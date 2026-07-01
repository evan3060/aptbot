import { describe, it, expect, vi } from 'vitest';
import {
  triggerSessionSummary,
  SUMMARY_PROMPT,
  SUMMARY_MAX_CHARS,
} from '../../../src/core/agent/session-summary.js';
import { agentLoop } from '../../../src/core/agent/loop.js';
import type {
  Provider,
  Model,
  Context,
  AssistantMessageEvent,
} from '../../../src/core/provider/types.js';
import type { StorageAdapter } from '../../../src/infrastructure/storage/file-storage.js';
import type { SessionMetadata } from '../../../src/core/memory/types.js';
import { createToolRegistry } from '../../../src/core/tool/types.js';
import type { AgentEvent } from '../../../src/core/agent/events.js';

const MODEL: Model = {
  provider: 'mock',
  id: 'mock-1',
  api: 'openai-responses',
  contextWindow: 8000,
  maxTokens: 1000,
};

function uuid(): string {
  return (
    '00000000-0000-4000-8000-' +
    Math.random().toString(16).slice(2, 14).padEnd(12, '0')
  );
}

interface StorageState {
  label?: string;
  labelSource?: 'custom' | 'auto';
  hasCustomLabelCalls: number;
  updateLabelCalls: Array<{ label: string; source?: 'custom' | 'auto' }>;
  resolveLabel?: () => void;
}

function makeStorage(
  initial: Partial<StorageState> = {},
): StorageAdapter & { state: StorageState } {
  const state: StorageState = {
    hasCustomLabelCalls: 0,
    updateLabelCalls: [],
    ...initial,
  };
  const storage: StorageAdapter & { state: StorageState } = {
    state,
    readSession: vi.fn(async () => []),
    appendSession: vi.fn(async () => {}),
    listSessions: vi.fn(async (): Promise<SessionMetadata[]> => []),
    readWorkingMemory: vi.fn(async () => null),
    writeWorkingMemory: vi.fn(async () => {}),
    deleteSession: vi.fn(async () => {}),
    claimSession: vi.fn(async () => {}),
    forceClaimSession: vi.fn(async () => {}),
    getSessionOwner: vi.fn(async () => undefined),
    updateSessionLabel: vi.fn(
      async (_id: string, label: string, source?: 'custom' | 'auto') => {
        state.label = label;
        state.labelSource = source;
        state.updateLabelCalls.push({ label, source });
        state.resolveLabel?.();
      },
    ),
    hasCustomLabel: vi.fn(async () => {
      state.hasCustomLabelCalls++;
      return state.labelSource === 'custom';
    }),
  };
  return storage;
}

function makeProvider(config: {
  text?: string;
  throwError?: Error;
  delayMs?: number;
} = {}): Provider & { callCount: number } {
  let callCount = 0;
  return {
    id: 'mock',
    name: 'Mock',
    auth: {},
    getModels: () => [MODEL],
    stream: async function* (): AsyncGenerator<AssistantMessageEvent> {
      callCount++;
      if (config.delayMs)
        await new Promise((r) => setTimeout(r, config.delayMs));
      if (config.throwError) throw config.throwError;
      if (config.text !== undefined) {
        yield { type: 'text', text: config.text };
        yield { type: 'stop', stopReason: 'end_turn' };
      }
    },
    get callCount() {
      return callCount;
    },
  };
}

// Integration provider: distinguishes main vs summary call via systemPrompt.
function makeLoopProvider(opts: {
  main: AssistantMessageEvent[];
  summaryText?: string;
  summaryThrow?: Error;
  summaryDelayMs?: number;
}): Provider & { summaryCallCount: number } {
  let summaryCallCount = 0;
  return {
    id: 'mock',
    name: 'Mock',
    auth: {},
    getModels: () => [MODEL],
    stream: async function* (
      _model: Model,
      context: Context,
    ): AsyncGenerator<AssistantMessageEvent> {
      if (context.systemPrompt === SUMMARY_PROMPT) {
        summaryCallCount++;
        if (opts.summaryDelayMs)
          await new Promise((r) => setTimeout(r, opts.summaryDelayMs));
        if (opts.summaryThrow) throw opts.summaryThrow;
        if (opts.summaryText !== undefined) {
          yield { type: 'text', text: opts.summaryText };
          yield { type: 'stop', stopReason: 'end_turn' };
        }
        return;
      }
      for (const e of opts.main) yield e;
    },
    get summaryCallCount() {
      return summaryCallCount;
    },
  };
}

async function collect(gen: AsyncGenerator<AgentEvent>): Promise<AgentEvent[]> {
  const out: AgentEvent[] = [];
  for await (const e of gen) out.push(e);
  return out;
}

describe('triggerSessionSummary', () => {
  it('1. 无 label 时触发摘要并写入 label (source=auto)', async () => {
    const sid = uuid();
    const storage = makeStorage();
    const provider = makeProvider({ text: '调试登录问题' });

    await triggerSessionSummary({
      sessionId: sid,
      provider,
      model: MODEL,
      messages: [
        { role: 'user', content: '登录失败了' },
        { role: 'assistant', content: '看看日志' },
      ],
      storage,
    });

    expect(storage.state.label).toBe('调试登录问题');
    expect(storage.state.labelSource).toBe('auto');
    expect(provider.callCount).toBe(1);
    // 2 次：触发时初始检查 + LLM 返回后复检（防 in-flight 期间 /label 竞态）
    expect(storage.state.hasCustomLabelCalls).toBe(2);
  });

  it('2. 用户已有 custom label 时跳过 (不调用 LLM)', async () => {
    const sid = uuid();
    const storage = makeStorage({ label: '我的会话', labelSource: 'custom' });
    const provider = makeProvider({ text: '不应被调用' });

    await triggerSessionSummary({
      sessionId: sid,
      provider,
      model: MODEL,
      messages: [{ role: 'user', content: 'hi' }],
      storage,
    });

    expect(provider.callCount).toBe(0);
    expect(storage.state.updateLabelCalls).toHaveLength(0);
    expect(storage.state.label).toBe('我的会话');
  });

  it('3. 摘要 ≤20 字符 (LLM 返回超长被截断)', async () => {
    const sid = uuid();
    const storage = makeStorage();
    const longText =
      '这是一个非常非常非常非常非常非常非常长的摘要文本超过二十个字符';
    const provider = makeProvider({ text: longText });

    await triggerSessionSummary({
      sessionId: sid,
      provider,
      model: MODEL,
      messages: [{ role: 'user', content: 'hi' }],
      storage,
    });

    expect(storage.state.label).toBe(longText.slice(0, 20));
    expect((storage.state.label as string).length).toBe(20);
  });

  it('4. LLM 失败时不报错且保留默认 label', async () => {
    const sid = uuid();
    const storage = makeStorage();
    const provider = makeProvider({ throwError: new Error('LLM down') });

    await expect(
      triggerSessionSummary({
        sessionId: sid,
        provider,
        model: MODEL,
        messages: [{ role: 'user', content: 'hi' }],
        storage,
      }),
    ).resolves.toBeUndefined();

    expect(storage.state.label).toBeUndefined();
    expect(storage.state.updateLabelCalls).toHaveLength(0);
  });

  it('5. 异步生成不阻塞主流程 (fire-and-forget)', async () => {
    const sid = uuid();
    const storage = makeStorage();
    const provider = makeProvider({ text: '慢摘要', delayMs: 50 });

    // fire and forget (do not await yet)
    const p = triggerSessionSummary({
      sessionId: sid,
      provider,
      model: MODEL,
      messages: [{ role: 'user', content: 'hi' }],
      storage,
    });

    // label should NOT be written yet (summary still pending)
    expect(storage.state.label).toBeUndefined();

    await p;
    expect(storage.state.label).toBe('慢摘要');
  });

  it('edge: LLM 超时不报错不修改 label', async () => {
    const sid = uuid();
    const storage = makeStorage();
    const provider = makeProvider({ text: '太慢', delayMs: 80 });

    await triggerSessionSummary({
      sessionId: sid,
      provider,
      model: MODEL,
      messages: [{ role: 'user', content: 'hi' }],
      storage,
      timeoutMs: 20,
    });

    expect(storage.state.label).toBeUndefined();
    expect(storage.state.updateLabelCalls).toHaveLength(0);
    // 让被遗弃的 stream 完成，避免悬挂 handle
    await new Promise((r) => setTimeout(r, 100));
  });

  it('edge: in-flight guard — 并发第二次调用跳过 (无重复 LLM 调用)', async () => {
    const sid = uuid();
    const storage = makeStorage();
    let resolveGate!: () => void;
    const gate = new Promise<void>((r) => {
      resolveGate = r;
    });
    let callCount = 0;
    const provider: Provider = {
      id: 'mock',
      name: 'Mock',
      auth: {},
      getModels: () => [MODEL],
      stream: async function* (): AsyncGenerator<AssistantMessageEvent> {
        callCount++;
        await gate;
        yield { type: 'text', text: '摘要' };
        yield { type: 'stop', stopReason: 'end_turn' };
      },
    };

    const opts = {
      sessionId: sid,
      provider,
      model: MODEL,
      messages: [{ role: 'user' as const, content: 'hi' }],
      storage,
    };
    const p1 = triggerSessionSummary(opts);
    const p2 = triggerSessionSummary(opts);
    try {
      await p2;
      expect(callCount).toBe(1);
    } finally {
      resolveGate();
    }
    await p1;
    expect(storage.state.label).toBe('摘要');
  });

  it('edge: /label 后手动设置 custom label，后续 turn 跳过 auto', async () => {
    const sid = uuid();
    const storage = makeStorage();
    const provider = makeProvider({ text: '自动摘要' });

    await triggerSessionSummary({
      sessionId: sid,
      provider,
      model: MODEL,
      messages: [{ role: 'user', content: 'hi' }],
      storage,
    });
    expect(storage.state.label).toBe('自动摘要');
    expect(storage.state.labelSource).toBe('auto');

    // 模拟 /label 命令（手动设置 custom label）
    await storage.updateSessionLabel(sid, '我的名字', 'custom');
    expect(storage.state.labelSource).toBe('custom');

    const provider2 = makeProvider({ text: '不应被调用' });
    await triggerSessionSummary({
      sessionId: sid,
      provider: provider2,
      model: MODEL,
      messages: [{ role: 'user', content: 'more' }],
      storage,
    });
    expect(provider2.callCount).toBe(0);
    expect(storage.state.label).toBe('我的名字');
  });

  it("concurrent: /label during in-flight auto-summary preserves user's custom label", async () => {
    const sid = uuid();
    const storage = makeStorage();
    let resolveGate!: () => void;
    const gate = new Promise<void>((r) => {
      resolveGate = r;
    });
    let callCount = 0;
    const provider: Provider = {
      id: 'mock',
      name: 'Mock',
      auth: {},
      getModels: () => [MODEL],
      stream: async function* (): AsyncGenerator<AssistantMessageEvent> {
        callCount++;
        await gate;
        yield { type: 'text', text: '自动摘要' };
        yield { type: 'stop', stopReason: 'end_turn' };
      },
    };

    // 触发自动摘要（LLM 被 gate 阻塞，处于 in-flight）
    const p = triggerSessionSummary({
      sessionId: sid,
      provider,
      model: MODEL,
      messages: [{ role: 'user', content: 'hi' }],
      storage,
    });

    // 在 LLM 仍 in-flight 期间，用户执行 /label 设置 custom label
    await storage.updateSessionLabel(sid, '用户的名字', 'custom');
    expect(storage.state.labelSource).toBe('custom');

    // 释放 LLM gate，让 promise resolve
    resolveGate();
    await p;

    // 用户的 custom label 应被保留，未被 auto summary 覆盖
    expect(storage.state.label).toBe('用户的名字');
    expect(storage.state.labelSource).toBe('custom');
    // LLM 调用确实发生了，但结果被丢弃
    expect(callCount).toBe(1);
  });

  it('security: 不发送 tool 角色消息与 toolCalls 内容给 LLM', async () => {
    const sid = uuid();
    const storage = makeStorage();
    let captured: Context | null = null;
    const provider: Provider = {
      id: 'mock',
      name: 'Mock',
      auth: {},
      getModels: () => [MODEL],
      stream: async function* (
        _m: Model,
        ctx: Context,
      ): AsyncGenerator<AssistantMessageEvent> {
        captured = ctx;
        yield { type: 'text', text: '摘要' };
        yield { type: 'stop', stopReason: 'end_turn' };
      },
    };

    await triggerSessionSummary({
      sessionId: sid,
      provider,
      model: MODEL,
      messages: [
        { role: 'user', content: 'hi' },
        {
          role: 'assistant',
          content: 'ok',
          toolCalls: [{ id: 't1', name: 'bash', arguments: '{"secret":"leak"}' }],
        },
        { role: 'tool', content: 'secret-output', toolCallId: 't1' },
        { role: 'assistant', content: 'done' },
      ],
      storage,
    });

    expect(captured).not.toBeNull();
    const userMsg = captured!.messages[0];
    expect(userMsg.role).toBe('user');
    const text =
      typeof userMsg.content === 'string' ? userMsg.content : '';
    expect(text).toContain('hi');
    expect(text).toContain('done');
    expect(text).not.toContain('secret-output');
    expect(text).not.toContain('leak');
  });

  it('uses fixed summary prompt (not configurable)', () => {
    expect(SUMMARY_PROMPT).toBe(
      'Summarize this conversation in ≤20 chars. No punctuation. No quotes.',
    );
    expect(SUMMARY_MAX_CHARS).toBe(20);
  });
});

describe('agentLoop + session summary integration', () => {
  it('turn_end 后无 custom label 时触发摘要写入 label', async () => {
    const sid = uuid();
    const storage = makeStorage();
    const provider = makeLoopProvider({
      main: [
        { type: 'text', text: '你好' },
        { type: 'stop', stopReason: 'end_turn' },
      ],
      summaryText: '问候会话',
    });
    const tools = createToolRegistry();
    const ctx: Context = { messages: [{ role: 'user', content: 'hi' }] };

    const events = await collect(
      agentLoop({
        provider,
        model: MODEL,
        tools,
        context: ctx,
        systemPrompt: 'sys',
        session: { sessionId: sid },
        storage,
      }),
    );

    expect(events[events.length - 1].type).toBe('agent_end');
    // 等待 fire-and-forget 摘要完成
    await new Promise((r) => setTimeout(r, 50));
    expect(provider.summaryCallCount).toBe(1);
    expect(storage.state.label).toBe('问候会话');
    expect(storage.state.labelSource).toBe('auto');
  });

  it('turn_end 后已有 custom label 时跳过摘要', async () => {
    const sid = uuid();
    const storage = makeStorage({ label: '已有', labelSource: 'custom' });
    const provider = makeLoopProvider({
      main: [
        { type: 'text', text: '你好' },
        { type: 'stop', stopReason: 'end_turn' },
      ],
      summaryText: '不应被调用',
    });
    const tools = createToolRegistry();
    const ctx: Context = { messages: [{ role: 'user', content: 'hi' }] };

    await collect(
      agentLoop({
        provider,
        model: MODEL,
        tools,
        context: ctx,
        systemPrompt: 'sys',
        session: { sessionId: sid },
        storage,
      }),
    );
    await new Promise((r) => setTimeout(r, 50));
    expect(provider.summaryCallCount).toBe(0);
    expect(storage.state.label).toBe('已有');
  });

  it('异步生成不阻塞主流程：agent_end 在 label 写入前发出', async () => {
    const sid = uuid();
    const storage = makeStorage();
    const provider = makeLoopProvider({
      main: [
        { type: 'text', text: '你好' },
        { type: 'stop', stopReason: 'end_turn' },
      ],
      summaryText: '慢摘要',
      summaryDelayMs: 80,
    });
    const tools = createToolRegistry();
    const ctx: Context = { messages: [{ role: 'user', content: 'hi' }] };

    const events = await collect(
      agentLoop({
        provider,
        model: MODEL,
        tools,
        context: ctx,
        systemPrompt: 'sys',
        session: { sessionId: sid },
        storage,
      }),
    );

    expect(events[events.length - 1].type).toBe('agent_end');
    // 摘要仍在进行 (delay 80ms)，label 尚未写入
    expect(storage.state.label).toBeUndefined();
    await new Promise((r) => setTimeout(r, 150));
    expect(storage.state.label).toBe('慢摘要');
  });

  it('不传 storage 时不触发摘要 (向后兼容)', async () => {
    const provider = makeLoopProvider({
      main: [
        { type: 'text', text: '你好' },
        { type: 'stop', stopReason: 'end_turn' },
      ],
      summaryText: '不应被调用',
    });
    const tools = createToolRegistry();
    const ctx: Context = { messages: [{ role: 'user', content: 'hi' }] };

    const events = await collect(
      agentLoop({ provider, model: MODEL, tools, context: ctx, systemPrompt: 'sys' }),
    );

    expect(events[events.length - 1].type).toBe('agent_end');
    expect(provider.summaryCallCount).toBe(0);
  });
});
