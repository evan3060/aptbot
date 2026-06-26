import type { ProviderDeclaration } from '../models.js';

/**
 * §4.1 OpenAI provider declaration.
 * baseUrl 指向 OpenAI Responses API；模型默认走 openai-responses。
 */
export const openaiProvider: ProviderDeclaration = {
  id: 'openai',
  name: 'OpenAI',
  baseUrl: 'https://api.openai.com/v1',
  auth: { envVar: 'OPENAI_API_KEY' },
  models: [
    {
      provider: 'openai',
      id: 'gpt-4',
      api: 'openai-responses',
      contextWindow: 128000,
      maxTokens: 4096,
    },
    {
      provider: 'openai',
      id: 'gpt-4o',
      api: 'openai-responses',
      contextWindow: 128000,
      maxTokens: 4096,
    },
    {
      provider: 'openai',
      id: 'gpt-3.5-turbo',
      api: 'openai-responses',
      contextWindow: 16385,
      maxTokens: 4096,
    },
  ],
};
