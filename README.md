# aptbot

> 个人学习/工作助手 agent —— CLI + WebUI 双入口，单模型 ReAct 循环，会话持久化。

[![Tests](https://img.shields.io/badge/tests-383%20passed-brightgreen)]()
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-blue)]()
[![Node](https://img.shields.io/badge/node-%3E%3D20-green)]()

## 特性

- **双入口**：CLI（Ink + Yoga）与 WebUI（Lit + Web Components），共享同一 agent 核心
- **ReAct 循环**：单模型流式响应 + 工具调用（bash / read / edit / update_working_memory）
- **会话持久化**：JSONL append-only，进程重启自动恢复最近 session
- **Slash 命令**：`/new` `/clear` `/help` `/model` `/session` `/sessions` `/resume` `/continue` `/exit`
- **Session 管理**：`/sessions` 列出所有会话（含当前标识），`/resume <短ID>` 切换会话
- **流式边界**：Provider TTFB 5s + chunk 1.5s 双时钟控制器
- **工具硬超时**：bash 30s SIGTERM→SIGKILL，read/edit 5s，大文件 2MB 分页
- **JSONL 容错**：增量流式解析 + `fs.truncateSync` 自动修复破损行
- **WebSocket**：入站限流（64KB content / 10 msg/s）+ resync 协议

## 快速开始

### 1. 安装依赖

```bash
npm install
```

### 2. 配置 API Key

复制示例配置并填入你的 API key 到 `.env`：

```bash
# .env（已在 .gitignore 中，不会提交）
CUSTOM_API_KEY=sk-your-api-key-here
```

`config/aptbot.json` 通过 `envVar` 字段引用环境变量，不直接存储密钥：

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

支持三种 API 协议：`openai-completions` / `openai-responses` / `anthropic-messages`。

### 3. 启动服务器

```bash
npm run dev          # 自动加载 .env，监听 PORT 或默认 8080
# 或显式指定端口
PORT=3000 npm run dev
```

### 4. 访问

- **WebUI**：浏览器打开 `http://localhost:8080/`
- **CLI**：`npx tsx src/cli/index.tsx`（开发中，MVP 主入口为 WebUI）

## Slash 命令

| 命令 | 说明 |
|------|------|
| `/new` | 开始新 session |
| `/clear` | 清空当前对话上下文 |
| `/help` | 显示命令帮助 |
| `/model [name]` | 查看或切换模型 |
| `/session` | 显示当前 session ID |
| `/sessions` | 列出所有 session（`(current)` 标识当前会话） |
| `/resume <id>` | 切换到指定 session（支持短 ID 前缀匹配） |
| `/continue <id>` | 从旧 session 继承 working memory |
| `/exit` | 退出应用 |

## 项目结构

详见 [ARCHITECTURE.md](./ARCHITECTURE.md)。

```
src/
├── infrastructure/    # 基建层：config / logger / jsonl / storage / process
├── core/              # 核心层：provider / tool / memory / agent
├── bus/               # 总线层：message-bus / channel-manager
├── access/            # 接入层：websocket-server / chat-page
├── shared/            # 共享：commands / ui-state
├── cli/               # CLI 入口（Ink）
├── webui/             # WebUI 入口（Lit）
└── server.ts          # 服务器入口，装配所有层
```

## 测试

```bash
npm test              # 全量测试（43 文件，383 用例）
npx tsc --noEmit      # 类型检查
```

## 技术栈

- **Language**: TypeScript (strict) / ESM / Node.js >= 20
- **Test**: vitest
- **Provider**: zod (config schema) / pino (logger) / async-mutex
- **CLI**: Ink + Yoga + React
- **WebUI**: Lit + Web Components
- **Transport**: WebSocket (ws)

## 版本

当前版本 **v0.1.0-mvp**。详见 [CHANGELOG.md](./CHANGELOG.md)。
