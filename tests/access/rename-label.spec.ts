import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import WebSocket from 'ws';
import { startWebSocketServer, type WebSocketServer } from '../../src/access/websocket-server.js';
import { InMemoryMessageBus } from '../../src/bus/message-bus.js';
import { createUserStorage, type UserStorage } from '../../src/infrastructure/user-storage.js';
import { FileStorage } from '../../src/infrastructure/storage/file-storage.js';

/**
 * 会话重命名功能测试
 *
 * Task 1+2+3 合并：
 * - POST /api/sessions/:id/label 路由
 * - onSessionRenamed 回调
 * - server.ts 广播 session_renamed 控制消息（通过 onSessionRenamed 回调）
 */

const TEST_PORT = 18790;

async function httpRequest(
  port: number,
  method: string,
  path: string,
  body?: unknown,
): Promise<{ status: number; body: any }> {
  const url = `http://localhost:${port}${path}`;
  const init: RequestInit = { method };
  if (body !== undefined) {
    init.headers = { 'content-type': 'application/json' };
    init.body = JSON.stringify(body);
  }
  const res = await fetch(url, init);
  const text = await res.text();
  let parsed: any = null;
  try { parsed = JSON.parse(text); } catch { parsed = text; }
  return { status: res.status, body: parsed };
}

function writeMeta(sessionsDir: string, sessionId: string, meta: Record<string, unknown>): void {
  writeFileSync(join(sessionsDir, `${sessionId}.meta.json`), JSON.stringify(meta));
}

function readMeta(sessionsDir: string, sessionId: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(sessionsDir, `${sessionId}.meta.json`), 'utf-8'));
}

describe('POST /api/sessions/:id/label — 会话重命名', () => {
  let server: WebSocketServer | null = null;
  let userStorage: UserStorage;
  let storage: FileStorage;
  let tmpDir: string;
  let sessionsDir: string;
  let onSessionRenamed: ReturnType<typeof vi.fn>;
  const wsClients: WebSocket[] = [];

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'aptbot-rename-'));
    sessionsDir = join(tmpDir, 'sessions');
    mkdirSync(sessionsDir, { recursive: true });
    userStorage = createUserStorage(tmpDir);
    storage = new FileStorage(sessionsDir);
    onSessionRenamed = vi.fn();
  });

  afterEach(async () => {
    for (const c of wsClients) {
      c.removeAllListeners();
      c.close();
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
      sessionStorage: storage,
      onSessionRenamed,
    });
  }

  function waitForWsMessage(ws: WebSocket, timeoutMs = 1000): Promise<any> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('message timeout')), timeoutMs);
      ws.once('message', (data) => {
        clearTimeout(timer);
        resolve(JSON.parse(data.toString()));
      });
    });
  }

  describe('成功路径', () => {
    it('有效 token + ownership 通过 → 200，meta.json 更新 label，onSessionRenamed 被调用', async () => {
      await startServer();
      const user = await userStorage.register('alice', 'pw123456');
      const sid = randomUUID();
      writeMeta(sessionsDir, sid, { userId: user.userId });
      writeFileSync(join(sessionsDir, `${sid}.jsonl`), '');

      const res = await httpRequest(
        TEST_PORT,
        'POST',
        `/api/sessions/${sid}/label?token=${user.token}`,
        { label: 'My New Name' },
      );
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ ok: true, label: 'My New Name' });
      // meta.json 应持久化 label
      const meta = readMeta(sessionsDir, sid);
      expect(meta.label).toBe('My New Name');
      // onSessionRenamed 回调应被调用
      expect(onSessionRenamed).toHaveBeenCalledTimes(1);
      expect(onSessionRenamed).toHaveBeenCalledWith(sid, 'My New Name');
    });

    it('label 超过 100 字符被截断', async () => {
      await startServer();
      const user = await userStorage.register('alice', 'pw123456');
      const sid = randomUUID();
      writeMeta(sessionsDir, sid, { userId: user.userId });
      writeFileSync(join(sessionsDir, `${sid}.jsonl`), '');

      const longLabel = 'a'.repeat(150);
      const res = await httpRequest(
        TEST_PORT,
        'POST',
        `/api/sessions/${sid}/label?token=${user.token}`,
        { label: longLabel },
      );
      expect(res.status).toBe(200);
      expect(res.body.label.length).toBe(100);
      const meta = readMeta(sessionsDir, sid);
      expect(meta.label).toBe('a'.repeat(100));
    });
  });

  describe('认证与权限', () => {
    it('无 token 返回 401', async () => {
      await startServer();
      const sid = randomUUID();
      const res = await httpRequest(TEST_PORT, 'POST', `/api/sessions/${sid}/label`, { label: 'x' });
      expect(res.status).toBe(401);
    });

    it('无效 token 返回 401', async () => {
      await startServer();
      const sid = randomUUID();
      const res = await httpRequest(
        TEST_PORT,
        'POST',
        `/api/sessions/${sid}/label?token=invalid`,
        { label: 'x' },
      );
      expect(res.status).toBe(401);
    });

    it('session 不存在（owner undefined）返回 404', async () => {
      await startServer();
      const user = await userStorage.register('alice', 'pw123456');
      const fakeSid = randomUUID();
      const res = await httpRequest(
        TEST_PORT,
        'POST',
        `/api/sessions/${fakeSid}/label?token=${user.token}`,
        { label: 'x' },
      );
      expect(res.status).toBe(404);
    });

    it('非 owner 返回 403', async () => {
      await startServer();
      const alice = await userStorage.register('alice', 'pw123456');
      const bob = await userStorage.register('bob', 'pw123456');
      const sid = randomUUID();
      writeMeta(sessionsDir, sid, { userId: bob.userId });

      const res = await httpRequest(
        TEST_PORT,
        'POST',
        `/api/sessions/${sid}/label?token=${alice.token}`,
        { label: 'x' },
      );
      expect(res.status).toBe(403);
    });
  });

  describe('参数校验', () => {
    it('空 label（trim 后）返回 400', async () => {
      await startServer();
      const user = await userStorage.register('alice', 'pw123456');
      const sid = randomUUID();
      writeMeta(sessionsDir, sid, { userId: user.userId });

      const res = await httpRequest(
        TEST_PORT,
        'POST',
        `/api/sessions/${sid}/label?token=${user.token}`,
        { label: '   ' },
      );
      expect(res.status).toBe(400);
      expect(res.body.error).toContain('label');
    });

    it('label 非 string 返回 400', async () => {
      await startServer();
      const user = await userStorage.register('alice', 'pw123456');
      const sid = randomUUID();
      writeMeta(sessionsDir, sid, { userId: user.userId });

      const res = await httpRequest(
        TEST_PORT,
        'POST',
        `/api/sessions/${sid}/label?token=${user.token}`,
        { label: 123 },
      );
      expect(res.status).toBe(400);
    });
  });

  describe('Task 3: 广播 session_renamed 控制消息（通过 onSessionRenamed）', () => {
    it('onSessionRenamed 回调签名正确：接收 (sessionId, label)', async () => {
      await startServer();
      const user = await userStorage.register('alice', 'pw123456');
      const sid = randomUUID();
      writeMeta(sessionsDir, sid, { userId: user.userId });
      writeFileSync(join(sessionsDir, `${sid}.jsonl`), '');

      await httpRequest(
        TEST_PORT,
        'POST',
        `/api/sessions/${sid}/label?token=${user.token}`,
        { label: 'Synced Name' },
      );
      expect(onSessionRenamed).toHaveBeenCalledWith(sid, 'Synced Name');
    });
  });
});
