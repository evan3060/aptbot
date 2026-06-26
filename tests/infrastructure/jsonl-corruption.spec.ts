import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { appendJsonl, readJsonlTolerant } from '../../src/infrastructure/jsonl.js';

const TMP_DIR = './tests/.tmp-jsonl-corruption';
const TMP_FILE = join(TMP_DIR, 'test.jsonl');

describe('jsonl corruption-tolerant', () => {
  beforeEach(() => {
    if (existsSync(TMP_DIR)) rmSync(TMP_DIR, { recursive: true, force: true });
    if (!existsSync(TMP_DIR)) mkdirSync(TMP_DIR, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(TMP_DIR)) rmSync(TMP_DIR, { recursive: true, force: true });
  });

  it('returns empty entries and skipped 0 for empty file', async () => {
    writeFileSync(TMP_FILE, '', 'utf-8');
    const result = await readJsonlTolerant(TMP_FILE);
    expect(result.entries).toEqual([]);
    expect(result.skipped).toBe(0);
  });

  it('skips broken trailing partial line', async () => {
    await appendJsonl(TMP_FILE, { id: 1 });
    await appendJsonl(TMP_FILE, { id: 2 });
    // append broken trailing line
    writeFileSync(TMP_FILE, '{"id":1}\n{"id":2}\n{"id":3,"text":"broken', 'utf-8');
    const result = await readJsonlTolerant(TMP_FILE);
    expect(result.entries).toHaveLength(2);
    expect(result.skipped).toBe(1);
  });

  it('skips broken middle line and continues', async () => {
    const content = '{"id":1}\n{broken middle}\n{"id":3}\n';
    writeFileSync(TMP_FILE, content, 'utf-8');
    const result = await readJsonlTolerant(TMP_FILE);
    expect(result.entries).toHaveLength(2);
    expect((result.entries[0] as { id: number }).id).toBe(1);
    expect((result.entries[1] as { id: number }).id).toBe(3);
    expect(result.skipped).toBe(1);
  });

  it('returns empty entries and skipped N for fully-broken file', async () => {
    const content = 'garbage line 1\ngarbage line 2\n{still broken\n';
    writeFileSync(TMP_FILE, content, 'utf-8');
    const result = await readJsonlTolerant(TMP_FILE);
    expect(result.entries).toEqual([]);
    expect(result.skipped).toBe(3);
  });

  it('handles valid file with zero skipped', async () => {
    await appendJsonl(TMP_FILE, { a: 1 });
    await appendJsonl(TMP_FILE, { b: 2 });
    const result = await readJsonlTolerant(TMP_FILE);
    expect(result.entries).toHaveLength(2);
    expect(result.skipped).toBe(0);
  });
});
