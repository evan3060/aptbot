import type { ProviderDeclaration } from '../models.js';

/**
 * §4.1 Anthropic provider declaration.
 * baseUrl 指向 Anthropic Messages API；模型默认走 anthropic-messages。
 */
export const anthropicProvider: ProviderDeclaration = {
  id: 'anthropic',
  name: 'Anthropic',
  baseUrl: 'https://api.anthropic.com/v1',
  auth: { envVar: 'ANTHROPIC_API_KEY' },
  models: [
    {
      provider: 'anthropic',
      id: 'claude-3',
      api: 'anthropic-messages',
      contextWindow: 200000,
      maxTokens: 8192,
    },
    {
      provider: 'anthropic',
      id: 'claude-3-5-sonnet-20241022',
      api: 'anthropic-messages',
      contextWindow: 200000,
      maxTokens: 8192,
    },
  ],
};
