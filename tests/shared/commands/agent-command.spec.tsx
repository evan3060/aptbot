import { describe, it, expect, vi } from 'vitest';
import { createCommandRegistry, type CommandContext } from '../../../src/shared/commands/registry.js';
import type { StorageAdapter } from '../../../src/infrastructure/storage/file-storage.js';
import type { AgentStorage } from '../../../src/core/agent/agent-storage.js';
import type { AgentProfile } from '../../../src/core/agent/agent-profile.js';
import type { MemoryAuditLog, AuditRecord } from '../../../src/core/agent/memory-audit-log.js';
import { DEFAULT_AGENT_SLUG } from '../../../src/core/agent/agent-migration.js';

/**
 * Task 12: /agent CLI 命令测试
 *
 * 覆盖 9 项场景：
 *   - 注册到 CommandRegistry
 *   - /agent 列出所有 agents（标记 current）
 *   - /agent <slug> 切换 agent（返回 action=switch_agent）
 *   - /agent info 显示当前 agent 的 personality
 *   - /agent info 默认 agent 提示无 personality
 *   - /agent memory-log 列出最近 N 条审计日志
 *   - /agent memory-log [limit] 自定义 limit
 *   - /agent <unknown-slug> 返回错误 + 列出可用 agents
 *   - /agent 无 agentStorage 提示未启用
 */

function makeMockStorage(): StorageAdapter {
  return {
    readSession: vi.fn(async () => []),
    appendSession: vi.fn(async () => {}),
    listSessions: vi.fn(async () => []),
    readWorkingMemory: vi.fn(async () => null),
    writeWorkingMemory: vi.fn(async () => {}),
    deleteSession: vi.fn(async () => {}),
  } as unknown as StorageAdapter;
}

function makeAgentProfile(overrides: Partial<AgentProfile> = {}): AgentProfile {
  return {
    name: 'Test Agent',
    description: 'A test agent',
    userId: '11111111-2222-3333-4444-555555555555',
    type: 'default',
    slug: 'agent-test1',
    createdAt: 1000,
    updatedAt: 2000,
    personality: 'You are a test agent.',
    ...overrides,
  };
}

/**
 * In-memory AgentStorage mock — listAgents / getAgent 透传到内部 Map。
 */
function makeMockAgentStorage(initial: AgentProfile[] = []): AgentStorage & {
  agents: Map<string, AgentProfile>;
  listCalls: number;
  getCalls: Array<{ userId: string; slug: string }>;
} {
  const agents = new Map<string, AgentProfile>();
  for (const a of initial) agents.set(a.slug, a);
  let listCalls = 0;
  const getCalls: Array<{ userId: string; slug: string }> = [];
  const mock = {
    agents,
    listCalls,
    getCalls,
    async listAgents(userId: string): Promise<AgentProfile[]> {
      mock.listCalls++;
      return Array.from(agents.values());
    },
    async getAgent(userId: string, slug: string): Promise<AgentProfile | null> {
      mock.getCalls.push({ userId, slug });
      return agents.get(slug) ?? null;
    },
    async saveAgent(_profile: AgentProfile): Promise<void> {},
    async deleteAgent(_userId: string, _slug: string): Promise<void> {},
    async exists(_userId: string, _slug: string): Promise<boolean> {
      return agents.has(_slug);
    },
    async countAgents(_userId: string): Promise<number> {
      return agents.size;
    },
    async findAgentOwner(_slug: string): Promise<string | null> {
      return null;
    },
    getAgentDir(_userId: string, _slug: string): string {
      return `/tmp/mock/${_userId}/${_slug}`;
    },
  };
  return mock as unknown as AgentStorage & {
    agents: Map<string, AgentProfile>;
    listCalls: number;
    getCalls: Array<{ userId: string; slug: string }>;
  };
}

function makeAuditRecord(overrides: Partial<AuditRecord> = {}): AuditRecord {
  return {
    timestamp: '2026-07-06T10:00:00.000Z',
    sessionId: 'session-1',
    section: 'user_profile',
    mode: 'append',
    contentPreview: 'user prefers dark mode',
    contentLength: 22,
    beforeSize: 0,
    afterSize: 22,
    ...overrides,
  };
}

/**
 * In-memory MemoryAuditLog mock — list 返回预设记录。
 */
function makeMockMemoryAuditLog(records: AuditRecord[] = []): MemoryAuditLog & {
  listCalls: Array<{ limit: number }>;
} {
  const listCalls: Array<{ limit: number }> = [];
  const mock = {
    listCalls,
    async append(_record: AuditRecord): Promise<void> {},
    async list(limit: number = 20): Promise<AuditRecord[]> {
      mock.listCalls.push({ limit });
      return records.slice(0, limit);
    },
  };
  return mock as unknown as MemoryAuditLog & {
    listCalls: Array<{ limit: number }>;
  };
}

const TEST_USER_ID = '11111111-2222-3333-4444-555555555555';

function makeCtx(overrides: Partial<CommandContext> = {}): CommandContext {
  return {
    sessionId: 'session-test',
    model: 'mock-1',
    storage: makeMockStorage(),
    userId: TEST_USER_ID,
    ...overrides,
  };
}

async function exec(
  reg: ReturnType<typeof createCommandRegistry>,
  input: string,
  ctx: CommandContext,
) {
  const resolved = reg.resolve(input);
  if (!resolved) throw new Error(`command not resolved: ${input}`);
  return resolved.command.execute(resolved.args, ctx);
}

describe('/agent command', () => {
  it('is registered in CommandRegistry', () => {
    const reg = createCommandRegistry();
    expect(reg.has('agent')).toBe(true);
    const resolved = reg.resolve('/agent');
    expect(resolved).not.toBeNull();
    expect(resolved!.command.name).toBe('agent');
  });

  it('/agent (no args) lists all agents with (current) prefix on active one', async () => {
    const reg = createCommandRegistry();
    const agentStorage = makeMockAgentStorage([
      makeAgentProfile({ name: 'Default Helper', slug: DEFAULT_AGENT_SLUG, type: 'default' }),
      makeAgentProfile({ name: 'Coder', slug: 'agent-coder', type: 'professional' }),
      makeAgentProfile({ name: 'Writer', slug: 'agent-writer', type: 'professional' }),
    ]);
    const result = await exec(reg, '/agent', makeCtx({
      agentStorage,
      currentAgentSlug: 'agent-coder',
    }));
    expect(result.output).toBeDefined();
    expect(result.output).toContain('Coder');
    expect(result.output).toContain('agent-coder');
    expect(result.output).toContain('Writer');
    expect(result.output).toContain('agent-writer');
    expect(result.output).toContain('Default Helper');
    // (current) 标记仅出现在当前 slug
    const currentLine = (result.output as string).split('\n').find((l) => l.includes('(current)'));
    expect(currentLine).toBeDefined();
    expect(currentLine).toContain('Coder');
    expect(currentLine).toContain('agent-coder');
  });

  it('/agent (no args) shows empty-state message when no agents exist', async () => {
    const reg = createCommandRegistry();
    const agentStorage = makeMockAgentStorage([]);
    const result = await exec(reg, '/agent', makeCtx({ agentStorage }));
    expect(result.output).toMatch(/no agents|empty/i);
  });

  it('/agent <slug> switches to the specified agent (action=switch_agent + agentSlug)', async () => {
    const reg = createCommandRegistry();
    const agentStorage = makeMockAgentStorage([
      makeAgentProfile({ name: 'Coder', slug: 'agent-coder', type: 'professional' }),
    ]);
    const result = await exec(reg, '/agent agent-coder', makeCtx({ agentStorage }));
    expect(result.action).toBe('switch_agent');
    expect(result.agentSlug).toBe('agent-coder');
    expect(result.output).toContain('agent-coder');
    expect(result.output).toMatch(/switch/i);
  });

  it('/agent <unknown-slug> returns error and lists available agents', async () => {
    const reg = createCommandRegistry();
    const agentStorage = makeMockAgentStorage([
      makeAgentProfile({ name: 'Coder', slug: 'agent-coder', type: 'professional' }),
      makeAgentProfile({ name: 'Writer', slug: 'agent-writer', type: 'professional' }),
    ]);
    const result = await exec(reg, '/agent agent-not-found', makeCtx({ agentStorage }));
    expect(result.action).not.toBe('switch_agent');
    expect(result.output).toBeDefined();
    expect(result.output).toContain('agent-not-found');
    // 列出可用 agents
    expect(result.output).toContain('agent-coder');
    expect(result.output).toContain('agent-writer');
  });

  it('/agent info shows current agent personality body', async () => {
    const reg = createCommandRegistry();
    const agentStorage = makeMockAgentStorage([
      makeAgentProfile({
        name: 'Coder',
        slug: 'agent-coder',
        type: 'professional',
        personality: 'You are an elite coder with strong opinions on style.',
      }),
    ]);
    const result = await exec(reg, '/agent info', makeCtx({
      agentStorage,
      currentAgentSlug: 'agent-coder',
    }));
    expect(result.output).toBeDefined();
    expect(result.output).toContain('Coder');
    expect(result.output).toContain('agent-coder');
    // 显示 personality 内容
    expect(result.output).toContain('elite coder');
  });

  it('/agent info on default agent shows note about no AGENT.md personality', async () => {
    const reg = createCommandRegistry();
    const agentStorage = makeMockAgentStorage([
      makeAgentProfile({
        name: 'Default Helper',
        slug: DEFAULT_AGENT_SLUG,
        type: 'default',
        personality: '',
      }),
    ]);
    const result = await exec(reg, '/agent info', makeCtx({
      agentStorage,
      currentAgentSlug: DEFAULT_AGENT_SLUG,
    }));
    expect(result.output).toBeDefined();
    expect(result.output).toContain(DEFAULT_AGENT_SLUG);
    // 默认 agent 应提示无 personality
    expect(result.output).toMatch(/default|no.*personality|通用/i);
  });

  it('/agent memory-log lists recent audit records with timestamp/section/mode/preview', async () => {
    const reg = createCommandRegistry();
    const records = [
      makeAuditRecord({
        timestamp: '2026-07-06T10:00:00.000Z',
        section: 'user_profile',
        mode: 'append',
        contentPreview: 'user prefers dark mode',
        contentLength: 22,
      }),
      makeAuditRecord({
        timestamp: '2026-07-06T09:00:00.000Z',
        section: 'facts',
        mode: 'replace',
        contentPreview: 'Paris is the capital of France',
        contentLength: 25,
      }),
    ];
    const auditLog = makeMockMemoryAuditLog(records);
    const agentStorage = makeMockAgentStorage([
      makeAgentProfile({ slug: 'agent-coder', type: 'professional' }),
    ]);
    const result = await exec(reg, '/agent memory-log', makeCtx({
      agentStorage,
      currentAgentSlug: 'agent-coder',
      memoryAuditLogFactory: (_userId, _slug) => auditLog,
    }));
    expect(result.output).toBeDefined();
    expect(result.output).toContain('2026-07-06T10:00:00.000Z');
    expect(result.output).toContain('user_profile');
    expect(result.output).toContain('append');
    expect(result.output).toContain('user prefers dark mode');
    expect(result.output).toContain('facts');
    expect(result.output).toContain('replace');
    // 默认 limit=20
    expect(auditLog.listCalls).toHaveLength(1);
    expect(auditLog.listCalls[0].limit).toBe(20);
  });

  it('/agent memory-log <limit> passes custom limit to audit log', async () => {
    const reg = createCommandRegistry();
    const auditLog = makeMockMemoryAuditLog([
      makeAuditRecord({ contentPreview: 'r1' }),
    ]);
    const agentStorage = makeMockAgentStorage([
      makeAgentProfile({ slug: 'agent-coder', type: 'professional' }),
    ]);
    const result = await exec(reg, '/agent memory-log 5', makeCtx({
      agentStorage,
      currentAgentSlug: 'agent-coder',
      memoryAuditLogFactory: () => auditLog,
    }));
    expect(result.output).toBeDefined();
    expect(auditLog.listCalls[0].limit).toBe(5);
  });

  it('/agent memory-log with no records shows empty-state message', async () => {
    const reg = createCommandRegistry();
    const auditLog = makeMockMemoryAuditLog([]);
    const agentStorage = makeMockAgentStorage([
      makeAgentProfile({ slug: 'agent-coder', type: 'professional' }),
    ]);
    const result = await exec(reg, '/agent memory-log', makeCtx({
      agentStorage,
      currentAgentSlug: 'agent-coder',
      memoryAuditLogFactory: () => auditLog,
    }));
    expect(result.output).toMatch(/no.*memory.*audit|empty/i);
  });

  it('/agent without agentStorage shows disabled message', async () => {
    const reg = createCommandRegistry();
    const result = await exec(reg, '/agent', makeCtx());
    expect(result.output).toBeDefined();
    expect(result.output).toMatch(/agent.*storage.*未启用|not.*enabled|disabled/i);
  });

  it('/agent info without currentAgentSlug shows helpful message', async () => {
    const reg = createCommandRegistry();
    const agentStorage = makeMockAgentStorage([
      makeAgentProfile({ slug: 'agent-coder', type: 'professional' }),
    ]);
    const result = await exec(reg, '/agent info', makeCtx({ agentStorage }));
    expect(result.output).toBeDefined();
    // 未设置 currentAgentSlug 时应给出提示（不抛错）
    expect(result.output).toMatch(/no.*current.*agent|current.*not.*set|未设置/i);
  });

  it('/agent info when current agent not found in storage shows error', async () => {
    const reg = createCommandRegistry();
    const agentStorage = makeMockAgentStorage([]); // 空 storage
    const result = await exec(reg, '/agent info', makeCtx({
      agentStorage,
      currentAgentSlug: 'agent-coder',
    }));
    expect(result.output).toBeDefined();
    expect(result.output).toContain('agent-coder');
    expect(result.output).toMatch(/not.*found|未找到/i);
  });

  it('/agent memory-log without memoryAuditLogFactory shows disabled message', async () => {
    const reg = createCommandRegistry();
    const agentStorage = makeMockAgentStorage([
      makeAgentProfile({ slug: 'agent-coder', type: 'professional' }),
    ]);
    const result = await exec(reg, '/agent memory-log', makeCtx({
      agentStorage,
      currentAgentSlug: 'agent-coder',
    }));
    expect(result.output).toBeDefined();
    expect(result.output).toMatch(/audit.*log.*未启用|not.*enabled|disabled/i);
  });

  it('/agent memory-log with invalid limit shows error', async () => {
    const reg = createCommandRegistry();
    const auditLog = makeMockMemoryAuditLog([]);
    const agentStorage = makeMockAgentStorage([
      makeAgentProfile({ slug: 'agent-coder', type: 'professional' }),
    ]);
    const result = await exec(reg, '/agent memory-log abc', makeCtx({
      agentStorage,
      currentAgentSlug: 'agent-coder',
      memoryAuditLogFactory: () => auditLog,
    }));
    expect(result.output).toBeDefined();
    expect(result.output).toMatch(/invalid.*limit|无效/i);
    // 不应调用 auditLog.list
    expect(auditLog.listCalls).toHaveLength(0);
  });

  it('/agent without userId shows error', async () => {
    const reg = createCommandRegistry();
    const agentStorage = makeMockAgentStorage([
      makeAgentProfile({ slug: 'agent-coder', type: 'professional' }),
    ]);
    const result = await exec(reg, '/agent', makeCtx({
      agentStorage,
      userId: undefined,
    }));
    expect(result.output).toBeDefined();
    expect(result.output).toMatch(/userId|未设置/i);
  });
});
