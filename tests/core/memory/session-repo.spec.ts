import { describe, it, expect, vi } from 'vitest';
import { createSessionRepo } from '../../../src/core/memory/session-repo.js';
import type { StorageAdapter } from '../../../src/infrastructure/storage/file-storage.js';
import type { SessionEntry, SessionMetadata } from '../../../src/core/memory/types.js';
import { isValidSessionId } from '../../../src/core/memory/types.js';

function makeMockStorage() {
  const sessions = new Map<string, SessionEntry[]>();
  const storage: StorageAdapter = {
    readSession: vi.fn(async (id: string) => sessions.get(id) ?? []),
    appendSession: vi.fn(async (id: string, entry: SessionEntry) => {
      const entries = sessions.get(id) ?? [];
      entries.push(entry);
      sessions.set(id, entries);
    }),
    listSessions: vi.fn(async (): Promise<SessionMetadata[]> => {
      const metas: SessionMetadata[] = [];
      for (const [id, entries] of sessions) {
        const last = entries[entries.length - 1];
        metas.push({
          id,
          createdAt: entries[0]?.timestamp ?? 0,
          updatedAt: last?.timestamp ?? 0,
          agentId: 'default',
        });
      }
      return metas;
    }),
    readWorkingMemory: vi.fn(async () => null),
    writeWorkingMemory: vi.fn(async () => {}),
    deleteSession: vi.fn(async (id: string) => {
      sessions.delete(id);
    }),
    // §0.3.0 Task 4: claimSession / forceClaimSession / updateSessionLabel / hasCustomLabel / getSessionOwner
    // mock 为 no-op，仅在 create(userId, agentId) 时被 spy 验证调用
    claimSession: vi.fn(async () => {}),
    forceClaimSession: vi.fn(async () => {}),
    updateSessionLabel: vi.fn(async () => {}),
    hasCustomLabel: vi.fn(async () => false),
    getSessionOwner: vi.fn(async () => undefined),
  };
  return { storage, sessions };
}

describe('SessionRepo', () => {
  it('create returns a new session with valid UUID', async () => {
    const { storage } = makeMockStorage();
    const repo = createSessionRepo(storage);

    const session = await repo.create();

    expect(isValidSessionId(session.id)).toBe(true);
    expect(session.metadata.id).toBe(session.id);
    expect(session.metadata.createdAt).toBeGreaterThan(0);
    expect(session.metadata.updatedAt).toBeGreaterThan(0);
  });

  it('open with non-existent id creates new session (idempotent)', async () => {
    const { storage } = makeMockStorage();
    const repo = createSessionRepo(storage);

    const id = '01234567-89ab-cdef-0123-456789abcdef';
    const session = await repo.open(id);

    expect(session.id).toBe(id);
    const entries = await session.getEntries();
    expect(entries).toEqual([]);
  });

  it('open with existing id loads entries', async () => {
    const { storage, sessions } = makeMockStorage();
    const repo = createSessionRepo(storage);

    const id = '01234567-89ab-cdef-0123-456789abcdef';
    const existing: SessionEntry = {
      type: 'message',
      id: 'm1',
      message: { id: 'm1', role: 'user', content: 'old', timestamp: 100 },
      timestamp: 100,
    };
    sessions.set(id, [existing]);

    const session = await repo.open(id);
    const entries = await session.getEntries();
    expect(entries).toHaveLength(1);
    expect(entries[0]).toEqual(existing);
  });

  it('list returns array of session metadata', async () => {
    const { storage } = makeMockStorage();
    const repo = createSessionRepo(storage);

    const s1 = await repo.create();
    await s1.append({
      type: 'message',
      id: 'm1',
      message: { id: 'm1', role: 'user', content: 'hi', timestamp: 1 },
      timestamp: 1,
    });

    const s2 = await repo.create();
    await s2.append({
      type: 'message',
      id: 'm2',
      message: { id: 'm2', role: 'user', content: 'hi', timestamp: 2 },
      timestamp: 2,
    });

    const list = await repo.list();
    expect(Array.isArray(list)).toBe(true);
    expect(list.length).toBe(2);
  });

  it('delete removes session and is idempotent', async () => {
    const { storage } = makeMockStorage();
    const repo = createSessionRepo(storage);

    const session = await repo.create();
    await repo.delete(session.id);

    const list = await repo.list();
    expect(list.find((m) => m.id === session.id)).toBeUndefined();

    await expect(repo.delete(session.id)).resolves.not.toThrow();
  });

  it('Session.append delegates to storage', async () => {
    const { storage } = makeMockStorage();
    const repo = createSessionRepo(storage);

    const session = await repo.create();
    const entry: SessionEntry = {
      type: 'message',
      id: 'msg1',
      message: { id: 'msg1', role: 'user', content: 'hi', timestamp: 1 },
      timestamp: 1,
    };

    await session.append(entry);

    expect(storage.appendSession).toHaveBeenCalledWith(session.id, entry);
    const entries = await session.getEntries();
    expect(entries).toHaveLength(1);
  });

  // §0.3.0 Task 4: create/open 接受 agentId 参数
  describe('Task 4: create/open with agentId', () => {
    it('create(userId, agentId) calls claimSession with (id, userId, agentId)', async () => {
      const { storage } = makeMockStorage();
      const repo = createSessionRepo(storage);

      const userId = '01234567-89ab-cdef-0123-456789abcdef';
      const agentId = 'default';
      const session = await repo.create(userId, agentId);

      expect(storage.claimSession).toHaveBeenCalledWith(session.id, userId, agentId);
    });

    it('create(userId, agentId) returns session with metadata.agentId set', async () => {
      const { storage } = makeMockStorage();
      const repo = createSessionRepo(storage);

      const userId = '01234567-89ab-cdef-0123-456789abcdef';
      const agentId = 'agent-abc123';
      const session = await repo.create(userId, agentId);

      expect(session.metadata.agentId).toBe(agentId);
    });

    it('create() without args defaults agentId to "default"', async () => {
      const { storage } = makeMockStorage();
      const repo = createSessionRepo(storage);

      const session = await repo.create();

      // 无 userId 时不调用 claimSession；agentId 仍默认 'default'
      expect(storage.claimSession).not.toHaveBeenCalled();
      expect(session.metadata.agentId).toBe('default');
    });

    it('create(userId) without agentId defaults agentId to "default"', async () => {
      const { storage } = makeMockStorage();
      const repo = createSessionRepo(storage);

      const userId = '01234567-89ab-cdef-0123-456789abcdef';
      const session = await repo.create(userId);

      expect(storage.claimSession).toHaveBeenCalledWith(session.id, userId, 'default');
      expect(session.metadata.agentId).toBe('default');
    });

    it('open(id, userId, agentId) calls claimSession with (id, userId, agentId)', async () => {
      const { storage } = makeMockStorage();
      const repo = createSessionRepo(storage);

      const id = '01234567-89ab-cdef-0123-456789abcdef';
      const userId = '11234567-89ab-cdef-0123-456789abcdef';
      const agentId = 'agent-xyz789';
      const session = await repo.open(id, userId, agentId);

      expect(session.id).toBe(id);
      expect(session.metadata.agentId).toBe(agentId);
      expect(storage.claimSession).toHaveBeenCalledWith(id, userId, agentId);
    });

    it('open(id) without userId/agentId does not call claimSession; agentId defaults to "default"', async () => {
      const { storage } = makeMockStorage();
      const repo = createSessionRepo(storage);

      const id = '01234567-89ab-cdef-0123-456789abcdef';
      const session = await repo.open(id);

      expect(storage.claimSession).not.toHaveBeenCalled();
      expect(session.metadata.agentId).toBe('default');
    });
  });
});
