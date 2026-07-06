# aptbot 0.3.0 Implementation Plan — 双轨 Agent 系统

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **研发流程规范：** [docs/superpowers/dev-workflow.md](./docs/superpowers/dev-workflow.md)（P0 准备 / A 每 task 14 步 / B 封仓 12 步 / UAT / 熔断）
>
> **设计文档：** [docs/superpowers/specs/2026-07-06-0.3.0-dual-mode-agent-design.md](./docs/superpowers/specs/2026-07-06-0.3.0-dual-mode-agent-design.md) — 8 节设计 + 决策汇总附录
>
> **全局设计笔记：** [docs/design-notes.md](./docs/design-notes.md)

## Goal

0.3.0 将 aptbot 从「单 agent 多会话」演进为「双轨 agent 系统」：Mode A 通用 agent + skill chip 区显式选 skill，Mode B 专业 agent + 跨 session 共享记忆 + 自动注入。主交互入口为 WebUI（桌面 agent 模式），左侧栏改为 agent 树形结构。统一抽象：Mode A 是 Mode B 的退化特例，两者都是 AgentProfile 实例。

## Value

- **双轨共存**：通用助手即开即用 + 专业 agent 长期积累，满足「临时任务」与「领域专家」两种心智
- **桌面 agent 体验**：左侧 agent 树形结构 + 浮层设置 + skill chip 区，所有操作在 WebUI 完成
- **长期记忆**：专业 agent 跨 session 积累 + KV 缓存自动注入，越用越懂用户
- **审计可追溯**：write_agent_memory 自动写入 + memory.log.jsonl 审计日志

## Direction

0.3.x 系列起点。主题「双轨 agent + 桌面模式」。0.3.1 半自动积累 + Mode A 体验优化，0.3.2 演化（SKILLS.md / STYLE.md）。

## Architecture Overview

不改变四层架构，在 core 层新增 AgentProfile 实体 + agent-memory 子模块，access 层新增 agent-api + skill-api + 浮层 HTML 生成器，webui 层新增 8 个 Lit 组件。SessionMetadata 新增 agentId 必填字段，session 存储路径从 `data/sessions/` 迁移到 `data/users/<userId>/agents/<slug>/sessions/`。详见 [0.3.0-design.md §1-§2](./docs/superpowers/specs/2026-07-06-0.3.0-dual-mode-agent-design.md)。

## Global Constraints

- 沿用 0.2.x 全部 Global Constraints（详见 [project_memory](./.trae-cn/memory)）
- 各 task 的技术边界/约束/安全控制详见 [0.3.0-design.md §7](./docs/superpowers/specs/2026-07-06-0.3.0-dual-mode-agent-design.md#7-错误处理与边界)
- **All tasks MUST follow TDD:** 编写失败测试 → 终端见证 RED → 实现 → 见证 GREEN → tsc 0 错误 → `requesting-code-review` skill 审查 → 提交
- **研发流程：** 遵循 [dev-workflow.md](./docs/superpowers/dev-workflow.md)
- **PLAN 不含代码：** 描述性内容 + 文件路径 + 行为契约 + TDD 验证命令，具体代码在 TDD 阶段根据测试错误驱动编写
- **Agent 必须禁止访问 `data/users/*/agents/*/sessions/`**（systemPrompt 安全约束）
- **跨用户隔离必须校验 `agent.userId === currentUserId`**
- **路径遍历防护：agentSlug 严格正则 `/^[a-z0-9-]{3,64}$/`**

---

## Task 列表

### Task 1: AgentProfile 类型与 schema 定义

- [ ] 完成（TDD RED → GREEN → tsc 0 → code-review → commit → 文档同步）

**价值：** 定义 AgentProfile / AgentType / AgentConfig 等核心类型与 zod schema，作为后续所有 agent 相关模块的类型契约。

**文件：**
- Create: `src/core/agent/agent-profile.ts`
- Test: `tests/core/agent/agent-profile.spec.ts`

**行为契约：**
- 导出 `AgentType = 'default' | 'professional'` 联合类型
- 导出 `AgentProfile` 接口：name / description / userId / type / slug / createdAt / updatedAt / personality（body）/ 可选 LLM 配置字段（model / temperature / maxTokens / reasoningEffort / thinkingType / thinkingBudgetTokens）
- 导出 `AGENT_SLUG_REGEX = /^[a-z0-9-]{3,64}$/` 常量
- 导出 `MAX_MEMORY_SIZE = 8192` 常量（8KB 软上限）
- 导出 `MAX_WRITE_CONTENT_SIZE = 2048` 常量（单次写入 2KB 上限）
- 导出 `MAX_AGENTS_PER_USER = 50` 常量（软上限）
- 导出 zod schema `AgentProfileSchema`：校验 frontmatter 字段类型与格式
- 导出 `parseAgentMd(raw: string): { frontmatter; body }` 函数：解析 AGENT.md 文件（gray-matter 风格，但不引入新依赖，复用现有 yaml 解析或简单解析）
- 导出 `generateSlug(name: string): string` 函数：从 name 生成 slug（中文转拼音或翻译 + 随机短后缀保证唯一）
- 导出 `validateSlug(slug: string): boolean` 函数：正则校验
- 字段校验：name max 64 / description max 120 / personality 无长度限制 / slug 严格正则

**TDD 验证：**
- 合法 frontmatter 解析通过
- 非法 frontmatter（缺字段 / 类型错 / slug 不匹配正则）抛错
- generateSlug 同名 name 多次调用生成不同 slug（随机后缀）
- validateSlug 合法 / 非法用例
- run: `npx vitest run tests/core/agent/agent-profile.spec.ts`
- tsc: `npx tsc --noEmit`

---

### Task 2: AgentStorage — AGENT.md 持久化与读取

- [ ] 完成（TDD RED → GREEN → tsc 0 → code-review → commit → 文档同步）

**价值：** 提供 AgentProfile 的文件系统持久化能力，封装 AGENT.md 的读写与目录管理。

**文件：**
- Create: `src/core/agent/agent-storage.ts`
- Test: `tests/core/agent/agent-storage.spec.ts`

**行为契约：**
- 导出 `AgentStorage` 类，构造参数：`dataDir: string`
- 路径计算：`getAgentDir(userId, slug) => data/users/<userId>/agents/<slug>`
- `getAgent(userId, slug): Promise<AgentProfile | null>`：读取 AGENT.md，解析 frontmatter + body，文件不存在返回 null，损坏文件抛错
- `listAgents(userId): Promise<AgentProfile[]>`：列出用户的所有 agent 目录，逐个读取 AGENT.md，损坏文件 warn 跳过
- `saveAgent(profile: AgentProfile): Promise<void>`：写入 AGENT.md（write-to-tmp + rename 原子操作），自动创建目录
- `deleteAgent(userId, slug): Promise<void>`：删除 agent 目录（递归）
- `exists(userId, slug): Promise<boolean>`：检查 agent 是否存在
- `countAgents(userId): Promise<number>`：统计用户 agent 数量
- per-agentId mutex 串行化并发写入（复用现有 jsonl-mutex 模式或新建 agent-mutex）
- 路径遍历防护：所有路径拼接前校验 userId（UUID）+ slug（正则）

**TDD 验证：**
- 创建 agent → 读取返回相同 profile
- 读取不存在的 agent 返回 null
- 列出多个 agent
- 删除 agent 后目录不存在
- 并发写入同一 agent 串行化（无错乱）
- 路径遍历防护（非法 slug 抛错）
- run: `npx vitest run tests/core/agent/agent-storage.spec.ts`

**依赖：** Task 1（AgentProfile 类型）

---

### Task 3: default agent 自动创建 + 现有 sessions 迁移

- [x] 完成（TDD RED → GREEN → tsc 0 → code-review → commit → 文档同步）

**价值：** 0.3.0 升级时自动迁移现有 sessions 到 default agent，保持向后兼容。

**文件：**
- Create: `src/core/agent/agent-migration.ts`
- Modify: `src/core/agent/session.ts`（首次访问触发 default agent 创建）
- Test: `tests/core/agent/agent-migration.spec.ts`

**行为契约：**
- 导出 `migrateLegacySessions(storage: StorageAdapter, agentStorage: AgentStorage): Promise<MigrationReport>` 函数
- 迁移逻辑：
  - 扫描 `data/sessions/*.jsonl` + `.meta.json`
  - 按 userId 分组：有 userId 的 → 迁移到 `data/users/<userId>/agents/default/sessions/`；无 userId 的 → 生成伪 userId
  - 为每个 userId 创建 default agent 的 AGENT.md（若不存在）：type=default / personality=通用 systemPrompt
  - 更新 .meta.json 添加 `agentId: default`
  - 迁移 session .jsonl + .meta.json 到新路径
- 幂等性：已迁移的 session 不重复迁移（检查目标路径是否存在）
- 幂等性：已创建的 default agent 不重复创建
- 迁移中断后重新运行可继续
- 导出 `ensureDefaultAgent(userId, agentStorage): Promise<AgentProfile>` 函数：用户首次访问时若 default agent 不存在则创建
- MigrationReport 含 migratedSessions / createdAgents / errors 字段

**TDD 验证：**
- 有 userId 的 session 迁移到正确路径
- 无 userId 的 session 生成伪 userId 并迁移
- default agent AGENT.md 自动创建
- 重复运行不重复迁移（幂等）
- 中断后重新运行可继续
- 迁移报告字段正确
- run: `npx vitest run tests/core/agent/agent-migration.spec.ts`

**依赖：** Task 1（类型）+ Task 2（AgentStorage）

---

### Task 4: SessionMetadata 扩展 + session 路径迁移

- [ ] 完成（TDD RED → GREEN → tsc 0 → code-review → commit → 文档同步）

**价值：** SessionMetadata 新增 agentId 必填字段，session 存储路径从 `data/sessions/` 迁移到 `data/users/<userId>/agents/<slug>/sessions/`。

**文件：**
- Modify: `src/core/memory/types.ts`（SessionMetadata 新增 agentId）
- Modify: `src/infrastructure/storage/file-storage.ts`（路径计算 + claimSession 扩展）
- Modify: `src/core/memory/session-repo.ts`（create/open 接受 agentId 参数）
- Test: `tests/core/memory/types.spec.ts`（扩展）
- Test: `tests/infrastructure/storage/file-storage.spec.ts`（扩展）

**行为契约：**
- SessionMetadata 接口新增 `readonly agentId: string` 必填字段
- FileStorage 路径计算从 `data/sessions/<id>.jsonl` 改为 `data/users/<userId>/agents/<agentId>/sessions/<id>.jsonl`
- claimSession 新增 agentId 参数：写入 .meta.json 的 agentId 字段
- SessionRepo.create(userId, agentId) / open(id, userId, agentId) 签名扩展
- 向后兼容：迁移期间 legacy 路径 fallback 读取（与 Task 3 迁移配合）
- 不持久化 activeSkill（spec §3.6 确认不持久化）

**TDD 验证：**
- SessionMetadata 含 agentId 字段
- FileStorage 路径计算正确
- claimSession 写入 agentId
- SessionRepo.create 创建带 agentId 的 session
- run: `npx vitest run tests/core/memory/types.spec.ts tests/infrastructure/storage/file-storage.spec.ts`

**依赖：** Task 3（迁移）

---

### Task 5: skill frontmatter template 字段扩展

- [ ] 完成（TDD RED → GREEN → tsc 0 → code-review → commit → 文档同步）

**价值：** skill frontmatter 新增 template 字段，支持 chip 点击后智能填充输入框。

**文件：**
- Modify: `src/core/skills/types.ts`（SkillFrontmatter + Skill 新增 template 字段）
- Modify: `src/core/skills/loader.ts`（解析 template 字段）
- Test: `tests/core/skills/skill-loader.spec.ts`（扩展）

**行为契约：**
- SkillFrontmatter 新增 `readonly template?: string` 字段
- Skill 新增 `readonly template?: string` 字段
- SkillLoader 解析 frontmatter 时读取 template 字段（可选，未设置时为 undefined）
- template 可含 `{{cursor}}` 占位符标记光标停留位置
- 不新增 display / displayName 字段（UI 层配置，不动 skill 文件）

**TDD 验证：**
- 含 template 字段的 skill 解析正确
- 不含 template 字段的 skill template 为 undefined
- template 含 `{{cursor}}` 占位符原样保留（解析时不处理，运行时处理）
- run: `npx vitest run tests/core/skills/skill-loader.spec.ts`

**依赖：** 无（独立模块）

---

### Task 6: read_agent_memory 工具

- [ ] 完成（TDD RED → GREEN → tsc 0 → code-review → commit → 文档同步）

**价值：** 专业 agent 主动读取 MEMORY.md（用于刷新或分段读取），路径硬编码当前 agentId，禁止跨 agent 访问。

**文件：**
- Create: `src/core/tool/tools/read-agent-memory.ts`
- Test: `tests/core/tool/tools/read-agent-memory.spec.ts`

**行为契约：**
- 实现 `AgentTool` 接口，name=`read_agent_memory`
- 参数：`{ section?: 'user_profile' | 'facts' | 'preferences' | 'history' | 'all' }`，默认 all
- 路径硬编码：`data/users/${currentUserId}/agents/${currentAgentId}/MEMORY.md`，不接受路径参数
- 大小限制：>8KB（MAX_MEMORY_SIZE）返回 `memory_too_large` error，提示按 section 分段读取
- 文件不存在返回空内容（非错误）
- 跨 agent 访问禁止（路径硬编码）
- 工具内部需要 currentUserId + currentAgentId 上下文（通过构造函数注入或闭包捕获）

**TDD 验证：**
- 读取存在的 MEMORY.md 返回内容
- 读取不存在的 MEMORY.md 返回空
- 读取 >8KB 文件返回 memory_too_large
- section 过滤正确（user_profile / facts / preferences / history / all）
- 路径硬编码不接受参数
- run: `npx vitest run tests/core/tool/tools/read-agent-memory.spec.ts`

**依赖：** Task 1（MAX_MEMORY_SIZE 常量）+ Task 4（agentId 上下文）

---

### Task 7: write_agent_memory 工具 + 审计日志

- [ ] 完成（TDD RED → GREEN → tsc 0 → code-review → commit → 文档同步）

**价值：** agent 自主写入 MEMORY.md（无用户确认）+ 审计日志记录所有写入操作。

**文件：**
- Create: `src/core/tool/tools/write-agent-memory.ts`
- Create: `src/core/agent/memory-audit-log.ts`
- Test: `tests/core/tool/tools/write-agent-memory.spec.ts`
- Test: `tests/core/agent/memory-audit-log.spec.ts`

**行为契约：**
- write_agent_memory 工具：
  - name=`write_agent_memory`
  - 参数：`{ section: 'user_profile' | 'facts' | 'preferences' | 'history'; content: string; mode: 'append' | 'replace' }`
  - 自动写入（无确认环节）
  - 单次 content 长度限制：max 2KB（MAX_WRITE_CONTENT_SIZE）
  - 路径硬编码当前 agentId，禁止跨 agent 写入
  - 写入操作：write-to-tmp + rename 原子操作
  - append 模式：追加到指定 section 末尾
  - replace 模式：替换整个 section 内容
  - 写入后记录审计日志
  - 返回写入结果给 agent（含 afterSize）
- MemoryAuditLog 类：
  - 存储路径：`data/users/<userId>/agents/<slug>/memory.log.jsonl`
  - append-only JSONL，复用现有 jsonl-mutex
  - append(record: AuditRecord): Promise<void>
  - list(limit?: number): Promise<AuditRecord[]>
  - AuditRecord 字段：timestamp / sessionId / section / mode / contentPreview（前 200 字符）/ contentLength / beforeSize / afterSize

**TDD 验证：**
- append 模式追加到 section 末尾
- replace 模式替换整个 section
- 单次 content >2KB 拒绝写入
- 路径硬编码不接受参数
- 审计日志正确记录（timestamp / section / mode / contentPreview / contentLength / beforeSize / afterSize）
- 审计日志 list 默认返回最近 20 条
- 并发写入串行化（per-agentId mutex）
- IO 错误时审计日志记录失败 + 工具返回错误
- run: `npx vitest run tests/core/tool/tools/write-agent-memory.spec.ts tests/core/agent/memory-audit-log.spec.ts`

**依赖：** Task 1（MAX_WRITE_CONTENT_SIZE）+ Task 2（AgentStorage）+ Task 6（read_agent_memory 用于 beforeSize）

---

### Task 8: AGENT.md systemPrompt 自动注入 + KV 缓存

- [ ] 完成（TDD RED → GREEN → tsc 0 → code-review → commit → 文档同步）

**价值：** 专业 agent 的 MEMORY.md 自动注入 systemPrompt，使用 KV 缓存避免每 turn 重复 token 计费。

**文件：**
- Create: `src/core/agent/system-prompt-builder.ts`
- Modify: `src/server.ts`（systemPrompt 构建从固定字符串改为动态构建）
- Test: `tests/core/agent/system-prompt-builder.spec.ts`

**行为契约：**
- 导出 `buildSystemPrompt(agent: AgentProfile, memoryContent: string | null): string` 函数
- systemPrompt 结构（前部稳定 + 后部追加）：
  - 固定前部（稳定区）：通用约束 + 工具说明 + 安全约束
  - MEMORY.md 内容（半稳定区）：注入为 `## Agent Memory` section
  - personality body（半稳定区）：agent 个性配置
- KV 缓存设计：
  - 缓存 key = hash(固定前部 + MEMORY.md 内容 + personality)
  - 缓存命中时前部稳定区不重新计费
  - 新记忆追加在 MEMORY.md 末尾（History section 内追加），不破坏前部缓存
  - 仅当 MEMORY.md 前部内容被修改时才触发缓存失效
- 注入策略：default agent 不注入 MEMORY.md（type=default 时 memoryContent=null）
- 注入策略：专业 agent 未启用记忆时不注入（memoryEnabled=false 时 memoryContent=null）
- 注入策略：专业 agent 启用记忆但 MEMORY.md 不存在时注入空内容
- 工具说明、安全约束等固定文本不放在 MEMORY.md 之后（保持前部稳定）

**TDD 验证：**
- default agent systemPrompt 不含 Agent Memory section
- 专业 agent systemPrompt 含 Agent Memory section
- MEMORY.md 不存在时注入空内容
- KV 缓存 key 稳定性（相同内容相同 hash）
- 追加记忆后缓存 key 变化（History section 末尾追加）
- run: `npx vitest run tests/core/agent/system-prompt-builder.spec.ts`

**依赖：** Task 1（AgentProfile）+ Task 2（AgentStorage 读取 MEMORY.md）

---

### Task 9: Agent HTTP API（/api/agents 系列）

- [ ] 完成（TDD RED → GREEN → tsc 0 → code-review → commit → 文档同步）

**价值：** 提供 agent CRUD + memory + memory-log 的 HTTP API，供 WebUI 调用。

**文件：**
- Create: `src/access/agent-api.ts`
- Modify: `src/access/websocket-server.ts`（路由扩展：/api/agents 优先于 /api/*）
- Test: `tests/access/agent-api.spec.ts`

**行为契约：**
- 导出 `handleAgentApi(req, res, pathname, agentStorage, memoryAuditLog, authToken?)` 函数
- 端点：
  - GET /api/agents — 列出当前用户的所有 agents（auth + 跨用户隔离）
  - GET /api/agents/:slug — 获取 agent 详情
  - POST /api/agents — 创建新 agent（专业 agent，含 slug 自动生成）
  - PUT /api/agents/:slug — 更新 agent 配置（personality / LLM / 记忆开关）
  - DELETE /api/agents/:slug — 路由注册 + 403 default 不可删校验；专业 agent 的归档逻辑由 Task 19 实现 archiveAgent 后接入（本 task 仅注册路由 + 返回 501 Not Implemented 作为占位）
  - GET /api/agents/:slug/sessions — 列出该 agent 的 sessions
  - GET /api/agents/:slug/memory — 获取 MEMORY.md 内容
  - GET /api/agents/:slug/memory-log — 获取写入审计日志（默认 20 条，query limit 可调）
- 鉴权：复用现有 authToken 机制（Bearer token）
- 跨用户隔离：所有操作校验 agent.userId === currentUserId，否则 403
- 路径遍历防护：slug 严格正则校验
- 创建 agent：校验 agent 数量上限（MAX_AGENTS_PER_USER，超出 400）
- 路由优先级：/api/agents 优先于 /api/*（与 /api/feedback 同模式）

**TDD 验证：**
- GET /api/agents 无 auth → 401
- GET /api/agents 正确 auth → 200 + agents 列表
- POST /api/agents 创建 agent → 200 + agent 详情
- POST /api/agents 超 50 个 → 400
- PUT /api/agents/:slug 更新 → 200
- DELETE /api/agents/default → 403（不可删）
- DELETE /api/agents/:slug 专业 agent → 501 Not Implemented（归档逻辑在 Task 19 接入）
- 跨用户访问 → 403
- 路径遍历防护（非法 slug → 400）
- GET /api/agents/:slug/memory-log 默认 20 条
- run: `npx vitest run tests/access/agent-api.spec.ts`

**依赖：** Task 2（AgentStorage）+ Task 7（MemoryAuditLog）

---

### Task 10: UI 配置 API（visibleSkills）

- [ ] 完成（TDD RED → GREEN → tsc 0 → code-review → commit → 文档同步）

**价值：** default agent 的 UI 层配置（visibleSkills）API，不动 skill 文件，不动 AGENT.md。

**文件：**
- Create: `src/core/agent/ui-config.ts`
- Modify: `src/access/agent-api.ts`（新增 /api/agents/default/ui-config 端点）
- Test: `tests/core/agent/ui-config.spec.ts`
- Test: `tests/access/agent-api.spec.ts`（扩展）

**行为契约：**
- UiConfig 接口：`{ visibleSkills: Array<{ slug: string; displayName: string }> }`
- UiConfigStorage 类：
  - 存储路径：`data/users/<userId>/agents/default/ui-config.json`
  - get(userId): Promise<UiConfig>
  - update(userId, config: UiConfig): Promise<void>（write-to-tmp + rename）
  - 文件不存在返回空 visibleSkills
  - 文件损坏返回空 visibleSkills + warn
- API 端点：
  - GET /api/agents/default/ui-config — 返回 UI 配置
  - PUT /api/agents/default/ui-config — 更新 UI 配置
- 鉴权 + 跨用户隔离（同 Task 9）
- 仅 default agent 有 ui-config.json（专业 agent 不需要）

**TDD 验证：**
- get 不存在的 ui-config.json 返回空 visibleSkills
- update 后 get 返回相同配置
- 文件损坏返回空 + warn
- GET /api/agents/default/ui-config 无 auth → 401
- PUT 后 GET 返回更新后配置
- run: `npx vitest run tests/core/agent/ui-config.spec.ts tests/access/agent-api.spec.ts`

**依赖：** Task 9（agent-api 路由）

---

### Task 11: Skill HTTP API（/api/skills）

- [ ] 完成（TDD RED → GREEN → tsc 0 → code-review → commit → 文档同步）

**价值：** 列出所有已加载 skill（含 template 字段），供 WebUI skill 配置区显示可选池。

**文件：**
- Modify: `src/access/agent-api.ts`（新增 GET /api/skills 端点）
- Test: `tests/access/agent-api.spec.ts`（扩展）

**行为契约：**
- GET /api/skills — 列出所有已加载 skill
- 返回字段：name / description / template（若有）
- 鉴权：复用 authToken 机制
- 不返回 skill 文件路径等内部信息

**TDD 验证：**
- GET /api/skills 无 auth → 401
- GET /api/skills 正确 auth → 200 + skills 列表
- 含 template 字段
- run: `npx vitest run tests/access/agent-api.spec.ts`

**依赖：** Task 5（template 字段）+ Task 9（agent-api 路由）

---

### Task 12: CLI 命令 /agent + /skill

- [ ] 完成（TDD RED → GREEN → tsc 0 → code-review → commit → 文档同步）

**价值：** CLI 保留必要管理命令（agent 管理 + skill 使用），WebUI 为主交互入口。

**文件：**
- Modify: `src/shared/commands/registry.ts`（注册 /agent + /skill 命令）
- Modify: `src/cli/index.tsx`（Ink 实现）
- Test: `tests/shared/commands/agent-command.spec.tsx`
- Test: `tests/shared/commands/skill-command.spec.tsx`

**行为契约：**
- /agent 命令：
  - `/agent` — 列出所有 agents（标记当前）
  - `/agent <slug>` — 切换到指定 agent
  - `/agent info` — 显示当前 agent 的 AGENT.md 内容
  - `/agent memory-log [limit]` — 列出最近 N 条记忆写入日志（默认 20）
- /skill 命令：
  - `/skill` — 列出所有已加载 skill
  - `/skill use <name>` — 在当前 session 激活 skill（填模板到下次输入）
- 不实现 CLI 创建 / 编辑 / 删除 agent（WebUI 完成）
- 不实现 CLI 编辑 skill 展示配置（WebUI 完成）
- 命令注册到 CommandRegistry（防止下发给 agent）

**TDD 验证：**
- /agent 注册在 CommandRegistry
- /agent 列出所有 agents
- /agent <slug> 切换 agent
- /agent info 显示当前 agent
- /agent memory-log 列出审计日志
- /skill 列出所有 skill
- /skill use <name> 激活 skill
- 未知 /agent <slug> 返回错误 + 列出可用 agents
- run: `npx vitest run tests/shared/commands/agent-command.spec.tsx tests/shared/commands/skill-command.spec.tsx`

**依赖：** Task 2（AgentStorage）+ Task 7（MemoryAuditLog）+ Task 5（SkillLoader）

---

### Task 13: WebUI — 左侧栏树形结构

- [ ] 完成（TDD RED → GREEN → tsc 0 → code-review → commit → 文档同步）

**价值：** 左侧栏从平铺 session 列表改为 agent 树形结构（通用助手根节点 + 专业 agent 子节点 + session 叶节点）。

**文件：**
- Create: `src/webui/components/agent-sidebar.ts`
- Create: `src/webui/components/agent-node.ts`
- Modify: `src/webui/components/session-node.ts`（沿用 0.2.x，加 agentId 归属显示）
- Modify: `src/webui/index.ts`（装配新组件）
- Test: `tests/webui/agent-sidebar.spec.ts`

**行为契约：**
- `<agent-sidebar>` 组件：左侧栏容器，渲染 agent 树形结构
  - 属性：agents（AgentProfile[]）/ sessions（按 agentId 分组）/ currentAgentSlug / currentSessionId
  - 事件：agent-click（切换 agent 展开/折叠）/ session-click（切换 session）/ settings-click（打开设置浮层）/ new-session-click / new-agent-click
- `<agent-node>` 组件：agent 节点
  - 显示：name + ⚙️ 设置按钮 + 折叠/展开箭头
  - 默认展开（显示子会话）
  - 点击 agent 名 → 折叠/展开
  - 点击 ⚙️ → 触发 settings-click 事件
- `<session-node>` 组件（修改）：session 节点
  - 沿用 0.2.x 行为（label / 自动摘要 / relative time / 内联重命名）
  - 新增 agentId 归属显示
  - 点击 → 触发 session-click 事件
- 「+ 新建会话」按钮：每个 agent 节点下
- 「+ 新建专业 agent」按钮：在所有 agent 节点下方
- 样式：沿用 adept tokens CSS 变量 + Inter 字体

**TDD 验证：**
- 渲染多个 agent 节点
- agent 节点默认展开子会话
- 点击 agent 名折叠/展开
- 点击 ⚙️ 触发 settings-click
- 点击 session 触发 session-click
- 当前 agent + session 高亮
- 「+ 新建会话」+「+ 新建专业 agent」按钮存在
- run: `npx vitest run tests/webui/agent-sidebar.spec.ts`

**依赖：** Task 9（agent API 提供数据）

---

### Task 14: WebUI — agent 设置浮层 + 新建 agent 浮层

- [ ] 完成（TDD RED → GREEN → tsc 0 → code-review → commit → 文档同步）

**价值：** agent 设置浮层（通用/专业两种模式）+ 新建专业 agent 浮层，居中 modal + 单页分段。

**文件：**
- Create: `src/webui/components/agent-settings-modal.ts`
- Create: `src/webui/components/new-agent-modal.ts`
- Test: `tests/webui/agent-settings-modal.spec.ts`
- Test: `tests/webui/new-agent-modal.spec.ts`

**行为契约：**
- `<agent-settings-modal>` 组件：
  - 属性：agent（AgentProfile）/ mode（'default' | 'professional'）/ open
  - 通用模式：LLM 配置区 + Skill 展示配置区 + 无 personality + 无删除按钮
  - 专业模式：身份配置区 + 性格配置区 + 记忆配置区 + LLM 配置区 + 删除按钮
  - 居中 modal，约 560px 宽度
  - 半透明黑色背景遮罩，点击遮罩不关闭
  - 底部固定保存 / 取消按钮
  - 保存触发 update 事件（含修改后的配置）
  - 取消触发 close 事件（有未保存内容时确认提示）
  - 删除按钮触发 delete 事件（带确认弹窗）
- `<new-agent-modal>` 组件：
  - 与 settings-modal 共用表单分段（身份/性格/记忆/LLM）
  - 创建按钮触发 create 事件（含新 agent 配置）
  - name 输入框（slug 自动生成，用户不感知）
- LLM 配置区字段：model / temperature / maxTokens / reasoningEffort / thinkingType / thinkingBudgetTokens
- Skill 展示配置区：列出所有已加载 skill，每个有 checkbox + displayName 输入框

**TDD 验证：**
- 通用模式显示 LLM 配置 + Skill 配置，无 personality + 无删除按钮
- 专业模式显示全部配置 + 删除按钮
- 居中 modal 渲染正确
- 保存触发 update 事件
- 取消触发 close 事件
- 删除按钮触发确认弹窗
- 新建 agent 浮层 name 输入 + slug 自动生成
- 创建按钮触发 create 事件
- run: `npx vitest run tests/webui/agent-settings-modal.spec.ts tests/webui/new-agent-modal.spec.ts`

**依赖：** Task 9（agent API）+ Task 10（ui-config API）+ Task 11（skill API）+ Task 13（左侧栏集成）

---

### Task 15: WebUI — skill chip 区 + 模板填充

- [ ] 完成（TDD RED → GREEN → tsc 0 → code-review → commit → 文档同步）

**价值：** 聊天框上方 skill chip 区（仅 default agent 显示），点击后智能填充模板到输入框。

**文件：**
- Create: `src/webui/components/skill-chips-bar.ts`
- Modify: `src/webui/index.ts`（装配 chip 区 + 仅 default agent 显示）
- Test: `tests/webui/skill-chips-bar.spec.ts`

**行为契约：**
- `<skill-chips-bar>` 组件：
  - 属性：visibleSkills（Array<{slug, displayName}>）/ activeSkill（string | null）
  - 仅 default agent 会话显示（专业 agent 会话不渲染）
  - chip 横向平铺，数量多时横向滚动
  - 点击 chip 触发 skill-select 事件（含 skill slug + template）
  - 选中的 chip 高亮（可再点取消）
  - 无 visibleSkills 时 chip 区不渲染
- 模板智能填充逻辑（在 index.ts 或独立工具函数）：
  - 空输入框 → 直接覆盖填入 template
  - 有内容 → 追加 template（含分隔符）
  - template 含 `{{cursor}}` 占位符 → 光标定位到该位置
  - template 不含 `{{cursor}}` → 光标默认在末尾
  - template 为空 → 仅激活 skill（不填入输入框）
- skill 不持久化（一次性使用，刷新页面清空）
- 用户可立即切换其他 skill

**TDD 验证：**
- chip 区仅在 default agent 显示
- chip 显示 displayName
- 点击 chip 触发 skill-select
- 空输入框覆盖填入 template
- 有内容追加 template
- `{{cursor}}` 占位符光标定位
- 无 visibleSkills 时不渲染
- run: `npx vitest run tests/webui/skill-chips-bar.spec.ts`

**依赖：** Task 5（template 字段）+ Task 10（visibleSkills 配置）+ Task 13（agent 类型判断）

---

### Task 16: WebUI — 记忆写入轻量提示

- [ ] 完成（TDD RED → GREEN → tsc 0 → code-review → commit → 文档同步）

**价值：** agent 写入 MEMORY.md 时 UI 展示轻量提示（toast），不打断对话。

**文件：**
- Create: `src/webui/components/memory-write-toast.ts`
- Modify: `src/webui/index.ts`（监听 write_agent_memory 工具调用事件 + 显示 toast）
- Test: `tests/webui/memory-write-toast.spec.ts`

**行为契约：**
- `<memory-write-toast>` 组件：
  - 属性：message（string）/ visible（boolean）
  - 显示位置：聊天区右上角或底部，不打断对话
  - 自动消失（3-5 秒）
  - 样式：轻量提示（如「agent 已更新记忆：Preferences」）
- 监听 write_agent_memory 工具调用事件（通过 AgentEvent 流）
- 显示 section 名称 + 简短预览

**TDD 验证：**
- toast 渲染正确
- visible=true 显示，false 隐藏
- 自动消失（3-5 秒后 visible=false）
- 显示 section 名称
- run: `npx vitest run tests/webui/memory-write-toast.spec.ts`

**依赖：** Task 7（write_agent_memory 工具事件）+ Task 15（WebUI 集成）

---

### Task 17: server.ts 装配 + systemPrompt 约束更新

- [ ] 完成（TDD RED → GREEN → tsc 0 → code-review → commit → 文档同步）

**价值：** server.ts 装配所有新模块 + systemPrompt 安全约束更新（禁止访问 sessions/ + archived-agents/ + ui-config.json）。

**文件：**
- Modify: `src/server.ts`（装配 AgentStorage + MemoryAuditLog + agent-api 路由 + systemPrompt 动态构建）
- Modify: `src/core/agent/system-prompt-builder.ts`（systemPrompt 约束更新）
- Test: `tests/server/`（新增装配测试）

**行为契约：**
- server.ts 实例化：
  - AgentStorage（dataDir 注入）
  - MemoryAuditLog（与 AgentStorage 共享 dataDir）
  - 启动时调用 migrateLegacySessions（Task 3）
- WebSocketServerOptions 注入：
  - agentStorage / memoryAuditLog / handleAgentApi
  - 现有 articleLoader / feedbackStorage 等保留
- systemPrompt 约束更新：
  - 禁止访问 `data/users/*/agents/*/sessions/`（原 `data/sessions/`）
  - 允许通过 read_agent_memory / write_agent_memory 工具访问当前 agent 的 MEMORY.md
  - 禁止访问其他 agent 的 MEMORY.md
  - 禁止访问归档文件夹 `data/users/*/archived-agents/`
  - 禁止访问 ui-config.json
- systemPrompt 动态构建：调用 buildSystemPrompt（Task 8）替代固定字符串

**TDD 验证：**
- AgentStorage 在启动时实例化
- migrateLegacySessions 在启动时调用
- agent-api 路由注册
- systemPrompt 含新约束（禁止 sessions/ + archived-agents/ + ui-config.json）
- systemPrompt 动态构建（不同 agent 不同 systemPrompt）
- run: `npx vitest run tests/server/`

**依赖：** Task 3（迁移）+ Task 8（systemPrompt 构建）+ Task 9（agent-api）

---

### Task 18: config-types 扩展 + AGENT.md LLM 配置字段

- [ ] 完成（TDD RED → GREEN → tsc 0 → code-review → commit → 文档同步）

**价值：** config-types 支持新字段 + AGENT.md frontmatter LLM 配置字段定义。

**文件：**
- Modify: `src/infrastructure/config-types.ts`（如需新增 config 字段）
- Modify: `src/core/agent/agent-profile.ts`（LLM 配置字段定义）
- Test: `tests/infrastructure/config-types.spec.ts`（扩展）
- Test: `tests/core/agent/agent-profile.spec.ts`（扩展）

**行为契约：**
- AgentProfile 接口 LLM 配置字段：model / temperature / maxTokens / reasoningEffort / thinkingType / thinkingBudgetTokens（全部可选）
- zod schema 校验 LLM 配置字段类型
- LLM 配置未设置时 fallback 到 config.defaultModel + 系统 default 值
- config-types 如需新增字段（如 agentEnabled）则扩展，否则不动

**TDD 验证：**
- AgentProfile 含 LLM 配置字段
- zod schema 校验 LLM 字段类型
- LLM 配置未设置时 fallback 正确
- run: `npx vitest run tests/infrastructure/config-types.spec.ts tests/core/agent/agent-profile.spec.ts`

**依赖：** Task 1（AgentProfile 类型）

---

### Task 19: 删除专业 agent 归档流程

- [ ] 完成（TDD RED → GREEN → tsc 0 → code-review → commit → 文档同步）

**价值：** 删除专业 agent 时归档到 `archived-agents/`，不直接删除，保留恢复可能性。

**文件：**
- Modify: `src/core/agent/agent-storage.ts`（新增 archiveAgent 方法）
- Modify: `src/access/agent-api.ts`（DELETE 端点调用归档）
- Test: `tests/core/agent/agent-storage.spec.ts`（扩展）
- Test: `tests/access/agent-api.spec.ts`（扩展）

**行为契约：**
- AgentStorage.archiveAgent(userId, slug): Promise<void>
  - 归档路径：`data/users/<userId>/archived-agents/<slug>-<timestamp>/`
  - 归档包含：AGENT.md + MEMORY.md + sessions/ + memory.log.jsonl
  - 归档操作：先复制到归档路径 + 验证完整性 + 再删除原路径
  - 归档失败时拒绝删除 + 错误提示
- DELETE /api/agents/:slug 端点：
  - 仅专业 agent 可删除（default 返回 403）
  - 调用 archiveAgent
  - 归档后从 active agent 列表移除
  - 返回归档路径
- 归档文件夹保留在 `archived-agents/` 下，不自动清理
- 不实现归档管理 UI（YAGNI）

**TDD 验证：**
- 归档 agent 后原路径不存在
- 归档路径含 AGENT.md + MEMORY.md + sessions/ + memory.log.jsonl
- 归档失败时拒绝删除
- DELETE default agent → 403
- DELETE 专业 agent → 200 + 归档路径
- run: `npx vitest run tests/core/agent/agent-storage.spec.ts tests/access/agent-api.spec.ts`

**依赖：** Task 2（AgentStorage）+ Task 9（agent-api）

---

### Task 20: 封仓收尾 — CHANGELOG / README / ARCHITECTURE / package.json / UAT 核验清单

- [ ] 完成

**价值：** 封仓收尾，文档同步，版本号升级，UAT 核验清单就位。

**文件：**
- Modify: `package.json`（版本升至 0.3.0）
- Modify: `CHANGELOG.md`（新增 0.3.0 版本条目）
- Modify: `README.md` / `README.zh-CN.md`（Features 表 + 双轨 agent 介绍）
- Modify: `ARCHITECTURE.md`（新增 agent/ 模块说明）
- Create: `docs/superpowers/plans/0.3.0-uat-checklist.md`

**行为契约：**
- package.json version: 0.3.0
- CHANGELOG 含 0.3.0 版本条目（双轨 agent + 桌面模式 + skill chip + 共享记忆 + 自动注入 + 审计日志 + 归档 + 迁移）
- README Features 表新增「双轨 Agent 系统」「Skill chip 区」「共享记忆」「桌面模式」行
- ARCHITECTURE 新增 agent/ 模块说明 + 数据模型变更
- UAT 核验清单含 4 类核验（本地功能 / VPS 线上 / 新功能逐项 / 老功能回归）
- git tag v0.3.0

**TDD 验证：**
- 文档内容与实现一致
- UAT 核验清单完整
- run: `npx vitest run`（全量回归）
- tsc: `npx tsc --noEmit`

**依赖：** 所有前序 task 完成

---

## 任务依赖关系

```
Task 1 (类型) → Task 2 (Storage) → Task 3 (迁移) → Task 4 (SessionMetadata)
                                                            ↓
Task 5 (skill template) → Task 11 (skill API)              ↓
                                                            ↓
Task 1 → Task 6 (read_agent_memory) → Task 7 (write + audit) → Task 8 (systemPrompt)
                                                              ↓
Task 9 (agent API) → Task 10 (ui-config API)                  ↓
                       ↓                                     ↓
Task 12 (CLI) ←──────┘                                       ↓
                                                              ↓
Task 13 (左侧栏) → Task 14 (设置浮层) → Task 15 (chip 区) → Task 16 (toast)
                                                              ↓
Task 17 (server 装配) ←──────────────────────────────────────┘
                                                              ↓
Task 18 (config) ← Task 1                                     ↓
                                                              ↓
Task 19 (归档) ← Task 2 + Task 9                              ↓
                                                              ↓
Task 20 (封仓) ← 全部完成
```

## 任务规模预估

- 基础模块（Task 1-8）：8 任务 / ~50-60 测试
- HTTP API（Task 9-11）：3 任务 / ~25-30 测试
- CLI（Task 12）：1 任务 / ~8-10 测试
- WebUI（Task 13-16）：4 任务 / ~30-40 测试
- 装配与收尾（Task 17-20）：4 任务 / ~10-15 测试 + 文档
- 总计：20 任务 / ~123-155 测试

## 风险与缓解

1. **迁移风险**：现有 sessions 迁移可能中断。缓解：幂等设计 + 备份 + 迁移中断可重新运行
2. **KV 缓存实现复杂度**：systemPrompt 前部稳定 + KV 缓存命中。缓解：Task 8 实施时先确认 provider 是否支持 prompt caching，若不支持则降级为简单拼接（无 KV 缓存）
3. **slug 自动生成**：中文 name 转 slug 算法。缓解：Task 1 实施时选简单方案（如 UUID 短前缀 + name 解耦），不依赖中文转拼音库
4. **WebUI 组件复杂度**：8 个新组件 + 浮层交互。缓解：分 task 实施，每 task 独立测试
5. **systemPrompt 约束更新**：禁止访问 sessions/ 路径变更。缓解：与 Task 3 迁移配合，迁移完成后旧路径不存在

## Self-Review

**1. Spec coverage:**
- §1 总体架构 → Task 1-4（基础架构）+ Task 13-16（WebUI）✅
- §2 AgentProfile 数据模型 → Task 1-2 + Task 18 ✅
- §2.8 新建浮层 → Task 14 ✅
- §2.9 设置浮层 → Task 14 ✅
- §2.10 LLM 配置分层 → Task 18 + Task 4（session 级覆盖沿用 0.2.x）✅
- §3 Mode A skill UI → Task 5 + Task 10 + Task 11 + Task 15 ✅
- §4 Mode B 共享记忆 → Task 6 + Task 7 + Task 8 + Task 16 ✅
- §5 迁移 + API + 删除 → Task 3 + Task 9 + Task 19 ✅
- §6 左侧栏 + 组件 → Task 13 + Task 14 + Task 15 + Task 16 ✅
- §6.4 CLI → Task 12 ✅
- §7 错误处理 → 各 task 的 TDD 验证覆盖 ✅
- §8 测试策略 → 各 task 的 TDD 验证 + Task 20 UAT ✅

**2. Placeholder scan:**
- 无 TBD / TODO / "implement later" ✅
- 无 "Add appropriate error handling" ✅
- 无 "Write tests for the above"（每个 task 含具体 TDD 验证）✅
- 无 "Similar to Task N"（每个 task 独立描述）✅

**3. Type consistency:**
- AgentProfile 类型在 Task 1 定义，Task 2/8/9/14 使用一致 ✅
- agentSlug 正则在 Task 1 定义，Task 2/9 使用一致 ✅
- MAX_MEMORY_SIZE / MAX_WRITE_CONTENT_SIZE / MAX_AGENTS_PER_USER 在 Task 1 定义，Task 6/7/9 使用一致 ✅
- SessionMetadata.agentId 在 Task 4 定义，Task 3/9 使用一致 ✅
- SkillFrontmatter.template 在 Task 5 定义，Task 11/15 使用一致 ✅
- UiConfig 在 Task 10 定义，Task 14 使用一致 ✅
- MemoryAuditLog 在 Task 7 定义，Task 9/12 使用一致 ✅

---

**文档状态**：20 个 task 全部定义，依赖关系清晰，self-review 通过。待用户审阅后进入 subagent-driven-development 阶段。
