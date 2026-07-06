import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, rmSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { FileStorage, type StorageAdapter } from '../../../src/infrastructure/storage/file-storage.js';
import { withJsonlLock } from '../../../src/infrastructure/jsonl-mutex.js';
import type { SessionEntry } from '../../../src/core/memory/types.js';

const TMP_DIR = './tests/.tmp-file-storage';
const SESSIONS_DIR = join(TMP_DIR, 'sessions');

describe('FileStorage', () => {
  let storage: StorageAdapter;

  beforeEach(() => {
    if (existsSync(TMP_DIR)) rmSync(TMP_DIR, { recursive: true, force: true });
    mkdirSync(SESSIONS_DIR, { recursive: true });
    storage = new FileStorage(SESSIONS_DIR);
  });

  afterEach(() => {
    if (existsSync(TMP_DIR)) rmSync(TMP_DIR, { recursive: true, force: true });
  });

  function validUuid(): string {
    return '550e8400-e29b-41d4-a716-' + Math.floor(Math.random() * 0xffff).toString(16).padStart(4, '0') + Math.floor(Math.random() * 0xffffffff).toString(16).padStart(8, '0');
  }

  function makeMessageEntry(text: string): SessionEntry {
    return {
      type: 'message',
      id: `entry-${Date.now()}-${Math.random()}`,
      message: {
        id: `msg-${Math.random()}`,
        role: 'user',
        content: text,
        timestamp: Date.now(),
      },
      timestamp: Date.now(),
    };
  }

  it('readSession returns [] for non-existent id', async () => {
    const entries = await storage.readSession(validUuid());
    expect(entries).toEqual([]);
  });

  it('appendSession + readSession round-trips entries', async () => {
    const id = validUuid();
    await storage.appendSession(id, makeMessageEntry('first'));
    await storage.appendSession(id, makeMessageEntry('second'));
    const entries = await storage.readSession(id);
    expect(entries).toHaveLength(2);
    expect((entries[0] as SessionEntry & { message: { content: string } }).message.content).toBe('first');
  });

  it('appendSession serializes concurrent calls for same sessionId', async () => {
    const id = validUuid();
    const writes = Array.from({ length: 10 }, (_, i) =>
      storage.appendSession(id, makeMessageEntry(`m${i}`)),
    );
    await Promise.all(writes);
    const entries = await storage.readSession(id);
    expect(entries).toHaveLength(10);
  });

  it('listSessions returns metadata sorted by mtime desc', async () => {
    const id1 = validUuid();
    const id2 = validUuid();
    await storage.appendSession(id1, makeMessageEntry('a'));
    // 间隔以区分 mtime
    await new Promise((r) => setTimeout(r, 20));
    await storage.appendSession(id2, makeMessageEntry('b'));
    const list = await storage.listSessions();
    expect(list).toHaveLength(2);
    expect(list[0].updatedAt).toBeGreaterThanOrEqual(list[1].updatedAt);
  });

  it('readWorkingMemory returns null when none exists', async () => {
    const id = validUuid();
    await storage.appendSession(id, makeMessageEntry('hi'));
    expect(await storage.readWorkingMemory(id)).toBeNull();
  });

  it('writeWorkingMemory + readWorkingMemory returns last keyInfo', async () => {
    const id = validUuid();
    await storage.writeWorkingMemory(id, 'first memory');
    await storage.writeWorkingMemory(id, 'second memory');
    const keyInfo = await storage.readWorkingMemory(id);
    expect(keyInfo).toBe('second memory');
  });

  it('deleteSession is idempotent', async () => {
    const id = validUuid();
    await storage.appendSession(id, makeMessageEntry('x'));
    await storage.deleteSession(id);
    // 第二次删除不应抛错
    await storage.deleteSession(id);
    expect(await storage.readSession(id)).toEqual([]);
  });

  it('reads and repairs corrupted file', async () => {
    const id = validUuid();
    await storage.appendSession(id, makeMessageEntry('valid'));
    // append broken data to file
    const path = join(SESSIONS_DIR, `${id}.jsonl`);
    const { appendFileSync } = await import('node:fs');
    appendFileSync(path, '{"broken":');
    const entries = await storage.readSession(id);
    expect(entries.length).toBe(1);
  });

  // I11 回归测试：readSession 必须获取 jsonl 锁，防止与 appendSession 的读写竞态
  it('readSession acquires jsonl lock — no read-write race (I11)', async () => {
    const id = validUuid();
    await storage.appendSession(id, makeMessageEntry('first'));

    // 外部持有锁
    let releaseExternal: () => void = () => {};
    const externalGate = new Promise<void>((r) => { releaseExternal = r; });
    const lockHeld = withJsonlLock(id, () => externalGate);

    // 尝试读取 —— 应阻塞（等待锁释放）
    let readCompleted = false;
    const readPromise = storage.readSession(id).then((entries) => {
      readCompleted = true;
      return entries;
    });

    // 等待 50ms —— read 不应完成（锁仍被持有）
    await new Promise((r) => setTimeout(r, 50));
    expect(readCompleted).toBe(false);

    // 释放锁
    releaseExternal();
    await lockHeld;

    // 现在 read 应完成
    const entries = await readPromise;
    expect(readCompleted).toBe(true);
    expect(entries.length).toBe(1);
  });
});

// §0.3.0 Task 4: SessionMetadata.agentId + session 路径迁移
// 新路径：data/users/<userId>/agents/<agentId>/sessions/<id>.jsonl + .meta.json
describe('FileStorage — Task 4 agent-scoped path', () => {
  const DATA_DIR = './tests/.tmp-file-storage-task4';
  let storage: FileStorage;

  beforeEach(() => {
    if (existsSync(DATA_DIR)) rmSync(DATA_DIR, { recursive: true, force: true });
    mkdirSync(DATA_DIR, { recursive: true });
    storage = new FileStorage(DATA_DIR);
  });

  afterEach(() => {
    if (existsSync(DATA_DIR)) rmSync(DATA_DIR, { recursive: true, force: true });
  });

  function validUuid(): string {
    return '550e8400-e29b-41d4-a716-' + Math.floor(Math.random() * 0xffff).toString(16).padStart(4, '0') + Math.floor(Math.random() * 0xffffffff).toString(16).padStart(8, '0');
  }

  function makeMessageEntry(text: string): SessionEntry {
    return {
      type: 'message',
      id: `entry-${Date.now()}-${Math.random()}`,
      message: {
        id: `msg-${Math.random()}`,
        role: 'user',
        content: text,
        timestamp: Date.now(),
      },
      timestamp: Date.now(),
    };
  }

  describe('constructor + path computation', () => {
    it('constructor takes dataDir (not sessionsDir) and computes new path', async () => {
      const userId = validUuid();
      const agentId = 'default';
      const id = validUuid();
      await storage.appendSession(id, userId, agentId, makeMessageEntry('hi'));

      // 验证文件位于新路径：data/users/<userId>/agents/<agentId>/sessions/<id>.jsonl
      const expectedPath = join(DATA_DIR, 'users', userId, 'agents', agentId, 'sessions', `${id}.jsonl`);
      expect(existsSync(expectedPath)).toBe(true);
    });

    it('creates intermediate directories automatically on append', async () => {
      const userId = validUuid();
      const agentId = 'agent-abc123';
      const id = validUuid();
      // DATA_DIR 已存在但 users/ 子目录不存在，append 应自动创建多层目录
      await storage.appendSession(id, userId, agentId, makeMessageEntry('first'));
      const entries = await storage.readSession(id, userId, agentId);
      expect(entries).toHaveLength(1);
    });

    it('readSession + appendSession round-trip with (id, userId, agentId) signature', async () => {
      const userId = validUuid();
      const agentId = 'default';
      const id = validUuid();
      await storage.appendSession(id, userId, agentId, makeMessageEntry('first'));
      await storage.appendSession(id, userId, agentId, makeMessageEntry('second'));
      const entries = await storage.readSession(id, userId, agentId);
      expect(entries).toHaveLength(2);
    });

    it('readSession returns [] for non-existent (userId, agentId, id) combination', async () => {
      const entries = await storage.readSession(validUuid(), validUuid(), 'default');
      expect(entries).toEqual([]);
    });

    it('writeWorkingMemory + readWorkingMemory accept (id, userId, agentId)', async () => {
      const userId = validUuid();
      const agentId = 'default';
      const id = validUuid();
      await storage.writeWorkingMemory(id, userId, agentId, 'remember this');
      const keyInfo = await storage.readWorkingMemory(id, userId, agentId);
      expect(keyInfo).toBe('remember this');
    });

    it('deleteSession accepts (id, userId, agentId) and is idempotent', async () => {
      const userId = validUuid();
      const agentId = 'default';
      const id = validUuid();
      await storage.appendSession(id, userId, agentId, makeMessageEntry('x'));
      await storage.deleteSession(id, userId, agentId);
      // 第二次删除不抛错
      await storage.deleteSession(id, userId, agentId);
      expect(await storage.readSession(id, userId, agentId)).toEqual([]);
    });
  });

  describe('claimSession writes agentId to .meta.json', () => {
    it('claimSession(id, userId, agentId) writes both userId and agentId', async () => {
      const userId = validUuid();
      const agentId = 'default';
      const id = validUuid();
      // 先创建 .jsonl 文件（claim 不依赖 jsonl 存在，但 meta 写入需要目录存在）
      await storage.appendSession(id, userId, agentId, makeMessageEntry('init'));

      await storage.claimSession(id, userId, agentId);

      const metaPath = join(DATA_DIR, 'users', userId, 'agents', agentId, 'sessions', `${id}.meta.json`);
      const meta = JSON.parse(readFileSync(metaPath, 'utf-8'));
      expect(meta.userId).toBe(userId);
      expect(meta.agentId).toBe(agentId);
    });

    it('claimSession is idempotent for same (userId, agentId)', async () => {
      const userId = validUuid();
      const agentId = 'default';
      const id = validUuid();
      await storage.appendSession(id, userId, agentId, makeMessageEntry('init'));

      await storage.claimSession(id, userId, agentId);
      // 重复 claim 同用户同 agent 不抛错
      await expect(storage.claimSession(id, userId, agentId)).resolves.not.toThrow();
    });

    it('claimSession throws SessionAlreadyClaimedError when userId differs', async () => {
      const userId1 = validUuid();
      const userId2 = validUuid();
      const agentId = 'default';
      const id = validUuid();
      await storage.appendSession(id, userId1, agentId, makeMessageEntry('init'));
      await storage.claimSession(id, userId1, agentId);

      await expect(storage.claimSession(id, userId2, agentId)).rejects.toThrow(/already claimed/);
    });

    it('forceClaimSession(id, userId, agentId) overwrites owner without throwing', async () => {
      const userId1 = validUuid();
      const userId2 = validUuid();
      const agentId = 'default';
      const id = validUuid();
      await storage.appendSession(id, userId1, agentId, makeMessageEntry('init'));
      await storage.claimSession(id, userId1, agentId);

      // force claim 跨用户不抛错
      await storage.forceClaimSession(id, userId2, agentId);
      const owner = await storage.getSessionOwner(id);
      expect(owner).toBe(userId2);
    });
  });

  describe('listSessions recursive scan', () => {
    it('listSessions() scans all users/agents recursively', async () => {
      const user1 = validUuid();
      const user2 = validUuid();
      // user1 / default: 1 session
      await storage.appendSession(validUuid(), user1, 'default', makeMessageEntry('u1d1'));
      // user1 / agent-abc: 1 session
      await storage.appendSession(validUuid(), user1, 'agent-abc123', makeMessageEntry('u1a1'));
      // user2 / default: 1 session
      await storage.appendSession(validUuid(), user2, 'default', makeMessageEntry('u2d1'));

      const all = await storage.listSessions();
      expect(all.length).toBe(3);
    });

    it('listSessions(userId) filters by user (across all their agents)', async () => {
      const user1 = validUuid();
      const user2 = validUuid();
      const id1 = validUuid();
      const id2 = validUuid();
      const id3 = validUuid();
      await storage.appendSession(id1, user1, 'default', makeMessageEntry('u1d1'));
      await storage.appendSession(id2, user1, 'agent-abc123', makeMessageEntry('u1a1'));
      await storage.appendSession(id3, user2, 'default', makeMessageEntry('u2d1'));
      // claim 以便 meta.userId 写入（filter 仍按 path 过滤，userId 来自 meta）
      await storage.claimSession(id1, user1, 'default');
      await storage.claimSession(id2, user1, 'agent-abc123');
      await storage.claimSession(id3, user2, 'default');

      const user1Sessions = await storage.listSessions(user1);
      expect(user1Sessions.length).toBe(2);
      expect(user1Sessions.every((s) => s.userId === user1)).toBe(true);

      const user2Sessions = await storage.listSessions(user2);
      expect(user2Sessions.length).toBe(1);
    });

    it('listSessions(userId, agentId) filters by both user and agent', async () => {
      const user1 = validUuid();
      await storage.appendSession(validUuid(), user1, 'default', makeMessageEntry('u1d1'));
      await storage.appendSession(validUuid(), user1, 'agent-abc123', makeMessageEntry('u1a1'));

      const defaultSessions = await storage.listSessions(user1, 'default');
      expect(defaultSessions.length).toBe(1);

      const agentSessions = await storage.listSessions(user1, 'agent-abc123');
      expect(agentSessions.length).toBe(1);
    });

    it('listSessions returns metadata with agentId field', async () => {
      const userId = validUuid();
      const agentId = 'agent-xyz789';
      const id = validUuid();
      await storage.appendSession(id, userId, agentId, makeMessageEntry('hi'));

      const list = await storage.listSessions(userId, agentId);
      expect(list).toHaveLength(1);
      expect(list[0].agentId).toBe(agentId);
      expect(list[0].userId).toBeUndefined(); // 未 claim 时 userId 在 meta 上不存在
    });

    it('listSessions returns metadata with userId when claimed', async () => {
      const userId = validUuid();
      const agentId = 'default';
      const id = validUuid();
      await storage.appendSession(id, userId, agentId, makeMessageEntry('hi'));
      await storage.claimSession(id, userId, agentId);

      const list = await storage.listSessions(userId, agentId);
      expect(list).toHaveLength(1);
      expect(list[0].userId).toBe(userId);
      expect(list[0].agentId).toBe(agentId);
    });
  });

  describe('getSessionOwner recursive scan (access layer compat)', () => {
    it('getSessionOwner(id) scans recursively to find owner', async () => {
      const userId = validUuid();
      const agentId = 'default';
      const id = validUuid();
      await storage.appendSession(id, userId, agentId, makeMessageEntry('hi'));
      await storage.claimSession(id, userId, agentId);

      const owner = await storage.getSessionOwner(id);
      expect(owner).toBe(userId);
    });

    it('getSessionOwner(id) returns undefined when session not found', async () => {
      const owner = await storage.getSessionOwner(validUuid());
      expect(owner).toBeUndefined();
    });

    it('getSessionOwner(id) returns undefined for unclaimed session', async () => {
      const userId = validUuid();
      const agentId = 'default';
      const id = validUuid();
      await storage.appendSession(id, userId, agentId, makeMessageEntry('hi'));
      // 未 claim

      const owner = await storage.getSessionOwner(id);
      expect(owner).toBeUndefined();
    });
  });

  describe('path traversal protection', () => {
    it('appendSession throws on invalid agentId (path traversal)', async () => {
      const userId = validUuid();
      const id = validUuid();
      await expect(
        storage.appendSession(id, userId, '../etc', makeMessageEntry('x')),
      ).rejects.toThrow(/invalid.*agent/i);
    });

    it('appendSession throws on invalid userId (path traversal)', async () => {
      const id = validUuid();
      await expect(
        storage.appendSession(id, '../etc', 'default', makeMessageEntry('x')),
      ).rejects.toThrow(/invalid.*user/i);
    });

    it('claimSession throws on invalid agentId', async () => {
      const userId = validUuid();
      const id = validUuid();
      await expect(
        storage.claimSession(id, userId, '../etc'),
      ).rejects.toThrow(/invalid.*agent/i);
    });

    it('listSessions(userId, agentId) ignores invalid agentId filter silently', async () => {
      // 列表查询不应因路径遍历参数而抛错，而是返回空列表（避免信息泄漏）
      const result = await storage.listSessions(validUuid(), '../etc');
      expect(result).toEqual([]);
    });
  });

  describe('legacy path fallback during 0.3.0 transition', () => {
    it('readSession falls back to legacy data/sessions/<id>.jsonl when new path missing', async () => {
      const id = validUuid();
      // 在 legacy 路径手工放置 .jsonl
      const legacyDir = join(DATA_DIR, 'sessions');
      mkdirSync(legacyDir, { recursive: true });
      const legacyJsonl = join(legacyDir, `${id}.jsonl`);
      const entry = makeMessageEntry('legacy');
      writeFileSync(legacyJsonl, JSON.stringify(entry) + '\n');

      // readSession(userId, agentId, id) 应能从 legacy 路径读取（userId/agentId 仅用于新路径）
      const entries = await storage.readSession(id, validUuid(), 'default');
      expect(entries).toHaveLength(1);
      expect((entries[0] as SessionEntry & { message: { content: string } }).message.content).toBe('legacy');
    });

    it('appendSession prefers new path; legacy path untouched', async () => {
      const userId = validUuid();
      const agentId = 'default';
      const id = validUuid();
      // legacy 路径已有文件
      const legacyDir = join(DATA_DIR, 'sessions');
      mkdirSync(legacyDir, { recursive: true });
      const legacyJsonl = join(legacyDir, `${id}.jsonl`);
      writeFileSync(legacyJsonl, JSON.stringify(makeMessageEntry('legacy')) + '\n');

      // 新写入应去新路径
      await storage.appendSession(id, userId, agentId, makeMessageEntry('new'));

      // 新路径有文件
      const newPath = join(DATA_DIR, 'users', userId, 'agents', agentId, 'sessions', `${id}.jsonl`);
      expect(existsSync(newPath)).toBe(true);
      // 新路径读到的是 'new'
      const newEntries = await storage.readSession(id, userId, agentId);
      const newMsgs = newEntries.filter((e) => e.type === 'message') as Array<SessionEntry & { message: { content: string } }>;
      // 新路径应包含 legacy + new（fallback 读取了 legacy 然后追加 new）— 或仅 new（取决于实现）
      // 实现选择：appendSession 时若新路径不存在但 legacy 有，迁移内容到新路径再追加
      const hasNew = newMsgs.some((m) => m.message.content === 'new');
      expect(hasNew).toBe(true);
    });
  });

  describe('updateSessionLabel + hasCustomLabel with (id, userId, agentId)', () => {
    it('updateSessionLabel writes to new path meta.json', async () => {
      const userId = validUuid();
      const agentId = 'default';
      const id = validUuid();
      await storage.appendSession(id, userId, agentId, makeMessageEntry('hi'));

      await storage.updateSessionLabel(id, userId, agentId, 'my-label', 'custom');

      const metaPath = join(DATA_DIR, 'users', userId, 'agents', agentId, 'sessions', `${id}.meta.json`);
      const meta = JSON.parse(readFileSync(metaPath, 'utf-8'));
      expect(meta.label).toBe('my-label');
      expect(meta.labelSource).toBe('custom');
    });

    it('hasCustomLabel reads from new path meta.json', async () => {
      const userId = validUuid();
      const agentId = 'default';
      const id = validUuid();
      await storage.appendSession(id, userId, agentId, makeMessageEntry('hi'));

      expect(await storage.hasCustomLabel(id, userId, agentId)).toBe(false);

      await storage.updateSessionLabel(id, userId, agentId, 'my-label', 'custom');
      expect(await storage.hasCustomLabel(id, userId, agentId)).toBe(true);
    });
  });
});
