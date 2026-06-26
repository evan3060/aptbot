import type { ToolDefinition } from '../provider/types.js';
import type { ContentBlock } from '../memory/agent-message.js';

/**
 * §5.1 AgentTool 接口。
 * 工具实现此接口；AgentLoop 通过 ToolRegistry 检索并执行。
 */
export interface AgentTool<TParams = unknown, TDetails = unknown> {
  readonly name: string;
  readonly label: string;
  readonly description: string;
  readonly parameters: Record<string, unknown>;
  readonly executionMode?: 'sequential' | 'parallel';
  execute(
    toolCallId: string,
    params: TParams,
    signal?: AbortSignal,
  ): Promise<AgentToolResult<TDetails>>;
}

/**
 * §5.1 AgentToolResult。
 * content 返回给 LLM；details 用于 UI 展示与日志记录；terminate 控制循环终止。
 */
export interface AgentToolResult<T = unknown> {
  content: ContentBlock[];
  details: T;
  terminate?: boolean;
  error?: { code: string; message: string };
}

/**
 * §5.3 ToolRegistry。
 * 内存实现：register/unregister/get/has/getDefinitions/getAll。
 * 重复 register 同名工具采用覆盖策略（无 warn 以避免日志噪声，调用方需自查）。
 */
export interface ToolRegistry {
  register(tool: AgentTool): void;
  unregister(name: string): void;
  get(name: string): AgentTool | undefined;
  has(name: string): boolean;
  getDefinitions(): ToolDefinition[];
  getAll(): AgentTool[];
}

export function createToolRegistry(): ToolRegistry {
  const tools = new Map<string, AgentTool>();
  return {
    register(tool: AgentTool): void {
      tools.set(tool.name, tool);
    },
    unregister(name: string): void {
      tools.delete(name);
    },
    get(name: string): AgentTool | undefined {
      return tools.get(name);
    },
    has(name: string): boolean {
      return tools.has(name);
    },
    getDefinitions(): ToolDefinition[] {
      const out: ToolDefinition[] = [];
      for (const tool of tools.values()) {
        out.push({
          name: tool.name,
          description: tool.description,
          parameters: tool.parameters,
        });
      }
      return out;
    },
    getAll(): AgentTool[] {
      return Array.from(tools.values());
    },
  };
}
