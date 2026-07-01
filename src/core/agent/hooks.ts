import { existsSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { ToolCall } from '../memory/agent-message.js';
import type { Provider, ContextMessage } from '../provider/types.js';
import type { AgentToolResult } from '../tool/types.js';

/**
 * §12.3 Hook session —— hook ctx 中的 session 字段最小接口。
 * AgentSession 结构化满足此接口（结构性类型），避免循环依赖。
 */
export interface HookSession {
  readonly sessionId: string;
}

/**
 * §12.3 ExitReason —— agent 退出原因。
 */
export type ExitReason =
  | 'end_turn'
  | 'max_iterations_exceeded'
  | 'aborted'
  | 'error';

/**
 * §12.3 LLMResponse —— LLM 单次返回摘要（用于 hook ctx）。
 */
export interface LLMResponse {
  text: string;
  toolCalls: ToolCall[];
  stopReason: string;
}

/**
 * §12.3 8 个 hook 点的 ctx 类型。
 * agent_before: agent 循环开始前（一次）
 * agent_after:  agent 循环结束后（一次）
 * turn_before:  每个 turn 开始
 * turn_after:   每个 turn 结束
 * llm_before:   调 LLM 前
 * llm_after:    LLM 返回后
 * tool_before:  工具执行前
 * tool_after:   工具执行后
 */
export interface HookContexts {
  agent_before: {
    messages: ContextMessage[];
    systemPrompt: string;
    session?: HookSession;
  };
  agent_after: {
    messages: ContextMessage[];
    exitReason: ExitReason;
    session?: HookSession;
  };
  turn_before: {
    turn: number;
    messages: ContextMessage[];
    session?: HookSession;
  };
  turn_after: {
    turn: number;
    response: LLMResponse;
    toolCalls: ToolCall[];
    session?: HookSession;
  };
  llm_before: {
    turn: number;
    messages: ContextMessage[];
    provider: Provider;
  };
  llm_after: {
    turn: number;
    response: LLMResponse;
    latencyMs: number;
    provider: Provider;
  };
  tool_before: {
    toolName: string;
    args: unknown;
    session?: HookSession;
  };
  tool_after: {
    toolName: string;
    args: unknown;
    result: AgentToolResult;
    latencyMs: number;
    session?: HookSession;
  };
}

export type HookPoint = keyof HookContexts;

export type HookFn<K extends HookPoint> = (
  ctx: HookContexts[K],
) => HookContexts[K] | void;

export interface HookRegistration<K extends HookPoint> {
  fn: HookFn<K>;
  priority: number;
  order: number;
}

export const DEFAULT_HOOK_PRIORITY = 100;

/**
 * §12.3 HookRegistry —— 模块级 hook 注册表。
 * 同步执行；ctx 允许 mutate（链式传递）；priority 升序排序；
 * hook 抛错吞掉 + stderr 打印 + 不影响主流程。
 */
export class HookRegistry {
  private registry: { [K in HookPoint]?: HookRegistration<K>[] } = {};
  private counter = 0;

  on<K extends HookPoint>(
    event: K,
    fn: HookFn<K>,
    priority: number = DEFAULT_HOOK_PRIORITY,
  ): () => void {
    const reg: HookRegistration<K> = { fn, priority, order: this.counter++ };
    const list = (this.registry[event] ??= []) as HookRegistration<K>[];
    list.push(reg);
    list.sort((a, b) => a.priority - b.priority || a.order - b.order);
    return () => this.off(event, fn);
  }

  off<K extends HookPoint>(event: K, fn: HookFn<K>): void {
    const list = this.registry[event] as HookRegistration<K>[] | undefined;
    if (!list) return;
    const filtered = list.filter((r) => r.fn !== fn);
    // 内部存储使用宽松类型，公开 API 由 on/trigger 签名保证类型安全
    (this.registry as Record<string, unknown[]>)[event] = filtered;
  }

  trigger<K extends HookPoint>(
    event: K,
    ctx: HookContexts[K],
  ): HookContexts[K] {
    const list = this.registry[event] as HookRegistration<K>[] | undefined;
    if (!list || list.length === 0) return ctx;
    let current = ctx;
    for (const { fn } of list) {
      try {
        const r = fn(current);
        if (r) current = r;
      } catch (e) {
        console.error(`[hooks] ${event} callback error:`, e);
      }
    }
    return current;
  }

  has(event: HookPoint): boolean {
    return !!this.registry[event]?.length;
  }

  clear(event?: HookPoint): void {
    if (event) {
      delete this.registry[event];
    } else {
      this.registry = {};
    }
  }

  /**
   * §12.3 两层插件目录加载。
   * pluginsDirs 按顺序加载（builtin 先，workspace 后）；
   * 同名文件 workspace 覆盖 builtin（仅加载 workspace 版本）。
   * 无沙箱：hook 直接访问 Node.js API。
   */
  async discoverAndLoad(pluginsDirs: string[]): Promise<void> {
    const fileMap = new Map<string, string>();
    for (const dir of pluginsDirs) {
      if (!existsSync(dir)) continue;
      const files = await readdir(dir);
      for (const f of files) {
        fileMap.set(f, dir);
      }
    }

    const sortedFiles = Array.from(fileMap.keys()).sort();
    for (const file of sortedFiles) {
      if (file.startsWith('_') || !/\.[mc]?[jt]s$/.test(file)) continue;
      const dir = fileMap.get(file)!;
      try {
        const filePath = join(dir, file);
        await import(pathToFileURL(filePath).href);
      } catch (e) {
        console.error(`[hooks] plugin '${file}' load failed:`, e);
      }
    }
  }
}

export const hooks = new HookRegistry();
