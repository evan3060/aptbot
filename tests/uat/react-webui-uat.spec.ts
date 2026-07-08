/**
 * Task 10 (React WebUI redesign): Playwright UAT E2E 测试。
 *
 * 覆盖 10 个用户场景：
 *  1. 注册新用户 → 登录 → 看到 WebUI
 *  2. 发送消息 → 收到流式响应 → 消息正确渲染
 *  3. 点击"新会话" → 消息清空 → session 列表新增
 *  4. 点击已有会话 → 历史消息加载
 *  5. 新建专业 agent → agent 出现在侧边栏
 *  6. 编辑 agent → 信息更新
 *  7. 删除会话 → 会话从列表消失
 *  8. 切换 agent → 输入区快捷指令变化
 *  9. Slash 命令 /help → 显示帮助文本
 * 10. 刷新页面 → 保持登录状态 → 消息历史恢复
 *
 * 测试隔离：
 * - 每个测试通过 API 注册独立用户（用户名含时间戳 + 随机后缀），避免数据冲突
 * - Test 1 走完整 UI 注册+登录流程；其余测试用 API 注册 + cookie 自动认证以加速 setup
 * - Playwright 默认为每个测试创建独立 BrowserContext，cookies/sessionStorage 自动隔离
 *
 * 超时：流式响应依赖真实 LLM（deepseek-v4-flash @ 192.168.0.11:3000），可能 10-30s。
 */
import { test, expect, type Page } from '@playwright/test';
import * as fs from 'node:fs';
import * as path from 'node:path';

const PASSWORD = 'Test1234';
const DATA_UAT_DIR = path.resolve(process.cwd(), 'data-uat');

/** 生成唯一用户名：prefix-timestamp-random6 */
function uniqueUsername(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * 清空 data-uat/ 目录（beforeAll 调用一次，避免之前测试残留干扰）。
 * 使用 force: true 容忍缺失；recursive: true 删除子目录。
 */
function cleanDataUatDir(): void {
  if (fs.existsSync(DATA_UAT_DIR)) {
    try {
      fs.rmSync(DATA_UAT_DIR, { recursive: true, force: true });
    } catch {
      // 文件被占用时静默忽略 — 后续测试用唯一用户名仍能隔离
    }
  }
}

/**
 * 通过 API 注册用户（设置 cookie + sessionStorage token）并导航到 /demo。
 * 用于 Test 2-10 的快速 setup（不走 UI 注册流程）。
 *
 * 实现细节：
 * 1. 先 navigate 到 /demo（AuthModal 会显示）
 * 2. 用 page.evaluate 调用浏览器 fetch 完成注册：
 *    - credentials:'include' 让 Set-Cookie 写入浏览器 cookie jar（HttpOnly）
 *    - 返回 body 中含 token，需手动存入 sessionStorage（AuthController.fetchMe 依赖
 *      sessionStorage 的 'aptbot:token' 才会发 /api/me 请求）
 * 3. Reload — App.tsx useEffect 重新构造 AuthController（读 sessionStorage 拿到 token），
 *    fetchMe 用 token + cookie 调 /api/me 返回 user → 跳过 AuthModal。
 */
async function setupViaApi(page: Page, username: string, password = PASSWORD): Promise<void> {
  // 先导航到 /demo — 任何 origin 都可以，让 AuthModal 显示
  await page.goto('/demo');
  await expect(page.getByTestId('auth-modal')).toBeVisible({ timeout: 20_000 });

  // 在浏览器上下文内调用 fetch — Set-Cookie 写入 cookie jar + token 写入 sessionStorage
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
    // 关键：AuthController.fetchMe 先检查 this.token（来自 sessionStorage），
    // 无 token 直接返回 null 不发 /api/me。必须将 token 副本写入 sessionStorage。
    sessionStorage.setItem('aptbot:token', body.token);
    return { ok, status, body: JSON.stringify(body), token: body.token };
  }, { u: username, p: password });

  if (!result.ok || !result.token) {
    throw new Error(`API register failed for ${username}: ${result.status} ${result.body}`);
  }

  // Reload — sessionStorage 已有 token，AuthController.fetchMe 调 /api/me 返回 user
  await page.reload();
  await expect(page.getByTestId('sidebar')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId('chat-area')).toBeVisible();
  await expect(page.getByTestId('input-area')).toBeVisible();
  await expect(page.getByTestId('auth-modal')).toBeHidden();
}

/**
 * 完整 UI 注册+登录流程（Test 1 专用）。
 */
async function setupViaUi(page: Page, username: string, password = PASSWORD): Promise<void> {
  await page.goto('/demo');
  await expect(page.getByTestId('auth-modal')).toBeVisible({ timeout: 20_000 });

  // 切换到注册模式
  await page.getByTestId('auth-register-trigger').click();
  await expect(page.getByTestId('auth-modal')).toHaveAttribute('data-mode', 'register');

  // 填写注册表单
  await page.getByTestId('auth-username').fill(username);
  await page.getByTestId('auth-password').fill(password);
  await page.getByTestId('auth-confirm-password').fill(password);

  // 提交注册
  await page.getByTestId('auth-confirm').click();

  // 等待"注册成功"提示 + 自动切回 login 模式
  await expect(page.getByText('注册成功')).toBeVisible({ timeout: 10_000 });
  await expect(page.getByTestId('auth-modal')).toHaveAttribute('data-mode', 'login', {
    timeout: 10_000,
  });

  // 登录 — useEffect 在 mode 切换时清空了 username/password，需要重新填
  await page.getByTestId('auth-username').fill(username);
  await page.getByTestId('auth-password').fill(password);
  await page.getByTestId('auth-confirm').click();

  // 等待"登录成功"提示
  await expect(page.getByText('登录成功')).toBeVisible({ timeout: 10_000 });

  // 等待 modal 关闭 + 主 UI 渲染
  await expect(page.getByTestId('auth-modal')).toBeHidden({ timeout: 10_000 });
  await expect(page.getByTestId('sidebar')).toBeVisible();
  await expect(page.getByTestId('chat-area')).toBeVisible();
  await expect(page.getByTestId('input-area')).toBeVisible();
}

/**
 * 等待 assistant 消息渲染出非空文本内容（流式响应累积）。
 * 单次轮询最长 60s，应对 LLM 响应延迟。
 */
async function waitForAssistantText(page: Page, timeout = 60_000): Promise<string> {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const texts = await page
      .locator('[data-role="assistant"]')
      .allTextContents();
    const nonEmpty = texts.find((t) => t.trim().length > 0);
    if (nonEmpty) return nonEmpty;
    await page.waitForTimeout(500);
  }
  throw new Error(`assistant message text did not appear within ${timeout}ms`);
}

/**
 * 等待 turn 完成（turn_end 事件触发）。
 *
 * 后端在 turn_end 时才将消息批量持久化到 .jsonl（session.ts bufferedEntries flush）。
 * 在此之前 reload 会导致 listSessions 扫描不到 .jsonl 文件 → sidebar 显示"暂无会话" →
 * 历史消息无法恢复。
 *
 * ChatArea 组件暴露 data-streaming 属性（isWorking ? 'true' : 'false'），
 * turn_end 触发 isWorking=false → data-streaming="false"。
 */
async function waitForTurnEnd(page: Page, timeout = 90_000): Promise<void> {
  await expect(page.getByTestId('chat-area')).toHaveAttribute('data-streaming', 'false', { timeout });
}

test.describe('React WebUI UAT — 10 user scenarios', () => {
  test.describe.configure({ mode: 'serial' });

  test.beforeAll(() => {
    cleanDataUatDir();
  });

  // --------------------------------------------------------------------------
  // Scenario 1: 注册新用户 → 登录 → 看到 WebUI
  // --------------------------------------------------------------------------
  test('1. 注册新用户 → 登录 → 看到 WebUI', async ({ page }) => {
    const username = uniqueUsername('uat1');
    await setupViaUi(page, username);

    // 验证所有主要组件渲染
    await expect(page.getByTestId('sidebar')).toBeVisible();
    await expect(page.getByTestId('chat-area')).toBeVisible();
    await expect(page.getByTestId('input-area')).toBeVisible();
    await expect(page.getByTestId('empty-state')).toBeVisible();

    // 验证侧边栏用户卡片显示用户名（前 2 个字符头像 + 完整用户名）
    await expect(page.locator('aside').getByText(username)).toBeVisible();
  });

  // --------------------------------------------------------------------------
  // Scenario 2: 发送消息 → 收到流式响应 → 消息正确渲染
  // --------------------------------------------------------------------------
  test('2. 发送消息 → 收到流式响应 → 消息正确渲染', async ({ page }) => {
    const username = uniqueUsername('uat2');
    await setupViaApi(page, username);

    // 输入消息并发送
    await page.getByTestId('input-textarea').fill('你好，请用一句话简短回应');
    await page.getByTestId('send-button').click();

    // 验证 user 消息立即出现（靠右对齐 — data-role="user"）
    const userMsg = page.locator('[data-role="user"]').first();
    await expect(userMsg).toBeVisible();
    await expect(userMsg).toContainText('你好');

    // 等待 assistant 消息出现（流式响应，可能 10-30s）
    const assistantText = await waitForAssistantText(page, 60_000);

    // 验证 assistant 消息有实际内容（非空且非占位）
    expect(assistantText.trim().length).toBeGreaterThan(0);

    // 验证 assistant 消息靠左对齐（data-role="assistant"）
    const assistantMsg = page.locator('[data-role="assistant"]').first();
    await expect(assistantMsg).toBeVisible();
  });

  // --------------------------------------------------------------------------
  // Scenario 3: 点击"新会话" → 消息清空 → session 列表新增
  // --------------------------------------------------------------------------
  test('3. 点击新会话 → 消息清空 → session 列表新增', async ({ page }) => {
    const username = uniqueUsername('uat3');
    await setupViaApi(page, username);

    // 在第一个 session 中发消息
    await page.getByTestId('input-textarea').fill('第一条消息');
    await page.getByTestId('send-button').click();
    await expect(page.locator('[data-role="user"]')).toBeVisible({ timeout: 10_000 });

    // 等待 session 出现在侧边栏（agent loop 处理后服务端持久化）
    await expect(page.locator('[data-testid^="session-item-"]').first()).toBeVisible({
      timeout: 15_000,
    });
    const initialSessionCount = await page.locator('[data-testid^="session-item-"]').count();

    // 点击"新会话"按钮
    await page.getByTestId('new-session-button').click();

    // 等待消息清空（empty-state 重新出现）
    await expect(page.getByTestId('empty-state')).toBeVisible({ timeout: 15_000 });

    // 在新会话中发一条消息使其持久化（确保新 session 出现在列表中）
    await page.getByTestId('input-textarea').fill('新会话的第一条');
    await page.getByTestId('send-button').click();
    await expect(page.locator('[data-role="user"]')).toBeVisible({ timeout: 10_000 });

    // 等待 session 数量增加
    await expect(async () => {
      const newCount = await page.locator('[data-testid^="session-item-"]').count();
      expect(newCount).toBeGreaterThan(initialSessionCount);
    }).toPass({ timeout: 20_000 });
  });

  // --------------------------------------------------------------------------
  // Scenario 4: 点击已有会话 → 历史消息加载
  // --------------------------------------------------------------------------
  test('4. 点击已有会话 → 历史消息加载', async ({ page }) => {
    const username = uniqueUsername('uat4');
    await setupViaApi(page, username);

    // 在 session1 发消息
    await page.getByTestId('input-textarea').fill('会话1标记消息');
    await page.getByTestId('send-button').click();
    await expect(page.locator('[data-role="user"]').first()).toContainText('会话1标记消息', {
      timeout: 10_000,
    });
    // 等待 session1 出现在侧边栏
    await expect(page.locator('[data-testid^="session-item-"]').first()).toBeVisible({
      timeout: 15_000,
    });
    const sessionsBefore = await page.locator('[data-testid^="session-item-"]').all();

    // 创建新会话2 + 发消息
    await page.getByTestId('new-session-button').click();
    await expect(page.getByTestId('empty-state')).toBeVisible({ timeout: 15_000 });
    await page.getByTestId('input-textarea').fill('会话2标记消息');
    await page.getByTestId('send-button').click();
    await expect(page.locator('[data-role="user"]').first()).toContainText('会话2标记消息', {
      timeout: 10_000,
    });
    await expect(page.locator('[data-testid^="session-item-"]').first()).toBeVisible({
      timeout: 15_000,
    });

    // 等待两个 session 都在列表中
    await expect(async () => {
      const count = await page.locator('[data-testid^="session-item-"]').count();
      expect(count).toBeGreaterThanOrEqual(2);
    }).toPass({ timeout: 20_000 });

    // 切换回第一个 session — 通过 preview 文本定位"会话1标记消息"对应的 session 项
    // 注意：session 列表按 updatedAt 降序排列，第一个是最近活跃的 session2（当前），
    // 所以不能用 .first()，必须通过 preview 文本精确匹配 session1。
    const session1Item = page
      .locator('[data-testid^="session-item-"]')
      .filter({ hasText: '会话1标记消息' });
    const session1Id = await session1Item.getAttribute('data-session-id');
    expect(session1Id).toBeTruthy();
    await page.locator(`[data-testid="session-item-${session1Id}"]`).click();

    // 等待历史消息加载 — 验证"会话1标记消息"恢复显示
    await expect(
      page.locator('[data-role="user"]').filter({ hasText: '会话1标记消息' }),
    ).toBeVisible({ timeout: 20_000 });
  });

  // --------------------------------------------------------------------------
  // Scenario 5: 新建专业 agent → agent 出现在侧边栏
  // --------------------------------------------------------------------------
  test('5. 新建专业 agent → agent 出现在侧边栏', async ({ page }) => {
    const username = uniqueUsername('uat5');
    await setupViaApi(page, username);

    const agentName = `测试Agent-${Date.now()}`;

    // 点击"新建智能体"按钮
    await page.getByTestId('create-agent-button').click();

    // 等待弹窗
    await expect(page.getByTestId('create-agent-modal')).toBeVisible({ timeout: 5_000 });

    // 填写表单
    await page.getByTestId('create-agent-name').fill(agentName);
    await page.getByTestId('create-agent-description').fill('用于 UAT 测试的专业 agent');
    await page.getByTestId('create-agent-prompt').fill('你是一个测试 agent');
    await page.getByTestId('create-agent-icon-brain').click();

    // 提交
    await page.getByTestId('create-agent-save').click();

    // 等待弹窗关闭
    await expect(page.getByTestId('create-agent-modal')).toBeHidden({ timeout: 10_000 });

    // 验证侧边栏出现新 agent
    await expect(page.getByTestId('specialized-agents-section').getByText(agentName)).toBeVisible({
      timeout: 10_000,
    });
  });

  // --------------------------------------------------------------------------
  // Scenario 6: 编辑 agent → 信息更新
  // --------------------------------------------------------------------------
  test('6. 编辑 agent → 信息更新', async ({ page }) => {
    const username = uniqueUsername('uat6');
    await setupViaApi(page, username);

    const initialName = `编辑前Agent-${Date.now()}`;
    const updatedName = `编辑后Agent-${Date.now()}`;

    // 先创建一个 agent
    await page.getByTestId('create-agent-button').click();
    await expect(page.getByTestId('create-agent-modal')).toBeVisible({ timeout: 5_000 });
    await page.getByTestId('create-agent-name').fill(initialName);
    await page.getByTestId('create-agent-description').fill('待编辑 agent');
    await page.getByTestId('create-agent-prompt').fill('初始设定');
    await page.getByTestId('create-agent-icon-cpu').click();
    await page.getByTestId('create-agent-save').click();
    await expect(page.getByTestId('create-agent-modal')).toBeHidden({ timeout: 10_000 });

    // 等待 agent 出现在侧边栏并获取其 slug
    await expect(
      page.getByTestId('specialized-agents-section').getByText(initialName),
    ).toBeVisible({ timeout: 10_000 });
    const agentItem = page.locator('[data-testid^="agent-item-"]').filter({ hasText: initialName });
    const agentSlug = await agentItem.getAttribute('data-agent-slug');
    expect(agentSlug).toBeTruthy();

    // 点击编辑按钮
    await page.getByTestId(`agent-edit-${agentSlug}`).click();
    await expect(page.getByTestId('edit-agent-modal')).toBeVisible({ timeout: 5_000 });

    // 修改名称
    await page.getByTestId('edit-agent-name').fill(updatedName);
    await page.getByTestId('edit-agent-save').click();

    // 等待弹窗关闭
    await expect(page.getByTestId('edit-agent-modal')).toBeHidden({ timeout: 10_000 });

    // 验证侧边栏显示新名称
    await expect(
      page.getByTestId('specialized-agents-section').getByText(updatedName),
    ).toBeVisible({ timeout: 10_000 });
    // 验证旧名称已不存在
    await expect(
      page.getByTestId('specialized-agents-section').getByText(initialName),
    ).toHaveCount(0);
  });

  // --------------------------------------------------------------------------
  // Scenario 7: 删除会话 → 会话从列表消失
  // --------------------------------------------------------------------------
  test('7. 删除会话 → 会话从列表消失', async ({ page }) => {
    const username = uniqueUsername('uat7');
    await setupViaApi(page, username);

    // 创建一个会话有消息
    await page.getByTestId('input-textarea').fill('待删除会话的消息');
    await page.getByTestId('send-button').click();
    await expect(page.locator('[data-role="user"]')).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('[data-testid^="session-item-"]').first()).toBeVisible({
      timeout: 15_000,
    });

    // 获取第一个 session id
    const sessionId = await page
      .locator('[data-testid^="session-item-"]')
      .first()
      .getAttribute('data-session-id');
    expect(sessionId).toBeTruthy();

    // hover session item 让删除按钮显示
    await page.locator(`[data-testid="session-item-${sessionId}"]`).hover();
    // 点击删除按钮（虽然按钮 opacity-0 group-hover:opacity-100，但 Playwright 可点击）
    await page.getByTestId(`session-delete-${sessionId}`).click();

    // 等待确认 UI 出现
    await expect(page.getByTestId(`session-delete-confirm-${sessionId}`)).toBeVisible({
      timeout: 5_000,
    });

    // 点击确认删除
    await page.getByTestId(`session-delete-confirm-button-${sessionId}`).click();

    // 验证 session 已从列表中消失
    await expect(page.locator(`[data-testid="session-item-${sessionId}"]`)).toHaveCount(0, {
      timeout: 10_000,
    });
  });

  // --------------------------------------------------------------------------
  // Scenario 8: 切换 agent → 输入区快捷指令变化
  // --------------------------------------------------------------------------
  test('8. 切换 agent → 输入区快捷指令变化', async ({ page }) => {
    const username = uniqueUsername('uat8');
    await setupViaApi(page, username);

    // 验证 default agent 下显示 16 个快捷指令
    await expect(page.getByTestId('quick-actions')).toBeVisible();
    const quickActionButtons = page.getByTestId('quick-actions').locator('button');
    await expect(quickActionButtons).toHaveCount(16);

    // 创建一个专业 agent
    const agentName = `快捷指令测试Agent-${Date.now()}`;
    await page.getByTestId('create-agent-button').click();
    await expect(page.getByTestId('create-agent-modal')).toBeVisible({ timeout: 5_000 });
    await page.getByTestId('create-agent-name').fill(agentName);
    await page.getByTestId('create-agent-description').fill('专业 agent');
    await page.getByTestId('create-agent-prompt').fill('专业设定');
    await page.getByTestId('create-agent-icon-terminal').click();
    await page.getByTestId('create-agent-save').click();
    await expect(page.getByTestId('create-agent-modal')).toBeHidden({ timeout: 10_000 });

    // 等待 agent 出现在侧边栏
    await expect(
      page.getByTestId('specialized-agents-section').getByText(agentName),
    ).toBeVisible({ timeout: 10_000 });

    // 通过下拉框切换到专业 agent
    await page.getByTestId('agent-select').selectOption({ label: agentName });

    // 验证快捷指令消失
    await expect(page.getByTestId('quick-actions')).toHaveCount(0, { timeout: 10_000 });

    // 切回 default agent（option label 是 agent.name = "通用助手"，非侧边栏标题"通用智能体"）
    await page.getByTestId('agent-select').selectOption({ label: '通用助手' });

    // 验证快捷指令重新出现
    await expect(page.getByTestId('quick-actions')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId('quick-actions').locator('button')).toHaveCount(16);
  });

  // --------------------------------------------------------------------------
  // Scenario 9: Slash 命令 /help → 显示帮助文本
  // --------------------------------------------------------------------------
  test('9. Slash 命令 /help → 显示帮助文本', async ({ page }) => {
    const username = uniqueUsername('uat9');
    await setupViaApi(page, username);

    // 输入 /help 并发送
    await page.getByTestId('input-textarea').fill('/help');
    await page.getByTestId('send-button').click();

    // 等待 assistant 消息出现，包含帮助文本
    const assistantText = await waitForAssistantText(page, 30_000);

    // 验证帮助文本包含关键命令标识
    expect(assistantText.toLowerCase()).toContain('available commands');
    expect(assistantText).toContain('/new');
    expect(assistantText).toContain('/help');
  });

  // --------------------------------------------------------------------------
  // Scenario 10: 刷新页面 → 保持登录状态 → 消息历史恢复
  // --------------------------------------------------------------------------
  test('10. 刷新页面 → 保持登录状态 → 消息历史恢复', async ({ page }) => {
    const username = uniqueUsername('uat10');
    await setupViaApi(page, username);

    // 发送一条消息
    const marker = `刷新恢复标记${Date.now()}`;
    await page.getByTestId('input-textarea').fill(marker);
    await page.getByTestId('send-button').click();
    await expect(page.locator('[data-role="user"]').first()).toContainText(marker, {
      timeout: 10_000,
    });
    // 等待 assistant 响应开始（确认 turn 已开始 → isWorking=true）
    await waitForAssistantText(page, 60_000);
    // 等待 turn 完成 — turn_end 触发后消息才持久化到 .jsonl
    await waitForTurnEnd(page, 90_000);

    // 刷新页面
    await page.reload();

    // 验证仍然登录（无 AuthModal）
    await expect(page.getByTestId('auth-modal')).toBeHidden({ timeout: 15_000 });
    await expect(page.getByTestId('sidebar')).toBeVisible();
    await expect(page.getByTestId('chat-area')).toBeVisible();

    // 验证历史消息恢复
    await expect(
      page.locator('[data-role="user"]').filter({ hasText: marker }),
    ).toBeVisible({ timeout: 20_000 });
  });
});
