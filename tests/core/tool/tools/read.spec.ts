import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import {
  readTool,
  READ_MAX_BYTES,
  READ_STREAM_THRESHOLD,
  READ_TIMEOUT_MS,
} from '../../../../src/core/tool/tools/read.js';

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aptbot-read-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('readTool', () => {
  it('reads small file content with line count and bytes', async () => {
    const file = path.join(tmpDir, 'small.txt');
    fs.writeFileSync(file, 'line1\nline2\nline3\n');
    const result = await readTool.execute('tc_1', { path: file });
    expect(result.error).toBeUndefined();
    expect(result.content[0]).toMatchObject({ type: 'text' });
    expect(result.content[0]).toHaveProperty('text');
    expect((result.content[0] as { text: string }).text).toContain('line1');
    expect((result.content[0] as { text: string }).text).toContain('line3');
    expect(result.details.lines).toBe(3);
    expect(result.details.bytes).toBe(18);
    expect(result.details.truncated).toBe(false);
  });

  it('returns file_too_large error for files > 2MB', async () => {
    const file = path.join(tmpDir, 'big.bin');
    const buf = Buffer.alloc(READ_MAX_BYTES + 1, 65); // 2MB+1 of 'A'
    fs.writeFileSync(file, buf);
    const result = await readTool.execute('tc_2', { path: file });
    expect(result.error?.code).toBe('file_too_large');
    expect(result.details.bytes).toBe(buf.length);
  });

  it('supports offset and limit pagination', async () => {
    const file = path.join(tmpDir, 'paginated.txt');
    fs.writeFileSync(file, 'l1\nl2\nl3\nl4\nl5\n');
    const result = await readTool.execute('tc_3', { path: file, offset: 1, limit: 2 });
    expect(result.error).toBeUndefined();
    const text = (result.content[0] as { text: string }).text;
    expect(text).toBe('l2\nl3\n');
    expect(result.details.lines).toBe(2);
  });

  it('rejects path containing ..', async () => {
    const result = await readTool.execute('tc_4', { path: '../etc/passwd' });
    expect(result.error?.code).toBe('path_traversal_denied');
  });

  it('returns error for non-existent file', async () => {
    const result = await readTool.execute('tc_5', { path: path.join(tmpDir, 'nope.txt') });
    expect(result.error?.code).toBe('not_found');
  });

  it('aborts via AbortSignal returning aborted error', async () => {
    // Use a large file so reading takes more than a tick
    const file = path.join(tmpDir, 'large.txt');
    const buf = Buffer.alloc(READ_STREAM_THRESHOLD + 100, 65); // > 1MB triggers stream path
    fs.writeFileSync(file, buf);
    const ctrl = new AbortController();
    const promise = readTool.execute('tc_6', { path: file }, ctrl.signal);
    ctrl.abort();
    const result = await promise;
    expect(result.error?.code).toBe('aborted');
  });

  it('exposes READ_MAX_BYTES=2MB, READ_STREAM_THRESHOLD=1MB, READ_TIMEOUT_MS=5000', () => {
    expect(READ_MAX_BYTES).toBe(2 * 1024 * 1024);
    expect(READ_STREAM_THRESHOLD).toBe(1024 * 1024);
    expect(READ_TIMEOUT_MS).toBe(5000);
  });

  it('declares name, label, description, parameters, parallel executionMode', () => {
    expect(readTool.name).toBe('read');
    expect(readTool.label).toBeTruthy();
    expect(readTool.description).toBeTruthy();
    expect(readTool.parameters).toBeDefined();
    expect(readTool.executionMode).toBe('parallel');
  });
});
