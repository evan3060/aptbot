/**
 * Bug H/I/J UAT — 3 个 bug 修复的验收测试。
 *
 * Bug H: 工具调用时出现空消息框（出现后消失）。
 *   - 根因: message_start 创建空消息，工具调用期间出现后消失。
 *   - 修复: message_start 不再创建消息，仅记录 pendingMessageIdRef；
 *           实际消息在 message_delta（文本到达时）创建。
 *           工具调用进行中但无文本时，显示 processing 占位气泡。
 *
 * Bug I: 历史会话（尤其 default agent 会话）无法加载历史内容。
 *   - 根因: websocket-server 仅在两个 ring buffer 都为空时才用 JSONL fallback；
 *           ring buffer 有部分数据时仅回放 buffer（不含完整 JSONL 历史）。
 *   - 修复: historyLimit 提供时总是先尝试 JSONL，仅在 JSONL 无返回时 fallback 到 ring buffer。
 *
 * Bug J: 点击不同 agent 的会话时输入区 agent 选择器不切换。
 *   - 根因: handleSelectSession 未更新 activeAgentSlug；/resume 传 currentAgentSlug 覆盖原始 agent。
 *   - 修复: (1) handleSelectSession 从 session.agentId 更新 activeAgentSlug；
 *           (2) /resume 不再传 agentSlug，让 sessionFactory 从 .meta.json 读取原始 agent。
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
        body: JSON.stringify({ name, description, personality, type: 'professional' }),
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

/** 获取 agent-select-desktop 当前选中选项的文本（agent 名称）。 */
async function getAgentSelectText(page: Page): Promise<string> {
  return await page.getByTestId('agent-select-desktop').evaluate(
    (el: HTMLSelectElement) => el.options[el.selectedIndex]?.text || '',
  );
}

test.describe('Bug H/I/J UAT — 3 bug fix scenarios', () => {
  test.describe.configure({ mode: 'serial' });

  test.beforeAll(() => {
    cleanDataUatDir();
  });

  // --------------------------------------------------------------------------
  // Bug H: 工具调用时不出现空消息框
  // --------------------------------------------------------------------------
  test('Bug H: 工具调用时不出现空消息框，工具调用内联展示', async ({ page }) => {
    test.setTimeout(240_000);
    const username = uniqueUsername('bugH');
    await setupViaApi(page, username);

    // 发送会触发工具调用的消息（write_agent_memory）
    await page.getByTestId('input-textarea').fill('请记住我的名字叫张三并保存到记忆中');
    await page.getByTestId('send-button').click();

    await expect(page.locator('[data-role="user"]').first()).toContainText('请记住我的名字叫张三', {
      timeout: 10_000,
    });

    // 等待 turn 完成（工具调用轮次可能较长）
    await waitForTurnComplete(page, 1, 180_000);

    // === 核心断言 1：无空 assistant 消息 ===
    // Bug H 修复后 message_start 不再创建空消息，实际消息在 message_delta（文本到达）时创建。
    // turn 结束后所有 [data-role="assistant"] 元素都应有非空文本内容。
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

    // === 核心断言 2：processing 占位气泡已移除（turn 结束后应消失）===
    // 工具调用进行中但无文本时显示 message-assistant-processing；turn 结束后 isWorking=false，应移除。
    await expect(page.getByTestId('message-assistant-processing')).toHaveCount(0);

    // === 核心断言 3：inline-tool-calls 内联在最后一条 assistant 消息内 ===
    // 工具调用以 InlineToolCalls 折叠展示在最后一条 assistant 消息的内容气泡内。
    const lastAssistant = assistantMessages.last();
    const inlineInLast = lastAssistant.locator('[data-testid="inline-tool-calls"]');
    await expect(
      inlineInLast.first(),
      'inline-tool-calls should be visible inside the last assistant message bubble',
    ).toBeVisible({ timeout: 15_000 });
  });

  // --------------------------------------------------------------------------
  // Bug I: 历史会话加载历史内容
  // --------------------------------------------------------------------------
  test('Bug I: 历史会话加载历史内容', async ({ page }) => {
    // §0.3.0 OpenCode free 模型适配：reasoning_content 阶段较长，单 turn 可能 120s+
    // 总超时设为 480s（2 个 turn 各最多 180s + replay/切换开销）
    test.setTimeout(480_000);
    const username = uniqueUsername('bugI');
    await setupViaApi(page, username);

    // 第一条消息
    await page.getByTestId('input-textarea').fill('历史测试标记消息BugI');
    await page.getByTestId('send-button').click();
    await expect(page.locator('[data-role="user"]').first()).toContainText('历史测试标记消息BugI', {
      timeout: 10_000,
    });
    await waitForTurnComplete(page, 1, 180_000);

    // 等待 session 出现在侧边栏并获取 session ID
    await expect(page.locator('[data-testid^="session-item-"]').first()).toBeVisible({
      timeout: 20_000,
    });
    const firstSessionId = await page
      .locator('[data-testid^="session-item-"]')
      .first()
      .getAttribute('data-session-id');
    expect(firstSessionId, 'first session should have an id').toBeTruthy();

    // 第二条消息（同一会话）
    await page.getByTestId('input-textarea').fill('第二条消息BugI');
    await page.getByTestId('send-button').click();
    await expect(page.locator('[data-role="user"]').nth(1)).toContainText('第二条消息BugI', {
      timeout: 10_000,
    });
    await waitForTurnComplete(page, 2, 180_000);

    // 创建新会话（通用助手）— 会清空聊天区
    await createNewSessionViaPicker(page, 'default');

    // 验证新会话为空
    await expect(page.getByTestId('empty-state')).toBeVisible({ timeout: 15_000 });

    // 点击第一个 session（历史会话）触发 /resume <id>
    await page.locator(`[data-testid="session-item-${firstSessionId}"]`).click({ force: true });

    // 等待历史消息加载（replay 通过 WS 异步进行）
    // 注意：使用 [data-role="user"] 过滤，避免 assistant 回复中引用用户消息文本导致匹配多元素。
    await expect(
      page.locator('[data-role="user"]').filter({ hasText: '历史测试标记消息BugI' }),
      'first historical user message should be visible after replay',
    ).toBeVisible({ timeout: 30_000 });

    await expect(
      page.locator('[data-role="user"]').filter({ hasText: '第二条消息BugI' }),
      'second historical user message should be visible after replay',
    ).toBeVisible({ timeout: 30_000 });

    // 验证两条 user 消息都已加载
    const userMessages = page.locator('[data-role="user"]');
    await expect(userMessages, 'should have 2 user messages after replay').toHaveCount(2, {
      timeout: 15_000,
    });

    // 验证 assistant 响应已加载（至少 2 条 assistant 消息，模型可能因工具调用产生更多）
    const assistantMessages = page.locator('[data-role="assistant"]');
    await expect(async () => {
      const count = await assistantMessages.count();
      expect(count, 'should have at least 2 assistant messages after replay').toBeGreaterThanOrEqual(2);
    }).toPass({ timeout: 15_000 });
  });

  // --------------------------------------------------------------------------
  // Bug J: 点击不同 agent 的会话时输入区 agent 选择器切换
  // --------------------------------------------------------------------------
  test('Bug J: 点击不同 agent 的会话时 agent 选择器切换', async ({ page }) => {
    test.setTimeout(240_000);
    const username = uniqueUsername('bugJ');
    await setupViaApi(page, username);

    // 通过 API 创建专用智能体
    const agentName = '投资助手测试J';
    const { slug: agentSlug } = await createSpecializedAgentViaApi(
      page,
      agentName,
      '投资助手',
      '你是一个专业的投资助手',
    );

    // 刷新页面让前端加载新建的智能体（bootstrap 重新拉取 agents 列表）
    await page.reload();
    await expect(page.getByTestId('sidebar')).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId('chat-area')).toBeVisible();

    // 创建专用智能体的会话并发送消息
    await createNewSessionViaPicker(page, agentSlug);
    await page.getByTestId('input-textarea').fill('你好，请介绍一下你自己');
    await page.getByTestId('send-button').click();
    await expect(page.locator('[data-role="user"]').first()).toContainText('你好', {
      timeout: 10_000,
    });
    await waitForTurnComplete(page, 1, 120_000);

    // 获取专用智能体会话的 ID（通过 API）
    const sessions = await fetchApiSessions(page);
    const specializedSession = sessions.find((s) => s.agentId === agentSlug);
    expect(specializedSession, 'specialized agent session should exist in API').toBeTruthy();
    const specializedSessionId = specializedSession!.id;

    // 展开专用智能体分区（点击 agent 名称）— 此时 active agent 已经是专用智能体
    await page.getByTestId(`agent-item-${agentSlug}`).getByText(agentName).click();
    await page.waitForTimeout(500);

    // 验证专用会话在展开列表中可见
    await expect(
      page.locator(`[data-testid="session-item-${specializedSessionId}"]`),
    ).toBeVisible({ timeout: 10_000 });

    // 创建新的 default 会话（分区展开状态在 Sidebar 本地 state 中保留）
    await createNewSessionViaPicker(page, 'default');

    // === 核心断言 1：agent 选择器显示通用助手 ===
    await expect(page.getByTestId('agent-select-desktop')).toHaveValue('default', { timeout: 10_000 });
    const defaultAgentText = await getAgentSelectText(page);
    expect(defaultAgentText, 'agent selector should show default agent name').toBe('通用助手');

    // 验证专用会话仍可见（分区仍展开）
    await expect(
      page.locator(`[data-testid="session-item-${specializedSessionId}"]`),
    ).toBeVisible({ timeout: 10_000 });

    // 点击专用智能体的会话（触发 handleSelectSession → 更新 activeAgentSlug）
    await page
      .locator(`[data-testid="session-item-${specializedSessionId}"]`)
      .click({ force: true });

    // === 核心断言 2：agent 选择器切换到专用智能体 ===
    await expect(page.getByTestId('agent-select-desktop')).toHaveValue(agentSlug, { timeout: 10_000 });
    const switchedAgentText = await getAgentSelectText(page);
    expect(switchedAgentText, 'agent selector should switch to specialized agent').toBe(agentName);
    expect(switchedAgentText, 'agent selector should NOT show default').not.toBe('通用助手');
  });
});
