import * as path from 'node:path';
import * as fs from 'node:fs/promises';

/**
 * §4.11 / design-notes §12.4 /session 动态属性白名单（5 项）。
 * 校验规则与 design-notes §12.4 参考实现一致。
 */
export const SESSION_ATTRS = {
  temperature: { type: 'number' as const, validate: (v: number) => v >= 0 && v <= 2 },
  maxTokens: { type: 'number' as const, validate: (v: number) => v > 0 && v <= 200000 },
  reasoningEffort: {
    type: 'string' as const,
    validate: (v: string) => ['none', 'minimal', 'low', 'medium', 'high', 'xhigh'].includes(v),
  },
  thinkingType: {
    type: 'string' as const,
    validate: (v: string) => ['adaptive', 'enabled', 'disabled'].includes(v),
  },
  thinkingBudgetTokens: { type: 'number' as const, validate: (v: number) => v > 0 },
};

export type SessionAttrName = keyof typeof SESSION_ATTRS;

/** 列出所有合法属性名（用于错误提示） */
export function listValidAttrNames(): string[] {
  return Object.keys(SESSION_ATTRS);
}

/**
 * 安全属性名校验：仅允许字母开头 + 字母/数字/下划线/连字符/点。
 * 拒绝路径分隔符（/ \）、`..` 前缀等，防止文件逃生口路径穿越注入。
 */
const SAFE_ATTR_NAME = /^[A-Za-z][A-Za-z0-9_.-]*$/;

export function isSafeAttrName(name: string): boolean {
  if (!name) return false;
  // 额外拒绝 `..` 段（即使正则允许单点，连续点也禁）
  if (name.includes('..')) return false;
  return SAFE_ATTR_NAME.test(name);
}

/**
 * SessionAttrHandler：/session 命令通过此接口操作 session 的动态属性。
 * AgentSession 结构化实现此接口（setProviderAttr 同时广播到 MixinProvider）。
 */
export interface SessionAttrHandler {
  setProviderAttr(key: string, value: unknown): void;
  getProviderAttr(key: string): unknown;
  getAllProviderAttrs(): Record<string, unknown>;
  resetProviderAttrs(): void;
}

/**
 * 处理 /session <attr> <value> 设置请求。
 *
 * 白名单属性：JSON 自动解析 → 类型校验 → 范围校验 → setProviderAttr（广播到 MixinProvider）
 * 非白名单属性：写入文件逃生口 `<dataDir>/session-attrs/<sessionId>/<key>`，供 agent read_file 读取
 *
 * 返回给用户的反馈字符串（成功/错误）。
 */
export async function handleSessionAttr(
  handler: SessionAttrHandler,
  key: string,
  rawValue: string,
  sessionId: string,
  dataDir: string,
): Promise<string> {
  const spec = SESSION_ATTRS[key as SessionAttrName];

  // 非白名单 → 文件逃生口
  if (!spec) {
    // 安全校验：拒绝路径穿越 / 注入字符
    if (!isSafeAttrName(key)) {
      return `❌ illegal attribute name: ${key}\navailable: ${listValidAttrNames().join(', ')}`;
    }
    const dir = path.join(dataDir, 'session-attrs', sessionId);
    await fs.mkdir(dir, { recursive: true });
    const filePath = path.join(dir, key);
    await fs.writeFile(filePath, rawValue, 'utf-8');
    return `✅ written to file: ${filePath}`;
  }

  // 白名单 → JSON 自动解析（number/boolean/null 自动转类型，字符串保持原样）
  let value: unknown = rawValue;
  try {
    value = JSON.parse(rawValue);
  } catch {
    // 字符串保持原样
  }

  // 类型校验
  if (typeof value !== spec.type) {
    return `❌ type error: ${key} expects ${spec.type}, got ${typeof value}`;
  }

  // 范围校验
  if (!spec.validate(value as never)) {
    return `❌ invalid value: ${key}=${JSON.stringify(value)}`;
  }

  handler.setProviderAttr(key, value);
  return `✅ session.${key} = ${JSON.stringify(value)}`;
}

/**
 * 格式化所有当前属性值用于 /session（无参数）展示。
 */
export function formatAllAttrs(handler: SessionAttrHandler): string {
  const current = handler.getAllProviderAttrs();
  const lines: string[] = ['Session attributes:'];
  for (const name of listValidAttrNames()) {
    const val = current[name];
    const display = val === undefined ? '(not set)' : JSON.stringify(val);
    lines.push(`  ${name} = ${display}`);
  }
  return lines.join('\n');
}

/**
 * 格式化单个属性值用于 /session <attr>（无值）展示。
 * 返回 undefined 表示该属性名不在白名单。
 */
export function formatSingleAttr(
  handler: SessionAttrHandler,
  key: string,
): string | undefined {
  const spec = SESSION_ATTRS[key as SessionAttrName];
  if (!spec) return undefined;
  const val = handler.getProviderAttr(key);
  const display = val === undefined ? '(not set)' : JSON.stringify(val);
  return `${key} = ${display}`;
}
