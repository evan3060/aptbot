import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { writeFileSync, mkdirSync, rmSync, existsSync, utimesSync } from 'node:fs';
import { join } from 'node:path';
import {
  loadConfig,
  resolveApiKey,
  DEFAULT_CONFIG_PATH,
  ConfigLoader,
  parseAptbotConfig,
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

describe('ConfigLoader', () => {
  const LOADER_DIR = './tests/.tmp-config-loader-hot';
  const LOADER_CONFIG = join(LOADER_DIR, 'aptbot.json');

  function makeValidConfig(model: string = 'gpt-4'): AptbotConfig {
    return {
      providers: [
        {
          id: 'openai',
          name: 'OpenAI',
          auth: { envVar: 'OPENAI_API_KEY' },
          models: [
            {
              id: model,
              api: 'openai-responses',
              contextWindow: 128000,
              maxTokens: 4096,
            },
          ],
        },
      ],
      defaultModel: model,
      dataDir: './data',
      deploy: 'local',
    };
  }

  function writeConfig(config: unknown, mtimeSec?: number): void {
    if (!existsSync(LOADER_DIR)) mkdirSync(LOADER_DIR, { recursive: true });
    writeFileSync(LOADER_CONFIG, JSON.stringify(config), 'utf-8');
    if (mtimeSec !== undefined) {
      const time = new Date(mtimeSec * 1000);
      utimesSync(LOADER_CONFIG, time, time);
    }
  }

  function createLoader(): ConfigLoader<AptbotConfig> {
    return new ConfigLoader<AptbotConfig>(LOADER_CONFIG, parseAptbotConfig);
  }

  beforeEach(() => {
    if (existsSync(LOADER_DIR)) rmSync(LOADER_DIR, { recursive: true, force: true });
  });

  afterEach(() => {
    if (existsSync(LOADER_DIR)) rmSync(LOADER_DIR, { recursive: true, force: true });
  });

  it('detects mtimeNs change and triggers reload', async () => {
    writeConfig(makeValidConfig('gpt-4'), 1000);
    const loader = createLoader();

    const first = await loader.load();
    expect(first.changed).toBe(true);
    expect(first.data.defaultModel).toBe('gpt-4');

    // 同 mtimeNs → changed=false（懒加载命中缓存）
    const second = await loader.load();
    expect(second.changed).toBe(false);

    // 修改文件 + 新 mtimeNs → 触发重载
    writeConfig(makeValidConfig('claude-3'), 2000);
    const third = await loader.load();
    expect(third.changed).toBe(true);
    expect(third.data.defaultModel).toBe('claude-3');
  });

  it('current turn uses old config snapshot, next turn uses new config', async () => {
    writeConfig(makeValidConfig('gpt-4'), 1000);
    const loader = createLoader();

    // Turn 1：加载初始配置
    const turn1 = await loader.load();
    expect(turn1.data.defaultModel).toBe('gpt-4');

    // 配置在 turn 1 执行期间被修改
    writeConfig(makeValidConfig('claude-3'), 2000);

    // Turn 1 仍使用旧快照（turn1.data 不变）
    expect(turn1.data.defaultModel).toBe('gpt-4');

    // Turn 2：load() 返回新配置，changed=true
    const turn2 = await loader.load();
    expect(turn2.changed).toBe(true);
    expect(turn2.data.defaultModel).toBe('claude-3');

    // Turn 3：无进一步变化
    const turn3 = await loader.load();
    expect(turn3.changed).toBe(false);
    expect(turn3.data.defaultModel).toBe('claude-3');
  });

  it('validation failure falls back to old config with error', async () => {
    writeConfig(makeValidConfig('gpt-4'), 1000);
    const loader = createLoader();

    const first = await loader.load();
    expect(first.changed).toBe(true);
    expect(first.error).toBeUndefined();

    // 覆盖为非法配置（providers 为空）
    writeConfig({ providers: [], defaultModel: 'x' }, 2000);

    const second = await loader.load();
    expect(second.changed).toBe(false);
    expect(second.error).toBeDefined();
    // 降级到旧配置
    expect(second.data.defaultModel).toBe('gpt-4');
  });

  it('JSON parse failure falls back to old config', async () => {
    writeConfig(makeValidConfig('gpt-4'), 1000);
    const loader = createLoader();

    await loader.load();

    // 覆盖为非法 JSON
    writeConfig('{ not valid json }', 2000);

    const result = await loader.load();
    expect(result.changed).toBe(false);
    expect(result.error).toBeDefined();
    expect(result.data.defaultModel).toBe('gpt-4');
  });

  it('first load with no cache throws on validation failure', async () => {
    writeConfig({ providers: [], defaultModel: 'x' }, 1000);
    const loader = createLoader();

    await expect(loader.load()).rejects.toThrow();
  });

  it('first load with no cache throws on missing file', async () => {
    const loader = new ConfigLoader<AptbotConfig>(
      join(LOADER_DIR, 'nonexistent.json'),
      parseAptbotConfig,
    );

    await expect(loader.load()).rejects.toThrow();
  });

  it('file deleted after initial load falls back to cached config', async () => {
    writeConfig(makeValidConfig('gpt-4'), 1000);
    const loader = createLoader();

    await loader.load();

    // 删除配置文件
    rmSync(LOADER_CONFIG);

    const result = await loader.load();
    expect(result.changed).toBe(false);
    expect(result.error).toBeDefined();
    expect(result.data.defaultModel).toBe('gpt-4');
  });

  it('invalidate forces next load to return changed=true', async () => {
    writeConfig(makeValidConfig('gpt-4'), 1000);
    const loader = createLoader();

    await loader.load();
    const second = await loader.load();
    expect(second.changed).toBe(false);

    loader.invalidate();

    const third = await loader.load();
    expect(third.changed).toBe(true);
  });

  it('force=true triggers reload even when mtimeNs unchanged', async () => {
    writeConfig(makeValidConfig('gpt-4'), 1000);
    const loader = createLoader();

    await loader.load();

    const forced = await loader.load(true);
    expect(forced.changed).toBe(true);
  });

  it('stop clears cache, next load returns changed=true', async () => {
    writeConfig(makeValidConfig('gpt-4'), 1000);
    const loader = createLoader();

    await loader.load();
    const second = await loader.load();
    expect(second.changed).toBe(false);

    loader.stop();

    const third = await loader.load();
    expect(third.changed).toBe(true);
  });

  it('stop does not leak old data reference after cleanup', async () => {
    writeConfig(makeValidConfig('gpt-4'), 1000);
    const loader = createLoader();

    const first = await loader.load();
    const firstData = first.data;

    loader.stop();

    writeConfig(makeValidConfig('claude-3'), 2000);
    const after = await loader.load();
    // 新 load 返回新对象，不是旧引用
    expect(after.data).not.toBe(firstData);
    expect(after.data.defaultModel).toBe('claude-3');
  });
});

describe('parseAptbotConfig', () => {
  it('parses valid JSON config', () => {
    const raw = JSON.stringify({
      providers: [
        {
          id: 'openai',
          name: 'OpenAI',
          auth: { envVar: 'OPENAI_API_KEY' },
          models: [{ id: 'gpt-4', api: 'openai-responses', contextWindow: 128000, maxTokens: 4096 }],
        },
      ],
      defaultModel: 'gpt-4',
      dataDir: './data',
      deploy: 'local',
    });
    const config = parseAptbotConfig(raw);
    expect(config.defaultModel).toBe('gpt-4');
  });

  it('throws on invalid JSON', () => {
    expect(() => parseAptbotConfig('{ not valid }')).toThrow();
  });

  it('throws on schema validation failure', () => {
    expect(() => parseAptbotConfig(JSON.stringify({ providers: [], defaultModel: 'x' }))).toThrow();
  });
});
