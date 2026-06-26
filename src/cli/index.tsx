import React, { useState, useEffect } from 'react';
import { render, Box, Text } from 'ink';
import type { Channel, MessageBus } from '../bus/types.js';
import type { CommandRegistry } from '../shared/commands/registry.js';
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
}

/**
 * §8.1 / §8.5 createCLIApp: 创建 CLI 应用。
 * Ink + Yoga 渲染，reducer 驱动 UIState，斜杠命令通过 CommandRegistry 分发。
 */
export function createCLIApp(config: CLIAppConfig): CLIApp {
  const { channel, registry, model, bus } = config;

  return {
    async start(): Promise<void> {
      await channel.start(bus);

      const { waitUntilExit } = render(
        <CLIAppRoot
          registry={registry}
          model={model}
          bus={bus}
        />,
      );
      await waitUntilExit();
    },
  };
}

function CLIAppRoot({
  registry,
  model,
  bus,
}: {
  registry: CommandRegistry;
  model: string;
  bus: MessageBus;
}): React.ReactElement {
  const [state, setState] = useState<UIState>(initialUIState);

  useEffect(() => {
    let active = true;
    const outboundLoop = async () => {
      while (active) {
        try {
          const envelope = await bus.consumeOutbound();
          if (!active) break;
          setState((prev) => coreReducer(prev, envelope.event));
        } catch {
          break;
        }
      }
    };
    outboundLoop();
    return () => {
      active = false;
    };
  }, [bus]);

  const handleSubmit = (text: string) => {
    if (text.startsWith('/')) {
      const resolved = registry.resolve(text);
      if (resolved) {
        resolved.command.execute(resolved.args, {
          sessionId: 'cli-session',
          model,
          storage: {
            readSession: async () => [],
            appendSession: async () => {},
            listSessions: async () => [],
            readWorkingMemory: async () => null,
            writeWorkingMemory: async () => {},
            deleteSession: async () => {},
          },
        });
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
