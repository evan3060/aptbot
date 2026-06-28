import { describe, it, expect, vi } from 'vitest';
import { InMemoryMessageBus } from '../../src/bus/message-bus.js';
import { runInboundLoop, type SlashCommandHandler } from '../../src/server.js';
import { createCommandRegistry } from '../../src/shared/commands/registry.js';
import type { AgentEvent } from '../../src/core/agent/events.js';
import type { StorageAdapter } from '../../src/infrastructure/storage/file-storage.js';

// I6 回归测试：runInboundLoop 应调用 watchdog.markTurnStart / markTurnEnd
describe('runInboundLoop watchdog wiring (I6)', () => {
  it('calls markTurnStart before turn and markTurnEnd after turn completes', async () => {
    const bus = new InMemoryMessageBus();
    const markTurnStart = vi.fn();
    const markTurnEnd = vi.fn();
    const watchdog = { markTurnStart, markTurnEnd };

    const mockSession = {
      run: async function* (_text: string): AsyncGenerator<AgentEvent> {
        yield { type: 'agent_start' };
        yield { type: 'turn_end', turnId: 't1' };
      },
    };

    // 发布一条入站消息
    await bus.publishInbound({
      channel: 'test',
      senderId: 'user',
      chatId: 'c1',
      content: 'hello',
      metadata: {},
    });

    // 启动 runInboundLoop（无限循环，但会在处理完消息后阻塞在 consumeInbound）
    const loopPromise = runInboundLoop(
      bus,
      { current: mockSession as never, currentKey: 's1' },
      watchdog,
    );

    // 等待 outbound 事件出现
    const env = await bus.consumeOutbound();
    expect(env.event.type).toBe('agent_start');

    // 等待第二个事件 + turn 结束
    const env2 = await bus.consumeOutbound();
    expect(env2.event.type).toBe('turn_end');

    // 给 fire-and-forget 的 finally 块一点时间执行
    await new Promise((r) => setTimeout(r, 50));

    // I6 断言：watchdog 被正确调用
    expect(markTurnStart).toHaveBeenCalledTimes(1);
    expect(markTurnEnd).toHaveBeenCalledTimes(1);
    expect(markTurnStart).toHaveBeenCalledBefore(markTurnEnd);

    // 清理：loopPromise 永远不会 resolve（无限循环），但不影响测试结果
    loopPromise.catch(() => {});
  });
});

// Slash 命令拦截测试：runInboundLoop 应在 agent 之前拦截 / 开头的命令
describe('runInboundLoop slash command interception', () => {
  it('intercepts /help and returns output as message_delta without calling session.run', async () => {
    const bus = new InMemoryMessageBus();
    const watchdog = { markTurnStart: vi.fn(), markTurnEnd: vi.fn() };

    const sessionRunMock = vi.fn();
    const mockSession = {
      run: async function* (_text: string): AsyncGenerator<AgentEvent> {
        sessionRunMock(_text);
        yield { type: 'agent_start' };
      },
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
      ctx: { sessionId: 's1', model: 'test-model', storage: mockStorage as StorageAdapter },
    };

    await bus.publishInbound({
      channel: 'test', senderId: 'user', chatId: 'c1',
      content: '/help', metadata: {},
    });

    const loopPromise = runInboundLoop(bus, { current: mockSession as never, currentKey: 's1' }, watchdog, slashHandler);

    // 收集事件
    const events: AgentEvent[] = [];
    for (let i = 0; i < 10; i++) {
      try {
        const env = await Promise.race([
          bus.consumeOutbound(),
          new Promise<null>((r) => setTimeout(() => r(null), 500)),
        ]);
        if (env === null) break;
        events.push(env.event);
        if (env.event.type === 'turn_end') break;
      } catch { break; }
    }

    // agent 不应被调用
    expect(sessionRunMock).not.toHaveBeenCalled();

    // 应产生 message_delta 事件含 help 输出
    const deltas = events.filter((e) => e.type === 'message_delta');
    expect(deltas.length).toBeGreaterThan(0);
    const fullText = deltas.map((d) => (d as { text: string }).text).join('');
    expect(fullText).toContain('Available commands');
    expect(fullText).toContain('/help');

    // 应有 turn_end
    expect(events.some((e) => e.type === 'turn_end')).toBe(true);

    loopPromise.catch(() => {});
  });

  it('passes non-slash messages to session.run normally', async () => {
    const bus = new InMemoryMessageBus();
    const watchdog = { markTurnStart: vi.fn(), markTurnEnd: vi.fn() };

    const sessionRunMock = vi.fn().mockImplementation(async function* (_text: string): AsyncGenerator<AgentEvent> {
      yield { type: 'agent_start' };
      yield { type: 'turn_end', turnId: 't1' };
    });
    const mockSession = { run: sessionRunMock };

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
      ctx: { sessionId: 's1', model: 'test-model', storage: mockStorage as StorageAdapter },
    };

    await bus.publishInbound({
      channel: 'test', senderId: 'user', chatId: 'c1',
      content: 'hello world', metadata: {},
    });

    const loopPromise = runInboundLoop(bus, { current: mockSession as never, currentKey: 's1' }, watchdog, slashHandler);

    const env = await bus.consumeOutbound();
    expect(env.event.type).toBe('agent_start');
    expect(sessionRunMock).toHaveBeenCalledWith('hello world');

    loopPromise.catch(() => {});
  });

  it('sends complete turn events for /new (action without output)', async () => {
    const bus = new InMemoryMessageBus();
    const watchdog = { markTurnStart: vi.fn(), markTurnEnd: vi.fn() };

    const sessionRunMock = vi.fn();
    const mockSession = {
      run: async function* (): AsyncGenerator<AgentEvent> { sessionRunMock(); },
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
      ctx: { sessionId: 's1', model: 'test-model', storage: mockStorage as StorageAdapter },
    };

    await bus.publishInbound({
      channel: 'test', senderId: 'user', chatId: 'c1',
      content: '/new', metadata: {},
    });

    const loopPromise = runInboundLoop(bus, { current: mockSession as never, currentKey: 's1' }, watchdog, slashHandler);

    const events: AgentEvent[] = [];
    for (let i = 0; i < 10; i++) {
      const env = await Promise.race([
        bus.consumeOutbound(),
        new Promise<null>((r) => setTimeout(() => r(null), 500)),
      ]);
      if (env === null) break;
      events.push(env.event);
      if (env.event.type === 'turn_end') break;
    }

    // agent 不应被调用
    expect(sessionRunMock).not.toHaveBeenCalled();
    // 必须有 turn_start 和 turn_end（确保客户端清除 working 状态）
    expect(events.some((e) => e.type === 'turn_start')).toBe(true);
    expect(events.some((e) => e.type === 'turn_end')).toBe(true);
    // /new 应显示 "New session started."
    const deltas = events.filter((e) => e.type === 'message_delta');
    const fullText = deltas.map((d) => (d as { text: string }).text).join('');
    expect(fullText).toContain('New session started');

    loopPromise.catch(() => {});
  });
});
