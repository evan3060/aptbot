# aptbot 0.2.2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **研发流程规范：** [docs/superpowers/dev-workflow.md](./docs/superpowers/dev-workflow.md)（P0 准备 / A 每 task 14 步 / B 封仓 12 步 / UAT / 熔断）
>
> **设计 spec：** [docs/superpowers/specs/2026-06-30-0.2.2-design.md](./docs/superpowers/specs/2026-06-30-0.2.2-design.md)
>
> **0.3.0 多 agent 设计：** [docs/superpowers/specs/2026-06-30-0.3.0-multi-agent-system-design.md](./docs/superpowers/specs/2026-06-30-0.3.0-multi-agent-system-design.md)

**Goal:** 0.2.2 将 aptbot 从"可用"演进为"可靠 + 可扩展 + 体验流畅"，引入多 provider 故障转移、配置热重载、hook 系统、JSONL 历史持久化、HttpOnly cookie 安全增强、Skills 系统基础、L1 索引 Skill、/session 动态属性、Channel 接口抽象，同时偿还 0.2.x 遗留技术债，为 0.3.0 多 agent 系统建立扩展性基础。

**Architecture:** 0.2.2 不改变 MVP 四层架构，在核心层（core）与接入层（access）增加扩展点：Provider 层引入 MixinProvider 故障转移 / Config 加 mtimeNs 懒加载热重载 / Hook 系统 8 hook 点 / Skills 系统两层加载 / Channel 接口抽象。设计契约详见 [design-notes §12](./docs/design-notes.md#L2553)。

**Tech Stack:** 沿用 0.2.x 技术栈，无新增依赖（hook 系统 + Skills 系统用纯 TS 实现）

## Global Constraints

- 沿用 0.2.x 全部 Global Constraints
- **MixinProvider：** 多 provider 按 priority 串联，前一个失败（fatal 除外）自动 fallback；流式已 yield 后出错不切 provider；同协议约束；广播属性；弹回机制
- **Config 热重载：** 监听 `config/aptbot.json` 的 mtimeNs 变化（懒加载，非 fs.watch）；运行中 turn 用旧配置，下个 turn 用新配置；校验失败降级到旧配置
- **Hook 系统：** 8 hook 点（agent_before/after, turn_before/after, llm_before/after, tool_before/after）；同步；ctx 允许 mutate；priority 排序；吞异常不中断主流程；无沙箱
- **JSONL 历史读取：** 仅 ring buffer 未命中时走 JSONL；仅返回 message 类型，不返回 tool_call；agent 仍受 `data/sessions/` 访问禁令
- **HttpOnly cookie：** token 同时存 cookie（HttpOnly + Secure + SameSite=Strict）+ sessionStorage；优先级 cookie > sessionStorage > URL
- **per-sessionKey ring buffer 分片：** 单 sessionKey 1000 上限；全局 50000 上限 LRU 淘汰；refCount 归零清理
- **turn_busy：** 同 sessionKey 排队时发 `{ type: 'turn_busy', position: N }`
- **Session 自动摘要：** ≤20 字符；用户手动 `/label` 优先；LLM 失败不报错
- **Skills 系统：** 两层加载（workspace `~/.aptbot/skills/` + builtin `src/skills/`）；workspace 覆盖 builtin；最小 frontmatter（name/description/disableModelInvocation）；ExecutionEnv 抽象
- **L1 索引 Skill：** 行数/字节/tags + lastUsed 降序排序 + 4K token 预算 + read_file 特判维护 lastUsed
- **/session 动态属性：** 白名单 5 项（temperature/maxTokens/reasoningEffort/thinkingType/thinkingBudgetTokens）+ 文件值逃生口 + JSON 自动解析 + 内存态 + /session.reset + MixinProvider 广播
- **Channel 抽象：** 方案 E 类型化 bus + AgentEventEnvelope + bindSession 多对一共享
- **All tasks MUST follow TDD:** 编写失败测试 → 终端见证 RED → 实现 → 见证 GREEN → tsc 0 错误 → `requesting-code-review` skill 审查 → 提交
- **研发流程：** 遵循 [docs/superpowers/dev-workflow.md](./docs/superpowers/dev-workflow.md)（P0 准备 / A 每 task 14 步 / B 封仓 12 步 / UAT / 熔断）

---

## Task 列表

### Task 1: per-sessionKey ring buffer 分片 + LRU

**Files:**
- Modify: `src/access/websocket-server.ts`
- Test: `tests/access/websocket-history-replay.spec.ts`

**Interfaces:**
- Consumes: 现有 ring buffer `Map<sessionKey, BufferedEvent[]>` 结构
- Produces: 分片 ring buffer + 全局上限 LRU 淘汰 + refCount 归零清理

**Design Contracts:** 详见 spec [§3.3 Task 1](./docs/superpowers/specs/2026-06-30-0.2.2-design.md#L88)

- [ ] **Step 1: Write the failing test**

覆盖：单 sessionKey 1000 上限 / 全局 50000 触发 LRU / refCount 归零清理

```typescript
// tests/access/websocket-history-replay.spec.ts
describe('ring buffer sharding with LRU', () => {
  it('enforces per-sessionKey 1000 limit');
  it('triggers LRU eviction when global 50000 limit hit');
  it('cleans up buffer when sessionKey refCount reaches zero');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- tests/access/websocket-history-replay.spec.ts`
Expected: FAIL（LRU 淘汰逻辑未实现）

- [ ] **Step 3: Implement minimal code**

在 `src/access/websocket-server.ts` 中：
- 保留单 sessionKey 1000 上限
- 新增全局 `MAX_TOTAL_BUFFERED_EVENTS = 50000`
- 超 50000 时按 LRU 淘汰最旧 sessionKey 的全部 buffer
- sessionKey refCount 归零时清理（沿用 L1 I4/I5 修复）

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- tests/access/websocket-history-replay.spec.ts`
Expected: PASS

- [ ] **Step 5: tsc check**

Run: `npx tsc --noEmit -p tsconfig.test.json`
Expected: 0 errors

- [ ] **Step 6: Commit**

```bash
git add src/access/websocket-server.ts tests/access/websocket-history-replay.spec.ts
git commit -m "refactor: shard ring buffer per sessionKey with LRU eviction"
```

### Task 2: turn_busy 响应

**Files:**
- Modify: `src/server.ts` (`runInboundLoop`)
- Modify: `src/access/chat-page.ts`
- Test: `tests/server/inbound-serialization.spec.ts`

**Interfaces:**
- Consumes: 现有 `runInboundLoop` 串行化逻辑
- Produces: `turn_busy` 消息 `{ type: 'turn_busy', position: N }` + 前端"等待中..."提示

**Design Contracts:** 详见 spec [§3.3 Task 2](./docs/superpowers/specs/2026-06-30-0.2.2-design.md#L96)

- [ ] **Step 1: Write the failing test**

```typescript
describe('turn_busy response', () => {
  it('sends turn_busy when same sessionKey has ongoing turn');
  it('position reflects queue depth');
  it('different sessions do not affect each other');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- tests/server/inbound-serialization.spec.ts`
Expected: FAIL

- [ ] **Step 3: Implement minimal code**

- `server.ts` `runInboundLoop`：同 sessionKey 已有 turn 执行时，新消息入队前发 `turn_busy`
- `chat-page.ts`：监听 `turn_busy` 显示"等待中... (前方 N 条消息)"，收到 turn_start/turn_end 清除

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- tests/server/inbound-serialization.spec.ts`
Expected: PASS

- [ ] **Step 5: tsc check + Commit**

```bash
git add src/server.ts src/access/chat-page.ts tests/server/inbound-serialization.spec.ts
git commit -m "feat: send turn_busy response when messages are queued"
```

### Task 3: JSONL 历史持久化

**Files:**
- Modify: `src/access/websocket-server.ts`
- Modify: `src/core/memory/session-repo.ts`
- Modify: `src/access/chat-page.ts`
- Test: `tests/access/websocket-history-replay.spec.ts`

**Interfaces:**
- Consumes: 现有 ring buffer 回放逻辑
- Produces: `readHistoryForReplay(id, limit)` 方法（仅 wsServer 调用，agent 仍受禁令）

**Design Contracts:** 详见 spec [§3.3 Task 3](./docs/superpowers/specs/2026-06-30-0.2.2-design.md#L104)

- [ ] **Step 1: Write the failing test**

```typescript
describe('JSONL history replay fallback', () => {
  it('reads JSONL when ring buffer empty (server restart)');
  it('returns only message type, not tool_call');
  it('marks replay: true for frontend dedup');
  it('respects limit parameter');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- tests/access/websocket-history-replay.spec.ts`
Expected: FAIL

- [ ] **Step 3: Implement minimal code**

- `session-repo.ts`：新增 `readHistoryForReplay(id, limit)` 返回 `SessionEntry[]`，过滤 `type === 'message'`
- `websocket-server.ts`：ring buffer 空时调用 `readHistoryForReplay`
- `chat-page.ts`：收到 `replay: true` 标记的消息直接渲染，不触发 appendUserMsg

- [ ] **Step 4: Run test to verify it passes + Commit**

```bash
git add src/access/websocket-server.ts src/core/memory/session-repo.ts src/access/chat-page.ts tests/access/websocket-history-replay.spec.ts
git commit -m "feat: persist history via JSONL fallback when ring buffer misses"
```

### Task 4: HttpOnly cookie 安全增强

**Files:**
- Modify: `src/access/websocket-server.ts`
- Modify: `src/access/chat-page.ts`
- Test: `tests/access/auth-api.spec.ts`

**Interfaces:**
- Consumes: 现有 token 存 sessionStorage 逻辑
- Produces: Set-Cookie 响应头 + cookie 优先级读取

**Design Contracts:** 详见 spec [§3.3 Task 4](./docs/superpowers/specs/2026-06-30-0.2.2-design.md#L116)

- [ ] **Step 1: Write the failing test**

```typescript
describe('HttpOnly cookie auth', () => {
  it('sets Set-Cookie on login success');
  it('cookie has HttpOnly + Secure + SameSite=Strict');
  it('/api/me reads cookie first, then Authorization header');
  it('WebSocket token priority: URL > cookie > sessionStorage');
});
```

- [ ] **Step 2-5: TDD cycle + Commit**

```bash
git commit -m "feat: use HttpOnly cookie for token storage to prevent XSS"
```

### Task 5: MixinProvider 多 provider 故障转移

**Files:**
- Create: `src/core/provider/mixin-provider.ts`
- Modify: `src/core/provider/types.ts`
- Test: `tests/core/provider/mixin-provider.spec.ts`

**Interfaces:**
- Consumes: `Provider` 接口（§5 Api-Provider 分离）
- Produces: `MixinProvider` 类（故障转移 + 弹回 + 流式不切已 yield + 同协议约束 + 广播属性）

**Design Contracts:** 详见 [design-notes §12.1](./docs/design-notes.md#L2557)（含完整 MixinConfig / MixinProvider 类实现 / 配置示例）

- [ ] **Step 1: Write the failing test**

```typescript
describe('MixinProvider failover', () => {
  it('succeeds with single provider');
  it('falls back to next provider on failure');
  it('does not fallback on fatal error (401/403/400)');
  it('retries 3 times on retryable error (429/5xx) before fallback');
  it('throws AggregateError when all providers fail');
  it('does not switch provider after stream has yielded');
  it('springs back to primary after springBackMs');
  it('broadcasts attributes to all sub-providers');
});
```

- [ ] **Step 2-5: TDD cycle + Commit**

实现按 [design-notes §12.1 MixinProvider 类](./docs/design-notes.md#L2587) 代码块。

```bash
git commit -m "feat: add MixinProvider with multi-provider failover"
```

### Task 6: Config 热重载

**Files:**
- Modify: `src/infrastructure/config-loader.ts`
- Modify: `src/server.ts`
- Test: `tests/infrastructure/config-loader.spec.ts`

**Interfaces:**
- Consumes: 现有静态 config 加载
- Produces: `ConfigLoader<T>` 类（mtimeNs 懒加载 + 整体重载 + beforeTurn 检查）

**Design Contracts:** 详见 [design-notes §12.2](./docs/design-notes.md#L2683)（含完整 ConfigLoader 类 / AgentSession 集成）

- [ ] **Step 1: Write the failing test**

```typescript
describe('Config hot reload', () => {
  it('detects mtimeNs change and reloads');
  it('running turn uses old config snapshot');
  it('next turn uses new config');
  it('degrades to old config on validation failure');
  it('stop() cleans up watchers');
});
```

- [ ] **Step 2-5: TDD cycle + Commit**

实现按 [design-notes §12.2 ConfigLoader 类](./docs/design-notes.md#L2714) 代码块。

```bash
git commit -m "feat: hot-reload config via mtimeNs watch"
```

### Task 7: Hook 系统（8 hook 点）

**Files:**
- Create: `src/core/agent/hooks.ts`
- Modify: `src/core/agent/loop.ts`
- Modify: `src/core/agent/session.ts`
- Test: `tests/core/agent/hooks.spec.ts`

**Interfaces:**
- Consumes: `AgentSession` / `AgentMessage` / `LLMResponse` / `AgentToolResult` 类型
- Produces: `HookRegistry` 类 + `HookContexts` 接口 + `hooks` 单例

**Design Contracts:** 详见 [design-notes §12.3](./docs/design-notes.md#L2773)（含 8 hook 点表 / HookContexts 接口 / HookRegistry 类 / langfuse 插件示例）

- [ ] **Step 1: Write the failing test**

```typescript
describe('Hook system', () => {
  it('executes hooks by priority ascending');
  it('does not interrupt main flow on hook error');
  it('supports register/unregister');
  it('triggers all 8 hook points');
  it('allows ctx mutation (chain)');
});
```

- [ ] **Step 2-5: TDD cycle + Commit**

实现按 [design-notes §12.3 HookRegistry 类](./docs/design-notes.md#L2824) 代码块。loop.ts/session.ts 集成 8 个 hook 点触发。

```bash
git commit -m "feat: add 8-point hook system with priority"
```

### Task 8: Skills 系统基础（§8.5/§8.6）

**Files:**
- Create: `src/core/skills/types.ts`
- Create: `src/core/skills/loader.ts`
- Create: `src/core/skills/system-prompt.ts`
- Create: `src/core/skills/invocation.ts`
- Create: `src/core/skills/env.ts`
- Test: `tests/core/skills/skill-loader.spec.ts`

**Interfaces:**
- Consumes: 文件系统（`~/.aptbot/skills/` + `.agents/skills/`）
- Produces: `Skill` / `SkillDiagnostic` / `ExecutionEnv` / `loadSkills()` 接口

**Design Contracts:** 详见 [design-notes §8.5/§8.6](./docs/design-notes.md#L1209)（含目录结构 / Skill 接口 / SkillDiagnostic / ExecutionEnv / loadSkills 函数）

- [ ] **Step 1: Write the failing test**

```typescript
describe('Skills system', () => {
  it('loads skills from two layers (workspace + builtin)');
  it('workspace skill overrides builtin with same name');
  it('parses YAML frontmatter (name/description/disableModelInvocation)');
  it('validates name: a-z0-9-, <=64 chars');
  it('validates description: <=1024 chars');
  it('returns SkillDiagnostic on parse failure');
  it('injects name+description into system prompt');
});
```

- [ ] **Step 2-5: TDD cycle + Commit**

实现按 [design-notes §8.6 目录结构 + 核心接口](./docs/design-notes.md#L1233) 代码块。

```bash
git commit -m "feat: add Skills system with two-layer loading and frontmatter"
```

### Task 9: L1 索引 Skill

**Files:**
- Modify: `src/core/skills/types.ts` (扩展 Skill 接口)
- Modify: `src/core/skills/system-prompt.ts` (L1 索引生成)
- Modify: `src/core/tools/read.ts` (read_file 特判维护 lastUsed)
- Test: `tests/core/skills/l1-index.spec.ts`

**Interfaces:**
- Consumes: Task 8 的 `Skill` 接口 + `loadSkills()` 函数
- Produces: 扩展 `Skill`（contentLines/contentBytes/tags/lastUsed）+ `formatSkillsForSystemPrompt()` L1 索引

**依赖：** Task 8（Skills 系统基础）

**Design Contracts:** 详见 [design-notes §12.5](./docs/design-notes.md#L2962)（含 Skill 扩展接口 / formatSkillsForSystemPrompt / formatSkillIndexLine / loadSkill / read_file 特判）

- [ ] **Step 1: Write the failing test**

```typescript
describe('L1 skill index', () => {
  it('includes contentLines/contentBytes/tags in index');
  it('sorts by lastUsed descending');
  it('truncates when total tokens exceed 4K budget');
  it('read_file updates lastUsed for skill files');
  it('falls back to name-only list when budget exceeded');
});
```

- [ ] **Step 2-5: TDD cycle + Commit**

实现按 [design-notes §12.5 Skill 扩展 + formatSkillsForSystemPrompt](./docs/design-notes.md#L2994) 代码块。

```bash
git commit -m "feat: add L1 index for skills with lastUsed tracking"
```

### Task 10: Session 自动摘要命名

**Files:**
- Modify: `src/core/agent/loop.ts`
- Modify: `src/core/memory/session-repo.ts`
- Modify: `src/infrastructure/storage/file-storage.ts`
- Test: `tests/core/agent/session-summary.spec.ts`

**Interfaces:**
- Consumes: `turn_end` 事件 + LLM provider
- Produces: `hasCustomLabel()` 方法 + 异步摘要生成

**Design Contracts:** 详见 spec [§3.3 Task 10](./docs/superpowers/specs/2026-06-30-0.2.2-design.md#L130)

- [ ] **Step 1: Write the failing test**

```typescript
describe('Session auto summary', () => {
  it('triggers summary after turn_end when no label');
  it('skips when user has custom label');
  it('generates summary <=20 chars');
  it('does not throw on LLM failure (keeps default label)');
});
```

- [ ] **Step 2-5: TDD cycle + Commit**

```bash
git commit -m "feat: auto-generate session summary as default label"
```

### Task 11: /session 动态属性

**Files:**
- Create: `src/core/command/session-attrs.ts`
- Modify: `src/core/command/registry.ts`
- Test: `tests/core/command/session-attrs.spec.ts`

**Interfaces:**
- Consumes: Task 5 `MixinProvider` 广播机制
- Produces: `/session` 命令扩展 + `SESSION_ATTRS` 白名单 + `handleSessionAttr()` 函数

**依赖：** Task 5（MixinProvider 广播机制）

**Design Contracts:** 详见 [design-notes §12.4](./docs/design-notes.md#L2900)（含 SESSION_ATTRS 白名单 / handleSessionAttr 函数 / 文件值逃生口 / MixinProvider 广播）

- [ ] **Step 1: Write the failing test**

```typescript
describe('/session dynamic attributes', () => {
  it('sets whitelisted attr (temperature/maxTokens/reasoningEffort/thinkingType/thinkingBudgetTokens)');
  it('reads current value with /session <attr>');
  it('resets all with /session.reset');
  it('supports file value escape hatch');
  it('auto-parses JSON (number/boolean/null)');
  it('rejects non-whitelisted attr');
  it('broadcasts to MixinProvider sub-providers');
});
```

- [ ] **Step 2-5: TDD cycle + Commit**

实现按 [design-notes §12.4 SESSION_ATTRS + handleSessionAttr](./docs/design-notes.md#L2921) 代码块。

```bash
git commit -m "feat: add /session dynamic attributes with MixinProvider broadcast"
```

### Task 12: Channel 接口抽象

**Files:**
- Modify: `src/bus/types.ts`
- Modify: `src/bus/channel-manager.ts`
- Test: `tests/bus/channel.spec.ts`

**Interfaces:**
- Consumes: 现有 WebSocket channel 实现
- Produces: `Channel` 接口（type/send/close/isAlive）+ ChannelManager 多渠道支持

**Design Contracts:** 详见 [design-notes §10](./docs/design-notes.md#L1745)（方案 E 类型化 bus + AgentEventEnvelope + bindSession 多对一共享）

- [ ] **Step 1: Write the failing test**

```typescript
describe('Channel abstraction', () => {
  it('defines Channel interface (type/send/close/isAlive)');
  it('bindSession accepts any Channel implementation');
  it('IM channel manages sessionKey mapping without ?session=');
  it('WebSocket still works as Channel implementation');
});
```

- [ ] **Step 2-5: TDD cycle + Commit**

```bash
git commit -m "refactor: abstract Channel interface for IM integration"
```

### Task 13: E2E 回归测试

**Files:**
- Test: `tests/e2e/0.2.2-regression.spec.ts`

**Interfaces:**
- Consumes: Task 1-12 全部实现
- Produces: E2E 测试覆盖全部新功能

**依赖：** Task 1-12 全部完成

- [ ] **Step 1: Write E2E tests covering:**

- MixinProvider 多 provider 故障转移
- Config 热重载
- Hook 系统 8 点触发
- Skills 系统 list_skills / read_skill
- /session 动态属性设置 + 广播
- JSONL 历史回放
- HttpOnly cookie 登录
- turn_busy 响应
- Session 自动摘要
- Channel 抽象

- [ ] **Step 2: Run + fix + Commit**

```bash
git commit -m "test: e2e regression for 0.2.2"
```

### Task 14: 人工 UAT 核验

**Files:**
- Create: `docs/superpowers/plans/0.2.2-uat-checklist.md`

**依赖：** Task 13

**Design Contracts:** 详见 [dev-workflow.md §4 UAT 核验](./docs/superpowers/dev-workflow.md#L97)

- [ ] **Step 1: 创建 UAT 核验清单文件**

覆盖 4 范围：本地功能 / VPS 线上 / 新功能逐项 / 旧功能回归

- [ ] **Step 2: 用户逐项核验，结果记入清单文件**

### Task 15: 封仓

**Files:**
- Modify: `PLAN-0.2.2.md` / `CHANGELOG.md` / `package.json` / `README.md` / `README.zh-CN.md`

**依赖：** Task 14

- [ ] **执行 B1-B12 封仓流程**（详见 [dev-workflow.md §3](./docs/superpowers/dev-workflow.md#L73)）

B1: `npm test` 全绿 / B2: `npx tsc --noEmit` 0 错误 / B3: 人工 UAT 通过 / B4-B8: 文档归档 / B9: package.json 升 0.2.2 / B10: 打 v0.2.2 tag / B11: `finishing-a-development-branch` skill / B12: VPS 部署验证

```bash
git commit -m "feat(0.2.2): complete with reliability and extensibility foundation"
```

---

## 依赖关系图

```
Task 1 (ring buffer) ─────────────────────────────┐
Task 2 (turn_busy) ───────────────────────────────┤
Task 3 (JSONL 历史) ───────────────────────────────┤
Task 4 (HttpOnly cookie) ─────────────────────────┤
Task 5 (MixinProvider) ──┬────────────────────────┤
Task 6 (Config 热重载) ──┤                        │
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

5. **研发流程合规：** 本 plan 由 writing-plans skill 流程产出，基于 spec [2026-06-30-0.2.2-design.md] + design-notes §12 已定设计。

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
