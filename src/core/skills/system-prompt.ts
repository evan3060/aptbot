import type { Skill } from './types.js';

/**
 * §8.5 / §8.6 formatSkillsForSystemPrompt：将 skill name + description 注入系统提示。
 *
 * 设计要点：
 * - MVP 全量注入（不做 token 预算截断，待 Task 9 L1 索引实现）
 * - disableModelInvocation=true 的 skill 不注入（模型不可见，仅显式调用）
 * - 0 个 skill 返回空字符串（调用方按需拼接）
 * - 格式遵循 §8.6 示例：`## Skills\n\n说明\n\n- **name** — desc  \`path\``
 */
export function formatSkillsForSystemPrompt(skills: Skill[]): string {
  const visible = skills.filter((s) => !s.disableModelInvocation);
  if (visible.length === 0) return '';
  const lines = visible.map(
    (s) => `- **${s.name}** — ${s.description}  \`${s.filePath}\``,
  );
  return (
    '## Skills\n\n' +
    'The following skills extend your capabilities. To use a skill, read its SKILL.md file using the read_file tool.\n\n' +
    lines.join('\n') +
    '\n'
  );
}
