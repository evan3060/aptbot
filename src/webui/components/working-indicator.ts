import { LitElement, html, css } from 'lit';

export class WorkingIndicator extends LitElement {
  static override styles = css`
    :host {
      display: block;
      padding: 4px 12px;
      font-family: system-ui, sans-serif;
      color: #6b7280;
      font-size: 0.85em;
    }
    .dot {
      animation: pulse 1.2s ease-in-out infinite;
      display: inline-block;
    }
    @keyframes pulse {
      0%, 100% { opacity: 0.4; }
      50% { opacity: 1; }
    }
  `;

  static override properties = {
    isWorking: { type: Boolean },
  };

  declare isWorking: boolean;

  constructor() {
    super();
    this.isWorking = false;
  }

  protected override render() {
    if (!this.isWorking) return html``;
    return html`<span class="dot">⠋ Working...</span>`;
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
