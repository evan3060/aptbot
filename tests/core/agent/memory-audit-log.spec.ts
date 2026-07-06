import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  MemoryAuditLog,
  type AuditRecord,
  type MemoryAuditSection,
} from '../../../src/core/agent/memory-audit-log.js';

/**
 * §0.3.0 Task 7: MemoryAuditLog — append-only JSONL audit log
 *
 * 测试契约：
 * - 路径：data/users/<userId>/agents/<slug>/memory.log.jsonl
 * - append-only JSONL，复用 jsonl-mutex
 * - append(record): 追加一行 JSON
 * - list(limit=20): 最近 N 条，倒序（最新在前）
 * - AuditRecord 字段：timestamp / sessionId / section / mode / contentPreview / contentLength / beforeSize / afterSize
 * - 路径遍历防护：userId + slug 校验
 */

const VALID_USER_ID = '00000000-0000-4000-8000-000000000000';
const VALID_AGENT_ID = 'agent-abc123';

function sampleRecord(overrides: Partial<AuditRecord> = {}): AuditRecord {
  return {
    timestamp: '2026-07-06T10:00:00.000Z',
    sessionId: 'sess-001',
    section: 'facts' as MemoryAuditSection,
    mode: 'append',
    contentPreview: 'hello world',
    contentLength: 11,
    beforeSize: 0,
    afterSize: 11,
    ...overrides,
  };
}

describe('memory-audit-log', () => {
  let tmpDataDir: string;

  beforeEach(() => {
    tmpDataDir = mkdtempSync(join(tmpdir(), 'aptbot-mem-audit-'));
  });

  afterEach(() => {
    rmSync(tmpDataDir, { recursive: true, force: true });
  });

  describe('construction & path traversal guard', () => {
    it('constructs with valid userId + slug', () => {
      expect(() => new MemoryAuditLog(VALID_USER_ID, VALID_AGENT_ID, tmpDataDir)).not.toThrow();
    });

    it('throws on invalid userId (path traversal guard)', () => {
      expect(() => new MemoryAuditLog('../etc', VALID_AGENT_ID, tmpDataDir)).toThrow(/userId/);
    });

    it('throws on invalid slug (path traversal guard)', () => {
      expect(() => new MemoryAuditLog(VALID_USER_ID, '../etc', tmpDataDir)).toThrow(/slug/);
    });

    it('does not create the file at construction (lazy creation on first append)', () => {
      const log = new MemoryAuditLog(VALID_USER_ID, VALID_AGENT_ID, tmpDataDir);
      const filePath = join(
        tmpDataDir,
        'users',
        VALID_USER_ID,
        'agents',
        VALID_AGENT_ID,
        'memory.log.jsonl',
      );
      expect(existsSync(filePath)).toBe(false);
      // reference log to satisfy linter
      expect(log).toBeDefined();
    });
  });

  describe('append', () => {
    it('writes one JSONL line per record to memory.log.jsonl', async () => {
      const log = new MemoryAuditLog(VALID_USER_ID, VALID_AGENT_ID, tmpDataDir);
      await log.append(sampleRecord());

      const filePath = join(
        tmpDataDir,
        'users',
        VALID_USER_ID,
        'agents',
        VALID_AGENT_ID,
        'memory.log.jsonl',
      );
      expect(existsSync(filePath)).toBe(true);
      const raw = readFileSync(filePath, 'utf8');
      const lines = raw.split('\n').filter((l) => l.trim() !== '');
      expect(lines.length).toBe(1);
      const parsed = JSON.parse(lines[0]);
      expect(parsed).toMatchObject({
        sessionId: 'sess-001',
        section: 'facts',
        mode: 'append',
        contentPreview: 'hello world',
        contentLength: 11,
        beforeSize: 0,
        afterSize: 11,
      });
      expect(parsed.timestamp).toBe('2026-07-06T10:00:00.000Z');
    });

    it('appends multiple records as separate JSONL lines', async () => {
      const log = new MemoryAuditLog(VALID_USER_ID, VALID_AGENT_ID, tmpDataDir);
      await log.append(sampleRecord({ sessionId: 's1' }));
      await log.append(sampleRecord({ sessionId: 's2' }));
      await log.append(sampleRecord({ sessionId: 's3' }));

      const filePath = join(
        tmpDataDir,
        'users',
        VALID_USER_ID,
        'agents',
        VALID_AGENT_ID,
        'memory.log.jsonl',
      );
      const raw = readFileSync(filePath, 'utf8');
      const lines = raw.split('\n').filter((l) => l.trim() !== '');
      expect(lines.length).toBe(3);
      expect(JSON.parse(lines[0]).sessionId).toBe('s1');
      expect(JSON.parse(lines[1]).sessionId).toBe('s2');
      expect(JSON.parse(lines[2]).sessionId).toBe('s3');
    });

    it('creates parent directories recursively on first append', async () => {
      const log = new MemoryAuditLog(VALID_USER_ID, VALID_AGENT_ID, tmpDataDir);
      // directory does not exist yet
      const dir = join(tmpDataDir, 'users', VALID_USER_ID, 'agents', VALID_AGENT_ID);
      expect(existsSync(dir)).toBe(false);

      await log.append(sampleRecord());
      expect(existsSync(dir)).toBe(true);
    });
  });

  describe('list', () => {
    it('returns empty array when file does not exist', async () => {
      const log = new MemoryAuditLog(VALID_USER_ID, VALID_AGENT_ID, tmpDataDir);
      const records = await log.list();
      expect(records).toEqual([]);
    });

    it('returns records most-recent-first (reverse insertion order)', async () => {
      const log = new MemoryAuditLog(VALID_USER_ID, VALID_AGENT_ID, tmpDataDir);
      await log.append(sampleRecord({ sessionId: 'first' }));
      await log.append(sampleRecord({ sessionId: 'second' }));
      await log.append(sampleRecord({ sessionId: 'third' }));

      const records = await log.list();
      expect(records.length).toBe(3);
      expect(records[0].sessionId).toBe('third');
      expect(records[1].sessionId).toBe('second');
      expect(records[2].sessionId).toBe('first');
    });

    it('default limit is 20', async () => {
      const log = new MemoryAuditLog(VALID_USER_ID, VALID_AGENT_ID, tmpDataDir);
      for (let i = 0; i < 25; i++) {
        await log.append(sampleRecord({ sessionId: `s${i}` }));
      }
      const records = await log.list();
      expect(records.length).toBe(20);
      // most recent 20 → s24..s5
      expect(records[0].sessionId).toBe('s24');
      expect(records[19].sessionId).toBe('s5');
    });

    it('respects custom limit', async () => {
      const log = new MemoryAuditLog(VALID_USER_ID, VALID_AGENT_ID, tmpDataDir);
      for (let i = 0; i < 10; i++) {
        await log.append(sampleRecord({ sessionId: `s${i}` }));
      }
      const records = await log.list(3);
      expect(records.length).toBe(3);
      expect(records[0].sessionId).toBe('s9');
      expect(records[2].sessionId).toBe('s7');
    });

    it('limit larger than record count returns all records', async () => {
      const log = new MemoryAuditLog(VALID_USER_ID, VALID_AGENT_ID, tmpDataDir);
      await log.append(sampleRecord({ sessionId: 'a' }));
      await log.append(sampleRecord({ sessionId: 'b' }));
      const records = await log.list(100);
      expect(records.length).toBe(2);
    });

    it('preserves all AuditRecord fields through round-trip', async () => {
      const log = new MemoryAuditLog(VALID_USER_ID, VALID_AGENT_ID, tmpDataDir);
      const rec: AuditRecord = {
        timestamp: '2026-07-06T12:34:56.789Z',
        sessionId: 'sess-xyz',
        section: 'preferences',
        mode: 'replace',
        contentPreview: 'x'.repeat(200),
        contentLength: 2048,
        beforeSize: 100,
        afterSize: 2148,
      };
      await log.append(rec);
      const records = await log.list();
      expect(records.length).toBe(1);
      expect(records[0]).toEqual(rec);
    });
  });

  describe('concurrent appends are serialized (per-agent mutex)', () => {
    it('appends 50 concurrent records with no lost lines', async () => {
      const log = new MemoryAuditLog(VALID_USER_ID, VALID_AGENT_ID, tmpDataDir);
      const N = 50;
      const tasks = Array.from({ length: N }, (_, i) =>
        log.append(sampleRecord({ sessionId: `s${i}` })),
      );
      await Promise.all(tasks);

      const records = await log.list(100);
      expect(records.length).toBe(N);
      // all sessionIds present (order may interleave but no loss)
      const ids = new Set(records.map((r) => r.sessionId));
      expect(ids.size).toBe(N);
    });
  });

  describe('corrupted JSONL tolerance', () => {
    it('list skips unparseable lines (tolerant read)', async () => {
      const filePath = join(
        tmpDataDir,
        'users',
        VALID_USER_ID,
        'agents',
        VALID_AGENT_ID,
        'memory.log.jsonl',
      );
      mkdirSync(join(filePath, '..'), { recursive: true });
      // one valid + one broken line
      writeFileSync(
        filePath,
        `${JSON.stringify(sampleRecord({ sessionId: 'good' }))}\n{not valid json\n`,
        'utf8',
      );
      const log = new MemoryAuditLog(VALID_USER_ID, VALID_AGENT_ID, tmpDataDir);
      const records = await log.list();
      expect(records.length).toBe(1);
      expect(records[0].sessionId).toBe('good');
    });
  });
});
