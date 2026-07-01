import type { Skill } from './types.js';

/**
 * §8.1 / §8.6 formatSkillInvocation：将 skill content 包装为 <skill> XML 块。
 *
 * 用于显式调用 skill：模型或上层应用按 name 查找 skill 后，将完整 content 注入对话。
 * additionalInstructions 可附加额外上下文（如本次调用的特定参数）。
 */
export function formatSkillInvocation(
  skill: Skill,
  additionalInstructions?: string,
): string {
  const parts: string[] = [
    `<skill name="${skill.name}" location="${skill.filePath}">`,
    skill.content,
  ];
  if (additionalInstructions && additionalInstructions.length > 0) {
    parts.push(additionalInstructions);
  }
  parts.push('</skill>');
  return parts.join('\n');
}
