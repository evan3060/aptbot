import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { writeFileSync, mkdirSync, rmSync, existsSync, utimesSync } from 'node:fs';
import { join } from 'node:path';
import { InMemoryMessageBus } from '../../src/bus/message-bus.js';
import { runInboundLoop, type SlashCommandHandler, type ConfigReload } from '../../src/server.js';
import { createCommandRegistry } from '../../src/shared/commands/registry.js';
import { ConfigLoader, parseAptbotConfig } from '../../src/infrastructure/config-loader.js';
import type { AptbotConfig } from '../../src/infrastructure/config-types.js';
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

    // 跨客户端同步修复：agent 处理前先 emit user_message 事件
    const env0 = await bus.consumeOutbound();
    expect(env0.event.type).toBe('user_message');

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

    // 跨客户端同步修复：agent 处理前先 emit user_message 事件
    const env0 = await bus.consumeOutbound();
    expect(env0.event.type).toBe('user_message');

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

// §4.6 / Task 6 集成测试：runInboundLoop + configReload 真正的 turn isolation 机制。
// pendingConfigApply 在 beforeTurn 准备，finally 块应用 — 当前 turn 用旧 session，下个 turn 用新配置。
describe('runInboundLoop config hot reload (Task 6 turn isolation)', () => {
  const TMP_DIR = './tests/.tmp-inbound-config-reload';
  const TMP_CONFIG = join(TMP_DIR, 'aptbot.json');

  function makeValidConfig(model: string = 'gpt-4'): AptbotConfig {
    return {
      providers: [
        {
          id: 'openai',
          name: 'OpenAI',
          auth: { envVar: 'OPENAI_API_KEY' },
          models: [
            {
              id: model,
              api: 'openai-responses',
              contextWindow: 128000,
              maxTokens: 4096,
            },
          ],
        },
      ],
      defaultModel: model,
      dataDir: './data',
      deploy: 'local',
    };
  }

  function writeConfig(config: unknown, mtimeSec?: number): void {
    if (!existsSync(TMP_DIR)) mkdirSync(TMP_DIR, { recursive: true });
    writeFileSync(TMP_CONFIG, typeof config === 'string' ? config : JSON.stringify(config), 'utf-8');
    if (mtimeSec !== undefined) {
      const time = new Date(mtimeSec * 1000);
      utimesSync(TMP_CONFIG, time, time);
    }
  }

  beforeEach(() => {
    if (existsSync(TMP_DIR)) rmSync(TMP_DIR, { recursive: true, force: true });
  });

  afterEach(() => {
    if (existsSync(TMP_DIR)) rmSync(TMP_DIR, { recursive: true, force: true });
  });

  it('does NOT rebuild session during turn, but DOES rebuild after turn ends when config changed', async () => {
    // 初始配置 + 预热 loader（首次 load 必返回 changed=true 并填充缓存）
    writeConfig(makeValidConfig('gpt-4'), 1000);
    const loader = new ConfigLoader<AptbotConfig>(TMP_CONFIG, parseAptbotConfig);
    await loader.load();

    // 在 turn 开始前修改配置文件（新 mtimeNs）→ beforeTurn 的 load() 将检测到变更
    writeConfig(makeValidConfig('claude-3'), 2000);

    const rebuild = vi.fn();
    const configReload: ConfigReload = { loader, rebuild };

    const bus = new InMemoryMessageBus();
    const watchdog = { markTurnStart: vi.fn(), markTurnEnd: vi.fn() };

    // 在 session.run 执行期间检查 rebuild 是否被提前调用（不应被调用）
    let rebuildCalledDuringRun = false;
    const mockSession = {
      run: async function* (_text: string): AsyncGenerator<AgentEvent> {
        if (rebuild.mock.calls.length > 0) rebuildCalledDuringRun = true;
        yield { type: 'agent_start' };
        if (rebuild.mock.calls.length > 0) rebuildCalledDuringRun = true;
        yield { type: 'turn_end', turnId: 't1' };
        if (rebuild.mock.calls.length > 0) rebuildCalledDuringRun = true;
      },
    };

    await bus.publishInbound({
      channel: 'test', senderId: 'user', chatId: 'c1',
      content: 'hello', metadata: {},
    });

    const loopPromise = runInboundLoop(
      bus,
      { current: mockSession as never, currentKey: 's1' },
      watchdog,
      undefined,
      undefined,
      undefined,
      configReload,
    );

    // 消费出站事件
    const env0 = await bus.consumeOutbound();
    expect(env0.event.type).toBe('user_message');
    const env1 = await bus.consumeOutbound();
    expect(env1.event.type).toBe('agent_start');
    const env2 = await bus.consumeOutbound();
    expect(env2.event.type).toBe('turn_end');

    // 等待 finally 块执行（pendingConfigApply 在 markTurnEnd 之后调用）
    await new Promise((r) => setTimeout(r, 100));

    // turn 执行期间 rebuild 不应被调用（pendingConfigApply 尚未应用）
    expect(rebuildCalledDuringRun).toBe(false);
    // turn 结束后 rebuild 应被调用一次（config 变更已应用）
    expect(rebuild).toHaveBeenCalledTimes(1);
    expect(rebuild).toHaveBeenCalledWith(expect.objectContaining({ defaultModel: 'claude-3' }));

    loopPromise.catch(() => {});
  });

  it('does NOT rebuild session when config has not changed', async () => {
    writeConfig(makeValidConfig('gpt-4'), 1000);
    const loader = new ConfigLoader<AptbotConfig>(TMP_CONFIG, parseAptbotConfig);
    await loader.load();

    const rebuild = vi.fn();
    const configReload: ConfigReload = { loader, rebuild };

    const bus = new InMemoryMessageBus();
    const watchdog = { markTurnStart: vi.fn(), markTurnEnd: vi.fn() };

    const mockSession = {
      run: async function* (_text: string): AsyncGenerator<AgentEvent> {
        yield { type: 'agent_start' };
        yield { type: 'turn_end', turnId: 't1' };
      },
    };

    await bus.publishInbound({
      channel: 'test', senderId: 'user', chatId: 'c1',
      content: 'hello', metadata: {},
    });

    const loopPromise = runInboundLoop(
      bus,
      { current: mockSession as never, currentKey: 's1' },
      watchdog,
      undefined,
      undefined,
      undefined,
      configReload,
    );

    const env0 = await bus.consumeOutbound();
    expect(env0.event.type).toBe('user_message');
    const env1 = await bus.consumeOutbound();
    expect(env1.event.type).toBe('agent_start');
    const env2 = await bus.consumeOutbound();
    expect(env2.event.type).toBe('turn_end');

    await new Promise((r) => setTimeout(r, 100));

    // 配置未变更 → rebuild 不应被调用
    expect(rebuild).not.toHaveBeenCalled();

    loopPromise.catch(() => {});
  });

  it('emits error event when config validation fails (degrades to old config)', async () => {
    writeConfig(makeValidConfig('gpt-4'), 1000);
    const loader = new ConfigLoader<AptbotConfig>(TMP_CONFIG, parseAptbotConfig);
    await loader.load();

    // 覆盖为非法配置（providers 为空）+ 新 mtimeNs → load() 返回 error
    writeConfig({ providers: [], defaultModel: 'x' }, 2000);

    const rebuild = vi.fn();
    const configReload: ConfigReload = { loader, rebuild };

    const bus = new InMemoryMessageBus();
    const watchdog = { markTurnStart: vi.fn(), markTurnEnd: vi.fn() };

    const mockSession = {
      run: async function* (_text: string): AsyncGenerator<AgentEvent> {
        yield { type: 'agent_start' };
        yield { type: 'turn_end', turnId: 't1' };
      },
    };

    await bus.publishInbound({
      channel: 'test', senderId: 'user', chatId: 'c1',
      content: 'hello', metadata: {},
    });

    const loopPromise = runInboundLoop(
      bus,
      { current: mockSession as never, currentKey: 's1' },
      watchdog,
      undefined,
      undefined,
      undefined,
      configReload,
    );

    // 收集事件（error 在 beforeTurn emit，先于 user_message）
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

    await new Promise((r) => setTimeout(r, 100));

    // 应 emit error 事件（config reload 失败通知）
    const errorEvents = events.filter((e) => e.type === 'error');
    expect(errorEvents.length).toBe(1);
    expect((errorEvents[0] as { message: string }).message).toContain('config reload failed');

    // 校验失败 → 降级到旧配置，rebuild 不应被调用
    expect(rebuild).not.toHaveBeenCalled();

    loopPromise.catch(() => {});
  });
});
