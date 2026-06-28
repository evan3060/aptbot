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

🤖 **aptbot** is a personal learning and work assistant agent with a small, readable core. It runs a single-model ReAct loop with bash/read/edit tools, persists sessions to JSONL, and ships both a CLI (Ink) and a WebUI (Lit + Web Components) over WebSocket.

> **Status:** v0.1.0 MVP — 42 tasks done, 383 tests passing. Currently single-user, local/VPS deployment.

## Start Here

| You want to... | Go to |
|---|---|
| Install and get a first reply in 5 minutes | [Quick Start](#-quick-start) |
| Open the browser UI after the server runs | [WebUI](#-webui) |
| Deploy to a VPS with TLS | [Deployment](#-deployment) |
| Understand the layered architecture | [Architecture](./ARCHITECTURE.md) |
| See what changed between versions | [Changelog](./CHANGELOG.md) |
| Review the MVP task plan | [PLAN.md](./PLAN.md) |

## 💡 Why aptbot

- **Small core**: a readable ReAct loop, not a framework. The whole agent layer is ~3 files.
- **Dual entry**: CLI (Ink) and WebUI (Lit) share the same `coreReducer` state machine.
- **Persistent sessions**: JSONL append-only with corruption-tolerant parsing and auto-repair.
- **Hardened boundaries**: TTFB/chunk dual-clock streaming, 30s bash hard timeout, 2MB read limit, per-file edit mutex.
- **Own your stack**: inspect every line, self-host on a $5 VPS, no platform lock-in.

## 📦 Install

Prerequisites: Node.js 20+ and npm. Git to clone the repo.

```bash
git clone https://github.com/evan3060/aptbot.git
cd aptbot
npm install
```

## 🚀 Quick Start

**1. Configure your API key**

Create `.env` in the project root (already gitignored):

```bash
CUSTOM_API_KEY=sk-your-api-key-here
```

**2. Edit `config/aptbot.json`**

Point `baseUrl` at your OpenAI-compatible endpoint and pick a model:

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

Supported `api` protocols: `openai-completions` · `openai-responses` · `anthropic-messages`.

**3. Start the server**

```bash
npm run dev          # loads .env automatically, listens on PORT or 8080
```

**4. Open the WebUI**

Visit [`http://localhost:8080/`](http://localhost:8080/) in your browser.

**5. Try a slash command**

```
/help          show available commands
/sessions      list all sessions (current marked)
/new           start a new session
/resume 0ca9   switch to a session by short ID
```

## 🌐 WebUI

The WebUI is served inline by the WebSocket server — no separate build step. Just start the server and open the URL.

- Streaming responses with `turn_start` / `message_delta` / `turn_end` events
- Tool call display with 200px max-height + 800-char result truncation
- 6 Lit components: `assistant-message` · `user-message` · `tool-execution` · `working-indicator` · `footer-bar` · `input-box`
- Auto-reconnect with `resync_required` protocol

## 🏗️ Architecture

aptbot is layered bottom-up: each layer depends only on the layer below.

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

See [ARCHITECTURE.md](./ARCHITECTURE.md) for the full module map, event flow diagram, and design decisions.

## ✨ Features

| Capability | Detail |
|---|---|
| ReAct loop | Single-model streaming + tool calls, `maxIterations` cap, `AbortSignal` propagation |
| Tools | `bash` (30s SIGTERM→SIGKILL) · `read` (2MB limit) · `edit` (per-file mutex) · `update_working_memory` |
| Memory | JSONL append-only · corruption-tolerant parse · `fs.truncateSync` auto-repair · Compaction at 80% context |
| Sessions | `/sessions` list with `(current)` marker · `/resume <short-id>` prefix matching · auto-restore last session on restart |
| Providers | `openai-completions` · `openai-responses` · `anthropic-messages` · dual-clock TTFB 5s + chunk 1.5s · 401/403/400 fatal, 429/5xx retry |
| WebSocket | Inbound limits 64KB / 10 msg/s · heartbeat 60s · resync protocol · dead-letter queue |
| Safety | systemPrompt forbids kill / source-mod / `data/sessions/` access · API key via `.env` only |

## Slash Commands

| Command | Description |
|---|---|
| `/new` | Start a new session |
| `/clear` | Clear the current conversation context |
| `/help` | Show available commands |
| `/model [name]` | Show or set the current model |
| `/session` | Show current session ID |
| `/sessions` | List all sessions (current marked with `(current)`) |
| `/resume <id>` | Switch to a session (short ID prefix matching) |
| `/continue <id>` | Inherit working memory from an old session |
| `/exit` | Exit the application |

## 📚 Docs

- [Architecture](./ARCHITECTURE.md) — layered design, module map, event flow
- [Deployment](./docs/deployment.md) — VPS deployment with systemd + nginx/Caddy
- [Changelog](./CHANGELOG.md) — versioned release notes
- [PLAN.md](./PLAN.md) — MVP task plan (42 tasks, all complete)

## 🚢 Deployment

### VPS (Ubuntu 22.04 + systemd + Caddy)

```bash
# 1. Install Node.js 20+, Caddy, git
# 2. Clone and build
cd /opt/aptbot
git clone https://github.com/evan3060/aptbot.git .
npm ci && npm run build

# 3. Configure
echo "CUSTOM_API_KEY=sk-..." > .env
echo "APTBOT_AUTH_TOKEN=$(openssl rand -hex 32)" >> .env

# 4. systemd service (listens on 127.0.0.1:8080)
# 5. Caddy reverse proxy (auto TLS for your domain)
```

Node.js binds to `127.0.0.1`, the reverse proxy terminates TLS on 443 and proxies to 8080. See the [deployment guide](./docs/deployment.md) for the full systemd unit, nginx/Caddy configs, SSH hardening, and sudoers setup.

### Local

```bash
npm run dev    # http://localhost:8080
```

## 🧪 Tests

```bash
npm test              # 43 files, 383 tests
npx tsc --noEmit      # strict type check, 0 errors
```

E2E covers the full agent loop: basic conversation, tool calls, multi-turn context, persistence, working memory, error recovery, WebSocket resync, slash commands, compaction, and cross-session inheritance.

## 🤝 Contribute

PRs welcome. The codebase is intentionally small — 54 source files, ~5700 LOC.

### Roadmap

- **L1** — Per-browser session isolation (localStorage-based), multi-client sync
- **L2** — IM channel integration (Telegram / Discord / Feishu)
- **L3** — Cloudflare Pages + Workers light deployment
- **Multi-modal** — image input/outputs
- **MCP** — Model Context Protocol tool extensions

## 📄 License

MIT (see [LICENSE](./LICENSE)).

<div align="center">
  <em>Built as a personal learning project. Thanks for visiting ✨ aptbot!</em>
</div>
