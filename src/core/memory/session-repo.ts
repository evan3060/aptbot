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
 * Task 3 (0.2.2): JSONL 历史回放消息结构。
 * 仅包含 user/assistant 角色消息，标记 replay: true 供前端去重。
 * 不包含 tool 角色消息和含 toolCalls 的 assistant 消息（避免泄漏内部状态）。
 */
export interface ReplayMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
  replay: true;
}

/**
 * Task 3 (0.2.2): 从 JSONL 读取历史消息用于回放。
 *
 * 行为：
 * - 仅返回 type === 'message' 的 SessionEntry
 * - 过滤 tool 角色消息和含 toolCalls 的 assistant 消息（避免泄漏内部状态）
 * - 仅返回最近 limit 条（默认 20）
 * - 每条消息标记 replay: true，前端不重复渲染
 * - JSONL 文件损坏时由 storage.readSession 内部的 repairJsonl 自动截断修复
 *
 * 安全约束：此函数仅限 wsServer 调用，不进入 agent 工具表。
 */
export async function readHistoryForReplay(
  storage: StorageAdapter,
  sessionId: string,
  limit: number = 20,
): Promise<ReplayMessage[]> {
  const entries = await storage.readSession(sessionId);
  const messages = entries
    .filter((e): e is Extract<SessionEntry, { type: 'message' }> => e.type === 'message')
    .filter((e) => {
      // 不返回 tool 角色消息（避免泄漏内部状态）
      if (e.message.role === 'tool') return false;
      // 不返回含 toolCalls 的 assistant 消息（避免泄漏内部状态）
      if (e.message.toolCalls && e.message.toolCalls.length > 0) return false;
      return true;
    })
    .map((e) => ({
      id: e.message.id,
      role: e.message.role as 'user' | 'assistant',
      content: typeof e.message.content === 'string' ? e.message.content : '',
      timestamp: e.timestamp,
      replay: true as const,
    }));
  // 仅返回最近 limit 条
  return messages.slice(-limit);
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
