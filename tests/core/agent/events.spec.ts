import { describe, it, expect } from 'vitest';
import {
  createTurnId,
  createMessageId,
  createToolCallId,
  type AgentEvent,
} from '../../../src/core/agent/events.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

describe('ID generators', () => {
  it('createTurnId returns UUID format', () => {
    expect(createTurnId()).toMatch(UUID_RE);
  });

  it('createMessageId returns UUID format', () => {
    expect(createMessageId()).toMatch(UUID_RE);
  });

  it('createToolCallId returns UUID format', () => {
    expect(createToolCallId()).toMatch(UUID_RE);
  });

  it('each call returns a unique id', () => {
    const a = createTurnId();
    const b = createTurnId();
    expect(a).not.toBe(b);
  });
});

describe('AgentEvent union', () => {
  it('agent_start event', () => {
    const e: AgentEvent = { type: 'agent_start' };
    expect(e.type).toBe('agent_start');
  });

  it('turn_start event carries turnId', () => {
    const e: AgentEvent = { type: 'turn_start', turnId: 't-1' };
    expect(e.type).toBe('turn_start');
    if (e.type === 'turn_start') expect(e.turnId).toBe('t-1');
  });

  it('message_start event carries messageId', () => {
    const e: AgentEvent = { type: 'message_start', messageId: 'm-1' };
    if (e.type === 'message_start') expect(e.messageId).toBe('m-1');
  });

  it('message_delta event carries text', () => {
    const e: AgentEvent = { type: 'message_delta', text: 'hello' };
    if (e.type === 'message_delta') expect(e.text).toBe('hello');
  });

  it('reasoning_delta event carries text', () => {
    const e: AgentEvent = { type: 'reasoning_delta', text: 'thinking' };
    if (e.type === 'reasoning_delta') expect(e.text).toBe('thinking');
  });

  it('tool_call_start event carries toolCallId and toolName', () => {
    const e: AgentEvent = {
      type: 'tool_call_start',
      toolCallId: 'tc-1',
      toolName: 'bash',
    };
    if (e.type === 'tool_call_start') {
      expect(e.toolCallId).toBe('tc-1');
      expect(e.toolName).toBe('bash');
    }
  });

  it('tool_call_delta event carries toolCallId and arguments', () => {
    const e: AgentEvent = {
      type: 'tool_call_delta',
      toolCallId: 'tc-1',
      arguments: '{"cmd":"ls"}',
    };
    if (e.type === 'tool_call_delta') {
      expect(e.toolCallId).toBe('tc-1');
      expect(e.arguments).toBe('{"cmd":"ls"}');
    }
  });

  it('tool_call_end event carries toolCallId', () => {
    const e: AgentEvent = { type: 'tool_call_end', toolCallId: 'tc-1' };
    if (e.type === 'tool_call_end') expect(e.toolCallId).toBe('tc-1');
  });

  it('tool_result event carries toolCallId, success, summary', () => {
    const e: AgentEvent = {
      type: 'tool_result',
      toolCallId: 'tc-1',
      success: true,
      summary: 'ok',
    };
    if (e.type === 'tool_result') {
      expect(e.success).toBe(true);
      expect(e.summary).toBe('ok');
    }
  });

  it('message_end event carries messageId and stopReason', () => {
    const e: AgentEvent = { type: 'message_end', messageId: 'm-1', stopReason: 'end_turn' };
    if (e.type === 'message_end') {
      expect(e.messageId).toBe('m-1');
      expect(e.stopReason).toBe('end_turn');
    }
  });

  it('turn_end event carries turnId', () => {
    const e: AgentEvent = { type: 'turn_end', turnId: 't-1' };
    if (e.type === 'turn_end') expect(e.turnId).toBe('t-1');
  });

  it('agent_end event', () => {
    const e: AgentEvent = { type: 'agent_end' };
    expect(e.type).toBe('agent_end');
  });

  it('error event carries message and retryable', () => {
    const e: AgentEvent = {
      type: 'error',
      message: 'provider down',
      retryable: true,
    };
    if (e.type === 'error') {
      expect(e.message).toBe('provider down');
      expect(e.retryable).toBe(true);
    }
  });

  it('error event with retryable=false', () => {
    const e: AgentEvent = {
      type: 'error',
      message: 'max_iterations_exceeded',
      retryable: false,
    };
    if (e.type === 'error') expect(e.retryable).toBe(false);
  });
});
