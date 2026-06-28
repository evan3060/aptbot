import type {
  Provider,
  Model,
  Context,
  StreamOptions,
  AssistantMessageEvent,
} from './types.js';
import { createOpenaiResponsesStream } from './api/openai-responses.js';
import { createOpenaiCompletionsStream } from './api/openai-completions.js';
import { createAnthropicMessagesStream } from './api/anthropic-messages.js';

export { openaiProvider } from './providers/openai.js';
export { anthropicProvider } from './providers/anthropic.js';
export { deepseekProvider } from './providers/deepseek.js';

/**
 * §4.1 / §4.2 Provider 声明。
 * 与运行时 Provider 不同：Declaration 仅声明 id/name/baseUrl/auth(models)，
 * 不携带 apiKey；apiKey 由调用方在 createProvider 时注入。
 */
export interface ProviderDeclaration {
  readonly id: string;
  readonly name: string;
  readonly baseUrl?: string;
  readonly auth: { envVar: string };
  readonly models: ReadonlyArray<Model>;
}

/**
 * §4.2 ModelRegistry。
 * 按 model id 路由到所属 Provider。当多个 Provider 出现同名 model 时采用 first-match-wins。
 */
export class ModelRegistry {
  private readonly entries: ReadonlyArray<{ provider: ProviderDeclaration; model: Model }>;

  constructor(providers: ProviderDeclaration[]) {
    const entries: { provider: ProviderDeclaration; model: Model }[] = [];
    for (const provider of providers) {
      for (const model of provider.models) {
        entries.push({ provider, model });
      }
    }
    this.entries = entries;
  }

  findModel(
    modelId: string,
  ): { provider: ProviderDeclaration; model: Model } | undefined {
    return this.entries.find((e) => e.model.id === modelId);
  }

  listModels(): ReadonlyArray<{ provider: ProviderDeclaration; model: Model }> {
    return this.entries;
  }
}

/**
 * §4.1 createProvider。
 * 根据 model.api 选择 stream 工厂：
 *   - 'anthropic-messages' → createAnthropicMessagesStream
 *   - 'openai-responses' → createOpenaiResponsesStream（/responses 端点）
 *   - 'openai-completions' → createOpenaiCompletionsStream（/chat/completions 端点）
 */
export function createProvider(decl: ProviderDeclaration, apiKey: string): Provider {
  return {
    id: decl.id,
    name: decl.name,
    baseUrl: decl.baseUrl,
    auth: { apiKey, envVar: decl.auth.envVar },
    getModels: () => decl.models,
    stream: (
      model: Model,
      context: Context,
      options?: StreamOptions,
    ): AsyncGenerator<AssistantMessageEvent> => {
      const baseUrl = decl.baseUrl ?? '';
      if (model.api === 'anthropic-messages') {
        return createAnthropicMessagesStream(baseUrl, apiKey, model, context, options);
      }
      if (model.api === 'openai-completions') {
        return createOpenaiCompletionsStream(baseUrl, apiKey, model, context, options);
      }
      // openai-responses 走 /responses 端点
      return createOpenaiResponsesStream(baseUrl, apiKey, model, context, options);
    },
  };
}
