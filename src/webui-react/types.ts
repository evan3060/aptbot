/**
 * Task 2 (React WebUI redesign): 共享类型定义。
 *
 * 后续 Task 会在此文件追加更多类型（session、agent、message 等）。
 */

/** 已认证用户的基本信息（GET /api/me 与 login/register 响应的子集） */
export interface AuthUser {
  userId: string;
  username: string;
}

/** 认证状态：当前用户与 token 副本（token 副本用于 WebSocket URL 构建） */
export interface AuthState {
  user: AuthUser | null;
  token: string | null;
}

/**
 * Task 3 (React WebUI redesign): WebSocket 消息与 AgentEvent 类型。
 *
 * AgentEvent 镜像 src/core/agent/events.ts 的联合类型，供浏览器 bundle 直接 import
 * （避免 webui-react bundle 依赖 node-only 的 src/core/agent/events.js）。
 *
 * 服务端消息形状来自 src/access/websocket-server.ts：
 * - `{ type: 'event', seq, event }` — broadcast() 通过 ring buffer 投递（line 965）
 * - `{ type: 'user_identified', userId, username?, sessionId?, clientId? }` — 鉴权后下发（line 817）
 * - `{ type: 'error', code, message }` — 顶层错误（line 724）
 * - `{ type: 'presence', onlineCount }` — 同 session 在线人数（line 688）
 * - `{ type: 'replay', replay: true, source?, messages }` — 历史回放（line 843/1064）
 * - `{ type: 'resync_required' }` — ring buffer 缺口，需重置 seq 重连（line 1014）
 * - `{ type: 'session_changed', sessionId }` — /new /resume 后通知（server.ts line 653）
 * - `{ type: 'session_renamed', sessionId, label }` — 重命名广播（server.ts line 499）
 * - `{ type: 'session_deleted', sessionId }` — 删除广播（server.ts line 504）
 *
 * 客户端→服务端：`{ type: 'message', content }`（websocket-server.ts handleMessage line 1114）
 */

/** AgentEvent 子类型字符串联合 */
export type AgentEventType =
  | 'agent_start'
  | 'turn_start'
  | 'turn_busy'
  | 'user_message'
  | 'message_start'
  | 'message_delta'
  | 'reasoning_delta'
  | 'tool_call_start'
  | 'tool_call_delta'
  | 'tool_call_end'
  | 'tool_result'
  | 'message_end'
  | 'turn_end'
  | 'agent_end'
  | 'error';

/** AgentEvent 鉴别联合（镜像 src/core/agent/events.ts） */
export type AgentEvent =
  | { type: 'agent_start' }
  | { type: 'turn_start'; turnId: string }
  | { type: 'turn_busy'; position: number }
  | { type: 'user_message'; text: string; senderId: string }
  | { type: 'message_start'; messageId: string }
  | { type: 'message_delta'; text: string }
  | { type: 'reasoning_delta'; text: string }
  | { type: 'tool_call_start'; toolCallId: string; toolName: string }
  | { type: 'tool_call_delta'; toolCallId: string; arguments: string }
  | { type: 'tool_call_end'; toolCallId: string }
  | { type: 'tool_result'; toolCallId: string; success: boolean; summary: string }
  | { type: 'message_end'; messageId: string; stopReason: string }
  | { type: 'turn_end'; turnId: string }
  | { type: 'agent_end' }
  | { type: 'error'; message: string; retryable: boolean };

/** 服务端→客户端消息联合 */
export type WsServerMessage =
  | { type: 'event'; seq: number; event: AgentEvent }
  | { type: 'user_identified'; userId: string; username?: string; sessionId?: string; clientId?: string }
  | { type: 'error'; code: string; message: string }
  | { type: 'presence'; onlineCount: number }
  | { type: 'replay'; replay: true; source?: string; messages: unknown[] }
  | { type: 'resync_required' }
  | { type: 'session_changed'; sessionId: string }
  | { type: 'session_renamed'; sessionId: string; label: string }
  | { type: 'session_deleted'; sessionId: string };

/** 客户端→服务端消息联合 */
export type WsClientMessage =
  | { type: 'message'; content: string };

/**
 * Task 4 (React WebUI redesign): AgentProfile 类型。
 *
 * 镜像后端 src/core/agent/agent-profile.ts 的 AgentProfile，但仅保留前端 UI 所需字段。
 * 后端使用 `slug` 作为 agent 路径标识符（与 frontend Global Constraint 一致，
 * 详见 docs/superpowers/plans/2026-07-07-react-webui-redesign.md 第 19 行）。
 *
 * 后端响应字段（src/access/agent-api.ts handleAgentApi）：
 * - slug / name / description / personality / userId / type / createdAt / updatedAt
 * - 可选 LLM 字段（model / temperature / maxTokens / reasoningEffort / thinkingType / thinkingBudgetTokens）
 * - memoryEnabled?: boolean（Task 18，仅 professional；default agent 永不注入；缺省 true）
 *
 * 前端独有字段：
 * - iconName: lucide icon 标识符（前端 Sidebar 用来渲染图标，后端不返回，由前端默认映射补齐）
 * - isCustom: 是否为用户自定义 agent（前端从 `type === 'professional'` 推导，default agent 为 false）
 * - predefinedPrompts?: 预设提示词（前端展示用，后端目前不返回，保留扩展点）
 *
 * Sidebar 通过 `slug` 区分 agent（而非 `id`）— 与 Global Constraint 第 19 行一致。
 */
export interface AgentProfile {
  /** 路径标识符（immutable，匹配 AGENT_SLUG_REGEX `[a-z0-9-]{3,64}`） */
  slug: string;
  /** 显示名（mutable，max 64，可中英文） */
  name: string;
  /** 简短描述（max 120） */
  description: string;
  /** 人格描述（AGENT.md body 内容，markdown，无长度限制） */
  personality: string;
  /** lucide icon 标识符（前端独有；后端不返回时由 Sidebar 默认映射） */
  iconName: string;
  /** 是否为用户自定义 agent（前端独有；后端 type === 'professional' 时为 true） */
  isCustom: boolean;
  /** 是否启用 MEMORY.md 注入（后端 Task 18，缺省 true） */
  memoryEnabled?: boolean;
  /** 预设提示词（前端独有；后端目前不返回，保留扩展点） */
  predefinedPrompts?: { label: string; text: string }[];
}

/**
 * Task 4 (React WebUI redesign): SessionMetadata 类型。
 *
 * 镜像后端 src/core/memory/types.ts 的 SessionMetadata，仅保留前端 Sidebar 所需字段。
 *
 * 后端响应字段（src/access/websocket-server.ts handleSessionApi + handleWebuiBootstrap）：
 * - id / agentId / userId? / label? / preview? / createdAt / updatedAt / passedSessions?
 *
 * 前端 Sidebar 仅需：id（用于 onSelectSession）/ agentId（按 agent 分组显示）/
 * label 或 preview（默认显示文本）/ updatedAt（按时间排序）。
 */
export interface SessionMetadata {
  /** session UUID（v4 小写格式），用于 onSelectSession */
  id: string;
  /** session 所属 agent slug（与 AgentProfile.slug 一致） */
  agentId: string;
  /** 用户自定义标签（来自 POST /api/sessions/:id/label） */
  label?: string;
  /** 首条用户消息摘要（无 label 时 Sidebar 默认显示） */
  preview?: string;
  /** 最后更新时间（ms 精度，UTC，用于按时间排序） */
  updatedAt: number;
}

/**
 * Task 4 (React WebUI redesign): GET /api/webui-bootstrap 响应体。
 *
 * 后端实现：src/access/websocket-server.ts handleWebuiBootstrap（line 1490）。
 * 一次性返回 WebUI 初始化所需的全部数据：
 * - agents: 当前用户的所有 AgentProfile（GET /api/agents 复用）
 * - sessions: 当前用户的所有 SessionMetadata（listSessions(userId)）
 * - visibleSkills: default agent 的 UiConfig.visibleSkills（仅 default agent 渲染 chip 区时用）
 * - skills: 已加载的 skill 列表（用于查找 template）
 * - currentAgentSlug: 当前活跃 agent slug（MVP 始终为 'default'）
 * - currentSessionId: server 当前活跃 sessionId（用于前端对齐）
 * - model: 默认 model（来自 config.defaultModel）
 */
export interface BootstrapResponse {
  agents: AgentProfile[];
  sessions: SessionMetadata[];
  visibleSkills: { slug: string; displayName: string }[];
  skills: { name: string; description: string; template?: string }[];
  currentAgentSlug: string;
  currentSessionId: string;
  model: string;
}

/**
 * Task 6 (React WebUI redesign): ModelOption 类型。
 *
 * InputArea 的 model 下拉框数据源。当前 bootstrap 仅返回单一 `model`（字符串），
 * 由 App.tsx（Task 9）包装成 `ModelOption[]`（单元素数组）传入。
 *
 * 字段：
 * - id: 内部标识符（与 bootstrap.model 字符串一致即可）
 * - name: 下拉框显示名（可读模型名，如 "GLM-5.2"，由 App.tsx 映射）
 * - backendModel: 后端实际使用的模型标识符（保留扩展点，目前与 id 一致）
 */
export interface ModelOption {
  id: string;
  name: string;
  backendModel: string;
}
