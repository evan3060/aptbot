import { randomUUID } from 'node:crypto';
import type { StorageAdapter } from '../../infrastructure/storage/file-storage.js';
import type { Session, SessionMetadata, SessionEntry } from './types.js';
import { nowTimestamp } from './types.js';

export interface SessionRepo {
  /** Task 5: create 新增 userId 参数，触发 storage.claimSession */
  create(userId?: string): Promise<Session>;
  /** Task 5: open 新增 userId 参数，触发 storage.claimSession */
  open(id: string, userId?: string): Promise<Session>;
  /** Task 5: list 新增 userId 过滤 */
  list(userId?: string): Promise<SessionMetadata[]>;
  delete(id: string): Promise<void>;
  /** Task 5: 更新 session label */
  updateLabel(id: string, label: string): Promise<void>;
}

/**
 * §6.3 SessionRepo: session lifecycle management.
 * create 生成新 UUID；open 对不存在 ID 创建新 session（幂等语义 §10.1.3）；
 * list 委托 storage；delete 幂等。
 *
 * Task 5: create/open 在 session 首次创建时调用 storage.claimSession 关联 userId。
 * 注意：claimSession 仅写入 sidecar .meta.json，不依赖 .jsonl 文件存在。
 */
export function createSessionRepo(storage: StorageAdapter): SessionRepo {
  function makeSession(id: string, createdAt: number): Session {
    const metadata: SessionMetadata = {
      id,
      createdAt,
      updatedAt: createdAt,
    };
    return {
      id,
      metadata,
      async getEntries() {
        return storage.readSession(id);
      },
      async append(entry: SessionEntry) {
        await storage.appendSession(id, entry);
      },
      async updateMetadata(_patch: Partial<SessionMetadata>) {
        // MVP: metadata derived from storage file stats; label/compaction entries handled at storage layer
      },
    };
  }

  return {
    async create(userId?: string): Promise<Session> {
      const id = randomUUID();
      const now = nowTimestamp();
      // Task 5: 若提供 userId，立即 claim（写 sidecar，不依赖 .jsonl 存在）
      if (userId) {
        await storage.claimSession(id, userId);
      }
      return makeSession(id, now);
    },

    async open(id: string, userId?: string): Promise<Session> {
      const now = nowTimestamp();
      // Task 5: 若提供 userId，立即 claim（覆盖语义，幂等）
      if (userId) {
        await storage.claimSession(id, userId);
      }
      return makeSession(id, now);
    },

    async list(userId?: string): Promise<SessionMetadata[]> {
      return storage.listSessions(userId);
    },

    async delete(id: string): Promise<void> {
      await storage.deleteSession(id);
    },

    async updateLabel(id: string, label: string): Promise<void> {
      await storage.updateSessionLabel(id, label);
    },
  };
}
