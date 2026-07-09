/**
 * Bug M (round 2) / N UAT — 2 个 bug 修复的验收测试。
 *
 * Bug M (round 2): 离开会话再进入后，工具调用记录被折叠进原消息，无空 assistant 消息。
 *   - 根因: readHistoryForReplay 将空内容 + 有 toolCalls 的 assistant 消息（工具调用轮次）
 *     作为独立空消息返回，导致重进会话后出现多条空消息悬浮在原消息上方。
 *   - 修复: readHistoryForReplay 跳过空内容 + 有 toolCalls 的 assistant 消息，
 *     将其 toolCalls 合并到下一条非空 assistant 消息。重进后应只有 1 条 assistant 消息
 *     （含 toolCalls + 文本），无空消息。
 *
 * Bug N: NewSessionPicker 状态下直接输入消息应创建新 default 会话。
 *   - 根因: handleSendMessage 未检测 showNewSessionPicker 状态，直接 ws.send 到当前 session，
 *     导致消息追加到上一个会话而非创建新会话。
 *   - 修复: handleSendMessage 检测 showNewSessionPicker 为 true 时，暂存消息到 pendingUserMessageRef，
 *     发送 /agent default + /new 创建新 default 会话，session_changed 后自动发送暂存消息。
 *
 * 测试隔离：每个测试通过 API 注册独立用户（用户名含时间戳 + 随机后缀）。
 * 超时：流式响应依赖真实 LLM，可能 30-60s；工具调用轮次可能 60-120s。
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

/**
 * 通过新会话选择器创建新会话并选择指定智能体。
 * 点击"新会话" → 等待 picker 显示 → 点击对应 agent 卡片 → 等待 empty-state 出现。
 */
async function createNewSessionViaPicker(page: Page, agentSlug: string): Promise<void> {
  await page.getByTestId('new-session-button').click();
  await expect(page.getByTestId('new-session-picker')).toBeVisible({ timeout: 5_000 });
  await page.getByTestId(`new-session-agent-${agentSlug}`).click();
  await expect(page.getByTestId('new-session-picker')).toBeHidden({ timeout: 15_000 });
  // 等待 /new 命令处理完成（/agent 先发，200ms 后 /new，需等待服务端处理）
  await page.waitForTimeout(1500);
  await expect(page.getByTestId('empty-state')).toBeVisible({ timeout: 15_000 });
}

/** 获取 agent-select-desktop 当前选中选项的文本（agent 名称）。 */
async function getAgentSelectText(page: Page): Promise<string> {
  return await page.getByTestId('agent-select-desktop').evaluate(
    (el: HTMLSelectElement) => el.options[el.selectedIndex]?.text || '',
  );
}

test.describe('Bug M (round 2) / N UAT — 2 bug fix scenarios', () => {
  test.describe.configure({ mode: 'serial' });

  test.beforeAll(() => {
    cleanDataUatDir();
    ensureScreenshotsDir();
  });

  // --------------------------------------------------------------------------
  // Bug M (round 2): 重进会话后无空 assistant 消息，工具调用折叠进原消息
  // --------------------------------------------------------------------------
  test('Bug M (round 2): 重进会话后无空 assistant 消息，工具调用折叠进原消息', async ({ page }) => {
    test.setTimeout(240_000);
    const username = uniqueUsername('bugM2');
    await setupViaApi(page, username);

    // 发送会触发工具调用的消息（write_agent_memory）
    await page.getByTestId('input-textarea').fill('请记住我的名字叫王五并保存到记忆中');
    await page.getByTestId('send-button').click();

    await expect(page.locator('[data-role="user"]').first()).toContainText('请记住我的名字叫王五', {
      timeout: 10_000,
    });

    // 等待 turn 完成（工具调用轮次可能较长）
    await waitForTurnComplete(page, 1, 180_000);

    // === 步骤 1：验证 inline-tool-calls 在当前（live）会话中可见 ===
    const liveLastAssistant = page.locator('[data-role="assistant"]').last();
    const liveInline = liveLastAssistant.locator('[data-testid="inline-tool-calls"]');
    await expect(
      liveInline.first(),
      'inline-tool-calls should be visible inside the last assistant message during live session',
    ).toBeVisible({ timeout: 15_000 });

    // 等待 session 出现在侧边栏
    await expect(page.locator('[data-testid^="session-item-"]').first()).toBeVisible({
      timeout: 20_000,
    });

    // 通过 API 获取 session 列表，识别包含工具调用的 session
    const sessions = await fetchApiSessions(page);
    expect(sessions.length, 'should have at least 1 session').toBeGreaterThanOrEqual(1);

    const targetSession = sessions.find(
      (s) => s.preview?.includes('请记住我的名字叫王五') || s.label?.includes('请记住我的名字叫王五'),
    );
    expect(targetSession, 'target session with tool calls should exist in API').toBeTruthy();
    const targetSessionId = targetSession!.id;

    // === 步骤 2：通过新会话选择器创建新会话（default agent）===
    await createNewSessionViaPicker(page, 'default');

    // 验证新会话为空
    await expect(page.getByTestId('empty-state')).toBeVisible({ timeout: 15_000 });

    // 验证 inline-tool-calls 已消失（确认离开了原会话）
    await expect(page.getByTestId('inline-tool-calls')).toHaveCount(0);

    // === 步骤 3：点击侧边栏的原 session（带工具调用的会话）触发 /resume <id> ===
    await page.locator(`[data-testid="session-item-${targetSessionId}"]`).click({ force: true });

    // === 步骤 4：等待历史消息回放完成 ===
    // 等待 user 消息重新出现（replay 通过 WS 异步进行）
    await expect(
      page.locator('[data-role="user"]').filter({ hasText: '请记住我的名字叫王五' }),
      'historical user message should be visible after replay',
    ).toBeVisible({ timeout: 30_000 });

    // 等待 assistant 消息重新出现（至少 1 条）
    await expect(
      page.locator('[data-role="assistant"]').first(),
      'should have at least one assistant message after replay',
    ).toBeVisible({ timeout: 30_000 });

    // 等待 inline-tool-calls 出现（确认 replay 已加载 toolCalls 数据）
    const replayedInline = page
      .getByTestId('chat-area')
      .locator('[data-role="assistant"]')
      .locator('[data-testid="inline-tool-calls"]');
    await expect(
      replayedInline.first(),
      'inline-tool-calls should be visible inside an assistant message after re-entering session',
    ).toBeVisible({ timeout: 30_000 });

    // 给 replay 额外渲染时间，确保所有消息都已加载
    await page.waitForTimeout(2000);

    // === 核心断言 1：所有 [data-role="assistant"] 元素都有非空文本内容（无空消息）===
    // Bug M round 2 修复前：空内容 + 有 toolCalls 的 assistant 消息作为独立空消息返回，
    // 导致重进后出现多条空消息。
    // Bug M round 2 修复后：这类消息被跳过，toolCalls 合并到下一条非空 assistant 消息。
    const assistantMessages = page.getByTestId('chat-area').locator('[data-role="assistant"]');
    const assistantCount = await assistantMessages.count();
    expect(assistantCount, 'should have at least one assistant message').toBeGreaterThanOrEqual(1);

    for (let i = 0; i < assistantCount; i++) {
      const text = await assistantMessages.nth(i).textContent();
      expect(
        text && text.trim().length > 0,
        `assistant message #${i} should have non-empty text (got: ${JSON.stringify(text)})`,
      ).toBe(true);
    }

    // === 核心断言 2：inline-tool-calls 在 chat-area 内可见 ===
    const inlineInChat = page.getByTestId('chat-area').locator('[data-testid="inline-tool-calls"]');
    await expect(
      inlineInChat.first(),
      'inline-tool-calls should be visible inside chat-area',
    ).toBeVisible({ timeout: 15_000 });

    // === 核心断言 3：assistant 消息数量不超过 2 条（允许工具调用前文本 + 最终回复）===
    // Bug M round 2 修复：空内容 + toolCalls 的消息被合并到下一条非空消息。
    // 但模型可能在工具调用前输出非空文本（如"好的，我来保存"），产生 2 条非空 assistant 消息。
    // 核心验证是"无空消息"（已在上方循环断言），不限制精确数量。
    expect(
      assistantCount,
      'should have at most 2 assistant messages (tool-call text + final reply)',
    ).toBeLessThanOrEqual(2);

    // === 额外断言：工具调用 header 文本可见 ===
    await expect(
      page.getByTestId('chat-area').getByText(/工具调用\s*\(\d+\)/).first(),
      'InlineToolCalls header should show tool call count after re-entering session',
    ).toBeVisible({ timeout: 15_000 });

    // 截图记录最终状态
    await page.screenshot({ path: path.join(SCREENSHOTS_DIR, 'bug-m-round2.png'), fullPage: true });
  });

  // --------------------------------------------------------------------------
  // Bug N: NewSessionPicker 状态下直接输入消息创建新 default 会话
  // --------------------------------------------------------------------------
  test('Bug N: NewSessionPicker 状态下直接输入消息创建新 default 会话', async ({ page }) => {
    test.setTimeout(240_000);
    const username = uniqueUsername('bugN');
    await setupViaApi(page, username);

    // === 第一条消息（创建初始会话）===
    await page.getByTestId('input-textarea').fill('第一条消息测试BugN');
    await page.getByTestId('send-button').click();
    await expect(page.locator('[data-role="user"]').first()).toContainText('第一条消息测试BugN', {
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
      (s) => s.preview?.includes('第一条消息测试BugN') || s.label?.includes('第一条消息测试BugN'),
    );
    expect(oldSession, 'old session should exist').toBeTruthy();
    const oldSessionId = oldSession!.id;

    // === 步骤 1：点击"新会话"按钮，显示 agent picker ===
    await page.getByTestId('new-session-button').click();
    await expect(page.getByTestId('new-session-picker')).toBeVisible({ timeout: 5_000 });

    // 验证 picker 中有 agent 卡片可见
    await expect(page.getByTestId('new-session-agent-default')).toBeVisible({ timeout: 5_000 });

    // === 步骤 2：不点击任何 agent 卡片，直接在输入区输入消息并发送 ===
    // Bug N 修复前：消息被 ws.send 到当前 session，追加到旧会话。
    // Bug N 修复后：handleSendMessage 检测 showNewSessionPicker，暂存消息，
    //              发送 /agent default + /new 创建新会话，session_changed 后发送暂存消息。
    await page.getByTestId('input-textarea').fill('新会话直接对话BugN');
    await page.getByTestId('send-button').click();

    // === 步骤 3：等待新会话创建 + 消息发送 + assistant 响应 ===
    // picker 应消失（handleSendMessage 调用 setShowNewSessionPicker(false)）
    await expect(page.getByTestId('new-session-picker')).toBeHidden({ timeout: 15_000 });

    // 等待 user 消息 "新会话直接对话BugN" 出现在聊天区
    // （session_changed 后 handleSessionChanged 添加乐观用户消息 + 500ms 后 ws.send）
    await expect(
      page.locator('[data-role="user"]').filter({ hasText: '新会话直接对话BugN' }),
      'new user message should appear in chat area after new session created',
    ).toBeVisible({ timeout: 30_000 });

    // 等待 turn 完成（assistant 响应）
    await waitForTurnComplete(page, 1, 120_000);

    // === 核心断言 1：聊天区只有 1 条 user 消息 "新会话直接对话BugN"（不是旧的）===
    const userMessages = page.getByTestId('chat-area').locator('[data-role="user"]');
    await expect(userMessages, 'should have exactly 1 user message in new session').toHaveCount(1, {
      timeout: 10_000,
    });
    await expect(userMessages.first()).toContainText('新会话直接对话BugN');
    // 旧消息不应出现在新会话中
    await expect(
      page.getByTestId('chat-area').locator('[data-role="user"]').filter({ hasText: '第一条消息测试BugN' }),
      'old user message should NOT be in the new session',
    ).toHaveCount(0);

    // === 核心断言 2：输入区的 agent 选择器显示"通用助手"（default agent）===
    await expect(page.getByTestId('agent-select-desktop')).toHaveValue('default', { timeout: 10_000 });
    const agentText = await getAgentSelectText(page);
    expect(agentText, 'agent selector should show 通用助手 (default agent)').toBe('通用助手');

    // === 核心断言 3：旧会话仍保留其内容 ===
    // 点击旧会话触发 /resume
    await page.locator(`[data-testid="session-item-${oldSessionId}"]`).click({ force: true });

    // 等待旧消息加载（replay 通过 WS 异步进行）
    await expect(
      page.locator('[data-role="user"]').filter({ hasText: '第一条消息测试BugN' }),
      'old session should still contain the first message',
    ).toBeVisible({ timeout: 30_000 });

    // 截图记录最终状态
    await page.screenshot({ path: path.join(SCREENSHOTS_DIR, 'bug-n.png'), fullPage: true });
  });
});
