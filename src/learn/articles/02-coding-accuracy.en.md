---
slug: "02-coding-accuracy"
title: "Coding Accuracy and Testing Baseline: Four Lines of Defense from It Works to It's Trustworthy"
description: "TDD red-green cycle, Semantic Versioning with Keep a Changelog, four-category UAT checklist, E2E test design, and test baseline maintenance — elevating AI code from 'runs' to 'trustworthy'"
track: ai-coding-practice
chapter: 方法论
order: 15
difficulty: beginner
estimatedReadingTime: 18
status: published
prerequisites: []
lastUpdated: "2026-07-02"
tags:
  - tdd
  - testing
  - uat
  - version-control
  - quality
---

Code written by AI has a deceptively dangerous quality: it **looks correct**. Naming is reasonable, structure is tidy, comments are complete — often cleaner than most human-written code. But run it, and you discover it references nonexistent APIs, misses boundary conditions, and hides bugs in untested paths. This isn't the AI being malicious; it's inherent to how large language models work: they generate code based on probability distributions, not execution verification. To elevate AI-written code from "it works" to "it's trustworthy," you need a set of interlocking quality defenses.

## Overview: The Quality Proposition of AI Code

AI-assisted development presents an unprecedented quality proposition. In traditional software development, the developer is directly responsible for code quality — you write a line of code, you know why you wrote it that way, you know what it covers and what it doesn't. AI doesn't work like that.

The process of AI code generation can be likened to "an experienced programmer falling asleep at the keyboard, with their hands still moving." The output is impeccable in syntax and style, but might reference a nonexistent function, assume a variable was never assigned, or ignore a critical state transition. **The root cause: AI has no execution model.** It doesn't know what its own code will do when run; it only "guesses" what it will do.

This renders traditional code review largely ineffective. When humans review AI code, they're easily misled by the surface-level cleanliness, assuming "the code is so well-structured, the logic must be fine too." Worse, bugs in AI code often aren't syntactic (linters won't catch them) — they're at the semantic level: function signatures look reasonable but behavior deviates subtly, error handling paths appear covered but are unreachable.

The solution: **stop relying on human judgment; rely on interlocking mechanisms.** When TDD, version control, UAT, and testing baselines are stacked together, each layer catches what the previous one might miss:

- **TDD** guards the correctness of every function — tests must pass before code enters the repository
- **Version control** guards the reversibility of every change — roll back immediately when something breaks
- **UAT** guards end-to-end behavioral consistency — verify exactly what the spec says
- **Testing baseline** guards against regression — new versions must not be worse than old ones

This "layered safety net" design is the only reliable path to making AI code truly correct, not just seemingly so.

## General Design: Four Lines of Quality Defense

### First Layer: The TDD Red Line

In AI-assisted development, TDD must be elevated from a "best practice suggestion" to a **red line**. A red line means: it is strictly forbidden to skip testing and write business code directly — no exceptions, not even "this function is simple" or "this change is just modifying a constant."

Why must it be this hard? Because AI's judgment of "simple" is not trustworthy. It thinks "changing timeout from 30s to 60s" is simple, but overlooks that the same constant is shared between stream control and tool timeout — changing one breaks the other. It thinks "adding a log statement" is simple, but the log leaks sensitive fields. TDD isn't about "testing whether this function is correct"; it's about **forcing behavioral changes to be made explicit** — if you want to change behavior, you must first write a test describing the new behavior, see the RED on the old test, then change the code.

The TDD red-green cycle in AI-assisted development has three strictly enforced steps:

1. **RED**: Write the test first, run it, and **you must see failure in the terminal**. If you don't see RED before writing implementation, you haven't written a test — because you can't tell whether the test is actually testing what you care about.
2. **GREEN**: Write the minimum code to make the test pass. Don't write a single extra line of "incidental" code. AI tends to write a complete implementation in one go, which violates YAGNI and leaves no work for subsequent tasks.
3. **REFACTOR**: Only refactor after the test passes. Run the test again after refactoring to confirm it's still green.

Why is "witnessing RED" so important? Because AI often writes tests that "look correct but always pass" — assertions referencing the wrong variable name, tests that never actually call the function under test, mock configurations that let any input pass. Seeing RED first proves the test is actually testing what you want it to test, making the GREEN phase implementation meaningful.

### Second Layer: Version Number Conventions

For AI-assisted development projects, version numbers aren't decorative. Every time a new version is released, the version must be semantic, and the CHANGELOG must be updated.

**Semantic Versioning** MAJOR.MINOR.PATCH rules:

- **MAJOR**: Incompatible API changes. In AI-assisted projects, this typically means architecture-level refactoring.
- **MINOR**: Backward-compatible feature additions. When an iteration completes a set of new capabilities, bump MINOR.
- **PATCH**: Backward-compatible bug fixes.

**Keep a Changelog** format conventions: Under each version entry, categorize changes into Added / Changed / Deprecated / Removed / Fixed / Security. AI makes two typical mistakes when writing CHANGELOGs: either piling all changes together without categorization, or writing in overly technical detail ("refactored the buffer management of the JSON parser") instead of from a user perspective ("fixed memory overflow when parsing large files"). The CHANGELOG is for users, not for git log.

The version, CHANGELOG, and git tag must all be synchronized: the `version` field in `package.json`, the entry in `CHANGELOG.md`, and the `git tag v0.x.y` tag — all three are required. During release closure, these three items are mandatory checks; if they're inconsistent, the release is blocked.

### Third Layer: UAT Verification Checklist

UAT (User Acceptance Testing) isn't "run through it once and see" — it's a structured checklist divided into four categories of verification:

**Category 1: Local verification**
Must pass in the local development environment. All tests green, TypeScript compilation zero errors, manually walk through the core path of new features. This is the minimum threshold — code that can't pass locally shouldn't proceed to the next step.

**Category 2: VPS verification**
Must pass when deployed to the production environment (or staging environment). Passing locally doesn't mean it passes on VPS — file path differences, Node version differences, missing environment variables, data directory permissions — any of these can cause the VPS to fail. AI-written code often "pretends" all paths are correct in the local test environment because it can't anticipate deployment environment differences.

**Category 3: New feature item-by-item verification**
Go through the spec's acceptance criteria one by one. If the spec says "visiting /learn shows 19 article cards," then during UAT, actually visit /learn and count the cards. The spec is the contract, and UAT is the acceptance — one-to-one correspondence. There's no room for "looks close enough."

**Category 4: Legacy feature regression verification**
Run through all core capabilities of the previous version. When AI changes code, it often "unintentionally" breaks old features — a new dependency changes the behavior of an old API, a refactoring misses a call site, or a dependency upgrade breaks an interface. Regression verification is the final safety net.

All four categories are mandatory. Doing only local but not VPS will fail on deployment day; doing only new features without regression will fail from user feedback. Write the UAT checklist as a markdown file, check off each item, and only release when all items pass.

### Fourth Layer: E2E Test Design

E2E (end-to-end) testing covers two types of scenarios while avoiding a common anti-pattern:

**Happy path**: The user's most common journey, running complete from entry to exit. For example, "user visits homepage → clicks an article card → sees the content → submits feedback → receives a success message." If any link in this chain breaks, the core experience collapses.

**Error path**: Exceptional scenarios. A nonexistent slug returns 404, an empty message returns 400, rapid repeated submissions trigger rate limiting (429), accessing an admin interface without auth returns 401. Error path testing is what AI most easily misses — it writes code assuming everything works normally and won't proactively consider "what if the user enters an empty string?"

**Zero expect anti-pattern**: Tests that only contain `await page.goto(url)` without any `expect` assertions. These tests always pass and are completely worthless. Every test must have a clear assertion — the page contains certain text, the status code equals a specific value, the database has one more record.

E2E testing is expensive, so it requires trade-offs. Don't aim for 100% coverage, but core paths and critical error paths must be covered. Visual details (font sizes, colors, spacing) shouldn't have E2E tests — leave them for manual UAT or future visual regression tools.

### Test Baseline Maintenance

Each version has a test baseline number (e.g., v0.2.2 had 936/938 passing). The goal for the next version is: **total count only increases, pass rate does not regress**.

What the non-regression red line means:

- **Don't delete old tests to "fix green"**: If a test is red, it means the code is broken, not the test.
- **Don't skip tests to "fake green"**: `it.skip` is a temporary measure; it must be restored before release closure. A permanently skipped test is equivalent to no test at all.
- **New features must include new tests**: If code volume increases but test volume doesn't, coverage will inevitably decline.
- **Flaky tests must be addressed**: Intermittently failing tests are worse than no tests — they strip "red" of its warning significance. Flaky tests must either be fixed, isolated, or deleted; they cannot be left unmanaged.

The test baseline numbers should be stated in advance within the spec (e.g., "0.2.3 target: approximately 85-95 new tests, total ~1030-1050"), and verified at release closure. Versions that don't meet the target should not be released — this is a hard self-imposed constraint.

### Release Closure Process

Release closure isn't "submit the last commit" — it's a structured series of wrap-up steps. A typical process includes:

1. All subtasks complete (kanban all `[x]`)
2. All tests green + compilation zero errors
3. CHANGELOG / README / architecture documentation synchronized
4. `package.json` version bumped
5. git tag created
6. Branch merge direction confirmed

The value of this process is **preventing "good enough, ship it"**. AI tends to slack off in the final stages — "tests pass, I'll update the docs later," "I'll create the tag when I remember." Structured wrap-up forces these "laters" into "now," because every item is a hard condition for closure.

Documentation synchronization is especially important. If the CHANGELOG isn't updated, users don't know what changed in this version. If the README isn't updated, nobody knows new features exist. If the architecture documentation isn't updated, in three months even you won't remember why you introduced a particular abstraction layer.

### Overview of the Four Quality Defense Lines

The diagram below shows how these four layers nest together, each backing up the others:

![Four Layers of Quality Defense](/learn/articles/images/coding-accuracy.png)

TDD ensures the correctness of every function, version control ensures the reversibility of every change, UAT ensures end-to-end behavioral consistency, and the testing baseline ensures non-regression between versions — all four layers are indispensable.

## Comparison with Other Approaches

Around the topic of "AI code quality assurance," current practices can be grouped into three approaches, each representing different trade-offs.

### Approach A: No Tests, Deploy AI Code Directly

This is the most aggressive and daring approach — have the AI write code, then deploy it to production directly. No tests, no review, no UAT.

**Design characteristics:**

- **Zero test investment**: All development time goes into writing business code
- **Complete trust in AI**: Assumes AI output is sufficiently correct
- **Relies on runtime to discover bugs**: If it's wrong, fix it when discovered in production
- **Fast time-to-deploy**: Shortest path from idea to deployment

**Applicable scenarios**: Prototype validation, personal small tools, unimportant internal scripts. When code errors won't cause real damage, this approach is fastest.

**Limitations**: For any project that faces users, processes data, or involves money, this is the most dangerous approach. Bugs in AI code aren't "maybe wrong" — they're "definitely wrong somewhere," you just haven't found them yet. The cost of fixing bugs in production is typically 10-100 times higher than fixing them during development.

### Approach B: Manual Post-hoc Testing

Code is generated by AI, then a human developer writes tests to verify it. This is how many teams operate — AI writes code, humans write tests.

**Design characteristics:**

- **Separation of development and testing**: AI produces code, humans supplement tests
- **Coverage is uncertain**: Humans decide what to test and what not to test
- **Tests lag behind code**: Tests are written after the code is complete
- **Relies on human judgment**: Humans need to determine what's worth testing and where AI might have made mistakes

**Applicable scenarios**: Projects with sufficient human resources and moderate quality requirements that aren't追求极致.

**Limitations**: This approach has several fundamental problems. First, **coverage is hard to guarantee** — human reviewers are deceived by AI code's "clean appearance" and miss critical tests. Second, **tests and code are out of sync** — when AI changes code, it won't update the tests because the tests were "added afterwards" rather than "written beforehand." Third, **human bias in test writing** — humans tend to test "what the code does" rather than "what the code should do," which is the reverse of the TDD perspective and more likely to miss boundary conditions. Fourth, **human energy is limited** — AI can produce thousands of lines of code per hour, but human test writing speed can't keep up, so test coverage will steadily decline.

### Approach C: TDD First + Automated Test Baseline + UAT Verification

This is the approach detailed in this article — TDD red line constrains the coding process, automated test baseline maintains quality thresholds, and the UAT structured checklist provides final pre-release verification.

**Design characteristics:**

- **TDD first**: Tests come before code, forcing behavioral changes to be explicit
- **Automated baseline**: Test quantity and quality serve as hard version release indicators
- **Structured UAT**: Four-category verification checklist with item-by-item checking
- **Release closure process**: Standardized version release wrap-up
- **Multiple safety nets**: Each defense layer covers the blind spots of the previous one

**Applicable scenarios**: Long-term product projects, team collaboration projects, production-grade code facing users.

**Cost**: The slowest development speed. Writing tests takes more time than writing code, and the TDD red-green cycle is significantly slower than writing code directly. UAT verification requires manual execution time. These investments pay off in long-term projects but may not be worthwhile for short-term projects or prototypes.

### Comparison Summary

| Dimension | Approach A (No Tests) | Approach B (Manual Post-hoc) | Approach C (TDD + Baseline + UAT) |
|---|---|---|---|
| Development speed | **Fastest** | Medium | Slowest |
| Test coverage | None | Medium (depends on human) | **High (structured)** |
| Test-code sync | — | Lagging | **First (TDD)** |
| Bug discovery timing | Production | Testing phase | **Coding phase** |
| Long-term maintainability | Poor | Fair | **Good** |
| Human effort | **Lowest** | **Highest (human writes tests)** | Medium (AI writes tests + human review) |
| Suitable projects | One-off scripts | Medium complexity | **Long-term products** |

This comparison reveals a counterintuitive truth: **Approach C, seemingly the slowest, actually saves the most time in long-term projects**. Because in Approaches A and B, bug fix costs grow exponentially as the project grows — you spend more and more time debugging, backtracking, and rolling back. Approach C invests mostly upfront, then continuously benefits from the test baseline's security.

## aptbot's Design Features

### Why Approach C

aptbot is an open-source learning-oriented AI Agent project. Its code exists for people to learn agent development. Both goals — open source and education — dictate that it must choose Approach C.

First, as an open-source project, aptbot's code will be used and modified by others. Without a test baseline, contributors can't tell whether their changes break existing functionality. The TDD red line and automated test baseline make open-source collaboration possible.

Second, as a learning-oriented project, aptbot's tests themselves serve as teaching material. By reading the test code, learners understand "what behavior this function should exhibit" and "how boundary conditions are handled." Tests aren't just quality assurance tools — they're documentation.

Third, aptbot aims for long-term sustainability. It's not a "write and run" project — it's an assistant that will iteratively evolve. Approach C's quality investments will continue to generate returns in subsequent versions.

### What Makes aptbot Unique

aptbot makes several unique design choices on top of Approach C:

**TDD tool-ified red line**: In other Approach C practices, TDD is typically a "team convention" or "personal habit." aptbot encodes TDD as a `test-driven-development` skill — when the agent executes tasks, the skill constrains it, and attempts to skip tests are intercepted. This turns TDD from a "verbal agreement" into a "system-mandated constraint."

**Finishing-a-development-branch skill**: The release closure process is encapsulated as a skill, automatically executing version checks, documentation synchronization, tag creation, and other operations. No need to manually go through a checklist — the agent handles these verifications itself.

**UAT checklist and spec bidirectional binding**: The UAT checklist doesn't exist independently — it's directly generated from the spec's acceptance criteria section. Whatever acceptance criteria the spec contains is what UAT verifies. This ensures "what's written gets verified, what's not written isn't considered complete."

**Test baseline pre-declared in spec**: Each version's spec states the expected number of new tests and the target baseline in the "Testing Strategy" section. This isn't a post-hoc statistic — it's a pre-commitment.

### Differences from Other Approaches

Compared to Approaches A, B, and C, aptbot's most fundamental difference is **transforming quality assurance from a human-to-human contract into a human-to-system contract**.

In Approach A, quality depends on luck. In Approach B, quality depends on human conscientiousness. In typical Approach C practice, quality depends on team discipline. aptbot goes further — quality depends on system enforcement. The agent cannot skip TDD, cannot bypass UAT, and cannot close a release without meeting the baseline. Discipline isn't achieved through "compliance" but through "inability to violate."

This design philosophy aligns perfectly with aptbot's positioning as an agent project: **if an agent's own code quality requires human supervision, it's not a true agent.**

## Future Directions

**Automated test generation and repair**: Currently, "writing tests" in TDD is still executed by AI, but test quality depends on prompt quality. In the future, agents could automatically analyze failure reasons after running tests and independently decide whether to fix the code or the test (though the "non-regression red line" would constrain the latter).

**Smarter baseline management**: The current baseline is "total count doesn't decrease," but different tests have different weights. Core path tests are far more valuable than edge feature tests. In the future, "weighted baselines" could be introduced — core tests must pass, while edge tests might conditionally regress.

**UAT automation**: Currently, UAT verification involves significant manual操作. In the future, visual regression tools (like Percy, Chromatic) and API contract testing tools could automate parts of UAT, allowing agents to execute UAT more independently.

**Automatic flaky test identification and治理**: Currently, flaky test management relies on manual discovery. In the future, agents could automatically mark flaky tests after multiple runs, analyze the source of flakiness, and even auto-repair them.

**Test coverage visualization**: Currently, the test baseline is one-dimensional (pass count), lacking coverage dimension visualization. In the future, "code change → test coverage" mapping diagrams could be generated, showing at a glance what tests cover each change.

## Summary

Coding accuracy isn't a single technique — it's a系统工程 of four interlocking defense layers:

1. **TDD red line** ensures the correctness of every function — tests must pass before code enters the repository
2. **Version control conventions** ensure the reversibility of every change — roll back immediately when something breaks
3. **UAT verification checklist** ensures end-to-end behavioral consistency — verify exactly what the spec says
4. **Test baseline maintenance** ensures non-regression between versions — new versions are no worse than old ones

Comparing the three approaches: Approach A (no tests) is fast but most dangerous; Approach B (manual post-hoc testing) has uncontrollable coverage and test-code sync issues; Approach C (TDD + baseline + UAT) is most reliable but slowest to develop. aptbot chooses Approach C and tool-ifies quality constraints into red lines, making it impossible for the agent to bypass quality gates at the system level.

The effect of stacking these four defense layers is: the earlier AI code bugs are found, the cheaper they are to fix. Problems TDD catches during coding can be fixed in seconds; problems UAT catches before release can be fixed in a day; problems users discover in production might take a week to locate and fix. The essence of quality defense isn't "zero bugs" — it's **making bugs appear at the moment when fixing them costs the least**. In the next article, we explore the underlying infrastructure that supports these processes and quality measures — the full lifecycle management of spec documentation.
