# Changelog

本文件记录 aptbot 各版本变更。格式遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循 [Semantic Versioning](https://semver.org/lang/zh-CN/)。

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
