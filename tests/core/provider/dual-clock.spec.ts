import { describe, it, expect } from 'vitest';
import {
  withDualClock,
  DEFAULT_TTFB_MS,
  DEFAULT_CHUNK_INTERVAL_MS,
  StreamTimeoutError,
} from '../../../src/core/provider/dual-clock.js';

async function* fromArray<T>(items: T[], delayMs = 0): AsyncGenerator<T> {
  for (const item of items) {
    if (delayMs > 0) await new Promise((r) => setTimeout(r, delayMs));
    yield item;
  }
}

async function collect<T>(gen: AsyncGenerator<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const item of gen) out.push(item);
  return out;
}

describe('dual-clock', () => {
  it('exposes default constants', () => {
    expect(DEFAULT_TTFB_MS).toBe(5000);
    expect(DEFAULT_CHUNK_INTERVAL_MS).toBe(1500);
  });

  it('passes through a fast stream without errors', async () => {
    const source = fromArray([1, 2, 3], 0);
    const result = await collect(withDualClock(source, { ttfbMs: 500, chunkIntervalMs: 200 }));
    expect(result).toEqual([1, 2, 3]);
  });

  it('throws StreamTimeoutError when TTFB exceeds threshold', async () => {
    const slowSource = (async function* () {
      await new Promise((r) => setTimeout(r, 300));
      yield 'too late';
    })();

    await expect(
      collect(withDualClock(slowSource, { ttfbMs: 100, chunkIntervalMs: 500 })),
    ).rejects.toBeInstanceOf(StreamTimeoutError);
  });

  it('throws StreamTimeoutError when chunk interval exceeds threshold', async () => {
    const stallingSource = (async function* () {
      yield 'first';
      await new Promise((r) => setTimeout(r, 300));
      yield 'second';
    })();

    await expect(
      collect(withDualClock(stallingSource, { ttfbMs: 500, chunkIntervalMs: 100 })),
    ).rejects.toBeInstanceOf(StreamTimeoutError);
  });

  it('StreamTimeoutError has retryable=true', async () => {
    const slowSource = (async function* () {
      await new Promise((r) => setTimeout(r, 200));
      yield 'x';
    })();

    try {
      await collect(withDualClock(slowSource, { ttfbMs: 50, chunkIntervalMs: 500 }));
    } catch (err) {
      expect(err).toBeInstanceOf(StreamTimeoutError);
      expect((err as StreamTimeoutError).retryable).toBe(true);
      return;
    }
    expect.unreachable('should have thrown');
  });

  it('stops yielding after abort signal', async () => {
    const ctrl = new AbortController();
    const longSource = (async function* () {
      yield 'a';
      await new Promise((r) => setTimeout(r, 10000));
      yield 'b';
    })();

    const gen = withDualClock(longSource, { signal: ctrl.signal, ttfbMs: 50000, chunkIntervalMs: 50000 });
    const first = await gen.next();
    expect(first.value).toBe('a');
    ctrl.abort();
    // Wait for abort to settle (100ms + buffer)
    await new Promise((r) => setTimeout(r, 200));
    const next = await gen.next();
    expect(next.done).toBe(true);
  });
});
