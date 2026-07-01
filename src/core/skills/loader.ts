import { basename, dirname, join } from 'node:path';
import { createLogger } from '../../infrastructure/logger.js';
import type { ExecutionEnv } from './env.js';
import type {
  LoadSkillsResult,
  Result,
  Skill,
  SkillDiagnostic,
  SkillFrontmatter,
} from './types.js';

const log = createLogger('skills:loader');

/** name 校验规则：a-z0-9-，<=64 字符，不能以 - 开头/结尾，不能连续 -- */
const NAME_REGEX = /^[a-z0-9-]+$/;
const NAME_MAX_LEN = 64;
const DESC_MAX_LEN = 1024;
const SKILL_FILENAME = 'SKILL.md';

/** §8.1 name 校验：a-z0-9-，<=64 字符，不以 - 开头/结尾，不连续 -- */
export function validateSkillName(name: string): boolean {
  if (!name || name.length === 0 || name.length > NAME_MAX_LEN) return false;
  if (!NAME_REGEX.test(name)) return false;
  if (name.startsWith('-') || name.endsWith('-')) return false;
  if (name.includes('--')) return false;
  return true;
}

/** §8.1 description 校验：非空，<=1024 字符 */
export function validateSkillDescription(description: string): boolean {
  if (description.length === 0 || description.length > DESC_MAX_LEN) return false;
  return true;
}

/** frontmatter 解析失败错误 */
export interface FrontmatterParseError {
  readonly code: 'parse_failed';
  readonly message: string;
}

/**
 * §8.6 SKILL.md frontmatter 解析。
 *
 * 格式：
 * ```
 * ---
 * name: my-skill
 * description: 简短描述
 * disableModelInvocation: true
 * ---
 *
 * # Markdown body
 * ```
 *
 * 支持双引号包裹的值（含 `:` 或前后空格）。布尔值 `true`/`false` 转换为 boolean。
 * 不依赖外部 YAML 库——MVP 仅需最小字段集。
 */
export function parseFrontmatter(
  raw: string,
): Result<SkillFrontmatter, FrontmatterParseError> {
  // 必须以 ---\n 开头（兼容 \r\n）
  const openMatch = raw.match(/^---\r?\n/);
  if (!openMatch) {
    return {
      ok: false,
      error: { code: 'parse_failed', message: 'frontmatter opening --- not found' },
    };
  }
  const afterOpen = raw.slice(openMatch[0].length);
  // 找闭合 ---\n（独占一行）；match.index 指向 \n（或 \r），slice 到此处即得 frontmatter 文本
  const closeMatch = afterOpen.match(/\r?\n---\r?\n/);
  if (!closeMatch || closeMatch.index === undefined) {
    return {
      ok: false,
      error: { code: 'parse_failed', message: 'frontmatter closing --- not found' },
    };
  }
  const frontmatterText = afterOpen.slice(0, closeMatch.index);
  // 闭合标记之后的全部内容即为 body（去掉闭合行 + 换行）
  const content = afterOpen.slice(closeMatch.index + closeMatch[0].length);

  // 解析 key: value 行
  let name: string | undefined;
  let description: string | undefined;
  let disableModelInvocation: boolean | undefined;

  for (const line of frontmatterText.split(/\r?\n/)) {
    if (line.trim() === '') continue;
    const colonIdx = line.indexOf(':');
    if (colonIdx < 0) continue;
    const key = line.slice(0, colonIdx).trim();
    let value = line.slice(colonIdx + 1).trim();
    if (value.startsWith('"') && value.endsWith('"') && value.length >= 2) {
      value = value.slice(1, -1);
    } else if (value.startsWith("'") && value.endsWith("'") && value.length >= 2) {
      value = value.slice(1, -1);
    }
    if (key === 'name') {
      name = value;
    } else if (key === 'description') {
      description = value;
    } else if (key === 'disableModelInvocation') {
      if (value === 'true') disableModelInvocation = true;
      else if (value === 'false') disableModelInvocation = false;
    }
  }

  return {
    ok: true,
    value: { name, description, disableModelInvocation, content },
  };
}

/** 构造 warning diagnostic */
function warning(
  code: SkillDiagnostic['code'],
  message: string,
  path: string,
): SkillDiagnostic {
  return { type: 'warning', code, message, path };
}

/** 加载单个 SKILL.md 文件 */
async function loadSkillFile(
  env: ExecutionEnv,
  filePath: string,
): Promise<{ skill?: Skill; diagnostic?: SkillDiagnostic }> {
  // 读取
  const readRes = await env.readTextFile(filePath);
  if (!readRes.ok) {
    return {
      diagnostic: warning(
        'read_failed',
        `failed to read ${filePath}: ${readRes.error.message}`,
        filePath,
      ),
    };
  }

  // 解析 frontmatter
  const parseRes = parseFrontmatter(readRes.value);
  if (!parseRes.ok) {
    return {
      diagnostic: warning(
        'parse_failed',
        `failed to parse frontmatter: ${parseRes.error.message}`,
        filePath,
      ),
    };
  }
  const fm = parseRes.value;

  // name 默认值：frontmatter name > 父目录名
  const name = fm.name ?? basename(dirname(filePath));
  if (!validateSkillName(name)) {
    return {
      diagnostic: warning(
        'invalid_metadata',
        `invalid skill name "${name}" (must match a-z0-9-, <=64 chars, no leading/trailing -, no consecutive --)`,
        filePath,
      ),
    };
  }

  // description 必填
  const description = fm.description ?? '';
  if (!validateSkillDescription(description)) {
    return {
      diagnostic: warning(
        'invalid_metadata',
        `invalid description (must be non-empty and <=1024 chars)`,
        filePath,
      ),
    };
  }

  const skill: Skill = {
    name,
    description,
    content: fm.content,
    filePath,
    disableModelInvocation: fm.disableModelInvocation,
  };
  return { skill };
}

/**
 * §8.6 loadSkills：两层加载，workspace 覆盖 builtin 同名。
 *
 * 流程：
 * 1. dirs 顺序即优先级顺序（前面对应 workspace，后面是 builtin）
 * 2. 每层扫描子目录中包含 SKILL.md 的，解析 frontmatter 并校验
 * 3. 同名 skill：后加载的会被前面已加载的同名覆盖（workspace 优先）
 * 4. 解析失败返回 SkillDiagnostic warning + 跳过
 * 5. 目录不存在不报错（返回空 skills + 空 diagnostics）
 *
 * 不递归子目录的子目录（MVP 仅支持 {dir}/{skillName}/SKILL.md 单层结构）。
 */
export async function loadSkills(
  env: ExecutionEnv,
  dirs: string | string[],
): Promise<LoadSkillsResult> {
  const dirList = Array.isArray(dirs) ? dirs : [dirs];
  const skillsByName = new Map<string, Skill>();
  const diagnostics: SkillDiagnostic[] = [];

  // 逆序遍历 dirs：builtin 先入 map，workspace 后入覆盖（保证 workspace 优先级）
  for (let i = dirList.length - 1; i >= 0; i--) {
    const dir = dirList[i];
    const listRes = await env.listDir(dir);
    if (!listRes.ok) {
      // 目录不存在 / 不可读：跳过（不报错），符合"目录不存在时返回空列表"
      if (listRes.error.kind !== 'not_found') {
        diagnostics.push(
          warning(
            'list_failed',
            `failed to list dir ${dir}: ${listRes.error.message}`,
            dir,
          ),
        );
      }
      continue;
    }
    // 按名字排序，保证加载顺序可预测
    const entries = [...listRes.value].sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      if (!entry.isDirectory) continue;
      const skillMdPath = join(dir, entry.name, SKILL_FILENAME);
      const infoRes = await env.fileInfo(skillMdPath);
      if (!infoRes.ok) {
        // 该子目录无 SKILL.md，跳过（非错误）
        if (infoRes.error.kind !== 'not_found') {
          diagnostics.push(
            warning(
              'file_info_failed',
              `failed to stat ${skillMdPath}: ${infoRes.error.message}`,
              skillMdPath,
            ),
          );
        }
        continue;
      }
      if (infoRes.value.isDirectory) continue;
      const loaded = await loadSkillFile(env, skillMdPath);
      if (loaded.diagnostic) {
        diagnostics.push(loaded.diagnostic);
        continue;
      }
      if (loaded.skill) {
        const existing = skillsByName.get(loaded.skill.name);
        if (existing) {
          // 同名覆盖：记录 info 日志
          log.info(
            `skill "${loaded.skill.name}" overridden by ${loaded.skill.filePath} (was ${existing.filePath})`,
          );
        }
        skillsByName.set(loaded.skill.name, loaded.skill);
      }
    }
  }

  const skills = Array.from(skillsByName.values()).sort((a, b) =>
    a.name.localeCompare(b.name),
  );
  return { skills, diagnostics };
}
