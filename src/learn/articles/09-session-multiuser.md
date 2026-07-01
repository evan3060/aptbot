---
slug: "09-session-multiuser"
title: "Session 与多用户：持久化、隔离、多端同步"
description: "JSONL session 存储 + .meta.json sidecar、UUID 校验、claimSession/forceClaimSession、per-sessionKey ring buffer + 全局 LRU、历史回放、presence、session_changed、多用户隔离"
track: agent-practice
chapter: 核心特性深入篇
order: 9
difficulty: intermediate
estimatedReadingTime: 11
status: published
prerequisites:
  - 08-channel-transport
lastUpdated: "2026-07-01"
tags:
  - session
  - multi-user
  - persistence
  - isolation
---

# Session 与多用户：持久化、隔离、多端同步

上一篇文章讲了 Channel——多端接入的抽象。但 Channel 只解决"事件怎么传"，没解决"状态怎么管"。一个 agent 实例要同时服务多个用户、每个用户有多个会话、每个会话能跨端切换，这需要 Session 系统在 Channel 之上做状态管理。这篇文章拆解 Session 系统的设计。

## JSONL session 存储 + .meta.json sidecar

每个 session 在磁盘上是两个文件：

- `<sessionId>.jsonl`：会话历史，按行 append SessionEntry（与 Memory 系统共用格式）
- `<sessionId>.meta.json`：会话元数据 sidecar，记录标题、创建时间、owner、标签等

为什么拆两个文件？

**.jsonl 适合 append**：会话历史是只增不改（除了 Compaction），JSONL append-only 性能最好。但 JSONL 不适合频繁改某个字段——改 meta 要重写整个文件。

**.meta.json 适合随机读写**：元数据会改（用户改标题、加标签、标星标），用单对象 JSON 文件改一次重写一次，简单可靠。元数据小（几百字节），重写成本低。

这种"主文件 append + sidecar 随机改"的组合，是文件系统存储的常见模式。它避免了"为了改一个元数据字段重写整个会话历史"的浪费，也避免了"为了 append 一行历史读整个文件解析再写回"的开销。

## UUID sessionId 路径校验

sessionId 是 UUID v4 格式（如 `550e8400-e29b-41d4-a716-446655440000`）。所有涉及 session 文件的操作都先校验 sessionId 是合法 UUID。

这是路径遍历防护的具体应用。如果 sessionId 可以是任意字符串，攻击者（或 agent 自己的"探索"）可能传 `../../etc/passwd` 作为 sessionId，让 aptbot 读写系统文件。UUID 校验直接拒绝任何非 UUID 格式的输入，从源头杜绝这类攻击。

UUID v4 还有几个好处：

- **全局唯一**：不需要中心化分配，每台机器各自生成不冲突
- **不可猜测**：随机性强，攻击者不能枚举别人的 sessionId
- **格式固定**：36 字符（含 4 个连字符），易于正则校验

## claimSession 严格 ownership + forceClaimSession 共享转移

session 有"owner"概念——只有创建 session 的用户能操作它。这是多用户隔离的基础。

`claimSession(sessionId, user)` 的逻辑：

- 如果 session 无 owner：当前 user 成为 owner
- 如果 session 已被当前 user 拥有：返回成功
- 如果 session 被其他 user 拥有：返回 403 Forbidden

这是严格 ownership，防止用户 A 操作用户 B 的 session。但有些场景需要"共享转移"——比如用户 A 把一个 session 移交给用户 B，或者用户 A 离职后管理员把 session 重新分配。

`forceClaimSession` 提供这个能力：管理员（或拥有特定权限的用户）可以强制把 session 的 owner 改成另一个用户。这是"严格规则 + 例外机制"的常见设计——默认严格，需要时显式打破。

## per-sessionKey ring buffer（1000）+ 全局 LRU（50000）

session 历史回放是性能热点——用户重连时，前端要拿到完整历史。从磁盘 JSONL 读每次都太慢，aptbot 用两层缓存：

**per-sessionKey ring buffer（1000 条）**：每个 sessionKey（用户+session 标识）维护一个环形缓冲区，存最近 1000 条事件。读历史优先从 ring buffer 读，O(1) 时间。

**全局 LRU（50000 条）**：所有 session 的 ring buffer 加起来上限 50000 条，超过 LRU 淘汰最久未访问的 session 的整个 ring buffer。

为什么两层？

- **ring buffer 适配单 session 局部性**：用户操作当前 session 时，反复读最近 N 条事件，ring buffer 命中率高
- **LRU 适配多 session 切换**：用户在多个 session 间切换，LRU 保证"最近活跃的 session 缓存常驻"
- **内存上限可控**：50000 条事件 × 平均 1KB = 50MB，是可接受的内存占用

ring buffer 容量 1000 是经验值。多数 session 不超过 1000 条事件，ring buffer 能装下整个 session。超过的（超长 session）需要 fall back 到 JSONL，但这是少数。

## 历史回放（ring buffer 未命中 → JSONL 兜底）

客户端重连时，aptbot 给它回放当前 session 的历史。回放策略：

1. 检查 ring buffer 是否覆盖请求的时间范围
2. 覆盖：直接从 ring buffer 读，构造事件序列返回
3. 不覆盖：从 JSONL 文件读，按时间范围过滤

JSONL 兜底是慢路径——需要打开文件、增量流式解析、过滤。但只在 ring buffer 不够时触发，多数请求命中 ring buffer。

这个"快路径 + 慢路径"的设计模式与 CPU 缓存一致——L1/L2/L3 cache 各自适配不同访问模式，最慢的 DRAM 兜底。aptbot 的 ring buffer + LRU + JSONL 就是这个模式的简化版。

## presence 广播

"presence"是 IM 应用常见的功能——显示"用户在线/离线"。aptbot 的多用户场景也需要 presence：用户 A 在电脑上打开 session X，用户 B（如果共享了 X）能看到"A 在线"。

presence 通过事件广播实现：

- 用户绑定 channel 到 session 时，发 presence_online 事件
- channel dead（用户离线）时，发 presence_offline 事件
- 所有绑定该 session 的 channel 收到 presence 事件，前端展示

presence 让"多端协作"成为可能——多个用户在同一个 session 上协作时，能看到谁在线、谁刚操作过。这是把 agent 从"单人对 AI"扩展到"多人 + AI 协作"的基础。

## session_changed 控制消息 + WebSocket 重连

session 状态会变化——另一端发消息、agent 在执行工具、compaction 触发等。这些变化需要通知所有客户端"session 变了，重新拉取"。

`session_changed` 是个轻量控制消息，只含 sessionId + 变化类型，不含具体变化内容。客户端收到后自己决定是否重新拉取完整状态。

为什么不直接推送完整变化？

1. **节省带宽**：变化可能很大（如 compaction 删了几百条），推送完整内容浪费
2. **去重**：多个变化合并成一次拉取，避免连续推送让客户端疲于应付
3. **容错**：客户端漏接一个完整推送会丢状态，漏接 session_changed 只是延迟，下次拉取补上

session_changed + 客户端拉取是"最终一致"模型，与 WebSocket 重连天然兼容——客户端重连时主动拉一次完整状态，不需要服务端追踪"哪个客户端漏了哪些事件"。

## 多用户隔离：UserStorage + scrypt + Bearer token

多用户场景下，"谁能访问哪些 session"是核心安全问题。aptbot 的多用户隔离：

**UserStorage**：用户存储，记录 username + password hash + 其他属性。密码用 scrypt 哈希——scrypt 是设计来抗暴力破解的（参数化内存硬度），比 bcrypt 更抗 ASIC 攻击。

**Bearer token**：用户登录后拿一个 Bearer token，后续请求带这个 token 鉴权。token 有过期时间，到期重新登录。

**session ownership**：每个 session 有 owner 字段，操作 session 时校验当前 token 对应的 user 是否是 owner（或管理员）。非 owner 操作返回 403。

这套机制让 aptbot 能在共享 VPS 上安全运行——多个用户共用一个 aptbot 实例，但彼此的 session 完全隔离，不能互相访问。这是 aptbot 从"单用户工具"进化到"多用户服务"的基础。

## /sessions · /resume · /label · /session 动态属性命令

aptbot CLI 提供一组 session 管理命令：

- **`/sessions`**：列出当前用户的所有 session（含标题、最后活动时间、是否活跃）
- **`/resume <sessionId>`**：恢复某个 session，把它绑到当前 channel
- **`/label <sessionId> <text>`**：给 session 加标签（如 "bug-fix-X"），方便后续查找
- **`/session <key> <value>`**：设置 session 的动态属性（如设置 "project" 字段为某 monorepo 路径）

这些命令让用户能管理自己的 session 库——长期使用 aptbot 的用户会积累几十上百个 session，没有管理命令会变成乱糟糟的目录。`/label` 和 `/session` 的动态属性特别重要，它们让 session 不只是"按时间排列的对话记录"，而是"按主题、按项目组织的工作单元"。

## 小结

Session 系统是 agent 状态管理的核心。JSONL + meta sidecar 平衡 append 与随机改，UUID 校验防路径遍历，claimSession/forceClaimSession 平衡严格与灵活，ring buffer + LRU + JSONL 三级缓存优化历史回放，presence + session_changed 支撑多端同步，UserStorage + scrypt + Bearer token 实现多用户隔离。这一层是 aptbot 从"单机工具"走向"多用户服务"的关键。

下一篇文章看 aptbot 的整体安全模型，把这些散落的安全设计点串起来。
