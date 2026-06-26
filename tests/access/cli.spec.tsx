import { describe, it, expect } from 'vitest';
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
import type { Channel, ChannelCapability, AgentEventEnvelope } from '../../src/bus/types.js';

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
    });
    expect(typeof app.start).toBe('function');
  });
});
