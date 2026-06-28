import * as fs from 'node:fs';
import type { AgentTool, AgentToolResult } from '../types.js';
import { createLogger } from '../../../infrastructure/logger.js';
import { Mutex, type MutexInterface } from 'async-mutex';
import { containsPathTraversal, toolError } from './path-guard.js';

const log = createLogger('tool:edit');

export interface EditParams {
  path: string;
  oldString: string;
  newString: string;
}

export interface EditDetails {
  bytesBefore: number;
  bytesAfter: number;
  replaced: number;
}

export const EDIT_TIMEOUT_MS = 5000;
const EDIT_LOCK_TIMEOUT_MS = EDIT_TIMEOUT_MS;

const fileMutexes = new Map<string, Mutex>();

function getMutex(filePath: string): Mutex {
  let m = fileMutexes.get(filePath);
  if (!m) {
    m = new Mutex();
    fileMutexes.set(filePath, m);
  }
  return m;
}

function errorResult(
  code: string,
  message: string,
  details: Partial<EditDetails> = {},
): AgentToolResult<EditDetails> {
  return toolError(code, message, {
    bytesBefore: details.bytesBefore ?? 0,
    bytesAfter: details.bytesAfter ?? 0,
    replaced: details.replaced ?? 0,
  }) as AgentToolResult<EditDetails>;
}

function countOccurrences(haystack: string, needle: string): number {
  if (needle === '') return 0;
  let count = 0;
  let idx = haystack.indexOf(needle);
  while (idx !== -1) {
    count++;
    idx = haystack.indexOf(needle, idx + needle.length);
  }
  return count;
}

export async function acquireWithTimeout(
  mutex: Mutex,
  timeoutMs: number,
): Promise<MutexInterface.Releaser> {
  const acquisition = mutex.acquire();
  const timeout = new Promise<never>((_, reject) => {
    setTimeout(() => {
      reject(new Error(`edit lock timeout after ${timeoutMs}ms`));
    }, timeoutMs);
  });
  try {
    return await Promise.race([acquisition, timeout]);
  } catch (err) {
    // 超时胜出：acquisition 仍 pending。若它后续 resolve，必须立即 release，
    // 否则 ghost acquisition 将永久锁死该 filePath 的 mutex（C5 死锁修复）。
    acquisition.then((rel) => rel()).catch(() => {});
    throw err;
  }
}

async function executeEdit(
  _toolCallId: string,
  params: EditParams,
  signal?: AbortSignal,
): Promise<AgentToolResult<EditDetails>> {
  if (containsPathTraversal(params.path)) {
    return errorResult('path_traversal_denied', `path contains '..': ${params.path}`);
  }

  if (signal?.aborted) {
    return errorResult('aborted', 'aborted before edit');
  }

  const mutex = getMutex(params.path);
  let release: MutexInterface.Releaser | undefined;

  try {
    try {
      release = await acquireWithTimeout(mutex, EDIT_LOCK_TIMEOUT_MS);
    } catch (err) {
      return errorResult(
        'edit_timeout',
        `could not acquire lock within ${EDIT_LOCK_TIMEOUT_MS}ms (${String(err)})`,
      );
    }

    if (signal?.aborted) {
      return errorResult('aborted', 'aborted after lock acquisition');
    }

    let content: string;
    try {
      const buf = await fs.promises.readFile(params.path);
      content = buf.toString('utf8');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('ENOENT')) {
        return errorResult('not_found', `file not found: ${params.path}`);
      }
      return errorResult('read_error', msg);
    }

    const bytesBefore = Buffer.byteLength(content, 'utf8');
    const occurrences = countOccurrences(content, params.oldString);

    if (occurrences === 0) {
      return errorResult(
        'not_found',
        `oldString not found in ${params.path}`,
        { bytesBefore, bytesAfter: bytesBefore },
      );
    }
    if (occurrences > 1) {
      return errorResult(
        'not_unique',
        `oldString occurs ${occurrences} times in ${params.path}; needs unique match`,
        { bytesBefore, bytesAfter: bytesBefore },
      );
    }

    const newContent = content.replace(params.oldString, params.newString);
    const bytesAfter = Buffer.byteLength(newContent, 'utf8');

    if (signal?.aborted) {
      return errorResult('aborted', 'aborted before write', {
        bytesBefore,
        bytesAfter: bytesBefore,
      });
    }

    try {
      await fs.promises.writeFile(params.path, newContent, 'utf8');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return errorResult('write_error', msg, { bytesBefore, bytesAfter });
    }

    log.debug('edit completed', {
      path: params.path,
      bytesBefore,
      bytesAfter,
      replaced: 1,
    });

    return {
      content: [
        {
          type: 'text',
          text: `replaced 1 occurrence in ${params.path} (${bytesBefore} → ${bytesAfter} bytes)`,
        },
      ],
      details: { bytesBefore, bytesAfter, replaced: 1 },
    };
  } finally {
    if (release) release();
  }
}

export const editTool: AgentTool<EditParams, EditDetails> = {
  name: 'edit',
  label: 'Edit',
  description: `Replace a unique string occurrence in a file. Per-file mutex serializes concurrent edits. Returns not_found if oldString is absent, not_unique if multiple occurrences. 5s timeout. Rejects paths containing '..'.`,
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'File path to edit' },
      oldString: { type: 'string', description: 'Exact string to replace (must be unique in file)' },
      newString: { type: 'string', description: 'Replacement string' },
    },
    required: ['path', 'oldString', 'newString'],
  },
  executionMode: 'sequential',
  execute: executeEdit,
};
