import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import WebSocket from 'ws';
import { startWebSocketServer, type WebSocketServer } from '../../src/access/websocket-server.js';
import { InMemoryMessageBus } from '../../src/bus/message-bus.js';
import { createUserStorage, type UserStorage } from '../../src/infrastructure/user-storage.js';
import { createChatPageHtml } from '../../src/access/chat-page.js';

/**
 * Task 3: HTTP 认证 API 端点
 *
 * 测试 POST /api/register、POST /api/login、GET /api/me 三个端点：
 * - 注册成功返回 token + userId
 * - 重复用户名注册返回 409
 * - 登录成功返回 token + userId
 * - 错误密码登录返回 401
 * - GET /api/me 有效 token 返回用户信息
 * - GET /api/me 无 token 返回 401
 */

const TEST_PORT = 18770;

async function httpRequest(
  port: number,
  method: string,
  path: string,
  body?: unknown,
  headers?: Record<string, string>,
): Promise<{ status: number; body: any; headers: Headers }> {
  const url = `http://localhost:${port}${path}`;
  const init: RequestInit = { method, headers: { 'content-type': 'application/json', ...headers } };
  if (body !== undefined) init.body = JSON.stringify(body);
  const res = await fetch(url, init);
  const text = await res.text();
  let parsed: any = null;
  try { parsed = JSON.parse(text); } catch { parsed = text; }
  return { status: res.status, body: parsed, headers: res.headers };
}

describe('Task 3: HTTP 认证 API', () => {
  let server: WebSocketServer | null = null;
  let userStorage: UserStorage;
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'aptbot-auth-api-'));
    userStorage = createUserStorage(tmpDir);
  });

  afterEach(async () => {
    if (server) {
      await server.stop();
      server = null;
    }
    rmSync(tmpDir, { recursive: true, force: true });
  });

  async function startServer(): Promise<void> {
    server = await startWebSocketServer({
      port: TEST_PORT,
      bus: new InMemoryMessageBus(),
      userStorage,
    });
  }

  describe('POST /api/register', () => {
    it('成功注册返回 200 + token + userId', async () => {
      await startServer();
      const res = await httpRequest(TEST_PORT, 'POST', '/api/register', {
        username: 'alice',
        password: 'password123',
      });
      expect(res.status).toBe(200);
      expect(res.body.token).toBeTruthy();
      expect(res.body.userId).toBeTruthy();
      expect(res.body.username).toBe('alice');
    });

    it('重复用户名返回 409', async () => {
      await startServer();
      await httpRequest(TEST_PORT, 'POST', '/api/register', {
        username: 'alice',
        password: 'pass1',
      });
      const res = await httpRequest(TEST_PORT, 'POST', '/api/register', {
        username: 'alice',
        password: 'pass2',
      });
      expect(res.status).toBe(409);
    });

    it('缺少字段返回 400', async () => {
      await startServer();
      const res = await httpRequest(TEST_PORT, 'POST', '/api/register', {
        username: 'alice',
      });
      expect(res.status).toBe(400);
    });

    it('非字符串字段返回 400（Task 3 I3 输入校验）', async () => {
      await startServer();
      const res = await httpRequest(TEST_PORT, 'POST', '/api/register', {
        username: 123,
        password: 'pass',
      });
      expect(res.status).toBe(400);
    });

    it('空白用户名返回 400', async () => {
      await startServer();
      const res = await httpRequest(TEST_PORT, 'POST', '/api/register', {
        username: '   ',
        password: 'pass',
      });
      expect(res.status).toBe(400);
    });

    it('超长用户名返回 400（> 64 字符）', async () => {
      await startServer();
      const res = await httpRequest(TEST_PORT, 'POST', '/api/register', {
        username: 'a'.repeat(65),
        password: 'pass',
      });
      expect(res.status).toBe(400);
    });
  });

  describe('POST /api/login', () => {
    it('正确凭据返回 200 + token', async () => {
      await startServer();
      await httpRequest(TEST_PORT, 'POST', '/api/register', {
        username: 'alice',
        password: 'password123',
      });
      const res = await httpRequest(TEST_PORT, 'POST', '/api/login', {
        username: 'alice',
        password: 'password123',
      });
      expect(res.status).toBe(200);
      expect(res.body.token).toBeTruthy();
      expect(res.body.userId).toBeTruthy();
    });

    it('错误密码返回 401', async () => {
      await startServer();
      await httpRequest(TEST_PORT, 'POST', '/api/register', {
        username: 'alice',
        password: 'correct',
      });
      const res = await httpRequest(TEST_PORT, 'POST', '/api/login', {
        username: 'alice',
        password: 'wrong',
      });
      expect(res.status).toBe(401);
    });

    it('不存在用户返回 401', async () => {
      await startServer();
      const res = await httpRequest(TEST_PORT, 'POST', '/api/login', {
        username: 'ghost',
        password: 'any',
      });
      expect(res.status).toBe(401);
    });
  });

  describe('GET /api/me', () => {
    it('有效 token 返回用户信息', async () => {
      await startServer();
      const reg = await httpRequest(TEST_PORT, 'POST', '/api/register', {
        username: 'alice',
        password: 'pass',
      });
      const res = await httpRequest(TEST_PORT, 'GET', '/api/me', undefined, {
        authorization: `Bearer ${reg.body.token}`,
      });
      expect(res.status).toBe(200);
      expect(res.body.userId).toBe(reg.body.userId);
      expect(res.body.username).toBe('alice');
    });

    it('无 token 返回 401', async () => {
      await startServer();
      const res = await httpRequest(TEST_PORT, 'GET', '/api/me');
      expect(res.status).toBe(401);
    });

    it('无效 token 返回 401', async () => {
      await startServer();
      const res = await httpRequest(TEST_PORT, 'GET', '/api/me', undefined, {
        authorization: 'Bearer invalid-token',
      });
      expect(res.status).toBe(401);
    });
  });
});

/**
 * Task 4 (0.2.2): HttpOnly cookie 安全增强
 *
 * 测试 token 从 sessionStorage 迁移到 HttpOnly+Secure+SameSite=Strict cookie：
 * - POST /api/register /api/login 成功时设置 Set-Cookie
 * - Cookie 属性 HttpOnly; Secure(HTTPS); SameSite=Strict; Path=/; Max-Age=2592000
 * - GET /api/me 优先读 cookie，其次 Authorization: Bearer
 * - WebSocket token 优先级 URL ?token= > cookie > sessionStorage
 * - cookie 被禁用时 fallback 到 sessionStorage（前端逻辑）
 * - 前端 fetch 自动带 cookie（credentials: 'include'）
 */

/** 从 Set-Cookie 头提取 name=value 部分 */
function parseCookieNameValue(setCookie: string): string {
  return setCookie.split(';')[0].trim();
}

/** 连接 WebSocket 并接收首条消息 */
function connectWsWithCookie(
  port: number,
  opts: { urlToken?: string; cookie?: string; session?: string },
  timeoutMs = 2000,
): { ws: WebSocket; firstMessage: Promise<any> } {
  const params = new URLSearchParams();
  if (opts.urlToken) params.set('token', opts.urlToken);
  if (opts.session) params.set('session', opts.session);
  const qs = params.toString();
  const url = `ws://localhost:${port}${qs ? `?${qs}` : ''}`;
  const wsOptions: WebSocket.ClientOptions = {};
  if (opts.cookie) wsOptions.headers = { cookie: opts.cookie };
  const ws = new WebSocket(url, wsOptions);

  let firstMessageResolve: (v: any) => void;
  let firstMessageReject: (e: any) => void;
  const firstMessage = new Promise<any>((res, rej) => {
    firstMessageResolve = res;
    firstMessageReject = rej;
  });
  const timer = setTimeout(() => firstMessageReject(new Error('message timeout')), timeoutMs);
  ws.once('message', (data) => {
    clearTimeout(timer);
    try { firstMessageResolve(JSON.parse(data.toString())); } catch (e) { firstMessageReject(e); }
  });
  ws.once('error', (err) => {
    clearTimeout(timer);
    firstMessageReject(err);
  });

  return { ws, firstMessage };
}

describe('Task 4 (0.2.2): HttpOnly cookie 安全增强', () => {
  let server: WebSocketServer | null = null;
  let userStorage: UserStorage;
  let tmpDir: string;
  const wsClients: WebSocket[] = [];

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'aptbot-cookie-'));
    userStorage = createUserStorage(tmpDir);
  });

  afterEach(async () => {
    for (const c of wsClients) {
      c.removeAllListeners();
      try { c.close(); } catch { /* ignore */ }
    }
    wsClients.length = 0;
    if (server) {
      await server.stop();
      server = null;
    }
    rmSync(tmpDir, { recursive: true, force: true });
  });

  async function startServer(): Promise<void> {
    server = await startWebSocketServer({
      port: TEST_PORT,
      bus: new InMemoryMessageBus(),
      userStorage,
    });
  }

  describe('POST /api/register /api/login Set-Cookie', () => {
    it('登录成功响应含 Set-Cookie，属性含 HttpOnly; SameSite=Strict; Path=/; Max-Age=2592000', async () => {
      await startServer();
      await httpRequest(TEST_PORT, 'POST', '/api/register', {
        username: 'alice',
        password: 'password123',
      });
      const res = await httpRequest(TEST_PORT, 'POST', '/api/login', {
        username: 'alice',
        password: 'password123',
      });
      expect(res.status).toBe(200);
      const setCookie = res.headers.get('set-cookie');
      expect(setCookie).toBeTruthy();
      expect(setCookie!).toContain('aptbot_token=');
      expect(setCookie!).toContain('HttpOnly');
      expect(setCookie!).toContain('SameSite=Strict');
      expect(setCookie!).toContain('Path=/');
      expect(setCookie!).toContain('Max-Age=2592000');
    });

    it('注册成功响应含 Set-Cookie', async () => {
      await startServer();
      const res = await httpRequest(TEST_PORT, 'POST', '/api/register', {
        username: 'bob',
        password: 'password123',
      });
      expect(res.status).toBe(200);
      const setCookie = res.headers.get('set-cookie');
      expect(setCookie).toBeTruthy();
      expect(setCookie!).toContain('aptbot_token=');
      expect(setCookie!).toContain('HttpOnly');
    });

    it('HTTP 环境下 Set-Cookie 不含 Secure（开发降级）', async () => {
      await startServer();
      await httpRequest(TEST_PORT, 'POST', '/api/register', {
        username: 'alice',
        password: 'pass',
      });
      const res = await httpRequest(TEST_PORT, 'POST', '/api/login', {
        username: 'alice',
        password: 'pass',
      });
      const setCookie = res.headers.get('set-cookie');
      expect(setCookie).toBeTruthy();
      expect(setCookie!).not.toContain('Secure');
    });

    it('HTTPS 环境（X-Forwarded-Proto: https）下 Set-Cookie 含 Secure', async () => {
      await startServer();
      const res = await httpRequest(TEST_PORT, 'POST', '/api/register', {
        username: 'alice',
        password: 'pass',
      }, { 'x-forwarded-proto': 'https' });
      const setCookie = res.headers.get('set-cookie');
      expect(setCookie).toBeTruthy();
      expect(setCookie!).toContain('Secure');
    });

    it('登录失败响应不含 Set-Cookie', async () => {
      await startServer();
      await httpRequest(TEST_PORT, 'POST', '/api/register', {
        username: 'alice',
        password: 'correct',
      });
      const res = await httpRequest(TEST_PORT, 'POST', '/api/login', {
        username: 'alice',
        password: 'wrong',
      });
      expect(res.status).toBe(401);
      expect(res.headers.get('set-cookie')).toBeNull();
    });
  });

  describe('GET /api/me 优先读 cookie', () => {
    it('携带 cookie 时返回对应用户信息', async () => {
      await startServer();
      const reg = await httpRequest(TEST_PORT, 'POST', '/api/register', {
        username: 'alice',
        password: 'pass',
      });
      const cookie = parseCookieNameValue(reg.headers.get('set-cookie')!);
      const res = await httpRequest(TEST_PORT, 'GET', '/api/me', undefined, {
        cookie,
      });
      expect(res.status).toBe(200);
      expect(res.body.userId).toBe(reg.body.userId);
      expect(res.body.username).toBe('alice');
    });

    it('cookie 与 Authorization Bearer 同时存在时优先读 cookie', async () => {
      await startServer();
      const aliceReg = await httpRequest(TEST_PORT, 'POST', '/api/register', {
        username: 'alice',
        password: 'pass',
      });
      const bobReg = await httpRequest(TEST_PORT, 'POST', '/api/register', {
        username: 'bob',
        password: 'pass',
      });
      const aliceCookie = parseCookieNameValue(aliceReg.headers.get('set-cookie')!);
      // 同时发 cookie (alice) + Bearer (bob) — cookie 应优先
      const res = await httpRequest(TEST_PORT, 'GET', '/api/me', undefined, {
        cookie: aliceCookie,
        authorization: `Bearer ${bobReg.body.token}`,
      });
      expect(res.status).toBe(200);
      expect(res.body.username).toBe('alice');
    });

    it('无 cookie 时回退 Authorization Bearer', async () => {
      await startServer();
      const reg = await httpRequest(TEST_PORT, 'POST', '/api/register', {
        username: 'alice',
        password: 'pass',
      });
      const res = await httpRequest(TEST_PORT, 'GET', '/api/me', undefined, {
        authorization: `Bearer ${reg.body.token}`,
      });
      expect(res.status).toBe(200);
      expect(res.body.username).toBe('alice');
    });
  });

  describe('WebSocket token 三级优先级（URL ?token= > cookie > sessionStorage）', () => {
    it('URL ?token= 优先级高于 cookie', async () => {
      await startServer();
      const aliceReg = await httpRequest(TEST_PORT, 'POST', '/api/register', {
        username: 'alice',
        password: 'pass',
      });
      const bobReg = await httpRequest(TEST_PORT, 'POST', '/api/register', {
        username: 'bob',
        password: 'pass',
      });
      const aliceCookie = parseCookieNameValue(aliceReg.headers.get('set-cookie')!);
      // 同时发 cookie (alice) + URL ?token= (bob) — URL 应优先
      const { ws, firstMessage } = connectWsWithCookie(TEST_PORT, {
        urlToken: bobReg.body.token,
        cookie: aliceCookie,
      });
      wsClients.push(ws);
      const msg = await firstMessage;
      expect(msg.type).toBe('user_identified');
      expect(msg.username).toBe('bob');
    });

    it('无 ?token= 时从 cookie 读取并认证成功', async () => {
      await startServer();
      const reg = await httpRequest(TEST_PORT, 'POST', '/api/register', {
        username: 'alice',
        password: 'pass',
      });
      const cookie = parseCookieNameValue(reg.headers.get('set-cookie')!);
      const { ws, firstMessage } = connectWsWithCookie(TEST_PORT, { cookie });
      wsClients.push(ws);
      const msg = await firstMessage;
      expect(msg.type).toBe('user_identified');
      expect(msg.username).toBe('alice');
    });
  });

  describe('POST /api/logout 清除 cookie', () => {
    it('登出响应设置 Max-Age=0 清除 cookie', async () => {
      await startServer();
      const res = await httpRequest(TEST_PORT, 'POST', '/api/logout');
      expect(res.status).toBe(200);
      const setCookie = res.headers.get('set-cookie');
      expect(setCookie).toBeTruthy();
      expect(setCookie!).toContain('aptbot_token=');
      expect(setCookie!).toContain('Max-Age=0');
    });
  });

  describe('cookie 被禁用时 fallback 到 sessionStorage（前端逻辑）', () => {
    const html = createChatPageHtml('/ws');

    it('内联 JS 检测 cookie 是否可用（cookieEnabled 探测）', () => {
      expect(html).toContain('cookieEnabled');
    });

    it('内联 JS fetch 调用包含 credentials: include（自动带 cookie）', () => {
      expect(html).toContain("credentials: 'include'");
    });

    it('内联 JS cookie 可用时不附加 ?token= 到 WS URL（让浏览器带 cookie）', () => {
      // cookieEnabled 为 true 时，resolveWsToken 返回 null（不附加到 URL）
      expect(html).toContain('cookieEnabled');
      // buildWsUrl 使用 resolveWsToken 决定是否附加 ?token=
      expect(html).toContain('resolveWsToken');
      expect(html).toContain("if (wsToken) params.set('token'");
    });

    it('内联 JS cookie 禁用时从 sessionStorage 取 token 作为 fallback', () => {
      // 验证 sessionStorage.getItem(TOKEN_KEY) 仍存在作为 fallback
      expect(html).toContain('sessionStorage.getItem(TOKEN_KEY)');
    });

    it('内联 JS 登出时调用 /api/logout 清除服务端 cookie', () => {
      expect(html).toContain('/api/logout');
    });
  });
});
