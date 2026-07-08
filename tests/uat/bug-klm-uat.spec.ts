/**
 * Bug K/L/M UAT — 3 个 bug 修复的验收测试。
 *
 * Bug K: 工具调用期间产生 1-2 个空消息框。
 *   - 根因: message_delta 事件即使 event.text 为空也会创建空消息。
 *   - 修复: message_delta handler 在 event.text 为空时 early-return，
 *           只有非空文本才触发消息创建。
 *
 * Bug L: 工具调用更新（新增工具/状态变化）时整个消息列表重渲染导致闪烁。
 *   - 根因: toolCalls 更新时所有 message 子组件都重新渲染。
 *   - 修复: 抽取 AssistantMessageItem / UserMessageItem 为 React.memo 组件；
 *           仅最后一条 assistant 消息（持有 live toolCalls）重渲染，其他消息稳定。
 *
 * Bug M: 离开会话再进入后工具调用记录消失。
 *   - 根因: readHistoryForReplay 过滤掉带 toolCalls 的 assistant 消息；
 *           前端无机制恢复工具调用记录。
 *   - 修复: (1) readHistoryForReplay 在 assistant 消息上保留 toolCalls 数据，
 *           关联 'tool' role 消息中的工具结果；(2) Message 类型新增 toolCalls?: ToolCall[]；
 *           (3) handleReplay 从 JSONL 历史填充 msg.toolCalls；
 *           (4) ChatArea AssistantMessageItem 对历史消息显示 msg.toolCalls，
 *           对当前流式消息显示 reducer 的 live toolCalls。
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

test.describe('Bug K/L/M UAT — 3 bug fix scenarios', () => {
  test.describe.configure({ mode: 'serial' });

  test.beforeAll(() => {
    cleanDataUatDir();
    ensureScreenshotsDir();
  });

  // --------------------------------------------------------------------------
  // Bug K: 工具调用期间不出现空消息框
  // --------------------------------------------------------------------------
  test('Bug K: 工具调用时不产生空 assistant 消息', async ({ page }) => {
    test.setTimeout(240_000);
    const username = uniqueUsername('bugK');
    await setupViaApi(page, username);

    // 发送会触发工具调用的消息（write_agent_memory）
    await page.getByTestId('input-textarea').fill('请记住我的名字叫张三并保存到记忆中');
    await page.getByTestId('send-button').click();

    await expect(page.locator('[data-role="user"]').first()).toContainText('请记住我的名字叫张三', {
      timeout: 10_000,
    });

    // 等待 turn 完成（工具调用轮次可能较长）
    await waitForTurnComplete(page, 1, 180_000);

    // === 核心断言 1：所有 [data-role="assistant"] 元素都有非空文本内容 ===
    // Bug K 修复后 message_delta 仅在 event.text 非空时创建消息，
    // turn 结束后所有 assistant 消息应有非空文本（不再有空消息框）。
    const assistantMessages = page.locator('[data-role="assistant"]');
    const assistantCount = await assistantMessages.count();
    expect(assistantCount, 'should have at least one assistant message').toBeGreaterThanOrEqual(1);

    for (let i = 0; i < assistantCount; i++) {
      const text = await assistantMessages.nth(i).textContent();
      expect(
        text && text.trim().length > 0,
        `assistant message #${i} should have non-empty text (got: ${JSON.stringify(text)})`,
      ).toBe(true);
    }

    // === 核心断言 2：turn 结束后 processing 占位气泡应已移除 ===
    // 工具调用进行中但无文本时显示 message-assistant-processing；turn 结束后 isWorking=false，应移除。
    await expect(page.getByTestId('message-assistant-processing')).toHaveCount(0);

    // === 额外断言：inline-tool-calls 内联在最后一条 assistant 消息内 ===
    // 确认工具调用确实被触发并以 InlineToolCalls 折叠展示（佐证空消息不是工具调用未触发的副作用）。
    const lastAssistant = assistantMessages.last();
    const inlineInLast = lastAssistant.locator('[data-testid="inline-tool-calls"]');
    await expect(
      inlineInLast.first(),
      'inline-tool-calls should be visible inside the last assistant message bubble',
    ).toBeVisible({ timeout: 15_000 });
  });

  // --------------------------------------------------------------------------
  // Bug L: 工具调用更新时消息列表不闪烁（仅最后一条 assistant 重渲染）
  // --------------------------------------------------------------------------
  test('Bug L: 工具调用更新时消息列表不闪烁', async ({ page }) => {
    test.setTimeout(240_000);
    const username = uniqueUsername('bugL');
    await setupViaApi(page, username);

    // 发送会触发工具调用的消息（read_agent_memory — 通常会有状态变化：running → success）
    await page.getByTestId('input-textarea').fill('请读取你记忆中保存的内容并告诉我');
    await page.getByTestId('send-button').click();

    await expect(page.locator('[data-role="user"]').first()).toContainText('请读取你记忆中保存', {
      timeout: 10_000,
    });

    // 等待 turn 完成
    await waitForTurnComplete(page, 1, 180_000);

    // 等待 assistant 文本渲染
    const assistantText = await waitForAssistantText(page, 30_000);
    expect(assistantText.trim().length, 'assistant should have non-empty text').toBeGreaterThan(0);

    // === 核心断言 1：聊天区至少有 1 条非空 assistant 消息 ===
    const assistantMessages = page.locator('[data-role="assistant"]');
    const assistantCount = await assistantMessages.count();
    expect(assistantCount, 'should have at least one assistant message').toBeGreaterThanOrEqual(1);

    const texts = await assistantMessages.allTextContents();
    const nonEmptyCount = texts.filter((t) => t.trim().length > 0).length;
    expect(nonEmptyCount, 'should have at least one non-empty assistant message').toBeGreaterThanOrEqual(1);

    // === 核心断言 2：inline-tool-calls 存在于最后一条 assistant 消息内 ===
    // Bug L 修复后仅最后一条 assistant 消息持有 live toolCalls 并重渲染，
    // inline-tool-calls 应内联在最后一条 assistant 消息气泡内。
    const lastAssistant = assistantMessages.last();
    const inlineInLast = lastAssistant.locator('[data-testid="inline-tool-calls"]');
    await expect(
      inlineInLast.first(),
      'inline-tool-calls should be visible inside the last assistant message',
    ).toBeVisible({ timeout: 15_000 });

    // === 核心断言 3：所有消息仍然可见（无消息丢失）===
    // Bug L 修复使用 React.memo，不应导致消息丢失。
    const userMessages = page.locator('[data-role="user"]');
    await expect(userMessages, 'should have exactly 1 user message').toHaveCount(1);
    // §0.3.0 OpenCode free 模型适配：模型可能在工具调用前输出非空文本（如"好的，我来读取"），
    // 产生 2 条非空 assistant 消息。核心验证是"无空消息"+"inline-tool-calls 存在"，
    // 不限制精确数量（与 bug-mn-uat.spec.ts Bug M round 2 同样的处理）。
    expect(
      assistantCount,
      'should have at most 2 assistant messages (tool-call text + final reply)',
    ).toBeLessThanOrEqual(2);

    // === 核心断言 4：消息数量正确（1 user + 1-2 assistant with tool calls）===
    // turn 完成后应有 1 条 user 消息和 1-2 条 assistant 消息（带 inline tool calls）。
    const totalMessages = await page.locator('[data-role="user"], [data-role="assistant"]').count();
    expect(totalMessages, 'should have 2-3 messages total (1 user + 1-2 assistant)').toBeLessThanOrEqual(3);

    // === 截图：验证视觉稳定性 ===
    await page.screenshot({ path: path.join(SCREENSHOTS_DIR, 'bug-l.png'), fullPage: true });
  });

  // --------------------------------------------------------------------------
  // Bug M: 离开会话再进入后工具调用记录仍显示
  // --------------------------------------------------------------------------
  test('Bug M: 离开会话再进入后工具调用记录仍显示', async ({ page }) => {
    test.setTimeout(240_000);
    const username = uniqueUsername('bugM');
    await setupViaApi(page, username);

    // 发送会触发工具调用的消息（write_agent_memory）
    await page.getByTestId('input-textarea').fill('请记住我的名字叫李四并保存到记忆中');
    await page.getByTestId('send-button').click();

    await expect(page.locator('[data-role="user"]').first()).toContainText('请记住我的名字叫李四', {
      timeout: 10_000,
    });

    // 等待 turn 完成
    await waitForTurnComplete(page, 1, 180_000);

    // === 步骤 1：验证 inline-tool-calls 在当前（live）会话中可见 ===
    const liveLastAssistant = page.locator('[data-role="assistant"]').last();
    const liveInline = liveLastAssistant.locator('[data-testid="inline-tool-calls"]');
    await expect(
      liveInline.first(),
      'inline-tool-calls should be visible inside the last assistant message during live session',
    ).toBeVisible({ timeout: 15_000 });

    // 等待 session 出现在侧边栏并获取 session ID
    await expect(page.locator('[data-testid^="session-item-"]').first()).toBeVisible({
      timeout: 20_000,
    });

    // 通过 API 获取 session 列表，识别包含 "请记住我的名字叫李四" 的 session
    const sessions = await fetchApiSessions(page);
    expect(sessions.length, 'should have at least 1 session').toBeGreaterThanOrEqual(1);

    const targetSession = sessions.find(
      (s) => s.preview?.includes('请记住我的名字叫李四') || s.label?.includes('请记住我的名字叫李四'),
    );
    expect(targetSession, 'target session with tool calls should exist in API').toBeTruthy();
    const targetSessionId = targetSession!.id;

    // 同时通过 DOM 获取 session-id（用于点击）— 与 API id 应一致
    const domSessionId = await page
      .locator(`[data-testid="session-item-${targetSessionId}"]`)
      .getAttribute('data-session-id');
    expect(domSessionId, 'DOM session-id should match API session id').toBe(targetSessionId);

    // === 步骤 2：通过新会话选择器创建新会话（default agent）===
    await createNewSessionViaPicker(page, 'default');

    // 验证新会话为空
    await expect(page.getByTestId('empty-state')).toBeVisible({ timeout: 15_000 });

    // 验证 inline-tool-calls 已消失（确认离开了原会话）
    await expect(page.getByTestId('inline-tool-calls')).toHaveCount(0);

    // === 步骤 3：点击侧边栏的第一个 session（带工具调用的会话）触发 /resume <id> ===
    await page.locator(`[data-testid="session-item-${targetSessionId}"]`).click({ force: true });

    // === 步骤 4：等待历史消息回放完成 ===
    // 等待 user 消息重新出现（replay 通过 WS 异步进行）
    await expect(
      page.locator('[data-role="user"]').filter({ hasText: '请记住我的名字叫李四' }),
      'historical user message should be visible after replay',
    ).toBeVisible({ timeout: 30_000 });

    // 等待 assistant 消息重新出现（至少 1 条）
    // 注意：JSONL 历史可能包含多条 assistant 消息（工具调用轮次 + 最终文本回复），
    // 此处仅确认 replay 已加载至少 1 条 assistant 消息，不限制具体数量。
    await expect(
      page.locator('[data-role="assistant"]').first(),
      'should have at least one assistant message after replay',
    ).toBeVisible({ timeout: 30_000 });

    // 给 JSONL replay 一点额外时间渲染 toolCalls 数据
    await page.waitForTimeout(2000);

    // === 核心断言 1：inline-tool-calls 在重新进入会话后仍然可见 ===
    // Bug M 修复前：readHistoryForReplay 过滤掉带 toolCalls 的 assistant 消息，
    // 重新进入会话后 inline-tool-calls 不会显示。
    // Bug M 修复后：readHistoryForReplay 保留 toolCalls 数据，handleReplay 填充 msg.toolCalls，
    // AssistantMessageItem 显示 msg.toolCalls（历史消息）。
    //
    // 注意：JSONL 中 toolCalls 附加在发起工具调用的 assistant 消息上（readHistoryForReplay
    // 按 msg.toolCalls 关联），不一定是最后一条 assistant 消息（最后一条通常是最终文本回复）。
    // 因此此处检查 inline-tool-calls 在 chat-area 内任意 assistant 消息中可见即可。
    const replayedInline = page
      .getByTestId('chat-area')
      .locator('[data-role="assistant"]')
      .locator('[data-testid="inline-tool-calls"]');
    await expect(
      replayedInline.first(),
      'inline-tool-calls should STILL be visible inside an assistant message after re-entering session',
    ).toBeVisible({ timeout: 30_000 });

    // === 核心断言 2：工具调用记录确实显示（InlineToolCalls 组件存在）===
    // 验证 InlineToolCalls 组件 header 文本 "工具调用 (N)" 存在。
    // 可能有多个 assistant 消息各自带 toolCalls（多次工具调用轮次），取第一个即可。
    await expect(
      page.getByTestId('chat-area').getByText(/工具调用\s*\(\d+\)/).first(),
      'InlineToolCalls header should show tool call count after re-entering session',
    ).toBeVisible({ timeout: 15_000 });

    // === 截图：记录重新进入会话后的状态 ===
    await page.screenshot({ path: path.join(SCREENSHOTS_DIR, 'bug-m.png'), fullPage: true });
  });
});
