---
slug: "04-tool-system"
title: "Tool 系统：声明式 registry 与安全边界"
description: "AgentTool 接口、ToolRegistry 声明式注册、4 个内置工具、TypeBox 参数校验、超时/OOM/路径遍历防护，以及与 GA code_run 万能工具的权衡"
track: agent-practice
chapter: 核心特性深入篇
order: 4
difficulty: intermediate
estimatedReadingTime: 10
status: published
prerequisites:
  - 03-provider-system
lastUpdated: "2026-07-01"
tags:
  - tool
  - security
  - registry
---

# Tool 系统：声明式 registry 与安全边界

agent 没有 tool 就只是 chatbot。tool 让 agent 能"做事"——执行命令、读写文件、改自己的记忆。但 tool 也是 agent 与外部世界交互的危险接口：一个能执行 bash 的 tool，意味着模型能跑任意命令。这篇文章看 aptbot 如何设计 tool 系统既给模型足够的能力，又守住安全边界。

## AgentTool 接口与 ToolRegistry 声明式注册

aptbot 的每个 tool 都实现 `AgentTool` 接口，包含：

- **name**：工具名，模型在 function call 中引用
- **description**：给模型看的说明，决定模型何时选择这个工具
- **inputSchema**：TypeBox schema，描述参数结构
- **execute(args, ctx)**：实际执行函数

工具不直接被 agent 调用，而是注册到 `ToolRegistry`。AgentLoop 在每一轮把 registry 里所有工具的 name+description+inputSchema 转成 function 列表发给 LLM，LLM 选择调用哪个、传什么参数，AgentLoop 再从 registry 取出对应工具执行。

声明式注册的好处：

1. **可枚举**：registry 一眼能看到 agent 拥有的全部能力。审计安全时不需要追代码，看 registry 就行。
2. **可替换**：替换一个 tool 只改注册，不动 agent 循环。
3. **可测试**：每个 tool 独立测试，不需要拉起整个 agent。

## 4 个内置工具

aptbot 0.2.x 内置 4 个工具：

- **bash**：执行 shell 命令。最强大也最危险，是 agent "动手"的主要途径。
- **read**：读文件。比 bash 限制度高，只读不写，且加了大文件防护。
- **edit**：改文件。基于"找旧字符串、替换新字符串"的精确编辑模式，避免整文件覆盖的风险。
- **update_working_memory**：让 agent 主动更新自己的工作记忆。这是 agent "记住"事情的工具。

这 4 个工具覆盖了"执行 / 读 / 写 / 记忆"四类基本操作。看起来朴素，但 90% 的 agent 任务都能用它们完成。这种"少而精"的工具集是 aptbot 的有意选择——下一节解释为什么不走"万能工具"路线。

## 参数 TypeBox schema 校验

每个工具的 inputSchema 是 TypeBox schema。LLM 返回的参数必须通过 schema 校验才能进入 execute。

校验解决两类问题：

1. **模型输出不稳定**：LLM 偶尔会返回结构错乱的 JSON（缺字段、类型错、多余字段）。schema 校验把这些挡在 execute 之外，避免工具内部因为参数问题崩。
2. **安全约束**：schema 可以加约束，比如路径必须是相对路径、命令长度上限、参数白名单。这是工具的第一道安全门。

校验失败的反馈也会发回给 LLM，让它在下一轮纠正。这形成了"模型尝试 → 校验拦截 → 错误反馈 → 模型修正"的闭环。

## 30s 硬超时 + 大文件 OOM 防护

工具执行有两个硬性安全限制：

**30 秒硬超时**：bash 工具执行任何命令都不能超过 30 秒。超时后先 SIGTERM，给进程优雅退出的机会；再过几秒还没退出就 SIGKILL 强制杀。这防止 agent 卡在"等一个 hang 住的命令"上——比如 `npm install` 网络问题、`sleep 1000` 测试、死循环脚本。

为什么是 30 秒？这是经验值。大多数有用的命令（git 操作、文件处理、测试运行）都在 30 秒内完成。给得太短（5 秒）会误杀合理操作，给得太长（5 分钟）会让 agent 卡死。30 秒是在"保护 agent 不被卡死"与"允许合理长任务"之间的折中。

**大文件 OOM 防护**：read 工具读文件时检查文件大小，超过阈值（如 10MB）拒绝读取。这防止 agent 因为读了一个巨大的日志文件、二进制文件导致 Node.js 进程 OOM 崩溃。agent 经常会"好奇地"读 data/ 目录下的文件，没有这道防线很容易把自己读死。

## 路径遍历防护（path-guard）

bash 和 edit 工具都涉及文件路径。攻击者（或模型自身的"探索欲"）可能尝试路径遍历：`../../etc/passwd`、`/etc/shadow`、`~/.ssh/id_rsa`。

aptbot 的 path-guard 把所有路径规范化为"workspace 内的绝对路径"：

1. 解析所有 `..` 和符号链接，得到真实绝对路径
2. 检查这个路径是否在 workspace 根目录之内
3. 不在则拒绝

这把工具的文件操作限制在 workspace 内。agent 能改自己项目里的文件，但不能碰 workspace 外的系统文件。这是"沙箱"的最小实现——不引入 OS 级沙箱（chroot、容器），只用路径校验，但对个人学习项目足够。

## systemPrompt 安全约束

除了工具层面的防护，aptbot 在 systemPrompt 里也写了硬约束：明确告诉模型"不要执行 X 类操作"——不要修改 .env、不要执行 sudo、不要写 ~/.ssh、不要 git push --force 等。

systemPrompt 约束不是技术防线（模型可以违反），是行为引导。它解决的是"模型不知道某些操作危险"的问题——大多数违规操作不是因为模型恶意，而是因为它不知道这是禁区。明确告诉它边界，大多数情况它会遵守。

systemPrompt 与工具校验形成两层防护：systemPrompt 引导行为，工具校验兜底技术边界。两者缺一不可——只有 systemPrompt 会被模型偶尔忽略，只有工具校验会让模型反复尝试直到撞墙。

## 与 GA code_run 万能工具的权衡

GenericAgent 走的是另一条路：只有一个 `code_run` 工具，让模型用 Python 代码完成所有事。读文件、调 API、改数据，都写成 Python 代码丢给 code_run 执行。

这条路线的好处：

- 工具数量极少（只 1 个），registry 简单
- 模型能写任意逻辑，灵活度最高
- 适合数据科学、批量处理类任务

代价：

- 安全边界难定：代码能做任何事，路径校验、超时、OOM 防护都得在 Python 沙箱里实现，复杂度高
- 调试难：模型写的 Python 代码出 bug 时，agent 要自己读 traceback、改代码、重试，循环成本高
- 与宿主语言割裂：宿主是 Python（GA 本身是 Python），但工具调用是"在 Python 里跑 Python"，状态传递有边界

aptbot 选了"多工具、每个工具能力受限"的路线：

- 每个工具都有明确的 inputSchema，校验简单
- 工具能力受限（bash 是最宽的，read/edit 都加了防护），安全边界清晰
- 工具是 TypeScript 实现，与宿主一致，调试容易
- 适合"代码维护、文件操作"类任务

这两条路线没有对错，是不同的设计哲学。GA 追求灵活度，aptbot 追求可控性。对 aptbot 的"个人学习项目"定位，可控性优先级更高——每一个安全边界都是一个学习点，加一个万能工具就抹掉了这些学习点。

## 小结

Tool 系统是 agent 的双手，也是它最危险的接口。aptbot 用声明式 registry 让能力可枚举、TypeBox schema 让参数可校验、4 个内置工具覆盖基本操作、30s 超时与 OOM 防护防止 agent 卡死、path-guard 把文件操作限制在 workspace 内、systemPrompt 引导行为边界。与 GA code_run 的对比展示了"多工具受限"与"单工具万能"两条路线的取舍。

下一篇文章看 Memory 系统：agent 如何记住跨轮、跨会话的上下文，以及为什么记忆需要压缩。
