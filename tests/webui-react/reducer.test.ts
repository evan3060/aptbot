/**
 * Task 3 (React WebUI redesign): uiReducer 单元测试。
 *
 * 验证 brief Step 6 要求的场景：
 *   - message_start 创建空 assistant 消息
 *   - message_delta 追加文本到最后一条 assistant 消息
 *   - message_end 标记 isStreaming=false
 *   - tool_call_start 新建 ToolCall（status=running）
 *   - tool_call_delta 追加 arguments
 *   - tool_result 设置 status（success/failed）+ summary
 *   - turn_start / turn_end 切换 isWorking
 *   - agent_start / agent_end 切换 isWorking
 *   - clear 清空 messages 与 toolCalls
 *
 * 关键：reducer 必须返回新对象/新数组（不可变更新，保证 React re-render）。
 */
import { describe, it, expect } from 'vitest';
import { uiReducer, initialUiState, type UiState, type UiAction } from '../../src/webui-react/lib/reducer.js';
import type { AgentEvent } from '../../src/webui-react/types.js';

function reduce(events: UiAction[]): UiState {
  return events.reduce(uiReducer, initialUiState);
}

describe('uiReducer', () => {
  it('initialUiState has empty messages, empty toolCalls, isWorking=false, currentTurnId=null', () => {
    expect(initialUiState.messages).toEqual([]);
    expect(initialUiState.toolCalls.size).toBe(0);
    expect(initialUiState.isWorking).toBe(false);
    expect(initialUiState.currentTurnId).toBeNull();
  });

  describe('isWorking 切换', () => {
    it('agent_start 设置 isWorking=true', () => {
      const state = reduce([{ type: 'agent_start' }]);
      expect(state.isWorking).toBe(true);
    });

    it('turn_start 设置 isWorking=true 并记录 currentTurnId', () => {
      const state = reduce([{ type: 'turn_start', turnId: 't1' }]);
      expect(state.isWorking).toBe(true);
      expect(state.currentTurnId).toBe('t1');
    });

    it('turn_end 设置 isWorking=false 并清空 currentTurnId', () => {
      const state = reduce([
        { type: 'turn_start', turnId: 't1' },
        { type: 'turn_end', turnId: 't1' },
      ]);
      expect(state.isWorking).toBe(false);
      expect(state.currentTurnId).toBeNull();
    });

    it('agent_end 设置 isWorking=false', () => {
      const state = reduce([
        { type: 'agent_start' },
        { type: 'agent_end' },
      ]);
      expect(state.isWorking).toBe(false);
    });

    it('error 事件设置 isWorking=false', () => {
      const state = reduce([
        { type: 'turn_start', turnId: 't1' },
        { type: 'error', message: 'boom', retryable: false },
      ]);
      expect(state.isWorking).toBe(false);
    });
  });

  describe('assistant 消息流', () => {
    it('message_start 新建空文本的 assistant 消息（isStreaming=true）', () => {
      const state = reduce([{ type: 'message_start', messageId: 'm1' }]);
      expect(state.messages.length).toBe(1);
      expect(state.messages[0]).toEqual({
        id: 'm1',
        role: 'assistant',
        text: '',
        isStreaming: true,
      });
    });

    it('message_delta 追加文本到最后一条 assistant 消息', () => {
      const state = reduce([
        { type: 'message_start', messageId: 'm1' },
        { type: 'message_delta', text: 'Hello' },
        { type: 'message_delta', text: ' World' },
      ]);
      expect(state.messages[0].text).toBe('Hello World');
    });

    it('message_end 标记对应 messageId 的消息 isStreaming=false', () => {
      const state = reduce([
        { type: 'message_start', messageId: 'm1' },
        { type: 'message_delta', text: 'Hi' },
        { type: 'message_end', messageId: 'm1', stopReason: 'end_turn' },
      ]);
      expect(state.messages[0].isStreaming).toBe(false);
      expect(state.messages[0].text).toBe('Hi');
    });

    it('message_delta 在无 assistant 消息时防御性创建一条', () => {
      const state = reduce([{ type: 'message_delta', text: 'orphan' }]);
      expect(state.messages.length).toBe(1);
      expect(state.messages[0].role).toBe('assistant');
      expect(state.messages[0].text).toBe('orphan');
      expect(state.messages[0].isStreaming).toBe(true);
    });

    it('多轮消息独立追加', () => {
      const state = reduce([
        { type: 'message_start', messageId: 'm1' },
        { type: 'message_delta', text: 'first' },
        { type: 'message_end', messageId: 'm1', stopReason: 'end_turn' },
        { type: 'turn_end', turnId: 't1' },
        { type: 'turn_start', turnId: 't2' },
        { type: 'message_start', messageId: 'm2' },
        { type: 'message_delta', text: 'second' },
        { type: 'message_end', messageId: 'm2', stopReason: 'end_turn' },
      ]);
      expect(state.messages.length).toBe(2);
      expect(state.messages[0].text).toBe('first');
      expect(state.messages[1].text).toBe('second');
    });
  });

  describe('tool calls', () => {
    it('tool_call_start 新建 ToolCall（status=running）', () => {
      const state = reduce([
        { type: 'tool_call_start', toolCallId: 'tc1', toolName: 'bash' },
      ]);
      expect(state.toolCalls.size).toBe(1);
      const tc = state.toolCalls.get('tc1');
      expect(tc).toEqual({
        id: 'tc1',
        name: 'bash',
        arguments: '',
        status: 'running',
      });
    });

    it('tool_call_delta 追加 arguments 到对应 toolCallId', () => {
      const state = reduce([
        { type: 'tool_call_start', toolCallId: 'tc1', toolName: 'bash' },
        { type: 'tool_call_delta', toolCallId: 'tc1', arguments: '{"cmd"' },
        { type: 'tool_call_delta', toolCallId: 'tc1', arguments: ': "ls"}' },
      ]);
      const tc = state.toolCalls.get('tc1');
      expect(tc?.arguments).toBe('{"cmd": "ls"}');
      expect(tc?.status).toBe('running');
    });

    it('tool_result 设置 status=success 并写入 summary', () => {
      const state = reduce([
        { type: 'tool_call_start', toolCallId: 'tc1', toolName: 'bash' },
        { type: 'tool_result', toolCallId: 'tc1', success: true, summary: 'done' },
      ]);
      const tc = state.toolCalls.get('tc1');
      expect(tc?.status).toBe('success');
      expect(tc?.summary).toBe('done');
    });

    it('tool_result with success=false 设置 status=failed', () => {
      const state = reduce([
        { type: 'tool_call_start', toolCallId: 'tc1', toolName: 'bash' },
        { type: 'tool_result', toolCallId: 'tc1', success: false, summary: 'error: exit 1' },
      ]);
      const tc = state.toolCalls.get('tc1');
      expect(tc?.status).toBe('failed');
      expect(tc?.summary).toBe('error: exit 1');
    });

    it('多个 tool_call 并存于 toolCalls Map', () => {
      const state = reduce([
        { type: 'tool_call_start', toolCallId: 'tc1', toolName: 'bash' },
        { type: 'tool_call_start', toolCallId: 'tc2', toolName: 'read' },
        { type: 'tool_call_start', toolCallId: 'tc3', toolName: 'write' },
      ]);
      expect(state.toolCalls.size).toBe(3);
      expect(state.toolCalls.get('tc1')?.name).toBe('bash');
      expect(state.toolCalls.get('tc2')?.name).toBe('read');
      expect(state.toolCalls.get('tc3')?.name).toBe('write');
    });

    it('tool_call_end 不改变 status（等 tool_result）', () => {
      const state = reduce([
        { type: 'tool_call_start', toolCallId: 'tc1', toolName: 'bash' },
        { type: 'tool_call_end', toolCallId: 'tc1' },
      ]);
      expect(state.toolCalls.get('tc1')?.status).toBe('running');
    });

    it('tool_call_delta 对未注册的 toolCallId 静默忽略', () => {
      const state = reduce([
        { type: 'tool_call_delta', toolCallId: 'unknown', arguments: 'x' },
      ]);
      expect(state.toolCalls.size).toBe(0);
    });
  });

  describe('turn_busy / reasoning_delta / user_message', () => {
    it('turn_busy 不修改 state（position 暂不展示）', () => {
      const stateBefore = reduce([{ type: 'turn_start', turnId: 't1' }]);
      const stateAfter = uiReducer(stateBefore, { type: 'turn_busy', position: 2 });
      expect(stateAfter).toBe(stateBefore); // 完全相等 — 不创建新对象
    });

    it('reasoning_delta 不修改 state（暂不展示）', () => {
      const stateBefore = reduce([{ type: 'turn_start', turnId: 't1' }]);
      const stateAfter = uiReducer(stateBefore, { type: 'reasoning_delta', text: 'hmm' });
      expect(stateAfter).toBe(stateBefore);
    });

    it('user_message 不修改 state（前端在 send 时本地渲染）', () => {
      const stateBefore = reduce([{ type: 'turn_start', turnId: 't1' }]);
      const stateAfter = uiReducer(stateBefore, {
        type: 'user_message',
        text: 'hi',
        senderId: 'c1',
      } as AgentEvent);
      expect(stateAfter).toBe(stateBefore);
    });
  });

  describe('clear action', () => {
    it('清空 messages 与 toolCalls，重置 isWorking 与 currentTurnId', () => {
      const stateBefore = reduce([
        { type: 'turn_start', turnId: 't1' },
        { type: 'message_start', messageId: 'm1' },
        { type: 'message_delta', text: 'hi' },
        { type: 'tool_call_start', toolCallId: 'tc1', toolName: 'bash' },
      ]);
      expect(stateBefore.messages.length).toBe(1);
      expect(stateBefore.toolCalls.size).toBe(1);
      expect(stateBefore.isWorking).toBe(true);

      const stateAfter = uiReducer(stateBefore, { type: 'clear' });
      expect(stateAfter.messages).toEqual([]);
      expect(stateAfter.toolCalls.size).toBe(0);
      expect(stateAfter.isWorking).toBe(false);
      expect(stateAfter.currentTurnId).toBeNull();
    });
  });

  describe('不可变性（React re-render 保证）', () => {
    it('message_start 返回新数组，不修改原数组', () => {
      const stateBefore = initialUiState;
      const stateAfter = uiReducer(stateBefore, { type: 'message_start', messageId: 'm1' });
      expect(stateAfter).not.toBe(stateBefore);
      expect(stateAfter.messages).not.toBe(stateBefore.messages);
      expect(stateBefore.messages).toEqual([]); // 原数组未被修改
    });

    it('message_delta 用 map 替换目标消息（不 mutate）', () => {
      const stateBefore = reduce([
        { type: 'message_start', messageId: 'm1' },
      ]);
      const stateAfter = uiReducer(stateBefore, { type: 'message_delta', text: 'hi' });
      expect(stateAfter.messages[0]).not.toBe(stateBefore.messages[0]);
      expect(stateBefore.messages[0].text).toBe(''); // 原 message 对象未被修改
      expect(stateAfter.messages[0].text).toBe('hi');
    });

    it('tool_call_start 返回新 Map 实例', () => {
      const stateBefore = reduce([
        { type: 'tool_call_start', toolCallId: 'tc1', toolName: 'bash' },
      ]);
      const stateAfter = uiReducer(stateBefore, {
        type: 'tool_call_start',
        toolCallId: 'tc2',
        toolName: 'read',
      });
      expect(stateAfter.toolCalls).not.toBe(stateBefore.toolCalls);
      expect(stateBefore.toolCalls.size).toBe(1); // 原 Map 未被修改
      expect(stateAfter.toolCalls.size).toBe(2);
    });

    it('tool_call_delta 返回新 Map 实例', () => {
      const stateBefore = reduce([
        { type: 'tool_call_start', toolCallId: 'tc1', toolName: 'bash' },
      ]);
      const stateAfter = uiReducer(stateBefore, {
        type: 'tool_call_delta',
        toolCallId: 'tc1',
        arguments: 'x',
      });
      expect(stateAfter.toolCalls).not.toBe(stateBefore.toolCalls);
      expect(stateBefore.toolCalls.get('tc1')?.arguments).toBe(''); // 原 ToolCall 未被修改
      expect(stateAfter.toolCalls.get('tc1')?.arguments).toBe('x');
    });

    it('turn_start 返回新 state 对象（不 mutate）', () => {
      const stateBefore = initialUiState;
      const stateAfter = uiReducer(stateBefore, { type: 'turn_start', turnId: 't1' });
      expect(stateAfter).not.toBe(stateBefore);
      expect(stateBefore.isWorking).toBe(false); // 原 state 未被修改
      expect(stateAfter.isWorking).toBe(true);
    });
  });
});
