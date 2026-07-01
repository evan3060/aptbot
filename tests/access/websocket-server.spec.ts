import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import WebSocket from 'ws';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  startWebSocketServer,
  WS_MAX_CONNECTIONS,
  WS_INBOUND_CONTENT_MAX_BYTES,
  WS_INBOUND_RATE_LIMIT_PER_SEC,
  WS_OUTBOUND_BUFFER_MAX,
  type WebSocketServer,
} from '../../src/access/websocket-server.js';
import { InMemoryMessageBus } from '../../src/bus/message-bus.js';
import { createUserStorage } from '../../src/infrastructure/user-storage.js';
import type { MessageBus, AgentEventEnvelope } from '../../src/bus/types.js';
import type { ArticleLoader } from '../../src/learn/article-loader.js';
import type { FeedbackStorage } from '../../src/infrastructure/feedback-storage.js';
import { TRACKS, type Article, type ArticleState } from '../../src/learn/article-types.js';
import { resetRateLimiter } from '../../src/access/feedback-api.js';

const TEST_PORT = 18765;

function connect(port: number, token?: string, lastEventSeq?: number): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const params = new URLSearchParams();
    if (token) params.set('token', token);
    if (lastEventSeq !== undefined) params.set('lastEventSeq', String(lastEventSeq));
    const qs = params.toString();
    const url = `ws://localhost:${port}${qs ? `?${qs}` : ''}`;
    const ws = new WebSocket(url);
    ws.once('open', () => resolve(ws));
    ws.once('error', reject);
  });
}

function send(ws: WebSocket, data: unknown): void {
  ws.send(JSON.stringify(data));
}

function waitForMessage(ws: WebSocket, timeoutMs = 1000): Promise<any> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('message timeout')), timeoutMs);
    ws.once('message', (data) => {
      clearTimeout(timer);
      resolve(JSON.parse(data.toString()));
    });
  });
}

function makeEnvelope(seq: number, eventType: string = 'message_delta'): AgentEventEnvelope {
  const event: AgentEventEnvelope['event'] =
    eventType === 'agent_start'
      ? { type: 'agent_start' }
      : eventType === 'turn_start'
        ? { type: 'turn_start', turnId: 't1' }
        : eventType === 'turn_end'
          ? { type: 'turn_end', turnId: 't1' }
          : { type: 'message_delta', text: `delta-${seq}` };
  return { sessionKey: 's1', chatId: 'c1', channel: 'ws', event, seq };
}

describe('WebSocketServer', () => {
  let server: WebSocketServer | null = null;
  let bus: MessageBus;
  const clients: WebSocket[] = [];

  beforeEach(() => {
    bus = new InMemoryMessageBus();
  });

  afterEach(async () => {
    for (const c of clients) {
      c.removeAllListeners();
      c.close();
    }
    clients.length = 0;
    if (server) {
      await server.stop();
      server = null;
    }
  });

  it('exposes correct constants', () => {
    expect(WS_MAX_CONNECTIONS).toBe(50);
    expect(WS_INBOUND_CONTENT_MAX_BYTES).toBe(64 * 1024);
    expect(WS_INBOUND_RATE_LIMIT_PER_SEC).toBe(10);
  });

  it('starts and accepts connections', async () => {
    server = await startWebSocketServer({ port: TEST_PORT, bus });
    const ws = await connect(TEST_PORT);
    clients.push(ws);
    expect(server.getActiveConnections()).toBe(1);
  });

  it('stops cleanly', async () => {
    server = await startWebSocketServer({ port: TEST_PORT, bus });
    await server.stop();
    server = null;
    // 连接应被拒绝
    await expect(connect(TEST_PORT)).rejects.toThrow();
  });

  it('getActiveConnections returns 0 when no clients', async () => {
    server = await startWebSocketServer({ port: TEST_PORT, bus });
    expect(server.getActiveConnections()).toBe(0);
  });

  it('inbound message over 64KB returns inbound_too_large', async () => {
    server = await startWebSocketServer({ port: TEST_PORT, bus });
    const ws = await connect(TEST_PORT);
    clients.push(ws);
    const largeContent = 'x'.repeat(WS_INBOUND_CONTENT_MAX_BYTES + 1);
    send(ws, { type: 'message', content: largeContent });
    const msg = await waitForMessage(ws);
    expect(msg.type).toBe('error');
    expect(msg.code).toBe('inbound_too_large');
  });

  it('valid inbound message is published to bus', async () => {
    server = await startWebSocketServer({ port: TEST_PORT, bus });
    const ws = await connect(TEST_PORT);
    clients.push(ws);
    send(ws, { type: 'message', content: 'hello' });
    const inbound = await bus.consumeInbound();
    expect(inbound.content).toBe('hello');
  });

  it('rate limiting triggers rate_limited after exceeding 10/sec', async () => {
    server = await startWebSocketServer({ port: TEST_PORT, bus });
    const ws = await connect(TEST_PORT);
    clients.push(ws);
    // 快速发送超过限制的消息
    for (let i = 0; i < WS_INBOUND_RATE_LIMIT_PER_SEC + 5; i++) {
      send(ws, { type: 'message', content: `msg-${i}` });
    }
    // 应收到 rate_limited 错误
    let gotRateLimited = false;
    const messages: any[] = [];
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, 500);
      ws.on('message', (data) => {
        const msg = JSON.parse(data.toString());
        messages.push(msg);
        if (msg.code === 'rate_limited') {
          gotRateLimited = true;
          clearTimeout(timer);
          resolve();
        }
      });
    });
    expect(gotRateLimited).toBe(true);
  });

  it('auth token required when configured', async () => {
    server = await startWebSocketServer({ port: TEST_PORT, bus, authToken: 'secret' });
    // 无 token 连接应失败或收到 auth_error
    const ws = new WebSocket(`ws://localhost:${TEST_PORT}`);
    clients.push(ws);
    const msg = await new Promise<any>((resolve) => {
      ws.once('message', (data) => resolve(JSON.parse(data.toString())));
      ws.once('close', () => resolve({ type: 'closed' }));
    });
    expect(msg.type === 'error' || msg.type === 'closed').toBe(true);
  });

  it('auth token accepted when correct', async () => {
    server = await startWebSocketServer({ port: TEST_PORT, bus, authToken: 'secret' });
    const ws = await connect(TEST_PORT, 'secret');
    clients.push(ws);
    expect(server.getActiveConnections()).toBe(1);
  });

  // I1+I2 回归测试：broadcast 发送 {type:'event', seq, event} wrapper
  it('broadcast wraps envelope as {type:event, seq, event} (I1)', async () => {
    // Task 5: 加 fallbackSessionKey='s1' 与 makeEnvelope 的 sessionKey 匹配
    server = await startWebSocketServer({ port: TEST_PORT, bus, fallbackSessionKey: 's1' });
    const ws = await connect(TEST_PORT);
    clients.push(ws);

    server!.broadcast(makeEnvelope(42, 'agent_start'));
    const msg = await waitForMessage(ws);
    expect(msg.type).toBe('event');
    expect(msg.seq).toBe(42);
    expect(msg.event.type).toBe('agent_start');
  });

  // I1+I2 回归测试：reconnect with lastEventSeq replays buffered events
  it('replays buffered events on reconnect with lastEventSeq (I1+I2)', async () => {
    // Task 5: 加 fallbackSessionKey='s1' 与 makeEnvelope 的 sessionKey 匹配
    server = await startWebSocketServer({ port: TEST_PORT, bus, fallbackSessionKey: 's1' });

    // 第一个客户端连接
    const ws1 = await connect(TEST_PORT);
    clients.push(ws1);

    // 广播 3 个事件
    server!.broadcast(makeEnvelope(0, 'agent_start'));
    server!.broadcast(makeEnvelope(1, 'turn_start'));
    server!.broadcast(makeEnvelope(2, 'turn_end'));

    // 等待 ws1 接收
    const msgs1: any[] = [];
    await new Promise<void>((resolve) => {
      let count = 0;
      ws1.on('message', (data) => {
        msgs1.push(JSON.parse(data.toString()));
        count++;
        if (count >= 3) resolve();
      });
    });
    expect(msgs1[2].seq).toBe(2);

    // 断连 ws1
    ws1.close();
    await new Promise((r) => setTimeout(r, 100));

    // 离线时广播更多事件
    server!.broadcast(makeEnvelope(3, 'agent_start'));
    server!.broadcast(makeEnvelope(4, 'turn_end'));

    // 用 lastEventSeq=2 重连 —— 先注册 message listener 再等待 open，
    // 因为 server 的 replay 在 connection handler 中同步发送（早于 client open 事件）
    // Task 5: 显式 ?session=s1 确保绑定到同一 sessionKey
    const ws2 = new WebSocket(`ws://localhost:${TEST_PORT}?session=s1&lastEventSeq=2`);
    clients.push(ws2);
    const msgs2: any[] = [];
    const replayDone = new Promise<void>((resolve) => {
      let count = 0;
      ws2.on('message', (data) => {
        msgs2.push(JSON.parse(data.toString()));
        count++;
        if (count >= 2) resolve();
      });
      setTimeout(resolve, 1000);
    });
    await new Promise<void>((resolve, reject) => {
      ws2.once('open', () => resolve());
      ws2.once('error', reject);
    });
    await replayDone;

    expect(msgs2.length).toBe(2);
    expect(msgs2[0].seq).toBe(3);
    expect(msgs2[1].seq).toBe(4);
  });

  // I1 回归测试：lastEventSeq 过旧时发送 resync_required
  it('sends resync_required when lastEventSeq is too old (I1)', async () => {
    // Task 5: 加 fallbackSessionKey='s1' 与 makeEnvelope 的 sessionKey 匹配
    server = await startWebSocketServer({ port: TEST_PORT, bus, fallbackSessionKey: 's1' });

    // 广播超过 buffer 容量 + 5 条事件，驱逐 seq 0..4
    for (let i = 0; i < WS_OUTBOUND_BUFFER_MAX + 5; i++) {
      server!.broadcast(makeEnvelope(i, 'message_delta'));
    }

    // buffer 现在包含 seq 5..1004 (seq 0..4 被驱逐)
    // Task 6 I1 fix: lastEventSeq=0 现在表示"全新连接，回放所有"，不再触发 resync
    // 要触发 resync，需用 lastEventSeq > 0 且 < oldestSeq - 1，如 lastEventSeq=3 (3 < 5-1=4)
    const ws = new WebSocket(`ws://localhost:${TEST_PORT}?session=s1&lastEventSeq=3`);
    clients.push(ws);
    const msg = await new Promise<any>((resolve, reject) => {
      ws.once('message', (data) => resolve(JSON.parse(data.toString())));
      ws.once('error', reject);
      setTimeout(() => reject(new Error('message timeout')), 1000);
    });
    expect(msg.type).toBe('resync_required');
  });

  // Task 6 I1 fix: lastEventSeq=0 表示全新连接，回放整个 buffer（不触发 resync）
  it('replays entire buffer when lastEventSeq=0 (Task 6 I1 fix)', async () => {
    server = await startWebSocketServer({ port: TEST_PORT, bus, fallbackSessionKey: 's1' });

    // 广播 3 条事件
    server!.broadcast(makeEnvelope(10, 'agent_start'));
    server!.broadcast(makeEnvelope(11, 'turn_start'));
    server!.broadcast(makeEnvelope(12, 'turn_end'));

    // 用 lastEventSeq=0 连接 — 应回放所有 3 条，不触发 resync
    const ws = new WebSocket(`ws://localhost:${TEST_PORT}?session=s1&lastEventSeq=0`);
    clients.push(ws);
    const msgs: any[] = [];
    await new Promise<void>((resolve) => {
      let count = 0;
      ws.on('message', (data) => {
        msgs.push(JSON.parse(data.toString()));
        count++;
        if (count >= 3) resolve();
      });
      setTimeout(resolve, 1000);
    });
    expect(msgs.length).toBe(3);
    expect(msgs[0].seq).toBe(10);
    expect(msgs[2].seq).toBe(12);
  });

  // Task 7: landingPage 配置组 — 验证 serveHtml + serveDemoHtml 路由行为
  // 与 routing-landing.spec.ts 一致，使用占位 HTML 隔离真实页面生成逻辑
  describe('landingPage config', () => {
    const LANDING_PORT = 18785;
    const LANDING_HTML = '<html id="landing">';
    const DEMO_HTML = '<html id="chat">';
    let landingTmpDir: string | null = null;

    afterEach(() => {
      if (landingTmpDir) {
        rmSync(landingTmpDir, { recursive: true, force: true });
        landingTmpDir = null;
      }
    });

    async function httpGet(path: string): Promise<{ status: number; body: string; headers: Record<string, string> }> {
      const res = await fetch(`http://localhost:${LANDING_PORT}${path}`, { method: 'GET' });
      const text = await res.text();
      const headerMap: Record<string, string> = {};
      res.headers.forEach((v, k) => { headerMap[k.toLowerCase()] = v; });
      return { status: res.status, body: text, headers: headerMap };
    }

    async function httpPostJson(path: string, body: unknown): Promise<{ status: number }> {
      const res = await fetch(`http://localhost:${LANDING_PORT}${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      await res.text();
      return { status: res.status };
    }

    async function startLandingServer(): Promise<void> {
      landingTmpDir = mkdtempSync(join(tmpdir(), 'aptbot-ws-landing-'));
      const userStorage = createUserStorage(landingTmpDir);
      server = await startWebSocketServer({
        port: LANDING_PORT,
        bus,
        userStorage,
        serveHtml: LANDING_HTML,
        serveDemoHtml: DEMO_HTML,
      });
    }

    it('GET / 返回 landing HTML（serveHtml 行为不变）', async () => {
      await startLandingServer();
      const res = await httpGet('/');
      expect(res.status).toBe(200);
      expect(res.body).toContain('id="landing"');
      expect(res.headers['content-type']).toContain('text/html');
    });

    it('GET /demo 返回 chat HTML（serveDemoHtml）', async () => {
      await startLandingServer();
      const res = await httpGet('/demo');
      expect(res.status).toBe(200);
      expect(res.body).toContain('id="chat"');
      expect(res.headers['content-type']).toContain('text/html');
    });

    it('GET /demo/ 返回 chat HTML（宽松匹配 trailing slash）', async () => {
      await startLandingServer();
      const res = await httpGet('/demo/');
      expect(res.status).toBe(200);
      expect(res.body).toContain('id="chat"');
    });

    it('GET /demo/index.html 返回 chat HTML（宽松匹配 index.html）', async () => {
      await startLandingServer();
      const res = await httpGet('/demo/index.html');
      expect(res.status).toBe(200);
      expect(res.body).toContain('id="chat"');
    });

    it('POST /api/login 行为不变（错误凭据返回 401，非 404，未被 /demo 路由遮蔽）', async () => {
      await startLandingServer();
      const res = await httpPostJson('/api/login', { username: 'nobody', password: 'wrong' });
      expect(res.status).toBe(401);
    });
  });

  // Task 9: learn/feedback routing — /learn, /learn/:slug, /feedback, /api/feedback
  describe('Task 9: learn/feedback routing', () => {
    const LEARN_PORT = 18795;
    const AUTH_TOKEN = 'admin-secret';
    let learnTmpDir: string | null = null;

    afterEach(() => {
      if (learnTmpDir) {
        rmSync(learnTmpDir, { recursive: true, force: true });
        learnTmpDir = null;
      }
    });

    // Stub article data
    const testArticle: Article = {
      meta: {
        slug: 'test-article',
        title: 'Test Article Title',
        description: 'A test article for routing',
        track: 'agent-practice',
        chapter: 'Chapter 1',
        order: 1,
        difficulty: 'beginner',
        estimatedReadingTime: 5,
        status: 'published',
        prerequisites: [],
        lastUpdated: '2026-07-01',
        tags: ['test'],
      },
      renderedHtml: '<p>Test content</p>',
      markdownBody: 'Test content',
    };
    const testState: ArticleState = {
      articles: [testArticle],
      tracks: TRACKS,
      bySlug: new Map([['test-article', testArticle]]),
      byTrack: new Map([['agent-practice', [testArticle]]]),
    };

    function makeArticleLoaderStub(): ArticleLoader {
      return {
        getState: () => testState,
        getBySlug: (slug: string) => testState.bySlug.get(slug) ?? null,
        getArticleNav: (slug: string) => {
          const article = testState.bySlug.get(slug);
          if (!article) return { prev: null, next: null };
          return { prev: null, next: null };
        },
      } as unknown as ArticleLoader;
    }

    function makeFeedbackStorageStub(): FeedbackStorage {
      const entries: any[] = [];
      return {
        append: async (input: any) => {
          const entry = {
            id: `fb-test-${entries.length + 1}`,
            message: input.message,
            category: input.category,
            articleSlug: input.articleSlug,
            contact: input.contact,
            ip: input.ip,
            userAgent: input.userAgent,
            status: 'open' as const,
            createdAt: new Date().toISOString(),
          };
          entries.push(entry);
          return entry;
        },
        list: async (filter: any) => {
          let filtered = [...entries];
          const status = filter.status ?? 'open';
          filtered = filtered.filter((e) => e.status === status);
          if (filter.category) {
            filtered = filtered.filter((e) => e.category === filter.category);
          }
          return { items: filtered, total: filtered.length };
        },
        findById: async (id: string) => entries.find((e) => e.id === id) ?? null,
        moderate: async (id: string, update: any) => {
          const idx = entries.findIndex((e) => e.id === id);
          if (idx === -1) return null;
          const existing = entries[idx];
          const updated = {
            ...existing,
            status: update.status,
            moderatedAt: new Date().toISOString(),
            ...(update.note !== undefined ? { note: update.note } : {}),
          };
          entries[idx] = updated;
          return updated;
        },
      } as unknown as FeedbackStorage;
    }

    async function httpGet(path: string, headers?: Record<string, string>): Promise<{ status: number; body: string; headers: Record<string, string> }> {
      const res = await fetch(`http://localhost:${LEARN_PORT}${path}`, { method: 'GET', headers });
      const text = await res.text();
      const headerMap: Record<string, string> = {};
      res.headers.forEach((v, k) => { headerMap[k.toLowerCase()] = v; });
      return { status: res.status, body: text, headers: headerMap };
    }

    async function httpPostJson(path: string, body: unknown, headers?: Record<string, string>): Promise<{ status: number; body: any }> {
      const res = await fetch(`http://localhost:${LEARN_PORT}${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...headers },
        body: JSON.stringify(body),
      });
      const text = await res.text();
      let parsed: any = text;
      try { parsed = JSON.parse(text); } catch { /* keep text */ }
      return { status: res.status, body: parsed };
    }

    async function startLearnServer(opts: {
      learnEnabled?: boolean;
      feedbackEnabled?: boolean;
      articleLoader?: ArticleLoader;
      feedbackStorage?: FeedbackStorage;
      withUserStorage?: boolean;
      serveHtml?: string;
      serveDemoHtml?: string;
    } = {}): Promise<void> {
      resetRateLimiter();
      const options: Record<string, unknown> = {
        port: LEARN_PORT,
        bus,
        learnEnabled: opts.learnEnabled,
        feedbackEnabled: opts.feedbackEnabled,
        articleLoader: opts.articleLoader,
        feedbackStorage: opts.feedbackStorage,
        authToken: AUTH_TOKEN,
      };
      if (opts.withUserStorage) {
        learnTmpDir = mkdtempSync(join(tmpdir(), 'aptbot-ws-learn-'));
        options.userStorage = createUserStorage(learnTmpDir);
      }
      if (opts.serveHtml !== undefined) options.serveHtml = opts.serveHtml;
      if (opts.serveDemoHtml !== undefined) options.serveDemoHtml = opts.serveDemoHtml;
      server = await startWebSocketServer(options as any);
    }

    // 1. GET /learn when learnEnabled → 200 HTML
    it('GET /learn when learnEnabled returns 200 HTML (createLearnListHtml)', async () => {
      await startLearnServer({
        learnEnabled: true,
        articleLoader: makeArticleLoaderStub(),
      });
      const res = await httpGet('/learn');
      expect(res.status).toBe(200);
      expect(res.body).toContain('知识体系');
      expect(res.headers['content-type']).toContain('text/html');
    });

    // 2. GET /learn when !learnEnabled → 404
    it('GET /learn when !learnEnabled returns 404', async () => {
      await startLearnServer({ learnEnabled: false });
      const res = await httpGet('/learn');
      expect(res.status).toBe(404);
    });

    // 3. GET /learn/:slug when learnEnabled + article exists → 200 HTML
    it('GET /learn/:slug when learnEnabled + article exists returns 200 HTML', async () => {
      await startLearnServer({
        learnEnabled: true,
        articleLoader: makeArticleLoaderStub(),
      });
      const res = await httpGet('/learn/test-article');
      expect(res.status).toBe(200);
      expect(res.body).toContain('Test Article Title');
      expect(res.headers['content-type']).toContain('text/html');
    });

    // 4. GET /learn/:slug when article not found → friendly 404 HTML
    it('GET /learn/:slug when article not found returns friendly 404 HTML', async () => {
      await startLearnServer({
        learnEnabled: true,
        articleLoader: makeArticleLoaderStub(),
      });
      const res = await httpGet('/learn/nonexistent');
      expect(res.status).toBe(404);
      expect(res.body).toContain('文章不存在');
      expect(res.body).toContain('/learn');
      expect(res.headers['content-type']).toContain('text/html');
    });

    // 5. GET /learn/:slug when !learnEnabled → 404
    it('GET /learn/:slug when !learnEnabled returns 404', async () => {
      await startLearnServer({ learnEnabled: false });
      const res = await httpGet('/learn/test-article');
      expect(res.status).toBe(404);
    });

    // 6. GET /feedback when feedbackEnabled → 200 HTML
    it('GET /feedback when feedbackEnabled returns 200 HTML', async () => {
      await startLearnServer({ feedbackEnabled: true });
      const res = await httpGet('/feedback');
      expect(res.status).toBe(200);
      expect(res.body).toContain('留言反馈');
      expect(res.headers['content-type']).toContain('text/html');
    });

    // 7. GET /feedback when !feedbackEnabled → 404
    it('GET /feedback when !feedbackEnabled returns 404', async () => {
      await startLearnServer({ feedbackEnabled: false });
      const res = await httpGet('/feedback');
      expect(res.status).toBe(404);
    });

    // 8. POST /api/feedback when feedbackEnabled → handled by handleFeedbackApi
    it('POST /api/feedback when feedbackEnabled is handled by handleFeedbackApi', async () => {
      await startLearnServer({
        feedbackEnabled: true,
        feedbackStorage: makeFeedbackStorageStub(),
      });
      const res = await httpPostJson('/api/feedback', {
        message: 'Great work!',
        category: 'general',
      });
      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      expect(res.body.id).toBeTruthy();
    });

    // 9. POST /api/feedback when !feedbackEnabled → disabled response
    it('POST /api/feedback when !feedbackEnabled returns disabled response', async () => {
      await startLearnServer({ feedbackEnabled: false });
      const res = await httpPostJson('/api/feedback', {
        message: 'Great work!',
        category: 'general',
      });
      expect([403, 404, 503]).toContain(res.status);
    });

    // 10. GET /api/feedback when feedbackEnabled → handled by handleFeedbackApi
    it('GET /api/feedback when feedbackEnabled is handled by handleFeedbackApi', async () => {
      await startLearnServer({
        feedbackEnabled: true,
        feedbackStorage: makeFeedbackStorageStub(),
      });
      const res = await httpGet('/api/feedback', {
        authorization: `Bearer ${AUTH_TOKEN}`,
      });
      expect(res.status).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.ok).toBe(true);
      expect(body).toHaveProperty('items');
      expect(body).toHaveProperty('total');
    });

    // 11. Route order: /api/feedback takes priority over /api/*
    it('/api/feedback takes priority over /api/* (route order)', async () => {
      await startLearnServer({
        withUserStorage: true,
        feedbackEnabled: true,
        feedbackStorage: makeFeedbackStorageStub(),
      });
      // POST /api/feedback should be handled by handleFeedbackApi (returns { ok: true, id })
      // not handleAuthApi (which would return 404 { error: 'not found' })
      const res = await httpPostJson('/api/feedback', {
        message: 'Route order test',
        category: 'general',
      });
      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      expect(res.body.id).toBeTruthy();
    });

    // 12. HTML response headers correct
    it('HTML response headers include Content-Type, Cache-Control, X-Content-Type-Options', async () => {
      await startLearnServer({
        learnEnabled: true,
        feedbackEnabled: true,
        articleLoader: makeArticleLoaderStub(),
      });
      const res = await httpGet('/learn');
      expect(res.headers['content-type']).toBe('text/html; charset=utf-8');
      expect(res.headers['cache-control']).toBe('no-cache, no-store, must-revalidate');
      expect(res.headers['x-content-type-options']).toBe('nosniff');

      const res2 = await httpGet('/feedback');
      expect(res2.headers['x-content-type-options']).toBe('nosniff');
    });

    // 13. Existing routes still work (regression)
    it('existing routes (/, /demo, /api/*) still work (regression)', async () => {
      await startLearnServer({
        withUserStorage: true,
        serveHtml: '<html id="landing">',
        serveDemoHtml: '<html id="chat">',
        learnEnabled: true,
        feedbackEnabled: true,
        articleLoader: makeArticleLoaderStub(),
        feedbackStorage: makeFeedbackStorageStub(),
      });
      // GET / → landing HTML
      const resRoot = await httpGet('/');
      expect(resRoot.status).toBe(200);
      expect(resRoot.body).toContain('id="landing"');
      // GET /demo → chat HTML
      const resDemo = await httpGet('/demo');
      expect(resDemo.status).toBe(200);
      expect(resDemo.body).toContain('id="chat"');
      // POST /api/login → 401 (auth handler active)
      const resLogin = await httpPostJson('/api/login', { username: 'nobody', password: 'wrong' });
      expect(resLogin.status).toBe(401);
    });

    // 14. 404 page for unknown routes
    it('unknown routes return 404', async () => {
      await startLearnServer({ learnEnabled: true, feedbackEnabled: true });
      const res = await httpGet('/unknown-path');
      expect(res.status).toBe(404);
    });
  });
});
