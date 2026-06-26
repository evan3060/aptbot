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
