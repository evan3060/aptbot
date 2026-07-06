import { describe, it, expect } from 'vitest';
import {
  AgentProfileSchema,
  parseAgentMd,
  generateSlug,
  validateSlug,
  AGENT_SLUG_REGEX,
  MAX_MEMORY_SIZE,
  MAX_WRITE_CONTENT_SIZE,
  MAX_AGENTS_PER_USER,
  type AgentProfile,
  type AgentType,
  type AgentProfileFrontmatter,
} from '../../../src/core/agent/agent-profile.js';

describe('agent-profile', () => {
  describe('constants', () => {
    it('AGENT_SLUG_REGEX 匹配合法 slug', () => {
      expect(AGENT_SLUG_REGEX.test('agent-a1b2c3')).toBe(true);
      expect(AGENT_SLUG_REGEX.test('my-agent')).toBe(true);
      expect(AGENT_SLUG_REGEX.test('abc')).toBe(true);
      // 边界长度：3 与 64
      expect(AGENT_SLUG_REGEX.test('abc')).toBe(true);
      expect(AGENT_SLUG_REGEX.test('a'.repeat(64))).toBe(true);
    });

    it('AGENT_SLUG_REGEX 拒绝非法 slug', () => {
      expect(AGENT_SLUG_REGEX.test('AB')).toBe(false); // 大写 + 过短
      expect(AGENT_SLUG_REGEX.test('Agent-A1b2c3')).toBe(false); // 大写
      expect(AGENT_SLUG_REGEX.test('a/b')).toBe(false); // 斜杠
      expect(AGENT_SLUG_REGEX.test('ab')).toBe(false); // 过短（<3）
      expect(AGENT_SLUG_REGEX.test('a'.repeat(65))).toBe(false); // 过长（>64）
      expect(AGENT_SLUG_REGEX.test('')).toBe(false); // 空
      expect(AGENT_SLUG_REGEX.test('has space')).toBe(false); // 空格
      expect(AGENT_SLUG_REGEX.test('under_score')).toBe(false); // 下划线
    });

    it('MAX_MEMORY_SIZE = 8192（8KB 软上限）', () => {
      expect(MAX_MEMORY_SIZE).toBe(8192);
    });

    it('MAX_WRITE_CONTENT_SIZE = 2048（单次写入 2KB 上限）', () => {
      expect(MAX_WRITE_CONTENT_SIZE).toBe(2048);
    });

    it('MAX_AGENTS_PER_USER = 50（软上限）', () => {
      expect(MAX_AGENTS_PER_USER).toBe(50);
    });
  });

  describe('validateSlug', () => {
    it('合法 slug 返回 true', () => {
      expect(validateSlug('agent-a1b2c3')).toBe(true);
      expect(validateSlug('my-agent')).toBe(true);
      expect(validateSlug('abc')).toBe(true);
    });

    it('非法 slug 返回 false', () => {
      expect(validateSlug('AB')).toBe(false);
      expect(validateSlug('a/b')).toBe(false);
      expect(validateSlug('')).toBe(false);
      expect(validateSlug('has space')).toBe(false);
    });
  });

  describe('generateSlug', () => {
    it('生成的 slug 匹配 AGENT_SLUG_REGEX', () => {
      const slug = generateSlug();
      expect(validateSlug(slug)).toBe(true);
    });

    it('多次调用生成不同 slug（随机后缀）', () => {
      const slug1 = generateSlug();
      const slug2 = generateSlug();
      const slug3 = generateSlug();
      expect(slug1).not.toBe(slug2);
      expect(slug2).not.toBe(slug3);
      expect(slug1).not.toBe(slug3);
    });

    it('slug 与 name 解耦：固定前缀 agent- + 6 位 hex', () => {
      // 不引入 pinyin 依赖，slug 与 name 内容无关
      const slug1 = generateSlug();
      const slug2 = generateSlug();
      expect(slug1).toMatch(/^agent-[a-f0-9]{6}$/);
      expect(slug2).toMatch(/^agent-[a-f0-9]{6}$/);
    });
  });

  describe('AgentProfileSchema', () => {
    const validFrontmatter = {
      name: 'My Agent',
      description: 'A helpful assistant',
      type: 'default' as const,
      slug: 'agent-a1b2c3',
    };

    it('接受合法 frontmatter', () => {
      const result = AgentProfileSchema.safeParse(validFrontmatter);
      expect(result.success).toBe(true);
    });

    it('接受带可选 LLM 配置的 frontmatter', () => {
      const result = AgentProfileSchema.safeParse({
        ...validFrontmatter,
        model: 'gpt-4',
        temperature: 0.7,
        maxTokens: 4096,
        reasoningEffort: 'medium',
        thinkingType: 'enabled',
        thinkingBudgetTokens: 1024,
      });
      expect(result.success).toBe(true);
    });

    it('接受 professional 类型', () => {
      const result = AgentProfileSchema.safeParse({
        ...validFrontmatter,
        type: 'professional',
      });
      expect(result.success).toBe(true);
    });

    it('拒绝缺 name', () => {
      const result = AgentProfileSchema.safeParse({
        description: 'A helpful assistant',
        type: 'default',
        slug: 'agent-a1b2c3',
      });
      expect(result.success).toBe(false);
    });

    it('拒绝缺 slug', () => {
      const result = AgentProfileSchema.safeParse({
        name: 'My Agent',
        description: 'A helpful assistant',
        type: 'default',
      });
      expect(result.success).toBe(false);
    });

    it('拒绝 name 超过 64 字符', () => {
      const result = AgentProfileSchema.safeParse({
        ...validFrontmatter,
        name: 'a'.repeat(65),
      });
      expect(result.success).toBe(false);
    });

    it('拒绝 description 超过 120 字符', () => {
      const result = AgentProfileSchema.safeParse({
        ...validFrontmatter,
        description: 'a'.repeat(121),
      });
      expect(result.success).toBe(false);
    });

    it('拒绝 slug 不匹配正则', () => {
      const result = AgentProfileSchema.safeParse({
        ...validFrontmatter,
        slug: 'Invalid Slug!',
      });
      expect(result.success).toBe(false);
    });

    it('拒绝非法 type', () => {
      const result = AgentProfileSchema.safeParse({
        ...validFrontmatter,
        type: 'invalid',
      });
      expect(result.success).toBe(false);
    });

    it('拒绝 temperature 超出 [0, 2]', () => {
      expect(
        AgentProfileSchema.safeParse({ ...validFrontmatter, temperature: 3 }).success,
      ).toBe(false);
      expect(
        AgentProfileSchema.safeParse({ ...validFrontmatter, temperature: -0.1 }).success,
      ).toBe(false);
    });

    it('拒绝 temperature 类型错误（字符串）', () => {
      const result = AgentProfileSchema.safeParse({
        ...validFrontmatter,
        temperature: 'hot',
      });
      expect(result.success).toBe(false);
    });

    it('拒绝 maxTokens 非正整数', () => {
      expect(
        AgentProfileSchema.safeParse({ ...validFrontmatter, maxTokens: 0 }).success,
      ).toBe(false);
      expect(
        AgentProfileSchema.safeParse({ ...validFrontmatter, maxTokens: -1 }).success,
      ).toBe(false);
      expect(
        AgentProfileSchema.safeParse({ ...validFrontmatter, maxTokens: 1.5 }).success,
      ).toBe(false);
    });

    it('拒绝非法 reasoningEffort', () => {
      const result = AgentProfileSchema.safeParse({
        ...validFrontmatter,
        reasoningEffort: 'invalid',
      });
      expect(result.success).toBe(false);
    });

    it('拒绝非法 thinkingType', () => {
      const result = AgentProfileSchema.safeParse({
        ...validFrontmatter,
        thinkingType: 'invalid',
      });
      expect(result.success).toBe(false);
    });

    it('拒绝 thinkingBudgetTokens 非正数', () => {
      expect(
        AgentProfileSchema.safeParse({ ...validFrontmatter, thinkingBudgetTokens: 0 }).success,
      ).toBe(false);
      expect(
        AgentProfileSchema.safeParse({ ...validFrontmatter, thinkingBudgetTokens: -1 }).success,
      ).toBe(false);
    });

    it('允许所有 LLM 字段缺省（可选）', () => {
      const result = AgentProfileSchema.safeParse(validFrontmatter);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.model).toBeUndefined();
        expect(result.data.temperature).toBeUndefined();
        expect(result.data.maxTokens).toBeUndefined();
        expect(result.data.reasoningEffort).toBeUndefined();
        expect(result.data.thinkingType).toBeUndefined();
        expect(result.data.thinkingBudgetTokens).toBeUndefined();
      }
    });
  });

  describe('parseAgentMd', () => {
    it('解析合法 AGENT.md（frontmatter + body）', () => {
      const raw = `---
name: My Agent
description: A helpful assistant
type: default
slug: agent-a1b2c3
---

You are a helpful assistant.`;
      const result = parseAgentMd(raw);
      expect(result.frontmatter.name).toBe('My Agent');
      expect(result.frontmatter.description).toBe('A helpful assistant');
      expect(result.frontmatter.type).toBe('default');
      expect(result.frontmatter.slug).toBe('agent-a1b2c3');
      expect(result.body).toContain('You are a helpful assistant.');
    });

    it('解析带可选 LLM 配置的 frontmatter', () => {
      const raw = `---
name: Pro Agent
description: A professional assistant
type: professional
slug: agent-pro123
model: gpt-4
temperature: 0.5
maxTokens: 8192
reasoningEffort: high
thinkingType: enabled
thinkingBudgetTokens: 2048
---

You are professional.`;
      const result = parseAgentMd(raw);
      expect(result.frontmatter.model).toBe('gpt-4');
      expect(result.frontmatter.temperature).toBe(0.5);
      expect(result.frontmatter.maxTokens).toBe(8192);
      expect(result.frontmatter.reasoningEffort).toBe('high');
      expect(result.frontmatter.thinkingType).toBe('enabled');
      expect(result.frontmatter.thinkingBudgetTokens).toBe(2048);
      expect(result.body).toContain('You are professional.');
    });

    it('缺字段时抛错', () => {
      const raw = `---
description: A helpful assistant
type: default
slug: agent-a1b2c3
---

body`;
      expect(() => parseAgentMd(raw)).toThrow();
    });

    it('slug 不匹配正则时抛错', () => {
      const raw = `---
name: My Agent
description: A helpful assistant
type: default
slug: Invalid Slug
---

body`;
      expect(() => parseAgentMd(raw)).toThrow();
    });

    it('类型错误时抛错', () => {
      const raw = `---
name: My Agent
description: A helpful assistant
type: invalid
slug: agent-a1b2c3
---

body`;
      expect(() => parseAgentMd(raw)).toThrow();
    });

    it('temperature 越界时抛错', () => {
      const raw = `---
name: My Agent
description: A helpful assistant
type: default
slug: agent-a1b2c3
temperature: 5
---

body`;
      expect(() => parseAgentMd(raw)).toThrow();
    });

    it('无 frontmatter 分隔符时抛错', () => {
      const raw = `Just some markdown content without frontmatter.`;
      expect(() => parseAgentMd(raw)).toThrow();
    });

    it('处理空 body（仅 frontmatter）', () => {
      const raw = `---
name: My Agent
description: A helpful assistant
type: default
slug: agent-a1b2c3
---`;
      const result = parseAgentMd(raw);
      expect(result.frontmatter.name).toBe('My Agent');
      expect(result.body).toBe('');
    });

    it('保留 body 中的多行内容', () => {
      const raw = `---
name: My Agent
description: A helpful assistant
type: default
slug: agent-a1b2c3
---

Line 1

Line 2

- Bullet 1
- Bullet 2`;
      const result = parseAgentMd(raw);
      expect(result.body).toContain('Line 1');
      expect(result.body).toContain('Line 2');
      expect(result.body).toContain('- Bullet 1');
      expect(result.body).toContain('- Bullet 2');
    });
  });

  describe('AgentProfile 接口（类型层面的契约）', () => {
    it('编译期校验：包含所有必填字段', () => {
      const profile: AgentProfile = {
        name: 'My Agent',
        description: 'desc',
        userId: 'user-1',
        type: 'default',
        slug: 'agent-a1b2c3',
        createdAt: 1000,
        updatedAt: 2000,
        personality: 'You are helpful.',
      };
      expect(profile.name).toBe('My Agent');
    });

    it('编译期校验：可选 LLM 配置字段', () => {
      const profile: AgentProfile = {
        name: 'My Agent',
        description: 'desc',
        userId: 'user-1',
        type: 'professional',
        slug: 'agent-a1b2c3',
        createdAt: 1000,
        updatedAt: 2000,
        personality: 'You are helpful.',
        model: 'gpt-4',
        temperature: 0.7,
        maxTokens: 4096,
        reasoningEffort: 'medium',
        thinkingType: 'enabled',
        thinkingBudgetTokens: 1024,
      };
      expect(profile.model).toBe('gpt-4');
    });

    it('AgentType 联合类型为 default | professional', () => {
      const t1: AgentType = 'default';
      const t2: AgentType = 'professional';
      expect([t1, t2]).toEqual(['default', 'professional']);
    });

    it('AgentProfileFrontmatter 是 Schema 推断的子集类型', () => {
      const fm: AgentProfileFrontmatter = {
        name: 'My Agent',
        description: 'desc',
        type: 'default',
        slug: 'agent-a1b2c3',
      };
      expect(fm.slug).toBe('agent-a1b2c3');
    });
  });
});
