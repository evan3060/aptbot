<div align="center">
  <p>
    <img src="https://img.shields.io/badge/tests-687%20passed-brightgreen" alt="Tests">
    <img src="https://img.shields.io/badge/TypeScript-strict-blue" alt="TypeScript">
    <img src="https://img.shields.io/badge/node-%3E%3D20-green" alt="Node">
    <img src="https://img.shields.io/badge/version-0.2.1-blue" alt="Version">
    <img src="https://img.shields.io/badge/license-MIT-yellow" alt="License">
  </p>
  <p>
    <a href="./README.md">English</a> |
    <a href="./README.zh-CN.md">简体中文</a>
  </p>
</div>

🤖 **aptbot — 你的个人 AI 助理**

一个开源、自托管、可完全定制的 AI 助理，立志成为你工作和生活中不可缺失的伙伴。

它不只是一个 chatbot。它是一个会思考、会行动、会记忆的智能体——能够通过工具操作你的本地环境（执行命令、读写文件、抓取网页、查询数据库），能够记住你跨会话的偏好与上下文，能够在你授权后接管重复性工作流，能够通过 CLI、WebUI、IM 多渠道接入你的工作场景，让你的助理始终在你最习惯的地方响应你。

它不只服务于你一个人。多用户隔离让家庭成员、团队成员可以在同一实例上拥有各自的会话空间；多端实时同步让你在手机上发起的对话可以在电脑上继续，在终端里启动的工作流可以在浏览器里收尾。

**长期目标：** 从一个简洁可读的 ReAct 循环出发，逐步扩展为高度个性化、全能的个人工作与生活助理——记住你的偏好、连接你的工具链、学习你的工作流、融入你的日常。最终，它不只是回答问题，而是主动为你工作。

> **状态：** v0.2.1 — 66 个文件 / 687 个测试通过。落地页 + adept 风格 demo 页。

## 从这里开始

| 你想... | 前往 |
|---|---|
| 5 分钟内安装并获得第一条回复 | [快速开始](#-快速开始) |
| 服务器跑起来后打开浏览器 UI | [WebUI](#-webui) |
| 部署到 VPS 并启用 TLS | [部署](#-部署) |
| 理解分层架构 | [架构](./ARCHITECTURE.md) |
| 查看版本变更记录 | [更新日志](./CHANGELOG.md) |
| 回顾 L1 任务计划 | [PLAN-L1.md](./PLAN-L1.md) |
| 预览 L2 路线图 | [PLAN-L2.md](./PLAN-L2.md) |

## 💡 为什么选 aptbot

**不是框架，不是 SaaS，而是"你的"agent。**

aptbot 选择了一条不同的路：不卖订阅、不锁数据、不藏代码。它把整个思考过程透明地呈现给你，把每一比特数据的所有权归还给你，把每一个行为边界的决定权交给你。

**核心理念：** 你产生的数据归你所有，你使用的工具由你决定，你定制的助理按你的方式工作。aptbot 不卖 AI，它给你一个真正属于你的 AI 助理。

**核心特色：**

- **思考过程透明**
  core 仅 ~3 个文件，一个可读的 ReAct 循环，不是框架。每一次思考、每一次工具调用、每一次决策都完整呈现在你面前，你看得见它如何工作。

- **多渠道接入，一个会话**
  CLI、WebUI、IM 三渠道接入同一个会话。你在手机上发起的对话可以在电脑上继续，在终端里启动的工作流可以在浏览器里收尾。per-sessionKey ring buffer + presence 广播让多端实时同步成为架构原语，而非附加功能。

- **多用户共享，一个实例**
  多用户隔离让家庭成员、团队成员可以在同一实例上拥有各自的会话空间。一个 aptbot，服务全家 / 全团队，无需重复部署。

- **会话持久化，跨会话记忆**
  JSONL append-only 持久化记住你过去的上下文。L2 起将引入 3 层记忆架构（短期工作记忆 / 长期情景记忆 / 程序性技能记忆），破损容错解析与自动修复确保记忆永不丢失。

- **多模型冗余，永不不可用**
  主 + fallback provider 自动切换 + 熔断器。单一 provider 故障时无感切换，你的助理始终在线。

- **硬化的边界，安全可控**
  TTFB/chunk 双时钟流式控制、工具 30s 硬超时、大文件 OOM 防护、JSONL 容错修复。每一层都有保护，每一次操作都有边界。

- **分层架构，无限扩展**
  严格四层架构 + 声明式注册表 + Hook 系统（8 个扩展点）。加一个 IM 渠道零核心改动，加一个工具只需声明注册，加一个 provider 只需写一个 config 声明。

- **双入口，统一状态机**
  CLI（Ink）和 WebUI（Lit）共享同一个 coreReducer 状态机。流式渲染、中途打断、多端同步是事件流的自然消费方式，不是额外功能。

## 📦 安装

前置条件：Node.js 20+ 和 npm。Git 用于克隆仓库。

```bash
git clone https://github.com/evan3060/aptbot.git
cd aptbot
npm install
```

## 🚀 快速开始

**1. 配置 API Key**

在项目根目录创建 `.env`（已被 gitignore）：

```bash
CUSTOM_API_KEY=sk-your-api-key-here
```

**2. 编辑 `config/aptbot.json`**

将 `baseUrl` 指向你的 OpenAI 兼容端点，选择一个模型：

```json
{
  "providers": [{
    "id": "custom",
    "name": "Custom API",
    "baseUrl": "https://api.example.com/v1",
    "auth": { "envVar": "CUSTOM_API_KEY" },
    "models": [{
      "id": "your-model",
      "api": "openai-completions",
      "contextWindow": 64000,
      "maxTokens": 4096
    }]
  }],
  "defaultModel": "your-model",
  "dataDir": "./data",
  "deploy": "local"
}
```

支持的 `api` 协议：`openai-completions` · `openai-responses` · `anthropic-messages`。

**3. 启动服务器**

```bash
npm run dev          # 自动加载 .env，监听 PORT 或 8080
```

**4. 打开 WebUI**

浏览器访问 [`http://localhost:8080/`](http://localhost:8080/)。

**5. 试试斜杠命令**

```
/help          显示可用命令
/sessions      列出所有会话（标记当前会话）
/new           开始新会话
/resume 0ca9   通过短 ID 切换会话
```

## 🌐 WebUI

WebUI 由 WebSocket 服务器内联提供——无需单独构建步骤。启动服务器后打开 URL 即可。

- 流式响应，支持 `turn_start` / `message_delta` / `turn_end` 事件
- 工具调用展示，最大高度 200px + 800 字符结果截断
- 6 个 Lit 组件：`assistant-message` · `user-message` · `tool-execution` · `working-indicator` · `footer-bar` · `input-box`
- 自动重连，支持 `resync_required` 协议

## 🏗️ 架构

aptbot 自底向上分层：core → bus → infrastructure → access，加 `shared/` 跨层共享。依赖方向严格向下，核心层完全不感知接入层存在。

```
┌─────────────────────────────────────────────────┐
│  access / cli / webui                           │
│  WebSocketServer · chat-page · Ink CLI · Lit UI  │
├─────────────────────────────────────────────────┤
│  bus                                            │
│  MessageBus (inbound/outbound) · ChannelManager  │
├─────────────────────────────────────────────────┤
│  core                                           │
│  Provider · Tool · Memory · AgentLoop/Session    │
├─────────────────────────────────────────────────┤
│  infrastructure                                 │
│  Config · Logger · JSONL · FileStorage · Process │
└─────────────────────────────────────────────────┘
        │
        ▼
   shared/ (commands · ui-state)  跨层共享
```

### 架构特色

1. **严格分层与单向依赖** — 四层架构加 `shared/` 跨层共享。核心层从不反向引用 access/bus（grep 验证：0 处引用）。新增一个 IM 渠道只需在接入层写一个 `Channel` 实现，总线层和核心层零改动。对比 nanobot 将 channel/IM/工具紧密耦合在同一进程空间。

2. **事件驱动总线与多渠道会话共享** — 所有出站事件（token 增量、工具进度、错误）以类型化 `AgentEventEnvelope` 流经 `ChannelManager`，按 `sessionKey` 路由。CLI、WebUI、未来 IM 频道可以独立订阅同一会话、互不阻塞。对比 pi-agent 纯 CLI 无渠道概念、nanobot 每个 channel 独立处理消息流——"一次 agent 调用、多端同步消费"是架构级差异。

3. **无状态生成器与有状态会话分离** — `AgentLoop` 是纯 async 生成器（无副作用、无持久化，输入输出全在参数和 `yield` 中）。有状态的关注点（存储、steering 注入、生命周期）由外层 `AgentSession` 管理。这种分离让核心循环可独立测试和组合——未来子代理或跨进程恢复只需从 Session 层拆出 Harness，不动循环本身。

4. **运行时多态注入而非编译分支** — 部署适配不靠构建变体，而是通过运行时注入不同的 `StorageAdapter` / `ToolRegistry` 实例，配置在启动时一次性加载。本地全功能、演示环境最小工具集、未来云端分布式存储——同一份代码，不同注入。比 nanobot 的"环境变量 + if 分支"更干净，比 GenericAgent 的"无抽象直接写"更可维护。

### 设计模式特色

1. **外置分层重试——循环只报告，上层决策** — 错误不内嵌在循环逻辑中，而是按类型分发：网络超时在 Provider 层自动重试，工具错误返回给语言模型让其自行决定，致命错误直接终止且不持久化（防"400 中毒"——错误 turn 永久保存）。对比 nanobot 400 行主循环内置 5 种恢复路径，aptbot 的循环保持简洁，错误策略可独立演进。

2. **细粒度事件流驱动 UI——从后端到前端的统一语言** — 每个 token 增量、工具调用进度、思考过程都是独立事件，UI 通过 reducer 消费事件流更新状态。流式渲染、中途打断、多端同步不是"额外功能"而是事件流的自然消费方式。对比 GenericAgent 用 generator yield 字符串、nanobot 用粗粒度 hook 回调，aptbot 的类型化事件让前端开发有完整类型推导，不靠猜。

3. **声明式注册表 + 工厂模式——扩展即声明** — `Tool`、`Command`、`Channel` 通过注册表声明式注册，新增一个工具只需实现接口并注册；`Provider` 则通过 config 声明 + 工厂函数创建，新增一个 Provider 只需写一个声明（baseUrl、envVar、models）。对比 GenericAgent 将所有工具硬编码在一个 JSON 文件中、nanobot 用装饰器加运行时反射，aptbot 在编译时就有完整类型，IDE 补全、重构安全。

4. **会话可变引用——运行中无中断切换** — `SessionRef` 允许 `/new`、`/resume` 命令在 agent 运行中切换当前会话，`ChannelManager` 重新绑定 `sessionKey` 即可，无需重启循环或断开连接。这种"引用可变、循环不变"的模式让会话管理成为即时操作而非生命周期事件。对比 pi-agent 的 session 不可变、nanobot 需重启 agent loop，aptbot 的体验更流畅。

完整的模块映射、事件流图与设计决策见 [ARCHITECTURE.md](./ARCHITECTURE.md)。与 pi-agent / nanobot / GenericAgent 的详细架构对比见 [docs/comparison-pi-nanobot-ga.md](./docs/comparison-pi-nanobot-ga.md)。

## ✨ 功能特性

| 能力 | 详情 |
|---|---|
| ReAct 循环 | 单模型流式 + 工具调用，`maxIterations` 上限，`AbortSignal` 传播 |
| 工具 | `bash`（30s SIGTERM→SIGKILL）· `read`（2MB 限制）· `edit`（per-file mutex）· `update_working_memory` |
| 记忆 | JSONL append-only · 破损容错解析 · `fs.truncateSync` 自动修复 · 80% 上下文触发 Compaction |
| 会话 | `/sessions` 列表带 `(current)` 标记 · `/resume <短ID>` 前缀匹配 · 重启后自动恢复最近会话 |
| 用户系统（v0.2.0） | `scrypt` 密码哈希 · Bearer token 认证 · per-user session ownership · `POST /api/register` / `POST /api/login` / `GET /api/me` |
| 多客户端同步（v0.2.0） | per-sessionKey 消息串行化 · ring buffer 历史回放 · presence 广播 · `session_changed` 控制消息 |
| 会话侧边栏（v0.2.0） | Codex 风格左面板 · 相对时间 · 3-dot 菜单 · inline 重命名（Enter/Esc） · 跨客户端 `session_renamed` 广播 |
| 落地页（v0.2.1） | adept.ai 风格 5-section 落地页位于 `/`（opt-in via `landingPage: true`） · 中/英 i18n · `/demo` 路由返回 agent 页 |
| Provider | `openai-completions` · `openai-responses` · `anthropic-messages` · 双时钟 TTFB 5s + chunk 1.5s · 401/403/400 fatal，429/5xx 重试 |
| WebSocket | 入站限制 64KB / 10 msg/s · 心跳 60s · resync 协议 · 死信队列 |
| 安全 | systemPrompt 禁止 kill / source-mod / `data/sessions/` 访问 · API key 仅通过 `.env` · session ownership 防跨用户访问 |

## 斜杠命令

| 命令 | 说明 |
|---|---|
| `/new` | 开始新会话 |
| `/clear` | 清除当前对话上下文 |
| `/help` | 显示可用命令 |
| `/model [name]` | 显示或设置当前模型 |
| `/session` | 显示当前会话 ID |
| `/sessions` | 列出所有会话（当前会话标记 `(current)`） |
| `/resume <id>` | 切换会话（短 ID 前缀匹配） |
| `/continue <id>` | 继承旧会话的 working memory |
| `/label <text>` | 重命名当前会话（v0.2.0+） |
| `/exit` | 退出应用 |

## 📚 文档

- [架构文档](./ARCHITECTURE.md) — 分层设计、模块映射、事件流
- [部署指南](./docs/deployment.md) — VPS 部署含 systemd + nginx/Caddy
- [更新日志](./CHANGELOG.md) — 版本发布说明
- [PLAN-L1.md](./PLAN-L1.md) — L1 任务计划（用户系统 + 多客户端同步，已完成）
- [PLAN-L2.md](./PLAN-L2.md) — L2 路线图（可靠性 + IM 集成，已规划）
- [架构对比](./docs/comparison-pi-nanobot-ga.md) — 与 pi-agent / nanobot / GenericAgent 的架构对比

## 🚢 部署

### VPS（Ubuntu 22.04 + systemd + nginx）

```bash
# 1. 安装 Node.js 20+、nginx、git
# 2. 克隆并构建
cd /opt/aptbot
git clone https://github.com/evan3060/aptbot.git .
npm ci && npm run build

# 3. 配置
echo "CUSTOM_API_KEY=sk-..." > .env
echo "APTBOT_AUTH_TOKEN=$(openssl rand -hex 32)" >> .env
echo "HOST=127.0.0.1" >> .env

# 4. systemd 服务（监听 127.0.0.1:8080）
# 5. nginx 反向代理（自动 TLS）
```

Node.js 绑定 `127.0.0.1`，反向代理在 443 端口终止 TLS 并代理到 8080。完整 systemd unit、nginx/Caddy 配置、SSH 加固与 sudoers 配置见[部署指南](./docs/deployment.md)。

### 本地

```bash
npm run dev    # http://localhost:8080
```

## 🧪 测试

```bash
npm test              # 66 个文件，687 个测试
npx tsc --noEmit      # 严格类型检查，0 错误
```

E2E 覆盖完整 agent 循环：基础对话、工具调用、多轮上下文、持久化、working memory、错误恢复、WebSocket resync、斜杠命令、Compaction、跨会话继承、用户注册/登录、session ownership 隔离、多客户端实时同步。

## 🤝 贡献

欢迎 PR。代码库刻意保持小巧——70+ 个源文件，~8000 行代码。

### 路线图

- **L1 ✅（v0.2.0）** — 用户系统（注册/登录）、浏览器级会话隔离、多客户端同步、Codex 风格侧边栏、会话重命名
- **v0.2.1 ✅** — aptbot.de 落地页（adept.ai 风格）+ demo 页视觉迁移 + 移动端适配
- **L2** — 可靠性（ring buffer 分片、JSONL 历史持久化、HttpOnly cookie）、扩展性（MixinProvider 故障转移、配置热重载、hook 系统）、体验（CLI overlay/diff、WebUI 拆分到 Cloudflare Pages）、IM 集成（Telegram 作为首个渠道）
- **L3** — FallbackProvider + 熔断器、OAuth、session 分支、跨会话长期记忆、飞书/钉钉集成、AgentHarness + 子代理管理
- **多模态** — 图像输入/输出
- **MCP** — Model Context Protocol 工具扩展

## 📄 许可证

MIT（见 [LICENSE](./LICENSE)）。

<div align="center">
  <em>作为个人学习项目构建。感谢访问 ✨ aptbot！</em>
</div>
