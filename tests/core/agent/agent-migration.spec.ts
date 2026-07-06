import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  mkdtempSync,
  rmSync,
  existsSync,
  mkdirSync,
  writeFileSync,
  readdirSync,
  readFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { AgentStorage } from '../../../src/core/agent/agent-storage.js';
import {
  migrateLegacySessions,
  ensureDefaultAgent,
  DEFAULT_AGENT_SLUG,
  DEFAULT_AGENT_PERSONALITY,
  DEFAULT_AGENT_NAME,
  DEFAULT_AGENT_DESCRIPTION,
  type MigrationReport,
  type MigrationError,
} from '../../../src/core/agent/agent-migration.js';

/**
 * §0.3.0 Task 3: default agent 自动创建 + 现有 sessions 迁移
 *
 * 测试迁移模块的核心契约：
 * - ensureDefaultAgent: 创建 default agent / 幂等 / 路径校验
 * - migrateLegacySessions: 有/无 userId 的 session 迁移到正确路径
 * - migrateLegacySessions: default agent AGENT.md 自动创建
 * - migrateLegacySessions: .meta.json 添加 agentId 字段
 * - migrateLegacySessions: 重复运行不重复迁移（幂等）
 * - migrateLegacySessions: 中断后重新运行可继续
 * - migrateLegacySessions: 报告字段正确（migratedSessions / createdAgents / errors）
 * - migrateLegacySessions: 边界场景（无 legacy 目录 / 损坏 meta / 多用户混合）
 */

describe('agent-migration', () => {
  let tmpDataDir: string;
  let legacySessionsDir: string;
  let agentStorage: AgentStorage;

  // 真实 UUID v4 形态（36 字符）
  const TEST_USER_ID = 'a1b2c3d4-e5f6-7890-1234-567890abcdef';
  const OTHER_USER_ID = '11111111-2222-3333-4444-555555555555';

  beforeEach(() => {
    tmpDataDir = mkdtempSync(join(tmpdir(), 'aptbot-migration-'));
    legacySessionsDir = join(tmpDataDir, 'sessions');
    mkdirSync(legacySessionsDir, { recursive: true });
    agentStorage = new AgentStorage(tmpDataDir);
  });

  afterEach(() => {
    rmSync(tmpDataDir, { recursive: true, force: true });
  });

  /** 生成合法 sessionId（UUID v4 形态） */
  function validSessionId(): string {
    return randomUUID();
  }

  /** 在 legacy sessions 目录写入一个测试 session */
  function writeLegacySession(
    sessionId: string,
    options: { userId?: string; content?: string; meta?: Record<string, unknown> } = {},
  ): void {
    const jsonlPath = join(legacySessionsDir, `${sessionId}.jsonl`);
    const metaPath = join(legacySessionsDir, `${sessionId}.meta.json`);
    const content =
      options.content ??
      JSON.stringify({
        type: 'message',
        id: 'msg-1',
        message: { role: 'user', content: 'hello' },
        timestamp: Date.now(),
      });
    writeFileSync(jsonlPath, content + '\n', 'utf-8');
    const meta: Record<string, unknown> = {};
    if (options.userId) meta.userId = options.userId;
    if (options.meta) Object.assign(meta, options.meta);
    writeFileSync(metaPath, JSON.stringify(meta, null, 2), 'utf-8');
  }

  /** 计算迁移后 session 的标准路径 */
  function newSessionPath(userId: string, slug: string, sessionId: string): string {
    return join(
      tmpDataDir,
      'users',
      userId,
      'agents',
      slug,
      'sessions',
      `${sessionId}.jsonl`,
    );
  }

  /** 计算迁移后 meta 的标准路径 */
  function newMetaPath(userId: string, slug: string, sessionId: string): string {
    return join(
      tmpDataDir,
      'users',
      userId,
      'agents',
      slug,
      'sessions',
      `${sessionId}.meta.json`,
    );
  }

  /** 读取迁移后的 meta.json */
  function readNewMeta(userId: string, slug: string, sessionId: string): Record<string, unknown> {
    const path = newMetaPath(userId, slug, sessionId);
    return JSON.parse(readFileSync(path, 'utf-8'));
  }

  describe('常量', () => {
    it('DEFAULT_AGENT_SLUG = "default"', () => {
      expect(DEFAULT_AGENT_SLUG).toBe('default');
    });

    it('DEFAULT_AGENT_SLUG 通过 AGENT_SLUG_REGEX 校验', async () => {
      // 与 AgentStorage 路径校验兼容
      const exists = await agentStorage.exists(TEST_USER_ID, DEFAULT_AGENT_SLUG);
      expect(exists).toBe(false); // 不存在但不抛错即说明 slug 合法
    });

    it('DEFAULT_AGENT_PERSONALITY 非空字符串', () => {
      expect(DEFAULT_AGENT_PERSONALITY.length).toBeGreaterThan(0);
    });

    it('DEFAULT_AGENT_NAME 非空', () => {
      expect(DEFAULT_AGENT_NAME.length).toBeGreaterThan(0);
    });

    it('DEFAULT_AGENT_DESCRIPTION 非空', () => {
      expect(DEFAULT_AGENT_DESCRIPTION.length).toBeGreaterThan(0);
    });
  });

  describe('ensureDefaultAgent', () => {
    it('首次调用创建 default agent 并返回 profile', async () => {
      const profile = await ensureDefaultAgent(TEST_USER_ID, agentStorage);
      expect(profile).toBeDefined();
      expect(profile.userId).toBe(TEST_USER_ID);
      expect(profile.slug).toBe(DEFAULT_AGENT_SLUG);
      expect(profile.type).toBe('default');
      expect(profile.name).toBe(DEFAULT_AGENT_NAME);
      expect(profile.description).toBe(DEFAULT_AGENT_DESCRIPTION);
      expect(profile.personality).toBe(DEFAULT_AGENT_PERSONALITY);
    });

    it('创建后 AGENT.md 文件存在', async () => {
      await ensureDefaultAgent(TEST_USER_ID, agentStorage);
      const mdPath = join(
        tmpDataDir,
        'users',
        TEST_USER_ID,
        'agents',
        DEFAULT_AGENT_SLUG,
        'AGENT.md',
      );
      expect(existsSync(mdPath)).toBe(true);
    });

    it('重复调用不重复创建（幂等）', async () => {
      const first = await ensureDefaultAgent(TEST_USER_ID, agentStorage);
      const second = await ensureDefaultAgent(TEST_USER_ID, agentStorage);
      // 同一 profile（createdAt/updatedAt 来自文件 stat 应一致）
      expect(second.userId).toBe(first.userId);
      expect(second.slug).toBe(first.slug);
      expect(second.name).toBe(first.name);
    });

    it('不同 userId 创建独立的 default agent', async () => {
      const a = await ensureDefaultAgent(TEST_USER_ID, agentStorage);
      const b = await ensureDefaultAgent(OTHER_USER_ID, agentStorage);
      expect(a.userId).toBe(TEST_USER_ID);
      expect(b.userId).toBe(OTHER_USER_ID);
      // 两个用户的 agent 隔离
      const listA = await agentStorage.listAgents(TEST_USER_ID);
      const listB = await agentStorage.listAgents(OTHER_USER_ID);
      expect(listA).toHaveLength(1);
      expect(listB).toHaveLength(1);
      expect(listA[0].userId).toBe(TEST_USER_ID);
      expect(listB[0].userId).toBe(OTHER_USER_ID);
    });

    it('非法 userId 抛错（路径遍历防护）', async () => {
      await expect(ensureDefaultAgent('../etc', agentStorage)).rejects.toThrow(/userId/);
      await expect(ensureDefaultAgent('user-1', agentStorage)).rejects.toThrow(/userId/);
      await expect(ensureDefaultAgent('', agentStorage)).rejects.toThrow(/userId/);
    });

    it('调用后通过 agentStorage.exists 返回 true', async () => {
      expect(await agentStorage.exists(TEST_USER_ID, DEFAULT_AGENT_SLUG)).toBe(false);
      await ensureDefaultAgent(TEST_USER_ID, agentStorage);
      expect(await agentStorage.exists(TEST_USER_ID, DEFAULT_AGENT_SLUG)).toBe(true);
    });
  });

  describe('migrateLegacySessions — 基本迁移', () => {
    it('有 userId 的 session 迁移到正确路径', async () => {
      const sessionId = validSessionId();
      writeLegacySession(sessionId, { userId: TEST_USER_ID });

      const report = await migrateLegacySessions(tmpDataDir, agentStorage);

      expect(report.migratedSessions).toBe(1);
      // 新路径存在
      expect(existsSync(newSessionPath(TEST_USER_ID, DEFAULT_AGENT_SLUG, sessionId))).toBe(true);
      expect(existsSync(newMetaPath(TEST_USER_ID, DEFAULT_AGENT_SLUG, sessionId))).toBe(true);
      // legacy 路径不存在
      expect(existsSync(join(legacySessionsDir, `${sessionId}.jsonl`))).toBe(false);
      expect(existsSync(join(legacySessionsDir, `${sessionId}.meta.json`))).toBe(false);
    });

    it('迁移后的 .meta.json 含 agentId=default 字段', async () => {
      const sessionId = validSessionId();
      writeLegacySession(sessionId, { userId: TEST_USER_ID });

      await migrateLegacySessions(tmpDataDir, agentStorage);

      const meta = readNewMeta(TEST_USER_ID, DEFAULT_AGENT_SLUG, sessionId);
      expect(meta.agentId).toBe(DEFAULT_AGENT_SLUG);
      expect(meta.userId).toBe(TEST_USER_ID);
    });

    it('迁移后保留原 meta 字段（label / preview）', async () => {
      const sessionId = validSessionId();
      writeLegacySession(sessionId, {
        userId: TEST_USER_ID,
        meta: { label: 'my session', preview: 'hello world' },
      });

      await migrateLegacySessions(tmpDataDir, agentStorage);

      const meta = readNewMeta(TEST_USER_ID, DEFAULT_AGENT_SLUG, sessionId);
      expect(meta.label).toBe('my session');
      expect(meta.preview).toBe('hello world');
      expect(meta.agentId).toBe(DEFAULT_AGENT_SLUG);
    });

    it('迁移后的 .jsonl 内容与 legacy 一致', async () => {
      const sessionId = validSessionId();
      const originalContent = JSON.stringify({
        type: 'message',
        id: 'msg-1',
        message: { role: 'user', content: 'hello world' },
        timestamp: 1234567890,
      });
      writeLegacySession(sessionId, {
        userId: TEST_USER_ID,
        content: originalContent,
      });

      await migrateLegacySessions(tmpDataDir, agentStorage);

      const migrated = readFileSync(
        newSessionPath(TEST_USER_ID, DEFAULT_AGENT_SLUG, sessionId),
        'utf-8',
      ).trim();
      expect(migrated).toBe(originalContent);
    });

    it('无 userId 的 session 生成伪 userId 并迁移', async () => {
      const sessionId = validSessionId();
      // 不写 userId
      writeLegacySession(sessionId);

      const report = await migrateLegacySessions(tmpDataDir, agentStorage);

      expect(report.migratedSessions).toBe(1);
      // legacy 目录应已清空（session 文件移走）
      const remaining = readdirSync(legacySessionsDir);
      expect(remaining).toEqual([]);

      // 找到迁移后的 session：扫所有用户目录
      const usersDir = join(tmpDataDir, 'users');
      const userDirs = readdirSync(usersDir);
      expect(userDirs).toHaveLength(1);
      const pseudoUserId = userDirs[0];
      // 伪 userId 应为合法 UUID
      expect(pseudoUserId).toMatch(/^[a-f0-9-]{36}$/);

      // session 在该用户的 default agent 下
      expect(
        existsSync(newSessionPath(pseudoUserId, DEFAULT_AGENT_SLUG, sessionId)),
      ).toBe(true);
      // meta 含伪 userId + agentId
      const meta = readNewMeta(pseudoUserId, DEFAULT_AGENT_SLUG, sessionId);
      expect(meta.userId).toBe(pseudoUserId);
      expect(meta.agentId).toBe(DEFAULT_AGENT_SLUG);
    });
  });

  describe('migrateLegacySessions — default agent 自动创建', () => {
    it('迁移时为每个 userId 自动创建 default agent', async () => {
      const sessionId = validSessionId();
      writeLegacySession(sessionId, { userId: TEST_USER_ID });

      await migrateLegacySessions(tmpDataDir, agentStorage);

      // AGENT.md 存在
      const mdPath = join(
        tmpDataDir,
        'users',
        TEST_USER_ID,
        'agents',
        DEFAULT_AGENT_SLUG,
        'AGENT.md',
      );
      expect(existsSync(mdPath)).toBe(true);
      // 通过 agentStorage 可读取
      const profile = await agentStorage.getAgent(TEST_USER_ID, DEFAULT_AGENT_SLUG);
      expect(profile).not.toBeNull();
      expect(profile!.type).toBe('default');
      expect(profile!.name).toBe(DEFAULT_AGENT_NAME);
    });

    it('迁移前已存在 default agent 时不重复创建', async () => {
      const sessionId = validSessionId();
      writeLegacySession(sessionId, { userId: TEST_USER_ID });

      // 先手动创建 default agent
      await ensureDefaultAgent(TEST_USER_ID, agentStorage);
      const originalProfile = await agentStorage.getAgent(TEST_USER_ID, DEFAULT_AGENT_SLUG);
      expect(originalProfile).not.toBeNull();
      const originalUpdatedAt = originalProfile!.updatedAt;

      // 等待文件 stat mtime 更新可区分
      await new Promise((r) => setTimeout(r, 20));

      // 迁移
      const report = await migrateLegacySessions(tmpDataDir, agentStorage);
      expect(report.migratedSessions).toBe(1);
      expect(report.createdAgents).toBe(0); // 未创建新 agent

      // AGENT.md 未被覆盖
      const afterProfile = await agentStorage.getAgent(TEST_USER_ID, DEFAULT_AGENT_SLUG);
      expect(afterProfile).not.toBeNull();
      expect(afterProfile!.updatedAt).toBe(originalUpdatedAt);
    });
  });

  describe('migrateLegacySessions — 幂等性', () => {
    it('重复运行不重复迁移（已迁移的 session 跳过）', async () => {
      const sessionId = validSessionId();
      writeLegacySession(sessionId, { userId: TEST_USER_ID });

      // 第一次迁移
      const report1 = await migrateLegacySessions(tmpDataDir, agentStorage);
      expect(report1.migratedSessions).toBe(1);
      expect(report1.createdAgents).toBe(1);

      // 第二次迁移（应全部跳过）
      const report2 = await migrateLegacySessions(tmpDataDir, agentStorage);
      expect(report2.migratedSessions).toBe(0);
      expect(report2.createdAgents).toBe(0);
      expect(report2.errors).toEqual([]);

      // 文件仍在原位
      expect(existsSync(newSessionPath(TEST_USER_ID, DEFAULT_AGENT_SLUG, sessionId))).toBe(true);
    });

    it('部分已迁移部分未迁移时仅迁移未完成部分', async () => {
      const session1 = validSessionId();
      const session2 = validSessionId();
      writeLegacySession(session1, { userId: TEST_USER_ID });
      writeLegacySession(session2, { userId: TEST_USER_ID });

      // 第一次迁移一个
      await migrateLegacySessions(tmpDataDir, agentStorage);
      expect(existsSync(newSessionPath(TEST_USER_ID, DEFAULT_AGENT_SLUG, session1))).toBe(true);
      expect(existsSync(newSessionPath(TEST_USER_ID, DEFAULT_AGENT_SLUG, session2))).toBe(true);

      // 添加新 session（模拟增量迁移）
      const session3 = validSessionId();
      writeLegacySession(session3, { userId: TEST_USER_ID });

      // 第二次迁移
      const report2 = await migrateLegacySessions(tmpDataDir, agentStorage);
      expect(report2.migratedSessions).toBe(1); // 仅 session3
      expect(report2.createdAgents).toBe(0); // default agent 已存在

      // 三个 session 都在位
      expect(existsSync(newSessionPath(TEST_USER_ID, DEFAULT_AGENT_SLUG, session1))).toBe(true);
      expect(existsSync(newSessionPath(TEST_USER_ID, DEFAULT_AGENT_SLUG, session2))).toBe(true);
      expect(existsSync(newSessionPath(TEST_USER_ID, DEFAULT_AGENT_SLUG, session3))).toBe(true);
    });
  });

  describe('migrateLegacySessions — 中断后重新运行可继续', () => {
    it('模拟部分迁移状态后重新运行可完成（仅 meta 写入但 jsonl 未移）', async () => {
      const sessionId = validSessionId();
      writeLegacySession(sessionId, { userId: TEST_USER_ID });

      // 先确保 default agent 存在（模拟迁移已进行到这一步）
      await ensureDefaultAgent(TEST_USER_ID, agentStorage);

      // 模拟「中断」：手动写入新 .meta.json 但不移动 .jsonl
      // （迁移过程中 writeFileSync(metaTmpPath) 已完成但 renameSync(jsonl) 未执行）
      const partialMetaDir = join(
        tmpDataDir,
        'users',
        TEST_USER_ID,
        'agents',
        DEFAULT_AGENT_SLUG,
        'sessions',
      );
      mkdirSync(partialMetaDir, { recursive: true });
      const partialMetaPath = join(partialMetaDir, `${sessionId}.meta.json`);
      writeFileSync(
        partialMetaPath,
        JSON.stringify({ userId: TEST_USER_ID, agentId: DEFAULT_AGENT_SLUG }, null, 2),
        'utf-8',
      );

      // 此时：legacy .jsonl + .meta.json 仍存在；新 .meta.json 存在但新 .jsonl 不存在

      // 重新运行迁移
      const report = await migrateLegacySessions(tmpDataDir, agentStorage);
      expect(report.migratedSessions).toBe(1); // 完成 session 迁移
      expect(report.errors).toEqual([]);

      // 验证：新 .jsonl 已存在，legacy 文件已清理
      expect(existsSync(newSessionPath(TEST_USER_ID, DEFAULT_AGENT_SLUG, sessionId))).toBe(true);
      expect(existsSync(join(legacySessionsDir, `${sessionId}.jsonl`))).toBe(false);
      expect(existsSync(join(legacySessionsDir, `${sessionId}.meta.json`))).toBe(false);
    });

    it('模拟 .jsonl 已迁移但 legacy 未清理的状态后重新运行可清理', async () => {
      const sessionId = validSessionId();
      writeLegacySession(sessionId, { userId: TEST_USER_ID });

      // 模拟「中断」：迁移已完成 .jsonl + .meta.json 写入，但 legacy 未清理
      await ensureDefaultAgent(TEST_USER_ID, agentStorage);
      const sessionsDir = join(
        tmpDataDir,
        'users',
        TEST_USER_ID,
        'agents',
        DEFAULT_AGENT_SLUG,
        'sessions',
      );
      mkdirSync(sessionsDir, { recursive: true });
      // 复制 .jsonl 到新路径
      const legacyJsonl = join(legacySessionsDir, `${sessionId}.jsonl`);
      const newJsonl = join(sessionsDir, `${sessionId}.jsonl`);
      writeFileSync(newJsonl, readFileSync(legacyJsonl));
      // 不删除 legacy

      // 重新运行迁移
      const report = await migrateLegacySessions(tmpDataDir, agentStorage);
      // 已迁移 → 不计数
      expect(report.migratedSessions).toBe(0);
      expect(report.errors).toEqual([]);
      // legacy 已清理
      expect(existsSync(legacyJsonl)).toBe(false);
      expect(existsSync(join(legacySessionsDir, `${sessionId}.meta.json`))).toBe(false);
      // 新路径仍在
      expect(existsSync(newJsonl)).toBe(true);
    });
  });

  describe('migrateLegacySessions — 多用户混合', () => {
    it('不同用户的 session 迁移到各自用户的 default agent 下', async () => {
      const s1 = validSessionId();
      const s2 = validSessionId();
      const s3 = validSessionId();
      writeLegacySession(s1, { userId: TEST_USER_ID });
      writeLegacySession(s2, { userId: OTHER_USER_ID });
      writeLegacySession(s3, { userId: TEST_USER_ID });

      const report = await migrateLegacySessions(tmpDataDir, agentStorage);

      expect(report.migratedSessions).toBe(3);
      expect(report.createdAgents).toBe(2); // 两个用户各创建一个

      // 验证路径
      expect(existsSync(newSessionPath(TEST_USER_ID, DEFAULT_AGENT_SLUG, s1))).toBe(true);
      expect(existsSync(newSessionPath(OTHER_USER_ID, DEFAULT_AGENT_SLUG, s2))).toBe(true);
      expect(existsSync(newSessionPath(TEST_USER_ID, DEFAULT_AGENT_SLUG, s3))).toBe(true);

      // 两个用户各有一个 default agent
      expect(await agentStorage.countAgents(TEST_USER_ID)).toBe(1);
      expect(await agentStorage.countAgents(OTHER_USER_ID)).toBe(1);
    });

    it('混合匿名与具名 session 都正确迁移', async () => {
      const s1 = validSessionId(); // 具名
      const s2 = validSessionId(); // 匿名
      const s3 = validSessionId(); // 具名
      writeLegacySession(s1, { userId: TEST_USER_ID });
      writeLegacySession(s2); // 无 userId
      writeLegacySession(s3, { userId: TEST_USER_ID });

      const report = await migrateLegacySessions(tmpDataDir, agentStorage);

      expect(report.migratedSessions).toBe(3);
      expect(report.createdAgents).toBe(2); // TEST_USER_ID + 1 个匿名

      // 验证：TEST_USER_ID 下有 s1 + s3
      expect(existsSync(newSessionPath(TEST_USER_ID, DEFAULT_AGENT_SLUG, s1))).toBe(true);
      expect(existsSync(newSessionPath(TEST_USER_ID, DEFAULT_AGENT_SLUG, s3))).toBe(true);

      // 匿名 session s2 迁移到某个伪 userId 下
      const usersDir = join(tmpDataDir, 'users');
      const userDirs = readdirSync(usersDir);
      // 两个用户：TEST_USER_ID + 一个伪 userId
      expect(userDirs).toHaveLength(2);
      expect(userDirs).toContain(TEST_USER_ID);
      const pseudoUserId = userDirs.find((u) => u !== TEST_USER_ID);
      expect(pseudoUserId).toBeDefined();
      expect(existsSync(newSessionPath(pseudoUserId!, DEFAULT_AGENT_SLUG, s2))).toBe(true);
    });
  });

  describe('migrateLegacySessions — 边界场景', () => {
    it('legacy 目录不存在时返回空报告', async () => {
      // 删除 legacy 目录
      rmSync(legacySessionsDir, { recursive: true, force: true });

      const report = await migrateLegacySessions(tmpDataDir, agentStorage);

      expect(report.migratedSessions).toBe(0);
      expect(report.createdAgents).toBe(0);
      expect(report.errors).toEqual([]);
    });

    it('legacy 目录为空时返回空报告', async () => {
      const report = await migrateLegacySessions(tmpDataDir, agentStorage);

      expect(report.migratedSessions).toBe(0);
      expect(report.createdAgents).toBe(0);
      expect(report.errors).toEqual([]);
    });

    it('损坏的 .meta.json 当作匿名 session 处理', async () => {
      const sessionId = validSessionId();
      // 写合法 .jsonl
      writeFileSync(
        join(legacySessionsDir, `${sessionId}.jsonl`),
        '{"type":"message"}\n',
        'utf-8',
      );
      // 写损坏的 .meta.json
      writeFileSync(
        join(legacySessionsDir, `${sessionId}.meta.json`),
        'this is not valid json',
        'utf-8',
      );

      const report = await migrateLegacySessions(tmpDataDir, agentStorage);

      expect(report.migratedSessions).toBe(1);
      expect(report.errors).toEqual([]);
      // session 被当作匿名处理（生成伪 userId）
      const usersDir = join(tmpDataDir, 'users');
      const userDirs = readdirSync(usersDir);
      expect(userDirs).toHaveLength(1);
      const pseudoUserId = userDirs[0];
      expect(pseudoUserId).toMatch(/^[a-f0-9-]{36}$/);
      expect(
        existsSync(newSessionPath(pseudoUserId, DEFAULT_AGENT_SLUG, sessionId)),
      ).toBe(true);
    });

    it('.meta.json 不存在时当作匿名 session 处理', async () => {
      const sessionId = validSessionId();
      // 仅写 .jsonl，不写 .meta.json
      writeFileSync(
        join(legacySessionsDir, `${sessionId}.jsonl`),
        '{"type":"message"}\n',
        'utf-8',
      );

      const report = await migrateLegacySessions(tmpDataDir, agentStorage);

      expect(report.migratedSessions).toBe(1);
      expect(report.errors).toEqual([]);
      // session 被当作匿名处理
      const usersDir = join(tmpDataDir, 'users');
      const userDirs = readdirSync(usersDir);
      expect(userDirs).toHaveLength(1);
      const pseudoUserId = userDirs[0];
      expect(pseudoUserId).toMatch(/^[a-f0-9-]{36}$/);
    });

    it('非法 userId 的 session 加入 errors 不抛错', async () => {
      const sessionId = validSessionId();
      writeLegacySession(sessionId, {
        userId: 'not-a-uuid', // 非法 userId
      });

      const report = await migrateLegacySessions(tmpDataDir, agentStorage);

      expect(report.migratedSessions).toBe(0);
      expect(report.errors).toHaveLength(1);
      expect(report.errors[0].sessionId).toBe(sessionId);
      expect(report.errors[0].error).toBeDefined();
      // legacy 文件保留
      expect(existsSync(join(legacySessionsDir, `${sessionId}.jsonl`))).toBe(true);
    });
  });

  describe('migrateLegacySessions — 报告字段', () => {
    it('MigrationReport 含 migratedSessions / createdAgents / errors 字段', async () => {
      const report: MigrationReport = await migrateLegacySessions(tmpDataDir, agentStorage);
      expect(report).toHaveProperty('migratedSessions');
      expect(report).toHaveProperty('createdAgents');
      expect(report).toHaveProperty('errors');
      expect(typeof report.migratedSessions).toBe('number');
      expect(typeof report.createdAgents).toBe('number');
      expect(Array.isArray(report.errors)).toBe(true);
    });

    it('MigrationError 含 sessionId + error 字段', async () => {
      // 触发一个 error
      const sessionId = validSessionId();
      writeLegacySession(sessionId, { userId: 'invalid' });

      const report = await migrateLegacySessions(tmpDataDir, agentStorage);
      expect(report.errors.length).toBeGreaterThan(0);
      const err: MigrationError = report.errors[0];
      expect(err).toHaveProperty('sessionId');
      expect(err).toHaveProperty('error');
      expect(typeof err.sessionId).toBe('string');
      expect(typeof err.error).toBe('string');
    });

    it('成功迁移的报告示例', async () => {
      const s1 = validSessionId();
      const s2 = validSessionId();
      writeLegacySession(s1, { userId: TEST_USER_ID });
      writeLegacySession(s2, { userId: TEST_USER_ID });

      const report = await migrateLegacySessions(tmpDataDir, agentStorage);
      expect(report.migratedSessions).toBe(2);
      expect(report.createdAgents).toBe(1); // 同一用户只创建一个 default agent
      expect(report.errors).toEqual([]);
    });
  });
});
