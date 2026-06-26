import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { randomUUID } from 'node:crypto';
import { FileStorage } from '../../../../src/infrastructure/storage/file-storage.js';
import {
  createUpdateWorkingMemoryTool,
  KEY_INFO_MAX_CHARS,
} from '../../../../src/core/tool/tools/update-working-memory.js';

let tmpDir: string;
let sessionId: string;
let storage: FileStorage;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aptbot-wm-'));
  sessionId = randomUUID();
  storage = new FileStorage(tmpDir);
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('updateWorkingMemoryTool', () => {
  it('writes short keyInfo and reports truncated=false', async () => {
    const tool = createUpdateWorkingMemoryTool(storage, sessionId);
    const result = await tool.execute('tc_1', { keyInfo: 'remember the milk' });
    expect(result.error).toBeUndefined();
    expect(result.details.truncated).toBe(false);
    expect(result.details.bytesBefore).toBe(0);
    expect(result.details.bytesAfter).toBeGreaterThan(0);
  });

  it('persists keyInfo so readWorkingMemory returns it', async () => {
    const tool = createUpdateWorkingMemoryTool(storage, sessionId);
    await tool.execute('tc_2', { keyInfo: 'buy groceries' });
    const stored = await storage.readWorkingMemory(sessionId);
    expect(stored).toBe('buy groceries');
  });

  it('truncates keyInfo exceeding 2000 chars and reports truncated=true', async () => {
    const tool = createUpdateWorkingMemoryTool(storage, sessionId);
    const long = 'x'.repeat(KEY_INFO_MAX_CHARS + 500);
    const result = await tool.execute('tc_3', { keyInfo: long });
    expect(result.details.truncated).toBe(true);
    expect(result.details.bytesAfter).toBe(KEY_INFO_MAX_CHARS);
    const stored = await storage.readWorkingMemory(sessionId);
    expect(stored?.length).toBe(KEY_INFO_MAX_CHARS);
  });

  it('overwrites previous keyInfo (monotonic update)', async () => {
    const tool = createUpdateWorkingMemoryTool(storage, sessionId);
    await tool.execute('tc_4a', { keyInfo: 'first' });
    await tool.execute('tc_4b', { keyInfo: 'second' });
    const stored = await storage.readWorkingMemory(sessionId);
    expect(stored).toBe('second');
  });

  it('exposes KEY_INFO_MAX_CHARS = 2000', () => {
    expect(KEY_INFO_MAX_CHARS).toBe(2000);
  });

  it('declares name, label, description, parameters, sequential executionMode', () => {
    const tool = createUpdateWorkingMemoryTool(storage, sessionId);
    expect(tool.name).toBe('update_working_memory');
    expect(tool.label).toBeTruthy();
    expect(tool.description).toBeTruthy();
    expect(tool.parameters).toBeDefined();
    expect(tool.executionMode).toBe('sequential');
  });
});
