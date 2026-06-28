export type RetryableError = {
  retryable: true;
  status: 429 | 500 | 502 | 503 | 504 | 'ECONNRESET' | 'ETIMEDOUT';
  message: string;
};
export type FatalError = {
  retryable: false;
  status: 400 | 401 | 403;
  message: string;
};
export type ProviderError = RetryableError | FatalError;

export const RETRY_DELAYS_MS = [1000, 2000, 4000] as const;
export const MAX_RETRIES = 3;

const RETRYABLE_HTTP = new Set([429, 500, 502, 503, 504]);
const FATAL_HTTP = new Set([400, 401, 403]);
const RETRYABLE_CODES = new Set(['ECONNRESET', 'ETIMEDOUT']);

/**
 * §10.1.5 classifyError: 将 HTTP 状态码或网络错误码分类为 retryable / fatal。
 */
export function classifyError(
  status: number | string,
  message: string,
): ProviderError {
  if (typeof status === 'string') {
    if (RETRYABLE_CODES.has(status)) {
      return { retryable: true, status: status as RetryableError['status'], message };
    }
    return { retryable: false, status: 400, message: `${status}: ${message}` };
  }
  if (RETRYABLE_HTTP.has(status)) {
    return { retryable: true, status: status as RetryableError['status'], message };
  }
  if (FATAL_HTTP.has(status)) {
    return { retryable: false, status: status as FatalError['status'], message };
  }
  // 未知状态码默认 fatal
  return { retryable: false, status: 400, message: `unknown status ${status}: ${message}` };
}

/**
 * §10.1.5 withRetry: 对 retryable 错误按 1s/2s/4s 指数退避重试最多 3 次。
 * fatal 错误立即抛出。
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options?: {
    signal?: AbortSignal;
    onRetry?: (err: ProviderError, attempt: number) => void;
  },
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    if (options?.signal?.aborted) {
      throw new Error('aborted');
    }
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      let providerErr: ProviderError;
      if (err && typeof err === 'object' && 'retryable' in err) {
        providerErr = err as ProviderError;
      } else {
        providerErr = classifyError(500, (err as Error)?.message ?? String(err));
      }
      if (!providerErr.retryable) {
        throw providerErr;
      }
      if (attempt >= MAX_RETRIES) {
        throw providerErr;
      }
      options?.onRetry?.(providerErr, attempt);
      const delay = RETRY_DELAYS_MS[attempt - 1] ?? RETRY_DELAYS_MS[RETRY_DELAYS_MS.length - 1];
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw lastError;
}
