import { describe, it, expect } from 'vitest';
import type {
  Provider,
  Model,
  Context,
  StreamOptions,
  AssistantMessageEvent,
} from '../../../src/core/provider/types.js';
import type { ProviderError } from '../../../src/core/provider/retry.js';
import { MixinProvider } from '../../../src/core/provider/mixin-provider.js';

const model: Model = {
  provider: 'test',
  id: 'test-model',
  api: 'openai-responses',
  contextWindow: 8000,
  maxTokens: 1000,
};
const ctx: Context = {
  messages: [{ role: 'user', content: 'hi' }],
};

function retryableErr(msg = 'rate limited'): ProviderError {
  return { retryable: true, status: 429, message: msg };
}
function fatalErr(msg = 'unauthorized'): ProviderError {
  return { retryable: false, status: 401, message: msg };
}

/** 创建 mock provider：genFn 按 callIndex 返回异步生成器 */
function mockProvider(
  id: string,
  name: string,
  genFn: (callIndex: number) => AsyncGenerator<AssistantMessageEvent>,
  models: Model[] = [model],
): Provider & {
  calls: number;
  lastOptions?: StreamOptions;
  lastContext?: Context;
} {
  let calls = 0;
  let lastOptions: StreamOptions | undefined;
  let lastContext: Context | undefined;
  return {
    id,
    name,
    auth: {},
    getModels: () => models,
    stream: (_m: Model, c: Context, o?: StreamOptions) => {
      const idx = calls;
      calls++;
      lastOptions = o;
      lastContext = c;
      return genFn(idx);
    },
    get calls() {
      return calls;
    },
    get lastOptions() {
      return lastOptions;
    },
    get lastContext() {
      return lastContext;
    },
  };
}

async function* genChunks(
  events: AssistantMessageEvent[],
): AsyncGenerator<AssistantMessageEvent> {
  for (const e of events) yield e;
}

async function* genThrow(err: unknown): AsyncGenerator<AssistantMessageEvent> {
  throw err;
}

async function* genYieldThenThrow(
  events: AssistantMessageEvent[],
  err: unknown,
): AsyncGenerator<AssistantMessageEvent> {
  for (const e of events) yield e;
  throw err;
}

async function collect(
  gen: AsyncGenerator<AssistantMessageEvent>,
): Promise<AssistantMessageEvent[]> {
  const out: AssistantMessageEvent[] = [];
  for await (const e of gen) out.push(e);
  return out;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('MixinProvider', () => {
  it('forwards events when single provider succeeds', async () => {
    const p = mockProvider('p0', 'P0', () =>
      genChunks([
        { type: 'text', text: 'hello' },
        { type: 'stop', stopReason: 'end_turn' },
      ]),
    );
    const mixin = new MixinProvider('m', [p]);
    const events = await collect(mixin.stream(model, ctx));
    expect(events).toEqual([
      { type: 'text', text: 'hello' },
      { type: 'stop', stopReason: 'end_turn' },
    ]);
    expect(p.calls).toBe(1);
    expect(mixin.currentIndex).toBe(0);
  });

  it('throws when sessions is empty', () => {
    expect(() => new MixinProvider('m', [])).toThrow(/empty/i);
  });

  it('throws if sessions have different Api protocols', () => {
    const m1: Model = { ...model, api: 'openai-responses' };
    const m2: Model = { ...model, api: 'anthropic-messages' };
    const p0 = mockProvider('p0', 'P0', () => genChunks([]), [m1]);
    const p1 = mockProvider('p1', 'P1', () => genChunks([]), [m2]);
    expect(() => new MixinProvider('m', [p0, p1])).toThrow(/same Api/i);
  });

  it('retries retryable error 3 times then falls back to next provider', async () => {
    const p0 = mockProvider('p0', 'P0', () => genThrow(retryableErr()));
    const p1 = mockProvider('p1', 'P1', () =>
      genChunks([
        { type: 'text', text: 'p1 ok' },
        { type: 'stop', stopReason: 'end_turn' },
      ]),
    );
    const mixin = new MixinProvider('m', [p0, p1]);
    const events = await collect(mixin.stream(model, ctx));
    expect(events).toEqual([
      { type: 'text', text: 'p1 ok' },
      { type: 'stop', stopReason: 'end_turn' },
    ]);
    expect(p0.calls).toBe(3);
    expect(p1.calls).toBe(1);
    expect(mixin.currentIndex).toBe(1);
  });

  it('throws immediately on fatal error without fallback', async () => {
    const p0 = mockProvider('p0', 'P0', () => genThrow(fatalErr()));
    const p1 = mockProvider('p1', 'P1', () =>
      genChunks([{ type: 'text', text: 'p1' }]),
    );
    const mixin = new MixinProvider('m', [p0, p1]);
    await expect(collect(mixin.stream(model, ctx))).rejects.toMatchObject({
      retryable: false,
      status: 401,
    });
    expect(p0.calls).toBe(1);
    expect(p1.calls).toBe(0);
  });

  it('does not switch provider when error occurs after yield', async () => {
    const p0 = mockProvider('p0', 'P0', () =>
      genYieldThenThrow(
        [{ type: 'text', text: 'partial' }],
        retryableErr('stream broke'),
      ),
    );
    const p1 = mockProvider('p1', 'P1', () =>
      genChunks([{ type: 'text', text: 'p1' }]),
    );
    const mixin = new MixinProvider('m', [p0, p1]);
    const events = await collect(mixin.stream(model, ctx));
    expect(events).toEqual([
      { type: 'text', text: 'partial' },
      {
        type: 'error',
        error: { message: 'stream broke', retryable: true, status: 429 },
      },
    ]);
    expect(p0.calls).toBe(1);
    expect(p1.calls).toBe(0);
  });

  it('springs back to primary after springBackMs', async () => {
    const p0Gens: Array<() => AsyncGenerator<AssistantMessageEvent>> = [
      () => genThrow(retryableErr()),
      () => genThrow(retryableErr()),
      () => genThrow(retryableErr()),
      () =>
        genChunks([
          { type: 'text', text: 'p0 ok' },
          { type: 'stop', stopReason: 'end_turn' },
        ]),
    ];
    const p0 = mockProvider('p0', 'P0', (idx) => p0Gens[idx]());
    const p1 = mockProvider('p1', 'P1', () =>
      genChunks([
        { type: 'text', text: 'p1 ok' },
        { type: 'stop', stopReason: 'end_turn' },
      ]),
    );
    const mixin = new MixinProvider('m', [p0, p1], { springBackMs: 50 });

    // 首次调用：p0 重试 3 次失败 → fallback 到 p1 成功
    const events1 = await collect(mixin.stream(model, ctx));
    expect(events1[0]).toEqual({ type: 'text', text: 'p1 ok' });
    expect(mixin.currentIndex).toBe(1);

    // 等待超过 springBackMs
    await sleep(60);

    // 再次调用：弹回主 provider p0，成功
    const events2 = await collect(mixin.stream(model, ctx));
    expect(events2[0]).toEqual({ type: 'text', text: 'p0 ok' });
    expect(mixin.currentIndex).toBe(0);
  });

  it('broadcasts attributes to all child providers', async () => {
    const p0 = mockProvider('p0', 'P0', () => genThrow(retryableErr()));
    const p1 = mockProvider('p1', 'P1', () =>
      genChunks([{ type: 'stop', stopReason: 'end_turn' }]),
    );
    const mixin = new MixinProvider('m', [p0, p1]);
    mixin.broadcastAttr('temperature', 0.7);
    mixin.broadcastAttr('maxTokens', 2048);
    await collect(mixin.stream(model, ctx));
    // p0（首次尝试）与 p1（fallback）均收到广播属性
    expect(p0.lastOptions?.temperature).toBe(0.7);
    expect(p0.lastOptions?.maxTokens).toBe(2048);
    expect(p1.lastOptions?.temperature).toBe(0.7);
    expect(p1.lastOptions?.maxTokens).toBe(2048);
  });

  // Task 11 / Task 5 deferred: 3 个新广播键（reasoningEffort/thinkingType/thinkingBudgetTokens）
  // 通过 mergeOptions 合并到 StreamOptions，完成 5 项白名单属性的广播机制
  it('broadcasts Task 11 whitelist attrs (reasoningEffort/thinkingType/thinkingBudgetTokens) to child providers', async () => {
    const p0 = mockProvider('p0', 'P0', () =>
      genChunks([{ type: 'stop', stopReason: 'end_turn' }]),
    );
    const mixin = new MixinProvider('m', [p0]);
    mixin.broadcastAttr('reasoningEffort', 'high');
    mixin.broadcastAttr('thinkingType', 'enabled');
    mixin.broadcastAttr('thinkingBudgetTokens', 4096);
    await collect(mixin.stream(model, ctx));
    expect(p0.lastOptions?.reasoningEffort).toBe('high');
    expect(p0.lastOptions?.thinkingType).toBe('enabled');
    expect(p0.lastOptions?.thinkingBudgetTokens).toBe(4096);
  });

  it('throws AggregateError when all providers fail', async () => {
    const p0 = mockProvider('p0', 'P0', () =>
      genThrow(retryableErr('p0 down')),
    );
    const p1 = mockProvider('p1', 'P1', () =>
      genThrow(retryableErr('p1 down')),
    );
    const mixin = new MixinProvider('m', [p0, p1]);

    let thrown: unknown;
    try {
      await collect(mixin.stream(model, ctx));
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(AggregateError);
    const agg = thrown as AggregateError;
    // 3 次重试 × 2 个 provider = 6 个错误
    expect(agg.errors).toHaveLength(6);
    expect(p0.calls).toBe(3);
    expect(p1.calls).toBe(3);
  });
});
