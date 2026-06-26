import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.spec.{ts,tsx}'],
    testTimeout: 10000,
  },
  esbuild: {
    jsx: 'automatic',
  },
});
