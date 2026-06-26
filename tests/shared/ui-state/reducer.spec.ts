import { describe, it, expect } from 'vitest';
import { coreReducer, initialUIState, type UIState } from '../../../src/shared/ui-state/reducer.js';
import type { AgentEvent } from '../../../src/core/agent/events.js';

function reduce(events: AgentEvent[]): UIState {
  return events.reduce(coreReducer, initialUIState);
}

describe('coreReducer', () => {
  it('initialUIState has empty messages and isWorking=false', () => {
    expect(initialUIState.messages).toEqual([]);
    expect(initialUIState.isWorking).toBe(false);
    expect(initialUIState.error).toBeUndefined();
  });

  it('turn_start sets isWorking=true', () => {
    const state = reduce([{ type: 'turn_start', turnId: 't1' }]);
    expect(state.isWorking).toBe(true);
  });

  it('message_start appends streaming assistant message', () => {
    const state = reduce([
      { type: 'turn_start', turnId: 't1' },
      { type: 'message_start', messageId: 'm1' },
    ]);
    expect(state.messages.length).toBe(1);
    expect(state.messages[0].id).toBe('m1');
    expect(state.messages[0].role).toBe('assistant');
    expect(state.messages[0].isStreaming).toBe(true);
    expect(state.messages[0].text).toBe('');
  });

  it('message_delta accumulates text', () => {
    const state = reduce([
      { type: 'turn_start', turnId: 't1' },
      { type: 'message_start', messageId: 'm1' },
      { type: 'message_delta', text: 'Hello' },
      { type: 'message_delta', text: ' World' },
    ]);
    expect(state.messages[0].text).toBe('Hello World');
  });

  it('message_end sets isStreaming=false', () => {
    const state = reduce([
      { type: 'turn_start', turnId: 't1' },
      { type: 'message_start', messageId: 'm1' },
      { type: 'message_delta', text: 'Hi' },
      { type: 'message_end', messageId: 'm1', stopReason: 'end_turn' },
    ]);
    expect(state.messages[0].isStreaming).toBe(false);
    expect(state.messages[0].text).toBe('Hi');
  });

  it('turn_end sets isWorking=false', () => {
    const state = reduce([
      { type: 'turn_start', turnId: 't1' },
      { type: 'turn_end', turnId: 't1' },
    ]);
    expect(state.isWorking).toBe(false);
  });

  it('error sets error field and isWorking=false', () => {
    const state = reduce([
      { type: 'turn_start', turnId: 't1' },
      { type: 'error', message: 'something broke', retryable: false },
    ]);
    expect(state.isWorking).toBe(false);
    expect(state.error).toBe('something broke');
  });

  it('tool_call_start appends toolCall with status=running', () => {
    const state = reduce([
      { type: 'turn_start', turnId: 't1' },
      { type: 'message_start', messageId: 'm1' },
      { type: 'tool_call_start', toolCallId: 'tc1', toolName: 'bash' },
    ]);
    const msg = state.messages[0];
    expect(msg.toolCalls).toBeDefined();
    expect(msg.toolCalls!.length).toBe(1);
    expect(msg.toolCalls![0].id).toBe('tc1');
    expect(msg.toolCalls![0].name).toBe('bash');
    expect(msg.toolCalls![0].status).toBe('running');
  });

  it('tool_result updates toolCall status', () => {
    const state = reduce([
      { type: 'turn_start', turnId: 't1' },
      { type: 'message_start', messageId: 'm1' },
      { type: 'tool_call_start', toolCallId: 'tc1', toolName: 'bash' },
      { type: 'tool_result', toolCallId: 'tc1', success: true, summary: 'done' },
    ]);
    expect(state.messages[0].toolCalls![0].status).toBe('success');
  });

  it('tool_result with success=false sets status=failed', () => {
    const state = reduce([
      { type: 'turn_start', turnId: 't1' },
      { type: 'message_start', messageId: 'm1' },
      { type: 'tool_call_start', toolCallId: 'tc1', toolName: 'bash' },
      { type: 'tool_result', toolCallId: 'tc1', success: false, summary: 'error' },
    ]);
    expect(state.messages[0].toolCalls![0].status).toBe('failed');
  });

  it('multiple tool_calls preserve order', () => {
    const state = reduce([
      { type: 'turn_start', turnId: 't1' },
      { type: 'message_start', messageId: 'm1' },
      { type: 'tool_call_start', toolCallId: 'tc1', toolName: 'bash' },
      { type: 'tool_call_start', toolCallId: 'tc2', toolName: 'read' },
      { type: 'tool_call_start', toolCallId: 'tc3', toolName: 'write' },
    ]);
    const calls = state.messages[0].toolCalls!;
    expect(calls.length).toBe(3);
    expect(calls[0].id).toBe('tc1');
    expect(calls[1].id).toBe('tc2');
    expect(calls[2].id).toBe('tc3');
  });

  it('multiple turns append separate messages', () => {
    const state = reduce([
      { type: 'turn_start', turnId: 't1' },
      { type: 'message_start', messageId: 'm1' },
      { type: 'message_delta', text: 'first' },
      { type: 'message_end', messageId: 'm1', stopReason: 'end_turn' },
      { type: 'turn_end', turnId: 't1' },
      { type: 'turn_start', turnId: 't2' },
      { type: 'message_start', messageId: 'm2' },
      { type: 'message_delta', text: 'second' },
      { type: 'message_end', messageId: 'm2', stopReason: 'end_turn' },
      { type: 'turn_end', turnId: 't2' },
    ]);
    expect(state.messages.length).toBe(2);
    expect(state.messages[0].text).toBe('first');
    expect(state.messages[1].text).toBe('second');
    expect(state.isWorking).toBe(false);
  });

  it('agent_start and agent_end do not crash', () => {
    const state = reduce([
      { type: 'agent_start' },
      { type: 'turn_start', turnId: 't1' },
      { type: 'turn_end', turnId: 't1' },
      { type: 'agent_end' },
    ]);
    expect(state.isWorking).toBe(false);
  });

  it('reducer is pure (does not mutate input)', () => {
    const state1 = reduce([
      { type: 'turn_start', turnId: 't1' },
      { type: 'message_start', messageId: 'm1' },
    ]);
    const state2 = coreReducer(state1, { type: 'message_delta', text: 'new' });
    // state1 不应被修改
    expect(state1.messages[0].text).toBe('');
    expect(state2.messages[0].text).toBe('new');
    expect(state1).not.toBe(state2);
  });
});
