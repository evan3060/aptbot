/**
 * Task 2 (0.3.1 mobile adaptation): useQuickActionsLayout hook + 纯算法函数。
 *
 * 计算给定容器宽度下,多少个快捷指令按钮可以可见,其余溢出到「更多」面板。
 * Task 7 的 InputArea 移动端适配会消费此 hook 渲染 UI。
 *
 * 算法:
 *   - 预估每个按钮宽度 = label.length × 7 + 18 + 16 + 8
 *     (charWidth=7, iconWidth=18, padding=16, gap=8)
 *   - MORE_BUTTON_WIDTH = 64(「更多」按钮预留宽度)
 *   - 先尝试全放下(累加 ≤ containerWidth);成功则不预留「更多」按钮
 *   - 失败则 availableWidth = containerWidth - MORE_BUTTON_WIDTH,贪心填充
 *
 * 导出:
 *   - QuickActionButton 类型
 *   - computeQuickActionsLayout(containerWidth, buttons) 纯函数(可独立测试)
 *   - useQuickActionsLayout(containerWidth, buttons) hook(薄封装,附 isMeasuring)
 */
import { useMemo } from 'react';

/** 「更多」按钮预留宽度(px) */
export const MORE_BUTTON_WIDTH = 64;

const CHAR_WIDTH = 7;
const ICON_WIDTH = 18;
const PADDING = 16;
const GAP = 8;

export interface QuickActionButton {
  id: string;
  label: string;
  icon?: string;
}

export interface QuickActionsLayout {
  visibleButtons: QuickActionButton[];
  overflowButtons: QuickActionButton[];
}

/** 预估单个按钮渲染宽度:label 字符 × charWidth + iconWidth + padding + gap */
function estimateButtonWidth(btn: QuickActionButton): number {
  return (btn.label?.length ?? 0) * CHAR_WIDTH + ICON_WIDTH + PADDING + GAP;
}

/**
 * 纯函数:计算可见 vs 溢出按钮。无 React 依赖,可独立测试。
 *
 * 算法:
 *   1. 先尝试全放下(累加所有按钮宽度 ≤ containerWidth)→ overflowButtons=[]
 *   2. 否则 availableWidth = containerWidth - MORE_BUTTON_WIDTH,贪心填充
 *      逐个累加,若加入下一个会超出 availableWidth 则停止,剩余全部进 overflow
 */
export function computeQuickActionsLayout(
  containerWidth: number,
  buttons: QuickActionButton[],
): QuickActionsLayout {
  const widths = buttons.map(estimateButtonWidth);
  const totalWidth = widths.reduce((sum, w) => sum + w, 0);

  // 先尝试全放下(不预留「更多」按钮)
  if (totalWidth <= containerWidth) {
    return { visibleButtons: [...buttons], overflowButtons: [] };
  }

  // 失败:预留「更多」按钮宽度后贪心填充
  const availableWidth = containerWidth - MORE_BUTTON_WIDTH;
  let accumulated = 0;
  let visibleCount = 0;
  for (let i = 0; i < buttons.length; i++) {
    if (accumulated + widths[i] <= availableWidth) {
      accumulated += widths[i];
      visibleCount = i + 1;
    } else {
      break;
    }
  }

  const visibleButtons = buttons.slice(0, visibleCount);
  const overflowButtons = buttons.slice(visibleCount);
  return { visibleButtons, overflowButtons };
}

/**
 * Hook:薄封装 computeQuickActionsLayout,额外返回 isMeasuring
 * (containerWidth === 0 时为 true,表示容器尚未完成测量)。
 */
export function useQuickActionsLayout(
  containerWidth: number,
  buttons: QuickActionButton[],
): QuickActionsLayout & { isMeasuring: boolean } {
  const layout = useMemo(
    () => computeQuickActionsLayout(containerWidth, buttons),
    [containerWidth, buttons],
  );
  return { ...layout, isMeasuring: containerWidth === 0 };
}
