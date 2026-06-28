<div align="center">
  <p>
    <img src="https://img.shields.io/badge/tests-383%20passed-brightgreen" alt="Tests">
    <img src="https://img.shields.io/badge/TypeScript-strict-blue" alt="TypeScript">
    <img src="https://img.shields.io/badge/node-%3E%3D20-green" alt="Node">
    <img src="https://img.shields.io/badge/version-0.1.0--mvp-orange" alt="Version">
    <img src="https://img.shields.io/badge/license-MIT-yellow" alt="License">
  </p>
  <p>
    <a href="./README.md">English</a> |
    <a href="./README.zh-CN.md">简体中文</a>
  </p>
</div>

🤖 **aptbot** 是一个个人学习与工作助手 agent，核心小巧可读。它运行单模型 ReAct 循环，内置 bash/read/edit 工具，将会话持久化到 JSONL，同时提供 CLI（Ink）和 WebUI（Lit + Web Components）双入口，基于 WebSocket 通信。

> **状态：** v0.1.0 MVP — 42 项任务完成，383 个测试通过。当前为单用户、本地/VPS 部署。

## 从这里开始

| 你想... | 前往 |
|---|---|
| 5 分钟内安装并获得第一条回复 | [快速开始](#-快速开始) |
| 服务器跑起来后打开浏览器 UI | [WebUI](#-webui) |
| 部署到 VPS 并启用 TLS | [部署](#-部署) |
| 理解分层架构 | [架构](./ARCHITECTURE.md) |
| 查看版本变更记录 | [更新日志](./CHANGELOG.md) |
| 回顾 MVP 任务计划 | [PLAN.md](./PLAN.md) |

## 💡 为什么选 aptbot

- **核心小**：一个可读的 ReAct 循环，不是框架。整个 agent 层只有 ~3 个文件。
- **双入口**：CLI（Ink）和 WebUI（Lit）共享同一个 `coreReducer` 状态机。
- **会话持久化**：JSONL append-only，支持破损容错解析与自动修复。
- **硬化的边界**：TTFB/chunk 双时钟流式控制、bash 30s 硬超时、read 2MB 限制、edit per-file mutex。
- **掌控你的栈**：每一行都可审查，5 美元 VPS 即可自托管，无平台锁定。

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

aptbot 自底向上分层：每层仅依赖其下层。

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
```

完整的模块映射、事件流图与设计决策见 [ARCHITECTURE.md](./ARCHITECTURE.md)。

## ✨ 功能特性

| 能力 | 详情 |
|---|---|
| ReAct 循环 | 单模型流式 + 工具调用，`maxIterations` 上限，`AbortSignal` 传播 |
| 工具 | `bash`（30s SIGTERM→SIGKILL）· `read`（2MB 限制）· `edit`（per-file mutex）· `update_working_memory` |
| 记忆 | JSONL append-only · 破损容错解析 · `fs.truncateSync` 自动修复 · 80% 上下文触发 Compaction |
| 会话 | `/sessions` 列表带 `(current)` 标记 · `/resume <短ID>` 前缀匹配 · 重启后自动恢复最近会话 |
| Provider | `openai-completions` · `openai-responses` · `anthropic-messages` · 双时钟 TTFB 5s + chunk 1.5s · 401/403/400 fatal，429/5xx 重试 |
| WebSocket | 入站限制 64KB / 10 msg/s · 心跳 60s · resync 协议 · 死信队列 |
| 安全 | systemPrompt 禁止 kill / source-mod / `data/sessions/` 访问 · API key 仅通过 `.env` |

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
| `/exit` | 退出应用 |

## 📚 文档

- [架构文档](./ARCHITECTURE.md) — 分层设计、模块映射、事件流
- [部署指南](./docs/deployment.md) — VPS 部署含 systemd + nginx/Caddy
- [更新日志](./CHANGELOG.md) — 版本发布说明
- [PLAN.md](./PLAN.md) — MVP 任务计划（42 项任务，全部完成）

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
npm test              # 43 个文件，383 个测试
npx tsc --noEmit      # 严格类型检查，0 错误
```

E2E 覆盖完整 agent 循环：基础对话、工具调用、多轮上下文、持久化、working memory、错误恢复、WebSocket resync、斜杠命令、Compaction、跨会话继承。

## 🤝 贡献

欢迎 PR。代码库刻意保持小巧——54 个源文件，~5700 行代码。

### 路线图

- **L1** — 浏览器级会话隔离（基于 localStorage）、多客户端同步
- **L2** — IM 渠道集成（Telegram / Discord / 飞书）
- **L3** — Cloudflare Pages + Workers 轻量部署
- **多模态** — 图像输入/输出
- **MCP** — Model Context Protocol 工具扩展

## 📄 许可证

MIT（见 [LICENSE](./LICENSE)）。

<div align="center">
  <em>作为个人学习项目构建。感谢访问 ✨ aptbot！</em>
</div>
