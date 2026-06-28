import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { FileStorage } from '../../src/infrastructure/storage/file-storage.js';
import { resolveSessionId } from '../../src/server.js';
import type { SessionEntry } from '../../src/core/memory/types.js';

const VALID_UUID = '01234567-89ab-cdef-0123-456789abcdef';
const VALID_UUID_2 = '01234567-89ab-cdef-0123-456789abcde0';

function makeEntry(id: string, role: 'user' | 'assistant', content: string, timestamp: number): SessionEntry {
  return {
    type: 'message',
    id,
    message: { id, role, content, timestamp },
    timestamp,
  };
}

describe('resolveSessionId (I4)', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'aptbot-resolve-'));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('returns existing most-recent session id when sessions exist', async () => {
    const sessionsDir = join(tempDir, 'sessions');
    mkdirSync(sessionsDir, { recursive: true });
    // 旧 session（updatedAt 较早）
    writeFileSync(
      join(sessionsDir, `${VALID_UUID_2}.jsonl`),
      JSON.stringify(makeEntry('1', 'user', 'old', 1)) + '\n',
    );
    // 新 session（updatedAt 较晚）—— 写入后 touch mtime 延迟
    await new Promise((r) => setTimeout(r, 20));
    writeFileSync(
      join(sessionsDir, `${VALID_UUID}.jsonl`),
      JSON.stringify(makeEntry('2', 'user', 'recent', 2)) + '\n',
    );

    const storage = new FileStorage(sessionsDir);
    const id = await resolveSessionId(storage);
    expect(id).toBe(VALID_UUID);
  });

  it('returns a new UUID when no sessions exist', async () => {
    const sessionsDir = join(tempDir, 'sessions');
    mkdirSync(sessionsDir, { recursive: true });
    const storage = new FileStorage(sessionsDir);
    const id = await resolveSessionId(storage);
    // 应为合法 UUID v4 格式
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  });

  it('returns a new UUID when sessions dir does not exist', async () => {
    const storage = new FileStorage(join(tempDir, 'nonexistent'));
    const id = await resolveSessionId(storage);
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  });
});
