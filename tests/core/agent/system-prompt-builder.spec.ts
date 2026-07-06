import { describe, it, expect } from 'vitest';
import {
  buildSystemPrompt,
  computeSystemPromptCacheKey,
} from '../../../src/core/agent/system-prompt-builder.js';
import type { AgentProfile } from '../../../src/core/agent/agent-profile.js';

/**
 * §0.3.0 Task 8: systemPrompt builder — AGENT.md 注入 + KV 缓存
 *
 * 测试 buildSystemPrompt 行为契约：
 * - default agent 不注入 ## Agent Memory section
 * - professional agent + memoryContent 注入 ## Agent Memory section
 * - professional agent + memoryContent=null 不注入
 * - professional agent + memoryContent='' 注入空 body
 * - KV 缓存 key 稳定性 + 内容变化失效
 * - 稳定前部位于 MEMORY.md 内容之前
 */
describe('system-prompt-builder', () => {
  const baseDefaultAgent: AgentProfile = {
    name: '通用助手',
    description: 'aptbot 通用助手',
    userId: '00000000-0000-0000-0000-000000000000',
    type: 'default',
    slug: 'default',
    createdAt: 0,
    updatedAt: 0,
    personality: '',
  };

  const baseProfessionalAgent: AgentProfile = {
    name: 'Travel Planner',
    description: '专业旅行规划助手',
    userId: 'a1b2c3d4-e5f6-7890-1234-567890abcdef',
    type: 'professional',
    slug: 'agent-travel01',
    createdAt: 1700000000000,
    updatedAt: 1700000000000,
    personality: '你是一位资深旅行规划师，擅长定制行程。',
  };

  describe('buildSystemPrompt - Agent Memory 注入规则', () => {
    it('default agent 不注入 ## Agent Memory section（即使 memoryContent 非 null 也忽略）', () => {
      const prompt = buildSystemPrompt(baseDefaultAgent, '一些记忆内容');
      expect(prompt).not.toContain('## Agent Memory');
    });

    it('default agent memoryContent=null 也不注入', () => {
      const prompt = buildSystemPrompt(baseDefaultAgent, null);
      expect(prompt).not.toContain('## Agent Memory');
    });

    it('professional agent + memoryContent 非空 → 注入 ## Agent Memory section 含内容', () => {
      const memory = '## User Profile\n\n喜欢徒步旅行\n\n## Facts\n\n懂日语';
      const prompt = buildSystemPrompt(baseProfessionalAgent, memory);
      expect(prompt).toContain('## Agent Memory');
      expect(prompt).toContain(memory);
    });

    it('professional agent + memoryContent=null → 不注入 ## Agent Memory section', () => {
      const prompt = buildSystemPrompt(baseProfessionalAgent, null);
      expect(prompt).not.toContain('## Agent Memory');
    });

    it('professional agent + memoryContent="" → 注入空 body 的 ## Agent Memory section', () => {
      const prompt = buildSystemPrompt(baseProfessionalAgent, '');
      // section header 存在
      expect(prompt).toContain('## Agent Memory');
      // 提取 ## Agent Memory 之后到下一个 ## header 之间的 body
      const afterMemory = prompt.split('## Agent Memory')[1] ?? '';
      const nextHeaderIdx = afterMemory.search(/\n## /);
      const body = nextHeaderIdx >= 0 ? afterMemory.slice(0, nextHeaderIdx) : afterMemory;
      // body 应为空或仅含换行/空格（注入了空 section 占位）
      expect(body.trim()).toBe('');
    });

    it('personality 始终注入（professional agent 非空 personality）', () => {
      const prompt = buildSystemPrompt(baseProfessionalAgent, null);
      expect(prompt).toContain(baseProfessionalAgent.personality);
    });

    it('personality 为空时不注入 ## Personality section', () => {
      const prompt = buildSystemPrompt(baseDefaultAgent, null);
      expect(prompt).not.toContain('## Personality');
    });
  });

  describe('buildSystemPrompt - 稳定前部位于 MEMORY.md 内容之前', () => {
    it('固定约束文本出现在 ## Agent Memory 之前', () => {
      const memory = '## User Profile\n\n喜欢咖啡';
      const prompt = buildSystemPrompt(baseProfessionalAgent, memory);
      const stableMarkerIdx = prompt.indexOf('You are aptbot');
      const memoryMarkerIdx = prompt.indexOf('## Agent Memory');
      expect(stableMarkerIdx).toBeGreaterThanOrEqual(0);
      expect(memoryMarkerIdx).toBeGreaterThan(stableMarkerIdx);
    });

    it('固定约束文本出现在 personality 之前', () => {
      const prompt = buildSystemPrompt(baseProfessionalAgent, null);
      const stableMarkerIdx = prompt.indexOf('You are aptbot');
      const personalityMarkerIdx = prompt.indexOf(baseProfessionalAgent.personality);
      expect(stableMarkerIdx).toBeGreaterThanOrEqual(0);
      expect(personalityMarkerIdx).toBeGreaterThan(stableMarkerIdx);
    });

    it('## Agent Memory 出现在 personality 之前', () => {
      const prompt = buildSystemPrompt(baseProfessionalAgent, '一些记忆');
      const memoryIdx = prompt.indexOf('## Agent Memory');
      const personalityIdx = prompt.indexOf(baseProfessionalAgent.personality);
      expect(memoryIdx).toBeGreaterThanOrEqual(0);
      expect(personalityIdx).toBeGreaterThan(memoryIdx);
    });

    it('稳定前部跨多次调用字节级稳定（不同 memoryContent 时前部相同）', () => {
      const prompt1 = buildSystemPrompt(baseProfessionalAgent, 'memory v1');
      const prompt2 = buildSystemPrompt(baseProfessionalAgent, 'memory v2');
      // 截取 ## Agent Memory 之前的部分（即稳定前部）
      const stablePrefix1 = prompt1.slice(0, prompt1.indexOf('## Agent Memory'));
      const stablePrefix2 = prompt2.slice(0, prompt2.indexOf('## Agent Memory'));
      expect(stablePrefix1).toBe(stablePrefix2);
    });
  });

  describe('computeSystemPromptCacheKey - KV 缓存 key 稳定性', () => {
    it('相同 (agent, memoryContent) → 相同 key', () => {
      const k1 = computeSystemPromptCacheKey(baseProfessionalAgent, 'memory v1');
      const k2 = computeSystemPromptCacheKey(baseProfessionalAgent, 'memory v1');
      expect(k1).toBe(k2);
    });

    it('不同 memoryContent → 不同 key', () => {
      const k1 = computeSystemPromptCacheKey(baseProfessionalAgent, 'memory v1');
      const k2 = computeSystemPromptCacheKey(baseProfessionalAgent, 'memory v2');
      expect(k1).not.toBe(k2);
    });

    it('不同 personality → 不同 key', () => {
      const otherAgent: AgentProfile = {
        ...baseProfessionalAgent,
        personality: '完全不同的个性配置',
      };
      const k1 = computeSystemPromptCacheKey(baseProfessionalAgent, null);
      const k2 = computeSystemPromptCacheKey(otherAgent, null);
      expect(k1).not.toBe(k2);
    });

    it('memoryContent=null 与 memoryContent="" 产生相同 key（遵循 brief 算法 `?? ""`）', () => {
      // brief 指定算法：sha256(stablePrefix + (memoryContent ?? '') + personality)
      // null 与 '' 在 hash 时均视为空字符串，产生相同 key。
      // 这是设计选择：cache key 反映内容稳定性，注入与否由 agent.type + memoryEnabled 决定。
      const k1 = computeSystemPromptCacheKey(baseProfessionalAgent, null);
      const k2 = computeSystemPromptCacheKey(baseProfessionalAgent, '');
      expect(k1).toBe(k2);
    });

    it('返回 sha256 hex 字符串（64 字符）', () => {
      const key = computeSystemPromptCacheKey(baseProfessionalAgent, 'memory');
      // sha256 hex = 64 字符，仅含 0-9a-f
      expect(key).toMatch(/^[0-9a-f]{64}$/);
    });

    it('追加记忆到末尾（History section）→ key 变化（缓存失效）', () => {
      // 模拟 MEMORY.md 末尾追加 History 记录的场景
      const beforeMemory = `## User Profile

喜欢徒步

## Facts

懂日语

## History

[2026-07-01] 用户询问了京都行程`;

      const afterMemory = `## User Profile

喜欢徒步

## Facts

懂日语

## History

[2026-07-01] 用户询问了京都行程
[2026-07-06] 用户预订了 8 月机票`;

      const k1 = computeSystemPromptCacheKey(baseProfessionalAgent, beforeMemory);
      const k2 = computeSystemPromptCacheKey(baseProfessionalAgent, afterMemory);
      expect(k1).not.toBe(k2);
    });
  });

  describe('buildSystemPrompt - 整体结构', () => {
    it('完整 prompt 结构：稳定前部 + ## Agent Memory + ## Personality', () => {
      const memory = '## User Profile\n\n喜欢咖啡';
      const prompt = buildSystemPrompt(baseProfessionalAgent, memory);

      // 顺序校验：stable prefix → ## Agent Memory → ## Personality
      const stableIdx = prompt.indexOf('You are aptbot');
      const memoryIdx = prompt.indexOf('## Agent Memory');
      const personalityIdx = prompt.indexOf('## Personality');

      expect(stableIdx).toBeGreaterThanOrEqual(0);
      expect(memoryIdx).toBeGreaterThan(stableIdx);
      expect(personalityIdx).toBeGreaterThan(memoryIdx);
    });

    it('default agent 完整 prompt 仅含稳定前部（personality 为空时）', () => {
      const prompt = buildSystemPrompt(baseDefaultAgent, null);
      // 不应包含任何半稳定区 section
      expect(prompt).not.toContain('## Agent Memory');
      expect(prompt).not.toContain('## Personality');
      // 应包含稳定前部
      expect(prompt).toContain('You are aptbot');
      expect(prompt).toContain('Important constraints');
    });
  });

  /**
   * §0.3.0 Task 17: STABLE_PREFIX 约束文本更新
   *
   * 新增/替换的约束：
   * - 替换原 data/sessions/ 引用为 data/users/*\/agents/*\/sessions/
   * - 新增：禁止访问 data/users/*\/archived-agents/（Task 19 归档 agent）
   * - 新增：禁止访问 ui-config.json 文件（UI 层配置）
   * - 新增：允许通过 read_agent_memory / write_agent_memory 工具访问当前 agent 的 MEMORY.md
   * - 新增：禁止访问其他 agent 的 MEMORY.md
   * - 保留：server kill 命令、源码修改、bash 输出摘要等原约束
   */
  describe('Task 17: STABLE_PREFIX 约束文本更新', () => {
    const prompt = buildSystemPrompt(baseDefaultAgent, null);

    it('禁止访问新路径 data/users/*/agents/*/sessions/（替换原 data/sessions/）', () => {
      expect(prompt).toContain('data/users/*/agents/*/sessions/');
    });

    it('不再引用旧路径 data/sessions/（被替换为新结构）', () => {
      // 旧路径已被替换为新路径，不应再以独立禁止项形式出现
      // 通过负向断言：不应出现 "data/sessions/" 这一具体路径串
      expect(prompt).not.toContain('data/sessions/');
    });

    it('禁止访问归档目录 data/users/*/archived-agents/', () => {
      expect(prompt).toContain('data/users/*/archived-agents/');
    });

    it('禁止访问 ui-config.json 文件', () => {
      expect(prompt).toContain('ui-config.json');
    });

    it('允许通过 read_agent_memory / write_agent_memory 工具访问当前 agent 的 MEMORY.md', () => {
      // 必须显式声明 read_agent_memory + write_agent_memory 工具是访问 MEMORY.md 的唯一许可路径
      expect(prompt).toContain('read_agent_memory');
      expect(prompt).toContain('write_agent_memory');
      expect(prompt).toContain('MEMORY.md');
    });

    it('禁止访问其他 agent 的 MEMORY.md 文件', () => {
      // 应明确禁止跨 agent 访问 MEMORY.md
      // 通过查找包含 "other" 或 "其他" 关键字的 MEMORY.md 禁止项
      const hasForbiddenOtherAgentsMemory =
        /other.*MEMORY\.md|MEMORY\.md.*other|其他.*MEMORY\.md|MEMORY\.md.*其他/i.test(prompt);
      expect(hasForbiddenOtherAgentsMemory).toBe(true);
    });

    it('保留原 server kill 命令约束', () => {
      expect(prompt).toContain('kill');
      expect(prompt).toContain('pkill');
      expect(prompt).toContain('shutdown');
    });

    it('保留原源码修改禁令', () => {
      expect(prompt).toContain('source code');
    });

    it('保留原 bash 输出摘要约束', () => {
      expect(prompt).toContain('summarize');
    });
  });
});
