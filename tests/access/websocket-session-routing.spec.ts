import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import WebSocket from 'ws';
import {
  startWebSocketServer,
  type WebSocketServer,
} from '../../src/access/websocket-server.js';
import { FileStorage, SessionAlreadyClaimedError } from '../../src/infrastructure/storage/file-storage.js';
import { createSessionRepo, type SessionRepo } from '../../src/core/memory/session-repo.js';
import { createUserStorage, type UserStorage } from '../../src/infrastructure/user-storage.js';
import { InMemoryMessageBus } from '../../src/bus/message-bus.js';
import type { AgentEventEnvelope } from '../../src/bus/types.js';
import { SESSION_ID_REGEX } from '../../src/core/memory/types.js';

/**
 * Task 5: WebSocket sessionKey 路由 + session-user 关联
 *
 * 测试覆盖：
 * 1. WS 连接带 ?session=xxx 时绑定到指定 sessionKey
 * 2. WS 连接不带 ?session= 时使用默认 sessionKey（server 传入的 fallbackSessionKey）
 * 3. broadcast 仅向 sessionKey 匹配的 connection 发送（不串扰）
 * 4. file-storage.listSessions(userId) 按 userId 过滤
 * 5. file-storage.updateSessionLabel 持久化 label
 * 6. session-repo create(userId) + list(userId) 关联正确
 */

const TEST_PORT = 18772;

function makeEnvelope(sessionKey: string, seq: number): AgentEventEnvelope {
  return {
    sessionKey,
    chatId: 'c1',
    channel: 'ws',
    event: { type: 'message_delta', text: `delta-${seq}` },
    seq,
  };
}

function connectWithSession(
  port: number,
  sessionKey?: string,
  token?: string,
  timeoutMs = 2000,
): Promise<{ ws: WebSocket; firstMessage: Promise<any> }> {
  return new Promise((resolve, reject) => {
    const params = new URLSearchParams();
    if (sessionKey) params.set('session', sessionKey);
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

function waitForMessage(ws: WebSocket, timeoutMs = 1000): Promise<any> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('message timeout')), timeoutMs);
    ws.once('message', (data) => {
      clearTimeout(timer);
      resolve(JSON.parse(data.toString()));
    });
  });
}

describe('Task 5: WebSocket sessionKey 路由 + session-user 关联', () => {
  let server: WebSocketServer | null = null;
  let tmpDir: string;
  const clients: WebSocket[] = [];

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'aptbot-task5-'));
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

  describe('WS sessionKey 路由', () => {
    it('连接带 ?session=xxx 时绑定到指定 sessionKey，broadcast 仅发给该 session', async () => {
      server = await startWebSocketServer({
        port: TEST_PORT,
        bus: new InMemoryMessageBus(),
        fallbackSessionKey: 'default-session',
      });

      // 两个不同 session 的连接
      const { ws: wsA, firstMessage: msgA } = await connectWithSession(TEST_PORT, 'session-a');
      clients.push(wsA);
      const { ws: wsB, firstMessage: msgB } = await connectWithSession(TEST_PORT, 'session-b');
      clients.push(wsB);

      // 消费掉 user_identified / open 后的初始消息（若有）
      await msgA.catch(() => {});
      await msgB.catch(() => {});

      // 广播 session-a 的事件 — 只有 wsA 应收到
      server!.broadcast(makeEnvelope('session-a', 1));

      const receivedA = await waitForMessage(wsA);
      expect(receivedA.event.text).toBe('delta-1');

      // wsB 不应收到 session-a 的事件 — 等待 200ms 确认无消息
      let gotMessage = false;
      wsB.once('message', () => { gotMessage = true; });
      await new Promise((r) => setTimeout(r, 200));
      expect(gotMessage).toBe(false);

      // 广播 session-b 的事件 — 只有 wsB 应收到
      server!.broadcast(makeEnvelope('session-b', 2));
      const receivedB = await waitForMessage(wsB);
      expect(receivedB.event.text).toBe('delta-2');
    });

    it('连接不带 ?session= 时使用 fallbackSessionKey', async () => {
      server = await startWebSocketServer({
        port: TEST_PORT,
        bus: new InMemoryMessageBus(),
        fallbackSessionKey: 'fallback-session',
      });

      // 不带 ?session= 连接
      const ws = new WebSocket(`ws://localhost:${TEST_PORT}`);
      clients.push(ws);
      await new Promise<void>((resolve, reject) => {
        ws.once('open', () => resolve());
        ws.once('error', reject);
      });

      // 广播 fallback-session 的事件 — 应收到
      server!.broadcast(makeEnvelope('fallback-session', 1));
      const msg = await waitForMessage(ws);
      expect(msg.event.text).toBe('delta-1');

      // 广播其他 session 的事件 — 不应收到
      server!.broadcast(makeEnvelope('other-session', 2));
      let gotOther = false;
      ws.once('message', () => { gotOther = true; });
      await new Promise((r) => setTimeout(r, 200));
      expect(gotOther).toBe(false);
    });

    it('onSessionBound 回调在连接建立时触发，参数为 sessionKey', async () => {
      const boundKeys: string[] = [];
      server = await startWebSocketServer({
        port: TEST_PORT,
        bus: new InMemoryMessageBus(),
        fallbackSessionKey: 'fallback',
        onSessionBound: (sessionKey) => { boundKeys.push(sessionKey); },
      });

      const { ws: ws1 } = await connectWithSession(TEST_PORT, 'session-x');
      clients.push(ws1);
      const ws2 = new WebSocket(`ws://localhost:${TEST_PORT}`);
      clients.push(ws2);
      await new Promise<void>((resolve, reject) => {
        ws2.once('open', () => resolve());
        ws2.once('error', reject);
      });

      // 等待回调触发
      await new Promise((r) => setTimeout(r, 100));
      expect(boundKeys).toContain('session-x');
      expect(boundKeys).toContain('fallback');
    });
  });

  describe('file-storage: listSessions(userId) 过滤 + updateSessionLabel', () => {
    let storage: FileStorage;

    beforeEach(() => {
      mkdirSync(join(tmpDir, 'sessions'));
      storage = new FileStorage(join(tmpDir, 'sessions'));
    });

    function createSessionFile(sessionId: string): void {
      // 创建空 session 文件
      writeFileSync(join(tmpDir, 'sessions', `${sessionId}.jsonl`), '');
    }

    it('listSessions() 无 userId 参数时返回所有 sessions', async () => {
      const sid1 = randomUUID();
      const sid2 = randomUUID();
      createSessionFile(sid1);
      createSessionFile(sid2);

      await storage.claimSession(sid1, 'user-1');
      await storage.claimSession(sid2, 'user-2');

      const all = await storage.listSessions();
      expect(all.length).toBe(2);
    });

    it('listSessions(userId) 仅返回该 user 的 sessions', async () => {
      const sid1 = randomUUID();
      const sid2 = randomUUID();
      const sid3 = randomUUID();
      createSessionFile(sid1);
      createSessionFile(sid2);
      createSessionFile(sid3);

      await storage.claimSession(sid1, 'user-1');
      await storage.claimSession(sid2, 'user-2');
      await storage.claimSession(sid3, 'user-1');

      const user1Sessions = await storage.listSessions('user-1');
      expect(user1Sessions.length).toBe(2);
      expect(user1Sessions.every((s) => s.userId === 'user-1')).toBe(true);

      const user2Sessions = await storage.listSessions('user-2');
      expect(user2Sessions.length).toBe(1);
      expect(user2Sessions[0].id).toBe(sid2);
    });

    it('未 claim 的 session 在 listSessions(userId) 中不返回', async () => {
      const sid1 = randomUUID();
      const sid2 = randomUUID();
      createSessionFile(sid1);
      createSessionFile(sid2);

      await storage.claimSession(sid1, 'user-1');
      // sid2 未 claim

      const user1Sessions = await storage.listSessions('user-1');
      expect(user1Sessions.length).toBe(1);
      expect(user1Sessions[0].id).toBe(sid1);
    });

    it('listSessions() 无 userId 时返回所有（含未 claim 的）', async () => {
      const sid1 = randomUUID();
      const sid2 = randomUUID();
      createSessionFile(sid1);
      createSessionFile(sid2);

      await storage.claimSession(sid1, 'user-1');
      // sid2 未 claim

      const all = await storage.listSessions();
      expect(all.length).toBe(2);
    });

    it('updateSessionLabel 持久化 label，listSessions 返回时含 label', async () => {
      const sid = randomUUID();
      createSessionFile(sid);

      await storage.updateSessionLabel(sid, '调试登录问题');
      const sessions = await storage.listSessions();
      const target = sessions.find((s) => s.id === sid);
      expect(target?.label).toBe('调试登录问题');
    });

    it('claimSession 幂等：重复 claim 同一 user 不报错', async () => {
      const sid = randomUUID();
      createSessionFile(sid);

      await storage.claimSession(sid, 'user-1');
      await storage.claimSession(sid, 'user-1'); // 不抛错
      const sessions = await storage.listSessions('user-1');
      expect(sessions.length).toBe(1);
    });
  });

  describe('session-repo: create(userId) + list(userId)', () => {
    let storage: FileStorage;
    let repo: SessionRepo;

    beforeEach(() => {
      mkdirSync(join(tmpDir, 'sessions'));
      storage = new FileStorage(join(tmpDir, 'sessions'));
      repo = createSessionRepo(storage);
    });

    it('create(userId) 创建 session 并 claim 到该 user', async () => {
      const session = await repo.create('user-1');
      expect(session.id).toMatch(SESSION_ID_REGEX);
      // 写入一条 entry 触发文件创建
      await session.append({
        type: 'message',
        id: 'm1',
        message: { role: 'user', content: 'hello' } as any,
        timestamp: Date.now(),
      });
      const user1Sessions = await repo.list('user-1');
      expect(user1Sessions.some((s) => s.id === session.id)).toBe(true);
    });

    it('list(userId) 仅返回该 user 的 sessions', async () => {
      const s1 = await repo.create('user-1');
      const s2 = await repo.create('user-2');
      await s1.append({ type: 'message', id: 'm1', message: { role: 'user', content: 'a' } as any, timestamp: Date.now() });
      await s2.append({ type: 'message', id: 'm2', message: { role: 'user', content: 'b' } as any, timestamp: Date.now() });

      const user1 = await repo.list('user-1');
      const user2 = await repo.list('user-2');
      expect(user1.some((s) => s.id === s1.id)).toBe(true);
      expect(user1.some((s) => s.id === s2.id)).toBe(false);
      expect(user2.some((s) => s.id === s2.id)).toBe(true);
    });

    it('open(id, userId) 对已 claim 到其他 user 的 session 抛 SessionAlreadyClaimedError', async () => {
      // 先用 user-1 创建
      const s1 = await repo.create('user-1');
      await s1.append({ type: 'message', id: 'm1', message: { role: 'user', content: 'a' } as any, timestamp: Date.now() });

      // user-2 open 同一 session — I8 fix 后抛错而非覆盖
      await expect(repo.open(s1.id, 'user-2')).rejects.toBeInstanceOf(SessionAlreadyClaimedError);

      // 原 owner 仍可访问
      const user1Sessions = await repo.list('user-1');
      expect(user1Sessions.some((s) => s.id === s1.id)).toBe(true);
      const user2Sessions = await repo.list('user-2');
      expect(user2Sessions.some((s) => s.id === s1.id)).toBe(false);
    });

    it('updateLabel 调用 storage.updateSessionLabel', async () => {
      const s1 = await repo.create('user-1');
      await s1.append({ type: 'message', id: 'm1', message: { role: 'user', content: 'a' } as any, timestamp: Date.now() });
      await repo.updateLabel(s1.id, '新标签');

      const sessions = await repo.list('user-1');
      const target = sessions.find((s) => s.id === s1.id);
      expect(target?.label).toBe('新标签');
    });
  });

  describe('集成：WS 路由 + userStorage', () => {
    let userStorage: UserStorage;

    beforeEach(() => {
      userStorage = createUserStorage(tmpDir);
    });

    it('注册用户连接时收到 user_identified，且可携带 ?session=', async () => {
      const user = await userStorage.register('alice', 'pass');
      server = await startWebSocketServer({
        port: TEST_PORT,
        bus: new InMemoryMessageBus(),
        userStorage,
        fallbackSessionKey: 'fallback',
      });

      const { ws, firstMessage } = await connectWithSession(TEST_PORT, 'my-session', user.token);
      clients.push(ws);
      const msg = await firstMessage;
      expect(msg.type).toBe('user_identified');
      expect(msg.userId).toBe(user.userId);
      expect(msg.username).toBe('alice');

      // 广播到 'my-session' 应收到
      server!.broadcast(makeEnvelope('my-session', 1));
      const event = await waitForMessage(ws);
      expect(event.event.text).toBe('delta-1');
    });
  });

  /**
   * Code review fixes — C1 (writeMeta race via lock + atomic write),
   * C2 (?session= ownership check), I4/I5 (cleanup on close),
   * I6 (multi-client same session), I7 (regression test for identifyUser change),
   * I8 (claimSession cross-user refuses), I10 (deleteSession removes meta).
   */
  describe('code review fixes', () => {
    let storage: FileStorage;
    let userStorage: UserStorage;
    let sessionsDir: string;

    beforeEach(() => {
      sessionsDir = join(tmpDir, 'sessions');
      mkdirSync(sessionsDir);
      storage = new FileStorage(sessionsDir);
      userStorage = createUserStorage(tmpDir);
    });

    it('I7: userStorage + authToken + 无 token → 拒绝连接（regression）', async () => {
      server = await startWebSocketServer({
        port: TEST_PORT,
        bus: new InMemoryMessageBus(),
        authToken: 'shared-secret',
        userStorage,
        fallbackSessionKey: 'fallback',
      });

      // 无 token 连接应被拒绝（即使有 userStorage）
      const ws = new WebSocket(`ws://localhost:${TEST_PORT}`);
      clients.push(ws);
      const result = await new Promise<{ rejected: boolean; errorCode?: string }>((resolve) => {
        const timer = setTimeout(() => resolve({ rejected: false }), 2000);
        ws.once('close', () => { clearTimeout(timer); resolve({ rejected: true }); });
        ws.once('message', (data) => {
          try {
            const msg = JSON.parse(data.toString());
            if (msg.code === 'auth_failed') {
              clearTimeout(timer);
              resolve({ rejected: true, errorCode: msg.code });
            }
          } catch { /* ignore */ }
        });
      });
      expect(result.rejected).toBe(true);
    });

    it('I6: 两个客户端连接同一 ?session= 都收到 broadcast', async () => {
      server = await startWebSocketServer({
        port: TEST_PORT,
        bus: new InMemoryMessageBus(),
        fallbackSessionKey: 'fallback',
      });

      // 不需 userStorage — 用 simple connect 避免 firstMessage 超时
      const connectSimple = (sessionKey: string): Promise<WebSocket> => new Promise((resolve, reject) => {
        const ws = new WebSocket(`ws://localhost:${TEST_PORT}?session=${sessionKey}`);
        ws.once('open', () => resolve(ws));
        ws.once('error', reject);
      });
      const ws1 = await connectSimple('shared-session');
      clients.push(ws1);
      const ws2 = await connectSimple('shared-session');
      clients.push(ws2);

      server!.broadcast(makeEnvelope('shared-session', 1));
      const [recv1, recv2] = await Promise.all([
        waitForMessage(ws1),
        waitForMessage(ws2),
      ]);
      expect(recv1.event.text).toBe('delta-1');
      expect(recv2.event.text).toBe('delta-1');
    });

    it('I8: claimSession 跨用户 claim 抛 SessionAlreadyClaimedError', async () => {
      const sid = randomUUID();
      writeFileSync(join(sessionsDir, `${sid}.jsonl`), '');
      await storage.claimSession(sid, 'user-1');
      // 同用户重复 claim：不抛错
      await storage.claimSession(sid, 'user-1');
      // 跨用户 claim：抛错
      await expect(storage.claimSession(sid, 'user-2')).rejects.toBeInstanceOf(SessionAlreadyClaimedError);
      // 原 owner 仍可访问
      const user1Sessions = await storage.listSessions('user-1');
      expect(user1Sessions.some((s) => s.id === sid)).toBe(true);
      const user2Sessions = await storage.listSessions('user-2');
      expect(user2Sessions.some((s) => s.id === sid)).toBe(false);
    });

    it('I10: deleteSession 同时删除 .meta.json sidecar', async () => {
      const sid = randomUUID();
      writeFileSync(join(sessionsDir, `${sid}.jsonl`), '');
      await storage.claimSession(sid, 'user-1');
      const metaPath = join(sessionsDir, `${sid}.meta.json`);
      expect(existsSync(metaPath)).toBe(true);

      await storage.deleteSession(sid);
      expect(existsSync(metaPath)).toBe(false);
      expect(existsSync(join(sessionsDir, `${sid}.jsonl`))).toBe(false);
    });

    it('C1: 并发 claimSession + updateSessionLabel 不丢数据（lock 防竞态）', async () => {
      const sid = randomUUID();
      writeFileSync(join(sessionsDir, `${sid}.jsonl`), '');

      // 并发执行 claim 和 updateLabel
      await Promise.all([
        storage.claimSession(sid, 'user-1'),
        storage.updateSessionLabel(sid, 'my-label'),
      ]);

      // 两者都应保留（加锁防读改写竞态）
      const sessions = await storage.listSessions();
      const target = sessions.find((s) => s.id === sid);
      expect(target?.userId).toBe('user-1');
      expect(target?.label).toBe('my-label');
    });

    it('C2: 用户 A 的 session 被 user B 通过 ?session= 访问时拒绝', async () => {
      const userA = await userStorage.register('alice', 'pass');
      const userB = await userStorage.register('bob', 'pass');

      // userA 先 claim 一个 session
      const sid = randomUUID();
      writeFileSync(join(sessionsDir, `${sid}.jsonl`), '');
      await storage.claimSession(sid, userA.userId);

      server = await startWebSocketServer({
        port: TEST_PORT,
        bus: new InMemoryMessageBus(),
        userStorage,
        sessionStorage: storage,
        fallbackSessionKey: 'fallback',
      });

      // userB 尝试连接 userA 的 session
      const ws = new WebSocket(`ws://localhost:${TEST_PORT}?session=${sid}&token=${userB.token}`);
      clients.push(ws);
      const result = await new Promise<{ rejected: boolean; code?: string }>((resolve) => {
        const timer = setTimeout(() => resolve({ rejected: false }), 2000);
        ws.once('close', () => { clearTimeout(timer); resolve({ rejected: true }); });
        ws.once('message', (data) => {
          try {
            const msg = JSON.parse(data.toString());
            if (msg.code === 'session_ownership_mismatch') {
              clearTimeout(timer);
              resolve({ rejected: true, code: msg.code });
            }
          } catch { /* ignore */ }
        });
      });
      expect(result.rejected).toBe(true);
      expect(result.code).toBe('session_ownership_mismatch');
    });

    it('C2: 同用户在多设备访问同一 session 允许', async () => {
      const user = await userStorage.register('alice', 'pass');
      const sid = randomUUID();
      writeFileSync(join(sessionsDir, `${sid}.jsonl`), '');
      await storage.claimSession(sid, user.userId);

      server = await startWebSocketServer({
        port: TEST_PORT,
        bus: new InMemoryMessageBus(),
        userStorage,
        sessionStorage: storage,
        fallbackSessionKey: 'fallback',
      });

      // 同一 user 用同一 token 在两个连接访问同一 session — 都应成功
      const { ws: ws1, firstMessage: m1 } = await connectWithSession(TEST_PORT, sid, user.token);
      clients.push(ws1);
      const { ws: ws2, firstMessage: m2 } = await connectWithSession(TEST_PORT, sid, user.token);
      clients.push(ws2);
      const [msg1, msg2] = await Promise.all([m1, m2]);
      expect(msg1.type).toBe('user_identified');
      expect(msg2.type).toBe('user_identified');
      expect(msg1.userId).toBe(user.userId);
      expect(msg2.userId).toBe(user.userId);
    });

    it('I4/I5: 所有连接关闭后 ringBuffer 与 channelManager binding 清理', async () => {
      const boundKeys: string[] = [];
      const unboundKeys: string[] = [];
      server = await startWebSocketServer({
        port: TEST_PORT,
        bus: new InMemoryMessageBus(),
        fallbackSessionKey: 'fallback',
        onSessionBound: (k) => { boundKeys.push(k); },
        onSessionUnbound: (k) => { unboundKeys.push(k); },
      });

      const { ws: ws1 } = await connectWithSession(TEST_PORT, 'ephemeral-session');
      clients.push(ws1);
      await new Promise((r) => setTimeout(r, 50));
      expect(boundKeys).toContain('ephemeral-session');

      // 关闭连接
      ws1.close();
      clients.length = 0;
      await new Promise((r) => setTimeout(r, 150));
      expect(unboundKeys).toContain('ephemeral-session');
    });
  });
});
