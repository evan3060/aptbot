import { describe, it, expect } from 'vitest';
import {
  createMessage,
  type AgentMessage,
  type MessageRole,
  type ContentBlock,
  type ToolCall,
  type TextContent,
  type ImageContent,
} from '../../../src/core/memory/agent-message.js';

describe('agent-message', () => {
  it('createMessage assigns UUID id matching UUID v4 format', () => {
    const m = createMessage('user', 'hello');
    expect(m.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
  });

  it('createMessage assigns integer timestamp in milliseconds', () => {
    const before = Date.now();
    const m = createMessage('user', 'hello');
    const after = Date.now();
    expect(Number.isInteger(m.timestamp)).toBe(true);
    expect(m.timestamp).toBeGreaterThanOrEqual(before);
    expect(m.timestamp).toBeLessThanOrEqual(after);
  });

  it('createMessage preserves role', () => {
    expect(createMessage('user', 'x').role).toBe('user');
    expect(createMessage('assistant', 'y').role).toBe('assistant');
    expect(createMessage('tool', 'z').role).toBe('tool');
  });

  it('createMessage accepts string content', () => {
    const m = createMessage('user', 'plain text');
    expect(m.content).toBe('plain text');
  });

  it('createMessage accepts ContentBlock array', () => {
    const blocks: ContentBlock[] = [
      { type: 'text', text: 'a' },
      { type: 'image', source: { type: 'base64', mediaType: 'image/png', data: 'xxx' } },
    ];
    const m = createMessage('user', blocks);
    expect(Array.isArray(m.content)).toBe(true);
    expect((m.content as ContentBlock[])[0].type).toBe('text');
    expect((m.content as ContentBlock[])[1].type).toBe('image');
  });

  it('createMessage generates unique ids', () => {
    const a = createMessage('user', 'a');
    const b = createMessage('user', 'b');
    expect(a.id).not.toBe(b.id);
  });
});
