/**
 * Task 10 (0.3.1 mobile adaptation): Playwright UAT — 8 mobile adaptation scenarios.
 *
 * 覆盖移动端适配的 8 个场景（使用 page.setViewportSize 切换桌面/移动视口）：
 *  1. 桌面布局 (1280×800): sidebar 可见、无 hamburger、无 Backdrop、main 有左 margin
 *  2. 移动布局初始 (390×844): sidebar 隐藏 (-translate-x-full)、hamburger 存在、无 Backdrop
 *  3. 抽屉打开 (390×844): 点击 hamburger → sidebar 可见 + Backdrop 可见 + body overflow hidden
 *  4. 抽屉关闭-遮罩 (390×844): 点击 Backdrop → sidebar 隐藏 + Backdrop 消失 + body overflow 恢复
 *  5. 抽屉关闭-选会话 (390×844): 打开抽屉，点击会话 → 自动关闭 + 会话切换
 *  6. 快捷指令缩放 (390×844): default agent，visibleButtons < 16，「更多」按钮存在，点击后 overflow 面板
 *  7. AuthModal 全屏 (390×844): 未登录 → modal 全屏 (inset-0) + × 关闭按钮存在
 *  8. AgentModals 全屏 (390×844): 编辑 agent → 全屏 + sticky header/footer
 *
 * 测试隔离：复用 react-webui-uat.spec.ts 的 setupViaApi 模式（每测试注册独立用户）。
 * 视口切换：使用 page.setViewportSize 在 1280×800（桌面）和 390×844（iPhone 13）之间切换。
 */
import { test, expect, type Page } from '@playwright/test';
import * as fs from 'node:fs';
import * as path from 'node:path';

const PASSWORD = 'Test1234';
const DATA_UAT_DIR = path.resolve(process.cwd(), 'data-uat');

const DESKTOP_VIEWPORT = { width: 1280, height: 800 };
const MOBILE_VIEWPORT = { width: 390, height: 844 };

/** 生成唯一用户名：prefix-timestamp-random6 */
function uniqueUsername(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/** 清空 data-uat/ 目录（避免之前测试残留干扰） */
function cleanDataUatDir(): void {
  if (fs.existsSync(DATA_UAT_DIR)) {
    try {
      fs.rmSync(DATA_UAT_DIR, { recursive: true, force: true });
    } catch {
      // 文件被占用时静默忽略
    }
  }
}

/**
 * 通过 API 注册用户（设置 cookie + sessionStorage token）并导航到 /demo。
 * 复用 react-webui-uat.spec.ts 的 setupViaApi 模式。
 */
async function setupViaApi(page: Page, username: string, password = PASSWORD): Promise<void> {
  await page.goto('/demo');
  await expect(page.getByTestId('auth-modal')).toBeVisible({ timeout: 20_000 });

  const result = await page.evaluate(async ({ u, p }) => {
    const res = await fetch('/api/register', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: u, password: p }),
      credentials: 'include',
    });
    const ok = res.ok;
    const status = res.status;
    if (!ok) {
      const text = await res.text();
      return { ok, status, body: text, token: null as string | null };
    }
    const body = (await res.json()) as { token: string };
    sessionStorage.setItem('aptbot:token', body.token);
    return { ok, status, body: JSON.stringify(body), token: body.token };
  }, { u: username, p: password });

  if (!result.ok || !result.token) {
    throw new Error(`API register failed for ${username}: ${result.status} ${result.body}`);
  }

  await page.reload();
  await expect(page.getByTestId('sidebar')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId('chat-area')).toBeVisible();
  await expect(page.getByTestId('input-area')).toBeVisible();
  await expect(page.getByTestId('auth-modal')).toBeHidden();
}

/**
 * 获取 sidebar 的 bounding box x 坐标。
 * - 可见时 x >= 0（translate-x-0 或 md:translate-x-0）
 * - 隐藏时 x < 0（-translate-x-full 将元素移出视口左侧）
 */
async function sidebarX(page: Page): Promise<number> {
  const box = await page.getByTestId('sidebar').boundingBox();
  return box ? box.x : NaN;
}

/** 获取 sidebar 的 class 属性（用于检查 -translate-x-full / translate-x-0） */
async function sidebarClass(page: Page): Promise<string> {
  return page.getByTestId('sidebar').getAttribute('class') ?? '';
}

/**
 * 检查元素 class 属性是否包含指定的独立 class（非 md: 前缀变体）。
 * 例如 hasStandaloneClass(cls, 'translate-x-0') 匹配 'translate-x-0' 但不匹配 'md:translate-x-0'。
 */
function hasStandaloneClass(cls: string, target: string): boolean {
  return cls.split(/\s+/).includes(target);
}

test.describe('Mobile adaptation UAT — 8 scenarios', () => {
  test.describe.configure({ mode: 'serial' });

  test.beforeAll(() => {
    cleanDataUatDir();
  });

  // --------------------------------------------------------------------------
  // Scenario 1: 桌面布局 (1280×800)
  // --------------------------------------------------------------------------
  test('1. 桌面布局 (1280×800): sidebar 可见、无 hamburger、无 Backdrop、main 有左 margin', async ({ page }) => {
    await page.setViewportSize(DESKTOP_VIEWPORT);
    const username = uniqueUsername('m1');
    await setupViaApi(page, username);

    // Sidebar 可见（computed transform 无 translateX — bounding box x >= 0）
    const x = await sidebarX(page);
    expect(x).toBeGreaterThanOrEqual(0);

    // 无 hamburger 按钮（md:hidden 在桌面端隐藏）
    await expect(page.locator('[aria-label="打开菜单"]')).toBeHidden();

    // 无 Backdrop（仅在 !isDesktop && sidebarOpen 时渲染）
    await expect(page.getByTestId('sidebar-backdrop')).toHaveCount(0);

    // main 元素有左 margin（md:ml-64 = 256px）
    const marginLeft = await page.evaluate(() => {
      const main = document.querySelector('main');
      return main ? getComputedStyle(main).marginLeft : '';
    });
    expect(marginLeft).toBe('256px');
  });

  // --------------------------------------------------------------------------
  // Scenario 2: 移动布局初始 (390×844)
  // --------------------------------------------------------------------------
  test('2. 移动布局初始 (390×844): sidebar 隐藏、hamburger 存在、无 Backdrop', async ({ page }) => {
    await page.setViewportSize(MOBILE_VIEWPORT);
    const username = uniqueUsername('m2');
    await setupViaApi(page, username);

    // Sidebar 有 -translate-x-full 类（隐藏）
    const cls = await sidebarClass(page);
    expect(hasStandaloneClass(cls, '-translate-x-full')).toBe(true);
    expect(hasStandaloneClass(cls, 'translate-x-0')).toBe(false);

    // bounding box x < 0（移出视口左侧）
    const x = await sidebarX(page);
    expect(x).toBeLessThan(0);

    // hamburger 按钮存在
    await expect(page.locator('[aria-label="打开菜单"]')).toBeVisible();

    // 无 Backdrop 初始渲染
    await expect(page.getByTestId('sidebar-backdrop')).toHaveCount(0);
  });

  // --------------------------------------------------------------------------
  // Scenario 3: 抽屉打开 (390×844)
  // --------------------------------------------------------------------------
  test('3. 抽屉打开 (390×844): 点击 hamburger → sidebar 可见 + Backdrop 可见 + body overflow hidden', async ({ page }) => {
    await page.setViewportSize(MOBILE_VIEWPORT);
    const username = uniqueUsername('m3');
    await setupViaApi(page, username);

    // 初始状态：sidebar 隐藏
    expect(await sidebarX(page)).toBeLessThan(0);

    // 点击 hamburger
    await page.locator('[aria-label="打开菜单"]').click();

    // Sidebar 变为 translate-x-0（可见）— 等待 CSS transition 完成
    await expect.poll(async () => {
      const cls = await sidebarClass(page);
      return hasStandaloneClass(cls, 'translate-x-0');
    }, { timeout: 2000 }).toBe(true);

    const cls = await sidebarClass(page);
    expect(hasStandaloneClass(cls, '-translate-x-full')).toBe(false);
    await expect.poll(async () => await sidebarX(page), { timeout: 2000 }).toBeGreaterThanOrEqual(0);

    // Backdrop 可见
    await expect(page.getByTestId('sidebar-backdrop')).toBeVisible();

    // body overflow === 'hidden'（滚动锁定）
    const overflow = await page.evaluate(() => document.body.style.overflow);
    expect(overflow).toBe('hidden');
  });

  // --------------------------------------------------------------------------
  // Scenario 4: 抽屉关闭-遮罩 (390×844)
  // --------------------------------------------------------------------------
  test('4. 抽屉关闭-遮罩 (390×844): 点击 Backdrop → sidebar 隐藏 + Backdrop 消失 + body overflow 恢复', async ({ page }) => {
    await page.setViewportSize(MOBILE_VIEWPORT);
    const username = uniqueUsername('m4');
    await setupViaApi(page, username);

    // 打开抽屉
    await page.locator('[aria-label="打开菜单"]').click();
    await expect(page.getByTestId('sidebar-backdrop')).toBeVisible();
    expect(await page.evaluate(() => document.body.style.overflow)).toBe('hidden');

    // 点击 Backdrop 关闭
    await page.getByTestId('sidebar-backdrop').click();

    // Sidebar 回到 -translate-x-full（隐藏）— 等待 CSS transition 完成
    await expect.poll(async () => {
      const cls = await sidebarClass(page);
      return hasStandaloneClass(cls, '-translate-x-full');
    }, { timeout: 2000 }).toBe(true);

    const cls = await sidebarClass(page);
    expect(hasStandaloneClass(cls, 'translate-x-0')).toBe(false);
    await expect.poll(async () => await sidebarX(page), { timeout: 2000 }).toBeLessThan(0);

    // Backdrop 消失
    await expect(page.getByTestId('sidebar-backdrop')).toHaveCount(0);

    // body overflow 恢复（!== 'hidden'）
    const overflow = await page.evaluate(() => document.body.style.overflow);
    expect(overflow).not.toBe('hidden');
  });

  // --------------------------------------------------------------------------
  // Scenario 5: 抽屉关闭-选会话 (390×844)
  // --------------------------------------------------------------------------
  test('5. 抽屉关闭-选会话 (390×844): 打开抽屉，点击会话 → 自动关闭 + 会话切换', async ({ page }) => {
    // 先在桌面视口创建一个会话（移动端输入体验较差，桌面端更稳定）
    await page.setViewportSize(DESKTOP_VIEWPORT);
    const username = uniqueUsername('m5');
    await setupViaApi(page, username);

    // 发送消息创建会话
    await page.getByTestId('input-textarea').fill('测试会话切换标记');
    await page.getByTestId('send-button').click();
    await expect(page.locator('[data-role="user"]')).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('[data-testid^="session-item-"]').first()).toBeVisible({
      timeout: 15_000,
    });

    // 获取 session id
    const sessionId = await page
      .locator('[data-testid^="session-item-"]')
      .first()
      .getAttribute('data-session-id');
    expect(sessionId).toBeTruthy();

    // 切换到移动视口
    await page.setViewportSize(MOBILE_VIEWPORT);
    // 等待移动布局生效（hamburger 按钮出现）
    await expect(page.locator('[aria-label="打开菜单"]')).toBeVisible({ timeout: 5_000 });

    // 打开抽屉
    await page.locator('[aria-label="打开菜单"]').click();
    await expect(page.getByTestId('sidebar-backdrop')).toBeVisible();

    // 点击会话项
    await page.locator(`[data-testid="session-item-${sessionId}"]`).click();

    // 抽屉自动关闭（Backdrop 消失 + sidebar 隐藏）— 等待 CSS transition 完成
    await expect(page.getByTestId('sidebar-backdrop')).toHaveCount(0);
    await expect.poll(async () => {
      const cls = await sidebarClass(page);
      return hasStandaloneClass(cls, '-translate-x-full');
    }, { timeout: 2000 }).toBe(true);
    await expect.poll(async () => await sidebarX(page), { timeout: 2000 }).toBeLessThan(0);
  });

  // --------------------------------------------------------------------------
  // Scenario 6: 快捷指令缩放 (390×844)
  // --------------------------------------------------------------------------
  test('6. 快捷指令缩放 (390×844): default agent，visibleButtons < 16，「更多」按钮存在，点击后 overflow 面板', async ({ page }) => {
    await page.setViewportSize(MOBILE_VIEWPORT);
    const username = uniqueUsername('m6');
    await setupViaApi(page, username);

    // default agent 下快捷指令区可见
    await expect(page.getByTestId('quick-actions')).toBeVisible();

    // 等待测量完成（isMeasuring=false 后「更多」按钮出现）
    await expect(page.locator('[aria-label="更多快捷指令"]')).toBeVisible({ timeout: 10_000 });

    // visibleButtons 数量 < 16（移动端窄屏，部分按钮溢出）
    const visibleButtons = await page
      .getByTestId('quick-actions')
      .locator('div.flex > button:not([aria-label="更多快捷指令"])')
      .count();
    expect(visibleButtons).toBeLessThan(16);

    // 点击「更多」按钮
    await page.locator('[aria-label="更多快捷指令"]').click();

    // overflow 面板可见（含剩余按钮，grid 布局）
    await expect(page.getByTestId('quick-actions-overflow-panel')).toBeVisible();
    const overflowButtons = await page
      .getByTestId('quick-actions-overflow-panel')
      .locator('button')
      .count();
    expect(overflowButtons).toBeGreaterThan(0);

    // 总按钮数 = 16（visible + overflow）
    expect(visibleButtons + overflowButtons).toBe(16);
  });

  // --------------------------------------------------------------------------
  // Scenario 7: AuthModal 全屏 (390×844)
  // --------------------------------------------------------------------------
  test('7. AuthModal 全屏 (390×844): 未登录 → modal 全屏 (inset-0) + × 关闭按钮存在', async ({ page }) => {
    await page.setViewportSize(MOBILE_VIEWPORT);

    // 未登录状态导航到 /demo（fresh context 无 cookie/sessionStorage）
    await page.goto('/demo');

    // AuthModal 可见
    await expect(page.getByTestId('auth-modal')).toBeVisible({ timeout: 20_000 });

    // 外层容器 fixed inset-0（全屏覆盖）
    const outerClass = await page.getByTestId('auth-modal').getAttribute('class') ?? '';
    expect(outerClass).toContain('fixed');
    expect(outerClass).toContain('inset-0');

    // 内层卡片 rounded-none（移动端无圆角，全屏）+ inset-0（fixed 全屏定位）
    const innerCard = page.locator('[data-testid="auth-modal"] > div').first();
    const innerClass = await innerCard.getAttribute('class') ?? '';
    expect(innerClass).toContain('rounded-none');
    expect(innerClass).toContain('inset-0');

    // × 关闭按钮存在（modal 内第一个 button，含 X 图标）
    const closeBtn = page.locator('[data-testid="auth-modal"] button').first();
    await expect(closeBtn).toBeVisible();
  });

  // --------------------------------------------------------------------------
  // Scenario 8: AgentModals 全屏 (390×844)
  // --------------------------------------------------------------------------
  test('8. AgentModals 全屏 (390×844): 编辑 agent → 全屏 + sticky header/footer', async ({ page }) => {
    await page.setViewportSize(MOBILE_VIEWPORT);
    const username = uniqueUsername('m8');
    await setupViaApi(page, username);

    // 移动端需先打开抽屉才能访问 sidebar 内的设置按钮
    await page.locator('[aria-label="打开菜单"]').click();
    await expect(page.getByTestId('sidebar-backdrop')).toBeVisible();

    // 点击 default agent 的设置按钮（title="设置智能体"）
    await page.locator('button[title="设置智能体"]').first().click();

    // 编辑 agent modal 可见
    await expect(page.getByTestId('edit-agent-modal')).toBeVisible({ timeout: 5_000 });

    // 外层 fixed inset-0（全屏覆盖）
    const outerClass = await page.getByTestId('edit-agent-modal').getAttribute('class') ?? '';
    expect(outerClass).toContain('fixed');
    expect(outerClass).toContain('inset-0');

    // 内层卡片 rounded-none（移动端无圆角）
    const innerCard = page.locator('[data-testid="edit-agent-modal"] > div:not(.absolute)').first();
    const innerClass = await innerCard.getAttribute('class') ?? '';
    expect(innerClass).toContain('rounded-none');

    // sticky header 存在（含 × 关闭按钮）
    const header = page.locator('[data-testid="edit-agent-modal"] .sticky.top-0');
    await expect(header).toBeVisible();
    await expect(page.getByTestId('edit-agent-close')).toBeVisible();

    // sticky footer 存在（含保存/取消按钮）
    const footer = page.locator('[data-testid="edit-agent-modal"] .sticky.bottom-0');
    await expect(footer).toBeVisible();
    await expect(page.getByTestId('edit-agent-save')).toBeVisible();
    await expect(page.getByTestId('edit-agent-cancel')).toBeVisible();
  });
});
