# aptbot.de 落地页 + Demo 页 adept.ai 风格克隆 实施计划 v0.2.1

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 aptbot.de VPS demo 站点新增 adept.ai 风格落地页（opt-in），同步将 chat-page.ts 迁移到同一视觉语言

**Architecture:** opt-in 配置 `landingPage: boolean` 控制路由 —— 默认 false 时 `/` 仍是 chat 页（clone 用户零影响）；true 时 `/` 是落地页、`/demo` 是 chat 页。落地页与 demo 页共享 adept.ai 真实提取的 CSS tokens + Inter 字体

**Tech Stack:** Node.js + TypeScript + vanilla HTML 内联 + Vitest + Zod

## Global Constraints

- 分支：`feat/v0.2.1-landing-page`（已从 main 切出，commit 2255b34）
- 版本隔离：`landingPage` 默认 undefined（视为 false），clone 自部署用户行为零变化
- 设计依据：`docs/research/adept/extracted/*.json`（adept.ai 真实 getComputedStyle 提取，已 gitignore）
- 字体：Google Fonts Inter（`<link>` CDN），fallback `system-ui, "PingFang SC"`
- 强调色：`rgb(13, 113, 73)` 深绿（adept 品牌色，非蓝色）
- 全站 `font-weight: 400`（除等宽 Eval 标签 700）
- CTA 按钮：`border-radius: 9999px` pill
- 不引入构建步骤、Tailwind、CSS-in-JS、i18n 库
- 不动 `src/webui/`、`src/cli/`、`/api/*` 路由
- 现有 584 项测试必须全绿
- PLAN.md 约束：不含具体函数实现/业务逻辑/多行代码；TDD 阶段根据测试错误写实现

---

## File Structure

| 文件 | 职责 | 动作 |
|---|---|---|
| `src/infrastructure/config-types.ts` | AptbotConfig 接口 + Zod schema | Modify |
| `src/access/landing-page.ts` | 落地页 HTML 生成器 | Create |
| `src/access/websocket-server.ts` | HTTP 路由 + WebSocket 服务 | Modify |
| `src/server.ts` | 启动入口，根据 config 选择 HTML | Modify |
| `src/access/chat-page.ts` | demo 页 HTML 生成器（adept 风格迁移） | Modify |
| `tests/access/landing-page.spec.ts` | 落地页结构断言 | Create |
| `tests/access/landing-page-i18n.spec.ts` | i18n 字典一致性断言 | Create |
| `tests/access/chat-page-adept-theme.spec.ts` | demo 页 adept 主题断言 | Create |
| `tests/access/routing-landing.spec.ts` | landingPage=true 路由断言 | Create |
| `tests/access/routing-default.spec.ts` | landingPage=false 回归保护 | Create |
| `tests/access/websocket-server.spec.ts` | 现有测试分组改造 | Modify |

---

## Task 1: config-types.ts 新增 landingPage opt-in 字段

**Files:**
- Modify: `src/infrastructure/config-types.ts`
- Test: `tests/infrastructure/config-types.spec.ts`（若存在，否则内联验证）

**Interfaces:**
- Produces: `AptbotConfig.landingPage?: boolean`（可选字段，undefined 视为 false）
- Zod schema: `landingPage: z.boolean().optional()`
- `defaultConfig` 不加该字段（保持 undefined）

**Behavior:**
- 现有 `validateConfig` 链路不变，新增字段走同一 Zod 验证
- 传 `"true"`（字符串）或 `1`（数字）应被 Zod 拒绝
- `defaultConfig` 不含 `landingPage`，确保 clone 用户零影响

- [ ] **Step 1: Write failing test** — 新增测试断言 `validateConfig({ ...defaultConfig, landingPage: true })` 成功且 `data.landingPage === true`；断言 `validateConfig({ ...defaultConfig, landingPage: "true" })` 失败；断言 `defaultConfig.landingPage` 为 undefined

- [ ] **Step 2: Run test to verify it fails** — `npx vitest run tests/infrastructure/config-types.spec.ts`（若文件不存在，先创建空壳）

- [ ] **Step 3: Implement minimal code** — `AptbotConfig` 接口加 `readonly landingPage?: boolean`；`configSchema` 加 `landingPage: z.boolean().optional()`；`defaultConfig` 不动

- [ ] **Step 4: Run test to verify it passes** — `npx vitest run tests/infrastructure/config-types.spec.ts`

- [ ] **Step 5: Commit** — `git add src/infrastructure/config-types.ts tests/infrastructure/config-types.spec.ts && git commit -m "feat(config): add landingPage opt-in field"`

---

## Task 2: landing-page.ts 基础结构 + adept design tokens

**Files:**
- Create: `src/access/landing-page.ts`
- Test: `tests/access/landing-page.spec.ts`

**Interfaces:**
- Produces: `createLandingPageHtml(): string`（无参，返回完整 HTML 字符串）
- HTML 含 `<style>` 块定义 `:root { --bg-base: rgb(255,255,255); --text-primary: rgb(39,36,34); --accent: rgb(13,113,73); ... }`（全部 adept 真实 tokens）
- HTML 含 Inter 字体 `<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&display=swap" rel="stylesheet">`

**Behavior:**
- 纯字符串拼接函数，无 I/O，无异常路径
- 返回的 HTML 默认 `lang="zh-CN"`
- 此 task 只搭骨架：`<head>` + `<style>` tokens + 空 `<body>` + `<script>` 占位
- 5 sections 内容在 Task 3 填充

**Design contract (tokens):**
```
--bg-base: rgb(255, 255, 255)
--bg-warm: rgb(245, 242, 241)
--bg-muted: rgb(249, 247, 244)
--bg-dark: rgb(39, 36, 34)
--bg-darker: rgb(18, 18, 18)
--text-primary: rgb(39, 36, 34)
--text-secondary: rgb(139, 133, 127)
--accent: rgb(13, 113, 73)
--decor-pink: rgb(241, 195, 214)
--decor-red: rgb(254, 190, 191)
--border: rgb(229, 231, 235)
--surface-translucent: rgba(255, 255, 255, 0.98)
--dark-translucent: rgba(39, 36, 34, 0.9)
```

- [ ] **Step 1: Write failing test** — `tests/access/landing-page.spec.ts` 断言 `createLandingPageHtml()` 返回值含：`<html lang="zh-CN">`、Inter `<link>`、`--bg-base: rgb(255, 255, 255)`、`--accent: rgb(13, 113, 73)`、`--text-primary: rgb(39, 36, 34)`

- [ ] **Step 2: Run test to verify it fails** — `npx vitest run tests/access/landing-page.spec.ts`（预期 import 失败）

- [ ] **Step 3: Implement minimal code** — 创建 `landing-page.ts`，导出 `createLandingPageHtml()`，返回含 `:root` tokens + Inter link 的最小 HTML 骨架

- [ ] **Step 4: Run test to verify it passes** — `npx vitest run tests/access/landing-page.spec.ts`

- [ ] **Step 5: Commit** — `git add src/access/landing-page.ts tests/access/landing-page.spec.ts && git commit -m "feat(landing): add landing-page.ts skeleton with adept design tokens"`

---

## Task 3: landing-page.ts 5 sections 内容 + i18n

**Files:**
- Modify: `src/access/landing-page.ts`
- Test: `tests/access/landing-page.spec.ts`（扩充）、`tests/access/landing-page-i18n.spec.ts`（新建）

**Interfaces:**
- Consumes: Task 2 的 `createLandingPageHtml()` 骨架
- Produces: 完整落地页 HTML，含 5 sections + nav + footer + i18n 字典 + `applyLang()` 函数

**Behavior:**
- 5 sections: `#hero` / `#features` / `#architecture` / `#use-cases` / `#cta`
- Nav: `position: fixed`，透明→白滚动（`transition: background-color 300ms ease-in-out`），含 wordmark + 锚点 + 语言切换 pill + GitHub + Demo CTA
- Hero h1: `font-size: 72px` / `font-weight: 400` / `letter-spacing: -3.6px` / `line-height: 64.8px`
- CTA 按钮: `border-radius: 9999px` / `padding: 12px 36px` / `font-size: 24px`
- 数据条: 含硬编码 `584` / `4` / `8` / `MIT`
- i18n: `data-i18n` 属性 + `I18N.zh` / `I18N.en` 字典 + `applyLang(lang)` 函数
- `/demo` 链接：hero CTA + nav Demo 按钮 + cta section 主按钮
- GitHub 链接：`https://github.com/evan3060/aptbot`

**Design contract (i18n):**
```typescript
// 内联在 <script> 中
const I18N = {
  zh: { 'nav.features': '特性', /* ... */ },
  en: { 'nav.features': 'Features', /* ... */ }
};
function applyLang(lang: 'zh' | 'en'): void
// 优先级：URL hash > localStorage 'aptbot.lang' > navigator.language > 'zh'
```

- [ ] **Step 1: Write failing tests** — `landing-page.spec.ts` 扩充断言含 `#hero`/`#features`/`#architecture`/`#use-cases`/`#cta`、`/demo` 链接、GitHub 链接、`584`/`4`/`8`/`MIT`、`data-i18n` 节点、`border-radius: 9999px`、`font-size: 72px`、`letter-spacing: -3.6px`；`landing-page-i18n.spec.ts` 断言 `I18N.zh` 与 `I18N.en` key 集合一致、每个 `[data-i18n]` 的 key 在字典中存在、`applyLang` 函数定义存在

- [ ] **Step 2: Run tests to verify they fail** — `npx vitest run tests/access/landing-page.spec.ts tests/access/landing-page-i18n.spec.ts`

- [ ] **Step 3: Implement minimal code** — 填充 5 sections HTML + nav + footer + i18n 字典 + `applyLang()` 函数 + IntersectionObserver

- [ ] **Step 4: Run tests to verify they pass** — `npx vitest run tests/access/landing-page.spec.ts tests/access/landing-page-i18n.spec.ts`

- [ ] **Step 5: Commit** — `git add src/access/landing-page.ts tests/access/landing-page.spec.ts tests/access/landing-page-i18n.spec.ts && git commit -m "feat(landing): add 5 sections content with adept layout and i18n"`

---

## Task 4: websocket-server.ts 路由扩展 serveDemoHtml + /demo

**Files:**
- Modify: `src/access/websocket-server.ts`（`WebSocketServerOptions` 接口 + `createServer` 回调）
- Test: `tests/access/routing-landing.spec.ts`（新建）、`tests/access/routing-default.spec.ts`（新建）

**Interfaces:**
- Consumes: Task 1 的 `landingPage` 配置（间接，通过 server.ts 传入）
- Produces: `WebSocketServerOptions.serveDemoHtml?: string`（新增可选字段）
- 路由逻辑：`serveDemoHtml` 存在时，`GET /demo`、`GET /demo/`、`GET /demo/index.html` 返回 demo HTML（200 + no-cache header）；不存在时返回 404

**Behavior:**
- `serveHtml` 现有行为不变（`/` 与 `/index.html`）
- 新增 `serveDemoHtml` 分支：宽松匹配 `/demo`、`/demo/`、`/demo/index.html`
- `/api/*` 路由不受影响
- 所有 HTML 响应带 `cache-control: no-cache, no-store, must-revalidate`
- 大小写敏感：`/Demo` 返回 404

**Design contract:**
```typescript
// WebSocketServerOptions 新增
serveDemoHtml?: string;
// createServer 回调新增分支（在 serveHtml 分支之后、404 之前）
if (serveDemoHtml && req.method === 'GET' &&
    (pathname === '/demo' || pathname === '/demo/' || pathname === '/demo/index.html')) {
  // 200 + no-cache + serveDemoHtml
}
```

- [ ] **Step 1: Write failing tests** — `routing-landing.spec.ts`：启动 server 传 `serveHtml='<html id="landing">'` + `serveDemoHtml='<html id="chat">'`，断言 `GET /` 返回含 `id="landing"`、`GET /demo` 返回含 `id="chat"`、`GET /demo/` 返回含 `id="chat"`、`GET /api/login` 行为不变；`routing-default.spec.ts`：启动 server 仅传 `serveHtml='<html id="chat">'`（不传 serveDemoHtml），断言 `GET /` 返回含 `id="chat"`、`GET /demo` 返回 404

- [ ] **Step 2: Run tests to verify they fail** — `npx vitest run tests/access/routing-landing.spec.ts tests/access/routing-default.spec.ts`

- [ ] **Step 3: Implement minimal code** — `WebSocketServerOptions` 加 `serveDemoHtml?: string`；`createServer` 回调在 serveHtml 分支后加 `/demo` 路由分支；`startWebSocketServer` 解构加 `serveDemoHtml`

- [ ] **Step 4: Run tests to verify they pass** — `npx vitest run tests/access/routing-landing.spec.ts tests/access/routing-default.spec.ts`

- [ ] **Step 5: Commit** — `git add src/access/websocket-server.ts tests/access/routing-landing.spec.ts tests/access/routing-default.spec.ts && git commit -m "feat(router): add /demo route with serveDemoHtml option"`

---

## Task 5: server.ts 集成 landingPage 配置

**Files:**
- Modify: `src/server.ts`（第 22 行 import + 第 177 行 serveHtml 赋值）
- Test: 手动验证（无新增测试，依赖 Task 4 路由测试覆盖）

**Interfaces:**
- Consumes: Task 1 的 `config.landingPage` + Task 2/3 的 `createLandingPageHtml()` + Task 4 的 `serveDemoHtml` option
- Produces: 根据 config 选择 HTML 传入 `startWebSocketServer`

**Behavior:**
- `import { createLandingPageHtml } from './access/landing-page.js'`
- `const landingEnabled = config.landingPage === true`
- `serveHtml: landingEnabled ? createLandingPageHtml() : createChatPageHtml('/ws')`
- `serveDemoHtml: landingEnabled ? createChatPageHtml('/ws') : undefined`
- 现有 `createChatPageHtml` import 保留（landingEnabled=false 时仍用）

- [ ] **Step 1: Run existing tests to verify baseline** — `npx vitest run tests/access/websocket-server.spec.ts`（应全绿，因为 server.ts 不被这些测试直接覆盖）

- [ ] **Step 2: Implement minimal code** — server.ts 加 import + 按 `landingEnabled` 三元选择 serveHtml / serveDemoHtml

- [ ] **Step 3: Run full test suite** — `npx vitest run`（验证无回归）

- [ ] **Step 4: Commit** — `git add src/server.ts && git commit -m "feat(server): integrate landingPage config with route selection"`

---

## Task 6: chat-page.ts adept 风格迁移

**Files:**
- Modify: `src/access/chat-page.ts`（`<style>` 块全面迁移 + `<head>` 加 Inter link）
- Test: `tests/access/chat-page-adept-theme.spec.ts`（新建）

**Interfaces:**
- Consumes: adept design tokens（与 Task 2 landing-page.ts 一致）
- Produces: `createChatPageHtml(wsPath: string): string`（签名不变，内容迁移）

**Behavior:**
- `<head>` 加 Inter `<link>`（与 landing-page.ts 一致）
- `<style>` 顶部新增 `:root { --bg-base: ...; --accent: ...; ... }` 变量块（同 Task 2 tokens）
- 所有硬编码颜色替换为 `var(--token-name)`（按设计文档映射表）
- 字体：`system-ui...` → `Inter, system-ui, "PingFang SC", sans-serif`
- 按钮 `#new-session-btn` / `#send` / `.submit-btn` 圆角 `6px` → `9999px`（pill）
- DOM 结构、WebSocket 客户端逻辑、中文文案零改动
- `prefers-reduced-motion` 守护 `#working-dot` animation
- `#input:focus` / `.modal-content input:focus` 加 `outline: 2px solid var(--accent)`

**Design contract (颜色映射，关键项):**
```
body bg: #f7f7f8 → var(--bg-base)
#fff → var(--bg-base)
#1f2937 → var(--text-primary)
#6b7280 → var(--text-secondary)
#3b82f6 → var(--accent)
#2563eb → rgb(10, 95, 60)
#e5e7eb → var(--border)
#dbeafe → rgba(13, 113, 73, 0.12)
#1e40af → var(--accent)
```

- [ ] **Step 1: Write failing test** — `chat-page-adept-theme.spec.ts` 断言 `createChatPageHtml('/ws')` 返回值含：`--bg-base`、`--text-primary`、`--accent` CSS 变量定义；含 Inter `<link>`；含 `border-radius: 9999px`；不再含 `#f7f7f8`、`#fff`、`#1f2937`、`#3b82f6`、`#6b7280`、`#9ca3af`、`#e5e7eb`、`#dbeafe`、`#1e40af`、`#f3f4f6`、`#f59e0b`、`#d1fae5`、`#065f46`、`#fef3c7`、`#fee2e2`、`#991b1b`、`#dc2626` 等浅色+蓝色硬编码值

- [ ] **Step 2: Run test to verify it fails** — `npx vitest run tests/access/chat-page-adept-theme.spec.ts`

- [ ] **Step 3: Implement minimal code** — chat-page.ts `<head>` 加 Inter link；`<style>` 顶部加 `:root` 变量块；逐个替换硬编码颜色为 `var()`；按钮圆角改 `9999px`；加 `prefers-reduced-motion` 与 focus outline

- [ ] **Step 4: Run test to verify it passes** — `npx vitest run tests/access/chat-page-adept-theme.spec.ts`

- [ ] **Step 5: Run existing chat-page tests to verify no regression** — `npx vitest run tests/access/chat-page-session.spec.ts tests/access/chat-page-sidebar.spec.ts tests/access/chat-page-token.spec.ts tests/access/rename-label.spec.ts`

- [ ] **Step 6: Commit** — `git add src/access/chat-page.ts tests/access/chat-page-adept-theme.spec.ts && git commit -m "feat(chat-page): migrate to adept.ai visual language with CSS variables"`

---

## Task 7: websocket-server.spec.ts 分组改造 + 全量回归

**Files:**
- Modify: `tests/access/websocket-server.spec.ts`

**Interfaces:**
- Consumes: Task 4 的 `serveDemoHtml` option

**Behavior:**
- 现有"GET / 返回聊天页"断言不动（默认配置组）
- 新增"landing 配置组"：传 `serveHtml=landingHtml` + `serveDemoHtml=chatHtml`，断言 `/` 返回 landing、`/demo` 返回 chat
- 确保现有测试在新 option 下仍全绿

- [ ] **Step 1: Run existing websocket-server.spec.ts to verify baseline** — `npx vitest run tests/access/websocket-server.spec.ts`（记录通过数）

- [ ] **Step 2: Add landing config test group** — 在现有 describe 块内新增 `describe('landingPage config', ...)` 子组，断言 landing 模式路由行为

- [ ] **Step 3: Run modified test file** — `npx vitest run tests/access/websocket-server.spec.ts`

- [ ] **Step 4: Run full regression** — `npx vitest run`（验证全部 584+ 项测试通过，含新增测试）

- [ ] **Step 5: Commit** — `git add tests/access/websocket-server.spec.ts && git commit -m "test(websocket-server): add landingPage config test group"`

---

## Self-Review

### 1. Spec coverage

| 设计文档要求 | 对应 Task |
|---|---|
| `config-types.ts` 加 `landingPage?: boolean` | Task 1 |
| `landing-page.ts` 导出 `createLandingPageHtml()` | Task 2 + 3 |
| 5 sections + nav + footer + i18n | Task 3 |
| adept design tokens（CSS 变量） | Task 2（landing）+ Task 6（chat-page） |
| Inter 字体 | Task 2（landing）+ Task 6（chat-page） |
| `websocket-server.ts` 加 `/demo` 路由 + `serveDemoHtml` | Task 4 |
| `server.ts` 根据 config 选择 HTML | Task 5 |
| `chat-page.ts` 风格迁移 | Task 6 |
| `landing-page.spec.ts` | Task 2 + 3 |
| `landing-page-i18n.spec.ts` | Task 3 |
| `chat-page-adept-theme.spec.ts` | Task 6 |
| `routing-landing.spec.ts` | Task 4 |
| `routing-default.spec.ts` | Task 4 |
| `websocket-server.spec.ts` 分组改造 | Task 7 |
| 584 项现有测试全绿 | Task 7 Step 4 全量回归 |

**Gaps:** 无。所有设计文档 in-scope 项均有对应 task。

### 2. Placeholder scan

- 无 "TBD" / "TODO" / "implement later"
- i18n 字典用 `/* ... */` 表示结构示意（实施时按 key 集合填充，非 placeholder）
- 颜色映射表用关键项示意（实施时按设计文档完整映射表替换）

### 3. Type consistency

- `createLandingPageHtml(): string` — Task 2 定义，Task 3 扩充内容，Task 5 调用 ✓
- `createChatPageHtml(wsPath: string): string` — 现有签名，Task 6 内部迁移不改签名 ✓
- `WebSocketServerOptions.serveDemoHtml?: string` — Task 4 定义，Task 5 传入 ✓
- `AptbotConfig.landingPage?: boolean` — Task 1 定义，Task 5 读取 ✓

---

## Execution Handoff

**Plan complete and saved to `docs/superpowers/plans/2026-06-30-aptbot-de-landing-page.md`. Two execution options:**

**1. Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints

**Which approach?**
