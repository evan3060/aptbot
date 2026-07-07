# React WebUI 重设计实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 用 React 19 + Vite + Tailwind v4 重写 aptbot WebUI，采用 aistudio-design 目录中的极简黑白灰高对比度视觉设计，接入现有 aptbot 后端（WebSocket 流式 + token 认证 + Agent + Session + Slash 命令 + 工具调用），最终通过 Playwright UAT 验收并替换 /demo 路由。

**Architecture:** 前端代码位于 `src/webui-react/`，用 Vite 构建到 `dist/webui/`（多 chunk：index.html + assets/*.js + assets/*.css）。Server 端扩展 websocket-server.ts 静态资源路由以服务 `/webui/assets/*`，保持 `/demo` 路由返回 Vite 构建的 index.html。前端通过 WebSocket 与后端通信（流式响应、事件分发、ring buffer resync），通过 fetch 调用 REST API（认证、agent 管理、session 管理）。保留 aistudio-design 的 Hanken Grotesk 字体、极简黑白灰设计、消息靠右/靠左布局、快捷指令栏、Agent 模态框等视觉特征。

**Tech Stack:** React 19, Vite 6, Tailwind CSS v4 (`@tailwindcss/vite`), lucide-react, framer-motion (`motion`), TypeScript。后端保持现有 Node.js + ws + JSONL 不变。

## Global Constraints

- 前端代码位置：`src/webui-react/`（与现有 `src/webui/` Lit 代码并存，不删除 Lit 代码作为回滚备份）
- 构建输出：`dist/webui/`（Vite 多 chunk 输出，覆盖现有 esbuild 单文件 bundle）
- 构建命令：`npm run webui:build` 调用 Vite，`npm run webui:watch` 调用 Vite watch 模式
- 路由约定：`/demo` 返回 WebUI HTML；`/webui/assets/*` 返回 Vite 构建的静态资源（JS/CSS/字体/图片）；`/webui/index.js` 保留兼容（重定向到 hashed bundle 或保留 entry chunk）
- 认证：token 通过 HttpOnly cookie 自动传递（fetch 需 `credentials: 'include'`），WebSocket URL 使用 `?token=` query 参数（cookie 不可用时 fallback）
- WebSocket URL：`ws(s)://<host>/ws?token=<token>&session=<sessionId>&lastEventSeq=<seq>`
- Agent 标识：使用 slug（如 `default`, `python-pro`），不是 id；predefined agents 由后端 `ensureDefaultAgent` 自动创建
- Session 管理：服务端 JSONL 持久化，前端不使用 localStorage 存储会话/消息（仅缓存 token 和 sessionId）
- 消息对齐：user 消息靠右（`ml-auto items-end`），assistant 消息靠左（`items-start`），保持 0.2.3 风格
- 流式响应：通过 WebSocket `message_delta` 事件增量更新 assistant 消息文本
- Slash 命令：以 `/` 开头的消息通过 WebSocket 发送（不经过 agent LLM），由 server 端 `CommandRegistry` 处理
- 字体：Hanken Grotesk（正文）+ JetBrains Mono（代码），通过 Google Fonts CDN 加载
- 色彩：黑白灰为主（`bg-white` / `text-black` / `text-neutral-*` / `border-slate-200`），无彩色主题
- Playwright UAT：覆盖注册/登录、发消息、流式响应、新建会话、切换会话、新建 agent、编辑 agent、删除会话

## File Structure

### 前端源码（`src/webui-react/`）

- `src/webui-react/index.html` — Vite HTML 入口，引用 `/src/main.tsx`，包含 `#root` 挂载点
- `src/webui-react/main.tsx` — React 挂载入口，`createRoot(document.getElementById('root')).render(<App />)`
- `src/webui-react/App.tsx` — 顶层组件，管理全局状态（auth、agents、sessions、messages、ws 连接），组合 Sidebar + ChatArea + InputArea + Modals
- `src/webui-react/vite.config.ts` — Vite 配置：React 插件 + Tailwind v4 插件 + 构建输出到 `dist/webui/` + `base: '/webui/'`（资源路径前缀）
- `src/webui-react/tsconfig.json` — TypeScript 配置，`jsx: react-jsx`，`moduleResolution: bundler`
- `src/webui-react/types.ts` — 共享类型定义（Agent、Session、Message、ModelOption、AttachedFile、WsEvent）
- `src/webui-react/index.css` — Tailwind v4 入口 + Google Fonts import + 自定义 scrollbar + 动画 keyframes
- `src/webui-react/lib/auth.ts` — 认证控制器：token 读写（sessionStorage fallback）、register/login/logout/me API 调用
- `src/webui-react/lib/ws-client.ts` — WebSocket 客户端：连接管理、重连、心跳、ring buffer seq 追踪、事件分发
- `src/webui-react/lib/api.ts` — REST API 封装：agents CRUD、sessions CRUD、bootstrap、统一 fetch + credentials
- `src/webui-react/lib/reducer.ts` — UI 状态 reducer（messages 增量更新、tool calls、working 状态）
- `src/webui-react/lib/markdown.ts` — 轻量 Markdown 解析（代码块、加粗、行内代码、换行）
- `src/webui-react/components/Sidebar.tsx` — 左侧栏：logo + 新会话按钮 + 通用 agent 区 + 专用 agent 区 + 用户卡片
- `src/webui-react/components/ChatArea.tsx` — 消息区：空状态欢迎卡 + 消息列表 + Markdown 渲染 + 流式占位
- `src/webui-react/components/InputArea.tsx` — 输入区：快捷指令栏 + 文件附件 + textarea + 发送按钮 + agent/model 选择
- `src/webui-react/components/AgentModals.tsx` — 新建/编辑 agent 模态框
- `src/webui-react/components/AuthModal.tsx` — 登录/注册模态框（调用后端 /api/register + /api/login）
- `src/webui-react/components/ToolCallView.tsx` — 工具调用展示（tool_call_start → delta → result）
- `src/webui-react/components/MemoryToast.tsx` — 记忆写入 toast 提示
- `src/webui-react/components/MessageActions.tsx` — assistant 消息悬浮操作栏（复制、重新生成）

### 后端修改

- `scripts/build-webui.mjs`（修改）— 改为调用 Vite 构建到 `dist/webui/`
- `src/access/websocket-server.ts`（修改）— 扩展静态资源路由：`/webui/assets/*` 通配服务 Vite 构产的 hashed chunks
- `src/server.ts`（修改）— `webuiHtmlPath` 计算逻辑适配 Vite 输出的 `dist/webui/index.html`；`webuiBundlePath` 保留兼容
- `package.json`（修改）— 新增 devDependencies：`@tailwindcss/vite`、`@vitejs/plugin-react`、`tailwindcss`、`lucide-react`、`motion`、`vite`；`webui:build` 脚本改为 `vite build --config src/webui-react/vite.config.ts`

### 测试与 UAT

- `tests/webui-react/auth.test.ts` — 认证模块单元测试
- `tests/webui-react/ws-client.test.ts` — WebSocket 客户端单元测试（mock ws）
- `tests/webui-react/reducer.test.ts` — UI reducer 单元测试
- `tests/webui-react/markdown.test.ts` — Markdown 解析单元测试
- `tests/uat/react-webui-uat.spec.ts` — Playwright E2E 验收测试

---

## Task 1: Vite 构建基础设施 + 静态资源路由扩展

**Files:**
- Create: `src/webui-react/index.html`
- Create: `src/webui-react/main.tsx`
- Create: `src/webui-react/vite.config.ts`
- Create: `src/webui-react/tsconfig.json`
- Create: `src/webui-react/index.css`
- Modify: `scripts/build-webui.mjs`
- Modify: `src/access/websocket-server.ts`
- Modify: `src/server.ts`
- Modify: `package.json`
- Test: `tests/webui-react/vite-build.test.ts`

**Interfaces:**
- Produces: `npm run webui:build` 命令可成功构建 Vite 产物到 `dist/webui/`，包含 `index.html` + `assets/index-[hash].js` + `assets/index-[hash].css`
- Produces: `/demo` 路由返回 Vite 构建的 HTML，`/webui/assets/*` 路由返回静态资源

- [ ] **Step 1: 安装前端依赖**

运行：`npm install -D @tailwindcss/vite @vitejs/plugin-react tailwindcss vite && npm install lucide-react motion`

- [ ] **Step 2: 创建 Vite 配置**

创建 `src/webui-react/vite.config.ts`：配置 React + Tailwind 插件，`build.outDir` 指向 `../../dist/webui`，`build.emptyOutDir: true`，`base: '/webui/'`。

- [ ] **Step 3: 创建 HTML 入口和 main.tsx**

`index.html` 包含 `#root` 和 `<script type="module" src="/src/main.tsx">`。`main.tsx` 暂时渲染一个占位 `<h1>aptbot WebUI</h1>`，后续 Task 9 替换为 `<App />`。

- [ ] **Step 4: 创建 index.css**

`@import "tailwindcss"` + Google Fonts import（Hanken Grotesk + JetBrains Mono）+ 自定义 scrollbar 样式 + slideIn 动画。

- [ ] **Step 5: 修改 build-webui.mjs 调用 Vite**

将 `scripts/build-webui.mjs` 改为 `import { build } from 'vite'` + `await build({ configFile: 'src/webui-react/vite.config.ts' })`。保留 `--watch` 模式（`build({ watch: true })`）。

- [ ] **Step 6: 扩展 websocket-server.ts 静态资源路由**

在 `/webui/index.js` 路由之后新增 `/webui/assets/*` 通配路由：读取 `dist/webui/assets/` 下的文件，按扩展名设置 content-type（`.js` → `text/javascript`，`.css` → `text/css`，`.woff2` → `font/woff2` 等），附带 `cache-control: public, max-age=31536000, immutable`（Vite 产物使用 content hash，可长期缓存）。

- [ ] **Step 7: 适配 server.ts 路径计算**

`webuiHtmlPath` 优先检查 `dist/webui/index.html`（Vite 输出），保留 `src/webui/index.html`（旧 Lit）作为 fallback。`webuiBundlePath` 保留指向 `dist/webui/index.js`（如存在）。

- [ ] **Step 8: 修改 package.json scripts**

`webui:build` 改为 `node scripts/build-webui.mjs`（保持不变，脚本内部改为调用 Vite）。新增 `webui:dev` 脚本：`vite --config src/webui-react/vite.config.ts`（开发模式，Vite dev server + HMR）。

- [ ] **Step 9: 验证构建**

运行：`npm run webui:build`
预期：`dist/webui/` 包含 `index.html` + `assets/` 目录

- [ ] **Step 10: 验证路由**

启动 server，访问 `http://localhost:8080/demo`
预期：看到占位 `<h1>aptbot WebUI</h1>`，浏览器 console 无 404 错误

- [ ] **Step 11: 提交**

```bash
git add src/webui-react/ scripts/build-webui.mjs src/access/websocket-server.ts src/server.ts package.json
git commit -m "feat(webui-react): Task 1 — Vite build infra + static asset routing"
```

---

## Task 2: 认证模块 + Token 管理 + AuthModal

**Files:**
- Create: `src/webui-react/lib/auth.ts`
- Create: `src/webui-react/components/AuthModal.tsx`
- Modify: `src/webui-react/types.ts`（添加 AuthUser 类型）
- Test: `tests/webui-react/auth.test.ts`

**Interfaces:**
- Consumes: `POST /api/register { username, password } → { userId, username, token }`；`POST /api/login { username, password } → { userId, username, token }`；`POST /api/logout`；`GET /api/me → { userId, username }`
- Produces: `AuthController` 类（`token: string | null`、`userId: string | null`、`username: string | null`、`isLoggedIn: boolean`、`login(username, password)`、`register(username, password)`、`logout()`、`fetchMe()`）；`<AuthModal>` 组件（props: `isOpen`, `onClose`, `onLoginSuccess`）

- [ ] **Step 1: 定义 AuthUser 类型**

`src/webui-react/types.ts` 新增 `AuthUser { userId: string; username: string }` 和 `AuthState { user: AuthUser | null; token: string | null }`。

- [ ] **Step 2: 编写 auth.ts 失败测试**

`tests/webui-react/auth.test.ts`：mock `fetch`，测试 `login` 成功时存储 token 到 sessionStorage、失败时抛错；测试 `logout` 清除 token；测试 `fetchMe` 无 token 时返回 null。

- [ ] **Step 3: 运行测试验证失败**

运行：`npx vitest run tests/webui-react/auth.test.ts`
预期：FAIL（auth.ts 未创建）

- [ ] **Step 4: 实现 AuthController**

`src/webui-react/lib/auth.ts`：封装 fetch 调用 `/api/register`、`/api/login`、`/api/logout`、`/api/me`。所有 fetch 附带 `credentials: 'include'`。token 存储在 sessionStorage（key: `aptbot:token`），因为 HttpOnly cookie 无法被 JS 读取，但 sessionStorage 用于 WebSocket URL 传递。登录成功后不手动存 token（依赖 cookie），但保留 token 副本用于 WS URL 构建。

- [ ] **Step 5: 运行测试验证通过**

运行：`npx vitest run tests/webui-react/auth.test.ts`
预期：PASS

- [ ] **Step 6: 实现 AuthModal 组件**

`src/webui-react/components/AuthModal.tsx`：迁移 aistudio-design 的 AuthModal，但将 `getUsers`/`localStorage` 逻辑替换为调用 `AuthController.login` / `AuthController.register`。保留双模式（login/register）UI、错误提示、成功提示。登录成功后调用 `onLoginSuccess(username)` 回调。

- [ ] **Step 7: 提交**

```bash
git add src/webui-react/lib/auth.ts src/webui-react/components/AuthModal.tsx src/webui-react/types.ts tests/webui-react/auth.test.ts
git commit -m "feat(webui-react): Task 2 — auth module + AuthModal"
```

---

## Task 3: WebSocket 客户端 + 事件分发 + Ring Buffer Resync

**Files:**
- Create: `src/webui-react/lib/ws-client.ts`
- Create: `src/webui-react/lib/reducer.ts`
- Modify: `src/webui-react/types.ts`（添加 WsMessage、AgentEvent 类型）
- Test: `tests/webui-react/ws-client.test.ts`
- Test: `tests/webui-react/reducer.test.ts`

**Interfaces:**
- Consumes: WebSocket URL `ws(s)://<host>/ws?token=<token>&session=<sessionId>&lastEventSeq=<seq>`
- Consumes: 服务端消息 `{ type: 'event', seq, event: AgentEvent }`、`{ type: 'user_identified', userId, sessionId }`、`{ type: 'error', code, message }`、`{ type: 'presence', onlineCount }`、`{ type: 'replay', messages }`、`{ type: 'resync_required' }`、`{ type: 'session_changed', sessionId }`、`{ type: 'session_renamed', sessionId, label }`、`{ type: 'session_deleted', sessionId }`
- Produces: `WsClient` 类（`connect(token, sessionId)`、`send(content)`、`sendSlash(cmd)`、`close()`、`on(event, handler)`、`lastEventSeq`）；`uiReducer(state, action)` 返回新状态

- [ ] **Step 1: 定义 WsMessage 和 AgentEvent 类型**

`types.ts` 新增 `AgentEventType` 联合类型（`agent_start | turn_start | turn_busy | user_message | message_start | message_delta | reasoning_delta | tool_call_start | tool_call_delta | tool_call_end | tool_result | message_end | turn_end | agent_end | error`）和 `WsServerMessage` 联合类型。

- [ ] **Step 2: 编写 ws-client 失败测试**

`tests/webui-react/ws-client.test.ts`：mock WebSocket，测试 `connect` 成功建立连接、`send` 发送 `{ type: 'message', content }`、`sendSlash` 发送 `/new` 等、收到 `{ type: 'event', seq: 1, event: { type: 'message_delta', text: 'Hi' } }` 时更新 `lastEventSeq` 并触发 handler。

- [ ] **Step 3: 运行测试验证失败**

运行：`npx vitest run tests/webui-react/ws-client.test.ts`
预期：FAIL

- [ ] **Step 4: 实现 WsClient**

`ws-client.ts`：管理 WebSocket 连接生命周期。`connect(token, sessionId)` 构建 URL 并 `new WebSocket(url)`。`onmessage` 解析 JSON，按 `type` 分发：`event` → 更新 `lastEventSeq` + 调用 `on('event', handler)`；`user_identified` → 调用 `on('user_identified')`；`session_changed` → 调用 `on('session_changed')` 并自动重连；`error` → 调用 `on('error')`；`resync_required` → 重置 `lastEventSeq=0` 并重连。`send(content)` 发送 `{ type: 'message', content }`。自动重连：连接断开时 3 秒后重连（指数退避，最大 30 秒）。

- [ ] **Step 5: 运行测试验证通过**

运行：`npx vitest run tests/webui-react/ws-client.test.ts`
预期：PASS

- [ ] **Step 6: 编写 reducer 失败测试**

`tests/webui-react/reducer.test.ts`：测试 `message_start` 创建空消息、`message_delta` 追加文本、`message_end` 标记完成、`tool_call_start` 创建工具调用、`tool_result` 更新结果、`turn_start`/`turn_end` 切换 working 状态。

- [ ] **Step 7: 运行测试验证失败**

运行：`npx vitest run tests/webui-react/reducer.test.ts`
预期：FAIL

- [ ] **Step 8: 实现 uiReducer**

`reducer.ts`：状态结构 `{ messages: Message[]; toolCalls: Map<string, ToolCall>; isWorking: boolean; currentTurnId: string | null }`。处理 `agent_start`/`turn_start` → `isWorking=true`；`message_start` → 新建 assistant 消息（空文本）；`message_delta` → 找到最后一条 assistant 消息追加文本；`message_end` → 标记完成；`tool_call_start` → 新建 ToolCall；`tool_call_delta` → 追加参数；`tool_result` → 设置结果；`turn_end`/`agent_end` → `isWorking=false`；`clear` → 清空消息。**关键**：消息更新采用不可变数组（`map` 替换目标消息对象），确保 React re-render。

- [ ] **Step 9: 运行测试验证通过**

运行：`npx vitest run tests/webui-react/reducer.test.ts`
预期：PASS

- [ ] **Step 10: 提交**

```bash
git add src/webui-react/lib/ws-client.ts src/webui-react/lib/reducer.ts src/webui-react/types.ts tests/webui-react/ws-client.test.ts tests/webui-react/reducer.test.ts
git commit -m "feat(webui-react): Task 3 — WebSocket client + UI reducer"
```

---

## Task 4: Sidebar + Agent 列表 + Session 列表 + Bootstrap

**Files:**
- Create: `src/webui-react/lib/api.ts`
- Create: `src/webui-react/components/Sidebar.tsx`
- Modify: `src/webui-react/types.ts`（添加 AgentProfile、SessionMetadata）
- Test: `tests/webui-react/api.test.ts`

**Interfaces:**
- Consumes: `GET /api/webui-bootstrap → { agents, sessions, visibleSkills, skills, currentAgentSlug, currentSessionId, model }`；`GET /api/agents`；`GET /api/sessions`；`DELETE /api/sessions/:id`；`POST /api/sessions/:id/label`
- Produces: `api` 对象（`bootstrap()`、`listAgents()`、`listSessions()`、`deleteSession(id)`、`renameSession(id, label)`、`createAgent(data)`、`updateAgent(slug, data)`、`deleteAgent(slug)`）；`<Sidebar>` 组件

- [ ] **Step 1: 定义 AgentProfile 和 SessionMetadata 类型**

`types.ts` 新增 `AgentProfile { slug: string; name: string; description: string; personality: string; iconName: string; isCustom: boolean; memoryEnabled?: boolean; predefinedPrompts?: { label: string; text: string }[] }` 和 `SessionMetadata { id: string; agentId: string; label?: string; preview?: string; updatedAt: number }`。注意后端用 `slug` 而非 `id`。

- [ ] **Step 2: 编写 api.ts 失败测试**

`tests/webui-react/api.test.ts`：mock fetch，测试 `bootstrap()` 返回数据、`deleteSession(id)` 调用 DELETE、`createAgent` 调用 POST。

- [ ] **Step 3: 运行测试验证失败**

运行：`npx vitest run tests/webui-react/api.test.ts`
预期：FAIL

- [ ] **Step 4: 实现 api.ts**

`api.ts`：封装所有 REST API 调用。`fetchBootstrap()` 调用 `GET /api/webui-bootstrap`。`listAgents()` 调用 `GET /api/agents`。`listSessions()` 调用 `GET /api/sessions`。`deleteSession(id)` 调用 `DELETE /api/sessions/:id`。`createAgent(data)` 调用 `POST /api/agents`。`updateAgent(slug, data)` 调用 `PUT /api/agents/:slug`。`deleteAgent(slug)` 调用 `DELETE /api/agents/:slug`。所有调用 `credentials: 'include'`。

- [ ] **Step 5: 运行测试验证通过**

运行：`npx vitest run tests/webui-react/api.test.ts`
预期：PASS

- [ ] **Step 6: 实现 Sidebar 组件**

`Sidebar.tsx`：迁移 aistudio-design 的 Sidebar，做以下适配：
1. Agent 标识从 `id` 改为 `slug`（`activeAgentSlug` 替代 `activeAgentId`）
2. Session 列表来自 `GET /api/sessions`（server-side 持久化），而非 localStorage
3. 点击会话项调用 `onSelectSession(sessionId)` → 触发 `/resume <id>` slash 命令
4. 新会话按钮调用 `onCreateSession()` → 触发 `/new` slash 命令
5. 删除会话调用 `api.deleteSession(id)` + 确认弹窗
6. 新建 agent 按钮调用 `onOpenCreateAgentModal()`
7. 用户卡片显示 `currentUser`（来自 auth），登出按钮调用 `auth.logout()`

- [ ] **Step 7: 手动验证 Sidebar 渲染**

在 App.tsx 临时使用 Sidebar，传入 mock agents/sessions，检查渲染
预期：Sidebar 正确显示 agent 列表、session 列表、用户卡片

- [ ] **Step 8: 提交**

```bash
git add src/webui-react/lib/api.ts src/webui-react/components/Sidebar.tsx src/webui-react/types.ts tests/webui-react/api.test.ts
git commit -m "feat(webui-react): Task 4 — Sidebar + API client + bootstrap"
```

---

## Task 5: ChatArea + 消息渲染 + Markdown + 流式 delta

**Files:**
- Create: `src/webui-react/lib/markdown.ts`
- Create: `src/webui-react/components/ChatArea.tsx`
- Create: `src/webui-react/components/MessageActions.tsx`
- Test: `tests/webui-react/markdown.test.ts`

**Interfaces:**
- Consumes: `Message[]`（来自 reducer state），每条消息 `{ id, role: 'user'|'assistant', content, timestamp?, modelUsed?, agentName?, files? }`
- Consumes: `isWorking: boolean`（reducer state，显示流式占位）
- Produces: `<ChatArea>` 组件（props: `messages`, `isWorking`, `activeAgent`, `onRegenerate`）

- [ ] **Step 1: 编写 markdown 失败测试**

`tests/webui-react/markdown.test.ts`：测试代码块解析（` ```python\nprint('hi')\n``` ` → `<pre><code>`）、加粗解析（`**bold**` → `<strong>`）、行内代码（`` `code` `` → `<code>`）、普通文本换行。

- [ ] **Step 2: 运行测试验证失败**

运行：`npx vitest run tests/webui-react/markdown.test.ts`
预期：FAIL

- [ ] **Step 3: 实现 markdown.ts**

`markdown.ts`：`renderMarkdown(content: string): React.ReactNode[]`。解析逻辑：先按 ` ``` ` 分割代码块，非代码段按 `\n` 分行，每行用正则匹配 `**bold**` 和 `` `code` ``。代码块带语言标签。返回 React 元素数组（不用 dangerouslySetInnerHTML，防 XSS）。

- [ ] **Step 4: 运行测试验证通过**

运行：`npx vitest run tests/webui-react/markdown.test.ts`
预期：PASS

- [ ] **Step 5: 实现 ChatArea 组件**

`ChatArea.tsx`：迁移 aistudio-design 的 ChatArea，做以下适配：
1. 消息对齐：user 靠右（`ml-auto items-end`），assistant 靠左（`items-start`）— 这是 0.2.3 的样式
2. `isWorking` 为 true 时，最后一条 assistant 消息显示流式光标（`animate-pulse`）
3. 空状态显示欢迎卡片 + agent 推荐指令
4. `renderFormattedContent` 调用 `markdown.ts` 的 `renderMarkdown`
5. 自动滚动到底部（`useEffect` + `scrollIntoView`）

- [ ] **Step 6: 实现 MessageActions 组件**

`MessageActions.tsx`：assistant 消息悬浮操作栏。复制按钮（`navigator.clipboard.writeText`）、重新生成按钮（调用 `onRegenerate(messageId)` → 发送 `/resume` 重新生成）。注意：当前后端不支持 `/regenerate`，暂时仅复制可用，重新生成按钮显示但提示"暂未支持"。

- [ ] **Step 7: 手动验证消息渲染**

在 App.tsx 临时传入 mock messages，检查 user/assistant 对齐、Markdown 渲染
预期：user 靠右、assistant 靠左、代码块正确高亮

- [ ] **Step 8: 提交**

```bash
git add src/webui-react/lib/markdown.ts src/webui-react/components/ChatArea.tsx src/webui-react/components/MessageActions.tsx tests/webui-react/markdown.test.ts
git commit -m "feat(webui-react): Task 5 — ChatArea + Markdown + streaming"
```

---

## Task 6: InputArea + 快捷指令 + Slash 命令 + 发送

**Files:**
- Create: `src/webui-react/components/InputArea.tsx`
- Modify: `src/webui-react/types.ts`（添加 ModelOption）

**Interfaces:**
- Consumes: `AgentProfile[]`（agent 列表）、`activeAgentSlug`、`selectedModel`、`ModelOption[]`、`onSendMessage(content, files?)`、`onSelectAgent(slug)`、`onSelectModel(model)`
- Produces: `<InputArea>` 组件，发送消息时区分普通消息和 slash 命令

- [ ] **Step 1: 实现 InputArea 组件**

`InputArea.tsx`：迁移 aistudio-design 的 InputArea，做以下适配：
1. 保留 16 个快捷指令按钮（仅在 general agent 时显示），点击时填充 textarea
2. 发送逻辑：`onSendMessage(content)` 由 App 决定走 WebSocket `send` 还是 `sendSlash`
3. Agent 选择下拉框使用 `slug` 而非 `id`
4. Model 选择下拉框：模型列表来自 bootstrap 的 `model`（单一默认模型，下拉仅显示当前选中）
5. 思考深度下拉框保留 UI，但后端暂未支持，仅前端状态
6. 文件附件：保留 UI，但后端暂未支持文件上传，提示"文件附件功能开发中"
7. 上下文 token 显示保留（mock 计算）

- [ ] **Step 2: 实现发送逻辑**

`handleSend`：trim 后的文本以 `/` 开头时调用 `onSendSlash(content)`，否则调用 `onSendMessage(content)`。清空 textarea 和附件。

- [ ] **Step 3: 手动验证发送**

在 App.tsx 临时 wire up `onSendMessage` 和 `onSendSlash`，检查 console 输出
预期：输入 `/new` 时走 slash 路径，输入普通文本时走 message 路径

- [ ] **Step 4: 提交**

```bash
git add src/webui-react/components/InputArea.tsx src/webui-react/types.ts
git commit -m "feat(webui-react): Task 6 — InputArea + quick actions + slash"
```

---

## Task 7: AgentModals + 新建/编辑 agent + 调用 /api/agents

**Files:**
- Create: `src/webui-react/components/AgentModals.tsx`
- Modify: `src/webui-react/lib/api.ts`（确保 createAgent/updateAgent/deleteAgent 已实现）

**Interfaces:**
- Consumes: `api.createAgent({ name, description, personality, iconName }) → AgentProfile`；`api.updateAgent(slug, data)`；`api.deleteAgent(slug)`
- Produces: `<AgentModals>` 组件（props: `isCreateOpen`, `isEditOpen`, `editingAgent`, `onCloseCreate`, `onCloseEdit`, `onSaved`）

- [ ] **Step 1: 实现 AgentModals 组件**

`AgentModals.tsx`：迁移 aistudio-design 的 AgentModals，做以下适配：
1. 新建 agent：调用 `api.createAgent({ name, description, personality, iconName })`，成功后调用 `onSaved()` 刷新列表
2. 编辑 agent：调用 `api.updateAgent(slug, { name, description, personality, iconName })`
3. `systemPrompt` 字段映射到后端的 `personality` 字段
4. 图标选项保留 4 个（cpu, brain, terminal, palette）
5. 错误处理：API 失败时显示错误提示

- [ ] **Step 2: 手动验证 agent CRUD**

在 App.tsx 临时 wire up，新建 agent 后检查 `GET /api/agents` 返回新 agent
预期：新建 agent 成功，编辑 agent 成功，删除 agent 成功

- [ ] **Step 3: 提交**

```bash
git add src/webui-react/components/AgentModals.tsx
git commit -m "feat(webui-react): Task 7 — AgentModals + CRUD integration"
```

---

## Task 8: 工具调用展示 + Memory Toast + Footer

**Files:**
- Create: `src/webui-react/components/ToolCallView.tsx`
- Create: `src/webui-react/components/MemoryToast.tsx`
- Create: `src/webui-react/components/FooterBar.tsx`

**Interfaces:**
- Consumes: `ToolCall`（来自 reducer state，`{ toolCallId, toolName, arguments, success, summary }`）；`AgentEvent`（memory write 相关事件）
- Produces: `<ToolCallView>` 组件、`<MemoryToast>` 组件、`<FooterBar>` 组件

- [ ] **Step 1: 实现 ToolCallView 组件**

`ToolCallView.tsx`：在 ChatArea 中 assistant 消息下方展示工具调用。`tool_call_start` → 显示工具名 + 加载中图标；`tool_result` → 显示成功/失败 + summary（折叠态，点击展开）。保留极简样式：`bg-neutral-50 border-neutral-200`，工具名用等宽字体。

- [ ] **Step 2: 实现 MemoryToast 组件**

`MemoryToast.tsx`：监听 `tool_call_start` + `tool_call_delta` + `tool_result` 事件，当 `toolName === 'write_agent_memory'` 时显示 toast。解析 `arguments` JSON 获取 `section` 和 `content`。toast 显示 3 秒后自动消失。保留 0.3.0 的 section title 映射（`user_profile` → `User Profile` 等）。

- [ ] **Step 3: 实现 FooterBar 组件**

`FooterBar.tsx`：底部状态栏，显示当前模型名（来自 bootstrap `model`）+ 连接状态指示器（`ws.readyState`：connecting/open/closing/closed）。保留极简样式。

- [ ] **Step 4: 手动验证工具调用展示**

发送触发工具调用的消息（如要求 agent 读取文件），检查 ToolCallView 渲染
预期：工具调用过程可见，结果 summary 折叠展示

- [ ] **Step 5: 提交**

```bash
git add src/webui-react/components/ToolCallView.tsx src/webui-react/components/MemoryToast.tsx src/webui-react/components/FooterBar.tsx
git commit -m "feat(webui-react): Task 8 — tool calls + memory toast + footer"
```

---

## Task 9: App 主入口 + 状态管理 + 路由组装

**Files:**
- Create: `src/webui-react/App.tsx`
- Modify: `src/webui-react/main.tsx`（替换占位为 `<App />`）

**Interfaces:**
- Consumes: 所有 Task 1-8 产生的组件和 lib 模块
- Produces: 完整的 React WebUI 应用，挂载到 `#root`

- [ ] **Step 1: 实现 App.tsx 主组件**

`App.tsx`：组合所有组件，管理全局状态：
1. `auth` 状态（AuthController）— 未登录时显示 AuthModal
2. `ws` 状态（WsClient）— 登录后建立 WebSocket 连接
3. `ui` 状态（reducer）— 处理 WebSocket 事件更新消息列表
4. `agents` / `sessions` 状态 — 来自 `api.bootstrap()`
5. `activeAgentSlug` / `activeSessionId` 状态 — 当前选中
6. `isGenerating` 状态 — `turn_start` 时 true，`turn_end` 时 false

- [ ] **Step 2: 实现登录流程**

App 挂载时：
1. 调用 `auth.fetchMe()` 检查已登录（cookie 有效）
2. 未登录 → 显示 AuthModal，阻止其他交互
3. 已登录 → 调用 `api.bootstrap()` 获取初始数据 → 建立 WebSocket 连接

- [ ] **Step 3: 实现消息发送流程**

`handleSendMessage(content)`：
1. 本地立即添加 user 消息到 reducer（`{ role: 'user', content }`）
2. `ws.send(content)` 发送到服务端
3. 服务端通过事件流返回 `message_start` → `message_delta`（多个）→ `message_end`

`handleSendSlash(cmd)`：
1. `ws.sendSlash(cmd)` 发送 slash 命令
2. 服务端返回 `session_changed`（如 `/new`）或纯文本输出（如 `/help`）

- [ ] **Step 4: 实现会话切换流程**

`handleSelectSession(sessionId)`：
1. 调用 `ws.sendSlash('/resume ' + sessionId)`
2. 收到 `session_changed` 事件 → 更新 `activeSessionId` → 重置 `lastEventSeq=0` → 重连 WS
3. 重连后 `historyLimit` 触发服务端回放历史消息（`replay` 事件）

- [ ] **Step 5: 实现新建会话流程**

`handleCreateSession()`：
1. 调用 `ws.sendSlash('/new')`
2. 收到 `session_changed` 事件 → 清空消息 → 更新 `activeSessionId`
3. `loadAgentsAndSessions()` 刷新 session 列表

- [ ] **Step 6: 替换 main.tsx 占位**

`main.tsx`：`import App from './App'` + `createRoot(...).render(<App />)`

- [ ] **Step 7: 构建并启动验证**

运行：`npm run webui:build && npm run dev`
访问 `http://localhost:8080/demo`
预期：看到完整 WebUI，登录后能发消息、收到流式响应

- [ ] **Step 8: 提交**

```bash
git add src/webui-react/App.tsx src/webui-react/main.tsx
git commit -m "feat(webui-react): Task 9 — App entry + state management + wiring"
```

---

## Task 10: Playwright UAT 验收 + Bug 修复

**Files:**
- Create: `tests/uat/react-webui-uat.spec.ts`
- Modify: 各组件文件（修复发现的 bug）

**Interfaces:**
- Produces: 通过的 Playwright E2E 测试 + 无可见交互 bug 的 WebUI

- [ ] **Step 1: 编写 Playwright UAT 测试脚本**

`tests/uat/react-webui-uat.spec.ts`：覆盖以下场景：
1. 注册新用户 → 登录 → 看到 WebUI
2. 发送消息 → 收到流式响应 → 消息正确渲染
3. 点击"新会话" → 消息清空 → session 列表新增
4. 点击已有会话 → 历史消息加载
5. 新建专业 agent → agent 出现在侧边栏
6. 编辑 agent → 信息更新
7. 删除会话 → 会话从列表消失
8. 切换 agent → 输入区快捷指令变化
9. Slash 命令 `/help` → 显示帮助文本
10. 刷新页面 → 保持登录状态 → 消息历史恢复

- [ ] **Step 2: 启动 server 并运行 UAT**

运行：`npm run webui:build && npx tsx --env-file=.env src/server.ts &`
运行：`npx playwright test tests/uat/react-webui-uat.spec.ts`
预期：部分测试可能 FAIL（发现 bug）

- [ ] **Step 3: 修复发现的 bug**

根据 Playwright 失败报告逐一修复：
- 消息对齐错误 → 修复 ChatArea CSS
- 流式更新不触发 re-render → 修复 reducer 不可变性
- 会话切换不加载历史 → 修复 WS 重连时序
- agent 创建后不刷新 → 修复 bootstrap 重新调用
- 登录状态丢失 → 修复 cookie credentials
- 其他交互 bug

- [ ] **Step 4: 重新运行 UAT 直到全部通过**

运行：`npx playwright test tests/uat/react-webui-uat.spec.ts`
预期：ALL PASS

- [ ] **Step 5: 提交**

```bash
git add tests/uat/react-webui-uat.spec.ts src/webui-react/
git commit -m "test(webui-react): Task 10 — Playwright UAT passed + bug fixes"
```

---

## Self-Review

### Spec coverage check

1. **消息对齐**（user 靠右、assistant 靠左）→ Task 5 Step 5 明确要求
2. **会话列表点击加载历史** → Task 9 Step 4 会话切换流程 + Task 3 ring buffer resync
3. **会话删除** → Task 4 Step 6 Sidebar 删除功能
4. **新建专业 agent 弹窗** → Task 7 AgentModals
5. **输入框布局** → Task 6 InputArea 保留 aistudio-design 布局
6. **流式响应** → Task 3 WsClient message_delta + Task 5 流式光标
7. **认证** → Task 2 AuthController + AuthModal
8. **Agent CRUD** → Task 7 AgentModals + api.ts
9. **Bootstrap** → Task 4 api.bootstrap()
10. **工具调用** → Task 8 ToolCallView
11. **记忆写入** → Task 8 MemoryToast
12. **Slash 命令** → Task 6 InputArea + Task 9 handleSendSlash
13. **Playwright UAT** → Task 10

### Placeholder scan

无 TBD / TODO / "implement later" / "similar to Task N"。每个步骤都有明确的行为描述和验证方式。

### Type consistency

- `AgentProfile.slug`（Task 4 定义）→ Task 6/7/9 一致使用 `slug` 而非 `id`
- `SessionMetadata.id`（Task 4 定义）→ Task 9 `handleSelectSession(sessionId)` 一致
- `Message.role: 'user' | 'assistant'`（Task 5 定义）→ Task 3 reducer 一致
- `WsClient.send / sendSlash`（Task 3 定义）→ Task 9 一致调用

### Gap check

未覆盖项（可接受的范围外）：
- 文件附件上传 — 后端暂不支持，InputArea 保留 UI 但提示"开发中"
- 重新生成消息 — 后端无 `/regenerate` 命令，按钮显示但提示"暂未支持"
- 思考深度选择 — 后端无对应 API，仅前端状态
- 多模型切换 — bootstrap 仅返回单个 `model`，下拉仅显示当前

这些是后端限制，非前端遗漏，可在未来后端扩展时再接入。
