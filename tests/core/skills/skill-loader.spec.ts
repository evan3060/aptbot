import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  loadSkills,
  validateSkillName,
  validateSkillDescription,
  parseFrontmatter,
} from '../../../src/core/skills/loader.js';
import { createNodeExecutionEnv } from '../../../src/core/skills/env.js';
import type { ExecutionEnv } from '../../../src/core/skills/env.js';
import { formatSkillsForSystemPrompt } from '../../../src/core/skills/system-prompt.js';
import { formatSkillInvocation } from '../../../src/core/skills/invocation.js';
import type { Skill } from '../../../src/core/skills/types.js';

let tmpRoot: string;
let env: ExecutionEnv;

beforeEach(async () => {
  tmpRoot = await mkdtemp(join(tmpdir(), 'aptbot-skills-'));
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

describe('skill-loader: validateSkillName', () => {
  it('accepts a-z0-9- within 64 chars', () => {
    expect(validateSkillName('my-skill')).toBe(true);
    expect(validateSkillName('skill123')).toBe(true);
    expect(validateSkillName('a')).toBe(true);
    expect(validateSkillName('a'.repeat(64))).toBe(true);
  });

  it('rejects names with uppercase, underscore, or other chars', () => {
    expect(validateSkillName('MySkill')).toBe(false);
    expect(validateSkillName('my_skill')).toBe(false);
    expect(validateSkillName('my.skill')).toBe(false);
    expect(validateSkillName('my skill')).toBe(false);
  });

  it('rejects names starting or ending with -', () => {
    expect(validateSkillName('-my-skill')).toBe(false);
    expect(validateSkillName('my-skill-')).toBe(false);
  });

  it('rejects names with consecutive --', () => {
    expect(validateSkillName('my--skill')).toBe(false);
  });

  it('rejects empty or >64 chars', () => {
    expect(validateSkillName('')).toBe(false);
    expect(validateSkillName('a'.repeat(65))).toBe(false);
  });
});

describe('skill-loader: validateSkillDescription', () => {
  it('accepts non-empty description within 1024 chars', () => {
    expect(validateSkillDescription('简短描述')).toBe(true);
    expect(validateSkillDescription('a')).toBe(true);
    expect(validateSkillDescription('a'.repeat(1024))).toBe(true);
  });

  it('rejects empty or >1024 chars', () => {
    expect(validateSkillDescription('')).toBe(false);
    expect(validateSkillDescription('a'.repeat(1025))).toBe(false);
  });
});

describe('skill-loader: parseFrontmatter', () => {
  it('parses name / description / disableModelInvocation', () => {
    const raw = `---\nname: my-skill\ndescription: a short desc\ndisableModelInvocation: true\n---\n\nbody`;
    const parsed = parseFrontmatter(raw);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.value.name).toBe('my-skill');
      expect(parsed.value.description).toBe('a short desc');
      expect(parsed.value.disableModelInvocation).toBe(true);
      expect(parsed.value.content).toBe('\nbody');
    }
  });

  it('handles quoted string values', () => {
    const raw = `---\nname: "quoted-name"\ndescription: "desc with: colon"\n---\nbody`;
    const parsed = parseFrontmatter(raw);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.value.name).toBe('quoted-name');
      expect(parsed.value.description).toBe('desc with: colon');
    }
  });

  it('returns err for missing closing ---', () => {
    const raw = `---\nname: my-skill\ndescription: desc\nno closing`;
    const parsed = parseFrontmatter(raw);
    expect(parsed.ok).toBe(false);
  });

  it('returns err when no frontmatter present', () => {
    const raw = `# just markdown\nno frontmatter`;
    const parsed = parseFrontmatter(raw);
    expect(parsed.ok).toBe(false);
  });
});

describe('skill-loader: loadSkills two-layer loading', () => {
  it('loads SKILL.md from a single directory', async () => {
    const workspaceDir = join(tmpRoot, 'workspace');
    await writeSkill(workspaceDir, 'solo', 'name: solo\ndescription: solo desc');
    const result = await loadSkills(env, [workspaceDir]);
    expect(result.diagnostics).toEqual([]);
    expect(result.skills).toHaveLength(1);
    expect(result.skills[0].name).toBe('solo');
    expect(result.skills[0].description).toBe('solo desc');
    expect(result.skills[0].content).toContain('# Skill body');
  });

  it('loads SKILL.md from both workspace and builtin dirs', async () => {
    const workspaceDir = join(tmpRoot, 'workspace');
    const builtinDir = join(tmpRoot, 'builtin');
    await writeSkill(workspaceDir, 'ws-skill', 'name: ws-skill\ndescription: from workspace');
    await writeSkill(builtinDir, 'builtin-skill', 'name: builtin-skill\ndescription: from builtin');
    const result = await loadSkills(env, [workspaceDir, builtinDir]);
    expect(result.diagnostics).toEqual([]);
    expect(result.skills).toHaveLength(2);
    const names = result.skills.map((s) => s.name).sort();
    expect(names).toEqual(['builtin-skill', 'ws-skill']);
  });

  it('workspace overrides builtin when same name (workspace wins)', async () => {
    const workspaceDir = join(tmpRoot, 'workspace');
    const builtinDir = join(tmpRoot, 'builtin');
    await writeSkill(
      workspaceDir,
      'shared',
      'name: shared\ndescription: from workspace',
      '# Workspace content',
    );
    await writeSkill(
      builtinDir,
      'shared',
      'name: shared\ndescription: from builtin',
      '# Builtin content',
    );
    const result = await loadSkills(env, [workspaceDir, builtinDir]);
    expect(result.diagnostics).toEqual([]);
    expect(result.skills).toHaveLength(1);
    expect(result.skills[0].description).toBe('from workspace');
    expect(result.skills[0].content).toContain('# Workspace content');
  });

  it('returns empty list when directory does not exist', async () => {
    const result = await loadSkills(env, [join(tmpRoot, 'no-such-dir')]);
    expect(result.skills).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it('accepts a single dir string instead of array', async () => {
    const workspaceDir = join(tmpRoot, 'workspace');
    await writeSkill(workspaceDir, 'solo', 'name: solo\ndescription: solo desc');
    const result = await loadSkills(env, workspaceDir);
    expect(result.skills).toHaveLength(1);
    expect(result.skills[0].name).toBe('solo');
  });
});

describe('skill-loader: frontmatter parsing integration', () => {
  it('parses disableModelInvocation=true correctly', async () => {
    const workspaceDir = join(tmpRoot, 'workspace');
    await writeSkill(
      workspaceDir,
      'hidden',
      'name: hidden\ndescription: hidden desc\ndisableModelInvocation: true',
    );
    const result = await loadSkills(env, [workspaceDir]);
    expect(result.diagnostics).toEqual([]);
    expect(result.skills).toHaveLength(1);
    expect(result.skills[0].disableModelInvocation).toBe(true);
  });

  it('parses disableModelInvocation=false as false', async () => {
    const workspaceDir = join(tmpRoot, 'workspace');
    await writeSkill(
      workspaceDir,
      'visible',
      'name: visible\ndescription: visible desc\ndisableModelInvocation: false',
    );
    const result = await loadSkills(env, [workspaceDir]);
    expect(result.skills[0].disableModelInvocation).toBe(false);
  });

  it('defaults disableModelInvocation to undefined when absent', async () => {
    const workspaceDir = join(tmpRoot, 'workspace');
    await writeSkill(workspaceDir, 'plain', 'name: plain\ndescription: plain desc');
    const result = await loadSkills(env, [workspaceDir]);
    expect(result.skills[0].disableModelInvocation).toBeUndefined();
  });

  it('falls back to parent directory name when frontmatter name is missing', async () => {
    const workspaceDir = join(tmpRoot, 'workspace');
    await writeSkill(workspaceDir, 'fallback-name', 'description: desc only');
    const result = await loadSkills(env, [workspaceDir]);
    expect(result.diagnostics).toEqual([]);
    expect(result.skills).toHaveLength(1);
    expect(result.skills[0].name).toBe('fallback-name');
  });
});

describe('skill-loader: name validation diagnostics', () => {
  it('emits invalid_metadata diagnostic + skips for uppercase name', async () => {
    const workspaceDir = join(tmpRoot, 'workspace');
    const filePath = await writeSkill(
      workspaceDir,
      'bad-dir',
      'name: BadName\ndescription: desc',
    );
    const result = await loadSkills(env, [workspaceDir]);
    expect(result.skills).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].type).toBe('warning');
    expect(result.diagnostics[0].code).toBe('invalid_metadata');
    expect(result.diagnostics[0].path).toBe(filePath);
  });

  it('emits invalid_metadata diagnostic + skips for underscore name', async () => {
    const workspaceDir = join(tmpRoot, 'workspace');
    await writeSkill(workspaceDir, 'bad-dir', 'name: with_underscore\ndescription: desc');
    const result = await loadSkills(env, [workspaceDir]);
    expect(result.skills).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].code).toBe('invalid_metadata');
  });

  it('emits invalid_metadata diagnostic + skips for name >64 chars', async () => {
    const workspaceDir = join(tmpRoot, 'workspace');
    const longName = 'a'.repeat(65);
    await writeSkill(workspaceDir, 'bad-dir', `name: ${longName}\ndescription: desc`);
    const result = await loadSkills(env, [workspaceDir]);
    expect(result.skills).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].code).toBe('invalid_metadata');
  });

  it('emits invalid_metadata diagnostic + skips when fallback parent dir name is invalid', async () => {
    const workspaceDir = join(tmpRoot, 'workspace');
    // parent dir name is "Bad_Dir" — invalid; frontmatter name missing
    await writeSkill(workspaceDir, 'Bad_Dir', 'description: desc only');
    const result = await loadSkills(env, [workspaceDir]);
    expect(result.skills).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].code).toBe('invalid_metadata');
  });
});

describe('skill-loader: description validation diagnostics', () => {
  it('emits invalid_metadata diagnostic + skips for description >1024 chars', async () => {
    const workspaceDir = join(tmpRoot, 'workspace');
    const longDesc = 'a'.repeat(1025);
    await writeSkill(workspaceDir, 'long-desc', `name: long-desc\ndescription: ${longDesc}`);
    const result = await loadSkills(env, [workspaceDir]);
    expect(result.skills).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].code).toBe('invalid_metadata');
  });

  it('emits invalid_metadata diagnostic + skips when description is missing', async () => {
    const workspaceDir = join(tmpRoot, 'workspace');
    await writeSkill(workspaceDir, 'no-desc', 'name: no-desc');
    const result = await loadSkills(env, [workspaceDir]);
    expect(result.skills).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].code).toBe('invalid_metadata');
  });
});

describe('skill-loader: corrupted frontmatter diagnostics', () => {
  it('emits parse_failed diagnostic + skips when frontmatter has no closing ---', async () => {
    const workspaceDir = join(tmpRoot, 'workspace');
    const skillDir = join(workspaceDir, 'broken');
    await mkdir(skillDir, { recursive: true });
    const filePath = join(skillDir, 'SKILL.md');
    await writeFile(filePath, '---\nname: broken\ndescription: desc\nno closing here\n', 'utf-8');
    const result = await loadSkills(env, [workspaceDir]);
    expect(result.skills).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].code).toBe('parse_failed');
    expect(result.diagnostics[0].path).toBe(filePath);
  });

  it('emits parse_failed diagnostic + skips when SKILL.md has no frontmatter', async () => {
    const workspaceDir = join(tmpRoot, 'workspace');
    const skillDir = join(workspaceDir, 'nofm');
    await mkdir(skillDir, { recursive: true });
    const filePath = join(skillDir, 'SKILL.md');
    await writeFile(filePath, '# Just markdown\nno frontmatter at all\n', 'utf-8');
    const result = await loadSkills(env, [workspaceDir]);
    expect(result.skills).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].code).toBe('parse_failed');
  });

  it('continues loading other skills after a corrupted one', async () => {
    const workspaceDir = join(tmpRoot, 'workspace');
    // broken skill
    const brokenDir = join(workspaceDir, 'broken');
    await mkdir(brokenDir, { recursive: true });
    await writeFile(join(brokenDir, 'SKILL.md'), '---\nname: broken\nno closing\n', 'utf-8');
    // good skill
    await writeSkill(workspaceDir, 'good', 'name: good\ndescription: good desc');
    const result = await loadSkills(env, [workspaceDir]);
    expect(result.skills).toHaveLength(1);
    expect(result.skills[0].name).toBe('good');
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].code).toBe('parse_failed');
  });
});

describe('skill-loader: system-prompt injection', () => {
  it('returns empty string for empty skill list', () => {
    expect(formatSkillsForSystemPrompt([])).toBe('');
  });

  it('includes name + description + filePath for each skill', () => {
    const skills: Skill[] = [
      {
        name: 'skill-a',
        description: 'Description for skill A',
        content: '',
        filePath: '/path/to/skill-a/SKILL.md',
      },
      {
        name: 'skill-b',
        description: 'Description for skill B',
        content: '',
        filePath: '/path/to/skill-b/SKILL.md',
      },
    ];
    const out = formatSkillsForSystemPrompt(skills);
    expect(out).toContain('## Skills');
    expect(out).toContain('**skill-a**');
    expect(out).toContain('Description for skill A');
    expect(out).toContain('/path/to/skill-a/SKILL.md');
    expect(out).toContain('**skill-b**');
    expect(out).toContain('Description for skill B');
  });

  it('excludes skills with disableModelInvocation=true', () => {
    const skills: Skill[] = [
      {
        name: 'visible',
        description: 'visible desc',
        content: '',
        filePath: '/p/visible/SKILL.md',
      },
      {
        name: 'hidden',
        description: 'hidden desc',
        content: '',
        filePath: '/p/hidden/SKILL.md',
        disableModelInvocation: true,
      },
    ];
    const out = formatSkillsForSystemPrompt(skills);
    expect(out).toContain('visible');
    expect(out).not.toContain('hidden');
  });
});

describe('skill-loader: formatSkillInvocation', () => {
  it('wraps skill content in <skill> block with name + location', () => {
    const skill: Skill = {
      name: 'my-skill',
      description: 'desc',
      content: '# My Skill\n\nDo this then that.',
      filePath: '/p/my-skill/SKILL.md',
    };
    const out = formatSkillInvocation(skill);
    expect(out).toContain('<skill name="my-skill" location="/p/my-skill/SKILL.md">');
    expect(out).toContain('# My Skill');
    expect(out).toContain('</skill>');
  });

  it('appends additional instructions when provided', () => {
    const skill: Skill = {
      name: 'my-skill',
      description: 'desc',
      content: 'body',
      filePath: '/p/my-skill/SKILL.md',
    };
    const out = formatSkillInvocation(skill, 'Extra context');
    expect(out).toContain('body');
    expect(out).toContain('Extra context');
    expect(out).toContain('</skill>');
  });
});

describe('skill-loader: ExecutionEnv', () => {
  it('exposes cwd / env / permissions', () => {
    expect(env.cwd).toBe(tmpRoot);
    expect(env.env).toBeDefined();
    expect(env.permissions).toBeDefined();
  });

  it('readTextFile returns ok for existing file', async () => {
    const filePath = join(tmpRoot, 'hello.txt');
    await writeFile(filePath, 'hi', 'utf-8');
    const r = await env.readTextFile(filePath);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toBe('hi');
  });

  it('readTextFile returns err for non-existent file', async () => {
    const r = await env.readTextFile(join(tmpRoot, 'nope.txt'));
    expect(r.ok).toBe(false);
  });

  it('listDir returns ok with FileInfo entries for existing dir', async () => {
    await writeSkill(tmpRoot, 'demo', 'name: demo\ndescription: d');
    const r = await env.listDir(tmpRoot);
    expect(r.ok).toBe(true);
    if (r.ok) {
      const names = r.value.map((f) => f.name);
      expect(names).toContain('demo');
    }
  });

  it('canonicalPath resolves absolute path', async () => {
    // tmpRoot 由 mkdtemp 创建，必然存在；macOS 下 /var 解析到 /private/var，但目录名保留
    const r = await env.canonicalPath(tmpRoot);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.startsWith('/')).toBe(true);
      expect(r.value).toContain('aptbot-skills-');
    }
  });
});
