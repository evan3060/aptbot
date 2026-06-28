# aptbot L1 Implementation Plan

> 🚧 **L1 IN PLANNING** — 初始框架，尚未开始实施。前置 MVP 已于 2026-06-28 封仓（见 [PLAN.md](./PLAN.md)）。

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** L1 阶段实现浏览器级会话隔离与多客户端同步，使 aptbot 从"单浏览器单会话"演进为"多浏览器各自独立会话 + 跨设备同步查看"。同时补齐 VPS 部署后暴露的体验短板。

**Architecture:** L1 不改变 MVP 四层架构，仅在接入层（access）与总线层（bus）之间增加 session 路由能力。WebSocket 服务器从"单 sessionKey 广播"升级为"per-connection sessionKey 路由"。客户端通过 localStorage 持久化 sessionId，实现浏览器级隔离。

**Tech Stack:** 沿用 MVP 技术栈，无新增依赖。

## Global Constraints

- 沿用 MVP 全部 Global Constraints（§10.1 ~ §10.14）
- **L1 新增约束：**
  - **Session 路由：** 每个 WebSocket connection 携带 sessionKey，ChannelManager 按 sessionKey 分发事件，不再全局广播
  - **localStorage 隔离：** 浏览器端通过 `localStorage.setItem('aptbot:sessionId', id)` 持久化，首次访问生成新 UUID
  - **多客户端同步：** 同一 sessionKey 的多个 connection 均收到出站事件；入站消息仅一个 connection 触发 agent run，其余 connection 收到同步事件
  - **向后兼容：** 现有 `/sessions` / `/resume` / `/new` 命令行为不变；CLI 不受影响（单 session）
- **All tasks MUST follow TDD:** 编写失败测试 → 验证失败 → 实现 → 验证通过 → 提交
- **Each task ends with:** `npm run test -- <path>` 返回 Exit Code = 0
- **本文件是图纸而非代码堆:** 具体函数体、业务逻辑与测试代码刻意省略。此处仅记录文件路径、设计契约（Interface/Types）、行为描述与验证命令。

---

## Phase 0: VPS 部署遗留补齐

### Task 1: 聊天页面 token 记忆与自动携带

**Files:**
- Modify: `src/access/chat-page.ts`
- Test: `tests/access/chat-page-token.spec.ts`

**Design Contracts:**
- 聊天页面 JS 在首次连接成功后，将 URL 中的 `token` 存入 `sessionStorage`
- 后续连接优先从 `sessionStorage` 读取 token，URL 参数优先级更高
- `sessionStorage` 中无 token 且 URL 无 token 时，显示鉴权提示并禁止发送

**Behavior:** VPS 部署后用户需每次带 `?token=` 参数访问，体验不佳。改为首次访问带 token 后记忆，后续刷新或重连自动携带。`sessionStorage` 随标签页关闭而清除，符合安全预期。

**TDD Cycle:**
- [ ] 编写失败测试覆盖：URL token 存入 sessionStorage、刷新后从 sessionStorage 读取、无 token 时显示提示
- [ ] 验证失败：`npm run test -- tests/access/chat-page-token.spec.ts` → FAIL
- [ ] 实现
- [ ] 验证通过：Exit Code 0
- [ ] 提交：`feat: persist auth token in sessionStorage for chat page`

### Task 2: 部署文档补齐（README + docs/deployment.md）

**Files:**
- Create: `docs/deployment.md`
- Modify: `README.md`
- Modify: `README.zh-CN.md`

**Design Contracts:**
- `docs/deployment.md` 包含：VPS 部署完整步骤、systemd unit 模板、nginx 配置模板、Caddy 替代方案、TLS 签发、SSH 加固、sudoers 配置
- README Deployment 章节链接到 `docs/deployment.md`

**Behavior:** MVP 封仓时部署指南标注"planned"，VPS 部署后已有实践经验，补齐为正式文档。

**TDD Cycle:**
- [ ] 编写 `docs/deployment.md`
- [ ] 更新 README 中 Deployment 章节的链接
- [ ] 提交：`docs: add VPS deployment guide`

---

## Phase 1: 浏览器会话隔离

### Task 3: WebSocket connection 绑定 sessionKey

**Files:**
- Modify: `src/access/websocket-server.ts`
- Modify: `src/access/websocket-channel.ts`
- Test: `tests/access/websocket-session-routing.spec.ts`

**Design Contracts:**

```typescript
// websocket-server.ts 新增
interface ConnectionState {
  sessionKey: string;        // 该 connection 绑定的 session
  messageTimestamps: number[];
  rateLimitWarnings: number;
  isAlive: boolean;
}

// WebSocket 连接时通过 query parameter ?session=<sessionId> 指定 sessionKey
// 未提供时使用服务器默认 session（向后兼容）
```

**Behavior:** 当前所有 WebSocket connection 共享一个全局 sessionKey。L1 改为 per-connection sessionKey：连接时通过 `?session=<id>` 指定，服务器在 `ConnectionState` 中记录。出站事件仅发给匹配 sessionKey 的 connection。

**TDD Cycle:**
- [ ] 编写失败测试覆盖：连接带 session 参数时绑定、不带时回退默认、不同 session 的 connection 不互相收到事件
- [ ] 验证失败：`npm run test -- tests/access/websocket-session-routing.spec.ts` → FAIL
- [ ] 实现
- [ ] 验证通过：Exit Code 0
- [ ] 提交：`feat: bind sessionKey per websocket connection`

### Task 4: 聊天页面 localStorage session 持久化

**Files:**
- Modify: `src/access/chat-page.ts`
- Test: `tests/access/chat-page-session.spec.ts`

**Design Contracts:**
- 页面加载时优先从 `localStorage.getItem('aptbot:sessionId')` 读取 sessionId
- 无存储值时生成新 UUID 并存入 localStorage
- WebSocket 连接 URL 附加 `?session=<sessionId>`
- `/new` 命令执行后更新 localStorage 为新 sessionId
- `/resume <id>` 命令执行后更新 localStorage 为目标 sessionId

**Behavior:** 实现浏览器级会话隔离。每个浏览器标签页持久化自己的 sessionId，刷新后恢复同一会话。不同浏览器/设备各自独立。

**TDD Cycle:**
- [ ] 编写失败测试覆盖：首次访问生成 sessionId 并存 localStorage、刷新后读取同一 sessionId、/new 后更新 localStorage、/resume 后更新 localStorage
- [ ] 验证失败：`npm run test -- tests/access/chat-page-session.spec.ts` → FAIL
- [ ] 实现
- [ ] 验证通过：Exit Code 0
- [ ] 提交：`feat: persist sessionId in localStorage for browser isolation`

### Task 5: ChannelManager 多 sessionKey 路由

**Files:**
- Modify: `src/bus/channel-manager.ts`
- Test: `tests/bus/channel-manager-routing.spec.ts`

**Design Contracts:**

```typescript
// channel-manager.ts 扩展
interface ChannelManager {
  // 已有：register / startAll / bindSession
  // 新增：将出站事件按 sessionKey 路由到对应 channel
  routeEnvelope(envelope: AgentEventEnvelope): void;
  // 一个 channel 可绑定多个 sessionKey（多会话场景）
  bindSession(sessionKey: string, channel: Channel): void;
  unbindSession(sessionKey: string, channel: Channel): void;
  getBindings(channel: Channel): string[];
}
```

**Behavior:** 当前 `bindSession` 是 many-to-one（多 sessionKey 绑定到一个 channel）。L1 需支持 one-to-many（一个 sessionKey 的事件分发给多个 connection）。ChannelManager 维护 `Map<sessionKey, Set<Channel>>` 反向索引，出站事件按 sessionKey 查找所有绑定的 channel 并分发。

**TDD Cycle:**
- [ ] 编写失败测试覆盖：多 channel 绑定同一 sessionKey 时均收到事件、unbind 后不再收到、不同 sessionKey 事件互不干扰
- [ ] 验证失败：`npm run test -- tests/bus/channel-manager-routing.spec.ts` → FAIL
- [ ] 实现
- [ ] 验证通过：Exit Code 0
- [ ] 提交：`feat: route envelopes by sessionKey to multiple channels`

### Task 6: WebSocket Channel 按 sessionKey 过滤出站事件

**Files:**
- Modify: `src/access/websocket-channel.ts`
- Test: `tests/access/websocket-channel-filter.spec.ts`

**Design Contracts:**
- WebSocketChannel 的 `broadcast` 方法接收 envelope 后，仅推送给 sessionKey 匹配的 connection
- sessionKey 不匹配的 connection 不收到该事件（避免串扰）

**Behavior:** Task 3 让每个 connection 携带 sessionKey，Task 5 让 ChannelManager 支持多 channel 路由。本 Task 在 WebSocketChannel 层实现最终过滤：broadcast 时遍历 connections，仅向 sessionKey 匹配者发送。

**TDD Cycle:**
- [ ] 编写失败测试覆盖：两个 connection 不同 sessionKey、broadcast 仅送达匹配者、无 sessionKey 的 connection 收到默认 session 事件
- [ ] 验证失败：`npm run test -- tests/access/websocket-channel-filter.spec.ts` → FAIL
- [ ] 实现
- [ ] 验证通过：Exit Code 0
- [ ] 提交：`feat: filter broadcast by sessionKey in websocket channel`

---

## Phase 2: 多客户端同步

### Task 7: 多客户端入站消息互斥与广播

**Files:**
- Modify: `src/bus/inbound-loop.ts`
- Modify: `src/access/websocket-server.ts`
- Test: `tests/bus/inbound-mutex.spec.ts`

**Design Contracts:**

```typescript
// 同一 sessionKey 的入站消息处理策略：
// - 第一个 connection 发送的消息触发 agent run
// - agent run 期间，其他 connection 发送的消息进入队列或返回 busy
// - agent 响应事件广播给该 sessionKey 的所有 connection
```

**Behavior:** 多客户端打开同一会话时，不能同时触发两个 agent run（会导致 JSONL 写入冲突）。第一个消息触发 run，期间其他客户端发送消息返回 `turn_busy` 错误。agent 响应通过 Task 5 的路由机制同步到所有客户端。

**TDD Cycle:**
- [ ] 编写失败测试覆盖：agent run 中第二个消息返回 busy、run 结束后可发新消息、响应广播到所有 connection
- [ ] 验证失败：`npm run test -- tests/bus/inbound-mutex.spec.ts` → FAIL
- [ ] 实现
- [ ] 验证通过：Exit Code 0
- [ ] 提交：`feat: mutex agent run per sessionKey with busy response`

### Task 8: 多客户端历史消息同步

**Files:**
- Modify: `src/access/websocket-server.ts`
- Modify: `src/core/memory/session-storage.ts`
- Test: `tests/access/websocket-history-sync.spec.ts`

**Design Contracts:**
- 新 connection 连接时（携带 sessionKey），服务器推送该 session 最近 N 条历史消息
- N 默认 20，可通过 `?historyLimit=<n>` 参数调整
- 历史消息以 `message_delta` 事件格式补发，标记 `replay: true`
- 已有 ring buffer 机制可复用（`WS_OUTBOUND_BUFFER_MAX`）

**Behavior:** 第二个浏览器打开同一会话时，能看到之前的对话历史，而非空白页面。利用 MVP 已有的 ring buffer，在连接建立时回放最近事件。

**TDD Cycle:**
- [ ] 编写失败测试覆盖：新连接收到历史回放、historyLimit 参数生效、replay 标记正确
- [ ] 验证失败：`npm run test -- tests/access/websocket-history-sync.spec.ts` → FAIL
- [ ] 实现
- [ ] 验证通过：Exit Code 0
- [ ] 提交：`feat: replay recent history on new websocket connection`

### Task 9: 客户端连接状态指示

**Files:**
- Modify: `src/access/chat-page.ts`
- Test: `tests/access/chat-page-multi-client.spec.ts`

**Design Contracts:**
- 聊天页面显示当前在线连接数（通过 `presence` 事件）
- 服务器在 connection 建立/断开时向同 sessionKey 的其他 connection 广播 `presence` 事件
- 页面底部显示 "N 人在线" 指示器

**Behavior:** 多客户端场景下，用户能感知其他设备的在线状态。避免重复发送消息（看到对方设备在线时知道会话已被打开）。

**TDD Cycle:**
- [ ] 编写失败测试覆盖：新连接触发 presence 广播、断开时触发、连接数正确显示
- [ ] 验证失败：`npm run test -- tests/access/chat-page-multi-client.spec.ts` → FAIL
- [ ] 实现
- [ ] 验证通过：Exit Code 0
- [ ] 提交：`feat: presence indicator for multi-client sessions`

---

## Phase 3: 端到端验证

### Task 10: E2E 多客户端会话隔离测试

**Files:**
- Test: `tests/e2e/multi-client-isolation.spec.ts`

**Design Contracts:**
- 模拟两个 WebSocket connection 携带不同 sessionKey
- 各自发送消息，验证响应互不串扰
- 验证 `/sessions` 命令在两个 session 中各自独立

**Behavior:** 端到端验证浏览器会话隔离的完整流程。

**TDD Cycle:**
- [ ] 编写失败测试
- [ ] 验证失败：`npm run test -- tests/e2e/multi-client-isolation.spec.ts` → FAIL
- [ ] 修复至通过
- [ ] 提交：`test: e2e multi-client session isolation`

### Task 11: E2E 多客户端同步测试

**Files:**
- Test: `tests/e2e/multi-client-sync.spec.ts`

**Design Contracts:**
- 模拟两个 WebSocket connection 携带相同 sessionKey
- 客户端 A 发送消息，验证客户端 B 收到 agent 响应
- 验证客户端 B 连接时收到历史回放
- 验证 presence 事件正确广播

**Behavior:** 端到端验证多客户端同步的完整流程。

**TDD Cycle:**
- [ ] 编写失败测试
- [ ] 验证失败：`npm run test -- tests/e2e/multi-client-sync.spec.ts` → FAIL
- [ ] 修复至通过
- [ ] 提交：`test: e2e multi-client sync`

### Task 12: L1 封仓回归测试

**Files:**
- Test: `tests/e2e/l1-regression.spec.ts`

**Design Contracts:**
- 全量回归：`npm test` 通过、`npx tsc --noEmit` 0 错误
- 手工测试：VPS 部署后多浏览器访问 `https://aptbot.de/` 验证隔离与同步

**Behavior:** L1 封仓前的完整回归验证。

**TDD Cycle:**
- [ ] `npm test` 全绿
- [ ] `npx tsc --noEmit` 0 错误
- [ ] VPS 多浏览器手工验证
- [ ] 更新 PLAN.md 顶部状态为 `✅ L1 COMPLETED`
- [ ] 提交：`feat(mvp): complete L1 with browser isolation and multi-client sync`

---

## Self-Review

### 设计决策回顾

1. **sessionStorage vs localStorage 存 token：** 选 sessionStorage — 标签页关闭即清除，比 localStorage 更安全。sessionId 用 localStorage — 跨标签页/刷新保持同一会话。

2. **多客户端互斥策略：** 选 busy 响应而非队列 — MVP 已有 InboundMessage 队列，但多客户端场景下队列会导致 FIFO 混乱。busy 响应让用户主动决定是否重试。

3. **历史回放用 ring buffer：** MVP 已有 `WS_OUTBOUND_BUFFER_MAX=1000` 的 ring buffer，直接复用。仅回放出站事件（agent 响应），入站消息（用户输入）需额外从 JSONL 读取补发。

### 风险点

1. **localStorage 被清除：** 用户清浏览器数据后 sessionId 丢失，会生成新会话。可接受 — 旧会话仍可通过 `/sessions` + `/resume` 恢复。

2. **多客户端并发写 JSONL：** MVP 已有 per-sessionId mutex，多客户端触发同一 session 的 agent run 会被 Task 7 的互斥逻辑拦截。

3. **ring buffer 内存：** 50 connections × 1000 envelopes 可能占用较多内存。L1 阶段保持现有上限，L2 可按 sessionKey 分片。

### 不做的事

- **跨设备实时编辑同步：** 不做 OT/CRDT，仅同步消息流（用户输入 + agent 响应）。
- **会话权限控制：** L1 无权限模型，任何拿到 token 的人可访问所有会话。权限放 L2 IM 阶段。
- **离线消息：** 不做离线推送，连接断开期间的消息仅通过历史回放补发。

---

## 后续阶段展望

### L2 首批（可靠性 + 扩展性基础）
- MixinProvider（多 provider 故障转移）
- Config 热重载（mtimeNs 懒加载）
- Hook 系统（8 hook 点 + priority）

### L2 次批（体验优化）
- /session 动态属性（temperature/maxTokens 等）
- L1 索引 Skill（tags + lastUsed 排序）

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
