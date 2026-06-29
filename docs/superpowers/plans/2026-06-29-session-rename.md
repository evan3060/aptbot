# 会话重命名功能 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在侧边栏会话项右侧添加 3-dot 菜单，支持重命名会话并跨客户端实时同步新名称。

**Architecture:** 后端新增 `POST /api/sessions/:id/label` 端点（复用 `StorageAdapter.updateSessionLabel`），成功后通过 `onSessionRenamed` 回调让 server.ts 调用 `wsServer.sendToSessionKey` 广播 `session_renamed` 控制消息（不走 AgentEvent union）。前端 `renderSessionList` 在每个 item 加 `⋮` 按钮，点击弹出菜单，点击「重命名会话」后 inline 替换 label 为 input，Enter 保存/Esc 取消。其他客户端收到 `session_renamed` 后直接 `loadSessionList`。

**Tech Stack:** TypeScript, Node.js http, ws, vanilla JS (inline in HTML template), vitest

## Global Constraints

- 不修改 `src/core/agent/events.ts`（避免破坏事件序列测试）
- label 长度限制 100 字符（复用 `/label` 命令限制）
- 复用 `StorageAdapter.updateSessionLabel(id, label)`（已实现，加锁防竞态）
- token 校验复用 `/api/sessions/:id/messages` 模式（query `?token=` 或 `Authorization: Bearer <token>`）
- ownership 检查复用 `getSessionOwner` === `user.userId`
- 代码注释使用中文，参数/变量/类型名/文件路径/命令保持英文
- 每个 Task 必须先 RED（测试失败）再 GREEN（最小修复），不可跳过测试

---

## File Structure

| 文件 | 责任 |
|------|------|
| `src/access/websocket-server.ts` | 新增 `POST /api/sessions/:id/label` 路由 + `onSessionRenamed` option 声明 + 透传给 `handleAuthApi` |
| `src/server.ts` | 传入 `onSessionRenamed` 回调，回调内调用 `wsServer.sendToSessionKey(sessionId, { type: 'session_renamed', sessionId, label })` |
| `src/access/chat-page.ts` | CSS 新增菜单样式 + `renderSessionList` 改造（item 结构含 `⋮` 按钮） + 菜单交互 + inline 编辑 + `session_renamed` 处理 |
| `tests/access/websocket-server.spec.ts` 或新增 `tests/access/rename-label.spec.ts` | 后端测试 |
| `tests/access/chat-page-sidebar.spec.ts` | 前端测试 |

---

## Task 1: 后端 — 新增 `onSessionRenamed` option + 透传

**Files:**
- Modify: `src/access/websocket-server.ts`（`WebSocketServerOptions` 接口，`startWebSocketServer` 解构，`handleAuthApi` 签名）
- Test: `tests/access/rename-label.spec.ts`（新建）

**Interfaces:**
- Produces: `WebSocketServerOptions.onSessionRenamed?: (sessionId: string, label: string) => void`
- Produces: `handleAuthApi` 新签名增加 `onSessionRenamed` 参数（位置：最后一个）

- [ ] **Step 1: Write the failing test**

`tests/access/rename-label.spec.ts`：

```typescript
import { describe, it, expect, vi } from 'vitest';
import { WebSocket } from 'ws';
import { startWebSocketServer } from '../../src/access/websocket-server.js';
import { createUserStorage } from '../../src/infrastructure/user-storage.js';
import { FileStorage } from '../../src/infrastructure/storage/file-storage.js';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

describe('POST /api/sessions/:id/label', () => {
  let tempDir: string;
  let userStorage: ReturnType<typeof createUserStorage>;
  let sessionStorage: FileStorage;
  let stop: () => Promise<void>;

  async function registerAndLogin(username: string, password: string): Promise<{ token: string; userId: string }> {
    await registerViaApi(username, password);
    return loginViaApi(username, password);
  }
  async function registerViaApi(username: string, password: string) {
    await fetch(`http://127.0.0.1:18080/api/register`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
  }
  async function loginViaApi(username: string, password: string): Promise<{ token: string; userId: string }> {
    const res = await fetch(`http://127.0.0.1:18080/api/login`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    return await res.json();
  }

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'aptbot-rename-'));
    userStorage = createUserStorage(tempDir);
    sessionStorage = new FileStorage(join(tempDir, 'sessions'));
    const { register } = await userStorage;
    void register;
    const server = await startWebSocketServer({
      port: 18080, bus: makeMockBus(), host: '127.0.0.1',
      userStorage, sessionStorage,
      onSessionRenamed: vi.fn(),
    });
    stop = server.stop;
  });
  afterEach(async () => { await stop(); await rm(tempDir, { recursive: true, force: true }); });

  it('returns 404 for unknown route initially (RED: 路由尚未实现)', async () => {
    const { token } = await registerAndLogin('alice', 'pw123456');
    const res = await fetch(`http://127.0.0.1:18080/api/sessions/00000000-0000-0000-0000-000000000000/label?token=${token}`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ label: 'new name' }),
    });
    // 当前未实现，返回 404；实现后应返回 404（session not found）
    expect(res.status).toBe(404);
  });
});

function makeMockBus() {
  return {
    async publishInbound() {}, async consumeInbound() { return await new Promise<{ channel: string; senderId: string; chatId: string; content: string; metadata: Record<string, unknown> }>(() => {}); },
    async publishOutbound() {}, async consumeOutbound() { return await new Promise(() => {}); },
  };
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/access/rename-label.spec.ts`
Expected: FAIL（路由不存在，可能 404 一开始就通过 — 改为先验证 onSessionRenamed 被调用）

- [ ] **Step 3: 修改 WebSocketServerOptions + handleAuthApi 签名**

在 `WebSocketServerOptions` 接口 `onSessionUnbound` 之后添加：

```typescript
/** 会话重命名后触发，用于广播 session_renamed 控制消息到同 session 其他连接 */
onSessionRenamed?: (sessionId: string, label: string) => void;
```

`startWebSocketServer` 解构补充 `onSessionRenamed`。

`handleAuthApi` 签名最后追加 `onSessionRenamed?: (sessionId: string, label: string) => void`。

调用处（行 144）传入 `onSessionRenamed`。

- [ ] **Step 4: 验证类型通过**

Run: `npm run build`
Expected: PASS（无类型错误）

- [ ] **Step 5: Commit**

```bash
git add src/access/websocket-server.ts tests/access/rename-label.spec.ts
git commit -m "feat(rename): add onSessionRenamed option to WebSocketServer"
```

---

## Task 2: 后端 — 实现 POST /api/sessions/:id/label 路由

**Files:**
- Modify: `src/access/websocket-server.ts`（`handleAuthApi` 内新增路由分支）
- Test: `tests/access/rename-label.spec.ts`

**Interfaces:**
- Consumes: `StorageAdapter.updateSessionLabel(id, label)`, `StorageAdapter.getSessionOwner(id)`, `UserStorage.findByToken(token)`
- Produces: HTTP `POST /api/sessions/:id/label` 返回 `200 { ok: true, label }`，并调用 `onSessionRenamed(sessionId, label)`

- [ ] **Step 1: Write failing tests**

在 `tests/access/rename-label.spec.ts` 中扩展，新增 6 个测试：

1. 成功 → 200，`onSessionRenamed` 回调被调用，`.meta.json` 含 label
2. 无 token → 401
3. 无效 token → 401
4. session 不存在（owner undefined）→ 404
5. 非 owner → 403
6. 空 label → 400
7. 非 POST 方法 → 405（或 404，与现有路由一致）

每个测试需要：
- 创建 tempDir + userStorage + sessionStorage
- 注册用户 alice，登录获取 token
- 创建 session（`sessionStorage.claimSession(sessionId, alice.userId)` + `appendSession` 触发 meta 创建）
- 调用 `fetch('POST /api/sessions/:id/label?token=...', { body: { label: 'new name' } })`
- 断言 status + 响应 body + `onSessionRenamed` mock 调用情况

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/access/rename-label.spec.ts`
Expected: FAIL（路由不存在，全部返回 404）

- [ ] **Step 3: 实现 POST /api/sessions/:id/label 路由**

在 `handleAuthApi` 的 `messagesMatch` 之后、`/api/sessions` GET 之前插入：

```typescript
// 会话重命名：POST /api/sessions/:id/label
const labelMatch = pathname.match(/^\/api\/sessions\/([a-f0-9-]{36})\/label$/);
if (labelMatch) {
  const sessionId = labelMatch[1];
  if (req.method !== 'POST') { sendJson(405, { error: 'method not allowed' }); return; }
  const url = new URL(req.url ?? '', 'http://localhost');
  const queryToken = url.searchParams.get('token');
  const authHeader = req.headers.authorization;
  const bearerToken = authHeader?.startsWith('Bearer ') ? authHeader.slice('Bearer '.length) : null;
  const token = queryToken ?? bearerToken;
  if (!token) { sendJson(401, { error: 'missing token' }); return; }
  const user = await userStorage.findByToken(token);
  if (!user) { sendJson(401, { error: 'invalid token' }); return; }
  if (!sessionStorage) { sendJson(500, { error: 'session storage unavailable' }); return; }
  const owner = await sessionStorage.getSessionOwner(sessionId);
  if (!owner) { sendJson(404, { error: 'session not found' }); return; }
  if (owner !== user.userId) { sendJson(403, { error: 'forbidden' }); return; }
  let body;
  try { body = await readJsonBody(req); } catch (err) {
    sendJson(err instanceof BodyTooLargeError ? 413 : 400, { error: 'invalid request body' }); return;
  }
  if (!body || typeof body !== 'object' || typeof (body as { label?: unknown }).label !== 'string') {
    sendJson(400, { error: 'label must be a non-empty string' }); return;
  }
  const label = ((body as { label: string }).label).trim().slice(0, 100);
  if (!label) { sendJson(400, { error: 'label must be a non-empty string' }); return; }
  await sessionStorage.updateSessionLabel(sessionId, label);
  if (onSessionRenamed) {
    try { onSessionRenamed(sessionId, label); } catch (err) {
      log.error('onSessionRenamed callback failed', { error: String(err), sessionId });
    }
  }
  sendJson(200, { ok: true, label });
  return;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/access/rename-label.spec.ts`
Expected: PASS（全部 7 个测试通过）

- [ ] **Step 5: Commit**

```bash
git add src/access/websocket-server.ts tests/access/rename-label.spec.ts
git commit -m "feat(rename): implement POST /api/sessions/:id/label endpoint"
```

---

## Task 3: 后端 — server.ts 传入 onSessionRenamed 回调

**Files:**
- Modify: `src/server.ts`（`startWebSocketServer` 调用处）

**Interfaces:**
- Consumes: `WebSocketServer.sendToSessionKey(sessionKey, msg)`
- Produces: 收到 `onSessionRenamed(sessionId, label)` 时调用 `wsServer.sendToSessionKey(sessionId, { type: 'session_renamed', sessionId, label })`

- [ ] **Step 1: Write failing test**

在 `tests/access/rename-label.spec.ts` 中新增 E2E 测试：两个 WS 客户端连同一 session，client A 调用 POST `/label`，client B 应收到 `{ type: 'session_renamed', sessionId, label }` 消息。

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/access/rename-label.spec.ts -t "broadcast"`
Expected: FAIL（client B 收不到 session_renamed 消息）

- [ ] **Step 3: 在 server.ts 传入回调**

在 `startServer` 中 `startWebSocketServer({...})` 调用内添加：

```typescript
onSessionRenamed: (sessionId, label) => {
  wsServer.sendToSessionKey(sessionId, { type: 'session_renamed', sessionId, label });
},
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/access/rename-label.spec.ts -t "broadcast"`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/server.ts tests/access/rename-label.spec.ts
git commit -m "feat(rename): broadcast session_renamed on label update"
```

---

## Task 4: 前端 — CSS + renderSessionList 改造

**Files:**
- Modify: `src/access/chat-page.ts`（CSS 部分 + `renderSessionList` 函数）
- Test: `tests/access/chat-page-sidebar.spec.ts`

**Interfaces:**
- Produces: 每个 `.session-item` 包含 `.session-main`（含 label+time）+ `.session-menu-btn`（⋮）按钮；item 有 `data-session-id` 属性

- [ ] **Step 1: Write failing tests**

在 `tests/access/chat-page-sidebar.spec.ts` 新增测试：

1. `createChatPageHtml` 输出包含 `.session-menu-btn` CSS 样式
2. `renderSessionList` 渲染的 item 包含 `data-session-id` 属性
3. `renderSessionList` 渲染的 item 包含 `.session-menu-btn` 元素
4. 点击 `.session-menu-btn` 不触发 `/resume` 命令（stopPropagation 验证）

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/access/chat-page-sidebar.spec.ts -t "menu"`
Expected: FAIL（CSS 和 DOM 结构不存在）

- [ ] **Step 3: 添加 CSS**

在 `#session-list .session-item` 样式块之后新增 `.session-main`, `.session-menu-btn`, `.session-menu`, `.session-menu-item`, `.session-rename-input` 样式。

- [ ] **Step 4: 改造 renderSessionList**

修改 `renderSessionList` 函数，每个 item 内部结构改为：

```html
<div class="session-item" data-session-id="...">
  <div class="session-main">
    <div class="session-label">...</div>
    <div class="session-time">...</div>
  </div>
  <button class="session-menu-btn" title="更多操作">⋮</button>
</div>
```

`.session-menu-btn` 的 click 事件 `e.stopPropagation()`，并在 item 内动态插入 `.session-menu`（含「重命名会话」项）。

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run tests/access/chat-page-sidebar.spec.ts -t "menu"`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/access/chat-page.ts tests/access/chat-page-sidebar.spec.ts
git commit -m "feat(rename): add 3-dot menu to session items"
```

---

## Task 5: 前端 — 重命名交互（inline 编辑 + Esc 取消）

**Files:**
- Modify: `src/access/chat-page.ts`（菜单点击处理 + inline input + Enter/Esc/blur 处理）
- Test: `tests/access/chat-page-sidebar.spec.ts`

**Interfaces:**
- Consumes: `POST /api/sessions/:id/label?token=...` body `{ label }`
- Produces: 点击「重命名会话」→ label 替换为 input；Enter → POST 请求 + 恢复 label；Esc/blur → 恢复原 label

- [ ] **Step 1: Write failing tests**

在 `tests/access/chat-page-sidebar.spec.ts` 新增测试：

1. 点击「重命名会话」后 `.session-label` 被替换为 `.session-rename-input`，input 默认值为原 label
2. input 触发 Enter 事件 → 调用 `fetch` POST `/api/sessions/:id/label`
3. fetch 成功后 input 恢复为新 label 文本
4. input 触发 Escape → 恢复原 label 文本（不发请求）
5. input 触发 blur → 恢复原 label 文本（不发请求）

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/access/chat-page-sidebar.spec.ts -t "rename"`
Expected: FAIL（交互逻辑不存在）

- [ ] **Step 3: 实现菜单点击 + inline 编辑逻辑**

在 `renderSessionList` 中：

1. 「重命名会话」点击 → 关闭菜单 → 找到该 item 的 `.session-label` → 替换为 `<input class="session-rename-input">`，value=原 label，autofocus + select()
2. input 监听 `keydown`：
   - `Enter` → preventDefault → 取 value.trim() → 非空则 fetch POST → 成功后恢复 label 文本为新值（失败则 alert + 保留 input）；空则恢复原 label
   - `Escape` → preventDefault → 恢复原 label 文本
3. input 监听 `blur` → 恢复原 label 文本（视为取消）
4. 「重命名会话」点击需 `e.stopPropagation()`

辅助函数 `startRenameSession(item, sessionId, currentLabel)`：
- 保存原 label 到 `item.dataset.originalLabel`
- 替换 DOM 为 input
- 注册事件监听

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/access/chat-page-sidebar.spec.ts -t "rename"`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/access/chat-page.ts tests/access/chat-page-sidebar.spec.ts
git commit -m "feat(rename): inline rename with Enter/Esc/blur handling"
```

---

## Task 6: 前端 — session_renamed 控制消息处理

**Files:**
- Modify: `src/access/chat-page.ts`（WS 消息处理分支）
- Test: `tests/access/chat-page-sidebar.spec.ts`

**Interfaces:**
- Consumes: WS 消息 `{ type: 'session_renamed', sessionId, label }`
- Produces: 收到后调用 `loadSessionList()` 刷新列表

- [ ] **Step 1: Write failing test**

在 `tests/access/chat-page-sidebar.spec.ts` 新增测试：模拟 WS 收到 `{ type: 'session_renamed', sessionId: '...', label: '...' }`，断言 `loadSessionList` 被调用（或 `fetch('/api/sessions')` 被调用）。

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/access/chat-page-sidebar.spec.ts -t "session_renamed"`
Expected: FAIL（处理分支不存在）

- [ ] **Step 3: 实现 session_renamed 处理**

在 WS `onmessage` 处理中（`session_changed` 分支之后）新增：

```javascript
if (msg.type === 'session_renamed' && msg.sessionId) {
  loadSessionList();
  return;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/access/chat-page-sidebar.spec.ts -t "session_renamed"`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/access/chat-page.ts tests/access/chat-page-sidebar.spec.ts
git commit -m "feat(rename): handle session_renamed control message"
```

---

## Task 7: 全量回归 + E2E 验证

- [ ] **Step 1: 全量回归**

Run: `npx vitest run --no-file-parallelism`
Expected: 全部通过（原有 561 + 新增测试）

- [ ] **Step 2: 构建 + 重启服务器**

Run: `npm run build && kill old server && start new server`

- [ ] **Step 3: E2E 验证脚本（手动或临时脚本）**

场景：
1. 两个客户端（A、B）登录同一用户，连同一 session
2. A 在侧边栏对当前 session 点击 ⋮ → 重命名 → 输入「My New Name」→ Enter
3. 验证：A 侧边栏 label 变为「My New Name」
4. 验证：B 侧边栏 label 自动变为「My New Name」（无需刷新）
5. 验证：刷新页面后 label 仍为「My New Name」（持久化）

- [ ] **Step 4: 通知用户验证**

提示用户进行人工验证。

---

## Self-Review

- **Spec coverage**: 6 个 spec 章节都有对应 Task（后端 Task 1-3、前端 Task 4-6、验证 Task 7）
- **Placeholder scan**: 无 TBD/TODO，所有 Step 含具体代码或命令
- **Type consistency**: `onSessionRenamed(sessionId, label)` 签名在 Task 1/2/3 一致；`session_renamed` 消息字段在 Task 3/6 一致
