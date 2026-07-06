import { LitElement, html, css } from 'lit';
import type { AgentProfile } from '../../core/agent/agent-profile.js';

/**
 * §0.3.0 Task 15: <skill-chips-bar> Lit 组件 — chat input 上方的 skill chip 区
 *
 * 行为契约：
 * - Properties: visibleSkills (Array<ChipSkill>) / activeSkill (string | null)
 * - chip 横向平铺，数量多时横向滚动（overflow-x: auto）
 * - chip 显示 displayName
 * - 点击 chip → dispatch skill-select CustomEvent（detail: { slug, template? }）
 * - active chip 高亮；点击 active chip 取消选中（dispatch slug=null）
 * - 无 visibleSkills → 不渲染 chip 区（render nothing）
 *
 * 仅 default agent 会话由上层 index.ts 渲染本组件（专业 agent 不渲染）。
 * skill 选择状态不持久化（一次性使用，刷新页面清空）。
 */

/**
 * §0.3.0 Task 15: ChipSkill — chip 渲染单元。
 *
 * = VisibleSkill (slug + displayName) + 可选 template（来自 Skill.template）。
 * template 由上层 index.ts 合并（UiConfig.visibleSkills + Skill.template）。
 * template 可含 `{{cursor}}` 占位符，由 fillTemplate 处理。
 */
export interface ChipSkill {
  readonly slug: string;
  readonly displayName: string;
  readonly template?: string;
}

/**
 * §0.3.0 Task 15: SkillSelectDetail — skill-select 事件 detail 形状。
 *
 * - slug=null → 取消选中（active chip 再次点击）
 * - slug=string → 选中该 skill
 * - template 可选：chip 知道则传，未知则 undefined（上层自行查找）
 */
export interface SkillSelectDetail {
  readonly slug: string | null;
  readonly template?: string;
}

/**
 * §0.3.0 Task 15: fillTemplate — 模板填充纯函数（可独立测试）。
 *
 * 行为契约：
 * - 空 input + 空 template → 不变（cursor 末尾，由调用方决定是否仅激活）
 * - 空 input + 有 template → 覆盖填入
 * - 有 input + 有 template → 追加（含分隔符 '\n'）
 * - template 含 {{cursor}} → 移除占位符，cursor 定位到该处
 * - template 不含 {{cursor}} → cursor 默认在末尾
 * - 多个 {{cursor}} → 仅移除第一个，cursor 定位到首个
 *
 * @param currentInput 当前输入框内容
 * @param template skill 模板字符串（可含 {{cursor}} 占位符）
 * @returns { value: 新输入框内容, cursorPos: 光标位置 }
 */
export function fillTemplate(
  currentInput: string,
  template: string,
): { value: string; cursorPos: number } {
  const input = currentInput ?? '';
  const tpl = template ?? '';

  // 空 template → 不修改输入框（仅激活 skill）
  if (tpl === '') {
    return { value: input, cursorPos: input.length };
  }

  // 计算 cursor 位置 + 移除首个 {{cursor}} 占位符
  const cursorIdx = tpl.indexOf('{{cursor}}');
  let resolvedTpl: string;
  let cursorOffsetInTpl: number;
  if (cursorIdx >= 0) {
    resolvedTpl = tpl.replace('{{cursor}}', '');
    cursorOffsetInTpl = cursorIdx;
  } else {
    resolvedTpl = tpl;
    cursorOffsetInTpl = tpl.length;
  }

  // 空 input → 覆盖填入；有 input → 追加（含 '\n' 分隔符）
  if (input === '') {
    return { value: resolvedTpl, cursorPos: cursorOffsetInTpl };
  }
  const separator = '\n';
  const value = input + separator + resolvedTpl;
  return {
    value,
    cursorPos: input.length + separator.length + cursorOffsetInTpl,
  };
}

/**
 * §0.3.0 Task 15: shouldRenderChipBar — 判断当前 agent 是否应渲染 chip 区。
 *
 * 仅 default agent 显示 chip 区（专业 agent 不渲染）。
 *
 * @param agents 当前 agent 列表
 * @param currentAgentSlug 当前选中的 agent slug
 * @returns true 仅当当前 agent 类型为 'default'
 */
export function shouldRenderChipBar(
  agents: AgentProfile[],
  currentAgentSlug: string,
): boolean {
  const current = agents.find((a) => a.slug === currentAgentSlug);
  return current?.type === 'default';
}

export class SkillChipsBar extends LitElement {
  static override styles = css`
    :host {
      display: block;
      font-family: Inter, system-ui, 'PingFang SC', sans-serif;
      color: var(--text-primary, rgb(39, 36, 34));
    }
    .chips-container {
      display: flex;
      gap: 6px;
      padding: 6px 12px;
      overflow-x: auto;
      border-bottom: 1px solid var(--border, rgb(229, 231, 235));
      max-width: 800px;
      width: 100%;
      margin: 0 auto;
      box-sizing: border-box;
    }
    .chip {
      display: inline-flex;
      align-items: center;
      padding: 4px 10px;
      font-size: 12px;
      border: 1px solid var(--border, rgb(229, 231, 235));
      border-radius: 9999px;
      background: var(--bg-base, rgb(255, 255, 255));
      color: var(--text-secondary, rgb(139, 133, 127));
      cursor: pointer;
      white-space: nowrap;
      user-select: none;
      flex-shrink: 0;
      font-family: inherit;
    }
    .chip:hover {
      border-color: var(--accent, rgb(13, 113, 73));
      color: var(--accent, rgb(13, 113, 73));
    }
    .chip.active {
      background: rgba(13, 113, 73, 0.12);
      border-color: var(--accent, rgb(13, 113, 73));
      color: var(--accent, rgb(13, 113, 73));
    }
  `;

  static override properties = {
    visibleSkills: { type: Array },
    activeSkill: { type: String },
  };

  declare visibleSkills: ChipSkill[];
  declare activeSkill: string | null;

  constructor() {
    super();
    this.visibleSkills = [];
    this.activeSkill = null;
  }

  protected override render() {
    if (this.visibleSkills.length === 0) {
      return html``;
    }
    return html`
      <div class="chips-container">
        ${this.visibleSkills.map(
          (skill) => html`<button
            class="chip${this.activeSkill === skill.slug ? ' active' : ''}"
            @click=${() => this._handleChipClick(skill)}
          >${skill.displayName}</button>`,
        )}
      </div>
    `;
  }

  private _handleChipClick(skill: ChipSkill) {
    const isActive = this.activeSkill === skill.slug;
    const detail: SkillSelectDetail = isActive
      ? { slug: null }
      : { slug: skill.slug, template: skill.template };
    this.dispatchEvent(
      new CustomEvent('skill-select', {
        detail,
        bubbles: true,
        composed: true,
      }),
    );
  }
}

if (!customElements.get('skill-chips-bar')) {
  customElements.define('skill-chips-bar', SkillChipsBar);
}

declare global {
  interface HTMLElementTagNameMap {
    'skill-chips-bar': SkillChipsBar;
  }
}
