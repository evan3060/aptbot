// @vitest-environment happy-dom
/**
 * Task 2 (0.3.1 mobile adaptation): useQuickActionsLayout hook + 纯算法函数 单元测试。
 *
 * 验证 brief Step 1 要求的 6 个算法场景（全部针对纯函数 computeQuickActionsLayout）:
 *   1. 全部放下:containerWidth=2000 + 16 个短 label 按钮 → overflowButtons 为空
 *   2. 部分溢出:containerWidth=400 + 16 个按钮 → visible < 16 且 overflow > 0,总数 16
 *   3. 全部溢出(极窄屏):containerWidth=100 → visibleButtons 为空,overflow === 16
 *   4. 单个按钮超宽:containerWidth=200 + 1 个超长 label 按钮 → 该按钮进入 overflow
 *   5. 「更多」按钮预留:overflowButtons 非空时,visibleButtons 总宽度 ≤ containerWidth - 64
 *   6. 边界:containerWidth=0 → visibleButtons 为空,overflowButtons.length === 全部
 *
 * 另测 hook 薄封装的 isMeasuring 行为（containerWidth === 0 时 true）。
 *
 * 注:项目遵循"不引入新依赖"约束（plan §Global Constraints）,
 * 不安装 @testing-library/react。这里复用 Task 1 测试中的最小 renderHook 模式
 * （react-dom/client createRoot + flushSync）。
 */
import { describe, it, expect } from 'vitest';
import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import {
  computeQuickActionsLayout,
  useQuickActionsLayout,
  MORE_BUTTON_WIDTH,
  type QuickActionButton,
} from '../../src/webui-react/lib/use-quick-actions-layout.js';

/** 生成 n 个短 label（2 字符）按钮,默认 label 形如 "Q0".."Q15" */
function makeButtons(n: number): QuickActionButton[] {
  return Array.from({ length: n }, (_, i) => ({ id: `b${i}`, label: `Q${i}` }));
}

/** 按预估公式累加 visibleButtons 的总宽度,用于断言「更多」按钮预留约束 */
function sumVisibleWidth(buttons: QuickActionButton[]): number {
  return buttons.reduce((sum, b) => sum + (b.label.length * 7 + 18 + 16 + 8), 0);
}

/** 最小 renderHook:挂载调用 hook 的组件,通过闭包 result 读取最新返回值 */
function renderHook<T>(hook: () => T): {
  result: { current: T };
  unmount: () => void;
} {
  const result: { current: T } = { current: undefined as unknown as T };
  function TestComponent() {
    result.current = hook();
    return null;
  }
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  flushSync(() => {
    root.render(createElement(TestComponent));
  });
  return {
    result,
    unmount: () => {
      flushSync(() => {
        root.unmount();
      });
      container.remove();
    },
  };
}

describe('computeQuickActionsLayout', () => {
  it('1. 全部放下:containerWidth=2000 + 16 个短 label 按钮,overflowButtons 为空', () => {
    const buttons = makeButtons(16);
    const { visibleButtons, overflowButtons } = computeQuickActionsLayout(2000, buttons);
    expect(overflowButtons).toEqual([]);
    expect(visibleButtons.length).toBe(16);
  });

  it('2. 部分溢出:containerWidth=400 + 16 个按钮,visible < 16 且 overflow > 0,总数 16', () => {
    const buttons = makeButtons(16);
    const { visibleButtons, overflowButtons } = computeQuickActionsLayout(400, buttons);
    expect(visibleButtons.length).toBeLessThan(16);
    expect(overflowButtons.length).toBeGreaterThan(0);
    expect(visibleButtons.length + overflowButtons.length).toBe(16);
  });

  it('3. 全部溢出(极窄屏):containerWidth=100,visibleButtons 为空,overflow === 16', () => {
    const buttons = makeButtons(16);
    const { visibleButtons, overflowButtons } = computeQuickActionsLayout(100, buttons);
    expect(visibleButtons).toEqual([]);
    expect(overflowButtons.length).toBe(16);
  });

  it('4. 单个按钮超宽:containerWidth=200 + 1 个超长 label 按钮,该按钮进入 overflow', () => {
    const superLong: QuickActionButton[] = [
      { id: 'long', label: 'X'.repeat(50) }, // 预估宽度 = 50*7+18+16+8 = 392 > 200
    ];
    const { visibleButtons, overflowButtons } = computeQuickActionsLayout(200, superLong);
    expect(visibleButtons).toEqual([]);
    expect(overflowButtons.length).toBe(1);
    expect(overflowButtons[0].id).toBe('long');
  });

  it('5. 「更多」按钮预留:overflowButtons 非空时,visibleButtons 总宽度 ≤ containerWidth - 64', () => {
    const buttons = makeButtons(16);
    const { visibleButtons, overflowButtons } = computeQuickActionsLayout(400, buttons);
    expect(overflowButtons.length).toBeGreaterThan(0);
    const totalVisibleWidth = sumVisibleWidth(visibleButtons);
    expect(totalVisibleWidth).toBeLessThanOrEqual(400 - MORE_BUTTON_WIDTH);
  });

  it('6. 边界:containerWidth=0,visibleButtons 为空,overflowButtons.length === 全部', () => {
    const buttons = makeButtons(16);
    const { visibleButtons, overflowButtons } = computeQuickActionsLayout(0, buttons);
    expect(visibleButtons).toEqual([]);
    expect(overflowButtons.length).toBe(16);
  });
});

describe('useQuickActionsLayout', () => {
  it('containerWidth === 0 时 isMeasuring 为 true,且全部按钮溢出', () => {
    const buttons = makeButtons(16);
    const { result, unmount } = renderHook(() => useQuickActionsLayout(0, buttons));
    expect(result.current.isMeasuring).toBe(true);
    expect(result.current.visibleButtons).toEqual([]);
    expect(result.current.overflowButtons.length).toBe(16);
    unmount();
  });

  it('containerWidth > 0 时 isMeasuring 为 false,且结果与纯函数一致', () => {
    const buttons = makeButtons(16);
    const { result, unmount } = renderHook(() => useQuickActionsLayout(2000, buttons));
    expect(result.current.isMeasuring).toBe(false);
    const pure = computeQuickActionsLayout(2000, buttons);
    expect(result.current.visibleButtons).toEqual(pure.visibleButtons);
    expect(result.current.overflowButtons).toEqual(pure.overflowButtons);
    unmount();
  });
});
