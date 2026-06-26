import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createLogger, maskSecret, type LogLevel } from '../../src/infrastructure/logger.js';
import { existsSync, rmSync, readFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const LOG_DIR = './logs';
const LOG_FILE = join(LOG_DIR, 'aptbot.log');

describe('logger', () => {
  beforeEach(() => {
    if (existsSync(LOG_DIR)) rmSync(LOG_DIR, { recursive: true, force: true });
  });

  afterEach(() => {
    if (existsSync(LOG_DIR)) rmSync(LOG_DIR, { recursive: true, force: true });
  });

  describe('maskSecret', () => {
    it('masks aptbot_ prefixed tokens', () => {
      expect(maskSecret('aptbot_abc123')).toBe('aptbot_***');
    });

    it('masks aptbot_ token embedded in longer string', () => {
      expect(maskSecret('Bearer aptbot_secret_xyz')).toBe('Bearer aptbot_***');
    });

    it('returns string unchanged when no aptbot_ pattern', () => {
      expect(maskSecret('hello world')).toBe('hello world');
    });

    it('masks apiKey field in JSON-serialized object', () => {
      const masked = maskSecret(JSON.stringify({ apiKey: 'aptbot_abc' }));
      expect(masked).toContain('aptbot_***');
      expect(masked).not.toContain('aptbot_abc');
    });
  });

  describe('createLogger', () => {
    it('preserves scope on logger instance', () => {
      const logger = createLogger('test-scope');
      expect(logger.scope).toBe('test-scope');
    });

    it('child logger inherits scope as namespaced', () => {
      const parent = createLogger('parent');
      const child = parent.child('sub');
      expect(child.scope).toBe('parent:sub');
    });

    it('writes log line to file with scope field', () => {
      const logger = createLogger('file-test');
      logger.info('hello world');
      // Force flush by syncing pino destination via process.stdout tick
      // pino async writes via worker; we use sync transport for testability
      return new Promise<void>((resolve) => {
        setImmediate(() => {
          expect(existsSync(LOG_FILE)).toBe(true);
          const content = readFileSync(LOG_FILE, 'utf-8');
          expect(content).toContain('"scope":"file-test"');
          expect(content).toContain('hello world');
          resolve();
        });
      });
    });

    it('respects level threshold filter', () => {
      const logger = createLogger('threshold-test', 'warn');
      logger.info('should-not-appear');
      logger.warn('should-appear');
      return new Promise<void>((resolve) => {
        setImmediate(() => {
          const content = readFileSync(LOG_FILE, 'utf-8');
          expect(content).not.toContain('should-not-appear');
          expect(content).toContain('should-appear');
          resolve();
        });
      });
    });

    it('child logger inherits parent threshold', () => {
      const parent = createLogger('parent-threshold', 'error');
      const child = parent.child('sub');
      child.warn('filtered');
      child.error('kept');
      return new Promise<void>((resolve) => {
        setImmediate(() => {
          const content = readFileSync(LOG_FILE, 'utf-8');
          expect(content).not.toContain('filtered');
          expect(content).toContain('kept');
          resolve();
        });
      });
    });
  });
});
