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
  const acquisition = mutex.acquire();
  const timeout = new Promise<never>((_, reject) => {
    setTimeout(() => {
      reject(new Error(`jsonl lock timeout after ${JSONL_LOCK_TIMEOUT_MS}ms for sessionId=${sessionId}`));
    }, JSONL_LOCK_TIMEOUT_MS);
  });
  let release: MutexInterface.Releaser;
  try {
    release = await Promise.race([acquisition, timeout]);
  } catch (err) {
    // 超时胜出：acquisition 仍 pending。若它后续 resolve，必须立即 release，
    // 否则 ghost acquisition 将永久锁死该 sessionId 的 mutex（C1 死锁修复）。
    acquisition.then((rel) => rel()).catch(() => {});
    throw err;
  }
  try {
    return await fn();
  } finally {
    release();
  }
}
