# aptbot 0.2.2 Implementation Plan

> **状态：🚧 0.2.2 PLANNED, NOT STARTED**
>
> **研发流程规范：** [docs/superpowers/dev-workflow.md](./docs/superpowers/dev-workflow.md)（P0 准备 / A 每 task 14 步 / B 封仓 12 步 / UAT / 熔断）
>
> **设计文档：** [docs/superpowers/specs/2026-06-30-0.2.2-design.md](./docs/superpowers/specs/2026-06-30-0.2.2-design.md)（技术方案/边界/约束/安全控制）
>
> **0.3.0 多 agent 设计：** [docs/superpowers/specs/2026-06-30-0.3.0-multi-agent-system-design.md](./docs/superpowers/specs/2026-06-30-0.3.0-multi-agent-system-design.md)
>
> **全局设计笔记：** [docs/design-notes.md](./docs/design-notes.md) §8.5/§8.6/§10/§12

## Goal

0.2.2 将 aptbot 从"可用"演进为"可靠 + 可扩展 + 体验流畅"，引入多 provider 故障转移、配置热重载、hook 系统、JSONL 历史持久化、HttpOnly cookie 安全增强、Skills 系统基础、L1 索引 Skill、/session 动态属性、Channel 接口抽象，同时偿还 0.2.x 遗留技术债，为 0.3.0 多 agent 系统建立扩展性基础。

## Value

- **可靠性**：ring buffer 分片 + LRU 防内存膨胀；turn_busy 给排队反馈；JSONL 持久化支持服务重启后历史回放；HttpOnly cookie 防 XSS。
- **扩展性**：MixinProvider 故障转移提升可用性；Config 热重载免重启调参；Hook 系统支持可插拔扩展；Skills 系统为 0.3.0 agent 独立技能铺路；Channel 抽象为 0.4.0 IM 接入铺路。
- **体验**：Session 自动摘要替代首 20 字符；/session 动态属性支持运行时调参。

## Direction

0.2.x 系列的延续，主题是"可靠性 + 扩展性 + 体验"。0.3.0 多 agent 系统的前置依赖层。永久放弃 CLI/WebUI 拆分，聚焦核心能力。

## Architecture Overview

0.2.2 不改变 MVP 四层架构，在核心层（core）与接入层（access）增加扩展点。设计契约详见 [0.2.2-design.md §3](./docs/superpowers/specs/2026-06-30-0.2.2-design.md#3-核心架构)。

## Global Constraints

- 沿用 0.2.x 全部 Global Constraints（详见 [project_memory](./.trae-cn/memory)）
- 各 task 的技术边界/约束/安全控制详见 [0.2.2-design.md §4](./docs/superpowers/specs/2026-06-30-0.2.2-design.md#4-技术方案与边界)
- **All tasks MUST follow TDD:** 编写失败测试 → 终端见证 RED → 实现 → 见证 GREEN → tsc 0 错误 → `requesting-code-review` skill 审查 → 提交
- **研发流程：** 遵循 [dev-workflow.md](./docs/superpowers/dev-workflow.md)

## Task 列表

### Task 1: per-sessionKey ring buffer 分片 + LRU

- [x] 完成（TDD RED → GREEN → tsc 0 → code-review → commit → 文档同步）

**价值：** 防 0.2.x 单 sessionKey 内存膨胀，全局上限触发 LRU 淘汰，避免 OOM。

**文件：**
- Modify: `src/access/websocket-server.ts`
- Test: `tests/access/websocket-history-replay.spec.ts`

**设计契约：** [0.2.2-design.md §4.1](./docs/superpowers/specs/2026-06-30-0.2.2-design.md#41-task-1--per-sessionkey-ring-buffer-分片--lru)

**行为：** 单 sessionKey 上限 1000 不变；新增全局 50000 上限触发 LRU 淘汰最旧 sessionKey 的全部 buffer；sessionKey refCount 归零时清理。

**TDD 验证：**
- 命令：`npm run test -- tests/access/websocket-history-replay.spec.ts`
- 用例：单 sessionKey 超 1000 截断；全局 50000 触发 LRU 淘汰最旧 sessionKey；refCount 归零时清理对应 buffer；LRU 淘汰后新 sessionKey 可正常写入。

**Commit：** `refactor: shard ring buffer per sessionKey with LRU eviction`

---

### Task 2: turn_busy 响应

- [x] 完成（TDD RED → GREEN → tsc 0 → code-review → commit → 文档同步）

**价值：** 同 sessionKey 排队时给前端"等待中"反馈，避免用户误以为系统卡死。

**文件：**
- Modify: `src/server.ts` (`runInboundLoop`)
- Modify: `src/access/chat-page.ts`
- Test: `tests/server/inbound-serialization.spec.ts`

**设计契约：** [0.2.2-design.md §4.2](./docs/superpowers/specs/2026-06-30-0.2.2-design.md#42-task-2--turn_busy-响应)

**行为：** 同 sessionKey 已有 turn 执行时，新消息入队前发 `{ type: 'turn_busy', position: N }`；turn 完成后不主动发 turn_ready（前端靠 turn_end 恢复）；前端监听 turn_busy 显示"等待中... (前方 N 条消息)"。

**TDD 验证：**
- 命令：`npm run test -- tests/server/inbound-serialization.spec.ts`
- 用例：同 sessionKey 排队时发 turn_busy 且 position 反映队列深度；不同 sessionKey 互不影响；turn_busy 发送失败时静默忽略不阻塞主流程；前端收到 turn_end 后清除等待提示。

**Commit：** `feat: send turn_busy response when messages are queued`

---

### Task 3: JSONL 历史持久化

- [x] 完成（TDD RED → GREEN → tsc 0 → code-review → commit → 文档同步）

**价值：** 服务重启后 ring buffer 清空，从 JSONL 兜底回放历史，保证用户体验连续性。

**文件：**
- Modify: `src/access/websocket-server.ts`
- Modify: `src/core/memory/session-repo.ts`
- Modify: `src/access/chat-page.ts`
- Test: `tests/access/websocket-history-replay.spec.ts`

**设计契约：** [0.2.2-design.md §4.3](./docs/superpowers/specs/2026-06-30-0.2.2-design.md#43-task-3--jsonl-历史持久化)

**行为：** ring buffer 未命中时调用 `readHistoryForReplay(id, limit)` 读 JSONL；仅返回 type === 'message'，不返回 tool_call（避免泄漏内部状态）；标记 `replay: true`，前端不重复渲染；limit 默认 20。**关键约束：** agent 仍受 `data/sessions/` 访问禁令，此路径仅 wsServer 使用。

**TDD 验证：**
- 命令：`npm run test -- tests/access/websocket-history-replay.spec.ts`
- 用例：ring buffer 空时从 JSONL 读取；仅返回 message 类型不含 tool_call；replay 标记触发前端去重；limit 参数生效；JSONL 文件损坏时增量流式解析 + 自动截断修复。

**Commit：** `feat: persist history via JSONL fallback when ring buffer misses`

---

### Task 4: HttpOnly cookie 安全增强

- [x] 完成（TDD RED → GREEN → tsc 0 → code-review → commit → 文档同步）

**价值：** token 从 sessionStorage 迁到 HttpOnly+Secure+SameSite=Strict cookie，防 XSS 窃取。

**文件：**
- Modify: `src/access/websocket-server.ts`
- Modify: `src/access/chat-page.ts`
- Test: `tests/access/auth-api.spec.ts`

**设计契约：** [0.2.2-design.md §4.4](./docs/superpowers/specs/2026-06-30-0.2.2-design.md#44-task-4--httponly-cookie-安全增强)

**行为：** POST /api/register /api/login 成功时设置 Set-Cookie；Cookie 属性 `HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=2592000`；GET /api/me 优先读 cookie，其次 Authorization: Bearer；WebSocket token 优先级 URL ?token= > cookie > sessionStorage；前端 fetch 自动带 cookie（`credentials: 'include'`）。

**TDD 验证：**
- 命令：`npm run test -- tests/access/auth-api.spec.ts`
- 用例：登录成功响应含 Set-Cookie 且属性正确；/api/me 优先读 cookie；WebSocket token 三级优先级生效；cookie 被禁用时 fallback 到 sessionStorage。

**Commit：** `feat: use HttpOnly cookie for token storage to prevent XSS`

---

### Task 5: MixinProvider 多 provider 故障转移

- [x] 完成（TDD RED → GREEN → tsc 0 → code-review → commit → 文档同步）

**价值：** 单 provider 故障时自动切换备 provider，提升可用性；为 0.3.0 不同 agent 用不同 provider 铺路。

**文件：**
- Create: `src/core/provider/mixin-provider.ts`
- Modify: `src/core/provider/types.ts`
- Test: `tests/core/provider/mixin-provider.spec.ts`

**设计契约：** [0.2.2-design.md §4.5](./docs/superpowers/specs/2026-06-30-0.2.2-design.md#45-task-5--mixinprovider-多-provider-故障转移) + [design-notes §12.1](./docs/design-notes.md#L2557)

**行为：** 多 provider 按 priority 串联；前一个失败（fatal 除外）自动 fallback；流式已 yield 后出错不切 provider（避免重复输出）；同协议约束；广播属性到子 provider；springBackMs 后弹回主 provider；所有 provider 失败抛 AggregateError。

**TDD 验证：**
- 命令：`npm run test -- tests/core/provider/mixin-provider.spec.ts`
- 用例：单 provider 成功；retryable 错误（429/5xx）重试 3 次后 fallback；fatal 错误（401/403/400）立即抛出不 fallback；流式已 yield 后出错不切 provider；springBackMs 后弹回主 provider；广播属性到所有子 provider；全部失败抛 AggregateError。

**Commit：** `feat: add MixinProvider with multi-provider failover`

---

### Task 6: Config 热重载

- [x] 完成（TDD RED → GREEN → tsc 0 → code-review → commit → 文档同步）

**价值：** 修改配置文件免重启，运行中 turn 用旧配置，下个 turn 用新配置，避免影响进行中的对话。

**文件：**
- Modify: `src/infrastructure/config-loader.ts`
- Modify: `src/server.ts`
- Test: `tests/infrastructure/config-loader.spec.ts`

**设计契约：** [0.2.2-design.md §4.6](./docs/superpowers/specs/2026-06-30-0.2.2-design.md#46-task-6--config-热重载) + [design-notes §12.2](./docs/design-notes.md#L2683)

**行为：** 监听 `config/aptbot.json` 的 mtimeNs 变化（懒加载，非 fs.watch）；AgentSession 在 beforeTurn 检查 mtimeNs；当前 turn 用旧配置快照，下个 turn 用新配置；校验失败降级到旧配置 + channel 错误通知；stop() 清理资源。

**TDD 验证：**
- 命令：`npm run test -- tests/infrastructure/config-loader.spec.ts`
- 用例：检测 mtimeNs 变化触发重载；运行中 turn 用旧配置快照；下个 turn 用新配置；校验失败降级到旧配置；stop() 清理 watcher 不泄漏。

**Commit：** `feat: hot-reload config via mtimeNs watch`

---

### Task 7: Hook 系统（8 hook 点）

- [x] 完成（TDD RED → GREEN → tsc 0 → code-review → commit → 文档同步）

**价值：** 8 个 hook 点支持可插拔扩展（日志/监控/审计），吞异常不中断主流程，为 0.3.0 注入 agent 个性铺路。

**文件：**
- Create: `src/core/agent/hooks.ts`
- Modify: `src/core/agent/loop.ts`
- Modify: `src/core/agent/session.ts`
- Test: `tests/core/agent/hooks.spec.ts`

**设计契约：** [0.2.2-design.md §4.7](./docs/superpowers/specs/2026-06-30-0.2.2-design.md#47-task-7--hook-系统8-hook-点) + [design-notes §12.3](./docs/design-notes.md#L2773)

**行为：** 8 hook 点（agent_before/after, turn_before/after, llm_before/after, tool_before/after）；同步执行；ctx 允许 mutate（链式传递）；priority 升序排序；两层插件目录（`~/.aptbot/hooks/` + `.agents/hooks/`）；无沙箱；hook 抛错吞掉 + stderr 打印 + 不影响主流程。

**TDD 验证：**
- 命令：`npm run test -- tests/core/agent/hooks.spec.ts`
- 用例：按 priority 升序执行；hook 抛错被吞且主流程不中断；register/unregister 生效；8 个 hook 点均被触发；ctx 链式 mutate 生效；两层目录加载且 workspace 覆盖 builtin。

**Commit：** `feat: add 8-point hook system with priority`

---

### Task 8: Skills 系统基础（§8.5/§8.6）

- [x] 完成（TDD RED → GREEN → tsc 0 → code-review → commit → 文档同步）

**价值：** 建立 Skills 加载/校验/注入基础设施，为 0.3.0 agent 独立技能绑定铺路；MVP/L1 阶段 Skills 系统从未实现，本 task 补齐基础。

**文件：**
- Create: `src/core/skills/types.ts`
- Create: `src/core/skills/loader.ts`
- Create: `src/core/skills/system-prompt.ts`
- Create: `src/core/skills/invocation.ts`
- Create: `src/core/skills/env.ts`
- Test: `tests/core/skills/skill-loader.spec.ts`

**设计契约：** [0.2.2-design.md §4.8](./docs/superpowers/specs/2026-06-30-0.2.2-design.md#48-task-8--skills-系统基础8586) + [design-notes §8.5/§8.6](./docs/design-notes.md#L1209)

**行为：** 两层加载（workspace `~/.aptbot/skills/` + builtin `src/skills/`），workspace 覆盖 builtin 同名；最小 frontmatter（name/description/disableModelInvocation）；校验 name（a-z0-9-, ≤64 字符）+ description（≤1024 字符）；解析失败返回 SkillDiagnostic warning + 跳过该 skill；全量 name+description 注入 system prompt；ExecutionEnv 抽象（cwd/env vars/permissions）。

**TDD 验证：**
- 命令：`npm run test -- tests/core/skills/skill-loader.spec.ts`
- 用例：两层目录加载；workspace 覆盖 builtin 同名；YAML frontmatter 解析（name/description/disableModelInvocation）；name 校验（合法/非法/超长）；description 校验（超长）；frontmatter 损坏返回 SkillDiagnostic warning 且跳过；system prompt 注入 name+description。

**Commit：** `feat: add Skills system with two-layer loading and frontmatter`

---

### Task 9: L1 索引 Skill

- [ ] 完成（TDD RED → GREEN → tsc 0 → code-review → commit → 文档同步）

**价值：** Skills 数量多时用 L1 索引（行数/字节/tags + lastUsed 排序）控制 system prompt token 预算，避免上下文爆炸。

**文件：**
- Modify: `src/core/skills/types.ts` (扩展 Skill 接口)
- Modify: `src/core/skills/system-prompt.ts` (L1 索引生成)
- Modify: `src/core/tools/read.ts` (read_file 特判维护 lastUsed)
- Test: `tests/core/skills/l1-index.spec.ts`

**设计契约：** [0.2.2-design.md §4.9](./docs/superpowers/specs/2026-06-30-0.2.2-design.md#49-task-9--l1-索引-skill) + [design-notes §12.5](./docs/design-notes.md#L2962)

**行为：** Skill 扩展 contentLines/contentBytes/tags/lastUsed 字段；formatSkillsForSystemPrompt 按 lastUsed 降序排序；总 token 超 4K 预算时截断，仅注入 lastUsed 前 N 个 + 全部名字列表；read_file 读取 skill 文件时特判更新 lastUsed；热重载联动（Config 热重载时 Skills 也重载）。

**依赖：** Task 8（Skills 系统基础）

**TDD 验证：**
- 命令：`npm run test -- tests/core/skills/l1-index.spec.ts`
- 用例：索引含 contentLines/contentBytes/tags；按 lastUsed 降序排序；超 4K token 预算截断；read_file 读取 skill 文件后 lastUsed 更新；预算超限时 fallback 到名字列表；热重载触发 Skills 重载。

**Commit：** `feat: add L1 index for skills with lastUsed tracking`

---

### Task 10: Session 自动摘要命名

- [ ] 完成（TDD RED → GREEN → tsc 0 → code-review → commit → 文档同步）

**价值：** LLM 生成 ≤20 字符摘要替代首 20 字符，提升侧边栏可读性；用户手动 /label 优先。

**文件：**
- Modify: `src/core/agent/loop.ts`
- Modify: `src/core/memory/session-repo.ts`
- Modify: `src/infrastructure/storage/file-storage.ts`
- Test: `tests/core/agent/session-summary.spec.ts`

**设计契约：** [0.2.2-design.md §4.10](./docs/superpowers/specs/2026-06-30-0.2.2-design.md#410-task-10--session-自动摘要命名)

**行为：** turn_end 后检查 session 是否已有 label；无 label 时异步调用 LLM 生成摘要（≤20 字符）；摘要 prompt 固定（"Summarize this conversation in ≤20 chars. No punctuation. No quotes."）；用户手动 /label 后跳过自动摘要；LLM 失败不报错，保留默认 label；新增 hasCustomLabel() 方法。

**TDD 验证：**
- 命令：`npm run test -- tests/core/agent/session-summary.spec.ts`
- 用例：turn_end 后无 label 时触发摘要；用户已有 custom label 时跳过；摘要 ≤20 字符；LLM 失败时不报错保留默认 label；异步生成不阻塞主流程。

**Commit：** `feat: auto-generate session summary as default label`

---

### Task 11: /session 动态属性

- [ ] 完成（TDD RED → GREEN → tsc 0 → code-review → commit → 文档同步）

**价值：** 运行时调整 provider 参数（temperature/maxTokens 等）免重启；MixinProvider 广播到所有子 provider；为 0.3.0 agent 级配置铺路。

**文件：**
- Create: `src/core/command/session-attrs.ts`
- Modify: `src/core/command/registry.ts`
- Test: `tests/core/command/session-attrs.spec.ts`

**设计契约：** [0.2.2-design.md §4.11](./docs/superpowers/specs/2026-06-30-0.2.2-design.md#411-task-11--session-动态属性) + [design-notes §12.4](./docs/design-notes.md#L2900)

**行为：** 白名单 5 项（temperature/maxTokens/reasoningEffort/thinkingType/thinkingBudgetTokens）；文件值逃生口（非白名单项写入文件供 agent 读取）；JSON 自动解析（number/boolean/null）；内存态存储；/session.reset 重置所有；MixinProvider 广播属性到子 provider；非法属性值返回错误 + 列出合法值。

**依赖：** Task 5（MixinProvider 广播机制）

**TDD 验证：**
- 命令：`npm run test -- tests/core/command/session-attrs.spec.ts`
- 用例：设置白名单属性生效；读取当前值（/session <attr>）；/session.reset 重置所有；文件值逃生口写入文件；JSON 自动解析（number/boolean/null）；非法属性名拒绝且列出合法值；属性广播到 MixinProvider 子 provider。

**Commit：** `feat: add /session dynamic attributes with MixinProvider broadcast`

---

### Task 12: Channel 接口抽象

- [ ] 完成（TDD RED → GREEN → tsc 0 → code-review → commit → 文档同步）

**价值：** 抽象 Channel 接口为 0.4.0 IM 接入铺路；WebSocket 作为 Channel 实现之一，不影响现有功能。

**文件：**
- Modify: `src/bus/types.ts`
- Modify: `src/bus/channel-manager.ts`
- Test: `tests/bus/channel.spec.ts`

**设计契约：** [0.2.2-design.md §4.12](./docs/superpowers/specs/2026-06-30-0.2.2-design.md#412-task-12--channel-接口抽象) + [design-notes §10](./docs/design-notes.md#L1745)

**行为：** 方案 E 类型化 bus + AgentEventEnvelope；Channel 接口（type/send/close/isAlive）；bindSession(sessionKey, channel) 多对一共享；IM channel 管理 sessionKey 映射无需 ?session= 参数；WebSocket 仍作为 Channel 实现工作。

**TDD 验证：**
- 命令：`npm run test -- tests/bus/channel.spec.ts`
- 用例：Channel 接口定义（type/send/close/isAlive）；bindSession 接受任意 Channel 实现；IM channel 管理 sessionKey 映射；WebSocket 作为 Channel 实现仍正常工作；多 channel 共享同一 sessionKey。

**Commit：** `refactor: abstract Channel interface for IM integration`

---

### Task 13: E2E 回归测试

- [ ] 完成（E2E 全绿 + commit）

**价值：** 端到端验证 0.2.2 全部新功能联动正确，作为封仓前置门禁。

**文件：**
- Test: `tests/e2e/0.2.2-regression.spec.ts`

**设计契约：** [0.2.2-design.md §6](./docs/superpowers/specs/2026-06-30-0.2.2-design.md#6-测试策略)

**依赖：** Task 1-12 全部完成

**行为：** E2E 覆盖：MixinProvider 多 provider 故障转移 / Config 热重载 / Hook 8 点触发 / Skills list_skills + read_skill / /session 动态属性设置 + 广播 / JSONL 历史回放 / HttpOnly cookie 登录 / turn_busy 响应 / Session 自动摘要 / Channel 抽象。

**TDD 验证：**
- 命令：`npm run test -- tests/e2e/0.2.2-regression.spec.ts`
- 用例：覆盖上述 10 项端到端流程，每项至少 1 个 happy path + 1 个 error path。

**Commit：** `test: e2e regression for 0.2.2`

---

### Task 14: 人工 UAT 核验

- [ ] 完成（4 范围全 ✅）

**价值：** 自动化测试无法覆盖真实体验，人工核验本地/VPS/新功能/旧功能 4 范围。

**文件：**
- Create: `docs/superpowers/plans/0.2.2-uat-checklist.md`

**设计契约：** [dev-workflow.md §4 UAT 核验](./docs/superpowers/dev-workflow.md#4-uat-核验)

**依赖：** Task 13

**行为：** 创建 UAT 核验清单文件覆盖 4 范围（本地功能 / VPS 线上 / 新功能逐项 / 旧功能回归）；用户逐项核验，结果记入清单文件；不通过项标记 ❌ 必须修复后重新 UAT。

**TDD 验证：**
- 命令：无（人工核验）
- 用例：4 范围全部 ✅。

---

### Task 15: 封仓

- [ ] 完成（B1-B12 全部通过 + v0.2.2 tag）

**价值：** 文档归档 + 版本号升级 + tag + VPS 部署验证，完成 0.2.2 迭代。

**文件：**
- Modify: `PLAN-0.2.2.md` / `CHANGELOG.md` / `package.json` / `README.md` / `README.zh-CN.md`

**设计契约：** [dev-workflow.md §3 封仓流程](./docs/superpowers/dev-workflow.md#3-封仓流程b-循环全部-task-完成后)

**依赖：** Task 14

**行为：** 执行 B1-B12 封仓流程（npm test 全绿 / tsc 0 错误 / UAT 通过 / CHANGELOG / README 同步 / PLAN 状态更新 / spec+plan 归档 / package.json 升 0.2.2 / 打 v0.2.2 tag / finishing-a-development-branch skill / VPS 部署验证）。

**TDD 验证：**
- 命令：`npm test && npx tsc --noEmit`
- 用例：全绿 + 0 错误 + VPS 线上验证通过。

**Commit：** `feat(0.2.2): complete with reliability and extensibility foundation`

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

### 范围对齐

- 15 task 全部映射到 spec §2.1 范围表 ✓
- 永久放弃 2 项（CLI 增强 / WebUI 拆分 CF Pages）✓
- 推迟 0.4.0 1 项（Telegram 渠道接入）✓
- 新增 3 项为 0.3.0 铺路（Skills 系统 / L1 索引 / /session 动态属性）✓

### 文档边界

- 本 plan 仅含描述性内容（目标/价值/方向/文件路径/行为描述/TDD 命令+用例描述/commit message），无代码块 ✓
- 技术方案/边界/约束/安全控制详见 [0.2.2-design.md](./docs/superpowers/specs/2026-06-30-0.2.2-design.md) ✓
- 研发流程规范详见 [dev-workflow.md](./docs/superpowers/dev-workflow.md) ✓

### 依赖一致性

- Task 9 依赖 Task 8（Skills 系统基础）✓
- Task 11 依赖 Task 5（MixinProvider 广播机制）✓
- Task 13 依赖 Task 1-12 ✓
- Task 14 依赖 Task 13 ✓
- Task 15 依赖 Task 14 ✓

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
