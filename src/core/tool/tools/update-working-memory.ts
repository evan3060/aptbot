import type { AgentTool, AgentToolResult } from '../types.js';
import type { StorageAdapter } from '../../../infrastructure/storage/file-storage.js';
import { createLogger } from '../../../infrastructure/logger.js';

const log = createLogger('tool:update_working_memory');

export interface UpdateWorkingMemoryParams {
  keyInfo: string;
}

export interface UpdateWorkingMemoryDetails {
  truncated: boolean;
  bytesBefore: number;
  bytesAfter: number;
}

export const KEY_INFO_MAX_CHARS = 2000;

/**
 * §6.5 update_working_memory tool factory.
 * 由于工具需要 StorageAdapter + sessionId 上下文，采用工厂模式注入依赖。
 * 调用方（AgentSession）在 session 创建时构造此 tool 并注册到 ToolRegistry。
 */
export function createUpdateWorkingMemoryTool(
  storage: StorageAdapter,
  sessionId: string,
): AgentTool<UpdateWorkingMemoryParams, UpdateWorkingMemoryDetails> {
  return {
    name: 'update_working_memory',
    label: 'Update Working Memory',
    description: `Update the session's key working memory notes. Overwrites any previous value. Truncates to ${KEY_INFO_MAX_CHARS} characters.`,
    parameters: {
      type: 'object',
      properties: {
        keyInfo: {
          type: 'string',
          description: `Concise key info to remember (max ${KEY_INFO_MAX_CHARS} chars)`,
        },
      },
      required: ['keyInfo'],
    },
    executionMode: 'sequential',
    execute: async (
      _toolCallId: string,
      params: UpdateWorkingMemoryParams,
    ): Promise<AgentToolResult<UpdateWorkingMemoryDetails>> => {
      const raw = params.keyInfo ?? '';
      let keyInfo = raw;
      let truncated = false;

      if (raw.length > KEY_INFO_MAX_CHARS) {
        keyInfo = raw.slice(0, KEY_INFO_MAX_CHARS);
        truncated = true;
        log.warn('keyInfo truncated', {
          sessionId,
          originalLength: raw.length,
          truncatedTo: KEY_INFO_MAX_CHARS,
        });
      }

      const bytesBefore = Buffer.byteLength(
        (await storage.readWorkingMemory(sessionId)) ?? '',
        'utf8',
      );

      try {
        await storage.writeWorkingMemory(sessionId, keyInfo);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: 'text', text: `write_error: ${msg}` }],
          details: { truncated, bytesBefore, bytesAfter: bytesBefore },
          error: { code: 'write_error', message: msg },
        };
      }

      const bytesAfter = Buffer.byteLength(keyInfo, 'utf8');

      log.debug('working memory updated', {
        sessionId,
        bytesBefore,
        bytesAfter,
        truncated,
      });

      return {
        content: [
          {
            type: 'text',
            text: truncated
              ? `working memory updated (truncated from ${raw.length} to ${KEY_INFO_MAX_CHARS} chars)`
              : `working memory updated (${bytesAfter} bytes)`,
          },
        ],
        details: { truncated, bytesBefore, bytesAfter },
      };
    },
  };
}
