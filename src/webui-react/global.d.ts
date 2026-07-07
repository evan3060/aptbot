/**
 * Task 1 (React WebUI redesign): Vite client 类型声明。
 *
 * Vite 处理 `.css` / `.svg` 等非 JS 资源时通过 side-effect import 引入，
 * TypeScript 默认无法识别这些模块。本声明让 side-effect import 通过类型检查。
 *
 * 参考 vite/client 类型定义（vite-env.d.ts），适配 aptbot 的 strict tsconfig。
 */
/// <reference types="vite/client" />

declare module '*.css';
