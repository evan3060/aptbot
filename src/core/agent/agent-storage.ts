import {
  mkdirSync,
  writeFileSync,
  readFileSync,
  renameSync,
  existsSync,
  readdirSync,
  rmSync,
  statSync,
} from 'node:fs';
import { join } from 'node:path';
import matter from 'gray-matter';
import { Mutex, type MutexInterface } from 'async-mutex';
import { createLogger } from '../../infrastructure/logger.js';
import {
  AGENT_SLUG_REGEX,
  parseAgentMd,
  type AgentProfile,
  type AgentProfileFrontmatter,
} from './agent-profile.js';

/**
 * §0.3.0 Task 2: AgentStorage — AGENT.md 持久化与读取
 *
 * 职责：
 * - 管理 `data/users/<userId>/agents/<slug>/AGENT.md` 文件结构
 * - 原子写（write-to-tmp + rename）
 * - per-agentId mutex 串行化并发写入（与 jsonl-mutex 模式一致）
 * - 路径遍历防护：所有路径拼接前校验 userId（UUID）+ slug（正则）
 *
 * 设计要点：
 * - AGENT.md = YAML frontmatter + markdown body（personality）
 * - frontmatter 由 parseAgentMd 解析 + AgentProfileSchema 校验
 * - userId / createdAt / updatedAt / personality 是运行时元数据：
 *   userId 由调用方传入，createdAt/updatedAt 来自文件 stat，personality 来自 body
 * - listAgents 损坏文件 warn 跳过，不抛错（与 FileStorage.listSessions 一致）
 */

/**
 * §0.3.0 USER_ID_REGEX: UUID v4 格式（小写 hex + 短横线，36 字符）。
 * 与 SESSION_ID_REGEX 一致，用于路径遍历防护。
 */
export const USER_ID_REGEX = /^[a-f0-9-]{36}$/;

/** §0.3.0 AGENT_LOCK_TIMEOUT_MS: agent 写锁超时 5000ms（与 jsonl-mutex 一致） */
export const AGENT_LOCK_TIMEOUT_MS = 5000;

const log = createLogger('agent-storage');

/** per-agentId mutex 缓存，键为 `${userId}/${slug}` */
const mutexCache = new Map<string, Mutex>();

/**
 * §0.3.0 getAgentMutex: per-agentId mutex 保证并发写入串行化。
 * Mutex 实例缓存到 Map，与 jsonl-mutex 模式一致。
 */
function getAgentMutex(lockKey: string): Mutex {
  let mutex = mutexCache.get(lockKey);
  if (!mutex) {
    mutex = new Mutex();
    mutexCache.set(lockKey, mutex);
  }
  return mutex;
}

/**
 * §0.3.0 withAgentLock: 在 5000ms 内未获取锁则 reject。
 * 与 withJsonlLock 实现一致，含 ghost acquisition 释放（防死锁）。
 *
 * §0.3.0 Task 7 起 export：write_agent_memory 工具复用此锁保证并发写入串行化
 * （与 AgentStorage.saveAgent 共享同一 per-agentId mutex，避免读写竞态）。
 */
export async function withAgentLock<T>(
  lockKey: string,
  fn: () => Promise<T>,
): Promise<T> {
  const mutex = getAgentMutex(lockKey);
  const acquisition = mutex.acquire();
  const timeout = new Promise<never>((_, reject) => {
    setTimeout(() => {
      reject(
        new Error(
          `agent lock timeout after ${AGENT_LOCK_TIMEOUT_MS}ms for key=${lockKey}`,
        ),
      );
    }, AGENT_LOCK_TIMEOUT_MS);
  });
  let release: MutexInterface.Releaser;
  try {
    release = await Promise.race([acquisition, timeout]);
  } catch (err) {
    // 超时胜出：acquisition 仍 pending。若它后续 resolve，必须立即 release，
    // 否则 ghost acquisition 将永久锁死该 agent 的 mutex（C1 死锁修复）。
    acquisition.then((rel) => rel()).catch(() => {});
    throw err;
  }
  try {
    return await fn();
  } finally {
    release();
  }
}

/**
 * §0.3.0 AgentStorage: AgentProfile 文件系统持久化。
 *
 * 路径结构：`<dataDir>/users/<userId>/agents/<slug>/AGENT.md`
 */
export class AgentStorage {
  private readonly usersDir: string;

  constructor(dataDir: string) {
    this.usersDir = join(dataDir, 'users');
  }

  /**
   * §0.3.0 校验 userId + slug，防路径遍历。
   * 所有路径拼接前必须调用。
   */
  private validatePathParams(userId: string, slug: string): void {
    if (!USER_ID_REGEX.test(userId)) {
      throw new Error(`invalid userId (path traversal guard): ${userId}`);
    }
    if (!AGENT_SLUG_REGEX.test(slug)) {
      throw new Error(`invalid slug (path traversal guard): ${slug}`);
    }
  }

  /** 仅校验 userId（用于 listAgents / countAgents 等无 slug 场景） */
  private validateUserId(userId: string): void {
    if (!USER_ID_REGEX.test(userId)) {
      throw new Error(`invalid userId (path traversal guard): ${userId}`);
    }
  }

  /** lockKey 用于 per-agentId mutex */
  private lockKey(userId: string, slug: string): string {
    return `${userId}/${slug}`;
  }

  /**
   * §0.3.0 getAgentDir: 返回 agent 目录绝对路径。
   * 入参 userId + slug 必须通过路径遍历校验。
   */
  getAgentDir(userId: string, slug: string): string {
    this.validatePathParams(userId, slug);
    return join(this.usersDir, userId, 'agents', slug);
  }

  /** AGENT.md 文件路径（不校验，由调用方保证入参合法） */
  private getAgentMdPath(userId: string, slug: string): string {
    return join(this.getAgentDir(userId, slug), 'AGENT.md');
  }

  /** 用户 agents 目录路径（仅校验 userId） */
  private getUserAgentsDir(userId: string): string {
    this.validateUserId(userId);
    return join(this.usersDir, userId, 'agents');
  }

  /**
   * §0.3.0 getAgent: 读取并解析 AGENT.md。
   *
   * @returns AgentProfile；文件不存在返回 null；损坏文件抛错
   */
  async getAgent(
    userId: string,
    slug: string,
  ): Promise<AgentProfile | null> {
    const mdPath = this.getAgentMdPath(userId, slug);
    if (!existsSync(mdPath)) return null;

    return withAgentLock(this.lockKey(userId, slug), async () => {
      // 双重检查：锁等待期间文件可能已被删除
      if (!existsSync(mdPath)) return null;
      const raw = readFileSync(mdPath, 'utf-8');
      const parsed = parseAgentMd(raw); // 损坏文件抛错
      const stat = statSync(mdPath);
      return this.assembleProfile(
        parsed.frontmatter,
        parsed.body,
        userId,
        stat.birthtimeMs,
        stat.mtimeMs,
      );
    });
  }

  /**
   * §0.3.0 listAgents: 列出用户所有 agent。
   *
   * - 用户目录不存在返回空数组
   * - 损坏文件 warn 跳过（不抛错，与 FileStorage.listSessions 一致）
   */
  async listAgents(userId: string): Promise<AgentProfile[]> {
    const userAgentsDir = this.getUserAgentsDir(userId);
    if (!existsSync(userAgentsDir)) return [];

    const entries = readdirSync(userAgentsDir, { withFileTypes: true });
    const profiles: AgentProfile[] = [];
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const slug = entry.name;
      if (!AGENT_SLUG_REGEX.test(slug)) continue;

      try {
        const profile = await this.getAgent(userId, slug);
        if (profile) profiles.push(profile);
      } catch (err) {
        // 损坏文件 warn 跳过
        log.warn('AGENT.md corrupted, skipping', {
          userId,
          slug,
          error: String(err),
        });
      }
    }
    return profiles;
  }

  /**
   * §0.3.0 saveAgent: 原子写入 AGENT.md（write-to-tmp + rename）。
   *
   * - 自动创建多层目录
   * - per-agentId mutex 串行化并发写入
   * - 仅写入 frontmatter 字段 + body；userId/createdAt/updatedAt 不存盘
   */
  async saveAgent(profile: AgentProfile): Promise<void> {
    const { userId, slug } = profile;
    // 路径遍历防护（在锁外也需校验，避免构造非法 lockKey）
    this.validatePathParams(userId, slug);

    await withAgentLock(this.lockKey(userId, slug), async () => {
      const agentDir = this.getAgentDir(userId, slug);
      const mdPath = join(agentDir, 'AGENT.md');

      // 自动创建多层目录
      if (!existsSync(agentDir)) {
        mkdirSync(agentDir, { recursive: true });
      }

      // 构造 frontmatter（仅 schema 字段，不含 userId/createdAt/updatedAt）
      const frontmatter: AgentProfileFrontmatter = {
        name: profile.name,
        description: profile.description,
        type: profile.type,
        slug: profile.slug,
      };
      if (profile.model !== undefined) frontmatter.model = profile.model;
      if (profile.temperature !== undefined)
        frontmatter.temperature = profile.temperature;
      if (profile.maxTokens !== undefined)
        frontmatter.maxTokens = profile.maxTokens;
      if (profile.reasoningEffort !== undefined)
        frontmatter.reasoningEffort = profile.reasoningEffort;
      if (profile.thinkingType !== undefined)
        frontmatter.thinkingType = profile.thinkingType;
      if (profile.thinkingBudgetTokens !== undefined)
        frontmatter.thinkingBudgetTokens = profile.thinkingBudgetTokens;

      // gray-matter stringify: frontmatter + body
      const content = matter.stringify(profile.personality, frontmatter);

      // 原子写：write-to-tmp + rename
      const tmpPath = `${mdPath}.tmp`;
      writeFileSync(tmpPath, content, 'utf-8');
      renameSync(tmpPath, mdPath);
    });
  }

  /**
   * §0.3.0 deleteAgent: 递归删除 agent 目录。
   * 幂等：目录不存在不抛错。
   *
   * 在 per-agentId 锁内执行，避免与 saveAgent 并发时产生竞态：
   * 否则 saveAgent 的 write-to-tmp 文件可能被 rmSync 删除，
   * 导致随后的 renameSync 抛 ENOENT 并破坏状态一致性。
   */
  async deleteAgent(userId: string, slug: string): Promise<void> {
    // 路径遍历防护（在锁外也需校验，避免构造非法 lockKey）
    this.validatePathParams(userId, slug);

    await withAgentLock(this.lockKey(userId, slug), async () => {
      const agentDir = this.getAgentDir(userId, slug);
      if (existsSync(agentDir)) {
        rmSync(agentDir, { recursive: true, force: true });
      }
    });
  }

  /**
   * §0.3.0 exists: 检查 agent 是否存在（依据 AGENT.md 是否存在）。
   */
  async exists(userId: string, slug: string): Promise<boolean> {
    const mdPath = this.getAgentMdPath(userId, slug);
    return existsSync(mdPath);
  }

  /**
   * §0.3.0 countAgents: 统计用户 agent 数量（依据 AGENT.md 存在的目录数）。
   * 不读取 AGENT.md 内容，仅按目录 + AGENT.md 存在性计数。
   */
  async countAgents(userId: string): Promise<number> {
    const userAgentsDir = this.getUserAgentsDir(userId);
    if (!existsSync(userAgentsDir)) return 0;

    const entries = readdirSync(userAgentsDir, { withFileTypes: true });
    let count = 0;
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (!AGENT_SLUG_REGEX.test(entry.name)) continue;
      const mdPath = join(userAgentsDir, entry.name, 'AGENT.md');
      if (existsSync(mdPath)) count++;
    }
    return count;
  }

  /**
   * §0.3.0 Task 9: findAgentOwner — 扫描所有用户目录，返回 slug 对应 agent 的 owner userId。
   *
   * 用于 /api/agents/:slug 跨用户 403 检测：getAgent(currentUserId, slug) 返回 null 时，
   * 调用此方法判断 agent 是否属于其他用户（→ 403）还是不存在（→ 404）。
   *
   * 设计要点：
   * - slug 严格正则校验（路径遍历防护）
   * - 仅扫描 usersDir 下一层目录，按 USER_ID_REGEX 过滤
   * - 返回首个匹配的 owner userId，不读取 AGENT.md 内容
   * - 未找到返回 null
   */
  async findAgentOwner(slug: string): Promise<string | null> {
    if (!AGENT_SLUG_REGEX.test(slug)) return null;
    if (!existsSync(this.usersDir)) return null;

    const userEntries = readdirSync(this.usersDir, { withFileTypes: true });
    for (const entry of userEntries) {
      if (!entry.isDirectory()) continue;
      if (!USER_ID_REGEX.test(entry.name)) continue;
      const mdPath = join(this.usersDir, entry.name, 'agents', slug, 'AGENT.md');
      if (existsSync(mdPath)) return entry.name;
    }
    return null;
  }

  /**
   * §0.3.0 assembleProfile: 组装完整 AgentProfile。
   * = frontmatter 字段（来自 AGENT.md）+ 运行时元数据（userId / 时间戳）+ personality（body）
   *
   * 注意：gray-matter 在 stringify 时会为 body 追加一个尾部 `\n`（如 'foo' → 'foo\n'）。
   * 这里 strip 末尾换行以保证 round-trip 精确：save('foo') → read('foo')。
   */
  private assembleProfile(
    frontmatter: AgentProfileFrontmatter,
    body: string,
    userId: string,
    createdAtMs: number,
    updatedAtMs: number,
  ): AgentProfile {
    return {
      name: frontmatter.name,
      description: frontmatter.description,
      type: frontmatter.type,
      slug: frontmatter.slug,
      userId,
      createdAt: Math.floor(createdAtMs),
      updatedAt: Math.floor(updatedAtMs),
      personality: body.replace(/\n+$/, ''),
      ...(frontmatter.model !== undefined && { model: frontmatter.model }),
      ...(frontmatter.temperature !== undefined && {
        temperature: frontmatter.temperature,
      }),
      ...(frontmatter.maxTokens !== undefined && {
        maxTokens: frontmatter.maxTokens,
      }),
      ...(frontmatter.reasoningEffort !== undefined && {
        reasoningEffort: frontmatter.reasoningEffort,
      }),
      ...(frontmatter.thinkingType !== undefined && {
        thinkingType: frontmatter.thinkingType,
      }),
      ...(frontmatter.thinkingBudgetTokens !== undefined && {
        thinkingBudgetTokens: frontmatter.thinkingBudgetTokens,
      }),
    };
  }
}
