import { LitElement, html, css } from 'lit';

export class FooterBar extends LitElement {
  static override styles = css`
    :host {
      display: block;
      padding: 4px 20px;
      border-top: 1px solid var(--border, rgb(229, 231, 235));
      font-family: ui-monospace, monospace;
      font-size: 11px;
      color: var(--text-secondary, rgb(139, 133, 127));
      background: var(--bg-base, rgb(255, 255, 255));
      text-align: center;
    }
  `;

  static override properties = {
    model: { type: String },
  };

  declare model: string;

  constructor() {
    super();
    this.model = '';
  }

  protected override render() {
    return html`<span>model: ${this.model}</span>`;
  }
}

if (!customElements.get('footer-bar')) {
  customElements.define('footer-bar', FooterBar);
}

declare global {
  interface HTMLElementTagNameMap {
    'footer-bar': FooterBar;
  }
}
