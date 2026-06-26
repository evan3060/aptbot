import { LitElement, html, css } from 'lit';

export class UserMessage extends LitElement {
  static styles = css`
    :host {
      display: block;
      padding: 8px 12px;
      margin: 4px 0;
      background: #e3f2fd;
      border-radius: 6px;
      font-family: system-ui, sans-serif;
      white-space: pre-wrap;
      word-break: break-word;
    }
  `;

  static properties = {
    text: { type: String },
  };

  declare text: string;

  constructor() {
    super();
    this.text = '';
  }

  protected render() {
    return html`<span>${this.text}</span>`;
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
