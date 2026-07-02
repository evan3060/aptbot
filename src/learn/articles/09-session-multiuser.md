---
slug: "09-session-multiuser"
title: "Session 与多用户：持久化、隔离、多端同步"
description: "从 session 管理的基本问题出发，对比三种持久化方案的设计取舍，深入 aptbot 的 JSONL + sidecar 存储、权限控制、两级缓存、多端同步的最终一致性模型与多用户租户隔离"
track: agent-practice
chapter: 核心特性深入篇
order: 9
difficulty: intermediate
estimatedReadingTime: 18
status: published
prerequisites:
  - 08-channel-transport
lastUpdated: "2026-07-02"
tags:
  - session
  - multi-user
  - persistence
  - cache
  - isolation
---

上一篇文章讲了 Channel——多端接入的抽象。Channel 解决的是"事件怎么传"的问题，但没解决"状态怎么管"的问题。

一个 agent 实例要同时服务多个用户：每个用户有多个 session（会话），每个 session 需要跨端切换、断线重连后恢复上下文、长期使用后积累历史——这些都是 Channel 管不了的。Channel 只负责传输，不负责存储和状态管理。

Session 系统就是填补这个空白的。它管理 session 的生命周期、存储 session 的历史数据、控制用户对 session 的访问权限、在多个客户端之间同步 session 的状态变化。可以把 Session 系统理解为 agent 的"状态持久化层"——它确保 agent 和用户之间的对话不会因为连接断开或进程重启而丢失。

这篇文章从 session 的基本概念讲起，对比三种持久化方案的取舍，然后深入看 aptbot 如何通过 JSONL + sidecar 存储、两级缓存、ownership 权限控制和多端同步机制来实现一个轻量但完整的 Session 系统。

## 一、概念：什么是 session，为什么需要 session 管理

### 1.1 session 的定义

在 agent 系统中，**session（会话）** 是用户与 agent 之间一次交互的完整记录。它包括：

- 对话历史：用户说了什么、agent 回复了什么
- 元数据：session 标题、创建时间、最后活动时间、owner、标签等
- 上下文状态：当前正在执行的任务、已经调用的工具、待处理的事项

一个 session 从创建开始，持续到用户显式关闭或系统因长期不活跃而回收。在此期间，用户可以随时断线重连，但 session 不会丢失——它被持久化到磁盘。

session 与"连接"的关系在上一篇文章中已经讨论过：session 独立于连接存在。多个连接可以绑定到同一个 session（多端同步），连接断了 session 还在（断线恢复）。

### 1.2 session 的职责边界

在一个 agent 系统中，session 承担了三层职责：

**存储层**：session 数据的持久化。磁盘上的文件、数据库中的表、内存中的缓存。决定了数据是否能在进程重启后存活。

**状态管理层**：session 的生命周期管理。创建、激活、暂停、恢复、关闭。控制 session 的完整生命周期。

**安全层**：session 的访问控制。谁可以创建 session、谁可以读取 session、谁可以删除 session。在多用户场景中，这一层确保用户 A 不能看到用户 B 的对话。

### 1.3 为什么 session 不能被 Channel 替代

一个常见的疑问：既然 Channel 是连接，session 也是连接，两者有什么不同？为什么不能合并？

关键区别在于职责：

- **Channel 是"传输"**：它是一条管道，负责把事件从服务端送到客户端。管道是易逝的——网络断开、客户端崩溃、用户刷新页面，管道就没了。
- **Session 是"记录"**：它是一份档案，存储着对话的所有信息。档案是持久的——即使所有管道都断了，档案还在，下次连接时重新打开。

用文件系统做类比：Channel 是文件描述符（打开文件时操作系统分配的一个编号，进程重启就没了），Session 是磁盘上的文件（进程重启后还在，重新打开就行）。

没有 session 层，Channel 断了之后，agent 的所有上下文就丢失了。有了 session 层，Channel 断了再重建一个，接回同一个 session，agent 继续干活。

## 二、通用设计方案：session 管理的三个核心维度

session 系统的设计可以从三个维度来分析。

### 2.1 持久化策略

Session 数据存哪里？这是最基础的设计决策。三种常见选择：

**纯内存**：session 数据只保存在进程内存中。读写最快（纳秒级），但进程重启后数据全部丢失。适合 session 不需要长期保留的场景。

**文件存储**：每个 session 保存为一个（或一组）文件。常见格式有 JSONL（每行一个 JSON 对象，append-only）、JSON（整个文件解析）、CSV。零依赖（只需要文件系统），但需要自己管理并发访问和一致性。

**嵌入式数据库**：SQLite 是最常见的选择。支持事务、索引、SQL 查询。功能完整，但需要额外的库依赖。二进制格式，不能直接用文本编辑器查看和调试。

### 2.2 多用户隔离

在单用户场景中，session 系统只需要管"存和取"。但多用户场景中必须回答：用户 A 能不能看到用户 B 的 session？

三种常见的隔离策略：

**目录隔离**：每个用户的 session 文件放在各自的目录中。比如 `sessions/userA/` 和 `sessions/userB/`。通过文件系统的路径来控制访问。简单但粒度粗糙——如果路径遍历防护没做好，可能越权访问。

**字段隔离**：所有 session 存在同一个存储中，每个 session 记录带一个 `owner` 字段。读取时按 `owner` 过滤。更灵活——可以支持 session 共享（设置 `owner` 为特定值表示"共享"），但需要查询层支持按 owner 过滤。

**租户隔离**：完全独立的存储实例。用户 A 用 SQLite 文件 A，用户 B 用 SQLite 文件 B。隔离最强（一个用户的数据损坏不影响另一个用户），但管理成本高（每个用户一个文件）。

### 2.3 客户端同步

在多端接入场景中，session 的状态变化需要同步给所有连接的客户端。同步策略的核心问题是：**谁负责保证客户端看到的是最新状态？**

**最终一致性**：服务端通知客户端"状态变了"，客户端自己在需要时重新拉取完整状态。优点是服务端不需要追踪"每个客户端看到了哪个版本"，实现简单。缺点是客户端可能在一段时间内看到旧状态。

**强一致性**：服务端维护每个客户端的状态版本号，确保每个客户端推送的数据包含了到该客户端最新版本为止的所有变化。优点是客户端始终看到最新状态，缺点是实现复杂——服务端需要追踪每个客户端的状态。

**客户端拉取（pull）**：客户端定期主动拉取最新状态。最简单，但延迟高（需要等下一个拉取周期）。

**服务端推送（push）**：服务端在状态变化时主动推送给客户端。延迟低，但需要建立长连接或使用 webhook。

实践中，大多数 agent 系统选择**最终一致性 + 服务端推送**的组合——服务端主动推送变更通知，但不保证推送的完整性；客户端收到通知后拉取最新状态补齐。

## 三、市面其他 session 管理方案对比

不同项目对 session 管理的实现差异很大，尤其在"存哪里"和"怎么存"这两个问题上。以下是三种有代表性的路线。

### 3.1 方案 A：纯内存 session，无持久化

这条路线的做法最简单：session 数据完全保存在进程内存中。一个 Map<sessionId, Session> 就是整个 session 存储系统。进程退出，session 全部消失。

**设计特点：**

- **内存存储**：session 存在 Map 或类似的数据结构中。读写速度极快（纳秒级）。
- **无磁盘写入**：不需要文件 I/O，不需要数据库，不需要序列化。实现代码不到 50 行。
- **进程生命周期绑定**：session 的生命周期等于进程的生命周期。进程重启意味着所有 session 丢失。

**优势：**

- **性能最好**——纯内存操作，没有磁盘 I/O，没有序列化/反序列化开销。对于 session 读写频繁的场景（每秒数百次），方案 A 是唯一能扛住的选择
- **实现最简单**——一个 Map、几个方法，20-50 行代码搞定 session 管理
- **没有文件锁、并发写入等问题**——不需要担心多个进程同时写同一个 session 文件

**劣势：**

- **进程重启即丢失**——这是最致命的问题。部署更新、服务器维护、意外崩溃，都会导致所有 session 丢失。用户正在进行的对话中断，历史记录不可恢复。
- **无法支持长期 session**——session 的有效期不能超过进程的运行时间。生产环境中进程单次运行时间可能是几天或几周，但用户期望 session 能保持数月甚至数年。
- **内存泄漏风险**——session 只增不删时，内存持续增长。如果某个用户创建了大量 session 而不关闭，Map 里的条目越来越多，最终 OOM。

**适用场景：** 开发调试环境（"重启就丢"是可以接受的）、短连接服务（session 生命周期在秒/分钟级别）、不需要持久化的 demo 项目。

### 3.2 方案 B：SQLite session 存储

这条路线的做法是使用 SQLite 作为 session 的持久化存储。每个 session 是 SQLite 表中的一行，对话历史可能存储在另一张关联表中。

**设计特点：**

- **关系型存储**：使用 SQLite 的表结构管理 session 数据。一张表存 session 元数据（id、title、owner、createdAt 等），一张表存对话历史（sessionId、role、content、timestamp 等）。
- **SQL 查询**：可以用 SQL 做复杂查询——"查找用户 A 所有标签包含 'bug' 的 session，按最后活动时间降序排列"。这是纯内存方案做不到的。
- **事务支持**：SQLite 支持 ACID 事务。写入 session 数据时，要么全写成功，要么全写失败，不会出现半写状态。
- **单文件**：整个 session 库是一个文件（`sessions.db`），迁移、备份、复制都非常简单。

**优势：**

- 功能完整——SQL 查询、事务、索引、全文搜索，该有的数据库功能都有
- 成熟稳定——SQLite 是经过几十年考验的嵌入式数据库，bug 少、兼容性好
- 查询灵活——按任意字段排序、过滤、聚合，不需要自己实现
- 数据一致性高——事务保证写入的原子性，不需要担心文件半写

**劣势：**

- **二进制不可读**：SQLite 文件是二进制格式。你想用 `tail -f` 实时查看最新的对话内容？做不到。调试时需要额外工具（sqlite3 CLI 或数据库浏览器）。对于经常需要调试 agent 行为的学习项目来说，这是一个显著的痛点——开发者最自然的行为是 `cat` 一个文件看看里面有什么，但 SQLite 文件 cat 出来是乱码。
- **写入放大**：对话历史是 append-only 的（只增不改）。但 SQLite 的行存储和 B-tree 结构在大量 append 场景下可能产生写放大——更新一个 B-tree 页可能导致整个页的重写。
- **并发写入限制**：SQLite 是单 writer 的。多个客户端同时往同一条 session 追加历史时，需要排队。虽然对于个人使用的 agent 来说这不是问题，但在极端情况下（如高强度并发写入）可能成为瓶颈。

**适用场景：** 功能完整的生产项目、需要 SQL 查询 session 数据的场景、团队协作的 agent 服务。

### 3.3 方案 C：JSONL append-only + sidecar

这条路线的做法结合了文件系统的两种模式：主文件用 JSONL 格式（每行一个 JSON 对象，只追加不修改）存对话历史，sidecar 文件用 JSON 格式（每次修改整个文件）存元数据。

**设计特点：**

- **JSONL 主文件**：`<sessionId>.jsonl`，每行是一个 JSON 序列化的 SessionEntry。追加新行时不用解析整个文件，直接 `fs.appendFile`。性能好，实现简单。
- **JSON sidecar**：`<sessionId>.meta.json`，存储 session 的元数据（标题、owner、标签、创建时间等）。元数据会频繁修改（用户改标题、加标签），用 JSON 格式每次修改时整个文件重写。
- **两种工作负载分离**：对话历史是 append-heavy（只增不删不改），元数据是 random-access（频繁修改）。用两种文件格式分别应对两种工作负载，避免"为了改一个字段重写整个会话历史"的浪费。

**优势：**

- **纯文本可读**：JSONL 和 JSON 都是纯文本格式。开发时 `tail -f session.jsonl` 就能实时看到最新对话，`cat session.meta.json` 就能看到 session 元数据。对调试和排错的帮助极大——不需要任何额外工具。
- **零依赖**：只需要文件系统，不需要 SQLite 库、不需要数据库驱动。这对于一个学习项目来说意义重大——减少了一个依赖，就减少了一个可能出错的环节。
- **语义化文件命名**：`<uuid>.jsonl` 和 `<uuid>.meta.json` 一目了然。不需要记住 SQL 表结构，文件系统就是"数据库"。
- **备份和迁移简单**：cp 命令就是备份，rsync 就是迁移。不用关心 SQLite 的 WAL 文件、journal 文件等额外状态。

**劣势：**

- 不支持复杂查询——想"查找所有含 'bug' 标签的 session"，需要遍历所有 meta 文件自己解析。没有 SQL 的 WHERE 和 JOIN。
- 并发写入需要文件锁——多个进程同时 append 同一个 jsonl 文件时可能会交叉写入。需要外部队列或锁机制。
- 文件数量多——每个 session 两个文件。如果有 10000 个 session，就是 20000 个文件。文件系统对目录下的文件数量有限制（虽然现代文件系统的限制很高，但心理上 20000 个文件会让一些人不适）。

**适用场景：** 学习项目（可读性优先）、个人使用的 agent（不需要复杂查询）、对零依赖有要求的场景。

### 3.4 三种方案对比

| 维度 | 方案 A（纯内存） | 方案 B（SQLite） | 方案 C（JSONL + sidecar） |
|---|---|---|---|
| 性能 | 最高（纳秒级） | 中（毫秒级，有序列化） | 中（毫秒级，有 I/O） |
| 可读性 | N/A | 差（二进制） | 好（纯文本，可 tail） |
| 功能完整度 | 低（无查询、无事务） | 高（SQL、事务、索引） | 中（无事务、无复杂查询） |
| 依赖 | 零 | 需 SQLite 库 | 零 |
| 进程重启 | 丢失所有数据 | 保留 | 保留 |
| 查询能力 | 无（只能遍历） | 强（SQL） | 弱（需自行解析过滤） |
| 调试友好度 | 中（需日志） | 差（需额外工具） | 高（cat/tail/grep） |
| 复杂度 | 低（几十行代码） | 中（ORM 或 SQL） | 中（文件管理） |

三条路线的选择本质上是"功能完整"、"调试友好"、"实现简单"三者之间的三角权衡。方案 A 为了简单牺牲了所有持久化，方案 B 为了功能完整牺牲了可读性，方案 C 为了可读性和零依赖牺牲了查询能力。

## 四、aptbot 的设计特点

aptbot 选择了**方案 C——JSONL append-only + sidecar**。这个选择与项目的"学习型"定位高度一致：纯文本可读让开发者能直接查看和调试 session 数据，零依赖让项目更容易上手，JSONL 的简单性让新手也能理解"数据是怎么存下来的"。

### 4.1 JSONL 主文件 + .meta.json sidecar：两种工作负载分离

每个 session 在磁盘上是两个文件：

```
sessions/
  ├── 550e8400-e29b-41d4-a716-446655440000.jsonl      # 对话历史
  ├── 550e8400-e29b-41d4-a716-446655440000.meta.json   # 会话元数据
  ├── 6ba7b810-9dad-11d1-80b4-00c04fd430c8.jsonl
  ├── 6ba7b810-9dad-11d1-80b4-00c04fd430c8.meta.json
  └── ...
```

**.jsonl（对话历史）**：append-only 文件。每次 agent 和用户交换一条消息，就在文件末尾追加一行 JSON。这种格式的特点：

- Append-only 意味着写入性能好——不需要读旧数据，不需要解析，只在文件末尾追加。文件系统对 append 操作有专门优化。
- 文件中行的顺序就是对话的时序——第 1 行是最早的消息，第 100 行是最新的消息。按行号定位比按时间戳更简单。
- JSONL 支持流式读取——想读最新的 10 条消息？倒着读最后 10 行就行。不需要解析把整个文件加载到内存。

**.meta.json（会话元数据）**：单对象 JSON 文件。存储 session 的标题、创建时间、最后活动时间、owner 用户 ID、标签列表、label 等元数据。

元数据和对话历史分开的原因：**两种工作负载的性质不同**。

对话历史是"只增不改"（除了极少数情况下的 compaction）。用 JSONL append-only 最合适——每次追加一行，CPU 和 I/O 开销都最小。

元数据是"频繁修改"——用户可能改标题、加标签、标星标、换 owner。如果用 JSONL 存元数据，每次修改都要追加一行，读元数据时要从末尾往回扫描找到最后一个有效行——冗长且容易出错。用一个单独的文件存元数据，每次修改整个文件重写，简单可靠。元数据通常只有几百字节，重写一次的成本几乎可以忽略。

这种"主文件 append + sidecar 随机改"的组合是文件系统存储中的常见模式。它避免了"为了改一个字段重写整个会话历史"的浪费，也避免了"为了读一条元数据扫描整个文件"的愚蠢。

### 4.2 UUID v4 sessionId 路径校验

sessionId 采用 UUID v4 格式（如 `550e8400-e29b-41d4-a716-446655440000`）。所有涉及 session 文件路径的操作，第一步都是**校验 sessionId 是否是合法 UUID**。

为什么需要校验？因为 sessionId 直接出现在文件路径中：`sessions/${sessionId}.jsonl`。如果 sessionId 来自外部输入（比如用户通过 API 传进来），且不做校验，攻击者可以传一个 `../../etc/passwd` 作为 sessionId，让系统读写系统文件。这就是"路径遍历攻击"。

UUID 校验直接从源头杜绝这个问题：UUID v4 的格式是固定的（8-4-4-4-12 的 16 进制字符 + 连字符），任何不匹配这个格式的输入都被拒绝。不存在"绕过"的可能——因为连字符的位置都是固定的，攻击者无法构造一个包含 `../` 的字符串同时满足 UUID 格式。

除了安全原因，UUID v4 还有几个附带好处：

- **全局唯一**：不需要中心化的 ID 分配器。每台机器各自生成 UUID，不会冲突。即使多台机器各自运行 aptbot 实例，它们的 sessionId 也不会冲突。
- **不可猜测**：122 位随机性。攻击者无法枚举可能的 sessionId 来获取其他人的 session。这对于多用户场景的安全隔离很重要。
- **格式固定**：36 个字符（含 4 个连字符）。正则表达式校验简单高效：`/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i`。

校验的实现位置在 Session 系统的入口——任何接受 `sessionId` 参数的公开方法（`getSession`、`appendEntry`、`claimSession` 等）都会先调 `isValidUUID(sessionId)`。校验失败立即返回错误，不做任何文件操作。

### 4.3 claimSession 严格 ownership + forceClaimSession 共享转移

session 有"owner"（拥有者）的概念——只有创建 session 的用户能操作它。这是多用户隔离的基础。

`claimSession(sessionId, user)` 的逻辑：

- 如果 session 还没有 owner：当前 user 成为 owner，操作成功
- 如果 session 的 owner 就是当前 user：操作成功
- 如果 session 有 owner 且不是当前 user：返回 403 Forbidden

这是**严格 ownership**。用户 A 不能操作用户 B 的 session。每个 session 是"私有"的，默认不共享。

严格 ownership 在多用户场景中的意义：假设两个开发者共用一台 VPS 跑 aptbot，开发者 A 的 session 里包含了敏感的项目代码片段和 API key。如果 session 没有 owner 隔离，开发者 B 可以随意读取 A 的 session——这就是隐私泄露。严格 ownership 保证了"你的 session 是你的，我的 session 是我的"。

但有些场景需要"共享转移"——比如团队中的开发者 A 休假了，开发者 B 需要接手 A 的任务。此时 B 需要能看到 A 的 session。或者 A 离职了，管理员需要把 A 的所有 session 重新分配给 B。

`forceClaimSession` 提供了这个能力：有管理员权限的用户可以强制把 session 的 owner 改成另一个用户。这是一个"打破规则"的接口，不是常规操作。

这种"严格规则 + 例外机制"的设计在安全领域很常见：默认情况下规则是最严格的（谁都不能看别人的 session），但提供了一条显式的、需要特权的"后门"来处理特殊情况（管理员可以进行 session 转移）。这让系统在大多数时候保持安全，在少数需要灵活的场合也不阻塞。

### 4.4 per-sessionKey ring buffer（1000）+ 全局 LRU（50000）

session 历史回放是性能热点——客户端重连时需要拿到完整的历史来渲染对话界面。如果每次都从磁盘 JSONL 读取，IO 延迟会明显拖慢重连速度。

aptbot 用**两级缓存**来解决这个问题：

**第一级——per-sessionKey ring buffer（环形缓冲区，1000 条）**：每个 sessionKey（用户 + session 的唯一标识）维护一个环形缓冲区，存储最近 1000 条事件。

环形缓冲区的工作原理：它本质上是一个固定大小的数组 + 两个指针（写指针和读指针）。写入新事件时覆盖最旧的事件。读事件时从最旧的事件开始顺序读出。

为什么是环形缓冲区而不是普通的数组？因为：

- 写入是 O(1)——不需要移动元素，只需要移动写指针
- 内存占用固定——最多 1000 个槽位，不会增长
- 适配"最近 N 条"的语义——环形缓冲区天然就是"保留最近 N 条丢弃旧的"

**第二级——全局 LRU（Least Recently Used，50000 条）**：所有 session 的 ring buffer 加起来不能超过 50000 条。当总量超过限制时，淘汰最久未访问的 session 的整个 ring buffer（不是逐条淘汰，是按 session 淘汰）。

为什么两层而不是一层？

- **ring buffer 适配单 session 局部性**：用户操作当前 session 时，反复读最近 N 条事件。ring buffer 命中率极高——几乎所有"查看历史"的请求都在 ring buffer 内完成，不需要走磁盘。
- **LRU 适配多 session 切换**：用户在多个 session 间来回切换（比如上午在"bug-fix-X" session 里调试，下午在"feature-Y" session 里开发），LRU 保证"最近活跃的 session 缓存常驻"，不活跃的 session 缓存被淘汰释放内存。
- **内存上限可控**：50000 条事件 × 平均 1KB/条 ≈ 50MB。在个人开发机器上，50MB 内存占用完全可以接受。如果用户有 100 个活跃 session，每个保留 500 条，正好在 50000 条的限制内。

这里有一个值得注意的类比：**CPU 的 L1/L2/L3 缓存架构**。

- L1 缓存（per-core，最快最小）≈ per-sessionKey ring buffer——专属于"当前正在操作的 session"，速度最快（内存访问 vs 磁盘访问）
- L2 缓存（per-core，中速中等）≈ 全局 LRU——跨 session 共享，容量更大
- L3 缓存（shared，较慢但大）≈ 无（aptbot 没有第三级，直接到 JSONL）
- 主存（最慢最大）≈ JSONL 磁盘文件

这个类比有助于理解两个关键设计：

1. **per-session ring buffer 的容量为什么是 1000**？因为多数 session 不超过 1000 条事件。ring buffer 能直接覆盖整个 session——绝大多数"查看历史"的请求都能命中 ring buffer，不需要走磁盘。1000 是经验值，来自对实际使用模式的观察。
2. **LRU 为什么按 session 淘汰而不是按条淘汰**？因为淘汰单条事件对"历史回放"没有意义——客户端重连时需要的是完整的 session 历史，不是零散的事件。如果 LRU 按条淘汰，最坏情况下一个 session 的事件被逐条淘汰了一部分，客户端重连时即使命中 ring buffer，也只能拿到残缺的历史，最后还是得走 JSONL 兜底。按 session 淘汰保证：要么整个 session 的 ring buffer 都在，要么都不在。没有"半在"的状态。

### 4.5 历史回放：ring buffer 未命中 → JSONL 兜底

客户端重连时，需要回放 session 的历史。回放的完整路径：

1. 客户端发重连请求，带上 sessionId 和需要回放的时间范围（或条数范围）
2. 检查该 sessionId 对应的 ring buffer 是否覆盖请求的范围
3. **快路径（ring buffer 覆盖）**：直接从 ring buffer 中读取事件，构造事件序列返回。O(N) 时间复杂度（N = 返回的事件条数），纯内存操作，通常在微秒级别。
4. **慢路径（ring buffer 不覆盖）**：打开 JSONL 文件，从文件末尾倒序读取，按时间范围过滤，构造事件序列返回。O(M) 时间复杂度（M = 文件的无效行数 + N），涉及磁盘 I/O，通常在毫秒级别。

快路径覆盖了绝大多数请求——用户在 session 内正常操作时，所有事件都在 ring buffer 中，客户端刷新页面或重连后，历史回放在微秒级别完成，用户感觉不到延迟。

慢路径只发生在少数边缘场景：用户隔了很久（一周甚至一个月）重新打开一个 session，期间这个 session 的 ring buffer 已经被 LRU 淘汰了。这时才需要从 JSONL 磁盘读取。虽然慢（相比内存），但仍然是可接受的（相比重新没有 session 系统）。

这个"快路径 + 慢路径"的设计模式在计算机系统中无处不在。CPU 有缓存（快）→ 主存（慢），操作系统有内存（快）→ 磁盘（慢），aptbot 的 session 系统也是一样——ring buffer（快）→ JSONL（慢）。每一层都在做同一件事：用更快的存储为更慢的存储做缓存，期望大多数请求在更快的层命中。

### 4.6 presence 广播

"presence"是即时通讯应用里的常见功能——显示"用户在线/离线"的状态。在多用户 aptbot 场景中，presence 的意思是：用户 A 能看到当前还有谁在同一个 session 上"在线"。

实现方式是通过事件广播：

- 当用户绑定 channel 到 session 时，系统发出 `presence_online` 事件，包含用户信息
- 当 channel 死亡（用户断开连接、页面关闭、网络中断）时，系统发出 `presence_offline` 事件
- 所有绑定了该 session 的 channel 收到 `presence_online` / `presence_offline` 事件，前端据此展示在线用户列表

presence 让"多端协作"成为可能——不仅仅是"多端同步看"，而是"多端一起用"。想象一个场景：你和同事共用一个 session，agent 在中间执行任务。你能看到同事在线，看到他刚发了什么消息，看到他正在看哪个工具的输出。agent 的执行结果实时推送给两个人——你们像在同一个房间里一起看着 agent 工作。

对于个人使用，presence 的意义在于"设备切换的感知"——你在手机上打开 session，看到"电脑端在线"的提示，就知道电脑上 session 还在活动，agent 可能正在执行一个长时间的任务，你不需要在手机上重新操作。

### 4.7 session_changed 控制消息 + 客户端拉取

session 状态会变化——另一端发了一条新消息、agent 正在执行工具、compaction 删除了旧数据、元数据被修改了。这些变化需要通知所有连接的客户端。

`session_changed` 是一个轻量控制消息，它只包含：

```typescript
interface SessionChangedMessage {
  type: 'session_changed';
  sessionId: string;
  changeType: 'new_entry' | 'meta_updated' | 'compaction' | 'status_change';
}
```

不包含具体的变化内容。客户端收到 `session_changed` 后，自己决定是否需要重新拉取完整状态。

为什么只发通知不发完整内容？三个原因：

1. **节省带宽**：变化可能很大——一次 compaction 可能删了数百条历史记录。如果完整内容推送给所有客户端，带宽浪费严重。通知只有几十字节，比推送完整内容便宜得多。
2. **去重**：多个变化可能在短时间内连续发生——agent 同时输出多个 token，每个 token 一个事件，如果每个都推送"新内容"，客户端一秒收到几十次推送，疲于处理。通知 + 拉取的模式让客户端可以"等变化稳定了再拉一次"，而不是每一次变化都响应。
3. **容错**：服务端推送完整内容时，如果客户端漏接了一个推送（比如网络丢包），客户端就永久丢失了这个变化。但在通知 + 拉取模式下，客户端漏接一个 `session_changed` 只是延迟了拉取的时间，下次拉取时一次性补齐所有遗漏的变化。

这种模式的术语叫"**最终一致性**"——不保证客户端在任何时刻都看到最新状态，但保证客户端在主动拉取后一定能看到最新状态。通知只是"提醒你该拉取了"，不承担"确保你看到最新"的责任。

最终一致性与 WebSocket 重连天然兼容：客户端重连后，第一件事就是主动拉取 session 的完整状态，不需要服务端追踪"这个客户端在断线期间错过了哪些事件"。服务端不需要维护每个客户端的状态版本号——只需要在收到拉取请求时返回当前完整状态即可。

### 4.8 多用户隔离：UserStorage + scrypt + Bearer token

多用户场景下，"谁能访问哪些 session"是核心安全问题。aptbot 的多用户隔离体系包含三个组件：

**UserStorage（用户存储）**：一个文件存储，记录用户的 `username`、`passwordHash`、`userId` 和其他属性。UserStorage 不和 SessionStorage 混在一起——用户数据和 session 数据放在不同的目录，有不同的访问策略。

**scrypt 密码哈希**：用户的密码在存储前用 scrypt 算法哈希。scrypt 是一种**内存硬**（memory-hard）的哈希算法——它不仅需要 CPU 计算，还需要大量内存。这让暴力破解变得极其昂贵：攻击者即使拿到了哈希值的副本，要破解每个密码也需要 GB 级别的内存和大量的计算时间。

相较于 bcrypt（另一种常见的选择），scrypt 的抗 ASIC 攻击能力更强。ASIC（专用集成电路）攻击者可以定制芯片来并行计算 bcrypt，但 scrypt 的内存要求让这种并行化变得困难——每个并行计算实例都需要独立的大块内存，芯片面积和成本急剧上升。对于 aptbot 这种项目的规模来说，bcrypt 其实也够用，但选择 scrypt 体现了"安全设计上不留妥协"的态度。

**Bearer token 鉴权**：用户登录成功后，服务端签发一个 Bearer token。后续所有 API 请求都带上这个 token。每个 token 绑定一个 userId，服务端从 token 中解析 userId 来鉴权。

Token 有过期时间（默认 24 小时）。过期的 token 被拒绝，用户需要重新登录。这是一个安全工程中的标准设计：限制 token 的有效期，降低 token 泄露后的风险窗口。

**session ownership 校验**：这是前面讲的 claimSession 机制的底层支撑。用户访问任意 session 时，系统校验：

1. 请求中的 Bearer token 是否有效 → 解析出 userId
2. 被请求的 session 的 owner 字段是否等于该 userId（或 userId 是否有管理员权限）
3. 校验通过 → 允许访问；校验失败 → 返回 403

这三个组件一起构成了一个完整的多用户隔离体系。用户数据（UserStorage）和会话数据（SessionStorage）分开存储，密码用强哈希保护，API 访问用 Bearer token 鉴权，session 访问用 ownership 校验。

这套体系让 aptbot 可以在共享 VPS 上安全运行——多个用户共用一个 aptbot 进程，但彼此的 session 完全隔离。用户 A 不能看到用户 B 的 session，用户 B 不能操作用户 A 的工具，每个用户都感觉自己在"独享"这个 agent。

### 4.9 CLI 命令：session 成为可组织的工作单元

Session 系统不仅是一套存储和权限机制，它还通过 CLI 命令让 session 成为用户可组织、可管理的工作单元。

aptbot CLI 提供了以下 session 管理命令：

**`/sessions`**：列出当前用户的所有 session。返回列表包含每个 session 的 ID、标题、最后活动时间、是否活跃等信息。这是用户"查看我的所有会话"的入口。

**`/resume <sessionId>`**：恢复一个历史 session，把它绑定到当前 channel。用户在多个设备间切换时，用 `/resume` 带上之前在电脑上看到的 sessionId，手机上就能接续对话。

**`/label <sessionId> <text>`**：给 session 加一个文本标签。比如 `/label 550e... "bug-fix-X"`。标签是用户组织 session 的主要方式——按项目、按任务、按优先级给 session 打标。

**`/session <key> <value>`**：设置 session 的动态属性。比如 `/session project monorepo-frontend` 在 session 中注入一条"当前 session 关联的项目是 monorepo-frontend"。agent 和 hook 可以读取这些动态属性来做上下文相关的决策。

**`/session`（无参数）**：查看当前 session 的所有动态属性。

这些命令的价值随着用户使用 aptbot 时间的增长而增加。长期使用一个 agent 的用户会积累几十甚至上百个 session——如果不加组织，session 列表就是一个杂乱无章的"按时间排列的对话记录"。有了 `/label` 和 `/session`，session 变成了"按主题组织的项目单元"——"所有打上 `bug-fix` 标签的 session"、"所有 project 属性为 `monorepo-frontend` 的 session"。

CLI 命令将 session 从"自动管理的存储单元"提升为"用户可操作的工作单元"。这不仅仅是 UX 的改进——它让用户能够主动管理自己与 agent 的交互记录，把 agent 从"用完即走的工具"变成"有记忆的长期协作伙伴"。

![Session 系统架构](/learn/articles/images/session-system.png)

## 五、发展方向

### 5.1 存储后端可替换

当前 aptbot 的 session 存储固定使用 JSONL + sidecar 文件。长远来看，可以抽象一个 `SessionStorage` 接口，支持多种后端实现：

- **FileSessionStorage**（当前默认）：JSONL + sidecar，零依赖，可读性好
- **SQLiteSessionStorage**：功能完整，支持复杂查询
- **MemorySessionStorage**：纯内存，性能最好，适合测试和临时场景

用户可以根据自己的需求选择后端——开发调试时用 FileSessionStorage（可读性好），生产部署时用 SQLiteSessionStorage（功能完整）。`SessionStorage` 接口的存在让这种切换不侵入 session 的业务逻辑。

### 5.2 session 共享与协作

当前的 claimSession/forceClaimSession 提供了最基础的共享能力（管理员强制转移）。未来可以支持更丰富的共享模式：

- **只读共享**：用户 A 可以把 session 共享给用户 B，但 B 只能看不能操作
- **协作共享**：多个用户可以同时操作同一个 session，所有操作实时同步给所有参与者
- **链接共享**：生成一个带过期时间的共享链接，任何人都可以通过链接访问 session（类似 Google Docs 的"任何知道链接的人都可以查看"）

共享和协作是 agent 从"个人工具"走向"团队工具"的关键能力。但它的前提是安全模型足够成熟——在支持共享之前，必须先确保隔离是可靠的。

### 5.3 session 的自动归档与压缩

长期使用的 session 文件会不断增长。一个 session 经过数百轮对话后，JSONL 文件可能有数万行。虽然 JSONL 是 append-only，但很多早期的对话内容已经不再需要了。

自动归档策略可以是：定期扫描超过一定时间未活跃的 session，把最早的 N% 的对话历史压缩成一个摘要（由 LLM 生成），用摘要替换原始内容。这样 session 文件的大小增长是亚线性的——新对话不断追加，旧对话被压缩成摘要后体积大幅缩小。

这个过程类似人类的记忆——"新事记得清楚，旧事只留印象"。它也是方案 B（SQLite）和方案 C（JSONL）都需要的——无论用什么存储，无限增长的历史都需要管理。

## 小结

Session 系统是 agent 状态管理的核心，在 Channel 之上提供了持久化、隔离和同步三层能力。

1. **概念层面**：session 是用户与 agent 之间一次交互的完整记录，独立于连接存在。它承担了存储层、状态管理层和安全层三层职责，不能被 Channel 替代——Channel 是管道，session 是档案。

2. **方案对比**：方案 A（纯内存）性能最好但进程重启即丢失；方案 B（SQLite）功能完整但二进制不可读，无法用 tail 调试；方案 C（JSONL append-only + sidecar）零依赖、纯文本可读，适合学习项目的规模。

3. **aptbot 的设计**：JSONL + sidecar 分离对话历史（append-only）和元数据（随机读写）两种工作负载；UUID v4 sessionId 从源头杜绝路径遍历攻击；claimSession/forceClaimSession 平衡严格权限与灵活转移；per-sessionKey ring buffer（1000 条）+ 全局 LRU（50000 条）的两级缓存通过类比 CPU L1/L2 缓存来理解；presence 广播让多端协作可见；session_changed + 客户端拉取用最终一致性简化同步模型；UserStorage + scrypt + Bearer token 构建完整的多用户租户隔离；CLI 命令让 session 从存储单元变为可组织的工作单元。

下一篇文章看 aptbot 的整体安全模型，把这些散落的安全设计点——UUID 校验、沙箱、hook 信任边界、scrypt、Bearer token——串起来，理解 aptbot 如何在开放和可控之间找到平衡。
