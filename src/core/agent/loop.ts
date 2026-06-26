import type { AgentEvent } from './events.js';
import { createTurnId, createMessageId } from './events.js';
import type { Provider, Model, Context, AssistantMessageEvent } from '../provider/types.js';
import type { ToolRegistry } from '../tool/types.js';
import type { AgentMessage, ToolCall } from '../memory/agent-message.js';

export const DEFAULT_MAX_ITERATIONS = 10;
export const MAX_STEERING_QUEUE = 5;

export interface AgentLoopConfig {
  provider: Provider;
  model: Model;
  tools: ToolRegistry;
  context: Context;
  systemPrompt: string;
  signal?: AbortSignal;
  maxIterations?: number;
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
  const maxIterations = config.maxIterations ?? DEFAULT_MAX_ITERATIONS;
  const messages: AgentMessage[] = [];
  const contextMessages = [...context.messages];
  let completed = false;

  try {
    yield { type: 'agent_start' };

    for (let iter = 0; iter < maxIterations; iter++) {
      if (signal?.aborted) break;

      const turnId = createTurnId();
      yield { type: 'turn_start', turnId };

      const messageId = createMessageId();
      yield { type: 'message_start', messageId };

      let textAccum = '';
      const toolCalls: ToolCall[] = [];
      let stopReason = 'end_turn';
      let hadToolCall = false;

      const streamCtx: Context = {
        systemPrompt,
        messages: contextMessages,
        tools: tools.getDefinitions(),
      };

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
          stopReason = evt.stopReason ?? 'end_turn';
          break;
        }
      }

      if (signal?.aborted) break;

      yield { type: 'message_end', messageId, stopReason };

      const assistantMsg: AgentMessage = {
        id: messageId,
        role: 'assistant',
        content: textAccum,
        toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
        stopReason,
        timestamp: Date.now(),
      };
      messages.push(assistantMsg);
      contextMessages.push({
        role: 'assistant',
        content: textAccum,
        toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
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
            result = await tool.execute(tc.id, params, signal);
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
        yield { type: 'turn_end', turnId };
      } else {
        yield { type: 'turn_end', turnId };
        completed = true;
        break;
      }
    }

    if (!completed && !signal?.aborted) {
      yield { type: 'error', message: 'max_iterations_exceeded', retryable: false };
    }
  } finally {
    yield { type: 'agent_end' };
  }

  return messages;
}
