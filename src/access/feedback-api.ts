import { timingSafeEqual } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { z } from 'zod';
import type {
  FeedbackCategory,
  FeedbackEntry,
  FeedbackInput,
  FeedbackListFilter,
  FeedbackStatus,
} from '../infrastructure/feedback-storage.js';

/**
 * Task 8 (0.2.3): feedback API — handleFeedbackApi + RateLimiter
 *
 * 三类请求：
 * - POST /api/feedback         提交反馈（zod 校验 + 限流 + storage.append）
 * - GET  /api/feedback         列出反馈（需 auth）
 * - POST /api/feedback/:id/moderate  审核（需 auth）
 *
 * 当 feedbackStorage 为 undefined（feedbackEnabled:false）时，所有请求返回 404。
 * 限流：per-IP 滑动窗口，10/min + 60/hour，内存 Map，重启重置。
 */

/** FeedbackStorage 公共契约（结构化类型，便于注入 stub） */
export interface FeedbackStorageLike {
  append(input: FeedbackInput): Promise<FeedbackEntry>;
  list(
    filter: FeedbackListFilter,
  ): Promise<{ items: FeedbackEntry[]; total: number }>;
  findById(id: string): Promise<FeedbackEntry | null>;
  moderate(
    id: string,
    update: { status: 'resolved' | 'archived'; note?: string },
  ): Promise<FeedbackEntry | null>;
}

/** ArticleLoader 公共契约（仅需 getBySlug 校验文章存在） */
export interface ArticleLoaderLike {
  getBySlug(slug: string): { meta: { slug: string } } | null;
}

// === 限流常量 ===
const RATE_LIMIT_PER_MIN = 10;
const RATE_LIMIT_PER_HOUR = 60;
const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;

/**
 * Per-IP 滑动窗口限流器。内存 Map，重启重置（可接受）。
 * 两个独立窗口：分钟级（10/min）+ 小时级（60/hour）。
 * checkRateLimit 在检查时惰性清理过期时间戳。
 */
export class RateLimiter {
  private readonly minuteHits = new Map<string, number[]>();
  private readonly hourHits = new Map<string, number[]>();

  /**
   * 检查 ip 是否允许通过。若允许，记录本次命中。
   * 返回 { allowed, retryAfter }，retryAfter 单位为秒（≥1）。
   */
  checkRateLimit(ip: string): { allowed: boolean; retryAfter: number } {
    const now = Date.now();

    // 惰性清理过期时间戳
    const minuteTimes = (this.minuteHits.get(ip) ?? []).filter(
      (t) => now - t < MINUTE_MS,
    );
    const hourTimes = (this.hourHits.get(ip) ?? []).filter(
      (t) => now - t < HOUR_MS,
    );

    // 先查小时窗口（更长周期，更严格）
    if (hourTimes.length >= RATE_LIMIT_PER_HOUR) {
      const oldest = hourTimes[0];
      const retryAfterMs = oldest + HOUR_MS - now;
      return {
        allowed: false,
        retryAfter: Math.max(1, Math.ceil(retryAfterMs / 1000)),
      };
    }

    // 再查分钟窗口
    if (minuteTimes.length >= RATE_LIMIT_PER_MIN) {
      const oldest = minuteTimes[0];
      const retryAfterMs = oldest + MINUTE_MS - now;
      return {
        allowed: false,
        retryAfter: Math.max(1, Math.ceil(retryAfterMs / 1000)),
      };
    }

    // 放行：记录命中
    minuteTimes.push(now);
    hourTimes.push(now);
    this.minuteHits.set(ip, minuteTimes);
    this.hourHits.set(ip, hourTimes);

    return { allowed: true, retryAfter: 0 };
  }

  /** 重置所有计数器（测试用 / 模拟重启） */
  reset(): void {
    this.minuteHits.clear();
    this.hourHits.clear();
  }
}

/** 模块级共享限流器实例（handleFeedbackApi 使用） */
const defaultRateLimiter = new RateLimiter();

/** 重置共享限流器（测试间隔离用） */
export function resetRateLimiter(): void {
  defaultRateLimiter.reset();
}

// === zod 校验 schema ===

const slugRegex = /^[a-z0-9-]+$/;

const FeedbackBodySchema = z
  .object({
    message: z
      .string()
      .min(1)
      .max(2000)
      .refine((s) => s.trim().length > 0, {
        message: 'message must not be empty',
      }),
    category: z.enum(['general', 'article', 'bug', 'feature']).default('general'),
    articleSlug: z.string().regex(slugRegex).optional(),
    contact: z.string().max(120).optional(),
  })
  .superRefine((data, ctx) => {
    if (data.category === 'article' && !data.articleSlug) {
      ctx.addIssue({
        code: 'custom',
        path: ['articleSlug'],
        message: 'articleSlug is required when category=article',
      });
    }
    if (data.category !== 'article' && data.articleSlug) {
      ctx.addIssue({
        code: 'custom',
        path: ['articleSlug'],
        message: 'articleSlug is only allowed when category=article',
      });
    }
  });

const ModerateBodySchema = z.object({
  status: z.enum(['resolved', 'archived']),
  note: z.string().max(500).optional(),
});

// === 响应头 ===

const RESPONSE_HEADERS: Readonly<Record<string, string>> = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-cache, no-store, must-revalidate',
  'x-content-type-options': 'nosniff',
};

// === 辅助函数 ===

class BodyTooLargeError extends Error {
  constructor() {
    super('body too large');
    this.name = 'BodyTooLargeError';
  }
}

function readJsonBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => {
      data += chunk;
      if (data.length > 64 * 1024) {
        reject(new BodyTooLargeError());
        req.destroy();
      }
    });
    req.on('end', () => {
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch (e) {
        reject(e);
      }
    });
    req.on('error', reject);
  });
}

/** 从 x-forwarded-for（取链中第一个）或 req.socket.remoteAddress 提取客户端 IP */
function extractClientIp(req: IncomingMessage): string {
  const xff = req.headers['x-forwarded-for'];
  if (xff) {
    const xffStr = Array.isArray(xff) ? xff.join(',') : xff;
    const first = xffStr.split(',')[0].trim();
    if (first) return first;
  }
  return req.socket.remoteAddress ?? 'unknown';
}

/** 常量时间比较 token，防时序攻击 */
function safeEqualToken(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

/** 校验 Authorization: Bearer <token> 是否匹配 authToken */
function checkAuth(
  req: IncomingMessage,
  authToken: string | undefined,
): boolean {
  if (!authToken) return false;
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) return false;
  const token = authHeader.slice('Bearer '.length);
  return safeEqualToken(token, authToken);
}

/** 从 zod issues 中提取第一个 { error, field } */
function firstZodError(
  issues: z.core.$ZodIssue[],
): { error: string; field: string } {
  const issue = issues[0];
  const field =
    issue.path && issue.path.length > 0 ? String(issue.path[0]) : '';
  return { error: issue.message, field };
}

// === 主入口 ===

/**
 * 处理 /api/feedback 路由的 HTTP 请求。
 *
 * @param req          Node.js IncomingMessage
 * @param res          Node.js ServerResponse
 * @param pathname     已解析的 URL pathname（不含 query string）
 * @param feedbackStorage  FeedbackStorage 实例；undefined 表示 feedback 禁用，全部返回 404
 * @param articleLoader    可选，用于校验 category=article 时 articleSlug 存在
 * @param authToken         可选，admin token；GET/moderate 端点要求 Authorization: Bearer 匹配
 */
export async function handleFeedbackApi(
  req: IncomingMessage,
  res: ServerResponse,
  pathname: string,
  feedbackStorage: FeedbackStorageLike | undefined,
  articleLoader?: ArticleLoaderLike,
  authToken?: string,
): Promise<void> {
  const sendJson = (
    status: number,
    body: unknown,
    extraHeaders?: Record<string, string>,
  ): void => {
    res.writeHead(status, { ...RESPONSE_HEADERS, ...extraHeaders });
    res.end(JSON.stringify(body));
  };

  // feedbackStorage 为 undefined → feedback 禁用，全部 404
  if (!feedbackStorage) {
    sendJson(404, { ok: false, error: 'feedback disabled' });
    return;
  }

  try {
    // POST /api/feedback — 提交反馈
    if (pathname === '/api/feedback' && req.method === 'POST') {
      let body: unknown;
      try {
        body = await readJsonBody(req);
      } catch (err) {
        sendJson(400, {
          ok: false,
          error:
            err instanceof BodyTooLargeError
              ? 'request body too large'
              : 'invalid request body',
          field: '',
        });
        return;
      }

      const zodResult = FeedbackBodySchema.safeParse(body);
      if (!zodResult.success) {
        const { error, field } = firstZodError(zodResult.error.issues);
        sendJson(400, { ok: false, error, field });
        return;
      }

      const { message, category, articleSlug, contact } = zodResult.data;

      // category=article 时校验 articleSlug 存在
      if (category === 'article') {
        if (!articleLoader) {
          sendJson(400, {
            ok: false,
            error: 'article validation unavailable',
            field: 'articleSlug',
          });
          return;
        }
        const article = articleLoader.getBySlug(articleSlug as string);
        if (!article) {
          sendJson(400, {
            ok: false,
            error: 'article not found',
            field: 'articleSlug',
          });
          return;
        }
      }

      // 限流检查（per-IP 滑动窗口）
      const ip = extractClientIp(req);
      const rateLimit = defaultRateLimiter.checkRateLimit(ip);
      if (!rateLimit.allowed) {
        sendJson(
          429,
          { ok: false, error: '提交过于频繁，请稍后再试' },
          { 'retry-after': String(rateLimit.retryAfter) },
        );
        return;
      }

      // 持久化
      const userAgentHeader = req.headers['user-agent'];
      const userAgent =
        typeof userAgentHeader === 'string' ? userAgentHeader : undefined;

      const entry = await feedbackStorage.append({
        message,
        category,
        articleSlug,
        contact,
        ip,
        userAgent,
      });

      sendJson(200, { ok: true, id: entry.id });
      return;
    }

    // GET /api/feedback — 列出反馈（需 auth）
    if (pathname === '/api/feedback' && req.method === 'GET') {
      if (!checkAuth(req, authToken)) {
        sendJson(401, { ok: false, error: 'unauthorized' });
        return;
      }

      const url = new URL(req.url ?? '/', 'http://localhost');
      const params = url.searchParams;

      // 用可变局部对象构建 filter（FeedbackListFilter 字段为 readonly）
      const filter: {
        status?: FeedbackStatus;
        category?: FeedbackCategory;
        limit?: number;
        offset?: number;
      } = {};

      const statusParam = params.get('status');
      if (
        statusParam &&
        (statusParam === 'open' ||
          statusParam === 'resolved' ||
          statusParam === 'archived')
      ) {
        filter.status = statusParam as FeedbackStatus;
      }

      const categoryParam = params.get('category');
      if (
        categoryParam &&
        (categoryParam === 'general' ||
          categoryParam === 'article' ||
          categoryParam === 'bug' ||
          categoryParam === 'feature')
      ) {
        filter.category = categoryParam as FeedbackCategory;
      }

      const limitParam = params.get('limit');
      if (limitParam !== null) {
        const n = parseInt(limitParam, 10);
        if (!Number.isNaN(n)) filter.limit = n;
      }

      const offsetParam = params.get('offset');
      if (offsetParam !== null) {
        const n = parseInt(offsetParam, 10);
        if (!Number.isNaN(n)) filter.offset = n;
      }

      const result = await feedbackStorage.list(filter);
      sendJson(200, {
        ok: true,
        items: result.items,
        total: result.total,
      });
      return;
    }

    // POST /api/feedback/:id/moderate — 审核（需 auth）
    const moderateMatch = pathname.match(/^\/api\/feedback\/([^/]+)\/moderate$/);
    if (moderateMatch && req.method === 'POST') {
      if (!checkAuth(req, authToken)) {
        sendJson(401, { ok: false, error: 'unauthorized' });
        return;
      }

      const id = moderateMatch[1];

      let body: unknown;
      try {
        body = await readJsonBody(req);
      } catch (err) {
        sendJson(400, {
          ok: false,
          error:
            err instanceof BodyTooLargeError
              ? 'request body too large'
              : 'invalid request body',
          field: '',
        });
        return;
      }

      const zodResult = ModerateBodySchema.safeParse(body);
      if (!zodResult.success) {
        const { error, field } = firstZodError(zodResult.error.issues);
        sendJson(400, { ok: false, error, field });
        return;
      }

      const updated = await feedbackStorage.moderate(id, zodResult.data);
      if (!updated) {
        sendJson(404, { ok: false, error: 'feedback not found' });
        return;
      }

      sendJson(200, { ok: true, entry: updated });
      return;
    }

    // 未匹配任何端点
    sendJson(404, { ok: false, error: 'not found' });
  } catch (err) {
    sendJson(500, { ok: false, error: 'internal server error' });
  }
}
