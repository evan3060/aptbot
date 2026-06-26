import type { ProviderDeclaration } from '../models.js';

/**
 * §4.1 DeepSeek provider declaration.
 * 复用 openai-responses 协议（DeepSeek API 兼容 OpenAI）。
 */
export const deepseekProvider: ProviderDeclaration = {
  id: 'deepseek',
  name: 'DeepSeek',
  baseUrl: 'https://api.deepseek.com/v1',
  auth: { envVar: 'DEEPSEEK_API_KEY' },
  models: [
    {
      provider: 'deepseek',
      id: 'deepseek-chat',
      api: 'openai-responses',
      contextWindow: 64000,
      maxTokens: 4096,
    },
    {
      provider: 'deepseek',
      id: 'deepseek-reasoner',
      api: 'openai-responses',
      contextWindow: 64000,
      maxTokens: 4096,
    },
  ],
};
