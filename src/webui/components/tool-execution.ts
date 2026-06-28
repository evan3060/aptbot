import { LitElement, html, css } from 'lit';

export type ToolStatus = 'running' | 'success' | 'failed';

export class ToolExecution extends LitElement {
  static override styles = css`
    :host {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 4px 8px;
      margin: 2px 0;
      font-family: ui-monospace, monospace;
      font-size: 0.85em;
      color: #555;
    }
    .icon { font-weight: bold; }
    .running .icon { color: #f59e0b; }
    .success .icon { color: #16a34a; }
    .failed .icon { color: #dc2626; }
  `;

  static override properties = {
    name: { type: String },
    status: { type: String },
  };

  declare name: string;
  declare status: ToolStatus;

  constructor() {
    super();
    this.name = '';
    this.status = 'running';
  }

  protected override render() {
    const icon = this.status === 'running' ? '⏳'
      : this.status === 'success' ? '✓'
      : '✗';
    return html`
      <div class=${this.status}>
        <span class="icon">${icon}</span>
        <span class="name">${this.name}</span>
      </div>
    `;
  }
}

if (!customElements.get('tool-execution')) {
  customElements.define('tool-execution', ToolExecution);
}

declare global {
  interface HTMLElementTagNameMap {
    'tool-execution': ToolExecution;
  }
}
