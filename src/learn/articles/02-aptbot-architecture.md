---
slug: "02-aptbot-architecture"
title: "aptbot 全景：分层架构与设计哲学"
description: "aptbot 四层架构（access/bus/core/infrastructure）+ shared 跨层的设计动机，单向依赖为何重要，以及与同类项目的定位差异"
track: agent-practice
chapter: 入门篇
order: 2
difficulty: beginner
estimatedReadingTime: 9
status: published
prerequisites:
  - 01-what-is-agent
lastUpdated: "2026-07-01"
tags:
  - architecture
  - layered-design
  - aptbot
---

# aptbot 全景：分层架构与设计哲学

上一篇文章我们建立了 agent 的心智模型：大脑 + 双手 + 长尾 + 嘴巴。这篇文章看 aptbot 如何用代码组织这套模型——四层架构、单向依赖、与同类项目的定位差异，以及贯穿全项目的设计哲学。

## 四层架构：access / bus / core / infrastructure + shared

aptbot 把代码切分为五个层次：

- **access（接入层）**：与外部世界对接。HTTP 路由、WebSocket、CLI Ink 界面、落地页 HTML 都属于这层。它把外部请求"翻译"成内部调用，把内部事件"翻译"回外部能消费的格式。
- **bus（总线层）**：类型化事件总线 + Channel 抽象。它解决"多端接入如何共享同一个 agent 会话"的问题。一个 WebSocket 连接、一个未来的 Telegram channel，都通过 bus 接入同一个 session。
- **core（核心层）**：agent 的运行循环本体。AgentLoop、provider 调用、工具调度、memory 管理、skills 加载、hook 触发都在这层。它是"大脑 + 双手 + 长尾"的实现。
- **infrastructure（基础设施层）**：与具体技术对接。文件系统（JSONL 持久化）、子进程（bash 工具）、HTTP 客户端（provider 调用）、配置加载都在这层。它是 core 的"手脚"。
- **shared（跨层共享）**：被多个层复用的纯类型与工具。commands 命令注册表、shared types、纯函数工具放这里。它不持有业务状态。

这个划分的依据是**依赖方向**：access → bus → core → infrastructure，shared 被任意层引用。下一节解释为什么这个方向不能反过来。

## 严格单向依赖的意义

"单向依赖"听起来像教条，但它解决的是非常实际的工程问题：**可替换性与可测试性**。

考虑一个反例：如果 core 直接依赖 access 的 WebSocket 实现，会出现什么？

1. 想把 aptbot 接入 Telegram，必须改 core。core 是 agent 循环本体，任何改动都可能影响 agent 行为。
2. 想给 core 写单元测试，必须 mock 整个 WebSocket 栈。测试变成集成测试，慢且脆。
3. agent 循环里出现"如果是 WebSocket 客户端就…"的分支，业务逻辑被接入细节污染。

单向依赖把这些问题消解掉：core 不知道 access 存在，所以接入新端只需在 access/bus 层加一个 Channel 实现，core 不动。core 测试只需 mock core 自己的接口（Provider、ToolRegistry），不需要拉起 HTTP 服务。agent 循环保持纯粹。

aptbot 的依赖规则：

- `access/*` 可以 import `bus/*` `core/*` `infrastructure/*` `shared/*`
- `bus/*` 可以 import `core/*` `infrastructure/*` `shared/*`
- `core/*` 可以 import `infrastructure/*` `shared/*`，**不能** import `access/*` `bus/*`
- `infrastructure/*` 只 import `shared/*` 与外部依赖
- `shared/*` 不 import 任何业务层

这条规则让每一层的"替换成本"都明确：换 access 层（新前端），core 不动；换 infrastructure 层（从文件系统换 SQLite），core 接口不变；换 core 实现（重写 agent 循环），接入与基础设施保留。

## 与 pi-agent / nanobot / GenericAgent 的对比定位

agent 项目大致分两类：**框架型**（给开发者用来构建自己的 agent）和**应用型**（一个具体的 agent 实例）。pi-agent、nanobot 偏框架，GenericAgent（GA）偏应用，aptbot 也是应用型但带教学属性。

| 项目 | 类型 | 语言 | 关注点 | 多端接入 |
|---|---|---|---|---|
| pi-agent | 框架 | 多语言 | 提供可组合的原语 | 由开发者集成 |
| nanobot | 框架 | Ruby | IM channel 全集（20+） | 内置丰富 |
| GenericAgent | 应用 | Python | autonomous / 浏览器控制 | 偏单端 |
| **aptbot** | **应用 + 教材** | **TypeScript** | **可靠性 + 可演进** | **Web 优先，IM 规划中** |

aptbot 选这条路的核心理由：**它是个人学习项目**，不是要成为通用框架，也不追求 IM 全集。它的目标是把 agent 的关键工程问题（Provider 故障转移、工具安全、记忆压缩、流式 UX、多端同步）一个个吃透，并把决策过程留作教材。所以 aptbot 的特性优先级是"对学习有价值的优先"，不是"对用户数有价值的优先"。

## aptbot 选 TypeScript 的理由

agent 项目的语言选择没有唯一正确答案。Python 生态最丰富（GA、LangChain 都在 Python），Ruby 的 nanobot 证明动态语言也能做 agent，Rust 适合追求性能与正确性。aptbot 选 TypeScript 的具体理由：

1. **类型系统够强**：zod + TypeBox 提供 runtime + compile-time 双重校验，agent 处理大量外部输入（LLM 响应、工具参数、配置文件），类型安全能挡掉一大批 bug。
2. **全栈统一**：CLI 用 Ink（React for terminal）、WebUI 用 Lit、服务端用 Node.js，前后端共享 TypeScript 类型定义，事件流类型可以一路从 core 流到前端 reducer。
3. **异步模型成熟**：agent 是高度 I/O 密集型（流式 LLM 响应、子进程、文件读写），Node.js 的 async/await + 流式抽象契合度高。
4. **个人熟悉度**：作为学习项目，选熟悉的语言能专注于 agent 本身的问题，而不是语言学习。

这不意味着 TypeScript 是 agent 的"最佳语言"。每条理由都对应着 trade-off：类型系统带来运行时开销、全栈统一在引入新端（如原生 mobile）时会失效、异步模型在 CPU 密集推理任务上不如 Python 生态。

## 设计哲学：不是框架，不是 SaaS，而是"你的"agent

aptbot 的 README 里有句话：**"不是框架，不是 SaaS，而是'你的' agent"**。这句话浓缩了三个设计取舍：

**不是框架**——意味着 aptbot 不追求"给开发者用"的通用 API。代码可以直接读、直接改，不需要为可扩展性预留抽象。这降低了代码复杂度，提升了可读性，代价是别人不能"基于 aptbot 二次开发"——但这不是目标。

**不是 SaaS**——意味着 aptbot 不托管用户数据，不提供托管服务，所有运行实例都是用户自部署。这换来了隐私、可定制性、零依赖外部服务，代价是没有"开箱即用"的便捷。落地页的 Demo 是同一个实例的演示，不是多租户服务。

**是"你的"agent**——意味着 aptbot 的所有设计都假设"用户能看懂代码、能改代码、能自己部署"。文档、注释、ARCHITECTURE.md、这套学习文章，都是为了让用户从"使用者"变成"理解者"。这是 aptbot 与商业 agent 产品最大的差异：**它假设你愿意理解它**。

## 小结

aptbot 的四层架构不是教条，是"可替换 + 可测试"的工程结果。单向依赖让每一层都能独立演进，shared 承载跨层纯逻辑。与同类项目相比，aptbot 选了"应用型 + 教学型"的窄定位，用 TypeScript 平衡类型安全与全栈统一。它的设计哲学——"你的 agent"——决定了后续每一项功能决策的优先级。

接下来 8 篇文章进入核心特性深入篇，每一篇拆解一个具体子系统：Provider、Tool、Memory、Skills、Hook、Channel、Session、Security。它们是 core + infrastructure 的具体内容。
