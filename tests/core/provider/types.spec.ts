import { describe, it, expect } from 'vitest';
import type {
  Provider,
  Model,
  Context,
  ContextMessage,
  ToolDefinition,
  AssistantMessageEvent,
  StreamOptions,
} from '../../../src/core/provider/types.js';
import type { ContentBlock } from '../../../src/core/memory/agent-message.js';

describe('provider types', () => {
  it('can construct a ToolDefinition', () => {
    const td: ToolDefinition = {
      name: 'bash',
      description: 'execute shell command',
      parameters: { type: 'object', properties: {} },
    };
    expect(td.name).toBe('bash');
  });

  it('can construct ContextMessage with string content', () => {
    const msg: ContextMessage = {
      role: 'user',
      content: 'hello',
    };
    expect(msg.role).toBe('user');
    expect(msg.content).toBe('hello');
  });

  it('can construct ContextMessage with ContentBlock array', () => {
    const blocks: ContentBlock[] = [{ type: 'text', text: 'hi' }];
    const msg: ContextMessage = {
      role: 'assistant',
      content: blocks,
      toolCalls: [{ id: 'tc1', name: 'bash', arguments: '{}' }],
    };
    expect(Array.isArray(msg.content)).toBe(true);
    expect(msg.toolCalls).toHaveLength(1);
  });

  it('can construct Context with systemPrompt and messages', () => {
    const ctx: Context = {
      systemPrompt: 'you are a helpful assistant',
      messages: [{ role: 'user', content: 'hi' }],
      tools: [{ name: 'bash', description: 'shell', parameters: {} }],
    };
    expect(ctx.systemPrompt).toBe('you are a helpful assistant');
    expect(ctx.messages).toHaveLength(1);
    expect(ctx.tools).toHaveLength(1);
  });

  it('can construct text AssistantMessageEvent', () => {
    const e: AssistantMessageEvent = { type: 'text', text: 'hello' };
    expect(e.type).toBe('text');
  });

  it('can construct tool_call AssistantMessageEvent', () => {
    const e: AssistantMessageEvent = {
      type: 'tool_call',
      toolCall: { id: 'tc1', name: 'bash', arguments: '{}' },
    };
    expect(e.type).toBe('tool_call');
  });

  it('can construct stop AssistantMessageEvent', () => {
    const e: AssistantMessageEvent = { type: 'stop', stopReason: 'end_turn' };
    expect(e.type).toBe('stop');
  });

  it('can construct error AssistantMessageEvent', () => {
    const e: AssistantMessageEvent = {
      type: 'error',
      error: { message: 'rate limited', retryable: true, status: 429 },
    };
    expect(e.type).toBe('error');
  });

  it('can construct StreamOptions with signal', () => {
    const ctrl = new AbortController();
    const opts: StreamOptions = {
      temperature: 0.7,
      maxTokens: 1024,
      signal: ctrl.signal,
    };
    expect(opts.temperature).toBe(0.7);
    expect(opts.maxTokens).toBe(1024);
  });

  it('can construct Model', () => {
    const m: Model = {
      provider: 'openai',
      id: 'gpt-4',
      api: 'openai-responses',
      contextWindow: 128000,
      maxTokens: 4096,
    };
    expect(m.id).toBe('gpt-4');
    expect(m.api).toBe('openai-responses');
  });

  it('can construct Provider interface shape', () => {
    const provider: Provider = {
      id: 'openai',
      name: 'OpenAI',
      auth: { envVar: 'OPENAI_API_KEY' },
      getModels: () => [],
      async *stream() {
        yield { type: 'stop', stopReason: 'end_turn' };
      },
    };
    expect(provider.id).toBe('openai');
    expect(provider.getModels()).toEqual([]);
  });
});
