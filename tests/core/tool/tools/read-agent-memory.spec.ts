import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import {
  createReadAgentMemoryTool,
  type ReadAgentMemoryParams,
} from '../../../../src/core/tool/tools/read-agent-memory.js';
import { MAX_MEMORY_SIZE } from '../../../../src/core/agent/agent-profile.js';
import type { AgentTool } from '../../../../src/core/tool/types.js';

const VALID_USER_ID = '00000000-0000-4000-8000-000000000000';
const VALID_AGENT_ID = 'agent-abc123';

const SAMPLE_MEMORY = `# Agent Memory

## User Profile
- Name: Alice
- Timezone: UTC

## Facts
- Prefers concise answers
- Working on TypeScript project

## Preferences
- Use Chinese for code comments

## History
- 2026-07-01: started aptbot 0.3.0
- 2026-07-06: completed Task 6
`;

let tmpDataDir: string;

beforeEach(() => {
  tmpDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aptbot-mem-'));
});

afterEach(() => {
  fs.rmSync(tmpDataDir, { recursive: true, force: true });
});

/** 在 agent 目录下写入 MEMORY.md（自动创建目录） */
function writeMemory(userId: string, agentId: string, content: string): string {
  const dir = path.join(tmpDataDir, 'users', userId, 'agents', agentId);
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'MEMORY.md');
  fs.writeFileSync(file, content, 'utf8');
  return file;
}

describe('readAgentMemoryTool', () => {
  it('declares name, label, description, parameters, parallel executionMode', () => {
    const tool = createReadAgentMemoryTool(() => VALID_USER_ID, () => VALID_AGENT_ID, tmpDataDir);
    expect(tool.name).toBe('read_agent_memory');
    expect(tool.label).toBeTruthy();
    expect(tool.description).toBeTruthy();
    expect(tool.parameters).toBeDefined();
    expect(tool.executionMode).toBe('parallel');
  });

  it('parameters schema only exposes optional section (no path param)', () => {
    const tool = createReadAgentMemoryTool(() => VALID_USER_ID, () => VALID_AGENT_ID, tmpDataDir);
    const props = tool.parameters.properties as Record<string, unknown>;
    expect(props).toHaveProperty('section');
    expect(props).not.toHaveProperty('path');
    const required = (tool.parameters as { required?: string[] }).required;
    // section 可选 → required 应为空或不存在
    expect(required ?? []).toEqual([]);
  });

  it('reads existing MEMORY.md and returns full content when section=all', async () => {
    writeMemory(VALID_USER_ID, VALID_AGENT_ID, SAMPLE_MEMORY);
    const tool = createReadAgentMemoryTool(() => VALID_USER_ID, () => VALID_AGENT_ID, tmpDataDir);
    const result = await tool.execute('tc_1', { section: 'all' });
    expect(result.error).toBeUndefined();
    expect(result.content[0]).toMatchObject({ type: 'text' });
    const text = (result.content[0] as { text: string }).text;
    expect(text).toContain('# Agent Memory');
    expect(text).toContain('## User Profile');
    expect(text).toContain('## Facts');
    expect(text).toContain('## Preferences');
    expect(text).toContain('## History');
    expect(text).toContain('Alice');
    expect(result.details.bytes).toBe(Buffer.byteLength(SAMPLE_MEMORY, 'utf8'));
    expect(result.details.section).toBe('all');
    expect(result.details.exists).toBe(true);
  });

  it('defaults to section=all when section omitted', async () => {
    writeMemory(VALID_USER_ID, VALID_AGENT_ID, SAMPLE_MEMORY);
    const tool = createReadAgentMemoryTool(() => VALID_USER_ID, () => VALID_AGENT_ID, tmpDataDir);
    const result = await tool.execute('tc_2', {});
    expect(result.error).toBeUndefined();
    expect(result.details.section).toBe('all');
    const text = (result.content[0] as { text: string }).text;
    expect(text).toContain('## Facts');
  });

  it('returns empty content (not error) when MEMORY.md does not exist', async () => {
    const tool = createReadAgentMemoryTool(() => VALID_USER_ID, () => VALID_AGENT_ID, tmpDataDir);
    const result = await tool.execute('tc_3', {});
    expect(result.error).toBeUndefined();
    expect(result.content[0]).toMatchObject({ type: 'text' });
    expect((result.content[0] as { text: string }).text).toBe('');
    expect(result.details.exists).toBe(false);
    expect(result.details.bytes).toBe(0);
    expect(result.details.section).toBe('all');
  });

  it('returns memory_too_large error when file > MAX_MEMORY_SIZE', async () => {
    // 构造 >8KB 文件
    const big = '# Agent Memory\n\n## Facts\n- ' + 'x'.repeat(MAX_MEMORY_SIZE + 100) + '\n';
    writeMemory(VALID_USER_ID, VALID_AGENT_ID, big);
    const tool = createReadAgentMemoryTool(() => VALID_USER_ID, () => VALID_AGENT_ID, tmpDataDir);
    const result = await tool.execute('tc_4', { section: 'all' });
    expect(result.error?.code).toBe('memory_too_large');
    expect(result.error?.message).toMatch(/section/);
    expect(result.details.exists).toBe(true);
    expect(result.details.bytes).toBeGreaterThan(MAX_MEMORY_SIZE);
  });

  it('filters to User Profile section only', async () => {
    writeMemory(VALID_USER_ID, VALID_AGENT_ID, SAMPLE_MEMORY);
    const tool = createReadAgentMemoryTool(() => VALID_USER_ID, () => VALID_AGENT_ID, tmpDataDir);
    const result = await tool.execute('tc_5', { section: 'user_profile' });
    expect(result.error).toBeUndefined();
    const text = (result.content[0] as { text: string }).text;
    expect(text).toContain('Alice');
    expect(text).not.toContain('## Facts');
    expect(text).not.toContain('## Preferences');
    expect(text).not.toContain('## History');
    expect(text).not.toContain('TypeScript project');
    expect(result.details.section).toBe('user_profile');
  });

  it('filters to Facts section only', async () => {
    writeMemory(VALID_USER_ID, VALID_AGENT_ID, SAMPLE_MEMORY);
    const tool = createReadAgentMemoryTool(() => VALID_USER_ID, () => VALID_AGENT_ID, tmpDataDir);
    const result = await tool.execute('tc_6', { section: 'facts' });
    const text = (result.content[0] as { text: string }).text;
    expect(text).toContain('TypeScript project');
    expect(text).not.toContain('Alice');
    expect(text).not.toContain('Use Chinese');
    expect(result.details.section).toBe('facts');
  });

  it('filters to Preferences section only', async () => {
    writeMemory(VALID_USER_ID, VALID_AGENT_ID, SAMPLE_MEMORY);
    const tool = createReadAgentMemoryTool(() => VALID_USER_ID, () => VALID_AGENT_ID, tmpDataDir);
    const result = await tool.execute('tc_7', { section: 'preferences' });
    const text = (result.content[0] as { text: string }).text;
    expect(text).toContain('Use Chinese');
    expect(text).not.toContain('Alice');
    expect(text).not.toContain('TypeScript project');
    expect(result.details.section).toBe('preferences');
  });

  it('filters to History section only', async () => {
    writeMemory(VALID_USER_ID, VALID_AGENT_ID, SAMPLE_MEMORY);
    const tool = createReadAgentMemoryTool(() => VALID_USER_ID, () => VALID_AGENT_ID, tmpDataDir);
    const result = await tool.execute('tc_8', { section: 'history' });
    const text = (result.content[0] as { text: string }).text;
    expect(text).toContain('Task 6');
    expect(text).not.toContain('Alice');
    expect(text).not.toContain('## Facts');
    expect(result.details.section).toBe('history');
  });

  it('returns empty content when section not found in MEMORY.md', async () => {
    const content = '# Agent Memory\n\n## Facts\n- only facts\n';
    writeMemory(VALID_USER_ID, VALID_AGENT_ID, content);
    const tool = createReadAgentMemoryTool(() => VALID_USER_ID, () => VALID_AGENT_ID, tmpDataDir);
    const result = await tool.execute('tc_9', { section: 'preferences' });
    expect(result.error).toBeUndefined();
    const text = (result.content[0] as { text: string }).text;
    expect(text).toBe('');
    expect(result.details.section).toBe('preferences');
    expect(result.details.exists).toBe(true);
  });

  it('hardcodes path — does not accept path parameter', async () => {
    writeMemory(VALID_USER_ID, VALID_AGENT_ID, SAMPLE_MEMORY);
    // 即使 caller 试图传 path，也被忽略；只读取硬编码路径
    const tool = createReadAgentMemoryTool(() => VALID_USER_ID, () => VALID_AGENT_ID, tmpDataDir);
    const malicious = (tool as AgentTool<unknown>).parameters as { properties: Record<string, unknown> };
    expect(malicious.properties).not.toHaveProperty('path');
    const result = await tool.execute('tc_10', {
      section: 'all',
      // 模拟 LLM 试图注入 path（应被忽略）
      ...({ path: '/etc/passwd' } as object),
    } as ReadAgentMemoryParams);
    expect(result.error).toBeUndefined();
    // 仍读取硬编码路径下的内容
    expect((result.content[0] as { text: string }).text).toContain('Alice');
  });

  it('prevents cross-agent access — different agentId reads its own MEMORY.md', async () => {
    writeMemory(VALID_USER_ID, 'agent-aaa111', '# Agent Memory\n\n## Facts\n- agent A\n');
    writeMemory(VALID_USER_ID, 'agent-bbb222', '# Agent Memory\n\n## Facts\n- agent B\n');
    const toolA = createReadAgentMemoryTool(() => VALID_USER_ID, () => 'agent-aaa111', tmpDataDir);
    const toolB = createReadAgentMemoryTool(() => VALID_USER_ID, () => 'agent-bbb222', tmpDataDir);
    const ra = await toolA.execute('tc_11a', { section: 'all' });
    const rb = await toolB.execute('tc_11b', { section: 'all' });
    expect((ra.content[0] as { text: string }).text).toContain('agent A');
    expect((rb.content[0] as { text: string }).text).toContain('agent B');
    expect((ra.content[0] as { text: string }).text).not.toContain('agent B');
  });

  it('returns invalid_user_id error at execution when userId fails path traversal guard', async () => {
    const tool = createReadAgentMemoryTool(() => '../etc', () => VALID_AGENT_ID, tmpDataDir);
    const result = await tool.execute('tc', {});
    expect(result.error?.code).toBe('invalid_user_id');
    expect(result.error?.message).toMatch(/userId/);
  });

  it('returns invalid_agent_id error at execution when agentId fails path traversal guard', async () => {
    const tool = createReadAgentMemoryTool(() => VALID_USER_ID, () => '../etc', tmpDataDir);
    const result = await tool.execute('tc', {});
    expect(result.error?.code).toBe('invalid_agent_id');
    expect(result.error?.message).toMatch(/agentId/);
  });

  it('exposes MAX_MEMORY_SIZE = 8192', () => {
    expect(MAX_MEMORY_SIZE).toBe(8192);
  });

  // §0.3.0 final-review: getter 模式 — 工具执行时读取最新上下文，非构造时
  it('getter-based: reads latest userId/agentId at execution time (not construction time)', async () => {
    // 为两个不同 agent 各写一份 MEMORY.md
    writeMemory(VALID_USER_ID, 'agent-aaa111', '# Agent Memory\n\n## Facts\n- agent A\n');
    writeMemory(VALID_USER_ID, 'agent-bbb222', '# Agent Memory\n\n## Facts\n- agent B\n');

    // 构造时可变上下文指向 agent-aaa111
    const ctx = { userId: VALID_USER_ID, agentId: 'agent-aaa111' as string };
    const tool = createReadAgentMemoryTool(
      () => ctx.userId,
      () => ctx.agentId,
      tmpDataDir,
    );

    // 第一次执行：读取 agent A 的 MEMORY.md
    const ra = await tool.execute('tc_12a', { section: 'all' });
    expect((ra.content[0] as { text: string }).text).toContain('agent A');

    // 切换上下文到 agent-bbb222（无需重建工具 / registry）
    ctx.agentId = 'agent-bbb222';
    const rb = await tool.execute('tc_12b', { section: 'all' });
    expect((rb.content[0] as { text: string }).text).toContain('agent B');
  });
});
