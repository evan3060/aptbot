/**
 * Task 1 (React WebUI redesign): React 19 入口。
 *
 * 当前为占位渲染 — 仅显示 `<h1>aptbot WebUI</h1>`，验证 Vite 构建链路打通。
 * Task 9 将替换为真实 `<App />` 组件（接入 WebSocket / agent 状态 / session 切换等）。
 */
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';

const rootEl = document.getElementById('root');
if (!rootEl) {
  throw new Error('Root element #root not found in index.html');
}

createRoot(rootEl).render(
  <StrictMode>
    <main className="flex min-h-screen items-center justify-center bg-white text-neutral-900">
      <h1 className="font-sans text-3xl font-semibold tracking-tight">aptbot WebUI</h1>
    </main>
  </StrictMode>,
);
