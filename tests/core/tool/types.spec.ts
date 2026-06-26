import { describe, it, expect } from 'vitest';
import {
  createToolRegistry,
  type AgentTool,
  type AgentToolResult,
} from '../../../src/core/tool/types.js';

function makeTool(name: string, opts: Partial<AgentTool> = {}): AgentTool {
  return {
    name,
    label: opts.label ?? name,
    description: opts.description ?? `${name} tool`,
    parameters: opts.parameters ?? { type: 'object', properties: {} },
    executionMode: opts.executionMode,
    execute: opts.execute ?? (async () => ({
      content: [{ type: 'text', text: 'ok' }],
      details: {},
    })),
  };
}

describe('ToolRegistry', () => {
  it('register then get returns the same tool', () => {
    const reg = createToolRegistry();
    const tool = makeTool('bash');
    reg.register(tool);
    expect(reg.get('bash')).toBe(tool);
    expect(reg.has('bash')).toBe(true);
  });

  it('get returns undefined for unknown tool', () => {
    const reg = createToolRegistry();
    expect(reg.get('nope')).toBeUndefined();
    expect(reg.has('nope')).toBe(false);
  });

  it('getDefinitions converts each tool to ToolDefinition schema', () => {
    const reg = createToolRegistry();
    reg.register(makeTool('bash', { description: 'run shell', parameters: { type: 'object' } }));
    reg.register(makeTool('read'));
    const defs = reg.getDefinitions();
    expect(defs).toHaveLength(2);
    expect(defs.map((d) => d.name).sort()).toEqual(['bash', 'read']);
    expect(defs[0]).toMatchObject({
      name: 'bash',
      description: 'run shell',
      parameters: { type: 'object' },
    });
  });

  it('unregister removes a tool from the registry', () => {
    const reg = createToolRegistry();
    reg.register(makeTool('bash'));
    reg.unregister('bash');
    expect(reg.get('bash')).toBeUndefined();
    expect(reg.has('bash')).toBe(false);
  });

  it('unregister on unknown name is a no-op', () => {
    const reg = createToolRegistry();
    expect(() => reg.unregister('ghost')).not.toThrow();
  });

  it('re-register same name overwrites the previous tool', () => {
    const reg = createToolRegistry();
    const first = makeTool('bash', { label: 'first' });
    const second = makeTool('bash', { label: 'second' });
    reg.register(first);
    reg.register(second);
    expect(reg.get('bash')).toBe(second);
    expect(reg.get('bash')?.label).toBe('second');
  });

  it('getAll returns array of currently registered tools', () => {
    const reg = createToolRegistry();
    reg.register(makeTool('bash'));
    reg.register(makeTool('read'));
    const all = reg.getAll();
    expect(all).toHaveLength(2);
    expect(all.map((t) => t.name).sort()).toEqual(['bash', 'read']);
  });

  it('execute returns AgentToolResult with content + details', async () => {
    const reg = createToolRegistry();
    const tool: AgentTool<{ cmd: string }, { exit: number }> = {
      name: 'bash',
      label: 'bash',
      description: 'shell',
      parameters: { type: 'object' },
      async execute(_id, params) {
        return {
          content: [{ type: 'text', text: `ran ${params.cmd}` }],
          details: { exit: 0 },
        };
      },
    };
    reg.register(tool as unknown as AgentTool);
    const fetched = reg.get('bash')!;
    const result = (await fetched.execute('tc_1', { cmd: 'ls' })) as AgentToolResult<{ exit: number }>;
    expect(result.content[0]).toMatchObject({ type: 'text', text: 'ran ls' });
    expect(result.details.exit).toBe(0);
  });
});
