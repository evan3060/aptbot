import {
  existsSync,
  statSync,
  readFileSync,
  writeFileSync,
  renameSync,
  mkdirSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import type { AgentTool, AgentToolResult } from '../types.js';
import { createLogger } from '../../../infrastructure/logger.js';
import { toolError } from './path-guard.js';
import {
  AGENT_SLUG_REGEX,
  MAX_WRITE_CONTENT_SIZE,
} from '../../agent/agent-profile.js';
import { USER_ID_REGEX, withAgentLock } from '../../agent/agent-storage.js';
import type { MemoryAuditLog, MemoryAuditSection } from '../../agent/memory-audit-log.js';
import {
  SECTION_HEADER_MAP,
  SECTION_ORDER,
} from './read-agent-memory.js';

const log = createLogger('tool:write_agent_memory');

/** §0.3.0 Task 7 write_agent_memory 参数 */
export interface WriteAgentMemoryParams {
  section: MemoryAuditSection;
  content: string;
  mode: 'append' | 'replace';
}

/** §0.3.0 Task 7 write_agent_memory 返回详情 */
export interface WriteAgentMemoryDetails {
  section: MemoryAuditSection;
  mode: 'append' | 'replace';
  /** 写入前 MEMORY.md 字节数（0 if not exists） */
  beforeSize: number;
  /** 写入后 MEMORY.md 字节数 */
  afterSize: number;
  /** 审计日志是否成功记录 */
  audited: boolean;
}

/** §0.3.0 审计 contentPreview 最大长度 */
const CONTENT_PREVIEW_MAX = 200;

/**
 * §0.3.0 Task 7 createWriteAgentMemoryTool: 工厂函数创建 write_agent_memory 工具。
 *
 * 路径硬编码为 `${dataDir}/users/${userId}/agents/${agentId}/MEMORY.md`：
 * - 不接受 path 参数 → 防止 LLM 跨 agent / 跨用户访问
 * - userId + agentId 通过 getter 在执行时动态读取，路径遍历防护也在执行时校验
 *
 * 并发串行化：复用 AgentStorage.withAgentLock（lockKey = `${userId}/${agentId}`），
 * 与 AgentStorage.saveAgent 共享同一 per-agentId Mutex 实例，保证并发写入串行化。
 * 审计日志 append 嵌套在 withAgentLock 内（审计 append 内部使用 withJsonlLock 独立锁），
 * 保证审计记录顺序与 memory 写入顺序一致。
 *
 * §0.3.0 final-review: 工厂签名改为 getter + auditLogFactory 模式，使 server.ts 可在
 * 注册时传入可变上下文（userId 在每条消息到达时更新、agentSlug 在 /agent 切换时更新），
 * 工具执行时读取最新值并按当前 (userId, agentId) 创建 MemoryAuditLog 实例。
 *
 * @param getUserId 返回当前 session 所属用户 ID（UUID v4）的 getter
 * @param getAgentId 返回当前 session 绑定的 agent slug 的 getter
 * @param dataDir 数据根目录
 * @param sessionId 触发写入的 session ID（记入审计）
 * @param memoryAuditLogFactory 审计日志工厂（按 (userId, slug) 创建实例），执行时调用
 */
export function createWriteAgentMemoryTool(
  getUserId: () => string,
  getAgentId: () => string,
  dataDir: string,
  sessionId: string,
  memoryAuditLogFactory: (userId: string, slug: string) => MemoryAuditLog,
): AgentTool<WriteAgentMemoryParams, WriteAgentMemoryDetails> {
  return {
    name: 'write_agent_memory',
    label: 'Write Agent Memory',
    description: `Write to the current agent's MEMORY.md (append or replace a section). Path is hardcoded to the current agent; cross-agent access is forbidden. Single write limit: ${MAX_WRITE_CONTENT_SIZE} bytes. Sections: User Profile / Facts / Preferences / History (Title Case headers).`,
    parameters: {
      type: 'object',
      properties: {
        section: {
          type: 'string',
          enum: ['user_profile', 'facts', 'preferences', 'history'],
          description: 'Target section to write (cannot be "all").',
        },
        content: {
          type: 'string',
          description: `Content to write (max ${MAX_WRITE_CONTENT_SIZE} bytes, UTF-8 byte length).`,
        },
        mode: {
          type: 'string',
          enum: ['append', 'replace'],
          description: 'append: add to end of section. replace: overwrite entire section content.',
        },
      },
      required: ['section', 'content', 'mode'],
    },
    executionMode: 'sequential',
    execute: async (
      _toolCallId: string,
      params: WriteAgentMemoryParams,
    ): Promise<AgentToolResult<WriteAgentMemoryDetails>> => {
      const { section, content, mode } = params;

      // §0.3.0 单次写入字节上限校验（UTF-8 byte length）
      const contentBytes = Buffer.byteLength(content, 'utf8');
      if (contentBytes > MAX_WRITE_CONTENT_SIZE) {
        return toolError(
          'content_too_large',
          `content size ${contentBytes} bytes exceeds max ${MAX_WRITE_CONTENT_SIZE}`,
          { section, mode, beforeSize: 0, afterSize: 0, audited: false },
        ) as AgentToolResult<WriteAgentMemoryDetails>;
      }

      // 执行时读取当前 userId / agentId，并校验路径遍历防护
      const userId = getUserId();
      const agentId = getAgentId();
      if (!USER_ID_REGEX.test(userId)) {
        return toolError('invalid_user_id', `invalid userId (path traversal guard): ${userId}`, {
          section,
          mode,
          beforeSize: 0,
          afterSize: 0,
          audited: false,
        }) as AgentToolResult<WriteAgentMemoryDetails>;
      }
      if (!AGENT_SLUG_REGEX.test(agentId)) {
        return toolError('invalid_agent_id', `invalid agentId (path traversal guard): ${agentId}`, {
          section,
          mode,
          beforeSize: 0,
          afterSize: 0,
          audited: false,
        }) as AgentToolResult<WriteAgentMemoryDetails>;
      }

      const memoryPath = join(dataDir, 'users', userId, 'agents', agentId, 'MEMORY.md');
      // §0.3.0 复用 AgentStorage 的 per-agentId mutex（lockKey = `${userId}/${agentId}`），
      // 与 AgentStorage.saveAgent 共享同一 Mutex 实例，保证并发写入串行化。
      const memoryLockKey = `${userId}/${agentId}`;
      // 按当前 (userId, agentId) 创建审计日志实例
      const memoryAuditLog = memoryAuditLogFactory(userId, agentId);

      let beforeSize = 0;
      let afterSize = 0;
      let audited = false;

      try {
        // §0.3.0 per-agent mutex 串行化 memory 写入 + 审计 append
        // 复用 AgentStorage.withAgentLock：与 saveAgent 共享同一 Mutex 实例
        await withAgentLock(memoryLockKey, async () => {
          beforeSize = existsSync(memoryPath) ? statSync(memoryPath).size : 0;

          let raw = '';
          if (existsSync(memoryPath)) {
            raw = readFileSync(memoryPath, 'utf8');
          }

          const next = applyWrite(raw, section, content, mode);

          // 自动创建多层目录
          const dir = dirname(memoryPath);
          if (!existsSync(dir)) {
            mkdirSync(dir, { recursive: true });
          }

          // 原子写：write-to-tmp + rename
          const tmpPath = `${memoryPath}.tmp`;
          writeFileSync(tmpPath, next, 'utf8');
          renameSync(tmpPath, memoryPath);

          afterSize = statSync(memoryPath).size;

          // §0.3.0 审计日志 append（嵌套在 memory-write 锁内保证顺序一致）
          // memory 写入已通过 rename 落盘，此处 append 失败不会回滚 memory。
          try {
            await memoryAuditLog.append({
              timestamp: new Date().toISOString(),
              sessionId,
              section,
              mode,
              contentPreview: content.slice(0, CONTENT_PREVIEW_MAX),
              contentLength: contentBytes,
              beforeSize,
              afterSize,
            });
            audited = true;
          } catch (auditErr) {
            const auditMsg = auditErr instanceof Error ? auditErr.message : String(auditErr);
            log.error(
              'audit log append failed (memory write already committed via atomic rename)',
              {
                path: memoryPath,
                sessionId,
                section,
                mode,
                beforeSize,
                afterSize,
                error: auditMsg,
              },
            );
            audited = false;
          }
        });
      } catch (err) {
        // memory 写入本身失败（lock 超时 / IO 错误）
        const msg = err instanceof Error ? err.message : String(err);
        log.error('write MEMORY.md failed', { path: memoryPath, error: msg });
        return toolError('write_error', msg, {
          section,
          mode,
          beforeSize,
          afterSize,
          audited: false,
        }) as AgentToolResult<WriteAgentMemoryDetails>;
      }

      // §0.3.0 审计失败但 memory 已提交 → 返回错误但报告 afterSize
      if (!audited) {
        return toolError(
          'audit_log_failed',
          `memory write committed (afterSize=${afterSize} bytes) but audit log append failed; memory mutation is NOT rolled back`,
          { section, mode, beforeSize, afterSize, audited: false },
        ) as AgentToolResult<WriteAgentMemoryDetails>;
      }

      return {
        content: [
          {
            type: 'text',
            text: `wrote ${contentBytes} bytes to section '${section}' (mode=${mode}); MEMORY.md size: ${beforeSize} → ${afterSize} bytes`,
          },
        ],
        details: { section, mode, beforeSize, afterSize, audited: true },
      };
    },
  };
}

/**
 * §0.3.0 Task 7 applyWrite: 对 MEMORY.md 文本应用一次写入，返回新文本。
 *
 * - raw 为空 → 构建 skeleton（4 个 Title Case section header）+ content
 * - raw 非空但 section header 缺失 → 在文件末尾追加 section header + content
 * - raw 非空且 section header 存在 → 按 mode 替换/追加 section 内容
 *
 * section header 必须使用 Title Case（复用 SECTION_HEADER_MAP），与 read_agent_memory 解析逻辑一致。
 */
function applyWrite(
  raw: string,
  section: MemoryAuditSection,
  content: string,
  mode: 'append' | 'replace',
): string {
  if (raw.trim() === '') {
    return buildSkeletonWithContent(section, content);
  }
  return applyWriteToExisting(raw, section, content, mode);
}

/** §0.3.0 buildSkeletonWithContent: 新建 MEMORY.md 时写入 4 个 section header skeleton */
function buildSkeletonWithContent(
  section: MemoryAuditSection,
  content: string,
): string {
  const body = content.replace(/\n+$/, '');
  const parts: string[] = ['# Memory', ''];
  for (const sec of SECTION_ORDER) {
    const header = SECTION_HEADER_MAP[sec];
    parts.push(`## ${header}`);
    if (sec === section) {
      parts.push('', body);
    }
    parts.push('');
  }
  return parts.join('\n');
}

/** §0.3.0 applyWriteToExisting: 在已有 MEMORY.md 文本上替换/追加 section 内容 */
function applyWriteToExisting(
  raw: string,
  section: MemoryAuditSection,
  content: string,
  mode: 'append' | 'replace',
): string {
  const header = SECTION_HEADER_MAP[section];
  const lines = raw.split('\n');

  // 定位目标 section header 行
  let headerIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].startsWith('## ') && lines[i].slice(3).trim() === header) {
      headerIdx = i;
      break;
    }
  }

  // section header 不存在 → 在文件末尾追加 header + content
  if (headerIdx === -1) {
    const normalized = raw.endsWith('\n') ? raw : `${raw}\n`;
    const body = content.replace(/\n+$/, '');
    return `${normalized}\n## ${header}\n\n${body}\n`;
  }

  // 定位下一个 ## header（或 EOF）
  let nextHeaderIdx = lines.length;
  for (let j = headerIdx + 1; j < lines.length; j++) {
    if (lines[j].startsWith('## ')) {
      nextHeaderIdx = j;
      break;
    }
  }

  // 提取现有 section body（去除首尾空行）
  const bodyLines = lines.slice(headerIdx + 1, nextHeaderIdx);
  let start = 0;
  while (start < bodyLines.length && bodyLines[start].trim() === '') start++;
  let end = bodyLines.length;
  while (end > start && bodyLines[end - 1].trim() === '') end--;
  const existingBody = bodyLines.slice(start, end).join('\n');

  const newContent = content.replace(/\n+$/, '');
  let newBody: string;
  if (mode === 'replace') {
    newBody = newContent;
  } else {
    newBody = existingBody.length > 0 ? `${existingBody}\n${newContent}` : newContent;
  }

  // 重建文件：header 之前 + header + 空行 + body + 空行 + 之后
  const before = lines.slice(0, headerIdx + 1);
  const after = lines.slice(nextHeaderIdx);

  const sectionParts: string[] = [...before];
  if (newBody.length > 0) {
    sectionParts.push('', newBody);
  }
  sectionParts.push('');

  const result = [...sectionParts, ...after];
  let joined = result.join('\n');
  // 折叠 3+ 连续换行为 2 个
  joined = joined.replace(/\n{3,}/g, '\n\n');
  // 确保单个尾部换行
  joined = joined.replace(/\n+$/, '\n');
  return joined;
}
