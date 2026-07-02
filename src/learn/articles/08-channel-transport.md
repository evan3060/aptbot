---
slug: "08-channel-transport"
title: "Channel 与多端接入：TransportChannel 抽象"
description: "从多端接入的问题出发，对比三种接入方案的设计取舍，深入 aptbot 的类型化事件总线、最小化 Channel 接口、bindSession 多对一共享、dead-channel 自动清理与 WebSocket 实现"
track: agent-practice
chapter: 核心特性深入篇
order: 8
difficulty: intermediate
estimatedReadingTime: 16
status: published
prerequisites:
  - 07-hook-system
lastUpdated: "2026-07-02"
tags:
  - channel
  - transport
  - websocket
  - multi-client
  - event-bus
---

一个 agent 同时服务多个客户端，是 aptbot 0.2.x 的核心场景：你在电脑上打开 WebUI 跟 agent 对话，出门切换到手机继续，回家在另一台电脑上接续。这要求 **agent 的状态独立于客户端连接**——客户端可以断开重连，agent 不应该重启，也不应该丢失对话上下文。

这个需求看起来简单，但实现起来有几个关键问题：如果两个客户端同时接入同一个 agent，事件该推给谁？客户端断线重连后，如何拿到断线期间错过的历史？一个用户在电脑上发了消息，手机端怎么同步看到回复？

Channel 抽象就是为了解决这些问题而诞生的。它把"如何与客户端通信"和"agent 如何运行"拆成两个独立的问题。这篇文章从多端接入的根本挑战讲起，对比三种方案的设计取舍，最后深入看 aptbot 如何通过类型化事件总线、最小化 Channel 接口和 bindSession 机制来实现多端同步。

## 一、概念：什么是多端接入，为什么需要 Channel 抽象

### 1.1 多端接入的核心问题

多端接入最朴素的实现是"每个客户端一个 agent 实例"——用户 A 连上来，创建一个 agent 实例服务 A；用户 B 连上来，再创建一个 agent 实例服务 B。但这在"同一用户多端切换"场景下会出问题：

1. **状态分裂**：用户在电脑上让 agent 改了文件，然后切换到手机。手机连接的是另一个 agent 实例，对刚才的修改一无所知。两个 agent 实例各自维护自己的上下文，彼此不通信，用户看到的对话历史不一致。
2. **资源浪费**：每个客户端一个 agent 实例意味着每个客户端都要维护一个完整的 LLM 上下文窗口。如果 10 个客户端接入，就是 10 个上下文窗口在内存里——即使其中 9 个客户端没有活跃对话。
3. **无法多端同步**：用户在电脑上发出指令，agent 执行完毕后回复只在电脑上显示。用户拿起手机看不到刚才的对话——因为手机连接的是另一个 agent 实例。

正确的做法是：**一个 agent 实例 + 多个客户端接入**。客户端只是 agent 的"显示器"和"输入设备"，agent 的状态不绑定于任何一个客户端。这样无论用户从哪个端接入，看到的是同一个 agent 会话。

### 1.2 Channel 抽象的角色

要实现"一个 agent + 多个客户端"，关键是把"消息怎么传"和"agent 怎么运行"解耦。

Channel 抽象就是这个解耦的桥梁：

- **Agent 侧**：只关心"产生事件"——LLM 的流式输出、工具的调用结果、状态的变化，都作为事件发出。agent 不关心这些事件最终怎么到达客户端。
- **Channel 侧**：只关心"消费事件"——把 agent 产生的事件转成客户端能理解的格式推送出去。Channel 不关心 agent 怎么决策、怎么执行工具。

这种解耦带来的灵活性：你可以同时用 WebSocket Channel（接 WebUI）、CLI Channel（接命令行终端）、Telegram Channel（接手机 IM），所有 Channel 接收的是同一套事件流。如果你要加一个新的接入方式（比如 Slack），只需要写一个新的 Channel 实现，agent 循环一行都不用改。

### 1.3 事件生产和事件消费的解耦

Channel 抽象背后的核心设计模式是**事件生产与事件消费的解耦**。

传统客户端-服务端模式中，服务端直接向客户端推送消息。这隐含了一个假设：一个消息只有一个消费者。但在多端接入场景中，同一个消息可能有多个消费者（电脑 WebUI + 手机 WebApp + 日志记录器）。

解耦的方式是引入一个中间层——事件总线。agent 把事件发到总线，总线负责把事件分发给所有感兴趣的人。agent 不需要知道"谁在听"，消费者不需要知道"谁在说"。

这个模式在大型系统中非常常见（如 Kafka、RabbitMQ），但 aptbot 是单进程应用，不需要分布式消息队列。aptbot 在进程内实现了一个轻量级的事件总线，专门用于 agent 事件的分发。

## 二、通用设计方案：多端接入的常见架构模式

在 agent 中实现多端接入，有几个维度的设计选择。理解这些维度是分析具体方案的基础。

### 2.1 session 与 connection 的关系

多端接入最核心的设计决策是：**session（会话）和 connection（连接）是绑定还是解耦？**

- **绑定模型**：连接即 session。用户打开 WebSocket 连接，系统创建一个 session；断开连接，session 销毁。这种方式简单直接，但无法支持"断开重连后保留会话"。
- **解耦模型**：session 独立于连接存在。用户登录后系统分配（或用户创建）一个 session，之后多个连接可以绑定到同一个 session。连接断了 session 还在，下次重连后绑定回原来的 session。

解耦模型显然是多端接入的正确选择，但它引入了额外的复杂度：session 需要持久化（否则进程重启 session 就丢了）、session 需要与连接建立映射关系、session 事件需要广播给所有绑定它的连接。

### 2.2 事件分发的策略

一个 agent 事件产生后，如何分发给客户端？三种常见策略：

**广播（broadcast）**：每个事件推送给所有连接的客户端。最简单，但问题很明显——用户 A 的私密对话会被推送给用户 B。广播只在单用户多端场景下可用。

**单播（unicast）**：每个事件只推送给"发起请求的那个客户端"。这是传统请求-响应模式。但问题是：用户在电脑上发消息、手机上想看到回复——单播模式下手机看不到。

**组播（multicast）**：每个事件推送给"绑定到当前 session 的所有客户端"。这是多端同步的正确策略——同一个 session 的所有客户端都收到事件。组播的分组依据是 session。

### 2.3 传输协议的选择

传输协议决定了事件怎么从服务端到达客户端。三种常见的实时传输协议：

**WebSocket**：全双工、低延迟，浏览器原生支持。适合需要流式推送的场景（agent 的流式输出天然适合 WebSocket）。缺点是自建协议的复杂度（心跳、重连、序列化）。

**SSE（Server-Sent Events）**：服务端到客户端的单向流，基于 HTTP 长连接。比 WebSocket 简单（原生 HTTP 协议），浏览器支持好。但 SSE 是单向的——客户端到服务端还需要额外的 HTTP 请求。

**长轮询（Long Polling）**：客户端定期发起 HTTP 请求，服务端在有事件时返回。实现最简单（只需要 HTTP），但延迟较高，资源消耗大。适合事件频率低的场景。

## 三、市面其他多端接入方案对比

不同 agent 项目对"如何让多个客户端接入同一个 agent"这个问题的回答差异很大。以下是三种有代表性的设计路线。

### 3.1 方案 A：agent + channel 强绑定

这条路线的做法是：每个连接对应一个 agent 实例，连接即 session，断开连接 session 即销毁。channel 只是 agent 的"附属品"——agent 创建时就决定了它使用什么 channel。

**设计特点：**

- **连接即 session**：用户连上来时创建一个 session，断开时销毁。没有"断线重连保留上下文"的概念。
- **agent 持有 channel**：agent 实例内部持有 channel 引用，直接调用 channel.send() 推送消息。不需要事件总线。
- **一对一关系**：一个 agent 实例只服务一个客户端。不存在多端共享 agent 的问题——因为压根不支持多端接入。
- **实现极简**：没有 channel 抽象层、没有事件总线、没有 session 管理器。agent 循环直接向 channel 写数据。

**优势：**

- 实现最简单——代码量最少，不需要任何基础设施
- 逻辑最直白——读代码就能理解"agent 怎么把消息发给客户端的"
- 零额外延迟——没有总线、没有分发，agent 直接推送给客户端

**劣势：**

- **无法多端同步**：用户不能在手机和电脑之间切换——第二个连接上来时，第一个连接已经销毁了对应的 agent 实例。用户在电脑上的对话不会同步到手机。
- **断线即丢失**：网络不稳定断开 WebSocket 时，agent 正在执行的任务可能中途取消。用户即使立即重连，也回到了一个全新的 session，刚才的对话历史没有了。
- **资源浪费**：每个连接一个 agent 实例意味着每个连接有独立的 LLM 上下文窗口。用户只是刷新页面就要重建一个 agent 实例——CPU 和内存的浪费很大。

**适用场景：** 简单的 demo 项目、一次性对话场景（用户用完即走，不需要保留历史）。

### 3.2 方案 B：独立 session 层 + channel 透传

这条路线的进步是引入了独立的 session 层：session 不再绑定到连接，而是持久化的实体。channel 则透穿在 session 和客户端之间——session 通过 channel 收发消息。

**设计特点：**

- **session 持久化**：session 有独立于连接的生命周期。连接断开后 session 保留，重连后恢复。
- **channel 透传**：session 直接持有 channel 引用，事件通过 channel 推送给客户端。没有事件总线，session 自己管理分发。
- **session 与 channel 一一对应**：一个 session 仍然只能绑定一个 channel。不支持多端同时接入。
- **连接恢复机制**：客户端断线后可以带上 sessionId 重连，重新绑定到同一个 session。

**优势：**

- session 持久化解决了"断线丢历史"的问题——客户端重连后能继续之前的对话
- session 层独立后，可以增加 session 管理功能（如 session 列表、session 标签、session 搜索）
- 实现相对简单——只需要在方案 A 的基础上加一个 session 管理器

**劣势：**

- **仍不支持多端同步**：一个 session 只能绑定一个 channel。用户不能在电脑发完消息、在手机上看回复——因为手机连接会"抢走"session 的 channel 绑定。
- **事件消费逻辑分散**：session 直接管 channel 的收发，意味着 session 代码里混合了"业务逻辑"（管理对话状态）和"传输逻辑"（怎么把消息发出去）。后续每加一种传输方式（从 WebSocket 到 Telegram），session 代码都需要修改。
- **连接切换时状态丢失**：用户从电脑切换到手机时，电脑的 channel 断开，手机的 channel 绑定上来。但电脑 channel 断开到手机 channel 绑定之间有一个时间窗口——期间 agent 产生的任何事件都丢失了（因为没有 channel 可以推送）。

**适用场景：** 单用户多设备轮换使用（一次只在一个设备上登录），需要保留对话历史但不需要实时多端同步。

### 3.3 方案 C：类型化事件总线 + Channel 抽象 + 多对一共享

这条路线做了三个关键设计：

1. **类型化事件总线**：agent 的所有输出都作为类型化事件发到总线上。总线不关心谁在消费这些事件。
2. **Channel 抽象**：每个接入方式实现 Channel 接口，从总线订阅事件并转发给客户端。agent 和 session 都不知道 Channel 的存在。
3. **多对一共享**：一个 session 可以同时绑定多个 Channel。总线把事件分发给所有绑定了该 session 的 Channel。

**设计特点：**

- **事件三层分离**：agent 只负责产生事件，总线负责分发事件，Channel 负责传输事件。三层各司其职，互不干扰。
- **Channel 接口最小化**：实现一个新接入方式只需要实现几个简单的方法（如 send、close、isAlive）。不需要理解 agent 的内部逻辑。
- **类型安全的事件格式**：所有事件有统一的类型定义（envelope），消费方按类型精确处理。不存在"收到一个 JSON 字符串，还要自己解析判断是什么事件"的情况。
- **自动生命周期管理**：Channel 死了自动解绑，新 Channel 接入自动订阅，不需要手动管理映射关系。

**优势：**

- 真正的多端同步——一个 session 绑定多个 Channel，所有 Channel 收到同一份事件流
- 加新接入方式成本低——实现 Channel 接口的 4 个方法即可，不碰 agent 循环
- 事件格式标准化——所有接入方式消费同一种事件格式，不存在"WebSocket 用一种格式、Telegram 用另一种"的适配问题
- 健壮性好——Channel 死了不影响 agent，agent 死了所有 Channel 收到关闭事件

**劣势：**

- 架构复杂——需要事件总线、Channel 管理器、session-Channel 映射表三套基础设施
- 总线可能成为瓶颈——所有事件经过总线分发，如果总线实现效率低会影响整体性能
- 调试困难——事件从 agent 到客户端经过三层（agent → bus → Channel → client），追踪问题时需要跨三层排查

**适用场景：** 需要多端实时同步的项目、需要接入多个不同传输协议的项目、架构清晰度要求高的项目。

### 3.4 三种方案对比

| 维度 | 方案 A（强绑定） | 方案 B（session + 透传） | 方案 C（总线 + 抽象 + 多对一） |
|---|---|---|---|
| 核心哲学 | 连接即 session，一对一 | session 持久化，channel 透传 | 三层分离，多对一共享 |
| session 生命周期 | 绑定连接 | 独立于连接 | 独立于连接 |
| 多端同步 | 不支持 | 不支持（一一对应） | 支持（多对一） |
| 事件分发 | agent 直接推送 | session 直接推送 | 总线组播 |
| 传输层与业务层 | 不分离 | 部分分离（session 管传输） | 完全分离 |
| 加新接入方式 | 改 agent 循环 | 改 session 层 | 仅加 Channel 实现 |
| 断线恢复 | 丢失 session | 保留 session，丢失中间事件 | 保留 session，缓冲事件 |
| 实现复杂度 | 低 | 中 | 高 |
| 架构清晰度 | 低（混杂） | 中 | 高（职责分明） |

三条路线从简到繁，从紧耦合到松耦合。方案 A 适合最小可行产品，方案 B 适合需要 session 管理的单用户场景，方案 C 适合需要真正多端同步的产品。aptbot 选择了方案 C，因为它的定位就是"一个 agent 服务多端"。

## 四、aptbot 的设计特点

aptbot 选择了**方案 C——类型化事件总线 + Channel 抽象 + 多对一共享**。这套设计在 aptbot 中实际落地为以下几个具体组件。

### 4.1 方案 E 类型化 bus + AgentEventEnvelope 设计动机

aptbot 在 0.2.x 中实现的事件总线被称为"方案 E"（Event-driven Engine），其核心设计围绕两个概念展开：

**类型化事件总线（Bus）**：bus 是 aptbot 内部的一个类型化 EventEmitter。Agent 产生的所有输出——LLM 流式 token、工具调用请求、工具执行结果、错误信息、状态变化——都作为类型化事件发到 bus。

```typescript
type AgentEvent =
  | { type: 'llm_token'; content: string }
  | { type: 'tool_call'; name: string; args: unknown }
  | { type: 'tool_result'; name: string; result: unknown }
  | { type: 'error'; message: string }
  | { type: 'done'; summary: string };
```

**AgentEventEnvelope（事件信封）**：每个事件在总线上传输时被包裹在一个"信封"中，包含事件的元信息：

```typescript
interface AgentEventEnvelope {
  id: string;           // 事件唯一 ID
  sessionId: string;    // 所属 session
  timestamp: number;    // 事件发生时间
  type: string;         // 事件类型
  payload: unknown;     // 事件内容
}
```

为什么需要 envelope？两个原因：

1. **多路复用**：bus 上同时传输多个 session 的事件。envelope 里的 sessionId 让 Channel 能过滤出"属于我的 session"的事件。如果没有 sessionId，每个 Channel 都得接收所有 session 的事件，然后自己过滤——浪费 CPU 也泄露隐私。
2. **消费方信息充足**：Channel 收到一个 envelope 后，不需要额外查询就知道这个事件属于哪个 session、什么时候发生的。这让 Channel 可以实现"事件缓冲"（客户端离线时缓存事件，重连后补发）而不需要额外维护映射表。

用 bus 而不是直接"agent → 客户端"推送的根本原因是：**bus 解耦了事件生产与事件消费**。agent 只往 bus 发事件，不管谁在收、收多少、收不收得到。Channel 从 bus 订阅事件，不管谁在发、发多少、为什么发。这种解耦让 agent 和 Channel 可以独立演变。

### 4.2 接口最小化：type / send / close / isAlive

Channel 是 aptbot 中接入方式的标准接口。它只要求 4 个方法：

```typescript
interface Channel {
  type: string;                              // channel 类型标识
  send(event: AgentEventEnvelope): void;     // 推送事件给客户端
  close(): void;                             // 关闭 channel
  isAlive(): boolean;                        // channel 是否还活着
}
```

4 个方法，这是有意的最小化设计：

- **type**：标识 Channel 的类型（如 `"websocket"`、`"telegram"`）。用于日志和监控，不参与业务逻辑。
- **send**：核心方法。bus 把事件分发给 Channel 时调用 send。Channel 的实现决定怎么把这个事件发送给客户端——WebSocket Channel 序列化成 JSON 通过 ws.send 推送，Telegram Channel 通过 Bot API 发送消息。
- **close**：关闭 Channel，释放资源。由 bus 在检测到 Channel 不存活时调用，或由上层系统关闭。
- **isAlive**：健康检查。bus 定期调用 isAlive 检查 Channel 是否还活着。如果返回 false，bus 会触发 Channel 死亡处理流程（自动解绑、清理资源）。

为什么接口这么小？

因为 Channel 的责任范围被严格限定在"**传输**"——它只负责"把已经封装好的事件从服务端送到客户端"。它不需要理解事件的含义、不需要关心 session 的状态、不需要处理用户输入。

接口最小化的另一面是**客户端能力假设最小化**——aptbot 假设客户端只能"收事件"和"被关闭"，不假设客户端能查询、能恢复、能确认。这些更高的能力通过协议层（如 WebSocket 重连后的 resync 协议）实现，不进入 Channel 接口本身。这保证了即使是最简单的客户端（如一个只读的事件显示器），也能实现 Channel 接口。

### 4.3 wrapTransportChannel 适配器

实际开发中，往往已经有成熟的传输层实现——Node.js 的 `ws` 库、Telegram Bot SDK、Slack SDK。这些库已经有自己的连接管理、心跳、重连、消息序列化等机制。如果要求每个 Channel 实现从头写这些，代价太大。

`wrapTransportChannel` 是一个适配器函数，它把"已有的传输层实现"包装成 Channel 接口：

```typescript
function wrapTransportChannel(options: {
  type: string;
  send: (data: string) => void;
  close: () => void;
  isAlive: () => boolean;
}): Channel {
  return {
    type: options.type,
    send: (event) => options.send(JSON.stringify(event)),
    close: options.close,
    isAlive: options.isAlive,
  };
}
```

适配器做的事情很简单：

1. 把 AgentEventEnvelope 序列化成传输层能消费的格式（如 JSON 字符串）
2. 调用传输层的 send 方法发送出去
3. 把传输层的 close 事件映射到 Channel 的 close
4. 把传输层的存活状态映射到 Channel 的 isAlive

这个适配器的价值在于：**开发者不需要重写传输层**。如果你有一个 WebSocket 连接，你只需要调用 `wrapTransportChannel({ type: 'websocket', send: ws.send, close: () => ws.close(), isAlive: () => ws.readyState === ws.OPEN })`，就得到了一个标准的 Channel 实例。

适配器模式让 aptbot 的 Channel 系统保持了"零依赖"的优雅——核心接口不依赖任何第三方库，而第三方库通过适配器接入。这是"不重新发明轮子"的具体体现。

### 4.4 bindSession(sessionKey, channel) 多对一共享

Channel 创建好了，接下来是把 Channel 绑定到 session。核心 API 是 `bindSession(sessionKey, channel)`。

**多对一**是最关键的设计：一个 session 可以同时绑定多个 Channel。

具体场景：

- 用户在电脑 WebUI 打开 session X（Channel A 绑定 session X）
- 用户在手机也打开 session X（Channel B 绑定 session X）
- agent 处理了一条消息，发回的事件通过 bus 分发，同时推送给 Channel A 和 Channel B
- 电脑和手机看到的是同一份 agent 输出

这个过程 agent 完全不知道——它只往 bus 发事件，不关心谁在收。bus 负责根据 sessionId 过滤事件，只推送给绑定了该 session 的 Channel。

多对一共享带来的核心能力是"**真正的多端同步**"——不是"用户主动刷新才能看到最新消息"，而是"agent 每产生一个事件，所有端实时收到"。用户在电脑上看到 agent 逐个输出 token 的同时，手机上也实时看到同样的 token 流。

### 4.5 WebSocket 作为 Channel 实现

aptbot 0.2.x 的主要 Channel 实现是 WebSocket。WebUI 是浏览器，自然用 WebSocket 与服务端双向通信。CLI 通过 WebSocket 连服务端（同一台机器或远程 VPS），也能接入同一个 agent。

WebSocket Channel 的工作流程：

1. **连接建立**：客户端通过 HTTP 升级协议建立 WebSocket 连接
2. **身份认证**：客户端在连接建立后发送认证消息，包含 Bearer token 和要绑定的 sessionKey
3. **绑定 session**：服务端验证 token 后，调用 `bindSession(sessionKey, channel)` 把 WebSocket 连接绑定到对应 session
4. **事件推送**：agent 产生事件 → bus 分发 → Channel.send → ws.send(JSON.stringify(envelope))
5. **客户端输入**：客户端通过 WebSocket 发送用户消息 → 服务端解析后注入 agent loop
6. **连接断开**：WebSocket 触发 close 事件 → bus 检测到 Channel 不存活 → 自动解绑

![Channel 多端接入架构](/learn/articles/images/channel-architecture.png)

这个流程中最关键的是第 3 步——客户端决定绑定到哪个 session，而不是服务端分配。这使得"断线重连保留 session 上下文"变得简单：客户端断线后记住 sessionId，重连时带上同一个 sessionId 重新绑定，历史都在。

WebSocket Channel 的实现细节中，一个值得注意的设计是**事件缓冲**。客户端断线后，bus 会缓存最近 N 条事件（N 可配置）。当客户端重连并绑定到同一个 session 后，bus 把缓存的事件重新推送给新 Channel，客户端补上断线期间错过的内容。这让"断线重连"的体验接近无缝——用户不会看到中间有一段空白。

### 4.6 dead-channel 自动 unbind

Channel 可能"死掉"——网络断开、客户端崩溃、超时无响应。如果死掉的 Channel 不被清理，会出现几个问题：

1. **事件丢失但自以为成功**：bus 调用 dead channel 的 send 方法，调用成功了（实际上数据丢进了虚空），bus 以为客户端收到了，实际上没有。用户可能以为 agent 回复了但"没收到"。
2. **资源泄漏**：每个 Channel 在 bus 中占用一个订阅位置。dead channel 不清理，订阅位置被占满后新的 Channel 无法订阅。Channel 内部的缓冲区也可能持续增长。
3. **幽灵连麦**：dead channel 不清理，bus 以为客户端还在线。但实际上客户端已经重连建立了新的 Channel，dead channel 变成了"幽灵"。如果幽灵 channel 还占着 session 的绑定槽位，新的 Channel 无法绑定。

aptbot 通过**自动 unbind** 解决这些问题：

- **定期健康检查**：bus 定期（如每 30 秒）调用所有 Channel 的 `isAlive()` 方法
- **死亡判定的阈值**：连续 3 次 isAlive() 返回 false，判定 Channel 死亡
- **自动解绑和清理**：死亡的 Channel 从 session 的绑定列表中移除，调用 close() 释放资源

当 Channel 死亡后，如果客户端立即重连，会创建新的 Channel 并重新绑定到同一个 session。dead channel 的自动清理和新 Channel 的绑定是两个独立的过程——清理由健康检查触发，绑定由客户端发起。二者可能同时发生，但因为它们的操作对象不同（老 channel 的清理 vs 新 channel 的绑定），不会产生冲突。

## 五、发展方向

### 5.1 Telegram 作为首条 IM Channel

尽管 aptbot 的架构可以支持任意多个 Channel 实现，0.2.x 只做了 WebSocket。远期的第一条 IM Channel 规划是 Telegram。

选择 Telegram 的原因：

- **Bot API 成熟**：Telegram 的 Bot API 是 IM 平台中文档最完善、限制最宽松的。它支持 webhook 和 polling 两种模式，消息类型丰富（文本、图片、文件、按钮、内联查询），且更新频率稳定。
- **多端天然支持**：Telegram 自己就是多端的（手机、桌面、Web）。aptbot 接入 Telegram 后，用户可以在手机 Telegram 里与 agent 对话，在电脑 Telegram 里查看历史——Telegram 自己负责多端同步，aptbot 不需要额外工作。
- **公开可达**：Telegram Bot 通过 webhook 接收消息。用户不需要在家庭网络开端口、不需要动态 DNS、不需要反向代理。在 VPS 上跑一个 aptbot 实例，Telegram Bot 把消息通过 api.telegram.org 转发过来。

接入 Telegram 的核心难点是**消息模型差异**：IM 平台是"消息"模型——一条消息一次发送，内容固定；aptbot 是"流式事件"模型——LLM 的 token 逐个产生、工具调用和结果是独立的事件。把流式事件"折叠"成 IM 消息是一个适配问题。

一种可能的方案是**消息聚合**：在 Telegram Channel 中维护一个"当前正在发送的消息"缓冲区。agent 产生的 llm_token 事件不断追加到缓冲区，直到产生完整的句子或达到最大消息长度时，一次性通过 Bot API 发送。工具调用事件则作为独立的后续消息发送。这样用户看到的是"agent 逐句输出"，体验接近在 Telegram 里和一个真人聊天。

### 5.2 IM Channel 接入的泛化

Telegram 之后，适配更多 IM 平台（Discord、Slack、飞书、企业微信）是一个自然的方向。每个平台的差异主要在于：

- **消息格式**：Markdown、HTML、自定义消息卡片
- **交互能力**：按钮、下拉菜单、模态框
- **文件传输**：图片、文档、代码片段
- **速率限制**：每个平台不同的限频策略

但核心的 Channel 抽象不需要变化——所有 IM Channel 都实现同样的 4 个方法。差异通过配置参数和适配器内部的转换逻辑处理。这是 Channel 抽象的价值所在：接入 1 个 IM 和接入 20 个 IM 的工作量是线性增长的，不会因为架构不支持而爆炸。

## 小结

Channel 与多端接入是 agent "状态独立于客户端"的基础设施。

1. **概念层面**：多端接入的核心矛盾是"一个 agent 服务多个客户端"。朴素的"每个客户端一个 agent 实例"方案会导致状态分裂和资源浪费。正确的做法是通过 Channel 抽象把事件生产与事件消费解耦。

2. **方案对比**：方案 A（agent + channel 强绑定）连接即 session，架构简单但体验差——断连丢失、无法多端同步。方案 B（独立 session 层 + channel 透传）解决了 session 持久化，但仍不支持多端同时接入。方案 C（类型化事件总线 + Channel 抽象 + 多对一共享）架构最清晰，但需要额外的事件总线基础设施。

3. **aptbot 的设计**：类型化事件总线（bus）+ AgentEventEnvelope 解耦事件生产与消费；Channel 接口最小化（type/send/close/isAlive）让接新端成本降到最低；wrapTransportChannel 适配器复用成熟传输层；bindSession 多对一共享实现真正的多端同步；dead-channel 自动 unbind 避免幽灵连接和资源泄漏。目前 WebSocket 是主要实现，Telegram 等 IM Channel 在远期规划中。

下一篇文章在 Channel 之上看 Session 系统：session 的持久化、多用户隔离、多端同步的最终一致性模型，以及 CLI 的命令如何让 session 成为可组织的工作单元。
