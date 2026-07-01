---
slug: "03-provider-system"
title: "Provider 系统：多协议、多模型、故障转移"
description: "Api 与 Provider 分离的设计、三种 API 协议、双时钟流式控制、错误分类重试、MixinProvider 故障转移，以及与 nanobot/GA 的对比"
track: agent-practice
chapter: 核心特性深入篇
order: 3
difficulty: intermediate
estimatedReadingTime: 10
status: published
prerequisites:
  - 02-aptbot-architecture
lastUpdated: "2026-07-01"
tags:
  - provider
  - streaming
  - retry
  - fallback
---

# Provider 系统：多协议、多模型、故障转移

agent 的"大脑"是 LLM，但 LLM 不是直接调用——它通过 Provider 系统接入。Provider 系统是 aptbot 与外部模型服务对接的门面，承担三类职责：协议适配、流式控制、故障转移。这篇文章拆解这三块的设计决策。

## Api 与 Provider 分离

aptbot 区分两个概念：**Api**（协议）和 **Provider**（服务商）。

- Api 描述"怎么对话"——请求/响应格式、流式协议、错误码语义。
- Provider 描述"和谁对话"——具体的服务商（OpenAI、Anthropic、自部署 vLLM…），含 endpoint、apiKey、model 名。

为什么要分离？因为同一个协议会被多个服务商实现。OpenAI 的 chat completions 协议被 Azure OpenAI、OpenRouter、本地 vLLM、DeepSeek 等数十家服务商实现。如果协议与服务商耦合，每加一个服务商都要重写一遍流式解析与错误处理。分离后，新增一个"用 OpenAI 协议的服务商"只需填 endpoint+apiKey+model 三项配置，协议逻辑完全复用。

这个分离让 aptbot 的模型接入成本极低：你换了服务商，但只要协议没变，agent 行为完全一致。

## 三种 API 协议

aptbot 0.2.x 内置三种 API 协议：

1. **openai-completions**：OpenAI 的 Chat Completions API，业界事实标准。请求是 messages 数组，响应是流式 chunk（含 delta.content）。绝大多数兼容服务商都用这个。
2. **openai-responses**：OpenAI 较新的 Responses API，原生支持工具调用、多 modal、推理模型。当 agent 需要这些能力时切到这个协议。
3. **anthropic-messages**：Anthropic 的 Messages API，与 OpenAI 协议不兼容（事件类型、tool 调用结构都不同）。Claude 系列模型走这个协议。

每种协议都有自己的 Provider 实现类，负责：把 aptbot 内部的统一 messages 格式转成协议请求、把协议的流式事件流转成 aptbot 内部的 AgentEvent 流。这意味着 agent core 永远只看到统一的 AgentEvent，不知道也不需要知道底层是哪个协议。

## 双时钟流式控制

LLM 流式响应有两个独立的失败模式：

1. **首字节超时（TTFB）**：请求发出后，迟迟收不到第一个 token。可能是服务商拥塞、模型加载、网络问题。aptbot 设 5 秒 TTFB 上限——5 秒内没有首字节就认为这次请求失败。
2. **块间超时**：流已经开始，但两个 chunk 之间卡住。可能是中间网络抖动、服务端 hang。aptbot 设 1.5 秒块间上限——任意两个 chunk 间隔超过 1.5 秒就认为流断了。

为什么用两个时钟？因为它们对应不同的故障特征。TTFB 长但流稳：服务端在准备，应该等。流式开始后卡住：服务端 hang 了，等也没用。一个时钟盖不住两种情况——5 秒 TTFB 对于"已开始流"是过宽松的（你不会想在流式开始后再等 5 秒），1.5 秒块间对于"未开始流"是过严的（模型还在加载）。

两个时钟各自独立、各自触发故障转移。这是流式系统常见的"双看门狗"模式。

## 错误分类重试

不是所有错误都该重试。aptbot 把错误分三类：

- **fatal（401/403/400）**：认证失败、权限不足、请求格式错。重试也是同样的错，立即放弃，不切 provider。
- **transient（429/5xx）**：限流、服务端临时故障。指数退避重试（1s → 2s → 4s…），多次失败后切 provider。
- **network（ECONNRESET/timeout）**：网络层问题。同 transient 处理。

这个分类的核心原则是"重试要有意义"。401 重试 100 次还是 401，纯粹浪费配额和延迟。429 重试有意义（限流窗口可能已过），但要用退避避免雪上加霜。

退避不是无脑指数——aptbot 加了 jitter（随机抖动）避免多个客户端同步重试。每次重试都重新检查时钟，不把"已经等了很久"的请求当作"刚发起"的请求处理。

## MixinProvider 故障转移

单个 Provider 即使重试也可能持续失败（服务商宕机、配额耗尽）。MixinProvider 解决这个问题：包装多个 Provider，按优先级顺序尝试，第一个失败切第二个，全失败才报错。

故障转移的关键设计：

- **优先级顺序**：primary → secondary → tertiary。primary 是首选，secondary 是备份。
- **springBackMs 弹回**：切到 secondary 后，不永久切走。每隔 springBackMs 毫秒尝试一次 primary，如果恢复就切回。这避免了"primary 短暂故障后永久使用 secondary"的资源浪费。
- **状态隔离**：每个 Provider 各自维护重试计数，互不污染。primary 的 429 不会让 secondary 的计数器归零。

弹回机制让 MixinProvider 在长时间运行中自动收敛到"最优 provider"——只要 primary 大部分时间可用，secondary 只在 primary 故障窗口期被使用。

## 流式已 yield 后出错不切 provider

这条规则容易忽略但非常关键：**如果流已经开始 yield（已经向用户输出了部分内容），即使后面出错，也不切 provider**。

为什么？因为切 provider 意味着重发请求、重新生成。但用户已经看到了前半段输出，重新生成会得到不同的内容，造成"半截话被替换"的混乱体验。这种情况下，aptbot 选择把错误暴露给用户（"流式中断"），让用户决定是重试还是放弃。

这是"正确性 vs 完整性"的取舍：不切 provider 牺牲了完整性（输出被截断），但保住了正确性（已输出的是真实生成内容，不是被偷偷替换的）。

## 与 nanobot FallbackProvider / GA MixinSession 对比

nanobot 的 FallbackProvider 也是多 provider 故障转移，但它的弹回策略是"冷却时间"——切走后固定冷却 N 秒再尝试。aptbot 的 springBackMs 是"持续试探"——每隔 N 毫秒试一次，更激进。差异源于定位：nanobot 是给生产环境用的，保守优先；aptbot 是学习项目，可以更激进地探索最优路径。

GA 的 MixinSession 是另一个思路：它把"切换"做到 session 级——一个 session 绑定一个 provider，切换意味着新 session。这换来了 session 内一致性（不会中途换模型），代价是无法在同一 session 内故障转移。aptbot 选了 session 内故障转移，因为 agent 任务往往跨多轮，session 重置成本太高。

## 小结

Provider 系统是 agent 与 LLM 服务对接的门面。Api/Provider 分离让协议复用、三种协议覆盖主流服务商、双时钟流式控制处理两类失败、错误分类避免无意义重试、MixinProvider 实现故障转移、流式后不切 provider 保住正确性。每一项决策都对应一个具体的可靠性问题，不是抽象的"高可用"口号。

下一篇文章看 Tool 系统：让 agent 真正"做事"的双手，以及它如何设置安全边界。
