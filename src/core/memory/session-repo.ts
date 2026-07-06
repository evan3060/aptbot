import { randomUUID } from 'node:crypto';
import type { StorageAdapter } from '../../infrastructure/storage/file-storage.js';
import type { Session, SessionMetadata, SessionEntry } from './types.js';
import { nowTimestamp } from './types.js';

export interface SessionRepo {
  /** Task 5: create 新增 userId 参数，触发 storage.claimSession
   *  §0.3.0 Task 4: 新增 agentId 参数（缺省 'default'） */
  create(userId?: string, agentId?: string): Promise<Session>;
  /** Task 5: open 新增 userId 参数，触发 storage.claimSession
   *  §0.3.0 Task 4: 新增 agentId 参数（缺省 'default'） */
  open(id: string, userId?: string, agentId?: string): Promise<Session>;
  /** Task 5: list 新增 userId 过滤 */
  list(userId?: string): Promise<SessionMetadata[]>;
  delete(id: string): Promise<void>;
  /** Task 5: 更新 session label。
   *  §4.10 Task 10: source 默认 'custom'（手动 /label），'auto' 为 LLM 自动摘要。 */
  updateLabel(id: string, label: string, source?: 'custom' | 'auto'): Promise<void>;
  /** §4.10 Task 10: 是否已有用户手动设置的 custom label（永久跳过自动摘要）。 */
  hasCustomLabel(id: string): Promise<boolean>;
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
/**
 * §0.3.0 Task 4: DEFAULT_AGENT_ID — SessionRepo 层缺省 agentId。
 * 与 agent-migration.ts 的 DEFAULT_AGENT_SLUG 保持一致。
 */
const DEFAULT_AGENT_ID = 'default';

export function createSessionRepo(storage: StorageAdapter): SessionRepo {
  /**
   * §0.3.0 Task 4: makeSession 携带 userId（可选）+ agentId。
   * - userId 提供时：append/getEntries 使用新路径 API（agent-scoped path）
   * - userId 缺省时：使用 legacy API（向后兼容，与未迁移调用方一致）
   */
  function makeSession(
    id: string,
    createdAt: number,
    userId: string | undefined,
    agentId: string = DEFAULT_AGENT_ID,
  ): Session {
    const metadata: SessionMetadata = {
      id,
      createdAt,
      updatedAt: createdAt,
      agentId,
      ...(userId !== undefined && { userId }),
    };
    return {
      id,
      metadata,
      async getEntries() {
        return userId !== undefined
          ? storage.readSession(id, userId, agentId)
          : storage.readSession(id);
      },
      async append(entry: SessionEntry) {
        if (userId !== undefined) {
          await storage.appendSession(id, userId, agentId, entry);
        } else {
          await storage.appendSession(id, entry);
        }
      },
      async updateMetadata(_patch: Partial<SessionMetadata>) {
        // MVP: metadata derived from storage file stats; label/compaction entries handled at storage layer
      },
    };
  }

  return {
    async create(userId?: string, agentId?: string): Promise<Session> {
      const id = randomUUID();
      const now = nowTimestamp();
      const effectiveAgentId = agentId ?? DEFAULT_AGENT_ID;
      // Task 5: 若提供 userId，立即 claim（写 sidecar，不依赖 .jsonl 存在）
      // §0.3.0 Task 4: claimSession 接受 agentId，写入 .meta.json
      if (userId) {
        await storage.claimSession(id, userId, effectiveAgentId);
      }
      return makeSession(id, now, userId, effectiveAgentId);
    },

    async open(id: string, userId?: string, agentId?: string): Promise<Session> {
      const now = nowTimestamp();
      const effectiveAgentId = agentId ?? DEFAULT_AGENT_ID;
      // Task 5: 若提供 userId，立即 claim（覆盖语义，幂等）
      // §0.3.0 Task 4: claimSession 接受 agentId
      if (userId) {
        await storage.claimSession(id, userId, effectiveAgentId);
      }
      return makeSession(id, now, userId, effectiveAgentId);
    },

    async list(userId?: string): Promise<SessionMetadata[]> {
      // §0.3.0 Task 4: listSessions 重载不接受 undefined，需条件分发
      return userId !== undefined
        ? storage.listSessions(userId)
        : storage.listSessions();
    },

    async delete(id: string): Promise<void> {
      await storage.deleteSession(id);
    },

    async updateLabel(id: string, label: string, source?: 'custom' | 'auto'): Promise<void> {
      await storage.updateSessionLabel(id, label, source);
    },

    async hasCustomLabel(id: string): Promise<boolean> {
      return storage.hasCustomLabel(id);
    },
  };
}
