import { describe, it, expect, vi, afterEach } from 'vitest';
import { createAnthropicMessagesStream } from '../../../../src/core/provider/api/anthropic-messages.js';
import type { Model, Context } from '../../../../src/core/provider/types.js';

const MODEL: Model = {
  provider: 'anthropic',
  id: 'claude-3-5-sonnet-20241022',
  api: 'anthropic-messages',
  contextWindow: 200000,
  maxTokens: 8192,
};

const CTX: Context = {
  systemPrompt: 'sys',
  messages: [{ role: 'user', content: 'hi' }],
};

function sseChunk(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

function makeSseResponse(chunks: string[]): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      for (const c of chunks) controller.enqueue(encoder.encode(c));
      controller.close();
    },
  });
  return new Response(stream, {
    status: 200,
    headers: { 'content-type': 'text/event-stream' },
  });
}

async function collect<T>(gen: AsyncGenerator<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const item of gen) out.push(item);
  return out;
}

describe('anthropic-messages stream', () => {
  const origFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = origFetch;
  });

  it('parses content_block_delta + tool_use + message_stop', async () => {
    const chunks = [
      sseChunk('content_block_delta', { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Hello' } }),
      sseChunk('content_block_delta', { type: 'content_block_delta', delta: { type: 'text_delta', text: ' world' } }),
      sseChunk('content_block_start', {
        type: 'content_block_start',
        index: 1,
        content_block: { type: 'tool_use', id: 'tu_1', name: 'bash', input: {} },
      }),
      sseChunk('content_block_delta', {
        type: 'content_block_delta',
        index: 1,
        delta: { type: 'input_json_delta', partial_json: '{"cmd":"ls"}' },
      }),
      sseChunk('message_stop', { type: 'message_stop' }),
    ];
    globalThis.fetch = vi.fn().mockResolvedValue(makeSseResponse(chunks));

    const gen = createAnthropicMessagesStream('https://api.anthropic.com/v1', 'sk-test', MODEL, CTX);
    const events = await collect(gen);

    const texts = events.filter((e) => e.type === 'text');
    expect(texts).toHaveLength(2);
    expect(texts[0].text).toBe('Hello');

    const stops = events.filter((e) => e.type === 'stop');
    expect(stops).toHaveLength(1);
  });

  it('throws fatal error on 401', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response('{"error":"unauthorized"}', { status: 401 }),
    );
    const gen = createAnthropicMessagesStream('https://api.anthropic.com/v1', 'sk-bad', MODEL, CTX);
    await expect(collect(gen)).rejects.toMatchObject({ retryable: false });
  });

  it('retries on 429 then fails', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response('{"error":"rate"}', { status: 429 }),
    );
    const gen = createAnthropicMessagesStream('https://api.anthropic.com/v1', 'sk-test', MODEL, CTX);
    await expect(collect(gen)).rejects.toMatchObject({ retryable: true });
    expect(globalThis.fetch).toHaveBeenCalledTimes(3);
  });
});
