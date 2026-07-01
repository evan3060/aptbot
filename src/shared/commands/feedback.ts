import type { Command } from './registry.js';
import type {
  FeedbackStorage,
  FeedbackEntry,
  FeedbackStatus,
} from '../../infrastructure/feedback-storage.js';

/**
 * Task 12: /feedback CLI 命令
 *
 * 用法：
 *   /feedback                    — 列出最近 10 条 open 状态反馈（默认）
 *   /feedback list               — 同上
 *   /feedback all                — 列出全部状态（含 resolved/archived）
 *   /feedback <id>               — 查看单条详情（含 note / moderatedAt）
 *   /feedback resolve <id> [note] — 标记为 resolved（追加 note）
 *   /feedback archive <id> [note] — 标记为 archived
 *   /feedback stats              — 显示按状态/分类的计数
 *
 * 无 feedbackStorage（feedbackEnabled:false）时提示"反馈功能未启用"。
 * 输出无 emoji，与 /sessions /label 等命令风格一致（纯文本多行）。
 */

const LIST_DEFAULT_LIMIT = 10;
const ALL_LIMIT = 100;
const MESSAGE_PREVIEW_LEN = 60;

const KNOWN_SUBCOMMANDS = new Set(['list', 'all', 'stats', 'resolve', 'archive']);

/**
 * 截取消息预览，超过 MESSAGE_PREVIEW_LEN 字符则截断 + "..."。
 */
function previewMessage(msg: string): string {
  return msg.length > MESSAGE_PREVIEW_LEN
    ? msg.slice(0, MESSAGE_PREVIEW_LEN) + '...'
    : msg;
}

/**
 * 渲染单条反馈的列表行：id / category / message 预览 / createdAt。
 */
function formatListLine(e: FeedbackEntry): string {
  return `  [${e.id}] ${e.category}  ${e.createdAt}  "${previewMessage(e.message)}"`;
}

/**
 * 渲染单条反馈的完整详情。
 */
function formatDetail(e: FeedbackEntry): string {
  const lines: string[] = [`Feedback ${e.id}`];
  lines.push(`  status: ${e.status}`);
  lines.push(`  category: ${e.category}`);
  lines.push(`  message: ${e.message}`);
  if (e.articleSlug !== undefined) lines.push(`  articleSlug: ${e.articleSlug}`);
  if (e.contact !== undefined) lines.push(`  contact: ${e.contact}`);
  lines.push(`  ip: ${e.ip}`);
  if (e.userAgent !== undefined) lines.push(`  userAgent: ${e.userAgent}`);
  lines.push(`  createdAt: ${e.createdAt}`);
  if (e.note !== undefined) lines.push(`  note: ${e.note}`);
  if (e.moderatedAt !== undefined) lines.push(`  moderatedAt: ${e.moderatedAt}`);
  return lines.join('\n');
}

/**
 * 列出反馈（单状态），渲染为多行文本。
 */
async function renderList(
  storage: FeedbackStorage,
  status: FeedbackStatus,
  title: string,
  limit: number,
): Promise<string> {
  const { items, total } = await storage.list({ status, limit });
  if (items.length === 0) {
    return `No ${status} feedback.`;
  }
  const lines: string[] = [`Feedback (${title}, ${total} total, showing ${items.length}):`];
  for (const e of items) {
    lines.push(formatListLine(e));
  }
  return lines.join('\n');
}

/**
 * 列出全部状态反馈。
 */
async function renderAll(storage: FeedbackStorage): Promise<string> {
  const open = await storage.list({ status: 'open', limit: ALL_LIMIT });
  const resolved = await storage.list({ status: 'resolved', limit: ALL_LIMIT });
  const archived = await storage.list({ status: 'archived', limit: ALL_LIMIT });
  const all = [...open.items, ...resolved.items, ...archived.items];
  if (all.length === 0) {
    return 'No feedback.';
  }
  const lines: string[] = [`Feedback (all, ${all.length} showing):`];
  for (const e of open.items) {
    lines.push(formatListLine(e));
  }
  for (const e of resolved.items) {
    lines.push(formatListLine(e));
  }
  for (const e of archived.items) {
    lines.push(formatListLine(e));
  }
  return lines.join('\n');
}

/**
 * 渲染统计：按状态计数 + 按分类计数。
 */
async function renderStats(storage: FeedbackStorage): Promise<string> {
  const open = await storage.list({ status: 'open', limit: ALL_LIMIT });
  const resolved = await storage.list({ status: 'resolved', limit: ALL_LIMIT });
  const archived = await storage.list({ status: 'archived', limit: ALL_LIMIT });
  const allItems = [...open.items, ...resolved.items, ...archived.items];

  const byCategory = new Map<string, number>();
  for (const e of allItems) {
    byCategory.set(e.category, (byCategory.get(e.category) ?? 0) + 1);
  }

  const lines: string[] = [
    'Feedback stats:',
    `  open: ${open.total}`,
    `  resolved: ${resolved.total}`,
    `  archived: ${archived.total}`,
    'By category:',
  ];
  for (const [cat, count] of byCategory) {
    lines.push(`  ${cat}: ${count}`);
  }
  return lines.join('\n');
}

export const feedbackCommand: Command = {
  name: 'feedback',
  description: 'List, view, and moderate feedback entries',
  async execute(args, ctx) {
    if (!ctx.feedbackStorage) {
      return { output: '反馈功能未启用' };
    }
    const storage = ctx.feedbackStorage;

    // /feedback（无参数）或 /feedback list — 列出最近 10 条 open
    if (args.length === 0 || args[0] === 'list') {
      return { output: await renderList(storage, 'open', 'open', LIST_DEFAULT_LIMIT) };
    }

    const sub = args[0];

    // /feedback all — 列出全部状态
    if (sub === 'all') {
      return { output: await renderAll(storage) };
    }

    // /feedback stats — 显示计数
    if (sub === 'stats') {
      return { output: await renderStats(storage) };
    }

    // /feedback resolve <id> [note]
    if (sub === 'resolve') {
      if (args.length < 2) {
        return { output: 'Usage: /feedback resolve <id> [note]' };
      }
      const id = args[1];
      const note = args.slice(2).join(' ');
      const update: { status: 'resolved'; note?: string } = { status: 'resolved' };
      if (note.length > 0) update.note = note;
      const updated = await storage.moderate(id, update);
      if (!updated) {
        return { output: `未找到: ${id}` };
      }
      return { output: `Feedback ${id} resolved.` };
    }

    // /feedback archive <id> [note]
    if (sub === 'archive') {
      if (args.length < 2) {
        return { output: 'Usage: /feedback archive <id> [note]' };
      }
      const id = args[1];
      const note = args.slice(2).join(' ');
      const update: { status: 'archived'; note?: string } = { status: 'archived' };
      if (note.length > 0) update.note = note;
      const updated = await storage.moderate(id, update);
      if (!updated) {
        return { output: `未找到: ${id}` };
      }
      return { output: `Feedback ${id} archived.` };
    }

    // /feedback <id> — 查看单条详情（id 以 'fb-' 前缀标识）
    if (sub.startsWith('fb-')) {
      const entry = await storage.findById(sub);
      if (!entry) {
        return { output: `未找到: ${sub}` };
      }
      return { output: formatDetail(entry) };
    }

    // 未知子命令
    return {
      output: `Unknown subcommand: ${sub}\nValid subcommands: ${Array.from(KNOWN_SUBCOMMANDS).join(', ')}, or <feedback-id>`,
    };
  },
};
