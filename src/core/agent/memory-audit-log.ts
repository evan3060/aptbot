import { withJsonlLock } from '../../infrastructure/jsonl-mutex.js';
import { appendJsonl, readJsonlTolerant } from '../../infrastructure/jsonl.js';
import { createLogger } from '../../infrastructure/logger.js';
import { join } from 'node:path';
import { AGENT_SLUG_REGEX } from './agent-profile.js';
import { USER_ID_REGEX } from './agent-storage.js';

/**
 * §0.3.0 Task 7: MemoryAuditLog — append-only JSONL audit log of memory writes.
 *
 * 设计要点：
 * - 存储路径：`<dataDir>/users/<userId>/agents/<slug>/memory.log.jsonl`
 * - append-only JSONL，一行一个 AuditRecord JSON 对象
 * - 复用现有 jsonl-mutex（withJsonlLock）串行化并发追加，lockKey = `memory-audit:<userId>/<slug>`
 * - 路径遍历防护：构造时校验 userId（UUID）+ slug（AGENT_SLUG_REGEX）
 * - list 默认返回最近 20 条，最新在前（倒序）
 *
 * 注意：section 字段使用 MemoryAuditSection（不含 'all'），因为 'all' 不能被写入。
 */

const log = createLogger('memory-audit-log');

/** §0.3.0 MemoryAuditSection: 可写入的 MEMORY.md 区段（排除 'all'） */
export type MemoryAuditSection = 'user_profile' | 'facts' | 'preferences' | 'history';

/** §0.3.0 AuditRecord: 单条审计记录 */
export interface AuditRecord {
  /** ISO 8601 时间戳 */
  timestamp: string;
  /** 触发写入的 session ID */
  sessionId: string;
  /** 写入的 section */
  section: MemoryAuditSection;
  /** 写入模式 */
  mode: 'append' | 'replace';
  /** content 前 200 字符（预览） */
  contentPreview: string;
  /** content 字节长度 */
  contentLength: number;
  /** 写入前 MEMORY.md 字节数 */
  beforeSize: number;
  /** 写入后 MEMORY.md 字节数 */
  afterSize: number;
}

/** §0.3.0 list 默认返回最近 20 条 */
const DEFAULT_LIST_LIMIT = 20;

/**
 * §0.3.0 Task 7 MemoryAuditLog: agent 记忆写入审计日志。
 *
 * 每次成功写入 MEMORY.md 后追加一条 AuditRecord。append-only，不修改历史记录。
 * 若审计日志 append 失败，调用方（write_agent_memory 工具）负责返回错误给 agent，
 * 但 MEMORY.md 的写入已经通过原子 rename 落盘，无法回滚。
 */
export class MemoryAuditLog {
  private readonly filePath: string;
  private readonly lockKey: string;

  constructor(userId: string, slug: string, dataDir: string) {
    if (!USER_ID_REGEX.test(userId)) {
      throw new Error(`invalid userId (path traversal guard): ${userId}`);
    }
    if (!AGENT_SLUG_REGEX.test(slug)) {
      throw new Error(`invalid slug (path traversal guard): ${slug}`);
    }
    this.filePath = join(dataDir, 'users', userId, 'agents', slug, 'memory.log.jsonl');
    this.lockKey = `memory-audit:${userId}/${slug}`;
  }

  /** §0.3.0 append: 追加一条 AuditRecord 到 JSONL 末尾（per-agent mutex 串行化） */
  async append(record: AuditRecord): Promise<void> {
    await withJsonlLock(this.lockKey, async () => {
      await appendJsonl(this.filePath, record);
    });
    log.debug('audit record appended', {
      path: this.filePath,
      sessionId: record.sessionId,
      section: record.section,
      mode: record.mode,
    });
  }

  /** §0.3.0 list: 返回最近 limit 条记录（默认 20），最新在前 */
  async list(limit: number = DEFAULT_LIST_LIMIT): Promise<AuditRecord[]> {
    return withJsonlLock(this.lockKey, async () => {
      const result = await readJsonlTolerant(this.filePath);
      const records = result.entries as AuditRecord[];
      const reversed = records.slice().reverse();
      return reversed.slice(0, limit);
    });
  }
}
