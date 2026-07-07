import { LitElement, html, css } from 'lit';
import type { SessionMetadata } from '../../core/memory/types.js';

/**
 * §0.3.0 Task 13: <session-node> Lit 组件
 *
 * 沿用 0.2.x 行为（label / 自动摘要 preview fallback / relative time / 内联重命名）
 * 新增：agentId 归属视觉标识（小标签显示在节点上，便于跨 agent 场景识别）。
 *
 * 行为契约：
 * - 显示：label || preview || short id（与 chat-page.ts 0.2.x 优先级一致）
 * - 显示：relative time（刚刚 / N 分钟前 / N 小时前 / N 天前）
 * - 显示：agentId 归属小标签（仅当 agentSlug 提供且不为 'default' 时显示，避免冗余）
 * - 点击 → dispatch session-click 事件（detail: { sessionId }）
 * - 当前 session 高亮（active class）
 *
 * 内联重命名沿用 0.2.x 行为：点击 ⋮ 菜单按钮 → 显示「重命名会话」 → 替换 label 为 input。
 * 重命名完成（Enter）→ dispatch rename-submit 事件（detail: { sessionId, label }），
 * 由上层（agent-sidebar / index.ts）调用 /api/sessions/:id/label API。
 * Escape/blur → 取消，恢复原 label。
 */
export class SessionNode extends LitElement {
  static override styles = css`
    :host {
      display: block;
      font-family: Inter, system-ui, 'PingFang SC', sans-serif;
    }
    .session-item {
      padding: 8px 10px;
      border-radius: 6px;
      cursor: pointer;
      margin-bottom: 4px;
      font-size: 13px;
      display: flex;
      align-items: center;
      position: relative;
      color: var(--text-primary, rgb(39, 36, 34));
    }
    .session-item:hover {
      background: var(--bg-muted, rgb(249, 247, 244));
    }
    .session-item.active {
      background: rgba(13, 113, 73, 0.12);
      color: var(--accent, rgb(13, 113, 73));
    }
    .session-main {
      flex: 1;
      min-width: 0;
    }
    .session-label {
      font-weight: 500;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .session-time {
      font-size: 11px;
      color: var(--text-secondary, rgb(139, 133, 127));
      margin-top: 2px;
    }
    .session-agent-tag {
      display: inline-block;
      font-size: 10px;
      color: var(--text-secondary, rgb(139, 133, 127));
      background: var(--bg-muted, rgb(249, 247, 244));
      border-radius: 3px;
      padding: 1px 5px;
      margin-left: 6px;
      vertical-align: middle;
      font-weight: 400;
    }
    .session-menu-btn {
      background: none;
      border: none;
      cursor: pointer;
      color: var(--text-secondary, rgb(139, 133, 127));
      font-size: 16px;
      line-height: 1;
      padding: 2px 6px;
      flex-shrink: 0;
      opacity: 0;
      border-radius: 3px;
      align-self: center;
    }
    .session-item:hover .session-menu-btn {
      opacity: 1;
    }
    .session-menu-btn:hover {
      background: var(--border, rgb(229, 231, 235));
      color: var(--text-primary, rgb(39, 36, 34));
    }
    .session-menu {
      position: absolute;
      right: 4px;
      top: 30px;
      background: var(--bg-base, rgb(255, 255, 255));
      border: 1px solid var(--border, rgb(229, 231, 235));
      border-radius: 4px;
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
      z-index: 10;
      min-width: 120px;
      padding: 4px 0;
    }
    .session-menu-item {
      padding: 6px 12px;
      cursor: pointer;
      font-size: 12px;
      color: var(--text-primary, rgb(39, 36, 34));
    }
    .session-menu-item:hover {
      background: var(--bg-muted, rgb(249, 247, 244));
    }
    .session-menu-item.danger {
      color: rgb(220, 38, 38);
    }
    .session-menu-item.danger:hover {
      background: rgba(220, 38, 38, 0.08);
    }
    .session-rename-input {
      width: 100%;
      padding: 2px 4px;
      border: 1px solid var(--accent, rgb(13, 113, 73));
      border-radius: 3px;
      font-size: 13px;
      font-weight: 500;
      outline: none;
      box-sizing: border-box;
      font-family: inherit;
    }
  `;

  static override properties = {
    session: { type: Object },
    agentSlug: { type: String },
    active: { type: Boolean },
    _menuOpen: { state: true },
    _renaming: { state: true },
    _renameValue: { state: true },
  };

  declare session: SessionMetadata;
  declare agentSlug: string;
  declare active: boolean;
  declare private _menuOpen: boolean;
  declare private _renaming: boolean;
  declare private _renameValue: string;

  constructor() {
    super();
    this.session = {
      id: '',
      createdAt: 0,
      updatedAt: 0,
      agentId: 'default',
    };
    this.agentSlug = '';
    this.active = false;
    this._menuOpen = false;
    this._renaming = false;
    this._renameValue = '';
  }

  /** 0.2.x formatRelativeTime 沿用：刚刚 / N 分钟前 / N 小时前 / N 天前 */
  private _formatRelativeTime(ts: number | undefined): string {
    if (!ts) return '';
    const now = Date.now();
    const diff = now - ts;
    if (diff < 60000) return '刚刚';
    if (diff < 3600000) return Math.floor(diff / 60000) + ' 分钟前';
    if (diff < 86400000) return Math.floor(diff / 3600000) + ' 小时前';
    return Math.floor(diff / 86400000) + ' 天前';
  }

  /** 0.2.x 优先级：label || preview || short id（前 8 字符） */
  private _getDisplayLabel(): string {
    const s = this.session;
    return s.label || s.preview || (s.id || '').slice(0, 8);
  }

  protected override render() {
    const s = this.session;
    const label = this._getDisplayLabel();
    const time = this._formatRelativeTime(s.updatedAt || s.createdAt);
    const showAgentTag = this.agentSlug && this.agentSlug !== 'default';

    return html`
      <div
        class="session-item${this.active ? ' active' : ''}"
        @click=${this._handleClick}
      >
        <div class="session-main">
          ${this._renaming
            ? html`<input
                class="session-rename-input"
                type="text"
                maxlength="100"
                .value=${this._renameValue}
                @click=${(e: Event) => e.stopPropagation()}
                @keydown=${this._handleRenameKeydown}
                @blur=${this._handleRenameCancel}
              />`
            : html`<div class="session-label">
                ${label}${showAgentTag
                  ? html`<span class="session-agent-tag">${this.agentSlug}</span>`
                  : ''}
              </div>
              <div class="session-time">${time}</div>`}
        </div>
        ${!this._renaming
          ? html`<button
              class="session-menu-btn"
              title="更多操作"
              @click=${this._handleMenuClick}
            >⋮</button>`
          : ''}
        ${this._menuOpen
          ? html`<div class="session-menu" @click=${(e: Event) => e.stopPropagation()}>
              <div
                class="session-menu-item"
                @click=${this._startRename}
              >重命名会话</div>
              <div
                class="session-menu-item danger"
                @click=${this._handleDelete}
              >删除会话</div>
            </div>`
          : ''}
      </div>
    `;
  }

  private _handleClick() {
    if (this._renaming || this._menuOpen) return;
    this.dispatchEvent(
      new CustomEvent('session-click', {
        detail: { sessionId: this.session.id },
        bubbles: true,
        composed: true,
      }),
    );
  }

  private _handleMenuClick(e: Event) {
    e.stopPropagation();
    this._menuOpen = !this._menuOpen;
  }

  private _startRename(e: Event) {
    e.stopPropagation();
    this._menuOpen = false;
    this._renaming = true;
    this._renameValue = this._getDisplayLabel();
    // focus 在 updated 钩子里完成
    requestAnimationFrame(() => {
      const input = this.shadowRoot?.querySelector<HTMLInputElement>('.session-rename-input');
      input?.focus();
      input?.select();
    });
  }

  private _handleRenameKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter') {
      e.preventDefault();
      const newLabel = (e.target as HTMLInputElement).value.trim();
      const original = this._getDisplayLabel();
      if (!newLabel || newLabel === original) {
        this._handleRenameCancel();
        return;
      }
      this.dispatchEvent(
        new CustomEvent('rename-submit', {
          detail: { sessionId: this.session.id, label: newLabel },
          bubbles: true,
          composed: true,
        }),
      );
      this._renaming = false;
      this._renameValue = '';
    } else if (e.key === 'Escape') {
      e.preventDefault();
      this._handleRenameCancel();
    }
  }

  private _handleRenameCancel() {
    this._renaming = false;
    this._renameValue = '';
  }

  private _handleDelete(e: Event) {
    e.stopPropagation();
    this._menuOpen = false;
    this.dispatchEvent(
      new CustomEvent('delete-session', {
        detail: { sessionId: this.session.id },
        bubbles: true,
        composed: true,
      }),
    );
  }
}

if (!customElements.get('session-node')) {
  customElements.define('session-node', SessionNode);
}

declare global {
  interface HTMLElementTagNameMap {
    'session-node': SessionNode;
  }
}
