---
slug: "06-skills-system"
title: "Skills 系统：两层加载与自演化规划"
description: "理解 skill 在 agent 中的「知识层」定位，两层加载机制如何平衡内置与定制、最小 frontmatter 设计理念、L1 索引与 token 预算截断、热重载联动，以及三种 skill 管理方案的对比"
track: agent-practice
chapter: 核心特性深入篇
order: 6
difficulty: intermediate
estimatedReadingTime: 15
status: published
prerequisites:
  - 01-what-is-agent
  - 04-tool-system
lastUpdated: "2026-07-02"
tags:
  - skills
  - system-prompt
  - hot-reload
  - token-management
---

Tool 系统给了 agent "做事"的能力，但当 agent 面对"如何用这些工具做事"的问题时，还需要另一层知识——**使用工具的"智慧"**。

一个 bash 工具加 100 条"如何用 bash 完成 X 任务"的指南，比单纯加 10 个新工具更有效。因为 agent 不会自动知道"要查磁盘空间该用 `df -h`""要搜索文件该用 `find . -name`""要查看运行中的进程该用 `ps aux`"。这些是"使用工具的知识"，不是工具本身。

Skills 系统就是承载这类知识的模块。它是 agent 的"知识层"——告诉 agent 在什么场景下用什么工具、按什么步骤操作、需要注意什么陷阱。

但这里有一个核心矛盾：**知识越多，system prompt 越臃肿**。把所有 skill 的描述都塞进 system prompt，agent 知道所有事情，但 token 成本爆炸；只放少量 skill，agent 不知道很多事，错过最佳方案。如何平衡"知识广度"和"token 成本"，是 skills 系统设计的核心命题。

这篇文章会从 skill 系统的基本概念讲起，对比几种主流的知识注入方案，然后深入看 aptbot 如何通过"两层加载 + 频率索引"来平衡这个矛盾。

## 一、概念：什么是 skill，为什么需要 skill 系统

### 1.1 skill 是什么：使用工具的知识

Skill 不是工具。工具是"做什么"的能力（读文件、写文件、执行命令），skill 是"怎么用工具完成一个任务"的知识。

用现实世界类比：
- 工具是一把锤子、一把螺丝刀、一把锯子
- Skill 是"如何用这些工具做一个书架"——先锯木板 → 打孔 → 拧螺丝 → 打磨

agent 也是一样。它已经有了 bash、read、edit 这些工具，但面对"帮我修复这个 TypeScript 类型错误"时，它需要知道：先读文件理解错误上下文 → 检查类型定义 → 修改代码 → 运行 tsc 验证 → 运行测试确保没破坏其他东西。这不是一个工具调用能完成的，而是一套"操作流程"的知识。

Skill 文件通常是一个 markdown 文档，包含：
- **描述**：告诉 agent 这个 skill 在什么场景下有用
- **指南正文**：具体的操作步骤、注意事项、最佳实践

### 1.2 skill 与 tool 的关系

Tool 和 skill 在 agent 中扮演不同角色，但协同工作：

| | Tool | Skill |
|---|---|---|
| 回答的问题 | "agent 能做什么" | "agent 知道该怎么做" |
| 载体 | TypeScript 函数 + schema | Markdown 文档 |
| 如何注入 | function calling 定义 | system prompt 或 context 中 |
| 执行方式 | 模型直接调用 | 模型阅读后自主决策 |
| 安全边界 | 代码层硬校验 | 无（只是知识，不执行） |

简单说：**tool 是"可执行的操作"，skill 是"什么时候用什么操作的知识"**。

### 1.3 skill 注入的 token 成本问题

Skill 的知识要"喂"给 LLM，最常见的方式是注入到 system prompt 中。但每一篇 skill 的 description 甚至全文都要占用 token。

假设你有 50 篇 skill，每篇 description 平均 50 token（约 35-40 个汉字），总计 2500 token。每次 LLM 调用都要为这 2500 token 付费（时间和金钱），无论这次调用是否真的需要这些 skill。在 100 轮对话中，就是 25 万 token 纯粹花在"列目录"上。

如果加上 skill 的完整内容（每篇可能 500-2000 token），这个数字更加惊人。所以"把所有 skill 都注入"的方案是不可持续的——它把"知识多"的成本变成了每次调用都要支付的固定开销。

## 二、通用设计方案

### 2.1 skill 的管理策略

不同的 agent 项目在 skill 管理上有三个维度的决策：

**来源维度**：skill 从哪来？
- 完全由项目内置（开箱即用，但不可定制）
- 完全由用户编写（高度定制，但上手成本高）
- 内置 + 用户自定义（两者结合）

**注入维度**：skill 如何进入模型上下文？
- 全量注入：所有 skill 的 description（或全文）随每次请求一起发送
- 按需注入：只在需要时检索并注入相关 skill
- 混合注入：description 全量注入（让模型知道有什么 skill），全文按需加载

**更新维度**：skill 如何变更？
- 静态：skill 文件只在发布时更新
- 热重载：修改 skill 文件后即时生效，无需重启
- 自演化：agent 自己创建和更新 skill

### 2.2 按需检索 vs 全量注入

按需注入的核心挑战是"模型不知道自己不知道什么"。如果某个 skill 的 description 不在当前上下文中，模型永远不会知道存在这个 skill，自然不会请求它。所以按需注入需要一个外部的检索系统来判断"当前对话可能需要什么 skill"。

常见的检索策略：

1. **关键词匹配**：把当前用户输入的关键词与 skill description 做匹配。简单但精度低。
2. **嵌入向量检索**：把 skill description 和当前对话都转成向量，计算相似度。精度高但需要嵌入基础设施。
3. **最近使用优先**：记录每个 skill 的最后使用时间，最近常用的 skill 优先注入。无需语义理解，实现简单。

这三种策略没有绝对优劣——关键词匹配最适合"精确触发"的场景（用户明确说"帮我跑测试"→ 注入 test skill），向量检索最适合"模糊发现"的场景（用户说"代码好像有点问题"→ 注入 debugging skill），最近使用优先最适合"习惯适配"的场景（用户这两天一直在用 git skill → git skill 优先注入）。

### 2.3 skill 的生命周期

一个 skill 从创建到废弃，通常会经历：

1. **创建**：用户或项目编写 markdown 文件
2. **注册**：文件放入约定的目录，系统扫描发现
3. **索引**：skill 进入 L1 索引（被列入"可用 skill"列表）
4. **注入**：在适当的时机进入 system prompt 或 context
5. **使用**：agent 阅读 skill 内容并据此行动
6. **更新**：内容修改后通过热重载生效
7. **废弃**：不再使用的 skill 从索引中移除

## 三、市面其他 skill 管理方案对比

不同 agent 项目对"如何管理使用工具的知识"这个问题的回答差异很大。以下是三种有代表性的路线。

### 3.1 方案 A：全部预置，无用户扩展

这套路线的做法是：项目自带一套完整的 skill 库，用户不能添加、不能修改、不能删除。Skill 的内容由项目维护者编写和更新。

**设计特点：**

- **统一的 skill 库**：所有用户共享同一套 skill，版本由项目发布节奏控制
- **无自定义路径**：用户无法编写自己的 skill，也无法覆盖内置 skill
- **全量或精选注入**：要么把所有 skill description 都注入，要么由项目维护者精选一部分注入

**优势：**

- 质量可控——所有 skill 经过项目维护者 review，不存在低质量或错误的 skill
- 用户零配置——clone 即用，不需要理解 skill 系统的概念
- 一致性好——所有用户拥有相同的 agent 行为

**劣势：**

- **僵化**：用户无法为特定项目定制 skill。比如公司 monorepo 的独特测试流程、团队的代码规范——这些知识永远无法进入 skill 系统。
- **依赖项目发布节奏**：如果项目维护者更新了某个 skill，用户需要升级整个项目才能获得更新。
- **无法覆盖错误**：如果内置某个 skill 写得不好（比如推荐了过时的命令），用户只能忍受，不能修正。

### 3.2 方案 B：全部用户自写，无内置

这套路线走向另一个极端：项目不提供任何内置 skill，完全由用户自己编写。用户为自己的项目、自己的工作流编写专属 skill。

**设计特点：**

- **零内置 skill**：项目 clone 后，skill 目录是空的
- **用户完全自行编写**：每个 skill 由用户根据需求创建
- **灵活度最高**：用户可以精确控制 agent 知道什么、不知道什么

**优势：**

- 高度定制——agent 的知识完全适配用户的工作模式
- 没有"多余"的 skill——不会为不需要的场景付出 token 成本
- 用户对 agent 行为有完全控制

**劣势：**

- **上手成本高**：新用户 clone 项目后，agent 没有任何"使用知识"。问它"如何调试 TypeScript"它不知道——需要用户先写一个 debug-skill。
- **知识绝缘**：用户 A 写的好 skill 无法共享给用户 B（除非手动复制），社区无法积累通用知识。
- **维护负担重**：用户需要自己维护所有 skill 的更新和正确性。随着时间推移，skill 库可能越来越臃肿或过时。

### 3.3 方案 C：两层加载 + 按使用频率动态截断

这套路线结合了方案 A 和方案 B 的优点：内置 skill 提供"开箱即用"的基础能力，用户自定义 skill 提供"项目特化"的定制能力；同时通过按使用频率动态截断机制控制 token 成本。

**设计特点：**

- **两层加载**：builtin 层（项目内置）和 workspace 层（用户自定义），同名 skill 以 workspace 版本为准（覆盖）
- **最小 frontmatter**：只要求 name 和 description 两个字段，降低 skill 编写门槛
- **L1 频率索引**：按 lastUsed 降序排列，取前 N 个注入 system prompt（token 预算截断）
- **热重载**：修改 skill 文件即时生效，支持快速迭代

**优势：**

- 开箱即用——内置 skill 让新用户 clone 后立即拥有完整能力
- 可定制——workspace 层允许用户添加、覆盖任何 skill
- token 成本可控——全量注入变成按需注入，只有常用 skill 在 system prompt 中
- 自适配——用户的 skill 使用习惯决定了索引顺序，不用手动配置

**劣势：**

- 架构更复杂——需要实现两层加载、覆盖逻辑、频率索引、热重载
- 新 skill 的"冷启动"问题——刚添加的 skill lastUsed 为 null，在不使用它的场景中可能永远不会出现在索引中（需要特判或兜底策略）
- 社区维护成本——内置 skill 需要随着项目发展持续更新

### 3.4 三种方案对比

| 维度 | 方案 A（全部预置） | 方案 B（全部自写） | 方案 C（两层 + 频率索引） |
|---|---|---|---|
| 开箱即用 | 是 | 否 | 是 |
| 可定制性 | 无 | 完全 | 完全 |
| 上手成本 | 低 | 高 | 低 |
| token 成本控制 | 固定（全量或精选） | 用户自控 | 动态（频率截断） |
| 社区共享 | 强（统一 skill） | 无 | 中（builtin 共享 + workspace 私有） |
| 实现复杂度 | 低 | 低 | 中高 |
| 适合场景 | 标准化产品 | 高度定制的工作流 | 学习项目 / 个人 agent |

## 四、aptbot 的设计特点

aptbot 选择了方案 C 的路线。理由和学习项目的定位一致：既要让新用户一 clone 就能用（内置 skill），又要留出足够的定制空间（workspace 覆盖）；既要积累足够的技能知识，又要控制 system prompt 的 token 成本（L1 频率索引截断）。

### 4.1 两层加载：workspace 覆盖 builtin

aptbot 的 skill 分两层存放：

**builtin skills（内置层）**：随 aptbot 代码一起发布。存放在项目目录下的约定路径中。这些是"通用技能"——如何调试 TypeScript、如何做 git 操作、如何写测试、如何查文档。每个 aptbot 新版本可能会增加或更新 builtin skill。

**workspace skills（工作区层）**：存放在当前工作目录的 `.aptbot/skills/` 下。这些是"项目特化技能"——比如"在我们公司的 monorepo 中如何运行测试""这个项目的编码规范""这个项目特有的构建流程"。

加载时，workspace 层覆盖 builtin 层。同名 skill 以 workspace 版本为准。这意味着：

- 用户对内置 skill 不满意？不需要 fork aptbot——在 workspace 下创建同名的 skill 文件，自己的版本自动生效
- 项目有特殊流程？写一篇 workspace skill 就行，agent 会自动学习
- 想扩展内置 skill？在 workspace 下创建新的 skill 文件，agent 会同时加载内置和 workspace 的所有 skill

两层加载解决的根本问题是"**开箱即用与项目特化的矛盾**"——没有内置 skill，新用户面对的是一个"什么都不知道"的 agent；没有 workspace skill，老用户无法把项目独有的知识教给 agent。

![Skills 系统架构](/learn/articles/images/skills-system.png)

### 4.2 最小 frontmatter：name / description

每个 skill 文件顶部有一段 YAML frontmatter，只要求两个字段：

```yaml
---
name: debug-typescript
description: 如何调试 TypeScript 类型错误，包括 tsc 编译检查、类型断言的正确用法、常见类型错误模式
---
```

为什么只保留两个字段？

因为 skill 的核心价值在于它的**正文**——具体的操作指南。frontmatter 只是"目录索引"，让 LLM 知道有这个 skill 存在、什么时候该读它。额外的字段（priority、tags、triggers、author、version 等）会带来两个问题：

1. **维护成本**：用户写 skill 时要填一堆字段。有些字段（如 tags）在只有几个 skill 时可能有用，但 skill 一多就成了负担——每次新建 skill 都要想"这个 tag 合不合理"。
2. **信息噪音**：LLM 在决定"要不要用这个 skill"时，真正有用的是 description——一句话说清楚"这个 skill 在什么场景下有用"。额外字段对 LLM 来说可能是噪音，分散对关键信息的注意力。

最小 frontmatter 的设计哲学是：**强制用户把"何时用"压缩进一句话**。这本身就是好的抽象训练——如果你不能用一句话说清楚一个 skill 在什么场景有用，说明这个 skill 可能边界太宽或者太窄。

至于更丰富的元数据（版本控制、分类标签、依赖关系），可以在需要时通过外部工具（如 skill 市场或目录索引）来管理，不需要侵入 skill 文件本身的格式。

### 4.3 全量 description 注入的 token 成本分析

先说最朴素的方案——把所有 skill 的 description 都注入 system prompt。假设：

- 共有 50 篇 skill（20 篇 builtin + 30 篇 workspace）
- 每篇 description 平均 50 token
- 每次 LLM 调用支付 2500 token 的"列目录"成本
- 在 100 轮对话中，总计 25 万 token 花在"列目录"上

25 万 token 是什么概念？按 GPT-4 的价格大约 $5-10，按 Claude 3.5 大约 $1-2。对于个人项目来说这不是不能接受，但**浪费**——大部分 skill 在大部分对话中都用不上。用户可能在 80% 的时间里只用 20% 的 skill（符合帕累托分布）。

更关键的是，description 注入只是"让模型知道有这个 skill"，当模型决定使用某个 skill 时，还需要加载这个 skill 的**正文内容**。如果 50 篇 skill 的正文全部加载，每篇平均 1000 token，就是 5 万 token——这基本填满了小模型（如 8K context）的整个 context window。

所以"全量注入只适用 skill 数量极少的情况"（比如不超过 10 篇）。一旦 skill 数量增长，就需要更精细的注入策略。

### 4.4 L1 索引：lastUsed 降序 + 4K token 预算截断

aptbot 通过 L1 索引来解决"全量注入"的 token 浪费问题。策略是：

1. 每个 skill 维护一个 `lastUsed` 时间戳，记录上次被 agent "使用"的时间
2. 在组装 system prompt 时，所有 skill 按 lastUsed 降序排列
3. 从头开始累加每个 skill description 的 token 数
4. 达到 4K token 预算时截断——后面的 skill 不注入这次 system prompt

**效果**：最近常用的 skill 永远在 system prompt 里，长期不用的 skill 沉到索引之外。这把"全量注入"的固定 token 成本变成"按使用频率注入"的动态成本。

为什么用 lastUsed 而不是更复杂的 relevance score？

1. **简单**：lastUsed 是单字段，不需要外部服务来计算
2. **可信**：使用时间是不可伪造的信号——它反映的是 agent 真实的行为模式，不是语义匹配的"猜测"
3. **自适配**：用户在某项目里频繁使用 git skill → git skill 的 lastUsed 不断更新 → 自然排在前面。换项目后几天不用 git skill → 它自然沉下去，新项目相关的 skill 上来

**4K token 预算是经验值**。太少（1K）可能导致常用 skill 也被截断；太多（16K）就失去了"控制 token"的意义。4K 大约能容纳 80-100 个 skill 的 description（按平均 50 token 计算），对于大多数项目的 skill 数量来说足够覆盖常用集。

但有一个问题：**新 skill 的冷启动**。一个刚创建的 workspace skill，lastUsed 是 null 或 0，它在 L1 索引中排在最后。如果用户不说与它直接相关的话，它可能永远不会出现在 system prompt 中，于是 agent 永远不会知道它的存在，永远不会调用它，lastUsed 永远不会更新——这就是"冷启动陷阱"。

aptbot 的解决方式：新 skill 的 lastUsed 初始化为当前时间戳（而不是 0），让新 skill 有机会出现在 L1 索引顶部。这是一种"新人优先"策略——新 skill 在一段时间内获得曝光，如果确实被使用，lastUsed 会被后续的真实使用刷新；如果一直未被使用，会随着时间推移自然沉底。

### 4.5 read_file 特判更新 lastUsed

lastUsed 的更新机制有一个重要的特判：当 agent 通过 `read` 工具读取一个 skill 文件时，自动更新该 skill 的 lastUsed。

为什么需要特判？因为正常情况下，"使用 skill"意味着 agent 把 skill 正文加载到 context 中并据此行动。但 `read` 工具是一个通用文件读取工具——agent 可以用它读任何文件，包括 skill 文件。如果不做特判，会发生这样的场景：

1. agent 的 L1 索引中有 `debug-typescript` skill（description 在 system prompt 里）
2. agent 判断"这个场景可能需要 debug-typescript skill"
3. agent 调用 read 工具读取 `skills/debug-typescript.md` 的正文
4. 它读完了，理解了内容，据此行动——但 lastUsed 没有更新
5. 下次 L1 索引排序时，debug-typescript 的 lastUsed 还是旧的，可能被截掉

特判解决了这个问题：**read 工具在发现读取路径指向 skill 目录时，额外更新该 skill 的 lastUsed**。这样 agent 读取 skill 的行为被正确地记录为"使用了该 skill"，L1 索引能反映真实的使用模式。

这是一个很小的设计细节，但它体现了"行为信号补全语义信号"的思路。不是通过模型主动报告"我用了哪个 skill"来更新 lastUsed（这依赖模型是否诚实、是否准确），而是通过工具执行的副效应来自动更新——更可靠、更无感。

### 4.6 热重载联动

Skill 是一个频繁迭代的"知识库"。用户在编写 skill 时，可能写一句就试一次，改一句再试一次。如果每次修改都需要重启 aptbot，这个迭代体验会很痛苦。

aptbot 的 skill 系统支持热重载——用户修改了 workspace 下的 skill 文件，下一次 LLM 调用就能自动生效，不需要重启。

热重载的实现与 Config、Memory 的热重载模式一致：**mtimeNs 懒加载**。

具体流程：
1. 在每次 LLM 调用前，检查 skill 目录的最新 mtimeNs（文件修改时间，纳秒精度）
2. 如果 mtimeNs 与上一次扫描时不同，说明有文件变更
3. 重新扫描 skill 目录，重新构建 L1 索引
4. 更新缓存中的 mtimeNs

这个机制的好处是：
- **懒加载**：不浪费资源在"实时监控文件变更"上——只在需要时检查
- **零配置**：用户不需要手动触发"重新加载"命令
- **与现有架构一致**：mtimeNs 懒加载已经在配置系统和记忆系统中验证过，skill 系统复用同一模式

热重载让 skill 的编写体验接近于"即时反馈"——保存文件后，在下一句对话中就能验证新 skill 的效果。对于 skill 这种本质上是 prompt engineering 的工作，快速的试错周期至关重要。

## 五、发展方向

### 5.1 自演化 skill

当前 skill 是**静态的**——由人或项目编写，agent 按需加载。更远期的愿景是**自演化**：agent 在执行任务时，如果发现"这个任务的方法值得记下来"，自己写一个新的 skill 文件存到 workspace。

它的意义在于：agent 不只是"使用知识"，而且是"创造知识"。一个长期运行的 agent，会逐步积累一套属于自己的技能库，越来越适配用户的工作模式。

自演化 skill 的核心难点：

1. **质量控制**：agent 写的 skill 可能是噪音（"我尝试了 X 但失败了"不应该存成 skill）。需要某种过滤机制——可能由 LLM 自评、用户审核，或两者结合。
2. **冲突管理**：新 skill 与现有 skill 冲突（比如"如何运行测试"有两个版本）时如何处理？优先使用更新的？让用户选择？自动合并？
3. **可解释性**：用户需要能审计 agent 自建的 skill 内容，否则就是黑箱。"这个东西是谁写的、什么时候写的、基于什么经验"这些元数据需要保留。

自演化是 aptbot L3 路线上的长期目标，短期内不会实现。但两层加载、最小 frontmatter、热重载这些基础设施已经为它铺好了路——自演化 skill 本质上就是让 agent 调用工具在 workspace 目录下创建、更新 markdown 文件。

### 5.2 skill 市场的社区生态

内置 skill 目前由 aptbot 项目维护者编写。未来可以探索社区贡献的 skill 市场——用户可以把好的 workspace skill 分享出来，其他人一键安装到自己的内置层。

这样既保留了"开箱即用"（社区精选 skill 可以成为内置层的一部分），又解决了"用户自写 skill 的信息孤岛"问题。不过 skill 市场的运行机制（版本管理、质量审核、依赖管理）是一个完整的平台工程问题，不在 aptbot 当前 MVP 范围内。

### 5.3 更智能的注入策略

当前的 L1 索引是基于 lastUsed 的简单排序截断。未来可以做得更智能：

- **基于对话上下文的动态检索**：除了 lastUsed 排序，还可以根据当前对话的语义从 L2/L3 存储中检索相关 skill
- **分层的 token 预算**：不是所有 skill 都平分 4K token 预算，而是给"核心 skill"（如 debug、test、git）预留固定配额，剩余预算给长尾 skill 竞争
- **skill 间的关联推荐**：如果 agent 正在使用"调试 TypeScript" skill，自动提升"如何写测试" skill 的排序优先级

这些策略可以逐步叠加，不需要一次性改造整个系统。L1 索引的价值就在于它"足够简单，可以作为更复杂策略的基础"。

## 小结

Skills 系统是 agent 的"知识层"，与 tool 系统的"执行层"互补。这篇文章从三个角度拆解了技能系统的设计：

1. **概念层面**：skill 是"使用工具的知识"，不是工具本身。它回答的是"如何做"的问题，承载在 markdown 文档中。Skill 注入的核心矛盾是"知识越多，token 越贵"。

2. **方案对比**：方案 A（全部预置）开箱即用但不可定制；方案 B（全部自写）高度灵活但上手成本高；方案 C（两层加载 + 频率索引）通过 builtin + workspace 分层和 lastUsed 排序截断，在"开箱即用"、"可定制"、"token 成本"三个目标之间取得平衡。

3. **aptbot 的选择**：两层加载解决"通用 vs 特化"的矛盾（workspace 覆盖 builtin），最小 frontmatter 降低编写门槛（只需 name/description），L1 索引按 lastUsed 排序 + 4K 预算截断控制 token 成本，read_file 特判让使用行为准确反馈到索引，热重载赋予 skill 编写即时迭代的能力。

下一篇是本系列的第 7 篇文章，我们看 Hook 系统：8 个扩展点如何让 agent 行为可插拔。
