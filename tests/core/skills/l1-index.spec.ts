import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadSkills, createSkillState } from '../../../src/core/skills/loader.js';
import { createNodeExecutionEnv } from '../../../src/core/skills/env.js';
import type { ExecutionEnv } from '../../../src/core/skills/env.js';
import {
  formatSkillsForSystemPrompt,
  MAX_INDEX_TOKENS,
} from '../../../src/core/skills/system-prompt.js';
import { createReadTool, readTool } from '../../../src/core/tool/tools/read.js';
import type { Skill } from '../../../src/core/skills/types.js';

let tmpRoot: string;
let env: ExecutionEnv;

beforeEach(async () => {
  tmpRoot = await mkdtemp(join(tmpdir(), 'aptbot-skills-l1-'));
  env = createNodeExecutionEnv(tmpRoot);
});

afterEach(async () => {
  await rm(tmpRoot, { recursive: true, force: true });
});

/** 写入一个 SKILL.md 到指定子目录，返回该 SKILL.md 绝对路径 */
async function writeSkill(
  parentDir: string,
  skillName: string,
  frontmatter: string,
  body = '# Skill body\n',
): Promise<string> {
  const skillDir = join(parentDir, skillName);
  await mkdir(skillDir, { recursive: true });
  const filePath = join(skillDir, 'SKILL.md');
  const content = `---\n${frontmatter}\n---\n\n${body}`;
  await writeFile(filePath, content, 'utf-8');
  return filePath;
}

describe('L1 index: loadSkills populates contentLines/contentBytes/tags', () => {
  it('computes contentLines from body and contentBytes from utf-8 bytes', async () => {
    const workspaceDir = join(tmpRoot, 'workspace');
    const body = '# Title\n\n中文内容\nline4\n';
    await writeSkill(workspaceDir, 'meta', 'name: meta\ndescription: meta skill', body);
    const result = await loadSkills(env, [workspaceDir]);
    expect(result.skills).toHaveLength(1);
    const skill = result.skills[0];
    // content = '\n' + body = '\n# Title\n\n中文内容\nline4\n'
    //   (parseFrontmatter 保留 frontmatter 闭合 --- 后的 \n 作为 leading)
    // split('\n') → ['', '# Title', '', '中文内容', 'line4', ''] → 6 lines
    expect(skill.contentLines).toBe(6);
    // bytes: 1(\n) + 7(# Title) + 2(\n\n) + 12(中文内容 = 4×3) + 1(\n) + 5(line4) + 1(\n) = 29
    expect(skill.contentBytes).toBe(29);
  });

  it('parses tags from frontmatter array syntax', async () => {
    const workspaceDir = join(tmpRoot, 'workspace');
    await writeSkill(
      workspaceDir,
      'tagged',
      'name: tagged\ndescription: tagged skill\ntags: [coding, typescript, refactor]',
    );
    const result = await loadSkills(env, [workspaceDir]);
    expect(result.skills[0].tags).toEqual(['coding', 'typescript', 'refactor']);
  });

  it('parses single-element tags array', async () => {
    const workspaceDir = join(tmpRoot, 'workspace');
    await writeSkill(
      workspaceDir,
      'single',
      'name: single\ndescription: d\ntags: [coding]',
    );
    const result = await loadSkills(env, [workspaceDir]);
    expect(result.skills[0].tags).toEqual(['coding']);
  });

  it('leaves tags undefined when not declared in frontmatter', async () => {
    const workspaceDir = join(tmpRoot, 'workspace');
    await writeSkill(workspaceDir, 'plain', 'name: plain\ndescription: d');
    const result = await loadSkills(env, [workspaceDir]);
    expect(result.skills[0].tags).toBeUndefined();
  });

  it('initializes lastUsed as undefined', async () => {
    const workspaceDir = join(tmpRoot, 'workspace');
    await writeSkill(workspaceDir, 'fresh', 'name: fresh\ndescription: d');
    const result = await loadSkills(env, [workspaceDir]);
    expect(result.skills[0].lastUsed).toBeUndefined();
  });
});

describe('L1 index: formatSkillsForSystemPrompt sorts by lastUsed desc', () => {
  function makeSkill(overrides: Partial<Skill>): Skill {
    return {
      name: 'skill',
      description: 'desc',
      content: '',
      filePath: '/p/SKILL.md',
      contentLines: 1,
      contentBytes: 1,
      ...overrides,
    };
  }

  it('sorts skills with lastUsed in descending order (most recent first)', () => {
    const a = makeSkill({ name: 'a', lastUsed: 1000 });
    const b = makeSkill({ name: 'b', lastUsed: 3000 });
    const c = makeSkill({ name: 'c', lastUsed: 2000 });
    const out = formatSkillsForSystemPrompt([a, b, c]);
    const aIdx = out.indexOf('**a**');
    const bIdx = out.indexOf('**b**');
    const cIdx = out.indexOf('**c**');
    expect(bIdx).toBeLessThan(cIdx);
    expect(cIdx).toBeLessThan(aIdx);
  });

  it('treats undefined lastUsed as 0 (sorts last)', () => {
    const used = makeSkill({ name: 'used', lastUsed: 1 });
    const fresh = makeSkill({ name: 'fresh' }); // lastUsed undefined
    const out = formatSkillsForSystemPrompt([fresh, used]);
    const usedIdx = out.indexOf('**used**');
    const freshIdx = out.indexOf('**fresh**');
    expect(usedIdx).toBeLessThan(freshIdx);
  });

  it('includes size hint (N行/M字节) and tags in index line', () => {
    const skill = makeSkill({
      name: 'refactor-ts',
      description: 'TypeScript refactor guide',
      contentLines: 42,
      contentBytes: 1024,
      tags: ['coding', 'typescript'],
      filePath: '/p/refactor-ts/SKILL.md',
    });
    const out = formatSkillsForSystemPrompt([skill]);
    expect(out).toContain('42');
    expect(out).toContain('1024');
    expect(out).toContain('coding');
    expect(out).toContain('typescript');
    expect(out).toContain('/p/refactor-ts/SKILL.md');
  });
});

describe('L1 index: 4K token budget truncation', () => {
  function makeSkill(name: string, descBytes: number): Skill {
    // description 长度直接驱动 index 行 token 数（chars/4 估算）
    const desc = 'x'.repeat(descBytes);
    return {
      name,
      description: desc,
      content: '',
      filePath: `/p/${name}/SKILL.md`,
      contentLines: 1,
      contentBytes: 1,
    };
  }

  it('exposes MAX_INDEX_TOKENS = 4000', () => {
    expect(MAX_INDEX_TOKENS).toBe(4000);
  });

  it('truncates when total tokens exceed 4K budget, keeps lastUsed-top N as full entries', () => {
    // 每个 skill 的 description 远超 4K chars (=> ~4K tokens)，仅 first 条能进 fullEntries
    // 构造 5 个 skill：lastUsed 高的在前
    const skills: Skill[] = [];
    for (let i = 0; i < 5; i++) {
      skills.push(
        makeSkill(`skill-${i}`, 16000), // ~4000 tokens per skill description
      );
      skills[i].lastUsed = 1000 - i; // skill-0 最近使用
    }
    const out = formatSkillsForSystemPrompt(skills);
    // skill-0 应作为完整条目（含 description）
    expect(out).toContain('**skill-0**');
    expect(out).toContain('x'.repeat(16000));
    // 其余 skill 应出现在 fallback 名字列表，不含完整 description
    expect(out).toContain('skill-1');
    expect(out).toContain('skill-4');
    // skill-1..4 的 description 不应被注入
    // （fallback 段只有名字，不会有 16000 个连续 x 重复）
    const matches = out.match(/x{16000}/g);
    expect(matches).not.toBeNull();
    expect(matches!.length).toBe(1); // 仅 skill-0 的 description
  });

  it('fallback section includes all truncated skill names', () => {
    const skills: Skill[] = [
      {
        name: 'big',
        description: 'y'.repeat(20000),
        content: '',
        filePath: '/p/big/SKILL.md',
        contentLines: 1,
        contentBytes: 1,
        lastUsed: 100,
      },
      {
        name: 'also-big',
        description: 'z'.repeat(20000),
        content: '',
        filePath: '/p/also-big/SKILL.md',
        contentLines: 1,
        contentBytes: 1,
        lastUsed: 50,
      },
    ];
    const out = formatSkillsForSystemPrompt(skills);
    // big 应作为完整条目（lastUsed 高），also-big 进入 fallback
    expect(out).toContain('**big**');
    expect(out).toContain('also-big');
    // also-big 的 description 不应出现
    expect(out).not.toContain('z'.repeat(20000));
  });

  it('single skill exceeding budget still gets name+description (no truncation of sole entry)', () => {
    // §4.9 边界条件：单 skill 超 4K 预算时仅注入该 skill 的名字 + description
    const skill: Skill = {
      name: 'huge',
      description: 'q'.repeat(20000),
      content: '',
      filePath: '/p/huge/SKILL.md',
      contentLines: 1,
      contentBytes: 1,
    };
    const out = formatSkillsForSystemPrompt([skill]);
    expect(out).toContain('**huge**');
    expect(out).toContain('q'.repeat(20000));
  });

  it('returns empty string for empty skill list', () => {
    expect(formatSkillsForSystemPrompt([])).toBe('');
  });

  it('excludes disableModelInvocation=true skills (still hidden from index)', () => {
    const skills: Skill[] = [
      {
        name: 'visible',
        description: 'visible desc',
        content: '',
        filePath: '/p/visible/SKILL.md',
        contentLines: 1,
        contentBytes: 1,
      },
      {
        name: 'hidden',
        description: 'hidden desc',
        content: '',
        filePath: '/p/hidden/SKILL.md',
        contentLines: 1,
        contentBytes: 1,
        disableModelInvocation: true,
      },
    ];
    const out = formatSkillsForSystemPrompt(skills);
    expect(out).toContain('visible');
    expect(out).not.toContain('hidden');
  });
});

describe('L1 index: read_file maintains lastUsed via skillState', () => {
  it('createReadTool invokes skillState.markUsed when reading a skill file', async () => {
    const workspaceDir = join(tmpRoot, 'workspace');
    const filePath = await writeSkill(
      workspaceDir,
      'reader',
      'name: reader\ndescription: reader skill',
    );
    const state = await createSkillState(env, [workspaceDir]);
    const tool = createReadTool({ skillState: state });
    const before = state.findByFilePath(filePath)?.lastUsed;
    expect(before).toBeUndefined();
    const result = await tool.execute('tc', { path: filePath });
    expect(result.error).toBeUndefined();
    const after = state.findByFilePath(filePath)?.lastUsed;
    expect(after).toBeDefined();
    expect(typeof after).toBe('number');
    expect(after! > 0).toBe(true);
  });

  it('createReadTool does not error when no skillState provided (backward compat)', async () => {
    const file = join(tmpRoot, 'plain.txt');
    await writeFile(file, 'hello', 'utf-8');
    const tool = createReadTool();
    const result = await tool.execute('tc', { path: file });
    expect(result.error).toBeUndefined();
  });

  it('readTool singleton remains backward compatible (no skillState)', async () => {
    const file = join(tmpRoot, 'plain.txt');
    await writeFile(file, 'hi', 'utf-8');
    const result = await readTool.execute('tc', { path: file });
    expect(result.error).toBeUndefined();
    expect(readTool.name).toBe('read');
  });

  it('readTool does not update lastUsed when path is not a skill file', async () => {
    const workspaceDir = join(tmpRoot, 'workspace');
    await writeSkill(workspaceDir, 'sk', 'name: sk\ndescription: d');
    const state = await createSkillState(env, [workspaceDir]);

    // 读一个非 skill 文件
    const otherFile = join(tmpRoot, 'other.txt');
    await writeFile(otherFile, 'data', 'utf-8');
    const tool = createReadTool({ skillState: state });
    await tool.execute('tc', { path: otherFile });

    // 所有 skill 的 lastUsed 仍应是 undefined
    for (const s of state.skills) {
      expect(s.lastUsed).toBeUndefined();
    }
  });
});

describe('L1 index: SkillState hot reload', () => {
  it('reload picks up modified SKILL.md content and recomputes contentLines', async () => {
    const workspaceDir = join(tmpRoot, 'workspace');
    const filePath = await writeSkill(
      workspaceDir,
      'reload',
      'name: reload\ndescription: reload skill',
      '# v1\nline\n',
    );
    const state = await createSkillState(env, [workspaceDir]);
    const before = state.findByFilePath(filePath);
    // content 含 frontmatter 后的 leading \n：'\n# v1\nline\n'.split('\n') => ['','# v1','line',''] => 4
    expect(before?.contentLines).toBe(4);

    // 修改 SKILL.md 增加行数
    await writeFile(
      filePath,
      `---\nname: reload\ndescription: reload skill\n---\n\n# v1\nline\nline2\nline3\n`,
      'utf-8',
    );
    await state.reload();
    const after = state.findByFilePath(filePath);
    // '\n# v1\nline\nline2\nline3\n'.split('\n') => ['','# v1','line','line2','line3',''] => 6
    expect(after?.contentLines).toBe(6);
  });

  it('reload preserves lastUsed for skills that still exist', async () => {
    const workspaceDir = join(tmpRoot, 'workspace');
    const filePath = await writeSkill(
      workspaceDir,
      'persist',
      'name: persist\ndescription: d',
    );
    const state = await createSkillState(env, [workspaceDir]);

    // 模拟 read_file 已使用过该 skill
    const tool = createReadTool({ skillState: state });
    await tool.execute('tc', { path: filePath });
    const usedTs = state.findByFilePath(filePath)?.lastUsed;
    expect(usedTs).toBeDefined();

    // 热重载后 lastUsed 应保留
    await state.reload();
    const reloaded = state.findByFilePath(filePath);
    expect(reloaded?.lastUsed).toBe(usedTs);
  });

  it('reload picks up newly added skills', async () => {
    const workspaceDir = join(tmpRoot, 'workspace');
    await writeSkill(workspaceDir, 'first', 'name: first\ndescription: d');
    const state = await createSkillState(env, [workspaceDir]);
    expect(state.skills).toHaveLength(1);

    await writeSkill(workspaceDir, 'second', 'name: second\ndescription: d2');
    await state.reload();
    expect(state.skills).toHaveLength(2);
    const names = state.skills.map((s) => s.name).sort();
    expect(names).toEqual(['first', 'second']);
  });

  it('findByFilePath returns undefined for unknown path', async () => {
    const workspaceDir = join(tmpRoot, 'workspace');
    await writeSkill(workspaceDir, 'solo', 'name: solo\ndescription: d');
    const state = await createSkillState(env, [workspaceDir]);
    expect(state.findByFilePath('/nonexistent/SKILL.md')).toBeUndefined();
  });

  it('markUsed returns false for unknown path and does not throw', async () => {
    const workspaceDir = join(tmpRoot, 'workspace');
    await writeSkill(workspaceDir, 'solo', 'name: solo\ndescription: d');
    const state = await createSkillState(env, [workspaceDir]);
    const ok = state.markUsed('/nonexistent/SKILL.md');
    expect(ok).toBe(false);
  });
});
