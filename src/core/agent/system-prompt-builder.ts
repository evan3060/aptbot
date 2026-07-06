import { createHash } from 'node:crypto';
import type { AgentProfile } from './agent-profile.js';

/**
 * §0.3.0 Task 8: systemPrompt 稳定前部（通用约束 + 安全约束）。
 *
 * KV 缓存设计：
 * - 此文本在 turn 之间字节级稳定，前部命中 KV 缓存不重复计费
 * - MEMORY.md 内容追加在末尾（History section）不破坏前部缓存
 * - 仅当 MEMORY.md 前部 section 变化或固定前部变化时缓存失效
 *
 * 内容来源：原 server.ts 内联的 systemPrompt base 字符串，Task 8 抽取为模块级常量。
 */
const STABLE_PREFIX = `You are aptbot, a personal learning and work assistant.

Important constraints:
- You are running inside a server process. NEVER execute commands that would kill, stop, or restart the server process (e.g., kill, pkill, killall, pnpm kill, shutdown, reboot). If asked to restart/stop the server, explain that you cannot do this and the user should do it manually.
- NEVER modify the server's own source code or configuration files (under /Users/evan/projects/aptbot/src/, config/, package.json) while the server is running.
- NEVER read or access files under the data/sessions/ directory. These are internal session storage files. Session history is managed automatically by the system (via /resume, /continue commands). Do not attempt to read, cat, or parse them.
- When bash command output is long, summarize the key information instead of pasting everything.`;

/**
 * §0.3.0 Task 8: buildSystemPrompt 构造 LLM systemPrompt。
 *
 * 结构（前部稳定 + 后部追加，为 KV 缓存优化）：
 *   1. 固定前部（稳定区）：STABLE_PREFIX（通用约束 + 安全约束）
 *   2. 半稳定区：
 *      - ## Agent Memory section（仅 professional agent + memoryContent !== null 注入）
 *      - ## Personality section（agent.personality 非空时注入）
 *
 * KV 缓存设计：
 * - 固定前部 turn 间字节级稳定 → KV 缓存命中
 * - MEMORY.md 末尾追加（History section）不破坏前部缓存
 * - 仅当 MEMORY.md 前部 section 变化时缓存失效
 *
 * 注入规则（按优先级）：
 * - agent.type === 'default' → 不注入 ## Agent Memory（即使 memoryContent 非 null 也忽略）
 * - memoryContent === null → 不注入 ## Agent Memory
 * - memoryContent === '' → 注入空 body 的 ## Agent Memory section
 * - memoryContent 非空字符串 → 注入含该内容的 ## Agent Memory section
 * - agent.personality 非空 → 注入 ## Personality section；为空则跳过
 *
 * @param agent AgentProfile 实例
 * @param memoryContent MEMORY.md 内容；
 *   - null 表示不注入（default agent 或专业 agent 未启用记忆）
 *   - '' 表示 MEMORY.md 文件不存在（注入空 section 占位）
 *   - 非空字符串为 MEMORY.md 文件内容
 * @returns 完整 systemPrompt 字符串
 */
export function buildSystemPrompt(
  agent: AgentProfile,
  memoryContent: string | null,
): string {
  const sections: string[] = [STABLE_PREFIX];

  // 注入规则：仅 professional + memoryContent !== null
  if (agent.type === 'professional' && memoryContent !== null) {
    sections.push(`## Agent Memory\n\n${memoryContent}`);
  }

  // personality 始终注入（professional 含个性配置；default 为空时跳过保持向后兼容）
  if (agent.personality) {
    sections.push(`## Personality\n\n${agent.personality}`);
  }

  return sections.join('\n\n');
}

/**
 * §0.3.0 Task 8: computeSystemPromptCacheKey 计算 systemPrompt 缓存 key。
 *
 * 算法：`sha256(stablePrefix + (memoryContent ?? '') + personality)` → hex
 *
 * 调用方（server.ts）turn 间比较此 key：
 * - 相同 key → 前部稳定区命中 KV 缓存，不重复计费
 * - 不同 key → 缓存失效，重新计费
 *
 * 注意：固定前部参与 hash 以保证 aptbot 版本升级（前部约束变化）不会错误命中旧缓存。
 *
 * @param agent AgentProfile 实例
 * @param memoryContent MEMORY.md 内容（null 视为空字符串参与 hash）
 * @returns sha256 hex 字符串（64 字符）
 */
export function computeSystemPromptCacheKey(
  agent: AgentProfile,
  memoryContent: string | null,
): string {
  const hash = createHash('sha256');
  hash.update(STABLE_PREFIX);
  hash.update(memoryContent ?? '');
  hash.update(agent.personality);
  return hash.digest('hex');
}
