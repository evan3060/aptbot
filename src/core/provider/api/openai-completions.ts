import type {
  Model,
  Context,
  StreamOptions,
  AssistantMessageEvent,
} from '../types.js';
import type { ContentBlock } from '../../memory/agent-message.js';
import { withDualClock } from '../dual-clock.js';
import { sanitizeContext } from '../sanitize.js';
import { createSseFetchGenerator } from './sse-fetch.js';

/**
 * openai-completions API stream（标准 OpenAI Chat Completions）。
 * 调用 POST {baseUrl}/chat/completions，使用 messages 数组格式。
 * 兼容大多数 OpenAI-compatible API（如 DeepSeek、Moonshot、Together 等）。
 * SSE 解析 → AssistantMessageEvent。应用 sanitize + dual-clock + retry。
 */
export function createOpenaiCompletionsStream(
  baseUrl: string,
  apiKey: string,
  model: Model,
  context: Context,
  options?: StreamOptions,
): AsyncGenerator<AssistantMessageEvent> {
  return (async function* (): AsyncGenerator<AssistantMessageEvent> {
    const sanitized = sanitizeContext(context);
    const url = `${baseUrl}/chat/completions`;

    // 构造 messages：system prompt 作为首条 system 消息
    // 工具调用上下文需正确格式化 assistant.tool_calls 和 tool.tool_call_id
    const messages: Array<Record<string, unknown>> = [];
    if (sanitized.systemPrompt) {
      messages.push({ role: 'system', content: sanitized.systemPrompt });
    }
    for (const m of sanitized.messages) {
      const content = serializeContent(m.content);
      if (m.role === 'assistant' && m.toolCalls && m.toolCalls.length > 0) {
        // assistant 消息带 tool_calls（OpenAI Chat Completions 格式）
        messages.push({
          role: 'assistant',
          content: content || null,
          tool_calls: m.toolCalls.map((tc) => ({
            id: tc.id,
            type: 'function',
            function: { name: tc.name, arguments: tc.arguments },
          })),
        });
      } else if (m.role === 'tool' && m.toolCallId) {
        // tool 结果消息必须带 tool_call_id
        messages.push({
          role: 'tool',
          content,
          tool_call_id: m.toolCallId,
        });
      } else {
        messages.push({ role: m.role, content });
      }
    }

    const body: Record<string, unknown> = {
      model: model.id,
      messages,
      stream: true,
      temperature: options?.temperature,
      max_tokens: options?.maxTokens,
    };
    if (sanitized.tools && sanitized.tools.length > 0) {
      body.tools = sanitized.tools.map((t) => ({
        type: 'function',
        function: {
          name: t.name,
          description: t.description,
          parameters: t.parameters,
        },
      }));
    }

    const fetchGen = createSseFetchGenerator(url, apiKey, body, options?.signal);
    const dualClockGen = withDualClock(fetchGen, {
      signal: options?.signal,
    });

    // 按 index 累积 tool_call 分片
    const pending = new Map<number, { id: string; name: string; arguments: string }>();

    for await (const chunk of dualClockGen) {
      const event = parseOpenaiChatEvent(chunk);
      if (!event) continue;

      if (event.type === 'text') {
        yield { type: 'text', text: event.text };
      } else if (event.type === 'tool_call_start') {
        pending.set(event.index, {
          id: event.id,
          name: event.name,
          arguments: event.arguments ?? '',
        });
      } else if (event.type === 'tool_call_delta') {
        let tc = pending.get(event.index);
        if (!tc) {
          tc = { id: `call_${event.index}`, name: 'unknown', arguments: '' };
          pending.set(event.index, tc);
        }
        if (event.name && tc.name === 'unknown') tc.name = event.name;
        if (event.arguments !== undefined) tc.arguments += event.arguments;
      } else if (event.type === 'stop') {
        // 刷新所有未完成的 tool_call
        for (const tc of pending.values()) {
          yield { type: 'tool_call', toolCall: tc };
        }
        pending.clear();
        yield { type: 'stop', stopReason: event.stopReason };
        return;
      }
    }
  })();
}

/**
 * 序列化 content：string 原样返回；ContentBlock[] 提取 text 拼接为字符串。
 */
function serializeContent(content: string | ContentBlock[]): string {
  if (typeof content === 'string') return content;
  return content
    .map((c) => (c.type === 'text' ? c.text : ''))
    .join('');
}

type OpenaiChatParsedEvent =
  | { type: 'text'; text: string }
  | { type: 'tool_call_start'; index: number; id: string; name: string; arguments?: string }
  | { type: 'tool_call_delta'; index: number; arguments?: string; name?: string }
  | { type: 'stop'; stopReason: string };

function parseOpenaiChatEvent(raw: string): OpenaiChatParsedEvent | null {
  if (!raw.startsWith('data:')) return null;
  const dataStr = raw.slice(5).trim();
  if (dataStr === '[DONE]') return { type: 'stop', stopReason: 'done' };
  try {
    const data = JSON.parse(dataStr);
    const choice = data.choices?.[0];
    if (!choice) return null;

    // finish_reason 存在表示流结束
    if (choice.finish_reason) {
      return { type: 'stop', stopReason: choice.finish_reason };
    }

    const delta = choice.delta;
    if (!delta) return null;

    // 处理文本内容（忽略 DeepSeek 特有的 reasoning_content）
    if (typeof delta.content === 'string' && delta.content.length > 0) {
      return { type: 'text', text: delta.content };
    }

    // 处理 tool_calls：首片带 id 和/或 function.name，后续分片只带 function.arguments
    if (Array.isArray(delta.tool_calls) && delta.tool_calls.length > 0) {
      const tc = delta.tool_calls[0];
      const idx = typeof tc.index === 'number' ? tc.index : 0;
      // 首片：含 id 或 function.name（可能同时携带初始 arguments）
      if (tc.id || tc.function?.name) {
        return {
          type: 'tool_call_start',
          index: idx,
          id: tc.id ?? `call_${idx}`,
          name: tc.function?.name ?? 'unknown',
          arguments: tc.function?.arguments,
        };
      }
      // 后续分片：function.arguments
      if (tc.function?.arguments !== undefined) {
        return { type: 'tool_call_delta', index: idx, arguments: tc.function.arguments };
      }
    }

    return null;
  } catch {
    console.debug('SSE JSON parse failed', { raw: raw.slice(0, 100) });
    return null;
  }
}
