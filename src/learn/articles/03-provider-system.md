---
slug: "03-provider-system"
title: "Provider 系统：多协议、多模型、故障转移"
description: "Api 与 Provider 分离的设计动机、三种 API 协议、双时钟流式控制、错误分类重试与退避、MixinProvider 故障转移与弹回机制，以及三种 provider 管理方案对比"
track: agent-practice
chapter: 核心特性深入篇
order: 3
difficulty: intermediate
estimatedReadingTime: 22
status: published
prerequisites:
  - 02-aptbot-architecture
lastUpdated: "2026-07-02"
tags:
  - provider
  - streaming
  - retry
  - failover
  - llm
---

在上一篇架构文章中，我们知道 Provider 是 core 层的关键组件之一——它是 agent 与 LLM 服务之间的桥梁。但这座桥梁不是一根直通的管道，而是一套包含协议适配、流式控制、错误分类、故障转移的完整系统。

这篇文章会从"为什么需要 Provider 系统"开始，逐步拆解它的每一层设计：API 与 Provider 的分离、三种内置协议、双时钟流式控制、错误分类与退避重试、MixinProvider 的故障转移与弹回机制。最后对比三种不同的 provider 管理方案，看 aptbot 为什么选择了目前的路线。

## 一、概念：从"调 API"到"Provider 系统"

### 1.1 最朴素的做法

在最简单的 agent 实现中，"调 LLM"可能就是几行代码：

```typescript
const response = await fetch('https://api.openai.com/v1/chat/completions', {
  method: 'POST',
  headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ model: 'gpt-4', messages: [...] }),
});
const data = await response.json();
```

这在一个模型、一个服务商、不在意故障的场景下够用。但一旦场景变复杂——要用 Claude、要用本地部署的模型、要处理服务商宕机、要做故障转移——这几行代码就会迅速膨胀成难以维护的泥球。

Provider 系统的诞生就是为了管理这种复杂性。它把"和 LLM 通信"这件事拆解成多个可组合的层次，每一层解决一个特定问题。

### 1.2 两个核心概念：Api 与 Provider

aptbot 在 Provider 系统中区分两个核心概念：

**Api（协议）** 描述的是"怎么对话"——请求和响应的格式是什么、流式事件如何解析、错误码有什么语义。它是一个通信协议的定义。

**Provider（服务商）** 描述的是"和谁对话"——具体的服务商是谁（OpenAI、Anthropic、自部署的 vLLM…），它的 endpoint 是什么、apiKey 是什么、有哪些 model 可选。

为什么要把这两个概念分开？因为**同一个协议会被大量服务商实现**。OpenAI 的 Chat Completions 协议被 Azure OpenAI、OpenRouter、本地 vLLM、DeepSeek、Together AI 等数十家服务商实现。如果协议和服务商耦合，每加一个服务商都要重写一遍流式解析、错误处理、重试逻辑。分开后，新增一个"用 OpenAI 协议的服务商"只需要填写 endpoint + apiKey + model 三项配置，协议解析逻辑完全复用。

这种分离带来的工程收益很直接：aptbot 0.2.x 内置了三种 API 协议，但通过这三种协议可以接入的服务商数量远大于三——只要对方兼容 OpenAI 或 Anthropic 的协议，就能接入。

## 二、通用设计方案：Provider 系统的核心组件

无论采用哪种 agent 框架，一个完整的 Provider 系统通常需要解决以下几个问题。

### 2.1 协议适配

不同 LLM 服务商的 API 互不兼容。OpenAI 用 `messages[]` 数组 + `delta.content` 的流式格式；Anthropic 用 `content[]` 块 + 不同的事件类型；Google Gemini 又是一种格式。协议适配层负责把 agent 内部的统一消息格式转换成各个服务商的请求格式，再把各自的响应格式转换回统一的事件流。

这是一个典型的"适配器模式"——每个协议一个适配器，适配器之间的接口一致，agent core 只跟统一接口对话。

### 2.2 流式控制

LLM 响应是流式的，不是一次性返回的。流式控制主要解决两个问题：

- **超时检测**：请求发出后多久没收到首字节算超时？流开始后两个 chunk 之间间隔多久算断了？
- **流式中断处理**：用户中途取消、网络断开、服务端异常导致流中断，系统如何响应？

流式控制如果不做精细化管理，用户就会遇到"转圈圈停不下来"或"卡住不动也不知道是不是还在跑"的糟糕体验。

### 2.3 错误分类与重试

LLM 调用的错误类型多样：有的是请求格式问题（400），有的是认证问题（401），有的是配额超限（429），有的是服务端临时故障（5xx），有的是网络层问题（ECONNRESET）。不同类型的错误需要不同的处理策略——有些需要重试，有些重试也没用。

如果所有错误都用同一套重试逻辑，结果就是：该重试的不够次数，不该重试的浪费配额。

### 2.4 故障转移

单服务商总有不可用的时候——配额耗尽、服务宕机、网络割裂。故障转移机制让 agent 在多个服务商之间自动切换，保证服务连续性。

核心问题包括：切换策略（优先级、轮询、并行）、回切策略（主服务恢复后是否自动切回）、状态管理（切换时当前请求怎么处理）。

## 三、aptbot Provider 系统的实现

理解了 Provider 系统要解决的通用问题，接下来看 aptbot 的具体实现。这是目前 aptbot 工程上最成熟的子系统之一。

### 3.1 API/Provider 分离的工程体现

在 aptbot 的代码结构中，API 和 Provider 被放在不同的目录下：

- `core/provider/api/`：每种 API 协议一个实现文件，负责协议层面的请求构建和响应解析
- `core/provider/providers/`：每个服务商一个实现文件，持有所属服务商的配置信息（endpoint、apiKey、model 列表）

新增一个服务商的流程是：选择一个已有的 API 协议实现（比如 `openai-completions`），在 `providers/` 下新建一个文件，填 endpoint 和 model 配置。协议解析逻辑完全继承自 API 层。

这种分离在实际维护中效果显著：当 OpenAI 修改了流式事件格式时，只需要改 `api/openai-completions.ts` 一个文件；当要接入一个"兼容 OpenAI 协议的新服务商"时，只需要在 `providers/` 下新增几行配置。

### 3.2 三种内置 API 协议

aptbot 0.2.x 内置了三种 API 协议，覆盖了当前主流的 LLM 服务：

**openai-completions**：基于 OpenAI Chat Completions 协议的实现。这是业界事实标准，请求格式是 `messages` 数组，流式响应是 SSE（Server-Sent Events），每个事件包含 `delta.content`。OpenAI、Azure OpenAI、OpenRouter、DeepSeek、vLLM、Together AI 等绝大多数兼容服务商都走这个协议。

**openai-responses**：OpenAI 较新的 Responses API 协议。相比 Completions，它原生支持工具调用、多模态输入（图片/音频）、推理模型（o1/o3）。当 agent 需要这些能力时切换到这个协议。与 Completions 共享 SSE 流式基础，但事件结构有所不同。

**anthropic-messages**：Anthropic 的 Messages API 协议。与 OpenAI 协议体系不兼容——请求格式不同（`content` 块而非 `messages` 数组）、流式事件类型不同（`content_block_delta` 系列事件）、工具调用结构也不同。Claude 系列模型必须走这个协议。

每种协议都实现同一个核心接口：

```typescript
stream(model, context, options): AsyncGenerator<AssistantMessageEvent>
```

这个接口对 agent core 完全透明。core 不关心底层是哪个协议，它只调用 `stream()` 方法，拿到统一的事件流。

### 3.3 双时钟流式控制

流式响应有两个互相独立的失败模式，aptbot 用"双时钟"分别处理：

![Provider 故障转移流程](/learn/articles/images/provider-failover.png)

**TTFB（Time To First Byte，首字节超时）**：请求发出后，服务端迟迟不返回第一个 token。可能的原因包括服务商拥塞、模型加载中、网络延迟。aptbot 设 5 秒上限——请求发出后 5 秒内没有收到任何数据，就认为这次请求失败。

**块间超时（inter-chunk timeout）**：流已经开始 yield 数据，但两个 chunk 之间卡住了。可能的原因包括中间网络抖动、服务端推理过程中 hang 住。aptbot 设 1.5 秒上限——任意两个 chunk 间隔超过 1.5 秒就认为流中断了。

为什么需要两个时钟而不是一个？因为它们对应不同的故障特征：

- TTFB 长但后续流稳定：服务端在准备阶段需要时间（比如模型加载），一旦开始生成就正常。这种情况下应该给足够的时间等待首字节。
- 流式开始后卡住：服务端推理过程中出了问题。这种情况下等待没有意义——如果已经生成了一半却突然卡住 5 秒，很可能是服务端挂了。

一个时钟盖不住这两种情况：5 秒 TTFB 对"已开始流"的场景过于宽松（你不会想在流式开始后还等 5 秒），1.5 秒块间对"未开始流"的场景又过于严格（模型加载可能超过 1.5 秒）。

两个时钟各自独立、各自触发故障转移。这是流式系统中常见的"双看门狗"模式——每个时钟监控一种故障模式，互不干扰。

### 3.4 错误分类与退避重试

不是所有错误都值得重试。aptbot 把错误分为三类：

**fatal 错误（400/401/403）**：请求格式错误、认证失败、权限不足。这些错误重试多少次结果都一样，因为问题在请求本身。aptbot 遇到 fatal 错误立即抛出异常，不重试、不切 provider。

**transient 错误（429/5xx）**：限流、服务端临时故障。这类错误有意义重试——限流窗口可能已经过去，服务端可能已经恢复。aptbot 用指数退避重试：第一次重试等待 1 秒、第二次 2 秒、第三次 4 秒。重试 3 次后如果还失败，就切换 provider。

**network 错误（ECONNRESET/ETIMEDOUT）**：网络连接被重置、请求超时。这类错误的特征和 transient 类似，按同样的策略处理：指数退避 + 重试 + 切 provider。

指数退避不是简单的"每次翻倍"——aptbot 加入了 **jitter（随机抖动）**。具体做法是在每次退避延迟上增加一个随机偏移量，避免多个客户端在同样的时间点同步重试（"惊群效应"）。如果 10 个客户端同时被限流，没有 jitter 的话它们会同时等 1 秒、同时重试、同时再次被限流——形成"重试风暴"。jitter 把这 10 个重试分散到 1 秒附近的不同时间点，大大降低再次冲突的概率。

### 3.5 MixinProvider 故障转移

即使有重试机制，单个 provider 也可能持续不可用——服务商大规模宕机、账户配额彻底耗尽。MixinProvider 解决这个问题。

MixinProvider 是 `Provider` 接口的一个特殊实现：它**包装多个子 Provider**，按优先级顺序尝试，前一个失败后自动切到下一个。所有子 Provider 共享同一个 API 协议（MixinProvider 在构造函数中校验协议一致性）。

核心机制：

- **优先级顺序**：子 Provider 数组中下标越小优先级越高。通常是 [primary, secondary, tertiary] 的排列。尝试时从第一个开始。
- **兜底失败**：所有子 Provider 都失败后，抛出 `AggregateError`，聚合所有子 provider 的错误信息，方便排查。不会"静默失败"或"返回半截结果"。
- **同协议约束**：所有子 Provider 必须使用同一种 API 协议（例如都是 openai-completions）。因为 MixinProvider 的切换是对上一层透明的——对 AgentLoop 来说，它只是同一个 Provider 接口，不能因为切换 protocol 就改变事件格式。

**springBackMs 弹回机制**：

切到 secondary provider 后，MixinProvider 不会永久停留在 secondary。它内置了一个弹回逻辑：每隔 `springBackMs` 毫秒（默认 5 分钟），下一次调用时会**重新尝试 primary provider**。如果 primary 可用，就切回去；如果仍然不可用，继续使用 secondary，并等待下一个弹回周期。

这个机制的直观意义是：**自动收敛到最优 provider**。primary 短暂故障（比如 2 分钟）后恢复，MixinProvider 会在 5 分钟内自动检测到并切回，不会"一次故障永久降级"。

为什么不直接永久切回？因为"试探"是有成本的——如果 primary 没有恢复，试探浪费了一次请求。springBackMs 的设置需要在"及时恢复"和"试探成本"之间做权衡。5 分钟是一个合理的默认值：对于大多数 LLM 服务商的故障场景（通常是分钟级的短暂中断），5 分钟足够恢复；同时 5 分钟一次试探的成本可以忽略。

**广播属性**：

MixinProvider 还有一个实用功能：`broadcastAttr(key, value)`。当设置一个属性（如 `temperature`、`maxTokens`、`systemPrompt`）时，它会自动同步到所有子 Provider。这样上层在切换 provider 时不需要关心属性的同步问题——AgentLoop 只管设一次，MixinProvider 负责分发。

### 3.6 流式已 yield 后出错不切换

这条规则容易被忽略，但非常关键：**如果流已经 yield 了数据（用户已经看到了部分输出），即使后面出错，也不切换 provider**。

为什么？假设这样一个场景：agent 正在通过 primary provider 流式输出回答，用户已经看到了"根据代码分析，这个 bug 的原因可能是…"的前半句，此时网络中断。如果 MixinProvider 此时切到 secondary provider 重新请求，会生成完全不同的后半句。用户看到的是"前半句来自 GPT-4，后半句来自 Claude"的混合内容——且不说内容可能不一致，用户甚至无法信任已看到的部分（因为后半段被偷偷替换了）。

aptbot 的处理方式是：**把错误暴露给用户，终止当前流**。在事件流中 yield 一个 `{ type: 'error', error: ... }` 事件，让用户知道"输出不完整，因为发生了 XX 错误"。用户决定是重试（重新开始完整生成）还是接受现有结果。

这是"正确性 vs 完整性"的明确取舍：**不切 provider 牺牲了完整性（输出被截断），但保住了正确性（已输出的部分是真实可信的）**。在 agent 输出中，"不可信的内容"比"截断的内容"严重得多——用户不知道哪些能信哪些不能信，整个 agent 的可信度被摧毁。

## 四、市面其他 Provider 方案对比

LLM 调用管理是每个 agent 项目都必须解决的问题。不同项目有不同的方案，这里用三种典型思路做对比。

### 4.1 方案 A：单 Provider 静态配置

最简单的方案——配置中写死一个 provider（如 `model: gpt-4`），所有请求都走这个 provider。

**特点：**
- 配置简单直接，一行 `model: gpt-4` 完事
- 没有故障转移，provider 挂了 agent 就崩
- 没有错误分类重试，请求失败直接报错
- 适合 demo 和原型阶段

**适用场景：** 快速原型、对可用性要求不高的个人实验。

**代价：** 零容错。一旦服务商炸了，agent 完全不可用。生产环境不可接受。

### 4.2 方案 B：链式透传

配置多个 provider，请求依次尝试——第一个失败就透传给第二个，第二个失败透传给第三个。

**特点：**
- 支持基础故障转移，比单 provider 可靠
- 配置灵活，可以按优先级组织 provider
- 但没有弹回机制——一旦切到 secondary，不会再尝试 primary
- 重试逻辑简单，通常没有错误分类
- 流式支持因实现而异

**适用场景：** 中小规模部署，需要基础高可用但不追求精细化。

**代价：** 配置复杂度显著高于方案 A；没有弹回机制导致"一次故障永久降级"；缺少错误分类导致 401 和 429 被同样处理（都重试），浪费配额。

### 4.3 方案 C：Mixin 多 provider 并行选优

最全面的方案——多个 provider 并行请求，取最快返回的结果。同时发起请求到 GPT-4 和 Claude，谁先回来用谁。

**特点：**
- 延迟最优——取最快响应，而不是等最慢的
- 天然故障容错——某个 provider 挂了不影响整体
- 但成本翻倍——每个请求都发到多个 provider
- 结果一致性难保证——不同模型的回复内容不同，怎么选优？
- 流式场景下并行开销更大——每个 token 流都要并行维持

**适用场景：** 对延迟极度敏感、不care成本、不要求回复结果一致性的场景。

**代价：** 成本 N 倍（N=并行 provider 数）；结果选择逻辑复杂；流式支持成本高。

### 4.4 方案对比

| 维度 | 方案 A（单静态） | 方案 B（链式透传） | 方案 C（并行选优） |
|---|---|---|---|
| 故障转移 | 无 | 有，单向 fallback | 天然容错 |
| 弹回机制 | 不适用 | 无 | 不适用 |
| 错误分类 | 无 | 无/简单 | 无 |
| 成本 | 低 | 中（fallback 请求额外成本） | 高（N 倍） |
| 延迟特征 | 正常 | fallback 时慢 | 最优 |
| 结果一致性 | 完全一致 | 不一致（不同 provider 内容不同） | 不一致 |
| 流式支持 | 完整 | 有限（透传实现复杂） | 困难（多流选择） |
| 配置复杂度 | 极低 | 中 | 高 |

## 五、aptbot 的设计特点

### 5.1 MixinProvider + 弹回机制的结合路线

aptbot 的选择本质上是一种"改良的方案 B"——基于优先级的链式 fallback，但增加了弹回机制作为弥补。

这个选择的核心考虑是：

**为什么不选方案 A（单静态）？** 因为 aptbot 是个人助理，不能"一个人用的时候就崩了"。故障转移不是锦上添花的功能，而是实际可用性的基础要求——今天 DeepSeek 宕机了，明天 OpenAI 限流了，agent 应该默默切到备用 provider 继续工作，而不是把错误抛给用户。

**为什么不选方案 C（并行选优）？** 因为成本。个人助理场景下，大部分请求都不是延迟敏感型的（agent 思考的过程用户本来就愿意等），为此付出双倍 API 成本不划算。更重要的是，并行选优在 agent 场景下有个致命问题——不同模型对同一个工具调用的结果可能不同，选优选到的"更快"结果可能不是"更正确"的结果，这会影响 agent 决策的稳定性。

**为什么选了链式 + 弹回？** 链式保证了"有备用方案"，弹回保证了"不会永久降级"。两者结合提供了适合个人助理场景的权衡：平时用 primary（最熟悉的模型、最稳定的服务商），primary 出问题时降级到 secondary，等待 primary 恢复后自动切回。用户几乎感知不到切换的发生。

### 5.2 教学可读性的体现

和核心架构一样，Provider 系统的代码也遵循"教学可读性优先"的约束：

- **错误分类显式可读**：`retry.ts` 中的 `classifyError()` 函数用清晰的 switch-style 逻辑（`if (status === 429) → retryable`），而不是用"错误码范围规则引擎"之类的抽象方案。前者代码量多一点但一目了然，后者更"聪明"但需要读者先理解规则引擎本身。
- **双时钟逻辑独立可读**：`dual-clock.ts` 中的 `withDualClock()` 是一个独立的 async generator 包装函数，不与其他逻辑耦合。读者可以单独阅读这 90 行代码来理解双时钟的全部细节。
- **MixinProvider 的单文件完整呈现**：故障转移的完整逻辑（优先级、重试、弹回、yield 后不切换、广播属性）全部在一个文件中呈现，约 220 行。读者不需要在多个文件间跳转来拼凑完整图景。

### 5.3 与方案 A/B/C 的差异总结

相比三种方案，aptbot 的 Provider 系统有这些独特之处：

**与方案 A 的差异**：aptbot 把 provider 故障转移作为核心能力内置（不是可选插件），因为"教学"的前提是 agent 真正能用——一个不处理故障的系统不是好教材。

**与方案 B 的差异**：aptbot 增加了细致的错误分类（fatal/transient/network）和双时钟流式控制，这不是在"把事情变复杂"，而是在展示 agent 系统的真实工程细节。好的教材应该让读者看到这些"真实世界的复杂性"。

**与方案 C 的差异**：aptbot 选择弹回机制而非并行选优，是因为成本约束和结果一致性在个人助理场景中优先级更高。这个选择本身也是教学素材——它展示了"工程决策就是取舍"。

## 六、发展方向

Provider 系统在 aptbot 的演进路线图中，有几个明确的改进方向：

**熔断机制（FallbackProvider）**：当前 MixinProvider 的弹回策略是"持续试探"——每隔 5 分钟尝试 primary 一次。但连续失败太多时，应该进入"熔断状态"，在更长时间内不再尝试，避免"反复短暂恢复又掉线"导致的抖动。这会在 L3 路线中以 `FallbackProvider` 的形式实现。

**更细粒度的时钟控制**：当前双时钟的超时时间（5s TTFB / 1.5s chunk-interval）是硬编码的配置项。未来可能支持 provider 级别的时钟配置（如对本地 vLLM 用更短的 TTFB，对 OpenAI 用更长的）。

**成本感知的 provider 选择**：当前优先级是固定的（primary / secondary / tertiary）。未来可能引入"成本 + 延迟 + 成功率"的综合评分，动态调整优先级。

## 小结

Provider 系统是 aptbot 工程复杂度最高的子系统之一，也是"可靠性"设计理念的集中体现。回顾本文核心内容：

1. **API/Provider 分离**让协议可复用、接入新服务商零协议编码。三种 API 协议（openai-completions / openai-responses / anthropic-messages）覆盖主流 LLM 服务商。
2. **双时钟流式控制**（5s TTFB + 1.5s 块间）分别应对首字节等待和流中卡顿两种故障模式，互不干扰。
3. **错误分类重试**（fatal/transient/network）+ 指数退避 + jitter 避免"重试无意义"和"重试风暴"两个极端。
4. **MixinProvider 故障转移**基于优先级链式 fallback + springBackMs 弹回机制，在做得到的情况下自动收敛到最优 provider。
5. **流式已 yield 后不切换 provider**，用正确性优先级高于完整性的原则，保证已输出内容可信。
6. **对比三种方案**（单静态 / 链式透传 / 并行选优），aptbot 的图像是"改良链式 + 弹回 + 教学可读性"。

Provider 系统解决了"大脑如何连接外部服务"的问题。下一篇文章看 Tool 系统——"双手如何做事"，以及 agent 执行工具时如何保证安全可控。
