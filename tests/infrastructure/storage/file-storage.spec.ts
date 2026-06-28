import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, rmSync, mkdirSync } from 'node:fs';
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
