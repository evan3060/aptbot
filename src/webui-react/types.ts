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
