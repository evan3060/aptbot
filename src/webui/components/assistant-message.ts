import { LitElement, html, css } from 'lit';

export class AssistantMessage extends LitElement {
  static override styles = css`
    :host {
      display: block;
      padding: 8px 12px;
      margin: 4px 0;
      background: #f7f7f8;
      border-radius: 6px;
      font-family: system-ui, sans-serif;
      white-space: pre-wrap;
      word-break: break-word;
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
    return html`<span class=${this.isStreaming ? 'streaming' : ''}>${this.text}</span>`;
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
