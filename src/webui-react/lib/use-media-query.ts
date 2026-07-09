/**
 * Task 1 (0.3.1 mobile adaptation): useIsDesktop hook。
 *
 * 返回当前视口是否 ≥768px（Tailwind `md` 断点），供 App.tsx 及各组件
 * 决定移动端 vs 桌面端交互行为（抽屉开闭 / 模态全屏 / 快捷指令缩放等）。
 *
 * 实现：
 *   - SSR 守护：`typeof window === 'undefined'` 时直接返回 false，不调用
 *     任何 React hook（避免 SSR 环境无 window 抛错）。
 *   - useState 惰性初始化：从 `window.matchMedia('(min-width: 768px)').matches`
 *     读取初始值，避免每次 render 重复调用 matchMedia。
 *   - useEffect 内 addEventListener('resize', handler) 监听视口变化，
 *     handler 重新读取 matchMedia.matches 并 setState；cleanup 移除监听。
 *
 * 断点阈值 768px 与 plan §Global Constraints 一致（Tailwind `md`）。
 */
import { useEffect, useState } from 'react';

const DESKTOP_QUERY = '(min-width: 768px)';

/**
 * 返回当前视口是否处于桌面端（≥768px）。
 *
 * SSR 安全：服务端渲染时返回 false，不抛错。
 */
export function useIsDesktop(): boolean {
  // SSR 守护：在调用任何 React hook 之前 early-return
  if (typeof window === 'undefined') return false;

  // 惰性初始化：仅在首次 render 时调用 matchMedia
  const [isDesktop, setIsDesktop] = useState<boolean>(
    () => window.matchMedia(DESKTOP_QUERY).matches,
  );

  useEffect(() => {
    const handler = () => {
      setIsDesktop(window.matchMedia(DESKTOP_QUERY).matches);
    };
    window.addEventListener('resize', handler);
    return () => {
      window.removeEventListener('resize', handler);
    };
  }, []);

  return isDesktop;
}
