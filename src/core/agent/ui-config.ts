import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { USER_ID_REGEX } from './agent-storage.js';
import { createLogger } from '../../infrastructure/logger.js';

/**
 * §0.3.0 Task 10: UiConfigStorage — UI 层配置持久化（visibleSkills）
 *
 * 职责：
 * - 管理 `data/users/<userId>/agents/default/ui-config.json` 文件
 * - 仅 default agent 有 ui-config（专业 agent 不需要）
 * - 原子写（write-to-tmp + rename），与 AgentStorage 模式一致
 * - 路径遍历防护：userId 严格正则校验（USER_ID_REGEX）
 *
 * 设计要点：
 * - 这只是 UI 层 display 偏好，不动 skill 文件，不动 AGENT.md
 * - 文件不存在 / 损坏 JSON → 返回空 visibleSkills（graceful 降级）
 * - 损坏 JSON 时 console.warn 提示解析错误（不抛错）
 *
 * 与 AgentStorage 的差异：
 * - 不需要 per-agentId mutex（仅 default agent，文件粒度小，写并发概率低）
 * - 不需要 findOwner / listAgents / countAgents（仅 default）
 * - 简单 JSON 文件，无 frontmatter / markdown body
 */

const log = createLogger('ui-config-storage');

/**
 * §0.3.0 Task 10: VisibleSkill — UI 层展示的 skill 项。
 *
 * - slug：skill 名称（与 Skill.name 一致，a-z0-9- ≤64）
 * - displayName：UI 显示名（可与 slug 不同，支持中文等）
 */
export interface VisibleSkill {
  readonly slug: string;
  readonly displayName: string;
}

/**
 * §0.3.0 Task 10: UiConfig — UI 层配置根接口。
 *
 * 当前仅含 visibleSkills，后续可扩展（如 collapsed sections / theme 等）。
 */
export interface UiConfig {
  readonly visibleSkills: VisibleSkill[];
}

/** §0.3.0 Task 10: 默认空配置（文件不存在 / 损坏时返回） */
const EMPTY_CONFIG: UiConfig = { visibleSkills: [] };

/**
 * §0.3.0 Task 10: UiConfigStorage — 文件系统持久化。
 *
 * 路径结构：`<dataDir>/users/<userId>/agents/default/ui-config.json`
 *
 * 注意：仅 default agent 有 ui-config.json（硬编码 "default"），
 * 专业 agent 不需要 UI 层配置。
 */
export class UiConfigStorage {
  private readonly usersDir: string;

  constructor(dataDir: string) {
    this.usersDir = join(dataDir, 'users');
  }

  /** 校验 userId（路径遍历防护） */
  private validateUserId(userId: string): void {
    if (!USER_ID_REGEX.test(userId)) {
      throw new Error(`invalid userId (path traversal guard): ${userId}`);
    }
  }

  /** ui-config.json 文件路径（已校验 userId） */
  private getConfigPath(userId: string): string {
    this.validateUserId(userId);
    return join(this.usersDir, userId, 'agents', 'default', 'ui-config.json');
  }

  /**
   * §0.3.0 Task 10: get — 读取 UI 配置。
   *
   * - 文件不存在 → 返回空 visibleSkills
   * - 损坏 JSON → 返回空 visibleSkills + console.warn（不抛错）
   */
  async get(userId: string): Promise<UiConfig> {
    const configPath = this.getConfigPath(userId);
    if (!existsSync(configPath)) {
      return EMPTY_CONFIG;
    }

    let raw: string;
    try {
      raw = readFileSync(configPath, 'utf-8');
    } catch (err) {
      // 读失败（权限/IO 错误）也降级为空配置，避免 UI 层崩溃
      log.warn('failed to read ui-config.json', {
        userId,
        error: String(err),
      });
      return EMPTY_CONFIG;
    }

    try {
      const parsed = JSON.parse(raw);
      if (!isUiConfig(parsed)) {
        log.warn('ui-config.json has invalid shape, returning empty', {
          userId,
        });
        return EMPTY_CONFIG;
      }
      return parsed;
    } catch (err) {
      // 损坏 JSON：warn + 返回空配置（graceful 降级，UI 不应因配置损坏崩溃）
      log.warn('failed to parse ui-config.json, returning empty', {
        userId,
        error: String(err),
      });
      // 与 listAgents 一致：console.warn 兼容旧观察者
      console.warn(
        `[ui-config-storage] failed to parse ui-config.json for user=${userId}: ${String(err)}`,
      );
      return EMPTY_CONFIG;
    }
  }

  /**
   * §0.3.0 Task 10: update — 原子写入 UI 配置（write-to-tmp + rename）。
   *
   * - 自动创建多层目录
   * - validate userId（路径遍历防护）
   */
  async update(userId: string, config: UiConfig): Promise<void> {
    const configPath = this.getConfigPath(userId);
    const configDir = join(configPath, '..');

    // 自动创建多层目录
    if (!existsSync(configDir)) {
      mkdirSync(configDir, { recursive: true });
    }

    // 原子写：write-to-tmp + rename
    const tmpPath = `${configPath}.tmp`;
    writeFileSync(tmpPath, JSON.stringify(config, null, 2), 'utf-8');
    renameSync(tmpPath, configPath);
  }
}

/**
 * §0.3.0 Task 10: isUiConfig — 运行时类型校验（避免 zod 依赖膨胀）。
 *
 * 校验 visibleSkills 数组，每个元素必须含 slug + displayName 字符串。
 */
function isUiConfig(value: unknown): value is UiConfig {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  if (!Array.isArray(v.visibleSkills)) return false;
  for (const item of v.visibleSkills) {
    if (!item || typeof item !== 'object') return false;
    const skill = item as Record<string, unknown>;
    if (typeof skill.slug !== 'string' || skill.slug.length === 0) return false;
    if (typeof skill.displayName !== 'string' || skill.displayName.length === 0) return false;
  }
  return true;
}
