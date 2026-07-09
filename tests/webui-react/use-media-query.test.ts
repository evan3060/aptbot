// @vitest-environment happy-dom
/**
 * Task 1 (0.3.1 mobile adaptation): useIsDesktop hook 单元测试。
 *
 * 验证 brief Step 1 要求的 5 个场景：
 *   1. matchMedia mock 返回 matches:true 时返回 true
 *   2. matchMedia mock 返回 matches:false 时返回 false
 *   3. resize 事件触发且 matchMedia.matches 切换时更新返回值
 *   4. typeof window === 'undefined' 时（模拟 SSR）返回 false 不抛错
 *   5. 卸载时移除 resize 监听（spy 断言 removeEventListener 被调用）
 *
 * happy-dom 默认无 window.matchMedia，需 mock（via vi.stubGlobal）。
 *
 * 注：项目遵循"不引入新依赖"约束（plan §Global Constraints），
 * 不安装 @testing-library/react。这里使用 react-dom/client + flushSync
 * 实现最小 renderHook，功能等价于 @testing-library/react 的 renderHook。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { useIsDesktop } from '../../src/webui-react/lib/use-media-query.js';

/** 最小 renderHook：挂载调用 hook 的组件，通过闭包 result 读取最新返回值 */
function renderHook<T>(hook: () => T): {
  result: { current: T };
  rerender: () => void;
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
    rerender: () => {
      flushSync(() => {
        root.render(createElement(TestComponent));
      });
    },
    unmount: () => {
      flushSync(() => {
        root.unmount();
      });
      container.remove();
    },
  };
}

/**
 * 安装 matchMedia mock，返回控制句柄用于动态切换 matches 值。
 * happy-dom 默认不提供 window.matchMedia，必须 mock。
 */
function installMatchMediaMock(initialMatches: boolean) {
  let currentMatches = initialMatches;
  const mock = vi.fn((query: string) =>
    ({
      matches: currentMatches,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }) as unknown as MediaQueryList,
  );
  vi.stubGlobal('matchMedia', mock);
  return {
    mock,
    setMatches: (next: boolean) => {
      currentMatches = next;
    },
  };
}

describe('useIsDesktop', () => {
  let matchMediaControl: ReturnType<typeof installMatchMediaMock>;

  beforeEach(() => {
    matchMediaControl = installMatchMediaMock(false);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('matchMedia matches:true 时返回 true', () => {
    matchMediaControl.setMatches(true);
    const { result, unmount } = renderHook(() => useIsDesktop());
    expect(result.current).toBe(true);
    expect(matchMediaControl.mock).toHaveBeenCalledWith('(min-width: 768px)');
    unmount();
  });

  it('matchMedia matches:false 时返回 false', () => {
    matchMediaControl.setMatches(false);
    const { result, unmount } = renderHook(() => useIsDesktop());
    expect(result.current).toBe(false);
    unmount();
  });

  it('resize 事件触发且 matchMedia.matches 切换时更新返回值', () => {
    // 初始 false
    const { result, unmount } = renderHook(() => useIsDesktop());
    expect(result.current).toBe(false);

    // 切换为 true 并触发 resize
    matchMediaControl.setMatches(true);
    flushSync(() => {
      window.dispatchEvent(new Event('resize'));
    });
    expect(result.current).toBe(true);

    // 再切换回 false 验证可重复响应
    matchMediaControl.setMatches(false);
    flushSync(() => {
      window.dispatchEvent(new Event('resize'));
    });
    expect(result.current).toBe(false);
    unmount();
  });

  it('typeof window === "undefined" 时（SSR）返回 false 不抛错', () => {
    // 模拟 SSR：把 globalThis.window 设为 undefined，使 typeof window === 'undefined'。
    // hook 的 SSR 守卫在调用任何 React hook 之前 early-return，
    // 所以可直接调用而不进入 React 渲染（不违反 Rules of Hooks）。
    const originalDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'window');
    try {
      Object.defineProperty(globalThis, 'window', {
        value: undefined,
        writable: true,
        configurable: true,
      });
      expect(useIsDesktop()).toBe(false);
    } finally {
      if (originalDescriptor) {
        Object.defineProperty(globalThis, 'window', originalDescriptor);
      }
    }
  });

  it('卸载时移除 resize 监听', () => {
    const removeSpy = vi.spyOn(window, 'removeEventListener');
    const { unmount } = renderHook(() => useIsDesktop());
    // 卸载前 removeEventListener 尚未被调用（此时只有 addEventListener 触发过）
    const callsBeforeUnmount = removeSpy.mock.calls.length;
    unmount();
    // 卸载后 cleanup 应调用 removeEventListener，且至少有一次是 'resize'
    expect(removeSpy.mock.calls.length).toBeGreaterThan(callsBeforeUnmount);
    expect(removeSpy.mock.calls.some(([type]) => type === 'resize')).toBe(true);
  });
});
