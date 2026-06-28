import { withRetry, classifyError } from '../retry.js';

/**
 * §4.1 共享 SSE fetch 生成器。
 * 发起带 retry 的 POST，读取 SSE 流并按行 yield（已 trim）。
 * 跳过空行与 `event:` 行；非 `data:` 行由调用方解析器自行忽略。
 *
 * `headers` 缺省时使用 OpenAI 风格 `authorization: Bearer <apiKey>`；
 * 需要自定义鉴权头（如 anthropic 的 `x-api-key`）时由调用方传入完整 headers。
 */
export async function* createSseFetchGenerator(
  url: string,
  apiKey: string,
  body: unknown,
  signal?: AbortSignal,
  headers?: Record<string, string>,
): AsyncGenerator<string> {
  const finalHeaders = headers ?? {
    'content-type': 'application/json',
    authorization: `Bearer ${apiKey}`,
  };

  const doFetch = () =>
    fetch(url, {
      method: 'POST',
      headers: finalHeaders,
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
