import { describe, it, expect, vi } from 'vitest';
import {
  compact,
  shouldCompact,
  findCutPoint,
  estimateTokens,
  DEFAULT_COMPACTION_SETTINGS,
  COMPACTION_TRIGGER_RATIO,
  COMPACTION_TARGET_RATIO,
  COMPACTION_MAX_TOKENS,
} from '../../../src/core/memory/compaction.js';
import type { SessionEntry } from '../../../src/core/memory/types.js';
import type { AgentMessage } from '../../../src/core/memory/agent-message.js';
import type { StorageAdapter } from '../../../src/infrastructure/storage/file-storage.js';
import type { Provider, Model, AssistantMessageEvent } from '../../../src/core/provider/types.js';

const MODEL: Model = {
  provider: 'mock',
  id: 'mock-1',
  api: 'openai-responses',
  contextWindow: 8000,
  maxTokens: 1000,
};

const SESSION_ID = '01234567-89ab-cdef-0123-456789abcdef';

function msg(id: string, role: 'user' | 'assistant' | 'tool', content: string, timestamp: number): SessionEntry {
  return {
    type: 'message',
    id,
    message: { id, role, content, timestamp },
    timestamp,
  };
}

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

function makeMockProvider(events: AssistantMessageEvent[]): Provider {
  return {
    id: 'mock',
    name: 'Mock',
    auth: {},
    getModels: () => [MODEL],
    stream: async function* () {
      for (const e of events) yield e;
    },
  };
}

const FAILING_PROVIDER: Provider = {
  id: 'fail',
  name: 'Fail',
  auth: {},
  getModels: () => [MODEL],
  stream: async function* () {
    yield {
      type: 'error',
      error: { message: 'llm_error', retryable: false },
    };
  },
};

describe('Compaction', () => {
  it('exposes correct constants', () => {
    expect(COMPACTION_TRIGGER_RATIO).toBe(0.8);
    expect(COMPACTION_TARGET_RATIO).toBe(0.3);
    expect(COMPACTION_MAX_TOKENS).toBe(2048);
    expect(DEFAULT_COMPACTION_SETTINGS.enabled).toBe(true);
    expect(DEFAULT_COMPACTION_SETTINGS.keepRecentTokens).toBeGreaterThan(0);
  });

  it('shouldCompact triggers at 80% threshold', () => {
    expect(shouldCompact(8000, 10000, DEFAULT_COMPACTION_SETTINGS)).toBe(true);
    expect(shouldCompact(7999, 10000, DEFAULT_COMPACTION_SETTINGS)).toBe(false);
  });

  it('shouldCompact returns false when disabled', () => {
    expect(
      shouldCompact(99999, 10000, { ...DEFAULT_COMPACTION_SETTINGS, enabled: false }),
    ).toBe(false);
  });

  it('findCutPoint finds user message boundary', () => {
    const entries: SessionEntry[] = [
      msg('1', 'user', 'x'.repeat(500), 1),
      msg('2', 'assistant', 'y'.repeat(500), 2),
      msg('3', 'user', 'recent question', 3),
      msg('4', 'assistant', 'recent answer', 4),
    ];
    const cut = findCutPoint(entries, 50);
    expect(cut).toBe(2);
  });

  it('findCutPoint returns 0 when all entries fit', () => {
    const entries: SessionEntry[] = [
      msg('1', 'user', 'short', 1),
      msg('2', 'assistant', 'short', 2),
    ];
    const cut = findCutPoint(entries, 9999);
    expect(cut).toBe(0);
  });

  it('compact success appends compaction entry', async () => {
    const { storage, appended } = makeMockStorage();
    const provider = makeMockProvider([
      { type: 'text', text: 'Summary of conversation' },
      { type: 'stop', stopReason: 'end_turn' },
    ]);
    const entries: SessionEntry[] = [
      msg('1', 'user', 'x'.repeat(500), 1),
      msg('2', 'assistant', 'y'.repeat(500), 2),
      msg('3', 'user', 'recent', 3),
      msg('4', 'assistant', 'recent', 4),
    ];

    const result = await compact(entries, null, MODEL, provider, storage, SESSION_ID);

    expect(result.success).toBe(true);
    const compactionEntries = appended.filter((e) => e.type === 'compaction');
    expect(compactionEntries.length).toBe(1);
    if (compactionEntries[0].type === 'compaction') {
      expect(compactionEntries[0].summary).toContain('Summary');
      expect(compactionEntries[0].firstKeptEntryId).toBe('3');
    }
  });

  it('compact LLM failure returns success=false and keeps entries intact', async () => {
    const { storage, appended } = makeMockStorage();
    const entries: SessionEntry[] = [
      msg('1', 'user', 'x'.repeat(500), 1),
      msg('2', 'assistant', 'y'.repeat(500), 2),
      msg('3', 'user', 'recent', 3),
      msg('4', 'assistant', 'recent', 4),
    ];

    const result = await compact(entries, null, MODEL, FAILING_PROVIDER, storage, SESSION_ID);

    expect(result.success).toBe(false);
    expect(result.reason).toBe('llm_failed');
    expect(appended.length).toBe(0);
  });

  it('estimateTokens uses chars/4 fallback', () => {
    const messages: AgentMessage[] = [
      { id: '1', role: 'user', content: 'hello world', timestamp: 1 },
    ];
    const tokens = estimateTokens(messages, MODEL);
    // 'hello world' = 11 chars → ceil(11/4) = 3
    expect(tokens).toBe(3);
  });

  it('estimateTokens sums multiple messages', () => {
    const messages: AgentMessage[] = [
      { id: '1', role: 'user', content: 'hello', timestamp: 1 },
      { id: '2', role: 'assistant', content: 'world', timestamp: 2 },
    ];
    const tokens = estimateTokens(messages, MODEL);
    // 'hello' (5) + 'world' (5) = 10 chars → ceil(10/4) = 3
    expect(tokens).toBe(3);
  });
});
