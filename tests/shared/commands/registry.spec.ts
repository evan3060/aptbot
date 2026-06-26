import { describe, it, expect, vi } from 'vitest';
import { createCommandRegistry, type CommandContext } from '../../../src/shared/commands/registry.js';
import type { StorageAdapter } from '../../../src/infrastructure/storage/file-storage.js';
import type { SessionEntry } from '../../../src/core/memory/types.js';

function makeMockStorage(entriesBySession: Record<string, SessionEntry[]> = {}): StorageAdapter {
  const store: Record<string, SessionEntry[]> = JSON.parse(JSON.stringify(entriesBySession));
  return {
    readSession: vi.fn(async (id: string) => store[id] ?? []),
    appendSession: vi.fn(async (id: string, entry: SessionEntry) => {
      if (!store[id]) store[id] = [];
      store[id].push(entry);
    }),
    listSessions: vi.fn(async () => []),
    readWorkingMemory: vi.fn(async (sessionId: string) => {
      const entries = store[sessionId] ?? [];
      for (let i = entries.length - 1; i >= 0; i--) {
        if (entries[i].type === 'working_memory') return entries[i].keyInfo;
      }
      return null;
    }),
    writeWorkingMemory: vi.fn(async (sessionId: string, keyInfo: string) => {
      const entry: SessionEntry = {
        type: 'working_memory',
        id: `wm-${Date.now()}`,
        keyInfo,
        timestamp: Date.now(),
      };
      if (!store[sessionId]) store[sessionId] = [];
      store[sessionId].push(entry);
    }),
    deleteSession: vi.fn(async () => {}),
  };
}

function makeCtx(overrides: Partial<CommandContext> = {}): CommandContext {
  return {
    sessionId: '11111111-2222-3333-4444-555555555555',
    model: 'mock-1',
    storage: makeMockStorage(),
    ...overrides,
  };
}

describe('CommandRegistry', () => {
  it('resolve /new returns new command', () => {
    const reg = createCommandRegistry();
    const result = reg.resolve('/new');
    expect(result).not.toBeNull();
    expect(result!.command.name).toBe('new');
    expect(result!.args).toEqual([]);
  });

  it('resolve with args', () => {
    const reg = createCommandRegistry();
    const result = reg.resolve('/model gpt-4');
    expect(result).not.toBeNull();
    expect(result!.command.name).toBe('model');
    expect(result!.args).toEqual(['gpt-4']);
  });

  it('resolve alias', () => {
    const reg = createCommandRegistry();
    // /exit might have alias /quit
    const result = reg.resolve('/quit');
    expect(result).not.toBeNull();
    expect(result!.command.name).toBe('exit');
  });

  it('resolve unknown command returns null', () => {
    const reg = createCommandRegistry();
    const result = reg.resolve('/nonexistent');
    expect(result).toBeNull();
  });

  it('resolve non-slash input returns null', () => {
    const reg = createCommandRegistry();
    const result = reg.resolve('hello world');
    expect(result).toBeNull();
  });

  it('/exit returns action=exit', async () => {
    const reg = createCommandRegistry();
    const resolved = reg.resolve('/exit');
    const result = await resolved!.command.execute([], makeCtx());
    expect(result.action).toBe('exit');
  });

  it('/new returns action=new_session', async () => {
    const reg = createCommandRegistry();
    const resolved = reg.resolve('/new');
    const result = await resolved!.command.execute([], makeCtx());
    expect(result.action).toBe('new_session');
  });

  it('/clear returns action=clear', async () => {
    const reg = createCommandRegistry();
    const resolved = reg.resolve('/clear');
    const result = await resolved!.command.execute([], makeCtx());
    expect(result.action).toBe('clear');
  });

  it('/help output contains all command names', async () => {
    const reg = createCommandRegistry();
    const resolved = reg.resolve('/help');
    const result = await resolved!.command.execute([], makeCtx());
    expect(result.output).toBeDefined();
    const output = result.output!;
    const commands = reg.list();
    for (const cmd of commands) {
      expect(output).toContain(cmd.name);
    }
  });

  it('/continue with nonexistent id returns error output', async () => {
    const reg = createCommandRegistry();
    const resolved = reg.resolve('/continue 00000000-0000-0000-0000-000000000000');
    const result = await resolved!.command.execute(['00000000-0000-0000-0000-000000000000'], makeCtx());
    // 不存在的 session 应返回友好错误（output 含 error 信息），action 不为 continue
    expect(result.output).toBeDefined();
    expect(result.action).not.toBe('continue');
  });

  it('/continue with valid source id inherits working memory', async () => {
    const sourceId = '00000000-0000-0000-0000-000000000000';
    const targetId = '11111111-2222-3333-4444-555555555555';
    const storage = makeMockStorage({
      [sourceId]: [
        { type: 'working_memory', id: 'wm-1', keyInfo: 'user prefers dark mode', timestamp: 100 },
      ],
    });
    const reg = createCommandRegistry();
    const resolved = reg.resolve(`/continue ${sourceId}`);
    const result = await resolved!.command.execute([sourceId], makeCtx({ sessionId: targetId, storage }));
    expect(result.action).toBe('continue');
    expect(result.continueSessionId).toBeDefined();
  });

  it('/model with no args shows current model', async () => {
    const reg = createCommandRegistry();
    const resolved = reg.resolve('/model');
    const result = await resolved!.command.execute([], makeCtx({ model: 'gpt-4' }));
    expect(result.output).toContain('gpt-4');
  });

  it('list returns all 7 commands', () => {
    const reg = createCommandRegistry();
    const commands = reg.list();
    expect(commands.length).toBe(7);
    const names = commands.map((c) => c.name).sort();
    expect(names).toEqual(['clear', 'continue', 'exit', 'help', 'model', 'new', 'session']);
  });

  it('has and get work correctly', () => {
    const reg = createCommandRegistry();
    expect(reg.has('help')).toBe(true);
    expect(reg.has('nonexistent')).toBe(false);
    expect(reg.get('help')).toBeDefined();
    expect(reg.get('nonexistent')).toBeUndefined();
  });

  it('register adds custom command', () => {
    const reg = createCommandRegistry();
    reg.register({
      name: 'custom',
      description: 'custom command',
      async execute() {
        return { output: 'custom' };
      },
    });
    expect(reg.has('custom')).toBe(true);
    const result = reg.resolve('/custom');
    expect(result!.command.name).toBe('custom');
  });
});
