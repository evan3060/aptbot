import type { AgentEvent } from './events.js';
import { createTurnId, createMessageId } from './events.js';
import type { Provider, Model, Context } from '../provider/types.js';
import type { ToolRegistry } from '../tool/types.js';
import type { AgentMessage, ToolCall } from '../memory/agent-message.js';
import type { HookRegistry, HookSession, ExitReason } from './hooks.js';
import type { StorageAdapter } from '../../infrastructure/storage/file-storage.js';
import { triggerSessionSummary } from './session-summary.js';
import { createLogger } from '../../infrastructure/logger.js';

const summaryLog = createLogger('agent-loop');

export const DEFAULT_MAX_ITERATIONS = 10;
export const MAX_STEERING_QUEUE = 5;
export const DEFAULT_STOP_REASON = 'end_turn';

/**
 * 当 toolCalls 非空时返回原数组，否则返回 undefined（用于 AgentMessage.toolCalls 字段）。
 */
export function maybeToolCalls(toolCalls: ToolCall[]): ToolCall[] | undefined {
  return toolCalls.length > 0 ? toolCalls : undefined;
}

export interface AgentLoopConfig {
  provider: Provider;
  model: Model;
  tools: ToolRegistry;
  context: Context;
  systemPrompt: string;
  signal?: AbortSignal;
  maxIterations?: number;
  hooks?: HookRegistry;
  session?: HookSession;
  /** §4.10 Task 10: 传入后，turn_end 后异步触发 LLM 摘要作为默认 label。 */
  storage?: StorageAdapter;
}

/**
 * §3.1 Layer 1 / §3.3 / §10.1.7.
 * Stateless ReAct generator. Emits AgentEvent stream and returns accumulated AgentMessage[].
 */
export function agentLoop(config: AgentLoopConfig): AsyncGenerator<AgentEvent, AgentMessage[]> {
  return agentLoopImpl(config);
}

async function* agentLoopImpl(
  config: AgentLoopConfig,
): AsyncGenerator<AgentEvent, AgentMessage[]> {
  const { provider, model, tools, context, systemPrompt, signal } = config;
  const hookRegistry = config.hooks;
  const session = config.session;
  const maxIterations = config.maxIterations ?? DEFAULT_MAX_ITERATIONS;
  const messages: AgentMessage[] = [];
  const contextMessages = [...context.messages];
  let completed = false;
  let exitReason: ExitReason = 'end_turn';

  // §12.3 agent_before: agent 循环开始前（一次）
  if (hookRegistry) {
    hookRegistry.trigger('agent_before', {
      messages: contextMessages,
      systemPrompt,
      session,
    });
  }

  try {
    yield { type: 'agent_start' };

    for (let iter = 0; iter < maxIterations; iter++) {
      if (signal?.aborted) break;

      const turnId = createTurnId();
      yield { type: 'turn_start', turnId };

      // §12.3 turn_before: 每个 turn 开始
      if (hookRegistry) {
        hookRegistry.trigger('turn_before', {
          turn: iter,
          messages: contextMessages,
          session,
        });
      }

      const messageId = createMessageId();
      yield { type: 'message_start', messageId };

      let textAccum = '';
      const toolCalls: ToolCall[] = [];
      let stopReason = DEFAULT_STOP_REASON;
      let hadToolCall = false;

      let streamCtx: Context = {
        systemPrompt,
        messages: contextMessages,
        tools: tools.getDefinitions(),
      };

      // §12.3 llm_before: 调 LLM 前（允许 mutate messages，链式传递）
      if (hookRegistry) {
        const llmCtx = hookRegistry.trigger('llm_before', {
          turn: iter,
          messages: contextMessages,
          provider,
        });
        streamCtx = { ...streamCtx, messages: llmCtx.messages };
      }

      const llmStart = Date.now();
      for await (const evt of provider.stream(model, streamCtx, { signal })) {
        if (signal?.aborted) break;
        if (evt.type === 'text' && evt.text !== undefined) {
          textAccum += evt.text;
          yield { type: 'message_delta', text: evt.text };
        } else if (evt.type === 'tool_call' && evt.toolCall) {
          const tc = evt.toolCall;
          yield { type: 'tool_call_start', toolCallId: tc.id, toolName: tc.name };
          yield { type: 'tool_call_delta', toolCallId: tc.id, arguments: tc.arguments };
          yield { type: 'tool_call_end', toolCallId: tc.id };
          toolCalls.push({ id: tc.id, name: tc.name, arguments: tc.arguments });
          hadToolCall = true;
        } else if (evt.type === 'stop') {
          stopReason = evt.stopReason ?? DEFAULT_STOP_REASON;
          break;
        }
      }

      if (signal?.aborted) break;

      // §12.3 llm_after: LLM 返回后
      if (hookRegistry) {
        hookRegistry.trigger('llm_after', {
          turn: iter,
          response: { text: textAccum, toolCalls, stopReason },
          latencyMs: Date.now() - llmStart,
          provider,
        });
      }

      yield { type: 'message_end', messageId, stopReason };

      const assistantMsg: AgentMessage = {
        id: messageId,
        role: 'assistant',
        content: textAccum,
        toolCalls: maybeToolCalls(toolCalls),
        stopReason,
        timestamp: Date.now(),
      };
      messages.push(assistantMsg);
      contextMessages.push({
        role: 'assistant',
        content: textAccum,
        toolCalls: maybeToolCalls(toolCalls),
      });

      if (hadToolCall) {
        for (const tc of toolCalls) {
          const tool = tools.get(tc.name);
          if (!tool) {
            yield {
              type: 'tool_result',
              toolCallId: tc.id,
              success: false,
              summary: `unknown tool: ${tc.name}`,
            };
            contextMessages.push({
              role: 'tool',
              content: `unknown tool: ${tc.name}`,
              toolCallId: tc.id,
            });
            continue;
          }
          let result;
          try {
            const params = JSON.parse(tc.arguments);

            // §12.3 tool_before: 工具执行前
            if (hookRegistry) {
              hookRegistry.trigger('tool_before', {
                toolName: tc.name,
                args: params,
                session,
              });
            }

            const toolStart = Date.now();
            result = await tool.execute(tc.id, params, signal);

            // §12.3 tool_after: 工具执行后
            if (hookRegistry) {
              hookRegistry.trigger('tool_after', {
                toolName: tc.name,
                args: params,
                result,
                latencyMs: Date.now() - toolStart,
                session,
              });
            }
          } catch (err) {
            result = {
              content: [{ type: 'text' as const, text: String(err) }],
              details: {},
              error: { code: 'execution_error', message: String(err) },
            };
          }
          const summary = result.content
            .map((c) => (c.type === 'text' ? c.text : ''))
            .join('');
          yield {
            type: 'tool_result',
            toolCallId: tc.id,
            success: !result.error,
            summary,
          };
          contextMessages.push({
            role: 'tool',
            content: result.content,
            toolCallId: tc.id,
          });
        }
      }

      // §12.3 turn_after: 每个 turn 结束
      if (hookRegistry) {
        hookRegistry.trigger('turn_after', {
          turn: iter,
          response: { text: textAccum, toolCalls, stopReason },
          toolCalls,
          session,
        });
      }

      yield { type: 'turn_end', turnId };

      // §4.10 Task 10: turn_end 后异步触发 LLM 摘要（fire-and-forget，不阻塞主流程）。
      // 仅当传入 storage + session 时触发；用户手动 /label 后永久跳过（hasCustomLabel 内部判断）。
      if (config.storage && session) {
        void triggerSessionSummary({
          sessionId: session.sessionId,
          provider,
          model,
          // 快照当前对话，避免后续 turn 修改 messages 导致摘要读到竞态数据
          messages: [...contextMessages],
          storage: config.storage,
        }).catch((e) => {
          summaryLog.warn('triggerSessionSummary error', {
            sessionId: session.sessionId,
            error: String(e),
          });
        });
      }

      if (!hadToolCall) {
        completed = true;
        break;
      }
    }

    if (!completed && !signal?.aborted) {
      exitReason = 'max_iterations_exceeded';
      yield { type: 'error', message: 'max_iterations_exceeded', retryable: false };
    } else if (signal?.aborted) {
      exitReason = 'aborted';
    }
  } finally {
    // §12.3 agent_after: agent 循环结束后（一次）
    if (hookRegistry) {
      hookRegistry.trigger('agent_after', {
        messages: contextMessages,
        exitReason,
        session,
      });
    }
    yield { type: 'agent_end' };
  }

  return messages;
}
