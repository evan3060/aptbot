import type {
  Model,
  Context,
  StreamOptions,
  AssistantMessageEvent,
} from '../types.js';
import { withDualClock } from '../dual-clock.js';
import { sanitizeContext } from '../sanitize.js';
import { createSseFetchGenerator } from './sse-fetch.js';
import { DEFAULT_STOP_REASON } from '../../agent/loop.js';

const DEFAULT_MAX_TOKENS = 4096;
const ANTHROPIC_API_VERSION = '2023-06-01';

/**
 * §4.1 anthropic-messages API stream.
 * SSE 解析 → AssistantMessageEvent。应用 sanitize + dual-clock + retry。
 */
export function createAnthropicMessagesStream(
  baseUrl: string,
  apiKey: string,
  model: Model,
  context: Context,
  options?: StreamOptions,
): AsyncGenerator<AssistantMessageEvent> {
  return (async function* (): AsyncGenerator<AssistantMessageEvent> {
    const sanitized = sanitizeContext(context);
    const url = `${baseUrl}/messages`;
    const body = {
      model: model.id,
      system: sanitized.systemPrompt,
      messages: sanitized.messages.map((m) => ({
        role: m.role,
        content: m.content,
      })),
      tools: sanitized.tools?.map((t) => ({
        name: t.name,
        description: t.description,
        input_schema: t.parameters,
      })),
      stream: true,
      temperature: options?.temperature,
      max_tokens: options?.maxTokens ?? DEFAULT_MAX_TOKENS,
    };

    const fetchGen = createSseFetchGenerator(url, apiKey, body, options?.signal, {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': ANTHROPIC_API_VERSION,
    });
    const dualClockGen = withDualClock(fetchGen, {
      signal: options?.signal,
    });

    // C4 修复：按 index 累积 tool_use 分片，id/name 取自 content_block_start
    const pending = new Map<number, { id: string; name: string; arguments: string }>();

    for await (const chunk of dualClockGen) {
      const event = parseAnthropicEvent(chunk);
      if (!event) continue;

      if (event.type === 'text') {
        yield { type: 'text', text: event.text };
      } else if (event.type === 'tool_call_start') {
        pending.set(event.index, { id: event.id, name: event.name, arguments: '' });
      } else if (event.type === 'tool_call_delta') {
        let tc = pending.get(event.index);
        if (!tc) {
          tc = { id: `tu_${event.index}`, name: 'unknown', arguments: '' };
          pending.set(event.index, tc);
        }
        tc.arguments += event.delta;
      } else if (event.type === 'tool_call_done') {
        const tc = pending.get(event.index);
        if (tc) {
          yield { type: 'tool_call', toolCall: tc };
          pending.delete(event.index);
        }
      } else if (event.type === 'stop') {
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

type AnthropicParsedEvent =
  | { type: 'text'; text: string }
  | { type: 'tool_call_start'; index: number; id: string; name: string }
  | { type: 'tool_call_delta'; index: number; delta: string }
  | { type: 'tool_call_done'; index: number }
  | { type: 'stop'; stopReason: string };

function parseAnthropicEvent(raw: string): AnthropicParsedEvent | null {
  if (!raw.startsWith('data:')) return null;
  const dataStr = raw.slice(5).trim();
  try {
    const data = JSON.parse(dataStr);
    if (data.type === 'content_block_delta') {
      if (data.delta?.type === 'text_delta') {
        return { type: 'text', text: data.delta.text };
      }
      if (data.delta?.type === 'input_json_delta') {
        return { type: 'tool_call_delta', index: data.index ?? 0, delta: data.delta.partial_json ?? '' };
      }
    }
    if (data.type === 'content_block_start' && data.content_block?.type === 'tool_use') {
      return {
        type: 'tool_call_start',
        index: data.index ?? 0,
        id: data.content_block.id,
        name: data.content_block.name,
      };
    }
    if (data.type === 'content_block_stop') {
      return { type: 'tool_call_done', index: data.index ?? 0 };
    }
    if (data.type === 'message_stop') {
      return { type: 'stop', stopReason: DEFAULT_STOP_REASON };
    }
    return null;
  } catch {
    console.debug('SSE JSON parse failed', { raw: raw.slice(0, 100) });
    return null;
  }
}
