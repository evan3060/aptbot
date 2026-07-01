import type { Skill } from './types.js';

/**
 * §8.5 / §8.6 / §12.5 formatSkillsForSystemPrompt：L1 索引注入系统提示。
 *
 * 设计要点：
 * - 按 lastUsed 降序（最近用的在前，LLM 注意力对靠前的更敏感）
 * - 4K token 预算硬上限（chars/4 估算），超限截断为「前 N 个完整条目 + 名字列表」
 * - disableModelInvocation=true 的 skill 不注入
 * - 0 个 skill 返回空字符串
 * - 单 skill 超 4K 预算时仍注入该 skill 的完整条目（§4.9 边界条件）
 *
 * 格式参考 §12.5：
 * `- **name** — desc (N行/M字节) [tag1,tag2]  \`path\``
 */
export const MAX_INDEX_TOKENS = 4000;
const CHARS_PER_TOKEN = 4;
const SKILL_INDEX_HEADER =
  '## Skills\n\n' +
  'The following skills extend your capabilities. To use a skill, read its SKILL.md file using the read_file tool. Judge by size hint whether worth reading.\n\n';

/** chars/4 token 估算（与 §10.5 estimateTokens 一致，避免引入 tiktoken 依赖） */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

/** §12.5 formatSkillIndexLine：单条 L1 索引行 */
function formatSkillIndexLine(s: Skill): string {
  const size = `${s.contentLines}行/${s.contentBytes}字节`;
  const tags = s.tags && s.tags.length > 0 ? ` [${s.tags.join(',')}]` : '';
  return `- **${s.name}** — ${s.description} (${size})${tags}  \`${s.filePath}\``;
}

/**
 * §12.5 formatSkillsForSystemPrompt：L1 索引生成。
 *
 * 流程：
 * 1. 过滤 disableModelInvocation=true
 * 2. 按 lastUsed 降序（undefined 按 0，排最后）
 * 3. 顺序累积 token，未超 4K 预算的进 fullEntries，超限的进 nameOnly
 * 4. 单 skill 超 4K 预算的特殊处理：仍作为完整条目注入（§4.9 边界条件）
 * 5. 拼接 fullEntries + 可选的 nameOnly 名字列表
 */
export function formatSkillsForSystemPrompt(skills: Skill[]): string {
  const visible = skills.filter((s) => !s.disableModelInvocation);
  if (visible.length === 0) return '';

  // 按 lastUsed 降序（undefined 按 0，排最后）
  const sorted = [...visible].sort((a, b) => (b.lastUsed ?? 0) - (a.lastUsed ?? 0));

  let usedTokens = estimateTokens(SKILL_INDEX_HEADER);
  const fullEntries: string[] = [];
  const nameOnly: string[] = [];

  for (const s of sorted) {
    const line = formatSkillIndexLine(s);
    const lineTokens = estimateTokens(line);
    if (fullEntries.length === 0 || usedTokens + lineTokens <= MAX_INDEX_TOKENS) {
      // §4.9 边界条件：第一个 skill（lastUsed 最高）即使超预算也注入完整条目
      // 后续 skill 仅在预算内才注入完整条目，否则降级到名字列表
      fullEntries.push(line);
      usedTokens += lineTokens;
    } else {
      nameOnly.push(s.name);
    }
  }

  let output = SKILL_INDEX_HEADER + fullEntries.join('\n');
  if (nameOnly.length > 0) {
    output += `\n\nAdditional skills (read SKILL.md for details): ${nameOnly.join(', ')}`;
  }
  return output + '\n';
}
