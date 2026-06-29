import { describe, it, expect, vi } from 'vitest';
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
 * 3. turn 完成后 runningTurns 清理（通过连续发送 + 时序断言验证）
 * 4. slash 命令参与串行化（/new 后的下一条消息等待命令完成，含 timing 断言）
 * 5. I15: InboundMessage.sessionKey 从 metadata 正确传播到所有 emit 的 envelope
 * 6. C1: 错误传播 — 一个 turn 失败不阻塞同 sessionKey 后续 turn
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

interface MockSession {
  run: ReturnType<typeof vi.fn>;
  runStartedAt: number[];
  runFinishedAt: number[];
}

function makeMockSession(runImpl?: (text: string) => AsyncGenerator<AgentEvent>): MockSession {
  const runStartedAt: number[] = [];
  const runFinishedAt: number[] = [];
  const defaultImpl = async function* (text: string): AsyncGenerator<AgentEvent> {
    runStartedAt.push(Date.now());
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

      // 两条消息共 4 个事件
      for (let i = 0; i < 4; i++) {
        await bus.consumeOutbound();
      }
      await new Promise((r) => setTimeout(r, 50));

      expect(session.runStartedAt.length).toBe(2);
      expect(session.runFinishedAt.length).toBe(2);
      // 串行断言：第二条开始时间 >= 第一条结束时间
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

      for (let i = 0; i < 4; i++) {
        await bus.consumeOutbound();
      }
      await new Promise((r) => setTimeout(r, 50));

      expect(session.runStartedAt.length).toBe(2);
      expect(session.runFinishedAt.length).toBe(2);
      // 并行断言：第二条开始时间 < 第一条结束时间
      expect(session.runStartedAt[1]).toBeLessThan(session.runFinishedAt[0]);

      loopPromise.catch(() => {});
    });
  });

  describe('runningTurns 清理', () => {
    it('turn 完成后 runningTurns 清理 — 连续 3 条同 sessionKey 消息总耗时接近 3 倍单条耗时', async () => {
      const bus = new InMemoryMessageBus();
      const watchdog = { markTurnStart: vi.fn(), markTurnEnd: vi.fn() };
      const session = makeMockSession();

      const slashHandler: SlashCommandHandler = {
        registry: createCommandRegistry(),
        ctx: { sessionId: 's1', model: 'm', storage: makeMockStorage() as StorageAdapter },
      };

      const start = Date.now();
      for (const text of ['m1', 'm2', 'm3']) {
        await bus.publishInbound({
          channel: 'test', senderId: 'user', chatId: 'c1',
          content: text, metadata: { sessionKey: 'cleanup-test' },
        });
      }

      const loopPromise = runInboundLoop(
        bus,
        { current: session as never, currentKey: 's1' },
        watchdog,
        slashHandler,
      );

      // 3 条消息共 6 个事件
      for (let i = 0; i < 6; i++) {
        await bus.consumeOutbound();
      }
      await new Promise((r) => setTimeout(r, 50));
      const elapsed = Date.now() - start;

      expect(session.runStartedAt.length).toBe(3);
      expect(session.runFinishedAt.length).toBe(3);
      // 串行 3 条 × 100ms ≈ 300ms；若清理失效导致并行，则 ≈ 100ms
      // 允许较宽余量（250ms），排除并行情况
      expect(elapsed).toBeGreaterThanOrEqual(250);
      // 串行连续：每条开始时间 >= 上一条结束时间
      for (let i = 1; i < 3; i++) {
        expect(session.runStartedAt[i]).toBeGreaterThanOrEqual(session.runFinishedAt[i - 1]);
      }

      loopPromise.catch(() => {});
    });
  });

  describe('slash 命令参与串行化', () => {
    it('/new 命令后的下一条消息等待命令完成（同 sessionKey，含 timing 断言）', async () => {
      const bus = new InMemoryMessageBus();
      const watchdog = { markTurnStart: vi.fn(), markTurnEnd: vi.fn() };
      const agentStartTimes: number[] = [];
      const session = makeMockSession(async function* (text: string): AsyncGenerator<AgentEvent> {
        agentStartTimes.push(Date.now());
        await new Promise((r) => setTimeout(r, 50));
        yield { type: 'agent_start' };
        yield { type: 'turn_end', turnId: 't-' + text };
      });
      const sessionFactory = vi.fn().mockReturnValue({
        run: session.run,
      });

      const slashHandler: SlashCommandHandler = {
        registry: createCommandRegistry(),
        ctx: { sessionId: 's1', model: 'm', storage: makeMockStorage() as StorageAdapter },
      };

      const beforeNew = Date.now();
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

      // /new 产生 5 个事件：turn_start, message_start, message_delta, message_end, turn_end
      // 普通消息产生 2 个事件：agent_start, turn_end
      let gotTurnEnd = 0;
      const turnEndTimes: number[] = [];
      while (gotTurnEnd < 2) {
        const env = await Promise.race([
          bus.consumeOutbound(),
          new Promise<null>((r) => setTimeout(() => r(null), 1000)),
        ]);
        if (env === null) break;
        if (env.event.type === 'turn_end') {
          gotTurnEnd++;
          turnEndTimes.push(Date.now());
        }
      }

      expect(gotTurnEnd).toBe(2);
      expect(session.run).toHaveBeenCalledWith('after-new');
      // timing 断言：agent 消息的开始时间 >= /new turn_end 时间（串行化生效）
      expect(agentStartTimes.length).toBe(1);
      expect(agentStartTimes[0]).toBeGreaterThanOrEqual(turnEndTimes[0]);
      // 整体耗时 >= /new 与 agent 串行总耗时（排除并行）
      expect(Date.now() - beforeNew).toBeGreaterThanOrEqual(50);

      loopPromise.catch(() => {});
    });
  });

  describe('I15: envelope.sessionKey 从 metadata 传播', () => {
    it('agent 路径：所有 emit 的 envelope.sessionKey 使用发起方 metadata.sessionKey', async () => {
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

      // agent 产生 2 个事件，均应携带 client-session-xyz
      const env1 = await bus.consumeOutbound();
      expect(env1.sessionKey).toBe('client-session-xyz');
      const env2 = await bus.consumeOutbound();
      expect(env2.sessionKey).toBe('client-session-xyz');

      loopPromise.catch(() => {});
    });

    it('slash 路径：/help 的所有 emit envelope.sessionKey 使用发起方 metadata.sessionKey', async () => {
      const bus = new InMemoryMessageBus();
      const watchdog = { markTurnStart: vi.fn(), markTurnEnd: vi.fn() };
      const session = makeMockSession();

      const slashHandler: SlashCommandHandler = {
        registry: createCommandRegistry(),
        ctx: { sessionId: 's1', model: 'm', storage: makeMockStorage() as StorageAdapter },
      };

      await bus.publishInbound({
        channel: 'test', senderId: 'user', chatId: 'c1',
        content: '/help', metadata: { sessionKey: 'slash-session-abc' },
      });

      const loopPromise = runInboundLoop(
        bus,
        { current: session as never, currentKey: 'server-default' },
        watchdog,
        slashHandler,
      );

      // /help 产生 5 个事件，全部应携带 slash-session-abc
      const envelopes = [];
      for (let i = 0; i < 5; i++) {
        const env = await Promise.race([
          bus.consumeOutbound(),
          new Promise<null>((r) => setTimeout(() => r(null), 500)),
        ]);
        if (env === null) break;
        envelopes.push(env);
      }

      expect(envelopes.length).toBe(5);
      for (const env of envelopes) {
        expect(env.sessionKey).toBe('slash-session-abc');
      }

      loopPromise.catch(() => {});
    });
  });

  describe('C1: 错误传播 — turn 失败不阻塞后续 turn', () => {
    it('第一个 turn 抛错后，同 sessionKey 的第二个 turn 仍正常处理', async () => {
      const bus = new InMemoryMessageBus();
      const watchdog = { markTurnStart: vi.fn(), markTurnEnd: vi.fn() };
      const runCallCount = { value: 0 };
      const session = makeMockSession(async function* (text: string): AsyncGenerator<AgentEvent> {
        runCallCount.value++;
        if (runCallCount.value === 1) {
          // 第一条消息：抛错
          throw new Error('agent boom');
        }
        // 第二条消息：正常
        yield { type: 'agent_start' };
        yield { type: 'turn_end', turnId: 't-' + text };
      });

      const slashHandler: SlashCommandHandler = {
        registry: createCommandRegistry(),
        ctx: { sessionId: 's1', model: 'm', storage: makeMockStorage() as StorageAdapter },
      };

      await bus.publishInbound({
        channel: 'test', senderId: 'user', chatId: 'c1',
        content: 'will-fail', metadata: { sessionKey: 'err-chain' },
      });
      await bus.publishInbound({
        channel: 'test', senderId: 'user', chatId: 'c1',
        content: 'should-succeed', metadata: { sessionKey: 'err-chain' },
      });

      const loopPromise = runInboundLoop(
        bus,
        { current: session as never, currentKey: 's1' },
        watchdog,
        slashHandler,
      );

      // 第一条消息：emit 一个 error 事件（catch 块内 emit）
      // 第二条消息：emit agent_start + turn_end
      const envelopes = [];
      for (let i = 0; i < 5; i++) {
        const env = await Promise.race([
          bus.consumeOutbound(),
          new Promise<null>((r) => setTimeout(() => r(null), 1000)),
        ]);
        if (env === null) break;
        envelopes.push(env);
      }

      // 应至少收到 3 个 envelope：1 个 error + agent_start + turn_end
      expect(envelopes.length).toBeGreaterThanOrEqual(3);
      // 第一个应为 error
      expect(envelopes[0].event.type).toBe('error');
      // 后续应有 agent_start 和 turn_end（第二条消息正常处理）
      const eventTypes = envelopes.map((e) => e.event.type);
      expect(eventTypes).toContain('agent_start');
      expect(eventTypes).toContain('turn_end');

      // session.run 被调用 2 次（两条消息都进入 agent 路径）
      expect(session.run).toHaveBeenCalledTimes(2);

      loopPromise.catch(() => {});
    });
  });
});
