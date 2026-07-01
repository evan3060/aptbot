import type { Provider, Model, ContextMessage, Context } from '../provider/types.js';
import type { StorageAdapter } from '../../infrastructure/storage/file-storage.js';
import { createLogger } from '../../infrastructure/logger.js';

const log = createLogger('session-summary');

/**
 * §4.10 Task 10: 固定摘要 prompt（不可配置）。
 * 要求 LLM 在 ≤20 字符内总结对话，无标点、无引号。
 */
export const SUMMARY_PROMPT =
  'Summarize this conversation in ≤20 chars. No punctuation. No quotes.';

/** §4.10: 摘要最大字符数（按字符而非字节，JS slice 天然按 UTF-16 码元）。 */
export const SUMMARY_MAX_CHARS = 20;

/** §4.10: LLM 调用默认超时（ms），超时静默放弃。 */
const DEFAULT_TIMEOUT_MS = 10_000;

/** §4.10: 每个 session 同时只允许一个摘要任务在飞，防止重复 LLM 调用。 */
const inFlight = new Set<string>();

export interface SummaryTriggerOpts {
  sessionId: string;
  provider: Provider;
  model: Model;
  /** 已积累的对话消息（含 user/assistant/tool 角色）；本函数会过滤后送入 LLM。 */
  messages: ContextMessage[];
  storage: StorageAdapter;
  /** 测试可注入超时；生产环境使用默认 10s。 */
  timeoutMs?: number;
}

/**
 * §4.10 Task 10: turn_end 后触发自动摘要。
 *
 * 行为：
 * - 已有 custom label（labelSource === 'custom'）→ 永久跳过
 * - 同 session 已有摘要任务在飞 → 跳过（in-flight guard）
 * - 过滤 tool 角色消息与 toolCalls 字段，仅拼接 user/assistant 文本（安全控制）
 * - 非阻塞：调用方应以 `void triggerSessionSummary(...).catch(...)` 形式 fire-and-forget
 * - LLM 失败 / 超时 → 静默放弃，保留默认 label，不抛错
 * - 摘要 > 20 字符 → 截断至 20 字符
 * - 成功 → 写入 label + labelSource='auto'
 *
 * 注意：in-flight 标记在首个 await 之前同步加入，确保并发调用安全跳过。
 */
export async function triggerSessionSummary(
  opts: SummaryTriggerOpts,
): Promise<void> {
  const { sessionId, provider, model, messages, storage } = opts;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  // in-flight guard：同步检查 + 同步加入（在首个 await 之前）
  if (inFlight.has(sessionId)) return;
  inFlight.add(sessionId);

  try {
    // 用户手动 /label 后永久跳过自动摘要
    try {
      if (await storage.hasCustomLabel(sessionId)) return;
    } catch (e) {
      log.warn('hasCustomLabel failed, skipping summary', {
        sessionId,
        error: String(e),
      });
      return;
    }

    // 安全控制：仅 user/assistant 文本，剔除 tool 角色与 toolCalls 内容
    const text = messages
      .filter((m) => m.role === 'user' || m.role === 'assistant')
      .map((m) => (typeof m.content === 'string' ? m.content : ''))
      .join('\n')
      .trim();
    if (!text) return;

    const summaryContext: Context = {
      systemPrompt: SUMMARY_PROMPT,
      messages: [{ role: 'user', content: text }],
    };

    const llmPromise = (async (): Promise<string> => {
      let acc = '';
      for await (const evt of provider.stream(model, summaryContext, {})) {
        if (evt.type === 'text' && evt.text !== undefined) acc += evt.text;
        if (evt.type === 'stop') break;
        if (evt.type === 'error') break;
      }
      return acc;
    })();

    const timeoutPromise = new Promise<'__TIMEOUT__'>((resolve) => {
      setTimeout(() => resolve('__TIMEOUT__'), timeoutMs);
    });

    let outcome: string | '__TIMEOUT__';
    try {
      outcome = await Promise.race([llmPromise, timeoutPromise]);
    } catch (e) {
      // LLM 失败：静默放弃，保留默认 label
      log.warn('summary llm call failed, keeping default label', {
        sessionId,
        error: String(e),
      });
      return;
    }

    if (outcome === '__TIMEOUT__') {
      // 超时：吞掉后续可能的 rejection，避免 unhandledRejection
      llmPromise.catch(() => {});
      log.warn('summary llm call timed out, keeping default label', {
        sessionId,
      });
      return;
    }

    const summary = outcome.trim().slice(0, SUMMARY_MAX_CHARS);
    if (!summary) return;

    // LLM 返回后，复检 hasCustomLabel（防止 in-flight 期间用户手动 /label 被覆盖）
    try {
      if (await storage.hasCustomLabel(sessionId)) return;
    } catch (e) {
      log.warn('hasCustomLabel re-check failed, skipping summary write', {
        sessionId,
        error: String(e),
      });
      return;
    }

    await storage.updateSessionLabel(sessionId, summary, 'auto');
  } catch (e) {
    // 任何意外错误都不向调用方/用户暴露
    log.warn('triggerSessionSummary failed, keeping default label', {
      sessionId,
      error: String(e),
    });
  } finally {
    inFlight.delete(sessionId);
  }
}
