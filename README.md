<div align="center">
  <p>
    <img src="https://img.shields.io/badge/tests-938%20passed-brightgreen" alt="Tests">
    <img src="https://img.shields.io/badge/TypeScript-strict-blue" alt="TypeScript">
    <img src="https://img.shields.io/badge/node-%3E%3D20-green" alt="Node">
    <img src="https://img.shields.io/badge/version-0.2.3-blue" alt="Version">
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

> **Status:** v0.2.3 — 19 structured articles (Track 1: Agent 体系实践 13 + Track 2: AI 辅助编码实践 6) + user feedback system (Web form + JSONL storage + `/feedback` CLI). Learn system is opt-in via `learnPage: true` (requires `landingPage: true`); feedback collection defaults to on (`feedbackEnabled: true`).

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

## 📖 Learn system (v0.2.3)

aptbot doubles as a learning project — "use it and learn agent from 0 alongside it." The learn system ships 19 structured articles plus a visitor feedback channel. Both are opt-in via config so a clone-and-self-host user sees zero change by default.

### Enable

In `config/aptbot.json` set `landingPage: true` and `learnPage: true`. The learn routes (`/learn`, `/learn/:slug`, `/feedback`) only activate when both are true. `feedbackEnabled` defaults to `true`, so `POST /api/feedback` works even without the landing/learn pages (a self-hoster can collect feedback through their own front-end).

```json
{
  "landingPage": true,
  "learnPage": true,
  "feedbackEnabled": true
}
```

### What it does

- **Knowledge section** — 19 articles in two tracks:
  - Track 1「Agent 体系实践」(13 articles): what is an agent, aptbot architecture, provider/tool/memory/skills/hook/channel/session/security internals, error/streaming UX, full MVP → 0.2.2 evolution recap, future roadmap
  - Track 2「AI 辅助编码实践」(6 articles): superpower workflow, TDD + version control + UAT, spec lifecycle, long-term iteration, capability boundaries, continuous improvement
- **Routes** — `/` landing page renders a 6th "Knowledge" section (article cards grouped by track + chapter); `/learn` lists all 19 articles with track filter + collapsible chapters; `/learn/:slug` is a reading-first article page (max-width 720px) with prev/next nav and an inline feedback form; planned articles show a PLANNED badge + outline placeholder
- **Feedback channel** — `/feedback` is a general feedback page; every article page has a feedback form at the bottom. Visitors submit thoughts / bugs / feature requests under `general | article | bug | feature`

### Article storage & rendering

Articles live in `src/learn/articles/*.md` as markdown with YAML frontmatter (`slug` / `title` / `description` / `track` / `chapter` / `order` / `difficulty` / `estimatedReadingTime` / `status` / `prerequisites` / `lastUpdated` / `tags`). At runtime `ArticleLoader` parses them with `gray-matter`, validates with `zod`, and renders published articles with `marked@15` (gfm + heading-id slugification + `data-language` on `<pre>`). Rendered HTML is cached in memory; mtime-based lazy hot-reload picks up edits without a server restart. Validation failures emit a stderr warning and skip the file without blocking startup.

### Feedback storage

Feedback is appended to `${dataDir}/feedback.jsonl` (one JSON object per line, append-only, reusing the existing JSONL + per-file mutex primitives). Reads stream-parse tolerantly (corrupt lines are skipped with a warning). `moderate` rewrites the whole file under per-file lock (acceptable given low expected volume). Submission is rate-limited per IP (10/min + 60/hour, in-memory sliding window, resets on restart). Listing and moderation require `APTBOT_AUTH_TOKEN`.

### Manage feedback from the CLI

```
/feedback                  # list recent 10 open feedback (default)
/feedback all              # list all statuses (incl. resolved/archived)
/feedback <id>             # show a single entry's detail (note / moderatedAt)
/feedback resolve <id> [n] # mark as resolved, optional note
/feedback archive <id>     # archive
/feedback stats            # counts by status / category
```

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
| Landing page (v0.2.1) | adept.ai-style 5-section landing at `/` (opt-in via `landingPage: true`) · zh/en i18n · `/demo` route for agent page |
| Knowledge section (v0.2.3) | 19 structured articles (Track 1: Agent 体系实践 13 + Track 2: AI 辅助编码实践 6) at `/learn` + `/learn/:slug` · markdown + frontmatter source · runtime `marked` rendering · opt-in via `learnPage: true` (requires `landingPage: true`) |
| User feedback (v0.2.3) | `/feedback` page + `POST /api/feedback` (general/article/bug/feature) · JSONL append-only storage · per-IP rate limit (10/min + 60/hour) · `/feedback` CLI (list/all/detail/resolve/archive/stats) · default on via `feedbackEnabled: true` |
| Reliability (v0.2.2) | per-sessionKey ring buffer sharding + LRU (1000/50000 caps) · JSONL history replay fallback · `turn_busy` queue feedback |
| Multi-provider failover (v0.2.2) | `MixinProvider` priority-chain failover · `springBackMs` rebound · AggregateError on all-fail · stream-aware no-switch |
| Config hot-reload (v0.2.2) | mtimeNs lazy-watch · turn isolation (current turn uses old snapshot, next turn uses new) · graceful degrade on invalid |
| Hook system (v0.2.2) | 8 hook points (`agent_before/after` · `turn_before/after` · `llm_before/after` · `tool_before/after`) · priority sort · swallow exceptions · two-layer plugin dirs |
| Skills system (v0.2.2) | two-layer loading (`~/.aptbot/skills/` + `src/skills/`) · frontmatter validation · L1 index with lastUsed ranking · 4K token budget truncation |
| Security (v0.2.2) | HttpOnly + Secure + SameSite=Strict cookie · WS token 3-tier priority (URL ?token= > cookie > sessionStorage) · `Cache-Control: no-store` |
| Session UX (v0.2.2) | auto-generated ≤20-char summary (LLM) · `/label` permanent override · `/session` dynamic attrs (temperature/maxTokens/reasoningEffort/thinkingType/thinkingBudgetTokens) · `/session.reset` |
| Channel abstraction (v0.2.2) | `TransportChannel` minimal interface (type/send/close/isAlive) · `wrapTransportChannel` adapter · `bindSession` many-to-one · dead-channel auto-unbind |
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
| `/session` | Show or set session dynamic attributes (v0.2.2+: temperature/maxTokens/reasoningEffort/thinkingType/thinkingBudgetTokens) |
| `/session.reset` | Reset all session dynamic attributes to defaults (v0.2.2+) |
| `/sessions` | List all sessions (current marked with `(current)`) |
| `/resume <id>` | Switch to a session (short ID prefix matching) |
| `/continue <id>` | Inherit working memory from an old session |
| `/label <text>` | Rename the current session (v0.2.0+) · permanently overrides auto-summary (v0.2.2+) |
| `/feedback [subcmd] [args]` | Manage user feedback (v0.2.3+): blank/`list` recent 10 open · `all` · `<id>` detail · `resolve <id> [note]` · `archive <id>` · `stats` |
| `/exit` | Exit the application |

## 📚 Docs

- [Architecture](./ARCHITECTURE.md) — layered design, module map, event flow
- [Deployment](./docs/deployment.md) — VPS deployment with systemd + nginx/Caddy
- [Changelog](./CHANGELOG.md) — versioned release notes
- [PLAN-L1.md](./PLAN-L1.md) — L1 task plan (user system + multi-client sync, complete)
- [PLAN-0.2.2.md](./PLAN-0.2.2.md) — 0.2.2 task plan (reliability + extensibility + UX, complete)
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
npm test              # 66 files, 687 tests
npx tsc --noEmit      # strict type check, 0 errors
```

E2E covers the full agent loop: basic conversation, tool calls, multi-turn context, persistence, working memory, error recovery, WebSocket resync, slash commands, compaction, cross-session inheritance, user registration/login, session ownership isolation, and multi-client real-time sync.

## 🤝 Contribute

PRs welcome. The codebase is intentionally small — 70+ source files, ~8000 LOC.

### Roadmap

- **L1 ✅ (v0.2.0)** — User system (registration/login), per-browser session isolation, multi-client sync, Codex-style sidebar, session rename
- **v0.2.1 ✅** — aptbot.de landing page (adept.ai style) + demo page visual migration + mobile adaptation
- **v0.2.2 ✅** — Reliability + extensibility + UX: MixinProvider failover, config hot-reload, hook system (8 points), Skills system + L1 index, JSONL history replay, HttpOnly cookie, turn_busy, /session dynamic attrs, Channel abstraction, session auto-summary
- **v0.2.3 ✅** — Learn system: 19 structured articles (Track 1 Agent 体系实践 13 + Track 2 AI 辅助编码实践 6) at `/learn` + `/learn/:slug` · user feedback system (`/feedback` page + `/api/feedback` + JSONL storage + `/feedback` CLI) · config `learnPage` (opt-in) + `feedbackEnabled` (default on) · new deps `marked@15` + `gray-matter@4`
- **L2** — Reliability (ring buffer sharding, JSONL history persistence, HttpOnly cookie), extensibility (MixinProvider failover, config hot-reload, hook system), UX (CLI overlay/diff, WebUI split to Cloudflare Pages), IM integration (Telegram as first channel)
- **L3** — FallbackProvider + circuit breaker, OAuth, session branching, cross-session long-term memory, Feishu/DingTalk integration, AgentHarness + subagent management
- **Multi-modal** — image input/outputs
- **MCP** — Model Context Protocol tool extensions

## 📄 License

MIT (see [LICENSE](./LICENSE)).

<div align="center">
  <em>Built as a personal learning project. Thanks for visiting ✨ aptbot!</em>
</div>
