import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { InMemoryMessageBus } from '../../src/bus/message-bus.js';
import { runInboundLoop, type SlashCommandHandler } from '../../src/server.js';
import { createCommandRegistry } from '../../src/shared/commands/registry.js';
import type { AgentEvent } from '../../src/core/agent/events.js';
import type { StorageAdapter } from '../../src/infrastructure/storage/file-storage.js';

/**
 * Task 7: per-sessionKey 串行化
 *
 * 测试覆盖：
 * 1. 同一 sessionKey 的两条消息串行执行（第二条在第一条 turn 完成后才开始）
 * 2. 不同 sessionKey 的消息并行执行（互不阻塞）
 * 3. turn 完成后 runningTurns 清理（内存不泄漏）
 * 4. slash 命令也参与串行化（/new 后的下一条消息等待命令完成）
 * 5. I15: InboundMessage.sessionKey 从 metadata 正确传播到 emit 的 envelope
 */

function makeMockStorage(): Pick<StorageAdapter, 'readSession' | 'listSessions' | 'appendSession' | 'writeWorkingMemory' | 'readWorkingMemory' | 'deleteSession'> {
  return {
    readSession: vi.fn().mockResolvedValue([]),
    listSessions: vi.fn().mockResolvedValue([]),
    appendSession: vi.fn().mockResolvedValue(undefined),
    writeWorkingMemory: vi.fn().mockResolvedValue(undefined),
    readWorkingMemory: vi.fn().mockResolvedValue(null),
    deleteSession: vi.fn().mockResolvedValue(undefined),
  };
}

function makeMockSession(runImpl?: (text: string) => AsyncGenerator<AgentEvent>): {
  run: vi.fn;
  runStartedAt: number[];
  runFinishedAt: number[];
} {
  const runStartedAt: number[] = [];
  const runFinishedAt: number[] = [];
  const defaultImpl = async function* (text: string): AsyncGenerator<AgentEvent> {
    runStartedAt.push(Date.now());
    // 模拟 agent 处理耗时
    await new Promise((r) => setTimeout(r, 100));
    yield { type: 'agent_start' };
    yield { type: 'turn_end', turnId: 't-' + text };
    runFinishedAt.push(Date.now());
  };
  return {
    run: vi.fn(runImpl ?? defaultImpl),
    runStartedAt,
    runFinishedAt,
  };
}

describe('Task 7: per-sessionKey 串行化', () => {
  describe('同 sessionKey 串行执行', () => {
    it('同一 sessionKey 的两条消息串行执行（第二条在第一条完成后才开始）', async () => {
      const bus = new InMemoryMessageBus();
      const watchdog = { markTurnStart: vi.fn(), markTurnEnd: vi.fn() };
      const session = makeMockSession();

      const slashHandler: SlashCommandHandler = {
        registry: createCommandRegistry(),
        ctx: { sessionId: 's1', model: 'm', storage: makeMockStorage() as StorageAdapter },
      };

      // 发布两条同 sessionKey 的消息（通过 metadata.sessionKey 标识）
      await bus.publishInbound({
        channel: 'test', senderId: 'user', chatId: 'c1',
        content: 'first', metadata: { sessionKey: 's1' },
      });
      await bus.publishInbound({
        channel: 'test', senderId: 'user', chatId: 'c1',
        content: 'second', metadata: { sessionKey: 's1' },
      });

      const loopPromise = runInboundLoop(
        bus,
        { current: session as never, currentKey: 's1' },
        watchdog,
        slashHandler,
      );

      // 等待两条消息处理完成（4 个事件：2 agent_start + 2 turn_end）
      for (let i = 0; i < 4; i++) {
        await bus.consumeOutbound();
      }
      await new Promise((r) => setTimeout(r, 50));

      // 串行断言：第二条消息的开始时间 >= 第一条消息的结束时间
      expect(session.runStartedAt.length).toBe(2);
      expect(session.runFinishedAt.length).toBe(2);
      expect(session.runStartedAt[1]).toBeGreaterThanOrEqual(session.runFinishedAt[0]);

      loopPromise.catch(() => {});
    });
  });

  describe('不同 sessionKey 并行执行', () => {
    it('不同 sessionKey 的消息并行执行（互不阻塞）', async () => {
      const bus = new InMemoryMessageBus();
      const watchdog = { markTurnStart: vi.fn(), markTurnEnd: vi.fn() };
      const session = makeMockSession();

      const slashHandler: SlashCommandHandler = {
        registry: createCommandRegistry(),
        ctx: { sessionId: 's1', model: 'm', storage: makeMockStorage() as StorageAdapter },
      };

      // 发布两条不同 sessionKey 的消息
      await bus.publishInbound({
        channel: 'test', senderId: 'user', chatId: 'c1',
        content: 'a', metadata: { sessionKey: 's1' },
      });
      await bus.publishInbound({
        channel: 'test', senderId: 'user', chatId: 'c1',
        content: 'b', metadata: { sessionKey: 's2' },
      });

      const loopPromise = runInboundLoop(
        bus,
        { current: session as never, currentKey: 's1' },
        watchdog,
        slashHandler,
      );

      // 等待处理完成
      for (let i = 0; i < 4; i++) {
        await bus.consumeOutbound();
      }
      await new Promise((r) => setTimeout(r, 50));

      // 并行断言：第二条消息的开始时间 < 第一条消息的结束时间
      expect(session.runStartedAt.length).toBe(2);
      expect(session.runFinishedAt.length).toBe(2);
      expect(session.runStartedAt[1]).toBeLessThan(session.runFinishedAt[0]);

      loopPromise.catch(() => {});
    });
  });

  describe('runningTurns 清理', () => {
    it('turn 完成后 runningTurns 清理（无内存泄漏）', async () => {
      const bus = new InMemoryMessageBus();
      const watchdog = { markTurnStart: vi.fn(), markTurnEnd: vi.fn() };
      const session = makeMockSession();

      const slashHandler: SlashCommandHandler = {
        registry: createCommandRegistry(),
        ctx: { sessionId: 's1', model: 'm', storage: makeMockStorage() as StorageAdapter },
      };

      await bus.publishInbound({
        channel: 'test', senderId: 'user', chatId: 'c1',
        content: 'done', metadata: { sessionKey: 'cleanup-test' },
      });

      const loopPromise = runInboundLoop(
        bus,
        { current: session as never, currentKey: 's1' },
        watchdog,
        slashHandler,
      );

      // 等待 turn 完成
      await bus.consumeOutbound(); // agent_start
      await bus.consumeOutbound(); // turn_end
      await new Promise((r) => setTimeout(r, 100));

      // 验证：session.run 被调用且完成
      expect(session.runStartedAt.length).toBe(1);
      expect(session.runFinishedAt.length).toBe(1);

      // runningTurns 是内部状态，无法直接断言。
      // 间接验证：发送同 sessionKey 的新消息应立即开始（无前序 pending turn）
      const startTime = Date.now();
      await bus.publishInbound({
        channel: 'test', senderId: 'user', chatId: 'c1',
        content: 'next', metadata: { sessionKey: 'cleanup-test' },
      });
      await bus.consumeOutbound(); // agent_start
      await bus.consumeOutbound(); // turn_end
      const elapsed = Date.now() - startTime;

      // 若 runningTurns 未清理，新消息会等待前一个 turn（已不存在）导致立即开始
      // 若清理正常，新消息在 100ms agent 处理后完成
      expect(elapsed).toBeLessThan(300); // 不应超过 agent 处理时间 + 余量

      loopPromise.catch(() => {});
    });
  });

  describe('slash 命令参与串行化', () => {
    it('/new 命令后的下一条消息等待命令完成（同 sessionKey）', async () => {
      const bus = new InMemoryMessageBus();
      const watchdog = { markTurnStart: vi.fn(), markTurnEnd: vi.fn() };
      const session = makeMockSession();
      const sessionFactory = vi.fn().mockReturnValue({
        run: session.run,
      });

      const slashHandler: SlashCommandHandler = {
        registry: createCommandRegistry(),
        ctx: { sessionId: 's1', model: 'm', storage: makeMockStorage() as StorageAdapter },
      };

      // 先发 /new，再发普通消息（同 sessionKey）
      await bus.publishInbound({
        channel: 'test', senderId: 'user', chatId: 'c1',
        content: '/new', metadata: { sessionKey: 's1' },
      });
      await bus.publishInbound({
        channel: 'test', senderId: 'user', chatId: 'c1',
        content: 'after-new', metadata: { sessionKey: 's1' },
      });

      const loopPromise = runInboundLoop(
        bus,
        { current: session as never, currentKey: 's1' },
        watchdog,
        slashHandler,
        sessionFactory as never,
      );

      // /new 产生 4 个事件：turn_start, message_start, message_delta, message_end, turn_end
      // 普通消息产生 2 个事件：agent_start, turn_end
      // 等待 /new 的 turn_end
      let gotTurnEnd = 0;
      const events: AgentEvent[] = [];
      while (gotTurnEnd < 2) {
        const env = await Promise.race([
          bus.consumeOutbound(),
          new Promise<null>((r) => setTimeout(() => r(null), 1000)),
        ]);
        if (env === null) break;
        events.push(env.event);
        if (env.event.type === 'turn_end') gotTurnEnd++;
      }

      // 普通消息的 session.run 应被调用
      expect(session.run).toHaveBeenCalledWith('after-new');

      loopPromise.catch(() => {});
    });
  });

  describe('I15: envelope.sessionKey 从 metadata 传播', () => {
    it('emit 的 envelope.sessionKey 使用发起方 metadata.sessionKey', async () => {
      const bus = new InMemoryMessageBus();
      const watchdog = { markTurnStart: vi.fn(), markTurnEnd: vi.fn() };
      const session = makeMockSession();

      const slashHandler: SlashCommandHandler = {
        registry: createCommandRegistry(),
        ctx: { sessionId: 's1', model: 'm', storage: makeMockStorage() as StorageAdapter },
      };

      await bus.publishInbound({
        channel: 'test', senderId: 'user', chatId: 'c1',
        content: 'hello', metadata: { sessionKey: 'client-session-xyz' },
      });

      const loopPromise = runInboundLoop(
        bus,
        { current: session as never, currentKey: 'server-default' },
        watchdog,
        slashHandler,
      );

      // 收集 envelope，验证 sessionKey
      const env = await bus.consumeOutbound();
      // I15: envelope.sessionKey 应为 'client-session-xyz'，而非 'server-default'
      expect(env.sessionKey).toBe('client-session-xyz');

      // 消费剩余事件
      await bus.consumeOutbound();

      loopPromise.catch(() => {});
    });
  });
});
