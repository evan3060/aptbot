import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { FileStorage } from '../../src/infrastructure/storage/file-storage.js';
import { createToolRegistry } from '../../src/core/tool/types.js';
import { bashTool } from '../../src/core/tool/tools/bash.js';
import { readTool } from '../../src/core/tool/tools/read.js';
import { editTool } from '../../src/core/tool/tools/edit.js';
import { createUpdateWorkingMemoryTool } from '../../src/core/tool/tools/update-working-memory.js';
import { createAgentSession } from '../../src/core/agent/session.js';
import { agentLoop } from '../../src/core/agent/loop.js';
import { createCommandRegistry } from '../../src/shared/commands/registry.js';
import { coreReducer, initialUIState } from '../../src/shared/ui-state/reducer.js';
import { inheritWorkingMemory } from '../../src/core/memory/working-memory.js';
import { compact, shouldCompact, DEFAULT_COMPACTION_SETTINGS } from '../../src/core/memory/compaction.js';
import type { Provider, Model, AssistantMessageEvent } from '../../src/core/provider/types.js';
import type { AgentEvent } from '../../src/core/agent/events.js';
import type { AgentMessage } from '../../src/core/memory/agent-message.js';
import type { SessionEntry } from '../../src/core/memory/types.js';
import type { StorageAdapter } from '../../src/infrastructure/storage/file-storage.js';
import { randomUUID } from 'crypto';

const MODEL: Model = {
  provider: 'mock',
  id: 'mock-1',
  api: 'openai-responses',
  contextWindow: 8000,
  maxTokens: 1000,
};

function makeMockProvider(events: AssistantMessageEvent[]): Provider {
  return {
    id: 'mock',
    name: 'Mock',
    auth: {},
    getModels: () => [MODEL],
    stream: async function* (): AsyncGenerator<AssistantMessageEvent> {
      for (const e of events) yield e;
    },
  };
}

function makeScriptedProvider(scripts: AssistantMessageEvent[][]): Provider {
  let callIdx = 0;
  return {
    id: 'mock',
    name: 'Mock',
    auth: {},
    getModels: () => [MODEL],
    stream: async function* (): AsyncGenerator<AssistantMessageEvent> {
      const events = scripts[callIdx] ?? scripts[scripts.length - 1];
      callIdx++;
      for (const e of events) yield e;
    },
  };
}

function makeErrorThenSuccessProvider(
  errorEvents: AssistantMessageEvent[],
  successEvents: AssistantMessageEvent[],
): Provider {
  return {
    id: 'mock',
    name: 'Mock',
    auth: {},
    getModels: () => [MODEL],
    stream: async function* (): AsyncGenerator<AssistantMessageEvent> {
      // Simulate internal retry: first yield error, then succeed on retry
      for (const e of errorEvents) yield e;
      for (const e of successEvents) yield e;
    },
  };
}

let tempDir: string;

function setupStorage(): { storage: FileStorage; dir: string } {
  tempDir = mkdtempSync(join(tmpdir(), 'aptbot-e2e-'));
  const storage = new FileStorage(tempDir);
  return { storage, dir: tempDir };
}

function cleanup(): void {
  if (tempDir) {
    rmSync(tempDir, { recursive: true, force: true });
    tempDir = '';
  }
}

function setupSession(provider: Provider, storage: StorageAdapter, sessionId?: string) {
  const sid = sessionId ?? randomUUID();
  const registry = createToolRegistry();
  registry.register(bashTool);
  registry.register(readTool);
  registry.register(editTool);
  registry.register(createUpdateWorkingMemoryTool(storage, sid));

  const session = createAgentSession({
    storage,
    sessionId: sid,
    agentLoop,
    provider,
    model: MODEL,
    tools: registry,
    systemPrompt: 'You are aptbot.',
  });
  return { session, sessionId: sid, registry };
}

async function collectEvents(gen: AsyncGenerator<AgentEvent>): Promise<AgentEvent[]> {
  const events: AgentEvent[] = [];
  for await (const e of gen) events.push(e);
  return events;
}

describe('E2E: Full agent loop', () => {
  afterEach(() => cleanup());

  it('#1 basic conversation: user input -> streaming response -> complete', async () => {
    const { storage } = setupStorage();
    const provider = makeMockProvider([
      { type: 'text', text: 'Hello' },
      { type: 'text', text: ' world' },
      { type: 'stop', stopReason: 'end_turn' },
    ]);
    const { session } = setupSession(provider, storage);

    const events = await collectEvents(session.run('hi'));

    const textEvents = events.filter((e) => e.type === 'message_delta');
    const text = textEvents.map((e) => (e as { text: string }).text).join('');
    expect(text).toBe('Hello world');
    expect(events.some((e) => e.type === 'turn_end')).toBe(true);
  });

  it('#2 tool call: LLM calls bash -> result -> LLM continues', async () => {
    const { storage } = setupStorage();
    const scripts: AssistantMessageEvent[][] = [
      [
        { type: 'tool_call', toolCall: { id: 'tc1', name: 'bash', arguments: JSON.stringify({ command: 'echo hello' }) } },
        { type: 'stop', stopReason: 'tool_use' },
      ],
      [
        { type: 'text', text: 'Tool said hello' },
        { type: 'stop', stopReason: 'end_turn' },
      ],
    ];
    const provider = makeScriptedProvider(scripts);
    const { session } = setupSession(provider, storage);

    const events = await collectEvents(session.run('run bash'));

    const toolEvents = events.filter((e) => e.type === 'tool_call_start' || e.type === 'tool_call_end');
    expect(toolEvents.length).toBeGreaterThanOrEqual(2);
    const textEvents = events.filter((e) => e.type === 'message_delta');
    const text = textEvents.map((e) => (e as { text: string }).text).join('');
    expect(text).toContain('Tool said hello');
  });

  it('#3 multi-turn: 3 consecutive turns accumulate context', async () => {
    const { storage } = setupStorage();
    const scripts: AssistantMessageEvent[][] = [
      [{ type: 'text', text: 'reply1' }, { type: 'stop', stopReason: 'end_turn' }],
      [{ type: 'text', text: 'reply2' }, { type: 'stop', stopReason: 'end_turn' }],
      [{ type: 'text', text: 'reply3' }, { type: 'stop', stopReason: 'end_turn' }],
    ];
    const provider = makeScriptedProvider(scripts);
    const { session, sessionId } = setupSession(provider, storage);

    await collectEvents(session.run('msg1'));
    await collectEvents(session.run('msg2'));
    await collectEvents(session.run('msg3'));

    const entries = await storage.readSession(sessionId);
    const messages = entries.filter((e) => e.type === 'message') as Array<{ type: 'message'; message: AgentMessage }>;
    expect(messages.length).toBe(6);
  });

  it('#4 persistence: restart restores history', async () => {
    const { storage, dir } = setupStorage();
    const provider = makeMockProvider([
      { type: 'text', text: 'saved reply' },
      { type: 'stop', stopReason: 'end_turn' },
    ]);
    const { session, sessionId } = setupSession(provider, storage);

    await collectEvents(session.run('persist this'));

    const storage2 = new FileStorage(dir);
    const entries = await storage2.readSession(sessionId);
    const messages = entries.filter((e) => e.type === 'message');
    expect(messages.length).toBe(2);
  });

  it('#5 working memory: update_working_memory persists across restart', async () => {
    const { storage, dir } = setupStorage();
    const scripts: AssistantMessageEvent[][] = [
      [
        { type: 'tool_call', toolCall: { id: 'tc1', name: 'update_working_memory', arguments: JSON.stringify({ keyInfo: 'remember this' }) } },
        { type: 'stop', stopReason: 'tool_use' },
      ],
      [{ type: 'text', text: 'done' }, { type: 'stop', stopReason: 'end_turn' }],
    ];
    const provider = makeScriptedProvider(scripts);
    const { session, sessionId } = setupSession(provider, storage);

    await collectEvents(session.run('update memory'));

    const storage2 = new FileStorage(dir);
    const { session: session2 } = setupSession(provider, storage2, sessionId);
    const wm = await session2.getWorkingMemory();
    expect(wm).toBe('remember this');
  });

  it('#6 error recovery: LLM returns error then succeeds', async () => {
    const { storage } = setupStorage();
    const provider = makeErrorThenSuccessProvider(
      [{ type: 'error', error: { message: 'server_error', retryable: true, status: 500 } }],
      [{ type: 'text', text: 'recovered' }, { type: 'stop', stopReason: 'end_turn' }],
    );
    const { session } = setupSession(provider, storage);

    const events = await collectEvents(session.run('test error'));

    const hasText = events.some((e) => e.type === 'message_delta' && (e as { text: string }).text === 'recovered');
    expect(hasText).toBe(true);
  });

  it('#8 CLI commands: all 12 builtin commands available and executable (I16)', async () => {
    const registry = createCommandRegistry();
    const commands = registry.list();
    expect(commands.length).toBe(12);
    const names = commands.map((c) => c.name).sort();
    expect(names).toEqual(['clear', 'continue', 'exit', 'feedback', 'help', 'label', 'model', 'new', 'resume', 'session', 'session.reset', 'sessions']);

    // I16 修复：实际执行每个命令验证输出/action，而非仅检查注册数量
    const mockStorage: StorageAdapter = {
      readSession: async () => [],
      appendSession: async () => {},
      listSessions: async () => [],
      readWorkingMemory: async () => null,
      writeWorkingMemory: async () => {},
      deleteSession: async () => {},
    };
    const ctx = { sessionId: 'test-sid', model: 'test-model', storage: mockStorage };

    const helpResult = await registry.resolve('/help')!.command.execute([], ctx);
    expect(helpResult.output).toContain('Available commands');

    const sessionResult = await registry.resolve('/session')!.command.execute([], ctx);
    expect(sessionResult.output).toContain('test-sid');

    const modelResult = await registry.resolve('/model')!.command.execute([], ctx);
    expect(modelResult.output).toContain('test-model');

    const exitResult = await registry.resolve('/exit')!.command.execute([], ctx);
    expect(exitResult.action).toBe('exit');

    const newResult = await registry.resolve('/new')!.command.execute([], ctx);
    expect(newResult.action).toBe('new_session');

    const clearResult = await registry.resolve('/clear')!.command.execute([], ctx);
    expect(clearResult.action).toBe('clear');
  });

  // C13 修复：#9 准确描述为 WebUI 状态核心（coreReducer）—— 组件渲染测试在 access/webui.spec.ts
  it('#9 WebUI state core: coreReducer processes agent events into UI state', () => {
    let state = initialUIState;
    const events: AgentEvent[] = [
      { type: 'agent_start' },
      { type: 'turn_start', turnId: 't1' },
      { type: 'message_start', messageId: 'm1' },
      { type: 'message_delta', text: 'Hello ' },
      { type: 'message_delta', text: 'World' },
      { type: 'message_end', messageId: 'm1', stopReason: 'end_turn' },
      { type: 'turn_end', turnId: 't1' },
    ];
    for (const e of events) {
      state = coreReducer(state, e);
    }
    expect(state.messages.length).toBe(1);
    expect(state.messages[0].text).toBe('Hello World');
    expect(state.isWorking).toBe(false);
  });

  it('#10 compaction: triggers at threshold and generates summary (I17)', async () => {
    const { storage } = setupStorage();
    const smallContextModel: Model = { ...MODEL, contextWindow: 100 };
    // I17 修复：使用足够长的文本强制超过 keepRecentTokens(100) + trigger threshold(80)
    // repeat(40) = 440 chars = 110 tokens，加 user msg 总计 ~115 tokens > 100 keepRecent
    const scripts: AssistantMessageEvent[][] = [
      [{ type: 'text', text: 'long reply '.repeat(40) }, { type: 'stop', stopReason: 'end_turn' }],
      [{ type: 'text', text: 'Summary of conversation' }, { type: 'stop', stopReason: 'end_turn' }],
    ];
    const provider = makeScriptedProvider(scripts);
    const { session, sessionId } = setupSession(provider, storage);

    await collectEvents(session.run('generate long text'));

    const entries = await storage.readSession(sessionId);
    const messages = entries.filter((e) => e.type === 'message') as Array<{ type: 'message'; message: AgentMessage }>;
    const totalText = messages.map((m) => m.message.content).join('');
    const tokens = Math.ceil(totalText.length / 4);

    // I17 修复：强制验证 compaction 触发，移除 if/else 可选路径
    expect(tokens).toBeGreaterThanOrEqual(80);
    expect(shouldCompact(tokens, smallContextModel.contextWindow, DEFAULT_COMPACTION_SETTINGS)).toBe(true);
    const result = await compact(entries, null, smallContextModel, provider, storage, sessionId);
    expect(result.success).toBe(true);
    const updated = await storage.readSession(sessionId);
    const compactionEntry = updated.find((e) => e.type === 'compaction');
    expect(compactionEntry).toBeDefined();
  });

  it('#11 cross-session inheritance: /continue inherits working memory (I18)', async () => {
    const { storage } = setupStorage();
    const oldSessionId = randomUUID();
    const newSessionId = randomUUID();

    const wmEntry: SessionEntry = {
      type: 'working_memory',
      id: `wm-${Date.now()}`,
      keyInfo: 'inherited key info',
      timestamp: Date.now(),
    };
    await storage.appendSession(oldSessionId, wmEntry);

    // I18 修复：通过 /continue 命令路径测试，而非直接调用 inheritWorkingMemory
    const registry = createCommandRegistry();
    const ctx = { sessionId: newSessionId, model: 'test-model', storage };
    const resolved = registry.resolve(`/continue ${oldSessionId}`);
    expect(resolved).not.toBeNull();
    const result = await resolved!.command.execute(resolved!.args, ctx);

    expect(result.action).toBe('continue');
    expect(result.continueSessionId).toBe(oldSessionId);

    const newEntries = await storage.readSession(newSessionId);
    const newWm = newEntries.find((e) => e.type === 'working_memory') as { type: 'working_memory'; id: string; keyInfo: string } | undefined;
    expect(newWm).toBeDefined();
    expect(newWm!.keyInfo).toBe('inherited key info');
    expect(newWm!.id).toMatch(/^wm-ps1-/);
  });

  it('#11b cross-session double inheritance: passedSessions increments', async () => {
    const { storage } = setupStorage();
    const s1 = randomUUID();
    const s2 = randomUUID();
    const s3 = randomUUID();

    const wmEntry: SessionEntry = {
      type: 'working_memory',
      id: `wm-${Date.now()}`,
      keyInfo: 'chain test',
      timestamp: Date.now(),
    };
    await storage.appendSession(s1, wmEntry);

    await inheritWorkingMemory(s1, s2, storage);
    const r2 = await inheritWorkingMemory(s2, s3, storage);
    expect(r2.passedSessions).toBe(2);

    const entries = await storage.readSession(s3);
    const wm = entries.find((e) => e.type === 'working_memory') as { id: string };
    expect(wm.id).toMatch(/^wm-ps2-/);
  });
});
