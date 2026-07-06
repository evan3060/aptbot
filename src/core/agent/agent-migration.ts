import {
  readdirSync,
  existsSync,
  readFileSync,
  writeFileSync,
  renameSync,
  mkdirSync,
  rmSync,
} from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createLogger } from '../../infrastructure/logger.js';
import { AgentStorage, USER_ID_REGEX } from './agent-storage.js';
import type { AgentProfile } from './agent-profile.js';

/**
 * §0.3.0 Task 3: default agent 自动创建 + 现有 sessions 迁移
 *
 * 职责：
 * - migrateLegacySessions: 0.3.0 升级时一次性扫描 legacy `data/sessions/*.jsonl`
 *   + `.meta.json`，按 userId 分组迁移到 `data/users/<userId>/agents/default/sessions/`
 * - ensureDefaultAgent: 用户首次访问时若 default agent 不存在则创建
 *
 * 设计要点：
 * - 幂等性：已迁移的 session（目标 .jsonl 已存在）不重复迁移；已创建的 default
 *   agent 不重复创建（检查 AGENT.md 是否存在）
 * - 中断恢复：迁移过程使用 atomic write-to-tmp + rename；中断后重新运行可继续
 * - 路径遍历防护：所有路径拼接前校验 userId（UUID）
 * - 匿名 session（无 userId）→ 生成伪 UUID 作为 userId
 *
 * 模块边界：
 * - 不依赖 StorageAdapter（其不暴露文件路径），直接使用 fs 操作
 * - 通过 AgentStorage.getAgentDir 复用新路径计算逻辑（避免路径知识重复）
 *
 * 与 spec 偏离：
 * - spec 期望签名 migrateLegacySessions(storage, agentStorage)，但 StorageAdapter
 *   不暴露文件路径，无法用于文件移动。实际签名 (dataDir, agentStorage) 更直接
 *   地表达迁移所需信息。详见 task-3-report.md。
 * - spec 期望 ensureDefaultAgent 位于 session.ts，但该函数与 session 模块职责
 *   无关，置于 agent-migration.ts 与 migrateLegacySessions 同模块更内聚。
 */

const log = createLogger('agent-migration');

/** §0.3.0 default agent slug（特殊保留值，非 generateSlug 生成） */
export const DEFAULT_AGENT_SLUG = 'default';

/** §0.3.0 default agent 显示名 */
export const DEFAULT_AGENT_NAME = '通用助手';

/** §0.3.0 default agent 描述 */
export const DEFAULT_AGENT_DESCRIPTION = 'aptbot 通用助手';

/**
 * §0.3.0 default agent personality（systemPrompt body）。
 *
 * 注意：这是占位文本。Task 8 (systemPrompt builder) 会动态构建完整 systemPrompt
 * （注入 skills 索引 / 安全约束等）。此处仅写入 AGENT.md 的 body 作为 fallback。
 */
export const DEFAULT_AGENT_PERSONALITY = '你是 aptbot 通用助手';

/** §0.3.0 Legacy session meta.json 结构（与 FileStorage.SessionMetaFile 一致 + agentId） */
interface LegacySessionMeta {
  userId?: string;
  label?: string;
  preview?: string;
  labelSource?: 'custom' | 'auto';
  /** §0.3.0 迁移后追加的字段：归属的 agent slug */
  agentId?: string;
}

/** §0.3.0 迁移报告中的错误项 */
export interface MigrationError {
  /** 出错的 session ID */
  readonly sessionId: string;
  /** 错误信息 */
  readonly error: string;
}

/** §0.3.0 迁移报告 */
export interface MigrationReport {
  /** 本次运行成功迁移的 session 数量（不含已迁移的） */
  readonly migratedSessions: number;
  /** 本次运行新创建的 default agent 数量（不含已存在的） */
  readonly createdAgents: number;
  /** 迁移过程中遇到的错误列表 */
  readonly errors: readonly MigrationError[];
}

/**
 * §0.3.0 ensureDefaultAgent: 用户首次访问时若 default agent 不存在则创建。
 *
 * 行为：
 * - 幂等：若 default agent 已存在则直接返回现有 profile
 * - 路径遍历防护：userId 必须匹配 UUID 正则
 * - 创建后重新读取以获得文件 stat 的 createdAt / updatedAt
 *
 * @param userId 用户 ID（UUID）
 * @param agentStorage AgentStorage 实例
 * @returns default agent profile
 */
export async function ensureDefaultAgent(
  userId: string,
  agentStorage: AgentStorage,
): Promise<AgentProfile> {
  // 路径遍历防护（与 AgentStorage.validatePathParams 一致）
  if (!USER_ID_REGEX.test(userId)) {
    throw new Error(`invalid userId (ensureDefaultAgent): ${userId}`);
  }

  // 幂等：先检查是否已存在
  const existing = await agentStorage.getAgent(userId, DEFAULT_AGENT_SLUG);
  if (existing) return existing;

  // 不存在则创建（createdAt / updatedAt 会被文件 stat 覆盖，这里仅占位）
  const now = Date.now();
  const profile: AgentProfile = {
    name: DEFAULT_AGENT_NAME,
    description: DEFAULT_AGENT_DESCRIPTION,
    userId,
    type: 'default',
    slug: DEFAULT_AGENT_SLUG,
    createdAt: now,
    updatedAt: now,
    personality: DEFAULT_AGENT_PERSONALITY,
  };
  await agentStorage.saveAgent(profile);

  // 重新读取以获得文件 stat 时间戳
  const created = await agentStorage.getAgent(userId, DEFAULT_AGENT_SLUG);
  if (!created) {
    throw new Error(
      `failed to create default agent for user ${userId}: getAgent returned null after saveAgent`,
    );
  }
  return created;
}

/**
 * §0.3.0 migrateLegacySessions: 0.3.0 升级时一次性迁移现有 sessions。
 *
 * 行为：
 * - 扫描 `${dataDir}/sessions/*.jsonl` + `.meta.json`
 * - 按 userId 分组：有 userId 的 → 迁移；无 userId 的 → 生成伪 UUID
 * - 为每个 userId 创建 default agent（若不存在）
 * - 更新 .meta.json 添加 `agentId: 'default'`
 * - 迁移 session .jsonl + .meta.json 到新路径
 * - 删除 legacy 文件
 *
 * 幂等性：
 * - 已迁移的 session（目标 .jsonl 已存在）不重复迁移，仅清理残留 legacy
 * - 已创建的 default agent 不重复创建
 * - 中断后重新运行可继续
 *
 * @param dataDir aptbot data 目录绝对路径
 * @param agentStorage AgentStorage 实例
 * @returns 迁移报告
 */
export async function migrateLegacySessions(
  dataDir: string,
  agentStorage: AgentStorage,
): Promise<MigrationReport> {
  const legacySessionsDir = join(dataDir, 'sessions');

  // legacy 目录不存在 → 幂等返回空报告
  if (!existsSync(legacySessionsDir)) {
    return { migratedSessions: 0, createdAgents: 0, errors: [] };
  }

  const files = readdirSync(legacySessionsDir);
  const jsonlFiles = files.filter((f) => f.endsWith('.jsonl'));

  let migratedSessions = 0;
  let createdAgents = 0;
  const errors: MigrationError[] = [];

  for (const file of jsonlFiles) {
    const sessionId = file.replace(/\.jsonl$/, '');
    const legacyJsonlPath = join(legacySessionsDir, file);
    const legacyMetaPath = join(legacySessionsDir, `${sessionId}.meta.json`);

    try {
      // 读取 legacy meta.json（不存在或损坏时当作匿名处理）
      let meta: LegacySessionMeta = {};
      if (existsSync(legacyMetaPath)) {
        try {
          const content = readFileSync(legacyMetaPath, 'utf-8');
          meta = JSON.parse(content) as LegacySessionMeta;
        } catch (e) {
          log.warn('legacy meta.json parse failed, treating as anonymous', {
            sessionId,
            error: String(e),
          });
          // meta 保持为空对象，下面会生成伪 userId
          meta = {};
        }
      }

      // 确定 userId：有则用，无则生成伪 UUID
      let userId = meta.userId;
      if (!userId) {
        userId = randomUUID();
        log.info('anonymous session assigned pseudo userId', {
          sessionId,
          userId,
        });
      }

      // 路径遍历防护：userId 必须为合法 UUID
      if (!USER_ID_REGEX.test(userId)) {
        throw new Error(`invalid userId in legacy meta: ${userId}`);
      }

      // 确保 default agent 存在（幂等）
      const agentExistedBefore = await agentStorage.exists(userId, DEFAULT_AGENT_SLUG);
      await ensureDefaultAgent(userId, agentStorage);
      if (!agentExistedBefore) {
        createdAgents++;
      }

      // 计算新路径
      const agentDir = agentStorage.getAgentDir(userId, DEFAULT_AGENT_SLUG);
      const newSessionsDir = join(agentDir, 'sessions');
      const newJsonlPath = join(newSessionsDir, `${sessionId}.jsonl`);
      const newMetaPath = join(newSessionsDir, `${sessionId}.meta.json`);

      // 幂等检查：目标 .jsonl 已存在 → 视为已迁移
      if (existsSync(newJsonlPath)) {
        log.info('session already migrated, cleaning up legacy', {
          sessionId,
          userId,
        });
        // 清理可能残留的 legacy 文件（resume 场景）
        if (existsSync(legacyJsonlPath)) {
          rmSync(legacyJsonlPath, { force: true });
        }
        if (existsSync(legacyMetaPath)) {
          rmSync(legacyMetaPath, { force: true });
        }
        // 已迁移 → 不计数
        continue;
      }

      // 创建新 sessions 目录（若不存在）
      if (!existsSync(newSessionsDir)) {
        mkdirSync(newSessionsDir, { recursive: true });
      }

      // 写新 .meta.json（含 agentId 字段，原子 write-to-tmp + rename）
      const updatedMeta: LegacySessionMeta = {
        ...meta,
        userId,
        agentId: DEFAULT_AGENT_SLUG,
      };
      const metaContent = JSON.stringify(updatedMeta, null, 2);
      const metaTmpPath = `${newMetaPath}.tmp`;
      writeFileSync(metaTmpPath, metaContent, 'utf-8');
      renameSync(metaTmpPath, newMetaPath);

      // 移动 .jsonl（rename 原子操作，源文件被移走）
      if (!existsSync(legacyJsonlPath)) {
        // legacy .jsonl 不存在但 newJsonlPath 也不存在 → 异常状态
        throw new Error(
          `legacy .jsonl missing for session ${sessionId} (cannot migrate)`,
        );
      }
      renameSync(legacyJsonlPath, newJsonlPath);

      // 清理 legacy .meta.json（.jsonl 已通过 rename 移走）
      if (existsSync(legacyMetaPath)) {
        rmSync(legacyMetaPath, { force: true });
      }

      migratedSessions++;
    } catch (e) {
      const errorMsg = e instanceof Error ? e.message : String(e);
      log.error('migration failed for session', {
        sessionId,
        error: errorMsg,
      });
      errors.push({ sessionId, error: errorMsg });
      // 单 session 失败不阻塞其他 session 迁移
    }
  }

  return { migratedSessions, createdAgents, errors };
}
