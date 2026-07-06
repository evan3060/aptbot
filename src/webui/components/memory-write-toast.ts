import { LitElement, html, css } from 'lit';

/**
 * §0.3.0 Task 16: <memory-write-toast> Lit 组件 — 记忆写入轻量提示
 *
 * 行为契约：
 * - Properties: message (string) / visible (boolean)
 * - visible=true 时显示 toast，4 秒后自动 visible=false（auto-dismiss）
 * - 再次 visible=true 重置计时器（不闪烁/不堆叠）
 * - visible=false 时不渲染、不启动计时器
 * - 非打断性：不抢焦点（无 autofocus），不阻挡 pointer events（点击穿透到 chat）
 * - 样式：轻量提示，position: fixed top-right，adept tokens CSS + Inter 字体
 *
 * 由 index.ts 监听 write_agent_memory 工具调用事件后设置 message + visible=true。
 */
export class MemoryWriteToast extends LitElement {
  static override styles = css`
    :host {
      display: block;
      position: fixed;
      top: 16px;
      right: 16px;
      z-index: 1000;
      pointer-events: none;
      font-family: Inter, system-ui, 'PingFang SC', sans-serif;
    }
    .toast {
      display: inline-block;
      max-width: 320px;
      padding: 8px 14px;
      background: var(--bg-elevated, rgb(255, 255, 255));
      color: var(--text-primary, rgb(39, 36, 34));
      border: 1px solid var(--border, rgb(229, 231, 235));
      border-left: 3px solid var(--accent, rgb(13, 113, 73));
      border-radius: 8px;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.08);
      font-size: 13px;
      line-height: 1.5;
      pointer-events: none;
      user-select: none;
      word-break: break-word;
    }
  `;

  static override properties = {
    message: { type: String },
    visible: { type: Boolean },
  };

  declare message: string;
  declare visible: boolean;

  /** §0.3.0 自动消失延迟（4 秒，位于 brief 3-5 秒范围） */
  static readonly AUTO_DISMISS_MS = 4000;

  private _timer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    super();
    this.message = '';
    this.visible = false;
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this._clearTimer();
  }

  /**
   * §0.3.0 检测 visible / message 属性变化：
   * - visible false→true → 启动 4 秒计时器，到点自动 visible=false
   * - visible true→false → 清除计时器（不重启）
   * - message 变化且 visible=true → 重置计时器（新一次记忆写入，避免提前消失）
   *
   * Lit 默认 hasChanged 用 Object.is，true→true 不会触发 updated；
   * 故「再次 visible=true」场景通过 message 变化触发计时器重置。
   */
  protected override updated(changedProperties: Map<string, unknown>): void {
    const visibleChanged = changedProperties.has('visible');
    const messageChanged = changedProperties.has('message');
    if (visibleChanged || (messageChanged && this.visible)) {
      this._clearTimer();
      if (this.visible) {
        this._timer = setTimeout(() => {
          this.visible = false;
        }, MemoryWriteToast.AUTO_DISMISS_MS);
      }
    }
  }

  private _clearTimer(): void {
    if (this._timer !== null) {
      clearTimeout(this._timer);
      this._timer = null;
    }
  }

  protected override render() {
    if (!this.visible) return html``;
    return html`
      <div class="toast" role="status" aria-live="polite">
        ${this.message}
      </div>
    `;
  }
}

if (!customElements.get('memory-write-toast')) {
  customElements.define('memory-write-toast', MemoryWriteToast);
}

declare global {
  interface HTMLElementTagNameMap {
    'memory-write-toast': MemoryWriteToast;
  }
}
