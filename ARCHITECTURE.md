# aptbot 架构

> 自底向上四层架构，每层仅依赖其下层；核心层不感知接入层存在。

## 分层总览

```
┌─────────────────────────────────────────────────┐
│  接入层 (access / cli / webui)                   │
│  WebSocketServer · chat-page · Ink CLI · Lit UI  │
├─────────────────────────────────────────────────┤
│  总线层 (bus)                                    │
│  MessageBus (入站/出站双队列) · ChannelManager    │
├─────────────────────────────────────────────────┤
│  核心层 (core)                                   │
│  Provider · Tool · Memory · AgentLoop/Session    │
├─────────────────────────────────────────────────┤
│  基建层 (infrastructure)                         │
│  Config · Logger · JSONL · FileStorage · Process │
└─────────────────────────────────────────────────┘
        │
        ▼
   shared/ (commands · ui-state)  跨层共享
```

## 1. 基建层 `src/infrastructure/`

| 模块 | 职责 |
|------|------|
| `config-types.ts` | zod schema 定义 `AptbotConfig`，支持 `apiKey` 或 `envVar` 引用 |
| `config-loader.ts` | 读取 `config/aptbot.json`（或 `APTBOT_CONFIG` 路径），`resolveApiKey` 优先级：apiKey → envVar |
| `logger.ts` | pino 异步 logger，10MB rotation 保留 5 份，apiKey/token 脱敏 |
| `jsonl.ts` | JSONL UTF-8 LF + trailing newline，增量流式解析，破损行容错 |
| `jsonl-mutex.ts` | per-sessionId async-mutex，5s 超时 |
| `file-storage.ts` | `StorageAdapter` 实现：`readSession` / `appendSession` / `listSessions` / 完全损坏备份 |
| `process-handler.ts` | SIGINT 10s / SIGTERM 30s / SIGHUP ignore；uncaughtException exit(1)；memory monitor；turn watchdog |

## 2. 核心层 `src/core/`

### 2.1 Provider `core/provider/`

| 模块 | 职责 |
|------|------|
| `types.ts` | `Provider` / `Model` / `Context` / `AssistantMessageEvent` 联合类型 |
| `dual-clock.ts` | TTFB 5s + chunk 1.5s 双时钟流式控制器 |
| `retry.ts` | 401/403/400 fatal 不重试；429/5xx 指数退避 1s/2s/4s 最多 3 次 |
| `sanitize.ts` | 消息内容脱敏与规范化 |
| `api/openai-completions.ts` | OpenAI Chat Completions 协议（含 tool_calls / tool_call_id） |
| `api/openai-responses.ts` | OpenAI Responses 协议 |
| `api/anthropic-messages.ts` | Anthropic Messages 协议 |
| `api/sse-fetch.ts` | 共享 SSE fetch 生成器（消除重复代码） |
| `models.ts` | Provider 工厂与 model 注册表 |
| `providers/{openai,anthropic,deepseek}.ts` | 厂商声明（baseUrl / envVar / models） |

### 2.2 Tool `core/tool/`

| 模块 | 职责 |
|------|------|
| `types.ts` | `AgentTool` 接口 + `ToolRegistry` |
| `tools/bash.ts` | 30s 硬超时 SIGTERM→2s→SIGKILL，stdout/stderr 截断 |
| `tools/read.ts` | 2MB 上限返回 `file_too_large`，5s 超时，流式读取 |
| `tools/edit.ts` | per-filePath mutex，old_string 不唯一拒绝，5s 超时 |
| `tools/update-working-memory.ts` | keyInfo 2000 字符截断 |
| `tools/path-guard.ts` | 共享路径遍历防护 + tool error 构造 |

### 2.3 Memory `core/memory/`

| 模块 | 职责 |
|------|------|
| `types.ts` | `SessionEntry` 联合类型 + UUID 路径校验（`/^[a-f0-9-]{36}$/`） |
| `agent-message.ts` | `AgentMessage` 与 ContentBlock 类型 |
| `session-repo.ts` | 幂等 open/create session |
| `working-memory.ts` | 单调覆盖 keyInfo，`/continue` 跨 session 继承 |
| `compaction.ts` | token 3 级估算（tiktoken → usage → chars/4），80% 触发，30% 目标，LLM 失败保留旧 entries |

### 2.4 Agent `core/agent/`

| 模块 | 职责 |
|------|------|
| `events.ts` | `AgentEvent` 联合类型（turn_start/end, message_*, tool_call_*, error 等） |
| `loop.ts` | ReAct 循环：maxIterations 上限 + AbortSignal 传播 + steering queue |
| `session.ts` | `AgentSession`：turn 原子性（错误不持久化），`loadHistory()` 懒加载 JSONL 历史 |

## 3. 总线层 `src/bus/`

| 模块 | 职责 |
|------|------|
| `types.ts` | `Channel` 接口 + `AgentEventEnvelope`（sessionKey/chatId/channel/event/seq） |
| `message-bus.ts` | `InMemoryMessageBus`：入站队列 100 / 出站队列 100，溢出丢弃最旧 |
| `channel-manager.ts` | 多 channel 注册 + `bindSession(sessionKey, channel)` 多对一绑定 + dispatch loop + 死信队列 100 |

### 事件流

```
用户输入 → WS → InboundMessage → MessageBus.consumeInbound()
                                          │
                                  runInboundLoop 消费
                                          │
            ┌─────────────────────────────┴─────────────┐
            ▼                                           ▼
     slash 命令拦截                              AgentSession.run()
     (registry.resolve)                          (yield AgentEvent)
            │                                           │
            ▼                                           ▼
     describeCommandResult → emit envelope    emit envelope
                                          │
                              bus.publishOutbound()
                                          │
                              ChannelManager.dispatchLoop()
                                          │
                              bindSession → wsChannel.consume()
                                          │
                              wsServer.broadcast() → 浏览器
```

## 4. 接入层

### 4.1 WebSocket `src/access/`

| 模块 | 职责 |
|------|------|
| `websocket-server.ts` | WS 服务，入站限流 64KB content / 10 msg/s，heartbeat 60s，resync 协议 |
| `chat-page.ts` | 内联 HTML（含 Lit + Web Components），工具结果 max-height 200px + 800 字符截断 |

### 4.2 CLI `src/cli/`

Ink + Yoga + React，6 个组件：`assistant-message` / `user-message` / `tool-execution` / `working-loader` / `footer` / `input-editor`。

### 4.3 WebUI `src/webui/`

Lit + Web Components，6 个组件：`assistant-message` / `user-message` / `tool-execution` / `working-indicator` / `footer-bar` / `input-box`。

## 5. 共享层 `src/shared/`

| 模块 | 职责 |
|------|------|
| `commands/registry.ts` | `CommandRegistry` + 9 个内置 slash 命令 |
| `ui-state/reducer.ts` | `coreReducer` UIState 状态机，CLI 与 WebUI 共用 |

## 6. 服务器装配 `src/server.ts`

`startServer(config)` 装配所有层：

1. `loadConfig()` → 读 `config/aptbot.json` + `resolveApiKey`（从 `process.env.CUSTOM_API_KEY`）
2. `FileStorage` → `data/sessions/`
3. `createToolRegistry()` → 注册 bash / read / edit / update_working_memory
4. `createProvider()` → 根据 config 创建 Provider
5. `resolveSessionId()` → 自动恢复最近 session（按 `updatedAt` 降序）
6. `createAgentSession()` → 注入 storage / provider / tools / systemPrompt
7. `SessionRef` + `SessionFactory` → 支持 `/new` `/resume` 切换 session
8. `InMemoryMessageBus` + `ChannelManager` → 绑定 `wsChannel` 到 `sessionId`
9. `runInboundLoop()` → 消费入站 + slash 拦截 + agent 调用 + 事件 emit
10. `onNewSession` 回调 → 切换 session 时重新 `bindSession(newId, wsChannel)`

### systemPrompt 安全约束

- 禁止执行 kill / pkill / killall / shutdown / reboot 等杀进程命令
- 禁止修改 `src/` / `config/` / `package.json` 源码
- 禁止读取 `data/sessions/` 内部存储文件（session 历史由系统管理）

## 关键设计决策

- **方案 E（类型化 bus）**：`AgentEventEnvelope` 双向队列，多 channel 共享 session
- **SessionRef 可变引用**：支持 `/new` `/resume` 在运行中切换 session，无需重启 loop
- **loadHistory 懒加载**：session 首次 `run()` 时从 JSONL 加载历史，避免启动时全量读取
- **Slash 拦截在 agent 之前**：`runInboundLoop` 检测 `/` 前缀 → `registry.resolve` → 命中则不传 agent
- **短 ID 前缀匹配**：`/resume 0ca9` 匹配 `0ca9446c-...`，歧义时提示 `Ambiguous id`
