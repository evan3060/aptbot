# 三方架构对比：pi-agent vs nanobot vs GenericAgent

> 本文档作为 aptbot 后续工作的参考，逐项对比三个轻量级 agent 框架的架构特点。
> - **pi-agent**：TypeScript，极简无状态生成器 + 事件流，纯 CLI 工具
> - **nanobot**：Python，完整多平台 IM agent，Channel + MessageBus 架构
> - **GenericAgent (GA)**：Python，~3K 行自演化 agent，9 原子工具 + generator 流式 + 极低 token
>
> 源码位置：`/Users/evan/projects/aptbot/{pi,nanobot,GenericAgent}`
> 生成时间：2026-06-26

---

## 目录

1. [项目定位与设计哲学](#1-项目定位与设计哲学)
2. [语言与技术栈](#2-语言与技术栈)
3. [代码规模与复杂度](#3-代码规模与复杂度)
4. [AgentLoop 架构](#4-agentloop-架构)
5. [Provider/LLM 抽象层](#5-providerllm-抽象层)
6. [Tool 系统](#6-tool-系统)
7. [Memory/记忆系统](#7-memory记忆系统)
8. [Skills 系统](#8-skills-系统)
9. [Subagent/多智能体](#9-subagent多智能体)
10. [Config 配置系统](#10-config-配置系统)
11. [Channel/前端接入](#11-channel前端接入)
12. [CLI 实现](#12-cli-实现)
13. [WebUI 实现](#13-webui-实现)
14. [会话管理](#14-会话管理)
15. [错误处理与重试](#15-错误处理与重试)
16. [上下文管理/压缩](#16-上下文管理压缩)
17. [流式输出](#17-流式输出)
18. [插件/扩展机制](#18-插件扩展机制)
19. [安全模型](#19-安全模型)
20. [自主行动/自动化](#20-自主行动自动化)
21. [浏览器/系统控制能力](#21-浏览器系统控制能力)
22. [对 aptbot 设计的调整建议](#22-对-aptbot-设计的调整建议)

---

## 1. 项目定位与设计哲学

| 维度 | pi-agent | nanobot | GenericAgent |
|---|---|---|---|
| **一句话定位** | 极简编程 agent SDK | 完整多平台 IM 机器人 | 自演化个人助理 |
| **设计哲学** | 极简内核 + 类型安全 + 可组合 | 工程化全栈 + 多平台 + 生产就绪 | 不预加载 skills，演化它们 |
| **核心场景** | 编码辅助（coding agent） | IM 聊天机器人 + WebUI + 自动化 | 系统控制 + 浏览器 + 自动化 + 学习 |
| **目标用户** | 开发者（SDK 嵌入） | IM 用户 + 运维 | 个人用户（桌面自动化） |
| **技能来源** | 用户手写 + 内置 | 用户手写 + 内置 | **任务自动结晶** |
| **token 策略** | 中等（事件流 + compaction） | 高（200K-1M context window） | **极低（<30K）** |
| **自举性** | 无 | 无 | **自我引导（仓库自身由 GA 创建）** |

**分析**：

- **pi-agent** 走的是"SDK 内核"路线，把 agent loop 做成无状态生成器函数，上层 harness/session 可自由组合。哲学是"少即是多"，核心 ~150 行，但上层 coding-agent 包了 40+ Ink 组件换交互体验。
- **nanobot** 走的是"全栈工程化"路线，从 IM channel 到 WebUI 到 cron 到 audio 全覆盖。哲学是"生产就绪"，30+ 内置 provider、20+ IM channel，配置驱动。
- **GA** 走的是"自演化"路线，哲学最激进：**不给 agent 预置技能，让它在解决任务时自己积累 skill**。3K 行种子代码 + 9 原子工具起家，用得越多越聪明。同时强调**极低 token**（<30K vs 其他 200K-1M），通过 tag 截断 + 工作记忆 checkpoint 实现。

**核心张力**：预加载（pi/nanobot）vs 自演化（GA）；全栈工程（nanobot）vs 极简内核（pi/GA）；高 token 容忍（nanobot）vs 极低 token（GA）。

---

## 2. 语言与技术栈

| 维度 | pi-agent | nanobot | GenericAgent |
|---|---|---|---|
| **语言** | TypeScript | Python | Python |
| **运行时** | Node.js / Bun | Python 3.10+ | Python 3.8+ |
| **包管理** | pnpm workspace (monorepo) | hatch / pip | pip (单包) |
| **类型系统** | 强类型（TypeScript + TypeBox + Zod） | 弱类型（Pydantic 部分覆盖） | 无类型（dataclass 极少） |
| **异步模型** | async/await + AsyncGenerator | asyncio | threading + generator |
| **TUI 框架** | 自研 pi-tui（Ink-like React） | prompt_toolkit + Rich | Textual（tuiapp） |
| **WebUI 框架** | 无（纯 CLI） | React SPA + WebSocket | Streamlit + pywebview |
| **HTTP** | node-fetch / undici | aiohttp / httpx | requests / urllib |
| **测试** | vitest | pytest | 无测试框架 |
| **monorepo** | 是（agent / ai / coding-agent 三包） | 否（单包） | 否（扁平结构） |

**分析**：

- **pi-agent** 的类型安全是三家中最强的：TypeScript + TypeBox schema + Zod config 校验，几乎全链路类型安全。monorepo 分包清晰（ai 包管 provider，agent 包管 loop，coding-agent 包管 UI）。
- **nanobot** 用 Pydantic 做配置和工具参数校验，但运行时大量 dict 传递（messages、tool_results），类型覆盖不完整。
- **GA** 几乎无类型约束，大量 dict + 字符串操作，依赖运行时行为。但用 **threading + generator** 而非 asyncio，降低异步心智负担，前端通过 queue 通信解耦。

**对 aptbot 的启示**：aptbot 选 TypeScript 是对的（类型安全 + 与 pi-agent 同生态）。但 GA 的 threading+queue 模型提示：异步模型选型要考虑前端接入复杂度。

---

## 3. 代码规模与复杂度

| 维度 | pi-agent | nanobot | GenericAgent |
|---|---|---|---|
| **核心 agent loop** | ~150 行（agentLoop 生成器） | ~400 行（AgentRunner._run_core） | **~100 行（agent_runner_loop）** |
| **核心包代码** | agent 包 ~3K 行 | nanobot 包 ~4K 行（core_agent_lines） | **~3K 行（种子代码）** |
| **总代码（含 UI）** | coding-agent ~15K+ 行 | ~10K+ 行（含 20+ channel） | ~4K 行（含多前端） |
| **Ink/TUI 组件** | 40+ 组件 | 无（prompt_toolkit 内联） | Textual（tuiapp，组件数少） |
| **内置 provider** | 30+ | 30+ | 无（mykey 配置驱动） |
| **内置 channel** | 0（无 channel 概念） | 20+ | 6 前端（非 channel 抽象） |
| **依赖数量** | 中（monorepo 共享） | 多（IM SDK 全家桶） | **少（requests + 可选 PyQt5/Streamlit）** |

**分析**：

- **GA 的极简主义最突出**：agent loop ~100 行，用 Python generator + yield 实现流式，无事件类定义（yield 字符串/dict）。9 个原子工具覆盖全部能力（code_run 万能工具包揽 python+bash 执行）。
- **pi-agent 核心 ~150 行**但分层清晰（Layer 1 无状态 / Layer 2 AgentSession / Layer 3 AgentHarness），复杂度在上层 coding-agent 的 40+ Ink 组件。
- **nanobot 最重**：_run_core ~400 行单方法，包含 orphan 修复、backfill、microcompact、tool_result_budget、snip_history、injection drain 等多种恢复路径，错误处理内置到循环。

**对 aptbot 的启示**：aptbot AgentLoop 已定方案 A（pi-agent Layer 1+2），保持 ~150 行核心。GA 的 generator yield 模式比 pi-agent 的 EventStream 更轻，但 aptbot 已定 EventStream（类型安全更好），不调整。

---

## 4. AgentLoop 架构

| 维度 | pi-agent | nanobot | GenericAgent |
|---|---|---|---|
| **核心函数** | `agentLoop()` 生成器 | `AgentRunner._run_core()` | `agent_runner_loop()` 生成器 |
| **循环结构** | 双层 while（steering + follow-up） | 单层 for（max_iterations） | 单层 while（turn < max_turns） |
| **状态** | 无状态（Layer 1）/ 有状态（Layer 2） | 有状态（self 持有） | 有状态（GenericAgent 类） |
| **事件模型** | EventStream<AgentEvent>（union type） | hook 回调（AgentHook） | **generator yield（字符串/dict）** |
| **工具执行** | 批量并行 + executionMode | 批量顺序（concurrency_safe 标记） | 顺序执行（for tc in tool_calls） |
| **steering** | 支持（pushSteering，运行中注入） | 不支持（injection 机制不同） | 不支持（task_queue 串行） |
| **follow-up** | 支持（getFollowUpMessages） | 不支持 | 不支持 |
| **中途打断** | AbortSignal | stop_signal / code_stop_signal | stop_sig + code_stop_signal |
| **turn 间钩子** | prepareNextTurn / shouldStopAfterTurn | before_iteration / after_iteration | turn_end_callback |
| **工具结果回传** | 推入 context.messages | 推入 messages 列表 | **替换 messages（只传新消息）** |

**关键代码对比**：

```python
# GA 的 agent_runner_loop（极简，~100 行）
while turn < handler.max_turns:
    turn += 1
    response_gen = client.chat(messages=messages, tools=tools_schema)
    response = yield from response_gen  # 流式 yield 给前端
    tool_calls = [{'tool_name': tc.function.name, 'args': json.loads(tc.function.arguments), 'id': tc.id} for tc in response.tool_calls]
    for tc in tool_calls:
        outcome = yield from handler.dispatch(tool_name, args, response)  # yield 工具输出
        if outcome.should_exit: break
        if not outcome.next_prompt: break  # CURRENT_TASK_DONE
        next_prompts.add(outcome.next_prompt)
    next_prompt = handler.turn_end_callback(...)
    messages = [{"role": "user", "content": next_prompt, "tool_results": tool_results}]  # 只传新消息！
```

```typescript
// pi-agent 的 runLoop（双层 while，steering + follow-up）
while (true) {
  while (hasMoreToolCalls || pendingMessages.length > 0) {
    // steering 注入
    // streamAssistantResponse → emit events
    // executeToolCalls
    // prepareNextTurn / shouldStopAfterTurn
    pendingMessages = await config.getSteeringMessages?.() || [];
  }
  const followUpMessages = await config.getFollowUpMessages?.() || [];
  if (followUpMessages.length > 0) { pendingMessages = followUpMessages; continue; }
  break;
}
```

**分析**：

- **GA 最激进的设计**：每轮 `messages` 只传**新消息**（`[{"role":"user","content":next_prompt,"tool_results":tool_results}]`），完整历史由 `client.backend` 内部管理。这与 pi/nanobot 把全部 messages 推入 context 完全不同——GA 的历史管理下沉到 LLM client 层。
- **GA 的 StepOutcome 模式**：工具返回 `StepOutcome(data, next_prompt, should_exit)`，next_prompt 决定下一轮 user 消息内容。这是"工具驱动对话流"——每个工具可以注入下一轮 prompt，比 pi/nanobot 的"工具结果被动附加"更主动。
- **GA 无 steering/follow-up**：task_queue 串行处理，运行中不能注入。pi-agent 的 steering（运行中追发消息）是独有能力。
- **GA 的 turn_end_callback**：handler 可在每轮结束后改写 next_prompt，类似 pi-agent 的 prepareNextTurn 但更简单。

**对 aptbot 的启示**：aptbot 已定 pi-agent 方案 A（双层 while + steering + EventStream）。GA 的 StepOutcome（工具驱动 next_prompt）和"只传新消息"模式值得记录，但不调整 MVP 设计——EventStream 类型安全更适合 TS 项目。

---

## 5. Provider/LLM 抽象层

| 维度 | pi-agent | nanobot | GenericAgent |
|---|---|---|---|
| **抽象层级** | Api（协议）+ Provider（服务商）分离 | LLMProvider 基类 + Factory | **ToolClient + Session 双层** |
| **内置 provider** | 30+（openai/anthropic/google/bedrock/...） | 30+（同上 + 国内厂商） | 无内置（mykey 配置） |
| **协议支持** | openai-responses / anthropic-messages / openai-completions / google / bedrock / mistral | openai-compat / anthropic / azure / bedrock / codex / github-copilot | **Claude SSE / OpenAI SSE（手写解析）** |
| **模型发现** | 内置 models.generated.ts（脚本生成） | 内置 model_presets.py | 无（用户配 mykey） |
| **认证** | API key / OAuth PKCE / credential store | API key / env var | **mykey.py / mykey.json（文件）** |
| **多模型混用** | 单次调用指定 model | FallbackProvider 熔断 | **MixinSession（多 LLM 混合）** |
| **重试** | retry.ts（传输重试） | LLMProvider 内置（5xx/429 指数退避 + 429 分类） | 无（client 层处理） |
| **消息治理** | sanitize.ts（role alternation / empty / image strip） | _drop_orphan / _backfill / _microcompact / _snip_history | compress_history_tags / trim_messages_history |

**分析**：

- **pi-agent 的 Api-Provider 分离**最优雅：协议实现（openai-responses.ts）与服务商声明（openai.ts）解耦，新增 OpenAI-compatible provider 只需声明配置。
- **nanobot 的 LLMProvider 基类**最重：内置 429 分类（RETRYABLE vs NON_RETRYABLE 文本标记）、persistent 重试心跳、context governance 链（6 步消息修复）。
- **GA 最简也最独特**：
  - **mykey.py 配置驱动**：用户写一个 Python 文件声明所有 API key + base_url + model，`reload_mykeys()` 支持热重载（mtime 检测）。
  - **MixinSession**：多个 LLM session 混合，可按 `llm_no` 切换，切换时迁移 history。这是"多模型混用"的轻量实现。
  - **手写 SSE 解析**：`_parse_claude_sse` / OpenAI SSE 解析直接写在 llmcore.py，无 SDK 依赖。
  - **无 provider 抽象**：直接 ToolClient(NativeClaudeSession) / NativeOAISession，不抽象"provider"概念。

**对 aptbot 的启示**：aptbot 已定 Api-Provider 分离（§5.6）。GA 的 **MixinSession 多模型混用**值得记录为后续待办——允许用户配置多个 provider，运行时 `/llm` 切换。GA 的 **mykey 热重载**（mtime 检测）也可参考用于 config 热重载。

---

## 6. Tool 系统

| 维度 | pi-agent | nanobot | GenericAgent |
|---|---|---|---|
| **工具数量** | 10+（bash/read/write/edit/grep/find/ls/...） | 20+（apply_patch/shell/search/web/mcp/cron/image_gen/...） | **9 原子工具** |
| **工具定义** | AgentTool 接口 + TypeBox schema | Tool 抽象类 + JSON Schema | **tools_schema.json（静态 JSON）** |
| **返回类型** | AgentToolResult<T>（content + details + terminate） | Any（字符串或 content blocks） | **StepOutcome（data + next_prompt + should_exit）** |
| **执行模式** | per-tool executionMode（parallel/sequential） | concurrency_safe + exclusive 标记 | 顺序（for 循环） |
| **参数校验** | prepareArguments + TypeBox | cast_params + validate_params（JSON Schema） | **json.loads（无校验）** |
| **万能工具** | 无 | 无 | **code_run（python + bash）** |
| **工具→对话流** | 无（结果被动附加） | 无（结果被动附加） | **next_prompt 驱动下一轮** |
| **MCP 支持** | 无（coding-agent 层） | 有（mcp.py + loader.py） | 无 |
| **虚拟工具** | 无 | 有（virtual tools） | 无 |

**GA 的 9 个原子工具**：

| 工具 | 说明 | GA 独特性 |
|---|---|---|
| `code_run` | 执行 python/bash 代码 | **万能工具**：python 可调任何库，bash 系统操作。替代 read/grep/find/ls 等 |
| `file_read` | 读文件 | 标准 |
| `file_patch` | patch 文件 | 类似 pi-agent edit |
| `file_write` | 写文件 | 标准 |
| `web_scan` | 扫描浏览器页面（TMWebDriver） | **真实浏览器注入**，保留登录态 |
| `web_execute_js` | 执行 JS | 浏览器内执行 |
| `update_working_checkpoint` | 更新工作记忆 | **LLM 主动管理记忆**，独有 |
| `ask_user` | 向用户提问 | 标准交互 |
| `start_long_term_update` | 启动长期记忆更新 | **LLM 触发记忆固化**，独有 |

**分析**：

- **GA 的 code_run 万能工具最激进**：用 python + bash 两个执行器替代 read/grep/find/ls/web 等专用工具。LLM 直接写 python 代码读文件/搜索/处理数据，灵活度最高但 token 消耗大（要写代码）。pi/nanobot 选择专用工具（每个工具 schema 简短，LLM 调用成本低）。
- **GA 的 StepOutcome 是最大创新**：工具返回 `next_prompt`，直接决定下一轮给 LLM 的 user 消息内容。这让工具能"引导"对话流（如 `update_working_checkpoint` 返回 next_prompt="继续任务"），而 pi/nanobot 的工具结果只是被动附加到 context。
- **GA 的 update_working_checkpoint / start_long_term_update**：把记忆管理暴露为工具，LLM 主动决定何时保存关键信息、何时固化长期记忆。这是"工具即记忆接口"模式，pi/nanobot 的记忆是被动的（compaction 自动触发）。

**对 aptbot 的启示**：
1. aptbot 已定 4 工具（read_file/write_file/exec/search），不采用 GA 的 code_run 万能工具（专用工具 token 更省、更安全）。
2. **StepOutcome 的 next_prompt 模式**值得记录——aptbot 当前工具结果是被动附加，未来可考虑让工具返回"建议下一轮 prompt"。
3. **update_working_checkpoint 工具**值得记录为后续待办——让 LLM 主动管理"当前任务关键信息"，作为 Compaction 的补充。

---

## 7. Memory/记忆系统

| 维度 | pi-agent | nanobot | GenericAgent |
|---|---|---|---|
| **短期记忆** | Session JSONL（messages 列表） | Session（messages 列表） | **client.backend.history** |
| **压缩策略** | Compaction（摘要 + 保留近期） | Consolidator（摘要 + consolidation_ratio） | **compress_history_tags（tag 正则截断）+ trim_messages_history（裁剪）** |
| **触发时机** | token 阈值兜底 | consolidation_ratio 阈值 | **每 5 轮自动 + 超阈值强制** |
| **长期记忆** | branch-summarization | MEMORY.md / USER.md / SOUL.md + GitStore | **global_mem.txt（L2）+ global_mem_insight（L1 索引）+ SOP（L3）** |
| **记忆层级** | 2 层（session + branch summary） | 2 层（session + 跨会话文件） | **3 层（L1 索引 / L2 全量 / L3 SOP）** |
| **LLM 主动管理** | 无（compaction 自动） | 无（consolidator 自动） | **有（update_working_checkpoint 工具）** |
| **工作记忆** | 无（全在 context） | 无 | **working dict（key_info / task / sop / passed_sessions）** |
| **存储格式** | JSONL | JSON + Markdown 文件 | **txt 文件（纯文本）** |
| **版本管理** | 无 | GitStore（git commit） | 无 |

**GA 的 3 层记忆**：

```
L1: global_mem_insight.txt    # 索引层：所有 skill/memory 的一句话摘要，每轮注入 system prompt
L2: global_mem.txt            # 全量层：完整 memory 内容，LLM 按需 file_read 读取
L3: SOP（plan_sop.md 等）     # 执行层：具体操作步骤，LLM 按需读取
+  working dict               # 工作记忆：当前任务的 key_info / task / sop，每轮注入
```

**GA 的 compress_history_tags**：

```python
def compress_history_tags(messages, keep_recent=10, max_len=800, interval=5):
    # 每 5 轮执行一次
    # 对 keep_recent 之前的消息：
    #   - <thinking>...</thinking> → 截断到 max_len
    #   - <tool_use>...</tool_use> → 截断
    #   - <tool_result>...</tool_result> → 截断
    #   - <history>...</history> → 替换为 [...]
    #   - <key_info>...</key_info> → 替换为 [...]
```

**分析**：

- **GA 的 3 层记忆最精细**：L1 索引（注入 prompt）→ L2 全量（按需读取）→ L3 SOP（按需读取），类似"目录→正文→操作手册"。pi/nanobot 只有 session + 摘要两层。
- **GA 的 working dict（工作记忆）独有**：`handler.working['key_info']` 存当前任务关键信息，每轮注入 system prompt。跨 session 传递（`passed_sessions` 计数）。这是"主动工作记忆"，pi/nanobot 没有。
- **GA 的 compress_history_tags 是轻量兜底**：不调 LLM 生成摘要（省 token），直接正则截断老消息的 tag 内容。比 pi/nanobot 的 compaction（调 LLM 摘要）轻量得多，但信息损失更大。
- **GA 的 LLM 主动记忆管理**：`update_working_checkpoint` 工具让 LLM 决定存什么到 working dict，`start_long_term_update` 触发固化到 global_mem。这是"LLM 自治记忆"，pi/nanobot 是"系统自动记忆"。

**对 aptbot 的启示**：
1. **L1/L2/L3 三层记忆**值得参考——aptbot 当前是 session + compaction 两层，后续长期记忆可参考 GA 的"索引→全量→SOP"分层。
2. **working dict（工作记忆）**值得记录为后续待办——让 LLM 主动管理"当前任务关键信息"，每轮注入，跨 session 传递。作为 Compaction 的补充。
3. **compress_history_tags 轻量兜底**值得参考——在 Compaction（调 LLM 摘要）之前，先做 tag 正则截断（零 token 成本）作为第一道防线。

---

## 8. Skills 系统

| 维度 | pi-agent | nanobot | GenericAgent |
|---|---|---|---|
| **skill 来源** | 用户手写 + 内置 | 用户手写 + 内置 | **任务自动结晶** |
| **格式** | SKILL.md（YAML frontmatter + markdown） | SKILL.md（同上） | **SOP markdown 文件** |
| **加载** | loadSkills（ExecutionEnv 抽象） | SkillsLoader（workspace + builtin） | **L1 insight 索引匹配** |
| **注入方式** | 全量 description 注入 system prompt | 摘要注入 + 按需 load_skill 读取 | **L1 索引注入 + LLM 按需 file_read L2/L3** |
| **frontmatter** | name + description（最小） | name + description + requires | 无（文件名即名称） |
| **自演化** | 无 | 无 | **有（任务完成自动生成 skill）** |
| **skill 创建** | 手动创建 | skill-creator 工具辅助 | **自动结晶** |
| **依赖检查** | 无 | requires.bins / requires.env | 无 |

**GA 的自演化机制**：

```
任务执行 → 成功完成 → 自动提取执行路径 → 结晶为 SOP 文件 → 更新 L1 insight 索引
                                                    ↓
                                          下次类似任务 → L1 匹配 SOP → 按需读取 L3 执行
```

**分析**：

- **GA 的自演化是最独特的设计**：不预加载 skills，每次任务成功后自动结晶为 SOP。L1 insight 是"技能目录"（一句话摘要），LLM 每轮看到 L1，匹配到就 file_read L3 执行。"用得越多越聪明"。
- **pi/nanobot 是预加载模式**：用户手动写 SKILL.md，系统加载后注入 description。LLM 看到技能列表，需要时调用。
- **GA 的 L1 索引匹配**比 pi/nanobot 的"全量 description 注入"更省 token：L1 只有一句话摘要，LLM 匹配后才读完整 SOP。pi/nanobot 把所有 skill 的 description 都注入 system prompt，skill 多了会占 token。

**对 aptbot 的启示**：
1. aptbot 已定两层加载（workspace + builtin）+ 全量 description 注入。**GA 的 L1 索引匹配模式**值得记录为后续优化——skill 数量多时，改用"索引注入 + 按需读取"省 token。
2. **自演化 skill**值得记录为 L3 待办——让 aptbot 在任务成功后自动结晶为 skill。这与 aptbot 的"学习助手"定位高度契合。

---

## 9. Subagent/多智能体

| 维度 | pi-agent | nanobot | GenericAgent |
|---|---|---|---|
| **subagent** | AgentHarness（L3 持久化 + phase 状态机） | subagent.py | **--func / --task 双模式** |
| **通信方式** | 进程内（EventStream） | 进程内（hook） | **文件系统（output.txt / reply.txt / _stop / _keyinfo / _intervene）** |
| **并行** | 无（单 agent） | 无 | **Map 模式（N 个 --func 并行）** |
| **上下文隔离** | 独立 session | 独立 context | **独立进程 + 文件共享** |
| **监控/干预** | 无 | 无 | **监察模式（--verbose）+ 干预文件** |
| **plan mode** | 无 | 无 | **探索态→规划态→执行态（SOP 驱动）** |

**GA 的 subagent 双模式**：

```
--func 模式（纯函数，并行 map）：
  python agentmain.py --func prompt.txt
  → 读 prompt → 执行 → 结果写 prompt.out.txt → 退出
  → 适合：单次任务、并行 map、不需追问

--task 模式（持续协作）：
  python agentmain.py --task {name} --input "短文本"
  → 后台启动，多轮协作
  → 通信：output.txt（[ROUND END]=轮完成）→ 写 reply.txt 继续 → 不写 10min 退出
  → 干预文件：_stop（当轮结束停止）| _keyinfo（注入 working memory）| _intervene（追加指令）
  → 可选 fork：写 _history.json 继承对话上下文
```

**GA 的 Plan Mode SOP**：

```
3步以上任务触发：
  探索态（主 agent 不直接探测，委托 subagent 只读探测，保护上下文）
    → exploration_findings.md
  规划态（基于探索结论写 plan.md）
    → 审查门（检查计划可行性）
  执行态（按 plan.md 执行，可委托 subagent 并行子任务）
    → checkpoint 恢复
```

**分析**：

- **GA 的文件系统通信最独特**：subagent 是独立进程，通过文件系统通信（output.txt/reply.txt/_stop/_keyinfo/_intervene）。优点是天然隔离 + 可并行 + 可干预；缺点是通信延迟 + 文件管理复杂。
- **GA 的监察模式**：主 agent 启动 subagent 时加 `--verbose`，可读 output.txt 观察进度，必要时写干预文件纠偏。这是"人在环路"的 agent 版本。
- **GA 的 Plan Mode**：主 agent 不直接探测环境（保护上下文），委托 subagent 只读探测。这是"上下文保护"意识——探测输出会挤占主 agent 的规划空间。

**对 aptbot 的启示**：
1. aptbot L3 待办已有 subagent。**GA 的 --func/--task 双模式 + 文件通信**值得记录为参考——轻量、隔离、可并行、可干预。
2. **Plan Mode SOP**值得记录为后续待办——探索态→规划态→执行态，主 agent 不直接探测。这与 aptbot 的"工作助手"定位契合（复杂任务规划）。
3. **监察模式 + 干预文件**值得记录——让用户/主 agent 能观察和干预 subagent 执行。

---

## 10. Config 配置系统

| 维度 | pi-agent | nanobot | GenericAgent |
|---|---|---|---|
| **格式** | JSON（两层：global + project） | YAML / JSON | **Python 文件（mykey.py）+ JSON** |
| **schema 校验** | Zod | Pydantic | 无 |
| **配置层级** | 两层（~/.pi/config + {cwd}/.pi/config） | 单层（~/.nanobot/config.yaml） | 单层（mykey.py） |
| **环境变量** | 支持（APTBOT_ 前缀风格） | 支持（env interp） | **mykey.py 直接写 Python** |
| **热重载** | 无 | 无 | **有（mtime 检测 reload_mykeys）** |
| **配置迁移** | migrations.ts | migrateConfig | 无 |
| **文件锁** | 有（多进程安全） | 无 | 无 |
| **project trust** | 有（未信任不加载 project config） | 无 | 无 |

**GA 的 mykey.py 模式**：

```python
# mykey.py（用户手写）
claude_api = {"api_key": "sk-...", "base_url": "https://api.anthropic.com", "model": "claude-sonnet-4-5"}
openai_config = {"api_key": "sk-...", "base_url": "https://api.openai.com/v1", "model": "gpt-4o"}
mixin_cfg = [{"session_idx": 0, "weight": 0.7}, {"session_idx": 1, "weight": 0.3}]  # 多模型混合
```

```python
# llmcore.py 热重载
def reload_mykeys():
    mt = os.stat(_mykey_path).st_mtime_ns
    if mt == _mykey_mtime: return mykeys, False  # 未变更
    mk = _load_mykeys(); _mykey_mtime = os.stat(_mykey_path).st_mtime_ns
    return mk, True  # 已变更
```

**分析**：

- **GA 用 Python 文件做配置**最灵活（可直接写 Python 逻辑，如 mixin_cfg），但最不安全（任意代码执行）+ 无校验。
- **GA 的热重载**最实用：mtime 检测，每次 `load_llm_sessions()` 时检查，变更则重新加载。pi/nanobot 都需重启。
- **pi-agent 的两层配置 + project trust + 文件锁**最工程化。

**对 aptbot 的启示**：aptbot 已定 JSON + Zod + 单层。**GA 的 mtime 热重载**值得记录为后续待办——aptbot 当前 config 静态加载，可加 mtime 检测实现热重载（用户改 config 不需重启）。

---

## 11. Channel/前端接入

| 维度 | pi-agent | nanobot | GenericAgent |
|---|---|---|---|
| **抽象** | Mode（Interactive/Print/Rpc） | Channel + MessageBus | **无抽象（每前端直连 agent）** |
| **IM channel** | 0 | 20+（telegram/discord/slack/feishu/qq/...） | 4（dcapp/tgapp/qqapp/fsapp） |
| **WebUI** | 无 | React SPA + WebSocket | **Streamlit + pywebview** |
| **CLI** | Ink + pi-tui | Typer + prompt_toolkit + Rich | **argparse + print（最简）** |
| **桌面 GUI** | 无 | 无 | **PyQt5（qtapp）+ pywebview（launch）** |
| **多端同步** | 无 | 有（多连接订阅同 chat_id） | 无（每前端独立 agent 实例） |
| **消息总线** | 无（进程内 EventBus） | MessageBus（双向队列） | **task_queue + display_queue（双队列）** |

**GA 的前端接入**：

```
frontends/
├── qtapp.py        # PyQt5 桌面 GUI（气泡代码高亮、文件拖拽、历史搜索）
├── stapp.py        # Streamlit Web（pywebview 可包装为桌面壳）
├── tuiapp.py       # Textual 终端 TUI
├── tuiapp_v2.py    # Textual v2
├── dcapp.py        # Discord
├── tgapp.py        # Telegram
├── qqapp.py        # QQ
└── fsapp.py        # 飞书

通信模型：
  前端 → agent.put_task(query) → task_queue
  agent.run() 消费 task_queue → 执行 → display_queue.put(chunks)
  前端轮询 display_queue → 渲染
```

**分析**：

- **GA 无 channel 抽象**：每个前端直接 `import GenericAgent`，通过 `put_task` / `display_queue` 双队列通信。最简但不可复用（每前端独立 agent 实例，不共享 session）。
- **nanobot 的 Channel + MessageBus**最完整：标准化 InboundMessage/OutboundMessage + 双向队列 + 多路复用 + 能力过滤。
- **pi-agent 的 Mode**最克制：3 种 mode 覆盖 CLI/脚本/嵌入场景，无 IM。
- **GA 的双队列（task_queue + display_queue）**是轻量版的 MessageBus：入站 task_queue，出站 display_queue，每 task 一个 display_queue（per-task 输出流）。

**对 aptbot 的启示**：aptbot 已定方案 E（类型化 bus）。GA 的双队列模式提示：MVP 阶段若 bus 太重，可先用 task_queue + display_queue 双队列过渡，后续再演化为 bus。

---

## 12. CLI 实现

| 维度 | pi-agent | nanobot | GenericAgent |
|---|---|---|---|
| **TUI 引擎** | 自研 pi-tui（Ink-like React） | prompt_toolkit + Rich | **argparse + print（最简）/ Textual（tuiapp）** |
| **组件数** | 40+ Ink 组件 | 无（内联渲染） | Textual 少量组件 |
| **流式渲染** | streamingComponent.updateContent | Rich Live in-place | **print chunk（最简）** |
| **斜杠命令** | 18 内置 + 扩展 + skill | 字符串解析 | **/session.xxx=yyy + /resume** |
| **Overlay 选择器** | 有（model/session/settings/...） | 无 | 无 |
| **steering 注入** | 有（editor Enter → pushSteering） | 无 | 无 |
| **认证 UI** | LoginDialog + OAuth PKCE | 无 | 无 |
| **会话管理 UI** | SessionSelector Overlay | --session 参数 | /resume 命令 |

**分析**：

- **pi-agent CLI 最丰富**：40+ Ink 组件 + Overlay 选择器 + steering 注入 + OAuth UI。但绑定单一终端场景。
- **nanobot CLI 中等**：prompt_toolkit + Rich StreamRenderer，走 bus 通路，无 Overlay。
- **GA CLI 最简**：默认 `python agentmain.py` 就是 `input() + print()`，tuiapp 用 Textual 提供增强体验。斜杠命令只有 `/session.xxx=yyy`（动态设置 session 属性）和 `/resume`（恢复会话）。

**对 aptbot 的启示**：aptbot 已定 Ink + 5 内置命令。GA 的 `/session.xxx=yyy` 动态属性设置模式值得记录——允许用户运行时调整 session 参数（如 context_window、temperature），无需改 config。

---

## 13. WebUI 实现

| 维度 | pi-agent | nanobot | GenericAgent |
|---|---|---|---|
| **有无** | 无 | 有（React SPA） | **有（Streamlit）** |
| **框架** | — | React + WebSocket | **Streamlit（Python Web）** |
| **通信** | — | WebSocket + HTTP API | **Streamlit session_state + cache_resource** |
| **多端同步** | — | 有（多连接订阅同 chat_id） | 无（单 agent 实例） |
| **桌面壳** | — | 无 | **pywebview（launch.pyw）** |
| **侧边栏/会话列表** | — | 有 | Streamlit sidebar |
| **文件预览** | — | 有（/api/sessions/{id}/file-preview） | 无 |
| **fork 树** | — | 有（webui-thread） | 无 |

**分析**：

- **nanobot WebUI 最完整**：React SPA + WebSocket + HTTP API + 多端同步 + 会话管理 + fork 树 + 文件预览。
- **GA WebUI 最简**：Streamlit（Python 全栈 Web），`@st.cache_resource` 单例 agent，`session_state` 管理对话。无需写前端代码，但定制性差。
- **GA 的 pywebview 桌面壳**：`launch.pyw` 用 pywebview 把 Streamlit 包装成原生窗口。轻量替代 Electron。

**对 aptbot 的启示**：aptbot 已定 Lit + WC + WebSocket。GA 的 Streamlit 模式不适合 aptbot（TS 项目），但 **pywebview 桌面壳思路**值得记录——MVP 阶段可用 webview 把 WebUI 包装成桌面应用，无需 Electron。

---

## 14. 会话管理

| 维度 | pi-agent | nanobot | GenericAgent |
|---|---|---|---|
| **存储** | JSONL（jsonl-repo.ts） | SessionManager + 文件 | **model_responses/{logid}.txt（日志式）** |
| **会话恢复** | session.load(id) | session manager | **/resume 命令（扫描日志找 history 块）** |
| **fork/分支** | 有（/fork /tree /clone） | 有（webui-thread） | 无 |
| **会话搜索** | SessionSelector 模糊搜索 | 会话列表 | 无 |
| **会话标题** | 自动生成 | 有 | 无 |
| **跨 session 记忆** | branch summary | MEMORY.md/USER.md/SOUL.md | **global_mem.txt + insight（L1/L2）** |
| **session TTL** | 无 | session_ttl_minutes | 无 |

**GA 的会话管理最原始**：

```python
# 会话日志：temp/model_responses/model_responses_{logid}.txt
# 每次启动生成新 logid，记录所有 LLM 响应
# /resume 命令：扫描日志目录，找最近 10 个文件的 <history>...</history> 块，总结后让用户选
```

**分析**：

- **GA 的会话管理最简陋**：无结构化存储，靠日志文件 + /resume 命令恢复。但 GA 的跨 session 记忆（global_mem L1/L2）弥补了会话管理的不足——重要信息已固化到 global_mem，新 session 仍可访问。
- **pi/nanobot 会话管理完整**：JSONL 存储 + fork + 搜索 + 标题。

**对 aptbot 的启示**：aptbot 已定 JSONL + SessionRepo。GA 的"跨 session 记忆弥补会话管理"思路值得参考——即使会话管理简单，只要长期记忆到位，用户体验仍可接受。

---

## 15. 错误处理与重试

| 维度 | pi-agent | nanobot | GenericAgent |
|---|---|---|---|
| **传输重试** | retry.ts（5xx/429 指数退避） | LLMProvider 内置（3 次指数退避 + 429 分类） | 无 |
| **业务重试** | AgentSession 层 | 无 | 无 |
| **语义重试** | agentLoop（错误回 LLM） | empty_content_retries + length_recovery | 无 |
| **429 分类** | 无 | RETRYABLE vs NON_RETRYABLE（文本标记） | 无 |
| **错误持久化** | 不持久化错误响应 | 不持久化 | 记录到日志 |
| **兜底** | FallbackProvider（待办） | FallbackProvider + 熔断器 | **MixinSession 切换 llm_no** |

**分析**：

- **nanobot 错误处理最完善**：传输重试（3 次指数退避 + 429 文本分类）+ 语义重试（empty_content_retries + length_recovery）+ FallbackProvider 熔断。
- **pi-agent 分层重试**：传输（retry.ts）+ 业务（AgentSession）+ 语义（agentLoop）三层分离。
- **GA 几乎无错误处理**：靠 MixinSession 切换 llm_no 作为兜底（一个 LLM 挂了切另一个）。最简但最脆弱。

**对 aptbot 的启示**：aptbot 已定外置分层重试（§4）。GA 的 **MixinSession 切换兜底**值得记录——多个 provider 配置后，一个挂了可手动/自动切换，作为 FallbackProvider 的轻量替代。

---

## 16. 上下文管理/压缩

| 维度 | pi-agent | nanobot | GenericAgent |
|---|---|---|---|
| **策略** | Compaction（LLM 摘要） | Consolidator（LLM 摘要） + context governance 链 | **tag 正则截断 + 裁剪（零 LLM 调用）** |
| **触发** | token 阈值 | consolidation_ratio 阈值 | **每 5 轮自动 + 超阈值强制** |
| **token 成本** | 高（调 LLM 摘要） | 高（调 LLM 摘要） | **零（纯正则）** |
| **信息损失** | 低（摘要保留语义） | 低 | **高（截断丢细节）** |
| **context governance** | sanitize.ts（role alternation） | 6 步链（drop_orphan/backfill/microcompact/budget/snip/backfill） | **compress_history_tags + trim_messages_history** |
| **目标 context** | 中等（~128K） | 高（200K-1M） | **极低（<30K）** |

**GA 的压缩策略**：

```python
# 1. compress_history_tags：每 5 轮，截断老消息的 <thinking>/<tool_use>/<tool_result> 到 max_len
# 2. trim_messages_history：超阈值时，先 force compress，再从头删除消息直到达标
#    - 删除时确保首条是 user 消息（_sanitize_leading_user_msg 把 tool_result 改写为纯文本）
# 3. 每 10 轮重置 client.last_tools（重新发送工具描述）
```

**分析**：

- **GA 的零成本压缩最激进**：纯正则截断，不调 LLM，token 成本为零。但信息损失大（老消息的 tool_use/tool_result 被截断到 800 字符）。
- **GA 的 <30K context**是三家最低：通过 tag 截断 + 裁剪 + working memory（关键信息存 handler.working，不依赖 history）三重保障。
- **nanobot 的 context governance 链最完善**：6 步修复（orphan tool result 修复、missing backfill、microcompact、budget 限制、snip history、二次修复）。
- **pi-agent 的 Compaction 最平衡**：LLM 摘要保留语义 + 保留近期消息。

**对 aptbot 的启示**：
1. aptbot 已定 Compaction（LLM 摘要）。**GA 的 tag 正则截断**值得作为**第一道防线**——在 Compaction 之前先做轻量截断（零 token 成本），截断后仍超阈值才触发 Compaction。两层压缩：tag 截断（轻）→ Compaction（重）。
2. **GA 的 working memory**与压缩互补：关键信息存 working dict，不依赖 history，即使 history 被截断也不丢任务关键信息。aptbot 可参考。

---

## 17. 流式输出

| 维度 | pi-agent | nanobot | GenericAgent |
|---|---|---|---|
| **模型** | EventStream<AgentEvent>（union type） | hook.emit + StreamRenderer | **generator yield（字符串/dict）** |
| **事件粒度** | 细粒度（message_start/update/end, tool_call/result, turn_start/end, reasoning_delta） | 细粒度（stream_chunk, reasoning, tool_event） | **粗粒度（yield 字符串 chunk + dict {turn}）** |
| **类型安全** | 强（union type） | 弱（dict + metadata 标记） | 无（字符串） |
| **工具输出流式** | 支持（onUpdate 回调，预留） | 支持（yield from） | **支持（yield from generator）** |
| **前端消费** | subscribeToAgent → handleEvent → switch | bus.consume_outbound → StreamRenderer | **display_queue.put(chunks) → 前端轮询** |

**分析**：

- **GA 的 generator yield 最轻量**：agent_runner_loop 是 generator，`yield` 字符串给前端，`yield from` 委托子 generator（LLM 流式、工具输出）。无事件类定义，无 EventStream 抽象。前端通过 display_queue 接收字符串 chunks。
- **pi-agent 的 EventStream 最类型安全**：union type 事件，switch 分发，每个事件类型明确。
- **nanobot 介于两者之间**：hook.emit 回调 + metadata 标记。

**对 aptbot 的启示**：aptbot 已定 EventStream（类型安全）。GA 的 generator yield 模式更轻但不适合 TS（丢失类型安全）。不调整。

---

## 18. 插件/扩展机制

| 维度 | pi-agent | nanobot | GenericAgent |
|---|---|---|---|
| **插件系统** | extensions（loader + runner + wrapper） | pkgutil 自动发现 + entry_points | **plugins/hooks.py（hook trigger）** |
| **hook 类型** | 无（extensions 是独立进程） | before_iteration / after_iteration / before_execute_tools / ... | **tool_before / tool_after / turn_before / turn_after / llm_before / llm_after / agent_before / agent_after** |
| **MCP 支持** | coding-agent 层 | 有（mcp.py + loader.py） | 无 |
| **工具扩展** | AgentTool 接口实现 | Tool 子类 + register | **do_{tool_name} 方法（handler 子类）** |
| **skill 扩展** | SKILL.md 文件 | SKILL.md 文件 | **SOP 文件（自演化）** |

**GA 的 hooks 插件**：

```python
# plugins/hooks.py
def trigger(hook_name, locals_dict):
    # 遍历已注册插件，调用对应 hook
    # hook_name: tool_before / tool_after / turn_before / turn_after / llm_before / llm_after / agent_before / agent_after
    pass

# agent_loop.py 中调用：
_hook('tool_before', locals())  # 工具执行前
_hook('llm_before', locals())  # LLM 调用前
_hook('turn_before', locals())  # 轮次开始前
```

**分析**：

- **GA 的 hooks 最轻量**：8 个 hook 点，`trigger(name, locals())` 传递局部变量。插件可读取/修改 locals。最简但无类型安全。
- **nanobot 的 hook 最完善**：AgentHook 类 + 多个生命周期方法 + context 传递。
- **pi-agent 的 extensions 是进程级**：独立进程扩展，不是 hook。

**对 aptbot 的启示**：aptbot 当前无插件系统设计。**GA 的 hook 点**值得记录为后续待办——tool_before/tool_after/turn_before/turn_after 等 hook 点可用于日志/监控/审计。MVP 不做，记录为 L2 待办。

---

## 19. 安全模型

| 维度 | pi-agent | nanobot | GenericAgent |
|---|---|---|---|
| **project trust** | 有（未信任不加载 project config） | 无 | 无 |
| **workspace 限制** | 有（trust manager） | 有（workspace_access + workspace_policy） | **无（全系统访问）** |
| **沙箱** | 有（restore-sandbox-env） | 有（sandbox.py） | 无 |
| **权限模型** | project trust | allow_from 白名单 + pairing | 无 |
| **网络限制** | 无 | network.py | 无 |
| **命令审查** | output-guard.ts | 无 | 无 |

**分析**：

- **GA 无安全模型**：code_run 工具直接执行任意 python/bash，TMWebDriver 注入真实浏览器，全系统访问。最强大但最危险。
- **pi/nanobot 有安全模型**：project trust / workspace 限制 / sandbox。

**对 aptbot 的启示**：aptbot MVP 无安全模型（本地 CLI/WebUI）。后续若加 IM 接入或多人使用，需引入 workspace 限制 + 权限模型。记录为 L2 待办。

---

## 20. 自主行动/自动化

| 维度 | pi-agent | nanobot | GenericAgent |
|---|---|---|---|
| **cron/定时** | 无 | 有（cron service + session_delivery + session_turns） | **有（reflect 模式 + 空闲触发）** |
| **空闲自主** | 无 | 无 | **有（用户离开 30 分钟自动触发 SOP）** |
| **自主行动 SOP** | 无 | 无 | **有（automation SOP）** |
| **心跳** | 无 | 有（heartbeat service） | 无 |
| **Dream 记忆整合** | 无 | 有（dream service） | 无 |

**GA 的自主行动**：

```
stapp.py（Streamlit WebUI）：
  autonomous_enabled = st.session_state.get('autonomous_enabled')
  if 用户离开 30 分钟 + autonomous_enabled:
    agent.put_task('[AUTO] 用户已离开 30 分钟，作为自主智能体，读自动化 SOP，执行自动任务')
```

**分析**：

- **GA 的空闲自主行动最独特**：用户离开 30 分钟后自动触发 SOP 执行任务（如整理文件、检查邮件、学习新知识）。这是"agent 主动工作"而非"被动响应"。
- **nanobot 的 cron/heartbeat/dream**是系统级自动化：定时触发、心跳保活、记忆整合。
- **pi-agent 无自动化**。

**对 aptbot 的启示**：aptbot 当前无自动化设计。**GA 的空闲自主行动**值得记录为 L3 待办——与 aptbot 的"学习助手"定位契合（空闲时自动整理笔记、复习知识）。但这需要安全边界（不能让 agent 随意操作系统）。

---

## 21. 浏览器/系统控制能力

| 维度 | pi-agent | nanobot | GenericAgent |
|---|---|---|---|
| **浏览器** | 无（bash 工具间接） | web.py 工具（HTTP 请求） | **TMWebDriver（CDP 注入真实浏览器）** |
| **浏览器登录态** | 无 | 无 | **有（注入已登录浏览器，过 hCaptcha）** |
| **JS 执行** | 无 | 无 | **有（web_execute_js）** |
| **键鼠控制** | 无 | 无 | **有（pyautogui 集成）** |
| **屏幕视觉** | 无 | 无 | **有（截图 + 视觉理解）** |
| **移动设备** | 无 | 无 | **有（ADB 控制 Android）** |
| **文件系统** | 有（read/write/edit） | 有（filesystem.py） | 有（file_read/write/patch） |
| **代码执行** | bash 工具 | shell.py | **code_run（python + bash）** |

**分析**：

- **GA 的系统控制能力远超 pi/nanobot**：TMWebDriver 注入真实浏览器（保留登录态、过验证码）、键鼠控制、屏幕视觉、ADB 控制 Android。这是"系统级 agent"能力。
- **pi/nanobot 是文件系统级 agent**：只操作文件 + 执行命令，不控制 GUI/浏览器。

**对 aptbot 的启示**：aptbot MVP 是文件系统级 agent（read/write/exec/search）。**GA 的浏览器/系统控制能力**记录为 L3 待办——若 aptbot 未来扩展为"桌面助手"，可参考 GA 的 TMWebDriver + 键鼠 + 屏幕视觉能力。但需安全边界。

---

## 22. 对 aptbot 设计的调整建议

基于三方对比，以下是对 aptbot 当前设计方案的调整建议。按优先级分级：

### 22.1 建议纳入 MVP（低成本高收益）

| 建议 | 来源 | 理由 | 影响 |
|---|---|---|---|
| **tag 正则截断作为 Compaction 前置** | GA compress_history_tags | 零 token 成本的第一道压缩防线，在 Compaction 前先截断老消息的 tool_use/tool_result | §7 Memory 增加一层轻量压缩 |

### 22.2 建议纳入 L2（中等成本，与定位契合）

| 建议 | 来源 | 理由 | 影响 |
|---|---|---|---|
| **working memory（工作记忆）** | GA working dict | LLM 主动管理当前任务关键信息，每轮注入，跨 session 传递。与"工作助手"定位契合 | §7 Memory 增加 working memory 层 |
| **MixinSession 多 provider 切换** | GA MixinSession | 配置多 provider，运行时 `/llm` 切换，一个挂了切另一个 | §5 Provider 增加运行时切换 |
| **config mtime 热重载** | GA reload_mykeys | 改 config 不需重启 | §9 Config 增加热重载 |
| **hook 点（tool_before/after, turn_before/after）** | GA hooks | 日志/监控/审计扩展点 | 新增 §12 Hooks 模块 |
| **`/session.xxx=yyy` 动态属性** | GA slash cmd | 运行时调整 session 参数（temperature/context_window） | §11.6 CLI 命令扩展 |
| **L1 索引 + 按需读取 skill** | GA L1/L2/L3 | skill 数量多时省 token | §8 Skills 优化 |

### 22.3 建议纳入 L3（高成本，远期目标）

| 建议 | 来源 | 理由 | 影响 |
|---|---|---|---|
| **自演化 skill** | GA 自演化 | 任务成功后自动结晶为 skill，与"学习助手"定位高度契合 | §8 Skills 增加自演化 |
| **subagent 文件通信** | GA --func/--task | 轻量多智能体，隔离 + 并行 + 可干预 | L3 subagent 设计参考 |
| **Plan Mode SOP** | GA plan_sop | 探索态→规划态→执行态，主 agent 不直接探测 | 复杂任务规划能力 |
| **空闲自主行动** | GA autonomous | 空闲时自动整理/学习，与"学习助手"契合 | 自动化能力 |
| **浏览器/系统控制** | GA TMWebDriver | 桌面助手扩展能力 | 桌面 agent |
| **MixinSession 作为 FallbackProvider 轻量替代** | GA MixinSession | 多 provider 自动故障转移 | §5 Provider Fallback |

### 22.4 不调整（已定方案合理）

| 项 | 已定方案 | 不调整理由 |
|---|---|---|
| AgentLoop | pi-agent 方案 A（双层 while + EventStream） | GA generator yield 更轻但丢类型安全，TS 项目需类型安全 |
| Tool 系统 | 4 专用工具（read/write/exec/search） | GA code_run 万能工具 token 消耗大，专用工具更安全更省 |
| Channel | 方案 E（类型化 bus） | GA 双队列太简，nanobot metadata hack 弱类型，E 是最优解 |
| CLI/WebUI | Ink + Lit + reducer + CommandRegistry | GA Streamlit 不适合 TS，pi-agent Ink 已验证 |
| Provider | Api-Provider 分离 | GA 无 provider 抽象，pi-agent 分离最优雅 |
| Config | JSON + Zod | GA mykey.py 不安全，JSON + Zod 是 TS 最佳实践 |
| Memory | JSONL + Compaction | GA 无结构化存储，JSONL 是标准方案 |

### 22.5 需要讨论的开放问题

1. **working memory 是否纳入 MVP？** GA 的 working dict 让 LLM 主动存"当前任务关键信息"，每轮注入。这与 Compaction 互补（Compaction 是被动的，working memory 是主动的）。但增加 MVP 复杂度。倾向 L2。
2. **tag 正则截断是否纳入 MVP？** 零成本，但 aptbot MVP 用 JSONL 存 SessionEntry（结构化），不是 GA 的纯文本 tag。需要定义"截断哪些字段"。倾向 MVP 做简化版（截断老 tool_result 的 content）。
3. **自演化 skill 的触发时机？** GA 是每次任务成功后自动结晶。aptbot 若做，需定义"成功"标准 + 结晶格式 + L1 索引更新。倾向 L3。

---

## 附：三方源码索引

### pi-agent
- AgentLoop: `pi/packages/agent/src/agent-loop.ts`
- AgentSession: `pi/packages/agent/src/agent.ts`
- AgentHarness: `pi/packages/agent/src/harness/agent-harness.ts`
- Provider: `pi/packages/ai/src/compat.ts`
- Tool: `pi/packages/agent/src/types.ts`
- Skills: `pi/packages/agent/src/harness/skills.ts`
- Compaction: `pi/packages/agent/src/harness/compaction/compaction.ts`
- Session: `pi/packages/agent/src/harness/session/jsonl-repo.ts`
- CLI InteractiveMode: `pi/packages/coding-agent/src/modes/interactive/interactive-mode.ts`
- Slash commands: `pi/packages/coding-agent/src/core/slash-commands.ts`
- Settings: `pi/packages/coding-agent/src/core/settings-manager.ts`

### nanobot
- AgentRunner: `nanobot/nanobot/agent/runner.py`
- AgentLoop: `nanobot/nanobot/agent/loop.py`
- LLMProvider: `nanobot/nanobot/providers/base.py`
- Provider Factory: `nanobot/nanobot/providers/factory.py`
- FallbackProvider: `nanobot/nanobot/providers/fallback_provider.py`
- Tool base: `nanobot/nanobot/agent/tools/base.py`
- ToolRegistry: `nanobot/nanobot/agent/tools/registry.py`
- SkillsLoader: `nanobot/nanobot/agent/skills.py`
- Memory: `nanobot/nanobot/agent/memory.py`
- SessionManager: `nanobot/nanobot/session/manager.py`
- Config: `nanobot/nanobot/config/schema.py`
- Channel base: `nanobot/nanobot/channels/base.py`
- ChannelManager: `nanobot/nanobot/channels/manager.py`
- WebSocketChannel: `nanobot/nanobot/channels/websocket.py`
- CLI: `nanobot/nanobot/cli/commands.py`
- StreamRenderer: `nanobot/nanobot/cli/stream.py`

### GenericAgent
- AgentLoop: `GenericAgent/agent_loop.py`
- GenericAgent 类: `GenericAgent/agentmain.py`
- Handler + Tools: `GenericAgent/ga.py`
- LLM Core: `GenericAgent/llmcore.py`
- Tool Schema: `GenericAgent/assets/tools_schema.json`
- Subagent SOP: `GenericAgent/memory/subagent.md`
- Plan Mode SOP: `GenericAgent/memory/plan_sop.md`
- CLI 分发: `GenericAgent/ga_cli/cli.py`
- Streamlit WebUI: `GenericAgent/frontends/stapp.py`
- Hooks: `GenericAgent/plugins/hooks.py`
- TMWebDriver: `GenericAgent/TMWebDriver.py`
