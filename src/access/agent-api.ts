import { timingSafeEqual } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { AgentStorage } from '../core/agent/agent-storage.js';
import type { MemoryAuditLog } from '../core/agent/memory-audit-log.js';
import type { StorageAdapter } from '../infrastructure/storage/file-storage.js';
import type { UserStorage } from '../infrastructure/user-storage.js';
import {
  AGENT_SLUG_REGEX,
  MAX_AGENTS_PER_USER,
  generateSlug,
  type AgentProfile,
} from '../core/agent/agent-profile.js';
import { createLogger } from '../infrastructure/logger.js';

/**
 * §0.3.0 Task 9: Agent HTTP API（/api/agents 系列）
 *
 * 端点：
 * - GET    /api/agents                  列出当前用户的 agents
 * - GET    /api/agents/:slug            获取 agent 详情
 * - POST   /api/agents                  创建新 agent（专业 agent，slug 自动生成）
 * - PUT    /api/agents/:slug            更新 agent 配置（personality / LLM / 记忆开关）
 * - DELETE /api/agents/:slug            路由注册 + 403 default 不可删 + 501 专业 agent 占位
 * - GET    /api/agents/:slug/sessions   列出该 agent 的 sessions
 * - GET    /api/agents/:slug/memory     获取 MEMORY.md 内容
 * - GET    /api/agents/:slug/memory-log 获取写入审计日志（默认 20 条，query limit 可调）
 *
 * 鉴权：复用 authToken 机制（Bearer token）+ userStorage.findByToken 解析 userId。
 * 跨用户隔离：所有操作校验 agent.userId === currentUserId，否则 403。
 * 路径遍历防护：slug 严格正则校验（AGENT_SLUG_REGEX）。
 *
 * 重要约束：DELETE 端点本 task 仅注册路由 + 403 default + 501 占位。
 * 真正的归档逻辑由 Task 19 实现 archiveAgent 后接入。
 */

const log = createLogger('agent-api');

/** §0.3.0 MemoryAuditLog 工厂：根据 (userId, slug) 构造绑定到该 agent 的实例 */
export type MemoryAuditLogFactory = (userId: string, slug: string) => MemoryAuditLog;

/** §0.3.0 memory-log 默认返回条数（与 MemoryAuditLog.DEFAULT_LIST_LIMIT 一致） */
const DEFAULT_MEMORY_LOG_LIMIT = 20;

/** §0.3.0 memory-log 单次最大返回条数（防恶意拉取） */
const MAX_MEMORY_LOG_LIMIT = 1000;

/** §0.3.0 请求体大小上限（与 feedback-api 一致） */
const MAX_BODY_BYTES = 64 * 1024;

/** §0.3.0 默认 agent slug（不可删） */
const DEFAULT_AGENT_SLUG = 'default';

const RESPONSE_HEADERS: Readonly<Record<string, string>> = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-cache, no-store, must-revalidate',
  'x-content-type-options': 'nosniff',
};

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
      if (data.length > MAX_BODY_BYTES) {
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

/** 常量时间比较 token（防时序攻击，与 feedback-api / websocket-server 一致） */
function safeEqualToken(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

/**
 * §0.3.0 从请求中提取 token。
 * 优先级：cookie > Authorization: Bearer > URL ?token=
 * 与 websocket-server.ts extractAuthToken 完全一致。
 */
function extractAuthToken(req: IncomingMessage): string | null {
  // 1. Cookie
  const cookieHeader = req.headers.cookie;
  if (cookieHeader) {
    const cookies = parseCookies(cookieHeader);
    if (cookies['aptbot_token']) return cookies['aptbot_token'];
  }
  // 2. Authorization: Bearer
  const authHeader = req.headers.authorization;
  if (authHeader?.startsWith('Bearer ')) {
    return authHeader.slice('Bearer '.length);
  }
  // 3. URL ?token=
  const url = new URL(req.url ?? '/', 'http://localhost');
  return url.searchParams.get('token');
}

function parseCookies(cookieHeader: string | undefined): Record<string, string> {
  const result: Record<string, string> = {};
  if (!cookieHeader) return result;
  for (const part of cookieHeader.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const name = part.slice(0, idx).trim();
    const value = part.slice(idx + 1).trim();
    if (name) result[name] = decodeURIComponent(value);
  }
  return result;
}

interface ResolvedAuth {
  userId: string;
  username?: string;
}

/**
 * §0.3.0 解析当前请求的用户身份。
 *
 * 流程：
 * 1. extractAuthToken 提取 token（cookie > Bearer > URL ?token=）
 * 2. 若 userStorage 提供：findByToken 解析真实用户 → userId
 * 3. 否则若 authToken 提供：常量时间比较，匹配则用 SHARED_AGENT_USER_ID
 * 4. 否则 → null（401）
 *
 * 设计理由：SHARED_USER_ID（'__shared__'）不通过 USER_ID_REGEX，无法用于 AgentStorage 路径。
 * 故此处用合法 UUID v4 形态的占位 ID，仅供 authToken-only 部署使用。
 */
async function resolveAuth(
  req: IncomingMessage,
  userStorage: UserStorage | undefined,
  authToken: string | undefined,
): Promise<ResolvedAuth | null> {
  const token = extractAuthToken(req);
  if (!token) return null;

  if (userStorage) {
    const user = await userStorage.findByToken(token);
    if (user) {
      return { userId: user.userId, username: user.username };
    }
    // userStorage 存在但 token 不匹配 → 若同时配置了 authToken 则回退
  }

  if (authToken && safeEqualToken(token, authToken)) {
    return { userId: SHARED_AGENT_USER_ID };
  }

  return null;
}

/** §0.3.0 authToken-only 模式下的共享 userId（合法 UUID v4 形态，通过 USER_ID_REGEX） */
const SHARED_AGENT_USER_ID = '00000000-0000-4000-8000-000000000000';

/**
 * §0.3.0 stripSensitiveFields: 列表/详情响应中剥离非必要字段。
 *
 * AgentProfile 全部字段都视为可暴露给 agent owner（用户自己的数据），
 * 但 createdAt/updatedAt 在 PUT 后由 storage stat 决定，不应由客户端控制。
 * 此函数目前仅做透传（无敏感字段需剥离），保留扩展点。
 */
function stripSensitiveFields(profile: AgentProfile): AgentProfile {
  return profile;
}

/**
 * §0.3.0 handleAgentApi: 处理 /api/agents 路由的 HTTP 请求。
 *
 * @param req                  Node.js IncomingMessage
 * @param res                  Node.js ServerResponse
 * @param pathname             已解析的 URL pathname（不含 query string）
 * @param agentStorage         AgentStorage 实例
 * @param memoryAuditLogFactory  根据 (userId, slug) 构造 MemoryAuditLog 的工厂函数
 * @param sessionStorage       可选，用于 /:slug/sessions 端点
 * @param authToken            可选，admin/shared token（authToken-only 部署模式）
 * @param userStorage          可选，用户存储（多用户模式下的 token → userId 解析）
 */
export async function handleAgentApi(
  req: IncomingMessage,
  res: ServerResponse,
  pathname: string,
  agentStorage: AgentStorage,
  memoryAuditLogFactory: MemoryAuditLogFactory,
  sessionStorage: StorageAdapter | undefined,
  authToken: string | undefined,
  userStorage: UserStorage | undefined,
): Promise<void> {
  const sendJson = (status: number, body: unknown): void => {
    res.writeHead(status, RESPONSE_HEADERS);
    res.end(JSON.stringify(body));
  };

  // 1. 鉴权
  const auth = await resolveAuth(req, userStorage, authToken);
  if (!auth) {
    sendJson(401, { ok: false, error: 'unauthorized' });
    return;
  }
  const currentUserId = auth.userId;

  try {
    // 2. 路由分发
    // GET /api/agents — 列表
    if (pathname === '/api/agents' && req.method === 'GET') {
      const agents = await agentStorage.listAgents(currentUserId);
      sendJson(200, agents.map(stripSensitiveFields));
      return;
    }

    // POST /api/agents — 创建
    if (pathname === '/api/agents' && req.method === 'POST') {
      let body: unknown;
      try {
        body = await readJsonBody(req);
      } catch (err) {
        sendJson(400, {
          ok: false,
          error: err instanceof BodyTooLargeError ? 'request body too large' : 'invalid request body',
        });
        return;
      }

      const validation = validateCreateBody(body);
      if (!validation.ok) {
        sendJson(400, { ok: false, error: validation.error });
        return;
      }

      // 创建数量上限校验
      const count = await agentStorage.countAgents(currentUserId);
      if (count >= MAX_AGENTS_PER_USER) {
        sendJson(400, {
          ok: false,
          error: `agent limit reached (${MAX_AGENTS_PER_USER})`,
        });
        return;
      }

      // 生成 slug（重试 3 次防极端冲突）
      let slug = '';
      for (let attempt = 0; attempt < 3; attempt++) {
        const candidate = generateSlug();
        if (!(await agentStorage.exists(currentUserId, candidate))) {
          slug = candidate;
          break;
        }
      }
      if (!slug) {
        sendJson(500, { ok: false, error: 'slug generation conflict, retry' });
        return;
      }

      const now = Date.now();
      const profile: AgentProfile = {
        name: validation.name,
        description: validation.description,
        type: 'professional',
        slug,
        userId: currentUserId,
        createdAt: now,
        updatedAt: now,
        personality: validation.personality,
        ...(validation.model !== undefined && { model: validation.model }),
        ...(validation.temperature !== undefined && { temperature: validation.temperature }),
        ...(validation.maxTokens !== undefined && { maxTokens: validation.maxTokens }),
        ...(validation.reasoningEffort !== undefined && { reasoningEffort: validation.reasoningEffort }),
        ...(validation.thinkingType !== undefined && { thinkingType: validation.thinkingType }),
        ...(validation.thinkingBudgetTokens !== undefined && {
          thinkingBudgetTokens: validation.thinkingBudgetTokens,
        }),
      };

      await agentStorage.saveAgent(profile);
      log.info('agent created', { userId: currentUserId, slug });
      sendJson(200, stripSensitiveFields(profile));
      return;
    }

    // 子路径匹配：/api/agents/:slug/...
    const slugMatch = pathname.match(/^\/api\/agents\/([^/]+)(?:\/(.+))?$/);
    if (slugMatch) {
      const slugRaw = slugMatch[1];
      const subPath = slugMatch[2];

      // 路径遍历防护：slug 必须匹配 AGENT_SLUG_REGEX
      if (!AGENT_SLUG_REGEX.test(slugRaw)) {
        sendJson(400, { ok: false, error: 'invalid slug' });
        return;
      }
      const slug = slugRaw;

      // 无子路径：GET 详情 / PUT 更新 / DELETE 删除
      if (!subPath) {
        // GET /api/agents/:slug — 详情
        if (req.method === 'GET') {
          const agent = await agentStorage.getAgent(currentUserId, slug);
          if (!agent) {
            // 跨用户检测：agent 可能属于其他用户 → 403；确实不存在 → 404
            const owner = await agentStorage.findAgentOwner(slug);
            if (owner !== null) {
              sendJson(403, { ok: false, error: 'forbidden' });
            } else {
              sendJson(404, { ok: false, error: 'agent not found' });
            }
            return;
          }
          sendJson(200, stripSensitiveFields(agent));
          return;
        }

        // PUT /api/agents/:slug — 更新
        if (req.method === 'PUT') {
          const agent = await agentStorage.getAgent(currentUserId, slug);
          if (!agent) {
            const owner = await agentStorage.findAgentOwner(slug);
            if (owner !== null) {
              sendJson(403, { ok: false, error: 'forbidden' });
            } else {
              sendJson(404, { ok: false, error: 'agent not found' });
            }
            return;
          }

          let body: unknown;
          try {
            body = await readJsonBody(req);
          } catch (err) {
            sendJson(400, {
              ok: false,
              error: err instanceof BodyTooLargeError ? 'request body too large' : 'invalid request body',
            });
            return;
          }

          const update = validateUpdateBody(body);
          if (!update.ok) {
            sendJson(400, { ok: false, error: update.error });
            return;
          }

          const updated: AgentProfile = {
            ...agent,
            ...(update.name !== undefined && { name: update.name }),
            ...(update.description !== undefined && { description: update.description }),
            ...(update.personality !== undefined && { personality: update.personality }),
            ...(update.model !== undefined && { model: update.model }),
            ...(update.temperature !== undefined && { temperature: update.temperature }),
            ...(update.maxTokens !== undefined && { maxTokens: update.maxTokens }),
            ...(update.reasoningEffort !== undefined && { reasoningEffort: update.reasoningEffort }),
            ...(update.thinkingType !== undefined && { thinkingType: update.thinkingType }),
            ...(update.thinkingBudgetTokens !== undefined && {
              thinkingBudgetTokens: update.thinkingBudgetTokens,
            }),
            updatedAt: Date.now(),
          };

          await agentStorage.saveAgent(updated);
          log.info('agent updated', { userId: currentUserId, slug });
          sendJson(200, stripSensitiveFields(updated));
          return;
        }

        // DELETE /api/agents/:slug — 删除（仅注册路由 + 403 default + 501 占位）
        if (req.method === 'DELETE') {
          if (slug === DEFAULT_AGENT_SLUG) {
            sendJson(403, { ok: false, error: 'default agent cannot be deleted' });
            return;
          }
          // 专业 agent 归档逻辑由 Task 19 实现，此处返回 501 Not Implemented
          sendJson(501, { ok: false, error: 'archiving not implemented yet' });
          return;
        }

        // 其他 method → 405
        sendJson(405, { ok: false, error: 'method not allowed' });
        return;
      }

      // 有子路径：sessions / memory / memory-log
      // 先校验 ownership（所有子路径都需要）
      const agent = await agentStorage.getAgent(currentUserId, slug);
      if (!agent) {
        const owner = await agentStorage.findAgentOwner(slug);
        if (owner !== null) {
          sendJson(403, { ok: false, error: 'forbidden' });
        } else {
          sendJson(404, { ok: false, error: 'agent not found' });
        }
        return;
      }

      // GET /api/agents/:slug/sessions — session 列表
      if (subPath === 'sessions' && req.method === 'GET') {
        if (!sessionStorage) {
          sendJson(200, []);
          return;
        }
        const sessions = await sessionStorage.listSessions(currentUserId, slug);
        sendJson(200, sessions);
        return;
      }

      // GET /api/agents/:slug/memory — MEMORY.md 内容
      if (subPath === 'memory' && req.method === 'GET') {
        // agentStorage.getAgentDir 校验过 userId + slug，路径安全
        const memPath = join(agentStorage.getAgentDir(currentUserId, slug), 'MEMORY.md');
        let content = '';
        if (existsSync(memPath)) {
          try {
            content = readFileSync(memPath, 'utf-8');
          } catch (err) {
            log.error('read MEMORY.md failed', { path: memPath, error: String(err) });
            sendJson(500, { ok: false, error: 'failed to read memory' });
            return;
          }
        }
        sendJson(200, { content });
        return;
      }

      // GET /api/agents/:slug/memory-log — 审计日志
      if (subPath === 'memory-log' && req.method === 'GET') {
        const url = new URL(req.url ?? '/', 'http://localhost');
        const limitParam = url.searchParams.get('limit');
        let limit = DEFAULT_MEMORY_LOG_LIMIT;
        if (limitParam !== null) {
          const parsed = parseInt(limitParam, 10);
          if (!Number.isNaN(parsed) && parsed > 0) {
            limit = Math.min(parsed, MAX_MEMORY_LOG_LIMIT);
          }
        }
        const auditLog = memoryAuditLogFactory(currentUserId, slug);
        const records = await auditLog.list(limit);
        sendJson(200, records);
        return;
      }

      // 未匹配的子路径 → 404
      sendJson(404, { ok: false, error: 'not found' });
      return;
    }

    // 未匹配任何端点 → 404
    sendJson(404, { ok: false, error: 'not found' });
  } catch (err) {
    log.error('agent api error', { error: String(err), pathname });
    sendJson(500, { ok: false, error: 'internal server error' });
  }
}

// === 输入校验 ===

const REASONING_EFFORT_VALUES = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh'] as const;
const THINKING_TYPE_VALUES = ['adaptive', 'enabled', 'disabled'] as const;

interface CreateValidation {
  ok: true;
  name: string;
  description: string;
  personality: string;
  model?: string;
  temperature?: number;
  maxTokens?: number;
  reasoningEffort?: (typeof REASONING_EFFORT_VALUES)[number];
  thinkingType?: (typeof THINKING_TYPE_VALUES)[number];
  thinkingBudgetTokens?: number;
}
interface ValidationFailure {
  ok: false;
  error: string;
}

function validateCreateBody(body: unknown): CreateValidation | ValidationFailure {
  if (!body || typeof body !== 'object') {
    return { ok: false, error: 'invalid request body' };
  }
  const b = body as Record<string, unknown>;

  // 必填字段
  if (typeof b.name !== 'string' || b.name.trim().length === 0 || b.name.length > 64) {
    return { ok: false, error: 'name must be a non-empty string (max 64 chars)' };
  }
  if (typeof b.description !== 'string' || b.description.trim().length === 0 || b.description.length > 120) {
    return { ok: false, error: 'description must be a non-empty string (max 120 chars)' };
  }
  if (typeof b.personality !== 'string' || b.personality.length > 8192) {
    return { ok: false, error: 'personality must be a string (max 8192 chars)' };
  }

  const result: CreateValidation = {
    ok: true,
    name: b.name.trim(),
    description: b.description.trim(),
    personality: b.personality,
  };

  // 可选 LLM 字段
  if (b.model !== undefined) {
    if (typeof b.model !== 'string' || b.model.length === 0) {
      return { ok: false, error: 'model must be a non-empty string' };
    }
    result.model = b.model;
  }
  if (b.temperature !== undefined) {
    if (typeof b.temperature !== 'number' || b.temperature < 0 || b.temperature > 2) {
      return { ok: false, error: 'temperature must be a number in [0, 2]' };
    }
    result.temperature = b.temperature;
  }
  if (b.maxTokens !== undefined) {
    if (typeof b.maxTokens !== 'number' || !Number.isInteger(b.maxTokens) || b.maxTokens <= 0 || b.maxTokens > 200000) {
      return { ok: false, error: 'maxTokens must be a positive integer (max 200000)' };
    }
    result.maxTokens = b.maxTokens;
  }
  if (b.reasoningEffort !== undefined) {
    if (typeof b.reasoningEffort !== 'string' || !(REASONING_EFFORT_VALUES as readonly string[]).includes(b.reasoningEffort)) {
      return { ok: false, error: `reasoningEffort must be one of: ${REASONING_EFFORT_VALUES.join(', ')}` };
    }
    result.reasoningEffort = b.reasoningEffort as (typeof REASONING_EFFORT_VALUES)[number];
  }
  if (b.thinkingType !== undefined) {
    if (typeof b.thinkingType !== 'string' || !(THINKING_TYPE_VALUES as readonly string[]).includes(b.thinkingType)) {
      return { ok: false, error: `thinkingType must be one of: ${THINKING_TYPE_VALUES.join(', ')}` };
    }
    result.thinkingType = b.thinkingType as (typeof THINKING_TYPE_VALUES)[number];
  }
  if (b.thinkingBudgetTokens !== undefined) {
    if (typeof b.thinkingBudgetTokens !== 'number' || !Number.isInteger(b.thinkingBudgetTokens) || b.thinkingBudgetTokens <= 0) {
      return { ok: false, error: 'thinkingBudgetTokens must be a positive integer' };
    }
    result.thinkingBudgetTokens = b.thinkingBudgetTokens;
  }

  return result;
}

interface UpdateValidation {
  ok: true;
  name?: string;
  description?: string;
  personality?: string;
  model?: string;
  temperature?: number;
  maxTokens?: number;
  reasoningEffort?: (typeof REASONING_EFFORT_VALUES)[number];
  thinkingType?: (typeof THINKING_TYPE_VALUES)[number];
  thinkingBudgetTokens?: number;
}

function validateUpdateBody(body: unknown): UpdateValidation | ValidationFailure {
  if (!body || typeof body !== 'object') {
    return { ok: false, error: 'invalid request body' };
  }
  const b = body as Record<string, unknown>;

  const result: UpdateValidation = { ok: true };

  if (b.name !== undefined) {
    if (typeof b.name !== 'string' || b.name.trim().length === 0 || b.name.length > 64) {
      return { ok: false, error: 'name must be a non-empty string (max 64 chars)' };
    }
    result.name = b.name.trim();
  }
  if (b.description !== undefined) {
    if (typeof b.description !== 'string' || b.description.trim().length === 0 || b.description.length > 120) {
      return { ok: false, error: 'description must be a non-empty string (max 120 chars)' };
    }
    result.description = b.description.trim();
  }
  if (b.personality !== undefined) {
    if (typeof b.personality !== 'string' || b.personality.length > 8192) {
      return { ok: false, error: 'personality must be a string (max 8192 chars)' };
    }
    result.personality = b.personality;
  }
  if (b.model !== undefined) {
    if (typeof b.model !== 'string' || b.model.length === 0) {
      return { ok: false, error: 'model must be a non-empty string' };
    }
    result.model = b.model;
  }
  if (b.temperature !== undefined) {
    if (typeof b.temperature !== 'number' || b.temperature < 0 || b.temperature > 2) {
      return { ok: false, error: 'temperature must be a number in [0, 2]' };
    }
    result.temperature = b.temperature;
  }
  if (b.maxTokens !== undefined) {
    if (typeof b.maxTokens !== 'number' || !Number.isInteger(b.maxTokens) || b.maxTokens <= 0 || b.maxTokens > 200000) {
      return { ok: false, error: 'maxTokens must be a positive integer (max 200000)' };
    }
    result.maxTokens = b.maxTokens;
  }
  if (b.reasoningEffort !== undefined) {
    if (typeof b.reasoningEffort !== 'string' || !(REASONING_EFFORT_VALUES as readonly string[]).includes(b.reasoningEffort)) {
      return { ok: false, error: `reasoningEffort must be one of: ${REASONING_EFFORT_VALUES.join(', ')}` };
    }
    result.reasoningEffort = b.reasoningEffort as (typeof REASONING_EFFORT_VALUES)[number];
  }
  if (b.thinkingType !== undefined) {
    if (typeof b.thinkingType !== 'string' || !(THINKING_TYPE_VALUES as readonly string[]).includes(b.thinkingType)) {
      return { ok: false, error: `thinkingType must be one of: ${THINKING_TYPE_VALUES.join(', ')}` };
    }
    result.thinkingType = b.thinkingType as (typeof THINKING_TYPE_VALUES)[number];
  }
  if (b.thinkingBudgetTokens !== undefined) {
    if (typeof b.thinkingBudgetTokens !== 'number' || !Number.isInteger(b.thinkingBudgetTokens) || b.thinkingBudgetTokens <= 0) {
      return { ok: false, error: 'thinkingBudgetTokens must be a positive integer' };
    }
    result.thinkingBudgetTokens = b.thinkingBudgetTokens;
  }

  return result;
}
