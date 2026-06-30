/**
 * 落地页 HTML 生成器（adept.ai 风格）。
 *
 * 纯字符串拼接函数，无 I/O，无异常路径。
 * Task 2 建立骨架（<head> + <style> design tokens + 空 <body>）。
 * Task 3 填充 5 sections 内容 + nav + footer + i18n 字典 + applyLang() + IntersectionObserver。
 */
export function createLandingPageHtml(): string {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<link rel="icon" href="data:,">
<title>aptbot</title>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&display=swap" rel="stylesheet">
<style>
  :root {
    --bg-base: rgb(255, 255, 255);
    --bg-warm: rgb(245, 242, 241);
    --bg-muted: rgb(249, 247, 244);
    --bg-dark: rgb(39, 36, 34);
    --bg-darker: rgb(18, 18, 18);
    --text-primary: rgb(39, 36, 34);
    --text-secondary: rgb(139, 133, 127);
    --accent: rgb(13, 113, 73);
    --decor-pink: rgb(241, 195, 214);
    --decor-red: rgb(254, 190, 191);
    --border: rgb(229, 231, 235);
    --surface-translucent: rgba(255, 255, 255, 0.98);
    --dark-translucent: rgba(39, 36, 34, 0.9);
  }

  * { box-sizing: border-box; margin: 0; padding: 0; }
  html { scroll-behavior: smooth; }
  body {
    font-family: Inter, system-ui, "PingFang SC", sans-serif;
    background: var(--bg-base);
    color: var(--text-primary);
    font-size: 20px;
    line-height: 25px;
    letter-spacing: -0.5px;
    -webkit-font-smoothing: antialiased;
  }
  a { color: inherit; text-decoration: none; }
  .container {
    max-width: 1650px;
    margin: 0 auto;
    padding: 48px;
  }

  /* Nav 粘性顶栏：始终半透明 + 模糊背景，避免滚动时下层文字透出叠加 */
  #nav {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    height: 56px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0 48px;
    background-color: rgba(255, 255, 255, 0.85);
    backdrop-filter: blur(8px);
    -webkit-backdrop-filter: blur(8px);
    transition: border-color 300ms ease-in-out, box-shadow 300ms ease-in-out;
    border-bottom: 1px solid transparent;
    z-index: 100;
  }
  #nav.scrolled {
    border-bottom: 1px solid var(--border);
    box-shadow: 0 1px 6px rgba(0, 0, 0, 0.04);
  }
  .nav-wordmark {
    font-size: 20px;
    font-weight: 500;
    letter-spacing: -0.5px;
    color: var(--text-primary);
  }
  .nav-links { display: flex; gap: 32px; }
  .nav-links a { font-size: 16px; color: var(--text-secondary); }
  .nav-links a:hover { color: var(--text-primary); }
  .nav-actions { display: flex; align-items: center; gap: 16px; }
  .nav-lang {
    font-size: 14px;
    padding: 6px 14px;
    border: 1px solid var(--border);
    border-radius: 9999px;
    color: var(--text-primary);
    cursor: pointer;
  }
  .nav-github { font-size: 16px; color: var(--text-secondary); }
  .nav-demo-btn {
    font-size: 16px;
    padding: 8px 20px;
    border-radius: 9999px;
    background: var(--text-primary);
    color: var(--bg-base);
    border: 1px solid var(--text-primary);
  }

  /* Pill 按钮（adept 真实样式：黑边 pill） */
  .btn-pill {
    display: inline-block;
    border-radius: 9999px;
    padding: 12px 36px;
    font-size: 24px;
    font-weight: 400;
    font-family: Inter, system-ui, "PingFang SC", sans-serif;
    border: 1px solid var(--text-primary);
    cursor: pointer;
    letter-spacing: -0.5px;
  }
  .btn-pill-primary { background: var(--text-primary); color: var(--bg-base); }
  .btn-pill-secondary { background: var(--bg-base); color: var(--text-primary); }

  /* Hero */
  #hero {
    min-height: 100vh;
    display: flex;
    align-items: center;
    padding: 96px 48px 48px;
    gap: 48px;
  }
  .hero-content { flex: 1; max-width: 760px; }
  #hero h1 {
    font-size: 72px;
    font-weight: 400;
    line-height: 64.8px;
    letter-spacing: -3.6px;
    color: var(--text-primary);
    font-family: Inter, system-ui, "PingFang SC", sans-serif;
    margin-bottom: 32px;
  }
  .hero-subtitle {
    font-size: 20px;
    line-height: 25px;
    letter-spacing: -0.5px;
    color: var(--text-secondary);
    margin-bottom: 48px;
    max-width: 620px;
  }
  .hero-ctas { display: flex; gap: 16px; flex-wrap: wrap; }
  .hero-visual {
    flex: 0 0 360px;
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .hero-channel {
    padding: 24px;
    background: var(--bg-muted);
    border: 1px solid var(--border);
    border-left: 3px solid var(--accent);
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
    font-size: 14px;
    color: var(--text-secondary);
  }

  /* Section 通用 */
  section { padding: 96px 48px; }
  .section-h2-sm {
    font-size: 24px;
    font-weight: 400;
    letter-spacing: -0.5px;
    color: var(--text-secondary);
    margin-bottom: 64px;
  }
  .section-h2-md {
    font-size: 36px;
    font-weight: 400;
    color: var(--text-primary);
    margin-bottom: 64px;
    letter-spacing: -0.5px;
  }
  .section-h2-lg {
    font-size: 48px;
    font-weight: 400;
    color: var(--text-primary);
    margin-bottom: 32px;
    letter-spacing: -1px;
  }

  /* 卡片栅格（adept 真实：直角无圆角、无阴影、透明底） */
  .card-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
    gap: 24px;
  }
  .card { padding: 32px 0; }
  .card-icon {
    width: 48px;
    height: 48px;
    margin-bottom: 24px;
    background: var(--bg-muted);
    border: 1px solid var(--border);
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 24px;
    color: var(--accent);
  }
  .card h3 {
    font-size: 20px;
    font-weight: 400;
    color: var(--text-primary);
    margin-bottom: 12px;
    letter-spacing: -0.5px;
  }
  .card-desc {
    font-size: 20px;
    line-height: 25px;
    letter-spacing: -0.5px;
    color: var(--text-secondary);
  }

  /* 数据条（adept Eval 标签样式） */
  .data-bar {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
    gap: 32px;
    margin-top: 96px;
    padding-top: 48px;
    border-top: 1px solid var(--border);
  }
  .eval-label {
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
    font-size: 14px;
    font-weight: 700;
    letter-spacing: 0.7px;
    color: var(--text-secondary);
    margin-bottom: 8px;
  }
  .eval-value {
    font-size: 48px;
    font-weight: 400;
    color: var(--text-primary);
    font-family: Inter, system-ui, "PingFang SC", sans-serif;
    line-height: 1.1;
  }

  /* Use cases 收尾 CTA */
  .use-case-cta {
    display: inline-block;
    margin-top: 64px;
    font-size: 20px;
    color: var(--accent);
    letter-spacing: -0.5px;
  }

  /* CTA section */
  #cta { background: var(--bg-warm); text-align: center; }
  .cta-subtitle {
    font-size: 20px;
    line-height: 25px;
    letter-spacing: -0.5px;
    color: var(--text-secondary);
    margin-bottom: 48px;
  }
  .cta-buttons { display: flex; gap: 16px; justify-content: center; flex-wrap: wrap; }

  /* Footer（深色块） */
  footer {
    background: var(--bg-dark);
    color: var(--bg-base);
    padding: 64px 48px;
  }
  .footer-grid {
    max-width: 1650px;
    margin: 0 auto;
    display: grid;
    grid-template-columns: 1fr 1fr 1fr;
    gap: 48px;
  }
  .footer-wordmark { font-size: 24px; font-weight: 500; margin-bottom: 8px; }
  .footer-tagline { font-size: 16px; color: var(--text-secondary); }
  .footer-links { display: flex; flex-direction: column; gap: 12px; }
  .footer-links a { font-size: 16px; color: var(--bg-base); }
  .footer-meta { font-size: 16px; text-align: right; color: var(--bg-base); line-height: 1.6; }
  .footer-bottom {
    max-width: 1650px;
    margin: 48px auto 0;
    padding-top: 24px;
    border-top: 1px solid rgba(255, 255, 255, 0.1);
    font-size: 14px;
    color: var(--text-secondary);
    text-align: center;
  }

  /* 响应式：桌面 nav 加高，移动端收起锚点与 hero 视觉 */
  @media (min-width: 768px) {
    #nav { height: 144px; }
  }
  @media (max-width: 767px) {
    body { font-size: 16px; line-height: 22px; }
    #nav { padding: 0 16px; }
    .nav-links { display: none; }
    .nav-wordmark { font-size: 18px; }
    .nav-actions { gap: 8px; }
    .nav-lang {
      font-size: 12px;
      padding: 4px 10px;
      line-height: 1.2;
    }
    .nav-github { font-size: 14px; }
    .nav-demo-btn {
      font-size: 14px;
      padding: 6px 14px;
      line-height: 1.2;
    }

    #hero { flex-direction: column; padding: 80px 20px 40px; gap: 24px; }
    .hero-visual { flex: none; width: 100%; }
    #hero h1 { font-size: 36px; line-height: 40px; letter-spacing: -1.5px; margin-bottom: 20px; }
    .hero-subtitle { font-size: 16px; line-height: 22px; margin-bottom: 28px; }
    .hero-ctas { gap: 10px; }
    .hero-channel { padding: 16px; font-size: 12px; }

    .btn-pill {
      font-size: 16px;
      padding: 10px 24px;
      letter-spacing: -0.3px;
    }

    section { padding: 56px 20px; }
    .container { padding: 20px; }
    .section-h2-sm { font-size: 16px; margin-bottom: 32px; }
    .section-h2-md { font-size: 24px; margin-bottom: 32px; }
    .section-h2-lg { font-size: 28px; margin-bottom: 20px; letter-spacing: -0.5px; }

    .card { padding: 20px 0; }
    .card-icon { width: 36px; height: 36px; margin-bottom: 16px; font-size: 18px; }
    .card h3 { font-size: 17px; margin-bottom: 8px; }
    .card-desc { font-size: 15px; line-height: 21px; }

    .data-bar { grid-template-columns: 1fr 1fr; gap: 20px; margin-top: 48px; padding-top: 28px; }
    .eval-label { font-size: 12px; }
    .eval-value { font-size: 28px; }

    .use-case-cta { font-size: 16px; margin-top: 32px; }
    .cta-subtitle { font-size: 16px; line-height: 22px; margin-bottom: 28px; }

    footer { padding: 40px 20px; }
    .footer-grid { grid-template-columns: 1fr; gap: 24px; }
    .footer-wordmark { font-size: 20px; }
    .footer-tagline { font-size: 14px; }
    .footer-links a { font-size: 14px; }
    .footer-meta { font-size: 14px; text-align: left; line-height: 1.6; }
    .footer-bottom { font-size: 12px; padding-top: 16px; }
  }

  @media (prefers-reduced-motion: reduce) {
    html { scroll-behavior: auto; }
    #nav { transition: none; }
  }
</style>
</head>
<body>
<header id="nav">
  <a href="/" class="nav-wordmark">aptbot</a>
  <nav class="nav-links">
    <a href="#features" data-i18n="nav.features">特性</a>
    <a href="#architecture" data-i18n="nav.architecture">架构</a>
    <a href="#use-cases" data-i18n="nav.useCases">场景</a>
  </nav>
  <div class="nav-actions">
    <a href="#" class="nav-lang" data-i18n="nav.lang" onclick="applyLang(document.documentElement.lang === 'zh-CN' ? 'en' : 'zh'); return false;">EN</a>
    <a href="https://github.com/evan3060/aptbot" class="nav-github" data-i18n="nav.github">GitHub</a>
    <a href="/demo" class="nav-demo-btn" data-i18n="nav.demo">体验 Demo</a>
  </div>
</header>

<main>
  <section id="hero">
    <div class="hero-content">
      <h1 data-i18n="hero.h1">开源 · 自托管 · 完全属于你的 AI 助手</h1>
      <p class="hero-subtitle" data-i18n="hero.subtitle">不只是聊天机器人，而是一个会思考、会行动、会记忆的 agent。能通过工具操作你的本地环境，能记住你的跨会话偏好，能通过 CLI / WebUI / IM 多端接入。</p>
      <div class="hero-ctas">
        <a href="/demo" class="btn-pill btn-pill-primary" data-i18n="hero.cta.primary">体验 Demo →</a>
        <a href="https://github.com/evan3060/aptbot" class="btn-pill btn-pill-secondary" data-i18n="hero.cta.secondary">查看 GitHub</a>
      </div>
    </div>
    <div class="hero-visual" aria-hidden="true">
      <div class="hero-channel">$ aptbot chat</div>
      <div class="hero-channel">□ aptbot webui</div>
      <div class="hero-channel">✉ aptbot im</div>
    </div>
  </section>

  <section id="features">
    <div class="container">
      <h2 class="section-h2-sm" data-i18n="features.h2">不是框架，不是 SaaS，而是"你的"agent</h2>
      <div class="card-grid">
        <div class="card">
          <div class="card-icon">◐</div>
          <h3 data-i18n="features.card1.title">透明思考过程</h3>
          <p class="card-desc" data-i18n="features.card1.desc">core 仅 ~3 文件，可读的 ReAct loop。每个思考、每次工具调用、每个决策都对你完全可见。</p>
        </div>
        <div class="card">
          <div class="card-icon">⚡</div>
          <h3 data-i18n="features.card2.title">多端接入 一段对话</h3>
          <p class="card-desc" data-i18n="features.card2.desc">CLI / WebUI / IM 共享同一段对话。手机上开始的对话在电脑上继续，终端启动的工作流在浏览器里完成。</p>
        </div>
        <div class="card">
          <div class="card-icon">◈</div>
          <h3 data-i18n="features.card3.title">多用户共享 单实例</h3>
          <p class="card-desc" data-i18n="features.card3.desc">多用户隔离让家人和团队成员在同一实例上拥有各自会话空间。一个 aptbot 服务全家 / 全团队。</p>
        </div>
        <div class="card">
          <div class="card-icon">⬡</div>
          <h3 data-i18n="features.card4.title">分层架构 无限扩展</h3>
          <p class="card-desc" data-i18n="features.card4.desc">严格四层架构 + 声明式 registry + Hook 系统（8 扩展点）。加 IM 通道零核心改动，加工具只需声明注册。</p>
        </div>
      </div>
    </div>
  </section>

  <section id="architecture">
    <div class="container">
      <h2 class="section-h2-md" data-i18n="architecture.h2">aptbot 的架构亮点</h2>
      <div class="card-grid">
        <div class="card">
          <div class="card-icon">▤</div>
          <h3 data-i18n="architecture.card1.title">会话持久化 跨会话记忆</h3>
          <p class="card-desc" data-i18n="architecture.card1.desc">JSONL append-only 持久化。L2 起引入三层记忆架构（短期工作记忆 / 长期情景记忆 / 程序性技能记忆）。</p>
        </div>
        <div class="card">
          <div class="card-icon">⇄</div>
          <h3 data-i18n="architecture.card2.title">多模型冗余 始终在线</h3>
          <p class="card-desc" data-i18n="architecture.card2.desc">主 + 备 provider 自动切换 + 熔断器。单一 provider 失败时无缝切换 —— 你的助手始终在线。</p>
        </div>
        <div class="card">
          <div class="card-icon">⛨</div>
          <h3 data-i18n="architecture.card3.title">硬化边界 安全可控</h3>
          <p class="card-desc" data-i18n="architecture.card3.desc">TTFB/块双时钟流式控制、30s 工具硬超时、大文件 OOM 防护、JSONL 损坏修复。每层都有防护。</p>
        </div>
        <div class="card">
          <div class="card-icon">◇</div>
          <h3 data-i18n="architecture.card4.title">双入口 统一状态机</h3>
          <p class="card-desc" data-i18n="architecture.card4.desc">CLI (Ink) 与 WebUI (Lit) 共享同一 coreReducer 状态机。流式渲染、回合中断、多端同步是事件流的自然消费模式。</p>
        </div>
      </div>
      <div class="data-bar">
        <div>
          <div class="eval-label">Eval</div>
          <div class="eval-value">584</div>
          <div class="card-desc" data-i18n="architecture.eval1.label">项测试通过</div>
        </div>
        <div>
          <div class="eval-label">Eval</div>
          <div class="eval-value">4</div>
          <div class="card-desc" data-i18n="architecture.eval2.label">层架构</div>
        </div>
        <div>
          <div class="eval-label">Eval</div>
          <div class="eval-value">8</div>
          <div class="card-desc" data-i18n="architecture.eval3.label">个 Hook 扩展点</div>
        </div>
        <div>
          <div class="eval-label">Eval</div>
          <div class="eval-value">MIT</div>
          <div class="card-desc" data-i18n="architecture.eval4.label">开源协议</div>
        </div>
      </div>
    </div>
  </section>

  <section id="use-cases">
    <div class="container">
      <h2 class="section-h2-sm" data-i18n="useCases.h2">aptbot 能做什么</h2>
      <div class="card-grid">
        <div class="card">
          <div class="card-icon">☉</div>
          <h3 data-i18n="useCases.card1.title">个人工作助手</h3>
          <p class="card-desc" data-i18n="useCases.card1.desc">学习、写作、研究、代码评审。工具调用透明可见，你随时知道它在做什么。跨会话记忆让偏好与上下文持续累积。</p>
        </div>
        <div class="card">
          <div class="card-icon">⚛</div>
          <h3 data-i18n="useCases.card2.title">家庭/团队共享</h3>
          <p class="card-desc" data-i18n="useCases.card2.desc">一个实例，多个用户。家人查天气、订日程、查资料；团队成员共享工具配置但会话隔离。无需重复部署。</p>
        </div>
        <div class="card">
          <div class="card-icon">⌥</div>
          <h3 data-i18n="useCases.card3.title">开发者二次开发</h3>
          <p class="card-desc" data-i18n="useCases.card3.desc">声明式 registry 加工具，Hook 系统改流程，新 IM 通道零核心改动。aptbot 是可编程的助手底座，不是黑盒 SaaS。</p>
        </div>
      </div>
      <a href="https://github.com/evan3060/aptbot/issues/new" class="use-case-cta" data-i18n="useCases.cta">分享你的使用场景 →</a>
    </div>
  </section>

  <section id="cta">
    <div class="container">
      <h2 class="section-h2-lg" data-i18n="cta.h2">立即体验 aptbot</h2>
      <p class="cta-subtitle" data-i18n="cta.subtitle">无需注册，直接进入 Demo 与你的助手对话。</p>
      <div class="cta-buttons">
        <a href="/demo" class="btn-pill btn-pill-primary" data-i18n="cta.primary">进入 Demo →</a>
        <a href="https://github.com/evan3060/aptbot#deployment" class="btn-pill btn-pill-secondary" data-i18n="cta.secondary">自托管文档</a>
      </div>
    </div>
  </section>
</main>

<footer>
  <div class="footer-grid">
    <div>
      <div class="footer-wordmark">aptbot</div>
      <div class="footer-tagline" data-i18n="footer.tagline">你的个人 AI 助手</div>
    </div>
    <div class="footer-links">
      <a href="https://github.com/evan3060/aptbot" data-i18n="footer.github">GitHub</a>
      <a href="https://github.com/evan3060/aptbot#readme" data-i18n="footer.documentation">文档</a>
      <a href="https://github.com/evan3060/aptbot/releases" data-i18n="footer.changelog">更新日志</a>
      <a href="https://github.com/evan3060/aptbot/blob/main/LICENSE" data-i18n="footer.license">开源协议</a>
    </div>
    <div class="footer-meta">
      <div>v0.2.0</div>
      <div>MIT</div>
      <div>© 2026 aptbot</div>
    </div>
  </div>
  <div class="footer-bottom" data-i18n="footer.bottom">用心打造 · 开源 · 可自托管</div>
</footer>

<script>
  const I18N = {
    zh: {
      'nav.features': '特性',
      'nav.architecture': '架构',
      'nav.useCases': '场景',
      'nav.github': 'GitHub',
      'nav.demo': '体验 Demo',
      'nav.lang': 'EN',
      'hero.h1': '开源 · 自托管 · 完全属于你的 AI 助手',
      'hero.subtitle': '不只是聊天机器人，而是一个会思考、会行动、会记忆的 agent。能通过工具操作你的本地环境，能记住你的跨会话偏好，能通过 CLI / WebUI / IM 多端接入。',
      'hero.cta.primary': '体验 Demo →',
      'hero.cta.secondary': '查看 GitHub',
      'features.h2': '不是框架，不是 SaaS，而是"你的"agent',
      'features.card1.title': '透明思考过程',
      'features.card1.desc': 'core 仅 ~3 文件，可读的 ReAct loop。每个思考、每次工具调用、每个决策都对你完全可见。',
      'features.card2.title': '多端接入 一段对话',
      'features.card2.desc': 'CLI / WebUI / IM 共享同一段对话。手机上开始的对话在电脑上继续，终端启动的工作流在浏览器里完成。',
      'features.card3.title': '多用户共享 单实例',
      'features.card3.desc': '多用户隔离让家人和团队成员在同一实例上拥有各自会话空间。一个 aptbot 服务全家 / 全团队。',
      'features.card4.title': '分层架构 无限扩展',
      'features.card4.desc': '严格四层架构 + 声明式 registry + Hook 系统（8 扩展点）。加 IM 通道零核心改动，加工具只需声明注册。',
      'architecture.h2': 'aptbot 的架构亮点',
      'architecture.card1.title': '会话持久化 跨会话记忆',
      'architecture.card1.desc': 'JSONL append-only 持久化。L2 起引入三层记忆架构（短期工作记忆 / 长期情景记忆 / 程序性技能记忆）。',
      'architecture.card2.title': '多模型冗余 始终在线',
      'architecture.card2.desc': '主 + 备 provider 自动切换 + 熔断器。单一 provider 失败时无缝切换 —— 你的助手始终在线。',
      'architecture.card3.title': '硬化边界 安全可控',
      'architecture.card3.desc': 'TTFB/块双时钟流式控制、30s 工具硬超时、大文件 OOM 防护、JSONL 损坏修复。每层都有防护。',
      'architecture.card4.title': '双入口 统一状态机',
      'architecture.card4.desc': 'CLI (Ink) 与 WebUI (Lit) 共享同一 coreReducer 状态机。流式渲染、回合中断、多端同步是事件流的自然消费模式。',
      'architecture.eval1.label': '项测试通过',
      'architecture.eval2.label': '层架构',
      'architecture.eval3.label': '个 Hook 扩展点',
      'architecture.eval4.label': '开源协议',
      'useCases.h2': 'aptbot 能做什么',
      'useCases.card1.title': '个人工作助手',
      'useCases.card1.desc': '学习、写作、研究、代码评审。工具调用透明可见，你随时知道它在做什么。跨会话记忆让偏好与上下文持续累积。',
      'useCases.card2.title': '家庭/团队共享',
      'useCases.card2.desc': '一个实例，多个用户。家人查天气、订日程、查资料；团队成员共享工具配置但会话隔离。无需重复部署。',
      'useCases.card3.title': '开发者二次开发',
      'useCases.card3.desc': '声明式 registry 加工具，Hook 系统改流程，新 IM 通道零核心改动。aptbot 是可编程的助手底座，不是黑盒 SaaS。',
      'useCases.cta': '分享你的使用场景 →',
      'cta.h2': '立即体验 aptbot',
      'cta.subtitle': '无需注册，直接进入 Demo 与你的助手对话。',
      'cta.primary': '进入 Demo →',
      'cta.secondary': '自托管文档',
      'footer.tagline': '你的个人 AI 助手',
      'footer.github': 'GitHub',
      'footer.documentation': '文档',
      'footer.changelog': '更新日志',
      'footer.license': '开源协议',
      'footer.bottom': '用心打造 · 开源 · 可自托管'
    },
    en: {
      'nav.features': 'Features',
      'nav.architecture': 'Architecture',
      'nav.useCases': 'Use Cases',
      'nav.github': 'GitHub',
      'nav.demo': 'Try Demo',
      'nav.lang': '中',
      'hero.h1': "Open-source · Self-hosted · An AI assistant that's truly yours",
      'hero.subtitle': 'Not just a chatbot, but an agent that thinks, acts, and remembers. It operates your local environment through tools, remembers your cross-session preferences, and connects via CLI / WebUI / IM.',
      'hero.cta.primary': 'Try Demo →',
      'hero.cta.secondary': 'View on GitHub',
      'features.h2': 'Not a framework, not a SaaS, but "your" agent',
      'features.card1.title': 'Transparent Thinking',
      'features.card1.desc': 'Core is only ~3 files, a readable ReAct loop. Every thought, every tool call, every decision is fully visible to you.',
      'features.card2.title': 'Multi-Channel One Conversation',
      'features.card2.desc': 'CLI / WebUI / IM share the same conversation. A conversation started on your phone continues on your computer; a workflow launched from the terminal finishes in the browser.',
      'features.card3.title': 'Multi-User One Instance',
      'features.card3.desc': 'Multi-user isolation lets family and team members have their own session space on the same instance. One aptbot serves the whole family / team.',
      'features.card4.title': 'Layered Architecture Infinite Extensibility',
      'features.card4.desc': 'Strict four-layer architecture + declarative registry + Hook system (8 extension points). Add IM channels with zero core changes; add tools by simply declaring registration.',
      'architecture.h2': "aptbot's architecture highlights",
      'architecture.card1.title': 'Session Persistence Cross-Session Memory',
      'architecture.card1.desc': 'JSONL append-only persistence. From L2, a three-tier memory architecture (short-term working memory / long-term episodic memory / procedural skill memory) is introduced.',
      'architecture.card2.title': 'Multi-Model Redundancy Always Available',
      'architecture.card2.desc': 'Primary + backup provider auto-switch + circuit breaker. Seamless failover when a single provider fails — your assistant is always online.',
      'architecture.card3.title': 'Hardened Boundaries Safe & Controllable',
      'architecture.card3.desc': 'TTFB/chunk dual-clock streaming control, 30s tool hard timeout, large file OOM protection, JSONL corruption repair. Every layer has protection.',
      'architecture.card4.title': 'Dual Entry Unified State Machine',
      'architecture.card4.desc': 'CLI (Ink) and WebUI (Lit) share the same coreReducer state machine. Streaming rendering, turn interruption, and multi-end sync are natural consumption patterns of the event stream.',
      'architecture.eval1.label': 'tests passing',
      'architecture.eval2.label': 'layered architecture',
      'architecture.eval3.label': 'hook extension points',
      'architecture.eval4.label': 'license',
      'useCases.h2': 'What aptbot can do',
      'useCases.card1.title': 'Personal Work Assistant',
      'useCases.card1.desc': "Learning, writing, research, code review. Tool calls are transparent and visible — you always know what it's doing. Cross-session memory accumulates preferences and context.",
      'useCases.card2.title': 'Family & Team Sharing',
      'useCases.card2.desc': 'One instance, multiple users. Family checks weather, schedules, and info; team members share tool configs but sessions are isolated. No need for repeated deployments.',
      'useCases.card3.title': 'Developer Extension',
      'useCases.card3.desc': 'Add tools via declarative registry, modify flows with the Hook system, add new IM channels with zero core changes. aptbot is a programmable assistant foundation, not a black-box SaaS.',
      'useCases.cta': 'Share your use case →',
      'cta.h2': 'Try aptbot now',
      'cta.subtitle': 'No signup required — jump straight into the demo and start talking to your assistant.',
      'cta.primary': 'Enter Demo →',
      'cta.secondary': 'Self-hosting Docs',
      'footer.tagline': 'Your Personal AI Assistant',
      'footer.github': 'GitHub',
      'footer.documentation': 'Documentation',
      'footer.changelog': 'Changelog',
      'footer.license': 'License',
      'footer.bottom': 'Made with care · Open source · Self-hostable'
    }
  };

  function applyLang(lang) {
    document.documentElement.lang = lang === 'zh' ? 'zh-CN' : 'en';
    document.querySelectorAll('[data-i18n]').forEach(el => {
      const key = el.dataset.i18n;
      if (I18N[lang][key]) el.textContent = I18N[lang][key];
    });
    const toggle = document.querySelector('[data-i18n="nav.lang"]');
    if (toggle) toggle.textContent = lang === 'zh' ? 'EN' : '中';
    try { localStorage.setItem('aptbot.lang', lang); } catch (e) {}
    history.replaceState(null, '', \`#\${lang}\`);
  }

  // 初始化优先级：URL hash > localStorage 'aptbot.lang' > navigator.language > 'zh'
  const initLang = (location.hash.slice(1)
    || localStorage.getItem('aptbot.lang')
    || (navigator.language.startsWith('zh') ? 'zh' : 'en'));
  applyLang(initLang === 'en' ? 'en' : 'zh');

  // Nav 滚动背景：IntersectionObserver 观察 hero，离开视口顶部即加 scrolled 类
  const nav = document.getElementById('nav');
  const hero = document.getElementById('hero');
  if (nav && hero && 'IntersectionObserver' in window) {
    const io = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          nav.classList.remove('scrolled');
        } else {
          nav.classList.add('scrolled');
        }
      });
    }, { threshold: 0, rootMargin: '-1px 0px 0px 0px' });
    io.observe(hero);
  }
</script>
</body>
</html>`;
}
