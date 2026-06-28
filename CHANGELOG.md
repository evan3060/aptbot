# Changelog

本文件记录 aptbot 各版本变更。格式遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循 [Semantic Versioning](https://semver.org/lang/zh-CN/)。

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
