/**
 * §8.5 / §8.6 Skills 系统核心类型。
 *
 * 设计要点：
 * - Skill：加载完成的有效 skill，name 已通过校验
 * - SkillDiagnostic：加载过程中的 warning（不抛错，调用方按需展示）
 * - Result<T, E>：文件操作的 discriminated union，避免 try/catch 污染调用方
 * - ExecutionEnv 不在此处定义（需依赖 Result/FileInfo/FsError，位于 env.ts）
 */

/** 文件信息（listDir / fileInfo 返回） */
export interface FileInfo {
  /** 绝对路径 */
  readonly path: string;
  /** 文件/目录名 */
  readonly name: string;
  readonly isDirectory: boolean;
  /** 字节大小（目录为 0） */
  readonly size: number;
  /** 纳秒精度 mtime，用于热重载比较 */
  readonly mtimeNs: bigint;
}

/** 文件系统错误分类，便于调用方区分处理 */
export type FsError =
  | { readonly kind: 'not_found'; readonly path: string; readonly message: string }
  | { readonly kind: 'permission_denied'; readonly path: string; readonly message: string }
  | { readonly kind: 'io_error'; readonly path: string; readonly message: string };

/** Result 类型：成功 ok 或失败 err，避免抛错传染 */
export type Result<T, E> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: E };

/** Skill frontmatter 原始解析结果（字段可能缺失或类型不对） */
export interface SkillFrontmatter {
  readonly name?: string;
  readonly description?: string;
  readonly disableModelInvocation?: boolean;
  /** markdown body（frontmatter 之后的内容） */
  readonly content: string;
}

/** 已校验的有效 Skill */
export interface Skill {
  /** 稳定名称，a-z0-9-，<=64 字符 */
  readonly name: string;
  /** 模型可见描述，<=1024 字符 */
  readonly description: string;
  /** 完整 skill 指令（markdown body） */
  readonly content: string;
  /** SKILL.md 绝对路径 */
  readonly filePath: string;
  /** 排除出模型可见列表，但仍可显式调用 */
  readonly disableModelInvocation?: boolean;
}

/** 加载诊断类型 */
export type SkillDiagnosticCode =
  | 'file_info_failed'
  | 'list_failed'
  | 'read_failed'
  | 'parse_failed'
  | 'invalid_metadata';

/** Skill 加载诊断（warning，不抛错） */
export interface SkillDiagnostic {
  readonly type: 'warning';
  readonly code: SkillDiagnosticCode;
  readonly message: string;
  /** 触发诊断的 SKILL.md 绝对路径 */
  readonly path: string;
}

/** loadSkills 返回值 */
export interface LoadSkillsResult {
  readonly skills: Skill[];
  readonly diagnostics: SkillDiagnostic[];
}
