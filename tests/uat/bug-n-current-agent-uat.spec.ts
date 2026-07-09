/**
 * Bug N (修正版) UAT — NewSessionPicker 状态下直接对话，
 * 根据输入框下方当前显示的智能体（activeAgentSlug）创建对应智能体的新会话。
 *
 * Bug N (修正版): 点击新会话时，输入框下方当前智能体显示为什么，
 *   就新建这个智能体的新对话。
 *   - 之前修复硬编码了 `/agent default`，导致 NewSessionPicker 状态下直接对话时
 *     始终创建 default 会话，即使当前显示的是专业智能体。
 *   - 修复: handleSendMessage 检测 showNewSessionPicker 时使用 activeAgentSlug
 *     （输入框下方当前显示的智能体），发送 `/agent ${activeAgentSlug}` + `/new`。
 *
 * 测试隔离：每个测试通过 API 注册独立用户（用户名含时间戳 + 随机后缀）。
 * 超时：流式响应依赖真实 LLM，可能 30-60s。
 */
import { test, expect, type Page } from '@playwright/test';
import * as fs from 'node:fs';
import * as path from 'node:path';

const PASSWORD = 'Test1234';
const DATA_UAT_DIR = path.resolve(process.cwd(), 'data-uat');
const SCREENSHOTS_DIR = path.resolve(process.cwd(), 'tests/uat/screenshots');

/** 生成唯一用户名：prefix-timestamp-random6 */
function uniqueUsername(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/** 清空 data-uat/ 目录，避免之前测试残留干扰。 */
function cleanDataUatDir(): void {
  if (fs.existsSync(DATA_UAT_DIR)) {
    try {
      fs.rmSync(DATA_UAT_DIR, { recursive: true, force: true });
    } catch {
      // 文件被占用时静默忽略
    }
  }
}

/** 确保截图目录存在。 */
function ensureScreenshotsDir(): void {
  if (!fs.existsSync(SCREENSHOTS_DIR)) {
    fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });
  }
}

interface ApiSession {
  id: string;
  label?: string;
  preview?: string;
  agentId?: string;
}

/** 通过 API 获取 session 列表（带认证）。 */
async function fetchApiSessions(page: Page): Promise<ApiSession[]> {
  return await page.evaluate(async () => {
    const res = await fetch('/api/sessions', { credentials: 'include' });
    if (!res.ok) throw new Error(`fetch sessions failed: ${res.status}`);
    const body = (await res.json()) as { sessions: ApiSession[] };
    return body.sessions;
  });
}

/**
 * 通过 API 注册用户（设置 cookie + sessionStorage token）并导航到 /demo。
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

/** 等待 assistant 消息渲染出非空文本内容。 */
async function waitForAssistantText(page: Page, timeout = 90_000): Promise<string> {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const texts = await page.locator('[data-role="assistant"]').allTextContents();
    const nonEmpty = texts.find((t) => t.trim().length > 0);
    if (nonEmpty) return nonEmpty;
    await page.waitForTimeout(500);
  }
  throw new Error(`assistant message text did not appear within ${timeout}ms`);
}

/**
 * 等待 turn 完全结束：data-streaming 稳定为 false。
 *
 * 工具调用场景下，turn_end 之间会瞬时 false（reducer 在 turn_end 设 isWorking=false，
 * 下一个 turn_start 再次设为 true）。此处通过 3s 二次确认避免过早判定完成。
 * 同时要求至少存在 minAssistantCount 条 assistant 消息（确保最终文本回复已渲染）。
 */
async function waitForTurnComplete(
  page: Page,
  minAssistantCount = 1,
  timeout = 150_000,
): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const streaming = await page.getByTestId('chat-area').getAttribute('data-streaming');
    const count = await page.locator('[data-role="assistant"]').count();
    if (streaming === 'false' && count >= minAssistantCount) {
      // 3s 二次确认，避免 tool-call turn 之间的瞬时 false
      await page.waitForTimeout(3000);
      const again = await page.getByTestId('chat-area').getAttribute('data-streaming');
      if (again === 'false') return;
    }
    await page.waitForTimeout(500);
  }
  throw new Error(`turn did not complete within ${timeout}ms`);
}

/** 获取 agent-select-desktop 当前选中选项的文本（agent 名称）。 */
async function getAgentSelectText(page: Page): Promise<string> {
  return await page.getByTestId('agent-select-desktop').evaluate(
    (el: HTMLSelectElement) => el.options[el.selectedIndex]?.text || '',
  );
}

/**
 * 通过 API 创建专业智能体，返回 { slug, name }。
 * body 包含 type: 'professional'（后端固定创建 professional，type 字段无害）。
 */
async function createSpecializedAgentViaApi(
  page: Page,
  name: string,
  description: string,
  personality: string,
): Promise<{ slug: string; name: string }> {
  const agent = await page.evaluate(
    async ({ name, description, personality }) => {
      const res = await fetch('/api/agents', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name, description, personality, type: 'professional' }),
        credentials: 'include',
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`create agent failed: ${res.status} ${text}`);
      }
      return (await res.json()) as { slug: string; name: string };
    },
    { name, description, personality },
  );
  expect(agent.slug, 'created agent should have a slug').toBeTruthy();
  return { slug: agent.slug, name: agent.name };
}

/**
 * 等待 InputArea agent selector 切换完成（/agent <slug> 触发 session_changed）。
 *
 * agent-select-desktop 的 value 由 handleSelectAgent 同步设置，但 /agent 命令触发的
 * session_changed 是异步的。此处等待 value 稳定 + data-streaming 归于 false +
 * 额外缓冲，确保 session_changed 处理完毕，避免与后续 /new 命令交错。
 */
async function waitForAgentSwitchStable(page: Page, expectedSlug: string, timeout = 60_000): Promise<void> {
  await expect(page.getByTestId('agent-select-desktop')).toHaveValue(expectedSlug, { timeout });
  await expect(page.getByTestId('chat-area')).toHaveAttribute('data-streaming', 'false', { timeout });
  // 额外缓冲：session_changed 异步处理（清空消息、刷新列表）需要时间
  await page.waitForTimeout(2500);
}

test.describe('Bug N (修正版) UAT — 当前智能体新建会话', () => {
  test.describe.configure({ mode: 'serial' });

  test.beforeAll(() => {
    cleanDataUatDir();
    ensureScreenshotsDir();
  });

  // --------------------------------------------------------------------------
  // Test 1: NewSessionPicker 状态下直接对话，使用当前 default 智能体创建新会话
  // --------------------------------------------------------------------------
  test('Test 1: NewSessionPicker 直接对话使用当前 default 智能体创建新会话', async ({ page }) => {
    test.setTimeout(240_000);
    const username = uniqueUsername('bugNDefault');
    await setupViaApi(page, username);

    // 确认输入框下方当前显示的是"通用助手"（default agent）
    await expect(page.getByTestId('agent-select-desktop')).toHaveValue('default', { timeout: 10_000 });
    const initialAgentText = await getAgentSelectText(page);
    expect(initialAgentText, '初始 agent selector 应显示"通用助手"').toBe('通用助手');

    // === 第一条消息（创建初始会话）===
    await page.getByTestId('input-textarea').fill('第一条消息测试CurrentAgent');
    await page.getByTestId('send-button').click();
    await expect(page.locator('[data-role="user"]').first()).toContainText('第一条消息测试CurrentAgent', {
      timeout: 10_000,
    });

    // 等待 turn 完成
    await waitForTurnComplete(page, 1, 120_000);

    // 等待 session 出现在侧边栏
    await expect(page.locator('[data-testid^="session-item-"]').first()).toBeVisible({
      timeout: 20_000,
    });

    // 通过 API 获取旧会话 ID（用于后续验证旧会话内容仍存在）
    const sessionsBefore = await fetchApiSessions(page);
    const oldSession = sessionsBefore.find(
      (s) => s.preview?.includes('第一条消息测试CurrentAgent') || s.label?.includes('第一条消息测试CurrentAgent'),
    );
    expect(oldSession, 'old session should exist').toBeTruthy();
    const oldSessionId = oldSession!.id;

    // === 步骤 1：点击"新会话"按钮，显示 agent picker ===
    await page.getByTestId('new-session-button').click();
    await expect(page.getByTestId('new-session-picker')).toBeVisible({ timeout: 5_000 });

    // 验证 picker 中有 agent 卡片可见
    await expect(page.getByTestId('new-session-agent-default')).toBeVisible({ timeout: 5_000 });

    // === 步骤 2：不点击任何 agent 卡片，直接在输入区输入消息并发送 ===
    // Bug N (修正版)：使用 activeAgentSlug（当前显示"通用助手" → default）创建新会话
    await page.getByTestId('input-textarea').fill('新会话直接对话Default');
    await page.getByTestId('send-button').click();

    // === 步骤 3：等待新会话创建 + 消息发送 + assistant 响应 ===
    // picker 应消失（handleSendMessage 调用 setShowNewSessionPicker(false)）
    await expect(page.getByTestId('new-session-picker')).toBeHidden({ timeout: 15_000 });

    // 等待 user 消息 "新会话直接对话Default" 出现在聊天区
    await expect(
      page.locator('[data-role="user"]').filter({ hasText: '新会话直接对话Default' }),
      'new user message should appear in chat area after new session created',
    ).toBeVisible({ timeout: 30_000 });

    // 等待 turn 完成（assistant 响应）
    await waitForTurnComplete(page, 1, 120_000);

    // === 核心断言 1：聊天区只有 1 条 user 消息 "新会话直接对话Default"（旧消息不在新会话中）===
    const userMessages = page.getByTestId('chat-area').locator('[data-role="user"]');
    await expect(userMessages, 'should have exactly 1 user message in new session').toHaveCount(1, {
      timeout: 10_000,
    });
    await expect(userMessages.first()).toContainText('新会话直接对话Default');
    // 旧消息不应出现在新会话中
    await expect(
      page.getByTestId('chat-area').locator('[data-role="user"]').filter({ hasText: '第一条消息测试CurrentAgent' }),
      'old user message should NOT be in the new session',
    ).toHaveCount(0);

    // === 核心断言 2：输入区的 agent 选择器显示"通用助手"（default agent）===
    await expect(page.getByTestId('agent-select-desktop')).toHaveValue('default', { timeout: 10_000 });
    const agentText = await getAgentSelectText(page);
    expect(agentText, 'agent selector should show 通用助手 (default agent)').toBe('通用助手');

    // === 额外验证：新会话归属 default agent（通过 API session.agentId）===
    const sessionsAfter = await fetchApiSessions(page);
    const newSession = sessionsAfter.find(
      (s) => s.preview?.includes('新会话直接对话Default') || s.label?.includes('新会话直接对话Default'),
    );
    expect(newSession, 'new session should exist in API').toBeTruthy();
    expect(newSession!.agentId, 'new session should belong to default agent').toBe('default');

    // === 额外验证：旧会话仍保留其内容 ===
    await page.locator(`[data-testid="session-item-${oldSessionId}"]`).click({ force: true });
    await expect(
      page.locator('[data-role="user"]').filter({ hasText: '第一条消息测试CurrentAgent' }),
      'old session should still contain the first message',
    ).toBeVisible({ timeout: 30_000 });

    // 截图记录最终状态
    await page.screenshot({ path: path.join(SCREENSHOTS_DIR, 'bug-n-current-agent-default.png'), fullPage: true });
  });

  // --------------------------------------------------------------------------
  // Test 2: NewSessionPicker 状态下直接对话，使用当前专业智能体创建新会话
  // --------------------------------------------------------------------------
  test('Test 2: NewSessionPicker 直接对话使用当前专业智能体创建新会话', async ({ page }) => {
    test.setTimeout(240_000);
    const username = uniqueUsername('bugNEnglish');
    await setupViaApi(page, username);

    // === 步骤 1：通过 API 创建专业智能体 ===
    const agentName = '英语学习助手CurrentAgent';
    const { slug: agentSlug } = await createSpecializedAgentViaApi(
      page,
      agentName,
      '英语学习助手',
      '你是一个专业的英语学习助手',
    );

    // 刷新页面让前端 bootstrap 重新拉取 agents 列表（agent-select-desktop 才会有新选项）
    await page.reload();
    await expect(page.getByTestId('sidebar')).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId('chat-area')).toBeVisible();
    await expect(page.getByTestId('input-area')).toBeVisible();

    // 确认初始显示的是 default 智能体
    await expect(page.getByTestId('agent-select-desktop')).toHaveValue('default', { timeout: 10_000 });

    // === 步骤 2：通过 InputArea 的 agent selector 切换到专业智能体 ===
    await page.getByTestId('agent-select-desktop').selectOption(agentSlug);

    // 等待 /agent 命令完成（session_changed）
    await waitForAgentSwitchStable(page, agentSlug, 60_000);

    // 验证 agent-select-desktop 当前显示专业智能体名称（输入框下方显示"英语学习助手CurrentAgent"）
    const switchedAgentText = await getAgentSelectText(page);
    expect(switchedAgentText, '切换后 agent selector 应显示专业智能体名称').toBe(agentName);

    // === 步骤 3：点击"新会话"按钮显示 agent picker ===
    await page.getByTestId('new-session-button').click();
    await expect(page.getByTestId('new-session-picker')).toBeVisible({ timeout: 5_000 });

    // === 步骤 4：不点击任何 agent 卡片，直接输入消息并发送 ===
    // Bug N (修正版)：使用 activeAgentSlug（当前显示专业智能体 → agentSlug）创建新会话
    await page.getByTestId('input-textarea').fill('新会话直接对话English');
    await page.getByTestId('send-button').click();

    // === 步骤 5：等待新会话创建 + 消息发送 + assistant 响应 ===
    await expect(page.getByTestId('new-session-picker')).toBeHidden({ timeout: 15_000 });

    await expect(
      page.locator('[data-role="user"]').filter({ hasText: '新会话直接对话English' }),
      'new user message should appear in chat area after new session created',
    ).toBeVisible({ timeout: 30_000 });

    await waitForTurnComplete(page, 1, 120_000);

    // === 核心断言 1：聊天区只有 1 条 user 消息 "新会话直接对话English" ===
    const userMessages = page.getByTestId('chat-area').locator('[data-role="user"]');
    await expect(userMessages, 'should have exactly 1 user message in new session').toHaveCount(1, {
      timeout: 10_000,
    });
    await expect(userMessages.first()).toContainText('新会话直接对话English');

    // === 核心断言 2：agent selector 显示"英语学习助手CurrentAgent"（专业智能体）===
    await expect(page.getByTestId('agent-select-desktop')).toHaveValue(agentSlug, { timeout: 10_000 });
    const finalAgentText = await getAgentSelectText(page);
    expect(finalAgentText, 'agent selector should show 专业智能体名称').toBe(agentName);

    // === 核心断言 3：新会话属于专业智能体（通过 API session.agentId 验证）===
    const sessions = await fetchApiSessions(page);
    const newSession = sessions.find(
      (s) => s.preview?.includes('新会话直接对话English') || s.label?.includes('新会话直接对话English'),
    );
    expect(newSession, 'new session should exist in API').toBeTruthy();
    expect(
      newSession!.agentId,
      'new session should belong to the specialized agent (英语学习助手CurrentAgent)',
    ).toBe(agentSlug);

    // 截图记录最终状态
    await page.screenshot({ path: path.join(SCREENSHOTS_DIR, 'bug-n-current-agent-english.png'), fullPage: true });
  });
});
