import { randomUUID } from 'node:crypto';
import type { StorageAdapter } from '../../infrastructure/storage/file-storage.js';
import type { Session, SessionMetadata, SessionEntry } from './types.js';
import { nowTimestamp } from './types.js';

export interface SessionRepo {
  create(): Promise<Session>;
  open(id: string): Promise<Session>;
  list(): Promise<SessionMetadata[]>;
  delete(id: string): Promise<void>;
}

/**
 * §6.3 SessionRepo: session lifecycle management.
 * create 生成新 UUID；open 对不存在 ID 创建新 session（幂等语义 §10.1.3）；
 * list 委托 storage；delete 幂等。
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
    async create(): Promise<Session> {
      const id = randomUUID();
      const now = nowTimestamp();
      return makeSession(id, now);
    },

    async open(id: string): Promise<Session> {
      const now = nowTimestamp();
      return makeSession(id, now);
    },

    async list(): Promise<SessionMetadata[]> {
      return storage.listSessions();
    },

    async delete(id: string): Promise<void> {
      await storage.deleteSession(id);
    },
  };
}
