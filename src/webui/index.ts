import './components/assistant-message.js';
import './components/user-message.js';
import './components/tool-execution.js';
import './components/working-indicator.js';
import './components/footer-bar.js';
import './components/input-box.js';
import './components/agent-sidebar.js';
import './components/skill-chips-bar.js';

import type { CommandRegistry } from '../shared/commands/registry.js';
import { coreReducer, initialUIState } from '../shared/ui-state/reducer.js';
import type { AgentEvent } from '../core/agent/events.js';
import type { AgentProfile } from '../core/agent/agent-profile.js';
import type { SessionMetadata } from '../core/memory/types.js';
import type { Skill } from '../core/skills/types.js';
import type { VisibleSkill } from '../core/agent/ui-config.js';
import type { AgentSidebar } from './components/agent-sidebar.js';
import type { SkillChipsBar, ChipSkill } from './components/skill-chips-bar.js';
import { fillTemplate, shouldRenderChipBar } from './components/skill-chips-bar.js';

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
  /** §0.3.0 Task 15: default agent 的 visibleSkills 配置（来自 GET /api/agents/default/ui-config） */
  visibleSkills?: VisibleSkill[];
  /** §0.3.0 Task 15: 已加载的 skill 列表（用于查找 template） */
  skills?: Skill[];
}

interface AppElements {
  sidebarEl: AgentSidebar;
  messagesEl: HTMLElement;
  chipsEl?: SkillChipsBar;
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

  // §0.3.0 Task 15: chip 区仅在 default agent 渲染（专业 agent 不渲染）
  const agents = config.agents ?? [];
  const currentSlug = config.currentAgentSlug ?? 'default';
  let chipsEl: SkillChipsBar | undefined;
  if (shouldRenderChipBar(agents, currentSlug)) {
    chipsEl = document.createElement('skill-chips-bar') as SkillChipsBar;
    chipsEl.visibleSkills = mergeChipSkills(
      config.visibleSkills ?? [],
      config.skills ?? [],
    );
    chipsEl.activeSkill = null;
  }

  const footerEl = document.createElement('footer-bar') as AppElements['footerEl'];
  const inputEl = document.createElement('input-box') as AppElements['inputEl'];

  document.body.appendChild(sidebarEl);
  document.body.appendChild(messagesEl);
  document.body.appendChild(workingEl);
  if (chipsEl) {
    document.body.appendChild(chipsEl);
  }
  document.body.appendChild(inputEl);
  document.body.appendChild(footerEl);

  return { sidebarEl, messagesEl, chipsEl, inputEl, footerEl, workingEl };
}

/**
 * §0.3.0 Task 15: mergeChipSkills — 合并 UiConfig.visibleSkills 与 Skill.template。
 *
 * UiConfig 仅含 { slug, displayName }（UI 层偏好），template 来自 Skill.template。
 * 按 visibleSkills 顺序输出 ChipSkill，查找对应 skill 的 template 注入。
 */
function mergeChipSkills(
  visibleSkills: VisibleSkill[],
  skills: Skill[],
): ChipSkill[] {
  return visibleSkills.map((v) => {
    const skill = skills.find((s) => s.name === v.slug);
    return {
      slug: v.slug,
      displayName: v.displayName,
      template: skill?.template,
    };
  });
}

/**
 * §0.3.0 Task 15: applyTemplateToInput — 将模板填入 <input-box> 内部 <input>。
 *
 * 通过 shadowRoot 访问内部 input 元素，设置 value + setSelectionRange + 同步 _value。
 * template 为空时仅激活 skill（不填入输入框），由调用方决定。
 */
function applyTemplateToInput(
  inputBox: HTMLElement,
  template: string,
): void {
  const input = inputBox.shadowRoot?.querySelector('input') as HTMLInputElement | null;
  if (!input) return;
  const current = input.value;
  const { value, cursorPos } = fillTemplate(current, template);
  if (value === current) {
    // template 空 → 不修改输入框
    return;
  }
  input.value = value;
  try {
    input.setSelectionRange(cursorPos, cursorPos);
  } catch {
    // setSelectionRange 在某些浏览器极端情况可能抛错，安全降级到末尾
    input.setSelectionRange(value.length, value.length);
  }
  // 同步 InputBox 内部 _value（dispatch input 事件触发 _handleInput）
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.focus();
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

      // §0.3.0 Task 15: skill-select 事件处理（仅 default agent 渲染 chip 区时生效）
      // - empty input + template → 覆盖填入
      // - has content + template → 追加（含 \n 分隔符）
      // - template 含 {{cursor}} → 光标定位到该处
      // - template 空 → 仅激活 skill（不填入输入框）
      // - skill 状态不持久化（一次性，刷新页面清空）
      // - 用户可立即切换其他 skill
      if (els.chipsEl) {
        els.chipsEl.addEventListener('skill-select', (e: Event) => {
          const detail = (e as CustomEvent).detail as {
            slug: string | null;
            template?: string;
          };
          // 更新 active chip 高亮（null = 取消选中）
          els.chipsEl!.activeSkill = detail.slug;
          // slug=null（取消选中）或 template 空 → 仅激活/取消激活，不填入输入框
          if (detail.slug === null) return;
          if (!detail.template) return;
          applyTemplateToInput(els.inputEl, detail.template);
        });
      }

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
