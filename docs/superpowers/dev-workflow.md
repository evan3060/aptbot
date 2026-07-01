# aptbot 通用研发规范

> **适用范围：** 所有版本迭代（0.2.x / 0.3.x / 0.4.x ...）均遵循此规范。
> **版本：** v1.0（2026-06-30 定稿，基于 0.2.0/0.2.1 经验 + 0.2.2 改进）
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
   ↓ 产出 plan 文档：PLAN-<version>.md（根目录）或 docs/superpowers/plans/
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
| P2 | `git checkout -b feat/<version>` 创建开发分支（或确认已在该分支） | 当前分支 = `feat/<version>` |
| P3 | 确认本版本相关 spec/plan 已就位 | 文件存在 |
| P4 | 提交 spec/plan 入版本库：`git add <files>` + `git commit -m "docs: add <version> plan and spec"` | 提交成功 |
| P5 | `npm install` 确认依赖完整 | node_modules 就绪，无 peer dep 警告 |
| P6 | `npm test` 基线回归 | 上一版本封仓状态全绿（基线建立） |
| P7 | `npx tsc --noEmit` | 0 错误 |
| P8 | 启动 `subagent-driven-development` skill 自动推进 task 链（每个 task 内部嵌套 `test-driven-development` skill） | 进入 Task 1 的 A1 步骤 |

### P0 约束

- P1 不通过 → 先处理未提交变更或 stash，禁止在脏工作区开新分支
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
| A10 | 更新 `PLAN-<version>.md` 对应 task checkbox 为 `[x]` | — |
| A11 | 若 task 涉及接口/架构变化 → 更新 `ARCHITECTURE.md` | — |
| A12 | 若 task 涉及用户可见行为 → 更新 `README.md` / `README.zh-CN.md` | — |
| A13 | 若 task 涉及设计决策 → 更新 `docs/design-notes.md` | — |
| A14 | `git add` 文档变更 + `git commit`（`docs: sync ...`） | — |

### A 循环约束

- **TDD 强制**：严禁跳过测试直接写业务代码，必须先见证 RED，再修复到 GREEN
- **git add 精确**：禁用 `git add -A` / `git add .`，必须按文件名添加，避免误提交 .env / 凭证
- **commit message 英文**：遵循 conventional commits（feat / fix / refactor / docs / test / chore）
- **文档同步触发式**：A11/A12/A13 是条件触发，不触发时仅做 A10

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
| B3 | **人工 UAT 核验**（详见第 4 节） | 用户验收通过 |
| B4 | `CHANGELOG.md` 添加 `<version>` 章节 | — |
| B5 | `README.md` / `README.zh-CN.md` 同步 `<version>` 变更 | — |
| B6 | `PLAN-<version>.md` 顶部状态更新为 `✅ <version> COMPLETED` | — |
| B7 | 设计文档归档至 `docs/superpowers/specs/` | — |
| B8 | 实施计划归档至 `docs/superpowers/plans/` | — |
| B9 | `package.json` 版本升至 `<version>` | — |
| B10 | 打 `v<version>` git tag | — |
| B11 | `finishing-a-development-branch` skill 执行最终封仓 | — |
| B12 | VPS 部署验证 | 线上验证通过 |

### B 循环约束

- B3 必须在 B1/B2 通过后进行（不允许带测试错误做 UAT）
- B4-B8 文档更新必须在 B11 封仓 skill 之前完成
- B12 VPS 验证发现的问题走 hotfix 流程，不阻塞封仓

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

## 6. subagent-driven-development 集成

### 6.1 流程链路

```
P1-P7 环境就绪 → P8 启动 subagent-driven-development
                      ↓
                每 task 循环 A1-A14（TDD + 审查 + 提交 + 文档同步）
                      ↓
                全部 task 完成 → Task E2E → Task UAT → Task 封仓 B1-B12
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

- 每个版本对应一个 `PLAN-<version>.md` 文件（根目录）
- 每个版本对应一个 spec 文档（`docs/superpowers/specs/`）
- 封仓后 plan 归档至 `docs/superpowers/plans/`

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
