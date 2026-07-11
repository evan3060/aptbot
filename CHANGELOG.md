# Changelog

本文件记录 aptbot 各版本变更。格式遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循 [Semantic Versioning](https://semver.org/lang/zh-CN/)。

## [0.3.2] - 2026-07-10

aptbot 0.3.2 首页博客子域名接入 + 研发流程规范升级。将首页"知识"/"学习入口"链接从站内 `/learn` 切换到已上线的 `blog.aptbot.de` 子域名，采用路径式 i18n 路由（中文 `/`、英文 `/en/`）与首页语言设置同步。同步升级通用研发规范至 v1.1，新增代码清晰度三审章节与 plan 文件位置统一。

### Changed

#### 首页博客子域名接入
- `src/access/landing-page.ts`：nav 链接 / Hero CTA / knowledge CTA / chapter more / 文章卡片共 5 处链接从 `/learn` 改为 `https://blog.aptbot.de/`（路径式路由）
- i18n 文案更新：zh `知识` → `博客`、`学习入口` → `博客`；en `Learn` → `Blog`、`Learning Hub` → `Blog`
- `applyLang()` JS 逻辑：语言切换时动态更新所有 `.blog-link` 与 `.article-card[data-slug]` 的 href，中文指向 `https://blog.aptbot.de/<slug>`、英文指向 `https://blog.aptbot.de/en/<slug>`
- Hero secondary CTA 改为条件渲染（仅 `learnEnabled=true` 时显示），避免 v0.2.2 兼容模式污染
- `tests/access/landing-page.spec.ts`：3 处断言同步更新 + 新增中文路径验证用例

### Added

#### 研发流程规范 v1.1
- `docs/superpowers/dev-workflow.md` 第 5.5 节「代码清晰度三审」：合并前强制执行三轮检查（去重 → 拆分 → 统一），对应 B2.5 步骤
  - 第一轮去重：跨文件重复逻辑（≥5 行在 2+ 文件出现）抽取公共模块
  - 第二轮拆分：函数 >50 行或多个抽象层级按职责拆分
  - 第三轮统一：命名 / 错误处理 / 导入顺序与项目规范对齐，无规范时抽取到 `docs/coding-conventions.md`
- 第 8 节「跨项目迁移兼容性检查」：aptblog 独立项目迁移 learn 文章场景的规范
- P2 约束：每个版本（含 patch）必须新开 `feat/<version>` 分支

#### plan 文件位置统一
- 4 个 plan 文件从根目录迁移到 `docs/superpowers/plans/`，命名规范化为 `YYYY-MM-DD-<version>-<topic>.md`
- `CHANGELOG.md` / `README.md` / `README.zh-CN.md` / design 文档中所有 plan 引用同步更新

## [0.3.1] - 2026-07-10

aptbot 0.3.1 WebUI 移动端适配。将 0.3.0 完成的 React WebUI 从桌面专用布局扩展为响应式，覆盖手机（<768px）/ 平板 / 桌面（≥768px）三档视口。核心特性为侧边栏抽屉化与 InputArea 快捷指令自动缩放，其余组件做间距 / 字号 / 全屏化适配。基于 [docs/superpowers/specs/2026-07-09-0.3.1-mobile-adaptation-design.md](./docs/superpowers/specs/2026-07-09-0.3.1-mobile-adaptation-design.md) 实施，[PLAN-0.3.1](./docs/superpowers/plans/2026-07-09-0.3.1-mobile-adaptation.md) 共 12 task 全部完成 + 人工验收通过。

### Added

#### Task 1-2 — 基建 hook
- `src/webui-react/lib/use-media-query.ts`：`useIsDesktop()` hook，matchMedia('(min-width: 768px)') + resize 监听，SSR 安全
- `src/webui-react/lib/use-quick-actions-layout.ts`：`computeQuickActionsLayout()` 纯函数 + `useQuickActionsLayout()` hook，贪心填充算法 + ResizeObserver 测量容器宽度 + 溢出按钮折叠到「更多」面板
- `tests/webui-react/use-media-query.test.ts`：5 个单元测试
- `tests/webui-react/use-quick-actions-layout.test.ts`：8 个单元测试（6 算法 + 2 hook wrapper）

#### Task 3 — App.tsx 协调层
- `sidebarOpen` state + `isDesktop` from useIsDesktop
- body 滚动锁（sidebarOpen && !isDesktop 时 overflow hidden）
- Esc 键关闭抽屉
- main margin `ml-64` → `md:ml-64`（移动端占满宽度）
- 4 个 handler 自动关闭抽屉（handleSelectSession / handleSelectAgent / handleCreateSession / handleStartNewSessionWithAgent）

#### Task 4-5 — 侧边栏抽屉化 + Backdrop + Hamburger
- Sidebar 接收 isDesktop / isOpen / onClose props，移动端 transform translate-x 抽屉动画
- Backdrop 遮罩（z-30 bg-black/30 backdrop-blur，点击关闭）
- Hamburger 移动端顶栏（lucide Menu 图标 + agent 名称）
- SessionItem 删除 / 重命名按钮移动端常显（opacity-100 md:opacity-0 md:group-hover:opacity-100）

#### Task 6 — ChatArea 响应式
- 根容器 padding `p-3 sm:p-4 md:p-6 lg:p-8`
- 代码块 `overflow-x-auto` + `text-xs md:text-sm`（移动端横滑）
- NewSessionPicker `grid-cols-1 md:grid-cols-2`
- EmptyState 辅助文案 `hidden md:block`
- InlineToolCalls 紧凑字号

#### Task 7 — InputArea 适配 + 快捷指令自动缩放
- 下拉框移动端 collapsible（⚙️ 设置 toggle + max-h transition）
- textarea `text-base`（防 iOS 缩放）+ `min-h-[60px] md:min-h-[80px]`
- 快捷指令区 ResizeObserver 测量 + useQuickActionsLayout 自动缩放
- 「更多 ⋯」按钮 + 弹出面板（grid grid-cols-3 md:grid-cols-4，click-outside 关闭）
- Bug fix: useLayoutEffect deps `[]` → `[activeAgentSlug === 'default']`（切换 agent 后 remount 导致 containerWidth 卡 0）

#### Task 8 — FooterBar 精简
- 移动端单行 + 色点 + 短文字（conn / wait / close / disc）
- model 名 `truncate max-w-[120px] md:max-w-none`
- 字号 `text-[10px] md:text-xs`

#### Task 9 — 模态移动端全屏化
- AuthModal：移动端 `fixed inset-0 rounded-none` + `text-base` 输入 + `w-full` 按钮
- AgentModals：移动端全屏 + sticky header（× + 标题）+ sticky footer（保存 / 取消）
- MemoryToast：移动端顶部全宽 banner `top-0 left-0 right-0 rounded-none`

#### Task 10 — UAT 测试
- `tests/uat/mobile-adaptation-uat.spec.ts`：8 个 Playwright UAT 场景（桌面布局 / 移动布局 / 抽屉打开 / 抽屉关闭-遮罩 / 抽屉关闭-选会话 / 快捷指令缩放 / AuthModal 全屏 / AgentModals 全屏）
- 桌面回归 10/10 通过 + vitest 1781/1783（2 pre-existing flaky）+ tsc 0

### Fixed
- 移动端浏览器「网站有风险」提示（根因）：learn / feedback / landing / chat 页面引用了 `https://fonts.googleapis.com` 外部资源，Google Fonts 在大陆被 GFW 干扰导致加载失败触发风险提示。全站移除 Google Fonts 引用，改用系统字体栈（Inter → system-ui / PingFang SC / Microsoft YaHei fallback）
- 移动端浏览器「网站有风险」提示（辅助）：通过 `res.writeHead` 拦截器在请求处理器入口全局注入安全 headers（HSTS / X-Content-Type-Options / X-Frame-Options / Referrer-Policy），覆盖所有响应类型（HTML / API JSON / 404 / 静态资源 / HEAD）
- HEAD 请求返回 404 问题：新增 HEAD 路由处理（/, /demo, /learn, /feedback），返回 200 + 安全 headers（无 body），修复 `curl -I` 返回 404 的诊断误报

### Test Coverage
- vitest: 1782/1783 pass（1 pre-existing webui DOM flaky）
- Playwright UAT: 8/8 mobile + 10/10 desktop regression
- tsc: 0 errors

## [0.3.0] - 2026-07-06

aptbot 从「单 agent 多会话」演进为「双轨 agent 系统」。八大主题：双轨 agent（Mode A 通用 + Mode B 专业）+ 桌面模式（WebUI 为唯一主交互入口，左侧栏 agent 树形结构）+ skill chip 区（仅 default agent，点击填模板）+ 共享记忆（professional agent 跨 session MEMORY.md）+ 自动注入（systemPrompt builder + KV 缓存 key 稳定性）+ 审计日志（append-only JSONL memory.log.jsonl）+ 归档（archiveAgent 复制 + 验证 + 删除）+ 迁移（legacy `data/sessions/` 自动迁移到新数据模型）。基于 [docs/superpowers/specs/2026-07-06-0.3.0-dual-mode-agent-design.md](./docs/superpowers/specs/2026-07-06-0.3.0-dual-mode-agent-design.md) 实施，[docs/superpowers/plans/2026-07-06-0.3.0-dual-mode-agent.md](./docs/superpowers/plans/2026-07-06-0.3.0-dual-mode-agent.md) 共 20 task 全部完成。统一抽象：Mode A 是 Mode B 的退化特例，两者都是 AgentProfile 实例。

### Added

#### Task 1 — AgentProfile 类型与 schema
- `src/core/agent/agent-profile.ts`：核心类型契约
  - `AgentType = 'default' | 'professional'` 联合类型
  - `AgentProfile` 接口：name / description / userId / type / slug / createdAt / updatedAt / personality（body）/ 可选 LLM 配置字段（model / temperature / maxTokens / reasoningEffort / thinkingType / thinkingBudgetTokens）/ `memoryEnabled`（Task 18）
  - `AGENT_SLUG_REGEX = /^[a-z0-9-]{3,64}$/` 路径遍历防护常量
  - `MAX_MEMORY_SIZE = 8192`（8KB 软上限）/ `MAX_WRITE_CONTENT_SIZE = 2048`（2KB 单次写入上限）/ `MAX_AGENTS_PER_USER = 50`（软上限）
  - zod `AgentProfileSchema`：校验 frontmatter 字段类型与格式
  - `parseAgentMd(raw)`：解析 AGENT.md（gray-matter 复用 0.2.3 依赖，无新依赖）+ zod schema 校验
  - `generateSlug()`：`agent-<6-hex-chars>` 算法（与 name 解耦，避免 pinyin 依赖；6 位 hex ≈ 1677 万组合，单用户 50 上限冲突概率可忽略，冲突时由 AgentStorage 重试）
  - `validateSlug(slug)`：正则校验

#### Task 2 — AgentStorage 持久化
- `src/core/agent/agent-storage.ts`：`AgentStorage` 类
  - 路径：`<dataDir>/users/<userId>/agents/<slug>/AGENT.md`
  - 原子写（write-to-tmp + rename）+ per-agentId mutex 串行化（5000ms 超时 + ghost acquisition 释放防死锁）
  - `getAgent` / `listAgents`（损坏文件 warn 跳过）/ `saveAgent` / `deleteAgent` / `exists` / `countAgents` / `findAgentOwner`（跨用户 403 检测）
  - 路径遍历防护：`USER_ID_REGEX`（UUID v4）+ `AGENT_SLUG_REGEX`
  - `withAgentLock` 导出供 write_agent_memory 工具复用
- 数据模型变更：sessions 从 `data/sessions/` 迁移到 `data/users/<userId>/agents/<slug>/sessions/`

#### Task 3 — 默认 agent 自动创建 + legacy sessions 迁移
- `src/core/agent/agent-migration.ts`：迁移逻辑
  - `migrateLegacySessions(dataDir, agentStorage)`：扫描 legacy `data/sessions/*.jsonl` + `.meta.json`，按 userId 分组迁移到 `data/users/<userId>/agents/default/sessions/`；无 userId 的 session 生成伪 UUID
  - `ensureDefaultAgent(userId, agentStorage)`：用户首次访问时创建 default agent（type=default / personality=通用 systemPrompt）
  - 幂等性：已迁移 session 不重复迁移；已创建 default agent 不重复创建
  - 中断恢复：atomic write-to-tmp + rename，中断后重新运行可继续
  - `MigrationReport`：含 `migratedSessions` / `createdAgents` / `errors` 字段
- 与 spec 偏离：实际签名 `(dataDir, agentStorage)` 而非 `(storage, agentStorage)`（StorageAdapter 不暴露文件路径）

#### Task 4 — SessionMetadata 扩展 + session 路径迁移
- `src/core/memory/types.ts`：`SessionMetadata` 新增 `readonly agentId: string` 必填字段
- `src/infrastructure/storage/file-storage.ts`：路径计算从 `data/sessions/<id>.jsonl` 改为 `data/users/<userId>/agents/<agentId>/sessions/<id>.jsonl`；`claimSession` 新增 agentId 参数
- `src/core/memory/session-repo.ts`：`create(userId, agentId)` / `open(id, userId, agentId)` 签名扩展
- 向后兼容：迁移期间 legacy 路径 fallback 读取
- 不持久化 `activeSkill`（spec §3.6 确认）

#### Task 5 — skill frontmatter template 字段
- `src/core/skills/types.ts`：`SkillFrontmatter` + `Skill` 新增 `template?: string` 字段（可选，含 `{{cursor}}` 占位符标记光标位置，运行时处理）
- `src/core/skills/loader.ts`：解析 template 字段
- 不新增 display / displayName 字段（UI 层配置，不动 skill 文件）

#### Task 6 — read_agent_memory 工具
- `src/core/tool/tools/read-agent-memory.ts`：实现 `AgentTool` 接口
  - 参数：`{ section?: 'user_profile' | 'facts' | 'preferences' | 'history' | 'all' }`，默认 all
  - 路径硬编码：`data/users/${currentUserId}/agents/${currentAgentId}/MEMORY.md`，不接受路径参数
  - 大小限制：>8KB（`MAX_MEMORY_SIZE`）返回 `memory_too_large` error，提示按 section 分段读取
  - 文件不存在返回空内容（非错误）；跨 agent 访问禁止

#### Task 7 — write_agent_memory 工具 + 审计日志
- `src/core/tool/tools/write-agent-memory.ts`：
  - 参数：`{ section: 'user_profile' | 'facts' | 'preferences' | 'history'; content: string; mode: 'append' | 'replace' }`
  - 自动写入（无用户确认）；单次 content 上限 2KB（`MAX_WRITE_CONTENT_SIZE`）
  - 路径硬编码当前 agentId；write-to-tmp + rename 原子操作；返回 afterSize 给 agent
- `src/core/agent/memory-audit-log.ts`：`MemoryAuditLog` 类
  - 路径：`<dataDir>/users/<userId>/agents/<slug>/memory.log.jsonl`
  - append-only JSONL，复用 `withJsonlLock` 串行化；list 默认返回最近 20 条
  - `AuditRecord` 字段：timestamp / sessionId / section / mode / contentPreview（前 200 字符）/ contentLength / beforeSize / afterSize

#### Task 8 — AGENT.md systemPrompt 自动注入 + KV 缓存
- `src/core/agent/system-prompt-builder.ts`：
  - `buildSystemPrompt(agent, memoryContent)`：前部稳定（STABLE_PREFIX 通用约束 + 安全约束）+ 半稳定区（`## Agent Memory` section + `## Personality` section）
  - `computeSystemPromptCacheKey(agent, memoryContent)`：`sha256(stablePrefix + (memoryContent ?? '') + personality)` → hex；turn 间比较此 key 命中 KV 缓存不重复计费
  - 注入规则：default agent 永不注入；professional + memoryEnabled + memoryContent !== null 时注入；MEMORY.md 末尾追加（History section）不破坏前部缓存
- `src/server.ts`：systemPrompt 构建从固定字符串改为动态调用 `buildSystemPrompt`

#### Task 9 — Agent HTTP API
- `src/access/agent-api.ts`：`handleAgentApi` 函数
  - 端点：GET `/api/agents` / GET `/api/agents/:slug` / POST `/api/agents` / PUT `/api/agents/:slug` / DELETE `/api/agents/:slug`（Task 19 接入归档）/ GET `/api/agents/:slug/sessions` / GET `/api/agents/:slug/memory` / GET `/api/agents/:slug/memory-log`
  - 鉴权：复用现有 authToken（Bearer token）
  - 跨用户隔离：所有操作校验 `agent.userId === currentUserId`，否则 403
  - 路径遍历防护：slug 严格正则校验；超 `MAX_AGENTS_PER_USER` 400
  - 路由优先级：`/api/agents` 优先于 `/api/*`（与 `/api/feedback` 同模式）

#### Task 10 — UI 配置 API（visibleSkills）
- `src/core/agent/ui-config.ts`：`UiConfigStorage` 类
  - 路径：`<dataDir>/users/<userId>/agents/default/ui-config.json`（仅 default agent）
  - `VisibleSkill { slug; displayName }` + `UiConfig { visibleSkills }`
  - `get` / `update`（write-to-tmp + rename）；文件不存在 / 损坏返回空 visibleSkills + warn
  - 不需要 per-agentId mutex（仅 default，文件粒度小）
- `src/access/agent-api.ts`：新增 GET / PUT `/api/agents/default/ui-config` 端点

#### Task 11 — Skill HTTP API
- `src/access/agent-api.ts`：新增 GET `/api/skills` 端点（列出所有已加载 skill，返回 name / description / template；不返回文件路径）

#### Task 12 — CLI /agent + /skill 命令
- `src/shared/commands/registry.ts` + `src/cli/index.tsx`：注册 `/agent` 与 `/skill`
  - `/agent`（列出）/ `/agent <slug>`（切换）/ `/agent info`（当前 AGENT.md）/ `/agent memory-log [limit]`（审计日志，默认 20）
  - `/skill`（列出）/ `/skill use <name>`（激活 skill 填模板）
  - 不实现 CLI 创建 / 编辑 / 删除 agent（WebUI 完成）
  - 命令注册到 CommandRegistry 防止下发给 agent

#### Task 13 — WebUI 左侧栏树形结构
- `src/webui/components/agent-sidebar.ts` + `agent-node.ts`：`<agent-sidebar>` 容器 + `<agent-node>` 节点
  - 属性：agents / sessions（按 agentId 分组）/ currentAgentSlug / currentSessionId
  - 事件：agent-click（折叠/展开）/ session-click / settings-click / new-session-click / new-agent-click
  - 默认展开；当前 agent + session 高亮；「+ 新建会话」+「+ 新建专业 agent」按钮
- `src/webui/components/session-node.ts`：沿用 0.2.x，加 agentId 归属显示
- 样式：沿用 adept tokens CSS 变量 + Inter 字体

#### Task 14 — agent 设置浮层 + 新建 agent 浮层
- `src/webui/components/agent-settings-modal.ts` + `new-agent-modal.ts`：居中 modal
  - 通用模式：LLM 配置区 + Skill 展示配置区 + 无 personality + 无删除
  - 专业模式：身份 + 性格 + 记忆 + LLM 配置区 + 删除按钮（带确认弹窗）
  - 560px 宽度 + 半透明遮罩（点击不关闭）+ 底部保存/取消
  - LLM 字段：model / temperature / maxTokens / reasoningEffort / thinkingType / thinkingBudgetTokens
  - Skill 配置区：checkbox + displayName 输入框

#### Task 15 — skill chip 区 + 模板填充
- `src/webui/components/skill-chips-bar.ts`：`<skill-chips-bar>` 组件
  - 仅 default agent 显示（专业 agent 不渲染）；chip 横向平铺，多时横向滚动
  - 选中 chip 高亮（可再点取消）；无 visibleSkills 时不渲染
  - 模板填充：空输入框 → 覆盖；有内容 → 追加；`{{cursor}}` → 光标定位；空 template → 仅激活
  - skill 不持久化（一次性使用，刷新清空）

#### Task 16 — 记忆写入轻量提示
- `src/webui/components/memory-write-toast.ts`：`<memory-write-toast>` 组件
  - 显示位置：聊天区右上角或底部，不打断对话
  - 自动消失（3-5 秒）；样式「agent 已更新记忆：Preferences」
  - 监听 write_agent_memory 工具调用事件（通过 AgentEvent 流）+ 显示 section 名 + 简短预览

#### Task 17 — server.ts 装配 + systemPrompt 约束更新
- `src/server.ts`：实例化 AgentStorage + MemoryAuditLog + 启动调用 `migrateLegacySessions` + 注入 WebSocketServerOptions（agentStorage / memoryAuditLog / handleAgentApi）
- systemPrompt 安全约束更新（在 STABLE_PREFIX 内）：
  - 禁止访问 `data/users/*/agents/*/sessions/`（原 `data/sessions/`）
  - 禁止访问 `data/users/*/archived-agents/`
  - 禁止访问 ui-config.json
  - 允许通过 read_agent_memory / write_agent_memory 工具访问当前 agent 的 MEMORY.md
  - 禁止访问其他 agent 的 MEMORY.md

#### Task 18 — config-types 扩展 + AGENT.md LLM 配置字段
- `src/core/agent/agent-profile.ts`：`AgentProfile` 接口与 `AgentProfileSchema` 新增 LLM 配置字段（model / temperature / maxTokens / reasoningEffort / thinkingType / thinkingBudgetTokens）+ `memoryEnabled` 字段
- LLM 配置未设置时 fallback 到 `config.defaultModel` + 系统默认值
- `memoryEnabled` 缺省视为 true（仅 professional 生效；default 永不注入）；false 时 systemPrompt 不注入 MEMORY.md

#### Task 19 — 删除专业 agent 归档流程
- `src/core/agent/agent-storage.ts`：`archiveAgent(userId, slug)` 方法
  - 归档路径：`data/users/<userId>/archived-agents/<slug>-<timestamp>/`
  - 行为：先 `cpSync` 递归复制 → 验证完整性（文件数对比 + AGENT.md 必须存在于归档）→ 验证通过删除原目录；失败清理归档目录 + 抛错拒绝删除
  - per-agentId 锁内执行，串行化并发 archiveAgent
  - cpSync 失败时清理归档路径防脏数据
- `src/access/agent-api.ts`：DELETE `/api/agents/:slug` 端点接入归档（仅 professional；default 返回 403）

#### Task 20 — 封仓收尾
- `package.json` 版本升至 `0.3.0`
- CHANGELOG / README / README.zh-CN / ARCHITECTURE 文档同步
- UAT 核验清单 `docs/superpowers/plans/0.3.0-uat-checklist.md` 就位
- 全量回归测试通过

### Security

- 路径遍历防护：所有 agent 路径操作校验 `userId`（UUID v4）+ `slug`（`AGENT_SLUG_REGEX`）
- 跨用户隔离：所有 agent API 校验 `agent.userId === currentUserId`，否则 403
- systemPrompt 约束：禁止 agent 访问 `data/users/*/agents/*/sessions/` / `data/users/*/archived-agents/` / `ui-config.json`
- 跨 agent 访问禁止：read_agent_memory / write_agent_memory 路径硬编码当前 agentId
- 单次写入上限：`MAX_WRITE_CONTENT_SIZE = 2048`（2KB）；记忆总量上限：`MAX_MEMORY_SIZE = 8192`（8KB）
- 归档原子性：复制 + 验证 + 删除，失败拒绝删除原目录
- AGENT.md 原子写：write-to-tmp + rename + per-agentId mutex 串行化
- 审计日志 append-only：所有 write_agent_memory 操作记录 timestamp / sessionId / section / mode / contentPreview / contentLength / beforeSize / afterSize

### Test Coverage

- 全量测试 `npx vitest run` 通过（含 ~2 pre-existing auth-api ECONNRESET flaky 失败，已知时序问题非 0.3.0 引入）
- 类型检查 `npx tsc --noEmit` 0 错误
- 新增测试覆盖：agent-profile / agent-storage / agent-migration / memory-audit-log / system-prompt-builder / ui-config / read-agent-memory / write-agent-memory / agent-api / agent-command / skill-command / agent-sidebar / agent-settings-modal / new-agent-modal / skill-chips-bar / memory-write-toast / server wiring

### Release Finalization（封仓收尾）

- 设计文档 [docs/superpowers/specs/2026-07-06-0.3.0-dual-mode-agent-design.md](./docs/superpowers/specs/2026-07-06-0.3.0-dual-mode-agent-design.md) 已就位
- 实施计划 [docs/superpowers/plans/2026-07-06-0.3.0-dual-mode-agent.md](./docs/superpowers/plans/2026-07-06-0.3.0-dual-mode-agent.md) Task 1-20 全部完成
- CHANGELOG / README / README.zh-CN / ARCHITECTURE 文档同步
- UAT 核验清单 [docs/superpowers/plans/0.3.0-uat-checklist.md](./docs/superpowers/plans/0.3.0-uat-checklist.md) 就位
- `package.json` 版本升至 `0.3.0`
- git tag `v0.3.0` 由 finishing 步骤单独处理（本版本未在本 commit 创建）

### React WebUI 重设计（0.3.0 增量）

基于 [docs/superpowers/plans/2026-07-07-react-webui-redesign.md](./docs/superpowers/plans/2026-07-07-react-webui-redesign.md) 实施，10 task 全部完成。将原 Lit Web Components 实现替换为 React 18 + TypeScript 重构，提升组件复用性与状态管理清晰度。

#### Added — React WebUI 重设计

- `src/webui-react/`：全新 React 18 实现
  - `App.tsx`：根组件 + 状态管理（useReducer + coreReducer）+ WebSocket 客户端集成
  - `components/Sidebar.tsx`：侧边栏（agent 列表 + session 列表 + NewSessionPicker 智能体选择卡片 + session 重命名/删除）
  - `components/ChatArea.tsx`：聊天区（消息渲染 + InlineToolCalls 折叠工具调用 + streaming 状态）
  - `components/InputArea.tsx`：输入区（快捷指令 + agent/model/思考深度选择）
  - `components/AgentModals.tsx`：agent 创建/编辑弹窗
  - `components/MemoryToast.tsx`：记忆写入 toast 通知
  - `components/FooterBar.tsx`：底部状态栏
  - `lib/reducer.ts`：核心 reducer（消息复用 + 空消息清理 + toolCalls 合并）
  - `lib/ws-client.ts`：WebSocket 客户端（session_changed 自动重连）
  - `lib/api.ts`：API 客户端
- `src/webui-react/index.html` + `src/webui-react/main.tsx`：React 入口
- `scripts/build-webui-react.mjs`：Vite 构建脚本

#### Fixed — UAT bug 修复（Round 1-4）

- **Bug A-D**：删除会话递归清理 + 新建会话 NewSessionPicker 流程 + 专用 agent 会话归属 + session 重命名
- **Bug E-G**：多工具调用空消息合并 + 输入框工具提示移除 + 专用 agent 角色身份保持
- **Bug H-J**：工具调用内联展示 + 历史会话加载（JSONL 优先于 ring buffer）+ agent 切换时 agentId 同步
- **Bug K-M**：工具调用无空 assistant 消息 + React.memo 防闪烁 + 重进会话工具调用记录保持
- **Bug M round 2**：readHistoryForReplay 保留含 toolCalls 的 assistant 消息（不再过滤）
- **Bug N**：NewSessionPicker 状态下直接输入消息创建新 default 会话
- **多用户 currentAgentSlug 状态泄漏**：server.ts runInboundLoop 中 userId 变化时重置 currentAgentSlug

#### Changed — UAT 测试适配 OpenCode free 模型

- `config/aptbot.json` / `config/aptbot.uat.json`：切换到 OpenCode free 模型（`https://opencode.ai/zen/v1` + `deepseek-v4-flash-free`）
- UAT 测试 `waitForTurnEnd` 增加 3s 二次确认，避免工具调用 turn 间隙 data-streaming 瞬时 false 导致过早判定完成
- UAT 测试放宽 assistant 消息数量断言（OpenCode 模型可能在工具调用前输出非空文本）
- UAT 测试增加超时（reasoning_content 阶段耗时较长）
- vitest `websocket-history-replay.spec.ts` 更新测试匹配 Bug I/M 修复后的行为

### Test Coverage（增量）

- Playwright UAT 27/27 通过（含 6 个 bug-fix UAT 场景 + 10 个 React WebUI UAT 场景）
- vitest 1769/1770 通过（1 个 pre-existing auth-api ECONNRESET flaky 失败，单独跑通过）
- `npx tsc --noEmit` 0 错误

---

## [0.2.3] - 2026-07-02

aptbot 从"个人 agent 工具"扩展为"边用边学的 agent 学习教材"。新增知识体系（19 篇文章 + 2 Track）+ 用户反馈区（Web 表单 + JSONL 存储 + CLI 管理）。文章以 markdown + frontmatter 存储，运行时 marked 渲染；反馈 append-only JSONL 持久化，CLI `/feedback` 命令列表/详情/resolve/archive/stats。配置项 `learnPage`（默认 false，opt-in）+ `feedbackEnabled`（默认 true）控制启用范围，clone 用户零影响。基于 [docs/superpowers/specs/2026-07-01-0.2.3-learn-system-design.md](./docs/superpowers/specs/2026-07-01-0.2.3-learn-system-design.md) 实施。

### Added

#### 知识体系（learn system）
- 19 篇结构化文章，两个 Track 独立编号：
  - Track 1「Agent 体系实践」13 篇（入门 2 + 核心特性深入 8 + 可靠性/UX 1 + 实战 1 + 演进路线 1），围绕 aptbot 项目展开，从 agent 原理到实现到演进路线
  - Track 2「AI 辅助编码实践」6 篇（开发流程 / 编码准确性 / spec 文档管理 / 长期迭代维护 / 边界与问题 / 方法与持续改进），与具体项目无关的通用方法论
- 文章存储：`src/learn/articles/*.md` markdown 源 + YAML frontmatter（slug / title / description / track / chapter / order / difficulty / estimatedReadingTime / status / prerequisites / lastUpdated / tags）
- `src/learn/article-types.ts`：`ArticleMetaSchema`（zod）+ `Article` / `ArticleState` / `ArticleNav` / `TrackMeta` + `TRACKS` 注册表（未来扩展 Track 3 只需追加一项）
- `src/learn/article-loader.ts`：`ArticleLoader` 类（load / getState / getBySlug / getArticleNav）；gray-matter 解析 + zod 校验 + 唯一性校验；marked@15 渲染 published 文章并缓存 htmlString；planned 跳过渲染；mtimeNs 懒加载热重载（与 v0.2.2 Config 热重载模式对齐）+ per-loader mutex 串行化
- 校验失败行为：stderr warning（含文件名 + zod 错误详情）+ 跳过该文件，不阻塞启动

#### 文章重写与插图（v0.2.3 最终轮）
- Track 1 全部 12 篇文章重写：统一使用「方案 A/B/C」代称替代具体工具名，增加概念→方案设计→方案对比→设计特点→发展方向→小结结构，难度降为入门/初学
- Track 2 全部 6 篇文章重写：同上结构化重写，去除 superpower 专属命名
- 所有文章增加对比表格，面向对 AI 辅助开发了解甚少的群体
- 20 张插图图像（1024×1024），使用 AI 文生图生成，存储于 `src/learn/articles/images/`
- 每张图片配套 prompt 文件（同名 `.md`），便于后续重新生成或调优
- 图片 CSS 优化：最大 640×640 居中显示，自适应文章宽度

#### 双语文章支持（中/英）
- 18 篇文章全部翻译为英文（`*.en.md`），slug 与中文版一致
- `article-types.ts` 新增 `ArticleLang` 类型（`'zh' | 'en'`）
- `article-loader.ts`：`bySlug` 键名改为 `slug:lang` 复合键；新增 `getBySlugAndLang()`；`getArticleNav()` 支持语言过滤
- `websocket-server.ts`：新增 `resolveLang(req)` 函数（URL query → cookie → Accept-Language → zh）
- `learn-page.ts`：列表页/文章页/反馈页全线支持 lang 参数传递；卡片链接自动附加 `?lang=`
- 语言切换策略：`?lang=en` 查询参数 > `aptbot.lang` cookie > `Accept-Language` header > 默认 zh

#### 知识体系 i18n（界面翻译）
- 三个学习页面（列表/文章/反馈）全部添加 `data-i18n` 属性 + `LEARN_I18N` 中英双语字典
- `learnApplyLang()` 函数支持 `data-i18n`、`data-i18n-placeholder`、`data-i18n-title-suffix` 扩展属性
- `SERVER_LANG` 服务端注入，客户端首次加载与服务端渲染语言一致，随后用 localStorage 偏好覆盖
- Nav 链接、Footer、章节标题、筛选按钮、反馈表单占位符等全部双语

#### 英文版 i18n 完善修复（v0.2.3 收尾轮）
- **服务端直接渲染英文**：合并三个 `LEARN_I18N` 字典为顶层常量 + `t(key, lang)` 函数，模板内所有 `data-i18n` 元素按 lang 参数直接渲染对应语言文本，消除客户端 JS 交换导致的中文闪烁（FOC）
- **首页知识区双语卡片**：`renderKnowledgeSection` 按 `lang === 'zh'` 过滤文章（18 张卡片非 36 张），每张卡片嵌入 `data-zh` / `data-en` 属性；`applyLang()` 扩展支持 `[data-en]` 元素即时切换 + 文章卡片 href 自动附加 `?lang=` 参数
- **Track 标题/描述双语**：`TrackMeta` 新增 `titleEn` / `descriptionEn`，列表页数据条与首页知识区按 lang 选择对应语言
- **难度标签双语**：`DIFFICULTY_LABELS` 改为 `{ beginner: { zh: '入门', en: 'Beginner' }, ... }`
- **列表页按语言过滤**：`totalArticles`、`trackCount`、`tracksHtml` 均按 `a.lang === currentLang` 过滤，避免中英双版本文章混在同一列表
- **新增 i18n 键**：`article.minutes`（分钟/min）、`list.subtitleSep`（中英文逗号）、`learn.comingSoon`（敬请期待/coming soon）
- **/feedback 路由语言参数**：`websocket-server.ts` 中 `/feedback` 路由调用 `resolveLang(req)` 并传给 `createFeedbackHtml(lang)`
- **英文文章正文清理**：18 篇 `.en.md` 共 233 处中文字符全部修正为英文（追求/pursue、沉淀/consolidate、强制/mandatorily、闭环/closed loop 等）；Track 2 英文版文章 `chapter: 方法论` → `chapter: Methodology`
- **安全响应头增强**：所有 HTML 响应新增 `strict-transport-security` / `x-frame-options: DENY` / `referrer-policy` 头
- **article-loader 噪音消除**：跨语言同 order 不再触发 duplicate order 警告（仅同语言重复才警告）

#### 用户反馈区（v0.2.3 第 2 轮）
- 访客可在文章页底部或 `/feedback` 通用反馈页提交想法 / bug / feature request
- `src/infrastructure/feedback-storage.ts`：`FeedbackStorage` 类（append / list / moderate / findById）+ `FeedbackEntry` 接口
- `src/access/feedback-api.ts`：`handleFeedbackApi` 函数 + per IP 限流
- `src/access/learn-page.ts`：三个纯字符串 HTML 生成器
- 首页落地页新增「学习入口」按钮替代「查看 GitHub」

#### /feedback CLI 命令
- `src/shared/commands/feedback.ts`：注册到 `CommandRegistry`，Ink 表格输出
- 子命令：list / all / detail / resolve / archive / stats

#### 配置与路由
- `src/infrastructure/config-types.ts`：`AptbotConfig` 新增 `learnPage` + `feedbackEnabled`（同 v0.2.2 模式）
- `src/access/websocket-server.ts`：路由分发扩展（/learn / /learn/:slug / /feedback / /api/feedback）
- `src/access/landing-page.ts`：新增第 6 section「知识」+ nav「知识」链接 + Hero 副标题 + 数据条

### Dependencies
- 新增 `marked@^15.0.12`：markdown 运行时渲染
- 新增 `gray-matter@^4.0.3`：markdown frontmatter 解析

### Security
- 文章源文件由开发者维护（信任边界内），不引入 DOMPurify
- 反馈区 per IP 限流（10/min + 60/hour）+ message 长度限制 2000 字符
- 反馈存储复用既有 JSONL 增量流式解析 + 破损行容错

### Test Coverage
- 新增 7 个测试文件
- 类型检查 `tsc --noEmit` 0 错误
- 全量测试 1228 passed / 81 files（auth-api 1 项 flaky ECONNRESET 为既有时序问题）
- API 路由测试 32 passed（含语言解析路由回归）
- learn-page 测试 94 passed / landing-page 测试 39 passed（含双语卡片 data-zh/data-en 契约）

### Release Finalization（封仓收尾）
- 设计文档 [docs/superpowers/specs/2026-07-01-0.2.3-learn-system-design.md](./docs/superpowers/specs/2026-07-01-0.2.3-learn-system-design.md) 已就位
- 实施计划 [docs/superpowers/plans/2026-07-01-0.2.3-learn-system.md](./docs/superpowers/plans/2026-07-01-0.2.3-learn-system.md) Task 1-9 全部完成
- CHANGELOG / README / deployment.md 同步更新
- `package.json` 版本升至 `0.2.3`
- 双语文章翻译 18 篇 `.en.md` 文件 + 20 张插图 + 20 个 prompt 文件
- 首页落地页「学习入口」按钮
- 知识页面全线 i18n 界面翻译 + 英文版 i18n 完善修复（服务端渲染 + 双语卡片 + 正文清理）
- 安全响应头增强（HSTS / X-Frame-Options / Referrer-Policy）
- git tag `v0.2.3` + PR to main 已提交
- VPS 部署验证：aptbot.de 线上英文版全页面无中文混入，安全头生效

---

## [0.2.2] - 2026-07-01

aptbot 从"可用"演进为"可靠 + 可扩展 + 体验流畅"。引入 10 项核心能力：多 provider 故障转移、配置热重载、Hook 系统、JSONL 历史持久化、HttpOnly cookie 安全增强、Skills 系统基础、L1 索引 Skill、/session 动态属性、Channel 接口抽象、Session 自动摘要命名。基于 [docs/superpowers/specs/2026-06-30-0.2.2-design.md](./docs/superpowers/specs/2026-06-30-0.2.2-design.md) 实施，为 0.3.0 多 agent 系统建立扩展性基础。

### Added

#### Task 1 — per-sessionKey ring buffer 分片 + LRU
- 单 sessionKey 上限 1000 不变；新增全局 50000 上限触发 LRU 淘汰最旧 sessionKey 的全部 buffer
- sessionKey refCount 归零时清理对应 buffer，防 0.2.x 单 sessionKey 内存膨胀与 OOM

#### Task 2 — turn_busy 响应
- 同 sessionKey 已有 turn 执行时，新消息入队前发 `{ type: 'turn_busy', position: N }`
- 前端监听 turn_busy 显示"等待中... (前方 N 条消息)"，避免用户误以为系统卡死
- turn 完成后不主动发 turn_ready，前端靠 turn_end 恢复

#### Task 3 — JSONL 历史持久化
- ring buffer 未命中时调用 `readHistoryForReplay(id, limit)` 读 JSONL 兜底回放历史
- 仅返回 type === 'message'，不返回 tool_call（避免泄漏内部状态）
- 标记 `replay: true`，前端不重复渲染；limit 默认 20
- JSONL 文件损坏时增量流式解析 + `fs.truncateSync` 自动截断修复

#### Task 4 — HttpOnly cookie 安全增强
- POST /api/register /api/login 成功时设置 Set-Cookie
- Cookie 属性 `HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=2592000`（HTTP localhost 下 Secure 条件性省略）
- GET /api/me 优先读 cookie，其次 Authorization: Bearer
- WebSocket token 三级优先级：URL ?token= > cookie > sessionStorage
- 前端 fetch 自动带 cookie（`credentials: 'include'`），cookie 被禁用时 fallback 到 sessionStorage

#### Task 5 — MixinProvider 多 provider 故障转移
- 多 provider 按 priority 串联；前一个失败（fatal 除外）自动 fallback
- 流式已 yield 后出错不切 provider（避免重复输出）
- 同协议约束；广播属性到子 provider
- `springBackMs` 后弹回主 provider；所有 provider 失败抛 AggregateError
- TTFB 5000ms + 块间 1500ms 流式控制器（沿用）

#### Task 6 — Config 热重载
- 监听 `config/aptbot.json` 的 mtimeNs 变化（懒加载，非 fs.watch）
- AgentSession 在 beforeTurn 检查 mtimeNs；当前 turn 用旧配置快照，下个 turn 用新配置
- 校验失败降级到旧配置 + channel 错误通知；stop() 清理资源

#### Task 7 — Hook 系统（8 hook 点）
- 8 hook 点：`agent_before/after` / `turn_before/after` / `llm_before/after` / `tool_before/after`
- 同步执行；ctx 允许 mutate（链式传递）；priority 升序排序
- 两层插件目录（`~/.aptbot/hooks/` + `.agents/hooks/`），workspace 覆盖 builtin
- 无沙箱；hook 抛错吞掉 + stderr 打印 + 不影响主流程

#### Task 8 — Skills 系统基础
- 两层加载（workspace `~/.aptbot/skills/` + builtin `src/skills/`），workspace 覆盖 builtin 同名
- 最小 frontmatter（name/description/disableModelInvocation）
- 校验 name（a-z0-9-, ≤64 字符）+ description（≤1024 字符）
- 解析失败返回 SkillDiagnostic warning + 跳过该 skill
- 全量 name+description 注入 system prompt
- ExecutionEnv 抽象（cwd/env vars/permissions）

#### Task 9 — L1 索引 Skill
- Skill 扩展 contentLines/contentBytes/tags/lastUsed 字段
- `formatSkillsForSystemPrompt` 按 lastUsed 降序排序
- 总 token 超 4K 预算时截断，仅注入 lastUsed 前 N 个 + 全部名字列表
- `read_file` 读取 skill 文件时特判更新 lastUsed
- 热重载联动（Config 热重载时 Skills 也重载，server.ts SkillState.reload()）

#### Task 10 — Session 自动摘要命名
- turn_end 后异步调用 LLM 生成 ≤20 字符摘要替代首 20 字符
- 摘要 prompt 固定："Summarize this conversation in ≤20 chars. No punctuation. No quotes."
- 用户手动 /label 后永久跳过自动摘要（labelSource='custom'）
- LLM 失败不报错，保留默认 label
- race condition 修复：LLM resolves 后 re-check hasCustomLabel，避免覆盖用户中途设置的 custom label

#### Task 11 — /session 动态属性
- 白名单 5 项：temperature / maxTokens / reasoningEffort / thinkingType / thinkingBudgetTokens
- 文件值逃生口（非白名单项写入 `<dataDir>/session-attrs/<sessionId>/<key>`）
- JSON 自动解析（number/boolean/null）；内存态存储
- /session.reset 重置所有；MixinProvider 广播属性到子 provider
- 非法属性值返回错误 + 列出合法值（validValues / validRange）
- 路径穿越防护（isSafeAttrName 正则 + `..` 段拒绝）

#### Task 12 — Channel 接口抽象
- 方案 E 类型化 bus + AgentEventEnvelope
- `TransportChannel` 接口（type/send/close/isAlive）作为最小传输接口
- `wrapTransportChannel` 适配器桥接 TransportChannel 到 bus-facing Channel
- `bindSession(sessionKey, channel)` 多对一共享；IM channel 管理 sessionKey 映射无需 ?session= 参数
- WebSocket 仍作为 Channel 实现正常工作
- channel 死亡时自动 unbind（isAlive? 可选方法 + dispatchEnvelope 失败后检查）

### Fixed

- 修复 SkillState 在 server.ts 中未接线（building blocks 存在但未 wire）：热重载不触发 Skills 重载、read_file 不更新 lastUsed、system prompt 缺 L1 索引
- 修复 l1-index 测试同义反复（用实现自身公式验证实现 → 改为具体期望值 6 行 / 29 字节）
- 修复 /label 与 in-flight 自动摘要 race condition（LLM resolves 后 re-check hasCustomLabel）
- 修复 /session 错误消息未列出合法值（添加 validValues / validRange）
- 修复 E2E 测试中无操作测试（zero expect）与伪装成 E2E 的纯函数测试

### Test Coverage

- 74 测试文件 / 938 用例（935 通过 + 3 个 auth-api ECONNRESET flaky，单跑 30/30 全绿）
- E2E 回归测试 37/37 全绿，覆盖 10 项新功能 happy + error path
- 类型检查 `tsc --noEmit` 0 错误（基线 15 在 Task 9 修复时顺手清掉）
- UAT 核验 71/77 通过（6 项 VPS 待部署后核验），0 不通过项

### Release Finalization（封仓收尾）

- `package.json` 版本升至 `0.2.2`
- 设计文档 [docs/superpowers/specs/2026-06-30-0.2.2-design.md](./docs/superpowers/specs/2026-06-30-0.2.2-design.md) 已就位
- 实施计划 [docs/superpowers/plans/2026-07-01-0.2.2-main.md](./docs/superpowers/plans/2026-07-01-0.2.2-main.md) Task 1-14 全部完成，状态 ✅ COMPLETED
- UAT 核验清单 [docs/superpowers/plans/0.2.2-uat-checklist.md](./docs/superpowers/plans/0.2.2-uat-checklist.md) 71/77 通过
- 打 `v0.2.2` git tag
- VPS 部署验证推迟到 0.2.3 一起部署

---

## [0.2.1] - 2026-06-30

aptbot.de 落地页 + Demo 页 adept.ai 风格克隆。新增 opt-in 落地页（5 sections + 中/英 i18n），将现有 agent demo 页迁移到同一视觉语言（13 CSS 变量 + Inter 字体 + pill 按钮）。基于 [docs/superpowers/specs/2026-06-30-aptbot-de-landing-page-design.md](./docs/superpowers/specs/2026-06-30-aptbot-de-landing-page-design.md) 实施。版本隔离：`landingPage === true` 严格 opt-in，clone 自部署用户零影响。

### Added

#### 落地页（landing-page.ts）
- `createLandingPageHtml()` 导出纯字符串函数，5 sections（Hero / Features / Architecture / Use Cases / CTA）+ Nav + Footer
- 13 个 adept.ai 真实 CSS design tokens（Phase 1 Reconnaissance 提取）：白底 + 深绿 `rgb(13,113,73)` + Inter 字体 + 细体大字
- 中/英双语 i18n：`data-i18n` 属性 + JS 字典（50 keys），URL hash + localStorage 记忆选择，默认中文
- Nav 粘性顶栏：始终半透明 `rgba(255,255,255,0.85)` + `backdrop-filter: blur(8px)`，`.scrolled` 加 border-bottom + box-shadow
- 数据条复刻 adept "Eval" 标签：`584` tests / `4` layered architecture / `8` hook extension points / `MIT` license

#### Demo 页风格迁移（chat-page.ts）
- `<style>` 顶部新增 `:root` 13 CSS 变量块（与 landing-page.ts 一致）
- 所有硬编码颜色替换为 `var(--token-name)`
- 字体 `system-ui` → `Inter, system-ui, "PingFang SC", sans-serif`
- 按钮 `#new-session-btn` / `#send` / `.submit-btn` 圆角 `6px` → `9999px`（pill）
- `prefers-reduced-motion` 守护 + focus outline 可访问性
- DOM 结构 / WebSocket 客户端逻辑 / 中文文案零改动

#### 路由与配置
- `websocket-server.ts` 新增 `/demo` 路由（宽松匹配 `/demo` / `/demo/` / `/demo/index.html`）+ `serveDemoHtml` option
- `config-types.ts` 新增 `landingPage?: boolean` opt-in 字段（Zod schema + interface），`defaultConfig` 不加（undefined → false）
- `server.ts` 根据 `aptbotConfig.landingPage === true` 选择 HTML：landing 模式 `/` 返回 landing、`/demo` 返回 chat；默认模式 `/` 返回 chat、`/demo` 返回 404

#### 移动端适配（验收期增补）
- chat-page.ts sidebar 抽屉化：`@media (max-width: 768px)` sidebar 转 `position: fixed` + `transform: translateX(-100%)`，SVG hamburger 按钮 + backdrop 遮罩（`backdrop-filter: blur(2px)`）
- v2 精致化：`box-shadow: 0 0 24px rgba(0,0,0,0.18)` 浮动感 + `cubic-bezier(0.4, 0, 0.2, 1)` 过渡 + sidebar 280px `max-width: 85vw`
- 移动端 `messages` / `input-bar` 显式 `max-width: 100%`（移除继承的 900px 桌面限制）
- JS 绑定：hamburger 切换 / backdrop 点击关闭 / 移动端 session 项点击后自动收起
- landing-page.ts 移动端字体/椭圆框精致化（`@media (max-width: 767px)`）：body 16px、btn-pill 16px/10px 24px（147×44）、hero h1 36px、section h2-lg 28px、eval-value 28px、card 文字紧凑

### Fixed

- 修复 nav 滚动文字叠加：默认背景 `rgba(0,0,0,0)` 透明 + `.scrolled` 的 `var(--surface-translucent)` 在 computed style 中未生效 + 移动端 IntersectionObserver 触发时机太晚 → 改为始终 `rgba(255,255,255,0.85)` + `backdrop-filter: blur(8px)`，`.scrolled` 仅加 border-bottom + box-shadow 做视觉分层
- 修复 a11y 对比度：`#status.disconnected` 文字色 `var(--decor-red)` `rgb(254,190,191)` 在 `rgba(254,190,191,0.3)` 背景上对比度 1.1:1 不可读 → 改为 `var(--text-primary)`
- 修复移动端 sidebar 挤压：390 视口下 sidebar 固定 260px 导致 main 仅剩 130px + 横向滚动条（scrollWidth 537 vs clientWidth 390）→ 抽屉化 + main 占满视口

### Test Coverage

- 66 测试文件 / 687 用例全部通过（原 651 + 增补 36）
- 新增 6 个测试文件：landing-page.spec.ts (15) / landing-page-i18n.spec.ts (5) / landing-page-mobile.spec.ts (14) / landing-page-nav-scroll.spec.ts (5) / chat-page-mobile.spec.ts (17) / chat-page-adept-theme.spec.ts (25) / routing-landing.spec.ts (8) / routing-default.spec.ts (4)
- 现有 websocket-server.spec.ts 分组改造（+5 landingPage 配置组）
- 类型检查 `tsc --noEmit` 0 错误
- playwright 视觉验证：1440/768/390 三视口，hero h1 72px/-3.6px/64.8px 确认

### Release Finalization（封仓收尾）

- `package.json` 版本升至 `0.2.1`
- 设计文档 [docs/superpowers/specs/2026-06-30-aptbot-de-landing-page-design.md](./docs/superpowers/specs/2026-06-30-aptbot-de-landing-page-design.md) 含验收增补章节
- 实施计划 [docs/superpowers/plans/2026-06-30-aptbot-de-landing-page.md](./docs/superpowers/plans/2026-06-30-aptbot-de-landing-page.md) 7 task 全部完成
- VPS 部署验证：aptbot.de + demo.aptbot.de 均通过 HTTPS 验证，TLS 证书扩展包含子域名（有效期 2026-09-28，自动续期）

---

## [0.2.0] - 2026-06-29

L1 迭代封仓：用户系统 + 多客户端同步 + Codex 风格侧边栏 + 会话重命名。13 任务 + 会话重命名增强 + agent session ownership 修复，58 测试文件 / 584 测试通过 / `tsc` 0 错误。基于 [docs/superpowers/plans/2026-06-29-l1-user-system.md](./docs/superpowers/plans/2026-06-29-l1-user-system.md) 与设计 [docs/superpowers/specs/2026-06-29-l1-user-system-multi-client-design.md](./docs/superpowers/specs/2026-06-29-l1-user-system-multi-client-design.md) 实施。

### Added

#### Phase 0 — VPS 部署遗留补齐
- `chat-page.ts` 首次连接成功后记忆 token 至 `sessionStorage`，刷新/重连自动携带，标签页关闭即清除
- `docs/deployment.md` 补齐 VPS 实践（SSH 加固、sudoers 限定 systemctl/journalctl、Caddy 反代、WebSocket 鉴权）
- README 中英文版本 Deployment 章节链接到 `docs/deployment.md`

#### Phase 1 — 用户系统
- `UserStorage` (`src/infrastructure/user-storage.ts`)：`scrypt` 密码哈希 + `users.jsonl` 持久化 + per-file mutex
- HTTP 认证 API：`POST /api/register` / `POST /api/login` / `GET /api/me`（Bearer token）
- WebSocket 认证中间件：用户 token > authToken > 匿名 UUID 三级身份识别，常量时间比较防时序攻击
- I2 修复：连接建立早期缓冲消息，identifyUser 完成后切换正式处理器，防止认证期间消息丢失

#### Phase 2 — 会话隔离与关联
- `ConnectionState.sessionKey` 路由：`?session=<id>` 显式指定或服务端生成，`broadcast()` 仅向同 sessionKey 的 connection 发送
- `SessionMetadata.userId` 字段 + `listSessions(userId?)` 按 owner 过滤
- `claimSession` / `getSessionOwner` / `SessionAlreadyClaimedError` 严格 ownership 模型
- localStorage `aptbot:sessionId` 持久化 + `session_changed` 事件 + WebSocket 重连
- `sendToSessionKey(sessionKey, msg)` 控制消息直发通道（不进 ring buffer / 不走 AgentEvent union）
- `/label` 命令 + `updateSessionLabel(id, label)` sidecar `.meta.json` 存储

#### Phase 3 — 多客户端同步
- per-sessionKey 入站消息串行化：`runningTurns: Map<sessionKey, Promise>` 同 session 排队、不同 session 并行，无 `turn_busy` 响应
- ring buffer 历史回放：入站 + 出站双 buffer，新连接（`lastEventSeq=0`）合并排序回放最近 N 条（默认 20，可调 `?historyLimit=`）
- presence 直发：连接建立/断开时 wsServer 直接向同 sessionKey 其他 connection 广播 `{ type: 'presence', onlineCount: N }`

#### Phase 4 — UI 增强
- 仿 Codex 左侧 session 侧边栏：260px 宽度、新会话按钮、相对时间、当前 session 高亮
- `GET /api/sessions?token=` HTTP API：按 userId 过滤、updatedAt 降序
- 底部用户信息（username / "匿名用户"）+ 登出按钮
- 会话重命名（增强）：3-dot `⋮` 菜单 + inline 编辑 + Enter 保存 / Esc 取消
- `POST /api/sessions/:id/label` 端点 + ownership 校验
- `session_renamed` 控制消息通过 `sendToSessionKey` 广播给同 session 其他客户端，触发 `loadSessionList()` 刷新

#### Phase 5 — 端到端验证
- `tests/e2e/l1-auth-isolation.spec.ts`：注册/登录/token 校验/session 隔离完整流程
- `tests/e2e/l1-multi-client-sync.spec.ts`：双客户端同 session 同步 + 历史回放 + presence + session_changed

### Fixed

- 修复 `session ownership mismatch, regenerating sessionId` 无限循环 — agent 共享单实例 session 跨用户切换时严格 ownership 拒绝导致前端死循环。新增 `forceClaimSession(id, userId)` 方法，当 `?session` 等于 agent 当前 sessionId 时强制转移 owner（覆盖旧 owner 不抛 `SessionAlreadyClaimedError`）
- 修复 3-dot 菜单按钮未垂直居中（`align-items: center`）
- 修复 3-dot 菜单按钮点击无反应（`e.stopPropagation()` + `menu-open` z-index 提升）
- 修复会话切换时 `/resume` 未发送（MockWebSocket 缺静态常量 `OPEN=1`，仅为测试问题非代码 Bug）
- 修复 `user_identified` 后 sessionId 变化必须重连 WS（避免 `sendToSessionKey(oldKey)` 失效）
- 修复 I1：resync 协议 `lastEventSeq` 重连时正确回放 ring buffer
- 修复 I4/I5：连接关闭且 sessionKey 无剩余连接时清理 ringBuffer 防内存泄漏
- 修复 I8：`claimSession` 真正幂等（同用户重复 claim 是 no-op；跨用户 claim 抛错）
- 修复 C1：claimSession 加 `withJsonlLock` 防并发读改写竞态
- 修复 C2：`?session=` 显式指定时执行 ownership 检查（旧版仅 sessionStorage + userStorage 同时存在才校验）
- 修复 M2：`session_changed` 关闭旧连接时清理所有监听器防止缓冲帧触发递归

### Security

- 密码哈希用 `crypto.scrypt` + 16 字节随机 salt
- token 用 `crypto.randomBytes(32).toString('hex')`（64 字符）
- authToken 常量时间比较 `timingSafeEqual` 防时序攻击
- HTTP API 路径校验：sessionId 严格匹配 UUID v4 正则
- Ownership 模型：session claim 后跨用户访问返回 403 forbidden
- `X-Content-Type-Options: nosniff` + `Cache-Control: no-cache, no-store, must-revalidate` 防缓存旧 HTML
- Agent session 共享单实例仅允许转移给当前登录用户（forceClaimSession），其他 session 保持严格 ownership

### Test Coverage

- 58 测试文件 / 584 用例全部通过
- E2E 覆盖 L1 全部 12 项验收标准
- 类型检查 `tsc --noEmit` 0 错误
- 真实浏览器（headless Chrome + puppeteer）端到端验证：3 个回归 Bug 全部 PASS + 消息发送 PASS + 0 次 ownership_mismatch 循环

### Release Finalization（封仓收尾）

- `.gitignore` 补充 `.trae-cn/`（TRAE IDE 本地数据）
- `docs/superpowers/plans/2026-06-29-l1-user-system.md` 顶部状态更新为 `✅ L1 COMPLETED`，Task 13 全部 checkbox 完成
- 设计文档归档至 `docs/superpowers/specs/`
- 实施计划归档至 `docs/superpowers/plans/`
- `package.json` 版本升至 `0.2.0`
- 下一迭代计划待生成（后续 0.2.1+ 版本）

---

## [0.1.0-mvp] - 2026-06-28

MVP 首个封仓版本。42 任务 / 54 源文件 / 5714 LOC src + 6289 LOC tests / 383 测试通过。

### Added

#### 基建层
- TypeScript strict + ESM 项目脚手架（`tsconfig.json` / `vitest.config.ts`）
- pino 异步 logger，10MB rotation 保留 5 份，apiKey/token 脱敏
- zod config schema，支持 `apiKey` 或 `envVar` 引用环境变量
- JSONL UTF-8 LF + trailing newline 编码，增量流式解析，破损行容错
- `fs.truncateSync` 自动修复破损 JSONL 文件
- per-sessionId async-mutex，5s 超时
- `FileStorage` 适配器：readSession / appendSession / listSessions / 完全损坏备份
- 进程信号处理：SIGINT 10s / SIGTERM 30s / SIGHUP ignore；uncaughtException exit(1)；memory monitor；turn watchdog 5min warn / 10min abort

#### 核心层 - Provider
- `Provider` / `Model` / `Context` / `AssistantMessageEvent` 类型定义
- TTFB 5s + chunk 1.5s 双时钟流式控制器
- 错误分类重试：401/403/400 fatal 不重试；429/5xx 指数退避 1s/2s/4s 最多 3 次
- 三种 API 协议实现：`openai-completions` / `openai-responses` / `anthropic-messages`
- OpenAI Completions 协议完整支持 `tool_calls` / `tool_call_id` 上下文
- 共享 SSE fetch 生成器（消除重复代码）

#### 核心层 - Tool
- `AgentTool` 接口 + `ToolRegistry`
- bash 工具：30s 硬超时 SIGTERM→2s→SIGKILL，stdout/stderr 截断
- read 工具：2MB 上限返回 `file_too_large`，5s 超时，流式读取
- edit 工具：per-filePath mutex，old_string 不唯一拒绝，5s 超时
- update_working_memory 工具：keyInfo 2000 字符截断
- 共享路径遍历防护模块

#### 核心层 - Memory
- `SessionEntry` 联合类型 + UUID 路径校验（`/^[a-f0-9-]{36}$/`）
- `AgentMessage` 与 ContentBlock 类型
- 幂等 open/create session 仓库
- Working memory 单调覆盖 + `/continue` 跨 session 继承
- Compaction：token 3 级估算（tiktoken → usage → chars/4），80% 触发，30% 目标，LLM 失败保留旧 entries

#### 核心层 - Agent
- `AgentEvent` 联合类型（turn_start/end, message_*, tool_call_*, error 等）
- ReAct AgentLoop：maxIterations 上限 + AbortSignal 传播 + steering queue
- `AgentSession`：turn 原子性（错误不持久化），`loadHistory()` 懒加载 JSONL 历史

#### 总线层
- `Channel` 接口 + `AgentEventEnvelope`（sessionKey/chatId/channel/event/seq）
- `InMemoryMessageBus`：入站队列 100 / 出站队列 100，溢出丢弃最旧
- `ChannelManager`：多 channel 注册 + `bindSession` 多对一绑定 + dispatch loop + 死信队列 100

#### 接入层
- WebSocket 服务：入站限流 64KB content / 10 msg/s，heartbeat 60s，resync 协议
- 内联 HTML chat 页（含 Lit + Web Components），工具结果 max-height 200px + 800 字符截断
- CLI 入口（Ink + Yoga + React），6 个组件
- WebUI 入口（Lit + Web Components），6 个组件
- `coreReducer` UIState 状态机，CLI 与 WebUI 共用

#### Slash 命令
- 9 个内置命令：`/new` `/clear` `/help` `/model` `/session` `/sessions` `/resume` `/continue` `/exit`
- `/sessions` 列出所有 session（短 ID + 时间 + 消息数 + 预览 + `(current)` 标识）
- `/resume <id>` 短 ID 前缀匹配切换 session，歧义提示 `Ambiguous id`

#### 服务器装配
- `startServer(config)` 装配所有层
- `resolveSessionId()` 自动恢复最近 session
- `SessionRef` + `SessionFactory` 支持 `/new` `/resume` 运行中切换 session
- `onNewSession` 回调重新绑定 WebSocket channel
- Slash 命令在 agent 之前拦截（`runInboundLoop` 检测 `/` 前缀）
- systemPrompt 安全约束：禁止杀进程 / 改源码 / 读 `data/sessions/`

### Security
- API key 移至 `.env`（`.gitignore` 已排除），`config/aptbot.json` 仅引用 `envVar` 名称
- systemPrompt 约束 agent 不得读取 `data/sessions/` 内部存储
- systemPrompt 约束 agent 不得执行 kill / pkill / killall / shutdown 等命令
- systemPrompt 约束 agent 不得修改 `src/` / `config/` / `package.json`

### Fixed
- 修复 openai-completions 丢失 `tool_calls` / `tool_call_id` 导致工具调用上下文断裂
- 修复 slash 命令未拦截被当作普通消息传给 agent
- 修复 `/new` 仅返回文本未实际创建新 session 导致卡死
- 修复 `/new` 后 `/session` 卡死（新 session 未绑定 WebSocket channel）
- 修复 `/resume` 命令定义但未注册导致落到 agent
- 修复 session 重启后历史丢失（未调用 `loadHistory`）
- 修复 `chat-page.ts` 模板字符串 `\n` 导致浏览器 `SyntaxError: Invalid or unexpected token`
- 修复工具结果在 UI 中过长未截断
- 修复 agent 自行 `cat data/sessions/*.jsonl` 读取其他会话记录

### Test Coverage
- 43 测试文件 / 383 用例全部通过
- E2E 覆盖 §11.3 全部 11 项验收标准
- 类型检查 `tsc --noEmit` 0 错误

### Release Finalization（封仓收尾）
- 添加 MIT LICENSE 文件（README 此前标注 planned）
- 添加 `docs/deployment.md` 脱敏版 VPS 部署指南（nginx + Caddy 双方案、systemd、SSH 加固、sudoers、12 节常见问题排查）— 提前完成 PLAN-L1 Task 2
- 添加 `.editorconfig` + `.prettierrc` 代码风格配置（多 agent 协作防风格漂移）
- 从仓库移除 `test_manual_MVP.md`（临时手工测试日志，不入库）
- `.agents/skills/` 加入 `.gitignore` 并取消 git 跟踪（工具 skill 非 aptbot 代码，−10073 行）
- 同步更新 README.md / README.zh-CN.md（修正 LICENSE 链接、新增 deployment 链接、移除 test_manual 引用）
- 打 `v0.1.0` git tag 作为版本基线，后续 L1/L2 迭代可清晰回溯

---

> **MVP v0.1.0 已于 2026-06-28 完整封仓。** 下一迭代见 [docs/superpowers/plans/2026-06-29-l1-user-system.md](./docs/superpowers/plans/2026-06-29-l1-user-system.md)：浏览器会话隔离 + 多客户端同步。
