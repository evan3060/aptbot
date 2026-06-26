import { createLogger } from '../../infrastructure/logger.js';
import { createMessage } from '../memory/agent-message.js';
import type { AgentMessage, ToolCall } from '../memory/agent-message.js';
import type { SessionEntry } from '../memory/types.js';
import type { AgentEvent } from './events.js';
import type { AgentLoopConfig } from './loop.js';
import type { Provider, Model, ContextMessage } from '../provider/types.js';
import type { ToolRegistry } from '../tool/types.js';
import type { StorageAdapter } from '../../infrastructure/storage/file-storage.js';

export interface AgentSessionConfig {
  storage: StorageAdapter;
  sessionId: string;
  agentLoop: (config: AgentLoopConfig) => AsyncGenerator<AgentEvent, AgentMessage[]>;
  provider: Provider;
  model: Model;
  tools: ToolRegistry;
  systemPrompt: string;
  reserveTokens?: number;
}

export interface AgentSession {
  readonly sessionId: string;
  run(userMessage: string): AsyncGenerator<AgentEvent>;
  pushSteering(message: AgentMessage): void;
  getWorkingMemory(): Promise<string | null>;
}

/**
 * §3.1 Layer 2 / §3.4 错误处理 / §10.4 turn 原子性。
 * 有状态封装：持有 context / steering 队列 / session 存储。
 * turn 结束后持久化 entries；错误响应不持久化。
 */
export function createAgentSession(config: AgentSessionConfig): AgentSession {
  const log = createLogger('agent-session');
  const { storage, sessionId, agentLoop, provider, model, tools, systemPrompt } = config;
  const contextMessages: ContextMessage[] = [];
  const steeringQueue: AgentMessage[] = [];
  const MAX_STEERING_QUEUE = 5;

  function drainSteeringQueue(): void {
    while (steeringQueue.length > 0) {
      const msg = steeringQueue.shift()!;
      contextMessages.push({
        role: msg.role,
        content: msg.content,
        toolCallId: msg.toolCallId,
        toolCalls: msg.toolCalls,
      });
    }
  }

  async function* run(userMessage: string): AsyncGenerator<AgentEvent> {
    const userMsg = createMessage('user', userMessage);
    contextMessages.push({ role: 'user', content: userMessage });

    drainSteeringQueue();

    let bufferedEntries: SessionEntry[] = [
      { type: 'message', id: userMsg.id, message: userMsg, timestamp: userMsg.timestamp },
    ];
    let turnHasError = false;
    let currentMessageId = '';
    let textAccum = '';
    let toolCalls: ToolCall[] = [];
    let currentToolCall: ToolCall | null = null;

    const gen = agentLoop({
      provider,
      model,
      tools,
      context: {
        systemPrompt,
        messages: contextMessages,
        tools: tools.getDefinitions(),
      },
      systemPrompt,
    });

    while (true) {
      const result = await gen.next();
      if (result.done) break;
      const evt = result.value;
      yield evt;

      switch (evt.type) {
        case 'turn_start':
          turnHasError = false;
          break;
        case 'message_start':
          currentMessageId = evt.messageId;
          textAccum = '';
          toolCalls = [];
          break;
        case 'message_delta':
          textAccum += evt.text;
          break;
        case 'tool_call_start':
          currentToolCall = { id: evt.toolCallId, name: evt.toolName, arguments: '' };
          break;
        case 'tool_call_delta':
          if (currentToolCall) currentToolCall.arguments += evt.arguments;
          break;
        case 'tool_call_end':
          if (currentToolCall) {
            toolCalls.push(currentToolCall);
            currentToolCall = null;
          }
          break;
        case 'message_end': {
          const assistantMsg: AgentMessage = {
            id: currentMessageId,
            role: 'assistant',
            content: textAccum,
            toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
            stopReason: evt.stopReason,
            timestamp: Date.now(),
          };
          bufferedEntries.push({
            type: 'message',
            id: assistantMsg.id,
            message: assistantMsg,
            timestamp: assistantMsg.timestamp,
          });
          contextMessages.push({
            role: 'assistant',
            content: textAccum,
            toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
          });
          break;
        }
        case 'tool_result': {
          const toolMsg: AgentMessage = {
            id: evt.toolCallId,
            role: 'tool',
            content: evt.summary,
            toolCallId: evt.toolCallId,
            timestamp: Date.now(),
          };
          bufferedEntries.push({
            type: 'message',
            id: toolMsg.id,
            message: toolMsg,
            timestamp: toolMsg.timestamp,
          });
          contextMessages.push({
            role: 'tool',
            content: evt.summary,
            toolCallId: evt.toolCallId,
          });
          break;
        }
        case 'error':
          turnHasError = true;
          break;
        case 'turn_end':
          if (!turnHasError) {
            for (const entry of bufferedEntries) {
              await storage.appendSession(sessionId, entry);
            }
          }
          bufferedEntries = [];
          drainSteeringQueue();
          break;
      }
    }
  }

  function pushSteering(message: AgentMessage): void {
    steeringQueue.push(message);
    if (steeringQueue.length > MAX_STEERING_QUEUE) {
      const dropped = steeringQueue.shift();
      log.warn('steering queue overflow, dropped oldest', {
        droppedId: dropped?.id,
      });
    }
  }

  async function getWorkingMemory(): Promise<string | null> {
    return storage.readWorkingMemory(sessionId);
  }

  return {
    sessionId,
    run,
    pushSteering,
    getWorkingMemory,
  };
}
