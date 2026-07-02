---
slug: "04-long-term-iteration"
title: "Long-Term Iteration Maintenance Practice: Architecture Evolution and Sustainability"
description: "Why AI-assisted projects tend to collapse by the third version, L1/L2/L3 version planning and iteration cadence, test baseline management, additive而非subtractive architecture evolution, design-notes..."
track: ai-coding-practice
chapter: 方法论
order: 17
difficulty: advanced
estimatedReadingTime: 18
status: published
prerequisites: []
lastUpdated: "2026-07-02"
tags:
  - iteration
  - architecture
  - maintenance
  - methodology
---

If you've tried using AI to develop a real project, you've likely experienced a trajectory like this: The first version, you had the AI quickly build a prototype, the code ran, and you thought "AI is amazing, development efficiency has at least quintupled." The second version, you had the AI add new features — although you started encountering "change A breaks B" situations, overall progress continued. By the third version, you found the code was completely unmaintainable — changing one line required modifying five files, adding one field introduced three bugs, and every new AI session suggested "maybe we should just rewrite it."

This isn't just your problem. It's the most common困境 in AI-assisted development, which we call "death by the third version." Why do AI-assisted projects particularly tend to die by the third version? How can you keep a project健康迭代 through dozens of versions? This article systematically answers that question, from concept to practice.

## Concept: "Death by the Third Version" in AI-Assisted Projects

To understand why AI-assisted projects tend to collapse by the third version, let's first look at the fundamental nature of how AI works.

AI performs extremely well within a single session: it has enough context window to understand the current task and can write structurally sound, functionally complete code. But it has a致命弱点 — **no cross-version long-term memory**. Every new session, the AI doesn't know what decisions were made in the previous version, why they were made, or what constraints and trade-offs existed. It faces only the "current code state," without seeing the code's evolutionary history.

This leads to a typical cycle:

- **First version**: The project starts from zero. AI has no historical baggage, builds from an empty repository, structure is clear, code is clean. You think "AI is so reliable for writing projects."
- **Second version**: You ask the AI to add features on top of the existing code. The AI reads the current code, understands the structure, then layers on new functionality. Some "compatibility" issues start appearing, but overall it's okay.
- **Third version**: The code has accumulated multiple layers of abstraction, multiple styles, and multiple versions of temporary patches. When the AI reads the code in a new session, it can no longer fully understand the relationships between all modules. Changing one place might miss three others. The AI starts suggesting "this part needs refactoring, it's too messy."

The problem isn't AI's capability — it's the **lack of a cross-version knowledge transfer mechanism**. The context from each version is discarded; the AI infers design intent from the "current code" each time — but the code itself doesn't record "why it was done this way."

This is the core矛盾 that long-term iteration maintenance must solve: AI has extremely strong single-session capability but zero cross-version memory. Without a systematic approach, the project will inevitably enter a "can't change anything" state between the third and fifth versions.

## General Design: Structured Iteration Methodology

Solving "death by the third version" doesn't rely on smarter AI — it relies on **structured iteration methodology**. The diagram below shows the complete framework from version planning to continuous evolution:

![Long-Term Iteration Roadmap](/learn/articles/images/long-term-iteration.png)

This methodology consists of seven core practices, covering version planning, iteration cadence, quality baseline, architecture evolution, knowledge memory, refactoring governance, and documentation synchronization.

### Version Planning: L1/L2/L3 Layered Roadmap

Long-term projects need two levels of planning, addressing both "direction" and "execution."

**Roadmap (L1/L2/L3)** is the coarse-grained long-term direction. L1 is the concrete content for the current version, L2 is the broad direction for the next two or three versions, and L3 is the long-term vision. The roadmap doesn't go down to the task level — it describes in "capability domains." For example: "L1 implement core CLI interaction + basic tool set; L2 introduce multi-session management and memory system; L3 explore multi-channel access and skill self-evolution capabilities."

The value of the roadmap isn't "accurately predicting the future" — it's **providing a coordinate system for current version decisions**. When writing the L1 spec and encountering the question "should I introduce this abstraction," check against the roadmap and ask: "Will this decision block L2's path?" If L2 plans to introduce multi-channel, then L1's communication layer should reserve abstract interfaces rather than hardcoding a single channel.

**Single-version spec** is the detailed design for L1. It goes down to the file level, interface signatures, test cases, and acceptance criteria. The spec only covers the current version and makes no assumptions about the future — but decisions should be made with the roadmap in mind.

The relationship between the two can be likened to a map and navigation: the roadmap is the map, showing you the general direction; the spec is the navigation, telling you how to traverse this section. Without a map, navigation might take a detour; without navigation, the map can't be executed.

### Iteration Cadence: Closure → UAT → Cool-Down

Iteration isn't endless feature stacking — it's rhythmically paced progress. Each version completes a full cycle:

1. **Planning period**: First do brainstorming to sort out requirements, then write a spec for detailed design, finally write a plan to decompose tasks. No code is written during this phase — only thinking and designing.
2. **Implementation period**: Execute subtasks one by one according to the plan. Each subtask goes through the TDD red → green → refactor cycle.
3. **Closure period**: "Close" the version after feature development is complete — no new features, only bug fixes, documentation补全, and full test runs. The closure is marked by submitting a version tag.
4. **UAT period**: User acceptance testing. Go through the spec item by item, verifying four checklists — functional completeness, boundary cases, error handling, documentation consistency.
5. **Release period**: Merge into the main branch, push the version tag, update deployment.
6. **Cool-down period**: Don't start the next version immediately after release. Spend a day or two organizing design-notes,回顾 the pitfalls of this version, adjusting project_memory, updating the roadmap.

Why is a cool-down period necessary? Because continuous滚动 development容易陷入 "add features → introduce bugs → fix bugs → add features" 的恶性循环, leaving no time for reflection. The cool-down period is "time to lift your head and look at the road" —回顾 which spec decisions turned out to be wrong in hindsight, which AI behavior patterns revealed new problems, and which technical debt should be scheduled for the next version.

The core of iteration cadence is **clear version boundaries**. Each version has a clear start and end, with independent design documents and changelogs — don't mix designs across versions.

### Test Baseline Management: Non-Regression Red Line

In long-term iteration, the test baseline is the most sensitive indicator of project health. Think of it like an ECG baseline — a stable baseline means the project is healthy; a fluctuating baseline means the project is deteriorating.

Three iron rules of test baseline management:

- **Total count only increases**: New features come with new tests, so the total should steadily rise. A decrease means either tests were deleted (must have a reason) or skipped (must have a reason). An unexplained decrease is a red alert.
- **Pass rate does not regress**: If the previous version was 936/938 (2 flaky), the current version shouldn't become 920/950. A declining pass rate means either new bugs were introduced or new flaky tests appeared.
- **Flaky tests must be addressed**: In long-term projects, flaky tests are慢性 poison. At first, one or two intermittent failures, and you tell yourself "it'll turn green in a moment." After a few months, "red is normal" becomes a habit, and the red light completely loses its warning significance. Each version must reduce flaky tests to zero, or at least to a traceable, explainable minimum.

At each closure, record a snapshot of the test baseline in the version release notes: total tests, passed count, failed count, flaky count, and coverage delta. Before starting the next version,对照 this snapshot to ensure the baseline hasn't regressed.

Historical flaky tests cannot be left unmanaged. Fix what can be fixed (usually timing, concurrency, or external dependency issues), isolate what can't be fixed into a separate test suite that doesn't count toward the main baseline. Never leave flaky tests in the main test suite where they contaminate the signal.

### Architecture Evolution: Additive而非Subtractive

The architecture evolution of long-term projects follows a seemingly counterintuitive principle: **additive而非subtractive**.

New versions layer on new abstractions without deleting old ones — unless there's a dedicated refactoring version. Why? Because deleting abstractions breaks backward compatibility, and in AI-assisted projects, "who's referencing this abstraction" is often unclear. The AI might have written code referencing an internal API, but nobody remembers all the reference points. Deleting it rashly could silently break something downstream.

The concrete approach of加法: New abstractions coexist with old ones; new features use the new abstraction, old features maintain the old abstraction, with gradual migration. For example, v0.1 uses plain HTTP communication, v0.2 introduces WebSocket, both coexist; v0.3 introduces a unified Channel abstraction, new integration points use Channel, while the old HTTP and WebSocket paths remain unchanged. Only when a dedicated "unified abstraction" refactoring version comes along are the old paths removed.

The cost of the additive principle is that code volume grows and abstraction layers stack. But this is a controllable cost — far less than the cost of "overthrowing everything every time you refactor." When the stack gets deep enough (e.g., three layers of wrapper nesting), schedule a dedicated refactoring version to consolidate, but don't "refactor on the side" in a feature version.

The deeper meaning of the additive principle is **respecting historical code**. Every line of code had its reason when it was written (even if that reason no longer applies). Rewriting casually means discarding the debugging experience and edge case handling that code carried. Be conservative with old code until you have solid evidence that it truly needs to be replaced.

### Design-Notes and Project_Memory

This is the key mechanism for solving "AI has no cross-version memory," consisting of two parts:

**Design-notes (cross-version design notes)** are long-term memory written for humans. They record the "why" — why a particular decision was made, why a particular constraint was set, why a particular approach was abandoned. Design-notes don't contain specific code (that's in the repository) or single-version design details (that's in the spec). They capture things only visible across versions: constraint evolution ("v0.1 had no layering constraints, v0.2 discovered the core-depends-on-access problem and added a unidirectional dependency rule"), principle establishment ("v0.3 introduced the additive而非subtractive principle because v0.2's refactoring caused two days of regression testing"), lessons learned ("v0.2 had a production hotfix because the AI skipped testing and went straight to implementation").

The cumulative effect of design-notes only becomes apparent in the later stages of a project. In the first three to five versions, you might feel "there's nothing worth recording," but looking back at the tenth version, the design-notes have compressed the entire project's design wisdom. Newcomers (whether human developers or new AI sessions) reading design-notes is more efficient than reading all the specs — it directly tells you "what not to do" and "why it's done this way."

**Project_memory (project-level knowledge base)** is the project constitution for the AI to read. It's injected into the system prompt each session, telling the AI the basic rules of the project. Project_memory includes:

- **Hard constraints**: Rules the AI must follow. For example, "core layer cannot import from access layer," "API keys can only be read from environment variables," "tests cannot depend on external networks."
- **Lessons learned**: Pitfalls encountered and the corresponding constraints. For example, "AI tends to skip tests and go straight to implementation, must use skill to enforce TDD."
- **Current version focus**: What this version does and doesn't do, preventing the AI from drifting into future version planning.
- **Architecture map**: The project's layering structure and module responsibilities.

Project_memory should be concise. It's injected every session, so being too long wastes tokens and dilutes the signal. A few hundred to a thousand words is most appropriate, covering only the most critical constraints and principles. Detailed designs go in the spec, design-notes carry the complete version memory, and project_memory is the "constitution," not the "legal code."

### Refactoring Timing and Dependency Upgrades

Long-term projects can't avoid refactoring and dependency upgrades, but timing is everything.

**Signals that it's time to refactor:** Abstraction layers have stacked to obvious混乱 (three-plus layers of wrapper nesting), the cost of modifying a module far exceeds its functional value (changing one line requires touching five files), the test baseline has been flaky for a long time暗示ing architectural problems, and the cost for a new session to understand the code has陡增.

**Signals that it's NOT time to refactor:** Refactoring "on the side" within a feature version (refactoring should be a standalone version), refactoring modules without written tests (behavior can't be verified after refactoring), the AI suggests refactoring (AI has no concept of sunk cost and often建议s overthrowing everything — you need to suppress this impulse), refactoring "to make the code look better" (refactoring should be for maintainability, not aesthetics).

Characteristics of a refactoring version: No new features, only structural adjustments; the test baseline total remains unchanged (behavior is preserved), pass rate must be 100%; the spec clearly marks "refactoring scope" and "out of scope," preventing refactoring from蔓延 to modules that shouldn't be changed.

**Dependency upgrade strategy** requires equal caution. When introducing a new dependency, ask yourself five questions:

- Necessity: Can it be solved with the standard library or existing dependencies?
- Maintenance activity: When was the last commit? Are there regular releases? Are issues responded to actively?
- Size cost: What transitive dependencies does it bring?
- Compatibility: Does it conflict with existing dependency versions?
- Security: Are there known CVEs?

When upgrading existing dependencies, minor versions are usually safe but still require a full test run; major versions must have a dedicated upgrade version — read the changelog, run full tests, UAT verification. AI tends to want "the latest version," but newer isn't always better — stability matters more than novelty.

### Documentation Synchronization

At each closure, three documents must be synchronized with the code:

- **CHANGELOG**: One entry per version, categorized into Added/Changed/Fixed/Removed. User-facing, no technical details.
- **README**: Feature list, quick start, configuration instructions. New features added to the feature table, configuration items updated in the instructions.
- **ARCHITECTURE**: Module descriptions, layering structure, design principles. New modules get sections added, architecture adjustments update the structural diagram.

"Outdated documentation is worse than no documentation" — this statement is especially true in AI-assisted development. If the AI reads outdated architecture documentation while reading the code, it will be misled into making wrong decisions. Checking documentation synchronization at each closure isn't an optional "best practice" — it's a necessary condition for maintaining AI output quality.

## Comparison with Other Approaches

In real projects, different teams and projects adopt different strategies for long-term iteration. There are roughly three typical approaches.

### Approach A: One-Shot Development, No Maintenance

The core strategy of this approach is "use and discard." Use AI to quickly build a prototype or MVP, with no plan for long-term maintenance after delivery. If future changes are needed, just use a new session to rewrite from scratch, without regard for existing code compatibility.

**Applicable scenarios:** One-off prototype validation, hackathon projects, short-term campaign pages, learning experiment code.

**Advantages:** Fastest development speed, no historical baggage, AI starts from zero each time with the highest output quality.

**Cost:** Cannot be used for production-grade projects. Every rewrite discards all tests, documentation, and debugging experience. The project cannot accumulate; all "long-term value" resets to zero.

Approach A itself isn't "wrong" — it's a rational choice for specific scenarios. If your project doesn't need to survive the third version, you don't need long-term iteration methodology. The problem is that many teams misjudge their needs, thinking "let's build a prototype first and maintain it later," but after the prototype is done, the project lives on without a corresponding maintenance strategy — and dies by the third version.

### Approach B: Manual Retrospective Iteration

This approach relies on the developer's personal experience to manage iteration. There are no systematic baselines, documentation, or process constraints. The developer's approach: after completing a version, recall what problems were encountered and pay attention next time. Constraints exist in the mind, not in tools or documents.

**Applicable scenarios:** Small solo projects, experienced and self-disciplined developers, small project scope (no more than 5 modules).

**Advantages:** Flexible, introduces no additional process burden. For very small projects (one or two files), complex iteration management is indeed unnecessary.

**Cost:** Highly dependent on personal experience, cannot be transferred across projects. If the developer takes a vacation or moves to another project, the knowledge is lost. For AI-assisted development, this problem is more severe — a new AI session cannot inherit the "experience" in the developer's mind at all. Each new session, the AI faces the codebase without any historical context; Approach B's "experience in the mind" effectively doesn't exist for the AI.

Moreover, without test baselines, design-notes, and closure cadence, once the project grows beyond about 5 modules, "change A breaks B" situations start appearing. Approach B is especially unsustainable in AI-assisted development — AI writes code fast, but without systematic constraints, it also creates混乱 fast.

### Approach C: Closure Cadence + Test Baseline + Design Notes

This is the structured iteration approach, the methodology systematically described in the "General Design" section. Core features:

- **Closure cadence**: Each version has clear boundaries, advancing rhythmically through planning → implementation → closure → UAT → cool-down.
- **Test baseline**: Total test count doesn't decrease, pass rate doesn't decrease, flaky tests are regularly cleared. The baseline serves as an objective signal of project health.
- **Design notes**: Design-notes accumulate design decisions across versions; project_memory serves as the AI's project constitution.
- **Additive而非subtractive**: Respect old code, don't rewrite casually; use "layering on" instead of "replacing."

**Applicable scenarios:** Production-grade projects, multi-person collaboration projects, projects expected to iterate beyond 5 versions.

**Advantages:** Project sustainability is predictable, the test baseline provides an objective health指标, design-notes let new AI sessions quickly understand project history, rhythmic progress leaves room for reflection.

**Cost:** Requires additional effort to maintain documentation and baselines; the process constraints feel "too heavy" early on — the first three to five versions may not need such a complex system, but after the fifth version, the前期 investment starts paying off.

### Design Philosophy Comparison

| Dimension | Approach A (One-Shot) | Approach B (Manual Retro) | Approach C (Structured Iteration) |
|---|---|---|---|
| Core philosophy | Use and discard | Experience-driven | Systematic baseline + knowledge accumulation |
| Version boundaries | None (one-shot) | Fuzzy (gut feeling) | Clear (closure定版) |
| Test baseline | None | None or loose | Strict management (non-regression) |
| Cross-version knowledge | Discarded | In the mind | Design-notes + project_memory |
| Architecture strategy | Rewrite each time | Refactor on demand | Additive而非subtractive |
| Suitable projects | Prototypes, experiments | Small solo projects | Production-grade, long-term |
| AI-friendliness | Low (no history transfer) | Low (experience not transferable) | High (knowledge explicit) |

Each of the three approaches has its applicable scenarios. The key is **matching project needs**. For prototypes, Approach A is most efficient. For small personal projects, Approach B is acceptable. But for an AI-assisted codebase that needs to iterate beyond 5 versions, Approach C isn't "optional" — it's "mandatory." Without systematic iteration management, the speed advantage of AI-assisted development will be completely offset by "death by the third version."

## aptbot's Design Features

aptbot, as a learning-oriented personal assistant project, chose Approach C from the start. Not because it's "most advanced," but because the project's positioning dictates that it must survive many versions: as an open-source learning project, aptbot must not only iterate健康 itself but also serve as an example of how to iterate健康.

In concrete practice, aptbot made the following key design choices:

**Layered roadmap driving iteration.** aptbot's roadmap is clearly分层: L1 focuses on the core agent loop and basic tool system, L2 on the memory system and multi-session management, L3 on skill self-evolution and multi-channel. Each new version checks方向 against the roadmap, ensuring that design decisions in every version don't block the next version's path. For example, when designing the tool system in L1, tool registration and discovery mechanisms were预留, preparing for L2's skill system — even though L2's skill system wasn't implemented yet, L1's abstraction already left extension points.

**Strict closure cadence.** Each version goes through the complete flow of brainstorming → spec → plan → subtask execution → finishing wrap-up → UAT verification. The cool-down period after closure is used to organize design-notes and project_memory. No rushing versions, no skipping steps.

**Automated test baseline recording.** Each closure records a test baseline snapshot, compared when starting the next version. Maintain a steady increase in total tests (don't delete existing tests, only add tests for new features), and keep the pass rate stable. Flaky tests are addressed within the version they're discovered — not deferred to the next version.

**Additive而非subtractive architecture practice.** aptbot's architecture evolution strictly follows this principle. New abstractions layer on top of old ones; old code is not destructively modified unless in a dedicated refactoring version. This means aptbot's codebase retains some "less elegant" implementations in early versions — but these implementations are tested, handle real boundary cases, and their value outweighs the impulse to rewrite for "cleaner looks."

**Design-notes and project_memory as project infrastructure.** These two files aren't "write when you have time" supplementary documents — they're formal outputs of each version iteration. Design-notes and project_memory must be updated before closure, as part of the standard cool-down流程. Project_memory remains concise (a few hundred words), and is automatically injected into every new AI session, ensuring the new session knows "what can be done, what can't be done, and what this version is working on."

## Future Directions

Long-term iteration maintenance practices continue to evolve. Several trends worth watching:

**Automated baseline monitoring.** Currently, test baselines rely on manual recording and comparison. In the future, automated tools could generate baseline reports with every build, automatically alerting on baseline regression. This further reduces the cognitive burden of maintaining test baselines.

**AI-assisted design note generation.** Design-notes currently require manual organization by the developer. In the future, AI could automatically generate a "version retrospect draft" at version closure, which the developer reviews and confirms. This lowers the barrier to maintaining design-notes, allowing more projects to benefit from cross-version knowledge accumulation.

**Finer-grained memory layering.** Currently, project_memory uses a "full injection" mode — all constraints are injected in every session. In the future, constraints could be intelligently selected based on the current subtask's context. For example, if the current subtask involves security, inject security-related constraints; if it involves testing, inject TDD constraints. This reduces token waste and increases signal density.

**Adaptive iteration cadence.** Projects at different stages may need different iteration cadences — early stages may need faster version cycles, mature stages may need longer cool-down and reflection time. In the future, adaptive cadence could be introduced, automatically suggesting iteration节奏 based on test baseline trends, code change volume, defect rates, and other metrics.

aptbot will gradually explore these directions in subsequent versions. The core principle remains unchanged: the key to long-term iteration isn't technology — it's **habits** — the habits of recording, reflecting, baseline management, and rhythmic progress. Tools can assist, but habits must be built by yourself.

## Summary

Starting from the core矛盾 of "death by the third version," this article systematically lays out the methodology for long-term iteration maintenance:

1. **Version planning** should be layered — L1/L2/L3 roadmap provides direction, single-version spec handles execution. The two serve as mutual coordinate systems.
2. **Iteration cadence** should be fixed — planning → implementation → closure → UAT → cool-down, each version completes the full cycle. The cool-down period is time for reflection.
3. **Test baseline** should be strict — total count doesn't decrease, pass rate doesn't decrease, flaky tests are清零. The baseline is an objective signal of project health.
4. **Architecture evolution** should be restrained — additive而非subtractive, respect old code, don't rewrite casually. Refactoring should be a standalone version.
5. **Knowledge memory** should be explicit — design-notes record cross-version design decisions, project_memory constrains AI behavior.
6. **Documentation** should be synchronized — CHANGELOG / README / ARCHITECTURE aligned with code at closure.

Among the three approaches, Approach C (structured iteration) is the only sustainable choice for long-term projects. It's not an added burden — it's the greatest guarantee against "death by the third version."

In the next article, we discuss the boundaries of AI's capabilities — what it's good at, what it's not good at, and when human intervention is necessary.
