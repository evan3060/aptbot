---
slug: "06-continuous-improvement"
title: "Methodology and Continuous Improvement: Collaboration, Learning, Knowledge Accumulation"
description: "How to establish effective collaboration with AI, learn from AI output, build a knowledge base, evaluate output quality at three levels, continuously optimize collaboration processes, avoid..."
track: ai-coding-practice
chapter: 方法论
order: 19
difficulty: intermediate
estimatedReadingTime: 18
status: published
prerequisites:
  - "05-boundary-issues"
lastUpdated: "2026-07-02"
tags:
  - collaboration
  - learning
  - knowledge
  - methodology
---

The previous five articles discussed process, quality, documentation, long-term iteration maintenance, and boundary issues. This article is the culmination of Track 2 — returning to methodology itself. AI-assisted development isn't a static skill; it continuously changes with model upgrades, tool evolution, and project accumulation. The workflow that works well today may become outdated in six months due to changes in model behavior. This article doesn't discuss "a set of rules" — it discusses a methodology for **letting rules continuously evolve**: how to establish effective collaboration with AI, how to learn from AI output, how to沉淀 knowledge, how to evaluate output, how to continuously optimize processes, and how to avoid over-reliance.

## Concept: Methodology Itself Is a Continuously Evolving System

If the previous five articles are like a set of "techniques," then this article is about the "inner principles" — techniques can become outdated, but inner principles won't.

What makes AI-assisted development unique is: **the tool itself is evolving rapidly, and your collaboration method must evolve in sync**. The prompt strategies that worked well last year may no longer be necessary after this year's model upgrade; tasks that AI was bad at last year may be handled well this year. This means you can't treat "AI-assisted development methodology" as a fixed set of rules — you must see it as a **living system** that needs continuous observation, adjustment, and optimization.

The core循环 of this system is: **Practice → Reflect →沉淀 → Optimize → Practice again**. The diagram below shows the complete structure of this continuous improvement闭环 — from collaboration to learning, from knowledge沉淀 to evaluation to optimization, forming a self-evolving cycle:

![Continuous Improvement Cycle](/learn/articles/images/continuous-improvement.png)

Every time you collaborate with AI is a practice. After collaboration, reflect on what went well and what didn't,沉淀 the experience into the knowledge base (project_memory, design-notes), then adjust the next round's collaboration approach.

This cycle isn't optional — it's a **required course** for AI-assisted development. Because AI isn't like traditional tools — you can use an editor for ten years and its behavior is basically unchanged. AI might upgrade its model every few months, and its behavior patterns can change significantly. If your collaboration methodology doesn't adjust accordingly, you'll experience confusion like "it worked this way before, why has it changed now?"

## General Design: Building a Four-Layer System for Effective Collaboration

### How to Establish Effective Collaboration with AI

Collaboration isn't "give AI a task, wait for delivery." It's bidirectional — you influence AI's behavior, and AI's output in turn influences your judgment. Three key elements for building effective collaboration:

**Element 1: Be specific in prompts.**

"Write a user login feature" is a vague prompt. When the AI receives this, it defaults to extrapolating a "complete" solution — potentially including OAuth integration, remember-me functionality, SMS verification codes, two-factor authentication — because you didn't say not to do these. The resulting proposal "looks professional" but far exceeds your actual needs.

"Use bcrypt for password hashing, JWT with 24-hour expiry, lock out for 15 minutes after 5 failed attempts, don't introduce new dependencies" is a specific prompt. The AI's output is clearly constrained and won't go off track.

**The essence of specificity is front-loading your judgment** — think clearly about what you want first, then have AI do it, rather than making AI guess what you want. Vague prompts effectively hand over decision-making to AI, and AI tends to make "the most complete version" when deciding.

**Element 2: Provide sufficient context.**

AI has no project memory; it works off the context you give it each session. The more context you provide, the better the AI output fits the project. Context should include:

- **spec**: The current version's design intent, telling AI "what we're doing"
- **design-notes**: Cross-version long-term constraints and decision history, telling AI "what decisions we made before and why"
- **project_memory**: The project's hard constraints and principles, telling AI "what can be done, what can't"
- **Current subtask description**: The focus of the current task, telling AI "you only need to care about this right now"

The less context you provide, the more AI tends toward "general best practices" — and "general best practices" usually aren't suitable for your specific project. This combination isn't something you "occasionally provide" — it must be prepared before every task starts.

**Element 3: Tool-ify constraint rules.**

Writing "please use TDD" in a prompt is a suggestion — AI can selectively comply. It might verbally agree to "use TDD" but skip tests and go straight to implementation in practice. Using a skill to强制 TDD is a constraint — AI must complete the full "write test → see RED → write implementation → see GREEN" cycle before proceeding.

Distinguishing "suggestions" from "constraints" is simple: suggestions AI can ignore; constraints AI cannot skip. What can be tool-ified should not remain at the prompt level. Because prompts "tell AI what to do," while tools "ensure AI must do it."

Which constraints are worth tool-ifying: testing standards (TDD mandatory), process standards (plan → implementation → review order), branch strategy (worktree isolation), version wrap-up (closure checklist). These are the areas where AI most easily "slacks off" or "goes off track." Tool-ifying them significantly improves collaboration quality.

### How to Learn from AI Output

AI output isn't just "code to use" — it's also a **learning material**. Every piece of AI-written code, every AI-written design document, contains something worth learning — provided you're willing to deconstruct it.

**Don't just accept the result; understand the原理.**

AI gives you a piece of code using `Promise.allSettled` to handle concurrent requests. Don't just copy-paste it. Ask: why use `allSettled` instead of `all`? What's the semantic difference between `allSettled` and `all`? When should each be used? If one failure shouldn't affect other requests' handling, `allSettled` is more appropriate; if any failure should cause the entire operation to fail, then `all` is the right choice.

Understand the原理, and next time you can judge similar situations yourself. Without understanding the原理, you won't spot it when AI gives the wrong choice — AI often uses `allSettled` where `all` is needed, or vice versa, because it has seen both usages in its training data but hasn't "understood" the boundary of correctness.

**Compare AI's multiple outputs.**

Ask AI the same question at different times, in different contexts, and compare the differences. The differences are typically "alternative approaches" — for instance, once AI used a callback pattern, another time it used a Promise pattern. Understanding why both approaches are viable, their respective pros and cons, and which to choose in your scenario — this comparison broadens your technical perspective.

One AI answer is "a solution." Multiple AI answers compared represent "solution space." Seeing the "solution space" is what truly helps you understand the problem's context.

**Learn from AI's mistakes.**

AI's incorrect code is especially worth studying. What's the error? Why did it make this error? What concept does this error reveal that AI misunderstands? Studying errors yields more insight than studying correct answers — correct answers seem obvious, and you glance over them; errors expose blind spots and easily confused boundaries.

For example, AI writes a SQL query without a `WHERE` clause, causing a full table update — the error itself isn't complex, but it reveals "AI may lose critical constraints when constructing SQL statements." You learn: in the future, when asking AI to write SQL, you must explicitly require "check each WHERE condition item by item."

**Be wary of code that "looks correct."**

AI-written code often has reasonable naming, tidy structure, and complete comments — it looks professional. But "looks correct" doesn't equal "correct." When learning, verify — run tests, check documentation, read source code to confirm, ask yourself "what would this code do in boundary cases?" Accepting without verification means what you learn is "AI's confidence," not "technical correctness."

"Looks correct" is the most dangerous. If code is clearly wrong, you'll immediately question it. But "looks correct" code lets your guard down, letting you accept errors as correct.

### How to Build a Knowledge Base

The knowledge base is an asset that accumulates "knowledge about how to collaborate." It has two layers:

**Memory (session-level memory)** : Working memory for the current session. What the AI learns during a session — "this project's conventions," "your preferences," "the current task focus" — lives in the session's working memory. It disappears when the session ends; it's short-term. Memory的作用 is to give AI continuity within a single session — not forgetting what was said earlier.

**Project_memory (project-level knowledge base)** : Cross-session long-term memory. Hard constraints, lessons learned, principles, architecture map — written in project_memory, injected into the system prompt every session. This is long-term, cumulative, and available in every session.

What should and shouldn't be written in project_memory needs clear differentiation:

**What should be written:**

- **Hard constraints**: Rules that cannot be violated in the project. For example, "core layer cannot import from access layer," "API keys can only be read from environment variables," "tests cannot depend on external networks."
- **Lessons learned**: Pitfalls encountered and the corresponding constraints. For example, "AI once skipped tests and went straight to implementation, resulting in a production hotfix — from then on, TDD was set as a red line,强制 enforced by skill."
- **Principles**: Design principles the项目遵循. For example, "YAGNI," "additive而非subtractive," "errors are not persisted."
- **Current version focus**: What this version does and doesn't do, preventing the AI from drifting into future version features.

**What should NOT be written:**

- **Specific code**: Code is in the repository; don't repeat it in memory. project_memory is for rules, not a code library.
- **Temporary decisions**: Temporary decisions belong in the spec, not memory. The next version's spec will override them; leaving them in memory makes them outdated.
- **Outdated information**: Outdated constraints are worse than no constraints — they make AI follow rules that are no longer valid. project_memory needs regular cleanup; constraints that no longer apply to the next version should be promptly removed.

Project_memory should be concise. It's injected into the system prompt every session; being too long wastes tokens and dilutes the signal. A few hundred to a thousand words is most appropriate, covering only the most critical constraints and principles. Detailed content goes in the spec and design-notes; project_memory is the "constitution," not the "legal code."

Knowledge base maintenance is a continuous process. After each version closure,回顾: what new pitfalls did this version uncover? What constraints should be added to project_memory? Which old constraints are outdated and should be removed? An unmaintained knowledge base becomes "historical baggage" — AI making decisions based on outdated constraints is worse than having no constraints at all.

### How to Evaluate AI Output Quality

AI output shouldn't be accepted just because it "looks correct." Three escalating standards for evaluating quality:

**Level 1: Tests pass.** The most basic condition. If tests don't pass, the output is definitely problematic. But tests passing doesn't mean the output is fine — test coverage might be insufficient, assertions too weak, or real logic mocked away. Passing is the first threshold, not the final standard.

**Level 2: Review the code.** Read through the AI-written code and ask a few questions: What does this code do? Why is it done this way? Is there a simpler approach? Are boundary cases handled? Are there unrequested dependencies or abstractions? Are there security risks?

Review isn't about distrusting AI — it's about treating AI as "a colleague who writes well but occasionally goes off track." Its output deserves review, and the review process is also a learning process for you — you'll discover common patterns in AI's work, which become reference points for your next prompt.

**Level 3: Compare against expectations.** Does AI's output match your expectations? If it does, did AI really understand your needs, or did it happen to give an answer that "looks similar"? If it doesn't, is AI wrong, or do your expectations themselves need adjustment?

This is the hardest level. It requires you to distinguish between "AI's output meets expectations" and "AI's output is correct" — expectations themselves can be wrong. For example, you ask AI to implement a feature using a certain pattern, and AI uses a different but cleaner pattern — should you insist on "matching expectations" or accept the "better approach"?

Evaluating quality requires avoiding two extremes: total acceptance ("AI wrote it, so it must be right") and total suspicion ("AI wrote it, so it must have problems"). The former abdicates judgment, the latter wastes AI's value. The right approach is **trust but verify** — AI can be trusted more in areas it excels at (patterned code, test generation), and must be strictly verified in areas it's poor at (architecture, security).

### How to Continuously Optimize Collaboration Processes

The collaboration process isn't designed once and done — it requires continuous optimization. The optimization cycle includes four steps:

**Step 1: Retrospect.** After each version closure,回顾 the collaboration in this version. Which subtasks went smoothly? Which repeatedly circuit-broke? Which AI behaviors surprised you? The retrospect must be honest — "AI performed very well this time" — if true, find out why (was the spec well-written? were constraints properly configured?). "This time was terrible" — find out why (vague requirements? insufficient constraints?).

A retrospect doesn't need to be long; a few key questions are enough:

- In what scenarios did AI perform best and worst this version?
- Did any new pitfall patterns emerge that aren't yet covered by constraints?
- Does project_memory need additions or changes?

**Step 2: Adjust constraints.** Patterns discovered during retrospect are transformed into concrete constraints. For example, if you find "AI keeps introducing unnecessary abstractions," add a rule to project_memory: "YAGNI is a hard constraint; introducing abstractions must be justified as necessary." If you find "AI often forgets to add transactions in database operations," add: "Database write operations must explicitly declare transaction boundaries."

Constraint adjustment is iterative — add a constraint, observe the effect, adjust if the effect isn't good. Adding too many constraints at once causes AI to become overly constrained and output quality to drop. Adjust one or two constraint points per version, giving adjustment time to take effect.

**Step 3: Iterate the workflow.** The workflow itself must also iterate. For example, if you find "the plan phase takes too much time," adjust the plan's granularity — from "detailed plan for every file" to "only module-level plan, letting AI decompose the details within subtasks." If you find "subtask isolation is insufficient," adjust the decomposition approach.

The workflow isn't dogma — it's a tool. Tools should serve effectiveness. If a流程 step doesn't bring value (or brings less value than the cost it consumes), it should be adjusted or removed.

**Step 4: Record adjustments.** Every process adjustment must be recorded in design-notes. What was adjusted, why it was adjusted, and what the effect was. Without recording, six months later you'll forget why you made this adjustment and will adjust back to the same approach, stepping in the same pitfall.

When recording, write down three things clearly: the original approach, the problem encountered, the new approach and its rationale. This seems like extra work, but in the long run, it's a safeguard against "repeatedly stepping in the same pit."

Optimization should avoid "over-optimization." Adjusting the workflow too frequently means you can't keep up, and constantly adapting to new processes is itself inefficient. A rule of thumb: adjust at most one or two process points per version, give them time to take effect, and observe the cumulative results.

### How to Avoid Over-Reliance on AI

The hidden risk of AI-assisted development is **over-reliance**. The symptoms are obvious, but those affected often can't see it in themselves:

- **You can't write code without AI anymore**. When faced with complex logic, your first reaction is "let AI write it," not "let me think it through first." Over time, your ability to write complex logic atrophies.
- **You don't review AI code anymore**. "AI wrote it, so it should be right" becomes the default assumption. You no longer question AI's output, even when "this code feels a bit off" — you tell yourself "AI must have thought it through more thoroughly than me."
- **You lose critical thinking**. You no longer question AI's proposed solutions; you just accept them. Where you once would think "what are the pros and cons of this approach," now you only think "does this approach work."
- **Core decision-making is outsourced**. Architecture direction, technology choices, tool selection — all left to AI's suggestions, with you merely "approving." But approval isn't decision-making — you're just confirming AI's thoughts without forming your own judgment.

The cost of over-reliance is **capability degradation**. Let AI write complex logic for long enough, and your own ability to write complex logic shrinks. Stop reviewing for long enough, and your code-reading ability shrinks. Stop questioning for long enough, and your technical judgment shrinks. When the day comes that AI is unavailable or gives the wrong answer, you'll find yourself unable to judge independently.

The solution is to **maintain autonomy in core decisions**:

- **Set architecture direction yourself** — AI only proposes, doesn't decide. You determine "what framework," "how to layer," "what patterns to introduce"; AI handles the implementation code.
- **Understand key algorithms yourself** — don't just accept AI's implementation. Even if you end up using AI's code, understand it before accepting it.
- **Review security-related code yourself** — don't rely on AI's self-checks. Errors in security logic don't surface immediately, but when they do, the damage is already done.
- **Occasionally write complex logic yourself** — keep your skills sharp. You don't need to write all the code yourself, but regularly practice on "challenging" code to keep your abilities active.
- **Keep learning** — AI is an accelerator, not a replacement. New technologies, new paradigms, new tools still require you to actively learn — AI can provide summaries and overviews, but deep understanding still comes from you.

AI is an amplifier — it amplifies your capabilities, and it also amplifies your blind spots. Capable people using AI are like a tiger with wings; less capable people using AI accelerate their mistakes. Maintain your own capabilities, and AI is a增益. Abandon your capabilities, and AI becomes a dependency trap.

## Comparison with Other Approaches

Facing the question of "how to continuously improve AI collaboration," different teams and individuals have different approaches. There are roughly three typical approaches.

### Approach A: Learn as You Go, No Systemization

The core attitude of this approach is "just use it." Developers don't deliberately record experiences, don't organize knowledge bases, don't回顾 and optimize processes. Every session is "starting from scratch" — prompts written on the fly, constraints thought up on the spot, processes improvised. When problems arise, they "pay more attention next time," but don't take time to沉淀 experience into reusable assets.

**Applicable scenarios:** Developers who use AI occasionally, one-off projects, scenarios with low quality requirements.

**Advantages:** Most flexible, no additional burden. For developers who "use AI once or twice a week," building a systematic methodology is indeed unnecessary.

**Cost:** No cumulative effect. Every session's efficiency depends entirely on that session's performance — when you're in a good state, collaboration goes smoothly; when you're in a bad state, you hit every pitfall. Experience exists in your mind — change projects, change times, change AI tools, and you have to figure everything out again. For developers who use AI frequently, Approach A's efficiency ceiling is very low — you'll keep tripping over the same pitfalls.

### Approach B: Personal Experience Summary

This approach is a step up from Approach A: developers do personal experience summaries. It might be kept in their mind, or written in personal notes. When they find a good prompt template, they bookmark it; when they hit a pitfall, they make a note to pay attention next time.

**Applicable scenarios:** Heavy personal AI users, developers with self-reflective habits.

**Advantages:** Experience is沉淀ed to some extent. Knowledge in personal notes can be reused in the next project. Over time, the developer's AI collaboration ability improves — because they remember previous lessons.

**Cost:** Experience is personal,无法跨项目 or cross-team transfer. If the developer changes (or the project is handed to someone else), "experience is in personal notes" effectively means it doesn't exist. Moreover, personal notes are typically unstructured — you record something today and can't find it tomorrow; flipping through notes takes significant time.

In the AI-assisted development scenario, Approach B has another致命 problem: **AI can't read your personal notes**. Your personal experience can only optimize your own behavior, not AI's behavior. To make AI perform better, you need to沉淀 experience into places AI can read (project_memory, workflow documents, etc.).

### Approach C: Systematic Methodology沉淀

This is the methodology described in the "General Design" section. Core features:

- **Layered knowledge base**: Memory (session-level) and project_memory (project-level) are differentiated. Short-term memory is effective within a session; long-term memory accumulates across sessions.
- **Systematized evaluation**: Three-tier evaluation standards — tests pass → review code → compare against expectations. Not "feels right, so it's fine" — there are progressive verification steps.
- **Processed retrospect**: Formal retrospect after each version, with results written into design-notes and project_memory as input for the next version.
- **Tool-ified constraints**:沉淀ed experience isn't "noted in a journal" but "transformed into constraints written into the workflow." Constraints aren't about reminding yourself to "pay attention next time" — they强制 AI to follow the rules.
- **Closed-loop iteration**: Practice → reflect →沉淀 → optimize → practice again, forming a continuously improving闭环. After the latest practice changes are applied, the next practice evaluates the effect, then changes again.

**Applicable scenarios:** Heavy AI users, long-term iteration projects, multi-person collaborative AI-assisted development.

**Advantages:** Experience is systematically沉淀ed and transferred. AI can read constraints in project_memory; humans can read decision history in design-notes. The project-level collaboration methodology doesn't get lost when "people leave" or "projects change hands." The continuous improvement闭环 ensures the methodology doesn't stagnate but evolves in sync with AI capability upgrades.

**Cost:** High upfront investment. Building project_memory, defining evaluation standards, and setting up retrospect processes all take time. In the first one or two versions, these investments look like "extra work" — but after the third or fifth version, the cumulative effect starts to show, and the前期 investment begins paying off.

### Design Philosophy Comparison

| Dimension | Approach A (Learn as You Go) | Approach B (Personal Summary) | Approach C (Systematic沉淀) |
|---|---|---|---|
| Core attitude | Just use it | Experience in the mind | Knowledge base + closed-loop iteration |
| Knowledge沉淀 | None | Personal notes | project_memory + design-notes |
| AI can read | No | No | Yes (constraint injection) |
| Retrospect mechanism | None | Occasional回想 | Formal retrospect after version |
| Evaluation standard | Feeling | Personal judgment | Three-tier (test → review → compare) |
| Constraint form | None | "I'll pay attention next time" | Tool-ified process强制 |
| Usage frequency | Occasional | Frequent | Continuous daily use |
| Transferability | None | Personal-level | Project-level |

The essential difference between the three approaches is "whether experience is systematized" — Approach A doesn't沉淀 experience, Approach B does personal-level沉淀, Approach C does project-level, tool-level systematic沉淀.

## aptbot's Design Features

aptbot chooses Approach C as its methodological foundation. The reason is straightforward: aptbot is a learning-oriented project; it must not only use AI well itself, but also serve as an example of "how to systematically improve AI collaboration."

In concrete practice, aptbot has established a complete continuous improvement闭环:

**Knowledge base体系.** aptbot differentiates between session-level memory and project-level project_memory. Memory is used for the current session's working memory — telling AI "what we just did in this session and what we're doing now." project_memory is cross-session long-term constraints — automatically injected into every new session, letting AI know the project's rules from the very first round. The two complement each other: the former ensures session continuity, the latter ensures cross-session consistency.

**Three-tier evaluation embedded.** aptbot's workflow embeds evaluation mechanisms: test passing is the minimum threshold (can't submit without passing), followed by a review phase (human or AI reviewing code quality), and finally expectation comparison (in the UAT phase,对照 the spec to verify whether the output matches design intent). These three tiers aren't optional — they are强制ly executed steps in the process.

**Retrospect as a formal version activity.** During the cool-down period after each version closure, retrospect is a standard流程 item. Retrospect output is written into design-notes and project_memory — new lessons added as constraints, outdated constraints cleaned up. The retrospect isn't "do it when you have time" — it's part of the version iteration, as formal as writing code.

**Tool-ified constraints.** aptbot's experience doesn't stop at document reminders — it's强制 enforced through skills (preconfigured workflow templates). TDD constraints, circuit breaker mechanisms, the plan-no-code rule — these aren't "suggestions recorded in project_memory" — they are processes the AI must follow. Tool-ified constraints leave AI no path to "choose to ignore."

**Continuous workflow iteration.** aptbot's workflow itself evolves through versioning. Each version may adjust one or two process points — adjusting subtask decomposition granularity, optimizing the spec template structure, refining the UAT verification checklist. Workflow iterations are also recorded in design-notes, ensuring every adjustment has a verifiable basis and every change has a clear reason.

aptbot's design conveys a core philosophy: **Methodology isn't dead — it's alive.** You don't need to have a perfect collaboration process on day one, but you need to start iterating it from day one.

## Future Directions

The methodology of AI-assisted development continues to evolve. Several trends are worth watching:

**Smarter context management.** Currently, project_memory uses a "full injection" mode — all constraints are injected into every session. In the future, constraints could be dynamically selected based on the current subtask's context — injecting security constraints when security is involved, and TDD constraints when testing is involved. This reduces token waste and increases signal density.

**AI-assisted retrospect.** Currently, retrospect relies on developers manually reviewing. In the future, AI could automatically generate a "version collaboration report" at version closure — listing the number and causes of circuit breaks in this version, the frequency of AI retries, and statistics on constraint triggers. Developers can retrospect more efficiently based on the report.

**Cross-project knowledge transfer.** Currently, project_memory is project-isolated — experience from one project doesn't automatically transfer to another. In the future, knowledge transfer mechanisms could allow AI collaboration experience (prompt patterns, constraint rules, document templates)沉淀ed in one project to be reused in a new project.

**Team-level knowledge sharing.** When multiple people collaborate using AI, how can different members' AI collaboration experience be shared? If one person hits a pitfall, how can the entire team (and the team's AI) avoid that pitfall? Team-level project_memory and collaboration retrospect mechanisms will become increasingly important.

aptbot will gradually explore these directions in subsequent versions. The core principle remains unchanged: the key to continuous improvement isn't tools — it's **habits** — the habit of retrospect, the habit of recording, the habit of evaluating. Tools can assist habits, but building habits is up to you.

## Summary

This article is the culmination of Track 2 and the "meta perspective" of the entire methodology —不再 discussing specific collaboration techniques, but discussing how to let the collaboration techniques themselves continuously evolve.

Core points:

1. **Effective collaboration** requires three elements: specific prompts, sufficient context, and tool-ified constraints. All three are indispensable.
2. **Learning from AI** requires not just accepting results, but understanding principles, comparing multiple outputs, studying AI's errors, and being wary of code that "looks correct."
3. **Knowledge base** should be layered — session-level memory ensures continuity; project-level project_memory ensures consistency. Working together, AI can output stably.
4. **Evaluating quality** requires three escalating tiers — tests pass → review code → compare against expectations. No step can be skipped.
5. **Optimizing processes** requires a closed loop — retrospect → adjust constraints → iterate workflow → record adjustments. Iterate one or two points per version,积累 continuously.
6. **Avoiding over-reliance** — maintain autonomy in core decisions, maintain the habit of reading code, maintain the ability to "do it without AI."

Among the three approaches, Approach C (systematic methodology沉淀) is the inevitable choice for sustained AI use. It's not the easiest (requires upfront investment), but it ensures your AI collaboration ability doesn't stagnate — you'll get better with each iteration.

The five articles of Track 2 (process, quality, documentation, long-term iteration, boundaries, continuous improvement) form a complete methodology for AI-assisted development. Return to Track 1 to see how a concrete agent project starts from an MVP and walks the evolutionary roadmap under these methodologies.
