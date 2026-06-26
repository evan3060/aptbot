import { LitElement, html, css } from 'lit';

export class FooterBar extends LitElement {
  static styles = css`
    :host {
      display: block;
      padding: 6px 12px;
      border-top: 1px solid #e5e7eb;
      font-family: ui-monospace, monospace;
      font-size: 0.75em;
      color: #9ca3af;
    }
  `;

  static properties = {
    model: { type: String },
  };

  declare model: string;

  constructor() {
    super();
    this.model = '';
  }

  protected render() {
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
