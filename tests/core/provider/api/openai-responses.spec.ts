import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createOpenaiResponsesStream } from '../../../../src/core/provider/api/openai-responses.js';
import type { Model, Context } from '../../../../src/core/provider/types.js';

const MODEL: Model = {
  provider: 'openai',
  id: 'gpt-4',
  api: 'openai-responses',
  contextWindow: 128000,
  maxTokens: 4096,
};

const CTX: Context = {
  systemPrompt: 'sys',
  messages: [{ role: 'user', content: 'hi' }],
};

function sseChunk(data: unknown): string {
  return `data: ${JSON.stringify(data)}\n\n`;
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

describe('openai-responses stream', () => {
  const origFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = origFetch;
  });

  it('parses text + tool_call + stop events', async () => {
    const chunks = [
      sseChunk({ type: 'response.output_text.delta', delta: 'Hello' }),
      sseChunk({ type: 'response.output_text.delta', delta: ' world' }),
      sseChunk({
        type: 'response.function_call_arguments.delta',
        item_id: 'tc_1',
        name: 'bash',
        delta: '{"cmd":"ls"}',
      }),
      sseChunk({ type: 'response.completed', response: { status: 'completed' } }),
    ];
    globalThis.fetch = vi.fn().mockResolvedValue(makeSseResponse(chunks));

    const gen = createOpenaiResponsesStream('https://api.openai.com/v1', 'sk-test', MODEL, CTX);
    const events = await collect(gen);

    const texts = events.filter((e) => e.type === 'text');
    expect(texts).toHaveLength(2);
    expect(texts[0].text).toBe('Hello');
    expect(texts[1].text).toBe(' world');

    const toolCalls = events.filter((e) => e.type === 'tool_call');
    expect(toolCalls).toHaveLength(1);
    expect(toolCalls[0].toolCall?.name).toBe('bash');

    const stops = events.filter((e) => e.type === 'stop');
    expect(stops).toHaveLength(1);
  });

  it('throws fatal error on 401', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response('{"error":"unauthorized"}', { status: 401 }),
    );
    const gen = createOpenaiResponsesStream('https://api.openai.com/v1', 'sk-bad', MODEL, CTX);
    await expect(collect(gen)).rejects.toMatchObject({ retryable: false });
  });

  it('retries on 500 then fails', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response('{"error":"server"}', { status: 500 }),
    );
    const gen = createOpenaiResponsesStream('https://api.openai.com/v1', 'sk-test', MODEL, CTX, {
      signal: new AbortController().signal,
    });
    // Use short retry delays for test
    const events = collect(gen);
    await expect(events).rejects.toMatchObject({ retryable: true });
    expect(globalThis.fetch).toHaveBeenCalledTimes(3);
  });
});
