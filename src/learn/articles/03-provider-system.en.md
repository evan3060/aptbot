---
slug: "03-provider-system"
title: "Provider System: Multi-Protocol, Multi-Model, Failover"
description: "Design motivation for separating API from Provider, three API protocols, dual-clock streaming control, error classification with retry and backoff, MixinProvider failover and spring-back mechanism,..."
track: agent-practice
chapter: Deep Dive into Core Features
order: 3
difficulty: intermediate
estimatedReadingTime: 22
status: published
prerequisites:
  - 02-aptbot-architecture
lastUpdated: "2026-07-02"
tags:
  - provider
  - streaming
  - retry
  - failover
  - llm
---

In the previous architecture article, we learned that Provider is one of the key components in the core layer—it acts as the bridge between the agent and LLM services. But this bridge is not a straight pipe; it's a complete system encompassing protocol adaptation, streaming control, error classification, and failover.

This article starts with "why a Provider system is needed" and progressively breaks down each layer of its design: the separation of API and Provider, three built-in protocols, dual-clock streaming control, error classification with backoff retry, and MixinProvider's failover and spring-back mechanism. Finally, we compare three different provider management approaches to understand why aptbot chose its current path.

## 1. Concepts: From "Calling an API" to a "Provider System"

### 1.1 The Simplest Approach

In the simplest agent implementation, "calling an LLM" might be just a few lines of code:

```typescript
const response = await fetch('https://api.openai.com/v1/chat/completions', {
  method: 'POST',
  headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ model: 'gpt-4', messages: [...] }),
});
const data = await response.json();
```

This works well enough with one model, one provider, and no concern about failures. But once the scenario becomes complex—needing Claude, a locally deployed model, handling provider outages, or implementing failover—these few lines quickly balloon into an unmaintainable mess.

The Provider system was born to manage this complexity. It breaks down "communicating with an LLM" into multiple composable layers, each solving a specific problem.

### 1.2 Two Core Concepts: API and Provider

aptbot distinguishes two core concepts in the Provider system:

**API (Protocol)** describes "how to converse"—the format of requests and responses, how streaming events are parsed, and what error codes mean. It's the definition of a communication protocol.

**Provider (Service Provider)** describes "who to converse with"—the specific service provider (OpenAI, Anthropic, self-hosted vLLM...), its endpoint, apiKey, and available models.

Why separate these two concepts? Because **the same protocol is implemented by numerous providers**. OpenAI's Chat Completions protocol is implemented by Azure OpenAI, OpenRouter, local vLLM, DeepSeek, Together AI, and dozens of other providers. If the protocol and provider were coupled, adding a new provider would require rewriting streaming parsing, error handling, and retry logic every time. By separating them, adding "a provider that uses the OpenAI protocol" only requires filling in three configuration items: endpoint + apiKey + model. The protocol parsing logic is fully reused.

The engineering benefit of this separation is direct: aptbot 0.2.x has three built-in API protocols, but the number of providers accessible through these three protocols is far greater—as long as a provider is compatible with OpenAI's or Anthropic's protocol, it can be integrated.

## 2. General Design: Core Components of a Provider System

Regardless of which agent framework you use, a complete Provider system typically needs to address the following problems.

### 2.1 Protocol Adaptation

Different LLM providers have incompatible APIs. OpenAI uses `messages[]` arrays with `delta.content` in streaming format; Anthropic uses `content[]` blocks with different event types; Google Gemini has yet another format. The protocol adaptation layer is responsible for converting the agent's internal unified message format into each provider's request format and converting each provider's response format back into a unified event stream.

This is a classic "Adapter Pattern"—one adapter per protocol, with consistent interfaces between adapters, allowing the agent core to talk only to the unified interface.

### 2.2 Streaming Control

LLM responses are streamed, not returned all at once. Streaming control primarily addresses two issues:

- **Timeout detection**: How long without receiving the first byte after sending a request counts as a timeout? How long between two chunks after streaming has started counts as a disconnection?
- **Stream interruption handling**: If the user cancels midway, the network disconnects, or a server-side exception causes the stream to break, how should the system respond?

Without fine-grained streaming control, users experience the awful feeling of "the spinner never stops" or "it's stuck and I don't know if it's still running."

### 2.3 Error Classification and Retry

LLM call errors come in various types: request format issues (400), authentication problems (401), quota exceeded (429), temporary server failures (5xx), and network layer problems (ECONNRESET). Different types of errors need different handling strategies—some should be retried, while retrying others is pointless.

If all errors use the same retry logic, the result is: the ones that should be retried don't get enough attempts, and the ones that shouldn't be retried waste quota.

### 2.4 Failover

A single provider is always potentially unavailable—quota exhausted, service outage, network partitioning. A failover mechanism allows the agent to automatically switch between multiple providers, ensuring service continuity.

Core issues include: switching strategy (priority, round-robin, parallel), fallback strategy (whether to automatically switch back when the primary service recovers), and state management (what happens to the current request during a switch).

## 3. Implementation of aptbot's Provider System

Now that we understand the general problems a Provider system needs to solve, let's look at aptbot's specific implementation. This is currently one of the most mature subsystems in aptbot.

### 3.1 Engineering Manifestation of API/Provider Separation

In aptbot's code structure, APIs and Providers are placed in separate directories:

- `core/provider/api/`: One implementation file per API protocol, handling protocol-level request construction and response parsing
- `core/provider/providers/`: One implementation file per provider, holding configuration information for that provider (endpoint, apiKey, model list)

The process for adding a new provider is: choose an existing API protocol implementation (e.g., `openai-completions`), create a new file in `providers/`, and fill in the endpoint and model configuration. The protocol parsing logic is fully inherited from the API layer.

This separation shows its effectiveness in ongoing maintenance: when OpenAI modifies the streaming event format, only `api/openai-completions.ts` needs to change; when integrating "a new provider compatible with the OpenAI protocol," only a few lines of configuration need to be added in `providers/`.

### 3.2 Three Built-in API Protocols

aptbot 0.2.x includes three built-in API protocols, covering the current mainstream LLM services:

**openai-completions**: An implementation based on the OpenAI Chat Completions protocol. This is the de facto industry standard. The request format uses the `messages` array, streaming responses use SSE (Server-Sent Events), and each event contains `delta.content`. The vast majority of compatible providers—OpenAI, Azure OpenAI, OpenRouter, DeepSeek, vLLM, Together AI—use this protocol.

**openai-responses**: OpenAI's newer Responses API protocol. Compared to Completions, it natively supports tool calling, multimodal input (images/audio), and reasoning models (o1/o3). Switch to this protocol when the agent needs these capabilities. It shares the SSE streaming foundation with Completions but has a different event structure.

**anthropic-messages**: Anthropic's Messages API protocol. It is incompatible with the OpenAI protocol family—different request format (`content` blocks instead of `messages` arrays), different streaming event types (`content_block_delta` series), and different tool call structures. Claude series models must use this protocol.

Each protocol implements the same core interface:

```typescript
stream(model, context, options): AsyncGenerator<AssistantMessageEvent>
```

This interface is completely transparent to the agent core. The core doesn't care which protocol is underneath; it only calls the `stream()` method and receives a unified event stream.

### 3.3 Dual-Clock Streaming Control

Streaming responses have two independent failure modes, and aptbot uses "dual clocks" to handle each:

![Provider Failover Flow](/learn/articles/images/provider-failover.png)

**TTFB (Time To First Byte)**: After the request is sent, the server doesn't return the first token for a long time. Possible causes include provider congestion, model loading, or network latency. aptbot sets a 5-second limit—if no data is received within 5 seconds after the request, the request is considered failed.

**Inter-chunk timeout**: Streaming has started yielding data, but gets stuck between two chunks. Possible causes include mid-stream network jitter or the server hanging during inference. aptbot sets a 1.5-second limit—if the interval between any two chunks exceeds 1.5 seconds, the stream is considered interrupted.

Why two clocks instead of one? Because they correspond to different failure characteristics:

- Long TTFB but stable subsequent stream: The server needs time during the preparation phase (e.g., model loading), but once generation starts, everything is normal. In this case, sufficient time should be given to wait for the first byte.
- Stream stuck after starting: Something went wrong during server inference. Waiting is useless in this case—if it's already generated halfway but suddenly gets stuck for 5 seconds, the server has likely crashed.

A single clock can't cover both scenarios: a 5-second TTFB is too loose for the "stream already started" scenario (you don't want to wait 5 seconds after streaming has started), and a 1.5-second inter-chunk timeout is too strict for the "stream hasn't started" scenario (model loading may take more than 1.5 seconds).

The two clocks are independent and each triggers failover separately. This is the common "dual watchdog" pattern in streaming systems—each clock monitors one failure mode without interfering with the other.

### 3.4 Error Classification and Backoff Retry

Not all errors are worth retrying. aptbot classifies errors into three types:

**fatal errors (400/401/403)**: Request format errors, authentication failures, insufficient permissions. Retrying these errors produces the same result because the problem is in the request itself. aptbot throws an exception immediately upon encountering a fatal error—no retry, no provider switch.

**transient errors (429/5xx)**: Rate limiting, temporary server failures. These errors are worth retrying—the rate limit window may have passed, and the server may have recovered. aptbot uses exponential backoff retry: first retry waits 1 second, second waits 2 seconds, third waits 4 seconds. If it still fails after 3 retries, it switches providers.

**network errors (ECONNRESET/ETIMEDOUT)**: Network connection reset, request timeout. These errors have similar characteristics to transient errors and are handled with the same strategy: exponential backoff + retry + provider switch.

Exponential backoff isn't simply "double each time"—aptbot adds **jitter (random offset)**. Specifically, a random offset is added to each backoff delay to prevent multiple clients from retrying synchronously at the same time (the "thundering herd problem"). If 10 clients are rate-limited simultaneously, without jitter they would all wait 1 second, retry together, and get rate-limited again—forming a "retry storm." Jitter spreads these 10 retries across different time points around 1 second, greatly reducing the probability of repeated conflicts.

### 3.5 MixinProvider Failover

Even with a retry mechanism, a single provider may remain persistently unavailable—a major provider outage, or an account quota completely exhausted. MixinProvider solves this problem.

MixinProvider is a special implementation of the `Provider` interface: it **wraps multiple child Providers**, attempting them in priority order, and automatically falls through to the next when the previous one fails. All child Providers share the same API protocol (MixinProvider validates protocol consistency in the constructor).

Core mechanisms:

- **Priority order**: The lower the index in the child Provider array, the higher the priority. Typically arranged as [primary, secondary, tertiary]. Attempts start from the first one.
- **Ultimate failure**: When all child Providers fail, it throws an `AggregateError` aggregating all child provider error information for easy debugging. It does not "silently fail" or "return partial results."
- **Same protocol constraint**: All child Providers must use the same API protocol (e.g., all openai-completions). This is because MixinProvider's switching must be transparent to the layer above—from AgentLoop's perspective, it's still the same Provider interface; switching protocols cannot change the event format.

**springBackMs mechanism**:

After switching to a secondary provider, MixinProvider does not permanently stay on the secondary. It has built-in spring-back logic: every `springBackMs` milliseconds (default 5 minutes), the next call will **re-attempt the primary provider**. If the primary is available, it switches back; if still unavailable, it continues using the secondary and waits for the next spring-back cycle.

The intuitive meaning of this mechanism is: **automatically converge to the optimal provider**. If the primary fails briefly (e.g., for 2 minutes) and then recovers, MixinProvider will automatically detect this within 5 minutes and switch back, without "once degraded, permanently degraded."

Why not permanently switch back? Because "probing" has a cost—if the primary hasn't recovered, probing wastes a request. The springBackMs setting must balance "timely recovery" against "probing cost." 5 minutes is a reasonable default: for most LLM provider failure scenarios (typically brief interruptions on the order of minutes), 5 minutes is sufficient for recovery, and the cost of one probe every 5 minutes is negligible.

**Broadcast property**:

MixinProvider also has a practical feature: `broadcastAttr(key, value)`. When setting a property (such as `temperature`, `maxTokens`, `systemPrompt`), it automatically synchronizes to all child Providers. This way, when the upper layer switches providers, it doesn't need to worry about property synchronization—AgentLoop sets it once, and MixinProvider handles distribution.

### 3.6 No Switch After Streaming Has Yielded

This rule is easy to overlook but is critically important: **if the stream has already yielded data (the user has already seen partial output), do not switch providers even if an error occurs later**.

Why? Consider this scenario: the agent is streaming a response through the primary provider, and the user has already seen the first half of "Based on the code analysis, the cause of this bug might be..." when the network disconnects. If MixinProvider switches to the secondary provider and makes a new request, it would generate a completely different second half. The user would see a mixed output of "first half from GPT-4, second half from Claude"—besides potentially inconsistent content, the user can't even trust the part they've already seen (because the second half was silently replaced).

aptbot's approach is: **expose the error to the user and terminate the current stream**. It yields an `{ type: 'error', error: ... }` event in the event stream, letting the user know "the output is incomplete because of error X." The user decides whether to retry (starting a complete new generation) or accept the existing result.

This is a clear trade-off between "correctness vs. completeness": **not switching providers sacrifices completeness (output is truncated), but preserves correctness (the already-output part is authentic and trustworthy)**. In agent output, "untrustworthy content" is far more serious than "truncated content"—if users don't know which parts to trust, the entire agent's credibility is destroyed.

## 4. Comparison of Other Provider Approaches

LLM call management is a problem every agent project must solve. Different projects have different approaches. Here we compare three typical approaches.

### 4.1 Approach A: Single Provider Static Configuration

The simplest approach—hardcode a single provider in the configuration (e.g., `model: gpt-4`), and all requests go through this provider.

**Characteristics:**
- Simple and direct configuration, done with one line `model: gpt-4`
- No failover—if the provider goes down, the agent crashes
- No error classification retry—request failure directly results in an error
- Suitable for demos and prototypes

**Applicable scenarios:** Rapid prototyping, personal experiments with low availability requirements.

**Cost:** Zero fault tolerance. Once the provider goes down, the agent is completely unusable. Unacceptable in production.

### 4.2 Approach B: Chain Passthrough

Configure multiple providers, attempting requests in sequence—if the first fails, passthrough to the second; if the second fails, passthrough to the third.

**Characteristics:**
- Supports basic failover, more reliable than a single provider
- Flexible configuration, providers can be organized by priority
- But no spring-back mechanism—once switched to secondary, it never tries the primary again
- Simple retry logic, typically without error classification
- Streaming support varies by implementation

**Applicable scenarios:** Small to medium deployments needing basic high availability without pursuing refinement.

**Cost:** Configuration complexity significantly higher than Approach A; no spring-back mechanism leads to "once degraded, permanently degraded"; lack of error classification means 401 and 429 are handled the same way (both retried), wasting quota.

### 4.3 Approach C: Mixin Multi-Provider Parallel Optimization

The most comprehensive approach—request from multiple providers in parallel, taking the fastest result. Send requests to both GPT-4 and Claude simultaneously, and use whichever returns first.

**Characteristics:**
- Optimal latency—takes the fastest response, not waiting for the slowest
- Naturally fault-tolerant—one provider going down doesn't affect the whole system
- But cost doubles—every request is sent to multiple providers
- Result consistency is hard to guarantee—different models may give different responses; how to choose?
- Parallel overhead is even larger in streaming scenarios—every token stream must be maintained in parallel

**Applicable scenarios:** Scenarios extremely sensitive to latency, unconcerned about cost, and not requiring consistent response results.

**Cost:** N times the cost (N = number of parallel providers); complex result selection logic; high streaming support cost.

### 4.4 Approach Comparison

| Dimension | Approach A (Single Static) | Approach B (Chain Passthrough) | Approach C (Parallel Optimization) |
|---|---|---|---|
| Failover | None | Yes, one-way fallback | Naturally fault-tolerant |
| Spring-back | N/A | No | N/A |
| Error classification | None | None/Simple | None |
| Cost | Low | Medium (extra cost from fallback requests) | High (N times) |
| Latency characteristic | Normal | Slow during fallback | Optimal |
| Result consistency | Fully consistent | Inconsistent (different provider content) | Inconsistent |
| Streaming support | Full | Limited (complex passthrough implementation) | Difficult (multi-stream selection) |
| Configuration complexity | Very low | Medium | High |

## 5. aptbot's Design Characteristics

### 5.1 MixinProvider + Spring-Back Combination

aptbot's choice is essentially a "refined Approach B"—priority-based chain fallback, but with the addition of a spring-back mechanism as compensation.

The core considerations for this choice are:

**Why not Approach A (Single Static)?** Because aptbot is a personal assistant—it can't be "broken just because one person is using it." Failover is not a nice-to-have feature; it's a fundamental requirement for actual usability. When DeepSeek goes down today or OpenAI rate-limits tomorrow, the agent should silently switch to a backup provider and keep working, not throw errors at the user.

**Why not Approach C (Parallel Optimization)?** Because of cost. In the personal assistant scenario, most requests are not latency-sensitive (users are already willing to wait for the agent's thinking process). Paying double API costs for this isn't worthwhile. More importantly, parallel optimization has a fatal flaw in agent scenarios—different models may produce different results for the same tool call, and the "faster" result chosen may not be the "more correct" result, affecting the stability of the agent's decisions.

**Why choose chain + spring-back?** Chain ensures "there's a backup plan," and spring-back ensures "no permanent degradation." The combination provides a trade-off suitable for the personal assistant scenario: use the primary by default (the most familiar model, the most stable provider), degrade to secondary when the primary has problems, and automatically switch back once the primary recovers. The user barely notices the switch happening.

### 5.2 Teaching Readability

Like the core architecture, the Provider system's code also follows the "teaching readability first" constraint:

- **Error classification is explicitly readable**: The `classifyError()` function in `retry.ts` uses clear switch-style logic (`if (status === 429) → retryable`), rather than abstract solutions like "error code range rule engines." The former has slightly more code but is immediately clear; the latter is "smarter" but requires the reader to first understand the rule engine itself.
- **Dual-clock logic is independently readable**: `withDualClock()` in `dual-clock.ts` is an independent async generator wrapper function, not coupled with other logic. Readers can read this ~90-line file alone to understand all the details of the dual-clock mechanism.
- **MixinProvider is fully presented in a single file**: The complete failover logic (priority, retry, spring-back, no switch after yield, broadcast property) is all in one file, about 220 lines. Readers don't need to jump between multiple files to piece together the full picture.

### 5.3 Summary of Differences from Approaches A/B/C

Compared to the three approaches, aptbot's Provider system has these unique characteristics:

**Difference from Approach A**: aptbot bakes provider failover into the core as a built-in capability (not an optional plugin), because the premise of "teaching" is that the agent can actually be used—a system that doesn't handle failures is not a good teaching tool.

**Difference from Approach B**: aptbot adds detailed error classification (fatal/transient/network) and dual-clock streaming control. This isn't "making things complicated"—it's showing the real engineering details of an agent system. Good teaching material should let readers see these "real-world complexities."

**Difference from Approach C**: aptbot chooses spring-back over parallel optimization because cost constraints and result consistency are higher priorities in the personal assistant scenario. This choice itself is also teaching material—it demonstrates that "engineering decisions are about trade-offs."

## 6. Future Directions

In aptbot's evolution roadmap, the Provider system has several clear improvement directions:

**Circuit breaker (FallbackProvider)**: The current MixinProvider's spring-back strategy is "continuous probing"—trying the primary every 5 minutes. But when failures are too frequent, it should enter a "circuit breaker state," ceasing attempts for a longer period to avoid the "repeated brief recovery and re-failure" jitter. This will be implemented as `FallbackProvider` in the L3 roadmap.

**More granular clock control**: The current dual-clock timeout values (5s TTFB / 1.5s chunk-interval) are hardcoded configuration items. Future versions may support provider-level clock configuration (e.g., shorter TTFB for local vLLM, longer for OpenAI).

**Cost-aware provider selection**: The current priority is fixed (primary / secondary / tertiary). Future versions may introduce a comprehensive "cost + latency + success rate" scoring system to dynamically adjust priority.

## Summary

The Provider system is one of the most engineering-complex subsystems in aptbot, and a concentrated embodiment of the "reliability" design philosophy. Reviewing the core content:

1. **API/Provider separation** enables protocol reuse and zero-protocol-coding for new provider integration. Three API protocols (openai-completions / openai-responses / anthropic-messages) cover mainstream LLM providers.
2. **Dual-clock streaming control** (5s TTFB + 1.5s inter-chunk) handles two failure modes—first-byte waiting and mid-stream stalling—independently.
3. **Error classification retry** (fatal/transient/network) + exponential backoff + jitter avoids the extremes of "pointless retries" and "retry storms."
4. **MixinProvider failover** uses priority-based chain fallback + springBackMs mechanism to automatically converge to the optimal provider when possible.
5. **No provider switch after streaming has yielded**, prioritizing correctness over completeness to ensure the trustworthiness of already-output content.
6. **Comparison of three approaches** (single static / chain passthrough / parallel optimization), with aptbot's picture being "refined chain + spring-back + teaching readability."

The Provider system solves the problem of "how the brain connects to external services." The next article looks at the Tool system—"how the hands do things"—and how to ensure safety and control when the agent executes tools.
