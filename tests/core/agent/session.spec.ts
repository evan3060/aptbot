import { describe, it, expect, vi } from 'vitest';
import { createAgentSession } from '../../../src/core/agent/session.js';
import type { AgentEvent } from '../../../src/core/agent/events.js';
import type { AgentMessage } from '../../../src/core/memory/agent-message.js';
import type { StorageAdapter } from '../../../src/infrastructure/storage/file-storage.js';
import type { SessionEntry } from '../../../src/core/memory/types.js';
import type { Provider, Model } from '../../../src/core/provider/types.js';
import type { ToolRegistry } from '../../../src/core/tool/types.js';
import { createToolRegistry } from '../../../src/core/tool/types.js';
import type { AgentLoopConfig } from '../../../src/core/agent/loop.js';

const MODEL: Model = {
  provider: 'mock',
  id: 'mock-1',
  api: 'openai-responses',
  contextWindow: 8000,
  maxTokens: 1000,
};

const SESSION_ID = '01234567-89ab-cdef-0123-456789abcdef';

type MessageEntry = Extract<SessionEntry, { type: 'message' }>;

function makeMockStorage() {
  const appended: SessionEntry[] = [];
  const storage: StorageAdapter = {
    readSession: vi.fn(async () => []),
    appendSession: vi.fn(async (_id: string, entry: SessionEntry) => {
      appended.push(entry);
    }),
    listSessions: vi.fn(async () => []),
    readWorkingMemory: vi.fn(async () => null),
    writeWorkingMemory: vi.fn(async () => {}),
    deleteSession: vi.fn(async () => {}),
  };
  return { storage, appended };
}

function makeMockAgentLoop(events: AgentEvent[]) {
  const configs: AgentLoopConfig[] = [];
  const fn = vi.fn((config: AgentLoopConfig): AsyncGenerator<AgentEvent, AgentMessage[]> => {
    configs.push(config);
    return (async function* () {
      for (const e of events) yield e;
      return [];
    })();
  });
  return { fn, configs };
}

const STUB_PROVIDER: Provider = {
  id: 'stub',
  name: 'Stub',
  auth: {},
  getModels: () => [MODEL],
  stream: async function* () {},
};

async function collect(gen: AsyncGenerator<AgentEvent>): Promise<AgentEvent[]> {
  const out: AgentEvent[] = [];
  for await (const e of gen) out.push(e);
  return out;
}

function messageEntries(entries: SessionEntry[]): MessageEntry[] {
  return entries.filter((e): e is MessageEntry => e.type === 'message');
}

describe('AgentSession', () => {
  it('single turn run persists entries to storage', async () => {
    const { storage, appended } = makeMockStorage();
    const events: AgentEvent[] = [
      { type: 'agent_start' },
      { type: 'turn_start', turnId: 't1' },
      { type: 'message_start', messageId: 'm1' },
      { type: 'message_delta', text: 'hello' },
      { type: 'message_end', messageId: 'm1', stopReason: 'end_turn' },
      { type: 'turn_end', turnId: 't1' },
      { type: 'agent_end' },
    ];
    const { fn } = makeMockAgentLoop(events);

    const session = createAgentSession({
      storage,
      sessionId: SESSION_ID,
      agentLoop: fn,
      provider: STUB_PROVIDER,
      model: MODEL,
      tools: createToolRegistry(),
      systemPrompt: 'sys',
    });

    await collect(session.run('hi'));

    const msgs = messageEntries(appended);
    expect(msgs.length).toBeGreaterThanOrEqual(2);
    const roles = msgs.map((e) => e.message.role);
    expect(roles).toContain('user');
    expect(roles).toContain('assistant');
  });

  it('error response is not persisted (turn atomicity)', async () => {
    const { storage, appended } = makeMockStorage();
    const events: AgentEvent[] = [
      { type: 'agent_start' },
      { type: 'turn_start', turnId: 't1' },
      { type: 'message_start', messageId: 'm1' },
      { type: 'error', message: 'provider_error', retryable: false },
      { type: 'agent_end' },
    ];
    const { fn } = makeMockAgentLoop(events);

    const session = createAgentSession({
      storage,
      sessionId: SESSION_ID,
      agentLoop: fn,
      provider: STUB_PROVIDER,
      model: MODEL,
      tools: createToolRegistry(),
      systemPrompt: 'sys',
    });

    await collect(session.run('hi'));

    expect(appended.length).toBe(0);
  });

  it('pushSteering message included in next run context', async () => {
    const { storage } = makeMockStorage();
    const events: AgentEvent[] = [
      { type: 'agent_start' },
      { type: 'turn_start', turnId: 't1' },
      { type: 'message_end', messageId: 'm1', stopReason: 'end_turn' },
      { type: 'turn_end', turnId: 't1' },
      { type: 'agent_end' },
    ];
    const { fn, configs } = makeMockAgentLoop(events);

    const session = createAgentSession({
      storage,
      sessionId: SESSION_ID,
      agentLoop: fn,
      provider: STUB_PROVIDER,
      model: MODEL,
      tools: createToolRegistry(),
      systemPrompt: 'sys',
    });

    session.pushSteering({
      id: 's1',
      role: 'user',
      content: 'steering hint',
      timestamp: 1,
    });

    await collect(session.run('hi'));

    expect(configs.length).toBe(1);
    const ctxMessages = configs[0].context.messages;
    expect(
      ctxMessages.some((m) => m.role === 'user' && m.content === 'steering hint'),
    ).toBe(true);
  });

  it('steering queue drops oldest when exceeding 5', async () => {
    const { storage } = makeMockStorage();
    const events: AgentEvent[] = [
      { type: 'agent_start' },
      { type: 'turn_end', turnId: 't1' },
      { type: 'agent_end' },
    ];
    const { fn, configs } = makeMockAgentLoop(events);

    const session = createAgentSession({
      storage,
      sessionId: SESSION_ID,
      agentLoop: fn,
      provider: STUB_PROVIDER,
      model: MODEL,
      tools: createToolRegistry(),
      systemPrompt: 'sys',
    });

    for (let i = 0; i < 6; i++) {
      session.pushSteering({
        id: `s${i}`,
        role: 'user',
        content: `hint${i}`,
        timestamp: i,
      });
    }

    await collect(session.run('hi'));

    const ctxMessages = configs[0].context.messages;
    const steeringMsgs = ctxMessages.filter(
      (m) => typeof m.content === 'string' && m.content.startsWith('hint'),
    );
    expect(steeringMsgs.length).toBe(5);
    expect(steeringMsgs.some((m) => m.content === 'hint0')).toBe(false);
    expect(steeringMsgs.some((m) => m.content === 'hint5')).toBe(true);
  });

  it('getWorkingMemory delegates to storage', async () => {
    const { storage } = makeMockStorage();
    (storage.readWorkingMemory as ReturnType<typeof vi.fn>).mockResolvedValue(
      'key info',
    );

    const session = createAgentSession({
      storage,
      sessionId: SESSION_ID,
      agentLoop: vi.fn(),
      provider: STUB_PROVIDER,
      model: MODEL,
      tools: createToolRegistry(),
      systemPrompt: 'sys',
    });

    const result = await session.getWorkingMemory();
    expect(result).toBe('key info');
    expect(storage.readWorkingMemory).toHaveBeenCalledWith(SESSION_ID);
  });

  it('forwards events from agentLoop', async () => {
    const { storage } = makeMockStorage();
    const events: AgentEvent[] = [
      { type: 'agent_start' },
      { type: 'turn_start', turnId: 't1' },
      { type: 'message_end', messageId: 'm1', stopReason: 'end_turn' },
      { type: 'turn_end', turnId: 't1' },
      { type: 'agent_end' },
    ];
    const { fn } = makeMockAgentLoop(events);

    const session = createAgentSession({
      storage,
      sessionId: SESSION_ID,
      agentLoop: fn,
      provider: STUB_PROVIDER,
      model: MODEL,
      tools: createToolRegistry(),
      systemPrompt: 'sys',
    });

    const collected = await collect(session.run('hi'));
    expect(collected.map((e) => e.type)).toEqual(events.map((e) => e.type));
  });
});
