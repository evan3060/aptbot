import { describe, it, expect, vi, afterEach } from 'vitest';
import { createOpenaiCompletionsStream } from '../../../../src/core/provider/api/openai-completions.js';
import type { Model, Context } from '../../../../src/core/provider/types.js';

const MODEL: Model = {
  provider: 'custom',
  id: 'deepseek-v4-flash',
  api: 'openai-completions',
  contextWindow: 64000,
  maxTokens: 4096,
};

const CTX: Context = {
  systemPrompt: 'You are helpful.',
  messages: [{ role: 'user', content: 'hi' }],
};

function sseChunk(data: unknown): string {
  return `data: ${JSON.stringify(data)}\n\n`;
}

function doneChunk(): string {
  return 'data: [DONE]\n\n';
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

describe('openai-completions stream', () => {
  const origFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = origFetch;
  });

  it('parses text delta + finish_reason=stop', async () => {
    const chunks = [
      sseChunk({
        choices: [{ index: 0, delta: { role: 'assistant', content: 'Hello' }, finish_reason: null }],
      }),
      sseChunk({
        choices: [{ index: 0, delta: { content: ' world' }, finish_reason: null }],
      }),
      sseChunk({
        choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
      }),
      doneChunk(),
    ];
    globalThis.fetch = vi.fn().mockResolvedValue(makeSseResponse(chunks));

    const gen = createOpenaiCompletionsStream('http://localhost:3000/v1', 'sk-test', MODEL, CTX);
    const events = await collect(gen);

    const texts = events.filter((e) => e.type === 'text');
    expect(texts).toHaveLength(2);
    expect(texts[0].text).toBe('Hello');
    expect(texts[1].text).toBe(' world');

    const stops = events.filter((e) => e.type === 'stop');
    expect(stops).toHaveLength(1);
    expect(stops[0].stopReason).toBe('stop');
  });

  it('accumulates fragmented tool_call argument deltas into one complete tool_call', async () => {
    const chunks = [
      sseChunk({
        choices: [{
          index: 0,
          delta: {
            tool_calls: [{
              index: 0,
              id: 'call_abc',
              type: 'function',
              function: { name: 'bash', arguments: '' },
            }],
          },
          finish_reason: null,
        }],
      }),
      sseChunk({
        choices: [{
          index: 0,
          delta: {
            tool_calls: [{ index: 0, function: { arguments: '{"cmd":"ls' } }],
          },
          finish_reason: null,
        }],
      }),
      sseChunk({
        choices: [{
          index: 0,
          delta: {
            tool_calls: [{ index: 0, function: { arguments: '"}' } }],
          },
          finish_reason: null,
        }],
      }),
      sseChunk({
        choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }],
      }),
      doneChunk(),
    ];
    globalThis.fetch = vi.fn().mockResolvedValue(makeSseResponse(chunks));

    const gen = createOpenaiCompletionsStream('http://localhost:3000/v1', 'sk-test', MODEL, CTX);
    const events = await collect(gen);

    const toolCalls = events.filter((e) => e.type === 'tool_call');
    expect(toolCalls).toHaveLength(1);
    expect(toolCalls[0].toolCall?.id).toBe('call_abc');
    expect(toolCalls[0].toolCall?.name).toBe('bash');
    expect(toolCalls[0].toolCall?.arguments).toBe('{"cmd":"ls"}');

    const stops = events.filter((e) => e.type === 'stop');
    expect(stops).toHaveLength(1);
    expect(stops[0].stopReason).toBe('tool_calls');
  });

  it('sends request body with messages array and system prompt as first message', async () => {
    const captured: { url?: string; init?: RequestInit } = {};
    globalThis.fetch = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
      captured.url = url;
      captured.init = init;
      return makeSseResponse([
        sseChunk({ choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] }),
        doneChunk(),
      ]);
    });

    const gen = createOpenaiCompletionsStream('http://localhost:3000/v1', 'sk-test', MODEL, CTX);
    await collect(gen);

    expect(captured.url).toBe('http://localhost:3000/v1/chat/completions');
    const body = JSON.parse(String(captured.init?.body));
    expect(body.model).toBe('deepseek-v4-flash');
    expect(body.stream).toBe(true);
    // 系统提示应作为 messages[0] 的 system role
    expect(body.messages[0]).toEqual({ role: 'system', content: 'You are helpful.' });
    expect(body.messages[1]).toEqual({ role: 'user', content: 'hi' });
    // 授权头
    const headers = captured.init?.headers as Record<string, string>;
    expect(headers.authorization).toBe('Bearer sk-test');
  });

  it('ignores reasoning_content field (DeepSeek-specific)', async () => {
    const chunks = [
      sseChunk({
        choices: [{
          index: 0,
          delta: { role: 'assistant', content: null, reasoning_content: 'Thinking' },
          finish_reason: null,
        }],
      }),
      sseChunk({
        choices: [{
          index: 0,
          delta: { content: 'Final answer', reasoning_content: ' more thought' },
          finish_reason: null,
        }],
      }),
      sseChunk({
        choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
      }),
      doneChunk(),
    ];
    globalThis.fetch = vi.fn().mockResolvedValue(makeSseResponse(chunks));

    const gen = createOpenaiCompletionsStream('http://localhost:3000/v1', 'sk-test', MODEL, CTX);
    const events = await collect(gen);

    // 只应产生一个 text 事件（Final answer），reasoning_content 被忽略
    const texts = events.filter((e) => e.type === 'text');
    expect(texts).toHaveLength(1);
    expect(texts[0].text).toBe('Final answer');
  });

  it('includes tools in request body when context has tools', async () => {
    const captured: { init?: RequestInit } = {};
    globalThis.fetch = vi.fn().mockImplementation(async (_url: string, init?: RequestInit) => {
      captured.init = init;
      return makeSseResponse([
        sseChunk({ choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] }),
        doneChunk(),
      ]);
    });

    const ctxWithTools: Context = {
      systemPrompt: 'sys',
      messages: [{ role: 'user', content: 'run ls' }],
      tools: [{
        name: 'bash',
        description: 'Run bash',
        parameters: { type: 'object', properties: { cmd: { type: 'string' } } },
      }],
    };

    const gen = createOpenaiCompletionsStream('http://localhost:3000/v1', 'sk-test', MODEL, ctxWithTools);
    await collect(gen);

    const body = JSON.parse(String(captured.init?.body));
    expect(body.tools).toHaveLength(1);
    expect(body.tools[0]).toEqual({
      type: 'function',
      function: {
        name: 'bash',
        description: 'Run bash',
        parameters: { type: 'object', properties: { cmd: { type: 'string' } } },
      },
    });
  });

  it('flushes pending tool_calls on stop even without explicit done event', async () => {
    const chunks = [
      sseChunk({
        choices: [{
          index: 0,
          delta: {
            tool_calls: [{
              index: 0,
              id: 'call_xyz',
              type: 'function',
              function: { name: 'read', arguments: '{"path":"/a"}' },
            }],
          },
          finish_reason: null,
        }],
      }),
      // 直接 finish，无额外 done delta
      sseChunk({
        choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }],
      }),
      doneChunk(),
    ];
    globalThis.fetch = vi.fn().mockResolvedValue(makeSseResponse(chunks));

    const gen = createOpenaiCompletionsStream('http://localhost:3000/v1', 'sk-test', MODEL, CTX);
    const events = await collect(gen);

    const toolCalls = events.filter((e) => e.type === 'tool_call');
    expect(toolCalls).toHaveLength(1);
    expect(toolCalls[0].toolCall?.arguments).toBe('{"path":"/a"}');
  });

  // 回归测试：工具调用后的上下文必须正确格式化 assistant.tool_calls 和 tool.tool_call_id
  it('formats assistant tool_calls and tool tool_call_id in messages (tool-call roundtrip)', async () => {
    const captured: { init?: RequestInit } = {};
    globalThis.fetch = vi.fn().mockImplementation(async (_url: string, init?: RequestInit) => {
      captured.init = init;
      return makeSseResponse([
        sseChunk({ choices: [{ index: 0, delta: { content: 'The cwd is /home' }, finish_reason: null }] }),
        sseChunk({ choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] }),
        doneChunk(),
      ]);
    });

    // 模拟工具调用后的上下文：user → assistant(tool_calls) → tool(result)
    const ctxAfterToolCall: Context = {
      systemPrompt: 'sys',
      messages: [
        { role: 'user', content: 'what is the cwd?' },
        {
          role: 'assistant',
          content: '',
          toolCalls: [{ id: 'call_1', name: 'bash', arguments: '{"command":"pwd"}' }],
        },
        {
          role: 'tool',
          content: '/Users/evan/projects/aptbot',
          toolCallId: 'call_1',
        },
      ],
    };

    const gen = createOpenaiCompletionsStream('http://localhost:3000/v1', 'sk-test', MODEL, ctxAfterToolCall);
    await collect(gen);

    const body = JSON.parse(String(captured.init?.body));
    const msgs = body.messages;

    // messages[0] = system, [1] = user, [2] = assistant(tool_calls), [3] = tool
    expect(msgs[0]).toEqual({ role: 'system', content: 'sys' });
    expect(msgs[1]).toEqual({ role: 'user', content: 'what is the cwd?' });

    // assistant 消息必须带 tool_calls 字段（OpenAI 格式）
    expect(msgs[2].role).toBe('assistant');
    expect(msgs[2].tool_calls).toEqual([
      {
        id: 'call_1',
        type: 'function',
        function: { name: 'bash', arguments: '{"command":"pwd"}' },
      },
    ]);

    // tool 消息必须带 tool_call_id 字段
    expect(msgs[3].role).toBe('tool');
    expect(msgs[3].tool_call_id).toBe('call_1');
    expect(msgs[3].content).toBe('/Users/evan/projects/aptbot');
  });

  it('serializes ContentBlock[] tool result content to text string', async () => {
    const captured: { init?: RequestInit } = {};
    globalThis.fetch = vi.fn().mockImplementation(async (_url: string, init?: RequestInit) => {
      captured.init = init;
      return makeSseResponse([
        sseChunk({ choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] }),
        doneChunk(),
      ]);
    });

    const ctxWithBlockContent: Context = {
      systemPrompt: 'sys',
      messages: [
        { role: 'user', content: 'read file' },
        {
          role: 'assistant',
          content: '',
          toolCalls: [{ id: 'call_2', name: 'read', arguments: '{"path":"/a"}' }],
        },
        {
          role: 'tool',
          content: [{ type: 'text', text: 'file content here' }],
          toolCallId: 'call_2',
        },
      ],
    };

    const gen = createOpenaiCompletionsStream('http://localhost:3000/v1', 'sk-test', MODEL, ctxWithBlockContent);
    await collect(gen);

    const body = JSON.parse(String(captured.init?.body));
    const toolMsg = body.messages[3];
    expect(toolMsg.role).toBe('tool');
    expect(toolMsg.content).toBe('file content here');
  });
});
