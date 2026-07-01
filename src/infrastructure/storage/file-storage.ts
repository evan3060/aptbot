import { readdirSync, statSync, unlinkSync, existsSync, writeFileSync, readFileSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import {
  appendJsonl,
  readJsonlTolerant,
  repairJsonl,
} from '../jsonl.js';
import { withJsonlLock } from '../jsonl-mutex.js';
import { createLogger } from '../logger.js';
import {
  type SessionEntry,
  type SessionMetadata,
  isValidSessionId,
  nowTimestamp,
} from '../../core/memory/types.js';

const metaLog = createLogger('file-storage');

/**
 * 生成 `${prefix}${timestamp}-${random}` 形态的 entry id。
 * timestamp 为 ms 精度（等同 nowTimestamp / Date.now），random 为 6 位 base36。
 */
export function generateEntryId(prefix: string): string {
  return `${prefix}${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Task 5: session 元数据 sidecar 文件结构。
 * 与 `<sessionId>.jsonl` 同目录，文件名 `<sessionId>.meta.json`。
 * 用于持久化 userId / label 等元信息，不混入 JSONL entries。
 */
interface SessionMetaFile {
  userId?: string;
  label?: string;
  preview?: string;
  /** §4.10 Task 10: label 来源。'custom'=用户手动 /label（永久跳过自动摘要）；'auto'=LLM 自动摘要。 */
  labelSource?: 'custom' | 'auto';
}

/**
 * Task 5 C2 fix: claimSession 在跨用户 claim 时抛出，防止所有权被静默转移。
 */
export class SessionAlreadyClaimedError extends Error {
  constructor(
    public readonly sessionId: string,
    public readonly currentOwner: string,
    public readonly attemptedOwner: string,
  ) {
    super(`session ${sessionId} already claimed by ${currentOwner}, cannot claim to ${attemptedOwner}`);
    this.name = 'SessionAlreadyClaimedError';
  }
}

export interface StorageAdapter {
  readSession(id: string): Promise<SessionEntry[]>;
  appendSession(id: string, entry: SessionEntry): Promise<void>;
  listSessions(userId?: string): Promise<SessionMetadata[]>;
  readWorkingMemory(sessionId: string): Promise<string | null>;
  writeWorkingMemory(sessionId: string, keyInfo: string): Promise<void>;
  deleteSession(id: string): Promise<void>;
  /** Task 5: 将 session claim 到指定 user（幂等：同用户重复 claim 是 no-op；跨用户 claim 抛 SessionAlreadyClaimedError） */
  claimSession(id: string, userId: string): Promise<void>;
  /** 强制覆盖 session owner（用于 agent 共享 session 转移给当前登录用户） */
  forceClaimSession(id: string, userId: string): Promise<void>;
  /** Task 5: 更新 session label（写入 sidecar .meta.json）。
   *  §4.10 Task 10: source 可选，'custom'（默认，用户手动 /label）/ 'auto'（LLM 自动摘要）。 */
  updateSessionLabel(id: string, label: string, source?: 'custom' | 'auto'): Promise<void>;
  /** Task 5 C2 fix: 读取 session 当前 owner（未 claim 返回 undefined） */
  getSessionOwner(id: string): Promise<string | undefined>;
  /** §4.10 Task 10: 是否已有用户手动设置的 custom label（永久跳过自动摘要）。 */
  hasCustomLabel(id: string): Promise<boolean>;
}

/**
 * §9.4 FileStorage: JSONL-based per-session file storage.
 * §10.1.1 / §10.1.3 边界：损坏容错、per-sessionId mutex 串行化。
 */
export class FileStorage implements StorageAdapter {
  private readonly sessionsDir: string;

  constructor(sessionsDir: string = './sessions') {
    this.sessionsDir = sessionsDir;
  }

  private resolvePath(id: string): string {
    if (!isValidSessionId(id)) {
      throw new Error(`invalid sessionId: ${id}`);
    }
    return join(this.sessionsDir, `${id}.jsonl`);
  }

  /** Task 5: sidecar .meta.json 路径 */
  private resolveMetaPath(id: string): string {
    if (!isValidSessionId(id)) {
      throw new Error(`invalid sessionId: ${id}`);
    }
    return join(this.sessionsDir, `${id}.meta.json`);
  }

  /** Task 5: 读取 sidecar 元数据，文件不存在返回空对象 */
  private readMeta(id: string): SessionMetaFile {
    const path = this.resolveMetaPath(id);
    if (!existsSync(path)) return {};
    try {
      const content = readFileSync(path, 'utf-8');
      return JSON.parse(content) as SessionMetaFile;
    } catch (err) {
      // I11 fix: 损坏时记录警告而非静默吞错
      metaLog.warn('meta.json parse failed, treating as empty', { sessionId: id, error: String(err) });
      return {};
    }
  }

  /**
   * Task 5 C1 fix: 原子写入 sidecar 元数据（write-to-tmp + rename）。
   * 调用方必须在 withJsonlLock 内调用以防止并发读改写竞态。
   */
  private writeMetaAtomic(id: string, patch: SessionMetaFile): void {
    const existing = this.readMeta(id);
    const merged: SessionMetaFile = { ...existing, ...patch };
    const finalPath = this.resolveMetaPath(id);
    const tmpPath = `${finalPath}.tmp`;
    writeFileSync(tmpPath, JSON.stringify(merged, null, 2), 'utf-8');
    renameSync(tmpPath, finalPath);
  }

  async readSession(id: string): Promise<SessionEntry[]> {
    const path = this.resolvePath(id);
    if (!existsSync(path)) return [];
    // I11 修复：获取 jsonl 锁，防止 repairJsonl 的 truncate+rewrite 与 appendSession 的写入竞态
    return withJsonlLock(id, async () => {
      // 先修复破损，再读取
      await repairJsonl(path);
      const result = await readJsonlTolerant(path);
      return result.entries as SessionEntry[];
    });
  }

  async appendSession(id: string, entry: SessionEntry): Promise<void> {
    const path = this.resolvePath(id);
    await withJsonlLock(id, async () => {
      await appendJsonl(path, entry);
      // 首条用户消息时缓存 preview（用于侧边栏默认显示，避免每次 listSessions 读 JSONL）
      if (entry.type === 'message' && entry.message.role === 'user') {
        const meta = this.readMeta(id);
        if (!meta.preview) {
          const content = typeof entry.message.content === 'string'
            ? entry.message.content
            : '';
          this.writeMetaAtomic(id, { preview: content.slice(0, 30) });
        }
      }
    });
  }

  async listSessions(userId?: string): Promise<SessionMetadata[]> {
    if (!existsSync(this.sessionsDir)) return [];
    const files = readdirSync(this.sessionsDir).filter((f) => f.endsWith('.jsonl'));
    const metas: SessionMetadata[] = [];
    for (const file of files) {
      const id = file.replace(/\.jsonl$/, '');
      if (!isValidSessionId(id)) continue;
      const path = join(this.sessionsDir, file);
      const stat = statSync(path);
      const meta = this.readMeta(id);
      // Task 5: 若指定 userId 过滤，跳过不属于该用户的 session（未 claim 也不返回）
      if (userId !== undefined && meta.userId !== userId) continue;
      metas.push({
        id,
        createdAt: Math.floor(stat.birthtimeMs),
        updatedAt: Math.floor(stat.mtimeMs),
        userId: meta.userId,
        label: meta.label,
        preview: meta.preview,
      });
    }
    // 按 updatedAt 降序
    metas.sort((a, b) => b.updatedAt - a.updatedAt);
    return metas;
  }

  async readWorkingMemory(sessionId: string): Promise<string | null> {
    const entries = await this.readSession(sessionId);
    // 从末尾反向查找最后一条 working_memory entry
    for (let i = entries.length - 1; i >= 0; i--) {
      const e = entries[i];
      if (e.type === 'working_memory') return e.keyInfo;
    }
    return null;
  }

  async writeWorkingMemory(sessionId: string, keyInfo: string): Promise<void> {
    const entry: SessionEntry = {
      type: 'working_memory',
      id: generateEntryId('wm-'),
      keyInfo,
      timestamp: nowTimestamp(),
    };
    await this.appendSession(sessionId, entry);
  }

  async deleteSession(id: string): Promise<void> {
    const path = this.resolvePath(id);
    if (existsSync(path)) {
      unlinkSync(path);
    }
    // 同步删除 sidecar meta
    const metaPath = this.resolveMetaPath(id);
    if (existsSync(metaPath)) {
      unlinkSync(metaPath);
    }
    // 幂等：文件不存在不抛错
  }

  /**
   * Task 5: claim session 到指定 user。
   * C1 fix: 加 withJsonlLock 防止并发读改写竞态。
   * I8 fix: 真正幂等 — 同用户重复 claim 是 no-op；跨用户 claim 抛 SessionAlreadyClaimedError。
   */
  async claimSession(id: string, userId: string): Promise<void> {
    if (!isValidSessionId(id)) {
      throw new Error(`invalid sessionId: ${id}`);
    }
    await withJsonlLock(id, () => {
      const existing = this.readMeta(id);
      if (existing.userId && existing.userId !== userId) {
        throw new SessionAlreadyClaimedError(id, existing.userId, userId);
      }
      // 同用户或未 claim：写入（若已是同用户则 no-op 但仍写入以保持幂等语义）
      this.writeMetaAtomic(id, { userId });
      return Promise.resolve();
    });
  }

  /** Task 5: 更新 session label（加锁防竞态）。
   *  §4.10 Task 10: source 默认 'custom'（手动 /label），'auto' 为 LLM 自动摘要。 */
  async updateSessionLabel(
    id: string,
    label: string,
    source: 'custom' | 'auto' = 'custom',
  ): Promise<void> {
    if (!isValidSessionId(id)) {
      throw new Error(`invalid sessionId: ${id}`);
    }
    await withJsonlLock(id, () => {
      this.writeMetaAtomic(id, { label, labelSource: source });
      return Promise.resolve();
    });
  }

  /** §4.10 Task 10: 是否已有用户手动设置的 custom label（永久跳过自动摘要）。 */
  async hasCustomLabel(id: string): Promise<boolean> {
    if (!isValidSessionId(id)) return false;
    return this.readMeta(id).labelSource === 'custom';
  }

  /** Task 5 C2 fix: 读取 session 当前 owner */
  async getSessionOwner(id: string): Promise<string | undefined> {
    if (!isValidSessionId(id)) return undefined;
    return this.readMeta(id).userId;
  }

  /**
   * 强制覆盖 session owner（用于 agent 共享 session 转移给当前登录用户）。
   * 与 claimSession 不同：跨用户 claim 不抛错，直接覆盖。
   */
  async forceClaimSession(id: string, userId: string): Promise<void> {
    if (!isValidSessionId(id)) {
      throw new Error(`invalid sessionId: ${id}`);
    }
    await withJsonlLock(id, () => {
      this.writeMetaAtomic(id, { userId });
      return Promise.resolve();
    });
  }
}
