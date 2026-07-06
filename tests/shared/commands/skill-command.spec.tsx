import { describe, it, expect, vi } from 'vitest';
import { createCommandRegistry, type CommandContext } from '../../../src/shared/commands/registry.js';
import type { StorageAdapter } from '../../../src/infrastructure/storage/file-storage.js';
import type { Skill, SkillState } from '../../../src/core/skills/loader.js';

/**
 * Task 12: /skill CLI 命令测试
 *
 * 覆盖场景：
 *   - 注册到 CommandRegistry
 *   - /skill 列出所有已加载 skill
 *   - /skill use <name> 激活 skill（返回 fillInput）
 *   - /skill use <name> 无 template 时回退到 content
 *   - /skill use <unknown> 返回错误 + 列出可用 skill
 *   - /skill use 无 name 显示 usage
 *   - /skill 无 skillState 提示未加载
 *   - /skill <unknown-subcommand> 错误
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

function makeSkill(overrides: Partial<Skill> = {}): Skill {
  return {
    name: 'test-skill',
    description: 'A test skill for unit testing',
    content: 'Skill body content instructing the model how to act.',
    filePath: '/tmp/skills/test-skill/SKILL.md',
    contentLines: 1,
    contentBytes: 50,
    ...overrides,
  } as Skill;
}

/**
 * In-memory SkillState mock — skills 数组单一来源。
 */
function makeMockSkillState(initial: Skill[] = []): SkillState & {
  skills: Skill[];
} {
  const skills = initial.map((s) => ({ ...s }));
  const mock = {
    skills,
    findByFilePath(filePath: string): Skill | undefined {
      return skills.find((s) => s.filePath === filePath);
    },
    markUsed(_filePath: string, _timestamp?: number): boolean {
      return false;
    },
    async reload(): Promise<void> {},
  };
  return mock as unknown as SkillState & { skills: Skill[] };
}

function makeCtx(overrides: Partial<CommandContext> = {}): CommandContext {
  return {
    sessionId: 'session-test',
    model: 'mock-1',
    storage: makeMockStorage(),
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

describe('/skill command', () => {
  it('is registered in CommandRegistry', () => {
    const reg = createCommandRegistry();
    expect(reg.has('skill')).toBe(true);
    const resolved = reg.resolve('/skill');
    expect(resolved).not.toBeNull();
    expect(resolved!.command.name).toBe('skill');
  });

  it('/skill (no args) lists all loaded skills with name + description', async () => {
    const reg = createCommandRegistry();
    const skillState = makeMockSkillState([
      makeSkill({ name: 'bash-runner', description: 'Run bash commands safely' }),
      makeSkill({ name: 'code-reviewer', description: 'Review code for issues' }),
    ]);
    const result = await exec(reg, '/skill', makeCtx({ skillState }));
    expect(result.output).toBeDefined();
    expect(result.output).toContain('bash-runner');
    expect(result.output).toContain('Run bash commands safely');
    expect(result.output).toContain('code-reviewer');
    expect(result.output).toContain('Review code for issues');
  });

  it('/skill (no args) shows template preview when present (truncated)', async () => {
    const reg = createCommandRegistry();
    const longTemplate = 'x'.repeat(250);
    const skillState = makeMockSkillState([
      makeSkill({
        name: 'with-template',
        description: 'A skill with a template',
        template: longTemplate,
      } as Skill),
    ]);
    const result = await exec(reg, '/skill', makeCtx({ skillState }));
    expect(result.output).toBeDefined();
    expect(result.output).toContain('with-template');
    expect(result.output).toContain('template');
    // 长模板应被截断（输出含 "..."）
    expect(result.output).toContain('...');
  });

  it('/skill (no args) shows empty-state message when no skills loaded', async () => {
    const reg = createCommandRegistry();
    const skillState = makeMockSkillState([]);
    const result = await exec(reg, '/skill', makeCtx({ skillState }));
    expect(result.output).toMatch(/no.*skills|empty/i);
  });

  it('/skill use <name> with template returns fillInput + output', async () => {
    const reg = createCommandRegistry();
    const template = 'Help me refactor this code: {{cursor}}';
    const skillState = makeMockSkillState([
      makeSkill({
        name: 'refactor',
        description: 'Refactoring assistant',
        template,
      } as Skill),
    ]);
    const result = await exec(reg, '/skill use refactor', makeCtx({ skillState }));
    expect(result.output).toBeDefined();
    expect(result.output).toContain('refactor');
    expect(result.output).toContain(template);
    expect(result.fillInput).toBe(template);
  });

  it('/skill use <name> without template falls back to content body in fillInput', async () => {
    const reg = createCommandRegistry();
    const content = 'You are a senior code reviewer. Review every change for correctness.';
    const skillState = makeMockSkillState([
      makeSkill({
        name: 'reviewer',
        description: 'Code reviewer',
        content,
      }),
    ]);
    const result = await exec(reg, '/skill use reviewer', makeCtx({ skillState }));
    expect(result.output).toBeDefined();
    expect(result.output).toContain('reviewer');
    // 无 template 时 fillInput 应为 content
    expect(result.fillInput).toBe(content);
    expect(result.output).toContain(content);
  });

  it('/skill use <unknown-name> returns error and lists available skills', async () => {
    const reg = createCommandRegistry();
    const skillState = makeMockSkillState([
      makeSkill({ name: 'bash-runner', description: 'Run bash' }),
      makeSkill({ name: 'code-reviewer', description: 'Review' }),
    ]);
    const result = await exec(reg, '/skill use unknown-skill', makeCtx({ skillState }));
    expect(result.output).toBeDefined();
    expect(result.output).toContain('unknown-skill');
    expect(result.output).toContain('bash-runner');
    expect(result.output).toContain('code-reviewer');
    expect(result.fillInput).toBeUndefined();
  });

  it('/skill use with no name shows usage', async () => {
    const reg = createCommandRegistry();
    const skillState = makeMockSkillState([
      makeSkill({ name: 'bash-runner', description: 'Run bash' }),
    ]);
    const result = await exec(reg, '/skill use', makeCtx({ skillState }));
    expect(result.output).toBeDefined();
    expect(result.output).toMatch(/usage/i);
    expect(result.output).toContain('use');
  });

  it('/skill without skillState shows disabled message', async () => {
    const reg = createCommandRegistry();
    const result = await exec(reg, '/skill', makeCtx());
    expect(result.output).toBeDefined();
    expect(result.output).toMatch(/skills.*未加载|not.*loaded|disabled/i);
  });

  it('/skill use without skillState shows disabled message', async () => {
    const reg = createCommandRegistry();
    const result = await exec(reg, '/skill use bash', makeCtx());
    expect(result.output).toBeDefined();
    expect(result.output).toMatch(/skills.*未加载|not.*loaded|disabled/i);
  });

  it('/skill <unknown-subcommand> shows error', async () => {
    const reg = createCommandRegistry();
    const skillState = makeMockSkillState([
      makeSkill({ name: 'bash-runner', description: 'Run bash' }),
    ]);
    const result = await exec(reg, '/skill bogus', makeCtx({ skillState }));
    expect(result.output).toBeDefined();
    expect(result.output).toMatch(/unknown.*subcommand|未知/i);
  });

  it('/skill (no args) truncates long description', async () => {
    const reg = createCommandRegistry();
    const longDesc = 'y'.repeat(120);
    const skillState = makeMockSkillState([
      makeSkill({ name: 'long-desc-skill', description: longDesc }),
    ]);
    const result = await exec(reg, '/skill', makeCtx({ skillState }));
    expect(result.output).toBeDefined();
    expect(result.output).toContain('long-desc-skill');
    expect(result.output).toContain('...');
  });
});
