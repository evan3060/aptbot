import type {
  Model,
  Context,
  StreamOptions,
  AssistantMessageEvent,
} from '../types.js';
import { withDualClock } from '../dual-clock.js';
import { sanitizeContext } from '../sanitize.js';
import { createSseFetchGenerator } from './sse-fetch.js';

/**
 * §4.1 openai-responses API stream.
 * SSE 解析 → AssistantMessageEvent。应用 sanitize + dual-clock + retry。
 */
export function createOpenaiResponsesStream(
  baseUrl: string,
  apiKey: string,
  model: Model,
  context: Context,
  options?: StreamOptions,
): AsyncGenerator<AssistantMessageEvent> {
  return (async function* (): AsyncGenerator<AssistantMessageEvent> {
    const sanitized = sanitizeContext(context);
    const url = `${baseUrl}/responses`;
    const body = {
      model: model.id,
      input: sanitized.messages.map((m) => ({
        role: m.role,
        content: m.content,
      })),
      instructions: sanitized.systemPrompt,
      tools: sanitized.tools?.map((t) => ({
        type: 'function',
        name: t.name,
        description: t.description,
        parameters: t.parameters,
      })),
      stream: true,
      temperature: options?.temperature,
      max_output_tokens: options?.maxTokens,
    };

    const fetchGen = createSseFetchGenerator(url, apiKey, body, options?.signal);
    const dualClockGen = withDualClock(fetchGen, {
      signal: options?.signal,
    });

    // C3 修复：累积 tool_call argument 分片，避免每个 delta 产生独立 tool_call
    const pending = new Map<string, { id: string; name: string; arguments: string }>();

    for await (const chunk of dualClockGen) {
      const event = parseOpenaiEvent(chunk);
      if (!event) continue;

      if (event.type === 'text') {
        yield { type: 'text', text: event.text };
      } else if (event.type === 'tool_call_start') {
        pending.set(event.itemId, { id: event.itemId, name: event.name, arguments: '' });
      } else if (event.type === 'tool_call_delta') {
        let tc = pending.get(event.itemId);
        if (!tc) {
          // Delta 无前置 start（兼容旧测试：name 可能从 delta 获取）
          tc = { id: event.itemId, name: event.name ?? 'unknown', arguments: '' };
          pending.set(event.itemId, tc);
        }
        if (event.name && tc.name === 'unknown') tc.name = event.name;
        tc.arguments += event.delta;
      } else if (event.type === 'tool_call_done') {
        const tc = pending.get(event.itemId);
        if (tc) {
          if (event.arguments) tc.arguments = event.arguments;
          yield { type: 'tool_call', toolCall: tc };
          pending.delete(event.itemId);
        }
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

type OpenaiParsedEvent =
  | { type: 'text'; text: string }
  | { type: 'tool_call_start'; itemId: string; name: string }
  | { type: 'tool_call_delta'; itemId: string; delta: string; name?: string }
  | { type: 'tool_call_done'; itemId: string; arguments?: string }
  | { type: 'stop'; stopReason: string };

function parseOpenaiEvent(raw: string): OpenaiParsedEvent | null {
  if (!raw.startsWith('data:')) return null;
  const dataStr = raw.slice(5).trim();
  if (dataStr === '[DONE]') return { type: 'stop', stopReason: 'done' };
  try {
    const data = JSON.parse(dataStr);
    if (data.type === 'response.output_text.delta') {
      return { type: 'text', text: data.delta };
    }
    if (data.type === 'response.output_item.added' && data.item?.type === 'function_call') {
      return { type: 'tool_call_start', itemId: data.item.id, name: data.item.name };
    }
    if (data.type === 'response.function_call_arguments.delta') {
      // I9 修复：缺失 item_id 的事件忽略，防止 ghost tool_call 进入 pending Map
      if (!data.item_id) return null;
      return { type: 'tool_call_delta', itemId: data.item_id, delta: data.delta, name: data.name };
    }
    if (data.type === 'response.function_call_arguments.done') {
      // I9 修复：缺失 item_id 的 done 事件忽略
      if (!data.item_id) return null;
      return { type: 'tool_call_done', itemId: data.item_id, arguments: data.arguments };
    }
    if (data.type === 'response.output_item.done' && data.item?.type === 'function_call') {
      return { type: 'tool_call_done', itemId: data.item.id };
    }
    if (data.type === 'response.completed') {
      return { type: 'stop', stopReason: 'completed' };
    }
    return null;
  } catch {
    console.debug('SSE JSON parse failed', { raw: raw.slice(0, 100) });
    return null;
  }
}
