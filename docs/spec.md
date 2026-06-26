# aptbot 需求规格说明书

> 本文档为 aptbot 项目的最终确定方案，可直接进入详细设计与开发阶段。所有决策已定，不再包含对比讨论过程。

---

## 1. 项目定位

- **目标**：个人学习与工作助手 agent
- **技术栈**：TypeScript / Node.js（>= 20）
- **MVP 范围**：CLI + WebUI 双入口，单模型 ReAct 循环，3 个基础工具（bash/read/edit），短期会话记忆 + Working Memory，JSONL 持久化
- **后续阶段**：L2（多 provider 故障转移、Config 热重载、Hook 系统、L1 索引 skill）/ L3（IM 接入、subagent、跨进程恢复）

---

## 2. 全局架构

```
接入层 (CLI / WebUI / Channel)
   ↓
总线层 (MessageBus / AgentEventEnvelope)
   ↓
核心层 (AgentLoop / Provider / Tools / Memory)
   ↓
基建层 (Config / Persistence / Logger)
```

**依赖规则**：每层仅依赖其下层；同层模块通过明确接口协作；核心层不感知接入层存在。

---

## 3. AgentLoop

### 3.1 分层设计

| Layer | 名称 | 职责 | 状态 |
|---|---|---|---|
| Layer 1 | `agentLoop()` | 无状态生成器函数，流式调用 LLM + 执行工具 + 发事件 + steering/follow-up 双 while 循环 | 纯函数，可独立测试 |
| Layer 2 | `AgentSession` | 有状态封装，持有 context/steering 队列/session 存储，负责持久化与状态管理 | 持久化 |
| Layer 3 | `AgentHarness`（L3 待办） | 持久化 + phase 状态机 + 中断恢复，支持 subagent 与跨进程恢复 | 未实现 |

### 3.2 事件流（细粒度 AgentEvent union）

```typescript
export type AgentEvent =
  | { type: 'agent_start' }
  | { type: 'turn_start'; turnId: string }
  | { type: 'message_start'; messageId: string }
  | { type: 'message_delta'; text: string }
  | { type: 'reasoning_delta'; text: string }
  | { type: 'tool_call_start'; toolCallId: string; toolName: string }
  | { type: 'tool_call_delta'; toolCallId: string; arguments: string }
  | { type: 'tool_call_end'; toolCallId: string }
  | { type: 'tool_result'; toolCallId: string; success: boolean; summary: string }
  | { type: 'message_end'; messageId: string; stopReason: string }
  | { type: 'turn_end'; turnId: string }
  | { type: 'agent_end' }
  | { type: 'error'; message: string; retryable: boolean };
```

**事件顺序**：`agent_start` → 每轮（`turn_start` → `message_start` → deltas → `message_end` → 可选 tool calls → `tool_result` → `turn_end`）→ `agent_end`。

### 3.3 核心接口

```typescript
interface AgentLoopConfig {
  provider: Provider;
  model: Model;
  tools: ToolRegistry;
  context: Context;
  systemPrompt: string;
  signal?: AbortSignal;
  maxIterations?: number;  // 默认 10
}

function agentLoop(config: AgentLoopConfig): AsyncGenerator<AgentEvent, AgentMessage[]>;

interface AgentSession {
  run(userMessage: string): AsyncGenerator<AgentEvent>;
  pushSteering(message: AgentMessage): void;  // 中途打断注入
}

function createAgentSession(config: AgentSessionConfig): AgentSession;
```

### 3.4 错误处理（外置分层重试）

| Layer | 职责 | 触发 |
|---|---|---|
| Layer 0 | Provider 传输重试（5xx/429 指数退避 3 次） | Provider 层内置 |
| Layer 1 | 流式错误分类（retryable vs fatal） | `agentLoop` 收到 `error` 事件 |
| Layer 2 | 语义重试 / fallback provider 切换 | `AgentSession` 决策 |
| Layer 3 | 持久化恢复 / turn 原子性 | `AgentSession` 保证错误响应不持久化 |

### 3.5 上下文治理

- **MVP**：`transformContext` 单钩子 + `max_tool_result_chars` 截断（5000 token）
- **持久化与模型上下文分离**：`AgentMessage`（持久化）↔ LLM Message（治理后）双向转换

---

## 4. Provider 抽象层

### 4.1 设计：Api-Provider 分离

| 层 | 职责 | 复用 |
|---|---|---|
| `api/` | 协议实现（openai-responses / anthropic-messages / openai-completions） | 多 provider 共享同一 API |
| `providers/` | 服务商声明（id + apiKey + baseUrl + model 目录） | 新增 provider 只需写配置 |
| `models.ts` | Models 集合 + 认证 + 路由 | 按 model 找 provider → 委托 stream |

### 4.2 目录结构

```
src/core/provider/
├── api/                        # 协议实现层
│   ├── openai-responses.ts
│   ├── anthropic-messages.ts
│   └── openai-completions.ts
├── providers/                  # Provider 声明层
│   ├── openai.ts
│   ├── anthropic.ts
│   ├── deepseek.ts             # 复用 openai-responses API
│   └── custom.ts
├── types.ts                    # 类型定义
├── retry.ts                    # 传输重试（5xx/429 指数退避 3 次）
├── sanitize.ts                 # 消息治理（role alternation / empty content / image strip）
└── mixin.ts                    # MixinProvider（L2，多 provider 故障转移）
```

### 4.3 核心接口

```typescript
type Api = 'anthropic-messages' | 'openai-responses' | 'openai-completions';

interface Provider {
  readonly id: string;
  readonly name: string;
  readonly baseUrl?: string;
  readonly auth: { apiKey?: string; envVar?: string };
  getModels(): readonly Model[];
  stream(model: Model, context: Context, options?: StreamOptions): AssistantMessageEventStream;
}

interface Model {
  readonly provider: string;
  readonly id: string;
  readonly api: Api;
  readonly contextWindow: number;
  readonly maxTokens: number;
}
```

### 4.4 MVP 范围

- ✅ Api-Provider 分离
- ✅ Provider 层内置传输重试（5xx/429，指数退避 1s/2s/4s，最多 3 次）
- ✅ 消息治理 Provider 层内置（role alternation、empty content 修复）
- ✅ 认证：apiKey + 环境变量
- ✅ 模型目录：手动声明
- ⏳ FallbackProvider + 熔断器（L2）
- ⏳ OAuth 认证（L2）

---

## 5. Tool 系统

### 5.1 核心接口

```typescript
interface AgentTool<TParams = unknown, TDetails = unknown> {
  readonly name: string;
  readonly label: string;           // UI 显示名
  readonly description: string;
  readonly parameters: Record<string, unknown>;  // JSON Schema
  readonly executionMode?: 'sequential' | 'parallel';
  execute(
    toolCallId: string,
    params: TParams,
    signal?: AbortSignal,
  ): Promise<AgentToolResult<TDetails>>;
}

interface AgentToolResult<T = unknown> {
  content: (TextContent | ImageContent)[];  // 返回给 LLM
  details: T;                                // 结构化详情（给 UI/日志）
  terminate?: boolean;                       // 是否终止 agent
}

interface ToolRegistry {
  register(tool: AgentTool): void;
  unregister(name: string): void;
  get(name: string): AgentTool | undefined;
  has(name: string): boolean;
  getDefinitions(): ToolDefinition[];  // 面向 LLM 的 schema 数组
  getAll(): AgentTool[];
}
```

### 5.2 MVP 工具清单

| 工具 | name | 功能 | executionMode | 边界 |
|---|---|---|---|---|
| bash | `bash` | 执行 shell 命令 | sequential | 30s 硬超时（SIGTERM→2s→SIGKILL） |
| read | `read` | 读取文件内容，支持 offset/limit 分页 | parallel | >2MB 返回 `file_too_large` |
| edit | `edit` | 精确字符串替换 | sequential | per-file mutex，old_string 不唯一时拒绝 |
| update_working_memory | `update_working_memory` | 更新 key_info | sequential | key_info 截断到 2000 字符 |

### 5.3 设计要点

- **结构化返回**：`content` 返回给 LLM，`details` 给 UI，分离关注点
- **手动注册**：显式调用 `toolRegistry.register()`
- **默认串行**：保留 `executionMode` 字段为后续并行预留
- **异常捕获**：工具异常返回 `AgentToolResult.error`，不 crash agent loop

---

## 6. Memory 系统

### 6.1 设计要点

| 维度 | 决策 |
|---|---|
| 会话结构 | 线性（后续 L2 可扩展为树） |
| 存储后端 | JSONL（每会话一个 `.jsonl` 文件，append-only） |
| 压缩策略 | 会话内 Compaction（摘要作为 entry 留在会话内） |
| 压缩触发 | 实时兜底（每次 turn 后检查 token，超 `contextWindow - reserveTokens` 触发） |
| 摘要方式 | 增量摘要（保留 `previousSummary`，LLM 增量更新） |
| Split Turn | 线性结构按 user 消息切点，天然规避 |

### 6.2 SessionEntry 类型

```typescript
type SessionEntry =
  | { type: 'message'; id: string; message: AgentMessage; timestamp: number }
  | { type: 'compaction'; id: string; summary: string; tokensBefore: number; firstKeptEntryId: string; timestamp: number }
  | { type: 'label'; id: string; label: string; timestamp: number }
  | { type: 'working_memory'; id: string; keyInfo: string; timestamp: number };
```

### 6.3 核心接口

```typescript
interface SessionRepo {
  create(): Promise<Session>;
  open(id: string): Promise<Session>;
  list(): Promise<SessionMetadata[]>;
  delete(id: string): Promise<void>;
}

interface Session {
  readonly id: string;
  readonly metadata: SessionMetadata;
  getEntries(): Promise<SessionEntry[]>;
  append(entry: SessionEntry): Promise<void>;
  updateMetadata(patch: Partial<SessionMetadata>): Promise<void>;
}

interface CompactionSettings {
  enabled: boolean;
  reserveTokens: number;       // 默认 16384
  keepRecentTokens: number;    // 默认 20000
}
```

### 6.4 压缩流程

```
agentLoop turn_end →
  AgentSession.afterTurn() →
    estimateContextTokens(messages) →
      shouldCompact(tokens, contextWindow, reserve) ? →
        compact(session, model):
          1. findCutPoint(messages, keepRecentTokens) → 找到 user 消息切点
          2. messagesToSummarize = messages[0..cutPoint]
          3. previousSummary = 上一次 compaction entry 的 summary
          4. generateSummary(messagesToSummarize, previousSummary, model)
          5. append compaction entry 到 session
          6. 后续 turn 的 context 从 compaction entry 之后开始构建
```

### 6.5 Working Memory

**定位**：Compaction 的补充（非替代）。Compaction 是"被动全局压缩"，Working Memory 是"主动局部保鲜"。

| 维度 | Compaction | Working Memory |
|---|---|---|
| 触发 | 系统自动（token 阈值） | LLM 主动（工具调用） |
| 内容 | 全局摘要 | 任务关键信息（约束/进度/教训） |
| 注入 | 压缩后替代旧 context | 每轮叠加到 system prompt |
| 跨 session | 摘要存长期记忆（待办） | key_info 显式继承（`/continue <oldId>`） |
| token 成本 | 高（调 LLM 摘要） | 零（工具调用即任务执行） |

**MVP 范围**：
- ✅ `update_working_memory` 工具（LLM 自主决定何时更新）
- ✅ key_info 每轮注入 system prompt（`<key_info>` 块）
- ✅ `working_memory` SessionEntry 持久化
- ✅ session 恢复时从最后一条 `working_memory` entry 重建
- ✅ `/continue <oldSessionId>` 命令显式跨 session 继承（`passedSessions` 计数）

### 6.6 JSONL 容错（§14.1.1 边界）

| 场景 | 处理 |
|---|---|
| 最后一行不完整（写入时崩溃） | 读取时 `JSON.parse` 失败的行跳过，记录 warn，session 恢复到上一完整 entry |
| 并发写入竞争 | per-sessionId mutex（`async-mutex`），锁超时 5s |
| 完全损坏 | 返回空 session，备份原文件到 `.corrupt.bak` |
| 自动修复 | `repairJsonl` 使用 `fs.truncateSync` 截断破损尾部，仅保留合法行 |

---

## 7. Channel 抽象

### 7.1 设计：方案 E（类型化 bus）

nanobot 架构的 TypeScript 现代化重写：用 `AgentEventEnvelope`（带路由字段的 union type）替代 `OutboundMessage + metadata: Record<string, unknown>` hack，既保留 bus 的重试/合并/去重/多路复用能力，又恢复类型安全。

### 7.2 核心接口

```typescript
interface InboundMessage {
  readonly channel: string;
  readonly senderId: string;
  readonly chatId: string;
  readonly content: string;
  readonly media?: MediaContent[];
  readonly metadata: Record<string, unknown>;
  readonly sessionKey?: string;  // 默认 `${channel}:${chatId}`
}

interface AgentEventEnvelope {
  readonly sessionKey: string;
  readonly chatId: string;
  readonly channel: string;
  readonly event: AgentEvent;  // 原生 union type，类型安全
}

interface ChannelCapability {
  streaming: boolean;
  reasoning: boolean;
  richUi: boolean;
  fileEditEvents: boolean;
  editMessage: boolean;
  markdown: boolean | 'limited';
}

interface Channel {
  readonly name: string;
  readonly capabilities: ChannelCapability;
  readonly messageLengthLimit?: number;
  start(bus: MessageBus): Promise<void>;
  stop(): Promise<void>;
  consume(envelope: AgentEventEnvelope): void | Promise<void>;
}

interface MessageBus {
  publishInbound(msg: InboundMessage): Promise<void>;
  consumeInbound(): Promise<InboundMessage>;
  publishOutbound(envelope: AgentEventEnvelope): Promise<void>;
  consumeOutbound(): Promise<AgentEventEnvelope>;
}

interface ChannelManager {
  register(channel: Channel): void;
  startAll(): Promise<void>;
  stopAll(): Promise<void>;
  bindSession(sessionKey: string, channel: Channel): void;   // 多对一绑定
  unbindSession(sessionKey: string, channel: Channel): void;
  runDispatchLoop(): Promise<void>;  // 按 capability 过滤 + 路由 + 重试/合并/去重
}
```

### 7.3 数据流

```
入站:
  Channel.start() → 监听平台事件
    → bus.publishInbound(InboundMessage{...})
  AgentSession 消费:
    msg = await bus.consumeInbound()
    await agentSession.run(msg.content, { sessionKey: msg.sessionKey })

出站:
  AgentSession 产生事件:
    → bus.publishOutbound(AgentEventEnvelope{ sessionKey, chatId, channel, event })
  ChannelManager.runDispatchLoop():
    envelope = await bus.consumeOutbound()
    for channel of boundChannels[envelope.sessionKey]:
      if matchesCapability(channel.capabilities, envelope.event):
        await sendWithRetry(channel, envelope)  // 指数退避 + coalesce + 去重
```

### 7.4 能力过滤规则

| 事件类型 | 过滤条件 | 不匹配时 fallback |
|---|---|---|
| `message_delta` | `streaming === true` | 不投递，channel 在 `message_end` 时一次性收完整内容 |
| `reasoning_delta` / `reasoning_end` | `reasoning === true` | 不投递 |
| `tool_*`（带 richUi payload） | `richUi === true` | 投递简化版（纯文本 tool name + status） |
| `file_edit_events` | `fileEditEvents === true` | 不投递 |
| 其他（`turn_*`/`message_start`/`message_end`/`agent_*`） | 始终投递 | — |

### 7.5 MVP 范围

- ✅ Channels：CLI + WebSocket
- ✅ 多 channel 共享 session（`bindSession` 多对一）
- ✅ 能力声明（6 字段）
- ⏳ IM 接入（Telegram/飞书/钉钉/微信）：L2/L3
- ⏳ 权限模型（`allow_from` + pairing）：IM 阶段
- ⏳ Channel 自动发现：IM 阶段

---

## 8. CLI / WebUI 接入层

### 8.1 技术选型

| 维度 | 选择 |
|---|---|
| CLI 渲染引擎 | Ink + Yoga（React 组件树模型，与 WebUI 心智一致） |
| WebUI 框架 | Lit + Web Components（标准 WC，开发体验好） |
| 斜杠命令 | 统一 CommandRegistry，CLI/WebUI 共用定义，渲染各自实现 |
| UI 状态机 | reducer（`UIState = reducer(state, AgentEvent)`），纯函数易测试 |
| Channel 复用 | CLI 和 WebUI 都是 channel，consume `AgentEventEnvelope` |

### 8.2 统一 CommandRegistry

```typescript
interface Command {
  readonly name: string;
  readonly description: string;
  readonly aliases?: string[];
  execute(args: string[], ctx: CommandContext): Promise<CommandResult>;
}

interface CommandResult {
  output?: string;
  action?: 'exit' | 'new_session' | 'clear';
}

interface CommandRegistry {
  register(cmd: Command): void;
  get(name: string): Command | undefined;
  has(name: string): boolean;
  list(): Command[];
}
```

### 8.3 共享 UI 状态机

```typescript
interface UIState {
  messages: MessageViewItem[];
  isWorking: boolean;
  error?: string;
}

function coreReducer(state: UIState, event: AgentEvent): UIState;
```

**状态转换**：`turn_start` → `isWorking: true`；`message_start` → 追加流式 assistant 消息；`message_delta` → 追加文本；`message_end` → 标记非流式；`turn_end` → `isWorking: false`；`error` → 设置 error 并停止工作。

### 8.4 MVP 命令清单

| 命令 | 功能 |
|---|---|
| `/new` | 新建会话 |
| `/clear` | 清屏 |
| `/help` | 显示命令帮助 |
| `/model` | 显示/切换模型（MVP 仅打印当前） |
| `/session` | 显示会话信息 |
| `/continue` | 显式继承 working memory |
| `/exit` | 退出（仅 CLI） |

### 8.5 MVP 组件清单

**CLI（Ink，6 组件）**：`AssistantMessage`、`UserMessage`、`ToolExecution`、`WorkingLoader`、`Footer`、`InputEditor`

**WebUI（Lit，6 组件）**：`<assistant-message>`、`<user-message>`、`<tool-execution>`、`<working-indicator>`、`<footer-bar>`、`<input-box>`

### 8.6 MVP 范围

- ✅ CLI：基础流式 + 6 组件 + 5 命令
- ✅ WebUI：单会话聊天 + 流式 + 工具展示 + 6 组件
- ⏳ CLI Overlay 选择器 / 认证 UI / fork 树 / diff 渲染：L2
- ⏳ WebUI 会话侧边栏 / fork 树 / 文件预览 / 媒体：L2

---

## 9. 部署设计

### 9.1 部署矩阵

| 环境 | 入口 | 后端 | 工具能力 | 存储 | 认证 |
|---|---|---|---|---|---|
| 本地主力（局域网） | `http://192.168.x.x:3000` | Node.js | 完整 | JSONL 本地文件 | 可选 token |
| 本地主力（公网） | `https://<自有域名>` | Caddy → Node.js | 完整 | JSONL 本地文件 | 强 token |
| CF 演示 | `https://demo.aptbot.de` | Workers + Pages | 受限（web_fetch + update_working_memory） | DO SQLite + KV | 简单 token |

### 9.2 本地双模式

```
局域网设备 ──HTTP──> 192.168.x.x:3000  ┐
                                      ├──> Node.js (:3000)  [监听 0.0.0.0]
公网用户 ──HTTPS──> 自有域名 ──────────┘     （Caddy 终止 TLS，转 HTTP 到本机）
```

**关键设计**：
- Node.js 始终跑 HTTP，TLS 终止在 Caddy（自动 Let's Encrypt）
- UFW 防火墙限制 3000 端口仅本机访问，公网流量必须经反代
- 进程管理：systemd（`Restart=on-failure`，开机自启）
- 配置开关：`DEPLOY_MODE=dual` 同时启用两个入口的认证策略

### 9.3 CF 演示版（demo.aptbot.de）

```
Browser ──HTTPS──> demo.aptbot.de
                       │
       ┌───────────────┴───────────────┐
       │                               │
   Pages (WebUI 静态)            Workers (轻量 agent loop)
                                       │
                                       ├─ LLM 流式调用（等待不计 CPU）
                                       ├─ web_fetch / update_working_memory
                                       └─ DO SQLite（会话/工作记忆）+ KV（配置）
```

**CF 免费额度评估**：Workers 10万请求/天 + 10ms CPU/请求（LLM 等待不计 CPU，单 turn 实际消耗 2-5ms）；DO SQLite 5GB 存储；KV 10万读/天。Demo 用量足够。

### 9.4 代码适配（运行时注入）

**共享层不变**：coreReducer / CommandRegistry / Provider / AgentLoop / Memory / Channel

**差异层接口**：

```typescript
interface StorageAdapter {
  readSession(id: string): Promise<SessionEntry[]>;
  appendSession(id: string, entry: SessionEntry): Promise<void>;
  listSessions(): Promise<SessionMetadata[]>;
  readWorkingMemory(sessionId: string): Promise<WorkingMemory | null>;
  writeWorkingMemory(sessionId: string, wm: WorkingMemory): Promise<void>;
}

// 本地实现：FileStorage（JSONL 文件）
// CF 实现：CloudflareStorage（DO SQLite + KV）

function createToolRegistry(deploy: 'local' | 'cf'): ToolRegistry;
// local: 完整工具集
// cf: 仅 web_fetch + update_working_memory
```

**启动入口分流**：按 `DEPLOY` 环境变量选择 `FileStorage` / `CloudflareStorage` 与对应 ToolRegistry。

### 9.5 认证策略

| 环境 | 认证方式 |
|---|---|
| 局域网 | 可选 `?token=aptbot_xxx`（信任度高可关闭） |
| 公网反代 | 强制 `Authorization: Bearer aptbot_<32字符>` + 推荐 Cloudflare Access 兜底 |
| CF 演示 | 简单 token + 可选 Turnstile 人机校验 |

### 9.6 域名规划

| 域名 | 用途 |
|---|---|
| `aptbot.de` | 主站（预留） |
| `demo.aptbot.de` | CF 演示版（CNAME → Workers/Pages） |
| `<自有域名>` | 本地主力公网入口（A/AAAA → 服务器 IP，经 Caddy 反代） |
| `192.168.x.x:3000` | 本地局域网入口 |

---

## 10. 技术边界

### 10.1 异常与边界处理

#### 10.1.1 Memory 边界

| 场景 | 处理 |
|---|---|
| JSONL 最后一行不完整 | 跳过坏行 + warn 日志，session 恢复到上一完整 entry |
| JSONL 并发写入竞争 | per-sessionId mutex，锁超时 5s |
| 磁盘满（ENOSPC） | 发 `error` 事件，agent loop 终止当前 turn，不持久化本 turn 结果 |
| Compaction 中断（进程崩溃） | 非破坏性：生成 summary → 写入新 entry → 标记旧 entries。中断最多丢失 summary，旧 entries 完整 |
| Compaction 摘要 LLM 调用失败 | 重试耗尽后跳过本轮压缩，保留旧 entries 不变，发 `compaction_skipped` warn 事件，下个 turn 后再尝试 |
| session 文件不存在 | 返回空 session，视为新 session |
| key_info 长度溢出 | 截断到 2000 字符 + warn 日志 |

#### 10.1.2 Tool 边界

| 场景 | 处理 | 默认值 |
|---|---|---|
| bash 超时 | SIGTERM → 等 2s → SIGKILL，返回 `timeout_error` | 30s |
| bash 进程泄漏 | 父进程退出时 `process.exit` hook 杀所有子进程 | — |
| edit 并发冲突 | per-filePath mutex，串行化同一文件的并发 edit | — |
| read 大文件 | 返回 `file_too_large`，建议分页 | >2MB |
| 工具执行异常 | 捕获所有异常，返回 `AgentToolResult.error`，让 LLM 决定是否重试 | — |

#### 10.1.3 Session 恢复边界

| 场景 | 处理 |
|---|---|
| JSONL 完全损坏 | 返回空 session + `error` 事件，备份原文件到 `.corrupt.bak` |
| working_memory entry 损坏 | 跳过该 entry，从更早的 working_memory entry 恢复 |
| session ID 不存在 | 创建新 session（幂等语义） |

#### 10.1.4 WebSocket 边界

| 场景 | 处理 |
|---|---|
| 客户端断连 | agent loop 继续执行，事件缓冲到 outbound 队列（上限 1000 条） |
| 缓冲溢出（>1000 条） | 丢弃最旧的 `message_delta`/`reasoning_delta`，保留 `tool_call`/`tool_result`/`message_end` |
| 心跳超时 | 60s 无心跳响应则关闭连接 |
| 重连后状态同步 | 客户端发 `lastEventSeq`，服务端重放缓冲；seq 已丢弃则发 `resync_required` 全量拉取 |
| 入站消息大小超限 | 单条 InboundMessage.content 上限 64KB，media 单文件 5MB，超出返回 `inbound_too_large` 错误并关闭连接 |
| 入站消息频率限制 | 单连接 10 条/秒，超出返回 `rate_limited` 警告；连续 3 次超限关闭连接 |

#### 10.1.5 Provider 流式边界

| 场景 | 处理 | 边界值 |
|---|---|---|
| 首字节超时（TTFB） | 视为传输错误，触发 Provider 层重试 | 5000ms |
| chunk 间超时 | 视为流中断，触发重试；已 yield 的 chunk 不撤回 | 1500ms |
| 流被 LLM 主动中止 | 正常结束当前 turn，不重试 | — |
| rate limit（429） | Provider 层指数退避重试 3 次；仍失败则 AgentSession 层切换 fallback（L2） | — |
| 鉴权失败（401/403） | 分类为 `fatal`，不重试，直接发 `error` 事件并终止 turn，提示用户检查 apiKey 配置 | — |
| 参数错误（400） | 分类为 `fatal`，不重试，发 `error` 事件，提示模型/参数不兼容 | — |
| 网络错误（ECONNRESET / ETIMEDOUT） | 视为传输错误，按 5xx 重试策略处理 | — |

#### 10.1.6 Channel/MessageBus 边界

| 场景 | 处理 |
|---|---|
| `bus.publishInbound()` 队列满 | 队列上限 100 条，溢出返回 `inbound_queue_full` 错误并丢弃最旧的非 `agent_start` 消息 |
| `Channel.start()` 失败（端口占用 / IM 鉴权 401） | ChannelManager 捕获异常，记录 `channel_start_failed` 事件，不阻塞其他 channel 启动；启动失败的 channel 不参与 dispatch |
| `Channel.consume()` 渲染异常 | 捕获异常 + 记录日志，本条 envelope 跳过该 channel，不影响其他 channel 投递 |
| `ChannelManager.runDispatchLoop()` 全部 channel 投递失败 | 保留 envelope 到死信队列（上限 100 条），发 `dispatch_dead_letter` warn，不阻塞 agent loop |
| `bindSession` 重复绑定 | 幂等：同 channel 重复 bind 不报错，仅记录 debug 日志 |
| `unbindSession` 解绑未注册 sessionKey | 幂等：不报错，记录 debug 日志 |
| Channel 启动顺序 | `ChannelManager.startAll()` 并行启动所有 channel，单个失败不回滚已启动的 channel |

#### 10.1.7 AgentLoop 边界

| 场景 | 处理 |
|---|---|
| `maxIterations` 达到上限（默认 10） | 发 `error` 事件（`message: 'max_iterations_exceeded'`, `retryable: false`），正常结束 agent loop，已完成的 turn 结果持久化 |
| `AbortSignal` 触发 | 停止 provider 流式 yield；对进行中 `tool_call` 转发 abort；已 yield 事件保留；发 `agent_end` 后退出 |
| `pushSteering` 队列上限 | 队列上限 5 条，超出丢弃最旧的 steering 消息 + warn 日志 |
| steering 注入时机 | 仅在 turn 之间注入，不中断当前 turn 的 LLM 流式 |
| AgentLoop generator 提前 return() | 触发 finally 块清理：cancel 进行中 tool_call、close provider stream、发 `agent_end` |

### 10.2 资源上限

| 约束 | 上限 |
|---|---|
| Node.js 进程内存 | 512MB（systemd `MemoryMax=512M`） |
| 单 session JSONL 文件 | 50MB（超出触发强制 Compaction；100MB 硬上限拒绝写入） |
| WebSocket 最大连接 | 50（单进程） |
| AgentEventEnvelope 缓冲 | 1000 条/连接 |
| bash 子进程数 | 10 并发 |
| grep/glob 结果 | 500 条 |
| read 单文件 | 2MB |
| web_fetch 响应体 | 1MB |
| key_info 长度 | 2000 字符（MVP） |
| WebSocket 入站单消息 | 64KB（content）+ 5MB（单 media） |
| WebSocket 入站频率 | 10 条/秒/连接 |
| InboundMessage 队列 | 100 条 |
| Dispatch 死信队列 | 100 条 |
| Steering 队列 | 5 条/session |
| 长跑进程 RSS 增长预算 | 稳定运行 24h 后 RSS 增长 ≤ 50MB（不含 JSONL 文件缓存） |

### 10.3 超时

| 操作 | 超时 | 处理 |
|---|---|---|
| bash 执行 | 30s | SIGTERM → 2s → SIGKILL |
| read 文件 | 5s | 返回 `read_timeout` |
| edit 文件 | 5s | 返回 `edit_timeout` |
| grep/glob | 10s | 返回 `search_timeout` |
| web_fetch | 15s | 返回 `fetch_timeout` |
| LLM 首字节（TTFB） | 5000ms | 触发 Provider 重试 |
| LLM chunk 间隔 | 1500ms | 视为流中断，触发重试 |
| WebSocket 心跳 | 60s | 关闭连接 |
| Provider 重试间隔 | 1s/2s/4s（指数退避） | 最多 3 次 |

### 10.4 不变量

| 不变量 | 保证方式 |
|---|---|
| AgentEventEnvelope 顺序保证 | 单 channel 内事件严格按生成顺序入队/出队（FIFO） |
| SessionEntry 追加语义 | 只 append 不 modify（Compaction 也是 append summary + mark old） |
| Working Memory 单调更新 | 每次 `update_working_memory` 覆盖整个 keyInfo |
| JSONL 行完整性 | 每行一个完整 JSON，写入用 `JSON.stringify` + `\n` |
| 工具调用 ID 唯一性 | `tool_call_id` 全局唯一（`crypto.randomUUID()`） |
| turn 原子性 | 单 turn 内所有 events 要么全部持久化要么全部不持久化（错误响应不持久化） |

### 10.5 Token 计算

| 约束 | 策略 |
|---|---|
| 估算精度 | 用 `tiktoken`（OpenAI）或 provider usage 字段，不自行实现 tokenizer |
| Compaction 触发阈值 | 上下文达到 model maxTokens 的 80% |
| Compaction 目标长度 | 压缩到 maxTokens 的 30% |
| 工具结果截断 | 单工具结果超过 5000 token 时截断，尾部附 `\n... [truncated]` |
| 估算降级策略 | 优先 `tiktoken`（OpenAI 模型）→ 其次 provider 返回的 usage 字段 → 最后字符数估算（`chars / 4`）+ warn 日志 |
| Compaction LLM 调用 token 预算 | 摘要请求 maxTokens 上限 2048，输入为 messagesToSummarize + previousSummary，超长时按 `keepRecentTokens` 调小 cutPoint |

### 10.6 事件循环与文件描述符

| 约束 | 处理 |
|---|---|
| 长同步操作 | JSON.parse 大 messages（>1MB）、Compaction 摘要生成必须 `setImmediate` 让出 event loop |
| 大文件读写 | read 工具读 >1MB 文件用流式读取 |
| 批量 session 列表 | `/list` 分页，每页 20 条 |
| JSONL 文件句柄 | 不保持长开句柄，每次 read/write 后 close |
| WebSocket 句柄 | 连接关闭时 `removeAllListeners` + `terminate()` |

### 10.7 Logger 约束

| 约束 | 规格 |
|---|---|
| 输出目标 | stdout（CLI 前台）+ `logs/aptbot.log`（文件，所有部署模式） |
| 日志级别 | trace/debug/info/warn/error，运行时按 `LOG_LEVEL` 环境变量切换，默认 info |
| 文件 rotation | 单文件 10MB，保留 5 个轮转文件（`aptbot.log.1` ~ `aptbot.log.5`），超出删除最旧 |
| 写入方式 | 异步写入（`pino` 或等价方案），禁止同步 fs 写入阻塞 event loop |
| 敏感信息脱敏 | apiKey / token 字段自动 mask 为 `aptbot_***`，session content 不入日志 |
| 结构化格式 | JSON 行（`{ts, level, module, msg, ...props}`），便于 grep 与后续 L1 索引 |

### 10.8 Config Schema 校验

| 约束 | 规格 |
|---|---|
| 配置文件路径 | `./config/aptbot.json`（默认），可由 `APTBOT_CONFIG` 环境变量覆盖 |
| Schema 校验 | 启动时用 `zod` 校验，失败则 stderr 打印错误并退出（exit code 1） |
| 必填字段 | `providers`（至少 1 个）、`defaultModel` |
| 环境变量优先级 | env var > config file > 默认值；apiKey 优先从 `${provider.auth.envVar}` 读取 |
| 校验失败降级 | MVP 不降级，直接退出；L2 引入 `--strict=false` 容错模式 |
| 热重载校验 | L2 mtimeNs 触发，校验失败保留旧配置 + warn 日志，不崩溃进程 |

### 10.9 AbortSignal 传播契约

| 模块 | abort 响应时限 | 清理时序 |
|---|---|---|
| Provider.stream | 收到 abort 后 100ms 内停止 yield，关闭底层 HTTP 流 | 释放 HTTP connection，已 yield chunk 不撤回 |
| Tool.execute | 收到 abort 后 500ms 内返回 `AgentToolResult.error(aborted)` | bash: SIGTERM → 2s → SIGKILL；read/edit: close fd |
| Memory.append | 收到 abort 后 50ms 内 reject promise | 不写入部分数据，保证 append 原子性 |
| AgentSession.run | generator return() 后 200ms 内完成 finally 清理 | cancel 进行中 tool_call → close provider stream → flush pending events → 发 `agent_end` |

### 10.10 Timestamp 约束

| 约束 | 规格 |
|---|---|
| 精度 | 毫秒（ms），用 `Date.now()` |
| 时区 | UTC（存储），UI 展示层转本地时区 |
| 单调性 | 同一 turn 内多个 entry 的 timestamp 允许相同（同 ms），按 append 顺序保证 FIFO |
| 字段命名 | `timestamp: number`（统一命名，禁止 `ts`/`time`/`createdAt` 混用） |

### 10.11 JSONL 编码约束

| 约束 | 规格 |
|---|---|
| 文件编码 | UTF-8 无 BOM |
| 换行符 | LF（`\n`），禁止 CRLF |
| 行格式 | 每行一个完整 `JSON.stringify(entry)` + `\n`，禁止多行 JSON |
| 文件末尾 | 必须 trailing newline（最后一行后要有 `\n`） |
| 文件创建 | 首次 append 自动创建，目录不存在时 `mkdirp` 递归创建（权限 0o755） |

### 10.12 文件路径约束

| 约束 | 规格 |
|---|---|
| Session JSONL 路径模板 | `./sessions/<sessionId>.jsonl`，sessionId 为 `crypto.randomUUID()` |
| 路径类型 | 相对路径（相对于 `process.cwd()`），运行目录固定 |
| macOS Unicode 规范化 | 文件名仅使用 ASCII（UUID），规避 NFC/NFD 差异 |
| 路径长度上限 | 限制 255 字符（含扩展名），超出 reject |
| 工作目录锁定 | 启动时 `process.chdir()` 到配置目录，运行中不切换 |
| 路径遍历防护 | sessionId 必须匹配 `/^[a-f0-9-]{36}$/`，拒绝含 `..`/`/` 的非法 ID |

### 10.13 进程信号处理

| 信号 | 处理 |
|---|---|
| SIGINT（Ctrl+C） | 标记 `isShuttingDown=true` → 停止接受新 inbound → 等待进行中 turn 完成（超时 10s）→ flush 日志 → exit(0)；超时则强制 exit(1) |
| SIGTERM（systemd stop） | 同 SIGINT 流程，但等待超时延长到 30s（systemd `TimeoutStopSec=30s` 对齐） |
| SIGHUP | MVP 忽略（L2 触发 config 热重载） |
| 优雅关闭数据语义 | 强制 exit 时进行中 turn 数据不持久化（接受丢失）；已持久化的 entry 不受影响 |
| 子进程清理 | 父进程 exit 前 `process.exit` hook 杀所有 bash 子进程（SIGKILL） |

### 10.14 进程级异常兜底

| 异常类型 | 处理 |
|---|---|
| `uncaughtException` | 记录 error 日志 → flush 日志 → exit(1)（不尝试 recover，避免状态不一致） |
| `unhandledRejection` | 记录 error 日志 → 不退出进程（Node.js 默认未来版本会退出，提前兼容）→ 上报 metrics |
| OOM（systemd 触发） | systemd `Restart=on-failure` 自动重启，JSONL 已持久化的 turn 不丢失 |
| 内存使用监控 | 每 60s 采样 `process.memoryUsage().rss`，超过 450MB（512MB 的 87.5%）发 warn 日志 |
| 死循环检测 | 单 turn 执行超过 5 分钟发 warn，超过 10 分钟发 error 并自动 abort |

---

## 11. 测试与验收

### 11.1 测试分层

| 层级 | 范围 | 依赖处理 |
|---|---|---|
| Unit | 模块内函数/类的纯逻辑测试 | mock 所有外部依赖 |
| Integration | 多模块协作 | mock LLM，用真实 fs/JSONL |
| E2E | 完整 agent loop | mock LLM，验证事件流序列 |

### 11.2 核心断言点

- **AgentLoop**：单 turn 事件序列完整；tool_call → tool_result → message_start 顺序正确；steering 注入后下个 turn 包含；错误响应不持久化；`maxIterations` 达到上限发 `error` 事件且 `retryable=false`；AbortSignal 触发后发 `agent_end` 且进行中 tool_call 被 cancel
- **Provider**：5xx 自动重试 3 次；429 指数退避；流式中断后已 yield chunk 不撤回；401/403 分类为 fatal 不重试；TTFB 超 5000ms 触发重试；chunk 间超 1500ms 触发重试
- **Tool**：bash 超时杀进程；edit 幂等性；read 大文件拒绝；工具异常被捕获不 crash；AbortSignal 触发后 500ms 内返回 `aborted` 错误
- **Memory**：JSONL 尾行损坏可恢复；Compaction 后旧 entries 标记；session 恢复重建 workingMemory；key_info 截断到 2000 字符；Compaction LLM 失败后跳过且保留旧 entries；JSONL 完全损坏返回空 session 并备份 `.corrupt.bak`
- **Channel**：WebSocket 断连后 agent loop 继续；重连后 backlog 重放；缓冲溢出丢弃细粒度事件；多 channel fanout 顺序一致；`resync_required` 路径在 seq 已丢弃时触发；入站消息超 64KB 返回 `inbound_too_large` 并关闭连接；Channel.start 失败不阻塞其他 channel
- **Config**：配置文件缺失时退出 code 1；schema 校验失败打印明确错误；env var 覆盖 config file 值；apiKey 优先从 `envVar` 读取；必填字段缺失时拒绝启动
- **CommandRegistry**：未知命令返回 `unknown_command` 提示；`/help` 列出所有已注册命令；命令别名正确解析；`/continue <不存在 id>` 返回友好错误；`/exit` 触发 `action: 'exit'`
- **UIState coreReducer**：`turn_start` 后 `isWorking=true`；`message_delta` 正确累积到当前消息；`message_end` 后停止累积；`turn_end` 后 `isWorking=false`；`error` 事件后 `isWorking=false` 且 `error` 字段被设置；连续多个 `tool_call_start` 顺序保持
- **StorageAdapter（FileStorage 实现）**：`readSession(不存在 id)` 返回空数组不抛错；`appendSession` 原子写入（中断不破坏现有行）；`listSessions` 按mtime 排序；接口契约与 CloudflareStorage 实现行为一致（同输入同输出）

### 11.3 MVP 验收标准（11 项最小闭环）

**定义**：单会话 + 单模型 + 3 工具（bash/read/edit）+ 流式输出 + 持久化恢复

| # | 验收项 | 通过标准 |
|---|---|---|
| 1 | 基础对话 | 用户输入 → LLM 流式响应 → 消息完整显示 |
| 2 | 工具调用 | LLM 调用 bash → 执行 → 结果回传 → LLM 继续生成 |
| 3 | 多轮对话 | 连续 3 轮对话，context 正确累积 |
| 4 | 持久化 | 进程重启后恢复历史 |
| 5 | Working Memory | LLM 调用 `update_working_memory` → 重启后 keyInfo 恢复 |
| 6 | 错误恢复 | LLM 返回错误 → Provider 重试 → 恢复或优雅降级 |
| 7 | WebSocket 断连重连 | 断连 → 重连 → backlog 重放 → 状态一致 |
| 8 | CLI 命令 | `/new` `/clear` `/help` `/model` `/continue` `/exit` 全部可用 |
| 9 | WebUI 基础 | 浏览器访问 → 流式显示 → 工具调用渲染 |
| 10 | Compaction | 长对话触发 Compaction → summary 生成 → 上下文长度下降 |
| 11 | 跨 session 继承 | `/continue <oldId>` → 新 session 的 keyInfo 与 oldId 最后一条 `working_memory` entry 一致；`passedSessions` 计数 +1 |

---

## 12. 后续待办（L2/L3）

### 12.1 L2 待办

| 模块 | 待办 |
|---|---|
| Provider | MixinProvider（多 provider 故障转移 + 弹回主 provider + 流式不切已 yield） |
| Config | mtimeNs 懒加载热重载 + 整体重载 + 校验失败降级 |
| Hook | 8 hook 点 + 同步 + ctx 允许 mutate + priority 排序 |
| /session | 动态属性（白名单 5 项 + 文件值逃生口 + `/session.reset`） |
| Skills | L1 索引（行数/字节/tags + lastUsed 排序 + 4K token 预算） |
| CLI | Overlay 选择器 / 认证 UI / fork 树 / diff 渲染 / thinking 折叠 |
| WebUI | 会话侧边栏 / fork 树 / 文件预览 / 媒体 / 设置面板 / 认证页 |
| Channel | IM 接入（Telegram/飞书/钉钉/微信）+ 权限模型 + 自动发现 |
| 部署 | WebUI 拆 CF Pages + R2 文件工具 + 多用户隔离 |

### 12.2 L3 待办

| 模块 | 待办 |
|---|---|
| AgentLoop | Layer 3 AgentHarness（持久化 + phase 状态机 + 中断恢复） |
| Subagent | 子代理生命周期管理 |
| 跨进程恢复 | CLI 重启后继续上次对话 |
| 会话分支 | 线性 → 树结构（fork/clone/tree） |
| 跨会话长期记忆 | MEMORY.md / USER.md / SOUL.md + GitStore 版本管理 |
| 闲置 TTL 压缩 | AutoCompact 后台扫描 + 压缩不活跃会话 |
| RpcMode | JSONL over stdin/stdout，供外部应用嵌入 |
| PrintMode | 一次性 stdin → stdout，CI/脚本场景 |
