import { spawn, type ChildProcess } from 'node:child_process';
import type { AgentTool, AgentToolResult } from '../types.js';
import { createLogger } from '../../../infrastructure/logger.js';

const log = createLogger('tool:bash');

export interface BashParams {
  command: string;
  cwd?: string;
  timeoutMs?: number;
}

export interface BashDetails {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  durationMs: number;
  killed: boolean;
}

export const BASH_TIMEOUT_MS = 30000;
export const BASH_SIGTERM_GRACE_MS = 2000;
export const BASH_MAX_CONCURRENT = 10;
const MAX_OUTPUT_BYTES = 1024 * 1024; // 1MB per stream

const activeProcesses = new Set<ChildProcess>();
let exitHookInstalled = false;

function installExitHook(): void {
  if (exitHookInstalled) return;
  exitHookInstalled = true;
  process.on('exit', () => {
    for (const p of activeProcesses) {
      try {
        p.kill('SIGKILL');
      } catch {
        /* noop */
      }
    }
  });
}

function appendChunk(
  buffer: string,
  bytes: number,
  chunk: Buffer,
): { buffer: string; bytes: number; truncated: boolean } {
  if (bytes >= MAX_OUTPUT_BYTES) {
    return { buffer, bytes, truncated: true };
  }
  const remaining = MAX_OUTPUT_BYTES - bytes;
  if (chunk.length > remaining) {
    return {
      buffer: buffer + chunk.slice(0, remaining).toString('utf8'),
      bytes: MAX_OUTPUT_BYTES,
      truncated: true,
    };
  }
  return {
    buffer: buffer + chunk.toString('utf8'),
    bytes: bytes + chunk.length,
    truncated: false,
  };
}

async function executeBash(
  _toolCallId: string,
  params: BashParams,
  signal?: AbortSignal,
): Promise<AgentToolResult<BashDetails>> {
  installExitHook();

  if (activeProcesses.size >= BASH_MAX_CONCURRENT) {
    log.warn('concurrency limit reached', {
      active: activeProcesses.size,
      max: BASH_MAX_CONCURRENT,
    });
    return {
      content: [{ type: 'text', text: 'concurrency_limit: max 10 concurrent bash calls' }],
      details: { exitCode: null, stdout: '', stderr: '', durationMs: 0, killed: false },
      error: { code: 'concurrency_limit', message: 'max 10 concurrent bash calls' },
    };
  }

  const start = Date.now();
  const timeoutMs = Math.min(params.timeoutMs ?? BASH_TIMEOUT_MS, BASH_TIMEOUT_MS);

  let child: ChildProcess;
  try {
    child = spawn(params.command, {
      shell: true,
      cwd: params.cwd,
      env: process.env,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      content: [{ type: 'text', text: `spawn_error: ${msg}` }],
      details: { exitCode: null, stdout: '', stderr: '', durationMs: 0, killed: false },
      error: { code: 'spawn_error', message: msg },
    };
  }

  let killed = false;
  let killReason: 'timeout' | 'aborted' | null = null;
  let stdout = '';
  let stdoutBytes = 0;
  let stderr = '';
  let stderrBytes = 0;

  child.stdout?.on('data', (chunk: Buffer) => {
    const r = appendChunk(stdout, stdoutBytes, chunk);
    stdout = r.buffer;
    stdoutBytes = r.bytes;
  });
  child.stderr?.on('data', (chunk: Buffer) => {
    const r = appendChunk(stderr, stderrBytes, chunk);
    stderr = r.buffer;
    stderrBytes = r.bytes;
  });

  activeProcesses.add(child);

  let timeoutHandle: NodeJS.Timeout | undefined;
  let sigkillHandle: NodeJS.Timeout | undefined;
  let abortListener: (() => void) | undefined;

  const cleanup = () => {
    if (timeoutHandle) clearTimeout(timeoutHandle);
    if (sigkillHandle) clearTimeout(sigkillHandle);
    if (signal && abortListener) {
      signal.removeEventListener('abort', abortListener);
      abortListener = undefined;
    }
    activeProcesses.delete(child);
  };

  const escalateKill = () => {
    if (killed) return;
    killed = true;
    try {
      child.kill('SIGTERM');
    } catch {
      /* noop */
    }
    sigkillHandle = setTimeout(() => {
      try {
        child.kill('SIGKILL');
      } catch {
        /* noop */
      }
    }, BASH_SIGTERM_GRACE_MS);
  };

  if (signal) {
    if (signal.aborted) {
      killReason = 'aborted';
      escalateKill();
    } else {
      abortListener = () => {
        killReason = 'aborted';
        escalateKill();
      };
      signal.addEventListener('abort', abortListener);
    }
  }

  timeoutHandle = setTimeout(() => {
    killReason = 'timeout';
    escalateKill();
  }, timeoutMs);

  return new Promise((resolve) => {
    const settle = (exitCode: number | null) => {
      cleanup();
      const durationMs = Date.now() - start;
      const details: BashDetails = {
        exitCode,
        stdout,
        stderr,
        durationMs,
        killed,
      };

      let error: { code: string; message: string } | undefined;
      if (killed) {
        if (killReason === 'aborted') {
          error = { code: 'aborted', message: 'aborted by signal' };
        } else {
          error = {
            code: 'timeout_error',
            message: `command exceeded ${timeoutMs}ms`,
          };
        }
      }

      const text = error
        ? `${error.code}: ${error.message}\nstdout:\n${stdout}\nstderr:\n${stderr}`
        : `exit=${exitCode}\nstdout:\n${stdout}\nstderr:\n${stderr}`;

      log.debug('bash completed', {
        exitCode,
        killed,
        durationMs,
        error: error?.code,
      });

      resolve({
        content: [{ type: 'text', text }],
        details,
        error,
      });
    };

    child.on('close', (code) => settle(code));
    child.on('error', (err) => {
      log.error('spawn error', { message: err.message });
      settle(null);
    });
  });
}

export const bashTool: AgentTool<BashParams, BashDetails> = {
  name: 'bash',
  label: 'Bash',
  description:
    'Execute a shell command with a 30s hard timeout. SIGTERM is sent on timeout/abort, followed by SIGKILL after 2s grace. stdout/stderr truncated to 1MB each.',
  parameters: {
    type: 'object',
    properties: {
      command: { type: 'string', description: 'Shell command to execute' },
      cwd: { type: 'string', description: 'Working directory' },
      timeoutMs: { type: 'number', description: 'Hard timeout in ms (max 30000)' },
    },
    required: ['command'],
  },
  executionMode: 'sequential',
  execute: executeBash,
};
