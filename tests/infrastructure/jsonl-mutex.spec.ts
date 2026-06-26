import { describe, it, expect } from 'vitest';
import { withJsonlLock, getJsonlMutex, JSONL_LOCK_TIMEOUT_MS } from '../../src/infrastructure/jsonl-mutex.js';

describe('jsonl mutex', () => {
  it('JSONL_LOCK_TIMEOUT_MS equals 5000', () => {
    expect(JSONL_LOCK_TIMEOUT_MS).toBe(5000);
  });

  it('serializes concurrent calls with same sessionId', async () => {
    const sessionId = 'sess-serialize-' + Date.now();
    const order: string[] = [];
    const p1 = withJsonlLock(sessionId, async () => {
      order.push('p1-start');
      await new Promise((r) => setTimeout(r, 30));
      order.push('p1-end');
      return 'p1';
    });
    const p2 = withJsonlLock(sessionId, async () => {
      order.push('p2-start');
      await new Promise((r) => setTimeout(r, 10));
      order.push('p2-end');
      return 'p2';
    });
    const [r1, r2] = await Promise.all([p1, p2]);
    expect(r1).toBe('p1');
    expect(r2).toBe('p2');
    expect(order).toEqual(['p1-start', 'p1-end', 'p2-start', 'p2-end']);
  });

  it('runs different sessionIds in parallel', async () => {
    const sessionA = 'sess-parallel-a-' + Date.now();
    const sessionB = 'sess-parallel-b-' + Date.now();
    const order: string[] = [];
    const start = Date.now();
    await Promise.all([
      withJsonlLock(sessionA, async () => {
        order.push('a-start');
        await new Promise((r) => setTimeout(r, 50));
        order.push('a-end');
      }),
      withJsonlLock(sessionB, async () => {
        order.push('b-start');
        await new Promise((r) => setTimeout(r, 50));
        order.push('b-end');
      }),
    ]);
    const elapsed = Date.now() - start;
    // 并行：总时长应接近 50ms 而非 100ms
    expect(elapsed).toBeLessThan(90);
  });

  it('returns same Mutex instance for same sessionId', () => {
    const sessionId = 'sess-stable-' + Date.now();
    const m1 = getJsonlMutex(sessionId);
    const m2 = getJsonlMutex(sessionId);
    expect(m1).toBe(m2);
  });
});
