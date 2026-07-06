import type { Command } from './registry.js';
import type { AgentStorage } from '../../core/agent/agent-storage.js';
import type { MemoryAuditLog } from '../../core/agent/memory-audit-log.js';

/**
 * Task 12: /agent CLI 命令
 *
 * 用法：
 *   /agent                       — 列出当前用户所有 agents，标记当前 agent
 *   /agent <slug>                — 切换到指定 agent（action=switch_agent）
 *   /agent info                  — 显示当前 agent 的 AGENT.md personality body
 *   /agent memory-log [limit]    — 列出最近 N 条记忆写入审计日志（默认 20）
 *
 * 不实现创建 / 编辑 / 删除（WebUI 负责）。
 * 输出无 emoji，与 /sessions /label /feedback 等命令风格一致（纯文本多行）。
 *
 * 行为契约：
 * - 无 agentStorage → 提示 "agent storage 未启用"
 * - 无 userId → 提示 "未设置 userId"
 * - 切换不存在的 slug → 错误信息 + 列出可用 agents
 * - /agent info 默认 agent → 显示 default agent 的 personality body（与其他 agent 一致）
 * - /agent memory-log 无 memoryAuditLogFactory → 提示 "memory audit log 未启用"
 */

const DEFAULT_MEMORY_LOG_LIMIT = 20;
const CONTENT_PREVIEW_LEN = 60;

/**
 * 渲染 agent 列表行：name / slug / type，current 加前缀。
 */
function formatAgentLine(
  name: string,
  slug: string,
  type: string,
  isCurrent: boolean,
): string {
  const prefix = isCurrent ? '(current) ' : '';
  return `  ${prefix}${name} (${slug}) [${type}]`;
}

/**
 * 渲染单条 audit 记录：timestamp / section / mode / contentPreview / contentLength。
 */
function formatAuditLine(record: {
  timestamp: string;
  section: string;
  mode: string;
  contentPreview: string;
  contentLength: number;
}): string {
  const preview =
    record.contentPreview.length > CONTENT_PREVIEW_LEN
      ? record.contentPreview.slice(0, CONTENT_PREVIEW_LEN) + '...'
      : record.contentPreview;
  return `  ${record.timestamp}  [${record.section}]  ${record.mode}  (${record.contentLength}B)  "${preview}"`;
}

export const agentCommand: Command = {
  name: 'agent',
  description: 'List, switch, and inspect agents',
  async execute(args, ctx) {
    if (!ctx.agentStorage) {
      return { output: 'agent storage 未启用' };
    }
    if (!ctx.userId) {
      return { output: '未设置 userId，无法列出 agents' };
    }
    const storage: AgentStorage = ctx.agentStorage;
    const userId = ctx.userId;

    // /agent (no args) — 列出所有 agents
    if (args.length === 0) {
      const agents = await storage.listAgents(userId);
      if (agents.length === 0) {
        return { output: 'No agents found.' };
      }
      const currentSlug = ctx.currentAgentSlug;
      const lines: string[] = ['Agents:'];
      for (const a of agents) {
        lines.push(
          formatAgentLine(a.name, a.slug, a.type, a.slug === currentSlug),
        );
      }
      lines.push('', 'Use /agent <slug> to switch agent.');
      return { output: lines.join('\n') };
    }

    const sub = args[0];

    // /agent info — 显示当前 agent 的 personality body
    if (sub === 'info') {
      const currentSlug = ctx.currentAgentSlug;
      if (!currentSlug) {
        return { output: 'No current agent set.' };
      }
      const agent = await storage.getAgent(userId, currentSlug);
      if (!agent) {
        return { output: `Agent not found: ${currentSlug}` };
      }
      const lines: string[] = [
        `Agent: ${agent.name} (${agent.slug})`,
        `description: ${agent.description}`,
        `type: ${agent.type}`,
        '',
        'personality:',
        agent.personality || '(empty)',
      ];
      return { output: lines.join('\n') };
    }

    // /agent memory-log [limit] — 列出最近 N 条审计日志
    if (sub === 'memory-log') {
      const currentSlug = ctx.currentAgentSlug;
      if (!currentSlug) {
        return { output: 'No current agent set.' };
      }
      if (!ctx.memoryAuditLogFactory) {
        return { output: 'memory audit log 未启用' };
      }
      let limit = DEFAULT_MEMORY_LOG_LIMIT;
      if (args.length >= 2) {
        const parsed = parseInt(args[1], 10);
        if (Number.isNaN(parsed) || parsed < 0) {
          return { output: `Invalid limit: ${args[1]}` };
        }
        limit = parsed;
      }
      const auditLog: MemoryAuditLog = ctx.memoryAuditLogFactory(userId, currentSlug);
      const records = await auditLog.list(limit);
      if (records.length === 0) {
        return { output: 'No memory audit logs.' };
      }
      const lines: string[] = [
        `Memory audit log (showing ${records.length}, slug=${currentSlug}):`,
      ];
      for (const r of records) {
        lines.push(formatAuditLine(r));
      }
      return { output: lines.join('\n') };
    }

    // /agent <slug> — 切换 agent
    const slug = sub;
    const agent = await storage.getAgent(userId, slug);
    if (!agent) {
      const agents = await storage.listAgents(userId);
      const lines: string[] = [`Agent not found: ${slug}`];
      if (agents.length > 0) {
        lines.push('Available agents:');
        for (const a of agents) {
          lines.push(formatAgentLine(a.name, a.slug, a.type, false));
        }
      }
      return { output: lines.join('\n') };
    }
    return {
      output: `Switched to agent: ${agent.name} (${agent.slug})`,
      action: 'switch_agent',
      agentSlug: slug,
    };
  },
};
