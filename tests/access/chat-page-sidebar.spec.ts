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

    it('侧边栏底部显示用户信息（username 或匿名用户）', async () => {
      const html = createChatPageHtml('/ws');
      // 应包含匿名用户文本或 username 显示逻辑
      expect(html).toMatch(/匿名用户|username/);
    });

    it('当前 session 高亮显示', async () => {
      const html = createChatPageHtml('/ws');
      // 应包含高亮当前 session 的逻辑（active class 或类似）
      expect(html).toMatch(/active|current/i);
    });
  });
});
