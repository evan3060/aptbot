<div align="center">
  <p>
    <img src="https://img.shields.io/badge/tests-584%20passed-brightgreen" alt="Tests">
    <img src="https://img.shields.io/badge/TypeScript-strict-blue" alt="TypeScript">
    <img src="https://img.shields.io/badge/node-%3E%3D20-green" alt="Node">
    <img src="https://img.shields.io/badge/version-0.2.0-blue" alt="Version">
    <img src="https://img.shields.io/badge/license-MIT-yellow" alt="License">
  </p>
  <p>
    <a href="./README.md">English</a> |
    <a href="./README.zh-CN.md">简体中文</a>
  </p>
</div>

🤖 **aptbot — Your Personal AI Assistant**

An open-source, self-hosted, fully customizable AI assistant that aspires to be an indispensable partner in your work and life.

It's not just a chatbot. It's an agent that thinks, acts, and remembers — able to operate your local environment through tools (execute commands, read/write files, fetch web pages, query databases), able to remember your cross-session preferences and context, able to take over repetitive workflows upon your authorization, able to integrate into your work scenarios through CLI, WebUI, and IM multi-channel access, so your assistant responds wherever you feel most at home.

It doesn't serve just you. Multi-user isolation lets family members and team members have their own session spaces on the same instance; multi-end real-time sync lets a conversation you start on your phone continue on your computer, and a workflow you launch in the terminal finish in the browser.

**Long-term goal:** Starting from a concise, readable ReAct loop, gradually expand into a highly personalized, omnipotent personal work and life assistant — remembering your preferences, connecting your toolchain, learning your workflows, blending into your daily life. Ultimately, it doesn't just answer questions — it works for you proactively.

> **Status:** v0.2.0 (L1) — 58 files / 584 tests passing. Multi-user, local/VPS deployment.

## Start Here

| You want to... | Go to |
|---|---|
| Install and get a first reply in 5 minutes | [Quick Start](#-quick-start) |
| Open the browser UI after the server runs | [WebUI](#-webui) |
| Deploy to a VPS with TLS | [Deployment](#-deployment) |
| Understand the layered architecture | [Architecture](./ARCHITECTURE.md) |
| See what changed between versions | [Changelog](./CHANGELOG.md) |
| Review the L1 task plan | [PLAN-L1.md](./PLAN-L1.md) |
| Preview the L2 roadmap | [PLAN-L2.md](./PLAN-L2.md) |

## 💡 Why aptbot

**Not a framework, not a SaaS, but "your" agent.**

aptbot chose a different path: no subscriptions, no data lock-in, no hidden code. It presents the entire thinking process transparently to you, returns ownership of every bit of data to you, and hands the decision over every behavioral boundary to you.

**Core philosophy:** Your data belongs to you, your tools are yours to decide, your customized assistant works your way. aptbot doesn't sell AI — it gives you an AI assistant that truly belongs to you.

**Core features:**

- **Transparent Thinking Process**
  core is only ~3 files, a readable ReAct loop, not a framework. Every thought, every tool call, every decision is fully presented to you — you see how it works.

- **Multi-Channel Access, One Conversation**
  CLI, WebUI, and IM three channels access the same conversation. A conversation you start on your phone can continue on your computer; a workflow you launch in the terminal can finish in the browser. per-sessionKey ring buffer + presence broadcast makes multi-end real-time sync an architectural primitive, not an add-on.

- **Multi-User Sharing, One Instance**
  Multi-user isolation lets family and team members have their own session spaces on the same instance. One aptbot serves the whole family / whole team — no need for duplicate deployments.

- **Session Persistence, Cross-Session Memory**
  JSONL append-only persistence remembers your past context. Starting L2, a 3-layer memory architecture (short-term working memory / long-term episodic memory / procedural skill memory) will be introduced, with corruption-tolerant parsing and auto-repair ensuring memory is never lost.

- **Multi-Model Redundancy, Always Available**
  Primary + fallback provider auto-switch + circuit breaker. When a single provider fails, switch is seamless — your assistant is always online.

- **Hardened Boundaries, Safe and Controllable**
  TTFB/chunk dual-clock streaming control, 30s tool hard timeout, large file OOM protection, JSONL corruption repair. Every layer has protection, every operation has boundaries.

- **Layered Architecture, Infinite Extensibility**
  Strict four-layer architecture + declarative registry + Hook system (8 extension points). Adding an IM channel requires zero core changes; adding a tool is just declaring registration; adding a provider is just writing a config declaration.

- **Dual Entry, Unified State Machine**
  CLI (Ink) and WebUI (Lit) share the same coreReducer state machine. Streaming rendering, mid-turn interruption, multi-end sync are natural consumption patterns of the event stream, not extra features.

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

aptbot is layered bottom-up: core → bus → infrastructure → access, with `shared/` cross-layer utilities. Dependencies flow strictly downward — the core layer is completely unaware of the access layer's existence.

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
   shared/ (commands · ui-state)  cross-layer
```

### Architectural Highlights

1. **Strict Layering & Unidirectional Dependency** — A four-layer architecture with `shared/` for cross-layer utilities. The core layer never imports from access/bus (verified by grep: 0 references). Adding an IM channel only requires a new `Channel` implementation in the access layer — bus and core remain untouched. Compare nanobot, which couples channels/IM/tools in the same process space.

2. **Event-Driven Bus & Multi-Channel Session Sharing** — All outbound events (token deltas, tool progress, errors) flow as typed `AgentEventEnvelope` through `ChannelManager`, routed by `sessionKey`. CLI, WebUI, and future IM channels can subscribe to the same conversation independently without blocking each other. Compare pi-agent (pure CLI, no channel concept) and nanobot (each channel processes its own message stream) — "one agent invocation, multi-end synced consumption" is an architectural-level difference.

3. **Stateless Generator vs Stateful Session** — `AgentLoop` is a pure async generator (no side effects, no persistence — inputs/outputs all in parameters and `yield`). Stateful concerns (storage, steering injection, lifecycle) live in `AgentSession` outside the loop. This separation makes the core loop independently testable and composable — future subagents or cross-process recovery only need to extract a Harness from the Session layer, leaving the loop untouched.

4. **Runtime Injection, Not Build Variants** — Deployment adaptation is done via runtime injection of different `StorageAdapter` / `ToolRegistry` instances, with config loaded once at startup. Local full-feature, demo minimal toolset, future cloud distributed storage — same codebase, different injections. Cleaner than nanobot's "env vars + if branches", more maintainable than GenericAgent's "no abstraction, just write it".

### Design Patterns

1. **Externalized Layered Retry — Loop Reports, Upper Layer Decides** — Errors are not embedded in loop logic but dispatched by type: network timeouts auto-retry at the Provider layer, tool errors return to the LLM to decide, fatal errors terminate without persisting (preventing "400 poisoning" — a bad turn saved forever). Compare nanobot's 400-line main loop with 5 recovery paths baked in — aptbot's loop stays clean, error strategies evolve independently.

2. **Fine-Grained Event Stream → UI — A Unified Language Backend to Frontend** — Every token delta, tool call progress, and thought step is an independent event. UI updates state by consuming the event stream via a reducer. Streaming rendering, mid-turn interruption, multi-end sync are natural consumption patterns of the event stream, not "extra features". Compare GenericAgent's `generator yield` of strings and nanobot's coarse-grained hook callbacks — aptbot's typed events give the frontend complete type inference, not guesswork.

3. **Declarative Registry + Factory — Extension as Declaration** — `Tool`, `Command`, `Channel` are registered via declarative registries; adding a tool only requires implementing the interface and registering. `Provider` uses config declaration + factory creation — adding a provider only requires writing a declaration (baseUrl, envVar, models). Compare GenericAgent's hardcoded JSON tool list and nanobot's decorator + runtime reflection — aptbot has complete compile-time types, IDE autocomplete, and refactor safety.

4. **Mutable Session Reference — No-Interrupt Switching Mid-Run** — `SessionRef` allows `/new`, `/resume` to switch the current session while the agent is running — `ChannelManager` rebinds `sessionKey` without restarting the loop or disconnecting. This "reference mutable, loop immutable" pattern makes session management an instant operation rather than a lifecycle event. Compare pi-agent's immutable session and nanobot's agent-loop restart — aptbot's experience is smoother.

See [ARCHITECTURE.md](./ARCHITECTURE.md) for the full module map, event flow diagram, and design decisions. See [docs/comparison-pi-nanobot-ga.md](./docs/comparison-pi-nanobot-ga.md) for a detailed comparison with pi-agent / nanobot / GenericAgent.

## ✨ Features

| Capability | Detail |
|---|---|
| ReAct loop | Single-model streaming + tool calls, `maxIterations` cap, `AbortSignal` propagation |
| Tools | `bash` (30s SIGTERM→SIGKILL) · `read` (2MB limit) · `edit` (per-file mutex) · `update_working_memory` |
| Memory | JSONL append-only · corruption-tolerant parse · `fs.truncateSync` auto-repair · Compaction at 80% context |
| Sessions | `/sessions` list with `(current)` marker · `/resume <short-id>` prefix matching · auto-restore last session on restart |
| User system (v0.2.0) | `scrypt` password hashing · Bearer token auth · per-user session ownership · `POST /api/register` / `POST /api/login` / `GET /api/me` |
| Multi-client sync (v0.2.0) | per-sessionKey message serialization · ring buffer history replay · presence broadcast · `session_changed` control message |
| Session sidebar (v0.2.0) | Codex-style left panel · relative time · 3-dot menu · inline rename (Enter/Esc) · cross-client `session_renamed` broadcast |
| Providers | `openai-completions` · `openai-responses` · `anthropic-messages` · dual-clock TTFB 5s + chunk 1.5s · 401/403/400 fatal, 429/5xx retry |
| WebSocket | Inbound limits 64KB / 10 msg/s · heartbeat 60s · resync protocol · dead-letter queue |
| Safety | systemPrompt forbids kill / source-mod / `data/sessions/` access · API key via `.env` only · session ownership prevents cross-user access |

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
| `/label <text>` | Rename the current session (v0.2.0+) |
| `/exit` | Exit the application |

## 📚 Docs

- [Architecture](./ARCHITECTURE.md) — layered design, module map, event flow
- [Deployment](./docs/deployment.md) — VPS deployment with systemd + nginx/Caddy
- [Changelog](./CHANGELOG.md) — versioned release notes
- [PLAN-L1.md](./PLAN-L1.md) — L1 task plan (user system + multi-client sync, complete)
- [PLAN-L2.md](./PLAN-L2.md) — L2 roadmap (reliability + IM integration, planned)
- [Comparison](./docs/comparison-pi-nanobot-ga.md) — architecture comparison with pi-agent / nanobot / GenericAgent

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
npm test              # 58 files, 584 tests
npx tsc --noEmit      # strict type check, 0 errors
```

E2E covers the full agent loop: basic conversation, tool calls, multi-turn context, persistence, working memory, error recovery, WebSocket resync, slash commands, compaction, cross-session inheritance, user registration/login, session ownership isolation, and multi-client real-time sync.

## 🤝 Contribute

PRs welcome. The codebase is intentionally small — 70+ source files, ~8000 LOC.

### Roadmap

- **L1 ✅ (v0.2.0)** — User system (registration/login), per-browser session isolation, multi-client sync, Codex-style sidebar, session rename
- **L2** — Reliability (ring buffer sharding, JSONL history persistence, HttpOnly cookie), extensibility (MixinProvider failover, config hot-reload, hook system), UX (CLI overlay/diff, WebUI split to Cloudflare Pages), IM integration (Telegram as first channel)
- **L3** — FallbackProvider + circuit breaker, OAuth, session branching, cross-session long-term memory, Feishu/DingTalk integration, AgentHarness + subagent management
- **Multi-modal** — image input/outputs
- **MCP** — Model Context Protocol tool extensions

## 📄 License

MIT (see [LICENSE](./LICENSE)).

<div align="center">
  <em>Built as a personal learning project. Thanks for visiting ✨ aptbot!</em>
</div>
