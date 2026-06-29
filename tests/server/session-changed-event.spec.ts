import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import WebSocket from 'ws';
import {
  startWebSocketServer,
  type WebSocketServer,
} from '../../src/access/websocket-server.js';
import { InMemoryMessageBus } from '../../src/bus/message-bus.js';
import { FileStorage, type StorageAdapter } from '../../src/infrastructure/storage/file-storage.js';
import { runInboundLoop, type SlashCommandHandler } from '../../src/server.js';
import { createCommandRegistry } from '../../src/shared/commands/registry.js';
import type { AgentEvent } from '../../src/core/agent/events.js';

/**
 * Task 6: session_changed 事件 + /label 命令
 *
 * 测试覆盖：
 * 1. wsServer.sendToSessionKey 向指定 sessionKey 的 connection 发送原始消息（不走 ring buffer）
 * 2. runInboundLoop 处理 /new 后调用 onNewSession(oldKey, newId)
 * 3. runInboundLoop 处理 /resume 后调用 onNewSession(oldKey, newId)
 * 4. /label 命令调用 storage.updateSessionLabel
 */

const TEST_PORT = 18782;

function waitForMessage(ws: WebSocket, timeoutMs = 1000): Promise<any> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('message timeout')), timeoutMs);
    ws.once('message', (data) => {
      clearTimeout(timer);
      resolve(JSON.parse(data.toString()));
    });
  });
}

describe('Task 6: session_changed 事件 + /label 命令', () => {
  describe('wsServer.sendToSessionKey', () => {
    let server: WebSocketServer | null = null;
    const clients: WebSocket[] = [];
    let tmpDir: string;

    beforeEach(() => {
      tmpDir = mkdtempSync(join(tmpdir(), 'aptbot-task6-'));
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

    it('sendToSessionKey 向指定 sessionKey 的 connection 发送原始消息', async () => {
      server = await startWebSocketServer({
        port: TEST_PORT,
        bus: new InMemoryMessageBus(),
        fallbackSessionKey: 'fallback',
      });

      // 连接两个不同 session 的客户端
      const wsA = new WebSocket(`ws://localhost:${TEST_PORT}?session=aaa`);
      clients.push(wsA);
      await new Promise<void>((resolve, reject) => {
        wsA.once('open', () => resolve());
        wsA.once('error', reject);
      });

      const wsB = new WebSocket(`ws://localhost:${TEST_PORT}?session=bbb`);
      clients.push(wsB);
      await new Promise<void>((resolve, reject) => {
        wsB.once('open', () => resolve());
        wsB.once('error', reject);
      });

      // 向 session-aaa 发送 session_changed 消息
      server!.sendToSessionKey('aaa', { type: 'session_changed', sessionId: 'new-id' });

      // wsA 应收到
      const msgA = await waitForMessage(wsA);
      expect(msgA.type).toBe('session_changed');
      expect(msgA.sessionId).toBe('new-id');

      // wsB 不应收到 — 等待 200ms 确认
      let gotMessage = false;
      wsB.once('message', () => { gotMessage = true; });
      await new Promise((r) => setTimeout(r, 200));
      expect(gotMessage).toBe(false);
    });

    it('sendToSessionKey 不写入 ring buffer（重连后不回放）', async () => {
      server = await startWebSocketServer({
        port: TEST_PORT,
        bus: new InMemoryMessageBus(),
        fallbackSessionKey: 'fallback',
      });

      // 连接 session-x，接收 sendToSessionKey 消息
      const ws1 = new WebSocket(`ws://localhost:${TEST_PORT}?session=xxx`);
      clients.push(ws1);
      await new Promise<void>((resolve, reject) => {
        ws1.once('open', () => resolve());
        ws1.once('error', reject);
      });

      server!.sendToSessionKey('xxx', { type: 'session_changed', sessionId: 'new' });
      const msg = await waitForMessage(ws1);
      expect(msg.type).toBe('session_changed');

      // 断连 ws1
      ws1.removeAllListeners();
      ws1.close();
      await new Promise((r) => setTimeout(r, 150));

      // 重连同一 session，不带 lastEventSeq — 不应回放 session_changed
      const ws2 = new WebSocket(`ws://localhost:${TEST_PORT}?session=xxx`);
      clients.push(ws2);
      let gotSessionChanged = false;
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, 500);
        ws2.on('message', (data) => {
          const parsed = JSON.parse(data.toString());
          if (parsed.type === 'session_changed') {
            gotSessionChanged = true;
            clearTimeout(timer);
            resolve();
          }
        });
        ws2.once('open', () => {});
        setTimeout(resolve, 500);
      });
      expect(gotSessionChanged).toBe(false);
    });
  });

  describe('runInboundLoop /new 触发 onNewSession(oldKey, newId)', () => {
    it('/new 命令后调用 onNewSession 回调，传入 oldKey 和 newId', async () => {
      const bus = new InMemoryMessageBus();
      const watchdog = { markTurnStart: vi.fn(), markTurnEnd: vi.fn() };

      const mockSession = {
        run: async function* (): AsyncGenerator<AgentEvent> {},
      };

      const mockStorage: Pick<StorageAdapter, 'readSession' | 'listSessions' | 'appendSession' | 'writeWorkingMemory' | 'readWorkingMemory' | 'deleteSession'> = {
        readSession: vi.fn().mockResolvedValue([]),
        listSessions: vi.fn().mockResolvedValue([]),
        appendSession: vi.fn().mockResolvedValue(undefined),
        writeWorkingMemory: vi.fn().mockResolvedValue(undefined),
        readWorkingMemory: vi.fn().mockResolvedValue(null),
        deleteSession: vi.fn().mockResolvedValue(undefined),
      };

      const slashHandler: SlashCommandHandler = {
        registry: createCommandRegistry(),
        ctx: { sessionId: 'old-session', model: 'test-model', storage: mockStorage as StorageAdapter },
      };

      const onNewSession = vi.fn();
      const sessionFactory = vi.fn().mockReturnValue(mockSession);

      await bus.publishInbound({
        channel: 'test', senderId: 'user', chatId: 'c1',
        content: '/new', metadata: {},
      });

      const loopPromise = runInboundLoop(
        bus,
        { current: mockSession as never, currentKey: 'old-session' },
        watchdog,
        slashHandler,
        sessionFactory,
        onNewSession,
      );

      // 等待 turn_end
      for (let i = 0; i < 10; i++) {
        const env = await Promise.race([
          bus.consumeOutbound(),
          new Promise<null>((r) => setTimeout(() => r(null), 500)),
        ]);
        if (env === null) break;
        if (env.event.type === 'turn_end') break;
      }
      await new Promise((r) => setTimeout(r, 50));

      // onNewSession 应被调用，第一个参数为 oldKey，第二个为 newId
      expect(onNewSession).toHaveBeenCalledTimes(1);
      const [oldKey, newId] = onNewSession.mock.calls[0];
      expect(oldKey).toBe('old-session');
      expect(typeof newId).toBe('string');
      expect(newId).not.toBe('old-session');

      loopPromise.catch(() => {});
    });
  });

  describe('runInboundLoop /resume 触发 onNewSession(oldKey, newId)', () => {
    it('/resume <id> 命令后调用 onNewSession 回调，传入 oldKey 和 resumed sessionId', async () => {
      const bus = new InMemoryMessageBus();
      const watchdog = { markTurnStart: vi.fn(), markTurnEnd: vi.fn() };

      const mockSession = {
        run: async function* (): AsyncGenerator<AgentEvent> {},
      };

      const targetId = 'target-session-id-1234';
      const mockStorage: Pick<StorageAdapter, 'readSession' | 'listSessions' | 'appendSession' | 'writeWorkingMemory' | 'readWorkingMemory' | 'deleteSession'> = {
        readSession: vi.fn().mockResolvedValue([]),
        listSessions: vi.fn().mockResolvedValue([{ id: targetId, createdAt: 0, updatedAt: 0 }]),
        appendSession: vi.fn().mockResolvedValue(undefined),
        writeWorkingMemory: vi.fn().mockResolvedValue(undefined),
        readWorkingMemory: vi.fn().mockResolvedValue(null),
        deleteSession: vi.fn().mockResolvedValue(undefined),
      };

      const slashHandler: SlashCommandHandler = {
        registry: createCommandRegistry(),
        ctx: { sessionId: 'current-session', model: 'test-model', storage: mockStorage as StorageAdapter },
      };

      const onNewSession = vi.fn();
      const sessionFactory = vi.fn().mockReturnValue(mockSession);

      await bus.publishInbound({
        channel: 'test', senderId: 'user', chatId: 'c1',
        content: `/resume ${targetId}`, metadata: {},
      });

      const loopPromise = runInboundLoop(
        bus,
        { current: mockSession as never, currentKey: 'current-session' },
        watchdog,
        slashHandler,
        sessionFactory,
        onNewSession,
      );

      // 等待 turn_end
      for (let i = 0; i < 10; i++) {
        const env = await Promise.race([
          bus.consumeOutbound(),
          new Promise<null>((r) => setTimeout(() => r(null), 500)),
        ]);
        if (env === null) break;
        if (env.event.type === 'turn_end') break;
      }
      await new Promise((r) => setTimeout(r, 50));

      // onNewSession 应被调用，oldKey=current-session，newId=targetId
      expect(onNewSession).toHaveBeenCalledTimes(1);
      const [oldKey, newId] = onNewSession.mock.calls[0];
      expect(oldKey).toBe('current-session');
      expect(newId).toBe(targetId);

      loopPromise.catch(() => {});
    });
  });

  describe('/label 命令', () => {
    let storage: FileStorage;
    let tmpDir: string;

    beforeEach(() => {
      tmpDir = mkdtempSync(join(tmpdir(), 'aptbot-label-'));
      mkdirSync(join(tmpDir, 'sessions'));
      storage = new FileStorage(join(tmpDir, 'sessions'));
    });

    afterEach(() => {
      rmSync(tmpDir, { recursive: true, force: true });
    });

    it('/label <名称> 调用 storage.updateSessionLabel 持久化 label', async () => {
      const registry = createCommandRegistry();
      const sessionId = randomUUID();
      // 创建 session 文件
      writeFileSync(join(tmpDir, 'sessions', `${sessionId}.jsonl`), '');

      const ctx = { sessionId, model: 'test', storage: storage as StorageAdapter };
      const resolved = registry.resolve('/label 调试登录问题');
      expect(resolved).not.toBeNull();

      const result = await resolved!.command.execute(resolved!.args, ctx);
      expect(result.output).toContain('调试登录问题');

      // 验证 label 已持久化
      const sessions = await storage.listSessions();
      const target = sessions.find((s) => s.id === sessionId);
      expect(target?.label).toBe('调试登录问题');
    });

    it('/label 无参数时返回 usage 提示', async () => {
      const registry = createCommandRegistry();
      const ctx = { sessionId: 'x', model: 'test', storage: storage as StorageAdapter };
      const resolved = registry.resolve('/label');
      expect(resolved).not.toBeNull();

      const result = await resolved!.command.execute(resolved!.args, ctx);
      expect(result.output).toContain('Usage');
      expect(result.output).toContain('/label');
    });

    it('/label 出现在 /help 命令列表中', async () => {
      const registry = createCommandRegistry();
      const helpCmd = registry.get('help');
      const result = await helpCmd!.execute([], { sessionId: 'x', model: 'm', storage: storage as StorageAdapter });
      expect(result.output).toContain('/label');
    });
  });
});
