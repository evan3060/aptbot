import type { Command } from './registry.js';

/**
 * Task 12: /skill CLI 命令
 *
 * 用法：
 *   /skill                  — 列出所有已加载 skill（name + description + template preview）
 *   /skill use <name>       — 激活 skill：返回 fillInput 供调用方填入下次输入（一次性）
 *
 * 项目记忆：skill 选择状态不持久化，通用 agent 的 skill 使用是一次性的。
 * 因此 /skill use 返回 fillInput 后由 CLI 调用方决定是否预填输入框（MVP 仅展示模板）。
 *
 * 输出无 emoji，与 /agent /feedback 等命令风格一致（纯文本多行）。
 */

const DESC_PREVIEW_LEN = 80;
const TEMPLATE_PREVIEW_LEN = 200;

/**
 * 截取预览，超过 maxLen 字符则截断 + "..."。
 */
function preview(text: string, maxLen: number): string {
  return text.length > maxLen ? text.slice(0, maxLen) + '...' : text;
}

export const skillCommand: Command = {
  name: 'skill',
  description: 'List loaded skills and activate one for the current session',
  async execute(args, ctx) {
    if (!ctx.skillState) {
      return { output: 'skills 未加载' };
    }
    const skills = [...ctx.skillState.skills];

    // /skill (no args) — 列出所有已加载 skill
    if (args.length === 0) {
      if (skills.length === 0) {
        return { output: 'No skills loaded.' };
      }
      const lines: string[] = [`Skills (${skills.length}):`];
      for (const s of skills) {
        let line = `  ${s.name}  ${preview(s.description, DESC_PREVIEW_LEN)}`;
        if (s.template) {
          line += `  [template: ${preview(s.template, TEMPLATE_PREVIEW_LEN)}]`;
        }
        lines.push(line);
      }
      lines.push('', 'Use /skill use <name> to activate a skill.');
      return { output: lines.join('\n') };
    }

    const sub = args[0];

    // /skill use <name> — 激活 skill（一次性，返回 fillInput）
    if (sub === 'use') {
      if (args.length < 2) {
        return { output: 'Usage: /skill use <name>' };
      }
      const name = args[1];
      const skill = skills.find((s) => s.name === name);
      if (!skill) {
        const lines: string[] = [`Skill not found: ${name}`];
        if (skills.length > 0) {
          lines.push('Available skills:');
          for (const s of skills) {
            lines.push(`  ${s.name}`);
          }
        }
        return { output: lines.join('\n') };
      }
      // 一次性激活：优先使用 template，无 template 则回退到 content body
      const fillInput = skill.template ?? skill.content;
      const header = skill.template
        ? `Skill activated: ${skill.name}\nTemplate (copy/adapt and submit):`
        : `Skill activated: ${skill.name}\nNo template declared; showing content body for one-time use:`;
      return {
        output: `${header}\n${fillInput}`,
        fillInput,
      };
    }

    // 未知子命令
    return {
      output: `Unknown subcommand: ${sub}\nValid subcommands: use`,
    };
  },
};
