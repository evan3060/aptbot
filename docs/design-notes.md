# aptbot 设计讨论记录

> 本文档记录 aptbot 项目的设计讨论过程与决策。每次讨论后更新。
> 参考框架源码已 clone 到项目根目录：`nanobot/`（Python）、`pi/`（pi-mono, TypeScript）、`mastra/`（TypeScript）。

---

## 0. 项目定位

- **目标**：个人学习与工作助手
- **技术栈**：TypeScript / Node.js
- **参考框架**：nanobot（Python）、pi-agent / pi-mono（TypeScript，同语言首选参考）
- **MVP 范围**：CLI + Web UI，单模型，ReAct 循环，3-4 个基础工具，短期对话记忆

## 1. 全局架构分层

```
接入层 (CLI / WebUI / Channel)
   ↓
总线层 (MessageBus / EventStream)
   ↓
核心层 (AgentLoop / Provider / Tools / Memory / Skills)
   ↓
基建层 (Config / Persistence / Logger)
```

## 2. 已决策项

| 模块 | 决策 | 状态 | 备注 |
|---|---|---|---|
| 语言/运行时 | TypeScript / Node.js | ✅ 已定 | 与 pi-agent 同栈，参考成本最低 |
| WebUI | Web Components + WebSocket | ✅ 已定 | 依赖事件流，需 AgentLoop 输出细粒度事件 |
| 事件流粒度 | 细粒度（token 级 delta + 工具进度） | ✅ 已定 | pi-agent 风格 |
| 中途打断 | 支持打断（AbortSignal + steering） | ✅ 已定 | pi-agent 风格 |
| 工具系统 | 原子工具 + Skills 声明式扩展 | ✅ 已定 | 参考 pi-agent + nanobot |
| 记忆系统 MVP | 短期对话 + JSONL 持久化 + 简单压缩 | ✅ 已定 | — |
| Working Memory | 纳入 MVP（key_info + update_working_memory 工具 + 持久化 + 显式继承） | ✅ 已定 | 见 §7.7 |
| AgentLoop 分层 | 方案 A：Layer 1 `agentLoop` 无状态生成器 + Layer 2 `AgentSession` 有状态+持久化 | ✅ 已定 | 见 §3.7 |
| 错误处理策略 | 外置分层重试 | ✅ 已定 | 见 §4 |
| Channel 抽象 | 方案 E：类型化 bus（AgentEventEnvelope 双向队列） | ✅ 已定 | 见 §10.6 |
| MVP Channel 范围 | CLI + WebSocket，IM 放 L2/L3 | ✅ 已定 | — |
| Channel 共享 session | 支持（bindSession 多对一） | ✅ 已定 | WebUI + CLI 可同时连同一 session |
| MVP 权限模型 | 无 allow_from，IM 阶段再引入 pairing | ✅ 已定 | — |
| CLI 渲染引擎 | Ink + Yoga（React 组件树模型） | ✅ 已定 | 见 §11.6 |
| WebUI 框架 | Lit + Web Components | ✅ 已定 | 见 §11.6，仍是标准 WC |
| 斜杠命令 | 统一 CommandRegistry，CLI/WebUI 共用 | ✅ 已定 | 见 §11.6 |
| UI 状态机 | reducer（`UIState = reducer(state, AgentEvent)`） | ✅ 已定 | 见 §11.6 |
| MVP CLI 范围 | 基础流式 + 6 内置命令（+ /continue），Overlay 放 L2 | ✅ 已定 | — |
| MVP WebUI 范围 | 单会话聊天 + 流式 + 工具，侧边栏/fork 放 L2 | ✅ 已定 | — |
| 自演化 skill | 不做自动演化，改推荐用户创建 skill（L2） | ✅ 已定 | 见 §8.7 |
| L2 MixinProvider | 多 provider 故障转移 + 弹回主 provider + 流式不切已 yield | ✅ 已定 | 见 §12.1 |
| L2 Config 热重载 | mtimeNs 懒加载 + 整体重载 + 校验失败降级 | ✅ 已定 | 见 §12.2 |
| L2 Hook 系统 | 8 hook 点 + 同步 + ctx 允许 mutate + priority 排序 | ✅ 已定 | 见 §12.3 |
| L2 /session 动态属性 | 白名单 5 项 + 文件值逃生口 + 内存态 + /session.reset | ✅ 已定 | 见 §12.4 |
| L2 L1 索引 skill | 行数/字节/tags + lastUsed 排序 + 4K token 预算 | ✅ 已定 | 见 §12.5 |
| 部署分层 | 本地 Ubuntu 主力（双模式：局域网 + 公网反代）+ CF 演示（demo.aptbot.de） | ✅ 已定 | 见 §13 |
| 本地暴露 | 双模式（局域网 HTTP + 公网 Caddy 反代 + 强 token） | ✅ 已定 | 见 §13.2 |
| WebUI 部署 | MVP 同源（Node.js serve 静态 + WS），L2+ 可拆 CF Pages | ✅ 已定 | 见 §13.8 |
| CF 演示后端 | Workers + DO（SQLite）+ KV，免费额度够 demo | ✅ 已定 | 见 §13.3 |
| CF 演示工具集 | 最小集（web_fetch + update_working_memory） | ✅ 已定 | 见 §13.4 |
| 代码适配 | 运行时注入（StorageAdapter / ToolRegistry 过滤 / ConfigSource） | ✅ 已定 | 见 §13.4 |
| 进程管理 | systemd | ✅ 已定 | 见 §13.2 |
| 反代工具 | Caddy（自动 Let's Encrypt） | ✅ 已定 | 见 §13.2 |
| 异常与边界处理 | 5 类边界场景（Memory/Tool/Session/WebSocket/Provider）+ 具体处理规则 | ✅ 已定 | 见 §14.1 |
| 测试分层 | Unit / Integration / E2E 三层 + 核心断言点 + MVP 10 项验收标准 | ✅ 已定 | 见 §14.2 |
| 资源上限 | Node 512MB / JSONL 50MB / WS 50 连接 / bash 10 并发 / read 10MB | ✅ 已定 | 见 §14.3.1 |
| 超时 | bash 30s / LLM 首字节 30s / chunk 间隔 60s / WS 心跳 60s | ✅ 已定 | 见 §14.3.2 |
| 不变量 | 6 项（事件顺序/追加语义/WM 单调/JSONL 完整/ID 唯一/turn 原子） | ✅ 已定 | 见 §14.3.3 |
| Token 计算 | 用 tiktoken / provider usage，不自行实现 tokenizer | ✅ 已定 | 见 §14.3.4 |

## 3. AgentLoop 模块：pi-agent vs nanobot 深度对比

> 基于实际源码（`pi/packages/agent/src/agent-loop.ts`、`nanobot/nanobot/agent/loop.py`、`nanobot/nanobot/agent/runner.py`）。

### 3.1 分层结构（重要纠正）

之前讨论误以为 nanobot 是"单层 20 行循环"。**实际两者都分层，只是粒度不同**：

**pi-agent 三层 API**：
```
agentLoop()        # 公开端点，返回 EventStream<AgentEvent, AgentMessage[]>
   ↓ 调用
runAgentLoop()     # async function，负责发 agent_start/turn_start 事件
   ↓ 调用
runLoop()          # 主循环，含外层(follow-up)+内层(steering+tool)双 while
```
之上还有 `Agent`（有状态订阅）和 `AgentHarness`（持久化 + phase 状态机）两个高层封装。

**nanobot 两层结构**：
```
AgentLoop 类       # 编排层，含 TurnState 状态机
   (RESTORE → COMPACT → COMMAND → BUILD → RUN → SAVE → RESPOND → DONE)
   ↓ 委托
AgentRunner 类     # 执行层，含 run() + _run_core() 主循环
```
`AgentLoop` 负责会话/上下文/命令路由/响应分发等编排，`AgentRunner` 只管"LLM ↔ 工具"循环。

### 3.2 核心循环对比

**pi-agent `runLoop`**（双层 while + steering/follow-up）：
```typescript
while (true) {                              // 外层：follow-up 循环
  let hasMoreToolCalls = true;
  while (hasMoreToolCalls || pendingMessages.length > 0) {  // 内层：tool + steering
    // 1. 注入 pending steering 消息
    // 2. streamAssistantResponse() ← 流式调用 LLM，发 message_start/update/end
    // 3. 解析 toolCalls
    // 4. executeToolCalls() ← parallel 或 sequential
    // 5. prepareNextTurn() 钩子 ← 可换 model/thinking level/context
    // 6. shouldStopAfterTurn() 钩子
    // 7. 重新拉取 steering 消息
  }
  // 8. getFollowUpMessages() ← agent 想停时再检查一次
  if (no followUp) break;
}
```

**nanobot `AgentRunner._run_core`**（单层 for + 多种恢复路径）：
```python
for iteration in range(spec.max_iterations):
    # 1. 上下文治理：drop_orphan / backfill / microcompact / tool_result_budget / snip_history
    # 2. hook.before_iteration()
    # 3. _request_model() ← 调用 LLM（含 streaming reasoning）
    # 4. 解析 reasoning + tool_calls
    # 5. 若有 tool_calls：
    #    - hook.before_execute_tools()
    #    - _execute_tools() ← concurrent 或 sequential
    #    - normalize + append tool results
    # 6. 若 fatal_error：尝试 _try_drain_injections，否则 break
    # 7. hook.after_iteration()
    # 8. _try_drain_injections() ← 检查注入消息（类 steering）
    # 9. continue / break
```

### 3.3 事件流（关键差异）

| 维度 | pi-agent | nanobot |
|---|---|---|
| **机制** | EventStream（async iterator） | AgentHook（回调） |
| **粒度** | 极细：token/thinking/toolcall delta 分开发 | 粗：before/after 阶段回调 |
| **事件类型** | `agent_start/end`, `turn_start/end`, `message_start/update/end`, `tool_execution_start/update/end` | `before_run/iteration`, `before_execute_tools`, `on_stream_end`, `emit_reasoning/end`, `on_error`, `after_run/iteration`, `on_finally` |
| **流式 token** | ✅ `message_update` 带 `assistantMessageEvent`（text/thinking/toolcall delta） | ⚠️ 仅 reasoning 流式，正文靠 `on_stream` 回调 |
| **工具进度** | ✅ `tool_execution_update` 带 `partialResult` | ❌ 无 |
| **消费方式** | `for await (const event of stream)` | 注册 hook 实例 |
| **WebUI 友好度** | ⭐⭐⭐⭐⭐ 天然适配 | ⭐⭐ 需在 hook 里转事件 |

### 3.4 中途打断（steering / injection）

| 维度 | pi-agent | nanobot |
|---|---|---|
| **机制名** | steering messages + follow-up messages | injection_callback + pending_queues |
| **触发时机** | 每次 turn 结束后 + agent 想停时 | 每次迭代后 + 错误后 + goal_active 时 |
| **配置入口** | `config.getSteeringMessages` / `config.getFollowUpMessages` | `spec.injection_callback` / `spec.goal_active_predicate` |
| **限流** | 无显式上限 | `_MAX_INJECTIONS_PER_TURN=3`, `_MAX_INJECTION_CYCLES=5` |
| **goal 持续** | 无 | ✅ `goal_continue_message`（agent 主动续跑） |
| **消息合并** | 直接 push | `_append_injected_messages` 合并连续 user 消息 |

### 3.5 上下文管理

| 维度 | pi-agent | nanobot |
|---|---|---|
| **入口** | `config.transformContext` 单一钩子 | 5 步链式处理 |
| **处理步骤** | 用户自定义 | `drop_orphan_tool_results` → `backfill_missing_tool_results` → `microcompact` → `apply_tool_result_budget` → `snip_history` |
| **独立压缩模块** | 无（交给 Harness） | ✅ `AutoCompact` + `Consolidator` |
| **工具结果截断** | 不截断 | `max_tool_result_chars` 截断 + 可 offload 到文件 |
| **持久化与模型上下文分离** | ✅ AgentMessage ↔ LLM Message 双向转换 | ✅ `messages`（持久化）vs `messages_for_model`（治理后） |

### 3.6 工具执行

| 维度 | pi-agent | nanobot |
|---|---|---|
| **并行/串行** | per-tool `executionMode` 字段 + 全局 `toolExecution` 配置 | 全局 `concurrent_tools` 配置 |
| **before/after 钩子** | ✅ `config.beforeToolCall` / `config.afterToolCall` | ✅ `hook.before_execute_tools`（无 per-tool after） |
| **参数校验** | `validateToolArguments` + `tool.prepareArguments` | 在工具内部 |
| **工具返回** | 结构化 `{content, details, terminate}` | 强制 `str`（再 normalize） |
| **错误传播** | 返回 `isError=true` 的 ToolResultMessage | `fatal_error` 终止 / 非致命返回错误字符串 |
| **terminate 语义** | ✅ 工具可主动 terminate 整个 batch | ❌ 无 |

### 3.7 aptbot 最终设计（已定）

**分层方案 A**：

```
Layer 1: agentLoop()         无状态生成器函数（pi-agent Layer 1 原样保留）
  - 输入: prompts, context, config, signal
  - 输出: EventStream<AgentEvent, AgentMessage[]>
  - 特点: 纯函数、无状态、可独立测试
  - 职责: 流式调用 LLM、执行工具、发事件、steering/follow-up 双 while 循环

Layer 2: AgentSession        有状态 + 持久化（合并 pi-agent Layer 2+3）
  - 持有: 当前 context、steering 队列、follow-up 队列、session 存储
  - 方法: load(sessionId) / save() / run(prompt) / pushSteering(msg)
  - 职责: 状态管理、持久化、steering 注入接口
  - 后续: 若需 subagent 或跨进程恢复，从 AgentSession 抽出持久化部分成独立 Harness
```

**Layer 3 扩展方案**（后续待办，从 Layer 2 拆出）：

```
Layer 3: AgentHarness       持久化 + phase 状态机 + 中断恢复
  - 持有: SessionStorage、save point、phase 状态
  - phase 状态机:
      Intake → Context → Inference → Tool → Response
      （每个 phase 可独立 save/restore，支持跨进程恢复）
  - 方法: saveSession() / loadSession() / resume() / createSavePoint()
  - 触发拆分条件:
      1. 需要 subagent（Harness 管理 subagent 生命周期）
      2. 需要跨进程恢复（CLI 重启后继续上次对话）
      3. 需要 phase 级 save point（中断后从最近 phase 恢复）
  - 拆分方式: 从 AgentSession 中抽出 load/save/resume 相关方法，
      AgentSession 改为持有 AgentHarness 实例而非直接实现持久化
```

**关键决策**：
1. **事件流**：细粒度 EventStream（token/thinking/toolcall delta + 工具进度），WebUI 天然适配
2. **steering + follow-up 双钩子**：采用 pi-agent 设计，比 nanobot 单一 injection_callback 更清晰
3. **上下文治理**：MVP 仅 `transformContext` 单钩子 + `max_tool_result_chars` 截断；nanobot 5 步链式处理过重，按需补
4. **工具执行**：默认串行，保留 `executionMode` 字段为后续并行预留
5. **持久化与模型上下文分离**：AgentMessage（持久化）↔ LLM Message（治理后）双向转换，参考两者做法

## 4. 错误处理策略（已定：外置分层重试）

### 4.1 两者的实际做法

**pi-agent**：
- LLM 错误：`message.stopReason = "error" | "aborted"`，发 `turn_end` + `agent_end` 后**直接终止**，不重试。
- 工具错误：构造 `isError=true` 的 ToolResultMessage 推回 messages，让 LLM 下一轮自己处理。
- 错误以事件形式发出，上层（Harness）决定是否重试。
- **特点**：错误处理**外置**到上层，循环本身只负责"报告"。

**nanobot**：
- LLM 错误：`stop_reason="error"`，调 `hook.on_error()`，终止。
- 工具错误：致命错误（`fatal_error`）直接终止；非致命返回错误字符串给 LLM 重试。
- **空内容重试**：`_MAX_EMPTY_RETRIES=2`，LLM 返回空时自动重试。
- **长度恢复**：`_MAX_LENGTH_RECOVERIES=3`，输出截断时发恢复消息让 LLM 继续。
- **400 中毒防护**：`_PERSISTED_MODEL_ERROR_PLACEHOLDER`，错误响应**不持久化**到 session。
- **特点**：错误处理**内置**到循环，带多种恢复路径。

### 4.2 待决策点

1. 错误处理放循环内还是外置到上层？→ **外置**
2. 是否需要空内容/长度恢复机制？→ **MVP 不做，按需补**
3. 错误响应是否持久化到 session？→ **不持久化**（防 400 中毒）
4. 工具错误是否重试，重试上限？→ **返回给 LLM 让其自行决定**

### 4.3 aptbot 最终方案（已定：外置分层重试）

**核心思想**：循环只负责"报告错误"，重试按类型分发到合适层级。

```
错误类型           处理层              是否涉及 LLM    行为
─────────────────────────────────────────────────────────────────
网络/5xx/429     Provider 层         ❌             自动重试（指数退避，N 次）
空内容/截断       AgentSession 层     ❌             整轮重跑（N 次后放弃）
工具错误         agentLoop 层        ✅             返回 isError=true 给 LLM
LLM 拒绝(400)    终止               ❌             错误响应不持久化，直接报错
```

**实现要点**：

```typescript
// Layer 0: Provider 层 —— 传输重试（对 LLM 透明）
provider.stream(messages, {
  maxRetries: 3,
  retryOn: [429, 500, 502, 503],
  backoff: "exponential",
})

// Layer 1: agentLoop —— 语义重试（让 LLM 参与）
async function* agentLoop(...) {
  while (...) {
    const response = await provider.stream(...);  // ← 传输重试在此内部
    if (response.stopReason === "error") {
      // 防护 1：错误响应不持久化（防 400 中毒）
      yield { type: "agent_end", error: response.error };
      return;  // 不 push 到 messages
    }
    if (response.toolCalls) {
      for (const call of response.toolCalls) {
        const result = await executeTool(call);
        // 工具错误 → 返回 isError=true 给 LLM，下轮让它自己决定
        messages.push(toolResultMessage(call, result));
      }
    }
  }
}

// Layer 2: AgentSession —— 业务重试（不涉及 LLM 决策）
class AgentSession {
  async run(prompt: string) {
    try {
      return await this.streamToResult(agentLoop(...));
    } catch (err) {
      if (isTransient(err) && this.retries < N) {
        this.retries++;
        return await this.streamToResult(agentLoop(...));  // 整轮重跑
      }
      if (isProviderDown(err) && this.fallbackProvider) {
        this.switchProvider(this.fallbackProvider);
        return await this.streamToResult(agentLoop(...));
      }
      throw err;
    }
  }
}
```

**不做**（MVP 阶段）：
- 空内容自动重试（少见，后续按需加）
- 长度恢复机制（少见）
- 工具级重试上限（让 LLM 决定即可）

## 5. 待讨论模块

- [x] AgentLoop（含事件流、分层、错误处理）— 见 §3、§4
- [x] Provider 抽象层 — 见 §5
- [x] Tool Registry & 原子工具 — 见 §6
- [x] Memory System — 见 §7
- [x] Skills 系统 — 见 §8
- [x] Channel 抽象 — 见 §10
- [x] Config 与持久化 — 见 §9
- [x] CLI / WebUI 接入层 — 见 §11

## 5. Provider 抽象层

### 5.1 pi-agent 的 Provider 架构

**三层结构**：

```
Api 层          具体协议实现（9 个）
  anthropic-messages, openai-completions, openai-responses,
  azure-openai-responses, openai-codex-responses,
  google-generative-ai, google-vertex, mistral-conversations,
  bedrock-converse-stream

Provider 层     模型目录 + 认证 + stream 委托（30+ 个）
  openai, anthropic, deepseek, google, xai, groq, openrouter,
  github-copilot, bedrock, azure, mistral, 等等

Models 层       Provider 集合 + 认证解析 + 路由
  Models 接口: getProviders() / getModels() / getModel() / stream()
  职责: 根据模型找 provider → 解析认证 → 委托 stream
```

**关键设计**：
1. **Api 与 Provider 分离**：Api 是协议（如 openai-responses），Provider 是服务商（如 openai, deepseek 共享 openai-responses API）。一个 Provider 可声明多个 Api。
2. **Model 类型**：`Model<TApi>` 泛型，携带 `provider`/`id`/`api`/`compat`/`thinkingLevelMap` 等元数据。
3. **认证体系**：`ProviderAuth` 接口 → `AuthContext` + `CredentialStore`，支持 apiKey / OAuth / 环境变量。
4. **注册表模式**：`apiProviderRegistry` 全局 Map<Api, ApiProvider>，按 Api 类型查找 stream 实现。
5. **传输重试**：**不在 Provider 层做**！由 `utils/retry.ts` 的 `isRetryableAssistantError()` 分类错误，上层决定是否重试。
6. **模型目录**：`models.generated.ts` 自动生成，包含所有 provider 的模型元数据。

### 5.2 nanobot 的 Provider 架构

**两层结构**：

```
LLMProvider     抽象基类（base.py）
  chat() / chat_stream()  ← 子类实现
  内置重试: chat_with_retry() 指数退避（1s, 2s, 4s）
  内置错误分类: _is_transient_error / _is_retryable_429_response / is_arrearage_response
  内置消息治理: _sanitize_empty_content / _enforce_role_alternation / _strip_image_content

具体实现        继承 LLMProvider
  OpenAICompatProvider   ← 绝大多数 provider（含 Responses API 子集）
  AnthropicProvider
  AzureOpenAIProvider
  BedrockProvider
  OpenAICodexProvider
  GitHubCopilotProvider

FallbackProvider  独立包装器，透明故障转移 + 熔断器
  - 主 provider 失败后依次尝试 fallback 模型
  - 熔断器: 连续 3 次失败后跳过主 provider 60 秒
  - 流式恢复: timeout 后可恢复到新 stream segment

ProviderFactory   从 config 创建 provider + FallbackProvider 包装
  registry.py: ProviderSpec 注册表，声明 provider 名 → backend → thinking_style
  factory.py: make_provider() → 按 backend 选择子类 → 可选 FallbackProvider 包装
```

**关键设计**：
1. **重试内置**：`chat_with_retry()` 在 Provider 基类中实现，3 次指数退避。
2. **错误分类极精细**：`_TRANSIENT_ERROR_MARKERS`、`_RETRYABLE_429_ERROR_TOKENS`、`_NON_RETRYABLE_429_TEXT_MARKERS` 等，区分可重试/不可重试 429。
3. **FallbackProvider**：独立的 AOP 风格包装器，不修改原 Provider，透明故障转移 + 熔断。
4. **消息治理内置**：`_enforce_role_alternation`、`_sanitize_empty_content` 等在 Provider 内处理。
5. **ProviderSpec 注册表**：声明式配置，指定 name → backend → thinking_style → default_api_base。

### 5.3 核心差异对比

| 维度 | pi-agent | nanobot |
|---|---|---|
| **架构分层** | 三层（Api/Provider/Models） | 两层（LLMProvider/具体实现） |
| **Api-Provider 分离** | ✅ 多 provider 共享同一 API 实现 | ❌ 每个 provider 自包含 |
| **重试策略** | 外置（utils/retry.ts 分类，上层决定） | 内置（chat_with_retry 3 次） |
| **故障转移** | 无内置 | ✅ FallbackProvider + 熔断器 |
| **错误分类** | 粗（isRetryableAssistantError 正则匹配） | 细（结构化 error_kind/error_type/error_code + 文本标记） |
| **消息治理** | 无（在 agent-loop 的 transformContext 做） | 内置（_enforce_role_alternation 等） |
| **认证** | 统一 ProviderAuth 接口 + OAuth | 简单 api_key / api_base |
| **模型目录** | 自动生成 models.generated.ts | ProviderSpec + config 手动声明 |
| **Provider 数量** | 30+ | ~10（但 OpenAICompat 覆盖面广） |
| **扩展方式** | 新增 Provider 工厂函数 + 注册 | 新增 ProviderSpec + 子类 |

### 5.4 aptbot 设计建议

**推荐：pi-agent 的 Api-Provider 分离 + nanobot 的 FallbackProvider**

```
Provider 抽象层
├── api/                    # 协议实现（可复用）
│   ├── openai-responses.ts
│   ├── anthropic-messages.ts
│   └── openai-completions.ts
├── providers/              # Provider 工厂（声明式）
│   ├── openai.ts
│   ├── anthropic.ts
│   ├── deepseek.ts         # 复用 openai-responses API
│   └── ...
├── models.ts               # Models 集合 + 认证 + 路由
├── fallback.ts             # FallbackProvider（nanobot 风格）
└── retry.ts                # 错误分类 + 重试策略
```

**关键决策点（已定）**：

1. **Api-Provider 分离** ✅
   - Api 层是协议实现（openai-responses / anthropic-messages / openai-completions）
   - Provider 层是声明式配置（服务商 + apiKey + baseUrl + model 目录）
   - deepseek/groq/openrouter 等复用 openai-responses API，扩展新 provider 只需写配置

2. **Provider 层内置传输重试** ✅
   - `stream()` 内部自动重试 5xx/429（指数退避 3 次），上层无感知
   - 与"外置分层重试"不矛盾：这是传输层重试，语义重试仍在 agentLoop 层
   - 参考 nanobot 的 `chat_with_retry()` 实现

3. **FallbackProvider 后续待办** ⏳
   - MVP 只支持单 provider，后续加 FallbackProvider + 熔断器
   - 参考 nanobot 的 FallbackProvider 实现（透明故障转移 + 熔断器 + 流式恢复）

4. **消息治理 Provider 层内置** ✅
   - role alternation、empty content 修复等在 `stream()` 内处理
   - 这些是协议要求（如 OpenAI 要求最后一条非 system 消息不是 assistant），应在最接近协议层处理

5. **模型目录：手动声明** ✅
   - MVP 手动声明模型元数据（provider/id/api/contextWindow/maxTokens/thinking）
   - 后续可选支持运行时 `GET /v1/models` 动态发现

6. **认证：MVP 仅 api_key + 环境变量** ✅
   - 后续加 OAuth 支持（GitHub Copilot 等）

### 5.5 aptbot Provider 最终设计（已定）

```
src/provider/
├── api/                        # 协议实现层（可复用）
│   ├── openai-responses.ts     # OpenAI Responses API 协议
│   ├── anthropic-messages.ts   # Anthropic Messages API 协议
│   └── openai-completions.ts   # OpenAI Chat Completions API 协议
├── providers/                  # Provider 声明层（服务商配置）
│   ├── openai.ts               # { id: "openai", api: "openai-responses", models: [...] }
│   ├── anthropic.ts            # { id: "anthropic", api: "anthropic-messages", models: [...] }
│   ├── deepseek.ts             # { id: "deepseek", api: "openai-responses", models: [...] }
│   └── custom.ts               # 用户自定义 provider 配置
├── models.ts                   # Models 集合 + 认证 + 路由
│   - getProviders() / getModels() / getModel()
│   - stream(model, context, options) → resolve provider → delegate to api stream
│   - auth: apiKey / env var
├── types.ts                    # Provider / Model / Api / StreamOptions 类型定义
├── retry.ts                    # 传输重试（5xx/429 指数退避 3 次）
├── sanitize.ts                 # 消息治理（role alternation / empty content / image strip）
├── mixin.ts                    # MixinProvider（L2，多 provider 故障转移 + 弹回）
└── fallback.ts                 # 后续待办：FallbackProvider + 熔断器
```

**核心接口**：

```typescript
// Api：协议实现
interface ApiStream<TApi extends Api> {
  stream(model: Model<TApi>, context: Context, options?: StreamOptions): AssistantMessageEventStream;
  streamSimple(model: Model<TApi>, context: Context, options?: SimpleStreamOptions): AssistantMessageEventStream;
}

// Provider：服务商声明
interface Provider<TApi extends Api = Api> {
  readonly id: string;           // "openai" | "anthropic" | "deepseek" | ...
  readonly name: string;
  readonly baseUrl?: string;
  readonly auth: { apiKey?: string; envVar?: string };
  getModels(): readonly Model<TApi>[];
  stream(model: Model<TApi>, context: Context, options?: StreamOptions): AssistantMessageEventStream;
}

// Model：模型元数据
interface Model<TApi extends Api = Api> {
  readonly provider: string;     // "openai"
  readonly id: string;           // "gpt-4o"
  readonly api: TApi;            // "openai-responses"
  readonly contextWindow: number;
  readonly maxTokens: number;
  readonly thinking?: ThinkingLevelMap;
  readonly compat?: ModelCompat; // 协议兼容性标记
}
```

**扩展流程**（新增一个 OpenAI-compatible provider）：

```typescript
// providers/groq.ts — 只需声明配置，复用 openai-responses API
export const groqProvider: Provider<"openai-responses"> = {
  id: "groq",
  name: "Groq",
  baseUrl: "https://api.groq.com/openai/v1",
  auth: { envVar: "GROQ_API_KEY" },
  getModels: () => [
    { provider: "groq", id: "llama-3.3-70b", api: "openai-responses", contextWindow: 131072, maxTokens: 32768 },
  ],
  stream: (model, ctx, opts) => openaiResponsesApi.stream(model, ctx, opts),
};
```

---

## 6. Tool Registry & 原子工具

### 6.1 pi-agent 的 Tool 系统

**接口设计**（基于 [types.ts](file:///Users/evan/projects/aptbot/pi/packages/agent/src/types.ts)）：

```typescript
// 工具定义
interface AgentTool<TParameters, TDetails> extends Tool<TParameters> {
  label: string;                                    // UI 显示名
  prepareArguments?: (args: unknown) => TParameters; // 参数预处理钩子
  execute: (
    toolCallId: string,
    params: TParameters,
    signal?: AbortSignal,
    onUpdate?: AgentToolUpdateCallback<TDetails>,    // 流式进度回调
  ) => Promise<AgentToolResult<TDetails>>;           // 结构化结果
  executionMode?: "sequential" | "parallel";         // per-tool 执行模式
}

// 工具结果
interface AgentToolResult<T> {
  content: (TextContent | ImageContent)[];  // 返回给 LLM 的内容
  details: T;                                // 结构化详情（给 UI/日志）
  terminate?: boolean;                       // 是否终止 agent
}
```

**关键特点**：
1. **结构化返回**：`AgentToolResult<T>` 泛型，`content` 返回给 LLM，`details` 给 UI，分离关注点
2. **流式进度**：`onUpdate` 回调，工具执行中可发 `tool_execution_update` 事件
3. **类型安全**：`TParameters` 用 TypeBox schema，`Static<TSchema>` 推导参数类型
4. **per-tool 执行模式**：`executionMode` 字段，部分工具串行部分并行
5. **参数预处理**：`prepareArguments` 钩子，在 schema 校验前转换参数
6. **before/after 钩子**：`config.beforeToolCall` / `config.afterToolCall`，可拦截/修改工具调用
7. **terminate 语义**：工具可主动终止整个 agent（所有工具都 terminate 时才真正终止）
8. **工具定义来源**：使用 pi-ai 包的 `Tool<TParameters>` 接口（含 name/description/parameters schema）

### 6.2 nanobot 的 Tool 系统

**接口设计**（基于 [base.py](file:///Users/evan/projects/aptbot/nanobot/nanobot/agent/tools/base.py)）：

```python
class Tool(ABC):
    @property
    @abstractmethod
    def name(self) -> str: ...
    @property
    @abstractmethod
    def description(self) -> str: ...
    @property
    @abstractmethod
    def parameters(self) -> dict[str, Any]: ...   # JSON Schema

    @property
    def read_only(self) -> bool: return False      # 只读标记
    @property
    def concurrency_safe(self) -> bool:            # 并发安全
        return self.read_only and not self.exclusive
    @property
    def exclusive(self) -> bool: return False       # 独占执行

    @abstractmethod
    async def execute(self, **kwargs) -> Any: ...   # 返回 Any（通常是 str）

    # 内置参数校验
    def cast_params(self, params) -> dict: ...      # 类型转换
    def validate_params(self, params) -> list[str]: ...  # JSON Schema 校验
    def to_schema(self) -> dict: ...                # OpenAI function schema
```

**ToolRegistry**（基于 [registry.py](file:///Users/evan/projects/aptbot/nanobot/nanobot/agent/tools/registry.py)）：

```python
class ToolRegistry:
    def register(self, tool: Tool) -> None: ...
    def unregister(self, name: str) -> None: ...
    def get(self, name: str) -> Tool | None: ...
    def get_definitions(self) -> list[dict]: ...    # 带缓存的 OpenAI function schemas
    def prepare_call(self, name, params) -> tuple[Tool|None, Any, str|None]: ...
```

**内置工具**（24 个文件）：
- **文件系统**：`filesystem.py`（read_file / write_file / apply_patch / list_dir）
- **执行**：`shell.py`（exec）、`sandbox.py`、`exec_session.py`
- **搜索**：`search.py`（grep / find_files）
- **网络**：`web.py`（web_search / web_fetch）
- **MCP**：`mcp.py`
- **定时**：`cron.py`
- **子代理**：`spawn.py`
- **图像生成**：`image_generation.py`
- **长任务**：`long_task.py`
- **自我修改**：`self.py`

**关键特点**：
1. **返回值自由**：`execute()` 返回 `Any`，在 `AgentRunner._normalize_tool_result()` 统一转 `str`
2. **read_only / concurrency_safe / exclusive**：三级并发标记，比 pi-agent 的 binary sequential/parallel 更细
3. **参数校验内置**：`cast_params` + `validate_params`，自动类型转换（str→int/bool 等）
4. **装饰器注册**：`@tool_parameters({...})` 声明式参数定义
5. **工具发现**：`loader.py` 通过 `pkgutil` 自动发现 + `ToolContext.enabled()` 条件加载
6. **工具结果截断**：`max_tool_result_chars` 配置，超出截断
7. **before/after 钩子**：`hook.before_execute_tools()`（批量，非 per-tool）

### 6.3 核心差异对比

| 维度 | pi-agent | nanobot |
|---|---|---|
| **工具返回** | 结构化 `AgentToolResult<T>` | `Any`（统一 normalize 为 str） |
| **类型安全** | TypeBox schema + Static 推导 | JSON Schema dict + 运行时校验 |
| **流式进度** | ✅ `onUpdate` 回调 | ❌ 无 |
| **执行模式** | per-tool `executionMode` | 三级 `read_only` / `concurrency_safe` / `exclusive` |
| **参数预处理** | `prepareArguments` 钩子 | `cast_params` 内置 |
| **before/after** | per-tool 钩子（beforeToolCall/afterToolCall） | 批量钩子（before_execute_tools） |
| **terminate** | ✅ 工具可主动终止 agent | ❌ 无 |
| **工具发现** | 手动注册 | 自动发现（pkgutil + enabled 条件） |
| **结果截断** | 无 | `max_tool_result_chars` |

### 6.4 aptbot MVP 工具清单

**MVP 核心工具（4 个）**：

| 工具 | 功能 | 参考来源 |
|---|---|---|
| `read_file` | 读取文件内容 | pi-agent Read + nanobot read_file |
| `write_file` | 写入/创建文件 | pi-agent Write + nanobot write_file |
| `exec` | 执行 shell 命令 | pi-agent Bash + nanobot exec |
| `search` | 搜索代码/文件 | pi-agent Glob/Grep + nanobot grep/find_files |

**后续扩展工具**：
- `apply_patch`：精确文件编辑（nanobot apply_patch）
- `web_search` / `web_fetch`：网络搜索/抓取
- `mcp`：MCP 协议工具集成
- `image_generation`：图像生成
- `cron`：定时任务
- `spawn`：子代理

### 6.5 aptbot Tool 系统设计（已定）

**关键决策**：

1. **工具返回类型：结构化** ✅
   - `AgentToolResult<T>` 泛型，`content` 返回给 LLM，`details` 给 UI，`terminate` 终止 agent
   - TypeScript 泛型天然支持，比 nanobot 的自由返回类型安全

2. **流式进度：接口预留** ✅
   - `onUpdate` 回调签名在接口中预留，但 MVP 工具不实现
   - `agentLoop` 已定义 `tool_execution_update` 事件，后续工具加 `onUpdate` 即可对接

3. **执行模式：pi-agent 风格** ✅
   - per-tool `executionMode: "sequential" | "parallel"`
   - MVP 默认串行，后续按工具标记开启并行

4. **工具注册：手动注册** ✅
   - 显式调用 `toolRegistry.register()`，可控清晰

5. **before/after 钩子：per-tool** ✅
   - 参考 pi-agent 的 `config.beforeToolCall` / `config.afterToolCall`
   - MVP 先不做，后续按需加

### 6.6 aptbot Tool 最终设计（已定）

```
src/tool/
├── types.ts              # AgentTool / AgentToolResult / ToolRegistry 接口
├── registry.ts           # ToolRegistry 实现（register / get / getDefinitions / prepareCall）
├── validate.ts           # 参数校验（JSON Schema 校验 + 类型转换）
├── tools/                # 内置工具实现
│   ├── read-file.ts      # read_file 工具
│   ├── write-file.ts     # write_file 工具
│   ├── exec.ts           # exec 工具
│   └── search.ts         # search 工具（grep + glob）
└── builtin.ts            # 注册所有内置工具的入口函数
```

**核心接口**：

```typescript
// 工具定义
interface AgentTool<TParams = any, TDetails = any> {
  readonly name: string;
  readonly label: string;           // UI 显示名
  readonly description: string;
  readonly parameters: Record<string, any>;  // JSON Schema
  readonly executionMode?: "sequential" | "parallel";
  readonly prepareArguments?: (args: unknown) => TParams;
  execute(
    toolCallId: string,
    params: TParams,
    signal?: AbortSignal,
    onUpdate?: (partial: AgentToolResult<TDetails>) => void,  // 预留，MVP 不实现
  ): Promise<AgentToolResult<TDetails>>;
}

// 工具结果
interface AgentToolResult<T = any> {
  content: (TextContent | ImageContent)[];  // 返回给 LLM
  details: T;                                // 结构化详情（给 UI/日志）
  terminate?: boolean;                       // 是否终止 agent
}

// 工具注册表
interface ToolRegistry {
  register(tool: AgentTool): void;
  unregister(name: string): void;
  get(name: string): AgentTool | undefined;
  getDefinitions(): ToolDefinition[];         // OpenAI function schemas（带缓存）
  has(name: string): boolean;
}
```

**MVP 工具列表**：

| 工具 | name | 功能 | executionMode |
|---|---|---|---|
| `read_file` | read_file | 读取文件内容，支持行号范围 | parallel |
| `write_file` | write_file | 写入/创建文件 | sequential |
| `exec` | exec | 执行 shell 命令 | sequential |
| `search` | search | 搜索代码/文件（grep + glob） | parallel |

---

## 7. Memory System

### 7.1 pi-agent 的 Memory 系统

**整体架构**：会话存储 + Compaction 压缩 + 分支摘要。pi-agent 的"记忆"严格等同于**会话消息树（SessionTree）+ Compaction 摘要**，没有跨会话的长期记忆文件。

**1. 会话存储**（[session/session.ts](file:///Users/evan/projects/aptbot/pi/packages/agent/src/harness/session/session.ts)）：
- 会话是**树结构**（SessionTreeEntry），支持分支（fork）和分叉编辑
- 每个 entry 是 union 类型：`message` / `custom_message` / `compaction` / `branch_summary` / `model_change` / `thinking_level_change` / `active_tools_change` / `label` / `session_info` / `leaf`
- 多种存储后端：`InMemorySessionRepo`（内存）、`JsonlSessionRepo`（文件）、`MemoryRepo`（通用抽象）

**2. Compaction 压缩**（[compaction/compaction.ts](file:///Users/evan/projects/aptbot/pi/packages/agent/src/harness/compaction/compaction.ts)）：
- 触发条件：`contextTokens > contextWindow - reserveTokens`（默认 reserve 16384）
- 保留预算：`keepRecentTokens: 20000`（保留最近约 2 万 token 不压缩）
- 切点查找（`findCutPoint`）：从尾部累计 token，达到 keepRecentTokens 后向前找最近的合法切点（user/branchSummary/custom 等消息）
- **Split Turn 处理**：若切点落在 turn 中间，将 turn 前缀单独摘要（`TURN_PREFIX_SUMMARIZATION_PROMPT`）
- **增量摘要**：保留 `previousSummary`，使用 `UPDATE_SUMMARIZATION_PROMPT` 让 LLM 增量更新而非全量重写
- **文件操作追踪**：`extractFileOpsFromMessage` 提取 read/write/edit 工具调用涉及的文件，作为 `<read-files>` / `<modified-files>` 标签附在摘要末尾
- 摘要格式：结构化 markdown（Goal / Constraints / Progress / Decisions / Next Steps / Critical Context）

**3. 自定义消息类型**（[messages.ts](file:///Users/evan/projects/aptbot/pi/packages/agent/src/harness/messages.ts)）：
- `bashExecution`：bash 执行记录（命令、输出、退出码、截断标记）
- `custom`：应用自定义消息（customType / content / display / details）
- `branchSummary`：分支合并摘要
- `compactionSummary`：压缩摘要（summary / tokensBefore / timestamp）
- 通过 declaration merging 扩展 `CustomAgentMessages` 接口

### 7.2 nanobot 的 Memory 系统

**整体架构**：会话存储 + Consolidator 整合 + AutoCompact 闲置压缩 + 跨会话长期记忆文件（MEMORY.md / USER.md / SOUL.md / history.jsonl）。这是与 pi-agent 最大的差异。

**1. 会话存储**（[session/manager.py](file:///Users/evan/projects/aptbot/nanobot/nanobot/session/manager.py)）：
- 会话是**线性 list**（messages），无分支
- `Session` dataclass：`key`（channel:chat_id）、`messages`、`metadata`、`last_consolidated`（已整合的消息数偏移）
- 文件存储：每会话一个 JSON 文件，`FILE_MAX_MESSAGES = 2000`

**2. Consolidator 整合**（[agent/memory.py](file:///Users/evan/projects/aptbot/nanobot/nanobot/agent/memory.py#L641)）：
- **整合而非压缩**：将"被驱逐的旧消息"摘要写入 `memory/history.jsonl`（追加），原始消息从会话移除
- `consolidation_ratio: 0.5`：当 token 超过 contextWindow 时，整合到只剩 50%
- `last_consolidated` 偏移：记录已整合到哪条消息，避免重复整合
- 每会话一把 `asyncio.Lock`，串行化整合操作

**3. AutoCompact 闲置压缩**（[agent/autocompact.py](file:///Users/evan/projects/aptbot/nanobot/nanobot/agent/autocompact.py)）：
- **闲置触发**：`session_ttl_minutes` 配置，会话超过 TTL 未活跃则触发
- `compact_idle_session(key, max_suffix=8)`：保留最近 8 条消息，其余整合
- 后台调度：`check_expired()` 扫描所有会话，调度后台 `_archive` 任务
- 跳过内部会话（`dream:` / `cron:` 前缀）和活跃会话

**4. 跨会话长期记忆**（`MemoryStore`）：
- **MEMORY.md**：手写/LLM 维护的长期笔记（git 跟踪）
- **USER.md**：用户画像档案（偏好、背景）
- **SOUL.md**：agent 人格定义
- **history.jsonl**：所有会话的整合摘要流（cursor 递增，append-only）
- **GitStore**：MEMORY.md / USER.md / SOUL.md / .dream_cursor 通过 git 版本管理

### 7.3 核心差异对比

| 维度 | pi-agent | nanobot |
|---|---|---|
| **会话结构** | 树（支持 fork/分支） | 线性 list |
| **存储后端** | 内存 / JSONL 抽象 | 单一文件 |
| **压缩触发** | 上下文窗口逼近（实时） | 上下文窗口 + 闲置 TTL（双重） |
| **压缩产物** | compaction 摘要 entry（仍在会话树内） | history.jsonl 追加（脱离会话） |
| **压缩策略** | keepRecentTokens 保留尾部 + 增量摘要 | consolidation_ratio 比例压缩 + 整合到外部文件 |
| **Split Turn** | ✅ 切点落在 turn 中间时单独摘要前缀 | ❌ 无（线性结构无此问题） |
| **文件操作追踪** | ✅ `<read-files>` / `<modified-files>` 标签 | ❌ 无 |
| **跨会话记忆** | ❌ 无（每会话独立） | ✅ MEMORY.md / USER.md / SOUL.md / history.jsonl |
| **长期记忆版本管理** | ❌ 无 | ✅ GitStore |
| **闲置压缩** | ❌ 无 | ✅ AutoCompact + TTL |
| **自定义消息类型** | ✅ declaration merging 扩展 | ❌ 全部 dict |

### 7.4 aptbot MVP 记忆需求

**MVP 必须**：
1. **单会话短期记忆**：保存当前会话的 messages，重启后能恢复
2. **上下文窗口压缩**：消息超过窗口时自动压缩，避免请求失败
3. **会话列表**：列出/切换/删除会话

**MVP 不做**：
- 跨会话长期记忆（MEMORY.md / USER.md / SOUL.md）—— 后续做
- 会话分支（fork）—— 后续做
- 闲置 TTL 压缩 —— 后续做
- Git 版本管理 —— 后续做

### 7.5 aptbot Memory 系统设计（已定）

**关键决策**：

1. **会话结构：线性** ✅
   - 简单，MVP 够用；后续要分支再扩展为树

2. **压缩策略：混合** ✅
   - MVP：会话内 Compaction（摘要作为 entry 留在会话内，会话是单一数据源）
   - 后续：跨会话长期记忆文件（MEMORY.md / USER.md / SOUL.md）—— 待办

3. **存储后端：JSONL** ✅
   - 每会话一个 `.jsonl` 文件，append-only，写入高效
   - 参考 pi-agent 的 `JsonlSessionRepo`

4. **压缩触发时机：实时兜底** ✅
   - MVP：每次 turn 后检查 token，超 `contextWindow - reserveTokens` 就压缩
   - 后续待办：闲置 TTL 压缩（AutoCompact 风格，后台压缩不活跃会话）

5. **摘要方式：增量** ✅
   - 保留 `previousSummary`，LLM 增量更新（参考 pi-agent 的 `UPDATE_SUMMARIZATION_PROMPT`）
   - 更省 token，摘要格式结构化（Goal / Progress / Decisions / Next Steps / Critical Context）

6. **Split Turn 处理：天然规避** ✅
   - 线性结构下按 user 消息作为切点，天然不会落在 turn 中间

### 7.6 aptbot Memory 最终设计（已定）

```
src/memory/
├── types.ts              # Session / SessionEntry / CompactionSummary / WorkingMemory 等类型
├── session-repo.ts       # SessionRepo 接口 + JSONL 实现
│   - create() / open(id) / list() / delete(id)
│   - append(id, entry) / getEntries(id)
├── compaction.ts         # Compaction 压缩逻辑
│   - estimateContextTokens(messages) → number
│   - shouldCompact(tokens, contextWindow, reserve) → boolean
│   - findCutPoint(messages, keepRecentTokens) → index
│   - generateSummary(messages, previousSummary?, model) → string
│   - compact(session, model) → CompactionResult
├── working-memory.ts     # Working Memory 管理（注入/继承/快照）
│   - injectKeyInfo(systemPrompt, workingMemory) → string
│   - snapshot(workingMemory) → SessionEntry
│   - inheritFrom(oldSession) → WorkingMemory
├── tokenize.ts           # token 估算（字符数 / 4 启发式）
└── prompts.ts            # SUMMARIZATION_PROMPT / UPDATE_SUMMARIZATION_PROMPT
```

**核心接口**：

```typescript
// 会话条目（union type）
type SessionEntry =
  | { type: "message"; id: string; message: AgentMessage; timestamp: number }
  | { type: "compaction"; id: string; summary: string; tokensBefore: number;
      firstKeptEntryId: string; timestamp: number }
  | { type: "label"; id: string; label: string; timestamp: number }
  | { type: "working_memory"; id: string; keyInfo: string; timestamp: number };

// 会话元数据
interface SessionMetadata {
  id: string;
  title?: string;
  createdAt: number;
  updatedAt: number;
}

// 会话仓库
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

// 压缩配置
interface CompactionSettings {
  enabled: boolean;
  reserveTokens: number;       // 默认 16384
  keepRecentTokens: number;    // 默认 20000
}
```

**压缩流程**（实时兜底）：

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

**后续待办**：
- [ ] 跨会话长期记忆：MEMORY.md / USER.md / SOUL.md + GitStore 版本管理
- [ ] 闲置 TTL 压缩：AutoCompact 后台扫描 + 压缩不活跃会话
- [ ] 会话分支（fork）：线性 → 树结构扩展
- [ ] 文件操作追踪：`<read-files>` / `<modified-files>` 标签
- [ ] 会话搜索：跨会话关键词搜索（依赖长期记忆）

### 7.7 Working Memory（已定，纳入 MVP）

> 参考 GenericAgent 的 `handler.working['key_info']` + `update_working_checkpoint` 工具。详见 [comparison-pi-nanobot-ga.md §7](comparison-pi-nanobot-ga.md)。

**定位**：Compaction 的补充（不是替代）。Compaction 是"被动全局压缩"，解决 context 装不下；Working Memory 是"主动局部保鲜"，解决关键信息被稀释/丢失 + 跨 session 任务连续性。

**解决的痛点**：
1. **关键约束漂移**：长对话中"用 TypeScript"、"保持双层 while"等约束被工具调用稀释，LLM 可能漂移。key_info 每轮注入，约束始终在最近 context。
2. **任务进度丢失**：Compaction 摘要可能丢"已做完步骤 1-4，当前在步骤 5"。key_info 主动保存进度。
3. **跨 session 连续性**：新 session 默认无旧上下文，显式继承 key_info 可恢复任务状态。
4. **零额外 LLM 调用**：`update_working_memory` 工具调用即任务执行的一部分（LLM 主动决策"什么重要"），不触发摘要。

**已定决策**：
- **纳入 MVP**：实现轻（1 工具 + 1 注入 + 1 持久化 + 显式继承），解决核心痛点
- **LLM 自主决定**：不设系统强制提醒（如 GA 每 7 轮提示），让 LLM 自主判断何时更新
- **持久化到 SessionEntry**：新增 `working_memory` entry type，session 恢复时 key_info 也恢复
- **显式继承**：不自动跨 session 继承；通过 `/continue <oldSessionId>` 命令显式继承

**核心接口**：

```typescript
// Working Memory 状态（AgentSession 持有）
interface WorkingMemory {
  keyInfo: string;          // LLM 主动维护的关键信息（约束/进度/教训）
  updatedAt: number;
  passedSessions: number;   // 跨 session 计数（0=本 session 原创，>0=继承自旧 session）
}

// 新增工具（注册到 ToolRegistry）
interface UpdateWorkingMemoryTool extends AgentTool {
  readonly name: "update_working_memory";
  readonly label: "更新工作记忆";
  readonly description: "更新当前任务的关键信息（约束/进度/教训）。长任务中每隔一段调用以防止关键上下文漂移。";
  readonly parameters: {
    type: "object";
    properties: {
      key_info: { type: "string"; description: "当前任务的关键约束、进度、教训" };
      clear: { type: "boolean"; description: "新任务时清空旧 key_info", default: false };
    };
    required: ["key_info"];
  };
  // execute: 更新 session.workingMemory + 持久化 working_memory entry 到 SessionRepo
}

// 每轮注入 system prompt（agentLoop 构造 context 时调用）
function injectKeyInfo(basePrompt: string, workingMemory: WorkingMemory): string {
  if (!workingMemory.keyInfo) return basePrompt;
  let prompt = basePrompt;
  prompt += `\n<key_info>\n${workingMemory.keyInfo}\n</key_info>`;
  if (workingMemory.passedSessions > 0) {
    prompt += `\n[SYSTEM] 此为前 ${workingMemory.passedSessions} 个对话的 key_info，若已在新任务，请调用 update_working_memory 更新或清除。`;
  }
  return prompt;
}

// 持久化：工具执行时写入 SessionEntry
async function persistWorkingMemory(session: Session, keyInfo: string): Promise<void> {
  await session.append({
    type: "working_memory",
    id: generateId(),
    keyInfo,
    timestamp: Date.now(),
  });
}

// 显式继承：/continue <oldSessionId> 命令触发
async function inheritWorkingMemory(oldSessionId: string): Promise<WorkingMemory> {
  const oldSession = await sessionRepo.open(oldSessionId);
  const entries = await oldSession.getEntries();
  // 取最后一条 working_memory entry
  const lastWm = [...entries].reverse().find(e => e.type === "working_memory");
  return {
    keyInfo: lastWm?.keyInfo ?? "",
    updatedAt: lastWm?.timestamp ?? Date.now(),
    passedSessions: 1,  // 标记为继承（新 session 的 passedSessions=1）
  };
}

// session 恢复：从 entries 重建 workingMemory
function restoreWorkingMemory(entries: SessionEntry[]): WorkingMemory {
  const lastWm = [...entries].reverse().find(e => e.type === "working_memory");
  return {
    keyInfo: lastWm?.keyInfo ?? "",
    updatedAt: lastWm?.timestamp ?? Date.now(),
    passedSessions: 0,  // 恢复同一 session，passedSessions 不变
  };
}
```

**数据流**：

```
工具调用更新:
  LLM 调 update_working_memory({key_info: "新关键信息"})
    → AgentSession.workingMemory.keyInfo = keyInfo
    → session.append({type:"working_memory", keyInfo, timestamp})
    → 工具返回 AgentToolResult{content:"已更新工作记忆"}

每轮注入（agentLoop 构造 context 时）:
  systemPrompt = injectKeyInfo(basePrompt, session.workingMemory)
  → <key_info>...新关键信息...</key_info>
  → [SYSTEM] 此为前 N 个对话的 key_info（若 passedSessions>0）

session 恢复（open(sessionId) 时）:
  entries = await session.getEntries()
  workingMemory = restoreWorkingMemory(entries)
  → 从最后一条 working_memory entry 恢复 keyInfo

显式跨 session 继承（/continue <oldId> 命令）:
  newSession = await sessionRepo.create()
  newSession.workingMemory = await inheritWorkingMemory(oldId)
  → 新 session 携带旧 session 的 key_info + passedSessions=1
```

**Working Memory vs Compaction**：

| 维度 | Compaction | Working Memory |
|---|---|---|
| 触发 | 系统自动（token 阈值） | LLM 主动（工具调用） |
| 内容 | 全局摘要（历史回顾） | 任务关键信息（约束/进度/教训） |
| 粒度 | 粗（整段对话） | 细（LLM 选择的关键点） |
| 注入 | 压缩后替代旧 context | 每轮叠加到 system prompt |
| 跨 session | 摘要存长期记忆（待办） | key_info 显式继承 |
| token 成本 | 高（调 LLM 摘要） | 零（工具调用即任务执行） |
| 信息损失 | 中（摘要丢细节） | 低（LLM 主动选关键信息） |
| 过时风险 | 低（每次重新摘要） | 中（LLM 可能忘记更新） |

**MVP 范围**：
- ✅ `update_working_memory` 工具
- ✅ key_info 每轮注入 system prompt
- ✅ working_memory SessionEntry 持久化
- ✅ session 恢复时重建 workingMemory
- ✅ `/continue <oldSessionId>` 命令显式继承（加入 §11.6 CommandRegistry）

**后续待办**：
- [ ] 系统强制提醒（每 N 轮提示 LLM 更新）：MVP 不做，待实测后评估
- [ ] key_info 长度限制 + 截断策略：MVP 简单截断到 N 字符
- [ ] 多 key_info 槽位（如 task/constraints/lessons 分离）：MVP 单槽位，后续按需扩展
- [ ] key_info 变更历史可视化（UI 展示 key_info 演进）：L2

---

## 8. Skills 系统

### 8.1 pi-agent 的 Skills 系统

**整体架构**：Skills 是声明式扩展——加载 `SKILL.md` 文件，提取 name/description 注入系统提示，agent 按需读取完整内容。

**1. Skill 定义**（[harness/types.ts](file:///Users/evan/projects/aptbot/pi/packages/agent/src/harness/types.ts)）：

```typescript
interface Skill {
  name: string;                  // 稳定名称，用于查找
  description: string;           // 模型可见的简短描述
  content: string;               // 完整 skill 指令
  filePath: string;              // skill 文件绝对路径
  disableModelInvocation?: boolean;  // 排除出模型可见列表，但仍可显式调用
}
```

**2. Skill 加载**（[harness/skills.ts](file:///Users/evan/projects/aptbot/pi/packages/agent/src/harness/skills.ts)）：
- `loadSkills(env, dirs)`：递归遍历目录，加载 `SKILL.md`
- 也支持根目录直接 `.md` 文件作为 skill（`includeRootFiles`）
- **YAML frontmatter**：`---\nname: ...\ndescription: ...\n---\n` + markdown body
- **.gitignore 支持**：加载 `.gitignore` / `.ignore` / `.fdignore`，过滤 skill 文件
- **诊断信息**：加载失败返回 `SkillDiagnostic`（warning + code + message + path）
- **名称校验**：`/^[a-z0-9-]+$/`，不超过 64 字符，不能以 `-` 开头/结尾，不能连续 `--`
- **描述校验**：不超过 1024 字符
- **name 默认值**：frontmatter name > 父目录名

**3. Skill 调用**：
- `formatSkillInvocation(skill, additionalInstructions?)`：将 skill 内容包装为 `<skill name="..." location="...">` XML 块
- 模型可见列表：`formatSkillsForSystemPrompt(skills)` 生成 agentskills.io 兼容的系统提示块
- 显式调用：应用层可通过 `name` 查找 skill 并触发

**4. 关键特点**：
- **agentskills.io 兼容**：遵循社区标准的 SKILL.md 格式
- **声明式**：skill 是知识/指令，不是代码；agent 读取后按指令操作
- **分离 metadata 与 content**：name/description 注入系统提示（省 token），content 按需读取
- **ExecutionEnv 抽象**：文件操作通过 `env.fileInfo()` / `env.readTextFile()` 抽象，可适配不同环境
- **sourced skills**：`loadSourcedSkills` 支持 source 标签追溯 skill 来源

### 8.2 nanobot 的 Skills 系统

**整体架构**：Skills 加载器 + 渐进式加载（progressive loading）+ 依赖检查（requirements）。

**1. SkillsLoader**（[agent/skills.py](file:///Users/evan/projects/aptbot/nanobot/nanobot/agent/skills.py)）：

```python
class SkillsLoader:
    def __init__(self, workspace, builtin_skills_dir, disabled_skills):
        self.workspace_skills = workspace / "skills"
        self.builtin_skills = builtin_skills_dir or BUILTIN_SKILLS_DIR

    def list_skills(self, filter_unavailable=True) -> list[dict]: ...  # 列出所有 skill
    def load_skill(self, name) -> str | None: ...                       # 加载单个 skill
    def load_skills_for_context(self, skill_names) -> str: ...          # 加载多个 skill 内容
    def build_skills_summary(self, exclude) -> str: ...                 # 构建摘要（name + desc + path + 可用性）
    def get_skill_availability(self, name) -> tuple[bool, str]: ...     # 检查依赖
    def get_always_skills(self) -> list[str]: ...                       # always=true 的 skill
```

**2. Skill 来源**：
- **workspace skills**：`{workspace}/skills/{name}/SKILL.md`
- **builtin skills**：`nanobot/skills/{name}/SKILL.md`（如 `skill-creator` / `update-setup`）
- workspace 优先级高于 builtin（同名覆盖）

**3. 依赖检查**（nanobot 独有）：
- frontmatter `metadata.nanobot.requires`：
  - `bins`: 需要的 CLI 命令（`shutil.which` 检查）
  - `env`: 需要的环境变量（`os.environ.get` 检查）
- `_check_requirements()`：返回 skill 是否可用
- `build_skills_summary()`：标注 unavailable skill 及缺失依赖
- `get_always_skills()`：`always=true` 的 skill 始终注入上下文

**4. 渐进式加载**（nanobot 独有）：
- 系统提示只注入 **摘要**（name + description + path + 可用性）
- agent 需要时用 `read_file` 工具读取完整 SKILL.md
- 节省 token：100 个 skill 的摘要 << 100 个 skill 的完整内容

**5. Skill 结构**（[skills/skill-creator/SKILL.md](file:///Users/evan/projects/aptbot/nanobot/nanobot/skills/skill-creator/SKILL.md)）：

```
skill-name/
├── SKILL.md (required)
│   ├── YAML frontmatter
│   │   ├── name (required)
│   │   └── description (required)
│   └── Markdown body
└── (optional)
    ├── scripts/       可执行脚本
    ├── references/    参考文档
    └── assets/        模板/图标等资源
```

### 8.3 核心差异对比

| 维度 | pi-agent | nanobot |
|---|---|---|
| **加载方式** | 递归遍历 + .gitignore | 两层目录（workspace + builtin） |
| **frontmatter** | YAML（name/description/disable-model-invocation） | YAML（name/description/metadata.nanobot.requires/always） |
| **依赖检查** | ❌ 无 | ✅ bins/env 检查 |
| **渐进式加载** | ❌ 全量注入或显式调用 | ✅ 摘要注入 + read_file 按需读取 |
| **always 标记** | ❌ 无 | ✅ always=true 始终注入 |
| **disableModelInvocation** | ✅ 排除出模型列表但可显式调用 | ❌ 无（用 disabled_skills 全局禁用） |
| **sourced skills** | ✅ source 标签追溯 | ❌ source 仅区分 workspace/builtin |
| **诊断信息** | ✅ SkillDiagnostic 结构化 | ❌ 仅日志 |
| **名称校验** | ✅ 严格（a-z0-9-，64 字符） | ❌ 用目录名 |
| **ExecutionEnv 抽象** | ✅ 文件操作抽象 | ❌ 直接 Path |
| **根 .md 文件** | ✅ 支持 | ❌ 仅 SKILL.md |
| **skill-creator** | ❌ 无 | ✅ 内置 skill 创建工具 |

### 8.4 aptbot MVP Skills 需求

**MVP 必须**：
1. **SKILL.md 加载**：从 `skills/` 目录加载 SKILL.md 文件
2. **系统提示注入**：将 skill 的 name + description 注入系统提示
3. **显式调用**：应用层可通过 name 查找并触发 skill

**MVP 不做**：
- 依赖检查（bins/env）—— 后续做
- 渐进式加载（摘要 + read_file 按需）—— 后续做（MVP 先全量注入 description）
- always 标记 —— 后续做
- skill-creator 工具 —— 后续做

### 8.5 aptbot Skills 系统设计（已定）

**关键决策**：

1. **加载范围：两层** ✅
   - workspace skills（`{workspace}/skills/`）+ builtin skills（`src/skills/`）
   - workspace 优先级高于 builtin（同名覆盖）

2. **frontmatter 字段：最小集** ✅
   - `name` / `description` / `disableModelInvocation`
   - 后续按需扩展 `metadata.requires` / `always`

3. **系统提示注入策略：全量 description** ✅
   - MVP 所有 skill 的 name+description 都注入系统提示
   - 后续待办：渐进式加载（摘要注入 + read_file 按需读取 content）

4. **Skill 调用方式：模型自主 + 显式调用** ✅
   - 模型看到 description 后自主决定是否读取完整 content
   - 应用层可通过 name 显式触发 skill

5. **ExecutionEnv 抽象：需要** ✅
   - 文件操作通过 `env.fileInfo()` / `env.readTextFile()` 抽象
   - 适配 Web/CLI 等不同环境，为后续多渠道预留

### 8.6 aptbot Skills 最终设计（已定）

```
src/skills/
├── types.ts              # Skill / SkillDiagnostic / SkillFrontmatter 类型
├── loader.ts             # loadSkills(env, dirs) 加载逻辑
│   - 递归遍历 + .gitignore 过滤
│   - YAML frontmatter 解析
│   - 名称校验（a-z0-9-，64 字符）
│   - 描述校验（1024 字符）
├── system-prompt.ts      # formatSkillsForSystemPrompt(skills) 系统提示生成
├── invocation.ts         # formatSkillInvocation(skill, additional?) 调用包装
├── env.ts                # ExecutionEnv 接口（fileInfo / readTextFile / listDir / canonicalPath）
└── builtin/              # 内置 skills
    └── (后续添加)
```

**核心接口**：

```typescript
// Skill 定义
interface Skill {
  readonly name: string;                  // 稳定名称，a-z0-9-，<=64 字符
  readonly description: string;           // 模型可见描述，<=1024 字符
  readonly content: string;               // 完整 skill 指令（markdown body）
  readonly filePath: string;              // SKILL.md 绝对路径
  readonly disableModelInvocation?: boolean;  // 排除出模型列表但可显式调用
}

// Skill 诊断
interface SkillDiagnostic {
  type: "warning";
  code: "file_info_failed" | "list_failed" | "read_failed" | "parse_failed" | "invalid_metadata";
  message: string;
  path: string;
}

// ExecutionEnv 抽象（文件操作）
interface ExecutionEnv {
  fileInfo(path: string): Promise<Result<FileInfo, FsError>>;
  readTextFile(path: string): Promise<Result<string, FsError>>;
  listDir(path: string): Promise<Result<FileInfo[], FsError>>;
  canonicalPath(path: string): Promise<Result<string, FsError>>;
}

// 加载结果
interface LoadSkillsResult {
  skills: Skill[];
  diagnostics: SkillDiagnostic[];
}

// 加载函数
async function loadSkills(env: ExecutionEnv, dirs: string | string[]): Promise<LoadSkillsResult>;
```

**SKILL.md 格式**：

```markdown
---
name: my-skill
description: 简短描述，告诉模型何时使用这个 skill
---

# My Skill

完整的 skill 指令内容...
```

**系统提示注入**：

```typescript
// formatSkillsForSystemPrompt 生成的内容（注入系统提示）
`
## Skills

The following skills extend your capabilities. To use a skill, read its SKILL.md file using the read_file tool.

- **skill-a** — Description for skill A  `/path/to/skill-a/SKILL.md`
- **skill-b** — Description for skill B  `/path/to/skill-b/SKILL.md`
`
```

**加载流程**：

```
启动 →
  loadSkills(env, [workspaceSkillsDir, builtinSkillsDir]) →
    递归遍历目录 →
      遇到 SKILL.md → 解析 frontmatter → 校验 name/description →
      遇到 .gitignore → 加载过滤规则 →
      遇到子目录 → 递归 →
    返回 { skills, diagnostics } →
  formatSkillsForSystemPrompt(skills) → 注入系统提示
```

**后续待办**：
- [ ] 渐进式加载：摘要注入 + read_file 按需读取 content
- [ ] 依赖检查：`metadata.requires.bins` / `metadata.requires.env`
- [ ] always 标记：`always=true` 的 skill 始终注入完整 content
- [ ] skill-creator 工具：内置 skill 创建向导
- [ ] sourced skills：source 标签追溯 skill 来源

### 8.7 Skills 推荐创建机制（已定，不做自演化）

> 参考 GenericAgent 的自演化 skills（任务成功后自动结晶为 SOP）。aptbot 不做自动演化，但提供"推荐用户创建"的轻量替代。

**决策**：不做自演化 skill（L3 待办移除），改为"推荐用户创建 skill"机制。

**理由**：
- 自演化 skill 需要"任务成功"的判定标准，复杂且易误判（GA 的判定也不完美）
- 自动生成的 SOP 质量参差，可能污染 skills 库
- 推荐机制更轻、更可控：LLM 检测到重复模式 → 提示用户 → 用户决策是否创建

**机制设计**：

```
LLM 检测到重复模式（如同一任务结构多次出现）→
  在回复中建议："检测到您多次执行 X 任务，是否创建 skill 以便复用？" →
  用户同意 → 调用 /skill create 命令（加入 CommandRegistry）→
    进入 skill 创建向导：
      1. 询问 skill name（a-z0-9-）
      2. 询问 description（何时使用）
      3. LLM 基于本次对话内容生成 skill content 草稿
      4. 用户确认/编辑草稿
      5. 写入 workspace skills 目录的 SKILL.md
      6. 下次启动自动加载
```

**MVP 范围**：不做（依赖 §11.6 CommandRegistry + 交互式命令，放 L2）。

**L2 待办**：
- [ ] `/skill create` 命令：交互式 skill 创建向导
- [ ] `/skill list` 命令：列出已加载 skills + 诊断信息
- [ ] `/skill edit <name>` 命令：编辑已有 skill
- [ ] LLM 主动推荐：检测重复模式时在回复中建议创建 skill（依赖 system prompt 引导）

**与自演化 skill 的对比**：

| 维度 | GA 自演化 skill | aptbot 推荐创建 |
|---|---|---|
| 触发 | 任务成功后自动 | LLM 检测重复模式 + 用户同意 |
| 决策 | 系统自动 | 用户决策 |
| 质量 | 参差（自动生成） | 可控（用户确认/编辑） |
| 复杂度 | 高（成功判定 + 结晶格式） | 低（命令 + 向导） |
| 风险 | 污染 skills 库 | 低（用户把关） |

---

## 9. Config 与持久化

### 9.1 pi-agent 的 Config 系统

**整体架构**：两层设置（global + project）+ JSON 文件 + 文件锁 + 会话 JSONL 持久化。pi-agent 的"配置"分为 **Settings（用户偏好）** 和 **Session（会话数据）** 两套独立系统。

**1. Settings**（[settings-manager.ts](file:///Users/evan/projects/aptbot/pi/packages/coding-agent/src/core/settings-manager.ts)）：

```typescript
interface Settings {
  // 模型与 Provider
  defaultProvider?: string;
  defaultModel?: string;
  defaultThinkingLevel?: "off" | "minimal" | "low" | "medium" | "high" | "xhigh";
  transport?: Transport;              // "auto" | "websocket" | "sse"
  // Agent 行为
  steeringMode?: "all" | "one-at-a-time";
  followUpMode?: "all" | "one-at-a-time";
  // 压缩
  compaction?: { enabled?; reserveTokens?; keepRecentTokens? };
  branchSummary?: { reserveTokens?; skipPrompt? };
  // 重试
  retry?: { enabled?; maxRetries?; baseDelayMs?; provider?: { timeoutMs?; maxRetries?; maxRetryDelayMs? } };
  // UI / 终端
  theme?: string;
  terminal?: { showImages?; imageWidthCells?; clearOnShrink?; showTerminalProgress? };
  images?: { autoResize?; blockImages? };
  // 扩展资源
  packages?: PackageSource[];         // npm/git 包源
  extensions?: string[];              // 本地扩展路径
  skills?: string[];                  // 本地 skill 路径
  prompts?: string[];                 // 本地 prompt 模板路径
  themes?: string[];                  // 本地主题路径
  // 其他
  sessionDir?: string;                // 自定义会话存储目录
  httpProxy?: string;
  // ... 40+ 字段
}
```

**两层设置**：
- **global**：`~/.pi/settings.json`（用户全局偏好）
- **project**：`{cwd}/.pi/settings.json`（项目级覆盖）
- **合并策略**：`deepMergeSettings(global, project)`，project 优先
- **project trust**：未信任的项目不加载 project settings（安全）

**文件锁**：
- `FileSettingsStorage` + `proper-lockfile`
- `withLock(scope, fn)`：读-改-写原子操作
- 锁重试：10 次，每次间隔 20ms

**设置迁移**：
- `migrateSettings()`：处理旧字段（`queueMode` → `steeringMode`、`websockets` → `transport`、skills object → array 等）

**2. Session 持久化**（[session-manager.ts](file:///Users/evan/projects/aptbot/pi/packages/coding-agent/src/core/session-manager.ts)）：

```typescript
interface SessionHeader {
  type: "session";
  version?: number;          // CURRENT_SESSION_VERSION = 3
  id: string;
  timestamp: string;
  cwd: string;
  parentSession?: string;
}

// 会话条目类型（union）
type SessionEntry =
  | SessionMessageEntry        // { type: "message"; message: AgentMessage }
  | ThinkingLevelChangeEntry   // { type: "thinking_level_change"; thinkingLevel }
  | ModelChangeEntry           // { type: "model_change"; provider; modelId }
  | CompactionEntry            // { type: "compaction"; summary; firstKeptEntryId; tokensBefore }
  | BranchSummaryEntry         // { type: "branch_summary"; fromId; summary }
  | CustomEntry                // { type: "custom"; customType; data }
  | LabelEntry                 // { type: "label"; targetId; label }
  | SessionInfoEntry;          // { type: "session_info"; name }
```

**存储格式**：JSONL 文件，每行一个 entry，首行是 SessionHeader。
- **append-only**：新 entry 追加到文件末尾
- **版本化**：`CURRENT_SESSION_VERSION = 3`，支持迁移
- **目录**：默认 `~/.pi/sessions/`，可 `sessionDir` 自定义

### 9.2 nanobot 的 Config 系统

**整体架构**：单一 `config.json` + Pydantic schema + 环境变量解析 + 多目录持久化。

**1. Config Schema**（[config/schema.py](file:///Users/evan/projects/aptbot/nanobot/nanobot/config/schema.py)）：

```python
class Config(Base):
  agents: AgentsConfig           # agent 默认配置
  providers: ProvidersConfig     # 30+ provider 配置
  channels: ChannelsConfig       # 渠道配置（extra=allow）
  tools: ToolsConfig             # 工具配置
  transcription: TranscriptionConfig  # 语音转写
  dream: DreamConfig             # Dream 记忆整合
  heartbeat: HeartbeatConfig     # 心跳服务
  api: ApiConfig                 # OpenAI 兼容 API 服务
  gateway: GatewayConfig         # Gateway 服务
  webui: WebuiConfig             # WebUI 配置

class AgentDefaults(Base):
  workspace: str = "~/.nanobot/workspace"
  model: str = "anthropic/claude-opus-4-5"
  provider: str = "auto"
  max_tokens: int = 8192
  context_window_tokens: int = 200_000
  temperature: float = 0.1
  max_tool_iterations: int = 200
  max_tool_result_chars: int = 16_000
  session_ttl_minutes: int = 15
  max_messages: int = 120
  consolidation_ratio: float = 0.5
  timezone: str = "UTC"
  bot_name: str = "nanobot"
  # ... 20+ 字段

class ProvidersConfig(Base):
  model_config = ConfigDict(extra="allow")  # 支持自定义 provider
  anthropic: ProviderConfig
  openai: ProviderConfig
  deepseek: ProviderConfig
  # ... 30+ 内置 provider
```

**2. Config 加载**（[config/loader.py](file:///Users/evan/projects/aptbot/nanobot/nanobot/config/loader.py)）：

```python
def load_config(config_path: Path | None = None) -> Config:
    path = config_path or get_config_path()  # ~/.nanobot/config.json
    config = Config()  # 默认值
    if path.exists():
        data = json.load(open(path))
        data = _migrate_config(data)        # 配置迁移
        config = Config.model_validate(data)  # Pydantic 校验
    _apply_ssrf_whitelist(config)
    return config

def resolve_config_env_vars(config: Config) -> Config:
    # 解析 ${VAR} 环境变量引用
    ...
```

**关键特点**：
- **Pydantic 校验**：类型安全，字段校验，别名支持（`AliasChoices`）
- **环境变量解析**：`${VAR}` 语法，递归解析所有字段
- **配置迁移**：`_migrate_config()` 处理旧版本字段
- **SSRF 白名单**：加载后应用到网络安全模块
- **extra=allow**：`ChannelsConfig` 和 `ProvidersConfig` 允许额外字段（插件 channel / 自定义 provider）

**3. 路径管理**（[config/paths.py](file:///Users/evan/projects/aptbot/nanobot/nanobot/config/paths.py)）：

```python
get_config_path()      # ~/.nanobot/config.json
get_data_dir()         # config.json 的父目录（实例数据目录）
get_runtime_subdir(name)  # {data_dir}/{name}
get_media_dir(channel) # {data_dir}/media/{channel}
get_cron_dir()         # {data_dir}/cron
get_logs_dir()         # {data_dir}/logs
get_webui_dir()        # {data_dir}/webui
get_workspace_path()   # ~/.nanobot/workspace（默认）
get_cli_history_path() # ~/.nanobot/history/cli_history
```

**4. 会话持久化**（[session/manager.py](file:///Users/evan/projects/aptbot/nanobot/nanobot/session/manager.py)）：
- 每会话一个 JSON 文件（`FILE_MAX_MESSAGES = 2000`）
- `Session` dataclass：`key` / `messages` / `metadata` / `last_consolidated`
- 存储目录：`{data_dir}/sessions/`

### 9.3 核心差异对比

| 维度 | pi-agent | nanobot |
|---|---|---|
| **配置文件** | 两层 JSON（global + project） | 单一 JSON（~/.nanobot/config.json） |
| **Schema 校验** | 无严格 schema（TypeScript interface + 运行时迁移） | Pydantic 严格校验 |
| **环境变量** | ❌ 无内建支持 | ✅ `${VAR}` 语法解析 |
| **配置迁移** | ✅ migrateSettings() | ✅ _migrate_config() |
| **文件锁** | ✅ proper-lockfile | ❌ 无 |
| **project trust** | ✅ 安全机制 | ❌ 无 |
| **会话存储** | JSONL（append-only，版本化） | 单 JSON（全量重写） |
| **会话版本** | ✅ CURRENT_SESSION_VERSION = 3 | ❌ 无版本号 |
| **路径管理** | getAgentDir() / getSessionsDir() | 完整路径助手体系（media/cron/logs/webui） |
| **provider 配置** | 在 Settings 中（defaultProvider + API key） | 独立 ProvidersConfig（30+ 内置 + 自定义） |
| **channel 配置** | 无（pi-agent 是单终端应用） | 独立 ChannelsConfig（extra=allow） |
| **工具配置** | 无（工具硬编码） | 独立 ToolsConfig（每工具可配置） |

### 9.4 aptbot MVP Config 需求

**MVP 必须**：
1. **单一配置文件**：`~/.aptbot/config.json`（或 YAML）
2. **Provider 配置**：API key / base URL / 默认模型
3. **Agent 配置**：默认模型、max_tokens、temperature、workspace 路径
4. **会话存储路径**：默认 `~/.aptbot/sessions/`
5. **环境变量支持**：`${VAR}` 语法解析 API key 等敏感信息

**MVP 不做**：
- 两层设置（global + project）—— 后续做
- 文件锁 —— 后续做（单用户场景不需要）
- project trust —— 后续做
- channel 配置 —— 后续做（MVP 只有 CLI/WebUI）
- dream / heartbeat / cron 配置 —— 后续做

### 9.5 aptbot Config 系统设计（已定）

**关键决策**：

1. **配置文件格式：JSON** ✅
   - 与 nanobot/pi-agent 一致，无额外依赖
   - `~/.aptbot/config.json`

2. **Schema 校验：Zod** ✅
   - TypeScript 原生，类型推导友好，运行时校验
   - 比 Pydantic 更轻量，比 pi-agent 的无 schema 更安全

3. **配置层级：单层** ✅
   - 单一 `~/.aptbot/config.json`，MVP 简单
   - 后续待办：两层（global + project）

4. **环境变量策略：两者都支持** ✅
   - 配置文件内 `${VAR}` 语法（如 `"apiKey": "${OPENAI_API_KEY}"`）
   - 纯 env var 覆盖（如 `APTBOT_OPENAI_API_KEY` 覆盖 `providers.openai.apiKey`）
   - env var 优先级高于配置文件值

5. **会话存储路径：可配置** ✅
   - 默认 `~/.aptbot/sessions/`
   - 可通过 `sessionDir` 自定义

6. **路径管理：参考 nanobot** ✅
   - `getDataDir()` / `getSessionsDir()` / `getWorkspacePath()` / `getLogsDir()`

### 9.6 aptbot Config 最终设计（已定）

```
src/config/
├── schema.ts             # Zod schema 定义（Config / AgentConfig / ProviderConfig）
├── loader.ts             # loadConfig(path?) / saveConfig(config, path?)
│   - JSON 读写
│   - Zod 校验
│   - ${VAR} 环境变量解析
│   - env var 覆盖（APTBOT_ 前缀）
│   - 配置迁移（migrateConfig）
├── paths.ts              # 路径助手
│   - getConfigPath() / getDataDir() / getSessionsDir()
│   - getWorkspacePath() / getLogsDir() / getSkillsDir()
└── defaults.ts           # 默认配置
```

**核心 Schema**：

```typescript
import { z } from "zod";

// Provider 配置
const ProviderConfigSchema = z.object({
  apiKey: z.string().optional(),        // 支持 ${VAR} 语法
  baseUrl: z.string().url().optional(),
  defaultModel: z.string().optional(),
});

// Agent 配置
const AgentConfigSchema = z.object({
  defaultProvider: z.string().default("openai"),
  defaultModel: z.string().default("gpt-4o"),
  maxTokens: z.number().int().positive().default(8192),
  temperature: z.number().min(0).max(2).default(0.7),
  contextWindow: z.number().int().positive().default(128000),
  maxToolIterations: z.number().int().positive().default(50),
  workspace: z.string().default("~/.aptbot/workspace"),
  systemPrompt: z.string().optional(),
});

// 压缩配置
const CompactionConfigSchema = z.object({
  enabled: z.boolean().default(true),
  reserveTokens: z.number().int().positive().default(16384),
  keepRecentTokens: z.number().int().positive().default(20000),
});

// 主 Config
const ConfigSchema = z.object({
  version: z.number().int().default(1),  // 配置版本号，用于迁移
  agent: AgentConfigSchema.default({}),
  providers: z.record(z.string(), ProviderConfigSchema).default({}),
  compaction: CompactionConfigSchema.default({}),
  sessionDir: z.string().optional(),     // 默认 ~/.aptbot/sessions/
  skillsDir: z.string().optional(),      // 默认 ~/.aptbot/skills/
  logLevel: z.enum(["debug", "info", "warn", "error"]).default("info"),
});

type Config = z.infer<typeof ConfigSchema>;
```

**配置文件示例**（`~/.aptbot/config.json`）：

```json
{
  "version": 1,
  "agent": {
    "defaultProvider": "openai",
    "defaultModel": "gpt-4o",
    "maxTokens": 8192,
    "temperature": 0.7,
    "workspace": "~/.aptbot/workspace"
  },
  "providers": {
    "openai": {
      "apiKey": "${OPENAI_API_KEY}",
      "defaultModel": "gpt-4o"
    },
    "anthropic": {
      "apiKey": "${ANTHROPIC_API_KEY}",
      "baseUrl": "https://api.anthropic.com"
    },
    "deepseek": {
      "apiKey": "${DEEPSEEK_API_KEY}",
      "baseUrl": "https://api.deepseek.com"
    }
  },
  "compaction": {
    "enabled": true,
    "reserveTokens": 16384,
    "keepRecentTokens": 20000
  },
  "logLevel": "info"
}
```

**加载流程**：

```
loadConfig(path?) →
  1. 读取 JSON 文件（默认 ~/.aptbot/config.json）
  2. migrateConfig(data) — 配置迁移
  3. resolveEnvVars(data) — 解析 ${VAR} 语法
  4. applyEnvOverrides(data) — 应用 APTBOT_ 前缀的环境变量覆盖
  5. ConfigSchema.parse(data) — Zod 校验 + 默认值填充
  6. 返回 Config
```

**路径体系**：

```
~/.aptbot/
├── config.json           # 配置文件
├── sessions/             # 会话存储（JSONL）
│   ├── {session-id}.jsonl
│   └── ...
├── workspace/            # 工作目录（agent 操作的默认目录）
├── skills/               # 用户 skills
│   └── {skill-name}/
│       └── SKILL.md
└── logs/                 # 日志
    └── aptbot.log
```

**后续待办**：
- [ ] 两层设置（global + project）：`~/.aptbot/config.json` + `{cwd}/.aptbot/config.json`
- [ ] 文件锁：多进程安全读写配置
- [ ] project trust：未信任项目不加载 project config
- [ ] channel 配置：多平台接入配置
- [ ] 配置热重载：文件变更时自动重新加载
- [ ] 配置验证命令：`aptbot config validate` 检查配置有效性

## 10. Channel 抽象

> 基于实际源码：`nanobot/nanobot/channels/`（base.py / manager.py / registry.py / websocket.py / telegram.py 等 20+ 实现）、`nanobot/nanobot/bus/`（queue.py / events.py / progress.py / runtime_events.py）、`pi/packages/coding-agent/src/modes/`（interactive / print-mode / rpc）、`pi/packages/coding-agent/src/core/event-bus.ts`、`pi/packages/coding-agent/src/core/agent-session.ts`。

### 10.1 nanobot 的 Channel 架构

**三层结构**：

```
Channel 层      平台接入（20+ 内置：telegram/discord/slack/whatsapp/wecom/feishu/
                dingtalk/qq/telegram/signal/matrix/msteams/email/websocket/...）
  BaseChannel 抽象: start/stop/send/send_delta/send_reasoning_delta/send_file_edit_events
  每个实现绑定一个 IM SDK，处理平台特有的消息格式、长度限制、富 UI 渲染

MessageBus 层   双向异步队列，解耦 channel 与 agent
  inbound: asyncio.Queue[InboundMessage]   channel → agent
  outbound: asyncio.Queue[OutboundMessage]  agent → channel
  无类型路由，仅 First-In-First-Out

ChannelManager  协调器
  - _init_channels(): 按 config.channels.{name}.enabled 过滤，registry 自动发现
  - start_all() / stop_all(): 并发启停
  - _dispatch_outbound(): 单消费者循环，按 msg.channel 路由到对应 channel
  - _send_with_retry(): 指数退避重试（1s/2s/4s）
  - _coalesce_stream_deltas(): 合并连续 _stream_delta 减少 API 调用
  - _should_suppress_outbound(): 重复内容去重（origin_message_id 指纹）
```

**关键设计**：

1. **标准化消息载体**：
   ```python
   InboundMessage:  channel / sender_id / chat_id / content / media / metadata / session_key_override
   OutboundMessage: channel / chat_id / content / reply_to / media / metadata / buttons
   ```
   `metadata` 是万能扩展槽，用 `_` 前缀约定内部标记：`_stream_delta` / `_stream_end` / `_stream_id` / `_reasoning_delta` / `_reasoning_end` / `_progress` / `_tool_hint` / `_file_edit_events` / `_agent_ui` / `_retry_wait` / `_wants_stream`。

2. **能力声明（类属性）**：
   ```python
   class BaseChannel(ABC):
       send_progress: bool = True      # 是否发送工具进度
       send_tool_hints: bool = False   # 是否发送工具提示
       show_reasoning: bool = True     # 是否渲染 reasoning
       @property
       def supports_streaming(self) -> bool:  # config.streaming AND 子类覆写了 send_delta
           ...
   ```

3. **流式协议（delta + end 配对）**：
   - `send_delta(chat_id, delta, metadata)`：流式文本块，stateful 实现须按 `_stream_id` 而非 `chat_id` 缓冲
   - `send_reasoning_delta` / `send_reasoning_end`：reasoning 独立通道，低强调渲染（Slack context block / Telegram blockquote / Discord subtext）
   - `send_file_edit_events`：结构化文件编辑事件，富 UI surface 专用
   - 一次性 reasoning（`_reasoning`）由基类翻译为 delta+end 对，保持单一渲染路径

4. **权限与配对**：
   - `is_allowed(sender_id)`：`"*"` 通配 > allowFrom 白名单 > pairing store 已批准 > 拒绝
   - 未批准用户在 DM 中收到配对码，`generate_code()` → `is_approved()` 校验

5. **自动发现（registry.py）**：
   - `pkgutil.iter_modules` 零导入扫描所有内置 channel 模块名
   - 仅导入 `enabled=True` 的模块（避免加载未使用的 IM SDK）
   - `entry_points(group="nanobot.channels")` 支持外部插件，内置优先级高于插件

6. **WebUI 走 websocket channel**：
   - 每个 WebSocket 连接对应一个独立 session（chat_id 唯一）
   - 支持 token 鉴权（静态 token + 短期 token 签发端点）
   - `OUTBOUND_META_AGENT_UI`：channel 无关的结构化 UI payload，富客户端可渲染，其他 channel 忽略

7. **双 bus 分离**：
   - `MessageBus`（queue.py）：用户消息投递，跨 channel 多路复用
   - `RuntimeEventBus`（runtime_events.py）：进程内状态通知（SessionTurnStarted / TurnRunStatusChanged / TurnCompleted / GoalStateChanged / RuntimeModelChanged），WebUI 订阅渲染，非消息投递

8. **入站 → agent 桥接**（loop.py）：
   ```python
   # channel 收到消息
   await self._handle_message(sender_id, chat_id, content, ...)
     → bus.publish_inbound(InboundMessage(...))
   # agent loop 消费
   msg = await bus.consume_inbound()
   progress_cb = build_bus_progress_callback(bus, msg)  # 进度回写 bus
   await agent_runner.run(spec, hook=progress_cb, messages=...)
   ```

### 10.2 pi-agent 的接入架构（Modes，无 Channel 概念）

**三种 Mode**：

```
InteractiveMode   TUI（终端交互式），主用例
  - Ink/React 渲染，订阅 AgentSessionEvent 实时更新 UI
  - 直接调用 agentSession.run(prompt) / pushSteering / abort

PrintMode         一次性（stdin prompt → stdout 响应），无交互
  - 用于脚本化、CI、管道

RpcMode           JSONL over stdin/stdout，供外部应用嵌入
  - 协议: stdin 收 RpcCommand（prompt/steer/abort/set_model/compact/fork/...）
         stdout 发 RpcResponse + AgentSessionEvent 流（JSONL）
  - 这是 pi-agent 的 "channel" 等价物，但仅单连接、本地进程
```

**关键设计**：

1. **进程内 EventBus**（event-bus.ts）：
   ```typescript
   interface EventBus {
     emit(channel: string, data: unknown): void;
     on(channel: string, handler: (data: unknown) => void): () => void;
   }
   ```
   基于 Node.js EventEmitter，字符串 channel 路由，无消息队列、无跨进程能力。

2. **AgentSession 事件流**：
   ```typescript
   type AgentSessionEvent =
     | AgentEvent                                    // agent_start/turn_start/message_*/tool_*/agent_end
     | { type: "queue_update"; steering; followUp }
     | { type: "compaction_start" | "compaction_end"; ... }
     | { type: "session_info_changed" }
     | { type: "thinking_level_changed" }
     | { type: "auto_retry_start" | "auto_retry_end" };
   ```
   细粒度、类型安全，Mode 直接订阅 `(event) => void`，无中间载体转换。

3. **RpcMode 协议**（rpc-types.ts）：
   ```typescript
   type RpcCommand =
     | { type: "prompt" | "steer" | "follow_up"; message; images? }
     | { type: "abort" | "new_session" | "get_state" | "get_messages" }
     | { type: "set_model" | "cycle_model" | "set_thinking_level" | ... }
     | { type: "compact" | "fork" | "switch_session" | "export_html" | ... };
   ```
   命令/响应带 `id` 关联，事件流式推送。Extension UI 请求/响应支持异步对话框。

4. **无消息总线**：Mode 直接持有 `AgentSession`，直接调用方法、直接订阅事件。无 inbound/outbound 队列、无多路复用、无重试/合并/去重。

5. **无 IM 接入**：pi-agent 定位是本地编码助手，不涉及 IM 平台。

### 10.3 核心差异对比

| 维度 | nanobot | pi-agent |
|---|---|---|
| **抽象层级** | Channel（平台无关接入）+ MessageBus（解耦） | Mode（运行模式）+ EventBus（进程内） |
| **多平台** | 20+ 内置 channel，自动发现 + 插件 | 仅 Interactive/Print/RPC，无 IM |
| **消息载体** | InboundMessage/OutboundMessage（标准化） | 直接传 AgentSessionEvent，无中间载体 |
| **流式** | channel 自实现 send_delta/send_reasoning_delta | 事件流直达 mode，mode 自行渲染 |
| **解耦** | queue 解耦，channel 与 agent 互不感知 | 直接耦合，mode 持有 session |
| **多路复用** | 多 channel 共享 bus，按 msg.channel 路由 | 单订阅，无扇出 |
| **重试/合并/去重** | ChannelManager 内置 | 无 |
| **权限** | allow_from + pairing | 无（本地 CLI） |
| **WebUI** | websocket channel（同进程） | RPC mode（外部进程消费 stdin/stdout） |
| **跨进程** | bus 可扩展为跨进程（当前同进程） | RPC mode 跨进程（stdin/stdout） |
| **事件细粒度** | metadata 标记 hack（`_stream_delta` 等） | 原生类型安全事件 |
| **能力声明** | send_progress/send_tool_hints/show_reasoning/supports_streaming | 无（mode 自行决定渲染） |

**核心张力**：nanobot 用标准化消息载体 + metadata 标记换来了多平台接入与解耦，但丢失了事件类型安全（`_stream_delta` 是字符串约定）。pi-agent 保留原生事件类型安全，但无多平台/多路复用能力。

### 10.4 aptbot MVP Channel 需求

- **必须**：CLI 接入（TUI）+ WebUI 接入（WebSocket）
- **后续**：IM 接入（个人助手定位，IM 有价值：Telegram/飞书/钉书/微信等）
- **已定约束**：Web Components + WebSocket；依赖事件流；AgentLoop 输出 `EventStream<AgentEvent, AgentMessage[]>`；细粒度事件（token 级 delta + 工具进度）
- **多会话**：WebUI 每连接一 session；CLI 单 session；IM 每 chat_id 一 session

### 10.5 aptbot Channel 设计建议（待讨论）

**核心抉择：Channel 消费什么？**

ABC 是三个最朴素的端点，DFE 是中间地带，完整设计空间如下：

| 方案 | 出站 | 入站 | 类型安全 | 多路复用 | 解耦 | IM 友好 | 备注 |
|---|---|---|---|---|---|---|---|
| **A** nanobot 风格 | AgentEvent → OutboundMessage → bus → channel.send | InboundMessage → bus | 弱（metadata 字符串标记） | 强 | 高 | 高 | 纯 bus 标准化载体 |
| **B** pi-agent 风格 | channel 直接订阅 AgentEventStream | channel 直调 agentSession.run() | 强 | 弱（手动扇出） | 低 | 低 | 纯直订阅 |
| **C** 混合 | channel 直订阅 AgentEventStream | InboundMessage → bus | 出站强、入站标准化 | 出站需扇出器 | 中 | 入站友好、出站每平台自理 | A+B 各取一半 |
| **D** 双轨出站 | 简单事件走 bus + 流式走直订阅 | InboundMessage → bus | 出站流式强、简单事件弱 | 强（简单）+ 弱（流式） | 中 | 中 | 复杂度高，channel 实现两套接口 |
| **E** 类型化 bus | AgentEvent（带路由 envelope）→ bus → channel.consume | InboundMessage → bus | 强（union type 替代 metadata） | 强 | 高 | 高 | nanobot 现代化版：消除字符串标记 hack |
| **F** 纯直订阅 + SessionRouter | channel 直订阅 AgentEventStream | SessionRouter 路由 channel → AgentSession.run() | 强 | 由 Router 做 fanout | 低 | 低 | 极简，无队列；IM webhook 入站需 channel 自处理 |
| **G** 队列 + 事件总线双 bus | 事件总线 pub/sub（类型化 AgentEvent） | 异步队列（缓冲 + 路由） | 强 | 强 | 高 | 高 | 两套基础设施，复杂度最高 |

**方案详细说明**：

- **A**：nanobot 原版。`OutboundMessage` + `_stream_delta` 等 metadata 标记。优点是成熟稳定、IM 友好；缺点是类型安全弱（`metadata: Record<string, unknown>` 是黑箱）。
- **B**：pi-agent 原版。无 bus、无 IM。MVP 可用但堵死 IM 路径。
- **C**：入站 bus + 出站直订阅。出站保留类型安全，但失去 bus 的重试/合并/去重；多 channel 共享 session 需自己写 fanout。
- **D**：双轨出站。把 `turn_end`/`message_end` 等离散事件走 bus 享受重试去重，把 `message_delta`/`reasoning_delta` 走直订阅保类型安全。问题是 channel 要实现两套接口，复杂度上升。
- **E**：类型化 bus。给 bus 投递的不是 `OutboundMessage` 而是 `AgentEvent`（带 `sessionKey`/`chatId` envelope 字段），用 union type 替代 metadata 字符串标记。既保留 bus 的重试/合并/去重/多路复用，又恢复类型安全。本质是 nanobot 架构的 TypeScript 现代化重写。
- **F**：纯直订阅 + SessionRouter。砍掉 bus，Router 负责 `sessionKey → AgentSession` 映射 + 多 channel fanout。极简但失去入站缓冲；IM webhook 入站冲击时无队列削峰。
- **G**：双 bus。入站队列（缓冲削峰）+ 出站事件总线（类型化 pub/sub）。能力最全但两套基础设施。

**关键判断维度**：

1. **是否需要入站缓冲**：IM webhook 高峰期需要队列削峰 → 保留入站 bus（A/C/D/E/G）
2. **是否需要出站重试/合并/去重**：IM 平台 API 限流、网络抖动常见 → 需要（A/D/E/G）
3. **类型安全是否必须**：TypeScript 项目应优先 → 排除 A 的 metadata hack（B/C/D/E/F/G）
4. **IM 路径是否预留**：个人助手定位，IM 有价值 → 排除 B/F 的纯直订阅
5. **复杂度预算**：MVP 阶段越简单越好 → 排除 D/G 的双轨/双 bus

**综合筛选**：在「类型安全 + IM 预留 + 入站缓冲 + 出站重试 + 复杂度可控」五个约束下，**E（类型化 bus）** 是最均衡的选择——它本质上就是 nanobot 成熟架构的 TypeScript 重写，用 union type 替代 metadata hack，保留所有 bus 能力。C 是 E 的简化版（砍掉出站 bus 能力换简单），适合 MVP 但 IM 阶段大概率要演化为 E。

**建议方案 E（类型化 bus）**：

1. **入站走 MessageBus**：Channel → InboundMessage → bus → AgentSession。理由：IM 平台入站差异大（webhook / 长轮询 / WebSocket），标准化载体 + bus 解耦是必要的；CLI/WebUI 入站也走同一通路，统一。bus 提供入站缓冲，IM webhook 高峰期队列削峰。
2. **出站走类型化 bus**：AgentSession 把 `AgentEvent`（带 `sessionKey`/`chatId` envelope）投递到出站 bus，ChannelManager 单消费者循环按 sessionKey 路由到绑定 channel，channel 通过 `consume(event: AgentEvent)` 接收。理由：用 union type 替代 nanobot 的 metadata 字符串标记，既恢复类型安全，又保留 bus 的重试（指数退避）、合并（连续 delta coalesce）、去重（origin_message_id 指纹）、多路复用能力——这些对 IM 平台 API 限流/网络抖动场景是刚需。
3. **能力声明**：channel 声明 `capabilities`，ChannelManager 据 capability 决定是否投递 reasoning / 流式 delta / 富 UI payload 事件。能力不足时 ChannelManager 在投递前过滤（如不支持 streaming 的 IM 不投递 `message_delta`，channel 端只在 `message_end` 时一次性发送完整内容）。

### 10.6 aptbot Channel 最终设计（已定）

**已定决策**：
- 方案 **E（类型化 bus）**：nanobot 架构的 TypeScript 现代化重写，用 `AgentEventEnvelope`（带路由字段的 union type）替代 `OutboundMessage + metadata: Record<string, unknown>` hack
- MVP 范围：**CLI + WebSocket**，IM 接入放 L2/L3
- **支持多 channel 共享 session**：`bindSession(sessionKey, channel)` 多对一绑定，WebUI + CLI 可同时连同一 session
- **MVP 无权限模型**：本地 CLI/WebUI 不做 allow_from；IM 阶段再引入 pairing
- **能力声明**：6 个字段（4 boolean + editMessage + markdown），覆盖事件投递过滤与内容格式化；buttons/mediaInput/mediaOutput 等后续按需扩展

```
src/channel/
├── types.ts          # Channel / InboundMessage / AgentEventEnvelope / ChannelCapability
├── bus.ts            # MessageBus（inbound + outbound 双向队列，类型化 AgentEvent 投递）
├── manager.ts        # ChannelManager（注册/启停/路由/重试/合并/去重/能力过滤）
├── base.ts           # BaseChannel 抽象基类
└── channels/
    ├── cli.ts        # CliChannel（TUI）
    └── websocket.ts  # WebSocketChannel（WebUI，JSON 协议）
```

**核心接口**：

```typescript
// 入站消息（标准化载体）
interface InboundMessage {
  readonly channel: string;          // "cli" | "websocket" | "telegram" | ...
  readonly senderId: string;
  readonly chatId: string;
  readonly content: string;
  readonly media?: MediaContent[];
  readonly metadata: Record<string, unknown>;
  readonly sessionKey?: string;      // 默认 `${channel}:${chatId}`
}

// 出站事件信封（给 AgentEvent 加路由字段，替代 OutboundMessage + metadata hack）
interface AgentEventEnvelope {
  readonly sessionKey: string;
  readonly chatId: string;
  readonly channel: string;          // 目标 channel 名
  readonly event: AgentSessionEvent; // 原生 union type，类型安全
}

// Channel 能力声明
interface ChannelCapability {
  streaming: boolean;        // 支持 sendDelta 流式（影响 message_delta 投递）
  reasoning: boolean;        // 支持 reasoning 渲染（影响 reasoning_delta 投递）
  richUi: boolean;           // 支持结构化 UI payload
  fileEditEvents: boolean;   // 支持文件编辑事件
  editMessage: boolean;      // 支持编辑已发送消息（流式 in-place edit vs buffer-and-flush）
  markdown: boolean | "limited";  // markdown 渲染能力（全支持/部分支持/纯文本）
}

// Channel 抽象
interface Channel {
  readonly name: string;
  readonly capabilities: ChannelCapability;
  readonly messageLengthLimit?: number;  // 消息长度上限（Telegram 4096, Discord 2000, CLI 无限）
  start(bus: MessageBus): Promise<void>;
  stop(): Promise<void>;
  // 入站：channel 内部调 bus.publishInbound(msg)
  // 出站：channel 实现 consume 接收类型化 AgentEvent（ChannelManager 已按 capability 过滤）
  consume(envelope: AgentEventEnvelope): void | Promise<void>;
}

// MessageBus（双向队列，类型化投递）
interface MessageBus {
  publishInbound(msg: InboundMessage): Promise<void>;
  consumeInbound(): Promise<InboundMessage>;
  publishOutbound(envelope: AgentEventEnvelope): Promise<void>;
  consumeOutbound(): Promise<AgentEventEnvelope>;
}

// ChannelManager
interface ChannelManager {
  register(channel: Channel): void;
  startAll(): Promise<void>;
  stopAll(): Promise<void>;
  // sessionKey → 绑定的 channel 列表（支持多 channel 共享 session）
  bindSession(sessionKey: string, channel: Channel): void;
  unbindSession(sessionKey: string, channel: Channel): void;
  // 出站消费循环：从 bus 取 envelope → 按 capability 过滤 → 路由到绑定 channel → 重试/合并/去重
  runDispatchLoop(): Promise<void>;
}
```

**数据流**：

```
入站:
  Channel.start() → 监听平台事件
    → bus.publishInbound(InboundMessage{ channel, senderId, chatId, content, ... })
  AgentSession 消费:
    msg = await bus.consumeInbound()
    await agentSession.run(msg.content, { sessionKey: msg.sessionKey })

出站:
  AgentSession 产生事件:
    → bus.publishOutbound(AgentEventEnvelope{ sessionKey, chatId, channel, event })
  ChannelManager.runDispatchLoop():
    envelope = await bus.consumeOutbound()
    channels = boundChannels[envelope.sessionKey]
    for channel of channels:
      if matchesCapability(channel.capabilities, envelope.event):
        await sendWithRetry(channel, envelope)  // 指数退避 + coalesce + 去重
```

**ChannelManager 出站能力过滤规则**：

| 事件类型 | 过滤条件 | 不匹配时的 fallback |
|---|---|---|
| `message_delta` | `streaming === true` | 不投递，channel 在 `message_end` 时一次性收完整内容 |
| `reasoning_delta` / `reasoning_end` | `reasoning === true` | 不投递 |
| `tool_*`（带 richUi payload） | `richUi === true` | 投递简化版（纯文本 tool name + status） |
| `file_edit_events` | `fileEditEvents === true` | 不投递 |
| 其他（`turn_start`/`turn_end`/`message_start`/`message_end`/`agent_end` 等） | 始终投递 | — |

**Channel 实现的渲染降级**：
- `editMessage === false` + `streaming === true`：channel 自行 buffer delta，在 `message_end` 时一次性发送（或按段落发多条新消息）
- `markdown === "limited"`：channel 自行转换 markdown 子集（如 Telegram MarkdownV2 转义）
- `markdown === false`：channel 自行 strip markdown 标记，发纯文本

**后续待办**：
- [ ] IM channel 实现（Telegram / 飞书 / 钉钉 / 微信等）：L2/L3 阶段
- [ ] 权限模型：`allow_from` 白名单 + pairing 配对码（IM 阶段引入）
- [ ] Channel 自动发现：内置 channel 扫描 + 外部插件注册（IM 阶段引入）
- [ ] 能力扩展：`buttons` / `mediaInput` / `mediaOutput` / `threading` / `reactions`
- [ ] RuntimeEventBus：进程内状态通知（SessionTurnStarted / TurnRunStatusChanged / TurnCompleted / ModelChanged），WebUI 订阅渲染（参考 nanobot `bus/runtime_events.py`）
- [ ] 出站 bus 高级能力：`_coalesce_stream_deltas`（连续 delta 合并）、`_should_suppress_outbound`（origin_message_id 指纹去重）

## 11. CLI / WebUI 接入层

> 基于实际源码：`pi/packages/coding-agent/src/modes/interactive/interactive-mode.ts`（InteractiveMode 主类，1600+ 行）、`pi/packages/coding-agent/src/modes/interactive/components/*.tsx`（40+ Ink 组件）、`pi/packages/coding-agent/src/core/slash-commands.ts`（18 内置斜杠命令）、`nanobot/nanobot/cli/commands.py`（Typer + prompt_toolkit + Rich StreamRenderer）、`nanobot/nanobot/cli/stream.py`（StreamRenderer + ThinkingSpinner）、`nanobot/nanobot/channels/websocket.py`（WebSocketChannel + HTTP 路由）、`nanobot/nanobot/webui/ws_http.py`（HTTP API 路由分发）、`nanobot/webui/index.html`（SPA 单文件入口）。

### 11.1 pi-agent 的 CLI（InteractiveMode + Ink + pi-tui）

**架构**：

```
InteractiveMode
  ├── 持有 AgentSession（直接订阅 AgentSessionEvent）
  ├── pi-tui TUI 引擎（Ink-like，自研 @earendil-works/pi-tui）
  │   ├── Container / Text / Spacer / Markdown / Loader / TruncatedText / hyperlink
  │   ├── EditorComponent（输入框，多行/IME/历史/vim 模式）
  │   ├── Overlay（模态层：selector / dialog）
  │   └── setKeybindings / KeybindingManager（全局快捷键）
  ├── 40+ Ink 组件（components/*.tsx）
  │   ├── AssistantMessageComponent（流式渲染 + thinking block 折叠）
  │   ├── BashExecutionComponent / ToolExecutionComponent（工具执行展示）
  │   ├── CompactionSummaryMessageComponent / BranchSummaryMessageComponent
  │   ├── ModelSelectorComponent / SessionSelectorComponent / ThinkingSelectorComponent
  │   ├── FooterComponent（状态栏：model / session / tokens / queue）
  │   ├── LoginDialogComponent / OAuthSelectorComponent（认证）
  │   └── DiffComponent（文件 diff 渲染）
  └── 斜杠命令系统（BUILTIN_SLASH_COMMANDS 18 个 + 扩展 + skill）
```

**关键设计**：

1. **事件流 → UI 状态机**：`subscribeToAgent()` 注册 `(event) => handleEvent(event)`，`handleEvent` 内 `switch (event.type)` 逐事件更新 UI 状态：
   ```typescript
   case "agent_start": pendingTools.clear(); startWorkingLoader();
   case "message_start": if assistant → new AssistantMessageComponent, addChild
   case "message_update": streamingComponent.updateContent(message)
   case "message_end": streamingComponent = null
   case "tool_call": pendingTools.set(id, ...); 
   case "tool_result": pendingTools.delete(id); addToolExecutionComponent
   case "queue_update": updatePendingMessagesDisplay (steering/follow-up 队列)
   case "compaction_start/end": showCompactionOverlay
   case "auto_retry_start/end": showRetryCountdown
   case "session_info_changed": updateTerminalTitle + footer.invalidate
   ```
   每个事件后调 `ui.requestRender()`，pi-tui 做批量 diff 渲染。

2. **斜杠命令**（18 内置）：
   ```
   settings / model / scoped-models / export / import / share / copy / name /
   session / changelog / hotkeys / fork / clone / tree / trust / login / logout / new
   ```
   - 输入 `/` 触发 Overlay 选择器（fuzzyFilter 模糊匹配）
   - 命令源：builtin + extension + prompt + skill（skill 自动注册为 `/skill:name`）
   - 命令可打开 Overlay UI（如 `/model` 打开 ModelSelectorComponent）

3. **steering/follow-up 注入**：editor 输入在 agent 运行时按 Enter 直接调 `session.pushSteering(msg)`，UI 显示 "pending" 标记，`queue_update` 事件刷新显示。

4. **认证 UI**：LoginDialog + OAuthSelector（PKCE flow，浏览器回调）。

5. **无 WebUI**：pi-agent 是纯 CLI 工具，WebUI 由第三方基于 RpcMode 实现。

### 11.2 nanobot 的 CLI（Typer + prompt_toolkit + Rich）

**架构**：

```
Typer CLI（commands.py）
  ├── @app.command() run  → 交互模式
  ├── @app.command() once → 一次性模式
  ├── @app.command() channels status → 渠道管理
  └── @app.command() gateway → 启动 WebUI 网关

交互模式核心循环（run_interactive）：
  ├── asyncio.run()
  ├── bus_task = agent_loop.run()        # 后台消费 inbound + 推进 agent
  ├── outbound_task = _consume_outbound() # 后台消费 outbound → StreamRenderer
  └── 主循环：prompt_toolkit await 输入 → bus.publish_inbound → await turn_done
```

**关键设计**：

1. **基于 MessageBus 而非直订阅**：CLI 也是一个 channel（`channel="cli"`），入站走 `bus.publish_inbound(InboundMessage{...})`，出站走 `bus.consume_outbound()` 消费 `OutboundMessage`，按 `metadata._stream_delta` / `_stream_end` / `_streamed` 等标记分发到 StreamRenderer 或直接 print。与 WebUI/IM 走同一通路。

2. **StreamRenderer**（Rich Live + transient）：
   - 流式期间用 `rich.live.Live(transient=True)` in-place 更新 markdown
   - `on_delta(chunk)` 累积，`on_end()` 停 Live（清屏）+ 打印最终 render
   - `stop_for_input()` 暂停 Live 避免与 prompt_toolkit 冲突
   - **ThinkingSpinner**：`console.status("... is thinking", spinner="dots")`，pause() 上下文管理器

3. **prompt_toolkit 输入**：
   - `PromptSession` + `FileHistory`（持久化历史）
   - `patch_stdout` 让流式输出与输入提示不冲突
   - 多行输入、ANSI/HTML formatted text、自动补全

4. **斜杠命令**：直接字符串解析（`_is_exit_command` / 自定义命令分发），无 Overlay UI，无 fuzzy 选择器。比 pi-agent 简单。

5. **信号处理**：SIGINT/SIGTERM/SIGHUP/SIGPIPE → 恢复终端 + 退出；Windows UTF-8 修复。

### 11.3 nanobot 的 WebUI（WebSocket channel + SPA + HTTP API）

**架构**：

```
WebSocketChannel（channels/websocket.py）
  ├── WebSocket 服务端（websockets 库）
  ├── chat_id → connections 多路订阅（_subs / _conn_chats）
  ├── 入站帧：文本/JSON → bus.publish_inbound
  ├── 出站帧：bus.consume_outbound → JSON frame → fan-out 到订阅连接
  └── HTTP 路由（ws_http.py WebUIHttpRouter）
      ├── /api/sessions/{id}/messages      会话消息
      ├── /api/sessions/{id}/webui-thread  会话线程
      ├── /api/sessions/{id}/file-preview  文件预览
      ├── /api/sessions/{id}/automations   自动化任务
      ├── /api/sessions/{id}/delete        删除会话
      ├── /api/sessions                    会话列表
      ├── /webui/bootstrap                 启动配置
      ├── /api/settings                    设置读写
      ├── /api/media                       媒体上传/下载
      ├── /api/skills                      skills 列表
      └── 静态文件服务（index.html SPA）
```

**关键设计**：

1. **WebUI 是一个 channel**：复用 Channel 抽象，`name="websocket"`。多个浏览器连接 → 多个 chat_id → 多个独立 session（也可共享）。
2. **多路订阅 fan-out**：`_subs[chat_id] = set(connections)`，一条出站消息可同时发给多个订阅同 chat_id 的连接（多端同步）。
3. **HTTP + WS 同端口**：`websockets.serve` 处理升级请求，非升级请求走 HTTP 路由。
4. **SPA 单文件入口**：`webui/index.html` 一个文件，内联 boot-splash，JS bundle 由构建系统生成（Vue/React 未知，未找到 src）。
5. **RuntimeEventBus 联动**：`goal_state` / `turn_run_wall_clock` 等运行时状态通过 WS 帧推送，刷新页面时 `_maybe_push_active_goal_state` 重放。
6. **会话 fork**：`/api/sessions/{id}/webui-thread` 支持会话树导航。

### 11.4 核心差异对比

| 维度 | pi-agent CLI | nanobot CLI | nanobot WebUI |
|---|---|---|---|
| **TUI 引擎** | 自研 pi-tui（Ink-like，React 模型） | prompt_toolkit + Rich | 无（SPA） |
| **渲染模型** | 组件树 diff 渲染（requestRender 批量） | Rich Live in-place 更新 | DOM（浏览器） |
| **事件消费** | 直订阅 AgentSessionEvent | bus.consume_outbound + metadata 标记 | WS 帧（JSON） |
| **斜杠命令** | 18 内置 + 扩展 + skill，Overlay 选择器 | 字符串解析，简单 | UI 按钮/菜单 |
| **流式** | streamingComponent.updateContent | StreamRenderer.on_delta/on_end | WS message_delta 帧 |
| **steering 注入** | editor Enter → pushSteering | 不支持（CLI 单向） | WS steer 帧 |
| **多端同步** | 无（单进程单终端） | 无（单 CLI） | 多连接订阅同 chat_id fan-out |
| **认证 UI** | LoginDialog + OAuth PKCE | 配置文件/API key | WebUI 登录页 |
| **会话管理 UI** | SessionSelector Overlay | `--session` 参数 | 侧边栏会话列表 |
| **fork/tree** | `/fork` `/tree` `/clone` 命令 | 不支持 | webui-thread API |

**核心张力**：
- pi-agent 用自研 TUI 引擎换来了丰富的组件化交互（Overlay/Selector/Diff/流式折叠），但绑定单一终端场景，无 WebUI 路径。
- nanobot CLI 用 prompt_toolkit+Rich 拿到 80% 体验但命令交互弱（无 Overlay）；WebUI 走 channel 复用获得多端同步能力。
- 事件消费方式：pi-agent 原生类型安全（直订阅 AgentSessionEvent），nanobot CLI 走 bus + metadata 标记（弱类型）——这与 §10 Channel 抽象的张力一致。

### 11.5 aptbot CLI/WebUI 设计建议（待讨论）

**前置约束**（已定）：
- WebUI = Web Components + WebSocket（§2 已定）
- 事件流细粒度（token 级 delta + 工具进度）
- Channel 抽象方案 E（类型化 bus，§10.6 已定）——CLI 和 WebUI 都是 channel，consume `AgentEventEnvelope`

**CLI 渲染引擎选择**：

| 方案 | 实现 | 优点 | 缺点 |
|---|---|---|---|
| **A. Ink（React for CLI）** | React 组件树 + Yoga 布局 | 生态成熟、组件化、类型安全、与 WebUI 心智一致 | 依赖 React 运行时、bundle 大、TS 项目天然适配 |
| **B. @clack/core + 自研** | 轻量 prompt 框架 + 自研渲染 | 极轻、无 React 依赖 | 组件需自写、流式/diff 渲染要自己实现 |
| **C. prompt_toolkit 风格（Node 等价 ink-better）** | 类 nanobot | 成熟 | Node 生态无 prompt_toolkit 等价物，Rich 等价物分散 |
| **D. RpcMode + 外部 TUI** | aptbot 只跑 RPC，TUI 由外部应用消费 | 解耦、复用 pi-agent 思路 | MVP 工作量大、需额外 TUI 应用 |

**WebUI 渲染选择**：

| 方案 | 实现 | 优点 | 缺点 |
|---|---|---|---|
| **W1. Web Components（已定）** | 原生 Custom Elements + Shadow DOM | 无框架、轻量、§2 已定 | 组件生态弱、需自写 |
| **W2. Lit + Web Components** | Lit 基类简化 WC 开发 | 仍是 WC、开发体验好 | 引入 Lit 依赖 |
| **W3. Vue SFC** | 单文件组件 | 生态好、响应式成熟 | 非 WC，与 §2 已定冲突 |

**斜杠命令系统**：

| 方案 | 实现 |
|---|---|
| **S1. pi-agent 风格** | builtin + extension + skill 自动注册，Overlay 模糊选择器，命令可触发 UI 组件 |
| **S2. nanobot 风格** | 字符串解析，简单分发 |
| **S3. 统一命令注册表** | CommandRegistry，命令 = { name, description, execute(ctx) }，CLI/WebUI 共用定义，渲染各自实现 |

**事件 → UI 状态机**：

| 方案 | 实现 |
|---|---|
| **U1. pi-agent 风格** | channel.consume 内 switch(event.type)，命令式更新组件树 |
| **U2. reducer 风格** | UI state = reducer(events)，channel 只负责 dispatch，渲染层订阅 state |
| **U3. 响应式 store** | 事件投递到 store（类 Pinia/Zustand），组件订阅 store slice 自动更新 |

**待决策点**：
1. **CLI 渲染引擎**：A（Ink）/ B（@clack+自研）/ C（prompt_toolkit 风格）/ D（RpcMode+外部 TUI）？我倾向 A（Ink），TS 项目天然适配、与 WebUI 心智一致、pi-agent 已验证可行。
2. **WebUI 框架**：W1（纯 WC）/ W2（Lit+WC）？我倾向 W2（Lit 大幅简化 WC 开发，仍是标准 WC，不违背 §2）。
3. **斜杠命令**：S1 / S2 / S3？我倾向 S3（统一注册表，CLI/WebUI 共用定义，渲染各自实现），既保留 pi-agent 的丰富性又支持多端。
4. **事件 → UI 状态机**：U1（命令式）/ U2（reducer）/ U3（响应式 store）？我倾向 U2（reducer，纯函数易测试，与事件流天然适配）。
5. **MVP CLI 范围**：是否需要 Overlay 选择器（model/session/setting）？还是 MVP 只做基础流式 + 斜杠命令，Overlay 放 L2？
6. **MVP WebUI 范围**：是否需要会话侧边栏 / fork 树 / 文件预览？还是 MVP 只做单会话聊天 + 流式 + 工具展示？

### 11.6 aptbot CLI/WebUI 最终设计（已定）

**已定决策**：
- **CLI 渲染引擎**：A（Ink + Yoga），React 组件树模型，与 WebUI 心智一致
- **WebUI 框架**：W2（Lit + Web Components），Lit 基类简化 WC 开发，仍是标准 WC，不违背 §2
- **斜杠命令**：S3（统一 CommandRegistry），CLI/WebUI 共用命令定义，渲染各自实现
- **事件 → UI 状态机**：U2（reducer），`UIState = reducer(UIState, AgentEvent)`，纯函数易测试
- **MVP CLI 范围**：基础流式 + 斜杠命令；Overlay 选择器（model/session/setting）/认证 UI/fork 树 等放 L2
- **MVP WebUI 范围**：单会话聊天 + 流式 + 工具展示；会话侧边栏 / fork 树 / 文件预览 / 媒体 等放 L2
- **CLI/WebUI 都是 channel**：复用 §10.6 Channel 抽象，consume `AgentEventEnvelope`

```
src/
├── cli/                          # CLI 接入层（Ink + channel）
│   ├── app.tsx                   # CliApp 根组件（Ink）
│   ├── channel.ts                # CliChannel 实现 Channel 接口
│   ├── reducer.ts                # cliReducer(state, AgentEvent) → UIState
│   ├── components/               # Ink 组件
│   │   ├── assistant-message.tsx     # 流式消息渲染
│   │   ├── user-message.tsx
│   │   ├── tool-execution.tsx        # 工具执行展示
│   │   ├── working-loader.tsx        # "thinking" spinner
│   │   ├── footer.tsx                # 状态栏（model / session / queue）
│   │   └── input-editor.tsx          # 输入框（多行/历史/steering 注入）
│   └── commands/                 # CLI 命令渲染（消费 CommandRegistry）
│       └── render-command.tsx        # 命令 → Overlay 或 inline 渲染
├── webui/                        # WebUI 接入层（Lit + channel）
│   ├── index.html                # SPA 入口
│   ├── app.ts                    # WebApp 根组件（Lit）
│   ├── channel.ts                # WebSocketChannel 实现 Channel 接口
│   ├── reducer.ts                # webReducer(state, AgentEvent) → UIState（可与 cli 共享核心 reducer）
│   ├── components/               # Lit Web Components
│   │   ├── assistant-message.ts      # <assistant-message> 流式渲染
│   │   ├── user-message.ts
│   │   ├── tool-execution.ts         # <tool-execution> 工具展示
│   │   ├── working-indicator.ts      # <working-indicator>
│   │   ├── footer-bar.ts             # <footer-bar>
│   │   └── input-box.ts              # <input-box> 输入（steering 注入）
│   └── commands/                 # WebUI 命令渲染（消费 CommandRegistry）
│       └── render-command.ts
├── shared/
│   ├── commands/                 # 统一 CommandRegistry
│   │   ├── registry.ts           # CommandRegistry 实现
│   │   ├── types.ts              # Command / CommandContext / CommandResult
│   │   └── builtin/              # 内置命令
│   │       ├── new.ts                # /new 新建会话
│   │       ├── clear.ts              # /clear 清屏
│   │       ├── help.ts               # /help 帮助
│   │       ├── model.ts              # /model（MVP 仅打印当前，L2 加 Overlay）
│   │       ├── session.ts            # /session（MVP 仅打印信息）
│   │       ├── continue.ts           # /continue <oldId> 显式继承 working memory（§7.7）
│   │       ├── skill.ts              # /skill create|list|edit（L2，§8.7）
│   │       └── exit.ts               # /exit 退出
│   ├── ui-state/                 # 共享 UI 状态机
│   │   ├── types.ts              # UIState / MessageViewItem / ToolViewItem
│   │   ├── core-reducer.ts       # 核心 reducer（CLI/WebUI 共用）
│   │   └── adapters/             # CLI/WebUI 各自的 state→view 适配
│   └── markdown/                 # 共享 markdown 渲染（CLI 用 marked-terminal，WebUI 用 marked）
└── ...
```

**核心接口**：

```typescript
// === Channel 实现（CLI/WebUI 都是 channel，§10.6 接口） ===

// CliChannel：本地直连，consume AgentEventEnvelope → dispatch 到 reducer
class CliChannel implements Channel {
  readonly name = "cli";
  readonly capabilities: ChannelCapability = {
    streaming: true,
    reasoning: true,
    richUi: false,        // MVP 终端不做富 UI
    fileEditEvents: false,
    editMessage: true,    // 终端 in-place edit（Ink）
    markdown: true,
  };
  // 入站：input-editor onSubmit → bus.publishInbound(InboundMessage{channel:"cli",...})
  // 出站：consume(envelope) → store.dispatch(envelope.event) → reducer → Ink re-render
}

// WebSocketChannel：远端浏览器，consume → JSON 帧 → WS send
class WebSocketChannel implements Channel {
  readonly name = "websocket";
  readonly capabilities: ChannelCapability = {
    streaming: true,
    reasoning: true,
    richUi: true,         // 浏览器支持富 UI
    fileEditEvents: true,
    editMessage: true,    // 浏览器 DOM in-place update
    markdown: true,
  };
  // 入站：WS onmessage → bus.publishInbound
  // 出站：consume(envelope) → JSON.stringify(envelope) → ws.send
}

// === 统一 CommandRegistry ===

interface Command {
  readonly name: string;                    // "new" | "model" | ...
  readonly description: string;
  readonly aliases?: string[];
  // execute 在 CLI/WebUI 共用，返回 CommandResult
  // 渲染由各自的 render-command 处理（CLI Overlay 或 WebUI modal）
  execute(ctx: CommandContext): Promise<CommandResult>;
}

interface CommandContext {
  readonly session: AgentSession;           // 调 session.new() / session.fork() 等
  readonly bus: MessageBus;                 // 投递消息
  readonly config: Config;
  readonly ui: CommandUiApi;                // 请求打开选择器/提示/确认
}

interface CommandUiApi {
  // 请求 UI 层打开选择器（CLI 用 Overlay，WebUI 用 modal），返回用户选择
  select<T>(options: SelectOption<T>[]): Promise<T | undefined>;
  prompt(message: string, defaultValue?: string): Promise<string | undefined>;
  confirm(message: string): Promise<boolean>;
}

interface CommandResult {
  readonly success: boolean;
  readonly message?: string;                // 反馈消息（渲染到 chat）
}

class CommandRegistry {
  register(cmd: Command): void;
  unregister(name: string): void;
  get(name: string): Command | undefined;
  list(): readonly Command[];
  // 输入 "/model gpt-4o" → 解析 → 找命令 → execute
  async execute(input: string, ctx: CommandContext): Promise<CommandResult | undefined>;
}

// === 共享 UI 状态机（reducer） ===

interface UIState {
  readonly messages: MessageViewItem[];     // 渲染用的消息视图
  readonly streamingMessage?: MessageViewItem; // 当前流式
  readonly pendingTools: Map<string, ToolViewItem>;
  readonly isWorking: boolean;
  readonly queueStatus?: { steering: number; followUp: number };
  readonly error?: { message: string; retryable: boolean };
  readonly lastCompaction?: { tokensBefore: number; summary: string };
}

// 核心 reducer（CLI/WebUI 共用）
function coreReducer(state: UIState, event: AgentSessionEvent): UIState {
  switch (event.type) {
    case "agent_start":
      return { ...state, isWorking: true, pendingTools: new Map(), error: undefined };
    case "message_start":
      if (event.message.role === "assistant") {
        return { ...state, streamingMessage: toViewItem(event.message) };
      }
      return { ...state, messages: [...state.messages, toViewItem(event.message)] };
    case "message_update":
      if (state.streamingMessage && event.message.role === "assistant") {
        return { ...state, streamingMessage: toViewItem(event.message) };
      }
      return state;
    case "message_end":
      if (state.streamingMessage) {
        return {
          ...state,
          messages: [...state.messages, state.streamingMessage],
          streamingMessage: undefined,
        };
      }
      return state;
    case "tool_call":
      return { ...state, pendingTools: new Map(state.pendingTools).set(event.toolCallId, toToolViewItem(event)) };
    case "tool_result": {
      const next = new Map(state.pendingTools);
      next.delete(event.toolCallId);
      return { ...state, pendingTools: next };
    }
    case "queue_update":
      return { ...state, queueStatus: { steering: event.steering.length, followUp: event.followUp.length } };
    case "agent_end":
      return { ...state, isWorking: false };
    case "compaction_start":
      return { ...state, isWorking: true };
    case "compaction_end":
      return { ...state, isWorking: false, lastCompaction: { tokensBefore: event.tokensBefore, summary: event.summary } };
    case "auto_retry_start":
      return { ...state, error: { message: event.message, retryable: true } };
    case "auto_retry_end":
      return { ...state, error: undefined };
    default:
      return state;
  }
}
```

**数据流**：

```
入站（用户输入）:
  CLI: Ink input-editor onSubmit
       → 若 "/" 开头: commandRegistry.execute(input, ctx) → CommandResult → 渲染反馈
       → 否则: bus.publishInbound(InboundMessage{channel:"cli", chatId, content})
  WebUI: <input-box> onSubmit
       → 同上分流（命令 vs 消息），消息走 bus.publishInbound

出站（agent 事件）:
  AgentSession 产生 AgentEvent
    → bus.publishOutbound(AgentEventEnvelope{sessionKey, chatId, channel, event})
  ChannelManager.runDispatchLoop:
    envelope = await bus.consumeOutbound()
    for channel of boundChannels[envelope.sessionKey]:
      if matchesCapability(channel.capabilities, envelope.event):
        await channel.consume(envelope)
  CliChannel.consume:
    store.dispatch(envelope.event)       # reducer 更新 UIState
    → Ink 重新渲染（reactive）
  WebSocketChannel.consume:
    ws.send(JSON.stringify(envelope))    # 浏览器端 reducer 更新 UIState
    → Lit 组件 reactive 更新
```

**MVP 命令清单（5 个内置）**：

| 命令 | 说明 | MVP 实现 |
|---|---|---|
| `/new` | 新建会话 | 调 session.new()，清空 UIState |
| `/clear` | 清屏 | 清空 UIState.messages |
| `/help` | 显示命令帮助 | 打印 CommandRegistry.list() |
| `/model` | 显示/切换模型 | MVP 仅打印当前 model；L2 加 Overlay 选择器 |
| `/exit` | 退出 | 仅 CLI，关闭 session + 进程退出 |

**MVP CLI 组件清单**：

| 组件 | 说明 |
|---|---|
| `AssistantMessage` | 流式渲染 assistant 消息（markdown via marked-terminal） |
| `UserMessage` | 渲染用户输入 |
| `ToolExecution` | 工具名 + 状态 + 结果摘要（折叠） |
| `WorkingLoader` | "aptbot is thinking..." spinner |
| `Footer` | 状态栏：当前 model / session id / queue 计数 |
| `InputEditor` | 多行输入 + 历史记录 + steering 注入（agent 运行时 Enter → pushSteering） |

**MVP WebUI 组件清单**：

| 组件 | 说明 |
|---|---|
| `<assistant-message>` | 流式渲染（markdown via marked + DOM in-place update） |
| `<user-message>` | 用户消息 |
| `<tool-execution>` | 工具执行卡片 |
| `<working-indicator>` | thinking 动画 |
| `<footer-bar>` | 状态栏 |
| `<input-box>` | 输入框 + steering |

**后续待办（L2+）**：

- [ ] CLI Overlay 选择器：model / session / settings / thinking level（参考 pi-agent ModelSelectorComponent）
- [ ] CLI 认证 UI：LoginDialog + OAuth PKCE flow
- [ ] CLI 会话管理：SessionSelector Overlay（列表 / 切换 / 搜索）
- [ ] CLI fork/tree：`/fork` `/tree` `/clone` 命令 + TreeSelector Overlay
- [ ] CLI diff 渲染：DiffComponent（文件编辑展示）
- [ ] CLI thinking block 折叠：AssistantMessage 内 thinking 折叠/展开
- [ ] WebUI 会话侧边栏：会话列表 / 搜索 / 切换 / 删除
- [ ] WebUI fork 树导航：会话分支可视化
- [ ] WebUI 文件预览：`/api/sessions/{id}/file-preview` 端点 + 预览组件
- [ ] WebUI 媒体上传/下载：图片输入输出
- [ ] WebUI 设置面板：model / provider / compaction 配置 UI
- [ ] WebUI 认证页：登录 / OAuth 回调
- [ ] 共享 markdown 渲染对齐：CLI（marked-terminal）与 WebUI（marked DOM）渲染一致
- [ ] 命令自动补全：输入 `/` 弹出 fuzzy 匹配列表（CLI Overlay / WebUI dropdown）
- [ ] 命令扩展机制：extension / prompt / skill 自动注册为命令（参考 pi-agent）
- [ ] RpcMode：JSONL over stdin/stdout，供外部应用嵌入（参考 pi-agent）
- [ ] PrintMode：一次性 stdin → stdout，CI/脚本场景
- [ ] HTTP API 路由：`/api/sessions/*` 等端点（WebUI L2 阶段随侧边栏引入）
- [ ] RuntimeEventBus 联动：goal_state / turn 状态推送（与 §10.6 RuntimeEventBus 待办合并）

## 12. L2 待办详细设计（已定）

> 基于 GenericAgent 对比结论（详见 [comparison-pi-nanobot-ga.md](comparison-pi-nanobot-ga.md)）确定的 5 项 L2 待办详细设计。所有 17 项子决策按推荐设置确定。

### 12.1 MixinProvider（多 provider 故障转移 + 运行时切换）

> 参考 GenericAgent 的 `MixinSession`（[llmcore.py:940-1003](file:///Users/evan/projects/aptbot/GenericAgent/llmcore.py)）。

**定位**：在 §5 Api-Provider 分离架构之上，提供"代理 Provider"，内部持有多个同协议 Provider，实现故障转移 + 弹回主 provider。

**已定决策**：
- **L2 首批**
- **弹回机制**：做，可配置 `springBackMs`（0=不弹回）
- **流式故障转移边界**：已 yield 后出错不切，直接 yield 错误块（已输出不能撤回，切了会乱）
- **配置格式**：显式 type 字段（`{type:"mixin", sessions:[...], ...}`，与 §5 Provider 声明风格一致）
- **切换通知**：故障切换时给 channel 发系统消息（用户应知当前 provider，影响质量/成本感知）
- **运行时手动切换**：`/model --sub <idx>` 切到指定子 provider，L2 实现（与 /session 动态属性同期）
- **同协议约束**：Mixin 内所有 provider 必须共享同一 Api 实现（如都 anthropic-messages 或都 openai-responses），配置校验时检查
- **广播属性**：systemPrompt/tools/temperature/maxTokens/reasoningEffort/stream 写入 Mixin 时自动广播到所有子 provider
- **弹回策略**：故障切到副 provider 后，`springBackMs`（默认 5 分钟）后尝试回主 provider

**核心接口**：

```typescript
// src/provider/mixin.ts

interface MixinConfig {
  type: "mixin";
  sessions: string[];       // 引用 providers 配置中的 id
  maxRetries: number;       // 默认 3
  baseDelay: number;        // 默认 1500ms
  springBackMs: number;     // 默认 300_000（5分钟），0=不弹回
}

class MixinProvider implements Provider {
  readonly id: string;
  private sessions: Provider[];        // 同 Api 协议
  private curIdx = 0;
  private switchedAt = 0;
  private broadcastKeys = new Set([
    'systemPrompt', 'tools', 'temperature', 'maxTokens', 'reasoningEffort', 'stream'
  ]);

  constructor(id: string, sessions: Provider[], cfg: MixinConfig) {
    // 同协议校验
    const apis = new Set(sessions.map(s => s.api));
    if (apis.size > 1) throw new Error("MixinProvider: sessions must share same Api");
    this.id = id;
    this.sessions = sessions;
  }

  get model() { return this.sessions[this.curIdx].model; }
  get name() { return this.sessions.map(s => s.name).join('|'); }

  private pick(): number {
    if (this.curIdx !== 0 && Date.now() - this.switchedAt > this.springBackMs) {
      this.curIdx = 0;  // 弹回主 provider
    }
    return this.curIdx;
  }

  stream(model: Model, context: Context, options?: StreamOptions): AssistantMessageEventStream {
    return this._streamWithFailover(model, context, options);
  }

  private async *_streamWithFailover(model, context, options): AsyncGenerator<AssistantMessageEvent> {
    const base = this.pick();
    const n = this.sessions.length;
    let lastChunk: AssistantMessageEvent | null = null;

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      const idx = (base + attempt) % n;
      console.log(`[MixinProvider] Using ${this.sessions[idx].name}`);

      const gen = this.sessions[idx].stream(model, context, options);
      let yielded = false;

      try {
        for await (const chunk of gen) {
          lastChunk = chunk;
          // 首块错误不 yield（安全切换）
          if (!yielded && isErrorChunk(chunk)) continue;
          yield chunk; yielded = true;
        }
        // 成功
        if (attempt > 0) {
          this.curIdx = idx;
          this.switchedAt = Date.now();
          // 发切换通知到 channel
          this.notifyChannel(`[已切换到 ${this.sessions[idx].name}]`);
        }
        return;
      } catch (e) {
        if (!yielded) continue;  // 未输出过，安全切下一个
        // 已 yield 过 → 不切，直接 yield 错误块
        yield { type: 'error', message: String(e) };
        return;
      }

      // 尾块错误判定
      if (isErrorChunk(lastChunk)) {
        const nxt = (base + attempt + 1) % n;
        if (nxt === base) await sleep(backoffDelay(attempt, n, this.baseDelay));
        continue;
      }
    }
    throw new Error("All sessions failed");
  }
}
```

**配置示例**（config.json）：

```json
{
  "providers": [
    { "id": "claude-primary", "api": "anthropic-messages", "apiKey": "..." },
    { "id": "glm-backup", "api": "openai-completions", "apiKey": "..." },
    {
      "id": "mixin-main",
      "type": "mixin",
      "sessions": ["claude-primary", "glm-backup"],
      "maxRetries": 3,
      "baseDelay": 1500,
      "springBackMs": 300000
    }
  ]
}
```

### 12.2 Config 热重载（mtime 检测 + 懒加载）

> 参考 GenericAgent 的 `reload_mykeys()`（[llmcore.py:25-34](file:///Users/evan/projects/aptbot/GenericAgent/llmcore.py)）。

**定位**：用 mtime 缓存实现懒加载热重载，零后台开销，每次 beforeTurn 检查配置是否变化。

**已定决策**：
- **L2 首批**
- **懒加载而非 fs.watch**：零后台开销，避免跨平台 watch 不可靠（macOS FSEvents/Linux inotify/Windows 行为不一，且笔记本休眠唤醒后可能失效）
- **整体重载**：配置文件通常小，整体重载成本低，不做增量 diff
- **mtime 纳秒精度**：用 `fs.stat().mtimeNs`（BigInt），比秒级精度更准
- **热重载触发点**：beforeTurn 检查 mtime；当前 turn 不受影响，nextTurn 前应用新配置
- **热重载范围白名单**：
  - ✅ providers 配置（增/删/改 key）：重建 providers，但当前 session 保留旧 provider 引用直至 turn 结束
  - ✅ skills 文件：全量重载
  - ✅ system prompt 片段：重载
  - ❌ session history：不可热重载
  - ❌ 当前 turn 的 provider 实例：等 turn 结束
- **校验失败降级**：保留旧配置 + channel 发错误通知（不崩溃）
- **强制刷新逃生口**：`invalidate()` 方法强制下次视为变更（UI 手动刷新用）

**核心接口**：

```typescript
// src/config/hot-reload.ts

interface ConfigCache<T> {
  mtimeNs: bigint | null;
  data: T | null;
}

export class ConfigLoader<T> {
  private cache: ConfigCache<T> = { mtimeNs: null, data: null };

  constructor(
    private path: string,
    private validate: (raw: unknown) => T  // Zod schema
  ) {}

  async load(force = false): Promise<{ data: T; changed: boolean }> {
    try {
      const stat = await fs.promises.stat(this.path);
      const mtimeNs = stat.mtimeNs;

      if (!force && this.cache.mtimeNs === mtimeNs && this.cache.data) {
        return { data: this.cache.data, changed: false };
      }

      const raw = await fs.promises.readFile(this.path, 'utf-8');
      const parsed = JSON.parse(raw);
      const data = this.validate(parsed);

      this.cache = { mtimeNs, data };
      return { data, changed: true };
    } catch (e) {
      // 校验失败 → 降级到旧配置
      if (this.cache.data) {
        return { data: this.cache.data, changed: false };
      }
      throw e;
    }
  }

  invalidate(): void { this.cache.mtimeNs = null; }
}

// AgentSession 集成
class AgentSession {
  async beforeTurn(): Promise<void> {
    const { changed, data } = await this.configLoader.load();
    if (changed) {
      // 重建 providers（当前 turn 不受影响）
      this.pendingProviders = await buildProviders(data);
      // skills 全量重载
      this.pendingSkills = await loadSkills(this.env, [skillsDir, builtinDir]);
      // 标记：当前 turn 结束后应用
      this.hasPendingConfig = true;
    }
  }

  async afterTurn(): Promise<void> {
    if (this.hasPendingConfig) {
      this.providers = this.pendingProviders;
      this.skills = this.pendingSkills;
      this.hasPendingConfig = false;
    }
  }
}
```

### 12.3 Hook 系统（零核心改动扩展点）

> 参考 GenericAgent 的 [plugins/hooks.py](file:///Users/evan/projects/aptbot/GenericAgent/plugins/hooks.py) + [project_mode.py](file:///Users/evan/projects/aptbot/GenericAgent/plugins/project_mode.py)。

**定位**：模块级注册表 + 装饰器 + 显式类型化 ctx，让插件在不改核心代码的情况下扩展 agent 行为。

**已定决策**：
- **L2 首批**
- **同步 hook**：简单、不污染 agentLoop 的 async/await 链；异步需求（远程日志）用 fire-and-forget
- **ctx 允许 mutate**：返回新对象则更新 ctx（链式）；但 `tool_before` 的 args 不应 mutate（影响工具执行）
- **插件目录**：两层加载（与 skills 一致），`~/.aptbot/plugins/`（用户级）+ `.aptbot/plugins/`（项目级）
- **插件能力边界**：L2 仅 hook；注册工具/命令放 L3（需更严格安全模型）
- **插件配置**：复用主 config.json 的 `plugins: {langfuse: {apiKey:"..."}}` 字段
- **hook 顺序**：显式 `priority` 字段（数字越小越先），无 priority 则按注册顺序
- **异常处理**：吞掉 hook 异常，stderr 打印，不影响主流程
- **无沙箱**：信任本地用户（与 GA 一致），L3 若支持远程插件再考虑沙箱

**8 个 hook 点**：

| Hook | 触发时机 | ctx 字段 | 典型用途 |
|---|---|---|---|
| `agent_before` | agent 循环开始前（一次） | messages, systemPrompt, session | project_mode 注入上下文 |
| `agent_after` | agent 循环结束后（一次） | messages, exitReason, session | tracing 结束 |
| `turn_before` | 每个 turn 开始 | turn, messages, session | 日志/监控 |
| `turn_after` | 每个 turn 结束 | turn, response, toolCalls, session | turn 级统计 |
| `llm_before` | 调 LLM 前 | turn, messages, provider | tracing 记录 input |
| `llm_after` | LLM 返回后 | turn, response, latencyMs, provider | tracing 记录 output |
| `tool_before` | 工具执行前 | toolName, args, session | 审计/权限校验 |
| `tool_after` | 工具执行后 | toolName, args, result, latencyMs, session | 结果日志/指标 |

**核心接口**：

```typescript
// src/plugins/hooks.ts

interface HookContexts {
  agent_before: { messages: AgentMessage[]; systemPrompt: string; session: AgentSession };
  agent_after:  { messages: AgentMessage[]; exitReason: ExitReason; session: AgentSession };
  turn_before:  { turn: number; messages: AgentMessage[]; session: AgentSession };
  turn_after:   { turn: number; response: LLMResponse; toolCalls: ToolCall[]; session: AgentSession };
  llm_before:   { turn: number; messages: AgentMessage[]; provider: LLMProvider };
  llm_after:    { turn: number; response: LLMResponse; latencyMs: number; provider: LLMProvider };
  tool_before:  { toolName: string; args: unknown; session: AgentSession };
  tool_after:   { toolName: string; args: unknown; result: AgentToolResult; latencyMs: number; session: AgentSession };
}

interface HookRegistration<K extends keyof HookContexts> {
  fn: (ctx: HookContexts[K]) => HookContexts[K] | void;
  priority: number;  // 默认 100，数字越小越先
}

class HookRegistry {
  private registry: { [K in keyof HookContexts]?: HookRegistration<K>[] } = {};

  on<K extends keyof HookContexts>(
    event: K,
    fn: (ctx: HookContexts[K]) => HookContexts[K] | void,
    priority = 100
  ): () => void {
    const reg: HookRegistration<K> = { fn, priority };
    (this.registry[event] ??= []).push(reg);
    this.registry[event]!.sort((a, b) => a.priority - b.priority);
    return () => this.off(event, fn);
  }

  off<K extends keyof HookContexts>(event: K, fn: Function): void {
    this.registry[event] = this.registry[event]?.filter(r => r.fn !== fn);
  }

  trigger<K extends keyof HookContexts>(event: K, ctx: HookContexts[K]): HookContexts[K] {
    for (const { fn } of this.registry[event] ?? []) {
      try {
        const r = fn(ctx);
        if (r) ctx = r;  // 返回值更新 ctx（链式）
      } catch (e) {
        console.error(`[hooks] ${event} callback error:`, e);
      }
    }
    return ctx;
  }

  async discoverAndLoad(pluginsDirs: string[]): Promise<void> {
    for (const dir of pluginsDirs) {
      if (!await pathExists(dir)) continue;
      const files = (await fs.promises.readdir(dir)).sort();
      for (const f of files) {
        if (f.startsWith('_') || !/\.[jt]s$/.test(f)) continue;
        try {
          await import(path.join(dir, f));  // side effect: 调 hooks.on(...)
        } catch (e) {
          console.error(`[hooks] plugin '${f}' load failed:`, e);
        }
      }
    }
  }
}

export const hooks = new HookRegistry();
```

**插件示例**（langfuse tracing）：

```typescript
// ~/.aptbot/plugins/langfuse-tracing.ts
import { hooks } from '../src/plugins/hooks';
import { config } from '../src/config';

const cfg = config.plugins?.langfuse;
if (cfg?.apiKey) {
  const langfuse = new Langfuse(cfg);
  let trace: LangfuseTrace | null = null;

  hooks.on('agent_before', (ctx) => {
    trace = langfuse.trace({ name: 'agent-run', sessionId: ctx.session.id });
  }, priority = 10);

  hooks.on('llm_after', (ctx) => {
    trace?.generation({ name: `turn-${ctx.turn}`, output: ctx.response, metadata: { latencyMs: ctx.latencyMs } });
  });

  hooks.on('agent_after', (ctx) => {
    trace?.update({ metadata: { exitReason: ctx.exitReason } });
    langfuse.flushAsync();  // fire-and-forget
  });
}
```

### 12.4 /session 动态属性

> 参考 GenericAgent 的 `/session.xxx=yyy`（[agentmain.py:122-133](file:///Users/evan/projects/aptbot/GenericAgent/agentmain.py)）。

**定位**：运行时白名单属性调参，内存态（重启还原），不需改配置文件重启。

**已定决策**：
- **L2 次批**
- **白名单 5 项**：temperature / maxTokens / reasoningEffort / thinkingType / thinkingBudgetTokens（不能设 history/messages/provider，影响 session 完整性）
- **保留文件值逃生口**：若 rawValue 是相对路径且文件存在，读文件内容作为值（长 prompt 场景实用）
- **JSON 自动解析**：数字/布尔/null 自动转类型，字符串保持原样
- **内存态**：不持久化（临时调参用），持久化用配置文件
- **`/session` 命令扩展**：查看当前所有动态属性（§11.6 /session 命令的 L2 扩展）
- **`/session.reset`**：清除所有动态属性（避免调参后忘记还原）
- **MixinProvider 广播**：若 provider 是 MixinProvider，设置属性自动广播到所有子 provider

**核心接口**：

```typescript
// src/commands/session-attr.ts

const SESSION_ATTRS = {
  temperature:          { type: 'number', validate: (v: number) => v >= 0 && v <= 2 },
  maxTokens:            { type: 'number', validate: (v: number) => v > 0 && v <= 200000 },
  reasoningEffort:      { type: 'string', validate: (v: string) => ['none','minimal','low','medium','high','xhigh'].includes(v) },
  thinkingType:         { type: 'string', validate: (v: string) => ['adaptive','enabled','disabled'].includes(v) },
  thinkingBudgetTokens: { type: 'number', validate: (v: number) => v > 0 },
} as const;

async function handleSessionAttr(
  session: AgentSession,
  key: string,
  rawValue: string,
  workspaceRoot: string
): Promise<string> {
  const spec = SESSION_ATTRS[key as keyof typeof SESSION_ATTRS];
  if (!spec) return `❌ 不支持的属性: ${key}（可用: ${Object.keys(SESSION_ATTRS).join(', ')}）`;

  let value: unknown = rawValue;

  // 文件值逃生口
  const filePath = path.join(workspaceRoot, rawValue);
  if (await fileExists(filePath)) {
    value = await fs.promises.readFile(filePath, 'utf-8');
  } else {
    try { value = JSON.parse(rawValue); } catch { /* 字符串保持原样 */ }
  }

  // 类型校验
  if (typeof value !== spec.type) {
    return `❌ 类型错误: ${key} 期望 ${spec.type}，得到 ${typeof value}`;
  }
  if (!spec.validate(value as never)) {
    return `❌ 校验失败: ${key}=${value} 不合法`;
  }

  // 设置（MixinProvider 自动广播）
  session.setProviderAttr(key, value);
  return `✅ session.${key} = ${JSON.stringify(value)}`;
}
```

### 12.5 L1 索引 + 按需读取 Skill

> 参考 GenericAgent project_mode 的两层设计（[project_mode.py:_build_injection](file:///Users/evan/projects/aptbot/GenericAgent/plugins/project_mode.py)）。

**定位**：§8.5 已有"摘要注入 + read_file 按需读取"雏形，L2 补充 L1 索引元信息（行数/字节/tags），给 LLM 读取决策提供依据。

**已定决策**：
- **L2 次批**
- **tags 来源**：手写 frontmatter（MVP），自动生成放 L3
- **lastUsed 维护**：read_file 工具中特判 path 是否为 skill 文件，是则更新 lastUsed
- **skill 排序**：按 lastUsed 降序（最近用的在前），LLM 注意力对靠前的更敏感
- **token 预算上限**：L1 索引总 token > 4K 时只注入 lastUsed 前 N 个 + 全部名字列表
- **元信息缓存**：加载时计算 contentLines/contentBytes，联动 §12.2 热重载（SKILL.md 改了自动重新计算）

**SKILL.md 扩展格式**：

```markdown
---
name: refactor-typescript
description: TypeScript 重构指南，涵盖提取函数/类型收窄/泛型简化
tags: [coding, typescript, refactor]
---

# Refactor TypeScript
...完整内容...
```

**核心接口**：

```typescript
// src/skills/types.ts 扩展

interface Skill {
  readonly name: string;
  readonly description: string;
  readonly content: string;
  readonly filePath: string;
  readonly disableModelInvocation?: boolean;
  // L2 新增
  readonly contentLines: number;
  readonly contentBytes: number;
  readonly tags?: string[];
  readonly lastUsed?: number;  // timestamp，由 read_file 工具维护
}

// 系统提示注入（L1 索引）
function formatSkillsForSystemPrompt(skills: Skill[]): string {
  // 按 lastUsed 降序（最近用的在前）
  const sorted = [...skills].sort((a, b) => (b.lastUsed ?? 0) - (a.lastUsed ?? 0));

  // token 预算控制
  const MAX_INDEX_TOKENS = 4000;
  let usedTokens = 0;
  const fullEntries: string[] = [];
  const nameOnly: string[] = [];

  for (const s of sorted) {
    const line = formatSkillIndexLine(s);
    const lineTokens = estimateTokens(line);
    if (usedTokens + lineTokens <= MAX_INDEX_TOKENS) {
      fullEntries.push(line);
      usedTokens += lineTokens;
    } else {
      nameOnly.push(s.name);
    }
  }

  let output = `## Skills\n\nTo use a skill, read its SKILL.md via read_file. Judge by size hint whether worth reading.\n\n`;
  output += fullEntries.join('\n');
  if (nameOnly.length > 0) {
    output += `\n\nAdditional skills (read SKILL.md for details): ${nameOnly.join(', ')}`;
  }
  return output;
}

function formatSkillIndexLine(s: Skill): string {
  const size = `${s.contentLines}行/${s.contentBytes}字节`;
  const tags = s.tags?.length ? ` [${s.tags.join(',')}]` : '';
  return `- **${s.name}** — ${s.description} (${size})${tags}  \`${s.filePath}\``;
}

// 加载时计算元信息
async function loadSkill(env: ExecutionEnv, filePath: string): Promise<Skill> {
  const result = await env.readTextFile(filePath);
  const content = result.ok ? result.value : '';
  const { frontmatter, body } = parseFrontmatter(content);
  return {
    name: frontmatter.name,
    description: frontmatter.description,
    content: body,
    filePath,
    contentLines: body.split('\n').length,
    contentBytes: Buffer.byteLength(body, 'utf-8'),
    tags: frontmatter.tags,
  };
}

// read_file 工具中特判维护 lastUsed
async function readFileTool(args: { path: string }, session: AgentSession): Promise<AgentToolResult> {
  const content = await fs.promises.readFile(args.path, 'utf-8');
  // 特判：是否为 skill 文件
  const skill = session.skills.find(s => s.filePath === args.path);
  if (skill) {
    skill.updateLastUsed(Date.now());  // 触发 L1 索引重排序
  }
  return { content };
}
```

### 12.6 L2 发布节奏

**L2 首批**（解决可靠性 + 扩展性基础）：
1. §12.1 MixinProvider（故障转移）
2. §12.2 Config 热重载（体验）
3. §12.3 Hook 系统（扩展性）

**L2 次批**（体验优化）：
4. §12.4 /session 动态属性（调参体验）
5. §12.5 L1 索引 skill（token 优化）

### 12.7 跨模块影响确认

- **§5 Provider 抽象层**：MixinProvider 在 Provider 层组合，§5 已定的 Api-Provider 分离天然支持（Mixin 要求子 Provider 共享同一 Api 实现）
- **§3 AgentLoop 事件流**：Hook ctx 独立于 AgentEvent，不冲突
- **§11.6 CommandRegistry**：L2 扩展命令
  - `/model --sub <idx>`：手动切 MixinProvider 子 provider
  - `/session` 扩展：查看当前动态属性
  - `/session.reset`：清除动态属性
  - `/session.xxx=yyy`：设置动态属性

---

- **2026-06-25**：
  - 初始化文档；完成 AgentLoop 模块 pi-agent vs nanobot 深度对比（基于实际源码纠正了"nanobot 单层"的误判，实际是两层 AgentLoop+AgentRunner）
  - 事件流粒度（细粒度）、中途打断（steering+follow-up）已定
  - AgentLoop 分层定为方案 A（Layer 1 无状态生成器 + Layer 2 AgentSession 有状态+持久化）
  - 错误处理定为外置分层重试（Provider 传输重试 / AgentSession 业务重试 / agentLoop 语义重试让 LLM 参与 / 错误响应不持久化）
  - Provider 抽象层定为 Api-Provider 分离（Api 协议实现层 + Provider 声明层），支持多 provider 共享同一 API 实现
- **2026-06-26**：
  - 完成 Tool Registry 模块对比与设计：结构化返回（AgentToolResult<T>）、流式进度接口预留、per-tool executionMode、手动注册
  - 完成 Memory System 模块对比与设计：线性会话、混合压缩（MVP 会话内 Compaction + 后续跨会话长期记忆）、JSONL 存储、实时兜底触发、增量摘要
  - 完成 Skills 系统模块对比与设计：两层加载（workspace+builtin）、最小 frontmatter、全量 description 注入、ExecutionEnv 抽象
  - 完成 Channel 抽象模块对比（§10.1-10.3）：nanobot Channel+MessageBus 双向队列多平台接入 vs pi-agent Mode+EventBus 进程内直订阅；核心张力是标准化载体（弱类型 metadata 标记）vs 原生事件类型安全。完整设计空间梳理 7 个方案（A/B/C/D/E/F/G），5 约束筛选后定方案 E（类型化 bus，nanobot 架构的 TS 现代化重写）。§10.6 定稿：AgentEventEnvelope 双向队列 + bindSession 多对一共享 + 6 字段能力声明 + MVP 限 CLI/WebSocket，IM 与权限模型放 L2/L3
  - 完成 CLI/WebUI 接入层模块对比与设计（§11）：pi-agent InteractiveMode+自研 pi-tui+40+ Ink 组件+18 斜杠命令 vs nanobot Typer+prompt_toolkit+Rich StreamRenderer（CLI 走 bus）+ WebSocketChannel+SPA+HTTP API（WebUI 复用 channel）。§11.6 定稿：CLI 用 Ink + 共享 coreReducer + 统一 CommandRegistry（5 内置命令 MVP）；WebUI 用 Lit + WC + 同 coreReducer + 同 CommandRegistry；CLI/WebUI 都是 channel consume AgentEventEnvelope；MVP 限基础流式+单会话，Overlay/侧边栏/fork/认证 放 L2
  - 新增 GenericAgent（GA）项目调研，完成三方（pi-agent vs nanobot vs GenericAgent）逐项架构对比，独立文档 [comparison-pi-nanobot-ga.md](comparison-pi-nanobot-ga.md)：22 个维度全覆盖（定位/技术栈/规模/AgentLoop/Provider/Tool/Memory/Skills/Subagent/Config/Channel/CLI/WebUI/会话/错误处理/上下文压缩/流式/插件/安全/自主行动/系统控制/调整建议）。GA 核心特点：~100 行 generator agent loop + 9 原子工具 + 自演化 skills + L1/L2/L3 三层记忆 + working memory + <30K 极低 token + MixinSession 多 LLM 混用 + subagent 文件通信 + Plan Mode SOP + TMWebDriver 真实浏览器注入 + 空闲自主行动。基于对比结论，aptbot 现有设计无需推翻，但补充 6 项 L2 待办（working memory / MixinSession 切换 / config 热重载 / hook 点 / /session 动态属性 / L1 索引 skill）+ 6 项 L3 待办（自演化 skill / subagent 文件通信 / Plan Mode / 空闲自主 / 浏览器控制 / MixinSession Fallback），1 项 MVP 候选（tag 正则截断作为 Compaction 前置）
  - 基于 GA 对比结论，确定 3 项调整决策：(1) tag 正则截断暂不纳入 MVP（aptbot 用 JSONL 结构化存储，截断策略需重新设计，MVP 先用 Compaction 兜底）；(2) Working Memory 纳入 MVP（§7.7 新增：key_info + update_working_memory 工具 + 持久化到 SessionEntry + /continue 显式继承；LLM 自主决定更新时机，无系统强制提醒；解决长对话约束漂移 + 跨 session 任务连续性，是 Compaction 的补充而非替代）；(3) 不做自演化 skill（§8.7 新增：改推荐用户创建 skill，L2 实现 /skill create|list|edit 命令 + LLM 主动推荐；理由是自动演化需任务成功判定且 SOP 质量参差，推荐机制更轻更可控）；§11.6 CommandRegistry 内置命令从 5 个增至 6 个（+ /continue），/skill 系列放 L2
  - 完成 L2 待办详细设计（§12 新增，5 项 + 17 子决策全部按推荐设置确定）：§12.1 MixinProvider（多 provider 故障转移 + 弹回 + 流式不切已 yield + 同协议约束 + 广播属性 + 切换通知）；§12.2 Config 热重载（mtimeNs 懒加载 + 整体重载 + beforeTurn 检查 + 当前 turn 不受影响 + 校验失败降级）；§12.3 Hook 系统（8 hook 点 + 同步 + ctx 允许 mutate + priority 排序 + 两层插件目录 + 无沙箱 + 吞异常）；§12.4 /session 动态属性（白名单 5 项 + 文件值逃生口 + JSON 自动解析 + 内存态 + /session.reset + MixinProvider 广播）；§12.5 L1 索引 skill（行数/字节/tags + lastUsed 降序排序 + 4K token 预算上限 + read_file 特判维护 lastUsed + 热重载联动）；§12.6 L2 发布节奏（首批 MixinProvider+热重载+Hook，次批 /session+L1 索引）；§12.7 跨模块影响确认（§5 Api-Provider 分离天然支持 MixinProvider，§3 事件流与 hook ctx 不冲突，§11.6 命令扩展 /model --sub + /session 系列）
  - 完成部署设计（§13 新增）：三环境分层部署——本地 Ubuntu 主力（双模式：局域网 HTTP + 公网 Caddy 反代 + 强 token）+ CF 演示（demo.aptbot.de，Workers + DO SQLite + KV，最小工具集 web_fetch + update_working_memory）。核心原则：本地保完整 bash/fs 能力，CF 演示做轻量 UI/流式展示。代码适配用运行时注入（非构建变体），共享层（coreReducer/CommandRegistry/Provider/AgentLoop/Memory/Skills/Channel）不变，差异层（StorageAdapter/ToolRegistry/ConfigSource）按 DEPLOY env 注入。MVP WebUI 同源（Node.js serve 静态 + WS），L2+ 可拆 CF Pages。进程管理用 systemd，反代用 Caddy（自动 Let's Encrypt）。已确认 CF 2026 免费额度（Workers 10ms CPU 但 LLM 等待不计 / DO SQLite Free 可用 / Pages 静态无限 / KV 够配置）足够 demo 用量
  - 完成技术边界与测试约束补充（§14 新增，brainstorming 审查后补齐 3 类底层缺失）：§14.1 异常与边界处理（5 类场景：Memory 边界 6 项 / Tool 执行边界 8 项 / Session 恢复边界 3 项 / WebSocket 边界 4 项 / Provider 流式边界 4 项，每项含处理规则与实现位置）；§14.2 本地测试断言与验收标准（Unit/Integration/E2E 三层分层 + 5 模块核心断言点代码示例 + MVP 10 项验收标准表）；§14.3 底层技术约束（资源上限 10 项 / 超时 10 项 / 不变量 6 项 / Token 计算约束 6 项 / 事件循环约束 3 项 / 文件描述符约束 3 项）；§14.4 决策汇总 10 项。与 §4 错误处理策略互补：§4 定义重试分层策略，§14 定义具体边界场景与处理规则

---

## 13. 部署设计（已定）

> 三环境分层部署：本地 Ubuntu 主力（双模式：局域网 + 公网反代）+ Cloudflare 演示版。核心原则：**本地保完整能力，CF 演示做轻量展示**。

### 13.1 部署矩阵

| 环境 | 域名/入口 | 后端 | 工具能力 | 存储 | 认证 |
|---|---|---|---|---|---|
| **本地主力（局域网）** | `http://192.168.x.x:3000` | Node.js | 完整（bash/fs/edit/grep/glob/...） | JSONL 本地文件 | 可选 token |
| **本地主力（公网）** | `https://<其他域名>` | Caddy → Node.js | 完整 | JSONL 本地文件 | 强 token |
| **CF 演示** | `https://demo.aptbot.de` | Workers + Pages | 受限（web_fetch + update_working_memory） | DO SQLite + KV | 简单 token |

**核心约束**：
- 同一份代码，运行时按 `DEPLOY` 环境变量注入差异层
- 共享层不变：coreReducer / CommandRegistry / Provider / AgentLoop / Memory / Skills / Channel
- 差异层注入：StorageAdapter / ToolRegistry 过滤 / ConfigSource

### 13.2 本地双模式（局域网 + 公网反代）

**架构**：

```
局域网设备 ──HTTP──> 192.168.x.x:3000  ┐
                                      ├──> Node.js (:3000)  [监听 0.0.0.0]
公网用户 ──HTTPS──> other-domain.com ─┘     （反代终止 TLS，转 HTTP 到本机）
              (Caddy)
```

**关键设计**：

1. **Node.js 始终跑 HTTP**：监听 `0.0.0.0:3000`，TLS 终止在反代层（Caddy 自动 Let's Encrypt）
2. **端口隔离**：UFW 防火墙限制 3000 端口仅本机访问，公网流量必须经反代
3. **认证分层**：
   - 局域网：可选轻 token（看信任度）
   - 公网：必强 token（`aptbot_<32字符随机串>`）+ 推荐 Cloudflare Access 免费版兜底
4. **配置开关**：`DEPLOY_MODE=dual` 同时启用两个入口的认证策略

**Caddy 配置示例**：

```caddy
other-domain.com {
  reverse_proxy localhost:3000
  # 可选：限制路径白名单
  # @allowed path /api/* /ws /
  # handle @allowed { reverse_proxy localhost:3000 }
}
```

**进程管理（systemd）**：

```ini
# /etc/systemd/system/aptbot.service
[Unit]
Description=aptbot agent server
After=network.target

[Service]
Type=simple
User=aptbot
WorkingDirectory=/opt/aptbot
Environment=NODE_ENV=production
Environment=DEPLOY=local
Environment=DEPLOY_MODE=dual
ExecStart=/usr/bin/node dist/server.js
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl enable --now aptbot
sudo systemctl status aptbot
sudo journalctl -u aptbot -f   # 实时日志
```

### 13.3 CF 演示版架构（demo.aptbot.de）

**架构**：

```
Browser ──HTTPS──> demo.aptbot.de
                       │
       ┌───────────────┴───────────────┐
       │                               │
   Pages (WebUI 静态)            Workers (轻量 agent loop)
                                       │
                                       ├─ LLM 流式调用（等待不计 CPU，10ms CPU 够用）
                                       ├─ web_fetch（fetch 外部 URL）
                                       ├─ update_working_memory（DO SQLite）
                                       └─ DO SQLite（会话/工作记忆）+ KV（配置）
```

**CF 免费额度（2026 最新，已确认）**：

| 资源 | 免费额度 | demo 用量评估 |
|---|---|---|
| Workers | 10万请求/天，10ms CPU/请求 | 够（LLM 等待不计 CPU） |
| Durable Objects（SQLite 后端） | 10万请求/天，13K GB-s/天，5GB 存储 | 够 demo |
| Pages | 静态请求无限，500 构建/月 | 够 |
| KV | 10万读/天，1K写/天 | 够配置 |
| D1 | 500万行读/天，10万行写/天 | 备选（demo 用 DO SQLite 即可） |
| R2 | 10GB，零出口费 | 备选（demo 暂不启用文件工具） |

**Workers CPU 限制分析**：
- 10ms CPU 是 wall-clock CPU，**LLM API 等待不计 CPU**（I/O 期间不消耗）
- 实际消耗：JSON 解析 + 流式 chunk 处理 + DO 读写
- 单 turn agent loop（含一次 LLM 流式调用 + 1-2 个 web_fetch）CPU 消耗约 2-5ms，远低于 10ms 上限
- **结论：演示版单 turn 可行**；多 turn 长任务需用 DO（CPU 30秒/请求）

**DO 选型**：用 SQLite 后端（免费版唯一可用后端，2026 起 Free 计划支持），单 DO 实例存单会话，支持 hibernate 降低 GB-s 计费

### 13.4 代码层适配（运行时注入）

**共享层（无改动）**：

```typescript
// 所有环境共用
const agentLoop = new AgentLoop(provider, tools, memory, skills);
const reducer = createCoreReducer();
const commands = createCommandRegistry();
const channel = new WebSocketChannel(/* ... */);
```

**差异层接口**：

```typescript
// src/storage/adapter.ts
interface StorageAdapter {
  // 会话存储
  readSession(id: string): Promise<SessionEntry | null>;
  appendSession(id: string, event: AgentEvent): Promise<void>;
  listSessions(): Promise<SessionMeta[]>;
  // 工作记忆
  readWorkingMemory(sessionId: string): Promise<WorkingMemory | null>;
  writeWorkingMemory(sessionId: string, wm: WorkingMemory): Promise<void>;
  // 配置
  readConfig(key: string): Promise<unknown>;
  writeConfig(key: string, value: unknown): Promise<void>;
}

// 本地实现：JSONL 文件
class FileStorage implements StorageAdapter { /* fs-based */ }

// CF 实现：DO SQLite + KV
class CloudflareStorage implements StorageAdapter {
  constructor(private doNamespace: DurableObjectNamespace, private kv: KVNamespace) {}
  /* DO for session/wm, KV for config */
}
```

```typescript
// src/tools/registry.ts
function createToolRegistry(deploy: 'local' | 'cf'): ToolRegistry {
  const allTools = [bashTool, readTool, writeTool, editTool, grepTool, globTool,
                    webFetchTool, updateWorkingMemoryTool];

  if (deploy === 'cf') {
    // 演示版：仅无 fs/bash 依赖的工具
    return new ToolRegistry([webFetchTool, updateWorkingMemoryTool]);
  }
  return new ToolRegistry(allTools);
}
```

```typescript
// src/config/source.ts
interface ConfigSource {
  get<T>(key: string): Promise<T | null>;
  set<T>(key: string, value: T): Promise<void>;
  watch(cb: () => void): void;  // 热重载钩子（仅本地实现）
}

class FileConfigSource implements ConfigSource { /* mtime 检测，见 §12.2 */ }
class KVConfigSource implements ConfigSource { /* KV 读取，无 watch */ }
```

**启动入口分流**：

```typescript
// src/server.ts（本地）
const deploy = process.env.DEPLOY ?? 'local';
const storage = new FileStorage('./data');
const tools = createToolRegistry('local');
const config = new FileConfigSource('./config.json');
startServer({ storage, tools, config });

// src/worker.ts（CF）
export default {
  async fetch(req: Request, env: Env) {
    const storage = new CloudflareStorage(env.DO_SESSION, env.KV_CONFIG);
    const tools = createToolRegistry('cf');
    const config = new KVConfigSource(env.KV_CONFIG);
    return handleRequest(req, { storage, tools, config, env });
  }
};
```

### 13.5 认证策略

**本地局域网**：
- 可选：`?token=aptbot_xxx` 查询参数，WebSocket 握手时校验
- 信任度高可关闭

**本地公网（反代）**：
- 强制：HTTP 头 `Authorization: Bearer aptbot_<32字符>`
- WebSocket：握手时 `Sec-WebSocket-Protocol` 携带 token
- 推荐叠加 Cloudflare Access 免费版（如反代域名也走 CF）

**CF 演示版**：
- 简单 token（同上），防止滥用
- 可选：Cloudflare Turnstile 免费版人机校验

```typescript
// src/auth.ts
function authenticate(req: Request, config: AuthConfig): boolean {
  if (!config.enabled) return true;
  const token = req.headers.get('Authorization')?.replace('Bearer ', '');
  return token === config.token;
}

// WebSocket 握手认证
function handleWsUpgrade(req: Request, server: WebSocketServer, token: string | undefined): WebSocket | null {
  if (config.enabled && token !== config.token) return null;
  return server.upgrade(req);
}
```

### 13.6 域名规划

| 域名 | 用途 | 解析 |
|---|---|---|
| `aptbot.de` | 主站（暂未启用，预留） | 后续可指向 CF Pages 或主力 |
| `demo.aptbot.de` | CF 演示版 | CNAME → `<worker>.workers.dev` 或 Pages 自定义域名 |
| `<其他自有域名>` | 本地主力公网入口 | A/AAAA → 服务器公网 IP（经 Caddy 反代） |
| `192.168.x.x:3000` | 本地局域网入口 | 直接 IP 访问 |

**DNS 配置（demo.aptbot.de）**：
- 在 Cloudflare DNS 添加 `demo` CNAME 记录指向 Pages/Workers
- 启用 Cloudflare 代理（橙色云）获取自动 HTTPS

### 13.7 项目构建与部署

**目录结构（monorepo 复用）**：

```
aptbot/
├── packages/
│   ├── core/              # 共享层（AgentLoop/Provider/Tools/Memory/...）
│   ├── server/            # 本地服务器入口（Node.js + Express/Hono）
│   ├── worker/            # CF Workers 入口
│   └── webui/             # WebUI 前端（Lit + WC，构建产物供两边复用）
├── wrangler.toml          # CF Workers 配置
├── Caddyfile              # 本地反代配置
└── deploy/
    ├── systemd/aptbot.service
    └── README.md          # 部署文档
```

**wrangler.toml（CF 演示版）**：

```toml
name = "aptbot-demo"
main = "packages/worker/dist/worker.js"
compatibility_date = "2026-06-01"

[assets]
directory = "./packages/webui/dist"
binding = "ASSETS"

[[durable_objects.bindings]]
name = "DO_SESSION"
class_name = "SessionDurableObject"

[[kv_namespaces]]
binding = "KV_CONFIG"
id = "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"

[[migrations]]
tag = "v1"
new_classes = ["SessionDurableObject"]
```

**部署命令**：

```bash
# 本地主力
npm run build
sudo systemctl restart aptbot

# CF 演示版
npm run build:webui
npx wrangler deploy
```

### 13.8 已定决策汇总

| 决策项 | 选择 | 理由 |
|---|---|---|
| 本地主力暴露方式 | 双模式（局域网 + 公网反代） | 局域网零配置，公网经 Caddy 反代 + 强认证 |
| WebUI 部署 | MVP 同源（Node.js serve 静态 + WS） | 单端口无 CORS，最快产出；L2+ 可拆 CF Pages |
| CF 演示域名 | `demo.aptbot.de` | aptbot.de 预留主站，演示用子域名 |
| CF 演示后端 | Workers + DO（SQLite）+ KV | 免费额度够 demo，LLM 等待不计 CPU |
| CF 演示工具集 | 最小集（web_fetch + update_working_memory） | 无 fs/bash 依赖，够演示对话/流式/命令 |
| 代码适配策略 | 运行时注入（非构建变体） | 同一份代码，按 env 切换，便于维护 |
| 进程管理 | systemd | 原生稳定，开机自启，无额外依赖 |
| 反代工具 | Caddy | 自动 Let's Encrypt，单文件配置 |
| TLS 终止 | 反代层（Node.js 跑 HTTP） | 简化 Node.js，证书管理在反代 |
| 认证策略 | 局域网可选 / 公网强 token / demo 简单 token | 按信任度分层 |

### 13.9 后续待办（L2+）

- WebUI 拆分到 CF Pages 独立部署（同源 → 分离，加 CORS）
- CF 演示版加 R2 文件工具（read_r2/write_r2），演示文件操作能力
- 多用户隔离与限流（若 demo 公开访问）
- CF 演示版会话自动清理（DO SQLite 5GB 上限，需 TTL 清理策略）
- 本地主力加 Tailscale 支持（设备级私网，备用入口）
- 监控与告警（systemd + Cloudflare Analytics）

---

## 14. 技术边界与测试约束（已定）

> 补充 §1-§13 中散落但未系统化的三类底层技术约束：异常与边界处理（Edge Cases）、本地测试断言与验收标准、底层技术约束（Constraints）。本章与 §4 错误处理策略互补：§4 定义"重试分层策略"，本章定义"具体边界场景与处理规则"。

### 14.1 异常与边界处理（Edge Cases）

#### 14.1.1 Memory System 边界

| 边界场景 | 处理规则 | 实现位置 |
|---|---|---|
| **JSONL 最后一行不完整**（写入时进程崩溃） | 读取时 `JSON.parse` 失败的尾行跳过，记录 warn 日志，session 可正常恢复到上一完整 entry | `FileStorage.readSession` |
| **JSONL 并发写入竞争**（多 channel 共享 session） | 写入加 `async-mutex`（per-sessionId），串行化 append；锁超时 5s 后放弃并报错 | `FileStorage.appendSession` |
| **磁盘满**（write 失败） | 捕获 `ENOSPC`，发 `error` 事件到 channel（"磁盘空间不足"），agent loop 终止当前 turn，不持久化本 turn 结果 | `FileStorage` + `AgentSession` |
| **Compaction 中断**（进程被杀） | Compaction 是非破坏性操作：生成 summary → 写入新 entry → 标记旧 entries 为 compacted。中断时最多丢失 summary entry，旧 entries 仍完整，下次启动可重新触发 | `Memory.compact` |
| **session 文件不存在** | 返回空 session（无 entries），不报错，视为新 session | `FileStorage.readSession` |
| **key_info 长度溢出**（§7.7 MVP 待办） | MVP 简单截断到 2000 字符，发 warn 日志；L2 改为多槽位（task/constraints/lessons） | `update_working_memory` 工具 |

#### 14.1.2 Tool 执行边界

| 边界场景 | 处理规则 | 默认值 |
|---|---|---|
| **bash 超时** | 子进程超时后 `SIGTERM` → 等 2s → `SIGKILL`，返回 `timeout_error` 给 LLM | 30s（可配置） |
| **bash 进程泄漏** | 父进程退出时 `process.exit` hook 杀所有子进程；每 turn 结束检查 orphan | — |
| **bash OOM** | 子进程被系统 OOM kill 时返回 `oom_error`；不在 aptbot 侧限制内存（依赖系统 cgroups） | — |
| **edit 并发冲突** | 文件读写加 per-filePath mutex；同一文件并发 edit 串行化 | — |
| **read 大文件** | 单文件读取上限 10MB，超出返回 `file_too_large`；行数上限 10000 行 | 10MB / 10000 行 |
| **grep/glob 结果过多** | 结果数上限 500 条，超出截断并提示"结果已截断，请细化查询" | 500 条 |
| **web_fetch 超时** | fetch 超时 15s，返回 `fetch_timeout`；响应体上限 1MB | 15s / 1MB |
| **工具执行异常**（未预期错误） | 捕获所有异常，返回 `AgentToolResult({ content: "Error: ...", terminate: false })`，让 LLM 决定是否重试 | — |

#### 14.1.3 Session 恢复边界

| 边界场景 | 处理规则 |
|---|---|
| **JSONL 完全损坏**（无法解析任何行） | 返回空 session，发 `error` 事件到 channel（"会话历史损坏，已重置"），备份原文件到 `.corrupt.bak` |
| **working_memory entry 损坏** | 跳过该 entry，从更早的 working_memory entry 恢复；若无则 keyInfo 为空 |
| **session ID 不存在** | 创建新 session，不报错（幂等语义） |

#### 14.1.4 WebSocket 边界

| 边界场景 | 处理规则 |
|---|---|
| **客户端断连** | agent loop 继续执行，事件缓冲到 outbound 队列（上限 1000 条）；客户端重连后发送 backlog |
| **缓冲溢出**（>1000 条） | 丢弃最旧的 `message_delta`/`reasoning_delta`（细粒度事件），保留 `tool_call`/`tool_result`/`message_end`（关键事件） |
| **心跳超时** | 60s 无心跳响应则关闭连接，释放资源 |
| **重连后状态同步** | 客户端发送 `lastEventSeq`，服务端从该 seq 之后重放缓冲事件；若 seq 已被丢弃则发 `resync_required` 让客户端全量拉取 |

#### 14.1.5 Provider 流式边界

| 边界场景 | 处理规则 |
|---|---|
| **首字节超时**（LLM 卡住未返回任何 chunk） | 30s 超时，视为传输错误，触发 Provider 层重试（§4 Layer 0） | 30s |
| **chunk 间超时**（流卡住但未断开） | 60s 无新 chunk 视为流中断，触发重试；已 yield 的 chunk 不撤回（§12.1 流式故障转移边界） | 60s |
| **流被 LLM 主动中止**（`stop_reason: "aborted"`） | 正常结束当前 turn，不重试，发 `message_end` 事件 |
| **rate limit（429）** | Provider 层指数退避重试 3 次（§4 Layer 0）；仍失败则 AgentSession 层切换 fallback provider（§12.1 MixinProvider） |

### 14.2 本地测试断言与验收标准

#### 14.2.1 测试分层

```
单元测试（Unit）        → 模块内函数/类的纯逻辑测试，mock 所有外部依赖
集成测试（Integration） → 多模块协作，mock LLM 但用真实 fs/JSONL
端到端测试（E2E）       → 完整 agent loop + mock LLM，验证事件流序列
```

#### 14.2.2 核心断言点

**AgentLoop（§3）**：

```typescript
describe('AgentLoop', () => {
  // 断言：单 turn 事件序列完整
  assert(events equals [
    { type: 'turn_start' },
    { type: 'message_start' },
    { type: 'message_delta', text: 'Hello' },
    { type: 'message_end', stopReason: 'end_turn' },
    { type: 'turn_end' }
  ]);

  // 断言：工具调用后继续生成
  assert(tool_call → tool_result → message_start 顺序正确);

  // 断言：steering message 中途注入后，下个 turn 包含
  assert(steering injected → next turn context includes steering);

  // 断言：错误响应不持久化
  assert(provider throws → session.entries 不包含该 turn);
});
```

**Provider（§5）**：

```typescript
describe('Provider', () => {
  // 断言：5xx 自动重试 3 次
  assert(mock 500 × 3 → throws after 3 retries);

  // 断言：429 指数退避
  assert(mock 429 → retries at 1s/2s/4s intervals);

  // 断言：流式中断后已 yield chunk 不撤回
  assert(stream breaks mid-way → yielded chunks preserved);
});
```

**Tool（§6）**：

```typescript
describe('Tool', () => {
  // 断言：bash 超时杀进程
  assert(sleep 60 → timeout at 30s → process killed);

  // 断言：edit 幂等性（同一 patch 两次应用，第二次返回 unchanged）
  assert(apply patch A → apply patch A again → second result: unchanged);

  // 断言：read 大文件拒绝
  assert(file > 10MB → returns file_too_large);

  // 断言：工具异常被捕获，不 crash agent loop
  assert(tool throws → AgentToolResult.error returned to LLM);
});
```

**Memory（§7）**：

```typescript
describe('Memory', () => {
  // 断言：JSONL 尾行损坏可恢复
  assert(write 3 entries + truncate last → read returns 2 valid entries);

  // 断言：Compaction 后旧 entries 标记为 compacted
  assert(compact → entries[0..n] marked compacted, summary entry appended);

  // 断言：session 恢复重建 workingMemory
  assert(write working_memory entry → restart → readWorkingMemory returns keyInfo);

  // 断言：key_info 截断到 2000 字符
  assert(update_working_memory(3000 chars) → stored keyInfo.length === 2000);
});
```

**Channel（§10）**：

```typescript
describe('Channel', () => {
  // 断言：WebSocket 断连后 agent loop 继续
  assert(ws disconnect → agent loop continues → events buffered);

  // 断言：重连后 backlog 重放
  assert(reconnect with lastEventSeq → events after seq replayed);

  // 断言：缓冲溢出丢弃细粒度事件
  assert(buffer > 1000 → message_delta dropped, tool_call preserved);

  // 断言：多 channel fanout 顺序一致
  assert(2 channels → both receive same event order);
});
```

#### 14.2.3 MVP 验收标准

**最小闭环定义**：单会话 + 单模型 + 3 工具（bash/read/write）+ 流式输出 + 持久化恢复

| # | 验收项 | 通过标准 |
|---|---|---|
| 1 | 基础对话 | 用户输入 → LLM 流式响应 → 消息完整显示 |
| 2 | 工具调用 | LLM 调用 bash → 执行 → 结果回传 → LLM 继续生成 |
| 3 | 多轮对话 | 连续 3 轮对话，context 正确累积 |
| 4 | 持久化 | 进程重启后 `/open <sessionId>` 恢复历史 |
| 5 | Working Memory | LLM 调用 `update_working_memory` → 重启后 keyInfo 恢复 |
| 6 | 错误恢复 | LLM 返回错误 → Provider 重试 → 恢复或优雅降级 |
| 7 | WebSocket 断连重连 | 断连 → 重连 → backlog 重放 → 状态一致 |
| 8 | CLI 命令 | `/new` `/open` `/list` `/model` `/continue` `/help` 全部可用 |
| 9 | WebUI 基础 | 浏览器访问 → 流式显示 → 工具调用渲染 |
| 10 | Compaction | 长对话触发 Compaction → summary 生成 → 上下文长度下降 |

### 14.3 底层技术约束（Constraints）

#### 14.3.1 资源上限

| 约束 | 上限 | 理由 |
|---|---|---|
| Node.js 进程内存 | 512MB（推荐 systemd 配 `MemoryMax=512M`） | 单用户 demo 足够，超出则 OOM kill 重启 |
| 单 session JSONL 文件 | 50MB | 超出触发强制 Compaction；100MB 硬上限拒绝写入 |
| WebSocket 最大连接 | 50（单进程） | MVP 单用户，多用户需 L2 拆分 |
| AgentEventEnvelope 缓冲 | 1000 条/连接 | 平衡内存与重连体验 |
| bash 子进程数 | 10 并发 | 防止 fork bomb |
| bash 子进程内存 | 不限（依赖系统） | MVP 不做 cgroups 限制 |
| grep/glob 结果 | 500 条 | 防止 LLM 上下文爆炸 |
| read 单文件 | 10MB / 10000 行 | 防止 OOM |
| web_fetch 响应体 | 1MB | 防止 OOM |
| key_info 长度 | 2000 字符（MVP） | L2 改多槽位 |

#### 14.3.2 超时

| 操作 | 超时 | 处理 |
|---|---|---|
| bash 执行 | 30s | SIGTERM → 2s → SIGKILL |
| read 文件 | 5s | 返回 `read_timeout` |
| edit 文件 | 5s | 返回 `edit_timeout` |
| grep/glob | 10s | 返回 `search_timeout` |
| web_fetch | 15s | 返回 `fetch_timeout` |
| LLM 首字节 | 30s | 触发 Provider 重试（§4 Layer 0） |
| LLM chunk 间隔 | 60s | 视为流中断，触发重试 |
| WebSocket 心跳 | 60s | 关闭连接 |
| Provider 重试间隔 | 1s/2s/4s（指数退避） | 最多 3 次 |
| Config 热重载检查 | beforeTurn（零阻塞） | mtimeNs 对比 |

#### 14.3.3 不变量（Invariants）

| 不变量 | 保证方式 | 违反时处理 |
|---|---|---|
| **AgentEventEnvelope 顺序保证** | 单 channel 内事件严格按生成顺序入队/出队 | 不可能违反（单队列 FIFO） |
| **SessionEntry 追加语义** | 只 append 不 modify（Compaction 也是 append summary + mark old，不删除） | 违反时 readSession 报错 |
| **Working Memory 单调更新** | 每次 update_working_memory 覆盖整个 keyInfo，不部分更新 | 工具层保证 |
| **JSONL 行完整性** | 每行一个完整 JSON，写入用 `JSON.stringify` + `\n`，不拆行 | 损坏时跳过坏行 |
| **工具调用 ID 唯一性** | `tool_call_id` 全局唯一（`crypto.randomUUID()`） | 不可能违反 |
| **turn 原子性** | 单 turn 内所有 events 要么全部持久化要么全部不持久化（错误响应不持久化） | AgentSession 层保证 |

#### 14.3.4 Token 计算约束

| 约束 | 策略 |
|---|---|
| **估算精度** | MVP 用 `tiktoken`（OpenAI）或 provider 提供的 usage 字段，不自行实现 tokenizer |
| **Compaction 触发阈值** | 上下文达到 model maxTokens 的 80% 时触发 |
| **Compaction 目标长度** | 压缩到 maxTokens 的 30% |
| **Skills 注入预算** | 全部 description 总长不超过 2000 token（§8.6） |
| **L1 索引 skill 预算** | 4K token（§12.5） |
| **工具结果截断** | 单工具结果超过 5000 token 时截断，尾部附 `\n... [truncated]` |

#### 14.3.5 事件循环约束

| 约束 | 处理 |
|---|---|
| **长同步操作** | JSON.parse 大 messages（>1MB）、Compaction 摘要生成（LLM 调用）必须 `setImmediate` 让出 event loop |
| **大文件读写** | read 工具读 >1MB 文件用流式读取，不一次性 `readFile` |
| **批量 session 列表** | `/list` 分页，每页 20 条，避免一次性加载所有 session 元数据 |

#### 14.3.6 文件描述符约束

| 约束 | 处理 |
|---|---|
| **bash 子进程 fd** | 子进程退出后自动回收；每 turn 结束检查 orphan 进程 |
| **JSONL 文件句柄** | 不保持长开句柄，每次 read/write 后 `close`；用 `fs.promises` 自动管理 |
| **WebSocket 句柄** | 连接关闭时 `removeAllListeners` + `terminate()`，防止内存泄漏 |

### 14.4 已定决策汇总

| 决策项 | 选择 | 理由 |
|---|---|---|
| JSONL 尾行损坏 | 跳过坏行 + warn 日志 | 优先恢复可用历史 |
| JSONL 并发写入 | per-sessionId mutex + 5s 超时 | 串行化保证完整性，超时避免死锁 |
| bash 超时 | 30s + SIGTERM→SIGKILL | 平衡实用性与安全性 |
| WebSocket 断连 | agent loop 继续 + 缓冲 1000 条 | 用户体验优先 |
| 缓冲溢出 | 丢弃细粒度事件，保留关键事件 | 语义完整性优先 |
| LLM 首字节超时 | 30s | 兼顾网络抖动与卡死检测 |
| Token 计算 | 用 tiktoken / provider usage | 不自行实现 tokenizer |
| Compaction 阈值 | 80% 触发，压到 30% | 留足安全边际 |
| 测试分层 | Unit / Integration / E2E | 标准三层 |
| MVP 验收 | 10 项最小闭环 | 覆盖核心路径 |
