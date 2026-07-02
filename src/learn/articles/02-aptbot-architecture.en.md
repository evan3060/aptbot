---
slug: "02-aptbot-architecture"
title: "aptbot Overview: Layered Architecture and Design Philosophy"
description: "Four-layer architecture (access/bus/core/infrastructure) + shared design motivation, why strict unidirectional dependencies matter, comparison of three agent architecture approaches, and the 'Your..."
track: agent-practice
chapter: Getting Started
order: 2
difficulty: beginner
estimatedReadingTime: 20
status: published
prerequisites:
  - 01-what-is-agent
lastUpdated: "2026-07-02"
tags:
  - architecture
  - layered-design
  - aptbot
  - dependency-injection
---

In the previous article, we understood what an agent is at the "conceptual level"—the ReAct loop, four core components, and the agent loop. This article shifts to the "engineering level": how should an agent system's code be organized? How are layers divided? How are dependencies managed? How do modules collaborate without tangling with each other?

We'll first use aptbot's four-layer architecture as a concrete example to understand the real motivations behind layered design. Then we'll compare three different agent architecture approaches, looking at what each sacrifices. Finally, we'll land on aptbot's design philosophy—why it's neither a framework nor a SaaS, but rather "your agent."

## 1. Four-Layer Architecture: access / bus / core / infrastructure + shared

If you open aptbot's src directory, the first thing you'll notice is four top-level directories: `access/`, `bus/`, `core/`, `infrastructure/`, plus a `shared/` directory referenced by all layers. This is not arbitrary folder naming—it's a layered design with clear intent.

![Four-Layer Architecture Diagram](/learn/articles/images/aptbot-layers.png)

### 1.1 access (Access Layer): Connecting with the Outside World

The access layer is aptbot's "facade." It handles direct interaction with the outside world—receiving external requests and returning responses that external consumers can use. Its specific contents include:

- **HTTP routes**: REST API endpoints for the WebUI or other HTTP clients to call
- **WebSocket handling**: WebSocket connection lifecycle management, supporting streaming event push
- **CLI terminal interface**: An interactive command-line interface built with Ink (React terminal rendering library)
- **Landing page HTML**: aptbot's web management interface

The core responsibility of the access layer is translation—translating external inputs into internal call parameters and translating internal events back into formats that external consumers can use. The access layer contains no business logic: it doesn't make agent decisions, manage sessions, or call LLMs. It only handles "how to connect."

The benefit of this isolation becomes clear in real scenarios: if you want to add a Slack bot integration to aptbot, you only need to add a Slack route handler in the access layer. The core layer's agent loop needs zero changes. Decoupling access methods from business logic means that for each new access method added, the risk to the core system approaches zero.

### 1.2 bus (Bus Layer): The Hub for Event Distribution

The bus layer solves a core problem: **how multiple endpoints share the same agent session**.

The simplest implementation would be "one agent instance per client," but that's wrong—if a user starts a task on their computer to have the agent edit a file, then switches to their phone to check progress, these two clients would see two independent agent sessions unaware of each other. Worse, if two clients execute conflicting operations sequentially, the agent's state would split.

The bus layer's approach: the agent does only one thing—run the loop and emit all output (LLM streaming tokens, tool call results, state changes) as events to the bus. The bus then distributes these events to all channels bound to that session. Each channel is an access endpoint (WebSocket, future Telegram, etc.), sharing the same agent session through the bus.

Key design points:

- **Typed event bus**: What travels on the bus isn't unstructured JSON strings, but typed `AgentEvent` union types. Each event has a clear shape, and consumers can handle events precisely based on their type.
- **Channel abstraction**: Each access endpoint implements the Channel interface, with core methods only `onEvent(event)` and `dispose()`. This interface is small enough that adding a new Channel implementation (e.g., a Telegram Channel) has very low cost.
- **Session binding**: A session is bound to the bus, and channels subscribe to the session's event stream through the bus.

### 1.3 core (Core Layer): The Heart of the Agent

The core layer is aptbot's most technically substantial layer, implementing the four components described in the previous article:

- **AgentLoop**: A generator implementation of the ReAct loop. Each iteration: assemble messages → call LLM → parse response → execute tool → collect result. The loop is about 150 lines, remaining clear and readable.
- **Provider**: The abstraction layer for LLM service access. The Provider interface defines a `stream(model, context, options)` method returning `AsyncGenerator<AssistantMessageEvent>`. All LLM calls go through this interface; the core doesn't need to know whether it's using OpenAI or Anthropic underneath.
- **Tool**: The tool registration and dispatch system. Each tool is a function (or more complex implementation) with clear input and output types. ToolRegistry manages all available tools, and AgentLoop executes tool calls through it.
- **Memory**: The memory system. Manages conversation history, short-term context windows, and cross-session long-term memory.
- **Skill**: The skills system. Manages reusable skill templates, allowing the agent to distill and reuse patterns for successfully solving problems.
- **Hook**: The hook system. Provides 8 extension points (beforeTurn, afterToolCall, etc.), allowing custom logic to be inserted without modifying core code.

The core layer knows nothing about the access or bus layers. It doesn't care whether the user connects via CLI or WebUI, or how events are distributed. It only focuses on "doing the agent's job"—receiving input, reasoning, acting, and outputting.

### 1.4 infrastructure (Infrastructure Layer): Connecting to Specific Technologies

The infrastructure layer is the core's "hands and feet"—it grounds abstract operations into concrete technical implementations:

- **File system**: JSONL persistence (conversation history to files), config loading, log writing
- **Subprocesses**: Creating subprocesses when the bash tool executes commands, managing process lifecycle
- **HTTP client**: Making HTTP requests when the Provider calls LLM APIs

This layer is independent because it's the "easiest to swap." For example, if today we use JSONL files for conversation history and tomorrow we want to switch to SQLite—you only need to reimplement the Memory interface in the infrastructure layer, without changing a single line of code in the core layer. Similarly, if today we use bash subprocesses to execute commands and tomorrow we want Docker containers, only the infrastructure layer implementation needs to change.

This replaceability is extremely valuable in production: different deployment scenarios require different infrastructure solutions, and the infrastructure layer's existence means these switches don't affect the agent's core logic.

### 1.5 shared (Cross-Layer Shared): Pure Types and Utilities

The shared layer is referenced by all other layers, but it **references no business layers**. It contains:

- Command registry (commands)
- Shared type definitions (shared types)
- Pure utility functions (e.g., string processing, date formatting)

The core constraint of the shared layer is "it holds no business state." A function placed in shared means it's pure—same input always produces the same output, with no dependency on global variables, no file I/O, and no external service calls. This constraint makes shared layer code naturally testable and easy to reason about.

## 2. The Significance of Strict Unidirectional Dependencies

### 2.1 Dependency Rules

The four-layer architecture isn't just about "putting code in different folders"—more critically, it's about **dependency rules**. aptbot's dependency direction is strictly unidirectional:

![Unidirectional Dependency Diagram](/learn/articles/images/aptbot-dependency.png)

The specific rules are:

- `access/*` → can reference `bus/*`, `core/*`, `infrastructure/*`, `shared/*`
- `bus/*` → can reference `core/*`, `infrastructure/*`, `shared/*`
- `core/*` → can reference `infrastructure/*`, `shared/*`, but **cannot** reference `access/*` or `bus/*`
- `infrastructure/*` → only references `shared/*` and external dependencies
- `shared/*` → references no business layers

The core requirement is: **dependency direction flows from the access layer toward the infrastructure layer, never the reverse**.

### 2.2 Why Can't It Be Reversed?

A counterexample is the most intuitive way to illustrate. Suppose the core layer directly references the access layer's WebSocket implementation. What problems arise?

First problem: **Replaceability collapses**. You want to change aptbot from web access to Telegram access, but the agent loop is filled with "if it's a WebSocket client, do X" conditional branches. Changing the access method becomes changing the core—and the core is the agent loop itself. Any change could affect the agent's reasoning behavior. Adding Telegram integration ends up breaking the agent, which is unacceptable.

Second problem: **Testability crashes**. You want to write a unit test for AgentLoop—testing whether it correctly parses a response after receiving a tool call request. But if AgentLoop depends on a WebSocket implementation, you must first spin up a WebSocket server and connect a client before running the test. A test that should take 5 lines becomes 50 lines of environment setup. The test becomes an integration test—slow to run, painful to change, and eventually the team gives up on testing.

Third problem: **Logic pollution**. The agent loop's code contains concepts from the access layer—"if it's WebSocket, send errors this way; if it's CLI, prompt that way." Business logic and access details become entangled, severely degrading code readability. New members must understand all access methods before understanding the agent loop—which runs counter to the principle of separation of concerns.

Unidirectional dependencies solve all three problems:

- **Replaceability**: The core layer doesn't know the access layer exists. Adding a new access method doesn't touch the core. Swapping infrastructure (JSONL → SQLite) doesn't change the core interface.
- **Testability**: Testing the core layer only requires mocking two interfaces (Provider and ToolRegistry), without spinning up HTTP services or WebSocket connections. A core AgentLoop test can be kept under 20 lines.
- **Logic purity**: The agent loop's code only contains "decision-making" logic, not "how to transmit" details. Someone reading the code only needs to understand the agent itself, not all access methods.

### 2.3 A Real Case of Reverse Dependency

At one point, aptbot's session management included a direct reference to the access layer's WebSocket state—the session needed to know "how many clients are currently connected" to make certain decisions. This violated the dependency rules (core referencing access).

The consequences appeared quickly: testing session logic required mocking WebSocket connections, slowing tests down. Later, when trying to add CLI access, it turned out the session had hardcoded WebSocket as the "default access method." The eventual refactoring moved the "connection count" logic from the session layer to the bus layer. The session now only cares about its own event stream, not who's consuming it. After refactoring, session tests went from needing 3 mocks to 0 mocks (pure function tests), and CLI access only required adding a Channel implementation in the bus layer—zero changes to the session layer.

This experience validated that: **unidirectional dependency isn't dogma; it's an engineering discipline forged through real-world lessons**.

## 3. Comparison of Other Agent Architecture Approaches

aptbot's four-layer architecture isn't the only way to organize. Agent projects in the industry follow several different design approaches. Here we use Approaches A/B/C to represent three typical approaches (they correspond to certain open-source projects, but this article focuses on the design approaches themselves).

### 3.1 Approach A: Minimal Core SDK

The philosophy of this approach is "less is more"—the core is small enough that upper layers can freely compose.

**Core design:**

- **Stateless generator core**: The agent loop is a stateless async generator function, 100-150 lines of core code. It holds no state; state is managed by the upper session/harness layer.
- **End-to-end type safety**: TypeScript + schema validation libraries (TypeBox/Zod) ensure type safety at every stage—tool definitions, configuration, event streams all have complete type constraints. Most interface inconsistencies are caught at compile time.
- **Event stream model**: Agent output is not a string but `EventStream<AgentEvent>`—each event is a typed object. The upper UI renders by subscribing to event types of interest, without polling or parsing.
- **Complexity moved upward**: The core is minimal, but the upper layer may include 40+ components for a complete interactive experience. This is a "give the choice to the user" strategy—you don't introduce features you don't need.

**Advantages:** Pure core, strong composability, type safety gives confidence in refactoring.

**Cost:** Although the core is small, building a usable product requires a lot of glue code in upper layers; the event stream model is heavyweight for simple "Q&A" scenarios; the type system has a non-trivial learning curve.

### 3.2 Approach B: Self-Evolution + Ultra-Low Token

This approach has the most radical philosophy—**the agent has no preset skills; it accumulates experience while solving problems**. The more it's used, the smarter it becomes.

**Core design:**

- **Task crystallization mechanism**: After completing a task, the agent automatically abstracts the successful path into a skill and stores it in the skill library. When encountering similar tasks next time, it directly reuses the skill without reasoning from scratch.
- **Extreme token control**: By "sending only new messages" (not full history) + tag truncation + working memory checkpoints, each turn's context is kept under 30K tokens, far below the 200K-1M range of other approaches.
- **Atomic tool set**: Only 9 atomic tools cover all capabilities—with `code_run` handling both Python and bash execution in a single tool. Tools can be freely combined.
- **Bootstrapping**: The project's own code was created by the agent—the agent not only uses tools but can understand and propose modifications to its own code.

**Advantages:** Becomes increasingly personalized with long-term use; extremely low token consumption, friendly for usage-based billing; natural path for capability evolution.

**Cost:** The skill library is empty on first use, so performance is worse than approaches with preset skills; the self-evolution path is uncontrollable and may crystallize low-quality skills; the threading + generator concurrency model is more complex for multi-end access compared to async/await.

### 3.3 Approach C: Full-Stack Engineering + Configuration-Driven

The philosophy of this approach is "production-ready"—covers everything from IM channels to WebUI to scheduled tasks, all driven by configuration without code changes.

**Core design:**

- **Channel abstraction + rich implementations**: Each chat platform (Telegram, Discord, Slack...) is abstracted as a Channel, communicating through a unified MessageBus. 20+ built-in Channel implementations.
- **Configuration-driven**: 30+ built-in providers, 20+ built-in channels, all switchable through YAML/TOML configuration files. Users don't need to write code—changing configuration lets them switch models or add/remove platforms.
- **In-loop recovery**: The agent loop is a single ~400-line method, with built-in orphan repair (handling tool calls that don't return), backfill (filling in missing context), micro-compaction (context compression), and various other error recovery paths.
- **Weak typing**: Heavy use of runtime dict/JSON passing; type validation only covers the configuration layer. Core logic has loose type constraints, relying on test coverage for refactoring.

**Advantages:** Out-of-the-box, feature-complete; wide multi-platform coverage; low barrier to entry with configuration-driven approach.

**Cost:** The single 400-line loop has poor readability, making it hard for new members to understand; weak typing poses high risks during refactoring (changing one field may cause multiple runtime errors); feature-complete but each module lacks refinement.

### 3.4 Architecture Approach Comparison

| Dimension | Approach A (Minimal SDK) | Approach B (Self-Evolution) | Approach C (Full-Stack Engineering) |
|---|---|---|---|
| Core philosophy | Less is more, composable | No preset skills, evolve through use | Production-ready, config-driven |
| Core loop size | ~150 lines | ~100 lines | ~400 lines |
| Type safety | Strong (end-to-end TypeBox/Zod) | Weak (almost no type constraints) | Weak (config layer Pydantic only) |
| Token strategy | Medium (full context) | Ultra-low (<30K, truncation + checkpoint) | High (relies on large context window) |
| Tool strategy | User-written + built-in composition | Atomic tools + auto-crystallization | 30+ built-in tools |
| Multi-platform | None (pure SDK, user integrates) | Limited (multi-frontend, not Channel) | 20+ Channels |
| Test difficulty | Low (pure functions + mock interfaces) | Medium (stateful but single process) | High (complex multi-platform dependencies) |
| Who it's for | Developers embedding into products | Personal long-term desktop assistant | Team multi-platform operations |

## 4. aptbot's Design Characteristics

### 4.1 Positioning Determines Trade-offs

In the previous article, we said aptbot has a dual identity: **learning project** and **personal assistant**. This dual identity determines that aptbot's architectural style must find its own position among the three approaches above.

In comparison:

- It can't be like Approach A, which is just an SDK—learners need to see a complete product. They need to understand "the full lifecycle of an agent from startup to service," not just a kernel.
- It can't be like Approach C, which piles on features—learners would be overwhelmed by a 400-line loop and 20+ Channel implementations, unable to find the main thread.
- It can't be like Approach B, which chases self-evolution—beginners can't understand uncontrollable skill crystallization, and the self-evolution path's strong path dependency isn't suitable for teaching.

### 4.2 Key Architectural Decisions

Based on this positioning, aptbot makes the following choices on several key dimensions:

**Type safety (aligning with Approach A)**: Chooses TypeScript + Zod as the type system. This is both an engineering quality guarantee and a teaching advantage—reading the code reveals the shape of every data structure. An `AgentEvent` union type definition does more to help people understand what an agent outputs than ten pages of documentation. The compile-time checking from type safety also reduces the risk of learners "breaking things without knowing it" when modifying code.

**Core loop (referencing Approach A's layered approach)**: AgentLoop maintains a stateless generator style at about 150 lines. Complexity moves up to the session layer (state management) and harness layer (lifecycle management). This lets newcomers first understand the simple "input → reason → tool → output" loop, then progressively see how upper layers manage state and lifecycle.

**Event stream (different from Approach B's string yield)**: Uses a typed EventStream, where each event has a clear type and payload. This lets the UI layer subscribe to events in a type-safe manner, and lets learners precisely understand "what kinds of things the agent output stream may contain" when reading the code.

**Tool system (different from Approach B's atomic tool self-crystallization)**: Provides a preset, well-documented tool set, with each tool having clear definitions and parameter descriptions. Learners can instantly see what the agent can and cannot do.

**Multi-end access (different from Approach C's 20+ Channels)**: MVP focuses on CLI + WebSocket two types of access. But retains the Channel abstraction and bus layer for future extensibility. The architecture maintains Approach C's extensibility while keeping implementation complexity under control.

**Memory and reliability**: This is where aptbot invests the most effort—Provider failover, tool security boundaries, memory compaction, Hook plugin mechanism—each addresses "how to make the agent more reliable in real-world environments." These will be explored in depth in subsequent articles.

### 4.3 Teaching-First Readability Constraint

Compared to other approaches, aptbot has a unique constraint: **teaching-first readability**.

Other approaches optimize for performance (low latency), tokens (low cost), or feature coverage (multi-platform). aptbot considers these but adds an extra criterion: **the code and architecture must be readable by beginners**.

This means aptbot actively avoids some "clever but obscure" implementation techniques. A concrete example: aptbot's configuration loading doesn't use "runtime reflection + auto-binding of config classes" magic. Instead, it uses an explicit three-step flow: `readConfig()` → `validateConfig()` → `applyConfig()`. The former is more "elegant" (less code), while the latter is more "plain" (people reading the code can follow step by step how the config is loaded and applied).

This isn't a technical concession—from the project's positioning, a project designed to teach agents cannot itself be a black box. If aptbot itself is hard to understand, it loses its reason to exist.

## 5. Future Directions

The four-layer architecture provides a clear roadmap for aptbot's evolution. Each layer can evolve independently without affecting the others.

**access layer**: The near-term focus is IM integration (Telegram as the first channel). This will verify whether the Channel abstraction design is truly sufficient—when the connection is not a "WebSocket client" but an "IM Bot," does the Channel interface need modification?

**bus layer**: The scaling direction is "event routing"—when a single instance serves multiple users and multiple sessions, the bus needs to upgrade from simple event broadcasting to event routing. User A's events only go to user A's channels.

**core layer**: The ongoing direction is "smarter agent behavior"—better context compression strategies, more reliable error recovery, deeper control over multi-turn reasoning. core layer evolution is aptbot's long-term main thread.

**infrastructure layer**: The expansion direction is storage backend diversity—from JSONL to SQLite to S3, enabling aptbot to adapt to different deployment scales.

**shared layer**: Maintain its "stateless" collection of pure functions, continuously refining utility functions shared across layers.

## Summary

This article dissected aptbot's architectural design from an engineering perspective:

1. **Four-layer architecture** (access/bus/core/infrastructure) + shared layer, each with clear responsibility boundaries. access handles connections, bus handles distribution, core handles reasoning and decisions, infrastructure handles technical implementation, and shared handles pure types and utilities.
2. **Strict unidirectional dependencies** are the engineering discipline for "replaceability + testability." Counterexamples prove: core depending on access layers leads to high replacement costs, slow tests, and logic pollution.
3. **Three architectural approaches** compared: Approach A (Minimal SDK) pursues composability, Approach B (Self-Evolution) pursues autonomous accumulation, Approach C (Full-Stack Engineering) pursues production readiness.
4. **aptbot's choices**: Takes the strengths of each approach, adding a "teaching readability" constraint. TypeScript + Zod ensures type safety, clear layering ensures readability, and the learning-oriented positioning determines every trade-off.

Architecture is the skeleton. The next article examines the flesh—the Provider system, which is responsible for making the agent's brain (LLM) truly operational, handling multiple protocols, multiple models, and failover.
