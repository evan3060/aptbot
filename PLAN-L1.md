# aptbot L1 Implementation Plan

> 🚧 **L1 IN PLANNING** — 基于 spec `docs/superpowers/specs/2026-06-29-l1-user-system-multi-client-design.md` 生成。前置 MVP 已于 2026-06-28 封仓（见 [PLAN.md](./PLAN.md)）。

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** L1 阶段实现用户级 session 管理与多客户端同步，使 aptbot 从"单浏览器单会话"演进为"注册用户跨设备同步 + 匿名用户浏览器内保持 + 多客户端实时同步 + Codex 风格侧边栏"。同时补齐 VPS 部署后暴露的体验短板。

**Architecture:** L1 不改变 MVP 四层架构，在接入层（access）与基建层（infrastructure）增加用户系统。WebSocket 服务器从"单 sessionKey 广播"升级为"per-connection sessionKey 路由 + 按 userId 过滤 session 列表"。客户端通过 localStorage 持久化 sessionId 和 token，实现浏览器级隔离与跨设备同步。

**Tech Stack:** 沿用 MVP 技术栈，无新增依赖（密码哈希用 Node.js 内置 `crypto.scrypt`）。

## Global Constraints

- 沿用 MVP 全部 Global Constraints（§10.1 ~ §10.1.4）
- **L1 新增约束：**
  - **用户系统：** 注册用户用 `data/users.jsonl` 存储，密码用 `crypto.scrypt` 哈希；匿名用户用随机 UUID + localStorage
  - **统一 token：** 注册用户登录返回 token，匿名用户首次访问生成 token，VPS 部署的 `authToken` env 作为部署级共享 token 保留
  - **Session 路由：** 每个 WebSocket connection 携带 `?session=<sessionId>`，`broadcast()` 仅向 sessionKey 匹配的 connection 发送
  - **Session-user 关联：** `SessionMetadata` 新增 `userId` 字段，`listSessions()` 按 userId 过滤
  - **session_changed 事件：** `/new` 或 `/resume` 切换 session 后，服务端向该 connection 推送 `session_changed` 事件
  - **per-sessionKey 串行化：** 同一 sessionKey 的消息 await 串行处理，不同 sessionKey 并行；无 `turn_busy` 响应
  - **ring buffer 历史回放：** 扩展 ring buffer 缓存入站+出站消息，新连接回放标记 `replay: true`；不读 JSONL
  - **presence 直发：** wsServer 在 connection 建立/断开时直接向同 sessionKey 的其他 connection 发送 presence 事件，不走 bus
  - **向后兼容：** 现有 `/sessions` / `/resume` / `/new` 命令行为不变；CLI 不受影响（单 session）
- **All tasks MUST follow TDD:** 编写失败测试 → 验证失败 → 实现 → 验证通过 → `requesting-code-review` skill 审查 → 提交
- **Each task ends with:** `npm run test -- <path>` 返回 Exit Code = 0
- **本文件是图纸而非代码堆:** 具体函数体、业务逻辑与测试代码刻意省略。此处仅记录文件路径、设计契约（Interface/Types）、行为描述与验证命令。

---

## Phase 0: VPS 部署遗留补齐

### Task 1: 聊天页面 token 记忆与自动携带

**Files:**
- Modify: `src/access/chat-page.ts`
- Test: `tests/access/chat-page-token.spec.ts`

**Design Contracts:**

```typescript
// chat-page.ts 内联 JS 行为契约（无新接口，修改 buildWsUrl 逻辑）：
// - 首次连接成功后，将 URL 中的 token 存入 sessionStorage（key: 'aptbot:token'）
// - 后续连接优先从 sessionStorage 读取 token，URL 参数优先级更高
// - sessionStorage 中无 token 且 URL 无 token 时，显示鉴权提示并禁止发送
```

**Behavior:** VPS 部署后用户需每次带 `?token=` 参数访问，体验不佳。改为首次访问带 token 后记忆，后续刷新或重连自动携带。`sessionStorage` 随标签页关闭而清除，符合安全预期。

**TDD Cycle:**
- [x] 编写失败测试覆盖：URL token 存入 sessionStorage、刷新后从 sessionStorage 读取、无 token 时显示提示
- [x] 验证失败：`npm run test -- tests/access/chat-page-token.spec.ts` → FAIL
- [x] 实现
- [x] 验证通过：Exit Code 0
- [x] `requesting-code-review` skill 审查
- [x] 提交：`feat: persist auth token in sessionStorage for chat page`

### Task 2: 部署文档补齐

**Files:**
- Modify: `docs/deployment.md`
- Modify: `README.md`
- Modify: `README.zh-CN.md`

**Design Contracts:**
- `docs/deployment.md` 已存在，补充 VPS 部署后的实践经验（SSH 加固、sudoers 配置、Caddy 反代、WebSocket 鉴权等）
- README Deployment 章节链接到 `docs/deployment.md`

**Behavior:** MVP 封仓时部署指南标注"planned"，VPS 部署后已有实践经验，补齐为正式文档。

**TDD Cycle:**
- [x] 更新 `docs/deployment.md` 内容
- [x] 更新 README 中 Deployment 章节的链接
- [x] 提交：`docs: complete VPS deployment guide with practices`

---

## Phase 1: 用户系统

### Task 3: 用户模型 + 存储 + 认证 API

**Files:**
- Create: `src/infrastructure/user-storage.ts`
- Create: `tests/infrastructure/user-storage.spec.ts`
- Modify: `src/access/websocket-server.ts`

**Design Contracts:**

```typescript
// user-storage.ts
export interface UserRecord {
  readonly userId: string;
  readonly username: string;
  readonly passwordHash: string;
  readonly token: string;
  readonly createdAt: number;
}

export interface UserStorage {
  register(username: string, password: string): Promise<UserRecord>;
  login(username: string, password: string): Promise<UserRecord | null>;
  findByToken(token: string): Promise<UserRecord | null>;
  findByUserId(userId: string): Promise<UserRecord | null>;
}

// 密码哈希用 node:crypto 的 scrypt + salt
// token 用 randomUUID(64) 或 crypto.randomBytes(32).toString('hex')
// 存储路径：${dataDir}/users.jsonl（复用 JSONL 基建，per-file mutex）

// websocket-server.ts 新增 HTTP API 路由：
// POST /api/register  body: { username, password } → { token, userId }
// POST /api/login     body: { username, password } → { token, userId }
// GET  /api/me        header: Authorization: Bearer <token> → { userId, username }
```

**Behavior:** 建立用户系统基础。注册时校验用户名唯一性，密码用 scrypt 哈希存储。登录验证密码后返回 token。`/api/me` 通过 token 查询用户信息。HTTP API 与 WebSocket 共用同一个 httpServer 实例。

**TDD Cycle:**
- [x] 编写失败测试覆盖：注册成功、重复用户名注册失败、登录成功、错误密码登录失败、token 查询用户、API 端点集成
- [x] 验证失败：`npm run test -- tests/infrastructure/user-storage.spec.ts` → FAIL
- [x] 实现
- [x] 验证通过：Exit Code 0
- [x] `requesting-code-review` skill 审查
- [x] 提交：`feat: add user model, storage, and auth API`

### Task 4: 认证中间件 + 匿名用户

**Files:**
- Modify: `src/access/websocket-server.ts`
- Modify: `src/server.ts`
- Test: `tests/access/websocket-auth.spec.ts`

**Design Contracts:**

```typescript
// websocket-server.ts ConnectionState 扩展
interface ConnectionState {
  messageTimestamps: number[];
  rateLimitWarnings: number;
  isAlive: boolean;
  userId: string;       // 新增：从 token 解析或匿名生成
  sessionKey: string;   // Task 5 填充，此处先占位
}

// 认证优先级：
// 1. URL ?token=<userToken> → userStorage.findByToken → userId
// 2. 环境变量 authToken（部署级共享）→ 共享 userId '__shared__'
// 3. 无 token → 匿名 userId = randomUUID()（客户端 localStorage 持久化）
//
// WebSocketServerOptions 新增可选 userStorage 参数：
interface WebSocketServerOptions {
  port: number;
  bus: MessageBus;
  authToken?: string;
  host?: string;
  serveHtml?: string;
  userStorage?: UserStorage;  // 新增
}
```

**Behavior:** WebSocket 连接时通过 token 识别用户身份。注册用户 token 返回对应 userId；VPS 部署的 authToken 作为共享 token，所有连接归为 `__shared__` 用户；无 token 时生成匿名 UUID。`?token=` 兼容现有 authToken 机制（authToken 优先级低于用户 token）。

**TDD Cycle:**
- [x] 编写失败测试覆盖：用户 token 认证、authToken 共享认证、匿名 UUID 生成、无 userStorage 时回退 authToken
- [x] 验证失败：`npm run test -- tests/access/websocket-auth.spec.ts` → FAIL
- [x] 实现
- [x] 验证通过：Exit Code 0
- [x] `requesting-code-review` skill 审查
- [x] 提交：`feat: add auth middleware with anonymous user support`

---

## Phase 2: 会话隔离与关联

### Task 5: WebSocket sessionKey 路由 + session-user 关联

**Files:**
- Modify: `src/access/websocket-server.ts`
- Modify: `src/core/memory/types.ts`
- Modify: `src/infrastructure/storage/file-storage.ts`
- Modify: `src/core/memory/session-repo.ts`
- Modify: `src/server.ts`
- Test: `tests/access/websocket-session-routing.spec.ts`

**Design Contracts:**

```typescript
// websocket-server.ts broadcast 改造
interface ConnectionState {
  messageTimestamps: number[];
  rateLimitWarnings: number;
  isAlive: boolean;
  userId: string;
  sessionKey: string;  // 从 ?session=<id> 解析，未提供时服务端生成
}

// broadcast(envelope) 仅向 state.sessionKey === envelope.sessionKey 的 connection 发送
// 连接时自动 channelManager.bindSession(sessionKey, wsChannel)

// types.ts SessionMetadata 扩展
export interface SessionMetadata {
  readonly id: string;
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly label?: string;
  readonly passedSessions?: number;
  readonly userId?: string;  // 新增：session 所属用户
}

// file-storage.ts listSessions 扩展
interface StorageAdapter {
  // 已有方法不变
  listSessions(userId?: string): Promise<SessionMetadata[]>;  // 新增可选 userId 过滤
  updateSessionLabel(sessionId: string, label: string): Promise<void>;  // 新增：Task 6 /label 命令使用
}

// session-repo.ts SessionRepo 扩展
export interface SessionRepo {
  create(userId?: string): Promise<Session>;          // 新增 userId 参数
  open(id: string, userId?: string): Promise<Session>;
  list(userId?: string): Promise<SessionMetadata[]>;  // 新增 userId 过滤
  delete(id: string): Promise<void>;
}
```

**Behavior:** 每个 WebSocket connection 携带 `?session=<sessionId>`，服务器在 `ConnectionState` 中记录 sessionKey。`broadcast()` 仅向 sessionKey 匹配的 connection 发送，避免串扰。`SessionMetadata` 新增 `userId` 字段，session 创建时打标签。`listSessions()` 支持按 userId 过滤，使用户只能看到自己的 sessions。连接时自动 `channelManager.bindSession(sessionKey, wsChannel)`。

**TDD Cycle:**
- [x] 编写失败测试覆盖：连接带 session 参数时绑定、不带时生成、不同 session 的 connection 不互相收到事件、listSessions 按 userId 过滤
- [x] 验证失败：`npm run test -- tests/access/websocket-session-routing.spec.ts` → FAIL
- [x] 实现
- [x] 验证通过：Exit Code 0
- [x] `requesting-code-review` skill 审查
- [x] 提交：`feat: route envelopes by sessionKey and associate sessions with users`

### Task 6: localStorage 持久化 + session_changed 事件 + 登录页面

> **Scope adjustment (code review):** 登录/注册页面 UI 与 `CommandContext.userId` 接线 deferred to Task 11 (E2E 用户认证 + session 隔离)。本 Task 聚焦 sessionId 持久化、session_changed 事件、/label 命令。
> **Design deviation (I5):** `sendToConnection(ws, msg)` 改为 `sendToSessionKey(sessionKey, msg)` — 支持多标签页同 session 场景，更符合 per-sessionKey 路由模型。

**Files:**
- Modify: `src/access/chat-page.ts`
- Modify: `src/access/chat-page-token.ts` (I1 fix: buildWsUrl 总是带 lastEventSeq)
- Create: `src/access/chat-page-session.ts` (纯函数，可测试)
- Modify: `src/server.ts`
- Modify: `src/shared/commands/registry.ts`
- Modify: `src/access/websocket-server.ts` (sendToSessionKey + replay lastEventSeq=0 语义)
- Test: `tests/access/chat-page-session.spec.ts`
- Test: `tests/server/session-changed-event.spec.ts`

**Design Contracts:**

```typescript
// chat-page.ts 内联 JS 行为契约：
// - localStorage key: 'aptbot:sessionId' / 'aptbot:token' / 'aptbot:userId'
// - 页面加载时优先从 localStorage 读取 sessionId 和 token
// - 无 sessionId 时生成新 UUID 并存入 localStorage
// - WebSocket 连接 URL 附加 ?session=<sessionId>&token=<token>
// - 监听 session_changed 事件后更新 localStorage 并重连 WebSocket

// server.ts runInboundLoop 改造：
// - /new 或 /resume 执行后，向当前 connection 推送 session_changed 事件
// - 事件格式：{ type: 'session_changed', sessionId: '<newId>' }
// - 通过 wsServer 新增 sendToConnection(ws, msg) 方法定向发送

// registry.ts CommandContext 扩展：
interface CommandContext {
  sessionId: string;
  model: string;
  storage: StorageAdapter;
  userId?: string;  // 新增
}

// registry.ts 新增 /label 命令：
// - /label <名称> 设置当前 session 的 label
// - 通过 storage.updateSessionLabel(sessionId, label) 持久化
```

**Behavior:** 实现浏览器级会话隔离。每个浏览器标签页持久化自己的 sessionId，刷新后恢复同一会话。`/new` 和 `/resume` 切换 session 时，服务端推送 `session_changed` 事件，客户端更新 localStorage 并重连。新增 `/label` 命令支持 session 重命名。登录/注册页面提供表单，支持匿名访问入口。

**TDD Cycle:**
- [x] 编写失败测试覆盖：首次访问生成 sessionId 并存 localStorage、刷新后读取同一 sessionId、session_changed 事件触发 localStorage 更新、/label 命令设置 label
- [x] 验证失败：`npm run test -- tests/access/chat-page-session.spec.ts tests/server/session-changed-event.spec.ts` → FAIL
- [x] 实现
- [x] 验证通过：Exit Code 0
- [x] `requesting-code-review` skill 审查
- [x] 提交：`feat: persist sessionId in localStorage with session_changed event`

---

## Phase 3: 多客户端同步

### Task 7: per-sessionKey 串行化

**Files:**
- Modify: `src/server.ts`（`runInboundLoop` 函数）
- Test: `tests/server/inbound-serialization.spec.ts`

**Design Contracts:**

```typescript
// server.ts runInboundLoop 改造：
// - 维护 Map<sessionKey, Promise<void>> runningTurns
// - 消息处理时：
//   const prev = runningTurns.get(sessionKey) ?? Promise.resolve();
//   const next = prev.then(() => processMessage(msg));
//   runningTurns.set(sessionKey, next);
//   void next.finally(() => {
//     if (runningTurns.get(sessionKey) === next) runningTurns.delete(sessionKey);
//   });
// - 不同 sessionKey 的消息并行处理（fire-and-forget）
// - 同一 sessionKey 的消息串行处理（await 前一个 turn）
```

**Behavior:** 修复当前 inbound loop 的 fire-and-forget 问题（[server.ts:349](file:///Users/evan/projects/aptbot/src/server.ts#L349) 的 `void (async ...)`）。同一 sessionKey 的消息 await 串行处理，避免 agent 响应交错；不同 sessionKey 并行处理，互不阻塞。无 `turn_busy` 响应，消息自然排队等待。JSONL per-sessionId mutex（已存在）作为数据安全兜底。

**TDD Cycle:**
- [x] 编写失败测试覆盖：同 session 两条消息串行执行、不同 session 并行执行、turn 完成后 runningTurns 清理
- [x] 验证失败：`npm run test -- tests/server/inbound-serialization.spec.ts` → FAIL
- [x] 实现
- [x] 验证通过：Exit Code 0
- [x] `requesting-code-review` skill 审查
- [x] 提交：`feat: serialize inbound messages per sessionKey`

### Task 8: ring buffer 历史回放

**Files:**
- Modify: `src/access/websocket-server.ts`
- Test: `tests/access/websocket-history-replay.spec.ts`

**Design Contracts:**

```typescript
// websocket-server.ts ring buffer 扩展：
// - 现有 ringBuffer: AgentEventEnvelope[] 仅缓存出站事件
// - 新增 inboundBuffer: Array<{ sessionKey: string; content: string; timestamp: number }>
// - 新连接（携带 sessionKey）时回放该 sessionKey 的历史：
//   1. 从 inboundBuffer 过滤匹配 sessionKey 的入站消息
//   2. 从 ringBuffer 过滤匹配 sessionKey 的出站事件
//   3. 按 seq/时间戳合并排序后发送，标记 replay: true
// - 回放消息格式：{ type: 'replay', messages: [...] }

// 扩展 WS_OUTBOUND_BUFFER_MAX 行为：
// - 入站和出站各自独立 ring buffer，上限均为 WS_OUTBOUND_BUFFER_MAX (1000)
// - 新连接可选 ?historyLimit=<n> 参数调整回放数量（默认 20）
```

**Behavior:** 第二个浏览器打开同一会话时，能看到之前的对话历史，而非空白页面。利用内存 ring buffer，在连接建立时回放最近事件。不读 JSONL，不违反"agent 不可读 session 文件"约束。服务器重启后历史丢失（可接受）。

**TDD Cycle:**
- [x] 编写失败测试覆盖：新连接收到历史回放、historyLimit 参数生效、replay 标记正确、不同 sessionKey 历史不串扰
- [x] 验证失败：`npm run test -- tests/access/websocket-history-replay.spec.ts` → FAIL
- [x] 实现
- [x] 验证通过：Exit Code 0
- [x] `requesting-code-review` skill 审查
- [x] 提交：`feat: replay recent history on new websocket connection`

### Task 9: presence 指示器

**Files:**
- Modify: `src/access/websocket-server.ts`
- Modify: `src/access/chat-page.ts`
- Test: `tests/access/websocket-presence.spec.ts`

**Design Contracts:**

```typescript
// websocket-server.ts presence 直发：
// - connection 建立/断开时，向同 sessionKey 的其他 connection 发送：
//   { type: 'presence', onlineCount: N }
// - 不经过 bus / ChannelManager，由 wsServer 直接发送
// - onlineCount = 当前 sessionKey 的活跃 connection 数

// chat-page.ts 内联 JS 行为契约：
// - 监听 presence 事件，更新页面底部指示器
// - 指示器格式："N 人在线"（N > 1 时显示，N = 1 时隐藏）
```

**Behavior:** 多客户端场景下，用户能感知其他设备的在线状态。避免重复发送消息（看到对方设备在线时知道会话已被打开）。presence 事件由 wsServer 直发，不污染 AgentEvent 命名空间。

**TDD Cycle:**
- [x] 编写失败测试覆盖：新连接触发 presence 广播、断开时触发、onlineCount 正确、页面指示器显示
- [x] 验证失败：`npm run test -- tests/access/websocket-presence.spec.ts` → FAIL
- [x] 实现
- [x] 验证通过：Exit Code 0
- [x] `requesting-code-review` skill 审查
- [x] 提交：`feat: presence indicator for multi-client sessions`

---

## Phase 4: UI 增强

### Task 10: 左侧 session 侧边栏

**Files:**
- Modify: `src/access/chat-page.ts`
- Modify: `src/shared/commands/registry.ts`（`/label` 命令已在 Task 6 注册，此处补充侧边栏交互）
- Test: `tests/access/chat-page-sidebar.spec.ts`

**Design Contracts:**

```typescript
// chat-page.ts 内联 JS/CSS 行为契约：
// - 布局：左侧侧边栏（width: 260px）+ 右侧主聊天区（flex: 1）
// - 侧边栏顶部："新会话"按钮（触发 /new 命令）
// - 侧边栏列表：通过 HTTP GET /api/sessions 获取当前用户的 sessions
//   - 每项显示：label（无 label 时显示短 ID）+ 相对时间
//   - 当前 session 高亮
//   - 点击切换：发送 /resume <id> 命令，监听 session_changed 事件
// - 侧边栏底部：用户信息（username 或 "匿名用户"）+ 登出按钮
// - 仿 Codex 样式：简洁、单色、hover 反馈

// 新增 HTTP API：
// GET /api/sessions?token=<token> → { sessions: SessionMetadata[] }
//   - 按 userId 过滤，按 updatedAt 降序
```

**Behavior:** 仿 Codex 样式的左侧 session 侧边栏。用户可查看自己的所有 sessions，点击切换，新建会话。侧边栏与 `/sessions` `/resume` `/new` 命令并存。Session 自动生成 label（首条用户消息前 20 字符），用户可通过 `/label` 命令重命名。

**TDD Cycle:**
- [x] 编写失败测试覆盖：侧边栏渲染 session 列表、点击切换 session、新会话按钮触发 /new、/api/sessions 按 userId 过滤
- [x] 验证失败：`npm run test -- tests/access/chat-page-sidebar.spec.ts` → FAIL
- [x] 实现
- [x] 验证通过：Exit Code 0
- [x] `requesting-code-review` skill 审查
- [x] 提交：`feat: add session sidebar with Codex-style layout`

---

## Phase 5: 端到端验证

### Task 11: E2E 用户认证 + session 隔离

**Files:**
- Test: `tests/e2e/l1-auth-isolation.spec.ts`

**Design Contracts:**
- 模拟注册/登录流程，验证 token 返回与 `/api/me` 查询
- 模拟两个不同用户的 WebSocket connection，验证 session 列表互不串扰
- 验证匿名用户的 session 不被其他用户看到

**Behavior:** 端到端验证用户认证与 session 隔离的完整流程。

**TDD Cycle:**
- [x] 编写失败测试
- [x] 验证失败：`npm run test -- tests/e2e/l1-auth-isolation.spec.ts` → FAIL
- [x] 修复至通过
- [x] `requesting-code-review` skill 审查
- [x] 提交：`test: e2e user auth and session isolation`

### Task 12: E2E 多客户端同步

**Files:**
- Test: `tests/e2e/l1-multi-client-sync.spec.ts`

**Design Contracts:**
- 模拟两个 WebSocket connection 携带相同 sessionKey
- 客户端 A 发送消息，验证客户端 B 收到 agent 响应
- 验证客户端 B 连接时收到历史回放
- 验证 presence 事件正确广播
- 验证 session_changed 事件在 /new 后触发

**Behavior:** 端到端验证多客户端同步的完整流程。

**TDD Cycle:**
- [ ] 编写失败测试
- [ ] 验证失败：`npm run test -- tests/e2e/l1-multi-client-sync.spec.ts` → FAIL
- [ ] 修复至通过
- [ ] `requesting-code-review` skill 审查
- [ ] 提交：`test: e2e multi-client sync`

### Task 13: L1 封仓回归

**Files:**
- Test: `tests/e2e/l1-regression.spec.ts`
- Modify: `PLAN-L1.md`

**Design Contracts:**
- 全量回归：`npm test` 通过、`npx tsc --noEmit` 0 错误
- 手工测试：VPS 部署后多浏览器访问 `https://aptbot.de/` 验证注册/登录、多客户端同步、侧边栏切换、匿名用户体验

**Behavior:** L1 封仓前的完整回归验证。使用 `finishing-a-development-branch` skill 执行封仓流程。

**TDD Cycle:**
- [ ] `npm test` 全绿
- [ ] `npx tsc --noEmit` 0 错误
- [ ] VPS 多浏览器手工验证
- [ ] `finishing-a-development-branch` skill 执行封仓流程（文档同步 + 工作区清理 + 合并决策）
- [ ] 更新 PLAN-L1.md 顶部状态为 `✅ L1 COMPLETED`
- [ ] 提交：`feat(l1): complete L1 with user system and multi-client sync`

---

## Self-Review

### 设计决策回顾

1. **sessionStorage vs localStorage 存 token：** Task 1 选 sessionStorage — 标签页关闭即清除，比 localStorage 更安全。sessionId 用 localStorage — 跨标签页/刷新保持同一会话。

2. **per-sessionKey 串行化而非 busy 响应：** JSONL mutex 已保护数据安全；busy 响应增加复杂度且用户体验差；串行化自然排队。

3. **历史回放仅用 ring buffer：** 不读 JSONL，不违反"agent 不可读 session 文件"约束；服务器重启丢失可接受。

4. **presence 直发不走 bus：** presence 非 agent 事件，不应污染 AgentEvent 命名空间。

5. **Task 3/5/6 合并策略：** 原 PLAN-L1.md 的 Task 3+5+6 合并为新 Task 5（ChannelManager 已有路由能力，三任务改同一文件相互依赖）。

### 风险点

1. **localStorage 被清除：** 匿名用户 sessionId 丢失，生成新会话。旧会话可通过 `/sessions` + `/resume` 恢复（若已注册并登录则跨设备可恢复）。

2. **多客户端并发写 JSONL：** MVP 已有 per-sessionId mutex（5s 超时），L1 的 per-sessionKey 串行化进一步避免并发。

3. **ring buffer 内存：** 50 connections × 1000 envelopes 可能占用较多内存。L1 保持现有上限，L2 可按 sessionKey 分片。

4. **用户 token 安全：** token 明文存 localStorage，存在 XSS 风险。L1 可接受（个人 agent），L2 可加 HttpOnly cookie。

### 不做的事

- 跨设备实时编辑同步（不做 OT/CRDT，仅同步消息流）
- 会话权限控制（L1 无权限模型，任何拿到 token 的人可访问对应对话）
- 离线消息推送（连接断开期间的消息仅通过历史回放补发）
- OAuth 第三方登录（L1 仅用户名密码）
- Session 分支/树结构（L3 远期目标）
- `turn_busy` 响应（L1 用串行化替代，L2 若需更精细并发控制可引入）

---

## 后续阶段展望

### L2 首批（可靠性 + 扩展性基础）
- MixinProvider（多 provider 故障转移）
- Config 热重载（mtimeNs 懒加载）
- Hook 系统（8 hook 点 + priority）
- **L1 推迟：** per-sessionKey 队列分片（ring buffer 按 sessionKey 分片，降低内存）
- **L1 推迟：** HttpOnly cookie（token 安全增强，防 XSS）
- **L1 推迟：** JSONL 历史读取（服务器重启后历史不丢失）

### L2 次批（体验优化）
- /session 动态属性（temperature/maxTokens 等）
- L1 索引 Skill（tags + lastUsed 排序）
- **L1 推迟：** `turn_busy` 响应（若多客户端并发场景需要更精细控制）
- **L1 推迟：** Session 自动摘要命名（替代首 20 字符，用 LLM 生成摘要）

### L2 其他
- CLI/WebUI 增强（Overlay/fork 树/diff 渲染）
- IM 渠道接入（Telegram/飞书/钉钉）
- WebUI 拆分 CF Pages
- FallbackProvider + 熔断器
- OAuth 认证

### L3（远期目标）
- AgentLoop Layer 3（AgentHarness + phase 状态机）
- Subagent 子代理管理
- 跨进程恢复
- 会话分支（树结构）
- 跨会话长期记忆（MEMORY.md / USER.md）
- RpcMode / PrintMode
- 自演化 skill
- Plan Mode SOP

详细设计见 `docs/spec.md §12` 与 `docs/design-notes.md §12`。
