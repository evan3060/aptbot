import { LitElement, html, css } from 'lit';

export class InputBox extends LitElement {
  static styles = css`
    :host {
      display: block;
      padding: 8px 12px;
      border-top: 1px solid #e5e7eb;
    }
    form {
      display: flex;
      gap: 8px;
    }
    input {
      flex: 1;
      padding: 8px 10px;
      border: 1px solid #d1d5db;
      border-radius: 6px;
      font-family: system-ui, sans-serif;
      font-size: 14px;
      outline: none;
    }
    input:focus {
      border-color: #3b82f6;
    }
    button {
      padding: 8px 16px;
      background: #3b82f6;
      color: white;
      border: none;
      border-radius: 6px;
      font-size: 14px;
      cursor: pointer;
    }
    button:hover {
      background: #2563eb;
    }
  `;

  static properties = {
    _value: { state: true },
  };

  declare private _value: string;

  constructor() {
    super();
    this._value = '';
  }

  protected render() {
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
