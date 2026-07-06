import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import {
  createWriteAgentMemoryTool,
  type WriteAgentMemoryParams,
  type WriteAgentMemoryDetails,
} from '../../../../src/core/tool/tools/write-agent-memory.js';
import {
  createReadAgentMemoryTool,
} from '../../../../src/core/tool/tools/read-agent-memory.js';
import {
  MemoryAuditLog,
  type MemoryAuditSection,
} from '../../../../src/core/agent/memory-audit-log.js';
import { MAX_WRITE_CONTENT_SIZE } from '../../../../src/core/agent/agent-profile.js';
import type { AgentTool, AgentToolResult } from '../../../../src/core/tool/types.js';

/**
 * §0.3.0 Task 7: write_agent_memory 工具
 *
 * 测试契约：
 * - name = write_agent_memory，sequential executionMode
 * - 参数：section / content / mode（全部 required），不接受 path
 * - 路径硬编码（构造时校验 userId + agentId）
 * - content > MAX_WRITE_CONTENT_SIZE (2048) → content_too_large，不写入
 * - append 模式：追加到 section 末尾
 * - replace 模式：替换整个 section 内容
 * - 新建 MEMORY.md 时写入 4 个 Title Case section header skeleton
 * - 跨任务契约：section header 使用 Title Case（## User Profile / ## Facts / ## Preferences / ## History）
 * - 审计日志记录：timestamp / sessionId / section / mode / contentPreview / contentLength / beforeSize / afterSize
 * - 审计日志失败 → 工具返回错误但 MEMORY.md 已写入
 * - 返回 afterSize 给 agent
 * - 并发写入串行化（per-agent mutex）
 * - read_agent_memory 可读回 write_agent_memory 写入的内容（跨任务契约）
 */

const VALID_USER_ID = '00000000-0000-4000-8000-000000000000';
const VALID_AGENT_ID = 'agent-abc123';
const SESSION_ID = 'sess-test-001';

let tmpDataDir: string;
let auditLog: MemoryAuditLog;

beforeEach(() => {
  tmpDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aptbot-write-mem-'));
  auditLog = new MemoryAuditLog(VALID_USER_ID, VALID_AGENT_ID, tmpDataDir);
});

afterEach(() => {
  fs.rmSync(tmpDataDir, { recursive: true, force: true });
});

function makeTool(
  userId: string = VALID_USER_ID,
  agentId: string = VALID_AGENT_ID,
): AgentTool<WriteAgentMemoryParams, WriteAgentMemoryDetails> {
  // §0.3.0 final-review: getter-based factory signature
  return createWriteAgentMemoryTool(
    () => userId,
    () => agentId,
    tmpDataDir,
    SESSION_ID,
    (uid, slug) => new MemoryAuditLog(uid, slug, tmpDataDir),
  );
}

function memoryPath(userId: string = VALID_USER_ID, agentId: string = VALID_AGENT_ID): string {
  return path.join(tmpDataDir, 'users', userId, 'agents', agentId, 'MEMORY.md');
}

function writeMemory(userId: string, agentId: string, content: string): void {
  const dir = path.join(tmpDataDir, 'users', userId, 'agents', agentId);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(memoryPath(userId, agentId), content, 'utf8');
}

describe('writeAgentMemoryTool', () => {
  describe('tool declaration', () => {
    it('declares name, label, description, parameters, sequential executionMode', () => {
      const tool = makeTool();
      expect(tool.name).toBe('write_agent_memory');
      expect(tool.label).toBeTruthy();
      expect(tool.description).toBeTruthy();
      expect(tool.parameters).toBeDefined();
      expect(tool.executionMode).toBe('sequential');
    });

    it('parameters schema requires section, content, mode', () => {
      const tool = makeTool();
      const props = tool.parameters.properties as Record<string, unknown>;
      expect(props).toHaveProperty('section');
      expect(props).toHaveProperty('content');
      expect(props).toHaveProperty('mode');
      const required = (tool.parameters as { required?: string[] }).required;
      expect(required).toEqual(
        expect.arrayContaining(['section', 'content', 'mode']),
      );
    });

    it('parameters schema does not expose path parameter', () => {
      const tool = makeTool();
      const props = tool.parameters.properties as Record<string, unknown>;
      expect(props).not.toHaveProperty('path');
    });

    it('section enum excludes "all"', () => {
      const tool = makeTool();
      const props = tool.parameters.properties as Record<string, { enum?: string[] }>;
      expect(props.section.enum).toEqual(
        expect.arrayContaining(['user_profile', 'facts', 'preferences', 'history']),
      );
      expect(props.section.enum).not.toContain('all');
    });
  });

  describe('construction path traversal guard', () => {
    // §0.3.0 final-review: guard 移到执行时（getter 模式），返回 error 而非 throw
    it('returns invalid_user_id error at execution when userId fails guard', async () => {
      const tool = makeTool('../etc', VALID_AGENT_ID);
      const result = await tool.execute('tc', {
        section: 'facts',
        content: 'x',
        mode: 'append',
      });
      expect(result.error?.code).toBe('invalid_user_id');
      expect(result.error?.message).toMatch(/userId/);
    });

    it('returns invalid_agent_id error at execution when agentId fails guard', async () => {
      const tool = makeTool(VALID_USER_ID, '../etc');
      const result = await tool.execute('tc', {
        section: 'facts',
        content: 'x',
        mode: 'append',
      });
      expect(result.error?.code).toBe('invalid_agent_id');
      expect(result.error?.message).toMatch(/agentId/);
    });
  });

  describe('content size limit', () => {
    it('rejects content > MAX_WRITE_CONTENT_SIZE with content_too_large (no write)', async () => {
      const tool = makeTool();
      const oversized = 'x'.repeat(MAX_WRITE_CONTENT_SIZE + 1);
      const result = await tool.execute('tc', {
        section: 'facts',
        content: oversized,
        mode: 'append',
      });
      expect(result.error?.code).toBe('content_too_large');
      // MEMORY.md 不应被创建
      expect(fs.existsSync(memoryPath())).toBe(false);
    });

    it('accepts content exactly at MAX_WRITE_CONTENT_SIZE', async () => {
      const tool = makeTool();
      const content = 'x'.repeat(MAX_WRITE_CONTENT_SIZE);
      const result = await tool.execute('tc', {
        section: 'facts',
        content,
        mode: 'replace',
      });
      expect(result.error).toBeUndefined();
      expect(fs.existsSync(memoryPath())).toBe(true);
    });

    it('byte-length based limit (multi-byte chars count as >1 byte)', async () => {
      const tool = makeTool();
      // 中文字符每字 3 字节；MAX_WRITE_CONTENT_SIZE/3 + 1 个字 → 超限
      const chars = Math.floor(MAX_WRITE_CONTENT_SIZE / 3) + 1;
      const content = '你'.repeat(chars);
      const result = await tool.execute('tc', {
        section: 'facts',
        content,
        mode: 'append',
      });
      expect(result.error?.code).toBe('content_too_large');
      expect(fs.existsSync(memoryPath())).toBe(false);
    });
  });

  describe('new MEMORY.md skeleton creation', () => {
    it('creates MEMORY.md with all 4 Title Case section headers when file does not exist', async () => {
      const tool = makeTool();
      await tool.execute('tc', { section: 'facts', content: 'hello', mode: 'append' });
      const raw = fs.readFileSync(memoryPath(), 'utf8');
      expect(raw).toContain('# Memory');
      expect(raw).toContain('## User Profile');
      expect(raw).toContain('## Facts');
      expect(raw).toContain('## Preferences');
      expect(raw).toContain('## History');
    });

    it('places content under the target section header', async () => {
      const tool = makeTool();
      await tool.execute('tc', { section: 'preferences', content: 'use dark theme', mode: 'append' });
      const raw = fs.readFileSync(memoryPath(), 'utf8');
      // content 应在 ## Preferences 之后、## History 之前
      const prefIdx = raw.indexOf('## Preferences');
      const histIdx = raw.indexOf('## History');
      const contentIdx = raw.indexOf('use dark theme');
      expect(prefIdx).toBeLessThan(contentIdx);
      expect(contentIdx).toBeLessThan(histIdx);
    });
  });

  describe('append mode', () => {
    it('appends content to the end of an existing section', async () => {
      const initial = `# Memory

## User Profile

## Facts

- likes cats

## Preferences

## History
`;
      writeMemory(VALID_USER_ID, VALID_AGENT_ID, initial);

      const tool = makeTool();
      await tool.execute('tc', { section: 'facts', content: '- likes dogs too', mode: 'append' });

      const raw = fs.readFileSync(memoryPath(), 'utf8');
      expect(raw).toContain('- likes cats');
      expect(raw).toContain('- likes dogs too');
      // ordering: cats before dogs
      expect(raw.indexOf('- likes cats')).toBeLessThan(raw.indexOf('- likes dogs too'));
    });

    it('appends to the last section (no subsequent header, before EOF)', async () => {
      const initial = `# Memory

## User Profile

## Facts

## Preferences

## History

- started task 7
`;
      writeMemory(VALID_USER_ID, VALID_AGENT_ID, initial);

      const tool = makeTool();
      await tool.execute('tc', { section: 'history', content: '- finished task 7', mode: 'append' });

      const raw = fs.readFileSync(memoryPath(), 'utf8');
      expect(raw).toContain('- started task 7');
      expect(raw).toContain('- finished task 7');
      expect(raw.indexOf('- started task 7')).toBeLessThan(raw.indexOf('- finished task 7'));
    });

    it('multiple appends accumulate within the section', async () => {
      const tool = makeTool();
      await tool.execute('tc1', { section: 'facts', content: 'first', mode: 'append' });
      await tool.execute('tc2', { section: 'facts', content: 'second', mode: 'append' });
      await tool.execute('tc3', { section: 'facts', content: 'third', mode: 'append' });

      const raw = fs.readFileSync(memoryPath(), 'utf8');
      const idx1 = raw.indexOf('first');
      const idx2 = raw.indexOf('second');
      const idx3 = raw.indexOf('third');
      expect(idx1).toBeLessThan(idx2);
      expect(idx2).toBeLessThan(idx3);
    });
  });

  describe('replace mode', () => {
    it('replaces entire section content, leaving other sections intact', async () => {
      const initial = `# Memory

## User Profile

- name: Alice

## Facts

- old fact 1
- old fact 2

## Preferences

## History
`;
      writeMemory(VALID_USER_ID, VALID_AGENT_ID, initial);

      const tool = makeTool();
      await tool.execute('tc', { section: 'facts', content: '- new fact', mode: 'replace' });

      const raw = fs.readFileSync(memoryPath(), 'utf8');
      expect(raw).not.toContain('old fact 1');
      expect(raw).not.toContain('old fact 2');
      expect(raw).toContain('- new fact');
      // other sections preserved
      expect(raw).toContain('- name: Alice');
      expect(raw).toContain('## User Profile');
      expect(raw).toContain('## Preferences');
      expect(raw).toContain('## History');
    });

    it('replace on empty section writes the new content', async () => {
      const initial = `# Memory

## User Profile

## Facts

## Preferences

## History
`;
      writeMemory(VALID_USER_ID, VALID_AGENT_ID, initial);

      const tool = makeTool();
      await tool.execute('tc', { section: 'preferences', content: '- prefers terse answers', mode: 'replace' });

      const raw = fs.readFileSync(memoryPath(), 'utf8');
      expect(raw).toContain('- prefers terse answers');
    });
  });

  describe('cross-task contract with read_agent_memory', () => {
    it('write_agent_memory writes Title Case headers readable by read_agent_memory', async () => {
      const tool = makeTool();
      await tool.execute('tc', { section: 'facts', content: '- hello from writer', mode: 'append' });

      const reader = createReadAgentMemoryTool(() => VALID_USER_ID, () => VALID_AGENT_ID, tmpDataDir);
      const result = await reader.execute('tc', { section: 'facts' });
      expect(result.error).toBeUndefined();
      const text = (result.content[0] as { text: string }).text;
      expect(text).toContain('- hello from writer');
      // other sections should be filtered out
      expect(text).not.toContain('## User Profile');
      expect(text).not.toContain('## Preferences');
    });

    it('read_agent_memory reads back appended content to each section', async () => {
      const tool = makeTool();
      await tool.execute('a', { section: 'user_profile', content: '- name: Bob', mode: 'append' });
      await tool.execute('b', { section: 'facts', content: '- is a dev', mode: 'append' });
      await tool.execute('c', { section: 'preferences', content: '- dark mode', mode: 'append' });
      await tool.execute('d', { section: 'history', content: '- task 7 done', mode: 'append' });

      const reader = createReadAgentMemoryTool(() => VALID_USER_ID, () => VALID_AGENT_ID, tmpDataDir);
      const up = await reader.execute('1', { section: 'user_profile' });
      const f = await reader.execute('2', { section: 'facts' });
      const p = await reader.execute('3', { section: 'preferences' });
      const h = await reader.execute('4', { section: 'history' });

      expect((up.content[0] as { text: string }).text).toContain('Bob');
      expect((f.content[0] as { text: string }).text).toContain('is a dev');
      expect((p.content[0] as { text: string }).text).toContain('dark mode');
      expect((h.content[0] as { text: string }).text).toContain('task 7 done');
    });
  });

  describe('hardcoded path — no cross-agent access', () => {
    it('does not expose path parameter and ignores injected path', async () => {
      const tool = makeTool();
      const params = (tool as AgentTool<unknown>).parameters as { properties: Record<string, unknown> };
      expect(params.properties).not.toHaveProperty('path');
      // inject path param (should be ignored)
      const result = await tool.execute('tc', {
        section: 'facts',
        content: 'x',
        mode: 'append',
        ...({ path: '/etc/passwd' } as object),
      } as WriteAgentMemoryParams);
      expect(result.error).toBeUndefined();
      // only the hardcoded MEMORY.md is written
      expect(fs.existsSync(memoryPath())).toBe(true);
    });

    it('different agentIds write to their own MEMORY.md', async () => {
      const toolA = createWriteAgentMemoryTool(
        () => VALID_USER_ID,
        () => 'agent-aaa111',
        tmpDataDir,
        SESSION_ID,
        (uid, slug) => new MemoryAuditLog(uid, slug, tmpDataDir),
      );
      const toolB = createWriteAgentMemoryTool(
        () => VALID_USER_ID,
        () => 'agent-bbb222',
        tmpDataDir,
        SESSION_ID,
        (uid, slug) => new MemoryAuditLog(uid, slug, tmpDataDir),
      );
      await toolA.execute('a', { section: 'facts', content: 'A content', mode: 'append' });
      await toolB.execute('b', { section: 'facts', content: 'B content', mode: 'append' });

      const rawA = fs.readFileSync(memoryPath(VALID_USER_ID, 'agent-aaa111'), 'utf8');
      const rawB = fs.readFileSync(memoryPath(VALID_USER_ID, 'agent-bbb222'), 'utf8');
      expect(rawA).toContain('A content');
      expect(rawA).not.toContain('B content');
      expect(rawB).toContain('B content');
      expect(rawB).not.toContain('A content');
    });
  });

  describe('result details (beforeSize / afterSize)', () => {
    it('returns beforeSize=0 and afterSize>0 for new file', async () => {
      const tool = makeTool();
      const result = await tool.execute('tc', { section: 'facts', content: 'hello', mode: 'append' });
      expect(result.error).toBeUndefined();
      expect(result.details.beforeSize).toBe(0);
      expect(result.details.afterSize).toBeGreaterThan(0);
      expect(result.details.afterSize).toBe(fs.statSync(memoryPath()).size);
    });

    it('returns beforeSize = existing file size and afterSize = new file size', async () => {
      const initial = `# Memory

## Facts

old

`;
      writeMemory(VALID_USER_ID, VALID_AGENT_ID, initial);
      const before = fs.statSync(memoryPath()).size;

      const tool = makeTool();
      const result = await tool.execute('tc', { section: 'facts', content: 'new line here', mode: 'append' });
      expect(result.error).toBeUndefined();
      expect(result.details.beforeSize).toBe(before);
      expect(result.details.afterSize).toBe(fs.statSync(memoryPath()).size);
    });

    it('returns section and mode in details', async () => {
      const tool = makeTool();
      const result = await tool.execute('tc', { section: 'preferences', content: 'x', mode: 'replace' });
      expect(result.details.section).toBe('preferences');
      expect(result.details.mode).toBe('replace');
    });
  });

  describe('audit log', () => {
    it('appends an AuditRecord after a successful write', async () => {
      const tool = makeTool();
      await tool.execute('tc', { section: 'facts', content: 'audit me', mode: 'append' });

      const records = await auditLog.list();
      expect(records.length).toBe(1);
      const rec = records[0];
      expect(rec.sessionId).toBe(SESSION_ID);
      expect(rec.section).toBe('facts');
      expect(rec.mode).toBe('append');
      expect(rec.contentPreview).toBe('audit me');
      expect(rec.contentLength).toBe(Buffer.byteLength('audit me', 'utf8'));
      expect(rec.beforeSize).toBe(0);
      expect(rec.afterSize).toBeGreaterThan(0);
      expect(rec.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    });

    it('contentPreview is truncated to 200 chars', async () => {
      const tool = makeTool();
      const content = 'y'.repeat(300);
      await tool.execute('tc', { section: 'facts', content, mode: 'replace' });

      const records = await auditLog.list();
      expect(records.length).toBe(1);
      expect(records[0].contentPreview.length).toBe(200);
      expect(records[0].contentLength).toBe(300);
    });

    it('contentLength is byte length (not char length) for multi-byte content', async () => {
      const tool = makeTool();
      const content = '你好'; // 6 bytes
      await tool.execute('tc', { section: 'facts', content, mode: 'append' });

      const records = await auditLog.list();
      expect(records[0].contentLength).toBe(6);
      expect(records[0].contentPreview).toBe('你好');
    });

    it('records multiple writes in order (most recent first)', async () => {
      const tool = makeTool();
      await tool.execute('a', { section: 'facts', content: 'first', mode: 'append' });
      await tool.execute('b', { section: 'facts', content: 'second', mode: 'append' });
      await tool.execute('c', { section: 'preferences', content: 'third', mode: 'replace' });

      const records = await auditLog.list();
      expect(records.length).toBe(3);
      expect(records[0].contentPreview).toBe('third');
      expect(records[1].contentPreview).toBe('second');
      expect(records[2].contentPreview).toBe('first');
    });

    it('audit log failure returns error but memory write is committed', async () => {
      // Failing audit log: stub append to throw
      const failingAudit = {
        append: async () => {
          throw new Error('disk full');
        },
        list: async () => [],
      } as unknown as MemoryAuditLog;
      // §0.3.0 final-review: 工厂签名改为 factory，返回 failing 实例
      const tool = createWriteAgentMemoryTool(
        () => VALID_USER_ID,
        () => VALID_AGENT_ID,
        tmpDataDir,
        SESSION_ID,
        () => failingAudit,
      );

      const result = await tool.execute('tc', { section: 'facts', content: 'persisted', mode: 'append' });

      // audit failed → tool returns error
      expect(result.error).toBeDefined();
      expect(result.error?.code).toBe('audit_log_failed');
      // but MEMORY.md was already written (atomic rename committed)
      expect(fs.existsSync(memoryPath())).toBe(true);
      const raw = fs.readFileSync(memoryPath(), 'utf8');
      expect(raw).toContain('persisted');
      // details still report the committed write
      expect(result.details.afterSize).toBeGreaterThan(0);
      expect(result.details.audited).toBe(false);
    });
  });

  describe('concurrent writes serialized (per-agent mutex)', () => {
    it('50 concurrent appends produce 50 lines in MEMORY.md and 50 audit records', async () => {
      const tool = makeTool();
      const N = 50;
      const tasks = Array.from({ length: N }, (_, i) =>
        tool.execute(`tc${i}`, { section: 'facts', content: `line-${i}`, mode: 'append' }),
      );
      const results = await Promise.all(tasks);

      // all succeed (no errors)
      for (const r of results) {
        expect(r.error).toBeUndefined();
      }
      const raw = fs.readFileSync(memoryPath(), 'utf8');
      for (let i = 0; i < N; i++) {
        expect(raw).toContain(`line-${i}`);
      }
      const auditRecords = await auditLog.list(100);
      expect(auditRecords.length).toBe(N);
    });
  });

  describe('atomic write — no residual tmp file', () => {
    it('does not leave a .tmp file after successful write', async () => {
      const tool = makeTool();
      await tool.execute('tc', { section: 'facts', content: 'clean', mode: 'append' });
      expect(fs.existsSync(`${memoryPath()}.tmp`)).toBe(false);
    });
  });
});
