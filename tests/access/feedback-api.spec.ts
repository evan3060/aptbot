import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createServer, type Server } from 'node:http';
import {
  handleFeedbackApi,
  RateLimiter,
  resetRateLimiter,
} from '../../src/access/feedback-api.js';
import type {
  FeedbackEntry,
  FeedbackInput,
  FeedbackListFilter,
  FeedbackStatus,
} from '../../src/infrastructure/feedback-storage.js';

/**
 * Task 8: feedback API — handleFeedbackApi + RateLimiter
 *
 * 19 项场景（按 brief 列表）+ IP 提取 + 响应头 + 独立 IP 计数：
 * 1. POST 合法 → 200 + { ok: true, id }
 * 2. POST message 空 → 400
 * 3. POST message > 2000 → 400
 * 4. POST category=article 缺 articleSlug → 400
 * 5. POST category=article 不存在 articleSlug → 400
 * 6. POST category 非法 → 400
 * 7. POST contact > 120 → 400
 * 8. POST 连续 11 次第 11 次 → 429 + Retry-After
 * 9. 限流重启重置（RateLimiter 新实例）
 * 10. 不同 IP 独立计数
 * 11. IP 从 x-forwarded-for 提取（取链中第一个）
 * 12. IP 从 req.socket.remoteAddress 兜底
 * 13. 响应头（Content-Type / Cache-Control / X-Content-Type-Options）
 * 14. GET 无 auth → 401
 * 15. GET 错误 auth → 401
 * 16. GET 正确 auth → 200 + items + total
 * 17. GET 正确 auth + limit=5 offset=10 分页
 * 18. GET 正确 auth + category=bug 过滤
 * 19. GET 正确 auth + status=open 默认
 * 20. POST moderate 无 auth → 401
 * 21. POST moderate 不存在 id → 404
 * 22. POST moderate 合法 → 200 + 更新后 entry
 * 23. feedbackEnabled:false（storage=undefined）→ 全 404
 */

/** 内存型 stub storage，模拟 FeedbackStorage 公共契约 */
class StubFeedbackStorage {
  entries: FeedbackEntry[] = [];
  appendCalls: FeedbackInput[] = [];

  async append(input: FeedbackInput): Promise<FeedbackEntry> {
    this.appendCalls.push(input);
    const entry: FeedbackEntry = {
      id: `fb-test-${this.entries.length + 1}`,
      message: input.message,
      category: input.category,
      articleSlug: input.articleSlug,
      contact: input.contact,
      ip: input.ip,
      userAgent: input.userAgent,
      status: 'open',
      createdAt: new Date().toISOString(),
    };
    this.entries.push(entry);
    return entry;
  }

  async list(
    filter: FeedbackListFilter,
  ): Promise<{ items: FeedbackEntry[]; total: number }> {
    let filtered = [...this.entries];
    const status: FeedbackStatus = filter.status ?? 'open';
    filtered = filtered.filter((e) => e.status === status);
    if (filter.category) {
      filtered = filtered.filter((e) => e.category === filter.category);
    }
    const total = filtered.length;
    const offset = Math.max(0, filter.offset ?? 0);
    const limit = Math.max(1, Math.min(100, filter.limit ?? 50));
    const items = filtered.slice(offset, offset + limit);
    return { items, total };
  }

  async findById(id: string): Promise<FeedbackEntry | null> {
    return this.entries.find((e) => e.id === id) ?? null;
  }

  async moderate(
    id: string,
    update: { status: 'resolved' | 'archived'; note?: string },
  ): Promise<FeedbackEntry | null> {
    const idx = this.entries.findIndex((e) => e.id === id);
    if (idx === -1) return null;
    const existing = this.entries[idx];
    const updated: FeedbackEntry = {
      ...existing,
      status: update.status,
      moderatedAt: new Date().toISOString(),
      ...(update.note !== undefined ? { note: update.note } : {}),
    };
    this.entries[idx] = updated;
    return updated;
  }
}

const AUTH_TOKEN = 'test-admin-token';

describe('Task 8: feedback API', () => {
  let server: Server | null = null;
  let port: number;
  let storage: StubFeedbackStorage;
  let articleLoader: {
    getBySlug: (slug: string) => { meta: { slug: string } } | null;
  };

  beforeEach(() => {
    resetRateLimiter();
    storage = new StubFeedbackStorage();
    articleLoader = {
      getBySlug(slug: string) {
        if (slug === 'existing-article') {
          return { meta: { slug } };
        }
        return null;
      },
    };
  });

  afterEach(async () => {
    if (server) {
      await new Promise<void>((r) => server!.close(() => r()));
      server = null;
    }
  });

  /** 启动测试服务器，使用默认 stub storage */
  async function startServer(): Promise<void> {
    server = createServer((req, res) => {
      const url = new URL(req.url ?? '/', 'http://localhost');
      handleFeedbackApi(
        req,
        res,
        url.pathname,
        storage,
        articleLoader,
        AUTH_TOKEN,
      );
    });
    await new Promise<void>((r) => server!.listen(0, '127.0.0.1', r));
    port = (server!.address() as { port: number }).port;
  }

  /** 启动测试服务器，feedback 禁用（storage=undefined） */
  async function startServerNoStorage(): Promise<void> {
    server = createServer((req, res) => {
      const url = new URL(req.url ?? '/', 'http://localhost');
      handleFeedbackApi(req, res, url.pathname, undefined, articleLoader, AUTH_TOKEN);
    });
    await new Promise<void>((r) => server!.listen(0, '127.0.0.1', r));
    port = (server!.address() as { port: number }).port;
  }

  async function request(
    method: string,
    path: string,
    body?: unknown,
    headers?: Record<string, string>,
  ): Promise<{ status: number; body: any; headers: Headers }> {
    const url = `http://localhost:${port}${path}`;
    const init: RequestInit = {
      method,
      headers: { 'content-type': 'application/json', ...headers },
    };
    if (body !== undefined) init.body = JSON.stringify(body);
    const res = await fetch(url, init);
    const text = await res.text();
    let parsed: any = null;
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = text;
    }
    return { status: res.status, body: parsed, headers: res.headers };
  }

  describe('POST /api/feedback', () => {
    it('1. 合法反馈 → 200 + { ok: true, id }', async () => {
      await startServer();
      const res = await request('POST', '/api/feedback', {
        message: 'great site',
        category: 'general',
      });
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ ok: true, id: 'fb-test-1' });
      expect(storage.appendCalls).toHaveLength(1);
      expect(storage.appendCalls[0].message).toBe('great site');
      expect(storage.appendCalls[0].category).toBe('general');
    });

    it('2. 缺 message → 400 + { ok: false, error, field }', async () => {
      await startServer();
      const res = await request('POST', '/api/feedback', {
        category: 'general',
      });
      expect(res.status).toBe(400);
      expect(res.body.ok).toBe(false);
      expect(res.body.error).toBeTruthy();
      expect(res.body.field).toBe('message');
    });

    it('3. message > 2000 字符 → 400', async () => {
      await startServer();
      const res = await request('POST', '/api/feedback', {
        message: 'x'.repeat(2001),
        category: 'general',
      });
      expect(res.status).toBe(400);
      expect(res.body.ok).toBe(false);
      expect(res.body.field).toBe('message');
    });

    it('4. category=article 缺 articleSlug → 400', async () => {
      await startServer();
      const res = await request('POST', '/api/feedback', {
        message: 'nice article',
        category: 'article',
      });
      expect(res.status).toBe(400);
      expect(res.body.ok).toBe(false);
      expect(res.body.field).toBe('articleSlug');
    });

    it('5. category=article 不存在 articleSlug → 400', async () => {
      await startServer();
      const res = await request('POST', '/api/feedback', {
        message: 'nice article',
        category: 'article',
        articleSlug: 'nonexistent',
      });
      expect(res.status).toBe(400);
      expect(res.body.ok).toBe(false);
      expect(res.body.field).toBe('articleSlug');
    });

    it('6. 非法 category → 400', async () => {
      await startServer();
      const res = await request('POST', '/api/feedback', {
        message: 'hi',
        category: 'invalid',
      });
      expect(res.status).toBe(400);
      expect(res.body.ok).toBe(false);
      expect(res.body.field).toBe('category');
    });

    it('7. contact > 120 字符 → 400', async () => {
      await startServer();
      const res = await request('POST', '/api/feedback', {
        message: 'hi',
        category: 'general',
        contact: 'x'.repeat(121),
      });
      expect(res.status).toBe(400);
      expect(res.body.ok).toBe(false);
      expect(res.body.field).toBe('contact');
    });

    it('8. 连续 11 次第 11 次 → 429 + Retry-After', async () => {
      await startServer();
      for (let i = 0; i < 10; i++) {
        const res = await request('POST', '/api/feedback', {
          message: `msg ${i}`,
          category: 'general',
        });
        expect(res.status).toBe(200);
      }
      const res = await request('POST', '/api/feedback', {
        message: 'one too many',
        category: 'general',
      });
      expect(res.status).toBe(429);
      expect(res.headers.get('retry-after')).toBeTruthy();
      const retryAfter = parseInt(res.headers.get('retry-after')!, 10);
      expect(retryAfter).toBeGreaterThan(0);
    });

    it('9. IP 从 x-forwarded-for 提取（取链中第一个）', async () => {
      await startServer();
      await request(
        'POST',
        '/api/feedback',
        { message: 'hi', category: 'general' },
        { 'x-forwarded-for': '1.2.3.4, 5.6.7.8' },
      );
      expect(storage.appendCalls[0].ip).toBe('1.2.3.4');
    });

    it('10. IP 从 req.socket.remoteAddress 兜底', async () => {
      await startServer();
      await request('POST', '/api/feedback', {
        message: 'hi',
        category: 'general',
      });
      expect(storage.appendCalls[0].ip).toBeTruthy();
      expect(storage.appendCalls[0].ip).not.toBe('unknown');
    });

    it('11. 响应头正确（Content-Type / Cache-Control / X-Content-Type-Options）', async () => {
      await startServer();
      const res = await request('POST', '/api/feedback', {
        message: 'hi',
        category: 'general',
      });
      expect(res.headers.get('content-type')).toBe(
        'application/json; charset=utf-8',
      );
      expect(res.headers.get('cache-control')).toBe(
        'no-cache, no-store, must-revalidate',
      );
      expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    });
  });

  describe('RateLimiter 类', () => {
    it('12. 重启重置（新实例计数器清零）', () => {
      const limiter1 = new RateLimiter();
      for (let i = 0; i < 10; i++) {
        expect(limiter1.checkRateLimit('1.2.3.4').allowed).toBe(true);
      }
      expect(limiter1.checkRateLimit('1.2.3.4').allowed).toBe(false);
      // 模拟重启：新实例
      const limiter2 = new RateLimiter();
      expect(limiter2.checkRateLimit('1.2.3.4').allowed).toBe(true);
    });

    it('13. 不同 IP 独立计数', () => {
      const limiter = new RateLimiter();
      for (let i = 0; i < 10; i++) {
        expect(limiter.checkRateLimit('1.1.1.1').allowed).toBe(true);
      }
      expect(limiter.checkRateLimit('1.1.1.1').allowed).toBe(false);
      // 不同 IP 不受影响
      expect(limiter.checkRateLimit('2.2.2.2').allowed).toBe(true);
    });
  });

  describe('GET /api/feedback', () => {
    it('14. 无 auth → 401', async () => {
      await startServer();
      const res = await request('GET', '/api/feedback');
      expect(res.status).toBe(401);
    });

    it('15. 错误 auth → 401', async () => {
      await startServer();
      const res = await request('GET', '/api/feedback', undefined, {
        authorization: 'Bearer wrong-token',
      });
      expect(res.status).toBe(401);
    });

    it('16. 正确 auth → 200 + items + total', async () => {
      await startServer();
      // 直接 seed stub storage，避免触发限流
      storage.entries.push(
        {
          id: 'fb-seed-1',
          message: 'a',
          category: 'general',
          ip: '127.0.0.1',
          status: 'open',
          createdAt: new Date().toISOString(),
        },
        {
          id: 'fb-seed-2',
          message: 'b',
          category: 'bug',
          ip: '127.0.0.1',
          status: 'open',
          createdAt: new Date().toISOString(),
        },
      );
      const res = await request('GET', '/api/feedback', undefined, {
        authorization: `Bearer ${AUTH_TOKEN}`,
      });
      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      expect(Array.isArray(res.body.items)).toBe(true);
      expect(res.body.items).toHaveLength(2);
      expect(res.body.total).toBe(2);
    });

    it('17. limit=5 offset=10 分页', async () => {
      await startServer();
      // 直接 seed 15 条
      for (let i = 0; i < 15; i++) {
        storage.entries.push({
          id: `fb-seed-${i}`,
          message: `msg ${i}`,
          category: 'general',
          ip: '127.0.0.1',
          status: 'open',
          createdAt: new Date().toISOString(),
        });
      }
      const res = await request('GET', '/api/feedback?limit=5&offset=10', undefined, {
        authorization: `Bearer ${AUTH_TOKEN}`,
      });
      expect(res.status).toBe(200);
      expect(res.body.items).toHaveLength(5);
      expect(res.body.total).toBe(15);
    });

    it('18. category=bug 过滤', async () => {
      await startServer();
      storage.entries.push(
        {
          id: 'fb-seed-1',
          message: 'a',
          category: 'general',
          ip: '127.0.0.1',
          status: 'open',
          createdAt: new Date().toISOString(),
        },
        {
          id: 'fb-seed-2',
          message: 'b',
          category: 'bug',
          ip: '127.0.0.1',
          status: 'open',
          createdAt: new Date().toISOString(),
        },
        {
          id: 'fb-seed-3',
          message: 'c',
          category: 'bug',
          ip: '127.0.0.1',
          status: 'open',
          createdAt: new Date().toISOString(),
        },
      );
      const res = await request('GET', '/api/feedback?category=bug', undefined, {
        authorization: `Bearer ${AUTH_TOKEN}`,
      });
      expect(res.status).toBe(200);
      expect(res.body.items).toHaveLength(2);
      expect(res.body.total).toBe(2);
      expect(
        res.body.items.every((e: FeedbackEntry) => e.category === 'bug'),
      ).toBe(true);
    });

    it('19. status=open 为默认', async () => {
      await startServer();
      storage.entries.push(
        {
          id: 'fb-seed-1',
          message: 'open one',
          category: 'general',
          ip: '127.0.0.1',
          status: 'open',
          createdAt: new Date().toISOString(),
        },
        {
          id: 'fb-seed-2',
          message: 'resolved one',
          category: 'general',
          ip: '127.0.0.1',
          status: 'resolved',
          createdAt: new Date().toISOString(),
          moderatedAt: new Date().toISOString(),
        },
      );
      const res = await request('GET', '/api/feedback', undefined, {
        authorization: `Bearer ${AUTH_TOKEN}`,
      });
      expect(res.status).toBe(200);
      expect(res.body.items).toHaveLength(1);
      expect(res.body.total).toBe(1);
      expect(res.body.items[0].status).toBe('open');
    });
  });

  describe('POST /api/feedback/:id/moderate', () => {
    it('20. 无 auth → 401', async () => {
      await startServer();
      storage.entries.push({
        id: 'fb-test-1',
        message: 'to moderate',
        category: 'general',
        ip: '127.0.0.1',
        status: 'open',
        createdAt: new Date().toISOString(),
      });
      const res = await request('POST', '/api/feedback/fb-test-1/moderate', {
        status: 'resolved',
      });
      expect(res.status).toBe(401);
    });

    it('21. 不存在 id → 404', async () => {
      await startServer();
      const res = await request(
        'POST',
        '/api/feedback/fb-nonexistent/moderate',
        { status: 'resolved' },
        { authorization: `Bearer ${AUTH_TOKEN}` },
      );
      expect(res.status).toBe(404);
    });

    it('22. 合法 → 200 + 更新后 entry', async () => {
      await startServer();
      storage.entries.push({
        id: 'fb-test-1',
        message: 'to moderate',
        category: 'general',
        ip: '127.0.0.1',
        status: 'open',
        createdAt: new Date().toISOString(),
      });
      const res = await request(
        'POST',
        '/api/feedback/fb-test-1/moderate',
        { status: 'resolved', note: 'fixed in v1.2' },
        { authorization: `Bearer ${AUTH_TOKEN}` },
      );
      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      expect(res.body.entry.id).toBe('fb-test-1');
      expect(res.body.entry.status).toBe('resolved');
      expect(res.body.entry.moderatedAt).toBeTruthy();
      expect(res.body.entry.note).toBe('fixed in v1.2');
    });
  });

  describe('feedbackEnabled: false（storage=undefined）', () => {
    it('23. POST → 404', async () => {
      await startServerNoStorage();
      const res = await request('POST', '/api/feedback', {
        message: 'hi',
        category: 'general',
      });
      expect(res.status).toBe(404);
    });

    it('24. GET → 404', async () => {
      await startServerNoStorage();
      const res = await request('GET', '/api/feedback', undefined, {
        authorization: `Bearer ${AUTH_TOKEN}`,
      });
      expect(res.status).toBe(404);
    });

    it('25. POST moderate → 404', async () => {
      await startServerNoStorage();
      const res = await request(
        'POST',
        '/api/feedback/fb-x/moderate',
        { status: 'resolved' },
        { authorization: `Bearer ${AUTH_TOKEN}` },
      );
      expect(res.status).toBe(404);
    });
  });
});
