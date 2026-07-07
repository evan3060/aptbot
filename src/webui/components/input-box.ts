import { LitElement, html, css } from 'lit';

export class InputBox extends LitElement {
  static override styles = css`
    :host {
      display: block;
      background: var(--bg-base, rgb(255, 255, 255));
      border-top: 1px solid var(--border, rgb(229, 231, 235));
      padding: 16px 20px;
      font-family: Inter, system-ui, 'PingFang SC', sans-serif;
    }
    form {
      display: flex;
      gap: 8px;
    }
    input {
      flex: 1;
      padding: 10px 14px;
      border: 1px solid var(--border, rgb(229, 231, 235));
      border-radius: 6px;
      font-family: inherit;
      font-size: 14px;
      outline: none;
    }
    input:focus {
      border-color: var(--accent, rgb(13, 113, 73));
      outline: 2px solid var(--accent, rgb(13, 113, 73));
      outline-offset: 1px;
    }
    button {
      padding: 10px 20px;
      background: var(--accent, rgb(13, 113, 73));
      color: var(--bg-base, rgb(255, 255, 255));
      border: none;
      border-radius: 9999px;
      font-size: 14px;
      cursor: pointer;
      font-family: inherit;
    }
    button:hover {
      background: rgb(10, 95, 60);
    }
  `;

  static override properties = {
    _value: { state: true },
  };

  declare private _value: string;

  constructor() {
    super();
    this._value = '';
  }

  protected override render() {
    return html`
      <form @submit=${this._handleSubmit}>
        <input
          type="text"
          .value=${this._value}
          @input=${this._handleInput}
          placeholder="Type a message or /command..."
        />
        <button type="submit">Send</button>
      </form>
    `;
  }

  private _handleInput(e: Event) {
    const input = e.target as HTMLInputElement;
    this._value = input.value;
  }

  private _handleSubmit(e: Event) {
    e.preventDefault();
    if (this._value.trim()) {
      this.dispatchEvent(
        new CustomEvent('submit', {
          detail: { text: this._value },
          bubbles: true,
          composed: true,
        }),
      );
      this._value = '';
    }
  }
}

if (!customElements.get('input-box')) {
  customElements.define('input-box', InputBox);
}

declare global {
  interface HTMLElementTagNameMap {
    'input-box': InputBox;
  }
}
