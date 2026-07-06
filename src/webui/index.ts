import './components/assistant-message.js';
import './components/user-message.js';
import './components/tool-execution.js';
import './components/working-indicator.js';
import './components/footer-bar.js';
import './components/input-box.js';
import './components/agent-sidebar.js';

import type { CommandRegistry } from '../shared/commands/registry.js';
import { coreReducer, initialUIState } from '../shared/ui-state/reducer.js';
import type { AgentEvent } from '../core/agent/events.js';
import type { AgentProfile } from '../core/agent/agent-profile.js';
import type { SessionMetadata } from '../core/memory/types.js';
import type { AgentSidebar } from './components/agent-sidebar.js';

export interface WebUIApp {
  start(): Promise<void>;
}

export interface WebUIAppConfig {
  wsUrl: string;
  registry: CommandRegistry;
  authToken?: string;
  /** §0.3.0 Task 13: 可选 agent 列表（由 server.ts 注入，来自 GET /api/agents） */
  agents?: AgentProfile[];
  /** §0.3.0 Task 13: 可选 session 列表（由 server.ts 注入，来自 GET /api/sessions） */
  sessions?: SessionMetadata[];
  /** §0.3.0 Task 13: 当前选中的 agent slug */
  currentAgentSlug?: string;
  /** §0.3.0 Task 13: 当前选中的 session id */
  currentSessionId?: string;
}

interface AppElements {
  sidebarEl: AgentSidebar;
  messagesEl: HTMLElement;
  inputEl: HTMLElement & { addEventListener: (type: string, listener: (e: Event) => void) => void };
  footerEl: HTMLElement & { model: string };
  workingEl: HTMLElement & { isWorking: boolean };
}

function createElements(config: WebUIAppConfig): AppElements {
  // §0.3.0 Task 13: 左侧 agent 树形结构 sidebar
  const sidebarEl = document.createElement('agent-sidebar') as AgentSidebar;
  sidebarEl.agents = config.agents ?? [];
  sidebarEl.sessions = config.sessions ?? [];
  sidebarEl.currentAgentSlug = config.currentAgentSlug ?? 'default';
  sidebarEl.currentSessionId = config.currentSessionId ?? '';

  const messagesEl = document.createElement('div');
  messagesEl.id = 'messages';

  const workingEl = document.createElement('working-indicator') as AppElements['workingEl'];
  const footerEl = document.createElement('footer-bar') as AppElements['footerEl'];
  const inputEl = document.createElement('input-box') as AppElements['inputEl'];

  document.body.appendChild(sidebarEl);
  document.body.appendChild(messagesEl);
  document.body.appendChild(workingEl);
  document.body.appendChild(inputEl);
  document.body.appendChild(footerEl);

  return { sidebarEl, messagesEl, inputEl, footerEl, workingEl };
}

function renderMessages(container: HTMLElement, messages: Array<{ role: string; text: string }>): void {
  container.innerHTML = '';
  for (const m of messages) {
    const el = document.createElement(m.role === 'user' ? 'user-message' : 'assistant-message') as HTMLElement & { text: string };
    el.text = m.text;
    container.appendChild(el);
  }
}

export function createWebUIApp(config: WebUIAppConfig): WebUIApp {
  return {
    async start() {
      const els = createElements(config);
      let state = initialUIState;
      els.footerEl.model = config.wsUrl;

      const ws = new WebSocket(
        config.authToken
          ? `${config.wsUrl}?token=${encodeURIComponent(config.authToken)}`
          : config.wsUrl,
      );

      // §0.3.0 Task 13: 透传 agent-sidebar 事件到上层。
      // 上层（server.ts / 集成测试）可通过 addEventListener 监听这些事件
      // 实现 agent 切换 / session 切换 / 打开设置浮层 / 新建 session / 新建 agent。
      // reducer pattern：sidebar 的状态（agents/sessions/currentX）由 index.ts 统一更新，
      // 这里只做事件转发（让 ws 发送 /resume 等命令由 server.ts 处理）。
      els.sidebarEl.addEventListener('session-click', (e: Event) => {
        const detail = (e as CustomEvent).detail as { sessionId: string };
        // 通过 ws 让 server 切换 session（保持 0.2.x /resume 语义）
        try {
          ws.send(JSON.stringify({ type: 'slash_command', content: `/resume ${detail.sessionId}` }));
        } catch {
          // ws 未连接时忽略（上层可能在 readyState===OPEN 后再触发）
        }
      });
      els.sidebarEl.addEventListener('new-session-click', () => {
        try {
          ws.send(JSON.stringify({ type: 'slash_command', content: '/new' }));
        } catch {
          // ignore
        }
      });
      // agent-click / settings-click / new-agent-click 由上层自定义处理（默认无操作）
      // 避免硬编码 ws 行为，保持组件解耦。

      ws.addEventListener('message', (event) => {
        try {
          const msg = JSON.parse(event.data as string) as { type: string; seq?: number; event?: AgentEvent };
          if (msg.type === 'event' && msg.event) {
            state = coreReducer(state, msg.event);
            renderMessages(els.messagesEl, state.messages);
            els.workingEl.isWorking = state.isWorking;
          } else if (msg.type === 'resync_required') {
            // 服务端缓冲已丢失，重置 UI 状态
            state = initialUIState;
            renderMessages(els.messagesEl, state.messages);
            els.workingEl.isWorking = false;
          }
        } catch {
          // ignore malformed
        }
      });

      els.inputEl.addEventListener('submit', (e: Event) => {
        const detail = (e as CustomEvent).detail as { text: string };
        const text = detail.text;
        if (text.startsWith('/')) {
          const result = config.registry.resolve(text);
          // C10 修复：resolve() 返回 { command, args } 而非 CommandResult；
          // 通过 command.name 判断是否为 exit 命令
          if (result?.command.name === 'exit') {
            ws.close();
            return;
          }
          return;
        }
        // C9 修复：WS server 读取 parsed.content 而非 parsed.text
        ws.send(JSON.stringify({ type: 'message', content: text }));
      });
    },
  };
}
