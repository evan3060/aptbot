/**
 * Bug E/F/G UAT — 3 个 bug 修复的验收测试。
 *
 * Bug E: Agent 多工具调用轮次产生空消息。
 *   - 根因: reducer 在 turn_start 清空 toolCalls，导致跨 turn 工具调用不累积；
 *           工具调用轮次的空 assistant 消息保留在前端。
 *   - 修复: reducer 改在 agent_start 清空 toolCalls（跨 turn 累积）；
 *           App.tsx 在 message_end 移除空 assistant 消息；
 *           工具调用以 InlineToolCalls 组件折叠展示在最后一条 assistant 消息内容气泡内。
 *
 * Bug F: ChatArea 与 InputArea 之间的独立 ToolCallView 面板。
 *   - 根因: App.tsx 在 ChatArea 下方独立渲染 ToolCallView 面板（border-t border-neutral-200）。
 *   - 修复: 移除独立面板，toolCalls 作为 prop 传入 ChatArea，内联折叠展示在消息气泡内。
 *
 * Bug G: 专用智能体首条消息后丢失身份。
 *   - 根因: sessionFactory 在服务器重启后懒加载 session 时，opts 未提供 agentSlug，
 *           fallback 到 DEFAULT_AGENT_SLUG，导致专用智能体 session 用 default agent 的 systemPrompt 重建。
 *   - 修复: sessionFactory 在 opts 未提供时从 .meta.json 读取 agentId + userId，
 *           防止 fallback 到 DEFAULT_AGENT_SLUG。
 *
 * 测试隔离：每个测试通过 API 注册独立用户（用户名含时间戳 + 随机后缀）。
 * 超时：流式响应依赖真实 LLM，可能 30-60s；工具调用轮次可能 60-120s。
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

/** 获取最后一条非空 assistant 消息文本。 */
async function getLastAssistantText(page: Page): Promise<string> {
  const texts = await page.locator('[data-role="assistant"]').allTextContents();
  for (let i = texts.length - 1; i >= 0; i--) {
    if (texts[i].trim().length > 0) return texts[i];
  }
  return '';
}

/**
 * 通过新会话选择器创建新会话并选择指定智能体。
 */
async function createNewSessionViaPicker(page: Page, agentSlug: string): Promise<void> {
  await page.getByTestId('new-session-button').click();
  await expect(page.getByTestId('new-session-picker')).toBeVisible({ timeout: 5_000 });
  await page.getByTestId(`new-session-agent-${agentSlug}`).click();
  await expect(page.getByTestId('new-session-picker')).toBeHidden({ timeout: 15_000 });
  await page.waitForTimeout(1500);
  await expect(page.getByTestId('empty-state')).toBeVisible({ timeout: 15_000 });
}

/** 通过 API 创建专用智能体，返回 { slug }。 */
async function createSpecializedAgentViaApi(
  page: Page,
  name: string,
  description: string,
  personality: string,
): Promise<{ slug: string }> {
  const agent = await page.evaluate(
    async ({ name, description, personality }) => {
      const res = await fetch('/api/agents', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name, description, personality }),
        credentials: 'include',
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`create agent failed: ${res.status} ${text}`);
      }
      return (await res.json()) as { slug: string };
    },
    { name, description, personality },
  );
  expect(agent.slug, 'created agent should have a slug').toBeTruthy();
  return { slug: agent.slug };
}

test.describe('Bug E/F/G UAT — 3 bug fix scenarios', () => {
  test.describe.configure({ mode: 'serial' });

  test.beforeAll(() => {
    cleanDataUatDir();
  });

  // --------------------------------------------------------------------------
  // Bug F: 无独立 ToolCallView 面板，工具调用内联在消息气泡内
  // --------------------------------------------------------------------------
  test('Bug F: 无独立工具调用面板，工具调用内联展示', async ({ page }) => {
    test.setTimeout(180_000);
    const username = uniqueUsername('bugF');
    await setupViaApi(page, username);

    // 发送会触发工具调用的消息（write_agent_memory）
    await page.getByTestId('input-textarea').fill('请记住以下信息：我的名字叫张三，并保存到你的记忆中');
    await page.getByTestId('send-button').click();

    // 验证 user 消息出现
    await expect(page.locator('[data-role="user"]').first()).toContainText('请记住以下信息', {
      timeout: 10_000,
    });

    // 等待 turn 完成（工具调用轮次可能较长）
    await waitForTurnComplete(page, 1, 150_000);

    // === 核心断言 1：ChatArea 与 InputArea 之间无独立工具调用面板 ===
    // 旧面板是 main 的直接子 div，带 border-t border-neutral-200。
    // 当前 main 直接子元素：ChatArea(无 border-t)、InputArea(border-t border-slate-200，颜色不同)、
    // FooterBar(<footer> 标签，非 div)。因此 main > div.border-t.border-neutral-200 应为 0。
    await expect(page.locator('main > div.border-t.border-neutral-200')).toHaveCount(0);

    // === 核心断言 2：inline-tool-calls 不是 main 的直接子元素（应内联在 chat-area 内）===
    await expect(page.locator('main > [data-testid="inline-tool-calls"]')).toHaveCount(0);

    // === 核心断言 3：工具调用应内联展示在 chat-area 内（非独立面板）===
    // 消息设计为触发 write_agent_memory / read_agent_memory 工具调用，
    // 修复后工具调用以 InlineToolCalls 折叠展示在 assistant 消息气泡内。
    const inlineInChat = page.getByTestId('chat-area').locator('[data-testid="inline-tool-calls"]');
    await expect(inlineInChat.first(), 'inline-tool-calls should be visible inside chat-area').toBeVisible({
      timeout: 15_000,
    });
    // 再次确认独立面板不存在（工具调用已内联，不应有独立 ToolCallView 面板）
    await expect(page.locator('main > div.border-t.border-neutral-200')).toHaveCount(0);
  });

  // --------------------------------------------------------------------------
  // Bug E: 无空 assistant 消息，工具调用整合到最后一条 assistant 消息内
  // --------------------------------------------------------------------------
  test('Bug E: 无空 assistant 消息，工具调用整合到最后一条消息内', async ({ page }) => {
    test.setTimeout(180_000);
    const username = uniqueUsername('bugE');
    await setupViaApi(page, username);

    // 发送会触发工具调用的消息（read_agent_memory / write_agent_memory）
    await page.getByTestId('input-textarea').fill('请读取你记忆中保存的内容，并告诉我你读到了什么');
    await page.getByTestId('send-button').click();

    await expect(page.locator('[data-role="user"]').first()).toContainText('请读取你记忆', {
      timeout: 10_000,
    });

    // 等待 turn 完成
    await waitForTurnComplete(page, 1, 150_000);

    // 等待并获取 assistant 文本（防御性：确保最终文本已渲染）
    const assistantText = await waitForAssistantText(page, 30_000);
    expect(assistantText.trim().length, 'assistant should have non-empty text').toBeGreaterThan(0);

    // === 核心断言 1：无空 assistant 消息 ===
    // 所有 [data-role="assistant"] 元素都应有非空文本内容。
    // 注意：turn 完成后 processing 占位气泡（isWorking 时显示）已移除，不会干扰计数。
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

    // === 核心断言 2：至少一条非空 assistant 消息 ===
    const texts = await assistantMessages.allTextContents();
    const nonEmptyCount = texts.filter((t) => t.trim().length > 0).length;
    expect(nonEmptyCount, 'should have at least one non-empty assistant message').toBeGreaterThanOrEqual(1);
    expect(
      nonEmptyCount,
      'should have no empty assistant messages (all assistant messages non-empty)',
    ).toBe(assistantCount);

    // === 核心断言 3：工具调用应折叠展示在最后一条 assistant 消息气泡内 ===
    // 消息设计为触发 read_agent_memory / write_agent_memory 工具调用。
    // 修复后空 assistant 消息被移除，工具调用累积并以 InlineToolCalls 折叠展示在
    // 最后一条非空 assistant 消息的内容气泡内（renderMarkdown 文本之前）。
    const lastAssistant = assistantMessages.last();
    const inlineInLast = lastAssistant.locator('[data-testid="inline-tool-calls"]');
    await expect(
      inlineInLast.first(),
      'inline-tool-calls should be visible inside the last assistant message bubble',
    ).toBeVisible({ timeout: 15_000 });

    // === 核心断言 4：inline-tool-calls 不应是 main 的直接子元素（应内联在消息内）===
    await expect(page.locator('main > [data-testid="inline-tool-calls"]')).toHaveCount(0);
  });

  // --------------------------------------------------------------------------
  // Bug G: 专用智能体跨消息保持身份
  // --------------------------------------------------------------------------
  test('Bug G: 专用智能体跨消息保持身份（不退化为通用助手）', async ({ page }) => {
    test.setTimeout(240_000);
    const username = uniqueUsername('bugG');
    await setupViaApi(page, username);

    // 通过 API 创建专用智能体
    const agentName = `英语学习助手测试-${Date.now()}`;
    const { slug: agentSlug } = await createSpecializedAgentViaApi(
      page,
      agentName,
      '专业的英语学习辅导智能体',
      '你是一个专业的英语学习助手，专门帮助用户学习英语。当用户询问你是谁或你的角色时，请明确回复你是英语学习助手。',
    );

    // 刷新页面让前端加载新建的智能体（bootstrap 重新拉取 agents 列表）
    await page.reload();
    await expect(page.getByTestId('sidebar')).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId('chat-area')).toBeVisible();

    // 通过新会话选择器创建会话并选择专用智能体
    await createNewSessionViaPicker(page, agentSlug);

    // === 第一条消息 ===
    await page.getByTestId('input-textarea').fill('你好，你是谁？');
    await page.getByTestId('send-button').click();

    await expect(page.locator('[data-role="user"]').first()).toContainText('你好，你是谁', {
      timeout: 10_000,
    });

    // 等待 turn 完成，至少 1 条 assistant 消息
    await waitForTurnComplete(page, 1, 120_000);
    const firstResponse = await waitForAssistantText(page, 30_000);

    // 验证第一条回复提及英语学习助手身份
    const firstLower = firstResponse.toLowerCase();
    const firstMentionsEnglish =
      firstResponse.includes('英语') || firstLower.includes('english');
    expect(
      firstMentionsEnglish,
      `first response should mention English learning assistant (got: ${JSON.stringify(firstResponse.slice(0, 200))})`,
    ).toBe(true);

    // === 第二条消息：验证身份保持 ===
    await page.getByTestId('input-textarea').fill('你是什么角色？请告诉我你的身份');
    await page.getByTestId('send-button').click();

    await expect(page.locator('[data-role="user"]').nth(1)).toContainText('你是什么角色', {
      timeout: 10_000,
    });

    // 等待 turn 完成，至少 2 条 assistant 消息
    await waitForTurnComplete(page, 2, 120_000);
    const secondResponse = await getLastAssistantText(page);
    expect(
      secondResponse.trim().length,
      'second response should be non-empty',
    ).toBeGreaterThan(0);

    // 验证第二条回复仍然提及英语学习助手身份（未退化为通用助手）
    const secondLower = secondResponse.toLowerCase();
    const secondMentionsEnglish =
      secondResponse.includes('英语') || secondLower.includes('english');
    expect(
      secondMentionsEnglish,
      `second response should STILL mention English learning assistant — bug G check (got: ${JSON.stringify(secondResponse.slice(0, 200))})`,
    ).toBe(true);

    // 额外断言：第二条回复不应退化为"通用助手/通用智能体"身份描述
    expect(
      secondResponse.includes('通用助手'),
      `second response should not fall back to "通用助手" (got: ${JSON.stringify(secondResponse.slice(0, 200))})`,
    ).toBe(false);
  });
});
