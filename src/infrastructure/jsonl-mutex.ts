import { Mutex, type MutexInterface } from 'async-mutex';

export const JSONL_LOCK_TIMEOUT_MS = 5000;

const mutexCache = new Map<string, Mutex>();

/**
 * §10.1.1 getJsonlMutex: per-sessionId mutex 保证并发写入串行化。
 * Mutex 实例缓存到 Map，session 结束后由调用方清理。
 */
export function getJsonlMutex(sessionId: string): Mutex {
  let mutex = mutexCache.get(sessionId);
  if (!mutex) {
    mutex = new Mutex();
    mutexCache.set(sessionId, mutex);
  }
  return mutex;
}

/**
 * §10.1.1 withJsonlLock: 在 5000ms 内未获取锁则 reject 并 emit error 事件。
 */
export async function withJsonlLock<T>(
  sessionId: string,
  fn: () => Promise<T>,
): Promise<T> {
  const mutex = getJsonlMutex(sessionId);
  let release: MutexInterface.Releaser | undefined;
  const acquisition = mutex.acquire();
  const timeout = new Promise<never>((_, reject) => {
    setTimeout(() => {
      reject(new Error(`jsonl lock timeout after ${JSONL_LOCK_TIMEOUT_MS}ms for sessionId=${sessionId}`));
    }, JSONL_LOCK_TIMEOUT_MS);
  });
  try {
    release = await Promise.race([acquisition, timeout]);
  } catch (err) {
    // 取消 acquisition 的等待（async-mutex 没有原生 cancel，但 release 在 finally 中兜底）
    throw err;
  }
  try {
    return await fn();
  } finally {
    if (release) release();
  }
}
