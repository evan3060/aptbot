import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  mkdtempSync,
  rmSync,
  existsSync,
  mkdirSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import {
  AgentStorage,
  USER_ID_REGEX,
  AGENT_LOCK_TIMEOUT_MS,
} from '../../../src/core/agent/agent-storage.js';
import type { AgentProfile } from '../../../src/core/agent/agent-profile.js';

/**
 * §0.3.0 Task 2: AgentStorage — AGENT.md 持久化与读取
 *
 * 测试 AgentStorage 的核心契约：
 * - getAgentDir: 路径计算 + 路径遍历防护
 * - saveAgent + getAgent: 写入 → 读取 round-trip
 * - listAgents: 列出多 agent + 损坏文件 warn 跳过 + 用户隔离
 * - deleteAgent: 递归删除 + 幂等
 * - exists / countAgents: 状态查询
 * - 并发写入同一 agent 串行化（无错乱）
 * - 原子写：write-to-tmp + rename，无残留 tmp 文件
 */

describe('agent-storage', () => {
  let tmpDataDir: string;
  let storage: AgentStorage;
  // 真实 UUID v4 形态（36 字符，小写 hex + 短横线）
  const TEST_USER_ID = 'a1b2c3d4-e5f6-7890-1234-567890abcdef';
  const OTHER_USER_ID = '11111111-2222-3333-4444-555555555555';

  beforeEach(() => {
    tmpDataDir = mkdtempSync(join(tmpdir(), 'aptbot-agent-storage-'));
    storage = new AgentStorage(tmpDataDir);
  });

  afterEach(() => {
    rmSync(tmpDataDir, { recursive: true, force: true });
  });

  describe('USER_ID_REGEX', () => {
    it('接受合法 UUID', () => {
      expect(USER_ID_REGEX.test(TEST_USER_ID)).toBe(true);
      expect(USER_ID_REGEX.test(randomUUID())).toBe(true);
    });

    it('拒绝非法 userId（路径遍历防护）', () => {
      expect(USER_ID_REGEX.test('../etc')).toBe(false);
      expect(USER_ID_REGEX.test('user-1')).toBe(false);
      expect(USER_ID_REGEX.test('')).toBe(false);
      expect(USER_ID_REGEX.test('a/b/c')).toBe(false);
      expect(USER_ID_REGEX.test('..')).toBe(false);
    });
  });

  describe('AGENT_LOCK_TIMEOUT_MS', () => {
    it('agent 写锁超时为 5000ms（与 jsonl-mutex 一致）', () => {
      expect(AGENT_LOCK_TIMEOUT_MS).toBe(5000);
    });
  });

  describe('getAgentDir', () => {
    it('返回 data/users/<userId>/agents/<slug>', () => {
      const dir = storage.getAgentDir(TEST_USER_ID, 'agent-a1b2c3');
      expect(dir).toBe(
        join(tmpDataDir, 'users', TEST_USER_ID, 'agents', 'agent-a1b2c3'),
      );
    });

    it('非法 userId 抛错', () => {
      expect(() => storage.getAgentDir('../etc', 'agent-a1b2c3')).toThrow(
        /userId/,
      );
      expect(() => storage.getAgentDir('user-1', 'agent-a1b2c3')).toThrow(
        /userId/,
      );
    });

    it('非法 slug 抛错', () => {
      expect(() => storage.getAgentDir(TEST_USER_ID, '../etc')).toThrow(/slug/);
      expect(() => storage.getAgentDir(TEST_USER_ID, 'AB')).toThrow(/slug/);
      expect(() => storage.getAgentDir(TEST_USER_ID, 'has space')).toThrow(
        /slug/,
      );
      expect(() => storage.getAgentDir(TEST_USER_ID, 'ab')).toThrow(/slug/); // 过短
    });
  });

  describe('saveAgent + getAgent round-trip', () => {
    it('创建 agent → 读取返回相同 profile（必填字段）', async () => {
      const profile: AgentProfile = {
        name: 'My Agent',
        description: 'A helpful assistant',
        userId: TEST_USER_ID,
        type: 'default',
        slug: 'agent-a1b2c3',
        createdAt: 1000, // 会被文件 stat 覆盖
        updatedAt: 2000, // 会被文件 stat 覆盖
        personality: 'You are a helpful assistant.',
      };

      await storage.saveAgent(profile);
      const read = await storage.getAgent(TEST_USER_ID, 'agent-a1b2c3');
      expect(read).not.toBeNull();
      expect(read!.name).toBe('My Agent');
      expect(read!.description).toBe('A helpful assistant');
      expect(read!.userId).toBe(TEST_USER_ID);
      expect(read!.type).toBe('default');
      expect(read!.slug).toBe('agent-a1b2c3');
      expect(read!.personality).toBe('You are a helpful assistant.');
      // createdAt / updatedAt 来自文件 stat，不是用户传入的值
      expect(read!.createdAt).toBeGreaterThan(0);
      expect(read!.updatedAt).toBeGreaterThan(0);
    });

    it('创建 agent → 读取返回相同 profile（含可选 LLM 配置）', async () => {
      const profile: AgentProfile = {
        name: 'Pro Agent',
        description: 'A professional assistant',
        userId: TEST_USER_ID,
        type: 'professional',
        slug: 'agent-pro123',
        createdAt: 1000,
        updatedAt: 2000,
        personality: 'You are professional.',
        model: 'gpt-4',
        temperature: 0.7,
        maxTokens: 4096,
        reasoningEffort: 'high',
        thinkingType: 'enabled',
        thinkingBudgetTokens: 1024,
      };

      await storage.saveAgent(profile);
      const read = await storage.getAgent(TEST_USER_ID, 'agent-pro123');
      expect(read).not.toBeNull();
      expect(read!.model).toBe('gpt-4');
      expect(read!.temperature).toBe(0.7);
      expect(read!.maxTokens).toBe(4096);
      expect(read!.reasoningEffort).toBe('high');
      expect(read!.thinkingType).toBe('enabled');
      expect(read!.thinkingBudgetTokens).toBe(1024);
    });

    it('读取不存在的 agent 返回 null', async () => {
      const read = await storage.getAgent(TEST_USER_ID, 'agent-notexist');
      expect(read).toBeNull();
    });

    it('保存多行 personality 后读取保留多行内容', async () => {
      const personality = `Line 1\n\nLine 2\n\n- Bullet 1\n- Bullet 2`;
      const profile: AgentProfile = {
        name: 'Multi-line Agent',
        description: 'desc',
        userId: TEST_USER_ID,
        type: 'default',
        slug: 'agent-multi1',
        createdAt: 1000,
        updatedAt: 2000,
        personality,
      };

      await storage.saveAgent(profile);
      const read = await storage.getAgent(TEST_USER_ID, 'agent-multi1');
      expect(read).not.toBeNull();
      expect(read!.personality).toContain('Line 1');
      expect(read!.personality).toContain('Line 2');
      expect(read!.personality).toContain('- Bullet 1');
      expect(read!.personality).toContain('- Bullet 2');
    });

    it('保存空 personality 后读取返回空字符串', async () => {
      const profile: AgentProfile = {
        name: 'Empty Body Agent',
        description: 'desc',
        userId: TEST_USER_ID,
        type: 'default',
        slug: 'agent-empty1',
        createdAt: 0,
        updatedAt: 0,
        personality: '',
      };

      await storage.saveAgent(profile);
      const read = await storage.getAgent(TEST_USER_ID, 'agent-empty1');
      expect(read).not.toBeNull();
      expect(read!.personality).toBe('');
    });

    it('覆盖保存已存在的 agent（更新 personality）', async () => {
      const profile: AgentProfile = {
        name: 'Overwrite',
        description: 'desc',
        userId: TEST_USER_ID,
        type: 'default',
        slug: 'agent-over1',
        createdAt: 0,
        updatedAt: 0,
        personality: 'original',
      };
      await storage.saveAgent(profile);
      // 覆盖保存
      await storage.saveAgent({ ...profile, personality: 'updated' });
      const read = await storage.getAgent(TEST_USER_ID, 'agent-over1');
      expect(read!.personality).toBe('updated');
    });

    // §0.3.0 Task 18: memoryEnabled round-trip
    it('memoryEnabled: false → 写入 frontmatter 后读取保留 false', async () => {
      const profile: AgentProfile = {
        name: 'Pro Agent No Mem',
        description: 'desc',
        userId: TEST_USER_ID,
        type: 'professional',
        slug: 'agent-nmem01',
        createdAt: 0,
        updatedAt: 0,
        personality: 'body',
        memoryEnabled: false,
      };
      await storage.saveAgent(profile);
      const read = await storage.getAgent(TEST_USER_ID, 'agent-nmem01');
      expect(read).not.toBeNull();
      expect(read!.memoryEnabled).toBe(false);
    });

    it('memoryEnabled: true → 写入 frontmatter 后读取保留 true', async () => {
      const profile: AgentProfile = {
        name: 'Pro Agent With Mem',
        description: 'desc',
        userId: TEST_USER_ID,
        type: 'professional',
        slug: 'agent-nmem02',
        createdAt: 0,
        updatedAt: 0,
        personality: 'body',
        memoryEnabled: true,
      };
      await storage.saveAgent(profile);
      const read = await storage.getAgent(TEST_USER_ID, 'agent-nmem02');
      expect(read).not.toBeNull();
      expect(read!.memoryEnabled).toBe(true);
    });

    it('memoryEnabled 未设置 → frontmatter 不含该字段，读取返回 undefined', async () => {
      const profile: AgentProfile = {
        name: 'Pro Agent Default',
        description: 'desc',
        userId: TEST_USER_ID,
        type: 'professional',
        slug: 'agent-nmem03',
        createdAt: 0,
        updatedAt: 0,
        personality: 'body',
      };
      await storage.saveAgent(profile);
      const read = await storage.getAgent(TEST_USER_ID, 'agent-nmem03');
      expect(read).not.toBeNull();
      expect(read!.memoryEnabled).toBeUndefined();
    });
  });

  describe('saveAgent 路径遍历防护', () => {
    it('slug 含路径分隔符时抛错', async () => {
      const profile: AgentProfile = {
        name: 'Bad Agent',
        description: 'desc',
        userId: TEST_USER_ID,
        type: 'default',
        slug: '../etc',
        createdAt: 0,
        updatedAt: 0,
        personality: 'body',
      };
      await expect(storage.saveAgent(profile)).rejects.toThrow(/slug/);
    });

    it('userId 含路径分隔符时抛错', async () => {
      const profile: AgentProfile = {
        name: 'Bad Agent',
        description: 'desc',
        userId: '../etc',
        type: 'default',
        slug: 'agent-a1b2c3',
        createdAt: 0,
        updatedAt: 0,
        personality: 'body',
      };
      await expect(storage.saveAgent(profile)).rejects.toThrow(/userId/);
    });
  });

  describe('saveAgent 原子写', () => {
    it('保存后文件存在且无残留 tmp 文件', async () => {
      const profile: AgentProfile = {
        name: 'Atomic Agent',
        description: 'desc',
        userId: TEST_USER_ID,
        type: 'default',
        slug: 'agent-atom1',
        createdAt: 0,
        updatedAt: 0,
        personality: 'body',
      };
      await storage.saveAgent(profile);
      const mdPath = join(
        tmpDataDir,
        'users',
        TEST_USER_ID,
        'agents',
        'agent-atom1',
        'AGENT.md',
      );
      expect(existsSync(mdPath)).toBe(true);
      // 原子写：tmp 文件应已被 rename，无残留
      expect(existsSync(`${mdPath}.tmp`)).toBe(false);
    });

    it('自动创建多层目录', async () => {
      const profile: AgentProfile = {
        name: 'Auto Dir Agent',
        description: 'desc',
        userId: TEST_USER_ID,
        type: 'default',
        slug: 'agent-autod1',
        createdAt: 0,
        updatedAt: 0,
        personality: 'body',
      };
      await storage.saveAgent(profile);
      const agentDir = join(
        tmpDataDir,
        'users',
        TEST_USER_ID,
        'agents',
        'agent-autod1',
      );
      expect(existsSync(agentDir)).toBe(true);
    });
  });

  describe('listAgents', () => {
    it('用户无 agent 时返回空数组', async () => {
      const list = await storage.listAgents(TEST_USER_ID);
      expect(list).toEqual([]);
    });

    it('用户目录不存在时返回空数组（不抛错）', async () => {
      const list = await storage.listAgents(TEST_USER_ID);
      expect(list).toEqual([]);
    });

    it('列出多个 agent', async () => {
      const profiles: AgentProfile[] = [
        {
          name: 'Agent A',
          description: 'desc',
          userId: TEST_USER_ID,
          type: 'default',
          slug: 'agent-aaa1',
          createdAt: 0,
          updatedAt: 0,
          personality: 'A',
        },
        {
          name: 'Agent B',
          description: 'desc',
          userId: TEST_USER_ID,
          type: 'default',
          slug: 'agent-bbb1',
          createdAt: 0,
          updatedAt: 0,
          personality: 'B',
        },
        {
          name: 'Agent C',
          description: 'desc',
          userId: TEST_USER_ID,
          type: 'professional',
          slug: 'agent-ccc1',
          createdAt: 0,
          updatedAt: 0,
          personality: 'C',
        },
      ];
      for (const p of profiles) {
        await storage.saveAgent(p);
      }
      const list = await storage.listAgents(TEST_USER_ID);
      expect(list).toHaveLength(3);
      const slugs = list.map((p) => p.slug).sort();
      expect(slugs).toEqual(['agent-aaa1', 'agent-bbb1', 'agent-ccc1']);
    });

    it('损坏 AGENT.md warn 跳过不抛错', async () => {
      // 先创建一个合法 agent
      await storage.saveAgent({
        name: 'Good Agent',
        description: 'desc',
        userId: TEST_USER_ID,
        type: 'default',
        slug: 'agent-good1',
        createdAt: 0,
        updatedAt: 0,
        personality: 'good',
      });
      // 再创建一个损坏的 AGENT.md（手工写无效内容）
      const corruptDir = join(
        tmpDataDir,
        'users',
        TEST_USER_ID,
        'agents',
        'agent-bad1',
      );
      mkdirSync(corruptDir, { recursive: true });
      writeFileSync(
        join(corruptDir, 'AGENT.md'),
        'this is not valid frontmatter',
        'utf-8',
      );

      const list = await storage.listAgents(TEST_USER_ID);
      // 应该只返回合法的 agent，跳过损坏的
      expect(list).toHaveLength(1);
      expect(list[0].slug).toBe('agent-good1');
    });

    it('不返回其他用户的 agent（用户隔离）', async () => {
      await storage.saveAgent({
        name: 'User A Agent',
        description: 'desc',
        userId: TEST_USER_ID,
        type: 'default',
        slug: 'agent-usr1a',
        createdAt: 0,
        updatedAt: 0,
        personality: 'A',
      });
      await storage.saveAgent({
        name: 'User B Agent',
        description: 'desc',
        userId: OTHER_USER_ID,
        type: 'default',
        slug: 'agent-usr2b',
        createdAt: 0,
        updatedAt: 0,
        personality: 'B',
      });
      const listA = await storage.listAgents(TEST_USER_ID);
      const listB = await storage.listAgents(OTHER_USER_ID);
      expect(listA).toHaveLength(1);
      expect(listA[0].slug).toBe('agent-usr1a');
      expect(listB).toHaveLength(1);
      expect(listB[0].slug).toBe('agent-usr2b');
    });

    it('非法 userId 抛错', async () => {
      await expect(storage.listAgents('../etc')).rejects.toThrow(/userId/);
    });
  });

  describe('deleteAgent', () => {
    it('删除已存在的 agent 后目录不存在', async () => {
      await storage.saveAgent({
        name: 'ToDelete',
        description: 'desc',
        userId: TEST_USER_ID,
        type: 'default',
        slug: 'agent-del1',
        createdAt: 0,
        updatedAt: 0,
        personality: 'body',
      });
      const dir = storage.getAgentDir(TEST_USER_ID, 'agent-del1');
      expect(existsSync(dir)).toBe(true);
      await storage.deleteAgent(TEST_USER_ID, 'agent-del1');
      expect(existsSync(dir)).toBe(false);
    });

    it('删除不存在的 agent 幂等不抛错', async () => {
      await expect(
        storage.deleteAgent(TEST_USER_ID, 'agent-noexist'),
      ).resolves.toBeUndefined();
    });

    it('非法 slug 抛错（路径遍历防护）', async () => {
      await expect(storage.deleteAgent(TEST_USER_ID, '../etc')).rejects.toThrow(
        /slug/,
      );
    });

    it('非法 userId 抛错', async () => {
      await expect(
        storage.deleteAgent('../etc', 'agent-a1b2c3'),
      ).rejects.toThrow(/userId/);
    });
  });

  describe('exists', () => {
    it('存在的 agent 返回 true', async () => {
      await storage.saveAgent({
        name: 'Exists',
        description: 'desc',
        userId: TEST_USER_ID,
        type: 'default',
        slug: 'agent-ex1',
        createdAt: 0,
        updatedAt: 0,
        personality: 'body',
      });
      expect(await storage.exists(TEST_USER_ID, 'agent-ex1')).toBe(true);
    });

    it('不存在的 agent 返回 false', async () => {
      expect(await storage.exists(TEST_USER_ID, 'agent-noexist')).toBe(false);
    });

    it('非法 slug 抛错', async () => {
      await expect(storage.exists(TEST_USER_ID, '../etc')).rejects.toThrow(
        /slug/,
      );
    });
  });

  describe('countAgents', () => {
    it('用户无 agent 返回 0', async () => {
      expect(await storage.countAgents(TEST_USER_ID)).toBe(0);
    });

    it('统计用户 agent 数量', async () => {
      for (let i = 0; i < 5; i++) {
        await storage.saveAgent({
          name: `Agent ${i}`,
          description: 'desc',
          userId: TEST_USER_ID,
          type: 'default',
          slug: `agent-cnt${i}`,
          createdAt: 0,
          updatedAt: 0,
          personality: `body${i}`,
        });
      }
      expect(await storage.countAgents(TEST_USER_ID)).toBe(5);
    });

    it('不统计其他用户的 agent', async () => {
      await storage.saveAgent({
        name: 'A',
        description: 'desc',
        userId: TEST_USER_ID,
        type: 'default',
        slug: 'agent-cnt1a',
        createdAt: 0,
        updatedAt: 0,
        personality: 'A',
      });
      await storage.saveAgent({
        name: 'B',
        description: 'desc',
        userId: OTHER_USER_ID,
        type: 'default',
        slug: 'agent-cnt2b',
        createdAt: 0,
        updatedAt: 0,
        personality: 'B',
      });
      expect(await storage.countAgents(TEST_USER_ID)).toBe(1);
      expect(await storage.countAgents(OTHER_USER_ID)).toBe(1);
    });

    it('非法 userId 抛错', async () => {
      await expect(storage.countAgents('../etc')).rejects.toThrow(/userId/);
    });
  });

  describe('并发写入同一 agent 串行化', () => {
    it('并发 saveAgent 不产生错乱（最终内容为某次写入）', async () => {
      const personalities = ['p1', 'p2', 'p3', 'p4', 'p5'];
      const profile: AgentProfile = {
        name: 'Concurrent Agent',
        description: 'desc',
        userId: TEST_USER_ID,
        type: 'default',
        slug: 'agent-con1',
        createdAt: 0,
        updatedAt: 0,
        personality: 'initial',
      };

      // 同时发起 5 次 save，每次只改 personality
      await Promise.all(
        personalities.map(async (p) => {
          await storage.saveAgent({ ...profile, personality: p });
        }),
      );

      const read = await storage.getAgent(TEST_USER_ID, 'agent-con1');
      expect(read).not.toBeNull();
      expect(personalities).toContain(read!.personality);
    });

    it('10 次并发写入后 AGENT.md 文件内容完整可解析', async () => {
      const profile: AgentProfile = {
        name: 'Concurrent 2',
        description: 'desc',
        userId: TEST_USER_ID,
        type: 'default',
        slug: 'agent-con2',
        createdAt: 0,
        updatedAt: 0,
        personality: 'initial',
      };

      // 10 次并发写入
      await Promise.all(
        Array.from({ length: 10 }, (_, i) =>
          storage.saveAgent({ ...profile, personality: `body-${i}` }),
        ),
      );

      // 文件应该能成功解析（无错乱）
      const read = await storage.getAgent(TEST_USER_ID, 'agent-con2');
      expect(read).not.toBeNull();
      expect(read!.name).toBe('Concurrent 2');
      // personality 应为某次写入的值
      expect(read!.personality).toMatch(/^body-\d+$/);
    });
  });

  describe('并发 save + delete 同一 agent', () => {
    it('并发 save + delete 不抛 ENOENT，无残留 tmp，最终状态一致', async () => {
      const slug = 'agent-sd1';
      const baseProfile: AgentProfile = {
        name: 'SaveDelete',
        description: 'desc',
        userId: TEST_USER_ID,
        type: 'default',
        slug,
        createdAt: 0,
        updatedAt: 0,
        personality: 'initial',
      };

      // 初始创建 agent，确保后续 delete 有目标
      await storage.saveAgent(baseProfile);

      // 并发：10 次 save + 10 次 delete 交替发起
      // 无锁时会出现 saveAgent 的 renameSync(tmpPath, mdPath) 抛 ENOENT：
      //   - Thread A (save): writeFileSync(tmpPath) → 锁外被 Thread B 删目录
      //   - Thread B (delete): rmSync(agentDir, recursive) 删掉 tmpPath
      //   - Thread A (save): renameSync(tmpPath, mdPath) → ENOENT
      // 加锁后 save 和 delete 串行化，此竞态不可能发生。
      const ops: Promise<unknown>[] = [];
      for (let i = 0; i < 10; i++) {
        ops.push(
          storage.saveAgent({ ...baseProfile, personality: `save-${i}` }),
        );
        ops.push(storage.deleteAgent(TEST_USER_ID, slug));
      }

      // 不应抛 ENOENT 或任何错误
      await expect(Promise.all(ops)).resolves.toBeDefined();

      const mdPath = join(
        tmpDataDir,
        'users',
        TEST_USER_ID,
        'agents',
        slug,
        'AGENT.md',
      );
      // 无残留 tmp 文件（saveAgent 完整完成的标志）
      expect(existsSync(`${mdPath}.tmp`)).toBe(false);

      // 最终状态一致：若 AGENT.md 仍存在，必须可正常解析（无半写损坏）
      if (existsSync(mdPath)) {
        const read = await storage.getAgent(TEST_USER_ID, slug);
        expect(read).not.toBeNull();
        expect(read!.name).toBe('SaveDelete');
        expect(read!.slug).toBe(slug);
        // personality 应为某次 save 写入的完整值（非半写）
        expect(read!.personality).toMatch(/^save-\d+$/);
      }
      // 若目录已被最后一个 delete 删除，也是合法终态（save 在 delete 之前完成）
    });

    it('多轮 save+delete 循环后状态自洽（回归测试）', async () => {
      const slug = 'agent-sd2';
      const profile: AgentProfile = {
        name: 'SaveDelete2',
        description: 'desc',
        userId: TEST_USER_ID,
        type: 'default',
        slug,
        createdAt: 0,
        updatedAt: 0,
        personality: 'body',
      };

      // 5 轮：每轮先 save 再 delete，但全部并发发起（不 await）
      const ops: Promise<unknown>[] = [];
      for (let round = 0; round < 5; round++) {
        ops.push(
          storage.saveAgent({ ...profile, personality: `round-${round}` }),
        );
        ops.push(storage.deleteAgent(TEST_USER_ID, slug));
      }

      await expect(Promise.all(ops)).resolves.toBeDefined();

      // 最终再 save 一次，验证 storage 仍可用（锁未死、目录可重建）
      await storage.saveAgent(profile);
      const read = await storage.getAgent(TEST_USER_ID, slug);
      expect(read).not.toBeNull();
      expect(read!.personality).toBe('body');
    });
  });

  describe('getAgent 损坏文件抛错', () => {
    it('损坏的 AGENT.md 抛错（不返回 null）', async () => {
      const corruptDir = join(
        tmpDataDir,
        'users',
        TEST_USER_ID,
        'agents',
        'agent-corrupt1',
      );
      mkdirSync(corruptDir, { recursive: true });
      writeFileSync(
        join(corruptDir, 'AGENT.md'),
        'this is not valid frontmatter',
        'utf-8',
      );

      await expect(
        storage.getAgent(TEST_USER_ID, 'agent-corrupt1'),
      ).rejects.toThrow();
    });

    it('frontmatter 缺字段抛错', async () => {
      const corruptDir = join(
        tmpDataDir,
        'users',
        TEST_USER_ID,
        'agents',
        'agent-corrupt2',
      );
      mkdirSync(corruptDir, { recursive: true });
      // 仅 frontmatter 缺 name 字段
      writeFileSync(
        join(corruptDir, 'AGENT.md'),
        `---
description: only desc
type: default
slug: agent-corrupt2
---

body`,
        'utf-8',
      );

      await expect(
        storage.getAgent(TEST_USER_ID, 'agent-corrupt2'),
      ).rejects.toThrow();
    });
  });
});
