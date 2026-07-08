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
 * 不包含 tool 角色消息（避免泄漏内部状态）。
 * §0.3.0 UAT Bug M fix: assistant 消息可附带 toolCalls 数据（含 status + summary）。
 */
export interface ReplayMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
  replay: true;
  /** §0.3.0 UAT Bug M: assistant 消息关联的工具调用记录（含 result summary） */
  toolCalls?: Array<{
    id: string;
    name: string;
    arguments: string;
    status: 'running' | 'success' | 'failed';
    summary?: string;
  }>;
}

/**
 * Task 3 (0.2.2): 从 JSONL 读取历史消息用于回放。
 *
 * 行为：
 * - 仅返回 type === 'message' 的 SessionEntry
 * - 过滤 tool 角色消息（避免泄漏内部状态）
 * - §0.3.0 UAT Bug M fix: 保留含 toolCalls 的 assistant 消息，并附带 toolCalls 数据
 *   使前端离开会话再进入时仍能显示工具调用记录
 * - §0.3.0 UAT Bug M fix (round 2): 空内容 + 有 toolCalls 的 assistant 消息（工具调用轮次）
 *   不作为独立消息返回，其 toolCalls 合并到下一条非空 assistant 消息上
 * - 关联 tool 角色消息的 summary 到对应 toolCall（按 toolCallId 匹配）
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
  const messageEntries = entries
    .filter((e): e is Extract<SessionEntry, { type: 'message' }> => e.type === 'message');

  // §0.3.0 UAT Bug M fix: 收集 tool 角色消息的 summary，按 toolCallId 索引
  const toolResultMap = new Map<string, { success: boolean; summary: string }>();
  for (const e of messageEntries) {
    if (e.message.role === 'tool' && e.message.toolCallId) {
      // tool 角色消息的 content 是 summary，success 默认 true（JSONL 不存失败状态）
      toolResultMap.set(e.message.toolCallId, {
        success: true,
        summary: typeof e.message.content === 'string' ? e.message.content : '',
      });
    }
  }

  // §0.3.0 UAT Bug M fix (round 2): 将空内容 + 有 toolCalls 的 assistant 消息的 toolCalls
  // 累积到 pendingToolCalls，合并到下一条非空 assistant 消息
  let pendingToolCalls: NonNullable<ReplayMessage['toolCalls']> = [];
  const messages: ReplayMessage[] = [];

  for (const e of messageEntries) {
    // 不返回 tool 角色消息（避免泄漏内部状态）
    if (e.message.role === 'tool') continue;

    const msg = e.message;
    const contentStr = typeof msg.content === 'string' ? msg.content : '';

    // §0.3.0 UAT Bug M fix (round 2): assistant 消息内容为空但有 toolCalls
    // → 不作为独立消息返回，累积 toolCalls 到 pendingToolCalls
    if (msg.role === 'assistant' && contentStr === '' && msg.toolCalls && msg.toolCalls.length > 0) {
      for (const tc of msg.toolCalls) {
        const result = toolResultMap.get(tc.id);
        pendingToolCalls.push({
          id: tc.id,
          name: tc.name,
          arguments: tc.arguments,
          status: result ? (result.success ? 'success' : 'failed') : 'success',
          summary: result?.summary,
        });
      }
      continue;
    }

    const base: ReplayMessage = {
      id: msg.id,
      role: msg.role as 'user' | 'assistant',
      content: contentStr,
      timestamp: e.timestamp,
      replay: true as const,
    };

    // §0.3.0 UAT Bug M fix: assistant 消息有 toolCalls 时附带返回
    // 优先使用 pendingToolCalls（合并的工具调用轮次），否则用消息自身的 toolCalls
    if (msg.role === 'assistant') {
      if (pendingToolCalls.length > 0) {
        // 使用合并累积的 toolCalls（已含 status + summary）
        base.toolCalls = pendingToolCalls;
      } else if (msg.toolCalls && msg.toolCalls.length > 0) {
        // 使用消息自身的 toolCalls，构建带 result 的版本
        base.toolCalls = msg.toolCalls.map((tc) => {
          const result = toolResultMap.get(tc.id);
          return {
            id: tc.id,
            name: tc.name,
            arguments: tc.arguments,
            status: result ? (result.success ? 'success' as const : 'failed' as const) : 'success' as const,
            summary: result?.summary,
          };
        });
      }
      pendingToolCalls = [];
    }

    messages.push(base);
  }
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
