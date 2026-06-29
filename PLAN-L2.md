# aptbot L2 Implementation Plan

> 🚧 **L2 PLANNED, NOT STARTED** — 可靠性 + 扩展性基础 + 体验优化。前置 L1 已于 2026-06-29 封仓（见 [PLAN-L1.md](./PLAN-L1.md)，v0.2.0）。
>
> **本文件是图纸而非代码堆:** 描述性内容（Goal/Architecture/Behavior/TDD Cycle 说明/Self-Review）用中文，参数、变量、类型名、文件路径、命令、commit 消息保持英文。具体函数体、业务逻辑与测试代码刻意省略。

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** L2 将 aptbot 从"可用"演进为"可靠 + 可扩展 + 体验流畅"：引入多 provider 故障转移、配置热重载、hook 系统、JSONL 历史持久化、HttpOnly cookie 安全增强、CLI/WebUI UI 增强、首个 IM 渠道接入（Telegram）。同时偿还 L1 遗留技术债（per-sessionKey ring buffer 分片、turn_busy 响应、session 自动摘要命名）。

**Architecture:** L2 不改变 MVP 四层架构，在核心层（core）与接入层（access）增加扩展点：
- Provider 层引入 `MixinProvider` 与 `FallbackProvider` 支持故障转移与熔断
- Config 加 mtimeNs 懒加载实现热重载
- Hook 系统：8 个 hook 点（beforeTurn / afterTurn / beforeToolCall / afterToolCall / beforeMessage / afterMessage / beforeSession / afterSession）+ priority 排序
- JSONL 历史读取：突破"agent 不可读 session 文件"约束的受限路径（仅 ring buffer 走 JSONL 恢复，不暴露给 agent）
- 安全增强：token 从 localStorage 改为 HttpOnly cookie，防 XSS
- IM 接入层：抽象 `Channel` 接口，Telegram 作为首个实现

**Tech Stack:** 沿用 MVP/L1 技术栈，新增依赖：
- `node-telegram-bot-api` 或直接 fetch Telegram Bot API
- 无其他新增依赖（hook 系统用纯 TS 实现）

## Global Constraints

- 沿用 MVP/L1 全部 Global Constraints
- **L2 新增约束：**
  - **MixinProvider：** 多 provider 按 priority 串联，前一个失败（fatal 除外）自动 fallback 到下一个
  - **Config 热重载：** 监听 `config/aptbot.json` 的 mtimeNs 变化，懒加载新配置；运行中 turn 用旧配置，下个 turn 用新配置
  - **Hook 系统：** 8 个 hook 点，每个 hook 注册时指定 priority（小数字先执行）；hook 抛错不中断主流程，仅记录
  - **JSONL 历史读取：** 仅在 ring buffer 未命中（服务器重启后）时走 JSONL，不暴露给 agent；agent 仍受 `data/sessions/` 访问禁令
  - **HttpOnly cookie：** token 同时存 cookie（HttpOnly + Secure + SameSite=Strict）+ sessionStorage；优先级 cookie > sessionStorage > URL
  - **per-sessionKey ring buffer 分片：** ring buffer 改为 `Map<sessionKey, BufferedEvent[]>`，每个 sessionKey 独立 1000 上限；总上限 50000 防失控
  - **turn_busy 响应：** 同 sessionKey 已有 turn 执行时，新消息入队前发送 `{ type: 'turn_busy', position: N }` 提示前端显示"等待中..."
  - **Session 自动摘要命名：** session 首条 assistant 消息后，异步调用 LLM 生成 ≤20 字符摘要，作为默认 label（用户手动 `/label` 优先级更高）
  - **IM Channel 抽象：** `Channel` 接口（send/receive/close），WebSocket 与 Telegram 都实现此接口；`ChannelManager` 支持 IM 渠道注册
- **All tasks MUST follow TDD:** 编写失败测试 → 验证失败 → 实现 → 验证通过 → `requesting-code-review` skill 审查 → 提交
- **Each task ends with:** `npm run test -- <path>` 返回 Exit Code = 0

---

## Phase 1: 可靠性基础（L1 遗留技术债）

### Task 1: per-sessionKey ring buffer 分片

**Files:**
- Modify: `src/access/websocket-server.ts`
- Modify: `tests/access/websocket-history-replay.spec.ts`

**Design Contracts:**

```typescript
// websocket-server.ts ring buffer 改造：
// - 旧：ringBuffers: Map<sessionKey, BufferedEvent[]>
// - 新：分片结构相同，但每 sessionKey 独立 WS_OUTBOUND_BUFFER_MAX (1000)
// - 新增全局上限 MAX_TOTAL_BUFFERED_EVENTS = 50000
// - 超过全局上限时按 LRU 淘汰最旧 sessionKey 的全部 buffer

interface BufferedEvent {
  envelope: AgentEventEnvelope;
  timestamp: number;
}

// 行为契约：
// - 单 sessionKey 上限 1000 不变
// - 全局 50000 上限触发 LRU 淘汰
// - sessionKey refCount 归零时清理（沿用 L1 I4/I5 修复）
```

**Behavior:** L1 的 ring buffer 在 50 connections × 1000 envelopes 场景下可能内存过高。L2 引入全局上限 + LRU 淘汰，保证内存可控。

**TDD Cycle:**
- [ ] 编写失败测试覆盖：单 sessionKey 1000 上限、全局 50000 触发 LRU、refCount 归零清理
- [ ] 验证失败：`npm run test -- tests/access/websocket-history-replay.spec.ts` → FAIL
- [ ] 实现
- [ ] 验证通过：Exit Code 0
- [ ] `requesting-code-review` skill 审查
- [ ] 提交：`refactor: shard ring buffer per sessionKey with LRU eviction`

### Task 2: turn_busy 响应

**Files:**
- Modify: `src/server.ts` (`runInboundLoop`)
- Modify: `src/access/chat-page.ts`
- Test: `tests/server/inbound-serialization.spec.ts`

**Design Contracts:**

```typescript
// server.ts runInboundLoop 改造：
// - 同 sessionKey 已有 turn 执行时，新消息入队前发送 turn_busy
// - 消息格式：{ type: 'turn_busy', position: N }（N = 队列中位置）
// - 通过 wsServer.sendToSessionKey(sessionKey, msg) 直发
// - turn 完成后不发送 turn_ready（前端靠 turn_end 事件自然恢复）

// chat-page.ts 行为契约：
// - 监听 turn_busy 事件，显示"等待中... (前方 N 条消息)"
// - 收到 turn_start / turn_end 后清除提示
```

**Behavior:** L1 的串行化让消息自然排队，但用户无反馈。L2 增加 turn_busy 提示，告知用户消息已入队。

**TDD Cycle:**
- [ ] 编写失败测试覆盖：同 session 第二条消息触发 turn_busy、position 正确、不同 session 不互相影响
- [ ] 验证失败：`npm run test -- tests/server/inbound-serialization.spec.ts` → FAIL
- [ ] 实现
- [ ] 验证通过：Exit Code 0
- [ ] `requesting-code-review` skill 审查
- [ ] 提交：`feat: send turn_busy response when messages are queued`

### Task 3: JSONL 历史持久化（服务器重启不丢失）

**Files:**
- Modify: `src/access/websocket-server.ts`
- Modify: `src/core/memory/session-repo.ts`
- Modify: `src/access/chat-page.ts`
- Test: `tests/access/websocket-history-replay.spec.ts`

**Design Contracts:**

```typescript
// websocket-server.ts 历史回放改造：
// - 新连接时优先用 ring buffer 回放（L1 行为）
// - ring buffer 为空（服务器重启后）时，调用 sessionStorage.readSession(id) 读 JSONL
// - readSession 返回 SessionEntry[]，过滤 type === 'message' 后发送
// - 标记 replay: true，前端不重复渲染

// session-repo.ts 新增方法（突破 agent 访问约束，仅 wsServer 调用）：
// - readHistoryForReplay(id: string, limit: number): Promise<SessionEntry[]>
// - 内部仍走 per-sessionId mutex
// - 限制：仅返回 message 类型，不返回 tool_call（避免泄漏内部状态）

// chat-page.ts 行为契约：
// - 收到 replay 标记的消息时不触发 appendUserMsg，而是直接渲染
// - turn_start / turn_end 等 agent 事件不重放
```

**Behavior:** L1 服务器重启后 ring buffer 丢失，历史不可恢复。L2 在 ring buffer 未命中时走 JSONL，保证历史不丢失。**重要约束：** agent 仍受 `data/sessions/` 访问禁令，此路径仅 wsServer 使用。

**TDD Cycle:**
- [ ] 编写失败测试覆盖：ring buffer 命中时不读 JSONL、ring buffer 空时读 JSONL、limit 参数生效、不返回 tool_call
- [ ] 验证失败：`npm run test -- tests/access/websocket-history-replay.spec.ts` → FAIL
- [ ] 实现
- [ ] 验证通过：Exit Code 0
- [ ] `requesting-code-review` skill 审查
- [ ] 提交：`feat: persist history via JSONL fallback when ring buffer misses`

### Task 4: HttpOnly cookie 安全增强

**Files:**
- Modify: `src/access/websocket-server.ts`
- Modify: `src/access/chat-page.ts`
- Test: `tests/access/auth-api.spec.ts`

**Design Contracts:**

```typescript
// websocket-server.ts HTTP API 改造：
// - POST /api/register /api/login 成功时设置 Set-Cookie
// - Cookie: aptbot_token=<token>; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=2592000 (30天)
// - GET /api/me 优先读 cookie，其次 Authorization: Bearer
// - WebSocket 连接 token 来源优先级：URL ?token= > cookie > sessionStorage

// chat-page.ts 行为契约：
// - 首次访问带 ?token= 时，不存 sessionStorage，依赖 cookie 自动携带
// - 无 ?token= 时 fetch 自动带 cookie（credentials: 'include'）
// - WebSocket 连接 URL 不再强制带 ?token=（cookie 在握手时自动携带）
```

**Behavior:** L1 的 token 存 sessionStorage，存在 XSS 风险。L2 改为 HttpOnly cookie，JavaScript 不可读，防 XSS 偷 token。

**TDD Cycle:**
- [ ] 编写失败测试覆盖：登录响应含 Set-Cookie、cookie HttpOnly + Secure + SameSite=Strict、/api/me 优先读 cookie
- [ ] 验证失败：`npm run test -- tests/access/auth-api.spec.ts` → FAIL
- [ ] 实现
- [ ] 验证通过：Exit Code 0
- [ ] `requesting-code-review` skill 审查
- [ ] 提交：`feat: use HttpOnly cookie for token storage to prevent XSS`

---

## Phase 2: 扩展性基础

### Task 5: MixinProvider 多 provider 故障转移

**Files:**
- Create: `src/core/provider/mixin-provider.ts`
- Modify: `src/core/provider/types.ts`
- Test: `tests/core/provider/mixin-provider.spec.ts`

**Design Contracts:**

```typescript
// mixin-provider.ts
export class MixinProvider implements Provider {
  constructor(private providers: Array<{ provider: Provider; priority: number }>) {}
  // 按 priority 升序尝试，前一个失败（非 fatal）自动 fallback
  // fatal 错误（401/403/400）不触发 fallback，直接抛出
  // retryable 错误（429/5xx）先在原 provider 重试 3 次（复用 L1 retry 逻辑），仍失败后 fallback
  // 所有 provider 都失败时抛 AggregateError
}

// types.ts 扩展：
interface Provider {
  // 已有方法不变
  readonly name: string;  // 新增：provider 标识，用于日志
}
```

**Behavior:** L1 单 provider 失败时直接报错。L2 支持多 provider 串联，前一个失败自动 fallback，提高可用性。

**TDD Cycle:**
- [ ] 编写失败测试覆盖：单 provider 成功、首个失败 fallback 到第二个、fatal 不 fallback、retryable 先重试再 fallback、全部失败抛 AggregateError
- [ ] 验证失败：`npm run test -- tests/core/provider/mixin-provider.spec.ts` → FAIL
- [ ] 实现
- [ ] 验证通过：Exit Code 0
- [ ] `requesting-code-review` skill 审查
- [ ] 提交：`feat: add MixinProvider with multi-provider failover`

### Task 6: Config 热重载

**Files:**
- Modify: `src/infrastructure/config-loader.ts`
- Modify: `src/server.ts`
- Test: `tests/infrastructure/config-loader.spec.ts`

**Design Contracts:**

```typescript
// config-loader.ts 改造：
// - 监听 config/aptbot.json 的 mtimeNs 变化（fs.watch）
// - 变化时懒加载新配置，不立即应用
// - getActiveConfig() 返回最新已加载配置
// - 运行中 turn 用旧配置（捕获时的快照），下个 turn 用新配置

interface ConfigLoader {
  getActiveConfig(): Config;
  onReload(callback: (config: Config) => void): void;
  stop(): void;
}

// server.ts 行为：
// - 启动时创建 ConfigLoader
// - 每个 turn 开始时调用 getActiveConfig() 获取当前配置
// - 配置变化时不中断运行中 turn
```

**Behavior:** L1 修改配置需重启服务器。L2 支持热重载，修改 `config/aptbot.json` 后下个 turn 自动生效。

**TDD Cycle:**
- [ ] 编写失败测试覆盖：文件变化触发 reload、运行中 turn 用旧配置、下个 turn 用新配置、stop() 清理监听器
- [ ] 验证失败：`npm run test -- tests/infrastructure/config-loader.spec.ts` → FAIL
- [ ] 实现
- [ ] 验证通过：Exit Code 0
- [ ] `requesting-code-review` skill 审查
- [ ] 提交：`feat: hot-reload config via mtimeNs watch`

### Task 7: Hook 系统

**Files:**
- Create: `src/core/agent/hooks.ts`
- Modify: `src/core/agent/loop.ts`
- Modify: `src/core/agent/session.ts`
- Test: `tests/core/agent/hooks.spec.ts`

**Design Contracts:**

```typescript
// hooks.ts
export type HookPoint =
  | 'beforeTurn' | 'afterTurn'
  | 'beforeToolCall' | 'afterToolCall'
  | 'beforeMessage' | 'afterMessage'
  | 'beforeSession' | 'afterSession';

export interface HookContext {
  sessionId: string;
  userId?: string;
  turnId?: string;
  toolName?: string;
  message?: AgentMessage;
}

export type HookHandler = (ctx: HookContext) => Promise<void>;

export class HookRegistry {
  register(point: HookPoint, handler: HookHandler, priority: number = 100): void;
  unregister(point: HookPoint, handler: HookHandler): void;
  async execute(point: HookPoint, ctx: HookContext): Promise<void>;
  // priority 升序执行，hook 抛错不中断主流程，仅 log.warn
}

// loop.ts / session.ts 集成：
// - turn 开始前：await hooks.execute('beforeTurn', ctx)
// - turn 结束后：await hooks.execute('afterTurn', ctx)
// - tool 调用前后：beforeToolCall / afterToolCall
// - message 发送前后：beforeMessage / afterMessage
```

**Behavior:** L1 无扩展点，定制逻辑需改源码。L2 引入 8 hook 点，支持插件式扩展（日志、审计、限流、自定义工具前置处理等）。

**TDD Cycle:**
- [ ] 编写失败测试覆盖：hook 按 priority 执行、hook 抛错不中断、register/unregister 生效、8 个 hook 点都被调用
- [ ] 验证失败：`npm run test -- tests/core/agent/hooks.spec.ts` → FAIL
- [ ] 实现
- [ ] 验证通过：Exit Code 0
- [ ] `requesting-code-review` skill 审查
- [ ] 提交：`feat: add 8-point hook system with priority`

---

## Phase 3: 体验优化

### Task 8: Session 自动摘要命名

**Files:**
- Modify: `src/core/agent/loop.ts`
- Modify: `src/core/memory/session-repo.ts`
- Modify: `src/infrastructure/storage/file-storage.ts`
- Test: `tests/core/agent/session-summary.spec.ts`

**Design Contracts:**

```typescript
// loop.ts 改造：
// - turn_end 后检查 session 是否已有 label
// - 无 label 时异步调用 LLM 生成摘要（≤20 字符）
// - 摘要 prompt："Summarize this conversation in ≤20 chars. No punctuation. No quotes."
// - 生成成功后 storage.updateSessionLabel(id, summary)
// - 用户手动 /label 后跳过自动摘要（检查现有 label 是否非默认）

// file-storage.ts 扩展：
interface StorageAdapter {
  // 已有方法不变
  hasCustomLabel(id: string): Promise<boolean>;  // 新增：判断是否用户手动设置
}
```

**Behavior:** L1 默认 label 是首 20 字符，不语义化。L2 用 LLM 生成摘要，更易识别。用户手动 `/label` 优先级更高。

**TDD Cycle:**
- [ ] 编写失败测试覆盖：无 label 时触发摘要、有用户 label 时跳过、摘要 ≤20 字符、LLM 失败时不报错
- [ ] 验证失败：`npm run test -- tests/core/agent/session-summary.spec.ts` → FAIL
- [ ] 实现
- [ ] 验证通过：Exit Code 0
- [ ] `requesting-code-review` skill 审查
- [ ] 提交：`feat: auto-generate session summary as default label`

### Task 9: CLI 增强（Overlay / fork 树 / diff 渲染）

**Files:**
- Modify: `src/cli/components/assistant-message.tsx`
- Modify: `src/cli/components/tool-execution.tsx`
- Create: `src/cli/components/diff-viewer.tsx`
- Test: `tests/access/cli.spec.tsx`

**Design Contracts:**

```typescript
// diff-viewer.tsx
export function DiffViewer({ oldText, newText }: { oldText: string; newText: string }): React.ReactElement;
// - 逐行 diff，+ 行绿色，- 行红色，未变行灰色
// - 折叠未变中间行（仅显示上下 3 行）

// assistant-message.tsx 改造：
// - 支持 overlay 模式：流式渲染时覆盖上一行，而非追加
// - tool_calls 折叠显示，点击展开

// tool-execution.tsx 改造：
// - edit 工具结果用 DiffViewer 渲染
// - bash 工具结果支持滚动（超出 20 行折叠）
```

**Behavior:** L1 CLI 输出追加式，工具结果冗长。L2 引入 overlay 流式 + diff 渲染，提升体验。

**TDD Cycle:**
- [ ] 编写失败测试覆盖：DiffViewer 渲染 +/- 行、overlay 模式覆盖、edit 工具结果用 diff
- [ ] 验证失败：`npm run test -- tests/access/cli.spec.tsx` → FAIL
- [ ] 实现
- [ ] 验证通过：Exit Code 0
- [ ] `requesting-code-review` skill 审查
- [ ] 提交：`feat: CLI overlay streaming and diff viewer for edit tool`

### Task 10: WebUI 拆分 Cloudflare Pages

**Files:**
- Create: `webui/` 目录（独立 WebUI 项目）
- Modify: `src/webui/index.html`
- Modify: `src/webui/index.ts`
- Create: `webui/wrangler.toml`
- Test: `tests/access/webui.spec.ts`

**Design Contracts:**

```typescript
// webui/ 独立项目结构：
// - package.json（lit + vite 构建）
// - wrangler.toml（Cloudflare Pages 配置）
// - src/ 源码（从 src/webui/ 迁移）
// - 构建：vite build → dist/
// - 部署：wrangler pages deploy dist/

// src/webui/index.ts 改造：
// - 通过环境变量 API_BASE 切换本地 / 生产 API
// - 本地：ws://localhost:8080
// - 生产：https://api.aptbot.de

// src/server.ts 改造：
// - serveHtml 仅在本地模式提供 HTML
// - 生产模式 WebUI 由 CF Pages 托管，API 由 Workers 代理
```

**Behavior:** L1 WebUI 与 API 同进程部署。L2 拆分 WebUI 到 CF Pages，提升 CDN 加速 + 独立部署。

**TDD Cycle:**
- [ ] 编写失败测试覆盖：API_BASE 切换、WebUI 独立构建、本地模式仍提供 serveHtml
- [ ] 验证失败：`npm run test -- tests/access/webui.spec.ts` → FAIL
- [ ] 实现
- [ ] 验证通过：Exit Code 0
- [ ] `requesting-code-review` skill 审查
- [ ] 提交：`feat: split WebUI to Cloudflare Pages with API_BASE switching`

---

## Phase 4: IM 渠道接入

### Task 11: Channel 接口抽象

**Files:**
- Modify: `src/bus/types.ts`
- Modify: `src/bus/channel-manager.ts`
- Test: `tests/bus/channel.spec.ts`

**Design Contracts:**

```typescript
// types.ts Channel 接口抽象：
export interface Channel {
  readonly type: 'websocket' | 'telegram' | 'feishu';
  send(msg: AgentEventEnvelope | ControlMessage): Promise<void>;
  close(): Promise<void>;
  isAlive(): boolean;
}

// channel-manager.ts 改造：
// - 支持 IM 渠道注册（不限于 WebSocket）
// - bindSession(sessionKey, channel) 接受任意 Channel 实现
// - IM 渠道连接时无 ?session=，由 IM 渠道自己管理 sessionKey 映射
```

**Behavior:** L1 ChannelManager 仅支持 WebSocket。L2 抽象 Channel 接口，为 IM 渠道接入做准备。

**TDD Cycle:**
- [ ] 编写失败测试覆盖：Channel 接口、bindSession 接受任意 Channel、IM 渠道无 ?session= 时由渠道映射
- [ ] 验证失败：`npm run test -- tests/bus/channel.spec.ts` → FAIL
- [ ] 实现
- [ ] 验证通过：Exit Code 0
- [ ] `requesting-code-review` skill 审查
- [ ] 提交：`refactor: abstract Channel interface for IM integration`

### Task 12: Telegram 渠道接入

**Files:**
- Create: `src/access/im/telegram-channel.ts`
- Create: `src/access/im/telegram-bot.ts`
- Modify: `src/server.ts`
- Test: `tests/access/im/telegram-channel.spec.ts`

**Design Contracts:**

```typescript
// telegram-channel.ts
export class TelegramChannel implements Channel {
  readonly type = 'telegram' as const;
  constructor(
    private bot: TelegramBot,
    private chatId: number,
    sessionKey: string,
  ) {}
  async send(msg: AgentEventEnvelope | ControlMessage): Promise<void>;
  // - assistant 消息：发送 Telegram message
  // - tool_call：折叠显示
  // - turn_end：标记完成
  // - 控制消息（session_changed 等）：不发送给用户
  async close(): Promise<void>;
  isAlive(): boolean;
}

// telegram-bot.ts
export class TelegramBot {
  constructor(token: string);
  async sendMessage(chatId: number, text: string): Promise<void>;
  async sendPhoto(chatId: number, photo: Buffer): Promise<void>;
  onMessage(handler: (chatId: number, text: string) => void): void;
  // - 接收用户消息
  // - chatId → sessionKey 映射（持久化到 data/telegram_sessions.jsonl）
  // - 首次消息创建新 session 并绑定 chatId
}

// server.ts 改造：
// - 启动时若有 TELEGRAM_BOT_TOKEN env，创建 TelegramBot 并注册
// - TelegramBot 收到消息时通过 ChannelManager 路由到 agent
```

**Behavior:** L2 首个 IM 渠道接入，用户可通过 Telegram 与 aptbot 交互。每个 Telegram chat 对应一个 session。

**TDD Cycle:**
- [ ] 编写失败测试覆盖：TelegramChannel send 各种消息类型、chatId → sessionKey 映射、首次消息创建 session
- [ ] 验证失败：`npm run test -- tests/access/im/telegram-channel.spec.ts` → FAIL
- [ ] 实现
- [ ] 验证通过：Exit Code 0
- [ ] `requesting-code-review` skill 审查
- [ ] 提交：`feat: integrate Telegram as first IM channel`

---

## Phase 5: 端到端验证与封仓

### Task 13: E2E 多 provider 故障转移

**Files:**
- Test: `tests/e2e/l2-provider-failover.spec.ts`

**Design Contracts:**
- 模拟主 provider 返回 500，验证自动 fallback 到备用 provider
- 验证 fatal 错误不 fallback
- 验证 retryable 错误先重试再 fallback

**TDD Cycle:**
- [ ] 编写失败测试
- [ ] 验证失败：`npm run test -- tests/e2e/l2-provider-failover.spec.ts` → FAIL
- [ ] 修复至通过
- [ ] `requesting-code-review` skill 审查
- [ ] 提交：`test: e2e multi-provider failover`

### Task 14: E2E Telegram 渠道

**Files:**
- Test: `tests/e2e/l2-telegram-channel.spec.ts`

**Design Contracts:**
- 模拟 Telegram bot 接收消息，验证 agent 响应通过 TelegramChannel 发送回
- 验证 chatId → sessionKey 映射持久化
- 验证多 chat 并发隔离

**TDD Cycle:**
- [ ] 编写失败测试
- [ ] 验证失败：`npm run test -- tests/e2e/l2-telegram-channel.spec.ts` → FAIL
- [ ] 修复至通过
- [ ] `requesting-code-review` skill 审查
- [ ] 提交：`test: e2e Telegram channel integration`

### Task 15: L2 封仓回归

**Files:**
- Test: `tests/e2e/l2-regression.spec.ts`
- Modify: `PLAN-L2.md`
- Modify: `CHANGELOG.md`
- Modify: `package.json`

**Design Contracts:**
- 全量回归：`npm test` 通过、`npx tsc --noEmit` 0 错误
- 手工测试：Telegram bot 实际交互、多 provider 故障转移演示、配置热重载演示
- `finishing-a-development-branch` skill 执行封仓流程

**TDD Cycle:**
- [ ] `npm test` 全绿
- [ ] `npx tsc --noEmit` 0 错误
- [ ] Telegram bot 实际交互验证
- [ ] 多 provider 故障转移演示
- [ ] 配置热重载演示
- [ ] `finishing-a-development-branch` skill 执行封仓流程
- [ ] 更新 PLAN-L2.md 顶部状态为 `✅ L2 COMPLETED`
- [ ] CHANGELOG.md 添加 0.3.0 章节
- [ ] package.json 版本升至 0.3.0
- [ ] 打 `v0.3.0` git tag
- [ ] 提交：`feat(l2): complete L2 with reliability and IM integration`

---

## Self-Review

### 设计决策回顾

1. **MixinProvider vs FallbackProvider：** L2 先做 MixinProvider（多 provider 串联），FallbackProvider + 熔断器留 L3。MixinProvider 更简单，覆盖 80% 场景。

2. **Config 热重载用 mtimeNs 而非 fs.watch：** fs.watch 跨平台兼容性差，mtimeNs 懒加载更稳定。每 5s 轮询检查 mtimeNs 变化。

3. **Hook 系统 8 点 vs 更多：** 8 个点覆盖 turn / tool / message / session 全生命周期，足够大多数插件需求。更多 hook 点留 L3。

4. **JSONL 历史读取突破 agent 约束：** 仅 wsServer 使用 readHistoryForReplay，agent 仍受禁令。这是必要的妥协，否则服务器重启后历史丢失。

5. **HttpOnly cookie vs token refresh：** L2 先做 HttpOnly cookie 防 XSS，token refresh（过期续期）留 L3。

6. **Telegram 优先于飞书/钉钉：** Telegram bot API 更简单，国际通用，作为 IM 接入的 PoC。

### 风险点

1. **MixinProvider 串联延迟：** 多 provider fallback 时累计延迟。L2 仅在 retryable 错误后 fallback，fatal 立即抛出。

2. **Config 热重载竞态：** 修改配置文件时可能有部分写入。L2 用原子写（write-to-tmp + rename）。

3. **Hook 系统性能：** 8 个 hook 点每个 turn 调用多次。L2 hook 必须异步且不阻塞主流程（超时 1s 后跳过）。

4. **JSONL 历史读取性能：** 大 session（10000+ 消息）读取慢。L2 限制 limit=20，仅返回最近 N 条。

5. **Telegram bot 单实例：** 单 bot 并发处理能力有限。L2 用 per-chatId 串行化（复用 L1 的 per-sessionKey 模式）。

### 不做的事

- FallbackProvider + 熔断器（L3）
- OAuth 第三方登录（L3）
- Session 分支/树结构（L3）
- 跨会话长期记忆（L3）
- 飞书/钉钉接入（L3）
- Token refresh 机制（L3）
- AgentLoop Layer 3（AgentHarness + phase 状态机，L3）
- Subagent 子代理管理（L3）

---

## 后续阶段展望

### L3（远期目标）
- FallbackProvider + 熔断器
- OAuth 认证
- Session 分支（树结构）
- 跨会话长期记忆（MEMORY.md / USER.md）
- 飞书/钉钉接入
- Token refresh 机制
- AgentLoop Layer 3（AgentHarness + phase 状态机）
- Subagent 子代理管理
- 跨进程恢复
- RpcMode / PrintMode
- 自演化 skill
- Plan Mode SOP

详细设计见 `docs/spec.md §12` 与 `docs/design-notes.md §12`。
