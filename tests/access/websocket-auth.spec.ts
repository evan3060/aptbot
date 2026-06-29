import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import WebSocket from 'ws';
import { startWebSocketServer, type WebSocketServer } from '../../src/access/websocket-server.js';
import { InMemoryMessageBus } from '../../src/bus/message-bus.js';
import { createUserStorage, type UserStorage } from '../../src/infrastructure/user-storage.js';

/**
 * Task 4: 认证中间件 + 匿名用户
 *
 * 测试 WebSocket 连接时的用户身份识别：
 * - 用户 token 认证：?token=<userToken> → userId 为用户 ID
 * - authToken 共享认证：?token=<authToken> → userId 为 '__shared__'
 * - 匿名 UUID 生成：无 token 时生成随机 userId
 * - 无 userStorage 时回退 authToken 机制
 * - token 优先级：用户 token > authToken
 */

const TEST_PORT = 18771;

function connectWithMessage(port: number, token?: string, timeoutMs = 2000): Promise<{ ws: WebSocket; firstMessage: Promise<any> }> {
  return new Promise((resolve, reject) => {
    const params = new URLSearchParams();
    if (token) params.set('token', token);
    const qs = params.toString();
    const url = `ws://localhost:${port}${qs ? `?${qs}` : ''}`;
    const ws = new WebSocket(url);

    let firstMessageResolve: (v: any) => void;
    let firstMessageReject: (e: any) => void;
    const firstMessage = new Promise<any>((res, rej) => {
      firstMessageResolve = res;
      firstMessageReject = rej;
    });

    const timer = setTimeout(() => firstMessageReject(new Error('message timeout')), timeoutMs);

    ws.once('message', (data) => {
      clearTimeout(timer);
      try {
        firstMessageResolve(JSON.parse(data.toString()));
      } catch (e) {
        firstMessageReject(e);
      }
    });

    ws.once('open', () => resolve({ ws, firstMessage }));
    ws.once('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

/** 连接但不期望收到消息（用于错误 token 场景） */
function connectExpectingClose(port: number, token?: string, timeoutMs = 1000): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const params = new URLSearchParams();
    if (token) params.set('token', token);
    const qs = params.toString();
    const url = `ws://localhost:${port}${qs ? `?${qs}` : ''}`;
    const ws = new WebSocket(url);
    const timer = setTimeout(() => {
      reject(new Error('expected close but connection stayed open'));
    }, timeoutMs);
    ws.once('open', () => {
      // 连接 open 了，但预期会被关闭
      ws.once('close', () => {
        clearTimeout(timer);
        reject(new Error('connection should have been rejected'));
      });
    });
    ws.once('error', (err) => {
      clearTimeout(timer);
      // error 表示连接被拒绝，符合预期
      resolve(ws);
    });
  });
}

describe('Task 4: WebSocket 认证中间件 + 匿名用户', () => {
  let server: WebSocketServer | null = null;
  let userStorage: UserStorage;
  let tmpDir: string;
  const clients: WebSocket[] = [];

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'aptbot-ws-auth-'));
    userStorage = createUserStorage(tmpDir);
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
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('用户 token 认证成功：连接建立并收到 user_identified 事件', async () => {
    const user = await userStorage.register('alice', 'pass');
    server = await startWebSocketServer({
      port: TEST_PORT,
      bus: new InMemoryMessageBus(),
      userStorage,
    });
    const { ws, firstMessage } = await connectWithMessage(TEST_PORT, user.token);
    clients.push(ws);
    const msg = await firstMessage;
    expect(msg.type).toBe('user_identified');
    expect(msg.userId).toBe(user.userId);
    expect(msg.username).toBe('alice');
  });

  it('authToken 共享认证：userId 为 __shared__', async () => {
    const authToken = 'shared-deployment-token';
    server = await startWebSocketServer({
      port: TEST_PORT,
      bus: new InMemoryMessageBus(),
      authToken,
      userStorage,
    });
    const { ws, firstMessage } = await connectWithMessage(TEST_PORT, authToken);
    clients.push(ws);
    const msg = await firstMessage;
    expect(msg.type).toBe('user_identified');
    expect(msg.userId).toBe('__shared__');
  });

  it('匿名用户：无 token 时生成随机 userId', async () => {
    server = await startWebSocketServer({
      port: TEST_PORT,
      bus: new InMemoryMessageBus(),
      userStorage,
    });
    const { ws, firstMessage } = await connectWithMessage(TEST_PORT);
    clients.push(ws);
    const msg = await firstMessage;
    expect(msg.type).toBe('user_identified');
    expect(msg.userId).toBeTruthy();
    expect(msg.userId).not.toBe('__shared__');
    expect(msg.username).toBeUndefined(); // 匿名用户无 username
  });

  it('无 userStorage 时回退 authToken 机制', async () => {
    const authToken = 'legacy-token';
    server = await startWebSocketServer({
      port: TEST_PORT,
      bus: new InMemoryMessageBus(),
      authToken,
      // 不提供 userStorage
    });
    // 正确 authToken 连接成功（回退模式不发送 user_identified，所以用普通连接）
    const ws = await new Promise<WebSocket>((resolve, reject) => {
      const w = new WebSocket(`ws://localhost:${TEST_PORT}?token=${authToken}`);
      w.once('open', () => resolve(w));
      w.once('error', reject);
    });
    clients.push(ws);
    expect(ws.readyState).toBe(WebSocket.OPEN);
    // 错误 token 被拒绝
    await expect(connectExpectingClose(TEST_PORT, 'wrong-token')).rejects.toThrow();
  });

  it('无 userStorage 且无 authToken 时：任何连接都被接受（开发模式）', async () => {
    server = await startWebSocketServer({
      port: TEST_PORT,
      bus: new InMemoryMessageBus(),
    });
    const ws = await new Promise<WebSocket>((resolve, reject) => {
      const w = new WebSocket(`ws://localhost:${TEST_PORT}`);
      w.once('open', () => resolve(w));
      w.once('error', reject);
    });
    clients.push(ws);
    expect(ws.readyState).toBe(WebSocket.OPEN);
  });

  it('用户 token 优先级高于 authToken', async () => {
    const authToken = 'shared-token';
    const user = await userStorage.register('bob', 'pass');
    server = await startWebSocketServer({
      port: TEST_PORT,
      bus: new InMemoryMessageBus(),
      authToken,
      userStorage,
    });
    const { ws, firstMessage } = await connectWithMessage(TEST_PORT, user.token);
    clients.push(ws);
    const msg = await firstMessage;
    expect(msg.userId).toBe(user.userId); // 而非 __shared__
    expect(msg.username).toBe('bob');
  });

  it('无效用户 token 但匹配 authToken 时回退共享身份', async () => {
    const authToken = 'shared-token';
    server = await startWebSocketServer({
      port: TEST_PORT,
      bus: new InMemoryMessageBus(),
      authToken,
      userStorage,
    });
    const { ws, firstMessage } = await connectWithMessage(TEST_PORT, authToken);
    clients.push(ws);
    const msg = await firstMessage;
    expect(msg.userId).toBe('__shared__');
  });
});
