import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    // 同时包含 .spec.{ts,tsx}（单元/集成测试）和 .test.{ts,tsx}（构建产物验证等）
    include: ['tests/**/*.spec.{ts,tsx}', 'tests/**/*.test.{ts,tsx}'],
    testTimeout: 10000,
  },
  esbuild: {
    jsx: 'automatic',
  },
});
