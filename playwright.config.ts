/**
 * Task 10 (React WebUI redesign): Playwright UAT 配置。
 *
 * - testDir: tests/uat — UAT E2E 测试目录
 * - chromium project — 单浏览器，headless
 * - webServer: 启动 aptbot 后端（PORT=8081，APTBOT_CONFIG=config/aptbot.uat.json）
 *   - reuseExistingServer: false — 每次测试启动新进程，保证隔离
 *   - url: http://localhost:8081/demo — 等待 React WebUI 就绪
 *   - timeout: 60s — 服务器启动 + 配置加载 + 迁移
 * - baseURL: http://localhost:8081 — 测试用 page.goto('/demo') 即可
 * - testTimeout: 90s — 单测包含 LLM 流式响应（10-30s）+ 等待 UI 动画
 * - workers: 1 — 串行执行（共享 UAT 数据目录，避免并发写冲突）
 *
 * 测试隔离策略：
 * - beforeEach 通过 API 注册新用户（用户名带时间戳/随机后缀）
 * - beforeEach 清空 data-uat/ 目录确保数据隔离
 * - storageState: 不使用 — 每个 test 内通过 UI 流程登录，cookie 自动写入 page context
 */
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/uat',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  timeout: 90_000,
  expect: { timeout: 15_000 },
  use: {
    baseURL: 'http://localhost:8081',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: 'npx tsx --env-file=.env src/server.ts',
    env: {
      APTBOT_CONFIG: 'config/aptbot.uat.json',
      PORT: '8081',
    },
    url: 'http://localhost:8081/demo',
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
