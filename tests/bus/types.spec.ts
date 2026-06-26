import { describe, it, expect } from 'vitest';
import {
  matchesCapability,
  type ChannelCapability,
  type InboundMessage,
  type AgentEventEnvelope,
  type Channel,
  type MessageBus,
  type MediaContent,
} from '../../src/bus/types.js';

const FULL_CAP: ChannelCapability = {
  streaming: true,
  reasoning: true,
  richUi: true,
  fileEditEvents: true,
  editMessage: true,
  markdown: true,
};

const NO_STREAMING: ChannelCapability = { ...FULL_CAP, streaming: false };
const NO_REASONING: ChannelCapability = { ...FULL_CAP, reasoning: false };
const NO_RICH_UI: ChannelCapability = { ...FULL_CAP, richUi: false };

describe('matchesCapability', () => {
  it('message_delta matches when streaming=true', () => {
    expect(matchesCapability(FULL_CAP, { type: 'message_delta', text: 'hi' })).toBe(true);
  });

  it('message_delta does not match when streaming=false', () => {
    expect(matchesCapability(NO_STREAMING, { type: 'message_delta', text: 'hi' })).toBe(false);
  });

  it('reasoning_delta matches when reasoning=true', () => {
    expect(matchesCapability(FULL_CAP, { type: 'reasoning_delta', text: 'think' })).toBe(true);
  });

  it('reasoning_delta does not match when reasoning=false', () => {
    expect(matchesCapability(NO_REASONING, { type: 'reasoning_delta', text: 'think' })).toBe(false);
  });

  it('tool_call_start always matches (degraded when richUi=false)', () => {
    expect(matchesCapability(FULL_CAP, { type: 'tool_call_start', toolCallId: '1', toolName: 'bash' })).toBe(true);
    expect(matchesCapability(NO_RICH_UI, { type: 'tool_call_start', toolCallId: '1', toolName: 'bash' })).toBe(true);
  });

  it('tool_result always matches (degraded when richUi=false)', () => {
    expect(matchesCapability(FULL_CAP, { type: 'tool_result', toolCallId: '1', success: true, summary: 'ok' })).toBe(true);
    expect(matchesCapability(NO_RICH_UI, { type: 'tool_result', toolCallId: '1', success: true, summary: 'ok' })).toBe(true);
  });

  it('agent_start always matches', () => {
    expect(matchesCapability(NO_STREAMING, { type: 'agent_start' })).toBe(true);
  });

  it('turn_start always matches', () => {
    expect(matchesCapability(NO_STREAMING, { type: 'turn_start', turnId: 't1' })).toBe(true);
  });

  it('message_start always matches', () => {
    expect(matchesCapability(NO_STREAMING, { type: 'message_start', messageId: 'm1' })).toBe(true);
  });

  it('message_end always matches', () => {
    expect(matchesCapability(NO_STREAMING, { type: 'message_end', messageId: 'm1', stopReason: 'end_turn' })).toBe(true);
  });

  it('turn_end always matches', () => {
    expect(matchesCapability(NO_STREAMING, { type: 'turn_end', turnId: 't1' })).toBe(true);
  });

  it('agent_end always matches', () => {
    expect(matchesCapability(NO_STREAMING, { type: 'agent_end' })).toBe(true);
  });

  it('error always matches', () => {
    expect(matchesCapability(NO_STREAMING, { type: 'error', message: 'fail', retryable: false })).toBe(true);
  });

  it('tool_call_delta always matches', () => {
    expect(matchesCapability(NO_RICH_UI, { type: 'tool_call_delta', toolCallId: '1', arguments: '{}' })).toBe(true);
  });

  it('tool_call_end always matches', () => {
    expect(matchesCapability(NO_RICH_UI, { type: 'tool_call_end', toolCallId: '1' })).toBe(true);
  });
});

describe('Type exports compile', () => {
  it('InboundMessage shape', () => {
    const msg: InboundMessage = {
      channel: 'cli',
      senderId: 'user1',
      chatId: 'chat1',
      content: 'hello',
      metadata: {},
    };
    expect(msg.content).toBe('hello');
  });

  it('MediaContent shape', () => {
    const m: MediaContent = {
      type: 'image',
      mediaType: 'image/png',
      data: 'base64...',
      sizeBytes: 1024,
    };
    expect(m.type).toBe('image');
  });

  it('AgentEventEnvelope shape', () => {
    const env: AgentEventEnvelope = {
      sessionKey: 's1',
      chatId: 'c1',
      channel: 'cli',
      event: { type: 'agent_start' },
      seq: 0,
    };
    expect(env.seq).toBe(0);
  });

  it('Channel interface is usable', () => {
    const ch: Channel = {
      name: 'cli',
      capabilities: FULL_CAP,
      async start() {},
      async stop() {},
      consume(_env) {},
    };
    expect(ch.name).toBe('cli');
  });

  it('MessageBus interface is usable', () => {
    const bus: MessageBus = {
      async publishInbound(_msg) {},
      async consumeInbound() { return {} as InboundMessage; },
      async publishOutbound(_env) {},
      async consumeOutbound() { return {} as AgentEventEnvelope; },
    };
    expect(bus).toBeDefined();
  });
});
