import React, { useState, useEffect } from 'react';
import { render, Box, Text } from 'ink';
import type { Channel, MessageBus } from '../bus/types.js';
import type { CommandRegistry } from '../shared/commands/registry.js';
import type { StorageAdapter } from '../infrastructure/storage/file-storage.js';
import type { FeedbackStorage } from '../infrastructure/feedback-storage.js';
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
}

/**
 * §8.1 / §8.5 createCLIApp: 创建 CLI 应用。
 * Ink + Yoga 渲染，reducer 驱动 UIState，斜杠命令通过 CommandRegistry 分发。
 */
export function createCLIApp(config: CLIAppConfig): CLIApp {
  const { channel, registry, model, bus, storage, sessionId, feedbackStorage } = config;

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
        />,
      );
      await waitUntilExit();
    },
  };
}

/**
 * I7+I8 修复：导出 CLIAppRoot 供组件级测试使用。
 * handleSubmit 使用注入的 storage/sessionId，并渲染命令输出。
 */
export function CLIAppRoot({
  registry,
  model,
  bus,
  storage,
  sessionId,
  feedbackStorage,
}: {
  registry: CommandRegistry;
  model: string;
  bus: MessageBus;
  storage: StorageAdapter;
  sessionId: string;
  feedbackStorage?: FeedbackStorage;
}): React.ReactElement {
  const [state, setState] = useState<UIState>(initialUIState);

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
        });
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
