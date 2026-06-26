import type { Context, ContextMessage } from './types.js';
import type { ContentBlock } from '../memory/agent-message.js';

/**
 * §4.4 sanitizeContext: 修复 role alternation、空 content、tool 消息完整性。
 */
export function sanitizeContext(context: Context): Context {
  const messages: ContextMessage[] = [];
  for (const msg of context.messages) {
    // 过滤无 toolCallId 的 tool 消息
    if (msg.role === 'tool' && !msg.toolCallId) {
      continue;
    }
    // 修复空 content
    const fixedContent = ensureNonEmptyContent(msg.content);
    const fixed: ContextMessage = { ...msg, content: fixedContent };

    // 合并连续同 role 的 user 消息
    const prev = messages[messages.length - 1];
    if (prev && prev.role === fixed.role && fixed.role === 'user') {
      messages[messages.length - 1] = mergeUserMessages(prev, fixed);
    } else {
      messages.push(fixed);
    }
  }
  return {
    ...context,
    messages,
  };
}

function ensureNonEmptyContent(content: string | ContentBlock[]): string | ContentBlock[] {
  if (typeof content === 'string') {
    return content === '' ? ' ' : content;
  }
  if (Array.isArray(content) && content.length === 0) {
    return ' ';
  }
  return content;
}

function mergeUserMessages(a: ContextMessage, b: ContextMessage): ContextMessage {
  const aContent = typeof a.content === 'string' ? a.content : JSON.stringify(a.content);
  const bContent = typeof b.content === 'string' ? b.content : JSON.stringify(b.content);
  return {
    role: 'user',
    content: `${aContent}\n${bContent}`,
  };
}
