---
slug: "03-spec-document-management"
title: "Spec Document Management: Project Memory and Decision Constitution for AI-Assisted Development"
description: "Boundaries between spec, plan, and design; file organization conventions; full lifecycle management (draft → review → active → revision → archive); self-review checklist; code synchronization..."
track: ai-coding-practice
chapter: 方法论
order: 16
difficulty: beginner
estimatedReadingTime: 18
status: published
prerequisites: []
lastUpdated: "2026-07-02"
tags:
  - spec
  - documentation
  - lifecycle
  - design
---

In AI-assisted development, one cost is often underestimated — repeated explanation. Every new session requires retelling the AI "what's the architecture of this project," "why did we choose A over B," "which constraints can't be violated." Without documented specs, you're paying for the project's "amnesia" with tokens and patience. The spec is essentially the **project memory and decision constitution** for AI-assisted development — it lets the AI quickly restore context in every session and prevents your design decisions from fading over time.

## Concept: Why Documented Specs Are Necessary

To understand the value of specs, you first need to grasp a fundamental contradiction in AI-assisted development: **Humans have long-term memory; AI does not.**

A human developer who made a design decision a week ago opens the code today and still remembers why they chose that path. But AI doesn't — each session starts from zero. Without specs, the AI's understanding of the project relies entirely on scattered information in the current context. It can't distinguish between "this is a well-considered design" and "this is a随手临时方案."

This leads to a typical vicious cycle:

1. First session: AI proposes a design based on its own "general best practices"
2. You correct it, AI adjusts per your feedback
3. Second session: AI again proposes the same (already rejected) approach based on "general best practices"
4. You correct it again
5. Third session: The same cycle repeats

The problem: **AI doesn't remember the rejected approaches from the previous session.** Every rejection is a "first" rejection.

Spec documentation is the tool that breaks this cycle. It solidifies design decisions from "a conversation in a session" into "a document that can be repeatedly read." Every time the AI reads the spec in a new session, it knows "this project uses approach A, not B," "this constraint is hard and can't be violated," "this feature belongs to v0.3 and won't be implemented now."

Beyond this, there's an even more important implicit value: **you only realize you haven't thought it through when you write it down.** In your head, "this feature will just be implemented this way" — but when you put it in a spec and have to write "what's the input, what's the output, how are errors handled, how does it interact with existing modules," you discover branches you never considered. The spec is a tool that forces fuzzy ideas into clear decisions.

## General Design: Spec Full Lifecycle Management

### Boundaries of Spec, Plan, and Design

In any documentation system, the biggest source of confusion is unclear responsibilities. Spec, plan, and design documents are easily confused, and confusion leads to AI overstepping — design rationale appearing in plans, task lists appearing in designs, implementation code appearing in specs.

Clear boundaries look like this:

| Document Type | Question It Answers | Content | Contains Code |
|---|---|---|---|
| **spec** | What to do, why, what not to do | Scope, goals, acceptance criteria, decision rationale | No |
| **design** | What technical approach to use | Architecture diagrams, interface signatures, data structures, algorithms | Optional (pseudocode/interface signatures) |
| **plan** | In what order, how to verify each step | Subtask list, verification commands, dependencies | No (verification commands only) |

**Spec** is decision-oriented. It answers "what are we doing," "why are we doing it," "what aren't we doing." Its readers are humans and AI — those who need to understand the project direction and design constraints.

**Design** is technical. It answers "what technical approach to implement with." Architecture diagrams, interface signatures, data models, and key algorithms go in design documents. It's the bridge between spec and plan — translating from spec's "what" to plan's "how."

**Plan** is execution-oriented. It answers "what comes first, what comes next, how to verify each step." The subtask list + verification commands are the core of the plan. Implementation code is not allowed in the plan.

The most common overstepping is: spec containing implementation details (should be moved to design or implementation phase), plan containing design rationale (should go back to spec), design containing task lists (should go to plan). Once overstepping happens, document responsibilities blur, and the AI can't tell whether a piece of information is a "constraint" or a "suggestion" — execution quality suffers.

A simple判断方法: Take a piece of content and ask "is this a constraint, a step, or a technical choice?" — constraints go in spec, steps go in plan, technical choices go in design.

### File Naming and Organization

Spec file naming needs to support both **time回溯** and **topic retrieval**. Standard naming format:

```
YYYY-MM-DD-<topic>-design.md
```

- `YYYY-MM-DD`: Creation date, sorting by time gives a historical timeline of project design decisions
- `<topic>`: Short topic keyword, e.g., `auth-redesign`, `api-rate-limiting`, `0.2.3-learn-system`
- `-design.md`: Suffix indicating this is a design document

All specs are stored in a single directory (e.g., `docs/specs/`), not分散 across module directories. Two reasons:

1. **Global retrieval**: See all design decisions in one directory, instantly knowing "what decisions this project has made"
2. **Cross-module references**: Module A's spec might reference Module B's spec; centralized storage keeps paths stable

When the directory has many files (dozens of specs), you can create subdirectories by year or version, but don't create subdirectories by module — organizing by module breaks the timeline and makes it hard to answer "what was this project doing during this period."

### Spec Lifecycle

A spec goes through five stages from birth to archive:

**Stage 1: Draft**
The initial draft of a spec comes from the decision table produced during brainstorming. Each "option + decision + rationale" for every open question in brainstorming is directly carried into the corresponding section of the spec. At this point, the spec is still "taking shape" and may change at any time.

**Stage 2: Pending Review (self-review + user review)**
Once the draft is complete, it enters the review stage. Review has two steps:

1. **Self-review**: The AI itself goes through a checklist. Self-review isn't a formality — it requires genuine item-by-item checking:
   - **Placeholder残留**: Search for `TODO`, `TBD`, `xxx`, `???` — all placeholders must be filled or removed
   - **Internal consistency**: The earlier text says "supports 5 protocols," but the later list only has 4; the earlier text says "default true," but the configuration example writes `false`
   - **Reasonable scope**: In scope and out of scope are clearly divided, and each in scope item has a corresponding acceptance criterion
   - **Ambiguous phrasing**: Search for "roughly," "maybe," "it depends," "as applicable" — these are all ambiguity signals; either make them specific or mark them as open questions
   - **Decision rationale**: Every decision has a "why" behind it. A decision without rationale is not a decision

2. **User review gate**: After self-review passes, submit for user review. No plan phase is allowed until the user approves. This gate isn't a formality — AI often writes "future version" content into the current spec, or uses vague terms to cover undecided issues. Human review is the last chance to surface these "soft errors."

**Stage 3: Active**
After user review passes, the spec becomes the "constitution" for subsequent planning and implementation. Any implementation decision that conflicts with the spec must either change the implementation or change the spec — no "private deviations" allowed. The spec is authoritative while in active status.

**Stage 4: Revision**
A spec isn't frozen once written. During implementation, some decisions may prove infeasible and need adjustment. Revision rules:
- Changes must be留痕 — add a "Change Log" section to the spec, recording date + change + reason
- Major changes (scope adjustment, architecture changes) must go through user review again
- Outdated decisions should be marked in the spec as "changed in v0.x.y, see YYYY-spec"

**Stage 5: Archive**
After a version is released, the spec is archived as the design record for that version. Archiving isn't deletion — it's marking as "historical version's design basis." After archiving, the spec is no longer active but can be queried for future回溯.

The diagram below shows the complete spec lifecycle from birth to archive:

![Spec Document Lifecycle](/learn/articles/images/spec-lifecycle.png)

### Spec and Code Synchronization

Synchronization between spec and code is the most easily overlooked and most problematic aspect of document management. Typical signals: code changed but spec didn't, spec changed but code didn't, both changed but in inconsistent directions.

Three core principles for synchronization:

1. **Spec changes must precede code changes**. Change the spec first, then change the code. This is similar to TDD's "write the test first, then write the implementation" — first describe what you're going to do, then do it. If you change the code first and then the spec, the spec becomes a "post-hoc explanation of the code," losing its "constitutional" status.

2. **Change records must be preserved**. Don't directly overwrite the original text. Keep a change log section in the spec, allowing readers to see "originally designed this way → later found infeasible → changed to this." The decision evolution itself is a valuable technical debt record.

3. **Reconcile spec and code at release closure**. Before releasing a version, go through the spec's acceptance criteria one by one and check them against the code's behavior. Any discrepancies found must be resolved by either changing the code or changing the spec — no "known discrepancies" allowed in the release version.

### When to Write Specs and When Not To

Not every change needs a spec. The judgment criteria determine the sustainability of the spec system — excessive spec writing is as harmful as not writing specs at all.

**Scenarios that need a spec:**
- Systemic changes — new modules, architecture refactoring, introducing dependencies, adjusting core abstractions
- Cross-version planning — roadmaps, version planning, multi-version compatibility strategies
- Features involving coordination across multiple modules
- Changes with important decisions worth recording (will you still need to know "why this choice" six months later?)

**Scenarios that don't need a spec:**
- Trivial changes — modifying text, fixing a typo, adjusting constant values
- Single-point bug fixes — fixing a clear, small bug
- Purely experimental exploration — experiments where you haven't decided whether to proceed

**Judgment尺度**: "Which modules will this change affect?" "Will I still need to know why this was changed six months from now?" — If it affects multiple modules and needs long-term memory, write a spec; if it's local and one-time, just make the change directly.

The problem with excessive specs: writing a spec for every typo dilutes the value of specs, burying important design documents in noise. Specs should be written where they belong — as an **index of important decisions** rather than a **log of every change**.

### Spec as a Collaboration Medium

Specs aren't just written for AI — they're also a medium for team collaboration:

- **PR review basis**: When reviewing a PR, reviewers对照 the spec to determine whether "the implementation matches the design." If the PR deviates from the spec, either change the PR or change the spec.
- **Newcomer onboarding documents**: When a new person joins the project, they first read the latest spec, then read the code. The spec is "design intent," the code is "design implementation" — reading intent before implementation leads to faster understanding.
- **Cross-team alignment**: Multiple teams or collaborators share the same spec, ensuring consistent implementation direction.

Even for personal projects, treating AI as a collaborator, the spec is the contract between you and the AI. Feeding the spec to the AI at the start of each session saves far more effort than re-explaining everything each time.

## Comparison with Other Approaches

Around "document management in AI-assisted development," current practices can be grouped into three approaches.

### Approach A: No Documentation, All Relying on Conversation Memory

This is the most common practice — no documents, no specs, all requirements, decisions, and designs happen entirely within chat sessions. Each new session is a fresh "explain from scratch."

**Design characteristics:**

- **Zero maintenance cost**: No time spent writing documents
- **Maximum flexibility**: Changing requirements means "directly tell the AI," no document updates needed
- **Fully dependent on conversation history**: Everything is present in the current session, but everything is lost across sessions
- **Suitable for one-time tasks**: No need to回顾 after completion

**Applicable scenarios**: One-off scripts, quick prototypes, temporary tasks. Done and discarded, no subsequent maintenance needed.

**Limitations**: Once a task needs multiple sessions or回顾 after weeks, problems surface. You spend大量 time re-explaining the same things, and the AI repeats the same mistakes. Decisions can't be回溯 — two weeks later you ask yourself "why did I choose that?" and there's no record.

### Approach B: Requirements Recorded in Chat Sessions

Better than Approach A — users record some key requirements during chat, or have the AI compile a summary at the end of a session. But these records typically stay within the chat platform, not as structured documents.

**Design characteristics:**

- **Chat as the record medium**: Requirements and decisions recorded in conversations, searchable by keywords
- **Some context retention**: Next session can reference the previous session's chat records
- **Unstructured**: Information scattered across conversations, no unified format or organization
- **Cross-session availability depends on the tool**: Some platforms support cross-session search, but most don't

**Applicable scenarios**: Small to medium projects where teams can use the chat platform's history feature.

**Limitations**: Information is still easily lost. Chat records aren't structured documents — finding a key decision might require flipping through dozens of pages of conversation. And the AI's understanding of chat records is "probabilistic" — it might miss important constraints or overestimate an offhand comment. Cross-session context "decays" significantly; early decisions are nearly forgotten after a few sessions.

### Approach C: Documented Spec Full Lifecycle Management

This is the approach detailed in this article — managing all design decisions with structured spec documents, covering the full process from brainstorming to archive.

**Design characteristics:**

- **Structured documents**: Specs have uniform formatting, naming conventions, and directory organization
- **Full lifecycle management**: From draft, review, active, revision, to archive
- **Document as contract**: The spec is a共同 agreement between AI and human
- **Cross-session usable**: Any new session reads the spec first, instantly restoring context
- **Traceable**: Historical specs preserve the complete record of decision evolution

**Applicable scenarios**: Long-term product projects, multi-person collaboration teams, projects requiring sustainable maintenance.

**Cost**: The highest maintenance cost. Writing a good spec takes time, review takes time, synchronization takes time. For some rapidly changing projects, spec might need updating as soon as it's written, and document maintenance costs may exceed benefits.

### Comparison Summary

| Dimension | Approach A (No Docs) | Approach B (Chat Records) | Approach C (Structured Spec) |
|---|---|---|---|
| Maintenance cost | **Lowest** | Low | High |
| Cross-session usability | None | Limited | **High** |
| Information traceability | None | Low | **High** |
| Decision rationale preservation | None | Yes (but hard to find) | **Complete record** |
| Flexibility | **Highest** | Medium | Low (change process) |
| Suitable projects | One-time tasks | Small to medium projects | **Long-term projects** |
| Team collaboration | Difficult | Medium | **Good** |

Three approaches correspond to three project lifecycles. Approach A suits "write and discard," Approach B suits "work for a while," Approach C suits "work forever." The key is knowing which category your project belongs to.

## aptbot's Design Features

### Why Approach C

aptbot is an open-source learning-oriented AI Agent project. Its lifecycle isn't "write and run" — it's long-term iteration: v0.1, v0.2, v0.3... continuous version evolution. Without specs, each version iteration would require re-understanding the previous version's architecture design, with costs rising exponentially.

But aptbot chose Approach C for an even deeper reason: **teaching needs**. aptbot's code itself is teaching material, and its specs are too. Readers looking at aptbot's specs can learn "what a qualified spec should contain," "how to record design decisions," "how to analyze pros and cons of approaches." The spec isn't just aptbot's own memory — it's also a textbook for readers.

### aptbot's Unique Practices

**Decision-table-driven spec writing**: aptbot's specs don't start from a blank page — they are transformed from the decision table produced during brainstorming. Each "option + decision + rationale" for every open question in the decision table directly becomes the content of the corresponding section in the spec. This ensures every decision in the spec has a verifiable basis.

**Self-review agent role switching**: During the self-review phase, aptbot has the AI switch roles — from "spec author" to "critical architect" reviewing its own spec. Perspective shifts surface more issues. This works better than "AI reviewing its own output."

**Change log as a standalone section**: Every spec has a "Change Log" section formatted as "date | change | reason." This isn't a post-hoc addition — it's an inherent structure of the spec. Having this section from the start means the team never feels "recording changes is extra work."

**Archive marking instead of deletion**: Archived specs are not removed; they are marked with `status: archived` in the frontmatter. These archived specs remain in the repository and can be回溯 queried at any time. Even if a decision is overturned, the record of the overturn remains — later developers can read the complete narrative of "why A was chosen → later A proved infeasible → changed to B," rather than just seeing B.

**Cross-spec reference relationships**: One spec may reference another spec's decisions. For example, the "API Authentication Strategy" spec references the "User Data Model" spec. aptbot maintains reference links in specs (see: `YYYY-MM-DD-user-model-design.md`), making the cross-spec decision network traceable.

### Differences from Other Approaches

Compared to the three approaches, aptbot's biggest difference in spec management is **treating specs as code**.

In Approaches A and B, documentation is an "accessory" — code is the主角, documentation is辅助. In typical Approach C practice, documentation is a "parallel product" — code and documentation are maintained in parallel, each with its own process.

In aptbot, **the spec is itself part of the product**. The spec's version management follows the same process as code version management — submit PR, review, merge. Spec changes trigger the same CI checks as code changes (format validation, link checking, etc.). Specs and code live in the same repository, the same branch, the same iteration cycle — naturally synchronized.

The design philosophy behind this is aptbot's understanding of "what is a project": **Project = Code + Design Decisions + Iteration History**. All three are indispensable, and the spec is the carrier of "design decisions."

## Future Directions

**Smarter spec generation**: Currently, specs mainly come from transforming brainstorming decision tables into text. In the future, agents could automatically analyze the gap between code changes and specs after completing an iteration, generating spec update suggestions. No need for humans to update word by word — the agent produces a draft, and the human reviews and confirms.

**Bidirectional spec-code binding**: Currently, specs reference code and code has comments, but there's no automated bidirectional link between them. In the future, specs could annotate "the file/function corresponding to this decision," and code could annotate "the spec entry corresponding to this implementation." This would let agents automatically detect when code changes require spec updates.

**Living specs**: Currently, specs are static markdown files. In the future, a "living spec" concept could be introduced — interface signatures and data models in the spec are extracted directly from code, maintaining real-time synchronization. The spec would no longer be a static document that "might be outdated after writing," but a dynamic view that's "always consistent with the code."

**Visual spec network**: As the number of specs grows, reference relationships between specs form a network. Visualizing this network would let developers see at a glance "which modules does this decision affect" and "which specs constrain this module." This is extremely valuable for large projects.

**Automated spec quality assessment**: Currently, self-review is manual or semi-automated. In the future, a spec quality checker could be developed — checking whether each decision has supporting rationale, whether acceptance criteria exist, whether there are ambiguous expressions, and whether the scope is reasonable. This would transform spec review from "manual inspection" to "automated check + human confirmation."

## Summary

Spec document management is an often underestimated but crucial aspect of AI-assisted development:

1. **Its value**: Specs are the AI's "project memory" and "decision constitution." They let the AI maintain decision consistency across sessions and allow humans to understand design choices months later. The time spent writing a spec is one-time; the cost of not writing specs and repeating explanations is ongoing.

2. **Its boundaries**: Spec answers "what to do, why, what not to do"; design answers "what technical approach"; plan answers "in what order, how to verify." The three document types have clear responsibilities and don't overstep.

3. **Its lifecycle**: Draft → self-review + user review → active → revision → archive. Each stage has a clear status and quality gate, making the spec controllable from birth to retirement.

4. **Approach comparison**: Approach A (no docs) is most flexible but can't be回溯; Approach B (chat records) has some context but cross-session loss is severe; Approach C (structured spec) is most规范 but has the highest maintenance cost. aptbot chooses Approach C and manages specs as part of the product, synchronized with code.

With this, the three core articles on AI-assisted development methodology are complete. From workflow constraints in the first (how to manage the process), to quality defense lines in the second (how to ensure quality), to spec management in the third (how to record decisions) — these three form a complete picture of structured AI-assisted development. If you're a developer bringing AI into your development process, the thinking in these three methodology articles can help you avoid the most common pitfalls — those moments when things "looked right but were actually wrong."
