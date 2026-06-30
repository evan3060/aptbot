# aptbot.de 落地页 + Demo 页风格克隆设计（v0.2.1）

**日期：** 2026-06-30
**版本：** v0.2.1
**状态：** 待用户审核（基于 adept.ai Phase 1 Reconnaissance 真实数据）

## 目标

为 aptbot.de 个人 VPS demo 站点新增落地页，**严格克隆 [adept.ai](https://www.adept.ai/) 的真实视觉语言**（基于 Phase 1 Reconnaissance 提取的计算样式）；同步将现有 agent demo 页（[chat-page.ts](file:///Users/evan/projects/aptbot/src/access/chat-page.ts)）改为同一风格，保持视觉连续性。落地页通过 opt-in 配置启用，普通 clone 自部署用户默认不受影响。

## Phase 1 Reconnaissance 数据来源

所有设计 token 来自 adept.ai 真实 `getComputedStyle()` 提取，存储于 [docs/research/adept/extracted/](file:///Users/evan/projects/aptbot/docs/research/adept/extracted/)（已 gitignore）：

- [global-tokens.json](file:///Users/evan/projects/aptbot/docs/research/adept/extracted/global-tokens.json) — 全局色彩/字体
- [hero-deep.json](file:///Users/evan/projects/aptbot/docs/research/adept/extracted/hero-deep.json) — Hero h1 与 CTA 精确值
- [section-breakdown.json](file:///Users/evan/projects/aptbot/docs/research/adept/extracted/section-breakdown.json) — 8 个 section 拓扑
- [nav-header.json](file:///Users/evan/projects/aptbot/docs/research/adept/extracted/nav-header.json) — Nav 结构
- [fonts.json](file:///Users/evan/projects/aptbot/docs/research/adept/extracted/fonts.json) — @font-face 规则
- [scroll-behavior.json](file:///Users/evan/projects/aptbot/docs/research/adept/extracted/scroll-behavior.json) — Header 滚动行为
- 三视图截图：[screenshots/](file:///Users/evan/projects/aptbot/docs/research/adept/screenshots/) (1440/768/390 + hero crop)

## 范围

### In scope

- 新增 `src/access/landing-page.ts`，导出 `createLandingPageHtml()`
- [chat-page.ts](file:///Users/evan/projects/aptbot/src/access/chat-page.ts) 风格迁移到 adept.ai 真实 tokens（CSS 变量集中化）
- [websocket-server.ts](file:///Users/evan/projects/aptbot/src/access/websocket-server.ts) 路由扩展：新增 `/demo` 路由
- [config-types.ts](file:///Users/evan/projects/aptbot/src/infrastructure/config-types.ts) 新增 `landingPage?: boolean` opt-in 配置
- [server.ts](file:///Users/evan/projects/aptbot/src/server.ts) 根据 config 选择 HTML
- 落地页双语切换（中/英，默认中文，data-i18n + JS 字典）
- 5 个新增测试文件 + 1 个现有测试文件分组改造

### Out of scope

- 不引入静态文件服务（无 `public/` 目录；字体走 Google Fonts CDN）
- 不动 [src/webui/](file:///Users/evan/projects/aptbot/src/webui/) Lit 实现（L2 Task 10 处理）
- 不动 `/api/*` 路由
- 不引入构建步骤（保持 vanilla HTML 内联）
- 不引入 Tailwind / CSS-in-JS / i18n 库
- 不做 demo 页 i18n（保持中文）
- 不动 [src/cli/](file:///Users/evan/projects/aptbot/src/cli/) Ink 组件
- 不做 E2E / 视觉回归 / 性能基准测试
- 不下载 adept.ai 实际图片资源（只用结构 + tokens，内容是 aptbot 的）
- 不复制 adept.ai 的视频 / animated logo SVG（用占位 CSS 抽象示意）

## 架构

### 文件结构

```
src/access/
  ├── chat-page.ts          # 现有 demo 页（adept 风格迁移）
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

- **Clone 自部署用户**：默认 config 不含 `landingPage` → 行为同 v0.2.0 → 升级到 v0.2.1 零迁移成本
- **VPS demo**：`config/aptbot.json` 加 `"landingPage": true` → `/` 变落地页，`/demo` 是 agent
- `landing-page.ts` 源码始终在仓库，README/部署文档默认不介绍此特性，只在 design-notes.md 注明"个人 demo 站点可选启用"

## Design Tokens（提取自 adept.ai 真实计算样式）

### 色彩系统

#### 提取的真实色彩

| 角色 | Token 名 | 真实值（adept.ai） | aptbot 用途 |
|---|---|---|---|
| 主背景（白） | `--bg-base` | `rgb(255, 255, 255)` | 页面底色 |
| 暖米背景 | `--bg-warm` | `rgb(245, 242, 241)` | section 交替底色 |
| 暖灰背景 | `--bg-muted` | `rgb(249, 247, 244)` | 卡片底色 |
| 深色块 | `--bg-dark` | `rgb(39, 36, 34)` | footer / CTA 区 |
| 极深黑 | `--bg-darker` | `rgb(18, 18, 18)` | 局部强调 |
| 主文字 | `--text-primary` | `rgb(39, 36, 34)` | 近黑暖色 |
| 次文字 | `--text-secondary` | `rgb(139, 133, 127)` | 暖灰 |
| 强调色 | `--accent` | `rgb(13, 113, 73)` | 深绿（adept 品牌色） |
| 装饰粉 | `--decor-pink` | `rgb(241, 195, 214)` | 卡片/插画占位 |
| 装饰红 | `--decor-red` | `rgb(254, 190, 191)` | 卡片/插画占位 |
| 边框 | `--border` | `rgb(229, 231, 235)` | 极淡灰线 |
| 半透明白 | `--surface-translucent` | `rgba(255, 255, 255, 0.98)` | nav 滚动后底色 |
| 半透明深 | `--dark-translucent` | `rgba(39, 36, 34, 0.9)` | overlay |

#### chat-page.ts 风格迁移映射

| 元素 | 现值（v0.2.0 浅色+蓝） | 新值（adept 浅色+绿） |
|---|---|---|
| body bg | `#f7f7f8` | `var(--bg-base)` |
| sidebar/header/card bg | `#fff` | `var(--bg-base)` |
| primary text | `#1f2937` | `var(--text-primary)` |
| secondary text | `#6b7280` | `var(--text-secondary)` |
| tertiary text | `#9ca3af` | `var(--text-secondary)`（adept 无第三层灰） |
| border | `#e5e7eb` / `#d1d5db` | `var(--border)` |
| hover bg | `#f3f4f6` | `var(--bg-muted)` |
| active session bg | `#dbeafe` | `rgba(13, 113, 73, 0.12)`（绿淡底） |
| active session text | `#1e40af` | `var(--accent)` |
| accent (按钮/链接) | `#3b82f6` | `var(--accent)` |
| accent hover | `#2563eb` | `rgb(10, 95, 60)`（绿深一档） |
| assistant msg left border | `#3b82f6` | `var(--accent)` |
| tool msg bg | `#f3f4f6` | `var(--bg-muted)` |
| tool left border | `#f59e0b` | `var(--decor-red)`（adept 无 amber，用装饰红） |
| tool result text | `#047857` | `var(--accent)` |
| tool name text | `#92400e` | `var(--text-secondary)` |
| error msg bg | `#fee2e2` | `rgba(254, 190, 191, 0.3)` |
| error msg border-left | `#dc2626` | `var(--decor-red)` |
| error msg text | `#991b1b` | `var(--text-primary)` |
| status connected | `#d1fae5` / `#065f46` | `rgba(13, 113, 73, 0.15)` / `var(--accent)` |
| status disconnected | `#fee2e2` / `#991b1b` | `rgba(254, 190, 191, 0.3)` / `var(--text-primary)` |
| status default | `#fef3c7` / `#92400e` | `var(--bg-muted)` / `var(--text-secondary)` |
| CTA 按钮 | `#3b82f6` 直角矩形 | `var(--accent)` pill (border-radius 9999px) |
| modal overlay | `rgba(0,0,0,0.5)` | `var(--dark-translucent)` |

### 排版（提取自 adept.ai 真实值）

#### 字体策略

adept.ai 用自定义品牌字体 `Adept.ttf`（`/fonts/Adept.ttf`，仅 weight 400）。aptbot 无品牌字体，**用 Google Fonts Inter 替代**（variable weight 100-900，免费，与 Adept 细体风格接近）。

- **落地页**：`<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&display=swap" rel="stylesheet">`
- **chat-page.ts**：同样引入 Inter
- **等宽**：`ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace`（adept 真实值，保持一致）
- **中文 fallback**：`"PingFang SC"`（adept 自动 fallback，显式声明）

#### 字号阶梯（adept.ai 真实值）

| 元素 | font-size | font-weight | line-height | letter-spacing |
|---|---|---|---|---|
| Hero h1 | `72px` | `400` | `64.8px` | `-3.6px` |
| Section h2 (大) | `48px` | `400` | adept 未提取 | adept 未提取 |
| Section h2 (中) | `36px` | `400` | adept 未提取 | adept 未提取 |
| Section h2 (小) | `24px` | `400` | adept 未提取 | `-0.5px` |
| Body / p | `20px` | `400` | `25px` | `-0.5px` |
| Nav CTA | `20px` | `400` | — | — |
| Hero CTA | `24px` | `400` | — | — |
| Eval label (等宽) | `14px` | `700` | `14px` | `0.7px` |
| Footer 链接 | `16px` | `400` | — | — |

**关键规律：全站 weight 400**（包括 h1/h2/按钮），靠字号 + letter-spacing 拉层级，不靠字重。

#### chat-page.ts 字号迁移

- body 13/14/16px → 保持不变（chat 应用需紧凑）
- header h1 `aptbot` 16px → 保持，但字体改 Inter
- 字体改 Inter（不引入等宽变化，等宽保持现有）

### 间距与栅格（adept 真实值）

- **内容容器**：`max-width: 1650px`（adept 真实值），`margin: 0 auto`，padding `48px`（桌面）/`24px`（移动）
- **Section 间距**：`mt-24` (96px) / `mt-36` (144px) / `mt-48` (192px) —— 大间距
- **Section 内距**：根据高度自适应（adept section 高度 373-2097px 不等）
- **卡片栅格**：CSS Grid `repeat(auto-fit, minmax(280px, 1fr))`，gap `24px`
- **chat-page.ts**：现有布局不变（sidebar 260px + main flex:1，messages max-width 900px）

### 圆角 / 边框 / 动效

- **圆角**：adept 全站用 pill `border-radius: 9999px`（按钮、CTA）；卡片无圆角（直角）
- **边框**：CTA 按钮 `1px solid var(--text-primary)`（黑边）
- **阴影**：adept 不用 box-shadow（极简风）
- **动效**：
  - nav 滚动时背景透明 → 白（`transition: background-color 300ms ease-in-out`，adept 真实值）
  - hero 入场：adept 无 stagger 动画（静态）
  - `prefers-reduced-motion: reduce` 守护

### CSS 变量定义位置

落地页与 chat-page.ts 各自内联 `<style>` 顶部都定义 `:root { ... }` 块。两文件 token 名一致，值相同。当前不抽离公共 CSS 文件。

## 落地页内容（5 sections，对齐 adept 拓扑）

adept.ai 真实有 8 个 section（含 modal overlay），我们精简为 5 个（保留核心：Hero / Full-stack approach / Capabilities / Use cases / CTA+Footer），但每个 section 严格复刻 adept 的视觉处理。

### 整体结构

```
<html lang="zh-CN">
  <head>
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link href="...Inter:wght@400;500;600..." rel="stylesheet">
    <style> (adept tokens + 响应式) </style>
  </head>
  <body>
    <header> 粘性顶栏（透明→白） </header>
    <main>
      <section id="hero"> Hero </section>
      <section id="features"> 核心特性（4 卡） </section>
      <section id="architecture"> 架构亮点（4 卡 + 数据条） </section>
      <section id="use-cases"> 使用场景（3 例） </section>
      <section id="cta"> 行动召唤 </section>
    </main>
    <footer> 深色 footer </footer>
    <script> i18n 字典 + IntersectionObserver + toggle </script>
  </body>
</html>
```

### Section 1 — Hero（复刻 adept hero）

- 全宽，`height: 100vh`（adept 真实 900px on 1440 视口）
- 背景：`var(--bg-base)` 白底 + 右侧 hero 视觉占位（adept 用视频海报，我们用纯 CSS 抽象示意 —— 一行三列"通道卡片"缩影 CLI `$` / WebUI `□` / IM `✉`，低饱和度灰底 + `var(--accent)` 绿描边）
- 元素（左对齐，adept 真实布局）：
  - H1：`开源 · 自托管 · 完全属于你的 AI 助手` / `Open-source · Self-hosted · An AI assistant that's truly yours`
    - **`font-size: 72px` / `font-weight: 400` / `line-height: 64.8px` / `letter-spacing: -3.6px`** / `color: var(--text-primary)` / `font-family: Inter`
  - 副标题：`font-size: 20px` / `line-height: 25px` / `letter-spacing: -0.5px` / `color: var(--text-secondary)`
    - 内容：README 开头改写 —— "不只是聊天机器人，而是一个会思考、会行动、会记忆的 agent。能通过工具操作你的本地环境，能记住你的跨会话偏好，能通过 CLI / WebUI / IM 多端接入。"
  - 双 CTA（adept 真实样式）：
    - 主：`体验 Demo →` → `/demo`
      - `background: var(--text-primary)` / `color: var(--bg-base)` / `border: 1px solid var(--text-primary)` / `border-radius: 9999px` / `padding: 12px 36px` / `font-size: 24px` / `font-weight: 400`
    - 次：`查看 GitHub` → https://github.com/evan3060/aptbot
      - `background: var(--bg-base)` / `color: var(--text-primary)` / `border: 1px solid var(--text-primary)` / `border-radius: 9999px` / `padding: 12px 36px` / `font-size: 24px`

### Section 2 — 核心特性（复刻 adept "Full-stack approach"）

- 容器：`max-width: 1650px` + `margin-top: 96px`（adept 真实 `mt-24`）
- H2：`Building useful, reliable agents requires a full-stack approach` 的 aptbot 版 —— `不是框架，不是 SaaS，而是"你的"agent`
  - **`font-size: 24px` / `font-weight: 400` / `letter-spacing: -0.5px` / `color: var(--text-secondary)`**（adept 真实：次文字色，非主色！）
- 4 张卡片（复刻 adept 4 张 stack 卡布局）：

| 卡 | 标题（zh / en） | 描述 |
|---|---|---|
| 1 | 透明思考过程 / Transparent Thinking | core 仅 ~3 文件，可读的 ReAct loop。每个思考、每次工具调用、每个决策都对你完全可见。 |
| 2 | 多端接入 一段对话 / Multi-Channel One Conversation | CLI / WebUI / IM 共享同一段对话。手机上开始的对话在电脑上继续，终端启动的工作流在浏览器里完成。 |
| 3 | 多用户共享 单实例 / Multi-User One Instance | 多用户隔离让家人和团队成员在同一实例上拥有各自会话空间。一个 aptbot 服务全家 / 全团队。 |
| 4 | 分层架构 无限扩展 / Layered Architecture Infinite Extensibility | 严格四层架构 + 声明式 registry + Hook 系统（8 扩展点）。加 IM 通道零核心改动，加工具只需声明注册。 |

- 卡内容（adept 真实模式）：每卡 = 图片占位（adept 用 `_astro/stack-*.png`，我们用 CSS 几何符号）+ h3 标题 + 描述段落
- h3：`font-size: 20px` / `font-weight: 400` / `color: var(--text-primary)`
- 描述：`font-size: 20px` / `line-height: 25px` / `letter-spacing: -0.5px` / `color: var(--text-secondary)`
- 卡片：直角无圆角，无 box-shadow，背景透明（adept 真实）

### Section 3 — 架构亮点（复刻 adept "Agent capabilities" + 数据条）

- 容器：`max-width: 1650px` + `margin-top: 192px`（adept 真实 `mt-48`）
- H2：`Adept's agent capabilities` 的 aptbot 版 —— `aptbot 的架构亮点`
  - **`font-size: 36px` / `font-weight: 400` / `color: var(--text-primary)`**（adept 真实：此 section h2 比上一节大）
- 4 卡 + 数据条（adept 真实模式）：

| 卡 | 标题（zh / en） | 描述 |
|---|---|---|
| 1 | 会话持久化 跨会话记忆 / Session Persistence Cross-Session Memory | JSONL append-only 持久化。L2 起引入三层记忆架构（短期工作记忆 / 长期情景记忆 / 程序性技能记忆）。 |
| 2 | 多模型冗余 始终在线 / Multi-Model Redundancy Always Available | 主 + 备 provider 自动切换 + 熔断器。单一 provider 失败时无缝切换 —— 你的助手始终在线。 |
| 3 | 硬化边界 安全可控 / Hardened Boundaries Safe & Controllable | TTFB/块双时钟流式控制、30s 工具硬超时、大文件 OOM 防护、JSONL 损坏修复。每层都有防护。 |
| 4 | 双入口 统一状态机 / Dual Entry Unified State Machine | CLI (Ink) 与 WebUI (Lit) 共享同一 coreReducer 状态机。流式渲染、回合中断、多端同步是事件流的自然消费模式。 |

- 数据条（复刻 adept "Eval" 标签样式）：
  - 每项 = "Eval" 等宽小标签 + 大数字 + 描述
  - "Eval" 标签：`font-family: ui-monospace, SFMono-Regular, Menlo...` / `font-size: 14px` / `font-weight: 700` / `letter-spacing: 0.7px` / `color: var(--text-secondary)`
  - 大数字：`font-size: 48px` / `font-weight: 400` / `color: var(--text-primary)` / `font-family: Inter`
  - 数据（硬编码当前值，发版时手动同步）：
    - `584` tests passing / `584` 项测试通过
    - `4` layered architecture / `4` 层架构
    - `8` hook extension points / `8` 个 Hook 扩展点
    - `MIT` license / `MIT` 开源协议

### Section 4 — 使用场景（复刻 adept "Examples"）

- 容器：`max-width: 1650px`，背景 `var(--bg-base)` 白
- H2：`Examples of what we can do` 的 aptbot 版 —— `aptbot 能做什么`
  - **`font-size: 24px` / `font-weight: 400` / `color: var(--text-secondary)`**
- 3 个场景（复刻 adept "Adept in action" 模式）：

| 场景 | 标题（zh / en） | 描述 |
|---|---|---|
| 1 | 个人工作助手 / Personal Work Assistant | 学习、写作、研究、代码评审。工具调用透明可见，你随时知道它在做什么。跨会话记忆让偏好与上下文持续累积。 |
| 2 | 家庭/团队共享 / Family & Team Sharing | 一个实例，多个用户。家人查天气、订日程、查资料；团队成员共享工具配置但会话隔离。无需重复部署。 |
| 3 | 开发者二次开发 / Developer Extension | 声明式 registry 加工具，Hook 系统改流程，新 IM 通道零核心改动。aptbot 是可编程的助手底座，不是黑盒 SaaS。 |

- 每场景 = 图片占位（adept 用 use-case 截图，我们用 CSS 几何符号）+ h3 + 描述
- CTA 收尾：`分享你的使用场景 →` → https://github.com/evan3060/aptbot/issues/new

### Section 5 — CTA + Footer（复刻 adept "Trust" + footer）

#### CTA 区（复刻 adept "Trust and security"）

- 背景：`var(--bg-warm)` 暖米（adept 真实 `rgb(245,242,241)`）
- H2：`Trust and security` 的 aptbot 版 —— `立即体验 aptbot` / `Try aptbot now`
  - **`font-size: 48px` / `font-weight: 400` / `color: var(--text-primary)`**
- 副标题：`无需注册，直接进入 Demo 与你的助手对话。` / `No signup required — jump straight into the demo and start talking to your assistant.`
- 双 CTA：
  - 主：`进入 Demo →` → `/demo`（adept pill 样式，黑底白字）
  - 次：`自托管文档` → https://github.com/evan3060/aptbot#deployment（adept pill 样式，白底黑边）

#### Footer（复刻 adept footer）

- 背景：`var(--bg-dark)` `rgb(39, 36, 34)` 深色
- 文字色：`var(--bg-base)` 白
- 结构（adept 真实 "Enterprise inquiries / Learn more..." 模式）：
  - 左：`aptbot` wordmark + tagline `Your Personal AI Assistant`
  - 中：链接列 - GitHub / Documentation / Changelog / License
  - 右：版本号 `v0.2.0` + 协议 `MIT` + `© 2026 aptbot`
  - 底部：`Made with care · Open source · Self-hostable`

### Nav 粘性顶栏（复刻 adept header）

- `position: fixed` / `top: 0` / `height: 56px`（移动） / `144px`（桌面 `md:h-36`，adept 真实值）
- 背景：滚动前 `rgba(0,0,0,0)` 透明，滚动后 `var(--bg-base)` 白
- `transition: background-color 300ms ease-in-out`（adept 真实值）
- **无 backdrop-filter**（adept 不用）
- 左：`aptbot` wordmark（点击回 `/`）
- 中（桌面）：锚点链接 `特性` / `架构` / `场景`
- 右：语言切换（`中 / EN` pill）+ GitHub 链接 + `Demo` 主按钮（adept pill 样式）

## chat-page.ts 风格迁移

### 迁移策略

在 `<style>` 顶部新增 `:root { --bg-base: ...; ... }` 变量块（adept 真实 tokens），将所有选择器的颜色值替换为 `var(--token-name)`。同步引入 Inter 字体 `<link>`。

### 不变的部分

- 整体布局（sidebar 260px + main flex:1）
- 字号、圆角、间距（保持 chat 应用紧凑性）
- WebSocket 客户端逻辑（`<script>` 部分）零改动
- DOM 结构零改动
- 中文文案零改动（仍 `lang="zh-CN"`）

### 需改的部分

- 字体：`system-ui...` → `Inter, system-ui, "PingFang SC", sans-serif`
- 颜色：全部按"chat-page.ts 风格迁移映射"表替换
- 按钮：`#new-session-btn` / `#send` / `.submit-btn` 圆角从 `6px` → `9999px`（pill）
- 状态 pill：保留圆角 `999px`（已 pill）
- 边框：保留 `1px solid`，颜色换 `var(--border)`

### 边界情况

- `<link rel="icon" href="data:,">`：保持不变
- `#messages` 空状态文案 `暂无会话` 内联 `color:#9ca3af` → `var(--text-secondary)`
- `prefers-reduced-motion`：加 `@media (prefers-reduced-motion: reduce) { #working-dot { animation: none; } }`
- 可访问性：`#input:focus` / `.modal-content input:focus` 加 `outline: 2px solid var(--accent); outline-offset: 1px;`
- Inter 加载失败：fallback 到 `system-ui`（已在 font-family 声明）

### 视觉连续性

- 落地页与 demo 页共用同一套 tokens + Inter 字体
- 落地页 nav 与 demo 页 header 都是白底（滚动后）
- 落地页 CTA 与 demo 页 `#new-session-btn` 都是 pill + `var(--accent)` 或 `var(--text-primary)` 底
- 跳转无突兀感

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
| `tests/access/landing-page.spec.ts` | HTML 含 `#hero` / `#features` / `#architecture` / `#use-cases` / `#cta` 锚点；含 `/demo` 链接；含 GitHub 链接；含数据条数字 `584` / `4` / `8` / `MIT`；含 `data-i18n` 节点；含 Inter 字体 `<link>`；含 `--accent` CSS 变量 |
| `tests/access/landing-page-i18n.spec.ts` | `I18N.zh` 与 `I18N.en` key 集合一致；每个 `[data-i18n]` 的 key 在字典中存在；`applyLang` 函数定义存在；HTML 默认 `lang="zh-CN"` |
| `tests/access/chat-page-adept-theme.spec.ts` | HTML 含 `--bg-base` / `--text-primary` / `--accent` 等 CSS 变量定义；含 Inter 字体 `<link>`；不再含以下 v0.2.0 浅色+蓝色硬编码值：`#f7f7f8`、`#fff`、`#1f2937`、`#6b7280`、`#9ca3af`、`#e5e7eb`、`#d1d5db`、`#dbeafe`、`#1e40af`、`#3b82f6`、`#2563eb`、`#f3f4f6`、`#f59e0b`、`#92400e`、`#047857`、`#d1fae5`、`#065f46`、`#fef3c7`、`#fee2e2`、`#991b1b`、`#dc2626`、`#f9fafb`、`#374151`；按钮 `border-radius` 含 `9999px` |
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
- Inter 字体加载失败：fallback 到 `system-ui`（已在 font-family 声明）

#### 4. chat-page.ts 风格迁移回归

- WebSocket 客户端逻辑零改动
- 现有 L1 测试（584 项）应全绿。若因颜色值硬断言失败，按"测试不应断言颜色"原则修测试，不回退迁移

#### 5. 浏览器兼容性

- CSS 变量：所有现代浏览器支持
- Inter via Google Fonts CDN：需外网访问。本地部署若内网隔离，Inter 加载失败 fallback 到 system-ui（可接受）
- `IntersectionObserver` / `localStorage`：所有现代浏览器支持。`localStorage` 隐私模式用 try/catch 包裹

#### 6. 性能

- landing-page.ts 返回 HTML ~30-40KB（含内联 CSS + JS 字典 + DOM），与 chat-page.ts（~50KB）同量级
- Inter 字体：仅加载 weight 400/500/600，~50KB woff2
- `createLandingPageHtml()` 在 `server.ts` 启动时调用一次，结果字符串作为 `serveHtml` 传入

## 验收标准

1. `landingPage: true` 时访问 `/` 看到浅色暖调落地页，视觉贴近 adept.ai（白底 + 深绿 + 细体大字 + pill 按钮）
2. 落地页 Demo 按钮 / CTA 跳转到 `/demo`，看到同风格 agent 页
3. 落地页语言切换按钮点击后无刷新切换中/英文，刷新后保持选择
4. `landingPage` 未设置时（默认 config）访问 `/` 仍是原 chat 页，`/demo` 返回 404
5. `npx vitest run` 全量绿，含 5 个新增测试文件
6. chat-page.ts 所有现有功能（流式、工具调用、token 认证、自动重连、session rename、presence）正常工作
7. 落地页 h1 计算样式为 `font-size: 72px` / `font-weight: 400` / `letter-spacing: -3.6px`（可在浏览器 devtools 验证）
8. 落地页 CTA 按钮计算样式含 `border-radius: 9999px`（pill）

## 不在范围内（汇总）

- 静态文件服务、`public/` 目录
- [src/webui/](file:///Users/evan/projects/aptbot/src/webui/) Lit 实现
- `/api/*` 路由
- 构建步骤、Tailwind、CSS-in-JS、i18n 库
- demo 页 i18n
- [src/cli/](file:///Users/evan/projects/aptbot/src/cli/) Ink 组件
- E2E / 视觉回归 / 性能基准测试
- 下载 adept.ai 实际图片/视频/SVG 资源
- 复制 adept.ai 的 animated logo SVG
- 自定义品牌字体（用 Inter 替代）

## Phase 1 Reconnaissance 产物索引

设计依据存放于 [docs/research/adept/](file:///Users/evan/projects/aptbot/docs/research/adept/)（已 gitignore，仅本地参考）：

- `screenshots/full-page-desktop-1440.png` — 桌面全页截图
- `screenshots/full-page-tablet-768.png` — 平板全页截图
- `screenshots/full-page-mobile-390.png` — 移动全页截图
- `screenshots/hero-crop-1440.png` — Hero 区裁切
- `extracted/global-tokens.json` — 全局色彩/字体
- `extracted/hero-deep.json` — Hero h1 + CTA 精确值
- `extracted/section-breakdown.json` — 8 section 拓扑
- `extracted/nav-header.json` — Nav 结构
- `extracted/fonts.json` — @font-face 规则
- `extracted/scroll-behavior.json` — Header 滚动行为
- `extracted/assets.json` — 资源清单
- `extracted/full-page.html` — 完整 DOM 快照
