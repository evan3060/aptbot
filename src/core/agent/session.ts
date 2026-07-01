import { Mutex } from 'async-mutex';
import { createLogger } from '../../infrastructure/logger.js';
import { createMessage } from '../memory/agent-message.js';
import type { AgentMessage, ToolCall } from '../memory/agent-message.js';
import type { SessionEntry } from '../memory/types.js';
import type { AgentEvent } from './events.js';
import { MAX_STEERING_QUEUE, maybeToolCalls } from './loop.js';
import type { AgentLoopConfig } from './loop.js';
import type { Provider, Model, ContextMessage } from '../provider/types.js';
import type { ToolRegistry } from '../tool/types.js';
import type { StorageAdapter } from '../../infrastructure/storage/file-storage.js';
import type { HookRegistry } from './hooks.js';

export interface AgentSessionConfig {
  storage: StorageAdapter;
  sessionId: string;
  agentLoop: (config: AgentLoopConfig) => AsyncGenerator<AgentEvent, AgentMessage[]>;
  provider: Provider;
  model: Model;
  tools: ToolRegistry;
  systemPrompt: string;
  reserveTokens?: number;
  hooks?: HookRegistry;
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
  const hookRegistry = config.hooks;
  const contextMessages: ContextMessage[] = [];
  const steeringQueue: AgentMessage[] = [];
  // I5 修复：per-session turn 互斥锁，防止并发 run() 交错 mutating contextMessages
  const turnMutex = new Mutex();
  // 修复：重启后加载历史上下文，避免 session 记忆丢失
  let historyLoaded = false;

  async function loadHistory(): Promise<void> {
    if (historyLoaded) return;
    historyLoaded = true;
    try {
      const entries = await storage.readSession(sessionId);
      for (const entry of entries) {
        if (entry.type === 'message') {
          contextMessages.push({
            role: entry.message.role,
            content: entry.message.content,
            toolCallId: entry.message.toolCallId,
            toolCalls: entry.message.toolCalls,
          });
        }
      }
      if (contextMessages.length > 0) {
        log.info('loaded session history', { sessionId, entries: entries.length, messages: contextMessages.length });
      }
    } catch (err) {
      log.warn('failed to load session history', { sessionId, error: String(err) });
    }
  }

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
    // I5 修复：串行化 turn —— 第二个 run() 会阻塞直到前一个完成（或抛出）
    const release = await turnMutex.acquire();
    try {
      // 修复：首次 run 时加载历史上下文
      await loadHistory();
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
        hooks: hookRegistry,
        session: { sessionId },
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
              toolCalls: maybeToolCalls(toolCalls),
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
              toolCalls: maybeToolCalls(toolCalls),
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
    } finally {
      release();
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
