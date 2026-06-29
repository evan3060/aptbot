# L1 迭代设计：用户级 Session 管理 + 多客户端同步

> **状态：** 已确认，待写实施计划
> **日期：** 2026-06-29
> **前置：** MVP v0.1.0 已封仓（2026-06-28，commit 8e0c5ad5）
> **分支：** `l1-user-system`（从 main 创建，不用 worktree）

## 目标

L1 将 aptbot 从"单浏览器单会话"升级为"**用户级 session 管理 + 多客户端同步**"：
- 注册用户登录后在任意设备看到自己的 sessions
- 匿名用户通过 UUID 在本浏览器内保持身份
- 多客户端打开同一 session 时实时同步
- UI 仿 Codex 样式，左侧"任务列表"侧边栏

## 架构变化

L1 不改变 MVP 四层架构，在接入层（access）与基建层（infrastructure）增加用户系统：

```
用户登录/匿名UUID → token → WebSocket携带token → 服务端识别userId
                                                  ↓
                                    session打上userId标签
                                                  ↓
                                    /sessions 和侧边栏按userId过滤
```

### 认证模型（统一 token）

| 用户类型 | 身份来源 | token 来源 | 跨设备同步 |
|---|---|---|---|
| 注册用户 | username + password | 登录返回 | 是 |
| 匿名用户 | 随机 UUID | 首次访问生成 | 否（仅本浏览器） |
| VPS 部署 | 现有 `authToken` env | 环境变量 | 共享（兼容现有部署） |

- token 统一存 localStorage，WebSocket 通过 `?token=` 携带
- 现有 `authToken` 作为"部署级共享 token"保留，与用户 token 并存
- `SessionMetadata` 新增 `userId` 字段，session 创建时打标签

## 关键设计决策

### 1. session_changed 事件（新增）

服务端在 `/new` 或 `/resume` 切换 session 后，向该 connection 推送 `{ type: 'session_changed', sessionId: '<newId>' }`。客户端监听后更新 localStorage 并用新 sessionKey 重连 WebSocket。

### 2. WebSocket sessionKey 路由

- `ConnectionState` 新增 `sessionKey` 字段，从 `?session=<id>` 解析
- 连接时自动 `channelManager.bindSession(sessionKey, wsChannel)`
- `broadcast(envelope)` 仅向 `state.sessionKey === envelope.sessionKey` 的 connection 发送
- **发现：** ChannelManager 已有 `Map<sessionKey, Set<Channel>>` 路由能力（MVP 已实现），真正工作在 wsServer 的 broadcast 过滤层
- **发现：** 计划引用的 `src/access/websocket-channel.ts` 不存在，`createWebSocketChannel` 内联在 `server.ts:44-55`

### 3. per-sessionKey 串行化

- inbound loop 维护 `Map<sessionKey, Promise<void>>` 正在运行的 turn
- 同 sessionKey 的消息 `await` 前一个 turn 完成
- 不同 sessionKey fire-and-forget 并行
- 无 `turn_busy` 响应，消息自然排队等待
- **发现：** JSONL per-sessionId mutex 已存在（`jsonl-mutex.ts`，5s 超时），即使并发也不会损坏数据

### 4. ring buffer 历史回放

- 扩展现有 `ringBuffer: AgentEventEnvelope[]`，新增入站消息缓存
- 新连接回放时同时发送历史用户消息和 agent 响应
- 标记 `replay: true` 区分实时与回放
- 不读 JSONL，不违反"agent 不可读 session 文件"约束
- 服务器重启后历史丢失（可接受）

### 5. presence 直发

- wsServer 在 connection 建立/断开时，直接向同 sessionKey 的其他 connection 发送 `{ type: 'presence', onlineCount: N }`
- 不经过 bus / ChannelManager，不污染 AgentEvent 命名空间

### 6. 用户存储

- 复用 JSONL 基建，新建 `data/users.jsonl` 存储用户记录
- 每条记录：`{ userId, username, passwordHash, token, createdAt }`
- 密码用 Node.js 内置 `crypto.scrypt` 哈希（无新增依赖）

### 7. 匿名用户

- 首次访问生成随机 UUID 作为匿名 userId，存入 localStorage
- 下次访问自动读取，换浏览器/清缓存后丢失
- 匿名用户的 sessions 仅本浏览器可见

### 8. Session 命名

- 首条用户消息前 20 字符自动生成 label
- 用户可通过 `/label <名称>` 命令或侧边栏重命名
- 侧边栏显示 label，无 label 时回退到短 ID + 创建时间

### 9. UI 设计方向

- 仿 Codex 样式：左侧 session 列表（"任务列表"风格）+ 右侧主聊天区
- 登录/注册页面：简洁表单，支持匿名访问入口
- 侧边栏与 `/sessions` `/resume` `/new` 命令并存

## 任务划分（13 任务）

### Phase 0: VPS 部署遗留补齐（2 任务）

| # | 任务 | 文件 | 核心契约 |
|---|---|---|---|
| 1 | token 记忆与自动携带 | Modify: `src/access/chat-page.ts` | 首次连接成功后将 URL `token` 存入 sessionStorage，后续优先读取，无 token 时显示鉴权提示 |
| 2 | 部署文档更新 | Modify: `docs/deployment.md`, `README.md`, `README.zh-CN.md` | 补齐 VPS 部署实践，README 链接到 docs/deployment.md |

### Phase 1: 用户系统（2 任务）

| # | 任务 | 文件 | 核心契约 |
|---|---|---|---|
| 3 | 用户模型 + 存储 + 认证 API | Create: `src/infrastructure/user-storage.ts`; Modify: `src/access/websocket-server.ts` | `data/users.jsonl` 存储；POST `/api/register` `/api/login` 返回 token；GET `/api/me` 验证 token 返回用户信息；密码用 `crypto.scrypt` |
| 4 | 认证中间件 + 匿名用户 | Modify: `src/access/websocket-server.ts`, `src/server.ts` | token 验证中间件；匿名 UUID 生成；`?token=` 兼容现有 authToken（authToken 作为部署级共享 token） |

### Phase 2: 会话隔离与关联（2 任务）

| # | 任务 | 文件 | 核心契约 |
|---|---|---|---|
| 5 | WebSocket sessionKey 路由 + session-user 关联 | Modify: `src/access/websocket-server.ts`, `src/core/memory/types.ts`, `src/infrastructure/storage/file-storage.ts` | `ConnectionState.sessionKey` 从 `?session=` 解析；`broadcast()` 按 sessionKey 过滤；`SessionMetadata` 新增 `userId`；`listSessions()` 按 userId 过滤；连接时自动 `bindSession` |
| 6 | localStorage 持久化 + session_changed + 登录页面 | Modify: `src/access/chat-page.ts`, `src/server.ts`（`runInboundLoop` 在此文件内） | localStorage 存 sessionId + token；`session_changed` 事件通知客户端切换；登录/注册 HTML 页面 |

### Phase 3: 多客户端同步（3 任务）

| # | 任务 | 文件 | 核心契约 |
|---|---|---|---|
| 7 | per-sessionKey 串行化 | Modify: `src/server.ts`（`runInboundLoop`） | `Map<sessionKey, Promise>` running 标志；同 session await，不同 session 并行 |
| 8 | ring buffer 历史回放 | Modify: `src/access/websocket-server.ts` | 扩展 ring buffer 缓存入站+出站；新连接回放标记 `replay: true` |
| 9 | presence 指示器 | Modify: `src/access/websocket-server.ts`, `src/access/chat-page.ts` | wsServer 直发 presence 事件；页面底部显示"N 人在线" |

### Phase 4: UI 增强（1 任务）

| # | 任务 | 文件 | 核心契约 |
|---|---|---|---|
| 10 | 左侧 session 侧边栏 | Modify: `src/access/chat-page.ts` | 仿 Codex 样式；session 列表（label + 时间）；点击切换；新建按钮；`/label` 命令重命名；与命令并存 |

### Phase 5: 端到端验证（3 任务）

| # | 任务 | 文件 | 核心契约 |
|---|---|---|---|
| 11 | E2E 用户认证 + session 隔离 | Test: `tests/e2e/l1-auth-isolation.spec.ts` | 注册/登录流程；不同用户 session 互不串扰 |
| 12 | E2E 多客户端同步 | Test: `tests/e2e/l1-multi-client-sync.spec.ts` | 同 session 多客户端同步；历史回放；presence |
| 13 | L1 封仓回归 | Test: `tests/e2e/l1-regression.spec.ts` | `npm test` 全绿；`npx tsc --noEmit` 0 错误；VPS 多浏览器手工验证 |

## 迭代管理

### 0. 迭代前准备

```bash
# 1. 从 main 创建 L1 分支
git checkout main
git pull origin main
git checkout -b l1-user-system

# 2. 验证基线（MVP 必须全绿）
npm test
npx tsc --noEmit

# 3. 用 spec 中的 13 任务重写 PLAN-L1.md（由 writing-plans skill 生成）

# 4. 更新 project_memory 中的硬约束
#    - 移除"L1 无权限模型"（L1 已引入用户系统）
#    - 新增 L1 用户系统相关约束
```

### 1. 执行流程（每个 Task）

```
executing-plans skill（驱动任务链，无需逐任务授权）
└── 读取 PLAN-L1.md 中下一个未完成任务
    └── test-driven-development skill（嵌套，每个子任务）
        ├── Step 1: 编写失败测试
        ├── Step 2: 终端验证 RED（必须亲眼看到测试失败）
        ├── Step 3: 最小代码实现
        └── Step 4: 终端验证 GREEN（Exit Code 0）
    └── 测试全绿后：
        ├── invoking requesting-code-review skill（代码审查）
        │   ├── 审查实现是否符合 spec 契约
        │   ├── 审查测试覆盖是否充分
        │   ├── 审查代码风格与既有约定
        │   └── 若有 issues：修复后重新 review
        ├── PLAN-L1.md 中标记 [x]
        ├── git add + commit（conventional commit）
        └── 无缝进入下一任务
```

**严格红线：**
- 严禁跳过测试直接写业务代码。必须先在终端亲眼见证 RED，再修复到 GREEN。
- 严禁跳过 code review 直接提交。每个 Task GREEN 后必须通过 requesting-code-review skill 审查，审查通过方可提交并标记 `[x]`。

### 2. Git 节奏

| 时机 | commit 格式 | 示例 |
|---|---|---|
| 每个 Task 完成 | `<type>: <description>` | `feat: add user registration and login API` |
| Phase 全部完成 | 可选 tag | `git tag v0.2.0-l1-phase1` |
| L1 封仓 | `feat(l1): complete L1 with user system and multi-client sync` | + tag `v0.2.0-l1` |

**type 选择：** `feat`（新功能）/ `fix`（修复）/ `test`（测试）/ `docs`（文档）/ `refactor`（重构）

### 3. Phase 检查点（每个 Phase 结束时）

```bash
# 必须全绿才能进入下一 Phase
npm test                    # 全部测试通过
npx tsc --noEmit            # 0 类型错误
git log --oneline -10       # 确认 commit 历史
```

### 4. 熔断器机制

```
3 次连续不可修复的测试失败
  ↓ 立即停止当前任务
  ↓ 打印完整错误栈
  ↓ 标记任务为 [!] failed
  ↓ 记录依赖关系（哪些后续任务依赖此任务）
  ↓ 跳到下一个无依赖的未完成任务
  ↓ 所有可执行任务完成后
  ↓ 回头重新审视失败任务
```

### 5. L1 封仓流程

```
所有 13 任务 [x] 完成
  ↓
invoking finishing-a-development-branch skill
  ├── Step 1: 全量回归验证
  │   ├── npm test（必须全绿）
  │   ├── npx tsc --noEmit（必须 0 错误）
  │   └── git log --oneline（确认 commit 历史）
  ├── Step 2: 文档同步
  │   ├── PLAN-L1.md 顶部标记 ✅ L1 COMPLETED
  │   ├── 更新 README.md / README.zh-CN.md
  │   ├── 更新 ARCHITECTURE.md
  │   └── 更新 CHANGELOG.md
  ├── Step 3: VPS 多浏览器手工验证
  │   ├── 注册/登录流程
  │   ├── 多客户端同步
  │   ├── 侧边栏切换
  │   └── 匿名用户体验
  ├── Step 4: 工作区清理
  │   ├── 清理临时日志 / 缓存文件
  │   └── 确认 .gitignore 覆盖敏感文件
  ├── Step 5: 提交封仓 commit
  │   └── feat(l1): complete L1 with user system and multi-client sync
  ├── Step 6: 合并决策（向用户呈现选项）
  │   ├── 合并到 main + tag v0.2.0-l1
  │   ├── 保留分支待 review
  │   └── 创建 PR（若需 code review）
  └── Step 7: 更新 project_memory
      ├── 记录 L1 完成状态
      ├── 更新硬约束（用户系统相关）
      └── 更新 lessons learned
```

**封仓红线：** 严禁自动 git push。合并到 main / 打 tag / push 远程必须经用户明确确认。

### 6. Skill 调用链

```
用户发"开始 L1"
  → invoking executing-plans skill
    → 读取 PLAN-L1.md，找到第一个 [ ] 任务
    → 对该任务 invoking test-driven-development skill
      → RED → GREEN
    → GREEN 后 invoking requesting-code-review skill
      → 审查通过？
        ├── 是：标记 [x] + commit + 进入下一任务
        └── 否：修复后重新 review
    → 循环直到所有任务 [x] 或触发熔断器
  → 所有任务 [x] 后 invoking finishing-a-development-branch skill
    → 封仓回归 + 文档同步 + 合并决策
```

## 决策变化记录（相对原 PLAN-L1.md）

| 原决策 | 新决策 | 原因 |
|---|---|---|
| 多客户端互斥：busy 响应 | per-sessionKey 串行化（await） | JSONL mutex 已保护数据安全；busy 响应增加复杂度且用户体验差；串行化自然排队 |
| 历史回放：ring buffer + JSONL | 仅 ring buffer（入站+出站） | 不违反"agent 不可读 session 文件"约束；服务器重启丢失可接受 |
| Task 3/5/6 分开 | 合并为 1 任务 | ChannelManager 已有路由能力（MVP 已实现）；三任务改同一文件，相互依赖 |
| presence 走 bus | wsServer 直发 | presence 非 agent 事件，不应污染 AgentEvent 命名空间 |

## 不做的事

- 跨设备实时编辑同步（不做 OT/CRDT，仅同步消息流）
- 会话权限控制（L1 无权限模型，任何拿到 token 的人可访问对应对话）
- 离线消息推送（连接断开期间的消息仅通过历史回放补发）
- OAuth 第三方登录（L1 仅用户名密码）
- Session 分支/树结构（L3 远期目标）
- `turn_busy` 响应（L1 用串行化替代，L2 若需更精细并发控制可引入）

## 风险点

1. **localStorage 被清除：** 匿名用户 sessionId 丢失，生成新会话。旧会话可通过 `/sessions` + `/resume` 恢复（若已注册并登录则跨设备可恢复）。
2. **多客户端并发写 JSONL：** MVP 已有 per-sessionId mutex（5s 超时），L1 的 per-sessionKey 串行化进一步避免并发。
3. **ring buffer 内存：** 50 connections × 1000 envelopes 可能占用较多内存。L1 保持现有上限，L2 可按 sessionKey 分片。
4. **用户 token 安全：** token 明文存 localStorage，存在 XSS 风险。L1 可接受（个人 agent），L2 可加 HttpOnly cookie。

## 后续阶段展望

### L2 首批（可靠性 + 扩展性基础）
- MixinProvider（多 provider 故障转移）
- Config 热重载（mtimeNs 懒加载）
- Hook 系统（8 hook 点 + priority）
- **L1 推迟：** per-sessionKey 队列分片（ring buffer 按 sessionKey 分片，降低内存）
- **L1 推迟：** HttpOnly cookie（token 安全增强，防 XSS）
- **L1 推迟：** JSONL 历史读取（服务器重启后历史不丢失）

### L2 次批（体验优化）
- /session 动态属性（temperature/maxTokens 等）
- L1 索引 Skill（tags + lastUsed 排序）
- **L1 推迟：** `turn_busy` 响应（若多客户端并发场景需要更精细控制）
- **L1 推迟：** Session 自动摘要命名（替代首 20 字符，用 LLM 生成摘要）

### L2 其他
- CLI/WebUI 增强（Overlay/fork 树/diff 渲染）
- IM 渠道接入（Telegram/飞书/钉钉）
- WebUI 拆分 CF Pages
- FallbackProvider + 熔断器
- OAuth 认证

### L3（远期目标）
- AgentLoop Layer 3（AgentHarness + phase 状态机）
- Subagent 子代理管理
- 跨进程恢复
- 会话分支（树结构）
- 跨会话长期记忆（MEMORY.md / USER.md）
- RpcMode / PrintMode
- 自演化 skill
- Plan Mode SOP

详细设计见 `docs/spec.md §12` 与 `docs/design-notes.md §12`。
