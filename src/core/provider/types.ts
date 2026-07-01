import type { ContentBlock } from '../memory/agent-message.js';
import type { Api } from '../../infrastructure/config-types.js';

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface ContextMessage {
  role: 'user' | 'assistant' | 'tool';
  content: string | ContentBlock[];
  toolCallId?: string;
  toolCalls?: Array<{ id: string; name: string; arguments: string }>;
}

export interface Context {
  systemPrompt?: string;
  messages: ContextMessage[];
  tools?: ToolDefinition[];
}

export interface AssistantMessageEvent {
  type: 'text' | 'tool_call' | 'stop' | 'error';
  text?: string;
  toolCall?: { id: string; name: string; arguments: string };
  stopReason?: string;
  error?: { message: string; retryable: boolean; status?: number };
}

export interface StreamOptions {
  temperature?: number;
  maxTokens?: number;
  /** Task 11: /session 动态属性广播 — reasoning effort enum */
  reasoningEffort?: string;
  /** Task 11: /session 动态属性广播 — thinking mode enum */
  thinkingType?: string;
  /** Task 11: /session 动态属性广播 — thinking budget token limit */
  thinkingBudgetTokens?: number;
  signal?: AbortSignal;
}

export interface Model {
  readonly provider: string;
  readonly id: string;
  readonly api: Api;
  readonly contextWindow: number;
  readonly maxTokens: number;
}

export interface Provider {
  readonly id: string;
  readonly name: string;
  readonly baseUrl?: string;
  readonly auth: { apiKey?: string; envVar?: string };
  getModels(): readonly Model[];
  stream(
    model: Model,
    context: Context,
    options?: StreamOptions,
  ): AsyncGenerator<AssistantMessageEvent>;
}

/**
 * §4.5 MixinProvider 配置。
 * maxRetries：单个 provider 的最大尝试次数（默认 3）。
 * springBackMs：fallback 后弹回主 provider 的等待毫秒数（默认 300_000，0=不弹回）。
 */
export interface MixinConfig {
  maxRetries?: number;
  springBackMs?: number;
}

/**
 * §4.5 / §12.1 可广播属性的 Provider 接口（MixinProvider 实现）。
 * Task 11 /session 动态属性依赖此接口广播属性到所有子 provider。
 */
export interface BroadcastableProvider extends Provider {
  readonly sessions: readonly Provider[];
  readonly currentIndex: number;
  broadcastAttr(key: string, value: unknown): void;
}
