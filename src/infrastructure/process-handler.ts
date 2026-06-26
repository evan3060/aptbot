import { createLogger } from './logger.js';

export interface ShutdownHandlers {
  onShutdown: () => Promise<void>;
  isShuttingDown: () => boolean;
}

export const SIGINT_TIMEOUT_MS = 10000;
export const SIGTERM_TIMEOUT_MS = 30000;
export const MEMORY_WARN_THRESHOLD_MB = 450;
export const TURN_WARN_MS = 5 * 60 * 1000;
export const TURN_ABORT_MS = 10 * 60 * 1000;
const MEMORY_SAMPLE_INTERVAL_MS = 60 * 1000;

const logger = createLogger('process-handler');

/**
 * §10.13 / §10.14 installProcessHandlers:
 * - SIGINT (10s 超时) / SIGTERM (30s 超时) 触发 onShutdown
 * - SIGHUP 忽略（MVP）
 * - uncaughtException: 记录 + flush 日志 + exit(1)
 * - unhandledRejection: 记录不退出
 */
export function installProcessHandlers(handlers: ShutdownHandlers): void {
  const triggerShutdown = async (signal: 'SIGINT' | 'SIGTERM') => {
    if (handlers.isShuttingDown()) {
      logger.warn(`received ${signal} during shutdown, ignoring`);
      return;
    }
    const timeout = signal === 'SIGINT' ? SIGINT_TIMEOUT_MS : SIGTERM_TIMEOUT_MS;
    logger.info(`received ${signal}, initiating graceful shutdown (timeout ${timeout}ms)`);
    const forceExit = setTimeout(() => {
      logger.error(`graceful shutdown timed out after ${timeout}ms, forcing exit(1)`);
      process.exit(1);
    }, timeout);
    try {
      await handlers.onShutdown();
      clearTimeout(forceExit);
      logger.info('graceful shutdown complete, exit(0)');
      process.exit(0);
    } catch (err) {
      clearTimeout(forceExit);
      logger.error(`shutdown handler threw: ${(err as Error).stack ?? err}`);
      process.exit(1);
    }
  };

  process.on('SIGINT', () => {
    void triggerShutdown('SIGINT');
  });
  process.on('SIGTERM', () => {
    void triggerShutdown('SIGTERM');
  });
  process.on('SIGHUP', () => {
    logger.info('received SIGHUP, ignoring (MVP)');
  });

  process.on('uncaughtException', (err) => {
    logger.error(`uncaughtException: ${err.stack ?? err}`);
    // 给 logger flush 的时间，然后退出
    setTimeout(() => process.exit(1), 100);
  });

  process.on('unhandledRejection', (reason) => {
    logger.error(`unhandledRejection: ${String(reason)}`);
    // 不退出，仅记录
  });
}

/**
 * §10.14 startMemoryMonitor: 每 60s 采样 RSS，超 450MB warn。
 */
export function startMemoryMonitor(thresholdMb: number = MEMORY_WARN_THRESHOLD_MB): NodeJS.Timeout {
  const sample = () => {
    const mem = process.memoryUsage();
    const rssMb = mem.rss / (1024 * 1024);
    if (rssMb > thresholdMb) {
      logger.warn(`RSS memory exceeded threshold: ${rssMb.toFixed(1)}MB > ${thresholdMb}MB`);
    }
  };
  return setInterval(sample, MEMORY_SAMPLE_INTERVAL_MS);
}

/**
 * §10.14 startTurnWatchdog: 单 turn 超 5min warn、10min 触发 onTimeout。
 */
export function startTurnWatchdog(onTimeout: () => void): {
  markTurnStart: () => void;
  markTurnEnd: () => void;
} {
  let warnTimer: NodeJS.Timeout | null = null;
  let abortTimer: NodeJS.Timeout | null = null;

  const markTurnStart = () => {
    warnTimer = setTimeout(() => {
      logger.warn(`turn exceeded ${TURN_WARN_MS}ms`);
    }, TURN_WARN_MS);
    abortTimer = setTimeout(() => {
      logger.error(`turn exceeded ${TURN_ABORT_MS}ms, aborting`);
      onTimeout();
    }, TURN_ABORT_MS);
  };

  const markTurnEnd = () => {
    if (warnTimer) clearTimeout(warnTimer);
    if (abortTimer) clearTimeout(abortTimer);
    warnTimer = null;
    abortTimer = null;
  };

  return { markTurnStart, markTurnEnd };
}
