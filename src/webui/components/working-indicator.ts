import { LitElement, html, css } from 'lit';

export class WorkingIndicator extends LitElement {
  static override styles = css`
    :host {
      display: none;
      text-align: center;
      padding: 8px;
      color: var(--text-secondary, rgb(139, 133, 127));
      font-size: 13px;
      font-family: Inter, system-ui, 'PingFang SC', sans-serif;
      background: var(--bg-base, rgb(255, 255, 255));
      border-top: 1px solid var(--border, rgb(229, 231, 235));
    }
    :host([isworking]) {
      display: block;
    }
    .dot {
      display: inline-block;
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: var(--accent, rgb(13, 113, 73));
      margin-left: 6px;
      animation: blink 1s infinite;
      vertical-align: middle;
    }
    @keyframes blink {
      0%, 100% { opacity: 0.3; }
      50% { opacity: 1; }
    }
  `;

  static override properties = {
    isWorking: { type: Boolean, reflect: true, attribute: 'isworking' },
  };

  declare isWorking: boolean;

  constructor() {
    super();
    this.isWorking = false;
  }

  protected override render() {
    if (!this.isWorking) return html``;
    return html`<span>Working</span><span class="dot"></span>`;
  }
}

if (!customElements.get('working-indicator')) {
  customElements.define('working-indicator', WorkingIndicator);
}

declare global {
  interface HTMLElementTagNameMap {
    'working-indicator': WorkingIndicator;
  }
}
