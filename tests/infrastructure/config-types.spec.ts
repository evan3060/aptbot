import { describe, it, expect } from 'vitest';
import {
  configSchema,
  defaultConfig,
  validateConfig,
  type AptbotConfig,
} from '../../src/infrastructure/config-types.js';

describe('config-types', () => {
  describe('defaultConfig', () => {
    it('contains at least one provider and is valid', () => {
      expect(defaultConfig.providers.length).toBeGreaterThanOrEqual(1);
      const result = validateConfig(defaultConfig);
      expect(result.success).toBe(true);
    });

    it('uses local deploy mode with ./data directory', () => {
      expect(defaultConfig.deploy).toBe('local');
      expect(defaultConfig.dataDir).toBe('./data');
    });
  });

  describe('validateConfig', () => {
    it('accepts a valid config', () => {
      const valid: AptbotConfig = {
        providers: [
          {
            id: 'openai',
            name: 'OpenAI',
            auth: { envVar: 'OPENAI_API_KEY' },
            models: [
              {
                id: 'gpt-4',
                api: 'openai-responses',
                contextWindow: 128000,
                maxTokens: 4096,
              },
            ],
          },
        ],
        defaultModel: 'gpt-4',
        dataDir: './data',
        deploy: 'local',
      };
      const result = validateConfig(valid);
      expect(result.success).toBe(true);
      if (result.success) expect(result.data.defaultModel).toBe('gpt-4');
    });

    it('rejects empty providers array', () => {
      const result = validateConfig({
        providers: [],
        defaultModel: 'x',
        dataDir: './data',
        deploy: 'local',
      });
      expect(result.success).toBe(false);
      if (!result.success) expect(result.errors.length).toBeGreaterThan(0);
    });

    it('rejects missing defaultModel', () => {
      const result = validateConfig({
        providers: [
          {
            id: 'openai',
            name: 'OpenAI',
            auth: { envVar: 'OPENAI_API_KEY' },
            models: [
              {
                id: 'gpt-4',
                api: 'openai-responses',
                contextWindow: 128000,
                maxTokens: 4096,
              },
            ],
          },
        ],
        dataDir: './data',
        deploy: 'local',
      });
      expect(result.success).toBe(false);
    });

    it('rejects invalid api value', () => {
      const result = validateConfig({
        providers: [
          {
            id: 'openai',
            name: 'OpenAI',
            auth: { envVar: 'OPENAI_API_KEY' },
            models: [
              {
                id: 'gpt-4',
                api: 'invalid-api',
                contextWindow: 128000,
                maxTokens: 4096,
              },
            ],
          },
        ],
        defaultModel: 'gpt-4',
        dataDir: './data',
        deploy: 'local',
      });
      expect(result.success).toBe(false);
    });

    it('rejects provider missing auth', () => {
      const result = validateConfig({
        providers: [
          {
            id: 'openai',
            name: 'OpenAI',
            auth: {},
            models: [
              {
                id: 'gpt-4',
                api: 'openai-responses',
                contextWindow: 128000,
                maxTokens: 4096,
              },
            ],
          },
        ],
        defaultModel: 'gpt-4',
        dataDir: './data',
        deploy: 'local',
      });
      expect(result.success).toBe(false);
    });

    it('rejects invalid deploy value', () => {
      const result = validateConfig({
        providers: defaultConfig.providers,
        defaultModel: defaultConfig.defaultModel,
        dataDir: './data',
        deploy: 'aws',
      });
      expect(result.success).toBe(false);
    });
  });

  describe('configSchema', () => {
    it('is a zod schema type', () => {
      expect(configSchema).toBeDefined();
      expect(typeof configSchema.parse).toBe('function');
    });
  });
});
