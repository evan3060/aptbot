import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { readJsonlTolerant } from '../../src/infrastructure/jsonl.js';
import {
  FeedbackStorage,
  type FeedbackEntry,
  type FeedbackInput,
  type FeedbackListFilter,
} from '../../src/infrastructure/feedback-storage.js';

/**
 * Task 3 (feedback-storage): FeedbackStorage 契约测试
 *
 * 覆盖 8 项场景 + 1 项边界：
 * 1. append 写入一行 JSON
 * 2. append 自动生成 id + createdAt
 * 3. list 默认 status=open + category 过滤 + limit+offset 分页 + total 正确
 * 4. moderate 不存在 id 返回 null
 * 5. moderate 合法 id 重写整个文件 + 返回更新后 entry（status/moderatedAt 设置，note 可选）
 * 6. findById 合法与不存在
 * 7. 并发 append mutex 串行化无错行
 * 8. JSONL 破损行容错 skip + warning 不 crash
 * 9. (edge) 文件不存在时 append 自动创建
 */
describe('Task 3: FeedbackStorage', () => {
  let tmpDir: string;
  let storage: FeedbackStorage;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'aptbot-feedback-test-'));
    storage = new FeedbackStorage(tmpDir);
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('append', () => {
    // 场景 1: append 写入一行 JSON
    it('writes exactly one JSON line to feedback.jsonl', async () => {
      const input: FeedbackInput = {
        message: 'great site',
        category: 'general',
        ip: '127.0.0.1',
      };
      await storage.append(input);

      const content = readFileSync(join(tmpDir, 'feedback.jsonl'), 'utf-8');
      const lines = content.split('\n').filter((l) => l.trim() !== '');
      expect(lines).toHaveLength(1);

      const parsed = JSON.parse(lines[0]) as FeedbackEntry;
      expect(parsed.message).toBe('great site');
      expect(parsed.category).toBe('general');
      expect(parsed.ip).toBe('127.0.0.1');
      expect(parsed.status).toBe('open');
    });

    // 场景 2: append 自动生成 id + createdAt
    it('auto-generates id matching ^fb-\\d+-[a-f0-9]{6}$ and ISO 8601 createdAt', async () => {
      const entry = await storage.append({
        message: 'm',
        category: 'bug',
        ip: '127.0.0.1',
      });
      expect(entry.id).toMatch(/^fb-\d+-[a-f0-9]{6}$/);
      // ISO 8601 round-trip
      const parsed = new Date(entry.createdAt);
      expect(parsed.toISOString()).toBe(entry.createdAt);
    });

    // 场景 9: 文件不存在时 append 自动创建
    it('auto-creates feedback.jsonl on first append when file does not exist', async () => {
      const filePath = join(tmpDir, 'feedback.jsonl');
      expect(existsSync(filePath)).toBe(false);

      await storage.append({ message: 'first', category: 'general', ip: '127.0.0.1' });

      expect(existsSync(filePath)).toBe(true);
    });

    it('returns full FeedbackEntry with optional fields preserved', async () => {
      const entry = await storage.append({
        message: 'feature request',
        category: 'feature',
        articleSlug: 'getting-started',
        contact: 'user@example.com',
        ip: '192.168.1.1',
        userAgent: 'Mozilla/5.0',
      });
      expect(entry.articleSlug).toBe('getting-started');
      expect(entry.contact).toBe('user@example.com');
      expect(entry.userAgent).toBe('Mozilla/5.0');
    });
  });

  describe('list', () => {
    // 场景 3: 默认 status=open + category 过滤 + limit+offset 分页 + total 正确
    it('applies default status=open, category filter, pagination, and total', async () => {
      // 种子数据：3 open general + 2 open bug + 1 resolved general
      await storage.append({ message: 'g1', category: 'general', ip: '1.1.1.1' });
      await storage.append({ message: 'g2', category: 'general', ip: '1.1.1.1' });
      await storage.append({ message: 'g3', category: 'general', ip: '1.1.1.1' });
      await storage.append({ message: 'b1', category: 'bug', ip: '1.1.1.1' });
      await storage.append({ message: 'b2', category: 'bug', ip: '1.1.1.1' });
      const resolved = await storage.append({
        message: 'g-resolved',
        category: 'general',
        ip: '1.1.1.1',
      });
      await storage.moderate(resolved.id, { status: 'resolved' });

      // 默认：status=open，无 category 过滤 → 5 条（3 general + 2 bug）
      const def = await storage.list({});
      expect(def.total).toBe(5);
      expect(def.items).toHaveLength(5);
      expect(def.items.every((e) => e.status === 'open')).toBe(true);

      // category 过滤：仅 general（open）→ 3 条
      const generalOnly = await storage.list({ category: 'general' });
      expect(generalOnly.total).toBe(3);
      expect(generalOnly.items).toHaveLength(3);
      expect(generalOnly.items.every((e) => e.category === 'general')).toBe(true);

      // 分页 page1：limit=2 offset=0 → 2 条，total=5
      const page1 = await storage.list({ limit: 2, offset: 0 });
      expect(page1.total).toBe(5);
      expect(page1.items).toHaveLength(2);

      // 分页 page2：limit=2 offset=2 → 2 条，total=5
      const page2 = await storage.list({ limit: 2, offset: 2 });
      expect(page2.total).toBe(5);
      expect(page2.items).toHaveLength(2);

      // 分页 page3：limit=2 offset=4 → 1 条（最后一条），total=5
      const page3 = await storage.list({ limit: 2, offset: 4 });
      expect(page3.total).toBe(5);
      expect(page3.items).toHaveLength(1);

      // 分页越界：limit=2 offset=10 → 0 条，total=5（total 仍是过滤后总数）
      const pageOOB = await storage.list({ limit: 2, offset: 10 });
      expect(pageOOB.total).toBe(5);
      expect(pageOOB.items).toHaveLength(0);

      // status 过滤：resolved → 1 条
      const resolvedList = await storage.list({ status: 'resolved' });
      expect(resolvedList.total).toBe(1);
      expect(resolvedList.items).toHaveLength(1);
      expect(resolvedList.items[0].status).toBe('resolved');
    });

    it('clamps limit to [1,100] and defaults to 50 when omitted', async () => {
      // 种子 3 条 open
      for (let i = 0; i < 3; i++) {
        await storage.append({ message: `m${i}`, category: 'general', ip: '1.1.1.1' });
      }
      // limit=0 → clamp 到 1
      const zero = await storage.list({ limit: 0 });
      expect(zero.items).toHaveLength(1);
      // limit=1000 → clamp 到 100（但只有 3 条）
      const huge = await storage.list({ limit: 1000 });
      expect(huge.items).toHaveLength(3);
      // 默认 limit（省略）→ 50，但只有 3 条
      const def = await storage.list({});
      expect(def.items).toHaveLength(3);
    });

    it('clamps negative offset to 0', async () => {
      await storage.append({ message: 'only', category: 'general', ip: '1.1.1.1' });
      const result = await storage.list({ offset: -5 });
      expect(result.items).toHaveLength(1);
      expect(result.total).toBe(1);
    });

    it('returns empty items and total 0 when file does not exist', async () => {
      const result = await storage.list({});
      expect(result.items).toEqual([]);
      expect(result.total).toBe(0);
    });
  });

  describe('moderate', () => {
    // 场景 4: 不存在 id 返回 null
    it('returns null for non-existent id', async () => {
      const result = await storage.moderate('fb-does-not-exist', { status: 'resolved' });
      expect(result).toBeNull();
    });

    // 场景 5: 合法 id 重写整个文件 + 返回更新后 entry
    it('rewrites file (no duplicate line) and returns updated entry with status/moderatedAt set', async () => {
      const original = await storage.append({
        message: 'bug report',
        category: 'bug',
        ip: '1.1.1.1',
      });

      const before = readFileSync(join(tmpDir, 'feedback.jsonl'), 'utf-8');
      const beforeLines = before.split('\n').filter((l) => l.trim() !== '');
      expect(beforeLines).toHaveLength(1);

      const updated = await storage.moderate(original.id, {
        status: 'resolved',
        note: 'fixed in v1',
      });

      expect(updated).not.toBeNull();
      expect(updated!.id).toBe(original.id);
      expect(updated!.status).toBe('resolved');
      expect(updated!.moderatedAt).toBeTruthy();
      // moderatedAt 必须是 ISO 8601
      expect(new Date(updated!.moderatedAt!).toISOString()).toBe(updated!.moderatedAt);
      expect(updated!.note).toBe('fixed in v1');

      // 文件被重写而非追加：仍只有 1 行
      const after = readFileSync(join(tmpDir, 'feedback.jsonl'), 'utf-8');
      const afterLines = after.split('\n').filter((l) => l.trim() !== '');
      expect(afterLines).toHaveLength(1);

      // 重读确认磁盘状态
      const refetched = await storage.findById(original.id);
      expect(refetched).not.toBeNull();
      expect(refetched!.status).toBe('resolved');
      expect(refetched!.note).toBe('fixed in v1');
      expect(refetched!.moderatedAt).toBe(updated!.moderatedAt);
    });

    it('preserves other entries when rewriting file during moderate', async () => {
      const e1 = await storage.append({ message: 'm1', category: 'general', ip: '1.1.1.1' });
      const e2 = await storage.append({ message: 'm2', category: 'general', ip: '1.1.1.1' });
      const e3 = await storage.append({ message: 'm3', category: 'general', ip: '1.1.1.1' });

      await storage.moderate(e2.id, { status: 'archived' });

      // 文件仍 3 行（重写而非追加）
      const content = readFileSync(join(tmpDir, 'feedback.jsonl'), 'utf-8');
      const lines = content.split('\n').filter((l) => l.trim() !== '');
      expect(lines).toHaveLength(3);

      const f1 = await storage.findById(e1.id);
      const f2 = await storage.findById(e2.id);
      const f3 = await storage.findById(e3.id);
      expect(f1!.status).toBe('open');
      expect(f2!.status).toBe('archived');
      expect(f3!.status).toBe('open');
    });

    it('updates status without note (note optional)', async () => {
      const original = await storage.append({
        message: 'archive me',
        category: 'feature',
        ip: '1.1.1.1',
      });
      const updated = await storage.moderate(original.id, { status: 'archived' });
      expect(updated).not.toBeNull();
      expect(updated!.status).toBe('archived');
      expect(updated!.moderatedAt).toBeTruthy();
    });
  });

  describe('findById', () => {
    // 场景 6: found + not-found
    it('returns the entry when found, null when not found', async () => {
      const created = await storage.append({
        message: 'find me',
        category: 'general',
        ip: '1.1.1.1',
      });

      const found = await storage.findById(created.id);
      expect(found).not.toBeNull();
      expect(found!.id).toBe(created.id);
      expect(found!.message).toBe('find me');

      const notFound = await storage.findById('fb-nonexistent');
      expect(notFound).toBeNull();
    });

    it('returns null when file does not exist', async () => {
      const result = await storage.findById('fb-anything');
      expect(result).toBeNull();
    });
  });

  describe('concurrency', () => {
    // 场景 7: 并发 append mutex 串行化无错行
    it('serializes concurrent appends with no corrupted lines', async () => {
      const N = 20;
      const promises: Promise<FeedbackEntry>[] = [];
      for (let i = 0; i < N; i++) {
        promises.push(
          storage.append({ message: `m${i}`, category: 'general', ip: '1.1.1.1' }),
        );
      }
      const results = await Promise.all(promises);
      expect(results).toHaveLength(N);

      // 所有 id 唯一
      const ids = new Set(results.map((r) => r.id));
      expect(ids.size).toBe(N);

      // 文件无破损行
      const result = await readJsonlTolerant(join(tmpDir, 'feedback.jsonl'));
      expect(result.skipped).toBe(0);
      expect(result.entries).toHaveLength(N);
    });
  });

  describe('broken line tolerance', () => {
    // 场景 8: JSONL 破损行容错 skip + warning 不 crash
    it('skips broken lines and emits warning without crashing (append + list work)', async () => {
      const filePath = join(tmpDir, 'feedback.jsonl');
      // 预写破损首行
      writeFileSync(filePath, '{"broken":\n', 'utf-8');

      const warnCalls: string[] = [];
      const storageWithLogger = new FeedbackStorage(tmpDir, {
        logger: { warn: (msg: string) => warnCalls.push(msg) },
      });

      // append 必须成功（不读文件，仅追加）
      await storageWithLogger.append({
        message: 'after corrupt',
        category: 'general',
        ip: '1.1.1.1',
      });

      // list 必须成功，跳过破损行，发出 warning
      const listed = await storageWithLogger.list({});
      expect(listed.items).toHaveLength(1);
      expect(listed.items[0].message).toBe('after corrupt');
      expect(warnCalls.length).toBeGreaterThan(0);
      expect(warnCalls.some((w) => /skip/i.test(w))).toBe(true);

      // findById 也应能工作
      const found = await storageWithLogger.findById(listed.items[0].id);
      expect(found).not.toBeNull();
      expect(found!.message).toBe('after corrupt');
    });
  });
});
