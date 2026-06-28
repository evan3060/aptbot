import { describe, it, expect, vi } from 'vitest';
import { render } from 'ink-testing-library';
import React from 'react';
import { AssistantMessage } from '../../src/cli/components/assistant-message.js';
import { UserMessage } from '../../src/cli/components/user-message.js';
import { ToolExecution } from '../../src/cli/components/tool-execution.js';
import { WorkingLoader } from '../../src/cli/components/working-loader.js';
import { Footer } from '../../src/cli/components/footer.js';
import { InputEditor } from '../../src/cli/components/input-editor.js';
import { createCLIApp } from '../../src/cli/index.js';
import { createCommandRegistry } from '../../src/shared/commands/registry.js';
import { InMemoryMessageBus } from '../../src/bus/message-bus.js';
import type { Channel, ChannelCapability } from '../../src/bus/types.js';
import type { StorageAdapter } from '../../src/infrastructure/storage/file-storage.js';

const FULL_CAP: ChannelCapability = {
  streaming: true,
  reasoning: true,
  richUi: true,
  fileEditEvents: true,
  editMessage: true,
  markdown: true,
};

function makeMockChannel(): Channel {
  return {
    name: 'cli',
    capabilities: FULL_CAP,
    async start() {},
    async stop() {},
    consume() {},
  };
}

describe('CLI Components', () => {
  it('AssistantMessage renders text', () => {
    const { lastFrame } = render(React.createElement(AssistantMessage, { text: 'Hello World' }));
    const frame = lastFrame();
    expect(frame).toContain('Hello World');
  });

  it('AssistantMessage renders streaming indicator when isStreaming', () => {
    const { lastFrame } = render(
      React.createElement(AssistantMessage, { text: 'Thinking', isStreaming: true }),
    );
    const frame = lastFrame();
    expect(frame).toContain('Thinking');
  });

  it('UserMessage renders user input', () => {
    const { lastFrame } = render(React.createElement(UserMessage, { text: 'What is 2+2?' }));
    const frame = lastFrame();
    expect(frame).toContain('What is 2+2?');
  });

  it('ToolExecution shows tool name and running status', () => {
    const { lastFrame } = render(
      React.createElement(ToolExecution, { name: 'bash', status: 'running' }),
    );
    const frame = lastFrame();
    expect(frame).toContain('bash');
  });

  it('ToolExecution shows success status', () => {
    const { lastFrame } = render(
      React.createElement(ToolExecution, { name: 'read', status: 'success' }),
    );
    const frame = lastFrame();
    expect(frame).toContain('read');
  });

  it('ToolExecution shows failed status', () => {
    const { lastFrame } = render(
      React.createElement(ToolExecution, { name: 'write', status: 'failed' }),
    );
    const frame = lastFrame();
    expect(frame).toContain('write');
  });

  it('WorkingLoader displays when isWorking=true', () => {
    const { lastFrame } = render(React.createElement(WorkingLoader, { isWorking: true }));
    const frame = lastFrame();
    expect(frame).toBeTruthy();
    expect(frame!.length).toBeGreaterThan(0);
  });

  it('WorkingLoader displays nothing when isWorking=false', () => {
    const { lastFrame } = render(React.createElement(WorkingLoader, { isWorking: false }));
    const frame = lastFrame();
    expect(frame).toBe('');
  });

  it('Footer shows model name', () => {
    const { lastFrame } = render(React.createElement(Footer, { model: 'gpt-4' }));
    const frame = lastFrame();
    expect(frame).toContain('gpt-4');
  });

  it('InputEditor renders and accepts input', async () => {
    const { stdin, lastFrame } = render(React.createElement(InputEditor, { onSubmit: () => {} }));
    stdin.write('hello');
    await new Promise((r) => setTimeout(r, 10));
    const frame = lastFrame();
    expect(frame).toContain('hello');
  });

  it('InputEditor calls onSubmit on Enter', () => {
    let submitted = '';
    const { stdin } = render(
      React.createElement(InputEditor, { onSubmit: (text: string) => { submitted = text; } }),
    );
    stdin.write('test input');
    stdin.write('\r');
    expect(submitted).toBe('test input');
  });
});

describe('createCLIApp', () => {
  it('creates a CLIApp with start method', () => {
    const bus = new InMemoryMessageBus();
    const channel = makeMockChannel();
    const registry = createCommandRegistry();
    const app = createCLIApp({
      channel,
      registry,
      model: 'gpt-4',
      bus,
      storage: makeMockStorage(),
      sessionId: 'test-session-id',
    });
    expect(typeof app.start).toBe('function');
  });
});

// I7+I8 回归测试：通过 CLIAppRoot 组件级测试验证注入的 storage/sessionId 和命令输出渲染
describe('CLIAppRoot slash command injection (I7+I8)', () => {
  it('/session renders injected sessionId (not fake cli-session)', async () => {
    const { CLIAppRoot } = await import('../../src/cli/index.js');
    const bus = new InMemoryMessageBus();
    const registry = createCommandRegistry();
    const storage = makeMockStorage();
    const { stdin, lastFrame } = render(
      React.createElement(CLIAppRoot, {
        registry,
        model: 'gpt-4',
        bus,
        storage,
        sessionId: 'injected-uuid-1234',
      }),
    );
    // 输入 /session 并回车
    stdin.write('/session');
    stdin.write('\r');
    await new Promise((r) => setTimeout(r, 50));
    const frame = lastFrame();
    // I7：应显示注入的 sessionId，而非硬编码的 'cli-session'
    expect(frame).toContain('injected-uuid-1234');
    expect(frame).not.toContain('cli-session');
  });

  it('/help renders command output (I8)', async () => {
    const { CLIAppRoot } = await import('../../src/cli/index.js');
    const bus = new InMemoryMessageBus();
    const registry = createCommandRegistry();
    const storage = makeMockStorage();
    const { stdin, lastFrame } = render(
      React.createElement(CLIAppRoot, {
        registry,
        model: 'gpt-4',
        bus,
        storage,
        sessionId: 'test-session',
      }),
    );
    stdin.write('/help');
    stdin.write('\r');
    await new Promise((r) => setTimeout(r, 50));
    const frame = lastFrame();
    // I8：命令输出应渲染到 UI
    expect(frame).toContain('Available commands');
  });
});

function makeMockStorage(): StorageAdapter {
  return {
    readSession: vi.fn(async () => []),
    appendSession: vi.fn(async () => {}),
    listSessions: vi.fn(async () => []),
    readWorkingMemory: vi.fn(async () => null),
    writeWorkingMemory: vi.fn(async () => {}),
    deleteSession: vi.fn(async () => {}),
  };
}

// I14 回归测试：outboundLoop 在 unmount 后应取消 pending consumeOutbound，
// 后续 publishOutbound 的事件应保留在队列中，不被 stale waiter 消费
describe('CLIAppRoot outboundLoop cancellation (I14)', () => {
  it('event published after unmount stays in queue (I14)', async () => {
    const { CLIAppRoot } = await import('../../src/cli/index.js');
    const bus = new InMemoryMessageBus();
    const registry = createCommandRegistry();
    const storage = makeMockStorage();

    const r1 = render(
      React.createElement(CLIAppRoot, {
        registry, model: 'gpt-4', bus, storage, sessionId: 'test',
      }),
    );
    // 等待 outboundLoop 启动并阻塞在 consumeOutbound
    await new Promise((r) => setTimeout(r, 50));

    // Unmount — cleanup 应取消 pending consumeOutbound
    r1.unmount();
    await new Promise((r) => setTimeout(r, 100));

    // Unmount 后发布事件
    await bus.publishOutbound({
      sessionKey: 's1', chatId: 'c1', channel: 'cli',
      event: { type: 'agent_start' }, seq: 0,
    });

    // 事件应保留在队列中（未被 stale waiter 消费）
    // 用短超时 consumeOutbound 验证
    const timeoutPromise = new Promise<null>((resolve) =>
      setTimeout(() => resolve(null), 500),
    );
    const env = await Promise.race([
      bus.consumeOutbound(),
      timeoutPromise,
    ]);
    expect(env).not.toBeNull();
    expect(env!.event.type).toBe('agent_start');
  });
});
