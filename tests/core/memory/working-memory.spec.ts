import { describe, it, expect, vi } from 'vitest';
import {
  inheritWorkingMemory,
  loadWorkingMemory,
} from '../../../src/core/memory/working-memory.js';
import type { StorageAdapter } from '../../../src/infrastructure/storage/file-storage.js';
import type { SessionEntry } from '../../../src/core/memory/types.js';

const SOURCE_ID = '01234567-89ab-cdef-0123-456789abcdef';
const TARGET_ID = '11111111-2222-3333-4444-555555555555';

function wmEntry(id: string, keyInfo: string, timestamp: number): SessionEntry {
  return { type: 'working_memory', id, keyInfo, timestamp };
}

function makeMockStorage(entriesBySession: Record<string, SessionEntry[]> = {}) {
  const store: Record<string, SessionEntry[]> = JSON.parse(JSON.stringify(entriesBySession));
  const storage: StorageAdapter = {
    readSession: vi.fn(async (id: string) => store[id] ?? []),
    appendSession: vi.fn(async (id: string, entry: SessionEntry) => {
      if (!store[id]) store[id] = [];
      store[id].push(entry);
    }),
    listSessions: vi.fn(async () => []),
    readWorkingMemory: vi.fn(async (sessionId: string) => {
      const entries = store[sessionId] ?? [];
      for (let i = entries.length - 1; i >= 0; i--) {
        const entry = entries[i];
        if (entry.type === 'working_memory') return entry.keyInfo;
      }
      return null;
    }),
    writeWorkingMemory: vi.fn(async (sessionId: string, keyInfo: string) => {
      const entry: SessionEntry = {
        type: 'working_memory',
        id: `wm-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        keyInfo,
        timestamp: Date.now(),
      };
      if (!store[sessionId]) store[sessionId] = [];
      store[sessionId].push(entry);
    }),
    deleteSession: vi.fn(async () => {}),
  };
  return { storage, store };
}

describe('WorkingMemory', () => {
  it('inheritWorkingMemory inherits keyInfo from source with working memory', async () => {
    const { storage } = makeMockStorage({
      [SOURCE_ID]: [wmEntry('wm-1', 'user likes TypeScript', 100)],
    });

    const result = await inheritWorkingMemory(SOURCE_ID, TARGET_ID, storage);

    expect(result.keyInfo).toBe('user likes TypeScript');
    expect(result.passedSessions).toBeGreaterThanOrEqual(1);
    expect(result.inheritedFrom).toBe(SOURCE_ID);
  });

  it('inheritWorkingMemory still increments passedSessions when source has no working memory', async () => {
    const { storage } = makeMockStorage({
      [SOURCE_ID]: [],
    });

    const result = await inheritWorkingMemory(SOURCE_ID, TARGET_ID, storage);

    expect(result.keyInfo).toBe('');
    expect(result.passedSessions).toBeGreaterThanOrEqual(1);
    expect(result.inheritedFrom).toBe(SOURCE_ID);
  });

  it('loadWorkingMemory returns last working_memory entry', async () => {
    const { storage } = makeMockStorage({
      [SOURCE_ID]: [
        wmEntry('wm-1', 'old key info', 100),
        wmEntry('wm-2', 'new key info', 200),
      ],
    });

    const result = await loadWorkingMemory(SOURCE_ID, storage);

    expect(result).not.toBeNull();
    expect(result!.keyInfo).toBe('new key info');
  });

  it('loadWorkingMemory returns null when no working_memory entry', async () => {
    const { storage } = makeMockStorage({
      [SOURCE_ID]: [],
    });

    const result = await loadWorkingMemory(SOURCE_ID, storage);

    expect(result).toBeNull();
  });

  it('after inherit, target can read back the inherited keyInfo', async () => {
    const { storage } = makeMockStorage({
      [SOURCE_ID]: [wmEntry('wm-1', 'remember: prefers dark mode', 100)],
    });

    await inheritWorkingMemory(SOURCE_ID, TARGET_ID, storage);
    const loaded = await loadWorkingMemory(TARGET_ID, storage);

    expect(loaded).not.toBeNull();
    expect(loaded!.keyInfo).toBe('remember: prefers dark mode');
  });

  it('passedSessions accumulates across chained inheritance', async () => {
    const { storage } = makeMockStorage({
      [SOURCE_ID]: [wmEntry('wm-1', 'base info', 100)],
    });

    const first = await inheritWorkingMemory(SOURCE_ID, TARGET_ID, storage);
    const THIRD_ID = '33333333-3333-3333-3333-333333333333';
    const second = await inheritWorkingMemory(TARGET_ID, THIRD_ID, storage);

    expect(second.passedSessions).toBeGreaterThan(first.passedSessions);
  });
});
