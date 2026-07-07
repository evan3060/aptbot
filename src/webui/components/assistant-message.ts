import { LitElement, html, css } from 'lit';

export class AssistantMessage extends LitElement {
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
      /* §0.3.0 WebUI 集成修复: 恢复 0.2.3 样式 — assistant 消息靠左 + 绿色左边框 */
      background: var(--bg-base, rgb(255, 255, 255));
      border-left: 3px solid var(--accent, rgb(13, 113, 73));
    }
    .label {
      font-size: 11px;
      color: var(--text-secondary, rgb(139, 133, 127));
      margin-bottom: 4px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }
    .streaming::after {
      content: '▋';
      animation: blink 1s steps(2) infinite;
    }
    @keyframes blink {
      50% { opacity: 0; }
    }
  `;

  static override properties = {
    text: { type: String },
    isStreaming: { type: Boolean },
  };

  declare text: string;
  declare isStreaming: boolean;

  constructor() {
    super();
    this.text = '';
    this.isStreaming = false;
  }

  protected override render() {
    return html`<div class="label">Assistant</div><div class=${this.isStreaming ? 'streaming' : ''}>${this.text}</div>`;
  }
}

if (!customElements.get('assistant-message')) {
  customElements.define('assistant-message', AssistantMessage);
}

declare global {
  interface HTMLElementTagNameMap {
    'assistant-message': AssistantMessage;
  }
}
