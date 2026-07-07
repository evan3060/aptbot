import './components/assistant-message.js';
import './components/user-message.js';
import './components/tool-execution.js';
import './components/working-indicator.js';
import './components/footer-bar.js';
import './components/input-box.js';
import './components/agent-sidebar.js';
import './components/skill-chips-bar.js';
import './components/memory-write-toast.js';
import './components/agent-settings-modal.js';
import './components/new-agent-modal.js';

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
import type { AgentSettingsModal } from './components/agent-settings-modal.js';
import type { NewAgentModal, NewAgentCreateDetail } from './components/new-agent-modal.js';
import { fillTemplate, shouldRenderChipBar } from './components/skill-chips-bar.js';

export interface WebUIApp {
  start(): Promise<void>;
}

export interface WebUIAppConfig {
  wsUrl: string;
  registry?: CommandRegistry;
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
  /** §0.3.0 WebUI 集成: 当前默认模型 ID（用于 footer 显示） */
  model?: string;
}

interface AppElements {
  sidebarEl: AgentSidebar;
  messagesEl: HTMLElement;
  chipsEl?: SkillChipsBar;
  toastEl: MemoryWriteToast;
  settingsModalEl: AgentSettingsModal;
  newAgentModalEl: NewAgentModal;
  inputEl: HTMLElement & { addEventListener: (type: string, listener: (e: Event) => void) => void };
  footerEl: HTMLElement & { model: string };
  workingEl: HTMLElement & { isWorking: boolean };
  statusEl: HTMLElement;
  sidebarContainerEl: HTMLElement;
  sidebarToggleBtn: HTMLButtonElement;
  sidebarBackdrop: HTMLElement;
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

interface PendingMemoryWrite {
  section: string;
  content: string;
}

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

/**
 * §0.3.0 WebUI 集成: queryElements — 从 index.html 静态 DOM 查询组件挂载点。
 * 与 0.2.x createElements 不同，0.3.0 WebUI 的 HTML 结构在 index.html 中预定义，
 * 此函数仅查询引用，不创建新元素。
 */
function queryElements(): AppElements {
  const sidebarEl = document.querySelector('agent-sidebar') as AgentSidebar;
  const messagesEl = document.getElementById('messages') as HTMLElement;
  const chipsEl = document.querySelector('skill-chips-bar') as SkillChipsBar | null;
  const toastEl = document.querySelector('memory-write-toast') as MemoryWriteToast;
  const settingsModalEl = document.querySelector('agent-settings-modal') as AgentSettingsModal;
  const newAgentModalEl = document.querySelector('new-agent-modal') as NewAgentModal;
  const inputEl = document.querySelector('input-box') as AppElements['inputEl'];
  const footerEl = document.querySelector('footer-bar') as AppElements['footerEl'];
  const workingEl = document.querySelector('working-indicator') as AppElements['workingEl'];
  const statusEl = document.getElementById('status') as HTMLElement;
  const sidebarContainerEl = document.getElementById('sidebar-container') as HTMLElement;
  const sidebarToggleBtn = document.getElementById('sidebar-toggle') as HTMLButtonElement;
  const sidebarBackdrop = document.getElementById('sidebar-backdrop') as HTMLElement;
  return {
    sidebarEl, messagesEl, chipsEl: chipsEl ?? undefined, toastEl,
    settingsModalEl, newAgentModalEl,
    inputEl, footerEl, workingEl, statusEl,
    sidebarContainerEl, sidebarToggleBtn, sidebarBackdrop,
  };
}

function renderMessages(container: HTMLElement, messages: Array<{ role: string; text: string }>): void {
  // §0.3.0 WebUI 集成修复: 增量更新而非全量重建。
  // 之前 container.innerHTML = '' 会销毁所有 Lit 元素，下一事件到达前
  // Lit 的异步 render 微任务来不及执行，导致元素 shadowRoot 始终为空。
  // 现按 id 复用已有元素，只更新 text 属性（Lit 会自动触发 render），
  // 新消息追加 createElement。消息数量减少时移除尾部多余元素。
  const existing = Array.from(container.children) as Array<HTMLElement & { text?: string }>;
  const tagFor = (role: string) => (role === 'user' ? 'user-message' : 'assistant-message');

  // 1. 更新已有 + 追加新消息
  for (let i = 0; i < messages.length; i++) {
    const m = messages[i];
    const wantTag = tagFor(m.role);
    let el = existing[i] as (HTMLElement & { text: string }) | undefined;
    if (!el || el.tagName.toLowerCase() !== wantTag) {
      // 位置 i 的元素不存在或类型不匹配 → 创建新元素
      el = document.createElement(wantTag) as HTMLElement & { text: string };
      if (existing[i]) {
        container.replaceChild(el, existing[i]);
        existing[i] = el;
      } else {
        container.appendChild(el);
        existing.push(el);
      }
    }
    // 仅在值变化时设置（避免无意义的 requestUpdate）
    if (el.text !== m.text) {
      el.text = m.text;
    }
  }
  // 2. 移除多余的尾部元素
  while (existing.length > messages.length) {
    const removed = existing.pop();
    if (removed && removed.parentNode === container) {
      container.removeChild(removed);
    }
  }
}

/**
 * §0.3.0 Task 15: mergeChipSkills — 合并 UiConfig.visibleSkills 与 Skill.template。
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
 * 通过 shadowRoot 访问内部 input 元素，设置 value + setSelectionRange + 同步 _value。
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
    return;
  }
  input.value = value;
  try {
    input.setSelectionRange(cursorPos, cursorPos);
  } catch {
    input.setSelectionRange(value.length, value.length);
  }
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.focus();
}

/**
 * §0.3.0 WebUI 集成: escapeHtml — 工具结果截断/转义（与 chat-page 一致）。
 */
function escapeHtml(s: string): string {
  return String(s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string
  ));
}

function generateUUID(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/** §0.3.0 WebUI 集成: AuthController — 处理 token / 登录 / 注册 / 登出 / auth modal。
 * 从 chat-page.ts 迁移，保留与 0.2.x 一致的双写策略（cookie + sessionStorage）。 */
class AuthController {
  private readonly TOKEN_KEY = 'aptbot:token';
  private readonly SESSION_ID_KEY = 'aptbot:sessionId';
  token: string | null;
  private urlToken: string | null;
  private storedToken: string | null;
  private cookieEnabled: boolean;
  sessionId: string;
  private readonly authModal: HTMLElement;
  private readonly authErrorEl: HTMLElement;
  private readonly loginForm: HTMLFormElement;
  private readonly registerForm: HTMLFormElement;
  private readonly toRegisterLink: HTMLElement;
  private readonly toLoginLink: HTMLElement;

  constructor() {
    this.authModal = document.getElementById('auth-modal') as HTMLElement;
    this.authErrorEl = document.getElementById('auth-error') as HTMLElement;
    this.loginForm = document.getElementById('login-form') as HTMLFormElement;
    this.registerForm = document.getElementById('register-form') as HTMLFormElement;
    this.toRegisterLink = document.getElementById('to-register') as HTMLElement;
    this.toLoginLink = document.getElementById('to-login') as HTMLElement;

    this.urlToken = new URLSearchParams(window.location.search).get('token');
    this.storedToken = sessionStorage.getItem(this.TOKEN_KEY) || null;
    this.token = this.urlToken || this.storedToken;
    this.cookieEnabled = this.detectCookieEnabled();

    const urlSessionId = new URLSearchParams(window.location.search).get('session');
    if (urlSessionId) {
      this.sessionId = urlSessionId;
      try { localStorage.setItem(this.SESSION_ID_KEY, this.sessionId); } catch { /* ignore */ }
    } else {
      this.sessionId = localStorage.getItem(this.SESSION_ID_KEY) || generateUUID();
      try { localStorage.setItem(this.SESSION_ID_KEY, this.sessionId); } catch { /* ignore */ }
    }
  }

  private detectCookieEnabled(): boolean {
    if (typeof navigator !== 'undefined' && typeof navigator.cookieEnabled === 'boolean') {
      return navigator.cookieEnabled;
    }
    try {
      document.cookie = 'aptbot_test=1; SameSite=Lax; path=/';
      return document.cookie.indexOf('aptbot_test=') !== -1;
    } catch {
      return false;
    }
  }

  resolveWsToken(): string | null {
    if (this.urlToken) return this.urlToken;
    if (!this.cookieEnabled && this.token) return this.token;
    return null;
  }

  showAuthModal(mode: 'login' | 'register'): void {
    this.authErrorEl.classList.remove('show');
    this.authErrorEl.textContent = '';
    if (mode === 'register') {
      this.loginForm.classList.add('hidden');
      this.registerForm.classList.remove('hidden');
    } else {
      this.registerForm.classList.add('hidden');
      this.loginForm.classList.remove('hidden');
    }
    this.authModal.classList.remove('hidden');
  }

  hideAuthModal(): void {
    this.authModal.classList.add('hidden');
    this.loginForm.reset();
    this.registerForm.reset();
    this.authErrorEl.classList.remove('show');
    this.authErrorEl.textContent = '';
  }

  showAuthError(msg: string): void {
    this.authErrorEl.textContent = msg;
    this.authErrorEl.classList.add('show');
  }

  /** 注册所有 auth modal 内的事件监听器 */
  attachListeners(onAuthSuccess: (token: string, username: string) => void): void {
    this.toRegisterLink.addEventListener('click', (e) => {
      e.preventDefault();
      this.showAuthModal('register');
    });
    this.toLoginLink.addEventListener('click', (e) => {
      e.preventDefault();
      this.showAuthModal('login');
    });
    this.authModal.addEventListener('click', (e) => {
      if (e.target === this.authModal) this.hideAuthModal();
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !this.authModal.classList.contains('hidden')) {
        this.hideAuthModal();
      }
    });
    this.loginForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const username = (document.getElementById('login-username') as HTMLInputElement).value.trim();
      const password = (document.getElementById('login-password') as HTMLInputElement).value;
      if (!username || !password) return;
      fetch('/api/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username, password }),
        credentials: 'include',
      })
        .then((res) => res.json().then((d) => ({ status: res.status, data: d as { token?: string; username?: string; error?: string } })))
        .then((r) => {
          if (r.status === 200 && r.data.token) {
            onAuthSuccess(r.data.token, r.data.username ?? '');
          } else {
            this.showAuthError(r.data.error || '登录失败，请检查用户名和密码');
          }
        })
        .catch(() => this.showAuthError('网络错误，请重试'));
    });
    this.registerForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const username = (document.getElementById('reg-username') as HTMLInputElement).value.trim();
      const password = (document.getElementById('reg-password') as HTMLInputElement).value;
      const password2 = (document.getElementById('reg-password2') as HTMLInputElement).value;
      if (!username || !password) return;
      if (password !== password2) {
        this.showAuthError('两次输入的密码不一致');
        return;
      }
      if (password.length < 6) {
        this.showAuthError('密码至少 6 位');
        return;
      }
      fetch('/api/register', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username, password }),
        credentials: 'include',
      })
        .then((res) => res.json().then((d) => ({ status: res.status, data: d as { token?: string; username?: string; error?: string } })))
        .then((r) => {
          if (r.status === 200 && r.data.token) {
            onAuthSuccess(r.data.token, r.data.username ?? '');
          } else if (r.status === 409) {
            this.showAuthError('用户名已存在');
          } else {
            this.showAuthError(r.data.error || '注册失败');
          }
        })
        .catch(() => this.showAuthError('网络错误，请重试'));
    });
  }

  onAuthSuccess(token: string, _username: string): void {
    this.token = token;
    this.storedToken = token;
    try { sessionStorage.setItem(this.TOKEN_KEY, token); } catch { /* ignore */ }
    this.hideAuthModal();
  }

  logout(): void {
    try { sessionStorage.removeItem(this.TOKEN_KEY); } catch { /* ignore */ }
    try { localStorage.removeItem(this.SESSION_ID_KEY); } catch { /* ignore */ }
    fetch('/api/logout', { method: 'POST', credentials: 'include' })
      .catch(() => { /* 即使 logout 请求失败也继续刷新 */ })
      .finally(() => {
        window.location.href = window.location.pathname;
      });
  }
}

export function createWebUIApp(config: WebUIAppConfig): WebUIApp {
  return {
    async start() {
      const els = queryElements();
      let state = initialUIState;
      els.footerEl.model = config.model ?? '';
      els.sidebarEl.agents = config.agents ?? [];
      els.sidebarEl.sessions = config.sessions ?? [];
      els.sidebarEl.currentAgentSlug = config.currentAgentSlug ?? 'default';
      els.sidebarEl.currentSessionId = config.currentSessionId ?? '';

      // §0.3.0 Task 15: chip 区仅在 default agent 渲染
      if (els.chipsEl) {
        const agents = config.agents ?? [];
        const currentSlug = config.currentAgentSlug ?? 'default';
        if (shouldRenderChipBar(agents, currentSlug)) {
          els.chipsEl.visibleSkills = mergeChipSkills(
            config.visibleSkills ?? [],
            config.skills ?? [],
          );
          els.chipsEl.activeSkill = null;
        } else {
          els.chipsEl.style.display = 'none';
        }
      }

      const auth = new AuthController();
      auth.attachListeners((token, username) => {
        auth.onAuthSuccess(token, username);
        // 登录成功后重连 ws + 加载 agents/sessions
        lastEventSeq = 0;
        restoreSessionAndConnect();
        loadAgentsAndSessions();
      });
      if (!auth.token) {
        auth.showAuthModal('login');
        els.statusEl.textContent = '未登录';
        els.statusEl.className = 'disconnected';
      }

      // §0.3.0 WebUI: 透传 sidebar 事件到 ws
      els.sidebarEl.addEventListener('session-click', (e: Event) => {
        const detail = (e as CustomEvent).detail as { sessionId: string };
        // 即时反馈：立即清空消息区，避免切换 session 期间显示旧消息
        state = initialUIState;
        renderMessages(els.messagesEl, state.messages);
        els.workingEl.isWorking = false;
        sendSlashCommand(`/resume ${detail.sessionId}`);
      });
      els.sidebarEl.addEventListener('new-session-click', () => {
        // 即时反馈：立即清空消息区，禁用输入直到 session_changed 事件到达
        state = initialUIState;
        renderMessages(els.messagesEl, state.messages);
        els.workingEl.isWorking = false;
        sendSlashCommand('/new');
      });
      // agent-click / settings-click / new-agent-click 由本组件直接处理
      els.sidebarEl.addEventListener('agent-click', (e: Event) => {
        const detail = (e as CustomEvent).detail as { slug: string };
        sendSlashCommand(`/agent ${detail.slug}`);
      });
      els.sidebarEl.addEventListener('settings-click', (e: Event) => {
        const detail = (e as CustomEvent).detail as { slug: string };
        openSettingsModal(detail.slug);
      });
      els.sidebarEl.addEventListener('new-agent-click', () => {
        openNewAgentModal();
      });
      // 删除会话：弹出确认 → DELETE /api/sessions/:id → 刷新列表
      els.sidebarEl.addEventListener('delete-session', (e: Event) => {
        const detail = (e as CustomEvent).detail as { sessionId: string };
        const sid = detail.sessionId;
        if (!sid || !auth.token) return;
        if (!window.confirm('确定要删除这个会话吗？删除后无法恢复。')) return;
        const token = auth.token;
        fetch(`/api/sessions/${sid}?token=${encodeURIComponent(token)}`, {
          method: 'DELETE',
          credentials: 'include',
        })
          .then((res) => res.json())
          .then((data: { ok?: boolean; error?: string }) => {
            if (!data || !data.ok) {
              window.alert(data?.error ?? '删除失败');
              return;
            }
            // 如果删除的是当前会话 → 启动新会话
            if (sid === auth.sessionId) {
              state = initialUIState;
              renderMessages(els.messagesEl, state.messages);
              els.workingEl.isWorking = false;
              sendSlashCommand('/new');
            } else {
              // 仅刷新列表
              loadAgentsAndSessions();
            }
          })
          .catch(() => {
            window.alert('删除失败，请重试');
          });
      });

      // §0.3.0 Task 15: skill-select 事件处理
      if (els.chipsEl) {
        els.chipsEl.addEventListener('skill-select', (e: Event) => {
          const detail = (e as CustomEvent).detail as {
            slug: string | null;
            template?: string;
          };
          els.chipsEl!.activeSkill = detail.slug;
          if (detail.slug === null) return;
          if (!detail.template) return;
          applyTemplateToInput(els.inputEl, detail.template);
        });
      }

      // §0.3.0 Task 14: settings modal / new-agent modal 事件
      // §0.3.0 WebUI 集成: AgentSettingsModal dispatch 'update' 事件，detail={ agent, uiConfig? }
      els.settingsModalEl.addEventListener('update', (e: Event) => {
        const detail = (e as CustomEvent).detail as {
          agent: Partial<AgentProfile> & { slug?: string };
          uiConfig?: { visibleSkills: Array<{ slug: string; displayName: string }> };
        };
        const slug = detail.agent.slug ?? (els.settingsModalEl.agent?.slug ?? '');
        if (!slug) return;
        const payload: Record<string, unknown> = { ...detail.agent };
        delete payload.slug; // slug 不可改
        fetch(`/api/agents/${encodeURIComponent(slug)}?token=${encodeURIComponent(auth.token ?? '')}`, {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(payload),
          credentials: 'include',
        })
          .then((res) => res.json())
          .then(() => {
            // 若 agent 为 default 且 uiConfig 提供，同步 PUT ui-config
            if (detail.uiConfig && slug === 'default') {
              return fetch(`/api/agents/default/ui-config?token=${encodeURIComponent(auth.token ?? '')}`, {
                method: 'PUT',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify(detail.uiConfig),
                credentials: 'include',
              });
            }
            return undefined;
          })
          .then(() => {
            els.settingsModalEl.open = false;
            loadAgentsAndSessions();
          })
          .catch((err) => {
            console.error('update agent failed:', err);
          });
      });
      els.settingsModalEl.addEventListener('close', () => {
        els.settingsModalEl.open = false;
      });
      els.newAgentModalEl.addEventListener('create', (e: Event) => {
        const detail = (e as CustomEvent).detail as NewAgentCreateDetail;
        fetch(`/api/agents?token=${encodeURIComponent(auth.token ?? '')}`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(detail),
          credentials: 'include',
        })
          .then((res) => res.json())
          .then(() => {
            els.newAgentModalEl.open = false;
            loadAgentsAndSessions();
          })
          .catch((err) => {
            console.error('create agent failed:', err);
          });
      });
      els.newAgentModalEl.addEventListener('close', () => {
        els.newAgentModalEl.open = false;
      });

      // §0.3.0 WebUI: sidebar 移动端抽屉化
      els.sidebarToggleBtn.addEventListener('click', () => {
        if (els.sidebarContainerEl.classList.contains('open')) {
          els.sidebarContainerEl.classList.remove('open');
          els.sidebarBackdrop.classList.remove('show');
        } else {
          els.sidebarContainerEl.classList.add('open');
          els.sidebarBackdrop.classList.add('show');
        }
      });
      els.sidebarBackdrop.addEventListener('click', () => {
        els.sidebarContainerEl.classList.remove('open');
        els.sidebarBackdrop.classList.remove('show');
      });

      // ===== WebSocket 管理 =====
      let ws: WebSocket | null = null;
      let reconnectDelay = 1000;
      let lastEventSeq = 0;
      let historyRequestId = 0;
      let historyLoading = false;
      let myClientId = '';
      const pendingMemoryWrites = new Map<string, PendingMemoryWrite>();

      function setStatus(text: string, cls: string): void {
        els.statusEl.textContent = text;
        els.statusEl.className = cls || '';
      }

      function setWorking(on: boolean): void {
        els.workingEl.isWorking = on;
      }

      function scrollBottom(): void {
        els.messagesEl.scrollTop = els.messagesEl.scrollHeight;
      }

      function buildWsUrl(): string {
        const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
        const base = `${proto}//${location.host}${config.wsUrl}`;
        const params = new URLSearchParams();
        const wsToken = auth.resolveWsToken();
        if (wsToken) params.set('token', wsToken);
        if (auth.sessionId) params.set('session', auth.sessionId);
        params.set('lastEventSeq', String(lastEventSeq));
        params.set('historyLimit', '20');
        const qs = params.toString();
        return qs ? `${base}?${qs}` : base;
      }

      function loadHistory(sid: string): void {
        if (!auth.token || !sid) return;
        const reqId = ++historyRequestId;
        historyLoading = true;
        fetch(`/api/sessions/${sid}/messages?token=${encodeURIComponent(auth.token)}`, { credentials: 'include' })
          .then((res) => {
            if (res.status === 404) {
              if (reqId !== historyRequestId) return;
              els.messagesEl.innerHTML = '';
              return null;
            }
            if (!res.ok) return null;
            return res.json();
          })
          .then((data: { messages?: Array<{ type: string; message?: { role: string; content?: string } }> } | null) => {
            if (reqId !== historyRequestId) return;
            historyLoading = false;
            if (!data || !data.messages) return;
            const messages: Array<{ id: string; role: 'user' | 'assistant'; text: string }> = [];
            for (const entry of data.messages) {
              if (entry.type !== 'message') continue;
              const msg = entry.message;
              if (!msg) continue;
              const content = typeof msg.content === 'string' ? msg.content : '';
              if (msg.role === 'user' || msg.role === 'assistant') {
                messages.push({ id: `history-${messages.length}`, role: msg.role, text: content });
              }
            }
            state = { ...initialUIState, messages };
            renderMessages(els.messagesEl, messages);
            scrollBottom();
          })
          .catch(() => { historyLoading = false; /* 静默 */ });
      }

      function handleServerMessage(msg: {
        type: string;
        seq?: number;
        event?: AgentEvent;
        sessionId?: string;
        username?: string;
        clientId?: string;
        onlineCount?: number;
        source?: string;
        messages?: Array<{ replay?: boolean; role: string; content: string }>;
        code?: string;
        message?: string;
      }): void {
        // user_identified 事件 — 对齐 sessionId + 加载历史 + 刷新侧栏
        if (msg.type === 'user_identified') {
          // 保存 clientId 用于 user_message 事件区分发送者
          if (msg.clientId) myClientId = msg.clientId;
          if (msg.sessionId && msg.sessionId !== auth.sessionId) {
            auth.sessionId = msg.sessionId;
            try { localStorage.setItem('aptbot:sessionId', auth.sessionId); } catch { /* ignore */ }
            lastEventSeq = 0;
            // 重置 state（避免旧 session 的 messages 残留）
            state = initialUIState;
            renderMessages(els.messagesEl, state.messages);
            els.workingEl.isWorking = false;
            pendingMemoryWrites.clear();
            if (ws) {
              ws.onclose = null;
              ws.onmessage = null;
              ws.onerror = null;
              ws.close();
            }
            connect();
            loadAgentsAndSessions();
            return;
          }
          if (lastEventSeq === 0) loadHistory(auth.sessionId);
          loadAgentsAndSessions();
          return;
        }
        if (msg.type === 'error' && msg.code === 'session_ownership_mismatch') {
          try { localStorage.removeItem('aptbot:sessionId'); } catch { /* ignore */ }
          auth.sessionId = generateUUID();
          try { localStorage.setItem('aptbot:sessionId', auth.sessionId); } catch { /* ignore */ }
          lastEventSeq = 0;
          if (ws) {
            ws.onclose = null;
            ws.onmessage = null;
            ws.onerror = null;
            ws.close();
          }
          connect();
          return;
        }
        if (msg.type === 'error' && msg.code === 'auth_failed') {
          auth.token = null;
          try { sessionStorage.removeItem('aptbot:token'); } catch { /* ignore */ }
          auth.showAuthModal('login');
          setStatus('未登录', 'disconnected');
          if (ws) { ws.onclose = null; ws.close(); }
          return;
        }
        if (msg.type === 'session_changed' && msg.sessionId) {
          try { localStorage.setItem('aptbot:sessionId', msg.sessionId); } catch { /* ignore */ }
          auth.sessionId = msg.sessionId;
          lastEventSeq = 0;
          // 重置 state（避免旧 session 的 messages 残留，导致后续 renderMessages 把旧消息渲染回来）
          state = initialUIState;
          renderMessages(els.messagesEl, state.messages);
          els.workingEl.isWorking = false;
          pendingMemoryWrites.clear();
          if (ws) {
            ws.onclose = null;
            ws.onmessage = null;
            ws.onerror = null;
            ws.close();
          }
          connect();
          loadAgentsAndSessions();
          return;
        }
        if (msg.type === 'session_renamed') {
          loadAgentsAndSessions();
          return;
        }
        if (msg.type === 'presence') {
          // §0.3.0 简化：暂不在 UI 显示 presence（保留接口）
          return;
        }
        if (msg.type === 'replay' && msg.source === 'jsonl' && msg.messages) {
          if (historyLoading) return;
          const extra: Array<{ id: string; role: 'user' | 'assistant'; text: string }> = [];
          for (const m of msg.messages) {
            if (m.replay !== true) continue;
            const content = typeof m.content === 'string' ? m.content : '';
            if (m.role === 'user' || m.role === 'assistant') {
              extra.push({ id: `replay-${extra.length}`, role: m.role, text: content });
            }
          }
          if (extra.length > 0) {
            state = { ...state, messages: [...state.messages, ...extra] };
            renderMessages(els.messagesEl, state.messages);
            scrollBottom();
          }
          return;
        }
        if (msg.type === 'event' && msg.event) {
          if (historyLoading) return;
          if (typeof msg.seq === 'number' && msg.seq > lastEventSeq) lastEventSeq = msg.seq;
          const event = msg.event;
          // 跳过自己发送的 user_message（已在 send 时本地渲染，避免重复）
          if (event.type === 'user_message' && event.senderId === myClientId) {
            return;
          }
          // §0.3.0 Task 16: toast 处理
          handleMemoryWriteEvent(els.toastEl, event, pendingMemoryWrites);
          state = coreReducer(state, event);
          renderMessages(els.messagesEl, state.messages);
          els.workingEl.isWorking = state.isWorking;
          if (event.type === 'turn_end') {
            // turn 结束后刷新侧栏（新 session/label 同步）
            loadAgentsAndSessions();
          }
          return;
        }
        if (msg.type === 'resync_required') {
          state = initialUIState;
          renderMessages(els.messagesEl, state.messages);
          els.workingEl.isWorking = false;
          lastEventSeq = 0;
          pendingMemoryWrites.clear();
          return;
        }
        if (msg.type === 'error') {
          // 顶层 error 消息
          const errEl = document.createElement('div');
          errEl.className = 'msg error';
          errEl.innerHTML = `<div class="label">Error</div>${escapeHtml(msg.message || msg.code || 'server error')}`;
          els.messagesEl.appendChild(errEl);
          scrollBottom();
          return;
        }
      }

      function connect(): void {
        if (!auth.token) {
          setStatus('未登录', 'disconnected');
          return;
        }
        ws = new WebSocket(buildWsUrl());
        ws.onopen = () => {
          setStatus('connected', 'connected');
          reconnectDelay = 1000;
          if (auth.token) {
            try { sessionStorage.setItem('aptbot:token', auth.token); } catch { /* ignore */ }
          }
          if (lastEventSeq === 0) {
            loadHistory(auth.sessionId);
          }
        };
        ws.onmessage = (ev) => {
          try {
            const msg = JSON.parse(ev.data as string);
            handleServerMessage(msg);
          } catch {
            // ignore malformed
          }
        };
        ws.onclose = () => {
          setStatus('disconnected', 'disconnected');
          setWorking(false);
          if (auth.token) {
            setTimeout(() => {
              reconnectDelay = Math.min(reconnectDelay * 1.5, 10000);
              connect();
            }, reconnectDelay);
          }
        };
        ws.onerror = () => { /* onclose 处理 */ };
      }

      function sendSlashCommand(cmd: string): void {
        if (!auth.token) {
          auth.showAuthModal('login');
          return;
        }
        if (!ws || ws.readyState !== WebSocket.OPEN) return;
        ws.send(JSON.stringify({ type: 'message', content: cmd }));
      }

      function restoreSessionAndConnect(): void {
        if (!auth.token) {
          connect();
          return;
        }
        fetch(`/api/sessions?token=${encodeURIComponent(auth.token)}`, { credentials: 'include' })
          .then((res) => res.json())
          .then((data: { sessions?: Array<{ id: string }> }) => {
            if (data && data.sessions && data.sessions.length > 0) {
              const currentBelongs = data.sessions.some((s) => s.id === auth.sessionId);
              if (!currentBelongs) {
                const latest = data.sessions[0];
                auth.sessionId = latest.id;
                try { localStorage.setItem('aptbot:sessionId', auth.sessionId); } catch { /* ignore */ }
              }
            }
            connect();
          })
          .catch(() => connect());
      }

      function loadAgentsAndSessions(): void {
        if (!auth.token) {
          els.sidebarEl.agents = [];
          els.sidebarEl.sessions = [];
          return;
        }
        const token = auth.token;
        Promise.all([
          fetch(`/api/agents?token=${encodeURIComponent(token)}`, { credentials: 'include' }).then((r) => r.json()) as Promise<AgentProfile[]>,
          fetch(`/api/sessions?token=${encodeURIComponent(token)}`, { credentials: 'include' }).then((r) => r.json()) as Promise<{ sessions: SessionMetadata[] }>,
        ])
          .then(([agentsList, sessionsData]) => {
            els.sidebarEl.agents = agentsList ?? [];
            els.sidebarEl.sessions = sessionsData.sessions ?? [];
            els.sidebarEl.currentSessionId = auth.sessionId;
          })
          .catch(() => { /* 静默 */ });
      }

      function openSettingsModal(slug: string): void {
        // 找到对应 agent profile，注入 modal
        const agent = (config.agents ?? []).find((a) => a.slug === slug)
          ?? (els.sidebarEl.agents ?? []).find((a) => a.slug === slug);
        if (!agent) return;
        els.settingsModalEl.agent = agent;
        els.settingsModalEl.open = true;
      }

      function openNewAgentModal(): void {
        els.newAgentModalEl.open = true;
      }

      // 输入提交处理
      els.inputEl.addEventListener('submit', (e: Event) => {
        const detail = (e as CustomEvent).detail as { text: string };
        const text = detail.text;
        if (text.startsWith('/')) {
          // slash 命令直接通过 ws message 发送（server 端处理）
          if (text === '/exit' || text.startsWith('/exit ')) {
            ws?.close();
            return;
          }
          sendSlashCommand(text);
          return;
        }
        if (!auth.token) {
          auth.showAuthModal('login');
          return;
        }
        if (!ws || ws.readyState !== WebSocket.OPEN) return;
        // 本地立即添加 user 消息（不等 server 广播回来，提升响应感）
        // server 广播的 user_message 事件会被 senderId===myClientId 过滤，避免重复
        state = {
          ...state,
          messages: [...state.messages, {
            id: `user-local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            role: 'user' as const,
            text,
          }],
        };
        renderMessages(els.messagesEl, state.messages);
        scrollBottom();
        ws.send(JSON.stringify({ type: 'message', content: text }));
      });

      // 启动流程：已登录则恢复 session + 连接 ws + 加载侧栏；未登录则显示 auth modal
      restoreSessionAndConnect();
      loadAgentsAndSessions();
    },
  };
}

/**
 * §0.3.0 WebUI 集成: bootstrap — 浏览器入口。
 * 从 /api/webui-bootstrap 加载初始数据（agents/sessions/visibleSkills/skills/currentAgentSlug），
 * 然后调用 createWebUIApp 启动应用。
 *
 * 仅在浏览器环境自动调用（不在 Node.js 测试环境触发，避免污染测试）。
 */
async function bootstrapWebUI(): Promise<void> {
  if (typeof document === 'undefined' || typeof window === 'undefined') return;
  // 读取 server 注入的 bootstrap 数据（内联 JSON 或 fetch）
  let bootstrap: {
    agents?: AgentProfile[];
    sessions?: SessionMetadata[];
    visibleSkills?: VisibleSkill[];
    skills?: Skill[];
    currentAgentSlug?: string;
    currentSessionId?: string;
    model?: string;
  } = {};
  try {
    const res = await fetch('/api/webui-bootstrap', { credentials: 'include' });
    if (res.ok) {
      bootstrap = await res.json() as typeof bootstrap;
    }
  } catch {
    // dev 环境尚未实现端点时降级为空数据（auth modal 会显示）
  }

  const wsUrl = '/ws';
  await createWebUIApp({
    wsUrl,
    agents: bootstrap.agents,
    sessions: bootstrap.sessions,
    visibleSkills: bootstrap.visibleSkills,
    skills: bootstrap.skills,
    currentAgentSlug: bootstrap.currentAgentSlug ?? 'default',
    currentSessionId: bootstrap.currentSessionId,
    model: bootstrap.model,
  }).start();
}

// §0.3.0 WebUI 集成: 浏览器自动启动入口
// 仅在 DOMContentLoaded 后触发，避免阻塞首屏渲染
if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      void bootstrapWebUI();
    });
  } else {
    void bootstrapWebUI();
  }
}
