import { readdirSync, statSync, unlinkSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import {
  appendJsonl,
  readJsonlTolerant,
  repairJsonl,
} from '../jsonl.js';
import { withJsonlLock } from '../jsonl-mutex.js';
import {
  type SessionEntry,
  type SessionMetadata,
  isValidSessionId,
  nowTimestamp,
} from '../../core/memory/types.js';

/**
 * 生成 `${prefix}${timestamp}-${random}` 形态的 entry id。
 * timestamp 为 ms 精度（等同 nowTimestamp / Date.now），random 为 6 位 base36。
 */
export function generateEntryId(prefix: string): string {
  return `${prefix}${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export interface StorageAdapter {
  readSession(id: string): Promise<SessionEntry[]>;
  appendSession(id: string, entry: SessionEntry): Promise<void>;
  listSessions(): Promise<SessionMetadata[]>;
  readWorkingMemory(sessionId: string): Promise<string | null>;
  writeWorkingMemory(sessionId: string, keyInfo: string): Promise<void>;
  deleteSession(id: string): Promise<void>;
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
    await withJsonlLock(id, () => appendJsonl(path, entry));
  }

  async listSessions(): Promise<SessionMetadata[]> {
    if (!existsSync(this.sessionsDir)) return [];
    const files = readdirSync(this.sessionsDir).filter((f) => f.endsWith('.jsonl'));
    const metas: SessionMetadata[] = [];
    for (const file of files) {
      const id = file.replace(/\.jsonl$/, '');
      if (!isValidSessionId(id)) continue;
      const path = join(this.sessionsDir, file);
      const stat = statSync(path);
      metas.push({
        id,
        createdAt: Math.floor(stat.birthtimeMs),
        updatedAt: Math.floor(stat.mtimeMs),
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
    // 幂等：文件不存在不抛错
  }
}
