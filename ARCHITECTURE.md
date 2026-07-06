# aptbot 架构

> 自底向上四层架构（core → bus → infrastructure → access）加 shared 跨层共享；依赖方向严格向下，核心层不感知接入层存在。v0.2.3 新增 `src/learn/` 学习内容层（独立于四层架构，承载知识栏目文章源 + 加载器）。v0.3.0 在 `src/core/agent/` 模块新增 AgentProfile 双轨 agent 抽象（default / professional）+ MEMORY.md 共享记忆 + KV 缓存 systemPrompt + 归档 + 迁移，access 层新增 agent-api + 浮层 HTML 生成器，webui 层新增 8 个 Lit 组件；session 存储路径从 `data/sessions/` 迁移到 `data/users/<userId>/agents/<slug>/sessions/`。

## 分层总览

```
┌─────────────────────────────────────────────────┐
│  接入层 (access / cli / webui)                   │
│  WebSocketServer · chat-page · landing-page ·    │
│  learn-page · feedback-api · Ink CLI · Lit UI    │
├─────────────────────────────────────────────────┤
│  总线层 (bus)                                    │
│  MessageBus (入站/出站双队列) · ChannelManager    │
├─────────────────────────────────────────────────┤
│  核心层 (core)                                   │
│  Provider · Tool · Memory · AgentLoop/Session    │
├─────────────────────────────────────────────────┤
│  基建层 (infrastructure)                         │
│  Config · Logger · JSONL · FileStorage ·         │
│  FeedbackStorage · Process                       │
└─────────────────────────────────────────────────┘
        │
        ▼
   shared/ (commands · ui-state)  跨层共享
        │
        ▼
   learn/ (article-types · article-loader · articles/)  v0.2.3 内容层
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
| `feedback-storage.ts` | (v0.2.3) `FeedbackStorage` 类：`append` / `list` / `moderate` / `findById` + `FeedbackEntry` 接口；存 `${dataDir}/feedback.jsonl`，复用 `jsonl.ts` + `jsonl-mutex.ts`；moderate 在 per-file 锁下重写整个文件 |
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

#### 2.4.1 ReAct 循环核心（0.1.0 基线）

| 模块 | 职责 |
|------|------|
| `events.ts` | `AgentEvent` 联合类型（turn_start/end, message_*, tool_call_*, error 等） |
| `loop.ts` | ReAct 循环：maxIterations 上限 + AbortSignal 传播 + steering queue |
| `session.ts` | `AgentSession`：turn 原子性（错误不持久化），`loadHistory()` 懒加载 JSONL 历史 |

#### 2.4.2 AgentProfile 类型与 schema（v0.3.0 Task 1）

`src/core/agent/agent-profile.ts` 定义 AgentProfile 双轨 agent 抽象，作为后续所有 agent 相关模块的类型契约。统一抽象：Mode A（通用）是 Mode B（专业）的退化特例，两者都是 `AgentProfile` 实例。

| 导出 | 职责 |
|------|------|
| `AgentType` | `'default' \| 'professional'` 联合类型 |
| `AgentProfile` 接口 | name / description / userId / type / slug / createdAt / updatedAt / personality（body）/ 可选 LLM 配置字段（model / temperature / maxTokens / reasoningEffort / thinkingType / thinkingBudgetTokens）/ `memoryEnabled`（Task 18） |
| `AGENT_SLUG_REGEX` | `/^[a-z0-9-]{3,64}$/` 路径遍历防护常量（仅小写字母、数字、连字符；3-64 字符） |
| `MAX_MEMORY_SIZE` | `8192`（8KB 软上限，read_agent_memory 超限返回 `memory_too_large`） |
| `MAX_WRITE_CONTENT_SIZE` | `2048`（2KB 单次写入上限） |
| `MAX_AGENTS_PER_USER` | `50`（软上限，POST /api/agents 超限返回 400） |
| `AgentProfileSchema` | zod schema：校验 AGENT.md frontmatter 字段类型与格式 |
| `parseAgentMd(raw)` | 解析 AGENT.md（gray-matter 复用 0.2.3 依赖，无新依赖）+ zod schema 校验；返回 `{ frontmatter, body }` |
| `generateSlug()` | `agent-<6-hex-chars>` 算法，与 name 解耦（避免 pinyin 依赖；6 位 hex ≈ 1677 万组合，单用户 50 上限冲突概率可忽略，冲突时由 AgentStorage 重试） |
| `validateSlug(slug)` | 正则校验 |

**AGENT.md 格式：** YAML frontmatter（--- 分隔）+ markdown body（personality）。frontmatter 由 `parseAgentMd` 解析 + `AgentProfileSchema` 校验；userId / createdAt / updatedAt / personality 是运行时元数据，由 AgentStorage 组装（不存盘 frontmatter）。

#### 2.4.3 AgentStorage — AGENT.md 持久化（v0.3.0 Task 2 + Task 19）

`src/core/agent/agent-storage.ts` 提供 AgentProfile 的文件系统持久化能力，封装 AGENT.md 的读写与目录管理。

| 方法 | 职责 |
|------|------|
| `getAgentDir(userId, slug)` | 返回 `data/users/<userId>/agents/<slug>/` 绝对路径（路径遍历校验后） |
| `getAgent(userId, slug)` | 读取 AGENT.md，解析 frontmatter + body；文件不存在返回 null；损坏文件抛错 |
| `listAgents(userId)` | 列出用户所有 agent，逐个读取 AGENT.md；损坏文件 warn 跳过（与 FileStorage.listSessions 一致） |
| `saveAgent(profile)` | 原子写入 AGENT.md（write-to-tmp + rename）；自动创建多层目录；per-agentId mutex 串行化 |
| `deleteAgent(userId, slug)` | 递归删除 agent 目录；幂等（目录不存在不抛错）；在 per-agentId 锁内执行避免与 saveAgent 竞态 |
| `exists(userId, slug)` | 检查 AGENT.md 是否存在 |
| `countAgents(userId)` | 统计用户 agent 数量（仅按目录 + AGENT.md 存在性计数，不读取内容） |
| `findAgentOwner(slug)` | 扫描所有用户目录，返回 slug 对应 agent 的 owner userId（用于跨用户 403 检测）；未找到返回 null |
| `archiveAgent(userId, slug)` | (Task 19) 专业 agent 归档：复制 → 验证 → 删除原子操作；归档路径 `data/users/<userId>/archived-agents/<slug>-<timestamp>/` |

**关键设计：**
- **per-agentId mutex**（`withAgentLock` 导出）：5000ms 超时 + ghost acquisition 释放防死锁；write_agent_memory 工具复用此锁保证并发写入串行化
- **路径遍历防护**：所有路径拼接前校验 `userId`（`USER_ID_REGEX` UUID v4）+ `slug`（`AGENT_SLUG_REGEX`）
- **原子写**：write-to-tmp + rename，与 0.1.0 edit 工具、0.2.3 FeedbackStorage 一致
- **归档原子性**（Task 19）：先 `cpSync` 递归复制 → 验证完整性（文件数对比 + AGENT.md 必须存在于归档）→ 验证通过删除原目录；失败清理归档目录 + 抛错拒绝删除；cpSync 失败时清理归档路径防脏数据

#### 2.4.4 MemoryAuditLog — append-only 审计日志（v0.3.0 Task 7）

`src/core/agent/memory-audit-log.ts` 记录所有 write_agent_memory 操作的审计日志。

| 字段 | 职责 |
|------|------|
| `MemoryAuditSection` | `'user_profile' \| 'facts' \| 'preferences' \| 'history'`（排除 'all'，因 'all' 不能被写入） |
| `AuditRecord` | timestamp（ISO 8601）/ sessionId / section / mode（append \| replace）/ contentPreview（前 200 字符）/ contentLength / beforeSize / afterSize |
| `MemoryAuditLog` 类 | `append(record)` 追加一条记录；`list(limit?)` 默认返回最近 20 条，最新在前（倒序） |

**存储路径：** `data/users/<userId>/agents/<slug>/memory.log.jsonl`，复用既有 `withJsonlLock` 串行化（lockKey = `memory-audit:<userId>/<slug>`）；路径遍历防护同 AgentStorage。

**与 MEMORY.md 的关系：** MEMORY.md 通过 write_agent_memory 工具写入是原子操作（write-to-tmp + rename，已落盘无法回滚）；若审计日志 append 失败，调用方（工具）返回错误给 agent，但 MEMORY.md 写入不回滚。

#### 2.4.5 system-prompt-builder — KV 缓存优化（v0.3.0 Task 8）

`src/core/agent/system-prompt-builder.ts` 替代 server.ts 内联固定 systemPrompt，为 KV 缓存命中优化。

| 导出 | 职责 |
|------|------|
| `buildSystemPrompt(agent, memoryContent)` | 构造完整 systemPrompt：固定前部（STABLE_PREFIX 通用约束 + 安全约束）+ 半稳定区（`## Agent Memory` section + `## Personality` section） |
| `computeSystemPromptCacheKey(agent, memoryContent)` | `sha256(stablePrefix + (memoryContent ?? '') + personality)` → hex（64 字符）；turn 间比较此 key 命中 KV 缓存不重复计费 |

**KV 缓存设计：**
- 固定前部 turn 间字节级稳定 → KV 缓存命中
- MEMORY.md 末尾追加（History section）不破坏前部缓存
- 仅当 MEMORY.md 前部 section 变化或固定前部变化时缓存失效
- 固定前部参与 hash：aptbot 版本升级（前部约束变化）不会错误命中旧缓存

**注入规则（按优先级）：**
- `agent.type === 'default'` → 不注入 `## Agent Memory`（即使 memoryContent 非 null 也忽略）
- `memoryContent === null` → 不注入（专业 agent 未启用记忆，即 `memoryEnabled === false`）
- `memoryContent === ''` → 注入空 body 的 `## Agent Memory` section（MEMORY.md 文件不存在占位）
- `memoryContent` 非空字符串 → 注入含该内容的 `## Agent Memory` section
- `agent.personality` 非空 → 注入 `## Personality` section；为空则跳过

**systemPrompt 安全约束（STABLE_PREFIX 内）：**
- 禁止执行 kill / pkill / killall / shutdown / reboot 等杀进程命令
- 禁止修改 `src/` / `config/` / `package.json` 源码
- 禁止访问 `data/users/*/agents/*/sessions/` 内部存储文件（原 `data/sessions/` 路径变更）
- 禁止访问 `data/users/*/archived-agents/` 归档文件夹
- 禁止访问 ui-config.json 文件
- 允许通过 read_agent_memory / write_agent_memory 工具访问当前 agent 的 MEMORY.md（路径硬编码）
- 禁止访问其他 agent 的 MEMORY.md（跨 agent 禁止）

#### 2.4.6 agent-migration — legacy session 迁移（v0.3.0 Task 3）

`src/core/agent/agent-migration.ts` 在 0.3.0 升级时一次性扫描 legacy `data/sessions/*.jsonl` + `.meta.json`，按 userId 分组迁移到新数据模型。

| 导出 | 职责 |
|------|------|
| `DEFAULT_AGENT_SLUG` | `'default'`（特殊保留值，非 generateSlug 生成） |
| `DEFAULT_AGENT_NAME` | `'通用助手'` |
| `DEFAULT_AGENT_DESCRIPTION` | `'aptbot 通用助手'` |
| `DEFAULT_AGENT_PERSONALITY` | `'你是 aptbot 通用助手'`（占位文本，Task 8 buildSystemPrompt 会动态构建完整 systemPrompt） |
| `migrateLegacySessions(dataDir, agentStorage)` | 扫描 legacy `data/sessions/*.jsonl` + `.meta.json`，按 userId 分组迁移到 `data/users/<userId>/agents/default/sessions/`；无 userId 的 session 生成伪 UUID；为每个 userId 创建 default agent 的 AGENT.md（若不存在）；更新 .meta.json 添加 `agentId: default`；返回 `MigrationReport` |
| `ensureDefaultAgent(userId, agentStorage)` | 用户首次访问时若 default agent 不存在则创建（type=default / personality=通用 systemPrompt） |
| `MigrationReport` | 含 `migratedSessions` / `createdAgents` / `errors` 字段 |

**关键设计：**
- **幂等性**：已迁移 session（目标 .jsonl 已存在）不重复迁移；已创建 default agent 不重复创建
- **中断恢复**：atomic write-to-tmp + rename，中断后重新运行可继续
- **路径遍历防护**：所有路径拼接前校验 userId（UUID）
- **与 spec 偏离**：实际签名 `(dataDir, agentStorage)` 而非 `(storage, agentStorage)`（StorageAdapter 不暴露文件路径，无法用于文件移动）

#### 2.4.7 ui-config — visibleSkills UI 配置（v0.3.0 Task 10）

`src/core/agent/ui-config.ts` 管理 default agent 的 UI 层展示偏好（visibleSkills），不动 skill 文件，不动 AGENT.md。

| 导出 | 职责 |
|------|------|
| `VisibleSkill` | `{ slug; displayName }`（slug 与 Skill.name 一致；displayName 可含中文等） |
| `UiConfig` | `{ visibleSkills: VisibleSkill[] }`（后续可扩展 collapsed sections / theme 等） |
| `UiConfigStorage` 类 | `get(userId)` 返回 UiConfig；`update(userId, config)` 原子写入（write-to-tmp + rename） |

**存储路径：** `data/users/<userId>/agents/default/ui-config.json`（仅 default agent，硬编码 "default"）。文件不存在 / 损坏 JSON → 返回空 visibleSkills（graceful 降级）+ console.warn。

**与 AgentStorage 的差异：** 不需要 per-agentId mutex（仅 default agent，文件粒度小，写并发概率低）；不需要 findOwner / listAgents / countAgents（仅 default）；简单 JSON 文件，无 frontmatter / markdown body。

#### 2.4.8 数据模型变更（v0.3.0）

0.3.0 将 session 存储路径从单层 `data/sessions/` 迁移到按用户 + agent 分层的 `data/users/<userId>/agents/<slug>/sessions/`，配合双轨 agent 抽象：

```
data/
├── users/
│   ├── <userId>/
│   │   ├── agents/
│   │   │   ├── default/                    # Mode A 通用 agent
│   │   │   │   ├── AGENT.md               # AgentProfile frontmatter + personality body
│   │   │   │   ├── ui-config.json         # visibleSkills UI 配置（仅 default）
│   │   │   │   ├── MEMORY.md              # 不存在（default 不注入记忆）
│   │   │   │   ├── memory.log.jsonl       # 不存在（default 不写记忆）
│   │   │   │   └── sessions/
│   │   │   │       ├── <sessionId>.jsonl  # session 消息历史
│   │   │   │       └── <sessionId>.meta.json  # SessionMetadata（含 agentId）
│   │   │   └── agent-<6-hex-chars>/       # Mode B 专业 agent
│   │   │       ├── AGENT.md
│   │   │       ├── MEMORY.md              # 跨 session 共享记忆（8KB 软上限）
│   │   │       ├── memory.log.jsonl       # 审计日志（append-only）
│   │   │       └── sessions/
│   │   │           ├── <sessionId>.jsonl
│   │   │           └── <sessionId>.meta.json
│   │   └── archived-agents/                # 归档专业 agent（archiveAgent 复制 + 验证 + 删除）
│   │       └── <slug>-<timestamp>/
│   │           ├── AGENT.md
│   │           ├── MEMORY.md
│   │           ├── sessions/
│   │           └── memory.log.jsonl
└── sessions/                                # legacy 0.2.x 路径（迁移源，迁移后空目录）
```

**SessionMetadata 扩展：** `SessionMetadata` 接口新增 `readonly agentId: string` 必填字段（Task 4），标识 session 归属的 agent slug；FileStorage 路径计算从 `data/sessions/<id>.jsonl` 改为 `data/users/<userId>/agents/<agentId>/sessions/<id>.jsonl`；`claimSession` 新增 agentId 参数写入 .meta.json；SessionRepo.create / open 签名扩展接受 agentId。向后兼容：迁移期间 legacy 路径 fallback 读取。不持久化 `activeSkill`（spec §3.6 确认）。

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
| `websocket-server.ts` | WS 服务，入站限流 64KB content / 10 msg/s，heartbeat 60s，resync 协议；v0.2.3 路由扩展：`/learn` / `/learn/:slug` / `/feedback` / `/api/feedback`（`/api/feedback` 优先于 `/api/*` 分发）+ 友好 404 页 + 统一 HTML 响应头 |
| `chat-page.ts` | 内联 HTML（含 Lit + Web Components），工具结果 max-height 200px + 800 字符截断 |
| `landing-page.ts` | (v0.2.1) 落地页 HTML 生成器，5 sections + nav + footer + adept.ai tokens；v0.2.3 新增第 6 section「知识」+ nav「知识」链接 + Hero 副标题更新 + 数据条追加 articles/tracks 数字（仅 `learnEnabled` 即 `landingPage:true && learnPage:true` 时生效） |
| `learn-page.ts` | (v0.2.3) 三个纯字符串 HTML 生成器：`createLearnListHtml`（/learn 列表页：Track 筛选 tab + chapter 折叠 + 文章卡片网格）/ `createLearnArticleHtml`（/learn/:slug 文章页：max-width 720px 阅读优先布局 + marked 渲染正文 + 上下篇导航 + 反馈表单；planned 文章显示 PLANNED 标签 + 大纲占位）/ `createFeedbackHtml`（/feedback 通用反馈页）；沿用 adept.ai tokens + Inter 字体 + 移动端 `@media (max-width: 767px)` 字号缩放；不含 emoji |
| `feedback-api.ts` | (v0.2.3) `handleFeedbackApi` 函数：POST `/api/feedback`（zod 校验 message 1-2000 / category general\|article\|bug\|feature / articleSlug 仅 article 时必填并校验存在 / contact 可选 ≤120）+ GET `/api/feedback`（`APTBOT_AUTH_TOKEN` 鉴权 + limit/offset/category/status 分页过滤）+ POST `/api/feedback/:id/moderate`（auth + status resolved\|archived + note ≤500）+ per IP 限流器（10/min + 60/hour 内存滑动窗口，429 含 Retry-After）；`feedbackStorage` 为 undefined 时全部 404 |

### 4.2 CLI `src/cli/`

Ink + Yoga + React，6 个组件：`assistant-message` / `user-message` / `tool-execution` / `working-loader` / `footer` / `input-editor`。

### 4.3 WebUI `src/webui/`

Lit + Web Components，6 个组件：`assistant-message` / `user-message` / `tool-execution` / `working-indicator` / `footer-bar` / `input-box`。

## 5. 学习内容层 `src/learn/`（v0.2.3）

独立于四层架构的内容模块，承载知识栏目的文章源 + 加载器。被 `src/access/learn-page.ts`（HTML 生成）与 `src/access/feedback-api.ts`（articleSlug 校验）消费，由 `src/server.ts` 装配。

| 模块 | 职责 |
|------|------|
| `article-types.ts` | `ArticleMetaSchema`（zod：slug / title / description / track / chapter / order / difficulty / estimatedReadingTime / status / prerequisites / lastUpdated / tags）+ `Article` / `ArticleState` / `ArticleNav` / `TrackMeta` 类型 + `TRACKS` 注册表（agent-practice + ai-coding-practice，未来扩展 Track 3 只需追加一项） |
| `article-loader.ts` | `ArticleLoader` 类：`load` / `getState` / `getBySlug` / `getArticleNav`；gray-matter 解析 frontmatter + zod 校验 + 唯一性校验（slug 重复保留 order 较小者 / prerequisites 引用不存在则清空 / track 不在注册表则跳过 / order 重复按文件名兜底排序）；marked@15 渲染 published 文章并缓存 htmlString（gfm true + breaks false + 自定义 renderer 为 h2/h3 生成 slug id 锚点 + pre 加 data-language）；planned 跳过渲染；mtimeNs 懒加载热重载（与 v0.2.2 Config 热重载模式对齐）+ per-loader mutex 串行化；校验失败 stderr warning + 跳过文件不阻塞启动 |
| `articles/*.md` | 19 篇 markdown 文章源文件：Track 1（01-13 Agent 体系实践：入门 2 + 核心特性深入 8 + 可靠性/UX 1 + 实战 1 + 演进路线 1）+ Track 2（01-06 AI 辅助编码实践）；slug 全局唯一，order 全局唯一 |

### 5.1 文章加载流程

```
ArticleLoader.load()
   │
   ▼
fs.readdirSync(articles/) 按文件名排序
   │
   ▼ 逐文件
gray-matter(.md) → { data: frontmatter, content: markdownBody }
   │ 失败 → stderr warning + skip
   ▼
ArticleMetaSchema.safeParse(frontmatter) 拿全部 zod 错误
   │ 失败 → stderr warning（含校验错误详情）+ skip
   ▼
唯一性校验（slug 重复 / prerequisites / track / order）
   │ 软冲突 → warning + 兜底处理（不阻塞）
   ▼
status=published → marked.parse(markdownBody) → 缓存 htmlString
status=planned   → htmlString = null（跳过渲染）
   │
   ▼
排序分组：全局 order 升序 → 按 track 分组 → 按 chapter 分组 → order 升序
   │
   ▼
返回 ArticleState（不可变快照：articles + tracks + bySlug Map + byTrack Map）
```

### 5.2 热重载策略

与 v0.2.2 Config 热重载模式对齐：mtimeNs 懒加载，非 fs.watch。每次 HTTP 请求 `/learn` 或 `/learn/:slug` 时检查 articles/ 目录 mtimeNs + 每个文件 mtimeNs 数组快照，任一变化触发 reload。per-loader mutex 串行化 reload，并发请求等同一个 reload 完成。与 Config 热重载独立工作（不联动）。

## 6. 共享层 `src/shared/`

| 模块 | 职责 |
|------|------|
| `commands/registry.ts` | `CommandRegistry` + 内置 slash 命令（`/new` `/clear` `/help` `/model` `/sessions` `/resume` `/continue` `/label` `/session` `/session.reset` `/exit` + v0.2.3 `/feedback`） |
| `commands/feedback.ts` | (v0.2.3) `/feedback` 命令实现：无参/`list` 最近 10 条 open · `all` 全部状态 · `<id>` 详情 · `resolve <id> [note]` · `archive <id>` · `stats` 按状态/分类计数；Ink 表格输出；复用 AgentSession auth 上下文，无 token 拒绝并提示 |
| `ui-state/reducer.ts` | `coreReducer` UIState 状态机，CLI 与 WebUI 共用 |

## 7. 服务器装配 `src/server.ts`

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
11. (v0.2.3) `ArticleLoader` → `learnEnabled`（`landingPage:true && learnPage:true`）或 `feedbackEnabled` 时实例化（feedback 校验 articleSlug 依赖 ArticleLoader），articles 目录 `path.resolve(__dirname, './articles')`
12. (v0.2.3) `FeedbackStorage` → `feedbackEnabled` 时实例化，存 `${dataDir}/feedback.jsonl`
13. (v0.2.3) 注入 `WebSocketServerOptions`：`serveLearnListHtml` / `serveLearnArticleHtml` / `serveFeedbackHtml`（仅 `learnEnabled` 时提供）/ `articleLoader` / `feedbackStorage` / `feedbackEnabled`

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
- **(v0.2.3) learn 独立于四层架构**：`src/learn/` 是内容模块而非业务层，被 access 层消费（learn-page.ts HTML 生成 + feedback-api.ts articleSlug 校验），不反向依赖 core/bus
- **(v0.2.3) 文章运行时渲染 + 缓存**：markdown 源 + frontmatter 由 `marked@15` 在运行时渲染并缓存 htmlString，无构建步骤，与项目既有模式一致
- **(v0.2.3) 反馈 JSONL append-only + 重写 moderate**：复用既有 JSONL + per-file mutex 基元；append-only 写入，moderate 重写整个文件（反馈量低，单文件原子性更好，无 tombstone 解析复杂度）
- **(v0.2.3) 配置 opt-in 分离**：`learnPage` 默认 false（与 `landingPage` 同模式，clone 用户零影响），`feedbackEnabled` 默认 true（自部署用户也可收集反馈）；`/learn` `/learn/:slug` `/feedback` 路由需 `landingPage:true && learnPage:true` 才启用，但 `POST /api/feedback` 仅需 `feedbackEnabled:true`
