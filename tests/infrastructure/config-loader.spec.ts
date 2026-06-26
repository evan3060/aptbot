import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { writeFileSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import {
  loadConfig,
  resolveApiKey,
  DEFAULT_CONFIG_PATH,
} from '../../src/infrastructure/config-loader.js';
import type { AptbotConfig, ProviderConfig } from '../../src/infrastructure/config-types.js';

const TMP_DIR = './tests/.tmp-config-loader';
const TMP_CONFIG = join(TMP_DIR, 'aptbot.json');

function writeTmpConfig(config: unknown): void {
  if (!existsSync(TMP_DIR)) mkdirSync(TMP_DIR, { recursive: true });
  writeFileSync(TMP_CONFIG, JSON.stringify(config), 'utf-8');
}

describe('config-loader', () => {
  const origEnvPath = process.env.APTBOT_CONFIG;

  beforeEach(() => {
    delete process.env.APTBOT_CONFIG;
    if (existsSync(TMP_DIR)) rmSync(TMP_DIR, { recursive: true, force: true });
  });

  afterEach(() => {
    delete process.env.APTBOT_CONFIG;
    if (origEnvPath) process.env.APTBOT_CONFIG = origEnvPath;
    if (existsSync(TMP_DIR)) rmSync(TMP_DIR, { recursive: true, force: true });
  });

  it('DEFAULT_CONFIG_PATH points to ./config/aptbot.json', () => {
    expect(DEFAULT_CONFIG_PATH).toBe('./config/aptbot.json');
  });

  it('loads a valid JSON config', async () => {
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
    writeTmpConfig(valid);
    const config = await loadConfig(TMP_CONFIG);
    expect(config.defaultModel).toBe('gpt-4');
    expect(config.providers[0].id).toBe('openai');
  });

  it('APTBOT_CONFIG env var overrides path argument', async () => {
    const valid: AptbotConfig = {
      providers: [
        {
          id: 'anthropic',
          name: 'Anthropic',
          auth: { envVar: 'ANTHROPIC_API_KEY' },
          models: [
            {
              id: 'claude-3',
              api: 'anthropic-messages',
              contextWindow: 200000,
              maxTokens: 8192,
            },
          ],
        },
      ],
      defaultModel: 'claude-3',
      dataDir: './data',
      deploy: 'local',
    };
    writeTmpConfig(valid);
    process.env.APTBOT_CONFIG = TMP_CONFIG;
    const config = await loadConfig('/nonexistent/path.json');
    expect(config.defaultModel).toBe('claude-3');
  });

  it('throws on missing file', async () => {
    await expect(loadConfig('/nonexistent/aptbot.json')).rejects.toThrow();
  });

  it('throws on invalid JSON', async () => {
    if (!existsSync(TMP_DIR)) mkdirSync(TMP_DIR, { recursive: true });
    writeFileSync(TMP_CONFIG, '{ not valid json }', 'utf-8');
    await expect(loadConfig(TMP_CONFIG)).rejects.toThrow();
  });

  it('throws on schema validation failure', async () => {
    writeTmpConfig({ providers: [], defaultModel: 'x' });
    await expect(loadConfig(TMP_CONFIG)).rejects.toThrow();
  });
});

describe('resolveApiKey', () => {
  afterEach(() => {
    delete process.env.TEST_API_KEY_VAR;
  });

  it('prefers provider.auth.apiKey when set', () => {
    const provider: ProviderConfig = {
      id: 'test',
      name: 'Test',
      auth: { apiKey: 'direct-key', envVar: 'TEST_API_KEY_VAR' },
      models: [],
    };
    expect(resolveApiKey(provider)).toBe('direct-key');
  });

  it('falls back to env var when apiKey missing', () => {
    process.env.TEST_API_KEY_VAR = 'env-key';
    const provider: ProviderConfig = {
      id: 'test',
      name: 'Test',
      auth: { envVar: 'TEST_API_KEY_VAR' },
      models: [],
    };
    expect(resolveApiKey(provider)).toBe('env-key');
  });

  it('returns undefined when neither apiKey nor envVar set', () => {
    const provider: ProviderConfig = {
      id: 'test',
      name: 'Test',
      auth: { envVar: 'MISSING_VAR' },
      models: [],
    };
    expect(resolveApiKey(provider)).toBeUndefined();
  });
});
