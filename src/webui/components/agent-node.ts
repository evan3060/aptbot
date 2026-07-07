import { LitElement, html, css } from 'lit';
import './session-node.js';
import type { AgentProfile } from '../../core/agent/agent-profile.js';
import type { SessionMetadata } from '../../core/memory/types.js';

/**
 * §0.3.0 Task 13: <agent-node> Lit 组件 — agent 节点
 *
 * 行为契约：
 * - 显示：agent name + ⚙️ 设置按钮 + 折叠/展开箭头
 * - 默认展开（expanded=true）
 * - 点击 agent 名 → toggle expanded + dispatch agent-click 事件（detail: { slug, expanded }）
 * - 点击 ⚙️ → dispatch settings-click 事件（detail: { slug }）
 * - 点击「+ 新建会话」→ dispatch new-session-click 事件（detail: { slug }）
 * - expanded=true 时渲染子 <session-node> 列表
 * - 当前 agent 高亮（active class，由 currentAgentSlug 决定）
 */
export class AgentNode extends LitElement {
  static override styles = css`
    :host {
      display: block;
      font-family: Inter, system-ui, 'PingFang SC', sans-serif;
    }
    .agent-row {
      display: flex;
      align-items: center;
      padding: 8px 10px;
      cursor: pointer;
      border-radius: 6px;
      font-size: 13px;
      font-weight: 600;
      color: var(--text-primary, rgb(39, 36, 34));
      user-select: none;
    }
    .agent-row:hover {
      background: var(--bg-muted, rgb(249, 247, 244));
    }
    .agent-row.active {
      background: rgba(13, 113, 73, 0.12);
      color: var(--accent, rgb(13, 113, 73));
    }
    .agent-arrow {
      display: inline-block;
      width: 14px;
      font-size: 10px;
      color: var(--text-secondary, rgb(139, 133, 127));
      transition: transform 0.15s ease;
      flex-shrink: 0;
    }
    .agent-arrow.collapsed {
      transform: rotate(-90deg);
    }
    .agent-name {
      flex: 1;
      min-width: 0;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .agent-type-tag {
      display: inline-block;
      font-size: 10px;
      font-weight: 400;
      color: var(--text-secondary, rgb(139, 133, 127));
      background: var(--bg-muted, rgb(249, 247, 244));
      border-radius: 3px;
      padding: 1px 5px;
      margin-left: 6px;
      vertical-align: middle;
    }
    .settings-btn {
      background: none;
      border: none;
      cursor: pointer;
      color: var(--text-secondary, rgb(139, 133, 127));
      line-height: 1;
      padding: 2px 4px;
      flex-shrink: 0;
      opacity: 0;
      border-radius: 3px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
    }
    .settings-btn svg {
      width: 14px;
      height: 14px;
      fill: currentColor;
    }
    .agent-row:hover .settings-btn {
      opacity: 1;
    }
    .settings-btn:hover {
      background: var(--border, rgb(229, 231, 235));
      color: var(--text-primary, rgb(39, 36, 34));
    }
    .sessions-container {
      margin-left: 12px;
      margin-top: 2px;
    }
    .new-session-btn {
      display: block;
      width: 100%;
      padding: 6px 10px;
      background: none;
      color: var(--text-secondary, rgb(139, 133, 127));
      border: 1px dashed var(--border, rgb(229, 231, 235));
      border-radius: 6px;
      font-size: 12px;
      cursor: pointer;
      margin-top: 4px;
      font-family: inherit;
    }
    .new-session-btn:hover {
      color: var(--accent, rgb(13, 113, 73));
      border-color: var(--accent, rgb(13, 113, 73));
    }
  `;

  static override properties = {
    agent: { type: Object },
    sessions: { type: Array },
    expanded: { type: Boolean },
    currentAgentSlug: { type: String },
    currentSessionId: { type: String },
  };

  declare agent: AgentProfile;
  declare sessions: SessionMetadata[];
  declare expanded: boolean;
  declare currentAgentSlug: string;
  declare currentSessionId: string;

  constructor() {
    super();
    this.agent = {
      name: '',
      description: '',
      userId: '',
      type: 'default',
      slug: '',
      createdAt: 0,
      updatedAt: 0,
      personality: '',
    };
    this.sessions = [];
    this.expanded = true;
    this.currentAgentSlug = '';
    this.currentSessionId = '';
  }

  protected override render() {
    const isActive = this.agent.slug === this.currentAgentSlug;
    const typeTagText = this.agent.type === 'professional' ? '专业' : '默认';

    return html`
      <div
        class="agent-row${isActive ? ' active' : ''}"
        @click=${this._handleNameClick}
      >
        <span class="agent-arrow${this.expanded ? '' : ' collapsed'}">▼</span>
        <span class="agent-name">${this.agent.name}<span class="agent-type-tag">${typeTagText}</span></span>
        <button
          class="settings-btn"
          title="agent 设置"
          @click=${this._handleSettingsClick}
        ><svg viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg"><path d="M8 4.754a3.246 3.246 0 1 0 0 6.492 3.246 3.246 0 0 0 0-6.492zM5.754 8a2.246 2.246 0 1 1 4.492 0 2.246 2.246 0 0 1-4.492 0z"/><path d="M9.796 1.343c-.527-1.79-3.065-1.79-3.592 0l-.094.319a.879.879 0 0 1-1.137.582l-.31-.113c-1.716-.607-3.302.879-2.696 2.595l.113.31a.879.879 0 0 1-.582 1.137l-.319.094c-1.79.527-1.79 3.065 0 3.592l.319.094a.879.879 0 0 1 .582 1.137l-.113.31c-.607 1.716.879 3.302 2.595 2.696l.31-.113a.879.879 0 0 1 1.137.582l.094.319c.527 1.79 3.065 1.79 3.592 0l.094-.319a.879.879 0 0 1 1.137-.582l.31.113c1.716.607 3.302-.879 2.696-2.595l-.113-.31a.879.879 0 0 1 .582-1.137l.319-.094c1.79-.527 1.79-3.065 0-3.592l-.319-.094a.879.879 0 0 1-.582-1.137l.113-.31c.607-1.716-.879-3.302-2.595-2.696l-.31.113a.879.879 0 0 1-1.137-.582l-.094-.319z"/></svg></button>
      </div>
      ${this.expanded
        ? html`<div class="sessions-container">
            ${this.sessions.map(
              (s) => html`<session-node
                .session=${s}
                .agentSlug=${this.agent.slug}
                .active=${s.id === this.currentSessionId}
              ></session-node>`,
            )}
            <button
              class="new-session-btn"
              @click=${this._handleNewSessionClick}
            >+ 新建会话</button>
          </div>`
        : ''}
    `;
  }

  private _handleNameClick() {
    this.expanded = !this.expanded;
    this.dispatchEvent(
      new CustomEvent('agent-click', {
        detail: { slug: this.agent.slug, expanded: this.expanded },
        bubbles: true,
        composed: true,
      }),
    );
  }

  private _handleSettingsClick(e: Event) {
    e.stopPropagation();
    this.dispatchEvent(
      new CustomEvent('settings-click', {
        detail: { slug: this.agent.slug },
        bubbles: true,
        composed: true,
      }),
    );
  }

  private _handleNewSessionClick(e: Event) {
    e.stopPropagation();
    this.dispatchEvent(
      new CustomEvent('new-session-click', {
        detail: { slug: this.agent.slug },
        bubbles: true,
        composed: true,
      }),
    );
  }
}

if (!customElements.get('agent-node')) {
  customElements.define('agent-node', AgentNode);
}

declare global {
  interface HTMLElementTagNameMap {
    'agent-node': AgentNode;
  }
}
