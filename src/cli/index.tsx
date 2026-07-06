import React, { useState, useEffect } from 'react';
import { render, Box, Text } from 'ink';
import type { Channel, MessageBus } from '../bus/types.js';
import type { CommandRegistry } from '../shared/commands/registry.js';
import type { StorageAdapter } from '../infrastructure/storage/file-storage.js';
import type { FeedbackStorage } from '../infrastructure/feedback-storage.js';
import type { AgentStorage } from '../core/agent/agent-storage.js';
import type { MemoryAuditLog } from '../core/agent/memory-audit-log.js';
import type { SkillState } from '../core/skills/loader.js';
import { coreReducer, initialUIState, type UIState } from '../shared/ui-state/reducer.js';
import { AssistantMessage } from './components/assistant-message.js';
import { UserMessage } from './components/user-message.js';
import { ToolExecution } from './components/tool-execution.js';
import { WorkingLoader } from './components/working-loader.js';
import { Footer } from './components/footer.js';
import { InputEditor } from './components/input-editor.js';

export interface CLIApp {
  start(): Promise<void>;
}

export interface CLIAppConfig {
  channel: Channel;
  registry: CommandRegistry;
  model: string;
  bus: MessageBus;
  // I7 修复：注入真实 StorageAdapter + sessionId，取代 handleSubmit 中的 fake storage
  storage: StorageAdapter;
  sessionId: string;
  // Task 12: 可选 FeedbackStorage，feedbackEnabled:false 时不传入，/feedback 提示未启用
  feedbackStorage?: FeedbackStorage;
  /** Task 12: /agent 命令使用的 AgentStorage；未注入时 /agent 提示未启用 */
  agentStorage?: AgentStorage;
  /** Task 12: 当前 session 的 agent slug；/agent 用于 (current) 标记 + /agent info */
  currentAgentSlug?: string;
  /** Task 12: MemoryAuditLog 工厂，按 (userId, slug) 创建实例以查询审计日志 */
  memoryAuditLogFactory?: (userId: string, slug: string) => MemoryAuditLog;
  /** Task 12: /skill 命令使用的 SkillState；未注入时 /skill 提示未加载 */
  skillState?: SkillState;
  /** Task 6: 当前用户 ID，用于 /agent 列出该用户的 agents */
  userId?: string;
}

/**
 * §8.1 / §8.5 createCLIApp: 创建 CLI 应用。
 * Ink + Yoga 渲染，reducer 驱动 UIState，斜杠命令通过 CommandRegistry 分发。
 */
export function createCLIApp(config: CLIAppConfig): CLIApp {
  const {
    channel, registry, model, bus, storage, sessionId,
    feedbackStorage, agentStorage, currentAgentSlug,
    memoryAuditLogFactory, skillState, userId,
  } = config;

  return {
    async start(): Promise<void> {
      await channel.start(bus);

      const { waitUntilExit } = render(
        <CLIAppRoot
          registry={registry}
          model={model}
          bus={bus}
          storage={storage}
          sessionId={sessionId}
          feedbackStorage={feedbackStorage}
          agentStorage={agentStorage}
          initialAgentSlug={currentAgentSlug}
          memoryAuditLogFactory={memoryAuditLogFactory}
          skillState={skillState}
          userId={userId}
        />,
      );
      await waitUntilExit();
    },
  };
}

/**
 * I7+I8 修复：导出 CLIAppRoot 供组件级测试使用。
 * handleSubmit 使用注入的 storage/sessionId，并渲染命令输出。
 *
 * Task 12: 新增 agentStorage / currentAgentSlug / memoryAuditLogFactory / skillState / userId
 * 注入；handleSubmit 处理 action='switch_agent' 时更新 currentAgentSlug state。
 */
export function CLIAppRoot({
  registry,
  model,
  bus,
  storage,
  sessionId,
  feedbackStorage,
  agentStorage,
  initialAgentSlug,
  memoryAuditLogFactory,
  skillState,
  userId,
}: {
  registry: CommandRegistry;
  model: string;
  bus: MessageBus;
  storage: StorageAdapter;
  sessionId: string;
  feedbackStorage?: FeedbackStorage;
  agentStorage?: AgentStorage;
  initialAgentSlug?: string;
  memoryAuditLogFactory?: (userId: string, slug: string) => MemoryAuditLog;
  skillState?: SkillState;
  userId?: string;
}): React.ReactElement {
  const [state, setState] = useState<UIState>(initialUIState);
  // Task 12: 当前 session 的 agent slug 状态（由 /agent <slug> 切换更新）
  const [currentAgentSlug, setCurrentAgentSlug] = useState<string | undefined>(initialAgentSlug);

  useEffect(() => {
    let active = true;
    // I14 修复：cancel promise + Promise.race 使 unmount 时 loop 能退出
    // 否则 await bus.consumeOutbound() 永远阻塞，closure 泄漏
    let cancelResolve: (() => void) | null = null;
    const cancelPromise = new Promise<null>((resolve) => {
      cancelResolve = () => resolve(null);
    });
    const outboundLoop = async () => {
      while (active) {
        try {
          const envelope = await Promise.race([
            bus.consumeOutbound(),
            cancelPromise,
          ]);
          if (!active || envelope === null) break;
          setState((prev) => coreReducer(prev, envelope.event));
        } catch {
          break;
        }
      }
    };
    outboundLoop();
    return () => {
      active = false;
      cancelResolve?.();
      // 清除 stale waiter，使后续事件入队列而非被 orphan promise 消费
      bus.cancelOutboundWaiter?.();
    };
  }, [bus]);

  const handleSubmit = async (text: string) => {
    if (text.startsWith('/')) {
      const resolved = registry.resolve(text);
      if (resolved) {
        // I7 修复：使用注入的 storage + sessionId，不再创建 fake adapter
        const result = await resolved.command.execute(resolved.args, {
          sessionId,
          model,
          storage,
          feedbackStorage,
          agentStorage,
          currentAgentSlug,
          memoryAuditLogFactory,
          skillState,
          userId,
        });
        // Task 12: /agent <slug> 切换 agent — 更新 currentAgentSlug state
        if (result.action === 'switch_agent' && result.agentSlug) {
          setCurrentAgentSlug(result.agentSlug);
        }
        // I8 修复：渲染命令输出到 UI
        if (result.output) {
          const output = result.output;
          setState((prev) => ({
            ...prev,
            messages: [...prev.messages, {
              id: `cmd-${Date.now()}`,
              role: 'assistant' as const,
              text: output,
            }],
          }));
        }
      }
      return;
    }
    setState((prev) => ({
      ...prev,
      messages: [...prev.messages, { id: `u-${Date.now()}`, role: 'user' as const, text }],
    }));
    bus.publishInbound({
      channel: 'cli',
      senderId: 'user',
      chatId: 'default',
      content: text,
      metadata: {},
    });
  };

  return (
    <Box flexDirection="column">
      {state.messages.map((msg) => {
        if (msg.role === 'user') {
          return <UserMessage key={msg.id} text={msg.text} />;
        }
        return (
          <Box key={msg.id} flexDirection="column">
            <AssistantMessage text={msg.text} isStreaming={msg.isStreaming} />
            {msg.toolCalls?.map((tc) => (
              <ToolExecution key={tc.id} name={tc.name} status={tc.status} />
            ))}
          </Box>
        );
      })}
      <WorkingLoader isWorking={state.isWorking} />
      {state.error && <Text color="red">{`Error: ${state.error}`}</Text>}
      <InputEditor onSubmit={handleSubmit} />
      <Footer model={model} />
    </Box>
  );
}
