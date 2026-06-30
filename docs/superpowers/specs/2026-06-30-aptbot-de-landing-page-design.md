# aptbot.de 落地页 + Demo 页深色化设计（v0.2.1）

**日期：** 2026-06-30
**版本：** v0.2.1
**状态：** 待用户审核

## 目标

为 aptbot.de 个人 VPS demo 站点新增深色 premium 风格的落地页，参考 [adept.ai](https://www.adept.ai/) 的视觉语言；同步将现有 agent demo 页（[chat-page.ts](file:///Users/evan/projects/aptbot/src/access/chat-page.ts)）全面深色化，保持视觉连续性。落地页通过 opt-in 配置启用，普通 clone 自部署用户默认不受影响。

## 范围

### In scope

- 新增 `src/access/landing-page.ts`，导出 `createLandingPageHtml()`
- [chat-page.ts](file:///Users/evan/projects/aptbot/src/access/chat-page.ts) 内联 CSS 深色化迁移（CSS 变量集中化）
- [websocket-server.ts](file:///Users/evan/projects/aptbot/src/access/websocket-server.ts) 路由扩展：新增 `/demo` 路由
- [config-types.ts](file:///Users/evan/projects/aptbot/src/infrastructure/config-types.ts) 新增 `landingPage?: boolean` opt-in 配置
- [server.ts](file:///Users/evan/projects/aptbot/src/server.ts) 根据 config 选择 HTML
- 落地页双语切换（中/英，默认中文，data-i18n + JS 字典）
- 5 个新增测试文件 + 1 个现有测试文件分组改造

### Out of scope

- 不引入静态文件服务（无 `public/` 目录）
- 不动 [src/webui/](file:///Users/evan/projects/aptbot/src/webui/) Lit 实现（L2 Task 10 处理）
- 不动 `/api/*` 路由
- 不引入构建步骤（保持 vanilla HTML 内联）
- 不引入 web font、Tailwind、CSS-in-JS
- 不引入 i18n 库
- 不做 demo 页 i18n（保持中文）
- 不做 dark/light 切换（落地页与 demo 页都固定深色）
- 不动 [src/cli/](file:///Users/evan/projects/aptbot/src/cli/) Ink 组件
- 不做 E2E / 视觉回归 / 性能基准测试
- 不放视频 / 截图 / testimonials / 定价表

## 架构

### 文件结构

```
src/access/
  ├── chat-page.ts          # 现有 demo 页（深色化改造）
  ├── landing-page.ts       # 新增落地页
  ├── chat-page-session.ts  # 不变
  ├── chat-page-token.ts    # 不变
  └── websocket-server.ts   # 路由扩展
```

### 路由行为（[websocket-server.ts](file:///Users/evan/projects/aptbot/src/access/websocket-server.ts#L141-L163)）

| 配置 | `/` 与 `/index.html` | `/demo`、`/demo/`、`/demo/index.html` | `/api/*` | 其他 |
|---|---|---|---|---|
| `landingPage: false`（默认，clone 用户） | chat 页（**当前行为，零变化**） | 404 | 不变 | 404 |
| `landingPage: true`（VPS demo） | landing 页 | chat 页 | 不变 | 404 |

所有 HTML 响应保持 `cache-control: no-cache, no-store, must-revalidate`。

### 配置变更（[config-types.ts](file:///Users/evan/projects/aptbot/src/infrastructure/config-types.ts)）

`AptbotConfig` 接口新增字段：

```typescript
readonly landingPage?: boolean;
```

Zod schema 加 `landingPage: z.boolean().optional()`。`defaultConfig` 不加该字段（undefined → 视为 false）。

### 模块接口

`WebSocketServerOptions` 新增字段：

```typescript
serveDemoHtml?: string;
```

`server.ts` 根据 config 决定：

```typescript
const landingEnabled = config.landingPage === true;
serveHtml: landingEnabled ? createLandingPageHtml() : createChatPageHtml('/ws'),
serveDemoHtml: landingEnabled ? createChatPageHtml('/ws') : undefined,
```

### 用户分发

- **Clone 自部署用户**：默认 config 不含 `landingPage` → 行为同 v0.2.0 → 升级到 v0.2.1 零迁移成本。
- **VPS demo**：`config/aptbot.json` 加 `"landingPage": true` → `/` 变落地页，`/demo` 是 agent。
- `landing-page.ts` 源码始终在仓库，README/部署文档默认不介绍此特性，只在 design-notes.md 注明"个人 demo 站点可选启用"。

## 深色 Design Tokens

### 色彩系统

强调色保留 `#3b82f6` blue-500 作为品牌延续。

#### 落地页（深色 premium）

| 角色 | Token 名 | 值 |
|---|---|---|
| 页面底色 | `--bg-base` | `#0a0a0b` |
| 卡片/section 底 | `--bg-surface` | `#131316` |
| 提升层（hover/浮层） | `--bg-elevated` | `#1c1c20` |
| 主文字 | `--text-primary` | `#fafafa` |
| 次文字 | `--text-secondary` | `#a1a1aa` |
| 弱文字/时间戳 | `--text-tertiary` | `#71717a` |
| 边框 | `--border-subtle` | `rgba(255,255,255,0.08)` |
| 边框（强调） | `--border-strong` | `rgba(255,255,255,0.14)` |
| 强调色 | `--accent` | `#3b82f6` |
| 强调色 hover | `--accent-hover` | `#60a5fa` |
| 强调色淡底 | `--accent-soft` | `rgba(59,130,246,0.12)` |
| 成功 | `--success` | `#34d399` |
| 错误 | `--error` | `#f87171` |
| 警告 | `--warning` | `#fbbf24` |

#### chat-page.ts 深色化映射

| 元素 | 现值（浅） | 新值（深） |
|---|---|---|
| body bg | `#f7f7f8` | `var(--bg-base)` |
| sidebar/header/card bg | `#fff` | `var(--bg-surface)` |
| primary text | `#1f2937` | `var(--text-primary)` |
| secondary text | `#6b7280` | `var(--text-secondary)` |
| tertiary text | `#9ca3af` | `var(--text-tertiary)` |
| border | `#e5e7eb` / `#d1d5db` | `var(--border-subtle)` |
| hover bg | `#f3f4f6` | `rgba(255,255,255,0.04)` |
| active session bg | `#dbeafe` | `var(--accent-soft)` |
| active session text | `#1e40af` | `var(--accent-hover)` |
| user msg bg | `#fff` | `var(--bg-surface)` |
| assistant msg left border | `#3b82f6` | `var(--accent)` |
| tool msg bg | `#f3f4f6` | `#0f0f10` |
| tool left border | `#f59e0b` | `var(--warning)` |
| tool result text | `#047857` | `var(--success)` |
| tool name text | `#92400e` | `var(--warning)` |
| error msg bg | `#fee2e2` | `rgba(248,113,113,0.08)` |
| error msg border-left | `#dc2626` | `var(--error)` |
| error msg text | `#991b1b` | `var(--error)` |
| status connected | `#d1fae5` / `#065f46` | `rgba(52,211,153,0.15)` / `var(--success)` |
| status disconnected | `#fee2e2` / `#991b1b` | `rgba(248,113,113,0.15)` / `var(--error)` |
| status default | `#fef3c7` / `#92400e` | `rgba(251,191,36,0.15)` / `var(--warning)` |
| modal overlay | `rgba(0,0,0,0.5)` | `rgba(0,0,0,0.7)` |
| modal shadow | `0 10px 25px rgba(0,0,0,0.15)` | `0 10px 40px rgba(0,0,0,0.5)` |
| session-menu shadow | `0 2px 8px rgba(0,0,0,0.1)` | `0 4px 16px rgba(0,0,0,0.4)` |

### 排版

- **字族**：`system-ui, -apple-system, "Segoe UI", sans-serif`（不引入 web font）
- **等宽**：`ui-monospace, "SF Mono", monospace`
- **落地页字号阶梯**：
  - Hero h1: `clamp(40px, 6vw, 72px)` / weight 700 / line-height 1.1 / letter-spacing -0.02em
  - Section h2: `clamp(28px, 4vw, 44px)` / weight 600 / line-height 1.15
  - Card h3: `20px` / weight 600
  - Body: `16px` / weight 400 / line-height 1.6
  - Small/caption: `14px` / weight 400 / `--text-secondary`
- **chat-page.ts**：字号不变，只改颜色

### 间距与栅格

- **Section 垂直内距**：`clamp(64px, 10vw, 120px)` 上下
- **内容最大宽度**：`1200px` 居中，左右 padding `24px`（移动端）/`48px`（桌面）
- **卡片栅格**：CSS Grid `repeat(auto-fit, minmax(280px, 1fr))`，gap `24px`
- **chat-page.ts**：现有布局不变（sidebar 260px + main flex:1，messages max-width 900px）

### 圆角 / 阴影 / 动效

- **圆角**：cards `12px`，buttons/pills `8px`，badges `999px`（pill），inputs `8px`
- **阴影**：Cards 用 `0 1px 0 rgba(255,255,255,0.04) inset` + `0 0 0 1px var(--border-subtle)`；Hover 加 `0 4px 24px rgba(0,0,0,0.4)`
- **动效**：
  - 全局 `prefers-reduced-motion: reduce` 守护
  - 默认过渡：`transition: all 200ms cubic-bezier(0.4, 0, 0.2, 1)`
  - Hero CTA hover：背景色 + `translateY(-1px)`
  - Section 入场：`opacity 0 → 1` + `translateY(12px) → 0`，IntersectionObserver 触发，`400ms ease-out`

### CSS 变量定义位置

落地页与 chat-page.ts 各自内联 `<style>` 顶部都定义 `:root { ... }` 块。两文件 token 名一致，值相同。当前不抽离公共 CSS 文件。

## 落地页内容（5 sections）

### 整体结构

```
<html lang="zh-CN">
  <head> meta + <style> (深色 tokens + 响应式) </head>
  <body>
    <nav> 粘性顶栏 </nav>
    <main>
      <section id="hero"> Hero </section>
      <section id="features"> 核心特性 </section>
      <section id="architecture"> 架构亮点 </section>
      <section id="use-cases"> 使用场景 </section>
      <section id="cta"> 行动召唤 </section>
    </main>
    <footer> 链接 + 版权 </footer>
    <script> i18n 字典 + IntersectionObserver + toggle </script>
  </body>
</html>
```

### Section 1 — Hero

- 全宽，垂直居中，`min-height: 88vh`
- 元素：
  - 顶部 badge：`v0.2.0 · L1 已交付`（pill，`--accent-soft` 底）
  - H1：`开源 · 自托管 · 完全属于你的 AI 助手` / `Open-source · Self-hosted · An AI assistant that's truly yours`
  - 副标题：README 开头改写 —— "不只是聊天机器人，而是一个会思考、会行动、会记忆的 agent。能通过工具操作你的本地环境，能记住你的跨会话偏好，能通过 CLI / WebUI / IM 多端接入。"
  - 双 CTA：
    - 主：`体验 Demo →` → `/demo`
    - 次：`查看 GitHub` → https://github.com/evan3060/aptbot
  - Hero 视觉元素：纯 CSS 抽象示意 —— 一行三列"通道卡片"缩影（CLI `$`、WebUI `□`、IM `✉`），低饱和度灰底 + 强调色描边。**占位，后续补充图片。**
- 动效：badge / h1 / 副标题 / CTA 依次淡入上移（stagger 80ms）

### Section 2 — 核心特性（4 卡）

- 布局：CSS Grid `repeat(auto-fit, minmax(280px, 1fr))`，gap 24px
- 4 卡（精选 README "Core features"）：

| 卡 | 标题（zh / en） | 描述 |
|---|---|---|
| 1 | 透明思考过程 / Transparent Thinking | core 仅 ~3 文件，可读的 ReAct loop。每个思考、每次工具调用、每个决策都对你完全可见。 |
| 2 | 多端接入 一段对话 / Multi-Channel One Conversation | CLI / WebUI / IM 共享同一段对话。手机上开始的对话在电脑上继续，终端启动的工作流在浏览器里完成。 |
| 3 | 多用户共享 单实例 / Multi-User One Instance | 多用户隔离让家人和团队成员在同一实例上拥有各自会话空间。一个 aptbot 服务全家 / 全团队。 |
| 4 | 分层架构 无限扩展 / Layered Architecture Infinite Extensibility | 严格四层架构 + 声明式 registry + Hook 系统（8 扩展点）。加 IM 通道零核心改动，加工具只需声明注册。 |

- 卡内容：顶部序号或 CSS 几何符号 + h3 + 描述段落
- hover：边框 `--border-subtle` → `--border-strong`，背景 `--bg-surface` → `--bg-elevated`，`translateY(-2px)`

### Section 3 — 架构亮点（4 卡 + 1 数据条）

- 上半 4 卡网格，下半横向数据条
- 4 卡：

| 卡 | 标题（zh / en） | 描述 |
|---|---|---|
| 1 | 会话持久化 跨会话记忆 / Session Persistence Cross-Session Memory | JSONL append-only 持久化。L2 起引入三层记忆架构（短期工作记忆 / 长期情景记忆 / 程序性技能记忆）。 |
| 2 | 多模型冗余 始终在线 / Multi-Model Redundancy Always Available | 主 + 备 provider 自动切换 + 熔断器。单一 provider 失败时无缝切换 —— 你的助手始终在线。 |
| 3 | 硬化边界 安全可控 / Hardened Boundaries Safe & Controllable | TTFB/块双时钟流式控制、30s 工具硬超时、大文件 OOM 防护、JSONL 损坏修复。每层都有防护。 |
| 4 | 双入口 统一状态机 / Dual Entry Unified State Machine | CLI (Ink) 与 WebUI (Lit) 共享同一 coreReducer 状态机。流式渲染、回合中断、多端同步是事件流的自然消费模式。 |

- 数据条（硬编码当前值，发版时手动同步）：
  - `584` tests passing / `584` 项测试通过
  - `4` layered architecture / `4` 层架构
  - `8` hook extension points / `8` 个 Hook 扩展点
  - `MIT` license / `MIT` 开源协议

### Section 4 — 使用场景（3 例）

- 三栏卡片，每张含"图标位 + 场景标题 + 描述"

| 场景 | 标题（zh / en） | 描述 |
|---|---|---|
| 1 | 个人工作助手 / Personal Work Assistant | 学习、写作、研究、代码评审。工具调用透明可见，你随时知道它在做什么。跨会话记忆让偏好与上下文持续累积。 |
| 2 | 家庭/团队共享 / Family & Team Sharing | 一个实例，多个用户。家人查天气、订日程、查资料；团队成员共享工具配置但会话隔离。无需重复部署。 |
| 3 | 开发者二次开发 / Developer Extension | 声明式 registry 加工具，Hook 系统改流程，新 IM 通道零核心改动。aptbot 是可编程的助手底座，不是黑盒 SaaS。 |

- CTA 收尾：`分享你的使用场景 →` → https://github.com/evan3060/aptbot/issues/new

### Section 5 — CTA + Footer

- CTA 区：单列居中，大标题 `立即体验 aptbot` / `Try aptbot now`，副标题 `无需注册，直接进入 Demo 与你的助手对话。` / `No signup required — jump straight into the demo and start talking to your assistant.`
- 双 CTA：
  - 主：`进入 Demo →` → `/demo`
  - 次：`自托管文档` → https://github.com/evan3060/aptbot#deployment
- Footer：
  - 左：`aptbot` wordmark + tagline `Your Personal AI Assistant`
  - 中：链接列 - GitHub / Documentation / Changelog / License
  - 右：版本号 `v0.2.0` + 协议 `MIT` + `© 2026 aptbot`
  - 底部一行：`Made with care · Open source · Self-hostable`

### Nav 粘性顶栏

- 高度 `64px`，背景 `rgba(10,10,11,0.8)` + `backdrop-filter: blur(12px)`（Safari 加 `-webkit-` 前缀）+ 底部 1px `--border-subtle`
- 左：`aptbot` wordmark（点击回 `/`）
- 中（桌面）：锚点链接 `特性` / `架构` / `场景`
- 右：语言切换（`中 / EN` pill）+ GitHub 链接 + Demo 主按钮

## chat-page.ts 深色化迁移

### 迁移策略

在 `<style>` 顶部新增 `:root { --bg-base: ...; ... }` 变量块（全部 tokens），将所有选择器的颜色值替换为 `var(--token-name)`。

### 不变的部分

- 整体布局（sidebar 260px + main flex:1）
- 字体、字号、圆角、间距
- WebSocket 客户端逻辑（`<script>` 部分）零改动
- DOM 结构零改动
- 中文文案零改动（仍 `lang="zh-CN"`）

### 边界情况

- `<link rel="icon" href="data:,">`：保持不变
- `#messages` 空状态文案 `暂无会话` 内联 `color:#9ca3af` → `var(--text-tertiary)`
- `box-shadow`：深色下加重（见 tokens 表）
- `prefers-reduced-motion`：加 `@media (prefers-reduced-motion: reduce) { #working-dot { animation: none; } }`
- 可访问性：`#input:focus` / `.modal-content input:focus` 加 `outline: 2px solid var(--accent); outline-offset: 1px;`

### 视觉连续性

- 落地页 nav 用 `rgba(10,10,11,0.8) + blur`，demo 页 header 用 `#131316`（不透明）—— 两者都是深色，跳转无突兀感
- 落地页 CTA 与 demo 页 `#new-session-btn` 共用 `--accent: #3b82f6`
- 字体一致（system-ui）

## i18n 双语实现

### 实现方式

`data-i18n` 属性 + JS 字典对象。无刷新切换，URL hash + localStorage 记录选择。

### 字典结构（内联在 `<script>` 中）

```javascript
const I18N = {
  zh: { 'nav.features': '特性', 'nav.architecture': '架构', /* ... */ },
  en: { 'nav.features': 'Features', 'nav.architecture': 'Architecture', /* ... */ }
};
```

### DOM 标注

每个需翻译文本节点加 `data-i18n="key"`，默认 innerHTML 是中文。

### 切换逻辑

```javascript
function applyLang(lang) {
  document.documentElement.lang = lang === 'zh' ? 'zh-CN' : 'en';
  document.querySelectorAll('[data-i18n]').forEach(el => {
    const key = el.dataset.i18n;
    if (I18N[lang][key]) el.textContent = I18N[lang][key];
  });
  const toggle = document.querySelector('[data-i18n="nav.lang"]');
  if (toggle) toggle.textContent = lang === 'zh' ? 'EN' : '中';
  try { localStorage.setItem('aptbot.lang', lang); } catch (e) {}
  history.replaceState(null, '', `#${lang}`);
}

// 初始化优先级：URL hash > localStorage > 浏览器语言 > 'zh'
const initLang = (location.hash.slice(1)
  || localStorage.getItem('aptbot.lang')
  || (navigator.language.startsWith('zh') ? 'zh' : 'en'));
applyLang(initLang === 'en' ? 'en' : 'zh');
```

### `<html lang>` 属性

初始 HTML 写 `lang="zh-CN"`，JS applyLang 时同步更新。

### 切换按钮

Nav 右侧 pill，显示"另一种语言"，onclick 调用 `applyLang`。

### 不在范围内

- 不引入 i18n 库
- 不做后端渲染双语
- demo 页（chat-page.ts）不做 i18n，保持中文
- 不做 SEO 双语独立 URL

## 测试与错误处理

### 新增测试文件

| 文件 | 断言内容 |
|---|---|
| `tests/access/landing-page.spec.ts` | HTML 含 `#hero` / `#features` / `#architecture` / `#use-cases` / `#cta` 锚点；含 `/demo` 链接；含 GitHub 链接；含数据条数字 `584` / `4` / `8` / `MIT`；含 `data-i18n` 节点 |
| `tests/access/landing-page-i18n.spec.ts` | `I18N.zh` 与 `I18N.en` key 集合一致；每个 `[data-i18n]` 的 key 在字典中存在；`applyLang` 函数定义存在；HTML 默认 `lang="zh-CN"` |
| `tests/access/chat-page-dark-theme.spec.ts` | HTML 含 `--bg-base` / `--text-primary` / `--accent` 等 CSS 变量定义；不再含以下浅色硬编码值：`#f7f7f8`、`#fff`、`#1f2937`、`#6b7280`、`#9ca3af`、`#e5e7eb`、`#d1d5db`、`#dbeafe`、`#1e40af`、`#f3f4f6`、`#f59e0b`、`#92400e`、`#047857`、`#d1fae5`、`#065f46`、`#fef3c7`、`#fee2e2`、`#991b1b`、`#dc2626`、`#f9fafb`、`#374151` |
| `tests/access/routing-landing.spec.ts` | `landingPage: true` 时 `GET /` 返回 landing HTML（含 `#hero`），`GET /demo` 返回 chat HTML（含 `#messages`），`GET /api/login` 行为不变 |
| `tests/access/routing-default.spec.ts` | `landingPage` 未设置时 `GET /` 返回 chat HTML（含 `#messages`），`GET /demo` 返回 404，`GET /api/login` 不变 —— 回归保护 |

### 现有测试改造

`tests/access/websocket-server.spec.ts`：现有断言"GET / 返回聊天页"分两组 —— "默认配置"组断言 `/` 是 chat；"landing 配置"组断言 `/` 是 landing、`/demo` 是 chat。新增 `serveDemoHtml` option 传入。

### TDD 验证命令

```bash
# 单文件
npx vitest run tests/access/landing-page.spec.ts

# access 目录全量
npx vitest run tests/access/

# 全量回归
npx vitest run
```

### 错误处理与边界

#### 1. 配置验证

`config-types.ts` Zod schema 加 `landingPage: z.boolean().optional()`。若用户传 `"true"`（字符串）或 `1`（数字），Zod 报错，沿用现有 `validateConfig` 错误链路。

#### 2. 路由边界

- `GET /demo/`（带尾斜杠）：宽松匹配 `pathname === '/demo' || pathname === '/demo/' || pathname === '/demo/index.html'`
- `GET /Demo`（大写）：返回 404，与现有 `/` 行为一致
- `GET /demo?token=xxx`：query string 被 `new URL().pathname` 剥离，pathname 仍是 `/demo`，正常匹配

#### 3. landing-page.ts 内部

- 纯字符串拼接函数，无 I/O，无异常路径
- i18n 字典 key 缺失时 `applyLang` 静默跳过（`if (I18N[lang][key])` 守护）

#### 4. chat-page.ts 深色化回归

- WebSocket 客户端逻辑零改动
- 现有 L1 测试（584 项）应全绿。若因颜色值硬断言失败，按"测试不应断言颜色"原则修测试，不回退深色化

#### 5. 浏览器兼容性

- CSS 变量：所有现代浏览器支持
- `backdrop-filter: blur(12px)`：Chrome / Safari / Firefox 支持，Safari 加 `-webkit-` 前缀
- `IntersectionObserver` / `localStorage`：所有现代浏览器支持。`localStorage` 隐私模式用 try/catch 包裹

#### 6. 性能

- landing-page.ts 返回 HTML ~30-40KB（含内联 CSS + JS 字典 + DOM），与 chat-page.ts（~50KB）同量级
- `createLandingPageHtml()` 在 `server.ts` 启动时调用一次，结果字符串作为 `serveHtml` 传入（与 chat-page.ts 现有模式一致）

## 验收标准

1. `landingPage: true` 时访问 `/` 看到深色落地页，含 5 个 section + nav + footer
2. 落地页 Demo 按钮 / CTA 跳转到 `/demo`，看到深色 agent 页
3. 落地页语言切换按钮点击后无刷新切换中/英文，刷新后保持选择
4. `landingPage` 未设置时（默认 config）访问 `/` 仍是原 chat 页，`/demo` 返回 404
5. `npx vitest run` 全量绿，含 5 个新增测试文件
6. chat-page.ts 所有现有功能（流式、工具调用、token 认证、自动重连、session rename、presence）正常工作

## 不在范围内（汇总）

- 静态文件服务、`public/` 目录
- [src/webui/](file:///Users/evan/projects/aptbot/src/webui/) Lit 实现
- `/api/*` 路由
- 构建步骤、web font、Tailwind、CSS-in-JS、i18n 库
- demo 页 i18n、dark/light 切换
- [src/cli/](file:///Users/evan/projects/aptbot/src/cli/) Ink 组件
- E2E / 视觉回归 / 性能基准测试
- 视频 / 截图 / testimonials / 定价表
