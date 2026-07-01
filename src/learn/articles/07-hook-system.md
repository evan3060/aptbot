---
slug: "07-hook-system"
title: "Hook 系统：8 扩展点的插件机制"
description: "8 hook 点拓扑、同步执行 + ctx mutate 链式传递 + priority 升序、两层插件目录、无沙箱设计哲学、与 nanobot/GA 对比、适用场景"
track: agent-practice
chapter: 核心特性深入篇
order: 7
difficulty: intermediate
estimatedReadingTime: 9
status: published
prerequisites:
  - 06-skills-system
lastUpdated: "2026-07-01"
tags:
  - hook
  - plugin
  - extensibility
---

# Hook 系统：8 扩展点的插件机制

agent 的核心循环是固定的——ReAct 循环、工具调用、流式输出。但在循环的每个关键节点，往往需要插入"侧动作"：记日志、上报监控、审计工具调用、自动注入 steering 信息。如果这些侧动作都硬编码进 agent 循环，循环本体会被各种 if 分支污染。Hook 系统解决这个矛盾：循环保持纯粹，侧动作通过扩展点插入。

## 8 hook 点拓扑

aptbot 在 agent 循环里设了 8 个 hook 点，按循环结构分四组：

**Agent 级（整个 agent 生命周期）**

- `agent_before`：agent 启动时触发，做全局初始化
- `agent_after`：agent 退出时触发，做全局清理

**Turn 级（每个用户回合）**

- `turn_before`：每轮开始前触发，可修改这一轮的初始 context
- `turn_after`：每轮结束后触发，可观察这一轮的最终状态

**LLM 级（每次 LLM 调用）**

- `llm_before`：调用 LLM 前触发，可修改 messages、tools、systemPrompt
- `llm_after`：LLM 返回后触发，可观察 LLM 输出、修改后续行为

**Tool 级（每次工具调用）**

- `tool_before`：工具执行前触发，可拦截、修改参数
- `tool_after`：工具执行后触发，可修改返回值、记录审计

这 8 个点覆盖了 agent 循环的所有关键决策点。任何"在 X 时机做 Y 事"的需求，基本都能对号入座到一个 hook 点。

## 同步执行 + ctx mutate 链式传递 + priority 升序

多个 hook 可能注册到同一个点。aptbot 的执行模型：

**同步执行**：hook 不返回 Promise，必须同步完成。这避免了 hook 异步导致 agent 循环复杂化。如果 hook 需要做异步操作（如发 HTTP 请求），自己 fire-and-forget，不阻塞循环。

**ctx mutate 链式传递**：每个 hook 接收一个 context 对象，可以直接 mutate 它。后一个 hook 看到的是前一个 hook 修改后的 context。这让多个 hook 能协作——比如 hook A 注入一段 steering 信息，hook B 在这段信息基础上再补充。

**priority 升序**：每个 hook 注册时带 priority 字段，数字小的先执行。这让用户能控制 hook 顺序——比如"日志 hook 先于业务 hook 执行"。

这套执行模型的设计取向是"简单优先"——同步、mutate、固定顺序，每个决策都选了最朴素的方案。代价是 hook 不能做重活（同步阻塞循环），但收益是 hook 的行为可预测、易调试。

## 两层插件目录（workspace 覆盖 builtin）

与 skills 系统一致，hooks 也分两层：

- **builtin hooks**：aptbot 内置，随代码发布
- **workspace hooks**：用户项目本地，覆盖 builtin 同名 hook

这个设计让 aptbot 能内置一些"通用 hook"（如基础日志、基础监控），同时允许用户为项目定制 hook 覆盖默认行为。两层加载是 aptbot 多个子系统的共享模式——skills、hooks、未来的 prompt templates 都用同一套机制。

## 无沙箱设计哲学

aptbot 的 hook 没有沙箱——hook 是普通 TypeScript 代码，直接 import aptbot 内部模块，能访问任何东西。hook 抛错会被吞掉 + 写 stderr，但不影响主流程。

这是有意的设计选择，对应"信任边界内"的假设：

- **hook 由用户自己写**：用户写自己的 workspace hook，不是从外部安装。用户能改 aptbot 代码，当然能改 hook。
- **hook 不需要权限隔离**：不像浏览器插件需要沙箱，aptbot hook 与 aptbot 本体在同一信任层。
- **沙箱会限制能力**：如果 hook 在沙箱里，它能做的事大幅受限，很多有价值的 hook（如修改 agent 内部状态）做不了。

无沙箱的代价是安全责任在用户——用户要为自己写的 hook 负责，写错可能让 agent 崩。但这是"自由 vs 安全"的常见取舍，aptbot 选了自由。

"hook 抛错吞掉 + stderr + 不影响主流程"是这个哲学的安全网——即使 hook 出错，agent 循环不崩。这让用户能放心地写实验性 hook，错了就改，不影响 agent 基本可用。

## 与 nanobot AgentHook / GA 8 hook 点对比

nanobot 的 AgentHook 是 Ruby 实现，hook 是 Proc 对象，执行模型类似（同步、链式）。差异在覆盖机制——nanobot 用全局注册，aptbot 用两层目录覆盖。aptbot 的方式更接近"配置即文件"，与 skills、prompts 的管理模式一致。

GenericAgent 也定义了 8 个 hook 点，与 aptbot 的拓扑几乎一致。这不是巧合——agent 循环的关键决策点是有限的，不同实现会收敛到相似的扩展点集合。差异在执行模型：GA 用 Python decorator，更灵活但更隐式；aptbot 用 priority 字段，更死板但更显式。

8 个 hook 点的"巧合"反映了 agent 循环的本质结构——它就是 agent / turn / llm / tool 四层，每层有 before/after 两个时机。任何想清楚 agent 循环结构的项目，都会自然演化出类似扩展点。

## 适用场景：日志 / 监控 / 审计 / 自动注入 steering

具体看 hook 的典型用法：

**日志**：`turn_before` / `turn_after` 记录每轮输入输出，写到独立日志文件。比 agent 内置日志更灵活，能定制格式。

**监控**：`llm_before` / `llm_after` 上报 token 用量、延迟、错误率到 Prometheus 或类似系统。比 agent 内置监控更轻——agent 不需要知道监控系统的存在。

**审计**：`tool_before` / `tool_after` 记录每次工具调用的参数与结果，用于事后审计。对 bash 这类危险工具尤其重要。

**自动注入 steering**：`llm_before` 检测当前 context，自动注入相关信息。比如检测到对话在讨论"测试"时，自动注入"项目测试约定"段落。这是"动态 systemPrompt"的基础——不需要把所有信息都塞进静态 systemPrompt，按需注入。

这四类场景的共同点：都是"侧动作"，与 agent 核心循环逻辑解耦。把它们做成 hook 而不是硬编码进 agent，让 agent 循环保持纯粹，也让这些侧动作能独立演进、独立配置、独立启停。

## 小结

Hook 系统是 agent 循环的扩展点机制。8 个 hook 点覆盖 agent/turn/llm/tool 四层的 before/after 时机，同步执行 + ctx mutate + priority 升序的执行模型追求简单可预测，两层目录覆盖与 skills 系统一致，无沙箱哲学反映"信任边界内"假设。日志、监控、审计、自动注入是典型场景。

下一篇文章看 Channel 与多端接入：如何让一个 agent 同时服务多个客户端。
