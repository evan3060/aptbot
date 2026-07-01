import * as fs from 'node:fs';
import { createReadStream } from 'node:fs';
import type { AgentTool, AgentToolResult } from '../types.js';
import { createLogger } from '../../../infrastructure/logger.js';
import { containsPathTraversal, toolError } from './path-guard.js';
import type { SkillState } from '../../skills/loader.js';

const log = createLogger('tool:read');

export interface ReadParams {
  path: string;
  offset?: number;
  limit?: number;
}

export interface ReadDetails {
  lines: number;
  bytes: number;
  truncated: boolean;
}

export const READ_MAX_BYTES = 2 * 1024 * 1024;
export const READ_STREAM_THRESHOLD = 1024 * 1024;
export const READ_TIMEOUT_MS = 5000;

/**
 * §12.5 createReadTool 选项。
 * - skillState：传入后，read_file 读取 skill 文件时特判更新 lastUsed（触发 L1 索引重排序）
 * - 不传则与 Task 8 行为一致（无 lastUsed 维护），保持向后兼容
 */
export interface ReadToolOptions {
  readonly skillState?: SkillState;
}

function errorResult(
  code: string,
  message: string,
  details: Partial<ReadDetails> = {},
): AgentToolResult<ReadDetails> {
  return toolError(code, message, {
    lines: details.lines ?? 0,
    bytes: details.bytes ?? 0,
    truncated: details.truncated ?? false,
  }) as AgentToolResult<ReadDetails>;
}

async function readStreaming(
  filePath: string,
  signal?: AbortSignal,
): Promise<{ text: string; bytes: number; aborted: boolean }> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    let totalBytes = 0;
    let aborted = false;
    const stream = createReadStream(filePath, { encoding: undefined });
    let timeoutHandle: NodeJS.Timeout | undefined;
    let abortListener: (() => void) | undefined;

    const cleanup = () => {
      if (timeoutHandle) clearTimeout(timeoutHandle);
      if (signal && abortListener) {
        signal.removeEventListener('abort', abortListener);
        abortListener = undefined;
      }
    };

    const finish = () => {
      cleanup();
      stream.destroy();
      const buf = Buffer.concat(chunks);
      resolve({ text: buf.toString('utf8'), bytes: totalBytes, aborted });
    };

    if (signal) {
      if (signal.aborted) {
        aborted = true;
        finish();
        return;
      }
      abortListener = () => {
        aborted = true;
        finish();
      };
      signal.addEventListener('abort', abortListener);
    }

    timeoutHandle = setTimeout(() => {
      aborted = true;
      finish();
    }, READ_TIMEOUT_MS);

    stream.on('data', (chunk: Buffer) => {
      if (aborted) return;
      totalBytes += chunk.length;
      chunks.push(chunk);
    });
    stream.on('end', finish);
    stream.on('error', (err) => {
      // Suppress error log when we initiated the destroy via abort/timeout
      if (!aborted) {
        log.error('stream read error', { path: filePath, message: err.message });
      }
      finish();
    });
  });
}

async function executeRead(
  _toolCallId: string,
  params: ReadParams,
  signal: AbortSignal | undefined,
  skillState: SkillState | undefined,
): Promise<AgentToolResult<ReadDetails>> {
  if (containsPathTraversal(params.path)) {
    return errorResult('path_traversal_denied', `path contains '..': ${params.path}`);
  }

  let stat: fs.Stats;
  try {
    stat = fs.statSync(params.path);
  } catch {
    return errorResult('not_found', `file not found: ${params.path}`);
  }

  if (!stat.isFile()) {
    return errorResult('not_a_file', `not a regular file: ${params.path}`);
  }

  if (stat.size > READ_MAX_BYTES) {
    return errorResult(
      'file_too_large',
      `file size ${stat.size} exceeds ${READ_MAX_BYTES}`,
      { bytes: stat.size },
    );
  }

  if (signal?.aborted) {
    return errorResult('aborted', 'aborted before read');
  }

  let text: string;
  let bytes: number;
  let truncated = false;

  if (stat.size > READ_STREAM_THRESHOLD) {
    const r = await readStreaming(params.path, signal);
    text = r.text;
    bytes = r.bytes;
    if (r.aborted) {
      return errorResult('aborted', 'aborted during read', { bytes });
    }
  } else {
    try {
      const buf = await fs.promises.readFile(params.path);
      text = buf.toString('utf8');
      bytes = buf.length;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return errorResult('read_error', msg);
    }
  }

  // Apply line-based pagination
  const allLines = text.split('\n');
  // Trailing newline produces a trailing empty string; preserve for byte-count integrity
  const hasTrailingNewline = text.endsWith('\n');
  const logicalLines = hasTrailingNewline ? allLines.slice(0, -1) : allLines;

  const offset = params.offset ?? 0;
  const limit = params.limit;
  const sliced = limit !== undefined ? logicalLines.slice(offset, offset + limit) : logicalLines.slice(offset);

  const outText = sliced.join('\n') + (sliced.length > 0 ? '\n' : '');
  const lineCount = sliced.length;

  // §12.5 read_file 特判：读取成功后，若 path 是 skill 文件，更新 lastUsed
  // 触发 L1 索引重排序（下次 formatSkillsForSystemPrompt 时生效）
  if (skillState) {
    try {
      skillState.markUsed(params.path);
    } catch (e) {
      // lastUsed 维护失败不影响 read 主流程
      log.warn('skillState.markUsed failed', { path: params.path, error: String(e) });
    }
  }

  log.debug('read completed', {
    path: params.path,
    bytes,
    lines: lineCount,
    offset,
    limit,
  });

  return {
    content: [{ type: 'text', text: outText }],
    details: { lines: lineCount, bytes, truncated },
  };
}

/**
 * §12.5 createReadTool：创建 read 工具实例。
 *
 * @param options.skillState 传入后，read_file 读取 skill 文件时特判更新 lastUsed
 *                           （联动 L1 索引重排序）；不传则无 lastUsed 维护，保持向后兼容。
 */
export function createReadTool(options: ReadToolOptions = {}): AgentTool<ReadParams, ReadDetails> {
  const skillState = options.skillState;
  return {
    name: 'read',
    label: 'Read',
    description: `Read a UTF-8 text file with optional line-based pagination. Files larger than 2MB return file_too_large. Streaming read above 1MB. 5s timeout. Rejects paths containing '..'.`,
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Absolute or relative file path' },
        offset: { type: 'number', description: 'Line offset (0-based)' },
        limit: { type: 'number', description: 'Max number of lines to return' },
      },
      required: ['path'],
    },
    executionMode: 'parallel',
    execute: (toolCallId, params, signal) => executeRead(toolCallId, params, signal, skillState),
  };
}

/**
 * §8.5 readTool 默认单例（无 skillState，向后兼容 Task 8 行为）。
 * 需要 lastUsed 维护时改用 createReadTool({ skillState })。
 */
export const readTool: AgentTool<ReadParams, ReadDetails> = createReadTool();
