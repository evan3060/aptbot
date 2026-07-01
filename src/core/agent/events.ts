import { randomUUID } from 'node:crypto';

/**
 * §3.2 AgentEvent union.
 * 事件流遵循 §3.2 顺序：agent_start → 多轮（turn_start → message_start → deltas → message_end → tool_call_* → tool_result → turn_end）→ agent_end。
 * 错误事件可穿插；maxIterations 超限时发 retryable=false 的 error。
 */
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

export function createTurnId(): string {
  return randomUUID();
}

export function createMessageId(): string {
  return randomUUID();
}

/** 内部测试辅助，保留供测试构造事件使用 */
export function createToolCallId(): string {
  return randomUUID();
}
