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

  // Regression for C1: timeout 后 ghost acquisition 永久锁死 mutex
  it('does not permanently deadlock after timeout (regression for C1)', async () => {
    const sessionId = 'sess-deadlock-' + Date.now();
    const mutex = getJsonlMutex(sessionId);

    // 手动持锁超过超时阈值
    const releaseA = await mutex.acquire();

    // B 将在 5000ms 后超时
    const bPromise = withJsonlLock(sessionId, async () => 'b-result');
    await expect(bPromise).rejects.toThrow(/jsonl lock timeout/);

    // 释放 A —— B 的 ghost acquisition 此刻可能 resolve 但 release 未被调用
    releaseA();
    // 让 microtask 刷新，使 ghost acquisition 有机会 resolve 并（修复后）自释放
    await new Promise((r) => setTimeout(r, 50));

    // C 应能重新获取锁；若存在死锁 bug，此处将永久挂起直到 testTimeout
    const cResult = await withJsonlLock(sessionId, async () => 'c-result');
    expect(cResult).toBe('c-result');
  }, 15000);
});
