import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { Mutex } from 'async-mutex';
import { editTool, EDIT_TIMEOUT_MS, acquireWithTimeout } from '../../../../src/core/tool/tools/edit.js';

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aptbot-edit-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('editTool', () => {
  it('replaces oldString with newString and reports byte delta', async () => {
    const file = path.join(tmpDir, 'a.txt');
    fs.writeFileSync(file, 'hello world');
    const result = await editTool.execute('tc_1', {
      path: file,
      oldString: 'hello',
      newString: 'goodbye',
    });
    expect(result.error).toBeUndefined();
    expect(result.details.bytesBefore).toBe(11);
    expect(result.details.bytesAfter).toBe(13);
    expect(result.details.replaced).toBe(1);
    expect(fs.readFileSync(file, 'utf8')).toBe('goodbye world');
  });

  it('returns not_found when oldString is absent', async () => {
    const file = path.join(tmpDir, 'b.txt');
    fs.writeFileSync(file, 'foo bar');
    const result = await editTool.execute('tc_2', {
      path: file,
      oldString: 'missing',
      newString: 'x',
    });
    expect(result.error?.code).toBe('not_found');
    expect(fs.readFileSync(file, 'utf8')).toBe('foo bar');
  });

  it('returns not_unique when oldString occurs multiple times', async () => {
    const file = path.join(tmpDir, 'c.txt');
    fs.writeFileSync(file, 'dup dup dup');
    const result = await editTool.execute('tc_3', {
      path: file,
      oldString: 'dup',
      newString: 'x',
    });
    expect(result.error?.code).toBe('not_unique');
    expect(fs.readFileSync(file, 'utf8')).toBe('dup dup dup');
  });

  it('returns not_found for non-existent file', async () => {
    const result = await editTool.execute('tc_4', {
      path: path.join(tmpDir, 'nope.txt'),
      oldString: 'a',
      newString: 'b',
    });
    expect(result.error?.code).toBe('not_found');
  });

  it('rejects path containing ..', async () => {
    const result = await editTool.execute('tc_5', {
      path: '../etc/passwd',
      oldString: 'a',
      newString: 'b',
    });
    expect(result.error?.code).toBe('path_traversal_denied');
  });

  it('serializes concurrent edits on the same file via per-file mutex', async () => {
    const file = path.join(tmpDir, 'serial.txt');
    fs.writeFileSync(file, 'alpha');
    // edit 1: alpha -> beta
    // edit 2: beta -> gamma (depends on edit 1 having completed)
    const p1 = editTool.execute('tc_6a', {
      path: file,
      oldString: 'alpha',
      newString: 'beta',
    });
    const p2 = editTool.execute('tc_6b', {
      path: file,
      oldString: 'beta',
      newString: 'gamma',
    });
    const [r1, r2] = await Promise.all([p1, p2]);
    expect(r1.error).toBeUndefined();
    expect(r2.error).toBeUndefined();
    expect(fs.readFileSync(file, 'utf8')).toBe('gamma');
  });

  it('aborts via AbortSignal returning aborted error', async () => {
    const file = path.join(tmpDir, 'abort.txt');
    fs.writeFileSync(file, 'x');
    const ctrl = new AbortController();
    const promise = editTool.execute('tc_7', {
      path: file,
      oldString: 'x',
      newString: 'y',
    }, ctrl.signal);
    ctrl.abort();
    const result = await promise;
    expect(result.error?.code).toBe('aborted');
  });

  it('exposes EDIT_TIMEOUT_MS = 5000', () => {
    expect(EDIT_TIMEOUT_MS).toBe(5000);
  });

  it('declares name, label, description, parameters, sequential executionMode', () => {
    expect(editTool.name).toBe('edit');
    expect(editTool.label).toBeTruthy();
    expect(editTool.description).toBeTruthy();
    expect(editTool.parameters).toBeDefined();
    expect(editTool.executionMode).toBe('sequential');
  });

  // C5 回归测试：acquireWithTimeout 超时后，ghost acquisition 不应永久锁死 mutex
  it('acquireWithTimeout releases ghost acquisition after timeout (C5)', async () => {
    const mutex = new Mutex();
    const SHORT_TIMEOUT = 50;

    // 1. 持有 mutex
    const holderRelease = await mutex.acquire();

    // 2. acquireWithTimeout 超时（mutex 被 holder 占用）
    await expect(acquireWithTimeout(mutex, SHORT_TIMEOUT)).rejects.toThrow('edit lock timeout');

    // 3. 释放 holder —— 此时 ghost acquisition 可能 resolve
    holderRelease();

    // 4. 等待 ghost acquisition resolve 并自动 release
    await new Promise((r) => setTimeout(r, 30));

    // 5. 新的 acquireWithTimeout 应立即成功（不被 ghost 锁死）
    const releaser = await acquireWithTimeout(mutex, SHORT_TIMEOUT);
    releaser();
  });
});
