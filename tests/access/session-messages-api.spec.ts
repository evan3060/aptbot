import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { startWebSocketServer, type WebSocketServer } from '../../src/access/websocket-server.js';
import { InMemoryMessageBus } from '../../src/bus/message-bus.js';
import { createUserStorage, type UserStorage } from '../../src/infrastructure/user-storage.js';
import { FileStorage } from '../../src/infrastructure/storage/file-storage.js';
import type { SessionEntry } from '../../src/core/memory/types.js';

/**
 * 验收修复：刷新页面后历史消失 + 默认会话名为 ID
 *
 * 1. GET /api/sessions/:id/messages — 从 JSONL 读取历史消息（仅 message 条目）
 * 2. listSessions 返回 preview（首条用户消息摘要）
 */

const TEST_PORT = 18780;

async function httpRequest(
  port: number,
  method: string,
  path: string,
): Promise<{ status: number; body: any }> {
  const url = `http://localhost:${port}${path}`;
  const res = await fetch(url, { method });
  const text = await res.text();
  let parsed: any = null;
  try { parsed = JSON.parse(text); } catch { parsed = text; }
  return { status: res.status, body: parsed };
}

/** 向 session JSONL 追加一条 message entry */
function appendMessageEntry(
  sessionsDir: string,
  sessionId: string,
  role: 'user' | 'assistant' | 'tool',
  content: string,
): void {
  const entry: SessionEntry = {
    type: 'message',
    id: `msg-${randomUUID()}`,
    message: {
      id: randomUUID(),
      role,
      content,
      timestamp: Date.now(),
    },
    timestamp: Date.now(),
  };
  appendFileSync(join(sessionsDir, `${sessionId}.jsonl`), JSON.stringify(entry) + '\n', 'utf-8');
}

function writeMeta(sessionsDir: string, sessionId: string, meta: Record<string, unknown>): void {
  writeFileSync(join(sessionsDir, `${sessionId}.meta.json`), JSON.stringify(meta));
}

describe('验收修复：session 历史 API + preview', () => {
  let server: WebSocketServer | null = null;
  let userStorage: UserStorage;
  let storage: FileStorage;
  let tmpDir: string;
  let sessionsDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'aptbot-session-msg-'));
    sessionsDir = join(tmpDir, 'sessions');
    mkdirSync(sessionsDir, { recursive: true });
    userStorage = createUserStorage(tmpDir);
    storage = new FileStorage(sessionsDir);
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
      sessionStorage: storage,
    });
  }

  describe('GET /api/sessions/:id/messages', () => {
    it('有效 token + ownership 通过，返回 message 条目列表', async () => {
      await startServer();
      const user = await userStorage.register('alice', 'pw123456');
      const sid = randomUUID();
      writeMeta(sessionsDir, sid, { userId: user.userId });
      appendMessageEntry(sessionsDir, sid, 'user', '你好');
      appendMessageEntry(sessionsDir, sid, 'assistant', '你好！有什么可以帮你的？');

      const res = await httpRequest(
        TEST_PORT,
        'GET',
        `/api/sessions/${sid}/messages?token=${user.token}`,
      );
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.messages)).toBe(true);
      expect(res.body.messages.length).toBe(2);
      expect(res.body.messages[0].message.role).toBe('user');
      expect(res.body.messages[0].message.content).toBe('你好');
      expect(res.body.messages[1].message.role).toBe('assistant');
    });

    it('无 token 返回 401', async () => {
      await startServer();
      const sid = randomUUID();
      const res = await httpRequest(TEST_PORT, 'GET', `/api/sessions/${sid}/messages`);
      expect(res.status).toBe(401);
    });

    it('无效 token 返回 401', async () => {
      await startServer();
      const sid = randomUUID();
      const res = await httpRequest(
        TEST_PORT,
        'GET',
        `/api/sessions/${sid}/messages?token=invalid`,
      );
      expect(res.status).toBe(401);
    });

    it('session 不属于当前用户返回 403', async () => {
      await startServer();
      const alice = await userStorage.register('alice', 'pw123456');
      const bob = await userStorage.register('bob', 'pw123456');
      const sid = randomUUID();
      // session 属于 bob
      writeMeta(sessionsDir, sid, { userId: bob.userId });
      appendMessageEntry(sessionsDir, sid, 'user', 'bob 的消息');

      const res = await httpRequest(
        TEST_PORT,
        'GET',
        `/api/sessions/${sid}/messages?token=${alice.token}`,
      );
      expect(res.status).toBe(403);
    });

    it('不存在的 session 返回 404', async () => {
      await startServer();
      const user = await userStorage.register('alice', 'pw123456');
      const fakeSid = randomUUID();
      const res = await httpRequest(
        TEST_PORT,
        'GET',
        `/api/sessions/${fakeSid}/messages?token=${user.token}`,
      );
      expect(res.status).toBe(404);
    });

    it('仅返回 message 条目，过滤 compaction/label/working_memory', async () => {
      await startServer();
      const user = await userStorage.register('alice', 'pw123456');
      const sid = randomUUID();
      writeMeta(sessionsDir, sid, { userId: user.userId });
      appendMessageEntry(sessionsDir, sid, 'user', '第一条');
      // 追加 compaction entry
      const compaction: SessionEntry = {
        type: 'compaction',
        id: 'comp-1',
        summary: '摘要',
        tokensBefore: 100,
        firstKeptEntryId: 'msg-1',
        timestamp: Date.now(),
      };
      appendFileSync(join(sessionsDir, `${sid}.jsonl`), JSON.stringify(compaction) + '\n', 'utf-8');
      appendMessageEntry(sessionsDir, sid, 'assistant', '回复');

      const res = await httpRequest(
        TEST_PORT,
        'GET',
        `/api/sessions/${sid}/messages?token=${user.token}`,
      );
      expect(res.status).toBe(200);
      expect(res.body.messages.length).toBe(2);
      // 全部都是 message 类型
      for (const m of res.body.messages) {
        expect(m.type).toBe('message');
      }
    });

    it('空 session 返回空数组', async () => {
      await startServer();
      const user = await userStorage.register('alice', 'pw123456');
      const sid = randomUUID();
      writeMeta(sessionsDir, sid, { userId: user.userId });
      // 创建空 jsonl 文件
      writeFileSync(join(sessionsDir, `${sid}.jsonl`), '');

      const res = await httpRequest(
        TEST_PORT,
        'GET',
        `/api/sessions/${sid}/messages?token=${user.token}`,
      );
      expect(res.status).toBe(200);
      expect(res.body.messages).toEqual([]);
    });
  });

  describe('listSessions 返回 preview（首条用户消息摘要）', () => {
    it('无 label 时返回 preview（首条 user 消息摘要）', async () => {
      const user = await userStorage.register('alice', 'pw123456');
      const sid = randomUUID();
      writeMeta(sessionsDir, sid, { userId: user.userId });
      // 通过 storage.appendSession 追加（触发 preview 缓存）
      await storage.appendSession(sid, {
        type: 'message',
        id: 'msg-1',
        message: { id: 'm1', role: 'user', content: '请帮我写一个排序算法的实现代码', timestamp: Date.now() },
        timestamp: Date.now(),
      });
      await storage.appendSession(sid, {
        type: 'message',
        id: 'msg-2',
        message: { id: 'm2', role: 'assistant', content: '好的，这是快速排序的实现...', timestamp: Date.now() },
        timestamp: Date.now(),
      });

      const sessions = await storage.listSessions(user.userId);
      expect(sessions.length).toBe(1);
      expect(sessions[0].preview).toBeTruthy();
      // preview 应包含用户消息的前若干字符
      expect(sessions[0].preview).toContain('请帮我写一个排序');
    });

    it('有 label 时 preview 仍可用（label 优先显示）', async () => {
      const user = await userStorage.register('alice', 'pw123456');
      const sid = randomUUID();
      writeMeta(sessionsDir, sid, { userId: user.userId, label: '自定义名称' });
      // 通过 storage.appendSession 追加（触发 preview 缓存）
      await storage.appendSession(sid, {
        type: 'message',
        id: 'msg-1',
        message: { id: 'm1', role: 'user', content: '这是用户消息内容', timestamp: Date.now() },
        timestamp: Date.now(),
      });

      const sessions = await storage.listSessions(user.userId);
      expect(sessions[0].label).toBe('自定义名称');
      // preview 也可用于 tooltip
      expect(sessions[0].preview).toBeTruthy();
    });

    it('无消息时 preview 为 undefined', async () => {
      const user = await userStorage.register('alice', 'pw123456');
      const sid = randomUUID();
      writeMeta(sessionsDir, sid, { userId: user.userId });
      writeFileSync(join(sessionsDir, `${sid}.jsonl`), '');

      const sessions = await storage.listSessions(user.userId);
      expect(sessions[0].preview).toBeUndefined();
    });
  });
});
