import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, rmSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { appendJsonl, readJsonl } from '../../src/infrastructure/jsonl.js';

const TMP_DIR = './tests/.tmp-jsonl';
const TMP_FILE = join(TMP_DIR, 'test.jsonl');

describe('jsonl basic', () => {
  beforeEach(() => {
    if (existsSync(TMP_DIR)) rmSync(TMP_DIR, { recursive: true, force: true });
  });

  afterEach(() => {
    if (existsSync(TMP_DIR)) rmSync(TMP_DIR, { recursive: true, force: true });
  });

  it('appendJsonl creates parent directory recursively', async () => {
    await appendJsonl(TMP_FILE, { a: 1 });
    expect(existsSync(TMP_FILE)).toBe(true);
  });

  it('appendJsonl + readJsonl round-trips entries', async () => {
    await appendJsonl(TMP_FILE, { id: 1, text: 'first' });
    await appendJsonl(TMP_FILE, { id: 2, text: 'second' });
    const entries = await readJsonl(TMP_FILE);
    expect(entries).toHaveLength(2);
    expect(entries[0]).toEqual({ id: 1, text: 'first' });
    expect(entries[1]).toEqual({ id: 2, text: 'second' });
  });

  it('readJsonl returns [] for non-existent file', async () => {
    const entries = await readJsonl('/nonexistent/path/file.jsonl');
    expect(entries).toEqual([]);
  });

  it('file ends with trailing newline (LF) after append', async () => {
    await appendJsonl(TMP_FILE, { a: 1 });
    const content = readFileSync(TMP_FILE, 'utf-8');
    expect(content.endsWith('\n')).toBe(true);
  });

  it('file uses LF line endings (no CRLF)', async () => {
    await appendJsonl(TMP_FILE, { a: 1 });
    await appendJsonl(TMP_FILE, { b: 2 });
    const content = readFileSync(TMP_FILE, 'utf-8');
    expect(content).not.toContain('\r\n');
  });

  it('file is UTF-8 encoded without BOM', async () => {
    await appendJsonl(TMP_FILE, { unicode: 'café ☕' });
    const buf = readFileSync(TMP_FILE);
    // BOM = 0xEF 0xBB 0xBF
    expect(buf[0]).not.toBe(0xEF);
    expect(buf[1]).not.toBe(0xBB);
    expect(buf[2]).not.toBe(0xBF);
    const content = buf.toString('utf-8');
    expect(content).toContain('café ☕');
  });
});
