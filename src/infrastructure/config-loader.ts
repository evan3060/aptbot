import { readFile, stat } from 'node:fs/promises';
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

  try {
    return parseAptbotConfig(raw);
  } catch (err) {
    process.stderr.write(`[aptbot] ${(err as Error).message}\n`);
    throw err;
  }
}

/**
 * §12.2 parseAptbotConfig：解析 + 校验 + 合并默认值。
 * 提取为独立函数供 ConfigLoader 复用，避免与 loadConfig 的文件读取逻辑耦合。
 * JSON 非法或校验失败时抛错。
 */
export function parseAptbotConfig(raw: string): AptbotConfig {
  const parsed = JSON.parse(raw);
  const result = validateConfig(parsed);
  if (!result.success) {
    throw new Error(
      `config validation failed:\n${result.errors.map((e) => `  - ${e}`).join('\n')}`,
    );
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

/**
 * §12.2 ConfigLoader 加载结果。
 * - data：当前配置（校验失败时为旧缓存）
 * - changed：本次 load 是否触发了实际重载（mtimeNs 变化或 force/invalidate）
 * - error：校验/读取失败时的错误信息；存在表示已降级到旧配置
 */
export interface ConfigLoadResult<T> {
  data: T;
  changed: boolean;
  error?: string;
}

/**
 * §12.2 ConfigLoader：基于 mtimeNs 的懒加载热重载。
 *
 * 设计要点：
 * - 不使用 fs.watch，每次 load() 时 stat 文件比较 mtimeNs（BigInt 纳秒精度）
 * - 校验/读取失败时降级到旧缓存 + 返回 error 字段（不抛错中断服务）
 * - 首次加载无缓存时仍抛错（启动阶段必须有有效配置）
 * - invalidate() 强制下次视为变更（UI 手动刷新用）
 * - stop() 清空缓存释放资源（懒加载模式下无 fs.watch 句柄需关闭）
 *
 * 调用方负责快照语义：当前 turn 用旧 data 引用，下个 turn 用新 load() 返回的 data。
 */
export class ConfigLoader<T> {
  private cache: { mtimeNs: bigint | null; data: T | null } = { mtimeNs: null, data: null };

  constructor(
    private readonly path: string,
    private readonly parse: (raw: string) => T,
  ) {}

  async load(force = false): Promise<ConfigLoadResult<T>> {
    try {
      const stats = await stat(this.path, { bigint: true });
      const mtimeNs = stats.mtimeNs;

      if (!force && this.cache.mtimeNs === mtimeNs && this.cache.data !== null) {
        return { data: this.cache.data, changed: false };
      }

      const raw = await readFile(this.path, 'utf-8');
      const data = this.parse(raw);

      this.cache = { mtimeNs, data };
      return { data, changed: true };
    } catch (e) {
      // 校验/读取失败 → 降级到旧配置
      if (this.cache.data !== null) {
        return { data: this.cache.data, changed: false, error: (e as Error).message };
      }
      throw e;
    }
  }

  /**
   * 强制下次 load() 视为变更（mtimeNs 置 null，但保留 data 作为降级兜底）。
   */
  invalidate(): void {
    this.cache.mtimeNs = null;
  }

  /**
   * 清理资源：清空缓存，使 loader 不再持有旧 data 引用。
   * 懒加载模式下无 fs.watch 句柄需关闭；stop() 后 loader 可继续使用（重新 load 全量读取）。
   */
  stop(): void {
    this.cache = { mtimeNs: null, data: null };
  }
}
