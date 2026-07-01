---
slug: "06-skills-system"
title: "Skills 系统：两层加载与自演化规划"
description: "Skills 两层加载机制、最小 frontmatter、L1 索引与 token 预算截断、read_file 特判更新 lastUsed、热重载联动、自演化 skill 远期愿景"
track: agent-practice
chapter: 核心特性深入篇
order: 6
difficulty: intermediate
estimatedReadingTime: 9
status: published
prerequisites:
  - 05-memory-system
lastUpdated: "2026-07-01"
tags:
  - skills
  - system-prompt
  - hot-reload
---

# Skills 系统：两层加载与自演化规划

agent 的能力不只是工具——还有"什么时候用什么工具"的知识。一个 bash 工具加 100 条"如何用 bash 完成 X 任务"的指南，比加 10 个新工具更有效。Skills 系统就是承载这类知识的方式，但要解决一个核心矛盾：知识多了 system prompt 会爆，少了 agent 又不够聪明。

## 两层加载：workspace 覆盖 builtin

aptbot 的 skills 分两层存放：

- **builtin skills**：随 aptbot 代码发布的内置技能，放在 `src/core/skills/builtin/` 之类目录
- **workspace skills**：用户项目本地技能，放在 workspace 的 `.aptbot/skills/` 之类目录

加载时 workspace 层覆盖 builtin 层——同名 skill 以 workspace 版本为准。

为什么要两层？

**builtin 提供"开箱即用"的基础能力**：aptbot 自带的"如何写测试"、"如何做 git 操作"、"如何调试 TypeScript"等通用技能，用户 clone 后立即能用。

**workspace 提供"项目特化"的定制能力**：用户可以为自己的项目写专门的 skill，比如"在我们公司的 monorepo 里如何跑测试"、"这个项目的代码风格约定"。这些 skill 永远不该进 builtin（太特化），但对当前项目至关重要。

**覆盖机制让用户能改 builtin**：如果用户不满意某个 builtin skill，不需要 fork aptbot，只需在 workspace 同名 skill 写自己的版本。这让 aptbot 既能"开箱即用"又能"完全可定制"。

## 最小 frontmatter（name / description）

每个 skill 是一个 markdown 文件，顶部 frontmatter 只要求两个字段：

- **name**：skill 名字（slug 格式）
- **description**：给 LLM 看的简介，告诉它"这个 skill 在什么场景下有用"

为什么这么少字段？因为 skill 的核心价值是它的 markdown 正文——具体怎么做事的指南。frontmatter 只是"目录索引"，让 LLM 知道有这个 skill 存在、什么时候该读它。

复杂 frontmatter（priority、tags、triggers 等）会带来两个问题：一是维护成本（用户写 skill 时要填一堆字段），二是 LLM 选择 skill 时反而要处理更多噪音信息。最小 frontmatter 强制用户把"何时用"压缩进 description 一句话，这本身是个好的抽象训练。

## 全量 description 注入 system prompt 的 token 成本

最朴素的 skills 加载方式：把所有 skill 的 description 都注入 system prompt，让 LLM 知道"有哪些 skill 可用"。这能 work，但有 token 成本。

假设 50 个 skill，每个 description 平均 50 token，就是 2500 token。每次 LLM 调用都要付这 2500 token，无论这次调用是否真的需要 skill。对于长对话（100 轮），就是 25 万 token 纯粹花在"列目录"上。

这个成本在 skill 数量少时（10 个以内）可接受，但增长到 50+ 就明显浪费。aptbot 的解决方式是 L1 索引。

## L1 索引（lastUsed 降序 + 4K token 预算截断）

L1 索引策略：

1. 每个 skill 维护 `lastUsed` 时间戳，记录上次被使用的时间
2. 按最近使用降序排序所有 skill
3. 注入 system prompt 时，按顺序累加 description token，达到 4K token 预算就截断

效果：最近常用的 skill 总在 system prompt 里，长期不用的沉到索引之外。这把"全量注入"的固定成本变成"按需注入"的动态成本。

为什么用 lastUsed 而不是更复杂的 relevance score？因为：

- **简单**：lastUsed 是单字段，维护成本低
- **可信**：使用时间是不可伪造的信号，不像 relevance 需要语义匹配
- **自适配**：用户在某个项目里频繁用 git skill，git skill 自然排前面；换项目后几天不用就沉下去

4K token 预算是经验值。太小（1K）会让常用 skill 也被截掉；太大（16K）挤占了真正对话内容的预算。4K 大约能容纳 30-50 个 skill 的 description，覆盖常用集。

## read_file 特判更新 lastUsed

lastUsed 的更新机制有个特判：`read_file` 工具读 skill 文件时，自动更新该 skill 的 lastUsed。

为什么特判？因为正常流程下，"使用 skill"意味着 agent 把 skill 内容加载进 context 并据此行动。但 read_file 是个通用工具，agent 可能用它读任何文件——包括 skill 文件。如果不特判，read skill 的行为不会被记录为"使用了 skill"，lastUsed 永远不更新，L1 索引会失真。

特判让 L1 索引反映真实使用模式：只要 agent 读过某个 skill，这个 skill 的 lastUsed 就更新，下次它在 L1 索引中位置更靠前。这是用"行为信号"补全"语义信号"的实用做法。

## 热重载联动

skills 支持热重载——用户改了 workspace 下的 skill 文件，下次 LLM 调用就能用新版本，不需要重启 aptbot。

热重载的实现与 Config、Memory 的热重载模式一致：mtimeNs 懒加载。每次 LLM 调用前检查 skills 目录的 mtimeNs，变了就重新扫描。

热重载让 skills 系统的迭代成本极低——用户写 skill 时可以"写一句、试一次、改一句、再试一次"，立即看到效果。这对 skill 的开发体验至关重要，因为 skill 本质是 prompt engineering，需要快速试错。

## future: 自演化 skill（参考 GA）

当前 skills 是静态的——用户写好 skill 文件，agent 按需加载。更远期的愿景是自演化 skill：agent 在执行任务时，如果发现"这个任务的方法值得记下来"，自己写一个新的 skill 文件存到 workspace。

这是 GenericAgent 的核心特性之一。它的意义在于：agent 不只是"使用知识"，而是"创造知识"。一个长期运行的 agent，会逐步积累一套属于自己的技能库，越来越适配用户的工作模式。

自演化 skill 的难点：

1. **质量控制**：agent 写的 skill 可能是噪音（"我尝试了 X 失败了"不该存成 skill）。需要某种过滤机制。
2. **冲突管理**：新 skill 与现有 skill 冲突时如何处理？
3. **可解释性**：用户需要能审计 agent 自己写的 skill，否则就是黑箱。

GA 用 LLM 自评 + 用户审计的组合解决这些问题。aptbot 的自演化 skill 还在路线图上（L3 路线），但 skills 系统的两层加载、最小 frontmatter、热重载这些基础，已经为未来演进铺好了路。

## 小结

Skills 系统是 agent 的"知识层"，与工具层（做事）互补。两层加载平衡 builtin 与定制，最小 frontmatter 降低维护成本，L1 索引用 lastUsed 控 token 成本，热重载让迭代成本低，自演化是远期愿景。每一项都对应"如何让 agent 既有知识又不被知识压垮"这个矛盾的一面。

下一篇文章看 Hook 系统：8 个扩展点如何让 agent 行为可插拔。
