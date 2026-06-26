import { createLogger } from '../../infrastructure/logger.js';
import type { AgentMessage } from './agent-message.js';
import type { SessionEntry } from './types.js';
import type { Provider, Model, Context } from '../provider/types.js';
import type { StorageAdapter } from '../../infrastructure/storage/file-storage.js';

const log = createLogger('compaction');

export interface CompactionSettings {
  enabled: boolean;
  reserveTokens: number;
  keepRecentTokens: number;
}

export const DEFAULT_COMPACTION_SETTINGS: CompactionSettings = {
  enabled: true,
  reserveTokens: 512,
  keepRecentTokens: 100,
};

export const COMPACTION_TRIGGER_RATIO = 0.8;
export const COMPACTION_TARGET_RATIO = 0.3;
export const COMPACTION_MAX_TOKENS = 2048;

/**
 * §10.5 estimateTokens: 三级降级 tiktoken → usage → chars/4 + warn。
 * MVP 使用 chars/4 降级路径。
 */
export function estimateTokens(messages: AgentMessage[], _model: Model): number {
  let totalChars = 0;
  for (const m of messages) {
    if (typeof m.content === 'string') {
      totalChars += m.content.length;
    } else if (Array.isArray(m.content)) {
      for (const block of m.content) {
        if (block.type === 'text') totalChars += block.text.length;
      }
    }
  }
  return Math.ceil(totalChars / 4);
}

/**
 * §6.4 shouldCompact: tokens ≥ contextWindow × 0.8 时返回 true。
 */
export function shouldCompact(
  tokens: number,
  contextWindow: number,
  settings: CompactionSettings,
): boolean {
  if (!settings.enabled) return false;
  return tokens >= contextWindow * COMPACTION_TRIGGER_RATIO;
}

function entryTokens(entry: SessionEntry): number {
  if (entry.type !== 'message') return 0;
  const content = entry.message.content;
  if (typeof content === 'string') return Math.ceil(content.length / 4);
  if (Array.isArray(content)) {
    const chars = content
      .filter((c) => c.type === 'text')
      .reduce((sum, c) => sum + (c.type === 'text' ? c.text.length : 0), 0);
    return Math.ceil(chars / 4);
  }
  return 0;
}

/**
 * §6.4 findCutPoint: 从末尾向前累积 tokens，超过 keepRecentTokens 时向前搜索下一个 user 消息边界。
 * cutPoint 之前的 entries 将被摘要，从 cutPoint 起的 entries 保留。
 */
export function findCutPoint(entries: SessionEntry[], keepRecentTokens: number): number {
  let acc = 0;
  for (let i = entries.length - 1; i >= 0; i--) {
    acc += entryTokens(entries[i]);
    if (acc > keepRecentTokens) {
      // 从 i 向前搜索下一个 user 消息作为保留块的起点
      for (let j = i; j < entries.length; j++) {
        if (entries[j].type === 'message' && entries[j].message.role === 'user') {
          return j;
        }
      }
      return 0;
    }
  }
  return 0;
}

/**
 * §6.4 / §10.1.1 compact: 找 cutPoint → 生成摘要 → append compaction entry。
 * LLM 失败时返回 { success: false, reason: 'llm_failed' }，保留旧 entries 不变。
 */
export async function compact(
  entries: SessionEntry[],
  previousSummary: string | null,
  model: Model,
  provider: Provider,
  storage: StorageAdapter,
  sessionId: string,
): Promise<{ success: boolean; reason?: string }> {
  const cutPoint = findCutPoint(entries, DEFAULT_COMPACTION_SETTINGS.keepRecentTokens);
  if (cutPoint === 0) {
    return { success: false, reason: 'no_compaction_needed' };
  }

  const toSummarize = entries.slice(0, cutPoint);
  const messages = toSummarize
    .filter((e): e is Extract<SessionEntry, { type: 'message' }> => e.type === 'message')
    .map((e) => e.message);

  if (messages.length === 0) {
    return { success: false, reason: 'no_messages_to_summarize' };
  }

  try {
    const summary = await generateSummary(messages, previousSummary, model, provider);
    const compactionEntry: SessionEntry = {
      type: 'compaction',
      id: `compaction-${Date.now()}`,
      summary,
      tokensBefore: estimateTokens(messages, model),
      firstKeptEntryId: entries[cutPoint].id,
      timestamp: Date.now(),
    };
    await storage.appendSession(sessionId, compactionEntry);
    return { success: true };
  } catch (err) {
    log.error('compaction LLM failed, keeping old entries', { error: String(err) });
    return { success: false, reason: 'llm_failed' };
  }
}

async function generateSummary(
  messages: AgentMessage[],
  previousSummary: string | null,
  model: Model,
  provider: Provider,
): Promise<string> {
  const systemPrompt = previousSummary
    ? `Previous summary: ${previousSummary}\n\nSummarize the following conversation:`
    : 'Summarize the following conversation:';

  const context: Context = {
    systemPrompt,
    messages: messages.map((m) => ({
      role: m.role,
      content: m.content,
    })),
  };

  const gen = provider.stream(model, context, { maxTokens: COMPACTION_MAX_TOKENS });
  let summary = '';
  for await (const evt of gen) {
    if (evt.type === 'text' && evt.text !== undefined) {
      summary += evt.text;
    } else if (evt.type === 'error') {
      throw new Error(evt.error?.message ?? 'llm_error');
    }
  }
  return summary;
}
