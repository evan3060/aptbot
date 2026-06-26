// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from 'vitest';
import '../../src/webui/components/assistant-message.js';
import '../../src/webui/components/user-message.js';
import '../../src/webui/components/tool-execution.js';
import '../../src/webui/components/working-indicator.js';
import '../../src/webui/components/footer-bar.js';
import '../../src/webui/components/input-box.js';
import type { AssistantMessage } from '../../src/webui/components/assistant-message.js';
import type { UserMessage } from '../../src/webui/components/user-message.js';
import type { ToolExecution } from '../../src/webui/components/tool-execution.js';
import type { WorkingIndicator } from '../../src/webui/components/working-indicator.js';
import type { FooterBar } from '../../src/webui/components/footer-bar.js';
import type { InputBox } from '../../src/webui/components/input-box.js';

async function waitFor<T>(fn: () => T, timeout = 1000): Promise<T> {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    try {
      return fn();
    } catch {
      await new Promise((r) => setTimeout(r, 10));
    }
  }
  return fn();
}

async function settled(el: HTMLElement): Promise<void> {
  await (el as unknown as { updateComplete?: Promise<unknown> }).updateComplete;
  await new Promise((r) => setTimeout(r, 0));
}

describe('WebUI Components', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('<assistant-message> renders text', async () => {
    const el = document.createElement('assistant-message') as AssistantMessage;
    el.text = 'Hello from assistant';
    document.body.appendChild(el);
    await settled(el);
    expect(el.shadowRoot?.textContent).toContain('Hello from assistant');
  });

  it('<user-message> renders input', async () => {
    const el = document.createElement('user-message') as UserMessage;
    el.text = 'What is the weather?';
    document.body.appendChild(el);
    await settled(el);
    expect(el.shadowRoot?.textContent).toContain('What is the weather?');
  });

  it('<tool-execution> shows status running', async () => {
    const el = document.createElement('tool-execution') as ToolExecution;
    el.name = 'bash';
    el.status = 'running';
    document.body.appendChild(el);
    await settled(el);
    expect(el.shadowRoot?.textContent).toContain('bash');
  });

  it('<tool-execution> shows status success', async () => {
    const el = document.createElement('tool-execution') as ToolExecution;
    el.name = 'read';
    el.status = 'success';
    document.body.appendChild(el);
    await settled(el);
    expect(el.shadowRoot?.textContent).toContain('read');
  });

  it('<working-indicator> visible when isWorking=true', async () => {
    const el = document.createElement('working-indicator') as WorkingIndicator;
    el.isWorking = true;
    document.body.appendChild(el);
    await settled(el);
    expect(el.shadowRoot?.textContent).toBeTruthy();
    expect(el.shadowRoot!.textContent!.trim().length).toBeGreaterThan(0);
  });

  it('<working-indicator> empty when isWorking=false', async () => {
    const el = document.createElement('working-indicator') as WorkingIndicator;
    el.isWorking = false;
    document.body.appendChild(el);
    await settled(el);
    expect(el.shadowRoot?.textContent?.trim() ?? '').toBe('');
  });

  it('<footer-bar> shows model name', async () => {
    const el = document.createElement('footer-bar') as FooterBar;
    el.model = 'gpt-4';
    document.body.appendChild(el);
    await settled(el);
    expect(el.shadowRoot?.textContent).toContain('gpt-4');
  });

  it('<input-box> dispatches submit event with value', async () => {
    const el = document.createElement('input-box') as InputBox;
    document.body.appendChild(el);
    await settled(el);

    const input = el.shadowRoot?.querySelector('input');
    expect(input).toBeTruthy();
    input!.value = 'hello world';
    input!.dispatchEvent(new Event('input', { bubbles: true }));

    let submitted = '';
    el.addEventListener('submit', (e: Event) => {
      const detail = (e as CustomEvent).detail as { text: string };
      submitted = detail.text;
    });

    const form = el.shadowRoot?.querySelector('form');
    expect(form).toBeTruthy();
    form!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));

    await waitFor(() => {
      if (!submitted) throw new Error('not yet');
    });
    expect(submitted).toBe('hello world');
  });
});
