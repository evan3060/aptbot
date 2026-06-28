import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  ModelRegistry,
  createProvider,
  openaiProvider,
  anthropicProvider,
  deepseekProvider,
} from '../../../src/core/provider/models.js';
import type { ProviderDeclaration } from '../../../src/core/provider/models.js';

describe('provider declarations', () => {
  it('openaiProvider has id openai and uses OPENAI_API_KEY env var', () => {
    expect(openaiProvider.id).toBe('openai');
    expect(openaiProvider.auth.envVar).toBe('OPENAI_API_KEY');
    expect(openaiProvider.models.length).toBeGreaterThan(0);
  });

  it('anthropicProvider has id anthropic and uses ANTHROPIC_API_KEY env var', () => {
    expect(anthropicProvider.id).toBe('anthropic');
    expect(anthropicProvider.auth.envVar).toBe('ANTHROPIC_API_KEY');
    expect(anthropicProvider.models.length).toBeGreaterThan(0);
  });

  it('deepseekProvider has id deepseek and reuses openai-responses api', () => {
    expect(deepseekProvider.id).toBe('deepseek');
    expect(deepseekProvider.models.every((m) => m.api === 'openai-responses')).toBe(true);
  });

  it('each model carries provider field matching declaration id', () => {
    for (const m of openaiProvider.models) expect(m.provider).toBe('openai');
    for (const m of anthropicProvider.models) expect(m.provider).toBe('anthropic');
    for (const m of deepseekProvider.models) expect(m.provider).toBe('deepseek');
  });
});

describe('ModelRegistry', () => {
  const registry = new ModelRegistry([
    openaiProvider,
    anthropicProvider,
    deepseekProvider,
  ]);

  it('findModel(gpt-4) returns openai provider', () => {
    const found = registry.findModel('gpt-4');
    expect(found).toBeDefined();
    expect(found?.provider.id).toBe('openai');
    expect(found?.model.id).toBe('gpt-4');
  });

  it('findModel(claude-3) returns anthropic provider', () => {
    const found = registry.findModel('claude-3');
    expect(found).toBeDefined();
    expect(found?.provider.id).toBe('anthropic');
  });

  it('findModel(deepseek-chat) returns deepseek provider', () => {
    const found = registry.findModel('deepseek-chat');
    expect(found).toBeDefined();
    expect(found?.provider.id).toBe('deepseek');
  });

  it('findModel returns undefined for unknown model', () => {
    expect(registry.findModel('unknown-model')).toBeUndefined();
  });

  it('listModels returns every model across all providers', () => {
    const all = registry.listModels();
    expect(all.length).toBe(
      openaiProvider.models.length +
        anthropicProvider.models.length +
        deepseekProvider.models.length,
    );
    expect(all.some((m) => m.provider.id === 'openai')).toBe(true);
    expect(all.some((m) => m.provider.id === 'anthropic')).toBe(true);
    expect(all.some((m) => m.provider.id === 'deepseek')).toBe(true);
  });

  it('findModel uses first-match-wins when duplicate ids exist', () => {
    const first: ProviderDeclaration = {
      id: 'first',
      name: 'First',
      auth: { envVar: 'FIRST_API_KEY' },
      models: [
        {
          provider: 'first',
          id: 'shared',
          api: 'openai-responses',
          contextWindow: 4000,
          maxTokens: 500,
        },
      ],
    };
    const dup: ProviderDeclaration = {
      id: 'dup',
      name: 'Dup',
      auth: { envVar: 'DUP_API_KEY' },
      models: [
        {
          provider: 'dup',
          id: 'shared',
          api: 'openai-responses',
          contextWindow: 8000,
          maxTokens: 1000,
        },
      ],
    };
    const r = new ModelRegistry([first, dup]);
    const found = r.findModel('shared');
    expect(found?.provider.id).toBe('first');
  });
});

describe('createProvider', () => {
  const origFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = origFetch;
  });

  it('returns Provider exposing id, name, auth and models from declaration', () => {
    const provider = createProvider(openaiProvider, 'sk-test');
    expect(provider.id).toBe('openai');
    expect(provider.name).toBe('OpenAI');
    expect(provider.auth.apiKey).toBe('sk-test');
    expect(provider.auth.envVar).toBe('OPENAI_API_KEY');
    expect(provider.getModels().length).toBe(openaiProvider.models.length);
  });

  it('stream() delegates to openai-responses factory using declaration baseUrl', async () => {
    const calls: string[] = [];
    globalThis.fetch = vi.fn(async (url: string | URL | Request) => {
      calls.push(String(url));
      const encoder = new TextEncoder();
      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({ type: 'response.output_text.delta', delta: 'hi' })}\n\n`,
            ),
          );
          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({ type: 'response.completed' })}\n\n`,
            ),
          );
          controller.close();
        },
      });
      return new Response(stream, {
        status: 200,
        headers: { 'content-type': 'text/event-stream' },
      });
    });

    const provider = createProvider(openaiProvider, 'sk-test');
    const gpt4 = openaiProvider.models.find((m) => m.id === 'gpt-4')!;
    const events = [];
    for await (const ev of provider.stream(
      gpt4,
      { messages: [{ role: 'user', content: 'hi' }] },
    )) {
      events.push(ev);
      if (ev.type === 'stop') break;
    }
    expect(events.some((e) => e.type === 'text')).toBe(true);
    expect(events.some((e) => e.type === 'stop')).toBe(true);
    expect(calls[0]).toContain('api.openai.com');
    // OpenAI uses Bearer authorization
    expect(((globalThis.fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls[0][1] as { headers: Record<string, string> }).headers.authorization).toBe(
      'Bearer sk-test',
    );
  });

  it('createProvider for anthropic delegates to anthropic-messages factory', async () => {
    const calls: string[] = [];
    globalThis.fetch = vi.fn(async (url: string | URL | Request) => {
      calls.push(String(url));
      const encoder = new TextEncoder();
      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(
            encoder.encode(
              `event: content_block_delta\ndata: ${JSON.stringify({
                type: 'content_block_delta',
                delta: { type: 'text_delta', text: 'hi' },
              })}\n\n`,
            ),
          );
          controller.enqueue(
            encoder.encode(
              `event: message_stop\ndata: ${JSON.stringify({ type: 'message_stop' })}\n\n`,
            ),
          );
          controller.close();
        },
      });
      return new Response(stream, {
        status: 200,
        headers: { 'content-type': 'text/event-stream' },
      });
    });

    const provider = createProvider(anthropicProvider, 'ant-test');
    const claude = anthropicProvider.models.find((m) => m.id === 'claude-3')!;
    const events = [];
    for await (const ev of provider.stream(
      claude,
      { messages: [{ role: 'user', content: 'hi' }] },
    )) {
      events.push(ev);
      if (ev.type === 'stop') break;
    }
    expect(events.some((e) => e.type === 'text')).toBe(true);
    expect(calls[0]).toContain('api.anthropic.com');
    const headers = ((globalThis.fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls[0][1] as { headers: Record<string, string> }).headers;
    expect(headers['x-api-key']).toBe('ant-test');
    expect(headers['anthropic-version']).toBe('2023-06-01');
  });

  it('createProvider for deepseek uses openai-responses stream (Bearer auth, deepseek baseUrl)', async () => {
    const calls: string[] = [];
    globalThis.fetch = vi.fn(async (url: string | URL | Request) => {
      calls.push(String(url));
      const encoder = new TextEncoder();
      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({ type: 'response.output_text.delta', delta: 'hi' })}\n\n`,
            ),
          );
          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({ type: 'response.completed' })}\n\n`,
            ),
          );
          controller.close();
        },
      });
      return new Response(stream, {
        status: 200,
        headers: { 'content-type': 'text/event-stream' },
      });
    });

    const provider = createProvider(deepseekProvider, 'ds-test');
    const model = deepseekProvider.models[0];
    const events = [];
    for await (const ev of provider.stream(
      model,
      { messages: [{ role: 'user', content: 'hi' }] },
    )) {
      events.push(ev);
      if (ev.type === 'stop') break;
    }
    expect(events.some((e) => e.type === 'text')).toBe(true);
    expect(calls[0]).toContain('api.deepseek.com');
    const headers = ((globalThis.fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls[0][1] as { headers: Record<string, string> }).headers;
    expect(headers.authorization).toBe('Bearer ds-test');
  });
});
