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

    const fetchGen = createFetchGenerator(url, apiKey, body, options?.signal);
    const dualClockGen = withDualClock(fetchGen, {
      signal: options?.signal,
    });

    for await (const chunk of dualClockGen) {
      const event = parseOpenaiEvent(chunk);
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
        authorization: `Bearer ${apiKey}`,
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
      if (trimmed === '') continue;
      yield trimmed;
    }
  }
  if (buffer.trim()) yield buffer.trim();
}

function parseOpenaiEvent(raw: string): AssistantMessageEvent | null {
  if (!raw.startsWith('data:')) return null;
  const dataStr = raw.slice(5).trim();
  if (dataStr === '[DONE]') return { type: 'stop', stopReason: 'done' };
  try {
    const data = JSON.parse(dataStr);
    if (data.type === 'response.output_text.delta') {
      return { type: 'text', text: data.delta };
    }
    if (data.type === 'response.function_call_arguments.delta') {
      return {
        type: 'tool_call',
        toolCall: {
          id: data.item_id ?? `tc_${Date.now()}`,
          name: data.name,
          arguments: data.delta,
        },
      };
    }
    if (data.type === 'response.completed') {
      return { type: 'stop', stopReason: 'completed' };
    }
    return null;
  } catch {
    return null;
  }
}
