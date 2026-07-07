/**
 * Task 1 + Task 9 (React WebUI redesign): React 19 入口。
 *
 * Task 1: 验证 Vite 构建链路打通（占位渲染）。
 * Task 9: 替换为真实 <App /> 组件（接入 WebSocket / agent 状态 / session 切换等）。
 */
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.js';
import './index.css';

const rootEl = document.getElementById('root');
if (!rootEl) {
  throw new Error('Root element #root not found in index.html');
}

createRoot(rootEl).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
