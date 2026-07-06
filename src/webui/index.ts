import './components/assistant-message.js';
import './components/user-message.js';
import './components/tool-execution.js';
import './components/working-indicator.js';
import './components/footer-bar.js';
import './components/input-box.js';
import './components/agent-sidebar.js';
import './components/skill-chips-bar.js';
import './components/memory-write-toast.js';

import type { CommandRegistry } from '../shared/commands/registry.js';
import { coreReducer, initialUIState } from '../shared/ui-state/reducer.js';
import type { AgentEvent } from '../core/agent/events.js';
import type { AgentProfile } from '../core/agent/agent-profile.js';
import type { SessionMetadata } from '../core/memory/types.js';
import type { Skill } from '../core/skills/types.js';
import type { VisibleSkill } from '../core/agent/ui-config.js';
import type { AgentSidebar } from './components/agent-sidebar.js';
import type { SkillChipsBar, ChipSkill } from './components/skill-chips-bar.js';
import type { MemoryWriteToast } from './components/memory-write-toast.js';
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
  toastEl: MemoryWriteToast;
  inputEl: HTMLElement & { addEventListener: (type: string, listener: (e: Event) => void) => void };
  footerEl: HTMLElement & { model: string };
  workingEl: HTMLElement & { isWorking: boolean };
}

/** §0.3.0 Task 16: write_agent_memory section 标题（snake_case → Title Case）映射。
 *  服务于 toast 显示。与 read-agent-memory.ts SECTION_HEADER_MAP 一致。 */
const SECTION_DISPLAY_MAP: Record<string, string> = {
  user_profile: 'User Profile',
  facts: 'Facts',
  preferences: 'Preferences',
  history: 'History',
};

/** §0.3.0 Task 16: toast 中 contentPreview 的最大字符数 */
const TOAST_PREVIEW_MAX = 60;

/**
 * §0.3.0 Task 16: buildMemoryToastMessage — 构造 toast 文案。
 * 形如 `agent 已更新记忆：Preferences` 或 `agent 已更新记忆：Preferences — prefers dark mode…`
 * section 为空时降级为 `agent 已更新记忆`；preview 为空时仅显示 section 标题。
 */
function buildMemoryToastMessage(section: string, contentPreview: string): string {
  const sectionTitle = SECTION_DISPLAY_MAP[section] ?? section ?? '';
  const base = sectionTitle ? `agent 已更新记忆：${sectionTitle}` : 'agent 已更新记忆';
  const preview = (contentPreview ?? '').trim();
  if (!preview) return base;
  const truncated = preview.length > TOAST_PREVIEW_MAX
    ? `${preview.slice(0, TOAST_PREVIEW_MAX)}…`
    : preview;
  return `${base} — ${truncated}`;
}

/**
 * §0.3.0 Task 16: PendingMemoryWrite — tool_call_start 到 tool_result 期间缓存的参数。
 * 由 tool_call_delta.arguments JSON 解析得到，用于 tool_result 时构造 toast 文案。
 */
interface PendingMemoryWrite {
  section: string;
  content: string;
}

/**
 * §0.3.0 Task 16: handleMemoryWriteEvent — 处理 AgentEvent，识别 write_agent_memory
 * 工具调用流程并在 tool_result 成功时显示 toast。
 *
 * 流程：
 * - tool_call_start.toolName === 'write_agent_memory' → 记录 toolCallId（占位）
 * - tool_call_delta 对应 toolCallId → 解析 JSON arguments 缓存 { section, content }
 * - tool_result 对应 toolCallId 且 success=true → 构造 toast 文案并 visible=true
 * - tool_result 后清理 pending 条目（无论成功/失败）
 *
 * 任何 JSON 解析失败 / 数据缺失 → 静默降级（不显示 toast，不抛错）。
 * 与 reducer 解耦：不影响 messages / isWorking 状态机。
 */
function handleMemoryWriteEvent(
  toast: MemoryWriteToast,
  event: AgentEvent,
  pending: Map<string, PendingMemoryWrite>,
): void {
  switch (event.type) {
    case 'tool_call_start': {
      if (event.toolName === 'write_agent_memory') {
        pending.set(event.toolCallId, { section: '', content: '' });
      }
      return;
    }
    case 'tool_call_delta': {
      const p = pending.get(event.toolCallId);
      if (!p) return;
      try {
        const args = JSON.parse(event.arguments ?? '{}') as {
          section?: string;
          content?: string;
          mode?: string;
        };
        if (typeof args.section === 'string') p.section = args.section;
        if (typeof args.content === 'string') p.content = args.content;
      } catch {
        // JSON 解析失败：保留占位（section=''），tool_result 时降级为通用文案
      }
      return;
    }
    case 'tool_result': {
      const p = pending.get(event.toolCallId);
      pending.delete(event.toolCallId);
      if (!p) return;
      if (!event.success) return;
      const message = buildMemoryToastMessage(p.section, p.content);
      toast.message = message;
      toast.visible = true;
      return;
    }
    default:
      return;
  }
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

  // §0.3.0 Task 16: 记忆写入 toast（position: fixed，最后 append 确保 z-index 顶层）
  const toastEl = document.createElement('memory-write-toast') as MemoryWriteToast;

  document.body.appendChild(sidebarEl);
  document.body.appendChild(messagesEl);
  document.body.appendChild(workingEl);
  if (chipsEl) {
    document.body.appendChild(chipsEl);
  }
  document.body.appendChild(inputEl);
  document.body.appendChild(footerEl);
  document.body.appendChild(toastEl);

  return { sidebarEl, messagesEl, chipsEl, toastEl, inputEl, footerEl, workingEl };
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
 *
 * 导出供集成测试直接调用（避免依赖完整 createWebUIApp + WebSocket 装配）。
 */
export function applyTemplateToInput(
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

      // §0.3.0 Task 16: pending write_agent_memory 调用（toolCallId → section+content）
      // tool_call_start 占位 → tool_call_delta 填充参数 → tool_result 显示 toast 后清理
      const pendingMemoryWrites = new Map<string, PendingMemoryWrite>();

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
            // §0.3.0 Task 16: write_agent_memory toast — 仅在 tool_result 成功时显示
            handleMemoryWriteEvent(els.toastEl, msg.event, pendingMemoryWrites);
          } else if (msg.type === 'resync_required') {
            // 服务端缓冲已丢失，重置 UI 状态
            state = initialUIState;
            renderMessages(els.messagesEl, state.messages);
            els.workingEl.isWorking = false;
            // §0.3.0 Task 16: 重置 pending memory writes（避免遗留 toolCallId 错触 toast）
            pendingMemoryWrites.clear();
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
