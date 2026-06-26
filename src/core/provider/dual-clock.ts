export interface DualClockOptions {
  ttfbMs?: number;
  chunkIntervalMs?: number;
  signal?: AbortSignal;
}

export const DEFAULT_TTFB_MS = 5000;
export const DEFAULT_CHUNK_INTERVAL_MS = 1500;
const ABORT_SETTLE_MS = 100;

export class StreamTimeoutError extends Error {
  readonly retryable = true;
  readonly kind: 'ttfb' | 'chunk-interval';
  constructor(kind: 'ttfb' | 'chunk-interval', timeoutMs: number) {
    super(`stream ${kind} timeout after ${timeoutMs}ms`);
    this.name = 'StreamTimeoutError';
    this.kind = kind;
  }
}

function createTimeout(ms: number, kind: 'ttfb' | 'chunk-interval'): { promise: Promise<never>, clear: () => void } {
  let handle: ReturnType<typeof setTimeout> | undefined;
  const promise = new Promise<never>((_, reject) => {
    handle = setTimeout(() => reject(new StreamTimeoutError(kind, ms)), ms);
  });
  const clear = () => {
    if (handle) clearTimeout(handle);
  };
  return { promise, clear };
}

function createAbortPromise(signal?: AbortSignal): { promise: Promise<true> | null } {
  if (!signal) return { promise: null };
  if (signal.aborted) return { promise: Promise.resolve(true) };
  const promise = new Promise<true>((resolve) => {
    signal.addEventListener('abort', () => resolve(true), { once: true });
  });
  return { promise };
}

/**
 * §10.1.5 / §10.3 withDualClock: 包装上游 AsyncGenerator，应用双时钟：
 * - TTFB 5000ms（首字节超时）
 * - chunk 间隔 1500ms
 * 任一超时抛 StreamTimeoutError(retryable: true)。
 * 收到 signal.abort 时 100ms 内停止 yield。
 */
export async function* withDualClock<T>(
  source: AsyncGenerator<T>,
  options?: DualClockOptions,
): AsyncGenerator<T> {
  const ttfbMs = options?.ttfbMs ?? DEFAULT_TTFB_MS;
  const chunkIntervalMs = options?.chunkIntervalMs ?? DEFAULT_CHUNK_INTERVAL_MS;
  const signal = options?.signal;

  const abort = createAbortPromise(signal);
  let isFirst = true;

  while (true) {
    const timeoutMs = isFirst ? ttfbMs : chunkIntervalMs;
    const kind: 'ttfb' | 'chunk-interval' = isFirst ? 'ttfb' : 'chunk-interval';
    const timeout = createTimeout(timeoutMs, kind);

    const nextPromise = source.next();
    const racers: Promise<unknown>[] = [nextPromise, timeout.promise];
    if (abort.promise) racers.push(abort.promise);

    try {
      const result = await Promise.race(racers);
      timeout.clear();

      if (result === true) {
        // abort 触发
        await new Promise((r) => setTimeout(r, ABORT_SETTLE_MS));
        return;
      }

      const next = result as IteratorResult<T>;
      if (next.done) return;
      isFirst = false;
      yield next.value;
    } catch (err) {
      timeout.clear();
      throw err;
    }
  }
}
