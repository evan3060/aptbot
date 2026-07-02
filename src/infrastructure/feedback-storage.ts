import { randomBytes } from 'node:crypto';
import { join } from 'node:path';
import { writeFileSync } from 'node:fs';
import { appendJsonl, readJsonlTolerant } from './jsonl.js';
import { withJsonlLock } from './jsonl-mutex.js';

/**
 * Task 3 (feedback-storage): FeedbackStorage 类
 *
 * 反馈数据存储在 ${dataDir}/feedback.jsonl，每行一个 FeedbackEntry。
 * append: per-filepath mutex 独占锁，appendJsonl 追加一行。
 * list / findById: 增量流式解析（readJsonlTolerant），无需锁（容忍并发 append）。
 * moderate: per-filepath mutex 独占锁，重写整个 JSONL 文件。
 *
 * 复用现有 jsonl.ts（appendJsonl / readJsonlTolerant）+ jsonl-mutex.ts（withJsonlLock）模式。
 */

export type FeedbackCategory = 'general' | 'article' | 'bug' | 'feature';
export type FeedbackStatus = 'open' | 'resolved' | 'archived';

export interface FeedbackEntry {
  readonly id: string;
  readonly message: string;
  readonly category: FeedbackCategory;
  readonly articleSlug?: string;
  readonly contact?: string;
  readonly ip: string;
  readonly userAgent?: string;
  readonly status: FeedbackStatus;
  readonly note?: string;
  /** ISO 8601 */
  readonly createdAt: string;
  /** ISO 8601，仅在 moderate 后设置 */
  readonly moderatedAt?: string;
}

export interface FeedbackInput {
  readonly message: string;
  readonly category: FeedbackCategory;
  readonly articleSlug?: string;
  readonly contact?: string;
  readonly ip: string;
  readonly userAgent?: string;
}

export interface FeedbackListFilter {
  readonly status?: FeedbackStatus;
  readonly category?: FeedbackCategory;
  readonly limit?: number;
  readonly offset?: number;
}

export interface FeedbackLogger {
  warn(msg: string): void;
}

const FEEDBACK_FILE = 'feedback.jsonl';
const DEFAULT_LIMIT = 50;
const MIN_LIMIT = 1;
const MAX_LIMIT = 100;

/** 生成 `fb-<Date.now()>-<rand6hex>` 形态的反馈 id */
function generateFeedbackId(): string {
  return `fb-${Date.now()}-${randomBytes(3).toString('hex')}`;
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

const defaultLogger: FeedbackLogger = {
  warn(msg: string): void {
    process.stderr.write(`${msg}\n`);
  },
};

export class FeedbackStorage {
  private readonly filePath: string;
  /** per-filepath mutex key：直接复用 getJsonlMutex 的字符串 key 缓存 */
  private readonly lockKey: string;
  private readonly logger: FeedbackLogger;

  constructor(dataDir: string, options?: { logger?: FeedbackLogger }) {
    this.filePath = join(dataDir, FEEDBACK_FILE);
    this.lockKey = this.filePath;
    this.logger = options?.logger ?? defaultLogger;
  }

  /**
   * 追加一条反馈。自动生成 id / createdAt / status='open'，
   * 用 per-filepath mutex 独占锁保证并发 append 串行化。
   */
  async append(input: FeedbackInput): Promise<FeedbackEntry> {
    const entry: FeedbackEntry = {
      id: generateFeedbackId(),
      message: input.message,
      category: input.category,
      articleSlug: input.articleSlug,
      contact: input.contact,
      ip: input.ip,
      userAgent: input.userAgent,
      status: 'open',
      createdAt: new Date().toISOString(),
    };
    await withJsonlLock(this.lockKey, async () => {
      await appendJsonl(this.filePath, entry);
    });
    return entry;
  }

  /**
   * 列出反馈。增量流式解析（无需锁），支持 status / category / limit / offset 过滤。
   * total = 过滤后总数（分页前）；items = 分页后的子集。
   */
  async list(
    filter: FeedbackListFilter,
  ): Promise<{ items: FeedbackEntry[]; total: number }> {
    const status: FeedbackStatus = filter.status ?? 'open';
    const category = filter.category;
    const limit = clamp(filter.limit ?? DEFAULT_LIMIT, MIN_LIMIT, MAX_LIMIT);
    const offset = Math.max(0, filter.offset ?? 0);

    const result = await readJsonlTolerant(this.filePath);
    if (result.skipped > 0) {
      this.logger.warn(
        `feedback.jsonl: skipped ${result.skipped} broken line(s)`,
      );
    }
    const all = result.entries as FeedbackEntry[];
    const filtered = all.filter((e) => {
      if (e.status !== status) return false;
      if (category !== undefined && e.category !== category) return false;
      return true;
    });
    const total = filtered.length;
    const items = filtered.slice(offset, offset + limit);
    return { items, total };
  }

  /**
   * 按 id 查找。增量流式解析（无需锁），未找到返回 null。
   */
  async findById(id: string): Promise<FeedbackEntry | null> {
    const result = await readJsonlTolerant(this.filePath);
    if (result.skipped > 0) {
      this.logger.warn(
        `feedback.jsonl: skipped ${result.skipped} broken line(s)`,
      );
    }
    const all = result.entries as FeedbackEntry[];
    return all.find((e) => e.id === id) ?? null;
  }

  /**
   * 审核：更新 status / note / moderatedAt。先用 findById 查找，
   * 不存在返回 null；存在则用 per-filepath 锁重写整个 JSONL 文件。
   */
  async moderate(
    id: string,
    update: { status: 'resolved' | 'archived'; note?: string },
  ): Promise<FeedbackEntry | null> {
    return withJsonlLock(this.lockKey, async () => {
      const result = await readJsonlTolerant(this.filePath);
      if (result.skipped > 0) {
        this.logger.warn(
          `feedback.jsonl: skipped ${result.skipped} broken line(s)`,
        );
      }
      const all = result.entries as FeedbackEntry[];
      const idx = all.findIndex((e) => e.id === id);
      if (idx === -1) return null;

      const existing = all[idx];
      const updated: FeedbackEntry = {
        ...existing,
        status: update.status,
        moderatedAt: new Date().toISOString(),
        // 仅在 update 显式提供 note 时覆盖（PATCH 语义），避免误清空已有 note
        ...(update.note !== undefined ? { note: update.note } : {}),
      };
      all[idx] = updated;
      const content = all.map((e) => JSON.stringify(e)).join('\n') + '\n';
      writeFileSync(this.filePath, content, { encoding: 'utf-8' });
      return updated;
    });
  }
}
