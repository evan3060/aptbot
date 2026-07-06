import { existsSync, statSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { AgentTool, AgentToolResult } from '../types.js';
import { createLogger } from '../../../infrastructure/logger.js';
import { toolError } from './path-guard.js';
import {
  AGENT_SLUG_REGEX,
  MAX_MEMORY_SIZE,
} from '../../agent/agent-profile.js';
import { USER_ID_REGEX } from '../../agent/agent-storage.js';

const log = createLogger('tool:read_agent_memory');

/** §0.3.0 §2.5 section 枚举：read_agent_memory 工具可读取的 MEMORY.md 区段 */
export type MemorySection = 'user_profile' | 'facts' | 'preferences' | 'history' | 'all';

export interface ReadAgentMemoryParams {
  section?: MemorySection;
}

export interface ReadAgentMemoryDetails {
  /** MEMORY.md 是否存在 */
  exists: boolean;
  /** 文件字节数（不存在为 0） */
  bytes: number;
  /** 实际返回的 section（已归一化，缺省为 'all'） */
  section: MemorySection;
  /** 是否触发了 section 过滤（section !== 'all'） */
  filtered: boolean;
}

/**
 * §0.3.0 §2.5 section 标题映射。
 * - section 值（snake_case）↔ MEMORY.md 中的 `## ` 标题（Title Case）
 * - 简单字符串映射，不做 fuzzy 匹配
 */
const SECTION_HEADER_MAP: Record<Exclude<MemorySection, 'all'>, string> = {
  user_profile: 'User Profile',
  facts: 'Facts',
  preferences: 'Preferences',
  history: 'History',
};

/**
 * §0.3.0 §2.5 parseSection: 从 MEMORY.md 文本中提取指定 section 内容。
 *
 * 解析规则（简单 markdown ## header detection，无 fancy parsing）：
 * - 仅识别 `## ` 开头的行作为 section header
 * - section 内容 = header 后所有非 `## ` 开头的行，直到下一个 `## ` 或 EOF
 * - 大小写敏感匹配（spec 中固定为 Title Case）
 * - 返回内容不含 section header 本身，但保留尾部换行
 *
 * @param raw MEMORY.md 原始文本
 * @param section 目标 section（非 'all'）
 * @returns section 内容（无匹配返回空字符串）
 */
function parseSection(raw: string, section: Exclude<MemorySection, 'all'>): string {
  const header = SECTION_HEADER_MAP[section];
  const lines = raw.split('\n');
  let capturing = false;
  let found = false;
  const captured: string[] = [];

  for (const line of lines) {
    if (line.startsWith('## ')) {
      if (capturing) {
        // 已进入目标 section，遇到下一个 ## header → 结束
        break;
      }
      // header 行：`## User Profile` 形式（去掉 `## ` 前缀比对）
      if (line.slice(3).trim() === header) {
        capturing = true;
        found = true;
      }
      continue;
    }
    if (capturing) {
      captured.push(line);
    }
  }

  if (!found) return '';
  // 拼接为完整文本；保留尾部换行以维持可读性
  let text = captured.join('\n');
  // 去除首部空行（`## Header` 与首行内容之间的空行）
  text = text.replace(/^\n+/, '');
  return text;
}

/**
 * §0.3.0 Task 6 createReadAgentMemoryTool: 工厂函数创建 read_agent_memory 工具。
 *
 * 路径硬编码为 `${dataDir}/users/${userId}/agents/${agentId}/MEMORY.md`：
 * - 不接受 path 参数 → 防止 LLM 跨 agent / 跨用户访问
 * - userId + agentId 在构造时校验路径遍历防护（USER_ID_REGEX + AGENT_SLUG_REGEX）
 *
 * @param userId 当前 session 所属用户 ID（UUID v4）
 * @param agentId 当前 session 绑定的 agent slug
 * @param dataDir 数据根目录（如 ./data）
 */
export function createReadAgentMemoryTool(
  userId: string,
  agentId: string,
  dataDir: string,
): AgentTool<ReadAgentMemoryParams, ReadAgentMemoryDetails> {
  // 构造时校验路径遍历防护
  if (!USER_ID_REGEX.test(userId)) {
    throw new Error(`invalid userId (path traversal guard): ${userId}`);
  }
  if (!AGENT_SLUG_REGEX.test(agentId)) {
    throw new Error(`invalid agentId (path traversal guard): ${agentId}`);
  }

  // 硬编码路径：dataDir/users/<userId>/agents/<agentId>/MEMORY.md
  const memoryPath = join(dataDir, 'users', userId, 'agents', agentId, 'MEMORY.md');

  return {
    name: 'read_agent_memory',
    label: 'Read Agent Memory',
    description: `Read the current agent's MEMORY.md (User Profile / Facts / Preferences / History). Path is hardcoded to the current agent; cross-agent access is forbidden. Files >${MAX_MEMORY_SIZE} bytes return memory_too_large — read by section instead.`,
    parameters: {
      type: 'object',
      properties: {
        section: {
          type: 'string',
          enum: ['user_profile', 'facts', 'preferences', 'history', 'all'],
          description: `Section to read (default: 'all'). Use specific section when file is large.`,
        },
      },
      required: [],
    },
    executionMode: 'parallel',
    execute: async (
      _toolCallId: string,
      params: ReadAgentMemoryParams,
    ): Promise<AgentToolResult<ReadAgentMemoryDetails>> => {
      // section 缺省归一化为 'all'；显式忽略任何 path / 其他参数
      const section: MemorySection = params?.section ?? 'all';
      const filtered = section !== 'all';

      // 文件不存在 → 返回空内容（非错误）
      if (!existsSync(memoryPath)) {
        return {
          content: [{ type: 'text', text: '' }],
          details: { exists: false, bytes: 0, section, filtered },
        };
      }

      let stat;
      try {
        stat = statSync(memoryPath);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        log.error('stat MEMORY.md failed', { path: memoryPath, error: msg });
        return toolError('stat_error', msg, {
          exists: false,
          bytes: 0,
          section,
          filtered,
        }) as AgentToolResult<ReadAgentMemoryDetails>;
      }

      const bytes = stat.size;

      // 大小限制：>MAX_MEMORY_SIZE 返回 memory_too_large
      if (bytes > MAX_MEMORY_SIZE) {
        const hint = `memory size ${bytes} exceeds ${MAX_MEMORY_SIZE}; read by section (user_profile / facts / preferences / history) instead`;
        log.warn('MEMORY.md too large', { path: memoryPath, bytes });
        return toolError('memory_too_large', hint, {
          exists: true,
          bytes,
          section,
          filtered,
        }) as AgentToolResult<ReadAgentMemoryDetails>;
      }

      // 读取文件内容
      let raw: string;
      try {
        raw = readFileSync(memoryPath, 'utf8');
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        log.error('read MEMORY.md failed', { path: memoryPath, error: msg });
        return toolError('read_error', msg, {
          exists: true,
          bytes,
          section,
          filtered,
        }) as AgentToolResult<ReadAgentMemoryDetails>;
      }

      // section 过滤
      let text: string;
      if (section === 'all') {
        text = raw;
      } else {
        text = parseSection(raw, section);
      }

      log.debug('read MEMORY.md', {
        path: memoryPath,
        bytes,
        section,
        filtered,
        outBytes: Buffer.byteLength(text, 'utf8'),
      });

      return {
        content: [{ type: 'text', text }],
        details: { exists: true, bytes, section, filtered },
      };
    },
  };
}
