import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import WebSocket from 'ws';
import { startWebSocketServer, type WebSocketServer } from '../../src/access/websocket-server.js';
import { InMemoryMessageBus } from '../../src/bus/message-bus.js';
import { createUserStorage, type UserStorage } from '../../src/infrastructure/user-storage.js';
import { FileStorage } from '../../src/infrastructure/storage/file-storage.js';

/**
 * Task 11: E2E 用户认证 + session 隔离
 *
 * 验证完整流程：
 * 1. 注册/登录 → 获取 token → /api/me 查询
 * 2. 两个不同用户的 session 列表互不串扰
 * 3. 匿名用户的 session 不被其他用户看到
 * 4. 跨用户访问他人 session 被拒绝
 *
 * 所有测试共用一个 server 实例，避免端口冲突。
 */

const BASE_PORT = 18775;
let portCounter = 0;
function nextPort(): number { return BASE_PORT + portCounter++; }

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

function createSessionFile(sessionsDir: string, id: string, opts?: { label?: string; userId?: string }): void {
  writeFileSync(join(sessionsDir, `${id}.jsonl`), '');
  if (opts?.label || opts?.userId) {
    const meta: Record<string, string> = {};
    if (opts?.label) meta.label = opts.label;
    if (opts?.userId) meta.userId = opts.userId;
    writeFileSync(join(sessionsDir, `${id}.meta.json`), JSON.stringify(meta));
  }
}

function connectWithListener(port: number, params: { token?: string; session?: string }): { ws: WebSocket; open: Promise<void> } {
  const sp = new URLSearchParams();
  if (params.token) sp.set('token', params.token);
  if (params.session) sp.set('session', params.session);
  const url = `ws://localhost:${port}?${sp.toString()}`;
  const ws = new WebSocket(url);
  const open = new Promise<void>((resolve, reject) => {
    ws.once('open', () => resolve());
    ws.once('error', reject);
  });
  return { ws, open };
}

function waitForMessage(ws: WebSocket, timeoutMs = 2000): Promise<any> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('message timeout')), timeoutMs);
    ws.once('message', (data) => {
      clearTimeout(timer);
      resolve(JSON.parse(data.toString()));
    });
  });
}

describe('Task 11: E2E 用户认证 + session 隔离', () => {
  let server: WebSocketServer | null = null;
  let userStorage: UserStorage;
  let storage: FileStorage;
  let tmpDir: string;
  let sessionsDir: string;
  let port: number;
  const clients: WebSocket[] = [];

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'aptbot-e2e-auth-'));
    sessionsDir = join(tmpDir, 'sessions');
    mkdirSync(sessionsDir, { recursive: true });
    userStorage = createUserStorage(tmpDir);
    storage = new FileStorage(sessionsDir);
    port = nextPort();
  });

  afterEach(async () => {
    for (const c of clients) {
      try { c.removeAllListeners(); } catch { /* ignore */ }
      try { c.close(); } catch { /* ignore */ }
    }
    clients.length = 0;
    if (server) {
      await server.stop();
      server = null;
    }
    rmSync(tmpDir, { recursive: true, force: true });
  });

  async function startServer(): Promise<void> {
    server = await startWebSocketServer({
      port,
      bus: new InMemoryMessageBus(),
      userStorage,
      sessionStorage: storage,
    });
  }

  it('完整认证流程：注册 → token → /api/me → WebSocket user_identified', async () => {
    await startServer();

    // 1. 注册
    const regRes = await httpRequest(port, 'POST', '/api/register', {
      username: 'alice',
      password: 'pw123456',
    });
    expect(regRes.status).toBe(200);
    expect(regRes.body.token).toBeTruthy();
    expect(regRes.body.userId).toBeTruthy();
    expect(regRes.body.username).toBe('alice');

    // 2. 用 token 查询 /api/me
    const meRes = await httpRequest(port, 'GET', '/api/me', undefined, {
      authorization: `Bearer ${regRes.body.token}`,
    });
    expect(meRes.status).toBe(200);
    expect(meRes.body.userId).toBe(regRes.body.userId);
    expect(meRes.body.username).toBe('alice');

    // 3. WebSocket 连接应收到 user_identified 事件（listener 在 open 前注册）
    const { ws, open } = connectWithListener(port, { token: regRes.body.token });
    clients.push(ws);
    const msgPromise = waitForMessage(ws);
    await open;
    const msg = await msgPromise;
    expect(msg.type).toBe('user_identified');
    expect(msg.username).toBe('alice');
  });

  it('登录流程：登录 → token → WebSocket user_identified', async () => {
    await startServer();

    // 先注册
    await httpRequest(port, 'POST', '/api/register', {
      username: 'bob',
      password: 'pw123456',
    });

    // 登录
    const loginRes = await httpRequest(port, 'POST', '/api/login', {
      username: 'bob',
      password: 'pw123456',
    });
    expect(loginRes.status).toBe(200);
    expect(loginRes.body.token).toBeTruthy();

    // WebSocket 连接应收到 user_identified
    const { ws, open } = connectWithListener(port, { token: loginRes.body.token });
    clients.push(ws);
    const msgPromise = waitForMessage(ws);
    await open;
    const msg = await msgPromise;
    expect(msg.type).toBe('user_identified');
    expect(msg.username).toBe('bob');
  });

  it('两个用户的 session 列表互不串扰 + 匿名 session 隔离', async () => {
    await startServer();

    const alice = await userStorage.register('alice', 'pw123456');
    const bob = await userStorage.register('bob', 'pw123456');

    // 创建分属两个用户的 session + 一个匿名 session
    createSessionFile(sessionsDir, randomUUID(), { label: 'alice-task-1', userId: alice.userId });
    createSessionFile(sessionsDir, randomUUID(), { label: 'alice-task-2', userId: alice.userId });
    createSessionFile(sessionsDir, randomUUID(), { label: 'bob-task-1', userId: bob.userId });
    createSessionFile(sessionsDir, randomUUID(), { label: 'anonymous-session' }); // 未 claim

    // alice 查询应只看到自己的 2 个 session
    const aliceRes = await httpRequest(port, 'GET', `/api/sessions?token=${alice.token}`);
    expect(aliceRes.status).toBe(200);
    expect(aliceRes.body.sessions.length).toBe(2);
    const aliceLabels = aliceRes.body.sessions.map((s: any) => s.label);
    expect(aliceLabels).toContain('alice-task-1');
    expect(aliceLabels).toContain('alice-task-2');
    expect(aliceLabels).not.toContain('bob-task-1');
    expect(aliceLabels).not.toContain('anonymous-session');

    // bob 查询应只看到自己的 1 个 session
    const bobRes = await httpRequest(port, 'GET', `/api/sessions?token=${bob.token}`);
    expect(bobRes.status).toBe(200);
    expect(bobRes.body.sessions.length).toBe(1);
    expect(bobRes.body.sessions[0].label).toBe('bob-task-1');
  });

  it('无效 token WebSocket 连接被拒绝 + 跨用户 session 访问被拒绝', async () => {
    await startServer();

    const alice = await userStorage.register('alice', 'pw123456');
    const bob = await userStorage.register('bob', 'pw123456');

    // 1. 无效 token 连接被拒绝
    const { ws: ws1, open: open1 } = connectWithListener(port, { token: 'invalid-token' });
    clients.push(ws1);
    const msg1Promise = waitForMessage(ws1);
    await open1;
    const msg1 = await msg1Promise;
    expect(msg1.type).toBe('error');
    expect(msg1.code).toBe('auth_failed');

    // 等待 ws1 完全关闭
    await new Promise((r) => setTimeout(r, 100));

    // 2. bob 尝试连接 alice 的 session — 应被拒绝
    const sid = randomUUID();
    createSessionFile(sessionsDir, sid, { userId: alice.userId });

    const { ws: ws2, open: open2 } = connectWithListener(port, { token: bob.token, session: sid });
    clients.push(ws2);
    const msg2Promise = waitForMessage(ws2);
    await open2;
    const msg2 = await msg2Promise;
    expect(msg2.type).toBe('error');
    expect(msg2.code).toBe('session_ownership_mismatch');
  });
});
