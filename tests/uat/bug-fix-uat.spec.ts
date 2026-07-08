/**
 * Bug Fix UAT — 4 个 bug 修复的验收测试。
 *
 * Bug A: 删除会话后点击其他会话，删除的会话不应重新出现
 *   - 根因: deleteSession 只删第一个找到的 meta 位置，遗漏其他位置的 .jsonl 副本
 *   - 修复: file-storage.ts deleteSession 递归扫描所有 agent-scoped 路径 + legacy 路径
 *
 * Bug B: 新建会话-通用助手-对话后，会话应出现在左侧列表
 *   - 根因: handleStartNewSessionWithAgent 仅发 /agent <slug> 切换到旧 session，未创建新会话
 *   - 修复: 改为发送 /agent <slug> + 延迟 200ms 后发 /new 创建新会话
 *
 * Bug C: 新建会话-专用智能体-对话后，会话应出现在该智能体列表下
 *   - 根因: 同 Bug B
 *   - 修复: 同 Bug B
 *
 * Bug D: 会话重命名功能
 *   - 根因: SessionItem 之前只有删除按钮，无重命名 UI
 *   - 修复: Sidebar.tsx SessionItem 添加 Pencil 图标 + 双击重命名 + input 编辑模式
 *
 * 测试隔离：每个测试通过 API 注册独立用户（用户名含时间戳 + 随机后缀），避免数据冲突。
 * 超时：流式响应依赖真实 LLM，可能 30-60s。
 *
 * Bug A 关键时序说明：
 *   - turn_end 后 triggerSessionSummary 异步触发 LLM 摘要（fire-and-forget，5-30s）
 *   - triggerSessionSummary 完成后调用 updateSessionLabel 写 .meta.json
 *   - 测试需等待足够长时间确保 summary 完成，否则 delete 后 summary 可能重建文件
 *   - listSessions 不按 updatedAt 排序，测试通过 API 获取 session 列表并按 preview 识别
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

/** 轮询 API 直到指定 session 不在列表中（或 timeout）。 */
async function waitForSessionGoneFromApi(
  page: Page,
  sessionId: string,
  timeout = 15_000,
): Promise<void> {
  await expect(async () => {
    const sessions = await fetchApiSessions(page);
    const found = sessions.find((s) => s.id === sessionId);
    expect(found, `session ${sessionId} should be gone from API`).toBeUndefined();
  }).toPass({ timeout });
}

/**
 * 轮询 API 直到指定 session 的 label 等于期望值（或 timeout）。
 * 用于 Bug D：/label slash 命令通过 WS 异步发送，服务端持久化需要时间。
 * 刷新页面前必须等待 label 在 API 中可见，否则 reload 后会拿到旧数据。
 * 注意：triggerSessionSummary 可能先写入 auto label，但 /label 最终会覆盖为 custom label，
 * 因此轮询会持续等待直到 label 稳定为期望值。
 */
async function waitForSessionLabelInApi(
  page: Page,
  sessionId: string,
  expectedLabel: string,
  timeout = 30_000,
): Promise<void> {
  await expect(async () => {
    const sessions = await fetchApiSessions(page);
    const found = sessions.find((s) => s.id === sessionId);
    expect(found, `session ${sessionId} should exist in API`).toBeDefined();
    expect(
      found!.label,
      `session ${sessionId} label should be "${expectedLabel}"`,
    ).toBe(expectedLabel);
  }).toPass({ timeout });
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
async function waitForAssistantText(page: Page, timeout = 60_000): Promise<string> {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const texts = await page.locator('[data-role="assistant"]').allTextContents();
    const nonEmpty = texts.find((t) => t.trim().length > 0);
    if (nonEmpty) return nonEmpty;
    await page.waitForTimeout(500);
  }
  throw new Error(`assistant message text did not appear within ${timeout}ms`);
}

/** 等待 turn 完成（data-streaming="false"）。
 * §0.3.0 OpenCode free 模型适配：使用 3s 二次确认，避免工具调用 turn 之间的瞬时 false。 */
async function waitForTurnEnd(page: Page, timeout = 120_000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const streaming = await page.getByTestId('chat-area').getAttribute('data-streaming');
    if (streaming === 'false') {
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
 *
 * handleStartNewSessionWithAgent 先发 /agent <slug>，200ms 后发 /new。
 * /agent 可能切换到已有 session 并加载消息，然后 /new 清空消息创建新 session。
 * 等待 picker 隐藏后额外等待 1.5s，确保 /new 已被服务端处理，避免在 /new
 * 处理前发送消息导致消息发到旧 session。
 */
async function createNewSessionViaPicker(page: Page, agentSlug: string): Promise<void> {
  await page.getByTestId('new-session-button').click();
  await expect(page.getByTestId('new-session-picker')).toBeVisible({ timeout: 5_000 });
  await page.getByTestId(`new-session-agent-${agentSlug}`).click();
  // 等待 picker 隐藏
  await expect(page.getByTestId('new-session-picker')).toBeHidden({ timeout: 15_000 });
  // 等待 /new 命令处理完成（/agent 先发，200ms 后 /new，需等待服务端处理）
  await page.waitForTimeout(1500);
  // 等待 empty-state 出现（确认新会话已创建，消息已清空）
  await expect(page.getByTestId('empty-state')).toBeVisible({ timeout: 15_000 });
}

test.describe('Bug Fix UAT — 4 bug fix scenarios', () => {
  test.describe.configure({ mode: 'serial' });

  test.beforeAll(() => {
    cleanDataUatDir();
  });

  // --------------------------------------------------------------------------
  // Bug A: 删除会话后切换到其他会话，被删除的会话不应重新出现
  // --------------------------------------------------------------------------
  test('Bug A: 删除会话后切换到其他会话，被删除的会话不应重新出现', async ({ page }) => {
    // 超时设为 240s：2 个 LLM turn（各 30-60s）+ 12s summary 等待 + reload + API 轮询
    test.setTimeout(240_000);
    const username = uniqueUsername('bugA');
    await setupViaApi(page, username);

    // 创建会话1：发送消息
    await page.getByTestId('input-textarea').fill('会话1标记消息bugA');
    await page.getByTestId('send-button').click();
    await expect(page.locator('[data-role="user"]').first()).toContainText('会话1标记消息bugA', {
      timeout: 10_000,
    });
    await expect(page.locator('[data-testid^="session-item-"]').first()).toBeVisible({
      timeout: 15_000,
    });
    await waitForTurnEnd(page, 90_000);

    // 创建会话2：通过新会话选择器选择通用助手
    await createNewSessionViaPicker(page, 'default');
    await page.getByTestId('input-textarea').fill('会话2标记消息bugA');
    await page.getByTestId('send-button').click();
    await expect(page.locator('[data-role="user"]').first()).toContainText('会话2标记消息bugA', {
      timeout: 10_000,
    });
    await expect(page.locator('[data-testid^="session-item-"]').first()).toBeVisible({
      timeout: 15_000,
    });
    await waitForTurnEnd(page, 90_000);

    // 关键：等待 triggerSessionSummary 完成。
    // session.ts 的 yield evt 在 turn_end flush 之前执行，flush 在 .next() 调用时触发（毫秒级）。
    // 但 triggerSessionSummary 是 fire-and-forget 异步 LLM 调用（5-30s），在 turn_end 后触发。
    // 它完成后调用 updateSessionLabel 写 .meta.json（不写 .jsonl，但可能影响 listSessions 顺序）。
    // 等待 12s 确保 summary 完成 + flush 完成 + 任何异步操作结束。
    await page.waitForTimeout(12_000);

    // 刷新页面，确保前端从 API 获取最新状态（flush + summary 都已完成）
    await page.reload();
    await expect(page.getByTestId('sidebar')).toBeVisible({ timeout: 20_000 });

    // 通过 API 获取 session 列表，按 preview/label 识别会话（不依赖 DOM 排序）
    const sessions = await fetchApiSessions(page);
    expect(sessions.length, 'should have at least 2 sessions').toBeGreaterThanOrEqual(2);

    // 找到包含 "会话2标记消息bugA" 的 session（preview 或 label）
    const session2 = sessions.find(
      (s) => s.preview?.includes('会话2标记消息bugA') || s.label?.includes('会话2标记消息bugA'),
    );
    expect(session2, '会话2 should exist in API session list').toBeTruthy();

    // 找到包含 "会话1标记消息bugA" 的 session
    const session1 = sessions.find(
      (s) => s.preview?.includes('会话1标记消息bugA') || s.label?.includes('会话1标记消息bugA'),
    );
    expect(session1, '会话1 should exist in API session list').toBeTruthy();

    const deleteSessionId = session2!.id;
    const keepSessionId = session1!.id;

    // hover session item 让删除按钮显示，然后删除
    await page.locator(`[data-testid="session-item-${deleteSessionId}"]`).hover();
    await page.getByTestId(`session-delete-${deleteSessionId}`).click();
    await expect(page.getByTestId(`session-delete-confirm-${deleteSessionId}`)).toBeVisible({
      timeout: 5_000,
    });
    await page.getByTestId(`session-delete-confirm-button-${deleteSessionId}`).click();

    // 验证被删除的 session 已从 DOM 中消失
    await expect(page.locator(`[data-testid="session-item-${deleteSessionId}"]`)).toHaveCount(0, {
      timeout: 10_000,
    });

    // 通过 API 验证被删除的 session 已从后端消失（轮询，防止延迟）
    await waitForSessionGoneFromApi(page, deleteSessionId, 15_000);

    // 关键步骤：点击另一个 session 切换
    // 这会触发 handleSessionChanged → loadAgentsAndSessions() → 重新从服务端获取 session 列表
    // 如果 deleteSession 没有完全清理 .jsonl 副本，被删除的 session 会重新出现
    // 使用 force: true 确保点击生效（避免 hover 按钮干扰）
    await page.locator(`[data-testid="session-item-${keepSessionId}"]`).click({ force: true });

    // 等待 session 列表刷新完成（loadAgentsAndSessions 是异步的，切换后触发）
    await page.waitForTimeout(3000);

    // 通过 API 再次验证被删除的 session 仍然不存在
    await waitForSessionGoneFromApi(page, deleteSessionId, 15_000);

    // 在 DOM 中验证
    await expect(page.locator(`[data-testid="session-item-${deleteSessionId}"]`)).toHaveCount(0);

    // 额外验证：刷新页面后，被删除的 session 仍然不在列表中
    // 刷新触发 bootstrap() → listSessions() 从磁盘重新扫描所有 .jsonl 文件
    // 如果 deleteSession 遗漏了任何 .jsonl 副本，此处会重新出现
    await page.reload();
    await expect(page.getByTestId('sidebar')).toBeVisible({ timeout: 20_000 });
    await expect(page.locator(`[data-testid="session-item-${deleteSessionId}"]`)).toHaveCount(0);

    // 最终 API 验证
    await waitForSessionGoneFromApi(page, deleteSessionId, 10_000);
  });

  // --------------------------------------------------------------------------
  // Bug B: 新建会话-通用助手-对话后，会话应出现在左侧列表
  // --------------------------------------------------------------------------
  test('Bug B: 新建会话-通用助手-对话后，会话应出现在左侧列表', async ({ page }) => {
    const username = uniqueUsername('bugB');
    await setupViaApi(page, username);

    // 初始状态：无会话，显示 empty-state
    await expect(page.getByTestId('empty-state')).toBeVisible();

    // 点击"新会话"按钮 → 验证 picker 可见
    await page.getByTestId('new-session-button').click();
    await expect(page.getByTestId('new-session-picker')).toBeVisible({ timeout: 5_000 });

    // 选择"通用助手"（default agent）
    await page.getByTestId('new-session-agent-default').click();

    // 等待新会话创建完成（picker 隐藏，empty-state 出现）
    await expect(page.getByTestId('new-session-picker')).toBeHidden({ timeout: 15_000 });
    // 等待 /new 命令处理完成（/agent 先发，200ms 后 /new）
    await page.waitForTimeout(1500);
    await expect(page.getByTestId('empty-state')).toBeVisible({ timeout: 15_000 });

    // 发送消息
    await page.getByTestId('input-textarea').fill('通用助手测试消息bugB');
    await page.getByTestId('send-button').click();

    // 验证 user 消息出现
    await expect(page.locator('[data-role="user"]').first()).toContainText('通用助手测试消息bugB', {
      timeout: 10_000,
    });

    // 等待 session 出现在侧边栏
    await expect(page.locator('[data-testid^="session-item-"]').first()).toBeVisible({
      timeout: 20_000,
    });

    // 等待 turn 完成以确保持久化
    await waitForTurnEnd(page, 90_000);

    // 验证会话出现在侧边栏"通用智能体"分区下
    // 用户只有 default agent，所有会话都在通用分区
    await expect(page.getByTestId('sidebar').getByText('通用智能体')).toBeVisible();
    const sessionCount = await page.locator('[data-testid^="session-item-"]').count();
    expect(sessionCount).toBeGreaterThanOrEqual(1);

    // 验证会话显示 preview 文本
    await expect(
      page.locator('[data-testid^="session-item-"]').filter({ hasText: '通用助手测试消息bugB' }),
    ).toBeVisible({ timeout: 10_000 });
  });

  // --------------------------------------------------------------------------
  // Bug C: 新建会话-专用智能体-对话后，会话应出现在该智能体列表下
  // --------------------------------------------------------------------------
  test('Bug C: 新建会话-专用智能体-对话后，会话应出现在该智能体列表下', async ({ page }) => {
    const username = uniqueUsername('bugC');
    await setupViaApi(page, username);

    // 先创建一个专用智能体
    const agentName = `英语学习助手-${Date.now()}`;
    await page.getByTestId('create-agent-button').click();
    await expect(page.getByTestId('create-agent-modal')).toBeVisible({ timeout: 5_000 });
    await page.getByTestId('create-agent-name').fill(agentName);
    await page.getByTestId('create-agent-description').fill('专业的英语学习辅导智能体');
    await page.getByTestId('create-agent-prompt').fill('你是一个专业的英语学习助手');
    await page.getByTestId('create-agent-icon-brain').click();
    await page.getByTestId('create-agent-save').click();
    await expect(page.getByTestId('create-agent-modal')).toBeHidden({ timeout: 10_000 });

    // 等待 agent 出现在侧边栏并获取其 slug
    await expect(
      page.getByTestId('specialized-agents-section').getByText(agentName),
    ).toBeVisible({ timeout: 10_000 });
    const agentItem = page.locator('[data-testid^="agent-item-"]').filter({ hasText: agentName });
    const agentSlug = await agentItem.getAttribute('data-agent-slug');
    expect(agentSlug).toBeTruthy();

    // 点击"新会话" → 验证 picker 可见
    await page.getByTestId('new-session-button').click();
    await expect(page.getByTestId('new-session-picker')).toBeVisible({ timeout: 5_000 });

    // 选择刚创建的专用智能体
    await page.getByTestId(`new-session-agent-${agentSlug}`).click();

    // 等待新会话创建完成
    await expect(page.getByTestId('new-session-picker')).toBeHidden({ timeout: 15_000 });
    // 等待 /new 命令处理完成（/agent 先发，200ms 后 /new）
    await page.waitForTimeout(1500);
    await expect(page.getByTestId('empty-state')).toBeVisible({ timeout: 15_000 });

    // 发送消息
    await page.getByTestId('input-textarea').fill('专用智能体测试消息bugC');
    await page.getByTestId('send-button').click();

    // 验证 user 消息出现
    await expect(page.locator('[data-role="user"]').first()).toContainText('专用智能体测试消息bugC', {
      timeout: 10_000,
    });

    // 等待 turn 完成以确保持久化
    await waitForTurnEnd(page, 90_000);

    // 展开该专用智能体（点击 agent-item 切换展开/折叠）
    await page.getByTestId(`agent-item-${agentSlug}`).getByText(agentName).click();

    // 验证会话出现在该专用智能体展开列表中
    const agentSessionItem = page.locator(
      `[data-testid="agent-item-${agentSlug}"] [data-testid^="session-item-"]`,
    );
    await expect(agentSessionItem.first()).toBeVisible({ timeout: 15_000 });

    // 验证会话显示 preview 文本
    await expect(agentSessionItem.filter({ hasText: '专用智能体测试消息bugC' })).toBeVisible({
      timeout: 10_000,
    });
  });

  // --------------------------------------------------------------------------
  // Bug D: 会话重命名功能
  // --------------------------------------------------------------------------
  test('Bug D: 会话重命名功能', async ({ page }) => {
    test.setTimeout(240_000);
    const username = uniqueUsername('bugD');
    await setupViaApi(page, username);

    // 关键：先通过 createNewSessionViaPicker 创建新会话。
    // 原因：slashHandler.ctx.sessionId 仅在 /new /resume /agent 命令时更新，
    // 普通消息不会更新它。若直接发消息，/label slash 命令会写入错误的 session
    // （server 初始 session 而非用户实际 session）。
    // createNewSessionViaPicker 发送 /agent default + /new，/new 会更新 ctx.sessionId
    // 到新创建的 session，使后续 /label 写入正确的 session。
    await createNewSessionViaPicker(page, 'default');

    // 在新会话中发送消息使其持久化
    await page.getByTestId('input-textarea').fill('重命名测试原始消息bugD');
    await page.getByTestId('send-button').click();
    await expect(page.locator('[data-role="user"]').first()).toContainText(
      '重命名测试原始消息bugD',
      { timeout: 10_000 },
    );

    // 等待 turn 完成以确保持久化（OpenCode free 模型 reasoning_content 阶段较长，需 120s）
    await waitForTurnEnd(page, 120_000);

    // 等待 session 出现在侧边栏（turn_end 后 loadAgentsAndSessions 异步刷新）
    await expect(page.locator('[data-testid^="session-item-"]').first()).toBeVisible({
      timeout: 20_000,
    });

    // 获取 session id
    const sessionId = await page
      .locator('[data-testid^="session-item-"]')
      .first()
      .getAttribute('data-session-id');
    expect(sessionId).toBeTruthy();

    // hover session item 让重命名按钮显示
    await page.locator(`[data-testid="session-item-${sessionId}"]`).hover();

    // 点击 Pencil 重命名按钮
    await page.getByTestId(`session-rename-button-${sessionId}`).click();

    // 验证重命名输入框出现
    const renameInput = page.getByTestId(`session-rename-input-${sessionId}`);
    await expect(renameInput).toBeVisible({ timeout: 5_000 });

    // 填入新名称并按 Enter
    const newName = `重命名后的会话-${Date.now()}`;
    await renameInput.fill(newName);
    await renameInput.press('Enter');

    // 验证重命名模式已退出（输入框消失）
    await expect(page.getByTestId(`session-rename-input-${sessionId}`)).toHaveCount(0, {
      timeout: 5_000,
    });

    // 验证会话显示名已更新为新名称（乐观更新：setSessions 立即更新前端状态）
    await expect(
      page.locator(`[data-testid="session-item-${sessionId}"]`).getByText(newName),
    ).toBeVisible({ timeout: 10_000 });

    // 关键：等待服务端持久化完成后再刷新。
    // /label slash 命令通过 WS 异步发送，服务端 updateSessionLabel 写入 .meta.json 需要时间。
    // 同时 triggerSessionSummary（turn_end 后 fire-and-forget LLM 调用）可能先写入 auto label，
    // 但 /label 最终会覆盖为 custom label（triggerSessionSummary 检查 hasCustomLabel 后跳过）。
    // 轮询 API 直到 label 稳定为新名称，确保 reload 不会拿到旧数据。
    await waitForSessionLabelInApi(page, sessionId!, newName, 30_000);

    // 刷新页面验证持久化（前端从 /api/sessions 重新获取，应显示新名称）
    await page.reload();
    await expect(page.getByTestId('sidebar')).toBeVisible({ timeout: 20_000 });
    await expect(
      page.locator(`[data-testid="session-item-${sessionId}"]`).getByText(newName),
    ).toBeVisible({ timeout: 20_000 });
  });
});
