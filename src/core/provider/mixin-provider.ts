import type {
  Provider,
  Model,
  Context,
  StreamOptions,
  AssistantMessageEvent,
  MixinConfig,
  BroadcastableProvider,
  ToolDefinition,
} from './types.js';

const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_SPRING_BACK_MS = 300_000;

/** 判断错误是否为 fatal（不可重试） */
function isFatal(err: unknown): boolean {
  if (err && typeof err === 'object' && 'retryable' in err) {
    return !(err as { retryable: boolean }).retryable;
  }
  // 未知错误视为 retryable（与 retry.ts 行为一致）
  return false;
}

/** 将错误转为 AssistantMessageEvent 的 error 字段 */
function toErrorInfo(err: unknown): {
  message: string;
  retryable: boolean;
  status?: number;
} {
  if (err && typeof err === 'object' && 'retryable' in err) {
    const e = err as {
      retryable: boolean;
      status?: number;
      message?: string;
    };
    return {
      message: e.message ?? String(err),
      retryable: e.retryable,
      status: e.status,
    };
  }
  return {
    message: (err as Error)?.message ?? String(err),
    retryable: true,
  };
}

/**
 * §4.5 / §12.1 MixinProvider：多 provider 故障转移。
 *
 * 多 provider 按 priority 串联（sessions[0] 为主 provider）。
 * 前 provider 失败（fatal 除外）自动 fallback 到下一个 provider。
 * retryable 错误重试 maxRetries 次后 fallback；fatal 错误立即抛出不 fallback。
 * 流式已 yield 后出错不切 provider（避免重复输出），直接 yield 错误块。
 * springBackMs 后弹回主 provider。
 * 广播属性到所有子 provider（temperature/maxTokens/systemPrompt/tools）。
 * 所有 provider 失败抛 AggregateError。
 */
export class MixinProvider implements BroadcastableProvider {
  readonly id: string;
  readonly name: string;
  readonly baseUrl?: string;
  readonly auth: { apiKey?: string; envVar?: string };
  readonly sessions: readonly Provider[];

  private readonly maxRetries: number;
  private readonly springBackMs: number;
  private curIdx = 0;
  private switchedAt = 0;
  private readonly broadcastAttrs: Record<string, unknown> = {};

  constructor(
    id: string,
    sessions: Provider[],
    config?: MixinConfig,
  ) {
    if (sessions.length === 0) {
      throw new Error('MixinProvider: sessions must not be empty');
    }
    // 同协议校验：所有子 provider 的 model.api 必须一致
    const apis = new Set<string>();
    for (const s of sessions) {
      for (const m of s.getModels()) {
        apis.add(m.api);
      }
    }
    if (apis.size > 1) {
      throw new Error('MixinProvider: all sessions must share the same Api');
    }

    this.id = id;
    this.sessions = sessions;
    this.maxRetries = config?.maxRetries ?? DEFAULT_MAX_RETRIES;
    this.springBackMs = config?.springBackMs ?? DEFAULT_SPRING_BACK_MS;

    const primary = sessions[0];
    this.name = sessions.map((s) => s.name).join('|');
    this.baseUrl = primary.baseUrl;
    this.auth = primary.auth;
  }

  get currentIndex(): number {
    return this.curIdx;
  }

  getModels(): readonly Model[] {
    const seen = new Set<string>();
    const all: Model[] = [];
    for (const s of this.sessions) {
      for (const m of s.getModels()) {
        if (!seen.has(m.id)) {
          seen.add(m.id);
          all.push(m);
        }
      }
    }
    return all;
  }

  /**
   * 广播属性到所有子 provider。
   * 属性在下次 stream 调用时合并到对应参数（temperature/maxTokens → options，systemPrompt/tools → context）。
   */
  broadcastAttr(key: string, value: unknown): void {
    this.broadcastAttrs[key] = value;
  }

  /**
   * 选择当前 provider 索引。若已 fallback 到副 provider 且超过 springBackMs，弹回主 provider。
   */
  private pick(): number {
    if (
      this.curIdx !== 0 &&
      this.springBackMs > 0 &&
      Date.now() - this.switchedAt >= this.springBackMs
    ) {
      this.curIdx = 0;
    }
    return this.curIdx;
  }

  /** 将广播属性合并到 StreamOptions */
  private mergeOptions(options?: StreamOptions): StreamOptions | undefined {
    const merged: StreamOptions = { ...options };
    const b = this.broadcastAttrs;
    if ('temperature' in b) merged.temperature = b.temperature as number;
    if ('maxTokens' in b) merged.maxTokens = b.maxTokens as number;
    // Task 11: 3 个新广播键（reasoningEffort/thinkingType/thinkingBudgetTokens）
    if ('reasoningEffort' in b) merged.reasoningEffort = b.reasoningEffort as string;
    if ('thinkingType' in b) merged.thinkingType = b.thinkingType as string;
    if ('thinkingBudgetTokens' in b)
      merged.thinkingBudgetTokens = b.thinkingBudgetTokens as number;
    return merged;
  }

  /** 将广播属性合并到 Context */
  private mergeContext(context: Context): Context {
    const merged: Context = { ...context };
    const b = this.broadcastAttrs;
    if ('systemPrompt' in b) {
      merged.systemPrompt = b.systemPrompt as string;
    }
    if ('tools' in b) {
      merged.tools = b.tools as ToolDefinition[];
    }
    return merged;
  }

  async *stream(
    model: Model,
    context: Context,
    options?: StreamOptions,
  ): AsyncGenerator<AssistantMessageEvent> {
    const base = this.pick();
    const n = this.sessions.length;
    const allErrors: unknown[] = [];
    const mergedOptions = this.mergeOptions(options);
    const mergedContext = this.mergeContext(context);

    for (let offset = 0; offset < n; offset++) {
      const idx = (base + offset) % n;
      let yielded = false;

      for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
        const gen = this.sessions[idx].stream(
          model,
          mergedContext,
          mergedOptions,
        );
        try {
          for await (const chunk of gen) {
            yield chunk;
            yielded = true;
          }
          // 成功完成
          if (offset !== 0) {
            this.curIdx = idx;
            this.switchedAt = Date.now();
          }
          return;
        } catch (err) {
          allErrors.push(err);
          if (yielded) {
            // 已 yield 后出错 → 不切 provider，yield 错误块
            yield { type: 'error', error: toErrorInfo(err) };
            return;
          }
          if (isFatal(err)) {
            // fatal 错误 → 立即抛出，不 fallback
            throw err;
          }
          // retryable 错误 → 重试同一 provider（attempt < maxRetries 时 continue）
          if (attempt >= this.maxRetries) {
            break; // 该 provider 重试耗尽 → 切下一个 provider
          }
        }
      }
    }

    // 所有 provider 均失败
    throw new AggregateError(
      allErrors,
      'MixinProvider: all sessions failed',
    );
  }
}
