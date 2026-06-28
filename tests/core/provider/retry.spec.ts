import { describe, it, expect, vi } from 'vitest';
import {
  classifyError,
  withRetry,
  RETRY_DELAYS_MS,
  MAX_RETRIES,
} from '../../../src/core/provider/retry.js';

describe('classifyError', () => {
  it('classifies 429 as retryable', () => {
    const e = classifyError(429, 'rate limited');
    expect(e.retryable).toBe(true);
  });
  it('classifies 500 as retryable', () => {
    expect(classifyError(500, 'server error').retryable).toBe(true);
  });
  it('classifies 502 as retryable', () => {
    expect(classifyError(502, 'bad gateway').retryable).toBe(true);
  });
  it('classifies 503 as retryable', () => {
    expect(classifyError(503, 'service unavailable').retryable).toBe(true);
  });
  it('classifies 504 as retryable', () => {
    expect(classifyError(504, 'gateway timeout').retryable).toBe(true);
  });
  it('classifies 400 as fatal', () => {
    expect(classifyError(400, 'bad request').retryable).toBe(false);
  });
  it('classifies 401 as fatal', () => {
    expect(classifyError(401, 'unauthorized').retryable).toBe(false);
  });
  it('classifies 403 as fatal', () => {
    expect(classifyError(403, 'forbidden').retryable).toBe(false);
  });
  it('classifies ECONNRESET-like as retryable', () => {
    const e = classifyError('ECONNRESET', 'socket hang up');
    expect(e.retryable).toBe(true);
  });
  it('classifies ETIMEDOUT-like as retryable', () => {
    const e = classifyError('ETIMEDOUT', 'timeout');
    expect(e.retryable).toBe(true);
  });
});

describe('withRetry', () => {
  it('returns result on first success', async () => {
    const fn = vi.fn().mockResolvedValue('ok');
    const result = await withRetry(fn);
    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('retries on retryable error and succeeds', async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(classifyError(429, 'rate'))
      .mockRejectedValueOnce(classifyError(503, 'unavailable'))
      .mockResolvedValueOnce('ok');
    const result = await withRetry(fn, { onRetry: () => {} });
    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('throws after MAX_RETRIES retryable failures', async () => {
    expect(RETRY_DELAYS_MS.length).toBe(3);
    expect(MAX_RETRIES).toBe(3);
    const fn = vi.fn().mockRejectedValue(classifyError(429, 'rate'));
    await expect(withRetry(fn)).rejects.toMatchObject({ retryable: true });
    expect(fn).toHaveBeenCalledTimes(MAX_RETRIES);
  });

  it('does not retry on fatal error', async () => {
    const fn = vi.fn().mockRejectedValue(classifyError(401, 'unauthorized'));
    await expect(withRetry(fn)).rejects.toMatchObject({ retryable: false });
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('calls onRetry callback with error and attempt number', async () => {
    const onRetry = vi.fn();
    const fn = vi
      .fn()
      .mockRejectedValueOnce(classifyError(429, 'rate'))
      .mockResolvedValueOnce('ok');
    await withRetry(fn, { onRetry });
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(onRetry).toHaveBeenCalledWith(expect.anything(), 1);
  });
});
