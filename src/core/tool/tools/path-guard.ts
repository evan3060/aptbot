import type { AgentToolResult } from '../types.js';

/**
 * §5.2 路径穿越守卫：拒绝任何包含父目录引用 (`..`) 的路径。
 * 同时识别正斜杠与反斜杠分隔符。
 */
export function containsPathTraversal(p: string): boolean {
  return p.split(/[\\/]/).some((seg) => seg === '..');
}

/**
 * §5.1 通用工具错误结果。
 * 构造统一的 content 文本与 error 对象；`details` 由调用方提供
 * （各工具特有的字段及默认值仍由各自的 errorResult 封装）。
 */
export function toolError(
  code: string,
  message: string,
  details?: Record<string, unknown>,
): AgentToolResult {
  return {
    content: [{ type: 'text', text: `${code}: ${message}` }],
    details: details ?? {},
    error: { code, message },
  };
}
