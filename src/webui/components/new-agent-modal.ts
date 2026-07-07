import { LitElement, html, css } from 'lit';
import type { AgentProfile } from '../../core/agent/agent-profile.js';

/**
 * §0.3.0 Task 14: <new-agent-modal> Lit 组件 — 新建专业 agent 浮层
 *
 * 行为契约：
 * - Properties: open
 * - 共用 settings-modal 的表单分段（身份/性格/记忆/LLM），但无删除按钮、无 Skill 配置区
 * - name 输入框（slug 自动生成，用户不感知）
 * - 创建按钮 → dispatch create 事件（含新 agent 配置 + auto-generated slug）
 * - 取消 → dispatch close 事件
 * - 居中 modal + 半透明遮罩，点击遮罩不关闭
 *
 * slug 生成：`agent-<6-hex-chars>`，与 agent-profile.ts generateSlug 一致的模式，
 * 但使用 Web Crypto API（browser-compatible），不导入 node:crypto。
 */
function generateBrowserSlug(): string {
  const bytes = new Uint8Array(3);
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    crypto.getRandomValues(bytes);
  } else {
    // Fallback for environments without Web Crypto
    for (let i = 0; i < 3; i++) {
      bytes[i] = Math.floor(Math.random() * 256);
    }
  }
  const hex = Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  return `agent-${hex}`;
}

export class NewAgentModal extends LitElement {
  static override styles = css`
    :host {
      font-family: Inter, system-ui, 'PingFang SC', sans-serif;
      color: var(--text-primary, rgb(39, 36, 34));
    }
    .modal-backdrop {
      position: fixed;
      inset: 0;
      background: rgba(0, 0, 0, 0.4);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 1000;
    }
    .modal-container {
      width: 560px;
      max-width: 90vw;
      max-height: 85vh;
      background: var(--bg-base, rgb(255, 255, 255));
      border-radius: 8px;
      box-shadow: 0 8px 32px rgba(0, 0, 0, 0.2);
      display: flex;
      flex-direction: column;
      overflow: hidden;
    }
    .modal-header {
      padding: 16px 20px;
      border-bottom: 1px solid var(--border, rgb(229, 231, 235));
      font-size: 16px;
      font-weight: 600;
    }
    .modal-body {
      flex: 1;
      overflow-y: auto;
      padding: 16px 20px;
    }
    .modal-footer {
      padding: 12px 20px;
      border-top: 1px solid var(--border, rgb(229, 231, 235));
      display: flex;
      gap: 8px;
      justify-content: flex-end;
      align-items: center;
    }
    .section {
      margin-bottom: 20px;
    }
    .section h3 {
      font-size: 13px;
      font-weight: 600;
      margin: 0 0 10px 0;
      color: var(--text-primary, rgb(39, 36, 34));
    }
    .form-field {
      margin-bottom: 10px;
    }
    .form-field label {
      display: block;
      font-size: 12px;
      color: var(--text-secondary, rgb(139, 133, 127));
      margin-bottom: 4px;
    }
    .form-field input[type='text'],
    .form-field input[type='number'],
    .form-field textarea,
    .form-field select {
      width: 100%;
      padding: 6px 8px;
      border: 1px solid var(--border, rgb(229, 231, 235));
      border-radius: 4px;
      font-size: 13px;
      font-family: inherit;
      color: var(--text-primary, rgb(39, 36, 34));
      background: var(--bg-base, rgb(255, 255, 255));
      box-sizing: border-box;
      outline: none;
    }
    .form-field input:focus,
    .form-field textarea:focus,
    .form-field select:focus {
      border-color: var(--accent, rgb(13, 113, 73));
    }
    .form-field textarea {
      resize: vertical;
      min-height: 80px;
      font-family: inherit;
    }
    .toggle-row {
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .toggle-row input[type='checkbox'] {
      cursor: pointer;
    }
    .toggle-row span {
      font-size: 13px;
    }
    .btn {
      padding: 6px 14px;
      border: 1px solid var(--border, rgb(229, 231, 235));
      border-radius: 6px;
      font-size: 13px;
      cursor: pointer;
      font-family: inherit;
      background: var(--bg-base, rgb(255, 255, 255));
      color: var(--text-primary, rgb(39, 36, 34));
    }
    .btn:hover {
      background: var(--bg-muted, rgb(249, 247, 244));
    }
    .btn-primary {
      background: var(--accent, rgb(13, 113, 73));
      color: var(--bg-base, rgb(255, 255, 255));
      border-color: var(--accent, rgb(13, 113, 73));
    }
    .btn-primary:hover {
      background: rgb(10, 95, 60);
    }
  `;

  static override properties = {
    open: { type: Boolean },
    _formState: { state: true },
    _dirty: { state: true },
  };

  declare open: boolean;

  declare private _formState: {
    name: string;
    description: string;
    personality: string;
    memoryEnabled: boolean;
    model: string;
    temperature: string;
    maxTokens: string;
    reasoningEffort: string;
    thinkingType: string;
    thinkingBudgetTokens: string;
  };
  declare private _dirty: boolean;

  constructor() {
    super();
    this.open = false;
    this._formState = {
      name: '',
      description: '',
      personality: '',
      memoryEnabled: true,
      model: '',
      temperature: '',
      maxTokens: '',
      reasoningEffort: 'none',
      thinkingType: 'adaptive',
      thinkingBudgetTokens: '',
    };
    this._dirty = false;
  }

  protected override willUpdate(changedProps: { has: (k: string) => boolean }): void {
    if (changedProps.has('open') && this.open) {
      // Reset form when modal opens
      this._formState = {
        name: '',
        description: '',
        personality: '',
        memoryEnabled: true,
        model: '',
        temperature: '',
        maxTokens: '',
        reasoningEffort: 'none',
        thinkingType: 'adaptive',
        thinkingBudgetTokens: '',
      };
      this._dirty = false;
    }
  }

  protected override render() {
    if (!this.open) return html``;
    const fs = this._formState;

    return html`
      <div class="modal-backdrop" @click=${this._handleBackdropClick}>
        <div class="modal-container" @click=${this._stopPropagation}>
          <div class="modal-header">新建专业 agent</div>
          <div class="modal-body">
            <div class="section identity-section">
              <h3>身份配置</h3>
              <div class="form-field field-name">
                <label>名称</label>
                <input
                  type="text"
                  .value=${fs.name}
                  @input=${this._handleNameInput}
                  placeholder="给 agent 起个名字"
                />
              </div>
              <div class="form-field field-description">
                <label>描述</label>
                <input
                  type="text"
                  .value=${fs.description}
                  @input=${this._handleDescriptionInput}
                  placeholder="简短描述 agent 的用途"
                />
              </div>
            </div>
            <div class="section personality-section">
              <h3>性格配置</h3>
              <div class="form-field field-personality">
                <label>人格描述</label>
                <textarea
                  .value=${fs.personality}
                  @input=${this._handlePersonalityInput}
                  placeholder="描述 agent 的人格、语气、专长等"
                ></textarea>
              </div>
            </div>
            <div class="section memory-config-section">
              <h3>记忆配置</h3>
              <div class="toggle-row">
                <input
                  type="checkbox"
                  .checked=${fs.memoryEnabled}
                  @change=${this._handleMemoryToggle}
                />
                <span>启用记忆（持久化 agent 跨会话上下文）</span>
              </div>
            </div>
            <div class="section llm-config-section">
              <h3>LLM 配置</h3>
              <div class="form-field field-model">
                <label>模型</label>
                <input
                  type="text"
                  .value=${fs.model}
                  @input=${this._handleModelInput}
                  placeholder="留空使用默认模型"
                />
              </div>
              <div class="form-field field-temperature">
                <label>Temperature</label>
                <input
                  type="number"
                  step="0.1"
                  min="0"
                  max="2"
                  .value=${fs.temperature}
                  @input=${this._handleTemperatureInput}
                />
              </div>
              <div class="form-field field-maxTokens">
                <label>Max Tokens</label>
                <input
                  type="number"
                  min="1"
                  max="200000"
                  .value=${fs.maxTokens}
                  @input=${this._handleMaxTokensInput}
                />
              </div>
              <div class="form-field field-reasoningEffort">
                <label>Reasoning Effort</label>
                <select
                  .value=${fs.reasoningEffort}
                  @change=${this._handleReasoningEffortChange}
                >
                  <option value="none">none</option>
                  <option value="minimal">minimal</option>
                  <option value="low">low</option>
                  <option value="medium">medium</option>
                  <option value="high">high</option>
                  <option value="xhigh">xhigh</option>
                </select>
              </div>
              <div class="form-field field-thinkingType">
                <label>Thinking Type</label>
                <select
                  .value=${fs.thinkingType}
                  @change=${this._handleThinkingTypeChange}
                >
                  <option value="adaptive">adaptive</option>
                  <option value="enabled">enabled</option>
                  <option value="disabled">disabled</option>
                </select>
              </div>
              <div class="form-field field-thinkingBudgetTokens">
                <label>Thinking Budget Tokens</label>
                <input
                  type="number"
                  min="1"
                  .value=${fs.thinkingBudgetTokens}
                  @input=${this._handleThinkingBudgetInput}
                />
              </div>
            </div>
          </div>
          <div class="modal-footer">
            <button class="btn cancel-btn" @click=${this._handleCancelClick}>
              取消
            </button>
            <button class="btn btn-primary create-btn" @click=${this._handleCreateClick}>
              创建
            </button>
          </div>
        </div>
      </div>
    `;
  }

  private _stopPropagation(e: Event) {
    e.stopPropagation();
  }

  private _handleBackdropClick() {
    // 点击遮罩不关闭（per brief）
  }

  private _markDirty() {
    this._dirty = true;
  }

  private _handleNameInput(e: Event) {
    const v = (e.target as HTMLInputElement).value;
    this._formState = { ...this._formState, name: v };
    this._markDirty();
  }

  private _handleDescriptionInput(e: Event) {
    const v = (e.target as HTMLInputElement).value;
    this._formState = { ...this._formState, description: v };
    this._markDirty();
  }

  private _handlePersonalityInput(e: Event) {
    const v = (e.target as HTMLTextAreaElement).value;
    this._formState = { ...this._formState, personality: v };
    this._markDirty();
  }

  private _handleMemoryToggle(e: Event) {
    const checked = (e.target as HTMLInputElement).checked;
    this._formState = { ...this._formState, memoryEnabled: checked };
    this._markDirty();
  }

  private _handleModelInput(e: Event) {
    const v = (e.target as HTMLInputElement).value;
    this._formState = { ...this._formState, model: v };
    this._markDirty();
  }

  private _handleTemperatureInput(e: Event) {
    const v = (e.target as HTMLInputElement).value;
    this._formState = { ...this._formState, temperature: v };
    this._markDirty();
  }

  private _handleMaxTokensInput(e: Event) {
    const v = (e.target as HTMLInputElement).value;
    this._formState = { ...this._formState, maxTokens: v };
    this._markDirty();
  }

  private _handleReasoningEffortChange(e: Event) {
    const v = (e.target as HTMLSelectElement).value;
    this._formState = { ...this._formState, reasoningEffort: v };
    this._markDirty();
  }

  private _handleThinkingTypeChange(e: Event) {
    const v = (e.target as HTMLSelectElement).value;
    this._formState = { ...this._formState, thinkingType: v };
    this._markDirty();
  }

  private _handleThinkingBudgetInput(e: Event) {
    const v = (e.target as HTMLInputElement).value;
    this._formState = { ...this._formState, thinkingBudgetTokens: v };
    this._markDirty();
  }

  private _handleCreateClick() {
    const fs = this._formState;
    // 保留所有键（undefined 表示「使用默认」，由上层决定是否覆盖）。
    // 不删除 undefined 键，保持 create 事件 detail 形状稳定，便于上层解构。
    const detail: Record<string, unknown> = {
      name: fs.name,
      description: fs.description,
      personality: fs.personality,
      memoryEnabled: fs.memoryEnabled,
      type: 'professional' as const,
      slug: generateBrowserSlug(),
      model: fs.model || undefined,
      temperature: fs.temperature ? parseFloat(fs.temperature) : undefined,
      maxTokens: fs.maxTokens ? parseInt(fs.maxTokens, 10) : undefined,
      reasoningEffort: fs.reasoningEffort,
      thinkingType: fs.thinkingType,
      thinkingBudgetTokens: fs.thinkingBudgetTokens
        ? parseInt(fs.thinkingBudgetTokens, 10)
        : undefined,
    };
    this._dirty = false;
    this.dispatchEvent(
      new CustomEvent('create', {
        detail,
        bubbles: true,
        composed: true,
      }),
    );
  }

  private _handleCancelClick() {
    this.dispatchEvent(
      new CustomEvent('close', {
        detail: {},
        bubbles: true,
        composed: true,
      }),
    );
  }
}

// Reference to satisfy unused import in type-check (AgentProfile used for interface alignment)
// The create event detail aligns with the professional AgentProfile shape.
export type NewAgentCreateDetail = Partial<AgentProfile> & {
  name: string;
  slug: string;
  type: 'professional';
  memoryEnabled: boolean;
};

if (!customElements.get('new-agent-modal')) {
  customElements.define('new-agent-modal', NewAgentModal);
}

declare global {
  interface HTMLElementTagNameMap {
    'new-agent-modal': NewAgentModal;
  }
}
