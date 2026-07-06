import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import matter from 'gray-matter';

/**
 * §0.3.0 Task 1: AgentProfile 类型与 schema 定义
 *
 * 本模块定义 AgentProfile 核心类型契约与 zod schema，作为后续所有 agent 相关模块
 * （AgentStorage / migration / agent-api 等）的类型基础。
 *
 * 设计要点：
 * - name（display name，max 64，可中英文，mutable）与 slug（path identifier，
 *   `[a-z0-9-]{3,64}`，immutable）是 SEPARATE 字段
 * - slug 自动生成算法：`agent-<6-hex-chars>`，与 name 解耦，避免引入 pinyin 依赖
 * - AGENT.md 格式：YAML frontmatter + markdown body（personality）
 * - LLM 配置字段全部可选（缺省时 fallback 到 config.defaultModel + 系统默认值）
 */

/** Agent 类型联合：default（普通用户 agent）/ professional（专业 agent） */
export type AgentType = 'default' | 'professional';

/**
 * §0.3.0 AGENT_SLUG_REGEX: slug 严格正则。
 * - 仅允许小写字母、数字、连字符
 * - 长度 3 ~ 64 字符
 * - 用于路径遍历防护（不允许 / .. 等）
 */
export const AGENT_SLUG_REGEX = /^[a-z0-9-]{3,64}$/;

/** §0.3.0 MAX_MEMORY_SIZE: agent 记忆 8KB 软上限 */
export const MAX_MEMORY_SIZE = 8192;

/** §0.3.0 MAX_WRITE_CONTENT_SIZE: agent 单次写入 2KB 上限 */
export const MAX_WRITE_CONTENT_SIZE = 2048;

/** §0.3.0 MAX_AGENTS_PER_USER: 单用户 agent 数量软上限 */
export const MAX_AGENTS_PER_USER = 50;

/** reasoningEffort 合法值（与 §4.11 /session 动态属性白名单一致） */
const REASONING_EFFORT_VALUES = [
  'none',
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
] as const;

/** thinkingType 合法值（与 §4.11 /session 动态属性白名单一致） */
const THINKING_TYPE_VALUES = ['adaptive', 'enabled', 'disabled'] as const;

/**
 * §0.3.0 AgentProfileSchema: 校验 AGENT.md frontmatter 字段类型与格式。
 *
 * 必填字段：name / description / type / slug
 * 可选字段：model / temperature / maxTokens / reasoningEffort / thinkingType / thinkingBudgetTokens
 *
 * 注意：此 schema 仅校验 frontmatter 部分；
 * userId / createdAt / updatedAt / personality（body）属于运行时元数据，由 AgentStorage 组装。
 */
export const AgentProfileSchema = z.object({
  name: z.string().min(1).max(64),
  description: z.string().min(1).max(120),
  type: z.enum(['default', 'professional']),
  slug: z.string().regex(AGENT_SLUG_REGEX),
  // 可选 LLM 配置字段（缺省 fallback 到 config.defaultModel + 系统默认值）
  model: z.string().min(1).optional(),
  temperature: z.number().min(0).max(2).optional(),
  maxTokens: z.number().int().positive().max(200000).optional(),
  reasoningEffort: z.enum(REASONING_EFFORT_VALUES).optional(),
  thinkingType: z.enum(THINKING_TYPE_VALUES).optional(),
  thinkingBudgetTokens: z.number().int().positive().optional(),
  // §0.3.0 Task 18: 是否注入 MEMORY.md（缺省视为 true 即启用；false 时不注入）
  memoryEnabled: z.boolean().optional(),
});

/** AgentProfileFrontmatter: Schema 推断的 frontmatter 类型（AGENT.md 中的字段） */
export type AgentProfileFrontmatter = z.infer<typeof AgentProfileSchema>;

/**
 * §0.3.0 AgentProfile 接口：运行时完整的 agent profile。
 *
 * = frontmatter 字段（来自 AGENT.md）+ 运行时元数据（userId / createdAt / updatedAt / personality）
 */
export interface AgentProfile {
  /** 显示名（mutable，max 64，可中英文） */
  readonly name: string;
  /** 简短描述（max 120） */
  readonly description: string;
  /** 所属用户 ID（运行时元数据，不存于 AGENT.md frontmatter） */
  readonly userId: string;
  /** agent 类型 */
  readonly type: AgentType;
  /** 路径标识符（immutable，匹配 AGENT_SLUG_REGEX） */
  readonly slug: string;
  /** 创建时间（ms 精度，UTC） */
  readonly createdAt: number;
  /** 更新时间（ms 精度，UTC） */
  readonly updatedAt: number;
  /** 人格描述（AGENT.md body 内容，markdown，无长度限制） */
  readonly personality: string;
  // 可选 LLM 配置字段（缺省时 fallback 到 config.defaultModel + 系统默认值）
  readonly model?: string;
  readonly temperature?: number;
  readonly maxTokens?: number;
  readonly reasoningEffort?: (typeof REASONING_EFFORT_VALUES)[number];
  readonly thinkingType?: (typeof THINKING_TYPE_VALUES)[number];
  readonly thinkingBudgetTokens?: number;
  /** §0.3.0 Task 18: 是否启用 MEMORY.md 注入（仅 professional；default agent 永不注入；缺省 true） */
  readonly memoryEnabled?: boolean;
}

/** parseAgentMd 返回类型 */
export interface ParsedAgentMd {
  readonly frontmatter: AgentProfileFrontmatter;
  readonly body: string;
}

/**
 * §0.3.0 parseAgentMd: 解析 AGENT.md 文件内容。
 *
 * 格式：YAML frontmatter（--- 分隔）+ markdown body（personality）。
 * 复用 gray-matter（0.2.3 已引入）解析 + zod schema 校验。
 *
 * @param raw AGENT.md 原始字符串
 * @returns { frontmatter, body } frontmatter 已通过 AgentProfileSchema 校验
 * @throws frontmatter 缺字段 / 类型错 / slug 不匹配正则时抛错
 */
export function parseAgentMd(raw: string): ParsedAgentMd {
  let matterResult;
  try {
    matterResult = matter(raw);
  } catch (e) {
    throw new Error(`failed to parse AGENT.md frontmatter: ${(e as Error).message}`);
  }

  // gray-matter 对无 frontmatter 的纯文本返回空 data 对象，这里显式校验
  const parseResult = AgentProfileSchema.safeParse(matterResult.data);
  if (!parseResult.success) {
    const details = parseResult.error.issues
      .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('; ');
    throw new Error(`invalid AGENT.md frontmatter: ${details}`);
  }

  return {
    frontmatter: parseResult.data,
    body: matterResult.content,
  };
}

/**
 * §0.3.0 generateSlug: 生成 slug。
 *
 * 算法：`agent-<6-hex-chars>`，与 name 解耦。
 * - 避免引入 pinyin 库依赖
 * - 6 位 hex = 16^6 ≈ 1677 万种组合，单用户 50 上限下冲突概率可忽略
 * - 真正冲突时由 AgentStorage 层重试（Task 2 实现）
 *
 * @returns 形如 `agent-a1b2c3` 的 slug
 */
export function generateSlug(): string {
  const hex = randomBytes(3).toString('hex'); // 3 bytes = 6 hex chars
  return `agent-${hex}`;
}

/**
 * §0.3.0 validateSlug: 校验 slug 是否匹配 AGENT_SLUG_REGEX。
 */
export function validateSlug(slug: string): boolean {
  return AGENT_SLUG_REGEX.test(slug);
}
