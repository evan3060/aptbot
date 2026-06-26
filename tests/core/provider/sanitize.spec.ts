import { describe, it, expect } from 'vitest';
import { sanitizeContext } from '../../../src/core/provider/sanitize.js';
import type { Context, ContextMessage } from '../../../src/core/provider/types.js';

function ctx(messages: ContextMessage[]): Context {
  return { systemPrompt: 'sys', messages };
}

describe('sanitizeContext', () => {
  it('merges consecutive user messages', () => {
    const input = ctx([
      { role: 'user', content: 'hello' },
      { role: 'user', content: 'world' },
    ]);
    const out = sanitizeContext(input);
    expect(out.messages).toHaveLength(1);
    expect(out.messages[0].role).toBe('user');
    expect(out.messages[0].content).toBe('hello\nworld');
  });

  it('replaces empty string content with placeholder', () => {
    const input = ctx([{ role: 'user', content: '' }]);
    const out = sanitizeContext(input);
    expect(out.messages[0].content).toBe(' ');
  });

  it('replaces empty array content with placeholder', () => {
    const input = ctx([{ role: 'user', content: [] }]);
    const out = sanitizeContext(input);
    expect(out.messages[0].content).toBe(' ');
  });

  it('filters out tool messages without toolCallId', () => {
    const input = ctx([
      { role: 'user', content: 'hi' },
      { role: 'tool', content: 'result' } as ContextMessage,
    ]);
    const out = sanitizeContext(input);
    expect(out.messages).toHaveLength(1);
    expect(out.messages[0].role).toBe('user');
  });

  it('keeps tool messages with toolCallId', () => {
    const input = ctx([
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: 'ok', toolCalls: [{ id: 'tc1', name: 'bash', arguments: '{}' }] },
      { role: 'tool', content: 'result', toolCallId: 'tc1' },
    ]);
    const out = sanitizeContext(input);
    expect(out.messages).toHaveLength(3);
    expect(out.messages[2].toolCallId).toBe('tc1');
  });

  it('preserves messages that already alternate correctly', () => {
    const input = ctx([
      { role: 'user', content: 'q' },
      { role: 'assistant', content: 'a' },
    ]);
    const out = sanitizeContext(input);
    expect(out.messages).toHaveLength(2);
  });

  it('preserves systemPrompt', () => {
    const input: Context = { systemPrompt: 'my system', messages: [] };
    const out = sanitizeContext(input);
    expect(out.systemPrompt).toBe('my system');
  });

  it('preserves tools array', () => {
    const input: Context = {
      messages: [],
      tools: [{ name: 'bash', description: 'shell', parameters: {} }],
    };
    const out = sanitizeContext(input);
    expect(out.tools).toHaveLength(1);
  });
});
