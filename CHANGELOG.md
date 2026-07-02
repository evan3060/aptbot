# Changelog

本文件记录 aptbot 各版本变更。格式遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循 [Semantic Versioning](https://semver.org/lang/zh-CN/)。

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
- 全量测试 1228 passed / 81 files
- API 路由测试 32 passed（含语言解析路由回归）

### Release Finalization（封仓收尾）
- 设计文档 [docs/superpowers/specs/2026-07-01-0.2.3-learn-system-design.md](./docs/superpowers/specs/2026-07-01-0.2.3-learn-system-design.md) 已就位
- 实施计划 [docs/superpowers/plans/2026-07-01-0.2.3-learn-system.md](./docs/superpowers/plans/2026-07-01-0.2.3-learn-system.md) Task 1-9 全部完成
- CHANGELOG / README / deployment.md 同步更新
- `package.json` 版本升至 `0.2.3`
- 双语文章翻译 18 篇 `.en.md` 文件 + 20 张插图 + 20 个 prompt 文件
- 首页落地页「学习入口」按钮
- 知识页面全线 i18n 界面翻译
- git tag `v0.2.3` + PR to main 已提交

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
- 实施计划 [PLAN-0.2.2.md](./PLAN-0.2.2.md) Task 1-14 全部完成，状态 ✅ COMPLETED
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

L1 迭代封仓：用户系统 + 多客户端同步 + Codex 风格侧边栏 + 会话重命名。13 任务 + 会话重命名增强 + agent session ownership 修复，58 测试文件 / 584 测试通过 / `tsc` 0 错误。基于 [PLAN-L1.md](./PLAN-L1.md) 与设计 [docs/superpowers/specs/2026-06-29-l1-user-system-multi-client-design.md](./docs/superpowers/specs/2026-06-29-l1-user-system-multi-client-design.md) 实施。

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
- `PLAN-L1.md` 顶部状态更新为 `✅ L1 COMPLETED`，Task 13 全部 checkbox 完成
- 设计文档归档至 `docs/superpowers/specs/`
- 实施计划归档至 `docs/superpowers/plans/`
- `package.json` 版本升至 `0.2.0`
- 下一迭代计划 [PLAN-L2.md](./PLAN-L2.md) 已生成

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

> **MVP v0.1.0 已于 2026-06-28 完整封仓。** 下一迭代见 [PLAN-L1.md](./PLAN-L1.md)：浏览器会话隔离 + 多客户端同步。
