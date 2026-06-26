import { describe, it, expect } from 'vitest';
import { bashTool, BASH_TIMEOUT_MS, BASH_SIGTERM_GRACE_MS } from '../../../../src/core/tool/tools/bash.js';

describe('bashTool', () => {
  it('executes echo hello and returns stdout', async () => {
    const result = await bashTool.execute('tc_1', { command: 'echo hello' });
    expect(result.error).toBeUndefined();
    expect(result.content[0]).toMatchObject({ type: 'text' });
    const details = result.details;
    expect(details.exitCode).toBe(0);
    expect(details.stdout.trim()).toBe('hello');
    expect(details.killed).toBe(false);
    expect(details.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('captures stderr separately', async () => {
    const result = await bashTool.execute('tc_2', {
      command: 'echo err >&2; echo out',
    });
    expect(result.details.exitCode).toBe(0);
    expect(result.details.stdout.trim()).toBe('out');
    expect(result.details.stderr.trim()).toBe('err');
  });

  it('returns non-zero exit code without throwing', async () => {
    const result = await bashTool.execute('tc_3', { command: 'exit 7' });
    expect(result.error).toBeUndefined();
    expect(result.details.exitCode).toBe(7);
  });

  it('returns timeout_error when command exceeds timeoutMs', async () => {
    const start = Date.now();
    const result = await bashTool.execute('tc_4', {
      command: 'sleep 5',
      timeoutMs: 100,
    });
    const elapsed = Date.now() - start;
    expect(result.error?.code).toBe('timeout_error');
    expect(result.details.killed).toBe(true);
    // Should complete well within the 5s sleep duration
    expect(elapsed).toBeLessThan(BASH_SIGTERM_GRACE_MS + 1000);
  });

  it('aborts via AbortSignal and returns aborted error', async () => {
    const ctrl = new AbortController();
    const promise = bashTool.execute('tc_5', { command: 'sleep 5' }, ctrl.signal);
    setTimeout(() => ctrl.abort(), 50);
    const result = await promise;
    expect(result.error?.code).toBe('aborted');
    expect(result.details.killed).toBe(true);
  });

  it('respects cwd option', async () => {
    const result = await bashTool.execute('tc_6', {
      command: 'pwd',
      cwd: '/tmp',
    });
    expect(result.details.exitCode).toBe(0);
    // /tmp is a symlink to /private/tmp on macOS, so accept either
    const pwd = result.details.stdout.trim();
    expect(pwd === '/tmp' || pwd === '/private/tmp' || pwd.endsWith('/tmp')).toBe(true);
  });

  it('exposes BASH_TIMEOUT_MS = 30000 and BASH_SIGTERM_GRACE_MS = 2000', () => {
    expect(BASH_TIMEOUT_MS).toBe(30000);
    expect(BASH_SIGTERM_GRACE_MS).toBe(2000);
  });

  it('truncates stdout exceeding 1MB', async () => {
    // Generate ~2MB of output
    const result = await bashTool.execute('tc_7', {
      command: 'yes hello | head -c 2097152',
    });
    expect(result.details.stdout.length).toBeLessThanOrEqual(1024 * 1024);
  });

  it('declares name, label, description, parameters and sequential executionMode', () => {
    expect(bashTool.name).toBe('bash');
    expect(bashTool.label).toBeTruthy();
    expect(bashTool.description).toBeTruthy();
    expect(bashTool.parameters).toBeDefined();
    expect(bashTool.executionMode).toBe('sequential');
  });
});
