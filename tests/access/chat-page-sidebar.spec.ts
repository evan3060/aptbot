import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { startWebSocketServer, type WebSocketServer } from '../../src/access/websocket-server.js';
import { InMemoryMessageBus } from '../../src/bus/message-bus.js';
import { createUserStorage, type UserStorage } from '../../src/infrastructure/user-storage.js';
import { FileStorage } from '../../src/infrastructure/storage/file-storage.js';
import { createChatPageHtml } from '../../src/access/chat-page.js';

/**
 * Task 10: 左侧 session 侧边栏
 *
 * 测试两类：
 * 1. HTTP API: GET /api/sessions 按 userId 过滤
 * 2. chat-page.ts 内联 JS/CSS: 侧边栏渲染、点击切换、新会话按钮
 */

const TEST_PORT = 18774;

async function httpRequest(
  port: number,
  method: string,
  path: string,
  body?: unknown,
  headers?: Record<string, string>,
): Promise<{ status: number; body: any }> {
  const url = `http://localhost:${port}${path}`;
  const init: RequestInit = { method, headers: { 'content-type': 'application/json', ...headers } };
  if (body !== undefined) init.body = JSON.stringify(body);
  const res = await fetch(url, init);
  const text = await res.text();
  let parsed: any = null;
  try { parsed = JSON.parse(text); } catch { parsed = text; }
  return { status: res.status, body: parsed };
}

/** 创建一个空的 session 文件（带可选 label 和 userId sidecar） */
function createSessionFile(sessionsDir: string, id: string, opts?: { label?: string; userId?: string }): void {
  writeFileSync(join(sessionsDir, `${id}.jsonl`), '');
  if (opts?.label || opts?.userId) {
    const meta: Record<string, string> = {};
    if (opts?.label) meta.label = opts.label;
    if (opts?.userId) meta.userId = opts.userId;
    writeFileSync(join(sessionsDir, `${id}.meta.json`), JSON.stringify(meta));
  }
}

describe('Task 10: 左侧 session 侧边栏', () => {
  let server: WebSocketServer | null = null;
  let userStorage: UserStorage;
  let storage: FileStorage;
  let tmpDir: string;
  let sessionsDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'aptbot-sidebar-'));
    sessionsDir = join(tmpDir, 'sessions');
    mkdirSync(sessionsDir, { recursive: true });
    userStorage = createUserStorage(tmpDir);
    storage = new FileStorage(sessionsDir);
  });

  afterEach(async () => {
    if (server) {
      await server.stop();
      server = null;
    }
    rmSync(tmpDir, { recursive: true, force: true });
  });

  async function startServer(): Promise<void> {
    server = await startWebSocketServer({
      port: TEST_PORT,
      bus: new InMemoryMessageBus(),
      userStorage,
      sessionStorage: storage,
    });
  }

  describe('GET /api/sessions HTTP API', () => {
    it('有效 token 返回当前用户的 sessions 列表', async () => {
      await startServer();
      const user = await userStorage.register('alice', 'pw123456');
      // 创建两个属于 alice 的 session
      const sid1 = randomUUID();
      const sid2 = randomUUID();
      createSessionFile(sessionsDir, sid1, { label: '任务A', userId: user.userId });
      createSessionFile(sessionsDir, sid2, { userId: user.userId });

      const res = await httpRequest(TEST_PORT, 'GET', `/api/sessions?token=${user.token}`);
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.sessions)).toBe(true);
      expect(res.body.sessions.length).toBe(2);
      // 应包含 label 和 id
      const labels = res.body.sessions.map((s: any) => s.label);
      expect(labels).toContain('任务A');
    });

    it('无 token 返回 401', async () => {
      await startServer();
      const res = await httpRequest(TEST_PORT, 'GET', '/api/sessions');
      expect(res.status).toBe(401);
    });

    it('无效 token 返回 401', async () => {
      await startServer();
      const res = await httpRequest(TEST_PORT, 'GET', '/api/sessions?token=invalid');
      expect(res.status).toBe(401);
    });

    it('按 userId 过滤，不返回其他用户的 session', async () => {
      await startServer();
      const alice = await userStorage.register('alice', 'pw123456');
      const bob = await userStorage.register('bob', 'pw123456');
      createSessionFile(sessionsDir, randomUUID(), { label: 'alice-task', userId: alice.userId });
      createSessionFile(sessionsDir, randomUUID(), { label: 'bob-task', userId: bob.userId });

      const res = await httpRequest(TEST_PORT, 'GET', `/api/sessions?token=${alice.token}`);
      expect(res.status).toBe(200);
      expect(res.body.sessions.length).toBe(1);
      expect(res.body.sessions[0].label).toBe('alice-task');
    });

    it('无 session 的用户返回空数组', async () => {
      await startServer();
      const user = await userStorage.register('alice', 'pw123456');
      const res = await httpRequest(TEST_PORT, 'GET', `/api/sessions?token=${user.token}`);
      expect(res.status).toBe(200);
      expect(res.body.sessions).toEqual([]);
    });
  });

  describe('chat-page.ts 侧边栏 HTML/CSS/JS', () => {
    it('包含左侧侧边栏布局（sidebar + 主聊天区）', async () => {
      const html = createChatPageHtml('/ws');
      // 侧边栏容器
      expect(html).toContain('id="sidebar"');
      // 新会话按钮
      expect(html).toContain('id="new-session-btn"');
      // session 列表容器
      expect(html).toContain('id="session-list"');
      // 用户信息区
      expect(html).toContain('id="user-info"');
    });

    it('CSS 设置侧边栏宽度与主聊天区 flex 布局', async () => {
      const html = createChatPageHtml('/ws');
      // 侧边栏宽度
      expect(html).toMatch(/#sidebar\s*\{[^}]*width:\s*260px/);
      // body 或主容器使用 flex 布局
      expect(html).toMatch(/display:\s*flex/);
    });

    it('内联 JS 在页面加载时 fetch /api/sessions', async () => {
      const html = createChatPageHtml('/ws');
      expect(html).toMatch(/fetch\s*\(\s*['"`]\/api\/sessions/);
    });

    it('内联 JS 渲染 session 列表项（label + 时间）', async () => {
      const html = createChatPageHtml('/ws');
      // 应包含渲染 session 项的逻辑
      expect(html).toMatch(/session-list/);
      // 应包含 label 显示（无 label 时显示短 ID）
      expect(html).toMatch(/label|shortId|short.*id/i);
    });

    it('内联 JS 点击 session 项触发 /resume 命令', async () => {
      const html = createChatPageHtml('/ws');
      expect(html).toMatch(/\/resume/);
    });

    it('内联 JS 新会话按钮触发 /new 命令', async () => {
      const html = createChatPageHtml('/ws');
      expect(html).toMatch(/\/new/);
    });

    it('侧边栏底部显示用户信息（未登录或 username）', async () => {
      const html = createChatPageHtml('/ws');
      // 应包含未登录文本或 username 显示逻辑
      expect(html).toMatch(/未登录|username/);
    });

    it('未登录时显示登录按钮', async () => {
      const html = createChatPageHtml('/ws');
      expect(html).toContain('id="auth-btn"');
      expect(html).toContain('id="auth-modal"');
    });

    it('登录/注册弹框包含表单与切换链接', async () => {
      const html = createChatPageHtml('/ws');
      expect(html).toContain('id="login-form"');
      expect(html).toContain('id="register-form"');
      expect(html).toContain('id="to-register"');
      expect(html).toContain('id="to-login"');
    });

    it('当前 session 高亮显示', async () => {
      const html = createChatPageHtml('/ws');
      // 应包含高亮当前 session 的逻辑（active class 或类似）
      expect(html).toMatch(/active|current/i);
    });
  });

  describe('验收修复：刷新后历史恢复 + 默认会话名', () => {
    it('内联 JS 包含 loadHistory 函数', async () => {
      const html = createChatPageHtml('/ws');
      expect(html).toMatch(/function\s+loadHistory\s*\(/);
    });

    it('内联 JS fetch /api/sessions/:id/messages', async () => {
      const html = createChatPageHtml('/ws');
      expect(html).toMatch(/\/api\/sessions\/.*\/messages/);
    });

    it('ws.onopen 调用 loadHistory（刷新后恢复历史）', async () => {
      const html = createChatPageHtml('/ws');
      // onopen 回调中应调用 loadHistory
      expect(html).toMatch(/ws\.onopen\s*=\s*function[\s\S]*?loadHistory/);
    });

    it('仅在 lastEventSeq === 0 时调用 loadHistory（避免重连清屏闪烁）', async () => {
      const html = createChatPageHtml('/ws');
      expect(html).toMatch(/lastEventSeq\s*===?\s*0[\s\S]*?loadHistory/);
    });

    it('session_changed 后通过 onopen 触发 loadHistory', async () => {
      const html = createChatPageHtml('/ws');
      // session_changed 处理中调用 connect()，connect 的 onopen 会调用 loadHistory
      expect(html).toMatch(/session_changed[\s\S]*?connect\(\)/);
    });

    it('renderSessionList 无 label 时使用 preview 作为默认名', async () => {
      const html = createChatPageHtml('/ws');
      // 应包含 label || preview || shortId 的优先级逻辑
      expect(html).toMatch(/s\.label\s*\|\|\s*s\.preview/);
    });

    it('loadHistory 渲染历史 user 消息', async () => {
      const html = createChatPageHtml('/ws');
      // loadHistory 中应处理 role === 'user' 的消息
      expect(html).toMatch(/loadHistory[\s\S]*?role\s*===?\s*['"]user['"]/);
    });

    it('loadHistory 渲染历史 assistant 消息', async () => {
      const html = createChatPageHtml('/ws');
      expect(html).toMatch(/loadHistory[\s\S]*?role\s*===?\s*['"]assistant['"]/);
    });

    it('loadHistory 处理 404（新 session 无历史）', async () => {
      const html = createChatPageHtml('/ws');
      // 应处理 404 状态码（新 session 无文件）
      expect(html).toMatch(/loadHistory[\s\S]*?404/);
    });

    it('包含 restoreSession 函数（onAuthSuccess 中预加载 session 列表）', async () => {
      const html = createChatPageHtml('/ws');
      expect(html).toMatch(/function\s+restoreSession\s*\(/);
    });

    it('restoreSession 检查当前 sessionId 是否属于用户', async () => {
      const html = createChatPageHtml('/ws');
      expect(html).toMatch(/restoreSession[\s\S]*?currentBelongs/);
    });

    it('user_identified 接收 msg.sessionId 并更新 localStorage', async () => {
      const html = createChatPageHtml('/ws');
      // user_identified 处理器中应读取 msg.sessionId 并写入 localStorage
      expect(html).toMatch(/user_identified[\s\S]*?msg\.sessionId/);
      expect(html).toMatch(/user_identified[\s\S]*?localStorage\.setItem\(SESSION_ID_KEY/);
    });

    it('user_identified 中 sessionId 变更后重连 WS（对齐 state.sessionKey）', async () => {
      const html = createChatPageHtml('/ws');
      // user_identified 中 sessionId 变化时应关闭旧连接并重连
      expect(html).toMatch(/user_identified[\s\S]*?msg\.sessionId[\s\S]*?ws\.close\(\)[\s\S]*?connect\(\)/);
    });

    it('user_identified 中 sessionId 未变化时调用 loadHistory', async () => {
      const html = createChatPageHtml('/ws');
      // user_identified 中 sessionId 未变化时 lastEventSeq === 0 调用 loadHistory
      expect(html).toMatch(/user_identified[\s\S]*?lastEventSeq\s*===?\s*0[\s\S]*?loadHistory/);
    });

    it('user_identified 保存 clientId（用于区分自己发送的消息）', async () => {
      const html = createChatPageHtml('/ws');
      expect(html).toMatch(/user_identified[\s\S]*?msg\.clientId[\s\S]*?myClientId/);
    });

    it('event 处理中包含 user_message case（跨客户端同步）', async () => {
      const html = createChatPageHtml('/ws');
      // switch 中应有 user_message case
      expect(html).toMatch(/case\s+['"]user_message['"]/);
      // 应检查 senderId !== myClientId
      expect(html).toMatch(/e\.senderId\s*!==\s*myClientId/);
    });

    it('loadHistory 进行中时忽略 event 事件（避免 ring buffer replay 闪烁）', async () => {
      const html = createChatPageHtml('/ws');
      // 应有 historyLoading 标志
      expect(html).toMatch(/historyLoading/);
      // event 处理中应检查 historyLoading
      expect(html).toMatch(/if\s*\(\s*historyLoading\s*\)\s*return/);
    });

    it('loadHistory 包含防竞态保护（historyRequestId）', async () => {
      const html = createChatPageHtml('/ws');
      // 应有 historyRequestId 计数器，仅接受最新请求结果
      expect(html).toMatch(/historyRequestId/);
      expect(html).toMatch(/reqId\s*!==\s*historyRequestId/);
    });

    it('session_changed 立即清空消息区（新会话切换无旧消息残留）', async () => {
      const html = createChatPageHtml('/ws');
      // session_changed 处理器中应立即清空 messagesEl.innerHTML
      expect(html).toMatch(/session_changed[\s\S]*?messagesEl\.innerHTML\s*=\s*['"]['"]/);
    });

    it('未登录时自动弹出 auth modal', async () => {
      const html = createChatPageHtml('/ws');
      // 初始化时 if (!token) showAuthModal('login')
      expect(html).toMatch(/if\s*\(\s*!token\s*\)\s*\{[\s\S]*?showAuthModal\(['"]login['"]\)/);
    });

    it('send 函数检查 token，未登录时弹出 auth modal', async () => {
      const html = createChatPageHtml('/ws');
      // send 函数中应有 if (!token) showAuthModal('login')
      expect(html).toMatch(/function\s+send\s*\(\s*\)\s*\{[\s\S]*?if\s*\(\s*!token\s*\)[\s\S]*?showAuthModal\(['"]login['"]\)/);
    });

    it('sendSlashCommand 检查 token，未登录时弹出 auth modal', async () => {
      const html = createChatPageHtml('/ws');
      // sendSlashCommand 函数中应有 if (!token) showAuthModal('login')
      expect(html).toMatch(/function\s+sendSlashCommand[\s\S]*?if\s*\(\s*!token\s*\)[\s\S]*?showAuthModal\(['"]login['"]\)/);
    });

    it('新会话按钮点击时立即清空消息区（即时反馈）', async () => {
      const html = createChatPageHtml('/ws');
      // newSessionBtn click 处理器中应立即设置 messagesEl.innerHTML = ''
      expect(html).toMatch(/new-session-btn[\s\S]*?messagesEl\.innerHTML\s*=\s*['"]['"]/);
    });

    it('新会话按钮点击时禁用输入框（防止切换前发送到旧 session）', async () => {
      const html = createChatPageHtml('/ws');
      // newSessionBtn click 处理器中应禁用 inputEl 并设置 placeholder
      expect(html).toMatch(/new-session-btn[\s\S]*?inputEl\.disabled\s*=\s*true/);
      expect(html).toMatch(/new-session-btn[\s\S]*?正在创建新会话/);
    });

    it('ws.onopen 重连后启用输入框（兜底恢复）', async () => {
      const html = createChatPageHtml('/ws');
      // ws.onopen 中应启用 inputEl（token 存在时）
      expect(html).toMatch(/ws\.onopen[\s\S]*?inputEl\.disabled\s*=\s*false/);
    });
  });

  describe('会话重命名 — 3-dot 菜单 + inline 编辑', () => {
    it('CSS 包含 session-menu-btn 样式', async () => {
      const html = createChatPageHtml('/ws');
      expect(html).toMatch(/\.session-menu-btn\b/);
    });

    it('CSS 包含 session-menu 弹出菜单样式', async () => {
      const html = createChatPageHtml('/ws');
      expect(html).toMatch(/\.session-menu\b/);
    });

    it('CSS 包含 session-rename-input 样式', async () => {
      const html = createChatPageHtml('/ws');
      expect(html).toMatch(/\.session-rename-input\b/);
    });

    it('renderSessionList 渲染的 item 包含 data-session-id 属性', async () => {
      const html = createChatPageHtml('/ws');
      expect(html).toMatch(/data-session-id/);
    });

    it('renderSessionList 渲染的 item 包含 session-menu-btn 按钮', async () => {
      const html = createChatPageHtml('/ws');
      expect(html).toMatch(/session-menu-btn/);
      // 应通过 createElement('button') 创建并设置 className
      expect(html).toMatch(/createElement\(['"]button['"]\)[\s\S]*?session-menu-btn/);
    });

    it('renderSessionList 包含 session-main 包裹层', async () => {
      const html = createChatPageHtml('/ws');
      expect(html).toMatch(/session-main/);
    });

    it('session-menu-btn click 事件调用 stopPropagation（防止触发 /resume）', async () => {
      const html = createChatPageHtml('/ws');
      // session-menu-btn 的 click 处理应包含 e.stopPropagation() 或 event.stopPropagation()
      expect(html).toMatch(/session-menu-btn[\s\S]*?stopPropagation/);
    });

    it('点击 session-menu-btn 后插入 session-menu（含重命名会话选项）', async () => {
      const html = createChatPageHtml('/ws');
      // 应有 session-menu 和 "重命名会话" 文本
      expect(html).toMatch(/session-menu/);
      expect(html).toMatch(/重命名会话/);
    });

    it('点击「重命名会话」后调用 startRenameSession 函数', async () => {
      const html = createChatPageHtml('/ws');
      expect(html).toMatch(/startRenameSession/);
    });

    it('startRenameSession 将 session-label 替换为 input（class=session-rename-input）', async () => {
      const html = createChatPageHtml('/ws');
      // startRenameSession 中应创建 input.session-rename-input
      expect(html).toMatch(/startRenameSession[\s\S]*?session-rename-input/);
    });

    it('input Enter 键触发 fetch POST /api/sessions/:id/label', async () => {
      const html = createChatPageHtml('/ws');
      // input keydown Enter 分支应调用 fetch POST 到 /label
      expect(html).toMatch(/Enter[\s\S]*?\/api\/sessions\/[^/]+\/label/);
    });

    it('input Escape 键恢复原 label 文本（不发请求）', async () => {
      const html = createChatPageHtml('/ws');
      // Escape 分支应恢复原 label（originalLabel）
      expect(html).toMatch(/Escape[\s\S]*?originalLabel/);
    });

    it('input blur 恢复原 label 文本（视为取消）', async () => {
      const html = createChatPageHtml('/ws');
      // blur 事件应恢复原 label
      expect(html).toMatch(/blur[\s\S]*?originalLabel/);
    });

    it('WS 消息处理中包含 session_renamed 分支', async () => {
      const html = createChatPageHtml('/ws');
      expect(html).toMatch(/session_renamed/);
      // 收到后应调用 loadSessionList
      expect(html).toMatch(/session_renamed[\s\S]*?loadSessionList/);
    });
  });
});
