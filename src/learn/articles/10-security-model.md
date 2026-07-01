---
slug: "10-security-model"
title: "安全模型：多层防护与信任边界"
description: "systemPrompt 约束、工具硬超时、双时钟流式、OOM 防护、路径遍历防护、JSONL 自修复、Cookie 安全、WS token、session ownership、API key、HTTP 头、future workspace 限制"
track: agent-practice
chapter: 核心特性深入篇
order: 10
difficulty: advanced
estimatedReadingTime: 11
status: published
prerequisites:
  - 09-session-multiuser
lastUpdated: "2026-07-01"
tags:
  - security
  - trust-boundary
  - defense-in-depth
---

# 安全模型：多层防护与信任边界

前面几篇文章散落提到不少安全设计：工具超时、路径校验、UUID、scrypt、Bearer token… 这篇文章把它们串起来，看 aptbot 的整体安全模型。安全不是单点，是多层防护的叠加——任何一层被绕过，下一层还能兜底。

## 信任边界：先明确谁信任谁

aptbot 的安全模型建立在明确的信任边界上：

- **用户信任 aptbot 代码**：用户自己部署 aptbot，能读所有源码。aptbot 不藏后门，不外发数据。
- **aptbot 信任用户**：用户能改 aptbot 代码、能写自己的 hook/skill、能配置 .env。aptbot 不防御用户自己——这是"信任边界内"。
- **aptbot 不信任 LLM 输出**：LLM 可能返回错误参数、有害内容、被注入的指令。所有 LLM 输出都校验。
- **aptbot 不信任外部输入**：HTTP 请求、WebSocket 消息、文件内容都可能恶意。所有外部输入都校验。

"信任边界内"的假设让 aptbot 不需要 OS 级沙箱、不需要权限隔离、不需要防用户自己——这大幅简化了实现。"信任边界外"的假设让 aptbot 必须校验 LLM 与外部输入——这是攻击面的主要来源。

## systemPrompt 安全约束

第一层防线在 systemPrompt 里——明确告诉 LLM 哪些操作是禁区：

- 不要执行 sudo 命令
- 不要修改 .env / ~/.ssh / ~/.aws 等敏感文件
- 不要 git push --force
- 不要修改 aptbot 自己的源码
- 不要安装新依赖

systemPrompt 不是技术防线（LLM 可能违反），是行为引导。它解决的是"LLM 不知道某些操作危险"的问题——大多数违规操作不是 LLM 恶意，是它不知道这是禁区。

systemPrompt 之外还有 hook 层的"软约束"——`tool_before` hook 可以拦截特定工具调用，记日志甚至取消执行。这是 systemPrompt 的补强——LLM 即使违反 systemPrompt，hook 还能拦一道。

## 30s 工具硬超时 + SIGTERM→SIGKILL

第二层防线在工具执行层：bash 工具 30 秒硬超时。

- 超时后先 SIGTERM（5 秒优雅退出窗口）
- 5 秒后仍不退出，SIGKILL 强制杀

这防止 agent 卡在"等一个 hang 住的命令"上——网络问题、死循环、长时间 sleep 都能被这个超时兜住。

SIGTERM→SIGKILL 两阶段是工程细节但重要——有些命令收到 SIGTERM 能清理临时文件、关闭连接、保存状态。直接 SIGKILL 会让这些清理来不及，留下垃圾文件或损坏状态。两阶段给清理机会，5 秒后还不走就强制杀。

## TTFB / 块间双时钟流式控制

第三层防线在 Provider 流式层：TTFB 5 秒 + 块间 1.5 秒双时钟。

- **TTFB 5 秒**：首字节超过 5 秒未到，认为是 provider 拥塞或网络问题，故障转移
- **块间 1.5 秒**：流式开始后任意两 chunk 间隔超过 1.5 秒，认为流断了

双时钟防止两种 DoS——provider 拖延不响应（TTFB 兜住）、provider 流到一半 hang（块间兜住）。没有这层，aptbot 可能挂在一个永远不返回的 provider 请求上，agent 完全卡死。

## 大文件 OOM 防护 + 工具结果截断

第四层防线在工具结果层：read 工具检查文件大小，超过阈值（如 10MB）拒绝读取；bash 工具的输出超过阈值（如 100KB）截断。

这防止两类 OOM：

- **进程 OOM**：读一个 1GB 的日志文件，Node.js 直接崩
- **Context OOM**：bash 输出 10MB，全部塞进 context，LLM 调用超 context window 报错

截断是"有用即可"的原则——agent 看工具输出的前 100KB 通常就够判断下一步，剩下的不塞进 context。如果真需要完整输出，agent 可以用 read 工具按行范围读，分批获取。

## 路径遍历防护

第五层防线在文件操作层：path-guard 把所有路径规范化为"workspace 内绝对路径"。

- 解析所有 `..` 和符号链接到真实路径
- 检查真实路径是否在 workspace 根目录内
- 不在则拒绝

这把 bash 和 edit 的文件操作限制在 workspace。agent 能改自己项目里的文件，但不能碰 `/etc/passwd`、`~/.ssh/id_rsa`、`~/.aws/credentials` 等系统敏感文件。

路径遍历防护是"最小权限"原则的体现——agent 不需要访问 workspace 之外的文件，给它这个能力只是增加风险，没有收益。

## JSONL 损坏自动修复

第六层防线在持久化层：JSONL 文件出现破损行时，stderr warning + skip + `fs.truncateSync` 截断到最后一个完整行。

破损来源：

- 写入中途进程崩溃（写到一半没写完）
- 磁盘满（写入失败但部分字节已落盘）
- 并发写入冲突（多个进程同时 append）

修复策略是"丢一保九"——破损行内容会丢，但文件其他部分保住，agent 能继续启动。这比"整个文件不可用"好得多。对个人学习项目，丢失一行会话历史可接受；对生产系统可能要更强的 durability（如 WAL + fsync），但 aptbot 不追求这个。

## HttpOnly + Secure + SameSite=Strict cookie

第七层防线在 Web 安全层：aptbot 的 auth cookie 三道属性：

- **HttpOnly**：JavaScript 不能读 cookie，防 XSS 偷 token
- **Secure**：只通过 HTTPS 传输，防中间人嗅探
- **SameSite=Strict**：跨站请求不带 cookie，防 CSRF

这三道属性是现代 Web auth cookie 的标配，缺一个都有对应攻击向量。HttpOnly 防 XSS 偷 token，Secure 防网络嗅探，SameSite 防 CSRF——aptbot 都加上，不省事。

## WS token 三级优先级

WebSocket 鉴权用 token，aptbot 设了三级优先级：

- **cookie token**（最高）：HTTP cookie 里的 token，Web 客户端天然带
- **query token**：URL query 参数的 token，CLI 连远程时用（CLI 没有 cookie）
- **header token**：Authorization header 的 token，编程式接入时用

三级优先级让不同客户端各用最方便的方式——浏览器用 cookie、CLI 用 query、SDK 用 header。但这三种都最终落到同一个 token 校验逻辑，鉴权行为一致。

为什么 query token 也允许？因为 CLI 不能发 cookie——CLI 连 WebSocket 时没有 HTTP cookie jar。query token 让 CLI 能用 `ws://host?token=xxx` 鉴权。代价是 token 可能出现在服务端 access log，但 aptbot 自部署、access log 也在用户手里，这个泄露面可接受。

## session ownership 跨用户 403

第八层防线在多用户隔离层：每个 session 有 owner，非 owner 操作返回 403。

- 用户 A 不能读用户 B 的 session 历史
- 用户 A 不能往用户 B 的 session 发消息
- 用户 A 不能 claim 用户 B 的 session（除非 forceClaimSession 管理员权限）

这是"租户隔离"的基础。多个用户共用一个 aptbot 实例时，彼此完全不可见——A 不知道 B 存在，B 不能影响 A 的 session。

## API key 仅通过 .env

第九层防线在密钥管理层：LLM provider 的 API key 只通过 .env 文件配置，不进 config、不进代码、不进日志。

- `.env` 文件不进 git（.gitignore）
- aptbot 启动时从 process.env 读 API key
- 日志中绝不打印 API key（即使是 warning/error）
- HTTP 响应绝不回显 API key

这防止 API key 泄露——key 只在内存中以 process.env 形式存在，不出现在任何持久化存储或网络传输中（除了发往 LLM provider 的 HTTPS 请求，这是必须的）。

## X-Content-Type-Options + Cache-Control

第十层防线在 HTTP 头层：

- **X-Content-Type-Options: nosniff**：禁止浏览器嗅探响应类型，防 MIME confusion 攻击
- **Cache-Control: no-cache, no-store, must-revalidate**：响应不缓存，防敏感数据被中间缓存读取

这两个头是 Web 安全的"廉价保险"——加一行配置就能防一类攻击。aptbot 给所有 HTML 响应都加这两个头，不省事。

## future: workspace 限制 + 权限模型（IM 接入后）

当前安全模型有个"信任假设"——所有用户都信任（自部署、单人或小团队）。这个假设在 IM 接入后会失效——把 aptbot 接到 Telegram 后，任何能加 bot 的人都能用它，可能有恶意用户。

IM 接入后需要的新防线：

- **workspace 限制**：每个用户一个独立 workspace，A 不能改 B 的文件
- **权限模型**：不同用户有不同权限（如只读 vs 读写 vs 管理员）
- **rate limit**：单用户调用频率限制，防滥用
- **audit log**：所有工具调用记日志，便于事后追溯

这些是 L3 路线的工作，aptbot 0.2.x 不做——因为 0.2.x 不接 IM，"所有用户都信任"的假设还成立。但安全模型要为这个演进留好空间——session ownership、UserStorage、Bearer token 这些机制已经为多用户权限模型铺了路，未来加 workspace 限制和权限模型是扩展不是重写。

## 小结

aptbot 的安全模型是多层防护的叠加：systemPrompt 引导行为、工具超时防卡死、双时钟防 provider hang、OOM 防护防内存爆、路径校验防越界、JSONL 自修复防数据损坏、Cookie 三属性防 Web 攻击、WS token 三级鉴权、session ownership 隔离用户、API key 通过 .env 防泄露、HTTP 头加保险。每一层都不完美，但叠加起来形成纵深防御。信任边界的清晰划定让 aptbot 不需要过度防御（用户自己信任），但仍能抵御真实攻击面（LLM 输出、外部输入、多用户隔离）。

下一篇文章看错误处理与流式 UX：这些散落的安全设计如何与错误处理、事件流、UI 渲染协作。
