import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    // 同时包含 .spec.{ts,tsx}（单元/集成测试）和 .test.{ts,tsx}（构建产物验证等）
    include: ['tests/**/*.spec.{ts,tsx}', 'tests/**/*.test.{ts,tsx}'],
    // Task 10: Playwright UAT E2E 测试由 `npm run test:uat` 单独运行，不在 vitest 中执行
    exclude: ['tests/uat/**', 'node_modules/**', 'dist/**'],
    testTimeout: 10000,
  },
  esbuild: {
    jsx: 'automatic',
  },
});
