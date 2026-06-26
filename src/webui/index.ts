import './components/assistant-message.js';
import './components/user-message.js';
import './components/tool-execution.js';
import './components/working-indicator.js';
import './components/footer-bar.js';
import './components/input-box.js';

import type { CommandRegistry } from '../shared/commands/registry.js';
import { coreReducer, initialUIState } from '../shared/ui-state/reducer.js';
import type { AgentEvent } from '../core/agent/events.js';

export interface WebUIApp {
  start(): Promise<void>;
}

export interface WebUIAppConfig {
  wsUrl: string;
  registry: CommandRegistry;
  authToken?: string;
}

interface AppElements {
  messagesEl: HTMLElement;
  inputEl: HTMLElement & { addEventListener: (type: string, listener: (e: Event) => void) => void };
  footerEl: HTMLElement & { model: string };
  workingEl: HTMLElement & { isWorking: boolean };
}

function createElements(): AppElements {
  const messagesEl = document.createElement('div');
  messagesEl.id = 'messages';

  const workingEl = document.createElement('working-indicator') as AppElements['workingEl'];
  const footerEl = document.createElement('footer-bar') as AppElements['footerEl'];
  const inputEl = document.createElement('input-box') as AppElements['inputEl'];

  document.body.appendChild(messagesEl);
  document.body.appendChild(workingEl);
  document.body.appendChild(inputEl);
  document.body.appendChild(footerEl);

  return { messagesEl, inputEl, footerEl, workingEl };
}

function renderMessages(container: HTMLElement, messages: Array<{ role: string; text: string }>): void {
  container.innerHTML = '';
  for (const m of messages) {
    const el = document.createElement(m.role === 'user' ? 'user-message' : 'assistant-message');
    (el as unknown as { text: string }).text = m.text;
    container.appendChild(el);
  }
}

export function createWebUIApp(config: WebUIAppConfig): WebUIApp {
  return {
    async start() {
      const els = createElements();
      let state = initialUIState;
      els.footerEl.model = config.wsUrl;

      const ws = new WebSocket(
        config.authToken
          ? `${config.wsUrl}?token=${encodeURIComponent(config.authToken)}`
          : config.wsUrl,
      );

      ws.addEventListener('message', (event) => {
        try {
          const envelope = JSON.parse(event.data as string) as { event: AgentEvent };
          state = coreReducer(state, envelope.event);
          renderMessages(els.messagesEl, state.messages);
          (els.workingEl as unknown as { isWorking: boolean }).isWorking = state.isWorking;
        } catch {
          // ignore malformed
        }
      });

      els.inputEl.addEventListener('submit', (e: Event) => {
        const detail = (e as CustomEvent).detail as { text: string };
        const text = detail.text;
        if (text.startsWith('/')) {
          const result = config.registry.resolve(text);
          if (result?.action === 'exit') {
            ws.close();
            return;
          }
          return;
        }
        ws.send(JSON.stringify({ type: 'message', text }));
      });
    },
  };
}
