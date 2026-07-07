/**
 * Task 3 (React WebUI redesign): uiReducer — 把 AgentEvent 流式归约为 UI 状态。
 *
 * 状态结构（brief Step 8）：
 *   {
 *     messages: Message[];          // 不可变数组，更新时返回新数组
 *     toolCalls: Map<string, ToolCall>;  // 不可变 Map，更新时返回新 Map 实例
 *     isWorking: boolean;
 *     currentTurnId: string | null;
 *   }
 *
 * 处理规则（brief Step 8）：
 *   - agent_start / turn_start  → isWorking=true（turn_start 同时记录 currentTurnId）
 *   - message_start              → 新建空文本 assistant 消息（isStreaming=true）
 *   - message_delta              → 找到最后一条 assistant 消息追加文本（不可变 map 替换）
 *   - message_end                → 对应 messageId 标记 isStreaming=false
 *   - tool_call_start            → 新建 ToolCall（status=running）
 *   - tool_call_delta           → 追加 arguments 到对应 toolCallId
 *   - tool_result                → 设置 status（success/failed）+ summary
 *   - turn_end / agent_end      → isWorking=false（turn_end 同时清空 currentTurnId）
 *   - error                      → isWorking=false
 *   - clear                      → 清空 messages / toolCalls / currentTurnId / isWorking
 *   - 其他（turn_busy / reasoning_delta / user_message / tool_call_end）→ no-op
 *
 * React re-render 保证：所有更新返回新对象/新数组/新 Map，绝不 mutate。
 */
import type { AgentEvent } from '../types.js';

/** UI 消息条目（仅 user/assistant，过滤 tool 角色） */
export interface Message {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  isStreaming?: boolean;
}

/** 工具调用条目，与 message 解耦存储在 Map（按 toolCallId 索引） */
export interface ToolCall {
  id: string;
  name: string;
  arguments: string;
  status: 'running' | 'success' | 'failed';
  summary?: string;
}

/** UI 状态 */
export interface UiState {
  messages: Message[];
  toolCalls: Map<string, ToolCall>;
  isWorking: boolean;
  currentTurnId: string | null;
}

/** reducer 接受 AgentEvent 或显式 clear action */
export type UiAction = AgentEvent | { type: 'clear' };

export const initialUiState: UiState = {
  messages: [],
  toolCalls: new Map(),
  isWorking: false,
  currentTurnId: null,
};

/**
 * 生成短随机后缀，用于防御性创建 message（无 message_start 先到 message_delta 的边界场景）。
 * 不与 server-issued messageId 冲突（后者是 UUID）。
 */
function ephemeralId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * uiReducer — 纯函数，将 UiAction 归约为新 UiState。
 *
 * 不修改入参；no-op 分支返回原 state 引用（让 React.memo 等比较器跳过渲染）。
 */
export function uiReducer(state: UiState, action: UiAction): UiState {
  switch (action.type) {
    case 'agent_start':
      return { ...state, isWorking: true };

    case 'turn_start':
      return { ...state, isWorking: true, currentTurnId: action.turnId };

    case 'message_start':
      return {
        ...state,
        messages: [
          ...state.messages,
          { id: action.messageId, role: 'assistant', text: '', isStreaming: true },
        ],
      };

    case 'message_delta': {
      // 找最后一条 assistant 消息追加文本（brief: "找到最后一条 assistant 消息追加文本"）
      let lastAssistantIndex = -1;
      for (let i = state.messages.length - 1; i >= 0; i--) {
        if (state.messages[i].role === 'assistant') {
          lastAssistantIndex = i;
          break;
        }
      }
      if (lastAssistantIndex === -1) {
        // 防御性：未收到 message_start 即收到 delta —— 创建一条新 assistant 消息
        return {
          ...state,
          messages: [
            ...state.messages,
            { id: ephemeralId('m'), role: 'assistant', text: action.text, isStreaming: true },
          ],
        };
      }
      const messages = state.messages.map((m, i) =>
        i === lastAssistantIndex ? { ...m, text: m.text + action.text } : m,
      );
      return { ...state, messages };
    }

    case 'message_end': {
      // 按 messageId 标记 isStreaming=false（保留 text 不变）
      const messages = state.messages.map((m) =>
        m.id === action.messageId ? { ...m, isStreaming: false } : m,
      );
      return { ...state, messages };
    }

    case 'tool_call_start': {
      const toolCalls = new Map(state.toolCalls);
      toolCalls.set(action.toolCallId, {
        id: action.toolCallId,
        name: action.toolName,
        arguments: '',
        status: 'running',
      });
      return { ...state, toolCalls };
    }

    case 'tool_call_delta': {
      const existing = state.toolCalls.get(action.toolCallId);
      if (!existing) return state; // 未注册的 toolCallId 静默忽略
      const toolCalls = new Map(state.toolCalls);
      toolCalls.set(action.toolCallId, {
        ...existing,
        arguments: existing.arguments + action.arguments,
      });
      return { ...state, toolCalls };
    }

    case 'tool_call_end':
      // 不改变 status —— tool_result 才是终态信号
      return state;

    case 'tool_result': {
      const existing = state.toolCalls.get(action.toolCallId);
      if (!existing) return state; // 未注册的 toolCallId 静默忽略
      const toolCalls = new Map(state.toolCalls);
      toolCalls.set(action.toolCallId, {
        ...existing,
        status: action.success ? 'success' : 'failed',
        summary: action.summary,
      });
      return { ...state, toolCalls };
    }

    case 'turn_end':
      return { ...state, isWorking: false, currentTurnId: null };

    case 'agent_end':
      return { ...state, isWorking: false };

    case 'error':
      return { ...state, isWorking: false };

    case 'clear':
      return {
        ...state,
        messages: [],
        toolCalls: new Map(),
        isWorking: false,
        currentTurnId: null,
      };

    // 以下事件不修改 UI 状态：
    // - turn_busy: position 暂不展示（未来用作进度条时可扩展）
    // - reasoning_delta: 暂不展示 reasoning 内容
    // - user_message: 用户消息在 send 时本地渲染，跨客户端同步留待 Task 9
    case 'turn_busy':
    case 'reasoning_delta':
    case 'user_message':
      return state;

    default:
      return state;
  }
}
