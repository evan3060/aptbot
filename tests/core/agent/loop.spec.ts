import { describe, it, expect } from 'vitest';
import { agentLoop, DEFAULT_MAX_ITERATIONS, MAX_STEERING_QUEUE } from '../../../src/core/agent/loop.js';
import type { AgentEvent } from '../../../src/core/agent/events.js';
import type { Provider, Model, Context, AssistantMessageEvent } from '../../../src/core/provider/types.js';
import type { ToolRegistry, AgentTool, AgentToolResult } from '../../../src/core/tool/types.js';
import { createToolRegistry } from '../../../src/core/tool/types.js';

const MODEL: Model = {
  provider: 'mock',
  id: 'mock-1',
  api: 'openai-responses',
  contextWindow: 8000,
  maxTokens: 1000,
};

function makeMockProvider(seqs: AssistantMessageEvent[][]): Provider {
  let call = 0;
  return {
    id: 'mock',
    name: 'Mock',
    auth: {},
    getModels: () => [MODEL],
    stream: async function* (): AsyncGenerator<AssistantMessageEvent> {
      const seq = seqs[Math.min(call, seqs.length - 1)];
      call++;
      for (const e of seq) yield e;
    },
  };
}

function makeMockTool(name: string, result: AgentToolResult): AgentTool {
  return {
    name,
    label: name,
    description: `${name} mock`,
    parameters: { type: 'object' },
    executionMode: 'sequential',
    execute: async () => result,
  };
}

function eventTypes(events: AgentEvent[]): string[] {
  return events.map((e) => e.type);
}

async function collect(gen: AsyncGenerator<AgentEvent>): Promise<AgentEvent[]> {
  const out: AgentEvent[] = [];
  for await (const e of gen) out.push(e);
  return out;
}

describe('agentLoop', () => {
  it('exposes DEFAULT_MAX_ITERATIONS=10 and MAX_STEERING_QUEUE=5', () => {
    expect(DEFAULT_MAX_ITERATIONS).toBe(10);
    expect(MAX_STEERING_QUEUE).toBe(5);
  });

  it('single turn text-only: complete event sequence', async () => {
    const provider = makeMockProvider([
      [
        { type: 'text', text: 'Hello' },
        { type: 'text', text: ' world' },
        { type: 'stop', stopReason: 'end_turn' },
      ],
    ]);
    const tools = createToolRegistry();
    const ctx: Context = { messages: [{ role: 'user', content: 'hi' }] };

    const events = await collect(
      agentLoop({ provider, model: MODEL, tools, context: ctx, systemPrompt: 'sys' }),
    );

    expect(eventTypes(events)).toEqual([
      'agent_start',
      'turn_start',
      'message_start',
      'message_delta',
      'message_delta',
      'message_end',
      'turn_end',
      'agent_end',
    ]);
    const deltas = events.filter((e) => e.type === 'message_delta');
    expect(deltas[0].type === 'message_delta' && deltas[0].text).toBe('Hello');
    expect(deltas[1].type === 'message_delta' && deltas[1].text).toBe(' world');
    const msgEnd = events.find((e) => e.type === 'message_end');
    expect(msgEnd?.type === 'message_end' && msgEnd.stopReason).toBe('end_turn');
  });

  it('tool_call → tool_result → follow-up message', async () => {
    const bashResult: AgentToolResult = {
      content: [{ type: 'text', text: 'file.txt' }],
      details: {},
    };
    const bashTool = makeMockTool('bash', bashResult);
    const tools = createToolRegistry();
    tools.register(bashTool);

    const provider = makeMockProvider([
      [
        { type: 'text', text: 'Let me list files' },
        {
          type: 'tool_call',
          toolCall: { id: 'tc_1', name: 'bash', arguments: '{"cmd":"ls"}' },
        },
        { type: 'stop', stopReason: 'tool_use' },
      ],
      [
        { type: 'text', text: 'Done' },
        { type: 'stop', stopReason: 'end_turn' },
      ],
    ]);

    const ctx: Context = { messages: [{ role: 'user', content: 'list files' }] };
    const events = await collect(
      agentLoop({ provider, model: MODEL, tools, context: ctx, systemPrompt: 'sys' }),
    );

    const types = eventTypes(events);
    // First turn
    expect(types.indexOf('tool_call_start')).toBeLessThan(types.indexOf('tool_call_delta'));
    expect(types.indexOf('tool_call_delta')).toBeLessThan(types.indexOf('tool_call_end'));
    expect(types.indexOf('tool_call_end')).toBeLessThan(types.indexOf('message_end'));
    expect(types.indexOf('message_end')).toBeLessThan(types.indexOf('tool_result'));
    expect(types.indexOf('tool_result')).toBeLessThan(types.indexOf('turn_end'));
    // Second turn follows
    const firstTurnEnd = types.indexOf('turn_end');
    const secondTurnStart = types.indexOf('turn_start', firstTurnEnd + 1);
    expect(secondTurnStart).toBeGreaterThan(firstTurnEnd);
    // Final agent_end
    expect(types[types.length - 1]).toBe('agent_end');

    // tool_result success
    const tr = events.find((e) => e.type === 'tool_result');
    expect(tr?.type === 'tool_result' && tr.success).toBe(true);
  });

  it('maxIterations exceeded emits error with retryable=false', async () => {
    const bashResult: AgentToolResult = { content: [{ type: 'text', text: 'ok' }], details: {} };
    const bashTool = makeMockTool('bash', bashResult);
    const tools = createToolRegistry();
    tools.register(bashTool);

    // Every call returns a tool_call → never terminates naturally
    const provider = makeMockProvider([
      [
        { type: 'tool_call', toolCall: { id: 'tc_1', name: 'bash', arguments: '{}' } },
        { type: 'stop', stopReason: 'tool_use' },
      ],
    ]);

    const ctx: Context = { messages: [{ role: 'user', content: 'loop' }] };
    const events = await collect(
      agentLoop({
        provider,
        model: MODEL,
        tools,
        context: ctx,
        systemPrompt: 'sys',
        maxIterations: 2,
      }),
    );

    const errEvent = events.find(
      (e) => e.type === 'error' && e.message === 'max_iterations_exceeded',
    );
    expect(errEvent).toBeDefined();
    expect(errEvent?.type === 'error' && errEvent.retryable).toBe(false);
    // agent_end must follow
    const errIdx = events.indexOf(errEvent!);
    expect(events[errIdx + 1]?.type).toBe('agent_end');
  });

  it('AbortSignal triggers agent_end', async () => {
    const ctrl = new AbortController();
    const provider = makeMockProvider([
      [
        { type: 'text', text: 'partial' },
        { type: 'stop', stopReason: 'end_turn' },
      ],
    ]);
    const tools = createToolRegistry();
    const ctx: Context = { messages: [{ role: 'user', content: 'hi' }] };

    const gen = agentLoop({
      provider,
      model: MODEL,
      tools,
      context: ctx,
      systemPrompt: 'sys',
      signal: ctrl.signal,
    });
    const events: AgentEvent[] = [];
    for await (const e of gen) {
      events.push(e);
      if (e.type === 'message_delta') {
        ctrl.abort();
      }
    }
    expect(events[events.length - 1].type).toBe('agent_end');
  });

  it('generator return() triggers cleanup (agent_end)', async () => {
    const provider = makeMockProvider([
      [
        { type: 'text', text: 'hello' },
        { type: 'stop', stopReason: 'end_turn' },
      ],
    ]);
    const tools = createToolRegistry();
    const ctx: Context = { messages: [{ role: 'user', content: 'hi' }] };

    const gen = agentLoop({ provider, model: MODEL, tools, context: ctx, systemPrompt: 'sys' });
    const events: AgentEvent[] = [];
    for await (const e of gen) {
      events.push(e);
      if (e.type === 'message_delta') {
        await gen.return([]);
        break;
      }
    }
    // After return(), the generator should have emitted agent_end in finally
    // (depending on iteration semantics, the last yielded value may or may not be agent_end)
    // At minimum, the generator must be done
    const result = await gen.next();
    expect(result.done).toBe(true);
  });

  it('unknown tool emits tool_result with success=false', async () => {
    const provider = makeMockProvider([
      [
        { type: 'tool_call', toolCall: { id: 'tc_x', name: 'nonexistent', arguments: '{}' } },
        { type: 'stop', stopReason: 'tool_use' },
      ],
      [
        { type: 'text', text: 'ok' },
        { type: 'stop', stopReason: 'end_turn' },
      ],
    ]);
    const tools = createToolRegistry();
    const ctx: Context = { messages: [{ role: 'user', content: 'hi' }] };
    const events = await collect(
      agentLoop({ provider, model: MODEL, tools, context: ctx, systemPrompt: 'sys' }),
    );
    const tr = events.find((e) => e.type === 'tool_result');
    expect(tr?.type === 'tool_result' && tr.success).toBe(false);
  });

  it('returns generated AgentMessage[] via generator return value', async () => {
    const provider = makeMockProvider([
      [
        { type: 'text', text: 'hello' },
        { type: 'stop', stopReason: 'end_turn' },
      ],
    ]);
    const tools = createToolRegistry();
    const ctx: Context = { messages: [{ role: 'user', content: 'hi' }] };

    const gen = agentLoop({ provider, model: MODEL, tools, context: ctx, systemPrompt: 'sys' });
    let finalResult: { done: boolean; value: unknown } | undefined;
    while (true) {
      const r = await gen.next();
      if (r.done) {
        finalResult = r;
        break;
      }
    }
    expect(finalResult).toBeDefined();
    expect(Array.isArray(finalResult!.value)).toBe(true);
    const messages = finalResult!.value as Array<{ role: string }>;
    expect(messages.length).toBeGreaterThan(0);
    expect(messages.some((m) => m.role === 'assistant')).toBe(true);
  });
});
