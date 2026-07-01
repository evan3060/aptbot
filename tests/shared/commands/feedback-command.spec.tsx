import { describe, it, expect, vi } from 'vitest';
import { createCommandRegistry, type CommandContext } from '../../../src/shared/commands/registry.js';
import type { StorageAdapter } from '../../../src/infrastructure/storage/file-storage.js';
import type {
  FeedbackStorage,
  FeedbackEntry,
  FeedbackListFilter,
  FeedbackCategory,
  FeedbackStatus,
} from '../../../src/infrastructure/feedback-storage.js';

/**
 * Task 12: /feedback 命令测试
 *
 * 用 in-memory mock FeedbackStorage 替代真实文件存储（Task 3 已覆盖真实存储）。
 * 覆盖 9 项场景：list / detail / resolve / resolve+note / archive / stats /
 *               no-storage / nonexistent-id / invalid-subcommand。
 */

function makeMockStorage(): StorageAdapter {
  return {
    readSession: vi.fn(async () => []),
    appendSession: vi.fn(async () => {}),
    listSessions: vi.fn(async () => []),
    readWorkingMemory: vi.fn(async () => null),
    writeWorkingMemory: vi.fn(async () => {}),
    deleteSession: vi.fn(async () => {}),
  } as unknown as StorageAdapter;
}

/**
 * In-memory FeedbackStorage mock。
 * entries 数组为单一数据源；list/findById/moderate 操作直接对 entries 过滤/修改。
 */
function makeMockFeedbackStorage(initial: FeedbackEntry[] = []): FeedbackStorage & {
  entries: FeedbackEntry[];
  moderateCalls: Array<{ id: string; update: { status: FeedbackStatus; note?: string } }>;
} {
  const entries: FeedbackEntry[] = initial.map((e) => ({ ...e }));
  const moderateCalls: Array<{ id: string; update: { status: FeedbackStatus; note?: string } }> = [];

  const mock: FeedbackStorage & {
    entries: FeedbackEntry[];
    moderateCalls: typeof moderateCalls;
  } = {
    entries,
    moderateCalls,
    async list(filter: FeedbackListFilter): Promise<{ items: FeedbackEntry[]; total: number }> {
      const status: FeedbackStatus = filter.status ?? 'open';
      const category: FeedbackCategory | undefined = filter.category;
      const limit = filter.limit ?? 50;
      const offset = filter.offset ?? 0;
      const filtered = entries.filter((e) => {
        if (e.status !== status) return false;
        if (category !== undefined && e.category !== category) return false;
        return true;
      });
      const total = filtered.length;
      const items = filtered.slice(offset, offset + limit);
      return { items, total };
    },
    async findById(id: string): Promise<FeedbackEntry | null> {
      return entries.find((e) => e.id === id) ?? null;
    },
    async moderate(
      id: string,
      update: { status: 'resolved' | 'archived'; note?: string },
    ): Promise<FeedbackEntry | null> {
      moderateCalls.push({ id, update });
      const idx = entries.findIndex((e) => e.id === id);
      if (idx === -1) return null;
      const existing = entries[idx];
      const updated: FeedbackEntry = {
        ...existing,
        status: update.status,
        moderatedAt: '2026-07-01T00:00:00.000Z',
        ...(update.note !== undefined ? { note: update.note } : {}),
      };
      entries[idx] = updated;
      return updated;
    },
  };
  return mock;
}

function makeEntry(overrides: Partial<FeedbackEntry> = {}): FeedbackEntry {
  return {
    id: 'fb-1',
    message: 'Great article, thanks!',
    category: 'general',
    ip: '127.0.0.1',
    status: 'open',
    createdAt: '2026-06-30T10:00:00.000Z',
    ...overrides,
  };
}

function makeCtx(overrides: Partial<CommandContext> = {}): CommandContext {
  return {
    sessionId: '11111111-2222-3333-4444-555555555555',
    model: 'mock-1',
    storage: makeMockStorage(),
    ...overrides,
  };
}

async function exec(
  reg: ReturnType<typeof createCommandRegistry>,
  input: string,
  ctx: CommandContext,
) {
  const resolved = reg.resolve(input);
  if (!resolved) throw new Error(`command not resolved: ${input}`);
  return resolved.command.execute(resolved.args, ctx);
}

describe('/feedback command', () => {
  it('is registered in CommandRegistry', () => {
    const reg = createCommandRegistry();
    expect(reg.has('feedback')).toBe(true);
    const resolved = reg.resolve('/feedback');
    expect(resolved).not.toBeNull();
    expect(resolved!.command.name).toBe('feedback');
  });

  // Scenario 1: /feedback list — shows recent open feedback
  it('/feedback list shows recent open feedback with id/category/preview/createdAt', async () => {
    const reg = createCommandRegistry();
    const feedbackStorage = makeMockFeedbackStorage([
      makeEntry({ id: 'fb-1', message: 'First feedback entry', category: 'general' }),
      makeEntry({ id: 'fb-2', message: 'Second feedback entry', category: 'bug' }),
      makeEntry({ id: 'fb-3', message: 'Already resolved', status: 'resolved' }),
    ]);
    const result = await exec(reg, '/feedback list', makeCtx({ feedbackStorage }));
    expect(result.output).toBeDefined();
    expect(result.output).toContain('fb-1');
    expect(result.output).toContain('fb-2');
    // resolved 状态不在默认 list 输出中
    expect(result.output).not.toContain('fb-3');
    expect(result.output).toContain('general');
    expect(result.output).toContain('bug');
  });

  it('/feedback with no args defaults to listing open feedback', async () => {
    const reg = createCommandRegistry();
    const feedbackStorage = makeMockFeedbackStorage([
      makeEntry({ id: 'fb-1', message: 'Hello', category: 'general' }),
    ]);
    const result = await exec(reg, '/feedback', makeCtx({ feedbackStorage }));
    expect(result.output).toBeDefined();
    expect(result.output).toContain('fb-1');
  });

  // Scenario 2: /feedback <id> — shows full detail
  it('/feedback <id> shows full detail including note and moderatedAt', async () => {
    const reg = createCommandRegistry();
    const feedbackStorage = makeMockFeedbackStorage([
      makeEntry({
        id: 'fb-detail-1',
        message: 'A detailed feedback message',
        category: 'article',
        articleSlug: 'learn-track1-intro',
        contact: 'user@example.com',
        ip: '192.168.1.1',
        status: 'open',
        createdAt: '2026-06-29T08:30:00.000Z',
      }),
    ]);
    const result = await exec(reg, '/feedback fb-detail-1', makeCtx({ feedbackStorage }));
    expect(result.output).toBeDefined();
    expect(result.output).toContain('fb-detail-1');
    expect(result.output).toContain('A detailed feedback message');
    expect(result.output).toContain('article');
    expect(result.output).toContain('learn-track1-intro');
    expect(result.output).toContain('user@example.com');
    expect(result.output).toContain('192.168.1.1');
    expect(result.output).toContain('2026-06-29T08:30:00.000Z');
    expect(result.output).toContain('open');
  });

  // Scenario 3: /feedback resolve <id> — marks resolved, confirms
  it('/feedback resolve <id> marks as resolved and confirms', async () => {
    const reg = createCommandRegistry();
    const feedbackStorage = makeMockFeedbackStorage([
      makeEntry({ id: 'fb-resolve-1', status: 'open' }),
    ]);
    const result = await exec(reg, '/feedback resolve fb-resolve-1', makeCtx({ feedbackStorage }));
    expect(result.output).toBeDefined();
    expect(result.output).toContain('fb-resolve-1');
    expect(result.output).toMatch(/resolved/i);
    // 验证 storage.moderate 被调用
    expect(feedbackStorage.moderateCalls).toHaveLength(1);
    expect(feedbackStorage.moderateCalls[0].id).toBe('fb-resolve-1');
    expect(feedbackStorage.moderateCalls[0].update.status).toBe('resolved');
    // 验证实际状态被更新
    expect(feedbackStorage.entries[0].status).toBe('resolved');
    expect(feedbackStorage.entries[0].moderatedAt).toBeDefined();
  });

  // Scenario 4: /feedback resolve <id> <note> — marks resolved with note
  it('/feedback resolve <id> <note> marks resolved with note', async () => {
    const reg = createCommandRegistry();
    const feedbackStorage = makeMockFeedbackStorage([
      makeEntry({ id: 'fb-resolve-2', status: 'open' }),
    ]);
    const result = await exec(
      reg,
      '/feedback resolve fb-resolve-2 fixed in v0.2.4',
      makeCtx({ feedbackStorage }),
    );
    expect(result.output).toBeDefined();
    expect(result.output).toContain('fb-resolve-2');
    expect(feedbackStorage.moderateCalls).toHaveLength(1);
    expect(feedbackStorage.moderateCalls[0].update.status).toBe('resolved');
    expect(feedbackStorage.moderateCalls[0].update.note).toBe('fixed in v0.2.4');
    expect(feedbackStorage.entries[0].note).toBe('fixed in v0.2.4');
  });

  // Scenario 5: /feedback archive <id> — marks archived, confirms
  it('/feedback archive <id> marks as archived and confirms', async () => {
    const reg = createCommandRegistry();
    const feedbackStorage = makeMockFeedbackStorage([
      makeEntry({ id: 'fb-archive-1', status: 'open' }),
    ]);
    const result = await exec(reg, '/feedback archive fb-archive-1', makeCtx({ feedbackStorage }));
    expect(result.output).toBeDefined();
    expect(result.output).toContain('fb-archive-1');
    expect(result.output).toMatch(/archived/i);
    expect(feedbackStorage.moderateCalls).toHaveLength(1);
    expect(feedbackStorage.moderateCalls[0].update.status).toBe('archived');
    expect(feedbackStorage.entries[0].status).toBe('archived');
  });

  // Scenario 6: /feedback stats — shows counts by status and category
  it('/feedback stats shows counts by status', async () => {
    const reg = createCommandRegistry();
    const feedbackStorage = makeMockFeedbackStorage([
      makeEntry({ id: 'fb-s1', status: 'open', category: 'general' }),
      makeEntry({ id: 'fb-s2', status: 'open', category: 'bug' }),
      makeEntry({ id: 'fb-s3', status: 'resolved', category: 'general' }),
      makeEntry({ id: 'fb-s4', status: 'archived', category: 'article' }),
    ]);
    const result = await exec(reg, '/feedback stats', makeCtx({ feedbackStorage }));
    expect(result.output).toBeDefined();
    expect(result.output).toMatch(/stats/i);
    // 包含三种状态计数
    expect(result.output).toMatch(/open/i);
    expect(result.output).toMatch(/resolved/i);
    expect(result.output).toMatch(/archived/i);
  });

  // Scenario 7: /feedback with no storage configured — friendly message
  it('/feedback without feedbackStorage shows friendly disabled message', async () => {
    const reg = createCommandRegistry();
    // 不传 feedbackStorage
    const result = await exec(reg, '/feedback', makeCtx());
    expect(result.output).toBeDefined();
    expect(result.output).toMatch(/反馈功能未启用|feedback.*disabled|not.*enabled/i);
  });

  it('/feedback resolve without feedbackStorage shows friendly disabled message', async () => {
    const reg = createCommandRegistry();
    const result = await exec(reg, '/feedback resolve fb-1', makeCtx());
    expect(result.output).toBeDefined();
    expect(result.output).toMatch(/反馈功能未启用|feedback.*disabled|not.*enabled/i);
  });

  // Scenario 8: /feedback <nonexistent-id> — "未找到"
  it('/feedback <nonexistent-id> shows 未找到 message', async () => {
    const reg = createCommandRegistry();
    const feedbackStorage = makeMockFeedbackStorage([]);
    const result = await exec(
      reg,
      '/feedback fb-does-not-exist',
      makeCtx({ feedbackStorage }),
    );
    expect(result.output).toBeDefined();
    expect(result.output).toContain('未找到');
    expect(result.output).toContain('fb-does-not-exist');
  });

  it('/feedback resolve <nonexistent-id> shows 未找到 message', async () => {
    const reg = createCommandRegistry();
    const feedbackStorage = makeMockFeedbackStorage([]);
    const result = await exec(
      reg,
      '/feedback resolve fb-does-not-exist',
      makeCtx({ feedbackStorage }),
    );
    expect(result.output).toBeDefined();
    expect(result.output).toContain('未找到');
  });

  // Scenario 9: Argument validation (invalid subcommand)
  it('/feedback resolve without id shows usage', async () => {
    const reg = createCommandRegistry();
    const feedbackStorage = makeMockFeedbackStorage([]);
    const result = await exec(reg, '/feedback resolve', makeCtx({ feedbackStorage }));
    expect(result.output).toBeDefined();
    expect(result.output).toMatch(/usage/i);
    expect(result.output).toContain('resolve');
  });

  it('/feedback archive without id shows usage', async () => {
    const reg = createCommandRegistry();
    const feedbackStorage = makeMockFeedbackStorage([]);
    const result = await exec(reg, '/feedback archive', makeCtx({ feedbackStorage }));
    expect(result.output).toBeDefined();
    expect(result.output).toMatch(/usage/i);
    expect(result.output).toContain('archive');
  });

  it('/feedback <unknown-subcommand> shows error', async () => {
    const reg = createCommandRegistry();
    const feedbackStorage = makeMockFeedbackStorage([]);
    // 既非已知子命令，也不像 fb- 前缀的 id
    const result = await exec(reg, '/feedback bogusSubcommand', makeCtx({ feedbackStorage }));
    expect(result.output).toBeDefined();
    // 应返回某种错误/未找到提示
    expect(result.output).toMatch(/invalid|unknown|未找到|usage|subcommand/i);
  });

  // /feedback all — list all statuses (from brief)
  it('/feedback all lists feedback across all statuses', async () => {
    const reg = createCommandRegistry();
    const feedbackStorage = makeMockFeedbackStorage([
      makeEntry({ id: 'fb-all-1', status: 'open' }),
      makeEntry({ id: 'fb-all-2', status: 'resolved' }),
      makeEntry({ id: 'fb-all-3', status: 'archived' }),
    ]);
    const result = await exec(reg, '/feedback all', makeCtx({ feedbackStorage }));
    expect(result.output).toBeDefined();
    expect(result.output).toContain('fb-all-1');
    expect(result.output).toContain('fb-all-2');
    expect(result.output).toContain('fb-all-3');
  });
});
