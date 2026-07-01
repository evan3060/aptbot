---
slug: "08-channel-transport"
title: "Channel 与多端接入：TransportChannel 抽象"
description: "方案 E 类型化 bus + AgentEventEnvelope 设计动机、Channel 接口最小化、wrapTransportChannel 适配器、bindSession 多对一共享、dead-channel 自动 unbind、IM channel 远期规划"
track: agent-practice
chapter: 核心特性深入篇
order: 8
difficulty: intermediate
estimatedReadingTime: 9
status: published
prerequisites:
  - 07-hook-system
lastUpdated: "2026-07-01"
tags:
  - channel
  - bus
  - multi-client
  - transport
---

# Channel 与多端接入：TransportChannel 抽象

一个 agent 同时服务多个客户端，是 aptbot 0.2.x 的核心场景：你在电脑上开 WebUI 跟 agent 对话，出门切换到手机继续，回家在另一台电脑上接续。这要求"agent 状态独立于客户端连接"——客户端可以断开重连，agent 不应该重启。Channel 抽象是实现这个解耦的关键。

## 方案 E 类型化 bus + AgentEventEnvelope 设计动机

多端接入最朴素的实现是"每个客户端一个 agent 实例"，但这是错的——agent 状态会分裂：A 客户端让 agent 改了文件，B 客户端的 agent 不知道。正确做法是"一个 agent 实例 + 多个客户端接入"，客户端只是 agent 的"显示器"。

aptbot 用"方案 E"实现：类型化 bus + AgentEventEnvelope。设计要素：

- **bus**：类型化的内部事件总线，agent 把所有输出（LLM 流、工具调用、状态变化）作为事件发到 bus
- **AgentEventEnvelope**：事件的统一封装格式，含事件类型、payload、sessionId、时间戳等元信息
- **Channel**：bus 的订阅者，把 bus 事件转成客户端能消费的格式（如 WebSocket frame、Telegram message）

为什么用 bus 而不是直接"agent → 客户端"推送？因为 bus 解耦了"事件产生"与"事件消费"：

1. **多订阅者**：一个 agent 事件可以同时被多个 Channel 消费（WebUI + CLI + 日志）
2. **缓冲**：bus 可以缓存事件，客户端断连重连后补播
3. **类型安全**：envelope 是 TypeScript 类型，编译期保证事件结构正确

## Channel 接口最小化（type / send / close / isAlive）

Channel 接口只要求 4 个方法：

- **type**：channel 类型标识（如 "websocket"、"telegram"）
- **send(event)**：向客户端推送一个事件
- **close()**：关闭 channel
- **isAlive()**：channel 是否还活着

接口极简是有意的。Channel 越简单，新接入一个端越容易。一个新端只需要实现这 4 个方法，不需要理解 agent 内部——agent 的事件已经通过 bus 标准化成 envelope。

接口最小化的另一面是"客户端能力假设最小化"——aptbot 假设客户端只能"收事件"和"被关闭"，不假设它能查询、能恢复、能确认。这些更高级的能力通过协议层（如 WebSocket 重连 + resync）实现，不进入 Channel 接口本身。

## wrapTransportChannel 适配器

实际中往往已经有了一个"传输层"实现（如 Node.js 的 WebSocket 库、Telegram Bot SDK），不直接实现 Channel 接口。aptbot 提供 `wrapTransportChannel` 适配器，把"传输层"包装成 Channel。

适配器做的事情：

- 把 envelope 序列化成传输层能消费的格式（如 JSON 字符串）
- 调用传输层的 send 方法
- 把传输层的 close 事件转成 Channel 的 close
- 把传输层的 alive 检查转成 Channel 的 isAlive

适配器让 aptbot 不重写传输层——直接复用 ws、node-telegram-bot-api 等成熟库，只写一层薄薄的包装。这是"不重新发明轮子"的具体体现。

## bindSession(sessionKey, channel) 多对一共享

核心 API：`bindSession(sessionKey, channel)`。把一个 channel 绑定到某个 session。

"多对一"是关键——一个 session 可以同时绑定多个 channel。比如：

- 用户在电脑 WebUI 打开 session X（channel A 绑定 X）
- 用户在手机也打开 session X（channel B 绑定 X）
- agent 收到一条消息，发回的事件同时通过 A 和 B 推送
- 两个客户端看到的是同一份 agent 输出

这是"多端同步"的核心机制。agent 不知道也不需要知道有几个客户端，它只往 bus 发事件，bus 把事件分发给所有绑定该 session 的 channel。

如果用户在电脑上发消息，agent 处理后事件也会推到手机——手机用户能"看到"电脑上的对话进行。这是真正的"agent 状态独立于客户端"。

## WebSocket 作为 Channel 实现

aptbot 0.2.x 的主要 Channel 实现是 WebSocket。WebUI 是浏览器，自然用 WebSocket 与服务端双向通信。CLI 通过 WebSocket 连服务端（同一台机器或远程 VPS），也能接入同一个 agent。

WebSocket Channel 的实现细节：

- 客户端连上时，发 auth token + 想绑定的 sessionKey
- 服务端校验后调用 bindSession
- agent 事件通过 ws.send 推给客户端
- 客户端断连（ws close 事件）触发 channel dead 处理

WebSocket 之外，aptbot 计划支持更多 Channel（见远期规划），但 0.2.x 只做 WebSocket——这是"先打通一条路"的策略，把多端接入的抽象做好，再逐步加端。

## dead-channel 自动 unbind

channel 可能"死掉"——网络断开、客户端崩溃、超时无响应。aptbot 检测到 channel 不 alive 时，自动从 session 解绑。

为什么需要自动 unbind？

1. **避免事件丢失**：往 dead channel 发事件是浪费（客户端收不到），但 aptbot 不知道就还往它发，可能阻塞或泄露内存
2. **资源回收**：每个 channel 占用内存（缓冲区、回调），死掉的 channel 不释放会泄露
3. **正确性**：客户端重连后会建新 channel，老 channel 应该被遗忘，不能让"幽灵 channel"还在收事件

dead-channel 自动 unbind 让系统在长时间运行中保持健康——channel 死了就清掉，重连了就重新绑定，agent 不知道这层切换。

## future: IM channel 集成（Telegram 首通道）

远期规划：把 IM（即时通讯）应用作为 Channel 接入。Telegram 是规划的首通道，因为：

- **Bot API 成熟**：Telegram Bot API 文档完善、SDK 丰富、限制宽松
- **多端天然支持**：Telegram 自己就是多端（手机/桌面/Web），aptbot 接入 Telegram 等于一次性覆盖所有这些端
- **公开可达**：Telegram Bot 通过 webhook 接收消息，不需要用户在自己机器跑服务，部署成本低

接入 Telegram 后，用户能在手机 Telegram 里跟自己的 aptbot 对话——agent 在 VPS 上跑，Telegram 是 Channel，所有 aptbot 能力（工具、记忆、skills）都通过 Telegram 可用。

IM channel 接入的难点是"消息模型差异"——IM 是"一条一条消息"，aptbot 是"流式事件"。需要把流式事件"折叠"成消息（如把 LLM 流式输出聚合成一条最终消息发送）。这是 Channel 适配器要做的工作，aptbot 的抽象层已经为这个差异预留了空间。

## 与 nanobot 20+ IM channel / GA 4 IM app 对比

nanobot 主打"IM channel 全集"——内置 20+ IM 应用的 channel 实现（Telegram、Discord、Slack、WhatsApp…）。这是 nanobot 的核心卖点，让用户"写一次 agent，部署到所有 IM"。

GA 集成 4 个主流 IM app，覆盖面小于 nanobot 但深度更甚——每个 IM 都做了完整的功能适配（不只是消息收发，还包括按钮、菜单、文件等）。

aptbot 走的是"窄而深"路线：0.2.x 只做 WebSocket，远期才加 Telegram，没有"全覆盖 IM"的野心。原因还是定位——aptbot 是学习项目，"打通一个 IM 端"已经能学到 Channel 抽象的所有要点，加 20 个 IM 是工程量但学习价值边际递减。

这条路线的取舍：aptbot 用户不能用 aptbot 直接接入 Discord/Slack，需要自己写 Channel 适配器。但 aptbot 的 Channel 抽象是公开的、最小化的，用户写适配器有清晰的接口参考。

## 小结

Channel 与多端接入是 agent "状态独立于客户端"的基础。方案 E 类型化 bus + envelope 解耦事件产生与消费，Channel 接口最小化让接端成本低，wrapTransportChannel 适配器复用成熟传输层，bindSession 多对一共享实现多端同步，dead-channel 自动 unbind 保持系统健康。WebSocket 是 0.2.x 的主实现，IM channel 是远期规划。

下一篇文章看 Session 与多用户：在 Channel 之上如何管理会话状态、用户隔离、多端同步的细节。
