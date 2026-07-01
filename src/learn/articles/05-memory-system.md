---
slug: "05-memory-system"
title: "Memory 系统：持久化、压缩、跨会话记忆"
description: "JSONL append-only 持久化、增量流式解析、SessionEntry 联合类型、Working memory 与 /continue 跨会话继承、Compaction 触发与三级 token 估算、三层记忆架构规划"
track: agent-practice
chapter: 核心特性深入篇
order: 5
difficulty: intermediate
estimatedReadingTime: 10
status: published
prerequisites:
  - 04-tool-system
lastUpdated: "2026-07-01"
tags:
  - memory
  - jsonl
  - compaction
  - persistence
---

# Memory 系统：持久化、压缩、跨会话记忆

没有记忆的 agent 每次都从零开始，无法承担持续项目。但记忆多了又会让 context window 爆炸——LLM 的 context 是有限的，把所有历史都塞进去既贵又慢。Memory 系统就是在这两个极端之间找平衡：保留有用的，压缩冗余的，丢弃过期的。

## JSONL append-only 持久化设计

aptbot 的会话历史用 JSONL（JSON Lines）格式持久化。每个 session 一个 `.jsonl` 文件，每行一个 JSON 对象，按时间顺序 append。

为什么 JSONL 而不是 SQLite 或 JSON 数组？

**vs JSON 数组**：JSON 数组要改一个元素得重写整个文件。append-only 的 JSONL 写入只需追加一行，O(1) 操作，不会因为文件变大而变慢。

**vs SQLite**：SQLite 是强大的嵌入式数据库，但对 aptbot 这个场景太重——session 数据量小（百级 entry）、查询模式简单（按顺序读）、并发低（单 agent 单 session）。引入 SQLite 会增加依赖、增加打包体积、增加运维复杂度。JSONL 的"零依赖、纯文本、可读"对学习项目更合适。

**append-only 的代价**：删除或修改某个 entry 需要重写整个文件。aptbot 用 Compaction 机制把"修改"转成"压缩后重写"，平时只 append，定期 compact，兼顾写入性能与空间占用。

## 增量流式解析 + 破损行容错 + fs.truncateSync 自动修复

读 JSONL 不是 `JSON.parse(fs.readFileSync(...))`，而是用增量流式解析。原因有三：

1. **大文件不爆内存**：流式解析逐行处理，不需要把整个文件读进内存。
2. **并发安全**：流式解析能容忍文件被 append（读到一半有新行写入也能正确处理）。
3. **破损行容错**：如果某行 JSON 损坏（写入中途崩溃、磁盘错误），流式解析跳过这一行继续，不整个 fail。

破损行容错是关键。生产环境中 JSONL 文件可能因为进程崩溃、磁盘满、并发写入而出现破损行。aptbot 的策略是：

- 解析时遇到破损行：stderr warning + skip，不阻塞
- 检测到破损行后：`fs.truncateSync` 把文件截断到最后一个完整行，自动修复

这个"容错 + 自修复"组合让 JSONL 在非理想环境下也能用。它不保证零数据丢失（破损行的内容会丢），但保证文件始终可解析、agent 始终能启动。

## SessionEntry 联合类型 + UUID 路径校验

session 文件里每一行是一个 `SessionEntry`，它是联合类型（discriminated union）：

- **user message**：用户输入
- **assistant message**：模型回复
- **tool call**：工具调用记录（name + args + result）
- **compaction marker**：压缩点标记
- **metadata**：会话元数据（标题、创建时间等）

联合类型让 TypeScript 在每行解析时强制类型校验，避免把一个 tool call 当 user message 处理这类错误。

session 文件名是 `sessionId.jsonl`，sessionId 是 UUID v4。aptbot 在读写 session 文件前都做 UUID 路径校验——只接受符合 UUID 格式的 sessionId。这是路径遍历防护的一部分：即使攻击者构造 `../../etc/passwd` 作为 sessionId，UUID 校验会直接拒绝。

## Working memory + /continue 跨会话继承

aptbot 区分两类记忆：

- **会话历史**：完整的 turn-by-turn 记录，存在 JSONL 文件
- **Working memory**：agent 当前任务的关键信息，存在 `.meta.json` sidecar 里

Working memory 不是历史压缩，是 agent 主动维护的"当前关注点"。比如执行"修复 bug X"任务时，working memory 可能记着"问题在 src/foo.ts:42、相关测试是 foo.spec.ts、已尝试方案 A 失败"。

`/continue` 命令实现跨会话继承：新 session 启动时，从指定旧 session 继承 working memory（不继承完整历史，避免 context 爆炸）。这让用户能"昨天没做完的事今天接着做"——agent 不需要重新读所有历史，working memory 已经把关键信息浓缩好了。

## Compaction：80% 触发、30% 目标、token 三级估算

session 越长，context 越大，直到超过 LLM 的 context window。Compaction 解决这个问题：当 context 占用达到阈值，压缩历史。

aptbot 的 Compaction 参数：

- **触发阈值 80%**：context 占用达到 80% 时触发压缩
- **目标 30%**：压缩后 context 占用降到 30%
- **token 估算三级**：用三级精度估算 token 数（粗略/中等/精确），平衡精度与性能

压缩不是简单"删掉旧消息"。aptbot 的策略是：

1. 保留最近的 N 轮完整对话
2. 把更早的对话压缩成一段摘要（"用户要求修复 X，agent 通过工具 A/B 完成了 Y，剩余 Z 待办"）
3. 把摘要作为一条 system message 注入 context，旧对话不再加载

这个策略保住了"近期上下文完整"与"长期记忆摘要"两个目标。agent 还能引用早期发生的事（通过摘要），但不需要为每一条历史消息付出 token 成本。

## 三层记忆架构规划（参考 GA L1/L2/L3）

aptbot 当前的记忆系统是"单层"——只有会话历史 + working memory。但规划是走向三层架构，参考 GenericAgent 的 L1/L2/L3：

- **L1（即时记忆）**：当前 session 的对话历史，正在使用，最贵
- **L2（短期记忆）**：近期 session 的摘要，按需检索，中等成本
- **L3（长期记忆）**：跨 session 的事实性知识，按相关性检索，最便宜

L1 已实现，L2/L3 是 future。三层架构的核心思想是"按使用频率分层存储"——频繁访问的放贵的层，少访问的沉到便宜的层，按需"提升"或"沉降"。

这个架构让 agent 既能记住大量历史（L3 容量大），又能在当前任务中快速引用（L1 速度快），还不需要为所有历史付出 L1 的成本。这是 agent 走向"长期使用"的关键基础设施。

## future: working dict（LLM 主动管理）

更远期的规划是 working dict：让 LLM 自己管理一个键值存储，而不是被动地写 working memory。

区别在哪？当前 working memory 是一个字符串字段，agent 用 update_working_memory 工具整体替换。working dict 是结构化的：

- `set(key, value)` 设置某项
- `get(key)` 读某项
- `delete(key)` 删某项
- `keys()` 列出所有键

这让 agent 能"记住 N 件事并分别引用"，而不是把所有事塞进一个字符串。比如执行多步任务时，每步的中间结果可以存到不同 key，后续步骤按 key 取用。

GA 已经实现了 working dict，是它 autonomous 能力的关键基础。aptbot 0.2.x 还没做，但在路线图上。

## 小结

Memory 系统让 agent 不止活在当下。JSONL append-only 提供持久化、增量流式解析提供容错、SessionEntry 联合类型提供类型安全、Working memory + /continue 提供跨会话继承、Compaction 控制 context 增长、三层架构规划长期演进方向。每一项都对应"如何让 agent 既记得住又不爆 context"这个核心矛盾的一面。

下一篇文章看 Skills 系统：如何让 agent 按需加载能力描述，控制 system prompt 的 token 成本。
