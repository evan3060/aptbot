import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { UiConfigStorage } from '../../../src/core/agent/ui-config.js';

/**
 * §0.3.0 Task 10: UiConfigStorage — UI 层 visibleSkills 配置持久化
 *
 * 测试契约：
 * - 存储路径：data/users/<userId>/agents/default/ui-config.json
 * - get 不存在文件 → 空 visibleSkills
 * - update 后 get → 返回相同配置
 * - 损坏 JSON → 空 visibleSkills + console.warn（不抛错）
 * - 原子写：write-to-tmp + rename，无残留 tmp 文件
 * - 路径遍历防护：非法 userId 抛错
 */

describe('UiConfigStorage', () => {
  let tmpDataDir: string;
  let storage: UiConfigStorage;
  // 真实 UUID v4 形态（36 字符，小写 hex + 短横线）
  const TEST_USER_ID = 'a1b2c3d4-e5f6-7890-1234-567890abcdef';

  beforeEach(() => {
    tmpDataDir = mkdtempSync(join(tmpdir(), 'aptbot-ui-config-'));
    storage = new UiConfigStorage(tmpDataDir);
  });

  afterEach(() => {
    rmSync(tmpDataDir, { recursive: true, force: true });
  });

  describe('get', () => {
    it('文件不存在时返回空 visibleSkills', async () => {
      const config = await storage.get(TEST_USER_ID);
      expect(config).toEqual({ visibleSkills: [] });
    });

    it('用户目录不存在时返回空 visibleSkills（不抛错）', async () => {
      const config = await storage.get(TEST_USER_ID);
      expect(config).toEqual({ visibleSkills: [] });
    });

    it('损坏 JSON 文件返回空 visibleSkills + console.warn', async () => {
      // 直接写入损坏的 JSON 内容
      const configDir = join(
        tmpDataDir,
        'users',
        TEST_USER_ID,
        'agents',
        'default',
      );
      mkdirSync(configDir, { recursive: true });
      writeFileSync(
        join(configDir, 'ui-config.json'),
        '{not valid json',
        'utf-8',
      );

      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const config = await storage.get(TEST_USER_ID);
      expect(config).toEqual({ visibleSkills: [] });
      // 应该有 warn 调用（log 解析错误）
      expect(warnSpy).toHaveBeenCalled();

      warnSpy.mockRestore();
    });

    it('损坏 JSON 不抛错（graceful 降级）', async () => {
      const configDir = join(
        tmpDataDir,
        'users',
        TEST_USER_ID,
        'agents',
        'default',
      );
      mkdirSync(configDir, { recursive: true });
      writeFileSync(
        join(configDir, 'ui-config.json'),
        '---broken---',
        'utf-8',
      );

      // 不应抛错
      const config = await storage.get(TEST_USER_ID);
      expect(config).toEqual({ visibleSkills: [] });
    });

    it('get 剥离文件中手动编辑的额外字段（仅保留 slug + displayName）', async () => {
      const configDir = join(
        tmpDataDir,
        'users',
        TEST_USER_ID,
        'agents',
        'default',
      );
      mkdirSync(configDir, { recursive: true });
      // 手动写入含额外字段（top-level + per-item）的合法 JSON
      writeFileSync(
        join(configDir, 'ui-config.json'),
        JSON.stringify({
          visibleSkills: [
            {
              slug: 'skill-a',
              displayName: 'A',
              extraField: 'should-not-leak',
              nested: { x: 1 },
            },
            {
              slug: 'skill-b',
              displayName: 'B',
              secret: 'should-not-leak',
            },
          ],
          topLevelExtra: 'should-not-leak',
        }),
        'utf-8',
      );

      const config = await storage.get(TEST_USER_ID);
      // 仅保留 slug + displayName，额外字段被剥离（与 PUT 校验对称）
      expect(config).toEqual({
        visibleSkills: [
          { slug: 'skill-a', displayName: 'A' },
          { slug: 'skill-b', displayName: 'B' },
        ],
      });
      // 额外字段未泄漏到返回对象
      expect(
        (config.visibleSkills[0] as Record<string, unknown>).extraField,
      ).toBeUndefined();
      expect(
        (config as Record<string, unknown>).topLevelExtra,
      ).toBeUndefined();
    });

    it('mutating 返回的空配置不影响后续 get（每次返回 fresh object）', async () => {
      // 文件不存在 → 返回空配置
      const first = await storage.get(TEST_USER_ID);
      expect(first).toEqual({ visibleSkills: [] });

      // 恶意 mutate 返回对象
      first.visibleSkills.push({
        slug: 'injected',
        displayName: 'Injected',
      } as never);

      // 第二次 get 仍应返回独立的空配置，不受上次 mutation 影响
      const second = await storage.get(TEST_USER_ID);
      expect(second).toEqual({ visibleSkills: [] });
      expect(second.visibleSkills).toHaveLength(0);
      // 确保两次返回的不是同一个引用
      expect(second).not.toBe(first);
    });
  });

  describe('update + get round-trip', () => {
    it('update 后 get 返回相同配置', async () => {
      const config = {
        visibleSkills: [
          { slug: 'skill-foo', displayName: 'Foo Skill' },
          { slug: 'skill-bar', displayName: 'Bar Skill' },
        ],
      };
      await storage.update(TEST_USER_ID, config);

      const read = await storage.get(TEST_USER_ID);
      expect(read).toEqual(config);
    });

    it('update 空 visibleSkills 后 get 返回空', async () => {
      await storage.update(TEST_USER_ID, { visibleSkills: [] });
      const read = await storage.get(TEST_USER_ID);
      expect(read).toEqual({ visibleSkills: [] });
    });

    it('覆盖 update 已存在的配置', async () => {
      // 先写一个配置
      await storage.update(TEST_USER_ID, {
        visibleSkills: [{ slug: 'old', displayName: 'Old' }],
      });
      // 覆盖
      await storage.update(TEST_USER_ID, {
        visibleSkills: [{ slug: 'new', displayName: 'New' }],
      });
      const read = await storage.get(TEST_USER_ID);
      expect(read.visibleSkills).toEqual([
        { slug: 'new', displayName: 'New' },
      ]);
    });

    it('写入到正确路径 data/users/<userId>/agents/default/ui-config.json', async () => {
      await storage.update(TEST_USER_ID, {
        visibleSkills: [{ slug: 'x', displayName: 'X' }],
      });

      const expectedPath = join(
        tmpDataDir,
        'users',
        TEST_USER_ID,
        'agents',
        'default',
        'ui-config.json',
      );
      expect(existsSync(expectedPath)).toBe(true);
    });
  });

  describe('原子写', () => {
    it('update 后无残留 .tmp 文件', async () => {
      await storage.update(TEST_USER_ID, {
        visibleSkills: [{ slug: 'a', displayName: 'A' }],
      });

      const configDir = join(
        tmpDataDir,
        'users',
        TEST_USER_ID,
        'agents',
        'default',
      );
      const files = readdirSync(configDir);
      // 仅应有 ui-config.json，不应有 ui-config.json.tmp
      expect(files).toContain('ui-config.json');
      expect(files.some((f) => f.endsWith('.tmp'))).toBe(false);
    });

    it('自动创建多层目录', async () => {
      await storage.update(TEST_USER_ID, {
        visibleSkills: [{ slug: 'a', displayName: 'A' }],
      });

      const configPath = join(
        tmpDataDir,
        'users',
        TEST_USER_ID,
        'agents',
        'default',
        'ui-config.json',
      );
      expect(existsSync(configPath)).toBe(true);
    });
  });

  describe('路径遍历防护', () => {
    it('非法 userId 在 get 时抛错', async () => {
      await expect(storage.get('../etc')).rejects.toThrow(/userId/);
      await expect(storage.get('user-1')).rejects.toThrow(/userId/);
      await expect(storage.get('')).rejects.toThrow(/userId/);
    });

    it('非法 userId 在 update 时抛错', async () => {
      await expect(
        storage.update('../etc', { visibleSkills: [] }),
      ).rejects.toThrow(/userId/);
      await expect(
        storage.update('user-1', { visibleSkills: [] }),
      ).rejects.toThrow(/userId/);
      await expect(storage.update('', { visibleSkills: [] })).rejects.toThrow(
        /userId/,
      );
    });
  });

  describe('用户隔离', () => {
    it('不同用户的配置互不影响', async () => {
      const OTHER_USER_ID = '11111111-2222-3333-4444-555555555555';
      await storage.update(TEST_USER_ID, {
        visibleSkills: [{ slug: 'alice-skill', displayName: 'Alice' }],
      });
      await storage.update(OTHER_USER_ID, {
        visibleSkills: [{ slug: 'bob-skill', displayName: 'Bob' }],
      });

      const alice = await storage.get(TEST_USER_ID);
      const bob = await storage.get(OTHER_USER_ID);
      expect(alice.visibleSkills[0].slug).toBe('alice-skill');
      expect(bob.visibleSkills[0].slug).toBe('bob-skill');
    });
  });
});
