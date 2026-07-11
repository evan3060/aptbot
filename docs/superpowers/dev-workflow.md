# aptbot 通用研发规范

> **适用范围：** 所有版本迭代（0.2.x / 0.3.x / 0.4.x ...）均遵循此规范。
> **版本：** v1.1（2026-07-10 修订，基于 0.3.0/0.3.1 经验补充分支规范、外部资源检查、安全 headers、VPS 验证细化、跨项目迁移规则）
> **superpower 流程：** brainstorming → spec → writing-plans → subagent-driven-development / executing-plans

---

## 0. superpower 标准流程

每个版本迭代必须按以下顺序执行，不得跳步：

```
1. brainstorming skill
   ↓ 产出 spec 文档：docs/superpowers/specs/YYYY-MM-DD-<version>-design.md
   ↓ spec self-review（placeholder/一致性/范围/歧义 4 项检查）
   ↓ NotifyUser 等待 user review gate（必须等用户 approval）
2. writing-plans skill
   ↓ 产出 plan 文档：docs/superpowers/plans/YYYY-MM-DD-<version>-<topic>.md
   ↓ plan self-review（spec 覆盖/placeholder/类型一致性 3 项检查）
3. subagent-driven-development skill（或 executing-plans）
   ↓ 按 P0 准备 → A 每 task 循环 → B 封仓 执行
```

**禁止行为：**
- 跳过 brainstorming 直接写 plan
- 跳过 spec self-review 直接交付用户
- 跳过 user review gate 直接进入 writing-plans
- 用 Write 工具手动写 plan 而非 writing-plans skill 产出

---

## 1. 开发前准备（P0，启动前一次性执行）

每个版本分支启动前必须完成环境就绪检查：

| 步骤 | 动作 | 验证 |
|---|---|---|
| P1 | `git status` 检查工作区干净 | 无未提交变更（含 untracked） |
| P2 | `git checkout -b feat/<version>` 创建开发分支 | 当前分支 = `feat/<version>`，禁止沿用上一版本分支 |
| P3 | 确认本版本相关 spec/plan 已就位 | 文件存在 |
| P4 | 提交 spec/plan 入版本库：`git add <files>` + `git commit -m "docs: add <version> plan and spec"` | 提交成功 |
| P5 | `npm install` 确认依赖完整 | node_modules 就绪，无 peer dep 警告 |
| P6 | `npm test` 基线回归 | 上一版本封仓状态全绿（基线建立） |
| P7 | `npx tsc --noEmit` | 0 错误 |
| P8 | 启动 `subagent-driven-development` skill 自动推进 task 链（每个 task 内部嵌套 `test-driven-development` skill） | 进入 Task 1 的 A1 步骤 |

### P0 约束

- P1 不通过 → 先处理未提交变更或 stash，禁止在脏工作区开新分支
- P2 不通过 → 每个版本（含 patch 如 0.3.1）必须新开 `feat/<version>` 分支，禁止沿用上一版本分支（如 0.3.1 禁止用 feat/0.3.0）
- P6 不通过 → 上一版本封仓状态被破坏，禁止启动新版本，先修复基线
- P7 不通过 → 修复 ts 错误后重跑，禁止带类型错误启动
- P3 的 spec 文档纳入 plan 提交原因：plan 的 task 是 spec 设计的实施，spec 作为前置参考必须随版本入库

---

## 2. 每 task 必做（A 循环，14 步）

每个 task 在 subagent-driven-development 中按以下步骤执行：

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
| A10 | 更新 plan 文档（`docs/superpowers/plans/`）对应 task checkbox 为 `[x]` | — |
| A11 | 若 task 涉及接口/架构变化 → 更新 `ARCHITECTURE.md` | — |
| A12 | 若 task 涉及用户可见行为 → 更新 `README.md` / `README.zh-CN.md` | — |
| A13 | 若 task 涉及设计决策 → 更新 `docs/design-notes.md` | — |
| A14 | `git add` 文档变更 + `git commit`（`docs: sync ...`） | — |
| A15 | 若 task 引入外部资源（`<link>` / `<script src>` / `@import url()`）→ 验证资源在大陆可访问，否则提供本地 fallback | — |

### A 循环约束

- **TDD 强制**：严禁跳过测试直接写业务代码，必须先见证 RED，再修复到 GREEN
- **git add 精确**：禁用 `git add -A` / `git add .`，必须按文件名添加，避免误提交 .env / 凭证
- **commit message 英文**：遵循 conventional commits（feat / fix / refactor / docs / test / chore）
- **文档同步触发式**：A11/A12/A13/A15 是条件触发，不触发时仅做 A10
- **外部资源可访问性**：禁止引用被 GFW 阻断的外部资源（Google Fonts / Google APIs / grpc.io 等），必须使用国内 CDN 或本地 fallback。违反此规则会导致移动端浏览器「网站有风险」提示

### 文档同步边界

- **A11 架构变化**：新增/删除模块、接口签名变更、依赖关系调整
- **A12 用户可见行为**：命令格式、配置项、部署方式、API 端点变化
- **A13 设计决策**：从"待讨论"变为"已定"、决策依据变化、新增约束
- 不触发的纯内部重构 → 仅做 A10（checkbox）

---

## 3. 封仓流程（B 循环，全部 task 完成后）

| 步骤 | 动作 | 验证 |
|---|---|---|
| B1 | `npm test` 全量回归 | 全绿 |
| B2 | `npx tsc --noEmit` | 0 错误 |
| B2.5 | **代码清晰度三审**（详见第 5.5 节） | 三轮检查完成，Critical/Important 问题已修复 |
| B3 | **人工 UAT 核验**（详见第 4 节） | 用户验收通过 |
| B4 | `CHANGELOG.md` 添加 `<version>` 章节 | — |
| B5 | 同步 `<version>` 变更到所有相关文档：`README.md` / `README.zh-CN.md` / `docs/deployment.md` / 其他涉及版本引用的文档 | — |
| B6 | plan 文档顶部状态更新为 `✅ <version> COMPLETED` | — |
| B7 | 设计文档归档至 `docs/superpowers/specs/` | — |
| B8 | ~~实施计划归档至 `docs/superpowers/plans/`~~（plan 已在该目录，无需移动） | — |
| B9 | `package.json` 版本升至 `<version>` | — |
| B10 | 打 `v<version>` git tag | — |
| B11 | `finishing-a-development-branch` skill 执行最终封仓 | — |
| B12 | VPS 部署验证（详见第 4.5 节验证清单） | 线上验证通过 |
| B13 | 全站安全 headers 验证（所有响应类型含 HSTS / X-Content-Type-Options / X-Frame-Options / Referrer-Policy） | HEAD + GET 均返回安全 headers |
| B14 | 全站外部资源引用检查（`grep -r "fonts.googleapis\|googleapis\|gfw-blocked-cdn"` 所有 HTML / CSS / JS 产物） | 引用计数为 0 |

### B 循环约束

- B2.5 必须在 B1/B2 通过后进行（不允许带测试错误做代码审查）
- B3 必须在 B2.5 完成后进行（代码清晰度问题修复后才进入 UAT）
- B4-B8 文档更新必须在 B11 封仓 skill 之前完成
- B12 VPS 验证发现的问题走 hotfix 流程，不阻塞封仓
- B13/B14 必须在 B12 VPS 部署后执行，HEAD 请求 + 外部资源检查是移动端兼容性的最后防线

---

## 4. UAT 核验

### 4.1 时机

E2E 测试通过后、封仓前（B3 步骤）。

### 4.2 范围（4 项必做）

| 范围 | 内容 |
|---|---|
| **本地功能验证** | 基础聊天 / 工具调用 / session 切换不回归 |
| **VPS 线上验证** | aptbot.de / demo.aptbot.de 不回归 |
| **新功能逐项验证** | 本版本每个新功能实际生效演示 |
| **旧功能回归验证** | 上一版本的用户系统 / 多客户端 / 侧边栏等不回归 |

### 4.3 记录

- **正式核验清单文件**：`docs/superpowers/plans/<version>-uat-checklist.md`
- 用户逐项核验，结果记入清单文件，逐项勾选
- 不通过项标记为 ❌，必须修复后重新 UAT

### 4.4 Bug 修复验收（强制）

**适用场景：** UAT 验收阶段或日常 bug 修复后，每次代码修改都必须通过浏览器自动化验收才能视为完成。

**强制流程：**

1. 代码修改完成 + `npx tsc --noEmit` 通过 + 相关单元测试 GREEN
2. `npm run webui:build` 重建前端（若涉及前端）
3. 重启服务器（确认日志输出 `server started`）
4. **启动独立子 agent**（`subagent_type: general_purpose_task`）执行 Playwright 自动化 UAT：
   - 用 `webapp-testing` skill 的 `scripts/with_server.py` 或直接连接已运行的服务器
   - 编写 Playwright 脚本模拟用户操作，覆盖修复的 bug 场景 + 相关联功能
   - 必须见证验收通过（断言成功）才能算修改完成
5. 验收通过后在对话中明确报告验收结果

**禁止行为：**
- 禁止仅凭 tsc 通过 / 单元测试通过就声称 bug 修复完成
- 禁止跳过浏览器自动化验收直接交付
- 禁止用"应该能工作"等推测代替实际验证

**Chrome DevTools MCP 集成：** 若需检查网络请求 / WebSocket 帧 / 控制台日志等深层行为，可在 Playwright 脚本中捕获 console / network 事件，或使用 Chrome DevTools MCP 完成相关联功能的测试。

### 4.5 VPS 部署验证清单（B12 步骤细化）

B12 VPS 部署后必须逐项验证：

| 检查项 | 命令 | 期望结果 |
|--------|------|----------|
| 服务运行 | `sudo systemctl status aptbot` | active (running) |
| HTTPS GET | `curl -s -o /dev/null -w "%{http_code}" https://aptbot.de/` | 200 |
| HTTPS HEAD | `curl -sI https://aptbot.de/` | 200（非 404） |
| HTTP 重定向 | `curl -s -o /dev/null -w "%{http_code}" http://aptbot.de/` | 301 |
| 安全 headers | `curl -sI https://aptbot.de/ \| grep -iE "strict\|x-frame\|referrer\|nosniff"` | 4 项全有 |
| 外部资源引用 | `curl -s https://aptbot.de/ \| grep -c "fonts.googleapis"` | 0 |
| SSL 证书有效期 | `echo \| openssl s_client -connect aptbot.de:443 2>/dev/null \| openssl x509 -noout -dates` | notAfter 在未来 |
| 子页面 HEAD | `curl -sI https://aptbot.de/demo` + `/learn` + `/feedback` | 200 + 安全 headers |

> **移动端兼容性提示：** 以上全部通过后，国产浏览器（华为 / 360 / QQ）仍可能因域名未 ICP 备案显示风险提示，这属于国内监管要求，非技术问题。推荐用户使用 Chrome / Firefox / Safari 访问。

---

## 5. 熔断机制

### 5.1 触发条件

- 遇到 3 次连续不可修复的测试失败：触发熔断

### 5.2 触发后行为

1. 立即停止当前 task
2. 打印错误栈
3. 标记 task 为 `failed`
4. 记录依赖关系
5. 切换到其他无依赖 task
6. 全部其他 task 完成后再回来修复

### 5.3 修复后

- 修复失败 task 后，重置熔断计数
- 重新走 A6-A9 审查 + 提交流程

---

## 5.5 代码清晰度三审（合并前强制执行）

**时机：** 全部 task 完成、B1-B2 测试通过后、B3 人工 UAT 之前执行。三轮按顺序进行，前一轮发现的问题修复后才进入下一轮。

### 第一轮：去重

**目标：** 消除跨文件的重复逻辑，抽取公共模块。

| 检查项 | 动作 |
|--------|------|
| 跨文件重复函数 / 代码块 | 提取到 `src/shared/` 或就近的公共模块 |
| 重复的常量 / 类型定义 | 合并到统一的 types / constants 文件 |
| 重复的错误处理模式 | 抽象为 helper 函数或装饰器 |
| 重复的工具函数 | 合并到 `src/utils/` 对应模块 |

> **判断标准：** 同一段逻辑（≥5 行）在 2 个及以上文件中出现，且语义相同，视为重复。

### 第二轮：拆分

**目标：** 控制函数粒度，确保单一职责。

| 检查项 | 动作 |
|--------|------|
| 函数超过 50 行 | 按职责拆分为多个小函数 |
| 函数承担多个职责 | 每个职责独立为一个函数 |
| 嵌套超过 3 层 | 提取内部逻辑为独立函数或使用 early return |
| 文件超过 400 行 | 评估是否按职责拆分为多个文件 |

> **判断标准：** 函数行数 > 50 行（不含空行和注释）或包含多个抽象层级。

### 第三轮：统一

**目标：** 命名、错误处理、导入顺序与项目规范一致。

| 检查项 | 动作 |
|--------|------|
| 命名风格（变量 / 函数 / 类 / 文件） | 与项目现有风格一致，不一致则修正 |
| 错误处理方式（throw / return error / Result 类型） | 与项目现有模式一致 |
| import 顺序（stdlib → 第三方 → 项目内 → 类型） | 统一排序，删除未使用的 import |
| 代码格式（缩进 / 引号 / 分号） | 与项目 prettier / eslint 配置一致 |

> **项目规范积累：** 若项目尚无明确的命名 / 错误处理 / 导入顺序规范，本轮中发现的一致性模式应抽取定义到 `docs/coding-conventions.md`，逐步积累。后续版本以此规范为基准。

### 执行方式

- **subagent-driven-development 模式：** 派发独立的 code-clarity-review subagent 执行三轮检查，输出问题清单
- **手动执行模式：** 开发者自行按三轮顺序检查
- **问题修复：** Critical（重复逻辑导致 bug）必须修复；Important（>100 行函数 / 命名严重不一致）应修复；Minor（格式微调）记录到后续迭代
- **验证：** 修复后重新跑 `npm test` + `npx tsc --noEmit` 确保无回归

### 期望效果

代码清晰可读、容易长期维护，人工可以参与修改调整。每个函数职责单一、命名表意、风格统一，新开发者能在 5 分钟内理解任意模块的作用。

---

## 6. subagent-driven-development 集成

### 6.1 流程链路

```
P1-P7 环境就绪 → P8 启动 subagent-driven-development
                      ↓
                每 task 循环 A1-A15（TDD + 审查 + 提交 + 文档同步）
                      ↓
                全部 task 完成 → B1-B2 测试 → B2.5 代码清晰度三审 → Task UAT → Task 封仓 B3-B14
```

### 6.2 多 agent 并行

- **独立 task 可并行 dispatch**：无依赖关系的 task 可同时启动多个 implementer subagent
- **依赖 task 串行**：Task 9 依赖 Task 8，必须等 Task 8 完成后才能 dispatch Task 9
- **文件冲突避免**：同时修改同一文件的 task 必须串行（如多个 task 都改 websocket-server.ts）

### 6.3 progress ledger

每个版本启动时在 `.superpowers/sdd/progress.md` 记录：
- Branch / Started / Base commit / Baseline tests
- 每 task 完成后追加一行：`Task N: complete (commits <base7>..<head7>, review clean)`
- 熔断 task 标记：`Task N: FAILED (error stack, dependencies)`

### 6.4 skill 调用顺序

1. `brainstorming`（spec 产出）
2. `writing-plans`（plan 产出）
3. `subagent-driven-development`（执行）
   - 每 task 内部嵌套 `test-driven-development`
   - 每 task 审查调用 `requesting-code-review`
4. `finishing-a-development-branch`（封仓）

---

## 7. 版本号约定

| 格式 | 含义 | 示例 |
|---|---|---|
| `0.2.x` | patch 版本（bugfix / 小改进） | 0.2.1 (landing-page) |
| `0.x.0` | minor 版本（新功能 / 主题迭代） | 0.3.0 (多 agent) |
| `1.0.0` | major 版本（API 稳定 / 重大重构） | — |

- 每个版本对应一个 plan 文档（`docs/superpowers/plans/YYYY-MM-DD-<version>-<topic>.md`）
- 每个版本对应一个 spec 文档（`docs/superpowers/specs/YYYY-MM-DD-<version>-design.md`）
- plan 在 `docs/superpowers/plans/` 目录中原地维护，无需封仓后归档移动

---

## 8. 跨项目迁移兼容性检查

当内容从一个项目迁移到另一个项目（如 aptbot learn 文章迁移到 aptblog）时，必须执行兼容性检查：

### 8.1 迁移前检查

| 检查项 | 动作 |
|--------|------|
| 内容清点 | 列出所有待迁移文件（含中英双语 / 图片 / frontmatter） |
| 依赖分析 | 检查迁移内容是否被原项目其他模块引用（路由 / 链接 / 测试） |
| 格式映射 | 确认 frontmatter / 图片路径 / 内部链接的映射规则 |

### 8.2 迁移后原项目兼容性

| 检查项 | 动作 |
|--------|------|
| 路由兼容 | 原项目路由是否需要保留重定向 / 404 处理 |
| 引用清理 | 原项目中指向已迁移内容的链接 / 导航项是否已更新 |
| 测试回归 | 原项目 `npm test` + `npx tsc --noEmit` 全绿 |
| 部署验证 | 原项目 VPS 部署后无 broken link / 404 |

### 8.3 新项目部署兼容性

| 检查项 | 动作 |
|--------|------|
| VPS 共存 | 新项目与原项目在同一 VPS 共存时，nginx server_name 路由隔离验证 |
| 端口冲突 | 新项目不占用原项目端口（aptbot 8080） |
| 用户隔离 | 新项目使用独立系统用户，sudoers 权限隔离 |
| SSL 证书 | 新子域名证书签发不影响原域名证书续期 |
| 安全 headers | 新项目也必须遵循第 4.5 节安全 headers 规则 |

### 8.4 迁移流程

```
1. 迁移前检查（8.1）→ 确认无阻塞
2. 新项目初始化 + 部署验证（8.3）
3. 内容迁移 + 格式转换
4. 原项目兼容性处理（8.2）— 保留重定向或清理引用
5. 双端验证 — 原项目 + 新项目均部署正常
6. 确认无误后删除原项目中已迁移内容（可选，视保留策略而定）
```

---

## 附录：决策来源

| 决策 | 来源 | 日期 |
|---|---|---|
| superpower 标准流程 | brainstorming skill 强制要求 | 2026-06-30 |
| P0 环境准备 | 0.2.1 封仓教训（脏工作区开分支风险） | 2026-06-30 |
| A11-A13 文档同步 | 0.2.0 封仓教训（文档未更新） | 2026-06-30 |
| B3 人工 UAT | 0.2.1 经验（自动化测试无法覆盖真实体验） | 2026-06-30 |
| 熔断机制 | 用户偏好（3 次失败停止） | 2026-06-30 |
| subagent-driven-development | superpower 推荐流程 | 2026-06-30 |
| P2 分支名规范 | 0.3.1 教训（0.3.1 沿用 feat/0.3.0 分支导致分支名与版本号不一致） | 2026-07-10 |
| Plan 文档位置统一 | 0.3.0/0.3.1 教训（plan 位置不统一：根目录 vs docs/superpowers/plans/） | 2026-07-10 |
| A15 外部资源检查 | 0.3.1 教训（Google Fonts 被 GFW 阻断导致移动端风险提示） | 2026-07-10 |
| B13 安全 headers 验证 | 0.3.1 教训（安全 headers 仅覆盖 HTML GET，HEAD/404/API 缺失） | 2026-07-10 |
| B14 外部资源引用检查 | 0.3.1 教训（封仓后才发现 Google Fonts 引用） | 2026-07-10 |
| 4.5 VPS 验证清单 | 0.3.1 教训（B12 过于笼统，缺少 HEAD/外部资源/子页面验证） | 2026-07-10 |
| 第 8 节跨项目迁移 | 0.3.2 规划（aptblog 独立项目迁移 learn 文章） | 2026-07-10 |
| 第 5.5 节代码清晰度三审 | 用户要求（合并前三轮检查：去重 / 拆分 / 统一） | 2026-07-10 |
