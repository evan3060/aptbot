// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from 'vitest';
import '../../src/webui/components/new-agent-modal.js';
import type { NewAgentModal } from '../../src/webui/components/new-agent-modal.js';

/**
 * §0.3.0 Task 14: <new-agent-modal> 测试
 *
 * 验证 brief 场景：
 * 7. 新建 agent 浮层 name 输入 + slug 自动生成（用户不感知）
 * 8. 创建按钮触发 create 事件（含新 agent 配置）
 * + 补充：取消触发 close / 共用表单分段（身份/性格/记忆/LLM）/ open=false 不渲染
 */

async function settled(el: HTMLElement): Promise<void> {
  await (el as unknown as { updateComplete?: Promise<unknown> }).updateComplete;
  await new Promise((r) => setTimeout(r, 0));
}

describe('Task 14: <new-agent-modal> 新建 agent 浮层', () => {
  let modal: NewAgentModal;

  beforeEach(() => {
    document.body.innerHTML = '';
    modal = document.createElement('new-agent-modal') as NewAgentModal;
    document.body.appendChild(modal);
  });

  it('name 输入 + slug 自动生成（用户不感知 slug）', async () => {
    modal.open = true;
    await settled(modal);

    const root = modal.shadowRoot!;
    const nameInput = root.querySelector('.field-name input') as HTMLInputElement;
    expect(nameInput).toBeTruthy();

    nameInput.value = 'My Code Assistant';
    nameInput.dispatchEvent(new Event('input', { bubbles: true }));
    await settled(modal);

    let createDetail: unknown = null;
    modal.addEventListener('create', (e: Event) => {
      createDetail = (e as CustomEvent).detail;
    });

    const createBtn = root.querySelector('.create-btn') as HTMLButtonElement;
    createBtn.click();
    await settled(modal);

    const detail = createDetail as { name: string; slug: string };
    expect(detail.name).toBe('My Code Assistant');
    // slug 自动生成，匹配 agent-<6-hex> 模式
    expect(detail.slug).toMatch(/^agent-[a-f0-9]{6}$/);
    // slug 输入框对用户不可见
    expect(root.querySelector('.field-slug')).toBeFalsy();
  });

  it('创建按钮触发 create 事件（含新 agent 配置）', async () => {
    modal.open = true;
    await settled(modal);

    let createDetail: unknown = null;
    modal.addEventListener('create', (e: Event) => {
      createDetail = (e as CustomEvent).detail;
    });

    const createBtn = modal.shadowRoot!.querySelector('.create-btn') as HTMLButtonElement;
    createBtn.click();
    await settled(modal);

    expect(createDetail).toBeTruthy();
    const detail = createDetail as Record<string, unknown>;
    // 共用表单分段：身份/性格/记忆/LLM
    expect(detail).toHaveProperty('name');
    expect(detail).toHaveProperty('description');
    expect(detail).toHaveProperty('personality');
    expect(detail).toHaveProperty('memoryEnabled');
    expect(detail).toHaveProperty('model');
    // slug 自动生成
    expect(detail).toHaveProperty('slug');
  });

  it('取消触发 close 事件', async () => {
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

  it('共用表单分段（身份/性格/记忆/LLM）', async () => {
    modal.open = true;
    await settled(modal);

    const root = modal.shadowRoot!;
    expect(root.querySelector('.identity-section')).toBeTruthy();
    expect(root.querySelector('.personality-section')).toBeTruthy();
    expect(root.querySelector('.memory-config-section')).toBeTruthy();
    expect(root.querySelector('.llm-config-section')).toBeTruthy();
    // 新建浮层不应有删除按钮
    expect(root.querySelector('.delete-btn')).toBeFalsy();
  });

  it('居中 modal 渲染正确（backdrop + container）', async () => {
    modal.open = true;
    await settled(modal);

    const root = modal.shadowRoot!;
    expect(root.querySelector('.modal-backdrop')).toBeTruthy();
    expect(root.querySelector('.modal-container')).toBeTruthy();
  });

  it('open=false 时不渲染 modal 内容', async () => {
    modal.open = false;
    await settled(modal);

    expect(modal.shadowRoot!.querySelector('.modal-backdrop')).toBeFalsy();
    expect(modal.shadowRoot!.querySelector('.modal-container')).toBeFalsy();
  });

  it('点击遮罩不关闭', async () => {
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

  it('LLM 配置区字段齐全', async () => {
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

  it('填写完整表单后 create 事件含全部修改值', async () => {
    modal.open = true;
    await settled(modal);

    const root = modal.shadowRoot!;

    // 填写 name
    const nameInput = root.querySelector('.field-name input') as HTMLInputElement;
    nameInput.value = '代码助手';
    nameInput.dispatchEvent(new Event('input', { bubbles: true }));

    // 填写 description
    const descInput = root.querySelector('.field-description input') as HTMLInputElement;
    descInput.value = '帮助写代码';
    descInput.dispatchEvent(new Event('input', { bubbles: true }));

    // 填写 personality
    const personalityInput = root.querySelector('.field-personality textarea') as HTMLTextAreaElement;
    personalityInput.value = '严谨的工程师';
    personalityInput.dispatchEvent(new Event('input', { bubbles: true }));

    // 填写 model
    const modelInput = root.querySelector('.field-model input') as HTMLInputElement;
    modelInput.value = 'gpt-4o';
    modelInput.dispatchEvent(new Event('input', { bubbles: true }));

    await settled(modal);

    let createDetail: unknown = null;
    modal.addEventListener('create', (e: Event) => {
      createDetail = (e as CustomEvent).detail;
    });

    const createBtn = root.querySelector('.create-btn') as HTMLButtonElement;
    createBtn.click();
    await settled(modal);

    const detail = createDetail as Record<string, unknown>;
    expect(detail.name).toBe('代码助手');
    expect(detail.description).toBe('帮助写代码');
    expect(detail.personality).toBe('严谨的工程师');
    expect(detail.model).toBe('gpt-4o');
  });
});
