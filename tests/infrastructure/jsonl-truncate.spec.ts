import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, rmSync, writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { repairJsonl } from '../../src/infrastructure/jsonl.js';

const TMP_DIR = './tests/.tmp-jsonl-truncate';
const TMP_FILE = join(TMP_DIR, 'test.jsonl');
const BAK_FILE = `${TMP_FILE}.corrupt.bak`;

describe('jsonl repair', () => {
  beforeEach(() => {
    if (existsSync(TMP_DIR)) rmSync(TMP_DIR, { recursive: true, force: true });
    mkdirSync(TMP_DIR, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(TMP_DIR)) rmSync(TMP_DIR, { recursive: true, force: true });
  });

  it('truncates broken trailing data and keeps valid entries', async () => {
    const content = '{"id":1}\n{"id":2}\n{"broken":';
    writeFileSync(TMP_FILE, content, 'utf-8');
    const result = await repairJsonl(TMP_FILE);
    expect(result.truncated).toBe(true);
    expect(result.bytesRemoved).toBeGreaterThan(0);
    const repaired = readFileSync(TMP_FILE, 'utf-8');
    expect(repaired).toBe('{"id":1}\n{"id":2}\n');
    expect(repaired).not.toContain('broken');
  });

  it('is a no-op on already valid file', async () => {
    const content = '{"id":1}\n{"id":2}\n';
    writeFileSync(TMP_FILE, content, 'utf-8');
    const result = await repairJsonl(TMP_FILE);
    expect(result.truncated).toBe(false);
    expect(result.bytesRemoved).toBe(0);
    const repaired = readFileSync(TMP_FILE, 'utf-8');
    expect(repaired).toBe(content);
  });

  it('backs up to .corrupt.bak when fully corrupted', async () => {
    const content = 'garbage1\ngarbage2\nstill broken\n';
    writeFileSync(TMP_FILE, content, 'utf-8');
    const result = await repairJsonl(TMP_FILE);
    expect(result.truncated).toBe(true);
    expect(result.bytesRemoved).toBeGreaterThan(0);
    expect(existsSync(BAK_FILE)).toBe(true);
    const backup = readFileSync(BAK_FILE, 'utf-8');
    expect(backup).toBe(content);
    const repaired = readFileSync(TMP_FILE, 'utf-8');
    expect(repaired).toBe('');
  });

  it('handles middle broken line by keeping valid lines around it', async () => {
    const content = '{"id":1}\n{broken middle}\n{"id":3}\n';
    writeFileSync(TMP_FILE, content, 'utf-8');
    const result = await repairJsonl(TMP_FILE);
    expect(result.truncated).toBe(true);
    const repaired = readFileSync(TMP_FILE, 'utf-8');
    expect(repaired).toBe('{"id":1}\n{"id":3}\n');
  });
});
