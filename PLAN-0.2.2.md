# aptbot 0.2.2 Implementation Plan

> 🚧 **0.2.2 PLANNED, NOT STARTED** — 可靠性 + 扩展性基础 + 体验优化。前置 0.2.0/0.2.1 已于 2026-06-30 封仓（见 [PLAN-L1.md](./PLAN-L1.md)）。
>
> **本文件是图纸而非代码堆:** 描述性内容（Goal/Architecture/Behavior/TDD Cycle 说明/Self-Review）用中文，参数、变量、类型名、文件路径、命令、commit 消息保持英文。具体函数体、业务逻辑与测试代码刻意省略。
>
> **0.3.0 多 agent 系统设计见** [docs/superpowers/specs/2026-06-30-0.3.0-multi-agent-system-design.md](./docs/superpowers/specs/2026-06-30-0.3.0-multi-agent-system-design.md)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 0.2.2 将 aptbot 从"可用"演进为"可靠 + 可扩展 + 体验流畅"：引入多 provider 故障转移、配置热重载、hook 系统、JSONL 历史持久化、HttpOnly cookie 安全增强、Skills 系统基础、L1 索引 Skill、/session 动态属性、Channel 接口抽象。同时偿还 0.2.x 遗留技术债（per-sessionKey ring buffer 分片、turn_busy 响应、session 自动摘要命名）。为 0.3.0 多 agent 系统建立扩展性基础。

**Architecture:** 0.2.2 不改变 MVP 四层架构，在核心层（core）与接入层（access）增加扩展点：
- Provider 层引入 `MixinProvider` 支持故障转移
- Config 加 mtimeNs 懒加载实现热重载
- Hook 系统：8 个 hook 点 + priority 排序
- Skills 系统：§8.5/§8.6 两层加载 + frontmatter + ExecutionEnv（0.3.0 多 agent 独立技能的基础）
- Channel 接口抽象（0.4.0 IM 接入铺路）

**Tech Stack:** 沿用 0.2.x 技术栈，无新增依赖（hook 系统 + Skills 系统用纯 TS 实现）

## Global Constraints

- 沿用 0.2.x 全部 Global Constraints
- **0.2.2 新增约束：**
  - **MixinProvider：** 多 provider 按 priority 串联，前一个失败（fatal 除外）自动 fallback 到下一个
  - **Config 热重载：** 监听 `config/aptbot.json` 的 mtimeNs 变化，懒加载新配置；运行中 turn 用旧配置，下个 turn 用新配置
  - **Hook 系统：** 8 个 hook 点，每个 hook 注册时指定 priority（小数字先执行）；hook 抛错不中断主流程，仅记录
  - **JSONL 历史读取：** 仅在 ring buffer 未命中时走 JSONL，不暴露给 agent；agent 仍受 `data/sessions/` 访问禁令
  - **HttpOnly cookie：** token 同时存 cookie（HttpOnly + Secure + SameSite=Strict）+ sessionStorage；优先级 cookie > sessionStorage > URL
  - **per-sessionKey ring buffer 分片：** ring buffer 改为 `Map<sessionKey, BufferedEvent[]>`，每个 sessionKey 独立 1000 上限；总上限 50000 防失控
  - **turn_busy 响应：** 同 sessionKey 已有 turn 执行时，新消息入队前发送 `{ type: 'turn_busy', position: N }` 提示前端显示"等待中..."
  - **Session 自动摘要命名：** session 首条 assistant 消息后，异步调用 LLM 生成 ≤20 字符摘要
  - **Skills 系统：** 两层加载（全局 + 项目）+ frontmatter + ExecutionEnv；agent 通过 list_skills 工具按需索引
  - **L1 索引 Skill：** 行数/字节/tags + lastUsed 排序 + 4K token 预算 + read_file 特判维护 lastUsed
  - **/session 动态属性：** MixinProvider 自动广播属性变更；白名单 5 项 + 文件值逃生口
  - **Channel 抽象：** `Channel` 接口（send/receive/close），WebSocket 实现此接口；ChannelManager 支持多渠道注册

## 研发流程

### 0. 开发前准备（启动前一次性执行）

| 步骤 | 动作 | 验证 |
|---|---|---|
| P1 | `git status` 检查工作区干净 | 无未提交变更（含 untracked） |
| P2 | `git checkout -b feat/0.2.2` 创建开发分支（或确认已在该分支） | 当前分支 = `feat/0.2.2` |
| P3 | 确认本版本相关 spec/plan 已就位：`PLAN-0.2.2.md` + `docs/superpowers/specs/2026-06-30-0.3.0-multi-agent-system-design.md` | 文件存在 |
| P4 | 提交 spec/plan 入版本库：`git add PLAN-0.2.2.md docs/superpowers/specs/2026-06-30-0.3.0-multi-agent-system-design.md` + `git commit -m "docs: add 0.2.2 plan and 0.3.0 multi-agent spec"` | 提交成功 |
| P5 | `npm install` 确认依赖完整 | node_modules 就绪，无 peer dep 警告 |
| P6 | `npm test` 基线回归 | 0.2.1 封仓状态全绿（基线建立） |
| P7 | `npx tsc --noEmit` | 0 错误 |
| P8 | 启动 `executing-plans` skill 自动推进 task 链（每个 task 内部嵌套 `test-driven-development` skill） | 进入 Task 1 的 A1 步骤 |

**约束：**
- P1 不通过 → 先处理未提交变更或 stash，禁止在脏工作区开新分支
- P6 不通过 → 0.2.1 封仓状态被破坏，禁止启动 0.2.2，先修复基线
- P7 不通过 → 修复 ts 错误后重跑，禁止带类型错误启动
- P3 的 0.3.0 设计文档纳入 0.2.2 提交原因：0.2.2 的 Task 5/7/8/11 等是为 0.3.0 多 agent 铺路，设计文档作为前置参考必须随版本入库

### A. 每 task 必做（14 步）

| 步骤 | 动作 | 验证 |
|---|---|---|
| A1 | 编写失败测试（覆盖契约边界） | — |
| A2 | `npm run test -- <path>` 终端见证 RED | 测试失败 |
| A3 | 实现最小代码（TDD 驱动，不写多余逻辑） | — |
| A4 | `npm run test -- <path>` 终端见证 GREEN | 测试通过 |
| A5 | `npx tsc --noEmit -p tsconfig.test.json` | 0 错误 |
| A6 | 调用 `requesting-code-review` skill 审查 | 审查通过 |
| A7 | 修复审查问题（如有）后重跑 A4/A5 | GREEN + 0 错误 |
| A8 | `git add <specific files>`（禁用 `git add -A`） | — |
| A9 | `git commit`（conventional commits，英文 message） | — |
| A10 | 更新 PLAN-0.2.2.md 对应 task checkbox 为 `[x]` | — |
| A11 | 若 task 涉及接口/架构变化 → 更新 `ARCHITECTURE.md` | — |
| A12 | 若 task 涉及用户可见行为 → 更新 `README.md` / `README.zh-CN.md` | — |
| A13 | 若 task 涉及设计决策 → 更新 `docs/design-notes.md` | — |
| A14 | `git add` 文档变更 + `git commit`（`docs: sync ...`） | — |

### B. 封仓流程（0.2.2 全部 task 完成后）

| 步骤 | 动作 | 验证 |
|---|---|---|
| B1 | `npm test` 全量回归 | 全绿 |
| B2 | `npx tsc --noEmit` | 0 错误 |
| B3 | **人工 UAT 核验**（详见各 task 的 UAT 要求） | 用户验收通过 |
| B4 | `CHANGELOG.md` 添加 0.2.2 章节 | — |
| B5 | `README.md` / `README.zh-CN.md` 同步 0.2.2 变更 | — |
| B6 | `PLAN-0.2.2.md` 顶部状态更新为 `✅ 0.2.2 COMPLETED` | — |
| B7 | 设计文档归档至 `docs/superpowers/specs/` | — |
| B8 | 实施计划归档至 `docs/superpowers/plans/` | — |
| B9 | `package.json` 版本升至 0.2.2 | — |
| B10 | 打 `v0.2.2` git tag | — |
| B11 | `finishing-a-development-branch` skill 执行最终封仓 | — |
| B12 | VPS 部署验证 | 线上验证通过 |

### UAT 核验范围

- 本地功能验证：基础聊天 / 工具调用 / session 切换不回归
- VPS 线上验证：aptbot.de / demo.aptbot.de 不回归
- 新功能逐项验证：MixinProvider fallback / Hook / 热重载 / Skills / /session 属性
- 旧功能回归验证：0.2.x 用户系统 / 多客户端同步 / 侧边栏

### 文档同步边界

- **A11 架构变化**：新增/删除模块、接口签名变更、依赖关系调整
- **A12 用户可见行为**：命令格式、配置项、部署方式、API 端点变化
- **A13 设计决策**：从"待讨论"变为"已定"、决策依据变化、新增约束
- 不触发的纯内部重构 → 仅做 A10（checkbox）

### 错误处理（熔断机制）

- 遇到 3 次连续不可修复的测试失败：触发熔断，停止当前 task
- 打印错误栈，标记 task 为 failed，记录依赖
- 切换到其他无依赖 task，全部完成后再回来修复

---

## Task 列表

### Task 1: per-sessionKey ring buffer 分片 + LRU

**Files:**
- Modify: `src/access/websocket-server.ts`
- Test: `tests/access/websocket-history-replay.spec.ts`

**Design Contracts:**

```typescript
// 行为契约：
// - 单 sessionKey 上限 1000 不变
// - 全局 50000 上限触发 LRU 淘汰最旧 sessionKey 的全部 buffer
// - sessionKey refCount 归零时清理
```

**Behavior:** 0.2.x 的 ring buffer 在 50 connections × 1000 envelopes 场景下可能内存过高。引入全局上限 + LRU 淘汰，保证内存可控。

**TDD Cycle:**
- [ ] 编写失败测试覆盖：单 sessionKey 1000 上限、全局 50000 触发 LRU、refCount 归零清理
- [ ] 验证失败：`npm run test -- tests/access/websocket-history-replay.spec.ts` → FAIL
- [ ] 实现
- [ ] 验证通过：Exit Code 0
- [ ] `requesting-code-review` skill 审查
- [ ] 提交：`refactor: shard ring buffer per sessionKey with LRU eviction`

### Task 2: turn_busy 响应

**Files:**
- Modify: `src/server.ts` (`runInboundLoop`)
- Modify: `src/access/chat-page.ts`
- Test: `tests/server/inbound-serialization.spec.ts`

**Design Contracts:**

```typescript
// 行为契约：
// - 同 sessionKey 已有 turn 执行时，新消息入队前发送 turn_busy
// - 消息格式：{ type: 'turn_busy', position: N }
// - turn 完成后不发送 turn_ready（前端靠 turn_end 事件自然恢复）
// - 前端监听 turn_busy 显示"等待中... (前方 N 条消息)"
```

**Behavior:** 0.2.x 的串行化让消息自然排队，但用户无反馈。增加 turn_busy 提示。

**TDD Cycle:**
- [ ] 编写失败测试覆盖：同 session 第二条消息触发 turn_busy、position 正确、不同 session 不互相影响
- [ ] 验证失败：`npm run test -- tests/server/inbound-serialization.spec.ts` → FAIL
- [ ] 实现
- [ ] 验证通过：Exit Code 0
- [ ] `requesting-code-review` skill 审查
- [ ] 提交：`feat: send turn_busy response when messages are queued`

### Task 3: JSONL 历史持久化

**Files:**
- Modify: `src/access/websocket-server.ts`
- Modify: `src/core/memory/session-repo.ts`
- Modify: `src/access/chat-page.ts`
- Test: `tests/access/websocket-history-replay.spec.ts`

**Design Contracts:**

```typescript
// 行为契约：
// - ring buffer 为空（服务器重启后）时，调用 readHistoryForReplay(id) 读 JSONL
// - readSession 返回 SessionEntry[]，过滤 type === 'message' 后发送
// - 标记 replay: true，前端不重复渲染
// - 限制：仅返回 message 类型，不返回 tool_call（避免泄漏内部状态）
// - agent 仍受 data/sessions/ 访问禁令，此路径仅 wsServer 使用
```

**Behavior:** 0.2.x 服务器重启后 ring buffer 丢失，历史不可恢复。在 ring buffer 未命中时走 JSONL。

**TDD Cycle:**
- [ ] 编写失败测试覆盖：ring buffer 命中时不读 JSONL、ring buffer 空时读 JSONL、limit 参数生效、不返回 tool_call
- [ ] 验证失败：`npm run test -- tests/access/websocket-history-replay.spec.ts` → FAIL
- [ ] 实现
- [ ] 验证通过：Exit Code 0
- [ ] `requesting-code-review` skill 审查
- [ ] 提交：`feat: persist history via JSONL fallback when ring buffer misses`

### Task 4: HttpOnly cookie 安全增强

**Files:**
- Modify: `src/access/websocket-server.ts`
- Modify: `src/access/chat-page.ts`
- Test: `tests/access/auth-api.spec.ts`

**Design Contracts:**

```typescript
// 行为契约：
// - POST /api/register /api/login 成功时设置 Set-Cookie
// - Cookie: aptbot_token=<token>; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=2592000
// - GET /api/me 优先读 cookie，其次 Authorization: Bearer
// - WebSocket 连接 token 来源优先级：URL ?token= > cookie > sessionStorage
// - 前端 fetch 自动带 cookie（credentials: 'include'）
```

**Behavior:** 0.2.x 的 token 存 sessionStorage，存在 XSS 风险。改为 HttpOnly cookie，JavaScript 不可读。

**TDD Cycle:**
- [ ] 编写失败测试覆盖：登录响应含 Set-Cookie、cookie HttpOnly + Secure + SameSite=Strict、/api/me 优先读 cookie
- [ ] 验证失败：`npm run test -- tests/access/auth-api.spec.ts` → FAIL
- [ ] 实现
- [ ] 验证通过：Exit Code 0
- [ ] `requesting-code-review` skill 审查
- [ ] 提交：`feat: use HttpOnly cookie for token storage to prevent XSS`

### Task 5: MixinProvider 多 provider 故障转移

**Files:**
- Create: `src/core/provider/mixin-provider.ts`
- Modify: `src/core/provider/types.ts`
- Test: `tests/core/provider/mixin-provider.spec.ts`

**Design Contracts:**

```typescript
// 行为契约：
// - 按 priority 升序尝试，前一个失败（非 fatal）自动 fallback
// - fatal 错误（401/403/400）不触发 fallback，直接抛出
// - retryable 错误（429/5xx）先在原 provider 重试 3 次，仍失败后 fallback
// - 所有 provider 都失败时抛 AggregateError
// - 流式已 yield 的内容不切换 provider（避免内容错乱）
```

**Behavior:** 0.2.x 单 provider 失败时直接报错。支持多 provider 串联，提高可用性。为 0.3.0 不同 agent 用不同 provider 铺路。

**TDD Cycle:**
- [ ] 编写失败测试覆盖：单 provider 成功、首个失败 fallback 到第二个、fatal 不 fallback、retryable 先重试再 fallback、全部失败抛 AggregateError、流式已 yield 不切换
- [ ] 验证失败：`npm run test -- tests/core/provider/mixin-provider.spec.ts` → FAIL
- [ ] 实现
- [ ] 验证通过：Exit Code 0
- [ ] `requesting-code-review` skill 审查
- [ ] 提交：`feat: add MixinProvider with multi-provider failover`

### Task 6: Config 热重载

**Files:**
- Modify: `src/infrastructure/config-loader.ts`
- Modify: `src/server.ts`
- Test: `tests/infrastructure/config-loader.spec.ts`

**Design Contracts:**

```typescript
// 行为契约：
// - 监听 config/aptbot.json 的 mtimeNs 变化（fs.watch）
// - 变化时懒加载新配置，不立即应用
// - getActiveConfig() 返回最新已加载配置
// - 运行中 turn 用旧配置（捕获时的快照），下个 turn 用新配置
```

**Behavior:** 0.2.x 修改配置需重启服务器。支持热重载，修改 `config/aptbot.json` 后下个 turn 自动生效。

**TDD Cycle:**
- [ ] 编写失败测试覆盖：文件变化触发 reload、运行中 turn 用旧配置、下个 turn 用新配置、stop() 清理监听器
- [ ] 验证失败：`npm run test -- tests/infrastructure/config-loader.spec.ts` → FAIL
- [ ] 实现
- [ ] 验证通过：Exit Code 0
- [ ] `requesting-code-review` skill 审查
- [ ] 提交：`feat: hot-reload config via mtimeNs watch`

### Task 7: Hook 系统（8 hook 点）

**Files:**
- Create: `src/core/agent/hooks.ts`
- Modify: `src/core/agent/loop.ts`
- Modify: `src/core/agent/session.ts`
- Test: `tests/core/agent/hooks.spec.ts`

**Design Contracts:**

```typescript
// HookPoint: 'beforeTurn' | 'afterTurn' | 'beforeToolCall' | 'afterToolCall' | 'beforeMessage' | 'afterMessage' | 'beforeSession' | 'afterSession'
// 行为契约：
// - priority 升序执行（小数字先执行）
// - hook 抛错不中断主流程，仅 log.warn
// - hook 必须异步且不阻塞主流程（超时 1s 后跳过）
// - register/unregister 生效
```

**Behavior:** 0.2.x 无扩展点，定制逻辑需改源码。引入 8 hook 点，支持插件式扩展。为 0.3.0 注入 agent 个性铺路。

**TDD Cycle:**
- [ ] 编写失败测试覆盖：hook 按 priority 执行、hook 抛错不中断、register/unregister 生效、8 个 hook 点都被调用、超时跳过
- [ ] 验证失败：`npm run test -- tests/core/agent/hooks.spec.ts` → FAIL
- [ ] 实现
- [ ] 验证通过：Exit Code 0
- [ ] `requesting-code-review` skill 审查
- [ ] 提交：`feat: add 8-point hook system with priority`

### Task 8: Skills 系统基础（§8.5/§8.6）

**Files:**
- Create: `src/core/skills/skill-loader.ts`
- Create: `src/core/skills/skill-registry.ts`
- Create: `src/core/skills/types.ts`
- Test: `tests/core/skills/skill-loader.spec.ts`

**Design Contracts:**

```typescript
// 两层加载：
// - 全局层：~/.aptbot/skills/<name>/SKILL.md
// - 项目层：.agents/skills/<name>/SKILL.md（项目层覆盖全局层）
// - SKILL.md frontmatter: name / description / tags / allowed-tools
// - ExecutionEnv：执行环境（cwd / env / 超时 / 资源限制）
// - list_skills 工具：列出可用 skills（按 lastUsed 排序）
// - read_skill 工具：读取指定 skill 的 SKILL.md 全文
```

**Behavior:** 0.3.0 多 agent 独立技能的基础。建立 Skills 系统的两层加载机制与 frontmatter 解析。

**TDD Cycle:**
- [ ] 编写失败测试覆盖：两层加载优先级、frontmatter 解析、项目层覆盖全局层、list_skills 返回、read_skill 返回
- [ ] 验证失败：`npm run test -- tests/core/skills/skill-loader.spec.ts` → FAIL
- [ ] 实现
- [ ] 验证通过：Exit Code 0
- [ ] `requesting-code-review` skill 审查
- [ ] 提交：`feat: add Skills system with two-layer loading and frontmatter`

### Task 9: L1 索引 Skill

**Files:**
- Modify: `src/core/skills/skill-registry.ts`
- Modify: `src/core/tools/read.ts`
- Test: `tests/core/skills/l1-index.spec.ts`

**Design Contracts:**

```typescript
// L1 索引行为契约：
// - list_skills 返回 L1 索引：name / 行数 / 字节 / tags
// - 按 lastUsed 排序（最近使用的在前）
// - 4K token 预算：超出则截断 + 提示
// - read_skill 特判：读取后更新 lastUsed 时间戳
// - lastUsed 持久化到 .agents/skills/.lastused.json
```

**Behavior:** Skills 系统的 L1 索引层，让 agent 按需发现 skills 而非全部加载。

**依赖：** Task 8（Skills 系统基础）

**TDD Cycle:**
- [ ] 编写失败测试覆盖：L1 索引返回行数/字节/tags、lastUsed 排序、4K token 截断、read_skill 更新 lastUsed
- [ ] 验证失败：`npm run test -- tests/core/skills/l1-index.spec.ts` → FAIL
- [ ] 实现
- [ ] 验证通过：Exit Code 0
- [ ] `requesting-code-review` skill 审查
- [ ] 提交：`feat: add L1 index for skills with lastUsed tracking`

### Task 10: Session 自动摘要命名

**Files:**
- Modify: `src/core/agent/loop.ts`
- Modify: `src/core/memory/session-repo.ts`
- Modify: `src/infrastructure/storage/file-storage.ts`
- Test: `tests/core/agent/session-summary.spec.ts`

**Design Contracts:**

```typescript
// 行为契约：
// - turn_end 后检查 session 是否已有 label
// - 无 label 时异步调用 LLM 生成摘要（≤20 字符）
// - 摘要 prompt: "Summarize this conversation in ≤20 chars. No punctuation. No quotes."
// - 生成成功后 storage.updateSessionLabel(id, summary)
// - 用户手动 /label 后跳过自动摘要（检查现有 label 是否非默认）
// - LLM 失败时不报错，保留默认 label
```

**Behavior:** 0.2.x 默认 label 是首 20 字符，不语义化。用 LLM 生成摘要，更易识别。

**TDD Cycle:**
- [ ] 编写失败测试覆盖：无 label 时触发摘要、有用户 label 时跳过、摘要 ≤20 字符、LLM 失败时不报错
- [ ] 验证失败：`npm run test -- tests/core/agent/session-summary.spec.ts` → FAIL
- [ ] 实现
- [ ] 验证通过：Exit Code 0
- [ ] `requesting-code-review` skill 审查
- [ ] 提交：`feat: auto-generate session summary as default label`

### Task 11: /session 动态属性

**Files:**
- Modify: `src/core/command/registry.ts`
- Create: `src/core/command/session-attrs.ts`
- Test: `tests/core/command/session-attrs.spec.ts`

**Design Contracts:**

```typescript
// /session 动态属性行为契约：
// - 白名单 5 项：temperature / maxTokens / reasoningEffort / thinkingType / thinkingBudgetTokens
// - /session <attr> <value>：设置属性，通过 MixinProvider 广播
// - /session <attr>：读取当前值
// - /session.reset：重置为默认值
// - 文件值逃生口：/session <attr> file <path> 从文件读取值
// - 属性变更通过 MixinProvider 自动广播到所有 provider
```

**Behavior:** 让用户动态调整 agent 参数，无需重启。为 0.3.0 agent 级配置铺路。

**依赖：** Task 5（MixinProvider 广播机制）

**TDD Cycle:**
- [ ] 编写失败测试覆盖：5 项白名单属性设置/读取、/session.reset 重置、file 逃生口、MixinProvider 广播、非法属性拒绝
- [ ] 验证失败：`npm run test -- tests/core/command/session-attrs.spec.ts` → FAIL
- [ ] 实现
- [ ] 验证通过：Exit Code 0
- [ ] `requesting-code-review` skill 审查
- [ ] 提交：`feat: add /session dynamic attributes with MixinProvider broadcast`

### Task 12: Channel 接口抽象

**Files:**
- Modify: `src/bus/types.ts`
- Modify: `src/bus/channel-manager.ts`
- Test: `tests/bus/channel.spec.ts`

**Design Contracts:**

```typescript
// Channel 接口：
// - readonly type: 'websocket' | 'telegram' | 'feishu'
// - send(msg: AgentEventEnvelope | ControlMessage): Promise<void>
// - close(): Promise<void>
// - isAlive(): boolean
// 行为契约：
// - ChannelManager 支持 IM 渠道注册（不限于 WebSocket）
// - bindSession(sessionKey, channel) 接受任意 Channel 实现
// - IM 渠道连接时无 ?session=，由 IM 渠道自己管理 sessionKey 映射
```

**Behavior:** 0.2.x ChannelManager 仅支持 WebSocket。抽象 Channel 接口，为 0.4.0 IM 渠道接入做准备。

**TDD Cycle:**
- [ ] 编写失败测试覆盖：Channel 接口、bindSession 接受任意 Channel、IM 渠道无 ?session= 时由渠道映射
- [ ] 验证失败：`npm run test -- tests/bus/channel.spec.ts` → FAIL
- [ ] 实现
- [ ] 验证通过：Exit Code 0
- [ ] `requesting-code-review` skill 审查
- [ ] 提交：`refactor: abstract Channel interface for IM integration`

### Task 13: E2E 回归测试

**Files:**
- Test: `tests/e2e/0.2.2-regression.spec.ts`

**Design Contracts:**

```typescript
// E2E 覆盖点：
// - MixinProvider 多 provider 故障转移演示
// - Config 热重载演示
// - Hook 系统 8 点触发
// - Skills 系统 list_skills / read_skill
// - /session 动态属性设置 + 广播
// - JSONL 历史回放
// - HttpOnly cookie 登录
// - turn_busy 响应
// - Session 自动摘要
// - Channel 抽象
```

**依赖：** Task 1-12 全部完成

**TDD Cycle:**
- [ ] 编写 E2E 测试覆盖上述点
- [ ] 验证失败：`npm run test -- tests/e2e/0.2.2-regression.spec.ts` → FAIL
- [ ] 修复至通过
- [ ] `requesting-code-review` skill 审查
- [ ] 提交：`test: e2e regression for 0.2.2`

### Task 14: 人工 UAT 核验

**Files:**
- Create: `docs/superpowers/plans/0.2.2-uat-checklist.md`

**Design Contracts:**

```typescript
// UAT 核验清单（4 范围）：
// 1. 本地功能验证：基础聊天 / 工具调用 / session 切换不回归
// 2. VPS 线上验证：aptbot.de / demo.aptbot.de 不回归
// 3. 新功能逐项验证：
//    - MixinProvider fallback（模拟主 provider 失败）
//    - Hook 系统（自定义 hook 触发）
//    - Config 热重载（修改配置后下个 turn 生效）
//    - Skills 系统（list_skills / read_skill）
//    - /session 动态属性（设置 + 广播）
//    - JSONL 历史回放（重启后历史可恢复）
//    - HttpOnly cookie（登录后 cookie 自动携带）
//    - turn_busy（同 session 排队提示）
//    - Session 自动摘要（首条 assistant 消息后生成摘要）
//    - Channel 抽象（WebSocket 仍正常）
// 4. 旧功能回归验证：0.2.x 用户系统 / 多客户端同步 / 侧边栏
```

**依赖：** Task 13

**行为：** 用户逐项核验，结果记入 `0.2.2-uat-checklist.md`，逐项勾选。

### Task 15: 封仓

**Files:**
- Modify: `PLAN-0.2.2.md`
- Modify: `CHANGELOG.md`
- Modify: `package.json`
- Modify: `README.md` / `README.zh-CN.md`

**Design Contracts:**

```typescript
// 封仓流程（B1-B12）：
// - B1: npm test 全绿
// - B2: npx tsc --noEmit 0 错误
// - B3: 人工 UAT 核验通过（Task 14）
// - B4: CHANGELOG.md 添加 0.2.2 章节
// - B5: README.md / README.zh-CN.md 同步 0.2.2 变更
// - B6: PLAN-0.2.2.md 顶部状态更新为 ✅ 0.2.2 COMPLETED
// - B7: 设计文档归档至 docs/superpowers/specs/
// - B8: 实施计划归档至 docs/superpowers/plans/
// - B9: package.json 版本升至 0.2.2
// - B10: 打 v0.2.2 git tag
// - B11: finishing-a-development-branch skill 执行封仓
// - B12: VPS 部署验证
```

**依赖：** Task 14

**行为：** 执行 B1-B12 全部步骤，完成 0.2.2 封仓。

---

## 依赖关系图

```
Task 1 (ring buffer) ─────────────────────────────┐
Task 2 (turn_busy) ───────────────────────────────┤
Task 3 (JSONL 历史) ───────────────────────────────┤
Task 4 (HttpOnly cookie) ─────────────────────────┤
Task 5 (MixinProvider) ──┬────────────────────────┤
Task 6 (Config 热重载) ─┤                        │
Task 7 (Hook 系统) ─────┤                        │
Task 8 (Skills 系统) ───┼──→ Task 9 (L1 索引) ───┤
Task 10 (Session 摘要) ─┤                        │
                        └──→ Task 11 (/session) ─┤
Task 12 (Channel 抽象) ───────────────────────────┤
                                                   ↓
                                          Task 13 (E2E)
                                                   ↓
                                          Task 14 (UAT)
                                                   ↓
                                          Task 15 (封仓)
```

**并行机会：**
- Task 1-4（0.2.x 技术债）互相独立，可并行
- Task 5/6/7/8/10/12 互相独立，可并行
- Task 9 依赖 Task 8
- Task 11 依赖 Task 5

---

## Self-Review

### 设计决策回顾

1. **版本号调整：** 原 PLAN-L2 的 11 项历史功能降级为 0.2.2（0.2.x 延续），0.3.0 留给多 agent 系统建立。

2. **永久放弃（2 项）：** CLI 增强（Overlay/diff/fold）、WebUI 拆分 Cloudflare Pages。理由：投入产出比低，聚焦 0.3.0 多 agent。

3. **推迟到 0.4.0（1 项）：** Telegram 渠道接入。理由：IM 实现需先完成 Channel 抽象（Task 12），首个 IM 渠道单独成版本更稳。

4. **新增 3 项：** Skills 系统基础、L1 索引 Skill、/session 动态属性。理由：0.3.0 多 agent 依赖这些基础。

5. **MixinProvider vs FallbackProvider：** 0.2.2 先做 MixinProvider（多 provider 串联），FallbackProvider + 熔断器留 L3。

6. **Config 热重载用 mtimeNs 而非 fs.watch：** fs.watch 跨平台兼容性差，mtimeNs 懒加载更稳定。

7. **Hook 系统 8 点：** 覆盖 turn / tool / message / session 全生命周期，足够大多数插件需求。

8. **JSONL 历史读取突破 agent 约束：** 仅 wsServer 使用 readHistoryForReplay，agent 仍受禁令。必要的妥协。

9. **HttpOnly cookie vs token refresh：** 0.2.2 先做 HttpOnly cookie 防 XSS，token refresh 留 L3。

### 风险点

1. **MixinProvider 串联延迟：** 多 provider fallback 时累计延迟。仅在 retryable 错误后 fallback，fatal 立即抛出。

2. **Config 热重载竞态：** 修改配置文件时可能有部分写入。用原子写（write-to-tmp + rename）。

3. **Hook 系统性能：** 8 个 hook 点每个 turn 调用多次。hook 必须异步且不阻塞主流程（超时 1s 后跳过）。

4. **JSONL 历史读取性能：** 大 session（10000+ 消息）读取慢。限制 limit=20，仅返回最近 N 条。

5. **Skills 系统与 0.3.0 多 agent 的衔接：** 0.2.2 建立 Skills 系统基础，0.3.0 在此之上实现 agent 独立技能绑定。需保证接口设计前瞻性。

6. **/session 动态属性与 MixinProvider 的耦合：** /session 依赖 MixinProvider 广播机制，需保证 MixinProvider 先完成。

7. **文档同步遗漏：** 0.2.x 封仓时发现各类文档未更新。0.2.2 研发流程新增 A11-A14 文档同步步骤 + B4-B8 封仓文档步骤。

### 不做的事（0.2.2 范围外）

- Telegram 渠道接入（0.4.0）
- CLI 增强（永久放弃）
- WebUI 拆分 Cloudflare Pages（永久放弃）
- FallbackProvider + 熔断器（L3）
- OAuth 第三方登录（L3）
- Session 分支/树结构（L3）
- 跨会话长期记忆（0.3.0 多 agent）
- Token refresh 机制（L3）
- AgentLoop Layer 3（L3）
- Subagent 子代理管理（L3）

---

## 后续阶段展望

### 0.3.0 多 agent 系统
- AgentProfile 实体（用户私有，多 md 文件）
- Session ↔ Agent 强约束
- 共享记忆（read_agent_memory + write_agent_memory 带确认）
- Agent 切换 UI + 基础向导模式
- 详细设计见 [docs/superpowers/specs/2026-06-30-0.3.0-multi-agent-system-design.md](./docs/superpowers/specs/2026-06-30-0.3.0-multi-agent-system-design.md)

### 0.4.0 IM 渠道接入
- Telegram 渠道接入（首个 IM 实现）
- 飞书/钉钉接入（可选）

### L3（远期目标）
- FallbackProvider + 熔断器
- OAuth 认证
- Session 分支（树结构）
- 飞书/钉钉接入
- Token refresh 机制
- AgentLoop Layer 3（AgentHarness + phase 状态机）
- Subagent 子代理管理
- 跨进程恢复
- RpcMode / PrintMode
- 自演化 skill
- Plan Mode SOP
