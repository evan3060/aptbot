import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  installProcessHandlers,
  startMemoryMonitor,
  startTurnWatchdog,
  SIGINT_TIMEOUT_MS,
  SIGTERM_TIMEOUT_MS,
  MEMORY_WARN_THRESHOLD_MB,
  TURN_WARN_MS,
  TURN_ABORT_MS,
} from '../../src/infrastructure/process-handler.js';

describe('process-handler', () => {
  describe('constants', () => {
    it('exposes §10.13 timeout constants', () => {
      expect(SIGINT_TIMEOUT_MS).toBe(10000);
      expect(SIGTERM_TIMEOUT_MS).toBe(30000);
    });
    it('exposes §10.14 memory and turn thresholds', () => {
      expect(MEMORY_WARN_THRESHOLD_MB).toBe(450);
      expect(TURN_WARN_MS).toBe(5 * 60 * 1000);
      expect(TURN_ABORT_MS).toBe(10 * 60 * 1000);
    });
  });

  describe('installProcessHandlers', () => {
    it('does not throw and registers signal listeners', () => {
      const onShutdown = vi.fn(async () => {});
      const isShuttingDown = vi.fn(() => false);
      expect(() =>
        installProcessHandlers({ onShutdown, isShuttingDown }),
      ).not.toThrow();
      // 验证 listener 已注册
      expect(process.listeners('SIGINT').length).toBeGreaterThan(0);
      expect(process.listeners('SIGTERM').length).toBeGreaterThan(0);
    });
  });

  describe('startMemoryMonitor', () => {
    it('returns a timer handle that can be cleared', () => {
      const timer = startMemoryMonitor(MEMORY_WARN_THRESHOLD_MB);
      expect(timer).toBeDefined();
      expect(typeof timer.ref).toBe('function');
      clearTimeout(timer);
    });
  });

  describe('startTurnWatchdog', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    it('does not trigger onTimeout before TURN_ABORT_MS', () => {
      const onTimeout = vi.fn();
      const wd = startTurnWatchdog(onTimeout);
      wd.markTurnStart();
      vi.advanceTimersByTime(TURN_ABORT_MS - 1);
      expect(onTimeout).not.toHaveBeenCalled();
      wd.markTurnEnd();
    });

    it('triggers onTimeout at TURN_ABORT_MS', () => {
      const onTimeout = vi.fn();
      const wd = startTurnWatchdog(onTimeout);
      wd.markTurnStart();
      vi.advanceTimersByTime(TURN_ABORT_MS);
      expect(onTimeout).toHaveBeenCalledTimes(1);
      wd.markTurnEnd();
    });

    it('does not trigger onTimeout after markTurnEnd', () => {
      const onTimeout = vi.fn();
      const wd = startTurnWatchdog(onTimeout);
      wd.markTurnStart();
      wd.markTurnEnd();
      vi.advanceTimersByTime(TURN_ABORT_MS * 2);
      expect(onTimeout).not.toHaveBeenCalled();
    });
  });
});
