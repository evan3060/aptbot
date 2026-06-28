import { readFile } from 'node:fs/promises';
import {
  type AptbotConfig,
  type ProviderConfig,
  validateConfig,
  defaultConfig,
} from './config-types.js';

export const DEFAULT_CONFIG_PATH = './config/aptbot.json';

/**
 * §10.8 loadConfig: 优先读取 APTBOT_CONFIG 环境变量，否则用 DEFAULT_CONFIG_PATH。
 * 读取 JSON → validateConfig 校验 → 与 defaultConfig 浅合并 → 返回。
 * 文件缺失 / JSON 非法 / 校验失败时抛错并打印 stderr 退出码 1。
 */
export async function loadConfig(path?: string): Promise<AptbotConfig> {
  const resolvedPath = process.env.APTBOT_CONFIG ?? path ?? DEFAULT_CONFIG_PATH;
  let raw: string;
  try {
    raw = await readFile(resolvedPath, 'utf-8');
  } catch (err) {
    const msg = `config file not found: ${resolvedPath} (${(err as Error).message})`;
    process.stderr.write(`[aptbot] ${msg}\n`);
    throw new Error(msg);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    const msg = `config file is not valid JSON: ${resolvedPath} (${(err as Error).message})`;
    process.stderr.write(`[aptbot] ${msg}\n`);
    throw new Error(msg);
  }

  const result = validateConfig(parsed);
  if (!result.success) {
    const msg = `config validation failed:\n${result.errors.map((e) => `  - ${e}`).join('\n')}`;
    process.stderr.write(`[aptbot] ${msg}\n`);
    throw new Error(msg);
  }

  return mergeWithDefaults(result.data);
}

/**
 * 与 defaultConfig 浅合并：未提供 dataDir/deploy 时回退到默认值。
 */
function mergeWithDefaults(config: AptbotConfig): AptbotConfig {
  return {
    ...defaultConfig,
    ...config,
    dataDir: config.dataDir ?? defaultConfig.dataDir,
    deploy: config.deploy ?? defaultConfig.deploy,
  };
}

/**
 * §10.8 resolveApiKey 优先级：provider.auth.apiKey → process.env[provider.auth.envVar] → undefined
 */
export function resolveApiKey(provider: ProviderConfig): string | undefined {
  if (provider.auth.apiKey) return provider.auth.apiKey;
  if (provider.auth.envVar) return process.env[provider.auth.envVar];
  return undefined;
}
