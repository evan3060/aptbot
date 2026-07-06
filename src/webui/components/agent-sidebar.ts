import { LitElement, html, css } from 'lit';
import './agent-node.js';
import type { AgentProfile } from '../../core/agent/agent-profile.js';
import type { SessionMetadata } from '../../core/memory/types.js';

/**
 * §0.3.0 Task 13: <agent-sidebar> Lit 组件 — 左侧栏容器
 *
 * 行为契约：
 * - Properties: agents / sessions（flat list，按 agentId 内部分组）/ currentAgentSlug / currentSessionId
 * - 渲染 <agent-node> 列表（每个 agent 一个）
 * - 底部「+ 新建专业 agent」按钮 → dispatch new-agent-click 事件
 * - 透传 agent-click / session-click / settings-click / new-session-click 事件
 *
 * 事件流：
 *   agent-node / session-node 内部 dispatch → 冒泡到 agent-sidebar
 *   → agent-sidebar 重新 dispatch（保持 detail 不变，便于上层 index.ts 统一处理）
 */
export class AgentSidebar extends LitElement {
  static override styles = css`
    :host {
      display: flex;
      flex-direction: column;
      width: 260px;
      flex-shrink: 0;
      height: 100%;
      background: var(--bg-base, rgb(255, 255, 255));
      border-right: 1px solid var(--border, rgb(229, 231, 235));
      font-family: Inter, system-ui, 'PingFang SC', sans-serif;
      color: var(--text-primary, rgb(39, 36, 34));
      overflow: hidden;
    }
    .sidebar-header {
      padding: 12px;
      border-bottom: 1px solid var(--border, rgb(229, 231, 235));
      font-size: 14px;
      font-weight: 600;
    }
    .agent-list {
      flex: 1;
      overflow-y: auto;
      padding: 8px;
    }
    .new-agent-btn {
      display: block;
      width: 100%;
      padding: 8px 12px;
      background: var(--accent, rgb(13, 113, 73));
      color: var(--bg-base, rgb(255, 255, 255));
      border: none;
      border-radius: 9999px;
      font-size: 13px;
      cursor: pointer;
      font-family: inherit;
    }
    .new-agent-btn:hover {
      background: rgb(10, 95, 60);
    }
    .sidebar-footer {
      padding: 12px;
      border-top: 1px solid var(--border, rgb(229, 231, 235));
    }
  `;

  static override properties = {
    agents: { type: Array },
    sessions: { type: Array },
    currentAgentSlug: { type: String },
    currentSessionId: { type: String },
  };

  declare agents: AgentProfile[];
  declare sessions: SessionMetadata[];
  declare currentAgentSlug: string;
  declare currentSessionId: string;

  constructor() {
    super();
    this.agents = [];
    this.sessions = [];
    this.currentAgentSlug = '';
    this.currentSessionId = '';
  }

  /** 按 agentId 分组 sessions（O(n) 一次扫描） */
  private _groupSessionsByAgent(): Map<string, SessionMetadata[]> {
    const map = new Map<string, SessionMetadata[]>();
    for (const s of this.sessions) {
      const list = map.get(s.agentId);
      if (list) {
        list.push(s);
      } else {
        map.set(s.agentId, [s]);
      }
    }
    return map;
  }

  protected override render() {
    const grouped = this._groupSessionsByAgent();

    return html`
      <div class="sidebar-header">aptbot</div>
      <div class="agent-list">
        ${this.agents.map(
          (agent) => html`<agent-node
            .agent=${agent}
            .sessions=${grouped.get(agent.slug) ?? []}
            .currentAgentSlug=${this.currentAgentSlug}
            .currentSessionId=${this.currentSessionId}
          ></agent-node>`,
        )}
      </div>
      <div class="sidebar-footer">
        <button class="new-agent-btn" @click=${this._handleNewAgentClick}>
          + 新建专业 agent
        </button>
      </div>
    `;
  }

  private _handleNewAgentClick() {
    this.dispatchEvent(
      new CustomEvent('new-agent-click', {
        detail: {},
        bubbles: true,
        composed: true,
      }),
    );
  }
}

if (!customElements.get('agent-sidebar')) {
  customElements.define('agent-sidebar', AgentSidebar);
}

declare global {
  interface HTMLElementTagNameMap {
    'agent-sidebar': AgentSidebar;
  }
}
