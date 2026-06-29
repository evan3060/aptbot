import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { startWebSocketServer, type WebSocketServer } from '../../src/access/websocket-server.js';
import { InMemoryMessageBus } from '../../src/bus/message-bus.js';
import { createUserStorage, type UserStorage } from '../../src/infrastructure/user-storage.js';

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
): Promise<{ status: number; body: any }> {
  const url = `http://localhost:${port}${path}`;
  const init: RequestInit = { method, headers: { 'content-type': 'application/json', ...headers } };
  if (body !== undefined) init.body = JSON.stringify(body);
  const res = await fetch(url, init);
  const text = await res.text();
  let parsed: any = null;
  try { parsed = JSON.parse(text); } catch { parsed = text; }
  return { status: res.status, body: parsed };
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
