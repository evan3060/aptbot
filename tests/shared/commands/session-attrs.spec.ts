import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { createCommandRegistry, type CommandContext } from '../../../src/shared/commands/registry.js';
import type { SessionAttrHandler } from '../../../src/shared/commands/session-attrs.js';
import { createAgentSession } from '../../../src/core/agent/session.js';
import { MixinProvider } from '../../../src/core/provider/mixin-provider.js';
import type {
  Provider,
  Model,
  StreamOptions,
  AssistantMessageEvent,
} from '../../../src/core/provider/types.js';
import type { StorageAdapter } from '../../../src/infrastructure/storage/file-storage.js';
import { createToolRegistry } from '../../../src/core/tool/types.js';

const MODEL: Model = {
  provider: 'mock',
  id: 'mock-1',
  api: 'openai-responses',
  contextWindow: 8000,
  maxTokens: 1000,
};

const SESSION_ID = '01234567-89ab-cdef-0123-456789abcdef';

function makeMockStorage(): StorageAdapter {
  return {
    readSession: vi.fn(async () => []),
    appendSession: vi.fn(async () => {}),
    listSessions: vi.fn(async () => []),
    readWorkingMemory: vi.fn(async () => null),
    writeWorkingMemory: vi.fn(async () => {}),
    deleteSession: vi.fn(async () => {}),
  } as unknown as StorageAdapter;
}

/** In-memory SessionAttrHandler for unit tests of /session command */
function makeMockHandler(): SessionAttrHandler & {
  attrs: Map<string, unknown>;
} {
  const attrs = new Map<string, unknown>();
  return {
    attrs,
    setProviderAttr(k, v) {
      attrs.set(k, v);
    },
    getProviderAttr(k) {
      return attrs.get(k);
    },
    getAllProviderAttrs() {
      return Object.fromEntries(attrs);
    },
    resetProviderAttrs() {
      attrs.clear();
    },
  };
}

function makeCtx(
  handler: SessionAttrHandler,
  overrides: Partial<CommandContext> = {},
): CommandContext {
  return {
    sessionId: SESSION_ID,
    model: 'mock-1',
    storage: makeMockStorage(),
    sessionAttrs: handler,
    dataDir: overrides.dataDir ?? '/tmp/aptbot-test-data',
    ...overrides,
  };
}

/** Mock sub-provider that records last stream options */
function mockSubProvider(id: string): Provider & {
  calls: number;
  lastOptions?: StreamOptions;
} {
  let calls = 0;
  let lastOptions: StreamOptions | undefined;
  return {
    id,
    name: id.toUpperCase(),
    auth: {},
    getModels: () => [MODEL],
    stream: (_m, _c, o) => {
      calls++;
      lastOptions = o;
      return (async function* () {
        yield { type: 'stop', stopReason: 'end_turn' } as AssistantMessageEvent;
      })();
    },
    get calls() {
      return calls;
    },
    get lastOptions() {
      return lastOptions;
    },
  };
}

async function drain(gen: AsyncGenerator<unknown>): Promise<void> {
  for await (const _ of gen) {
    /* drain */
  }
}

async function exec(
  reg: ReturnType<typeof createCommandRegistry>,
  input: string,
  ctx: CommandContext,
) {
  const resolved = reg.resolve(input);
  if (!resolved) throw new Error(`command not resolved: ${input}`);
  return resolved.command.execute(resolved.args, ctx);
}

describe('/session dynamic attributes', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'aptbot-session-attrs-'));
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  // Test case 1: 设置白名单属性生效
  it('sets whitelist attribute and confirms via read-back', async () => {
    const reg = createCommandRegistry();
    const handler = makeMockHandler();

    const setResult = await exec(reg, '/session temperature 0.5', makeCtx(handler));
    expect(setResult.output).toMatch(/temperature/);
    expect(setResult.output).toMatch(/0\.5/);
    expect(handler.getProviderAttr('temperature')).toBe(0.5);
    expect(typeof handler.getProviderAttr('temperature')).toBe('number');
  });

  // Test case 2: 读取当前值（/session <attr>）
  it('reads current value via /session <attr>', async () => {
    const reg = createCommandRegistry();
    const handler = makeMockHandler();
    handler.setProviderAttr('maxTokens', 2048);

    const result = await exec(reg, '/session maxTokens', makeCtx(handler));
    expect(result.output).toContain('2048');
  });

  // Test case 3: /session.reset 重置所有
  it('/session.reset clears all attrs', async () => {
    const reg = createCommandRegistry();
    const handler = makeMockHandler();
    handler.setProviderAttr('temperature', 0.5);
    handler.setProviderAttr('maxTokens', 2048);

    const result = await exec(reg, '/session.reset', makeCtx(handler));
    expect(result.output).toMatch(/reset/i);

    expect(handler.getProviderAttr('temperature')).toBeUndefined();
    expect(handler.getProviderAttr('maxTokens')).toBeUndefined();
  });

  // Test case 4: 文件值逃生口写入文件
  it('file escape hatch writes non-whitelist attr to file and returns path', async () => {
    const reg = createCommandRegistry();
    const handler = makeMockHandler();

    const result = await exec(
      reg,
      '/session customPrompt hello world',
      makeCtx(handler, { dataDir: tempDir }),
    );

    // Output should mention file path
    expect(result.output).toMatch(/file/i);
    expect(result.output).toContain(tempDir);

    // File should exist with the raw value
    const expectedPath = path.join(
      tempDir,
      'session-attrs',
      SESSION_ID,
      'customPrompt',
    );
    const content = await fs.readFile(expectedPath, 'utf-8');
    expect(content).toBe('hello world');

    // Should NOT enter the in-memory attr map
    expect(handler.getProviderAttr('customPrompt')).toBeUndefined();
  });

  // Test case 5: JSON 自动解析（number/boolean/null）
  it('JSON auto-parse: number string parsed to number', async () => {
    const reg = createCommandRegistry();
    const handler = makeMockHandler();

    await exec(reg, '/session temperature 0.5', makeCtx(handler));
    expect(handler.getProviderAttr('temperature')).toBe(0.5);
    expect(typeof handler.getProviderAttr('temperature')).toBe('number');
  });

  it('JSON auto-parse: boolean parsed but fails type check for number attr', async () => {
    const reg = createCommandRegistry();
    const handler = makeMockHandler();

    const result = await exec(reg, '/session temperature true', makeCtx(handler));
    expect(result.output).toMatch(/type|error/i);
    expect(handler.getProviderAttr('temperature')).toBeUndefined();
  });

  it('JSON auto-parse: null parsed but fails type check', async () => {
    const reg = createCommandRegistry();
    const handler = makeMockHandler();

    const result = await exec(reg, '/session temperature null', makeCtx(handler));
    expect(result.output).toMatch(/type|error/i);
    expect(handler.getProviderAttr('temperature')).toBeUndefined();
  });

  it('JSON auto-parse: unquoted string stays as-is for string attr', async () => {
    const reg = createCommandRegistry();
    const handler = makeMockHandler();

    const result = await exec(reg, '/session reasoningEffort high', makeCtx(handler));
    expect(result.output).toMatch(/high/);
    expect(handler.getProviderAttr('reasoningEffort')).toBe('high');
  });

  // Test case 6: 非法属性名拒绝且列出合法值（读取非白名单属性时拒绝）
  it('rejects reading invalid attr name and lists valid values', async () => {
    const reg = createCommandRegistry();
    const handler = makeMockHandler();

    // /session bogusAttr (no value = read attempt) → rejected + list valid
    const result = await exec(reg, '/session bogusAttr', makeCtx(handler));
    expect(result.output).toMatch(/unsupported|invalid|not.*support|unknown/i);
    // Should list valid attr names
    expect(result.output).toContain('temperature');
    expect(result.output).toContain('maxTokens');
    expect(result.output).toContain('reasoningEffort');
    expect(result.output).toContain('thinkingType');
    expect(result.output).toContain('thinkingBudgetTokens');

    // Should NOT enter attr map
    expect(handler.getProviderAttr('bogusAttr')).toBeUndefined();
  });

  // Security: reject attr names with path traversal / dangerous chars (injection prevention)
  it('rejects attr name with path traversal characters (injection prevention)', async () => {
    const reg = createCommandRegistry();
    const handler = makeMockHandler();

    const result = await exec(
      reg,
      '/session ../etc/passwd payload',
      makeCtx(handler, { dataDir: tempDir }),
    );
    expect(result.output).toMatch(/unsupported|invalid|error|illegal/i);
    // Should NOT write any file
    const escapeHatchDir = path.join(tempDir, 'session-attrs');
    const exists = await fs
      .access(escapeHatchDir)
      .then(() => true)
      .catch(() => false);
    expect(exists).toBe(false);
  });

  // Test case 7: 属性广播到 MixinProvider 子 provider
  it('broadcasts attrs to MixinProvider sub-providers via /session command', async () => {
    const sub = mockSubProvider('p0');
    const mixin = new MixinProvider('m', [sub]);

    const session = createAgentSession({
      storage: makeMockStorage(),
      sessionId: SESSION_ID,
      agentLoop: vi.fn() as unknown as Parameters<
        typeof createAgentSession
      >[0]['agentLoop'],
      provider: mixin,
      model: MODEL,
      tools: createToolRegistry(),
      systemPrompt: 'sys',
    });

    const reg = createCommandRegistry();
    const ctx: CommandContext = {
      sessionId: SESSION_ID,
      model: 'mock-1',
      storage: makeMockStorage(),
      sessionAttrs: session,
      dataDir: tempDir,
    };

    const result = await exec(reg, '/session temperature 0.7', ctx);
    expect(result.output).toMatch(/temperature/);
    expect(result.output).toMatch(/0\.7/);

    // Trigger stream on mixin to verify broadcast reached sub-provider
    await drain(
      mixin.stream(MODEL, { messages: [{ role: 'user', content: 'hi' }] }),
    );

    expect(sub.lastOptions?.temperature).toBe(0.7);
  });

  // Edge: /session (no args) lists all current values
  it('lists all current values when called with no args', async () => {
    const reg = createCommandRegistry();
    const handler = makeMockHandler();
    handler.setProviderAttr('temperature', 0.7);
    handler.setProviderAttr('maxTokens', 2048);

    const result = await exec(reg, '/session', makeCtx(handler));
    expect(result.output).toContain('temperature');
    expect(result.output).toContain('0.7');
    expect(result.output).toContain('maxTokens');
    expect(result.output).toContain('2048');
  });

  // Edge: invalid value type (string for number attr) returns error
  it('rejects invalid value type (string for number attr)', async () => {
    const reg = createCommandRegistry();
    const handler = makeMockHandler();

    // "hot" parses as string (JSON.parse fails), but temperature expects number
    const result = await exec(reg, '/session temperature hot', makeCtx(handler));
    expect(result.output).toMatch(/type|error/i);
    expect(handler.getProviderAttr('temperature')).toBeUndefined();
  });

  // Edge: invalid value range (temperature=5) returns error
  it('rejects invalid value range (temperature=5)', async () => {
    const reg = createCommandRegistry();
    const handler = makeMockHandler();

    const result = await exec(reg, '/session temperature 5', makeCtx(handler));
    expect(result.output).toMatch(/invalid|range|error/i);
    expect(handler.getProviderAttr('temperature')).toBeUndefined();
  });

  // Edge: /session.reset doesn't affect other sessions
  it('/session.reset only clears the current session attrs', async () => {
    const reg = createCommandRegistry();
    const handler1 = makeMockHandler();
    const handler2 = makeMockHandler();

    handler1.setProviderAttr('temperature', 0.5);
    handler2.setProviderAttr('temperature', 0.7);

    await exec(
      reg,
      '/session.reset',
      makeCtx(handler1, { sessionId: 'session-1' }),
    );

    expect(handler1.getProviderAttr('temperature')).toBeUndefined();
    // handler2 should be unchanged
    expect(handler2.getProviderAttr('temperature')).toBe(0.7);
  });

  // Edge: Non-BroadcastableProvider — setProviderAttr stores locally without broadcasting
  it('setProviderAttr on non-BroadcastableProvider stores locally without broadcasting', async () => {
    const stubProvider: Provider = {
      id: 'stub',
      name: 'Stub',
      auth: {},
      getModels: () => [MODEL],
      stream: async function* () {},
    };
    const session = createAgentSession({
      storage: makeMockStorage(),
      sessionId: SESSION_ID,
      agentLoop: vi.fn() as unknown as Parameters<
        typeof createAgentSession
      >[0]['agentLoop'],
      provider: stubProvider,
      model: MODEL,
      tools: createToolRegistry(),
      systemPrompt: 'sys',
    });

    // Should not throw (no broadcastAttr method on plain Provider)
    expect(() => session.setProviderAttr('temperature', 0.5)).not.toThrow();
    expect(session.getProviderAttr('temperature')).toBe(0.5);
  });

  // Edge: thinkingType / thinkingBudgetTokens validation
  it('sets thinkingType with valid enum value', async () => {
    const reg = createCommandRegistry();
    const handler = makeMockHandler();

    const result = await exec(reg, '/session thinkingType enabled', makeCtx(handler));
    expect(result.output).toMatch(/enabled/);
    expect(handler.getProviderAttr('thinkingType')).toBe('enabled');
  });

  it('rejects invalid thinkingType value', async () => {
    const reg = createCommandRegistry();
    const handler = makeMockHandler();

    const result = await exec(reg, '/session thinkingType bogus', makeCtx(handler));
    expect(result.output).toMatch(/invalid|error/i);
    expect(handler.getProviderAttr('thinkingType')).toBeUndefined();
  });

  it('sets thinkingBudgetTokens with valid positive number', async () => {
    const reg = createCommandRegistry();
    const handler = makeMockHandler();

    const result = await exec(
      reg,
      '/session thinkingBudgetTokens 4096',
      makeCtx(handler),
    );
    expect(result.output).toMatch(/4096/);
    expect(handler.getProviderAttr('thinkingBudgetTokens')).toBe(4096);
  });

  it('rejects thinkingBudgetTokens=0 (must be > 0)', async () => {
    const reg = createCommandRegistry();
    const handler = makeMockHandler();

    const result = await exec(
      reg,
      '/session thinkingBudgetTokens 0',
      makeCtx(handler),
    );
    expect(result.output).toMatch(/invalid|error/i);
    expect(handler.getProviderAttr('thinkingBudgetTokens')).toBeUndefined();
  });
});
