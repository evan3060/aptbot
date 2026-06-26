import type {
  Model,
  Context,
  StreamOptions,
  AssistantMessageEvent,
} from '../types.js';
import { withDualClock } from '../dual-clock.js';
import { withRetry, classifyError } from '../retry.js';
import { sanitizeContext } from '../sanitize.js';

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
      max_tokens: options?.maxTokens ?? 4096,
    };

    const fetchGen = createFetchGenerator(url, apiKey, body, options?.signal);
    const dualClockGen = withDualClock(fetchGen, {
      signal: options?.signal,
    });

    for await (const chunk of dualClockGen) {
      const event = parseAnthropicEvent(chunk);
      if (event) yield event;
      if (event?.type === 'stop') return;
    }
  })();
}

async function* createFetchGenerator(
  url: string,
  apiKey: string,
  body: unknown,
  signal?: AbortSignal,
): AsyncGenerator<string> {
  const doFetch = () =>
    fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(body),
      signal,
    });

  const response = await withRetry(async () => {
    const res = await doFetch();
    if (!res.ok) {
      const errBody = await res.text().catch(() => '');
      throw classifyError(res.status, errBody);
    }
    return res;
  }, { signal });

  if (!response.body) throw new Error('empty response body');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed === '' || trimmed.startsWith('event:')) continue;
      yield trimmed;
    }
  }
  if (buffer.trim()) yield buffer.trim();
}

function parseAnthropicEvent(raw: string): AssistantMessageEvent | null {
  if (!raw.startsWith('data:')) return null;
  const dataStr = raw.slice(5).trim();
  try {
    const data = JSON.parse(dataStr);
    if (data.type === 'content_block_delta') {
      if (data.delta?.type === 'text_delta') {
        return { type: 'text', text: data.delta.text };
      }
      if (data.delta?.type === 'input_json_delta') {
        return {
          type: 'tool_call',
          toolCall: {
            id: `tu_${data.index ?? 0}`,
            name: 'unknown',
            arguments: data.delta.partial_json ?? '',
          },
        };
      }
    }
    if (data.type === 'content_block_start' && data.content_block?.type === 'tool_use') {
      return {
        type: 'tool_call',
        toolCall: {
          id: data.content_block.id,
          name: data.content_block.name,
          arguments: '',
        },
      };
    }
    if (data.type === 'message_stop') {
      return { type: 'stop', stopReason: 'end_turn' };
    }
    return null;
  } catch {
    return null;
  }
}
