import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  HookRegistry,
  hooks as globalHooks,
  DEFAULT_HOOK_PRIORITY,
} from '../../../src/core/agent/hooks.js';
import type { HookPoint } from '../../../src/core/agent/hooks.js';
import { agentLoop } from '../../../src/core/agent/loop.js';
import type { AgentEvent } from '../../../src/core/agent/events.js';
import type {
  Provider,
  Model,
  Context,
  AssistantMessageEvent,
} from '../../../src/core/provider/types.js';
import type { AgentTool, AgentToolResult } from '../../../src/core/tool/types.js';
import { createToolRegistry } from '../../../src/core/tool/types.js';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

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

async function collect(gen: AsyncGenerator<AgentEvent>): Promise<AgentEvent[]> {
  const out: AgentEvent[] = [];
  for await (const e of gen) out.push(e);
  return out;
}

const ALL_HOOK_POINTS: HookPoint[] = [
  'agent_before',
  'agent_after',
  'turn_before',
  'turn_after',
  'llm_before',
  'llm_after',
  'tool_before',
  'tool_after',
];

describe('HookRegistry', () => {
  it('exposes DEFAULT_HOOK_PRIORITY=100', () => {
    expect(DEFAULT_HOOK_PRIORITY).toBe(100);
  });

  it('executes hooks in ascending priority order', () => {
    const reg = new HookRegistry();
    const order: number[] = [];
    reg.on('agent_before', () => {
      order.push(30);
    }, 30);
    reg.on('agent_before', () => {
      order.push(10);
    }, 10);
    reg.on('agent_before', () => {
      order.push(20);
    }, 20);
    reg.trigger('agent_before', { messages: [], systemPrompt: '' });
    expect(order).toEqual([10, 20, 30]);
  });

  it('multiple hooks with same priority execute in registration order', () => {
    const reg = new HookRegistry();
    const order: string[] = [];
    reg.on('agent_before', () => {
      order.push('first');
    }, 50);
    reg.on('agent_before', () => {
      order.push('second');
    }, 50);
    reg.on('agent_before', () => {
      order.push('third');
    }, 50);
    reg.trigger('agent_before', { messages: [], systemPrompt: '' });
    expect(order).toEqual(['first', 'second', 'third']);
  });

  it('uses default priority 100 when not specified', () => {
    const reg = new HookRegistry();
    const order: string[] = [];
    reg.on('agent_before', () => {
      order.push('default');
    });
    reg.on('agent_before', () => {
      order.push('early');
    }, 10);
    reg.trigger('agent_before', { messages: [], systemPrompt: '' });
    expect(order).toEqual(['early', 'default']);
  });

  it('swallows hook exceptions and continues main flow', () => {
    const reg = new HookRegistry();
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const order: string[] = [];
    reg.on('agent_before', () => {
      throw new Error('boom');
    });
    reg.on('agent_before', () => {
      order.push('after-error');
    });
    expect(() =>
      reg.trigger('agent_before', { messages: [], systemPrompt: '' }),
    ).not.toThrow();
    expect(order).toEqual(['after-error']);
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it('unregister via returned off() stops hook from being called', () => {
    const reg = new HookRegistry();
    const calls: string[] = [];
    const off = reg.on('agent_before', () => {
      calls.push('called');
    });
    reg.trigger('agent_before', { messages: [], systemPrompt: '' });
    expect(calls).toEqual(['called']);
    off();
    reg.trigger('agent_before', { messages: [], systemPrompt: '' });
    expect(calls).toEqual(['called']);
  });

  it('off() directly removes hook by function reference', () => {
    const reg = new HookRegistry();
    const calls: string[] = [];
    const fn = () => {
      calls.push('called');
    };
    reg.on('agent_before', fn);
    reg.trigger('agent_before', { messages: [], systemPrompt: '' });
    expect(calls.length).toBe(1);
    reg.off('agent_before', fn);
    reg.trigger('agent_before', { messages: [], systemPrompt: '' });
    expect(calls.length).toBe(1);
  });

  it('ctx mutations chain to subsequent hooks', () => {
    const reg = new HookRegistry();
    const seen: string[] = [];
    reg.on('agent_before', (ctx) => {
      return { ...ctx, systemPrompt: ctx.systemPrompt + ' -> A' };
    });
    reg.on('agent_before', (ctx) => {
      seen.push(ctx.systemPrompt);
      return { ...ctx, systemPrompt: ctx.systemPrompt + ' -> B' };
    });
    reg.on('agent_before', (ctx) => {
      seen.push(ctx.systemPrompt);
    });
    const result = reg.trigger('agent_before', {
      messages: [],
      systemPrompt: 'init',
    });
    expect(seen).toEqual(['init -> A', 'init -> A -> B']);
    expect(result.systemPrompt).toBe('init -> A -> B');
  });

  it('hook returning void does not mutate ctx', () => {
    const reg = new HookRegistry();
    let observed: string | undefined;
    reg.on('agent_before', () => {
      /* no return */
    });
    reg.on('agent_before', (ctx) => {
      observed = ctx.systemPrompt;
    });
    reg.trigger('agent_before', {
      messages: [],
      systemPrompt: 'original',
    });
    expect(observed).toBe('original');
  });

  it('trigger with no registered hooks returns ctx unchanged', () => {
    const reg = new HookRegistry();
    const ctx = { messages: [], systemPrompt: 'test' };
    const result = reg.trigger('agent_before', ctx);
    expect(result).toBe(ctx);
  });

  it('has() reports registered events', () => {
    const reg = new HookRegistry();
    expect(reg.has('agent_before')).toBe(false);
    reg.on('agent_before', () => {});
    expect(reg.has('agent_before')).toBe(true);
    expect(reg.has('agent_after')).toBe(false);
  });

  it('clear() removes all hooks', () => {
    const reg = new HookRegistry();
    reg.on('agent_before', () => {});
    reg.on('turn_after', () => {});
    reg.clear();
    expect(reg.has('agent_before')).toBe(false);
    expect(reg.has('turn_after')).toBe(false);
  });

  it('clear(event) removes only specified event hooks', () => {
    const reg = new HookRegistry();
    reg.on('agent_before', () => {});
    reg.on('turn_after', () => {});
    reg.clear('agent_before');
    expect(reg.has('agent_before')).toBe(false);
    expect(reg.has('turn_after')).toBe(true);
  });
});

describe('agentLoop hooks integration', () => {
  it('triggers all 8 hook points during agentLoop execution', async () => {
    const reg = new HookRegistry();
    const fired: HookPoint[] = [];
    for (const point of ALL_HOOK_POINTS) {
      reg.on(point, () => {
        fired.push(point);
      });
    }

    const bashResult: AgentToolResult = {
      content: [{ type: 'text', text: 'ok' }],
      details: {},
    };
    const bashTool = makeMockTool('bash', bashResult);
    const tools = createToolRegistry();
    tools.register(bashTool);

    const provider = makeMockProvider([
      [
        {
          type: 'tool_call',
          toolCall: { id: 'tc_1', name: 'bash', arguments: '{}' },
        },
        { type: 'stop', stopReason: 'tool_use' },
      ],
      [
        { type: 'text', text: 'Done' },
        { type: 'stop', stopReason: 'end_turn' },
      ],
    ]);

    const ctx: Context = { messages: [{ role: 'user', content: 'hi' }] };
    await collect(
      agentLoop({
        provider,
        model: MODEL,
        tools,
        context: ctx,
        systemPrompt: 'sys',
        hooks: reg,
      }),
    );

    expect(new Set(fired)).toEqual(new Set(ALL_HOOK_POINTS));
  });

  it('hook exceptions do not break agentLoop main flow', async () => {
    const reg = new HookRegistry();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    reg.on('llm_before', () => {
      throw new Error('hook boom');
    });
    reg.on('tool_before', () => {
      throw new Error('hook boom');
    });
    reg.on('turn_before', () => {
      throw new Error('hook boom');
    });

    const bashResult: AgentToolResult = {
      content: [{ type: 'text', text: 'ok' }],
      details: {},
    };
    const bashTool = makeMockTool('bash', bashResult);
    const tools = createToolRegistry();
    tools.register(bashTool);

    const provider = makeMockProvider([
      [
        {
          type: 'tool_call',
          toolCall: { id: 'tc_1', name: 'bash', arguments: '{}' },
        },
        { type: 'stop', stopReason: 'tool_use' },
      ],
      [
        { type: 'text', text: 'Done' },
        { type: 'stop', stopReason: 'end_turn' },
      ],
    ]);

    const ctx: Context = { messages: [{ role: 'user', content: 'hi' }] };
    const events = await collect(
      agentLoop({
        provider,
        model: MODEL,
        tools,
        context: ctx,
        systemPrompt: 'sys',
        hooks: reg,
      }),
    );
    expect(events[events.length - 1].type).toBe('agent_end');
    vi.restoreAllMocks();
  });

  it('agent_before/after fire exactly once', async () => {
    const reg = new HookRegistry();
    const counts: Record<string, number> = {};
    (['agent_before', 'agent_after'] as HookPoint[]).forEach((p) => {
      reg.on(p, () => {
        counts[p] = (counts[p] ?? 0) + 1;
      });
    });

    const provider = makeMockProvider([
      [
        { type: 'text', text: 'hi' },
        { type: 'stop', stopReason: 'end_turn' },
      ],
    ]);
    const ctx: Context = { messages: [{ role: 'user', content: 'hi' }] };
    await collect(
      agentLoop({
        provider,
        model: MODEL,
        tools: createToolRegistry(),
        context: ctx,
        systemPrompt: 'sys',
        hooks: reg,
      }),
    );

    expect(counts.agent_before).toBe(1);
    expect(counts.agent_after).toBe(1);
  });

  it('turn_before/after and llm_before/after fire once per turn', async () => {
    const reg = new HookRegistry();
    const counts: Record<string, number> = {};
    (['turn_before', 'turn_after', 'llm_before', 'llm_after'] as HookPoint[]).forEach(
      (p) => {
        reg.on(p, () => {
          counts[p] = (counts[p] ?? 0) + 1;
        });
      },
    );

    const bashResult: AgentToolResult = {
      content: [{ type: 'text', text: 'ok' }],
      details: {},
    };
    const bashTool = makeMockTool('bash', bashResult);
    const tools = createToolRegistry();
    tools.register(bashTool);

    const provider = makeMockProvider([
      [
        {
          type: 'tool_call',
          toolCall: { id: 'tc_1', name: 'bash', arguments: '{}' },
        },
        { type: 'stop', stopReason: 'tool_use' },
      ],
      [
        { type: 'text', text: 'Done' },
        { type: 'stop', stopReason: 'end_turn' },
      ],
    ]);

    const ctx: Context = { messages: [{ role: 'user', content: 'hi' }] };
    await collect(
      agentLoop({
        provider,
        model: MODEL,
        tools,
        context: ctx,
        systemPrompt: 'sys',
        hooks: reg,
      }),
    );

    // Two turns total
    expect(counts.turn_before).toBe(2);
    expect(counts.turn_after).toBe(2);
    expect(counts.llm_before).toBe(2);
    expect(counts.llm_after).toBe(2);
  });

  it('llm_before can mutate messages passed to provider', async () => {
    const reg = new HookRegistry();
    const seenMessageCounts: number[] = [];
    const provider: Provider = {
      id: 'mock',
      name: 'Mock',
      auth: {},
      getModels: () => [MODEL],
      stream: async function* (_model, context) {
        seenMessageCounts.push(context.messages.length);
        yield { type: 'text', text: 'ok' };
        yield { type: 'stop', stopReason: 'end_turn' };
      },
    };

    reg.on('llm_before', (ctx) => {
      return {
        ...ctx,
        messages: [
          ...ctx.messages,
          { role: 'assistant' as const, content: 'injected' },
        ],
      };
    });

    const ctx: Context = { messages: [{ role: 'user', content: 'hi' }] };
    await collect(
      agentLoop({
        provider,
        model: MODEL,
        tools: createToolRegistry(),
        context: ctx,
        systemPrompt: 'sys',
        hooks: reg,
      }),
    );

    expect(seenMessageCounts[0]).toBe(2);
  });

  it('tool_before receives toolName and parsed args', async () => {
    const reg = new HookRegistry();
    const toolCalls: { name: string; args: unknown }[] = [];
    reg.on('tool_before', (ctx) => {
      toolCalls.push({ name: ctx.toolName, args: ctx.args });
    });

    const bashResult: AgentToolResult = {
      content: [{ type: 'text', text: 'ok' }],
      details: {},
    };
    const bashTool = makeMockTool('bash', bashResult);
    const tools = createToolRegistry();
    tools.register(bashTool);

    const provider = makeMockProvider([
      [
        {
          type: 'tool_call',
          toolCall: { id: 'tc_1', name: 'bash', arguments: '{"cmd":"ls"}' },
        },
        { type: 'stop', stopReason: 'tool_use' },
      ],
      [
        { type: 'text', text: 'done' },
        { type: 'stop', stopReason: 'end_turn' },
      ],
    ]);

    const ctx: Context = { messages: [{ role: 'user', content: 'hi' }] };
    await collect(
      agentLoop({
        provider,
        model: MODEL,
        tools,
        context: ctx,
        systemPrompt: 'sys',
        hooks: reg,
      }),
    );

    expect(toolCalls.length).toBe(1);
    expect(toolCalls[0].name).toBe('bash');
    expect(toolCalls[0].args).toEqual({ cmd: 'ls' });
  });

  it('tool_after receives result and latencyMs', async () => {
    const reg = new HookRegistry();
    let afterResult: AgentToolResult | null = null;
    let afterLatency: number | null = null;
    reg.on('tool_after', (ctx) => {
      afterResult = ctx.result;
      afterLatency = ctx.latencyMs;
    });

    const bashResult: AgentToolResult = {
      content: [{ type: 'text', text: 'ok' }],
      details: {},
    };
    const bashTool = makeMockTool('bash', bashResult);
    const tools = createToolRegistry();
    tools.register(bashTool);

    const provider = makeMockProvider([
      [
        {
          type: 'tool_call',
          toolCall: { id: 'tc_1', name: 'bash', arguments: '{}' },
        },
        { type: 'stop', stopReason: 'tool_use' },
      ],
      [
        { type: 'text', text: 'done' },
        { type: 'stop', stopReason: 'end_turn' },
      ],
    ]);

    const ctx: Context = { messages: [{ role: 'user', content: 'hi' }] };
    await collect(
      agentLoop({
        provider,
        model: MODEL,
        tools,
        context: ctx,
        systemPrompt: 'sys',
        hooks: reg,
      }),
    );

    expect(afterResult).not.toBeNull();
    expect(afterLatency).not.toBeNull();
    expect(afterLatency!).toBeGreaterThanOrEqual(0);
  });

  it('hook ctx receives session info when provided', async () => {
    const reg = new HookRegistry();
    const seenSessions: string[] = [];
    reg.on('agent_before', (ctx) => {
      if (ctx.session) seenSessions.push(ctx.session.sessionId);
    });
    reg.on('tool_before', (ctx) => {
      if (ctx.session) seenSessions.push(ctx.session.sessionId);
    });

    const bashResult: AgentToolResult = {
      content: [{ type: 'text', text: 'ok' }],
      details: {},
    };
    const bashTool = makeMockTool('bash', bashResult);
    const tools = createToolRegistry();
    tools.register(bashTool);

    const provider = makeMockProvider([
      [
        {
          type: 'tool_call',
          toolCall: { id: 'tc_1', name: 'bash', arguments: '{}' },
        },
        { type: 'stop', stopReason: 'tool_use' },
      ],
      [
        { type: 'text', text: 'done' },
        { type: 'stop', stopReason: 'end_turn' },
      ],
    ]);

    const ctx: Context = { messages: [{ role: 'user', content: 'hi' }] };
    await collect(
      agentLoop({
        provider,
        model: MODEL,
        tools,
        context: ctx,
        systemPrompt: 'sys',
        hooks: reg,
        session: { sessionId: 'test-session-123' },
      }),
    );

    expect(seenSessions).toContain('test-session-123');
  });

  it('agent_after receives exitReason end_turn on natural completion', async () => {
    const reg = new HookRegistry();
    let exitReason: string | null = null;
    reg.on('agent_after', (ctx) => {
      exitReason = ctx.exitReason;
    });

    const provider = makeMockProvider([
      [
        { type: 'text', text: 'hi' },
        { type: 'stop', stopReason: 'end_turn' },
      ],
    ]);
    const ctx: Context = { messages: [{ role: 'user', content: 'hi' }] };
    await collect(
      agentLoop({
        provider,
        model: MODEL,
        tools: createToolRegistry(),
        context: ctx,
        systemPrompt: 'sys',
        hooks: reg,
      }),
    );

    expect(exitReason).toBe('end_turn');
  });

  it('agent_after receives exitReason max_iterations_exceeded', async () => {
    const reg = new HookRegistry();
    let exitReason: string | null = null;
    reg.on('agent_after', (ctx) => {
      exitReason = ctx.exitReason;
    });

    const bashResult: AgentToolResult = {
      content: [{ type: 'text', text: 'ok' }],
      details: {},
    };
    const bashTool = makeMockTool('bash', bashResult);
    const tools = createToolRegistry();
    tools.register(bashTool);

    const provider = makeMockProvider([
      [
        {
          type: 'tool_call',
          toolCall: { id: 'tc_1', name: 'bash', arguments: '{}' },
        },
        { type: 'stop', stopReason: 'tool_use' },
      ],
    ]);

    const ctx: Context = { messages: [{ role: 'user', content: 'hi' }] };
    await collect(
      agentLoop({
        provider,
        model: MODEL,
        tools,
        context: ctx,
        systemPrompt: 'sys',
        hooks: reg,
        maxIterations: 2,
      }),
    );

    expect(exitReason).toBe('max_iterations_exceeded');
  });

  it('hooks fire in correct order within a turn', async () => {
    const reg = new HookRegistry();
    const order: string[] = [];
    for (const point of ALL_HOOK_POINTS) {
      reg.on(point, () => {
        order.push(point);
      });
    }

    const bashResult: AgentToolResult = {
      content: [{ type: 'text', text: 'ok' }],
      details: {},
    };
    const bashTool = makeMockTool('bash', bashResult);
    const tools = createToolRegistry();
    tools.register(bashTool);

    const provider = makeMockProvider([
      [
        {
          type: 'tool_call',
          toolCall: { id: 'tc_1', name: 'bash', arguments: '{}' },
        },
        { type: 'stop', stopReason: 'tool_use' },
      ],
      [
        { type: 'text', text: 'Done' },
        { type: 'stop', stopReason: 'end_turn' },
      ],
    ]);

    const ctx: Context = { messages: [{ role: 'user', content: 'hi' }] };
    await collect(
      agentLoop({
        provider,
        model: MODEL,
        tools,
        context: ctx,
        systemPrompt: 'sys',
        hooks: reg,
      }),
    );

    // Verify relative ordering of key hook points
    const agentBeforeIdx = order.indexOf('agent_before');
    const turnBeforeIdx = order.indexOf('turn_before');
    const llmBeforeIdx = order.indexOf('llm_before');
    const llmAfterIdx = order.indexOf('llm_after');
    const toolBeforeIdx = order.indexOf('tool_before');
    const toolAfterIdx = order.indexOf('tool_after');
    const turnAfterIdx = order.indexOf('turn_after');
    const agentAfterIdx = order.indexOf('agent_after');

    expect(agentBeforeIdx).toBeLessThan(turnBeforeIdx);
    expect(turnBeforeIdx).toBeLessThan(llmBeforeIdx);
    expect(llmBeforeIdx).toBeLessThan(llmAfterIdx);
    expect(llmAfterIdx).toBeLessThan(toolBeforeIdx);
    expect(toolBeforeIdx).toBeLessThan(toolAfterIdx);
    expect(toolAfterIdx).toBeLessThan(turnAfterIdx);
    expect(turnAfterIdx).toBeLessThan(agentAfterIdx);
  });
});

describe('HookRegistry discoverAndLoad', () => {
  let builtinDir: string;
  let workspaceDir: string;

  beforeEach(async () => {
    builtinDir = await mkdtemp(join(tmpdir(), 'hooks-builtin-'));
    workspaceDir = await mkdtemp(join(tmpdir(), 'hooks-workspace-'));
    globalHooks.clear();
  });

  afterEach(async () => {
    globalHooks.clear();
    await rm(builtinDir, { recursive: true, force: true });
    await rm(workspaceDir, { recursive: true, force: true });
    delete (globalThis as Record<string, unknown>).__testHookA;
    delete (globalThis as Record<string, unknown>).__testHookB;
    delete (globalThis as Record<string, unknown>).__testSharedSource;
    delete (globalThis as Record<string, unknown>).__testBuiltinOnly;
    delete (globalThis as Record<string, unknown>).__testUnderscore;
  });

  it('loads hook files from both directories', async () => {
    await writeFile(
      join(builtinDir, 'a.js'),
      `globalThis.__testHookA = true;\n`,
    );
    await writeFile(
      join(workspaceDir, 'b.js'),
      `globalThis.__testHookB = true;\n`,
    );

    await globalHooks.discoverAndLoad([builtinDir, workspaceDir]);

    expect((globalThis as Record<string, unknown>).__testHookA).toBe(true);
    expect((globalThis as Record<string, unknown>).__testHookB).toBe(true);
  });

  it('workspace overrides builtin by filename', async () => {
    await writeFile(
      join(builtinDir, 'shared.js'),
      `globalThis.__testSharedSource = 'builtin';\n`,
    );
    await writeFile(
      join(workspaceDir, 'shared.js'),
      `globalThis.__testSharedSource = 'workspace';\n`,
    );

    await globalHooks.discoverAndLoad([builtinDir, workspaceDir]);

    expect((globalThis as Record<string, unknown>).__testSharedSource).toBe(
      'workspace',
    );
  });

  it('builtin-only files still load when no workspace override', async () => {
    await writeFile(
      join(builtinDir, 'builtin-only.js'),
      `globalThis.__testBuiltinOnly = true;\n`,
    );

    await globalHooks.discoverAndLoad([builtinDir, workspaceDir]);

    expect((globalThis as Record<string, unknown>).__testBuiltinOnly).toBe(
      true,
    );
  });

  it('skips non-existent directories gracefully', async () => {
    await expect(
      globalHooks.discoverAndLoad([
        '/nonexistent/path/1',
        '/nonexistent/path/2',
      ]),
    ).resolves.not.toThrow();
  });

  it('skips files starting with underscore', async () => {
    await writeFile(
      join(builtinDir, '_disabled.js'),
      `globalThis.__testUnderscore = true;\n`,
    );

    await globalHooks.discoverAndLoad([builtinDir]);

    expect(
      (globalThis as Record<string, unknown>).__testUnderscore,
    ).toBeUndefined();
  });

  it('logs error on plugin load failure without throwing', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    await writeFile(
      join(builtinDir, 'broken.js'),
      `throw new Error('load error');\n`,
    );

    await expect(
      globalHooks.discoverAndLoad([builtinDir]),
    ).resolves.not.toThrow();

    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});
