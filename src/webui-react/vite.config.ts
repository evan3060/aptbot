/**
 * Task 1 (React WebUI redesign): Vite 构建配置。
 *
 * - root: src/webui-react/ — index.html 与 src/main.tsx 所在目录
 * - React 19 + Tailwind v4 插件
 * - base: '/webui/' — 所有产物 URL 前缀（HTML 中 /webui/assets/...）
 * - build.outDir: '../../dist/webui' — 输出到项目根 dist/webui（与旧 Lit bundle 同目录，便于 server.ts 路径解析）
 * - build.emptyOutDir: true — 构建前清空 outDir（Vite 推荐做法，确保无残留旧产物）
 *
 * 旧 Lit 代码（src/webui/）保留为 rollback backup，不影响本配置。
 */
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  root: path.resolve(__dirname),
  base: '/webui/',
  build: {
    outDir: path.resolve(__dirname, '../../dist/webui'),
    emptyOutDir: true,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname),
    },
  },
});
