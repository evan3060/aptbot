import type { AgentEvent } from '../../core/agent/events.js';

export interface MessageViewItem {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  toolCalls?: Array<{ id: string; name: string; status: 'running' | 'success' | 'failed' }>;
  isStreaming?: boolean;
}

export interface UIState {
  messages: MessageViewItem[];
  isWorking: boolean;
  error?: string;
}

export const initialUIState: UIState = {
  messages: [],
  isWorking: false,
};

/**
 * §8.3 coreReducer: 纯函数 UIState 状态机。
 * - turn_start → isWorking=true
 * - message_start → 追加流式 assistant 消息
 * - message_delta → 累积文本到当前消息
 * - message_end → isStreaming=false
 * - tool_call_start → 追加 toolCall 项 status=running
 * - tool_result → 更新 status
 * - turn_end → isWorking=false
 * - error → 设置 error 且 isWorking=false
 */
export function coreReducer(state: UIState, event: AgentEvent): UIState {
  switch (event.type) {
    case 'turn_start':
      return { ...state, isWorking: true };

    case 'message_start': {
      const newMsg: MessageViewItem = {
        id: event.messageId,
        role: 'assistant',
        text: '',
        isStreaming: true,
      };
      return { ...state, messages: [...state.messages, newMsg] };
    }

    case 'message_delta': {
      if (state.messages.length === 0) return state;
      const lastIndex = state.messages.length - 1;
      const messages = state.messages.map((m, i) =>
        i === lastIndex ? { ...m, text: m.text + event.text } : m,
      );
      return { ...state, messages };
    }

    case 'message_end': {
      const messages = state.messages.map((m) =>
        m.id === event.messageId ? { ...m, isStreaming: false } : m,
      );
      return { ...state, messages };
    }

    case 'tool_call_start': {
      if (state.messages.length === 0) return state;
      const lastIndex = state.messages.length - 1;
      const messages = state.messages.map((m, i) =>
        i === lastIndex
          ? {
              ...m,
              toolCalls: [
                ...(m.toolCalls ?? []),
                { id: event.toolCallId, name: event.toolName, status: 'running' as const },
              ],
            }
          : m,
      );
      return { ...state, messages };
    }

    case 'tool_call_delta':
    case 'tool_call_end':
      return state;

    case 'tool_result': {
      const status: 'success' | 'failed' = event.success ? 'success' : 'failed';
      const messages = state.messages.map((m) => ({
        ...m,
        toolCalls: m.toolCalls?.map((tc) =>
          tc.id === event.toolCallId
            ? { ...tc, status }
            : tc,
        ),
      }));
      return { ...state, messages };
    }

    case 'turn_end':
      return { ...state, isWorking: false };

    case 'error':
      return { ...state, isWorking: false, error: event.message };

    default:
      return state;
  }
}
