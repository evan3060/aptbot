import { LitElement, html, css, type PropertyValues } from 'lit';
import type { AgentProfile } from '../../core/agent/agent-profile.js';
import type { UiConfig } from '../../core/agent/ui-config.js';

/**
 * §0.3.0 Task 14: <agent-settings-modal> Lit 组件 — agent 设置浮层
 *
 * 行为契约：
 * - Properties: agent / mode ('default' | 'professional') / open / skills / uiConfig / memoryEnabled
 * - 通用模式 (default): LLM 配置区 + Skill 展示配置区；无 personality；无删除按钮
 * - 专业模式 (professional): 身份配置区 + 性格配置区 + 记忆配置区 + LLM 配置区 + 删除按钮
 * - 居中 modal，约 560px 宽度
 * - 半透明黑色背景遮罩，点击遮罩不关闭
 * - 底部固定 保存 / 取消 按钮
 * - 保存 → dispatch update 事件（detail: { agent, uiConfig? }）
 * - 取消 → dispatch close 事件（有未保存内容时确认提示）
 * - 删除按钮（professional only）→ 确认弹窗 → dispatch delete 事件
 */
export class AgentSettingsModal extends LitElement {
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
    .footer-left {
      margin-right: auto;
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
    .skill-item {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 6px 0;
      border-bottom: 1px solid var(--border, rgb(229, 231, 235));
    }
    .skill-item:last-child {
      border-bottom: none;
    }
    .skill-item input[type='checkbox'] {
      cursor: pointer;
      flex-shrink: 0;
    }
    .skill-slug {
      font-size: 12px;
      color: var(--text-secondary, rgb(139, 133, 127));
      min-width: 100px;
    }
    .skill-display-name-input {
      flex: 1;
      padding: 4px 6px;
      border: 1px solid var(--border, rgb(229, 231, 235));
      border-radius: 4px;
      font-size: 13px;
      font-family: inherit;
      color: var(--text-primary, rgb(39, 36, 34));
      background: var(--bg-base, rgb(255, 255, 255));
      box-sizing: border-box;
      outline: none;
    }
    .skill-display-name-input:focus {
      border-color: var(--accent, rgb(13, 113, 73));
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
    .btn-danger {
      color: rgb(220, 38, 38);
      border-color: rgb(220, 38, 38);
    }
    .btn-danger:hover {
      background: rgba(220, 38, 38, 0.08);
    }
    .delete-confirm-dialog {
      position: fixed;
      inset: 0;
      background: rgba(0, 0, 0, 0.5);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 1100;
    }
    .delete-confirm-box {
      background: var(--bg-base, rgb(255, 255, 255));
      border-radius: 8px;
      padding: 20px;
      width: 320px;
      box-shadow: 0 4px 16px rgba(0, 0, 0, 0.2);
    }
    .delete-confirm-box p {
      margin: 0 0 16px 0;
      font-size: 14px;
    }
    .delete-confirm-actions {
      display: flex;
      gap: 8px;
      justify-content: flex-end;
    }
  `;

  static override properties = {
    agent: { type: Object },
    mode: { type: String },
    open: { type: Boolean },
    skills: { type: Array },
    uiConfig: { type: Object },
    _formState: { state: true },
    _visibleSkills: { state: true },
    _showDeleteConfirm: { state: true },
    _showCancelConfirm: { state: true },
    _dirty: { state: true },
  };

  declare agent: AgentProfile;
  declare mode: 'default' | 'professional';
  declare open: boolean;
  declare skills: Array<{ name: string; description: string; template?: string }>;
  declare uiConfig: UiConfig;

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
  declare private _visibleSkills: Array<{
    slug: string;
    displayName: string;
    visible: boolean;
  }>;
  declare private _showDeleteConfirm: boolean;
  declare private _showCancelConfirm: boolean;
  declare private _dirty: boolean;

  constructor() {
    super();
    this.agent = {
      name: '',
      description: '',
      userId: '',
      type: 'default',
      slug: '',
      createdAt: 0,
      updatedAt: 0,
      personality: '',
    };
    this.mode = 'default';
    this.open = false;
    this.skills = [];
    this.uiConfig = { visibleSkills: [] };
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
    this._visibleSkills = [];
    this._showDeleteConfirm = false;
    this._showCancelConfirm = false;
    this._dirty = false;
  }

  protected override willUpdate(changedProps: PropertyValues): void {
    if (changedProps.has('open') && this.open && this.agent) {
      this._initFormState();
    }
    if (
      (changedProps.has('skills') || changedProps.has('uiConfig')) &&
      this.mode === 'default'
    ) {
      this._initVisibleSkills();
    }
  }

  private _initFormState(): void {
    const a = this.agent;
    this._formState = {
      name: a.name,
      description: a.description,
      personality: a.personality,
      memoryEnabled: true,
      model: a.model ?? '',
      temperature: a.temperature?.toString() ?? '',
      maxTokens: a.maxTokens?.toString() ?? '',
      reasoningEffort: a.reasoningEffort ?? 'none',
      thinkingType: a.thinkingType ?? 'adaptive',
      thinkingBudgetTokens: a.thinkingBudgetTokens?.toString() ?? '',
    };
    this._dirty = false;
  }

  private _initVisibleSkills(): void {
    const list = this.skills ?? [];
    const cfg = this.uiConfig ?? { visibleSkills: [] };
    this._visibleSkills = list.map((s) => {
      const existing = cfg.visibleSkills.find((v) => v.slug === s.name);
      return {
        slug: s.name,
        displayName: existing?.displayName ?? s.name,
        visible: !!existing,
      };
    });
  }

  protected override render() {
    if (!this.open) return html``;

    return html`
      <div class="modal-backdrop" @click=${this._handleBackdropClick}>
        <div class="modal-container" @click=${this._stopPropagation}>
          <div class="modal-header">
            ${this.mode === 'professional' ? 'Agent 设置' : '通用 Agent 设置'}
          </div>
          <div class="modal-body">
            ${this.mode === 'professional'
              ? html`
                  <div class="section identity-section">
                    <h3>身份配置</h3>
                    <div class="form-field field-name">
                      <label>名称</label>
                      <input
                        type="text"
                        .value=${this._formState.name}
                        @input=${this._handleNameInput}
                      />
                    </div>
                    <div class="form-field field-description">
                      <label>描述</label>
                      <input
                        type="text"
                        .value=${this._formState.description}
                        @input=${this._handleDescriptionInput}
                      />
                    </div>
                  </div>
                  <div class="section personality-section">
                    <h3>性格配置</h3>
                    <div class="form-field field-personality">
                      <label>人格描述</label>
                      <textarea
                        .value=${this._formState.personality}
                        @input=${this._handlePersonalityInput}
                      ></textarea>
                    </div>
                  </div>
                  <div class="section memory-config-section">
                    <h3>记忆配置</h3>
                    <div class="toggle-row">
                      <input
                        type="checkbox"
                        .checked=${this._formState.memoryEnabled}
                        @change=${this._handleMemoryToggle}
                      />
                      <span>启用记忆（持久化 agent 跨会话上下文）</span>
                    </div>
                  </div>
                `
              : ''}
            <div class="section llm-config-section">
              <h3>LLM 配置</h3>
              <div class="form-field field-model">
                <label>模型</label>
                <input
                  type="text"
                  .value=${this._formState.model}
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
                  .value=${this._formState.temperature}
                  @input=${this._handleTemperatureInput}
                />
              </div>
              <div class="form-field field-maxTokens">
                <label>Max Tokens</label>
                <input
                  type="number"
                  min="1"
                  max="200000"
                  .value=${this._formState.maxTokens}
                  @input=${this._handleMaxTokensInput}
                />
              </div>
              <div class="form-field field-reasoningEffort">
                <label>Reasoning Effort</label>
                <select
                  .value=${this._formState.reasoningEffort}
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
                  .value=${this._formState.thinkingType}
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
                  .value=${this._formState.thinkingBudgetTokens}
                  @input=${this._handleThinkingBudgetInput}
                />
              </div>
            </div>
            ${this.mode === 'default'
              ? html`
                  <div class="section skill-config-section">
                    <h3>Skill 展示配置</h3>
                    ${this._visibleSkills.map(
                      (s, i) => html`
                        <div class="skill-item">
                          <input
                            type="checkbox"
                            .checked=${s.visible}
                            @change=${(e: Event) =>
                              this._handleSkillVisibleChange(
                                i,
                                (e.target as HTMLInputElement).checked,
                              )}
                          />
                          <span class="skill-slug">${s.slug}</span>
                          <input
                            class="skill-display-name-input"
                            type="text"
                            .value=${s.displayName}
                            @input=${(e: Event) =>
                              this._handleSkillDisplayNameChange(
                                i,
                                (e.target as HTMLInputElement).value,
                              )}
                          />
                        </div>
                      `,
                    )}
                  </div>
                `
              : ''}
          </div>
          <div class="modal-footer">
            <div class="footer-left">
              ${this.mode === 'professional'
                ? html`<button
                    class="btn btn-danger delete-btn"
                    @click=${this._handleDeleteClick}
                  >
                    删除
                  </button>`
                : ''}
            </div>
            <button class="btn cancel-btn" @click=${this._handleCancelClick}>
              取消
            </button>
            <button class="btn btn-primary save-btn" @click=${this._handleSaveClick}>
              保存
            </button>
          </div>
        </div>
      </div>
      ${this._showDeleteConfirm ? this._renderDeleteConfirm() : ''}
      ${this._showCancelConfirm ? this._renderCancelConfirm() : ''}
    `;
  }

  private _renderDeleteConfirm() {
    return html`
      <div class="delete-confirm-dialog" @click=${this._stopPropagation}>
        <div class="delete-confirm-box">
          <p>确认删除此 agent？此操作不可撤销。</p>
          <div class="delete-confirm-actions">
            <button
              class="btn cancel-btn"
              @click=${() => {
                this._showDeleteConfirm = false;
              }}
            >
              取消
            </button>
            <button
              class="btn btn-danger delete-confirm-btn"
              @click=${this._handleDeleteConfirm}
            >
              确认删除
            </button>
          </div>
        </div>
      </div>
    `;
  }

  private _renderCancelConfirm() {
    return html`
      <div class="delete-confirm-dialog" @click=${this._stopPropagation}>
        <div class="delete-confirm-box">
          <p>有未保存的修改，确认放弃？</p>
          <div class="delete-confirm-actions">
            <button
              class="btn cancel-btn"
              @click=${() => {
                this._showCancelConfirm = false;
              }}
            >
              继续编辑
            </button>
            <button
              class="btn btn-primary delete-confirm-btn"
              @click=${this._handleCancelConfirm}
            >
              确认放弃
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

  private _handleSkillVisibleChange(index: number, visible: boolean) {
    const list = this._visibleSkills.map((s, i) =>
      i === index ? { ...s, visible } : s,
    );
    this._visibleSkills = list;
    this._markDirty();
  }

  private _handleSkillDisplayNameChange(index: number, displayName: string) {
    const list = this._visibleSkills.map((s, i) =>
      i === index ? { ...s, displayName } : s,
    );
    this._visibleSkills = list;
    this._markDirty();
  }

  private _handleSaveClick() {
    const fs = this._formState;
    const agent: Record<string, unknown> = {
      name: fs.name,
      description: fs.description,
      personality: fs.personality,
      memoryEnabled: fs.memoryEnabled,
      model: fs.model || undefined,
      temperature: fs.temperature ? parseFloat(fs.temperature) : undefined,
      maxTokens: fs.maxTokens ? parseInt(fs.maxTokens, 10) : undefined,
      reasoningEffort: fs.reasoningEffort,
      thinkingType: fs.thinkingType,
      thinkingBudgetTokens: fs.thinkingBudgetTokens
        ? parseInt(fs.thinkingBudgetTokens, 10)
        : undefined,
    };
    // 移除 undefined 值，保持 payload 简洁
    Object.keys(agent).forEach((k) => {
      if (agent[k] === undefined) delete agent[k];
    });

    const detail: { agent: typeof agent; uiConfig?: UiConfig } = { agent };
    if (this.mode === 'default') {
      detail.uiConfig = {
        visibleSkills: this._visibleSkills
          .filter((s) => s.visible)
          .map((s) => ({ slug: s.slug, displayName: s.displayName })),
      };
    }
    this._dirty = false;
    this.dispatchEvent(
      new CustomEvent('update', {
        detail,
        bubbles: true,
        composed: true,
      }),
    );
  }

  private _handleCancelClick() {
    if (this._dirty) {
      this._showCancelConfirm = true;
      return;
    }
    this.dispatchEvent(
      new CustomEvent('close', {
        detail: {},
        bubbles: true,
        composed: true,
      }),
    );
  }

  private _handleCancelConfirm() {
    this._showCancelConfirm = false;
    this._dirty = false;
    this.dispatchEvent(
      new CustomEvent('close', {
        detail: {},
        bubbles: true,
        composed: true,
      }),
    );
  }

  private _handleDeleteClick() {
    this._showDeleteConfirm = true;
  }

  private _handleDeleteConfirm() {
    this._showDeleteConfirm = false;
    this.dispatchEvent(
      new CustomEvent('delete', {
        detail: { slug: this.agent.slug },
        bubbles: true,
        composed: true,
      }),
    );
  }
}

if (!customElements.get('agent-settings-modal')) {
  customElements.define('agent-settings-modal', AgentSettingsModal);
}

declare global {
  interface HTMLElementTagNameMap {
    'agent-settings-modal': AgentSettingsModal;
  }
}
