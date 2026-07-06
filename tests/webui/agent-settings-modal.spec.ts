// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from 'vitest';
import '../../src/webui/components/agent-settings-modal.js';
import type { AgentSettingsModal } from '../../src/webui/components/agent-settings-modal.js';
import type { AgentProfile } from '../../src/core/agent/agent-profile.js';
import type { UiConfig } from '../../src/core/agent/ui-config.js';

/**
 * §0.3.0 Task 14: <agent-settings-modal> 测试
 *
 * 验证 6 个 brief 场景：
 * 1. 通用模式显示 LLM 配置 + Skill 配置，无 personality + 无删除按钮
 * 2. 专业模式显示全部配置 + 删除按钮
 * 3. 居中 modal 渲染正确
 * 4. 保存触发 update 事件
 * 5. 取消触发 close 事件
 * 6. 删除按钮触发确认弹窗
 * + 补充：点击遮罩不关闭 / 删除确认后触发 delete 事件 / unsaved 提示
 */

async function settled(el: HTMLElement): Promise<void> {
  await (el as unknown as { updateComplete?: Promise<unknown> }).updateComplete;
  await new Promise((r) => setTimeout(r, 0));
}

function makeAgent(overrides: Partial<AgentProfile> = {}): AgentProfile {
  return {
    name: 'Test Agent',
    description: 'Test description',
    userId: 'user-1',
    type: 'professional',
    slug: 'agent-test',
    createdAt: 1700000000000,
    updatedAt: 1700000000000,
    personality: 'Test personality',
    ...overrides,
  };
}

function makeSkills(): Array<{ name: string; description: string }> {
  return [
    { name: 'skill-a', description: 'Skill A description' },
    { name: 'skill-b', description: 'Skill B description' },
  ];
}

function makeUiConfig(): UiConfig {
  return {
    visibleSkills: [{ slug: 'skill-a', displayName: 'Skill A' }],
  };
}

describe('Task 14: <agent-settings-modal> agent 设置浮层', () => {
  let modal: AgentSettingsModal;

  beforeEach(() => {
    document.body.innerHTML = '';
    modal = document.createElement('agent-settings-modal') as AgentSettingsModal;
    document.body.appendChild(modal);
  });

  it('通用模式显示 LLM 配置 + Skill 配置，无 personality + 无删除按钮', async () => {
    modal.agent = makeAgent({ type: 'default', slug: 'default' });
    modal.mode = 'default';
    modal.open = true;
    modal.skills = makeSkills();
    modal.uiConfig = makeUiConfig();
    await settled(modal);

    const root = modal.shadowRoot!;
    expect(root.querySelector('.llm-config-section')).toBeTruthy();
    expect(root.querySelector('.skill-config-section')).toBeTruthy();
    expect(root.querySelector('.personality-section')).toBeFalsy();
    expect(root.querySelector('.delete-btn')).toBeFalsy();
  });

  it('专业模式显示全部配置 + 删除按钮', async () => {
    modal.agent = makeAgent({ type: 'professional' });
    modal.mode = 'professional';
    modal.open = true;
    await settled(modal);

    const root = modal.shadowRoot!;
    expect(root.querySelector('.identity-section')).toBeTruthy();
    expect(root.querySelector('.personality-section')).toBeTruthy();
    expect(root.querySelector('.memory-config-section')).toBeTruthy();
    expect(root.querySelector('.llm-config-section')).toBeTruthy();
    expect(root.querySelector('.delete-btn')).toBeTruthy();
    expect(root.querySelector('.skill-config-section')).toBeFalsy();
  });

  it('居中 modal 渲染正确（backdrop + container）', async () => {
    modal.agent = makeAgent();
    modal.mode = 'professional';
    modal.open = true;
    await settled(modal);

    const root = modal.shadowRoot!;
    const backdrop = root.querySelector('.modal-backdrop');
    expect(backdrop).toBeTruthy();
    const container = root.querySelector('.modal-container');
    expect(container).toBeTruthy();
  });

  it('保存触发 update 事件（含修改后的配置）', async () => {
    modal.agent = makeAgent({ name: 'Original', model: 'gpt-4' });
    modal.mode = 'professional';
    modal.open = true;
    await settled(modal);

    let updateDetail: unknown = null;
    modal.addEventListener('update', (e: Event) => {
      updateDetail = (e as CustomEvent).detail;
    });

    const saveBtn = modal.shadowRoot!.querySelector('.save-btn') as HTMLButtonElement;
    saveBtn.click();
    await settled(modal);

    expect(updateDetail).toBeTruthy();
    const detail = updateDetail as { agent: { name?: string } };
    expect(detail.agent).toBeTruthy();
    expect(detail.agent.name).toBe('Original');
  });

  it('取消触发 close 事件', async () => {
    modal.agent = makeAgent();
    modal.mode = 'professional';
    modal.open = true;
    await settled(modal);

    let closed = false;
    modal.addEventListener('close', () => {
      closed = true;
    });

    const cancelBtn = modal.shadowRoot!.querySelector('.cancel-btn') as HTMLButtonElement;
    cancelBtn.click();
    await settled(modal);

    expect(closed).toBe(true);
  });

  it('有未保存修改时取消 → 弹确认对话框 → 确认放弃后触发 close 事件', async () => {
    modal.agent = makeAgent({ name: 'Original' });
    modal.mode = 'professional';
    modal.open = true;
    await settled(modal);

    // 编辑 name 字段，触发 _dirty=true
    const nameInput = modal.shadowRoot!.querySelector(
      '.field-name input',
    ) as HTMLInputElement;
    nameInput.value = 'Edited Name';
    nameInput.dispatchEvent(new Event('input', { bubbles: true }));
    await settled(modal);

    let closed = false;
    modal.addEventListener('close', () => {
      closed = true;
    });

    // 点击取消 → 因 _dirty=true，弹出确认对话框（不直接 close）
    const cancelBtn = modal.shadowRoot!.querySelector('.cancel-btn') as HTMLButtonElement;
    cancelBtn.click();
    await settled(modal);

    // 确认对话框已渲染，「确认放弃」按钮可见
    const confirmDialog = modal.shadowRoot!.querySelector('.delete-confirm-dialog');
    expect(confirmDialog).toBeTruthy();
    const confirmAbandonBtn = modal.shadowRoot!.querySelector(
      '.delete-confirm-btn',
    ) as HTMLButtonElement;
    expect(confirmAbandonBtn).toBeTruthy();
    expect(confirmAbandonBtn.textContent?.trim()).toBe('确认放弃');

    // 此时还未 dispatch close（等待用户确认）
    expect(closed).toBe(false);

    // 点击「确认放弃」→ dispatch close
    confirmAbandonBtn.click();
    await settled(modal);

    expect(closed).toBe(true);
  });

  it('删除按钮触发确认弹窗（professional only）', async () => {
    modal.agent = makeAgent({ type: 'professional' });
    modal.mode = 'professional';
    modal.open = true;
    await settled(modal);

    const deleteBtn = modal.shadowRoot!.querySelector('.delete-btn') as HTMLButtonElement;
    deleteBtn.click();
    await settled(modal);

    const confirmDialog = modal.shadowRoot!.querySelector('.delete-confirm-dialog');
    expect(confirmDialog).toBeTruthy();
  });

  it('点击遮罩不关闭', async () => {
    modal.agent = makeAgent();
    modal.mode = 'professional';
    modal.open = true;
    await settled(modal);

    let closed = false;
    modal.addEventListener('close', () => {
      closed = true;
    });

    const backdrop = modal.shadowRoot!.querySelector('.modal-backdrop') as HTMLElement;
    backdrop.click();
    await settled(modal);

    expect(closed).toBe(false);
  });

  it('删除确认后触发 delete 事件（detail.slug）', async () => {
    modal.agent = makeAgent({ type: 'professional', slug: 'agent-xyz' });
    modal.mode = 'professional';
    modal.open = true;
    await settled(modal);

    let deleteDetail: unknown = null;
    modal.addEventListener('delete', (e: Event) => {
      deleteDetail = (e as CustomEvent).detail;
    });

    const deleteBtn = modal.shadowRoot!.querySelector('.delete-btn') as HTMLButtonElement;
    deleteBtn.click();
    await settled(modal);

    const confirmBtn = modal.shadowRoot!.querySelector('.delete-confirm-btn') as HTMLButtonElement;
    confirmBtn.click();
    await settled(modal);

    expect(deleteDetail).toBeTruthy();
    expect((deleteDetail as { slug: string }).slug).toBe('agent-xyz');
  });

  it('LLM 配置区字段齐全（model/temperature/maxTokens/reasoningEffort/thinkingType/thinkingBudgetTokens）', async () => {
    modal.agent = makeAgent();
    modal.mode = 'professional';
    modal.open = true;
    await settled(modal);

    const root = modal.shadowRoot!;
    expect(root.querySelector('.field-model')).toBeTruthy();
    expect(root.querySelector('.field-temperature')).toBeTruthy();
    expect(root.querySelector('.field-maxTokens')).toBeTruthy();
    expect(root.querySelector('.field-reasoningEffort')).toBeTruthy();
    expect(root.querySelector('.field-thinkingType')).toBeTruthy();
    expect(root.querySelector('.field-thinkingBudgetTokens')).toBeTruthy();
  });

  it('Skill 展示配置区：列出所有 skill（checkbox + displayName input）', async () => {
    modal.agent = makeAgent({ type: 'default', slug: 'default' });
    modal.mode = 'default';
    modal.open = true;
    modal.skills = makeSkills();
    modal.uiConfig = makeUiConfig();
    await settled(modal);

    const root = modal.shadowRoot!;
    const skillItems = root.querySelectorAll('.skill-item');
    expect(skillItems.length).toBe(2);
    // 每项有 checkbox + displayName input
    const firstItem = skillItems[0];
    expect(firstItem.querySelector('input[type="checkbox"]')).toBeTruthy();
    expect(firstItem.querySelector('.skill-display-name-input')).toBeTruthy();
  });

  it('open=false 时不渲染 modal 内容', async () => {
    modal.agent = makeAgent();
    modal.mode = 'professional';
    modal.open = false;
    await settled(modal);

    expect(modal.shadowRoot!.querySelector('.modal-backdrop')).toBeFalsy();
    expect(modal.shadowRoot!.querySelector('.modal-container')).toBeFalsy();
  });

  it('修改表单字段后保存，update 事件含修改后的值', async () => {
    modal.agent = makeAgent({ name: 'Original', temperature: 0.5 });
    modal.mode = 'professional';
    modal.open = true;
    await settled(modal);

    const nameInput = modal.shadowRoot!.querySelector('.field-name input') as HTMLInputElement;
    nameInput.value = 'Updated Name';
    nameInput.dispatchEvent(new Event('input', { bubbles: true }));
    await settled(modal);

    let updateDetail: unknown = null;
    modal.addEventListener('update', (e: Event) => {
      updateDetail = (e as CustomEvent).detail;
    });

    const saveBtn = modal.shadowRoot!.querySelector('.save-btn') as HTMLButtonElement;
    saveBtn.click();
    await settled(modal);

    const detail = updateDetail as { agent: { name: string } };
    expect(detail.agent.name).toBe('Updated Name');
  });
});
