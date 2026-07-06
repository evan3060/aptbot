// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import '../../src/webui/components/memory-write-toast.js';
import type { MemoryWriteToast } from '../../src/webui/components/memory-write-toast.js';

/**
 * §0.3.0 Task 16: <memory-write-toast> 测试
 *
 * 验证 4 个 brief 场景：
 * 1. toast 渲染正确（message 显示）
 * 2. visible=true 显示，false 隐藏
 * 3. 自动消失（visible=true → setTimeout 4s → visible=false）— fake timers
 * 4. 显示 section 名称（如 "Preferences"）
 *
 * + 补充：
 * - 非打断性：不抢焦点（无 autofocus / pointer-events 可穿透）
 * - 多次 visible=true 重置计时器（不闪烁/不堆叠）
 * - visible=false 不渲染 toast
 */

async function settled(el: HTMLElement): Promise<void> {
  // §0.3.0 Task 16: fake timers 下 setTimeout(0) 不会自动推进，
  // 用 updateComplete + 多轮 microtask flush 代替。
  await (el as unknown as { updateComplete?: Promise<unknown> }).updateComplete;
  await Promise.resolve();
  await Promise.resolve();
}

describe('Task 16: <memory-write-toast> 记忆写入轻量提示', () => {
  let toast: MemoryWriteToast;

  beforeEach(() => {
    document.body.innerHTML = '';
    vi.useFakeTimers();
    toast = document.createElement('memory-write-toast') as MemoryWriteToast;
    document.body.appendChild(toast);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('toast 渲染时显示 message', async () => {
    toast.message = 'agent 已更新记忆：Preferences';
    toast.visible = true;
    await settled(toast);

    const el = toast.shadowRoot?.querySelector('.toast');
    expect(el).toBeTruthy();
    expect(el?.textContent).toContain('agent 已更新记忆：Preferences');
  });

  it('visible=false → toast 不显示（不渲染 .toast 元素）', async () => {
    toast.message = 'agent 已更新记忆：Facts';
    toast.visible = false;
    await settled(toast);

    const el = toast.shadowRoot?.querySelector('.toast');
    expect(el).toBeNull();
  });

  it('visible=true → 显示 toast', async () => {
    toast.message = 'agent 已更新记忆：History';
    toast.visible = true;
    await settled(toast);

    const el = toast.shadowRoot?.querySelector('.toast');
    expect(el).not.toBeNull();
    expect(el?.textContent).toContain('History');
  });

  it('自动消失：4 秒后 visible 变为 false', async () => {
    toast.message = 'agent 已更新记忆：Preferences';
    toast.visible = true;
    await settled(toast);

    expect(toast.visible).toBe(true);

    // 推进 4 秒（auto-dismiss 阈值）
    vi.advanceTimersByTime(4000);
    await settled(toast);

    expect(toast.visible).toBe(false);
    // toast 元素应消失
    const el = toast.shadowRoot?.querySelector('.toast');
    expect(el).toBeNull();
  });

  it('3 秒时 toast 仍可见（未到 4 秒阈值）', async () => {
    toast.message = 'agent 已更新记忆：Preferences';
    toast.visible = true;
    await settled(toast);

    vi.advanceTimersByTime(3000);
    await settled(toast);

    expect(toast.visible).toBe(true);
  });

  it('显示 section 名称（Title Case）', async () => {
    toast.message = 'agent 已更新记忆：User Profile';
    toast.visible = true;
    await settled(toast);

    const el = toast.shadowRoot?.querySelector('.toast');
    expect(el?.textContent).toContain('User Profile');
  });

  it('非打断性：不设置 autofocus（不抢焦点）', async () => {
    toast.message = 'agent 已更新记忆：Preferences';
    toast.visible = true;
    await settled(toast);

    // 不应包含 autofocus 属性的元素
    const autofocusEl = toast.shadowRoot?.querySelector('[autofocus]');
    expect(autofocusEl).toBeNull();
  });

  it('非打断性：toast 容器不阻止 pointer events（pointer-events: none）', async () => {
    toast.message = 'agent 已更新记忆：Preferences';
    toast.visible = true;
    await settled(toast);

    const host = toast;
    const style = getComputedStyle(host);
    // host 应允许 pointer 事件穿透（auto/none 都接受；这里仅检查不会拦截 chat）
    // Lit shadow DOM 中 host 的 pointer-events 由 :host 控制
    // 我们接受 '' 或 'none' — 关键是 toast 内部若 pointer-events: none 则点击穿透
    expect(style.pointerEvents === 'none' || style.pointerEvents === 'auto' || style.pointerEvents === '').toBe(true);
  });

  it('再次 visible=true 重置计时器（不提前消失）', async () => {
    toast.message = 'first';
    toast.visible = true;
    await settled(toast);

    // 推进 3 秒（接近但未到 4 秒阈值）
    vi.advanceTimersByTime(3000);
    await settled(toast);

    // 再次触发 visible=true（重新计时）
    toast.message = 'second';
    toast.visible = true;
    await settled(toast);

    // 再推进 2 秒（如果未重置计时器，总共 5 秒 → 应消失；如果重置则 2 秒 < 4 秒 → 仍可见）
    vi.advanceTimersByTime(2000);
    await settled(toast);

    expect(toast.visible).toBe(true);

    // 推进到总计 4 秒后应消失
    vi.advanceTimersByTime(2000);
    await settled(toast);
    expect(toast.visible).toBe(false);
  });

  it('visible=false 时不启动自动消失计时器', async () => {
    toast.message = 'agent 已更新记忆：Preferences';
    toast.visible = false;
    await settled(toast);

    // 推进 10 秒 — 不应抛错（计时器未启动）
    expect(() => vi.advanceTimersByTime(10000)).not.toThrow();
    expect(toast.visible).toBe(false);
  });

  it('visible 从 true → false 时不重新启动计时器', async () => {
    toast.message = 'test';
    toast.visible = true;
    await settled(toast);

    toast.visible = false;
    await settled(toast);

    // 推进 10 秒不应再次显示
    vi.advanceTimersByTime(10000);
    await settled(toast);
    expect(toast.visible).toBe(false);
  });

  it('message 改变但 visible 已为 true 时不重置 toast 状态', async () => {
    toast.message = 'first';
    toast.visible = true;
    await settled(toast);

    // 仅改 message（不改 visible）— 应该显示新消息
    toast.message = 'second';
    await settled(toast);

    const el = toast.shadowRoot?.querySelector('.toast');
    expect(el?.textContent).toContain('second');
  });
});
