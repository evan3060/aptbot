import { LitElement, html, css } from 'lit';

export class UserMessage extends LitElement {
  static override styles = css`
    :host {
      display: block;
      margin-bottom: 16px;
      padding: 12px 16px;
      border-radius: 8px;
      line-height: 1.6;
      white-space: pre-wrap;
      word-wrap: break-word;
      font-family: Inter, system-ui, 'PingFang SC', sans-serif;
      /* §0.3.0 WebUI 集成修复: 恢复 0.2.3 样式 — user 消息靠右（margin-left 大）*/
      background: var(--bg-base, rgb(255, 255, 255));
      border: 1px solid var(--border, rgb(229, 231, 235));
      margin-left: 40px;
    }
    .label {
      font-size: 11px;
      color: var(--text-secondary, rgb(139, 133, 127));
      margin-bottom: 4px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }
  `;

  static override properties = {
    text: { type: String },
  };

  declare text: string;

  constructor() {
    super();
    this.text = '';
  }

  protected override render() {
    return html`<div class="label">You</div><div>${this.text}</div>`;
  }
}

if (!customElements.get('user-message')) {
  customElements.define('user-message', UserMessage);
}

declare global {
  interface HTMLElementTagNameMap {
    'user-message': UserMessage;
  }
}
