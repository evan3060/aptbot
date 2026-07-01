---
slug: "11-error-streaming-ux"
title: "错误处理与流式 UX：分层重试 + EventStream + reducer"
description: "外置分层重试哲学、三层重试（传输/业务/语义）、错误不持久化、AgentEvent 联合类型、EventStream → UI reducer 模式、流式渲染/回合中断/多端同步、resync 协议、turn_busy、SessionRef"
track: agent-practice
chapter: 可靠性+UX 篇
order: 11
difficulty: advanced
estimatedReadingTime: 11
status: published
prerequisites:
  - 10-security-model
lastUpdated: "2026-07-01"
tags:
  - error-handling
  - streaming
  - event-stream
  - reducer
  - ux
---

# 错误处理与流式 UX：分层重试 + EventStream + reducer

agent 系统的"可靠性"和"UX"看似两个话题，在 aptbot 里其实是同一个：都是关于"事件如何从 agent 流到用户、出错时如何处理"。这篇文章把这两条线索拧在一起，看 aptbot 的错误处理哲学、事件流抽象、UI 渲染模式如何协作。

## 外置分层重试哲学

最朴素的重试方式是"哪里出错就在哪里重试"——网络层出错网络层重试、业务层出错业务层重试。但这种方式有个问题：低层不知道高层语义，重试决策可能错误。

举个例子：HTTP 请求返回 401。网络层看到"请求失败"，可能重试。但 401 是"认证失败"，重试 100 次还是 401，纯粹浪费。重试决策应该在"知道 401 意味着什么"的层做。

aptbot 的外置分层重试哲学：**loop 报告，上层决策**。具体执行层（如 Provider 调用）不自己决定是否重试，而是把错误分类后上报，由更上层的 loop 决策——是切 provider、是回滚、是问用户、是放弃。

这让每一层都保持纯粹——执行层只管"执行 + 报错"，决策层管"如何处理错"。决策逻辑集中、可审计、可调整；执行逻辑简单、可复用、可测试。

## 三层重试：传输 + 业务 + 语义

aptbot 的错误分三层：

**传输层重试**：网络层错误。ECONNRESET、ETIMEDOUT、socket hang up。这类错误重试有意义（可能是临时网络抖动），但要用退避避免雪上加霜。aptbot 用指数退避（1s→2s→4s）+ jitter。

**业务层重试**：HTTP 状态码错误。401/403 fatal（不重试）、429/5xx transient（重试 + 切 provider）、400 fatal（参数错，重试无意义）。这一层根据 HTTP 语义决定。

**语义层重试**：LLM 输出错误。模型返回不合法 JSON、工具参数 schema 校验失败、模型反复调用不存在的工具。这类"重试"不是重新发请求，是把错误反馈给 LLM 让它在下一轮纠正。这层由 agent loop 处理，不是 provider 层。

三层各自处理自己懂的错误，不越界。传输层不知道 401 意味着什么，不重试 401。业务层不知道 LLM 输出错在哪，不试图纠正 JSON。语义层不重发 HTTP 请求，只在 agent loop 内反馈给 LLM。

## 错误不持久化原则（防"400 poisoning"）

aptbot 有个反直觉的原则：**错误不写入 session 历史**。

为什么反直觉？直观上"记录错误以便复盘"是好的。但实际中这会引入"400 poisoning"——某个 provider 临时返回 400（如模型参数错），错误被记进 session 历史。下次 session 回放时，这个 400 又被发回 LLM 作为"上轮发生了什么"，LLM 看到"上轮 400 错"可能会困惑或重复触发同样的问题。

正确做法是错误只活在内存中——发生时通过事件流推给客户端展示，但绝不写入 JSONL。session 历史只记"成功完成的事"（user message、assistant message、tool call result），不记"失败尝试"。

这保证了 session 回放的一致性——任何时候回放，看到的都是"已完成的事"，不会有"半截错误"污染上下文。

## AgentEvent 联合类型

agent 的所有输出（LLM token、工具调用、状态变化、错误）都是事件，统一用 `AgentEvent` 联合类型表示：

- **token event**：LLM 流式输出的一个 token
- **tool_call_start event**：工具调用开始（name + args）
- **tool_call_end event**：工具调用结束（result）
- **turn_end event**：一个回合结束
- **error event**：错误（含类型 + 消息）
- **presence event**：用户上线/离线
- **session_changed event**：session 状态变化

联合类型让 TypeScript 在每个事件处理点强制校验类型，避免把 token event 当 tool_call_end 处理这类错误。事件流是 aptbot 内部与外部的统一接口——agent core 产生事件，bus 分发事件，Channel 转发事件，UI 消费事件。

## EventStream → UI reducer 模式（CLI Ink + WebUI Lit 共享 coreReducer）

UI 不是直接处理事件，而是通过 reducer 模式：

- **EventStream**：事件的有序序列，从 agent 流到 UI
- **reducer**：纯函数 `(state, event) => newState`，把事件序列折叠成 UI 状态
- **UI**：根据 state 渲染

aptbot 有两个 UI：CLI（用 Ink）和 WebUI（用 Lit）。它们用同一个 `coreReducer`——reducer 是纯函数，与 UI 框架无关。差异只在"如何把 state 渲染成像素"——Ink 渲染成终端字符、Lit 渲染成 DOM。

reducer 共享的好处：

1. **一致性**：CLI 和 WebUI 显示同样的 agent 状态，不会"CLI 看到工具调用但 WebUI 看不到"
2. **可测试**：reducer 是纯函数，单元测试不需要拉起 UI 框架
3. **可演化**：未来加新 UI（如 mobile app），复用 reducer，只写渲染层

## 流式渲染、回合中断、多端同步是事件流的自然消费

reducer 模式让三个看似复杂的 UX 行为变成"事件流的自然消费"：

**流式渲染**：token event 一个个到达，reducer 把它们 append 到 state 的"当前 assistant message"字段，UI 看到 state 变化就渲染新 token。不需要特殊"流式逻辑"，就是 reducer 处理 token event。

**回合中断**：用户点"停止"按钮，发 abort 信号给 agent loop，loop 停止工具执行与 LLM 调用，发 turn_aborted event。reducer 收到 turn_aborted，把当前 message 标记为"已中断"，UI 显示中断标记。中断不是"特殊路径"，是事件流的一个 event。

**多端同步**：agent 事件发到 bus，bus 分发给所有绑定该 session 的 channel。每个 channel 的 UI 各自跑 reducer，state 各自演化但同步——因为它们消费同一份事件流。多端同步不需要"特殊同步逻辑"，是事件流的天然结果。

这是 reducer 模式的核心价值——把"复杂 UX 行为"还原成"事件流 + 纯函数"，复杂度从 UI 转移到事件设计，UI 层变薄。

## resync 协议

WebSocket 断连重连后，客户端如何"补上"断连期间的事件？最朴素是"重连后重新拉取整个 session 历史"，但这浪费带宽（大部分事件客户端已经看过）。

aptbot 的 resync 协议：

- 客户端记录最后收到的事件 sequence number
- 重连时把 sequence 发给服务端
- 服务端从该 sequence 之后开始 replay

这把"重连"成本降到最低——只补"漏接的事件"，不重发全部。resync 协议在底层支撑了"无感重连"——用户网络抖动一下，UI 闪一下，状态自动追上，不需要刷新页面。

## turn_busy 队列反馈

agent 正在执行 turn 时（如跑 bash 工具，30 秒），用户又发了一条消息怎么办？aptbot 用 `turn_busy` 反馈：

- agent 正在执行 turn 时，新消息进入队列
- agent 给客户端发 turn_busy event，告诉"我现在忙，你的消息已排队"
- 当前 turn 结束后，agent 自动处理队列中的下一条

这让 UX 更清晰——用户知道"我的消息被收到了，但 agent 在忙，稍后处理"，而不是"我发了消息但 agent 没反应"的迷茫。turn_busy 是事件流的另一个 event，reducer 处理它显示"忙"状态。

## SessionRef 可变引用（运行中切 session 不重启 loop）

agent loop 运行时，用户可能想切换到另一个 session——比如当前 session 卡在一个长任务上，用户想换一个 session 干别的事。

最朴素的实现是"停掉当前 loop，重启新 loop 切到新 session"，但代价大——loop 重启会丢失内存中的临时状态（如正在执行的工具、未完成的 LLM 调用）。

aptbot 用 `SessionRef` 可变引用解决：loop 持有一个对当前 session 的引用（不是 session 本身），引用可变。切 session 时只改引用，loop 不重启。当前正在执行的 LLM 调用完成后，下一轮自动用新 session。

这让"运行中切 session"成本极低——只是改一个引用，loop 继续跑。代价是新 session 要等当前 turn 结束才能完全接管，但这是合理代价（你不能让进行中的 LLM 调用"换 brain"）。

## 小结

错误处理与流式 UX 在 aptbot 是同一个话题——都是关于"事件如何流、出错如何处理"。外置分层重试哲学让决策集中，三层重试各管各的，错误不持久化防 400 poisoning。AgentEvent 联合类型 + EventStream + reducer 让 UI 变薄，流式渲染/回合中断/多端同步都是事件流的自然消费。resync 协议支撑无感重连，turn_busy 让队列反馈清晰，SessionRef 让运行中切 session 不重启。

下一篇文章离开抽象层，看 aptbot 实际开发过程：从 MVP 到 0.2.2 的演进回顾。
