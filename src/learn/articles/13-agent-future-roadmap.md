---
slug: "13-agent-future-roadmap"
title: "Agent 的未来演进路线"
description: "L2/L3 路线、多 modal、MCP、自演化 skill 远期愿景、浏览器/系统控制展望、空闲自主行动展望、项目即学习核心理念"
track: agent-practice
chapter: 演进路线篇
order: 13
difficulty: advanced
estimatedReadingTime: 11
status: published
prerequisites:
  - 12-aptbot-evolution
lastUpdated: "2026-07-01"
tags:
  - roadmap
  - future
  - mcp
  - autonomous
---

# Agent 的未来演进路线

这是 Track 1 的最后一篇。前面 12 篇讲的是 aptbot 已有的设计与实现，这篇讲未来——从 0.2.3 出发的 L2/L3 路线、多 modal、MCP、自演化 skill、浏览器与系统控制、空闲自主行动的远期展望。最后回到 aptbot 的核心理念："项目即学习"。

## L2 路线：可靠性深化 + IM 集成 + WebUI 拆分

L2 是 0.2.3 之后的近期路线，三条主线：

**可靠性深化**：0.2.2 把基础可靠性建起来了（故障转移、错误分类、超时、OOM 防护），L2 继续深化。具体方向包括 FallbackProvider 熔断（连续失败 N 次后短期不再尝试，避免持续浪费配额）、更精细的错误分类（区分"模型输出错"与"协议错"）、resync 协议的边界 case 处理（如 sequence number 回绕）。

**IM 集成（Telegram 首通道）**：把 aptbot 接到 Telegram。这是 Channel 抽象的第一个"非 WebSocket"实现，验证抽象设计的正确性。Telegram 接入后用户能在手机 Telegram 里用 aptbot，agent 能力从桌面扩展到移动 IM。难点是把流式事件"折叠"成 IM 消息（IM 是一条一条消息，aptbot 是流式 token），需要适配层。

**WebUI 拆分到 Cloudflare Pages**：当前 WebUI 与服务端在同一份代码里（src/webui/ + src/access/），部署时一起跑。L2 拆分 WebUI 为独立前端，部署到 Cloudflare Pages，服务端只暴露 API。这降低服务端资源占用（静态资源走 CDN）、提升 WebUI 加载速度、让 WebUI 能独立迭代。

L2 的核心主题："让 aptbot 在更多场景可用"。可靠性深化让 agent 在更多边界条件下不崩，IM 集成让 agent 在更多端可用，WebUI 拆分让 agent 部署更灵活。

## L3 路线：熔断 + OAuth + session 分支 + 跨 session 记忆 + IM 扩展 + AgentHarness + subagent

L3 是中期路线，能力扩展更深：

**FallbackProvider 熔断**：MixinProvider 的进化。当前 MixinProvider 在 primary 失败时切 secondary，但 primary 恢复后会立即切回（springBackMs）。熔断机制让 primary 连续失败 N 次后进入"熔断状态"，在 M 分钟内不再尝试 primary（即使 springBackMs 到了），避免"primary 反复短暂恢复又掉线"导致的反复切换抖动。

**OAuth 集成**：当前 aptbot 用本地 UserStorage（用户名 + 密码）。L3 加 OAuth，支持 Google / GitHub / 飞书等第三方登录。这对 IM 接入后的多用户场景重要——用户用 Telegram 登录后，aptbot 需要识别"这个 Telegram 用户对应哪个 aptbot 用户"，OAuth 提供这条关联。

**session 分支**：当前 session 是线性的——一个 session 一条历史线。L3 加 session 分支，用户能从某个 turn 分叉出新 session，"如果当时换条路会怎样"。这对探索性任务有用——agent 修 bug 时尝试方案 A 失败，用户能从尝试前的 turn 分支，让 agent 试方案 B，不丢方案 A 的探索记录。

**跨 session 长期记忆**：当前 session 之间完全隔离，agent 不记得"昨天在另一个 session 做过什么"。L3 加跨 session 记忆（参考 GA L2/L3 三层架构），agent 能记住跨 session 的事实性知识（"用户偏好用 vitest 而非 jest"、"这个项目用 pnpm"）。

**飞书 / 钉钉 IM 接入**：Telegram 之后接国内 IM。这条路线主要是工程量（每个 IM 一套适配器），不引入新抽象——Channel 接口已经够通用。

**AgentHarness**：agent 的"测试框架"。让 agent 在受控环境里跑预设场景，断言行为。这对 agent 自身开发重要——目前测试覆盖的是"模块行为"，AgentHarness 能覆盖"agent 端到端行为"，如"给 agent 这个任务，它应该调 bash 工具 N 次、最终修改这个文件"。

**subagent 管理**：让 agent 能启动子 agent。如主 agent 接到"重构这个模块"任务，启动一个 subagent 专门做"读取模块依赖关系"，subagent 完成后把结果交回主 agent。这让 agent 能并行处理多步任务，而非纯串行。

L3 的核心主题："让 agent 更智能、更协作"。熔断让 agent 更稳定、OAuth 让 agent 适配真实多用户、session 分支让 agent 支持探索、跨 session 记忆让 agent 长期累积、subagent 让 agent 能拆解大任务。

## 多 modal：图像输入/输出

当前 aptbot 是纯文本——LLM 输入是文本，输出是文本，工具调用是文本参数。多 modal 加图像：

**图像输入**：用户能贴一张截图给 agent，agent 用 vision 模型理解图像内容。这对"agent 修 UI bug"场景重要——用户贴 bug 截图，agent 看图就知道问题在哪。

**图像输出**：agent 能生成图像（如用 DALL-E / Stable Diffusion）。这让 agent 不止能"改代码"，还能"做设计"——如生成项目 logo、绘制架构图。

多 modal 的技术挑战主要在 Provider 层——OpenAI / Anthropic 的 vision API 与纯文本 API 在消息格式上不同（图像是 image_url 字段或 base64），需要 Provider 适配。AgentLoop 层改动不大——messages 数组里多了 image 类型，event 流里多了 image_chunk 类型。

## MCP：Model Context Protocol 工具扩展

MCP（Model Context Protocol）是 Anthropic 提出的开放协议，让 agent 能从外部 MCP server 加载工具。它的价值在于"工具生态共享"——一个 MCP server 提供的工具，任何支持 MCP 的 agent 都能用。

aptbot 接 MCP 后，用户能直接复用社区已有的 MCP server（如 GitHub MCP、Slack MCP、数据库 MCP），不需要 aptbot 自己开发这些工具。这把 aptbot 的工具能力从"4 个内置"扩展到"无限"。

MCP 接入的挑战是"工具质量参差"——MCP server 提供的工具，inputSchema 可能不严格、execute 可能有副作用、安全边界不清晰。aptbot 接入时需要保留自己的校验层（path-guard、超时、OOM 防护），不能盲信 MCP server。

## 自演化 skill 的远期愿景

0.2.x 的 skills 是静态的——用户写好 skill 文件，agent 按需加载。远期愿景是自演化 skill：agent 在执行任务时，如果发现"这个任务的方法值得记下来"，自己写新的 skill 文件存到 workspace。

自演化 skill 的难点：

1. **质量控制**：agent 写的 skill 可能是噪音（"我尝试了 X 失败了"不该存成 skill）。需要某种过滤机制——如 LLM 自评"这个 skill 值得保留吗"。
2. **冲突管理**：新 skill 与现有 skill 冲突时如何处理？是覆盖、是合并、是并存？
3. **可解释性**：用户需要能审计 agent 自己写的 skill，否则就是黑箱。
4. **演化压力**：skill 太多会让 L1 索引爆，需要"淘汰不常用 skill"的机制。

GA 已经实现了自演化 skill 的初步版本，是它 autonomous 能力的关键基础。aptbot 的自演化 skill 是 L3 之后的工作，但 skills 系统的两层加载、最小 frontmatter、热重载这些基础，已经为未来演进铺好了路。

## 浏览器/系统控制能力的远期展望（参考 GA TMWebDriver）

当前 aptbot 的工具是"开发者向"——bash、read、edit、update_working_memory，都围绕代码项目。远期能力扩展是"浏览器/系统控制"：

**浏览器控制**：agent 能驱动浏览器（如 Playwright/Puppeteer），打开网页、点击按钮、填表单、截图。这让 agent 能做"在网页上完成 X"的任务——如"帮我订下周二的机票"、"把这个网页的内容整理成 markdown"。

**系统控制**：agent 能驱动操作系统——切换应用、操作文件管理器、配置系统设置。这让 agent 能做"在电脑上完成 X"的任务——如"清理下载文件夹里 30 天前的文件"。

GA 的 TMWebDriver 是浏览器控制的具体实现，证明了 LLM + 浏览器驱动的可行性。aptbot 远期可以参考这个路线，但不会很快做——浏览器/系统控制的安全边界比文件操作复杂得多，需要更成熟的沙箱与权限模型。

## 空闲自主行动的远期展望（参考 GA autonomous）

当前 aptbot 是"被动响应"——用户发消息 agent 才动。远期愿景是"空闲自主行动"：agent 在用户没发消息时也能主动做事。

具体场景：

- **后台监控**：agent 监控某个仓库的 issue，有新 issue 时主动分析并提示用户
- **定期任务**：agent 每天早上整理昨天的工作笔记，生成日报
- **持续优化**：agent 空闲时审视自己的 skill 库，淘汰过时 skill、合并重复 skill

这是 GA autonomous 的核心特性，也是 agent 从"工具"走向"助手"的关键。但实现难度高——需要 agent 能判断"什么值得做"，否则会变成噪音源；需要用户能信任 agent 的自主行为，否则会担心"它会不会乱搞"。

aptbot 的空闲自主行动不会很快做。当前优先级是先把"被动响应"做扎实——一个被动响应都不可靠的 agent，自主行动只会放大不可靠。

## "项目即学习"的核心理念：aptbot 既是工具也是教材

回到 aptbot 的核心理念，也是这套学习文章的出发点：**aptbot 既是工具也是教材**。

这有两层含义：

**aptbot 是工具**——它能用。用户能 clone、部署、用它做代码维护、用它跑 agent 任务。它不是 demo，不是 prototype，是能长期使用的工具。

**aptbot 是教材**——它能学。用户能读它的源码、读它的 ARCHITECTURE.md、读这套学习文章，理解每个设计决策的来龙去脉。它不是黑箱，不是"用就完了"，是"用 + 学"一体的项目。

这两层不冲突，相互加强：

- 作为工具，aptbot 的每个设计决策都有真实场景驱动，不是空想。这让教材内容"接地气"——讲 Provider 故障转移，是因为真发生过 provider 故障；讲 path-guard，是因为真有路径遍历风险。
- 作为教材，aptbot 的每个设计都有文档与注释，让工具更易维护。用户改 aptbot 时不需要"逆向工程"，直接读文档就知道为什么这么设计。

这套 13 篇文章是"项目即学习"理念的落地——把 aptbot 的设计、实现、演进整理成可读的文字，让"用 aptbot"的用户能成为"理解 aptbot"的学习者。如果有一天用户读完这 13 篇，能自己改 aptbot、扩展 aptbot、甚至写出自己的 agent，那就是这个项目最大的成功。

## Track 1 结语

13 篇文章从"agent 是什么"开始，经过 aptbot 的架构、Provider、Tool、Memory、Skills、Hook、Channel、Session、Security、Error/UX、演进回顾，到这篇未来展望结束。这条路径本身是"理解 agent"的一个完整框架——从原理到实现到演进。

如果你读完了这 13 篇，你应该能：

- 解释 agent 与 chatbot 的本质差异
- 理解 aptbot 的四层架构与单向依赖
- 描述 Provider/Tool/Memory/Skills/Hook/Channel/Session 各自的职责
- 看 aptbot 的安全模型如何多层叠加
- 用 reducer 模式解释流式 UX 的工作原理
- 复述 aptbot 从 MVP 到 0.2.2 的演进路径
- 说出 aptbot 未来 L2/L3 路线的核心方向

更重要的是，你应该建立了"agent 系统设计"的心智模型——遇到一个新 agent 项目，能问出对的问题：它的工具系统怎么设计？记忆如何持久化？错误如何处理？多端如何接入？安全边界在哪？这些问题的答案各不相同，但问问题的方式是通用的。

Track 1 结束，但 aptbot 的演进没结束。下一版本会有新特性、新文章、新决策。这套学习文章会随项目演进，"项目即学习"是持续过程，不是终点。

如果你继续到 Track 2，会看到 AI 辅助编码的通用方法论——Track 1 讲"agent 这个东西怎么造"，Track 2 讲"造这个东西的过程中，AI 辅助开发怎么用"。两个 Track 互补：一个是产物，一个是过程。
