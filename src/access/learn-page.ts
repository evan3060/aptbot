import type { Article, ArticleState, TrackMeta } from '../learn/article-types.js';

/**
 * /learn 列表页 HTML 生成器（adept.ai 风格，与 landing-page.ts 视觉一致）。
 *
 * 纯字符串拼接函数，无 I/O，无异常路径。
 * Task 4 实现 createLearnListHtml。
 * Task 5 将在本文件追加 createLearnArticleHtml。
 * Task 6 将追加 createFeedbackHtml。
 */

const DIFFICULTY_LABELS: Readonly<Record<string, string>> = {
  beginner: '入门',
  intermediate: '进阶',
  advanced: '深入',
};

/** 转义 HTML 特殊字符，防止文章元数据注入 */
function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => {
    switch (c) {
      case '&':
        return '&amp;';
      case '<':
        return '&lt;';
      case '>':
        return '&gt;';
      case '"':
        return '&quot;';
      case "'":
        return '&#39;';
      default:
        return c;
    }
  });
}

interface ChapterGroup {
  readonly name: string;
  readonly articles: readonly Article[];
}

/**
 * 按章节分组文章，保持 chapter 在该 track 内首次出现的顺序。
 * 文章已由 ArticleLoader 按 order 排序，直接遍历即可。
 */
function groupByChapter(articles: readonly Article[]): ChapterGroup[] {
  const groups: ChapterGroup[] = [];
  const seen = new Map<string, number>();
  for (const article of articles) {
    const name = article.meta.chapter;
    const idx = seen.get(name);
    if (idx === undefined) {
      seen.set(name, groups.length);
      groups.push({ name, articles: [article] });
    } else {
      const existing = groups[idx];
      // readonly Article[] → 需要新建数组追加（避免 mutation）
      groups[idx] = { name, articles: [...existing.articles, article] };
    }
  }
  return groups;
}

function renderArticleCard(article: Article): string {
  const meta = article.meta;
  const difficultyLabel = DIFFICULTY_LABELS[meta.difficulty] ?? meta.difficulty;
  const metaRow = `${escapeHtml(difficultyLabel)} · ${meta.estimatedReadingTime} 分钟`;
  const tagsHtml = meta.tags.length > 0
    ? `<div class="article-tags">${meta.tags
        .map((t) => `<span class="article-tag">${escapeHtml(t)}</span>`)
        .join('')}</div>`
    : '<div class="article-tags"></div>';

  if (meta.status === 'planned') {
    return `        <div class="article-card article-card-planned" data-track="${escapeHtml(meta.track)}">
          <div class="article-meta">${metaRow}</div>
          <h3 class="article-title">${escapeHtml(meta.title)}</h3>
          <p class="article-desc">${escapeHtml(meta.description)}</p>
          <div class="article-footer">
            ${tagsHtml}
            <span class="coming-soon-badge">coming soon</span>
          </div>
        </div>`;
  }

  return `        <a class="article-card" href="/learn/${escapeHtml(meta.slug)}" data-track="${escapeHtml(meta.track)}">
          <div class="article-meta">${metaRow}</div>
          <h3 class="article-title">${escapeHtml(meta.title)}</h3>
          <p class="article-desc">${escapeHtml(meta.description)}</p>
          <div class="article-footer">
            ${tagsHtml}
            <span class="article-arrow" aria-hidden="true">→</span>
          </div>
        </a>`;
}

function renderTrack(track: TrackMeta, articles: readonly Article[], trackNumber: number): string {
  const chapters = groupByChapter(articles);
  const chaptersHtml = chapters
    .map((ch) => {
      const chapterId = `${track.id}__${ch.name}`;
      const cardsHtml = ch.articles.map(renderArticleCard).join('\n');
      return `      <div class="chapter" data-chapter-id="${escapeHtml(chapterId)}">
        <button type="button" class="chapter-header" aria-expanded="true">
          <span class="chapter-arrow" aria-hidden="true">▼</span>
          <span class="chapter-name">${escapeHtml(ch.name)}</span>
          <span class="chapter-count">(${ch.articles.length})</span>
        </button>
        <div class="chapter-content">
          <div class="card-grid">
${cardsHtml}
          </div>
        </div>
      </div>`;
    })
    .join('\n');

  return `    <section class="track-container" data-track="${escapeHtml(track.id)}" id="track${trackNumber}">
      <div class="track-label">TRACK ${trackNumber}</div>
      <h2 class="track-title">${escapeHtml(track.title)}</h2>
      <p class="track-desc">${escapeHtml(track.description)}</p>
${chaptersHtml}
    </section>`;
}

export function createLearnListHtml(state: ArticleState): string {
  const totalArticles = state.articles.length;
  const totalTracks = state.tracks.length;
  const sortedTracks = [...state.tracks].sort((a, b) => a.order - b.order);

  // 计算每个 track 的文章数；track.id → count
  const trackCount = new Map<string, number>();
  for (const t of sortedTracks) {
    trackCount.set(t.id, (state.byTrack.get(t.id) ?? []).length);
  }
  const track1Count = trackCount.get('agent-practice') ?? 0;
  const track2Count = trackCount.get('ai-coding-practice') ?? 0;

  // track title（用于 subtitle 与 caption）— 通过 id 查表，避免重复遍历
  const track1Meta = sortedTracks.find((t) => t.id === 'agent-practice');
  const track2Meta = sortedTracks.find((t) => t.id === 'ai-coding-practice');
  const track1Title = track1Meta?.title ?? 'Agent 体系实践';
  const track2Title = track2Meta?.title ?? 'AI 辅助编码实践';

  const tracksHtml = sortedTracks
    .map((t, i) => renderTrack(t, state.byTrack.get(t.id) ?? [], i + 1))
    .join('\n');

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<link rel="icon" href="data:,">
<title>知识体系 - aptbot</title>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&display=swap" rel="stylesheet">
<style>
  :root {
    --bg-base: rgb(255, 255, 255);
    --bg-warm: rgb(245, 242, 241);
    --bg-muted: rgb(249, 247, 244);
    --bg-dark: rgb(39, 36, 34);
    --text-primary: rgb(39, 36, 34);
    --text-secondary: rgb(139, 133, 127);
    --accent: rgb(13, 113, 73);
    --border: rgb(229, 231, 235);
    --surface-translucent: rgba(255, 255, 255, 0.98);
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
  button { font-family: inherit; }

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
    border-bottom: 1px solid var(--border);
    z-index: 100;
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
  .nav-links a.active { color: var(--text-primary); }
  .nav-actions { display: flex; align-items: center; gap: 16px; }
  .nav-lang {
    font-size: 14px;
    padding: 6px 14px;
    border: 1px solid var(--border);
    border-radius: 9999px;
    color: var(--text-primary);
    cursor: pointer;
  }

  main {
    padding: 104px 48px 48px;
    max-width: 1650px;
    margin: 0 auto;
  }

  .page-header { margin-bottom: 32px; }
  .page-header h1 {
    font-size: 48px;
    font-weight: 400;
    color: var(--text-primary);
    letter-spacing: -1px;
    margin-bottom: 16px;
  }
  .page-subtitle {
    font-size: 20px;
    line-height: 25px;
    letter-spacing: -0.5px;
    color: var(--text-secondary);
  }

  .data-bar {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
    gap: 32px;
    margin-top: 48px;
    padding-top: 32px;
    border-top: 1px solid var(--border);
  }
  .data-label {
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
    font-size: 14px;
    font-weight: 700;
    letter-spacing: 0.7px;
    color: var(--text-secondary);
    margin-bottom: 8px;
  }
  .data-value {
    font-size: 48px;
    font-weight: 400;
    color: var(--text-primary);
    font-family: Inter, system-ui, "PingFang SC", sans-serif;
    line-height: 1.1;
  }
  .data-caption {
    font-size: 14px;
    color: var(--text-secondary);
    margin-top: 4px;
  }

  .filter-bar {
    position: sticky;
    top: 56px;
    z-index: 50;
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 16px 0;
    margin-bottom: 48px;
    background-color: var(--bg-base);
    border-bottom: 1px solid var(--border);
  }
  .track-tabs { display: flex; gap: 8px; flex-wrap: wrap; }
  .track-tab {
    font-size: 14px;
    padding: 8px 16px;
    border: 1px solid var(--border);
    background: var(--bg-base);
    color: var(--text-secondary);
    cursor: pointer;
    border-radius: 9999px;
    letter-spacing: -0.3px;
  }
  .track-tab:hover { color: var(--text-primary); }
  .track-tab.active {
    background: var(--text-primary);
    color: var(--bg-base);
    border-color: var(--text-primary);
  }
  .view-toggle { display: flex; gap: 8px; }
  .view-btn {
    font-size: 14px;
    padding: 6px 12px;
    border: 1px solid var(--border);
    background: var(--bg-base);
    color: var(--text-secondary);
    cursor: pointer;
    letter-spacing: -0.3px;
  }
  .view-btn.active {
    color: var(--text-primary);
    border-color: var(--text-primary);
  }

  .track-container { margin-bottom: 80px; }
  .track-label {
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
    font-size: 14px;
    font-weight: 700;
    letter-spacing: 0.7px;
    color: var(--text-secondary);
    margin-bottom: 8px;
  }
  .track-title {
    font-size: 28px;
    font-weight: 400;
    color: var(--text-primary);
    letter-spacing: -0.5px;
    margin-bottom: 8px;
  }
  .track-desc {
    font-size: 16px;
    line-height: 22px;
    color: var(--text-secondary);
    margin-bottom: 32px;
  }

  .chapter { margin-bottom: 32px; }
  .chapter-header {
    display: flex;
    align-items: center;
    gap: 12px;
    width: 100%;
    padding: 12px 0;
    background: none;
    border: none;
    border-bottom: 1px solid var(--border);
    cursor: pointer;
    color: var(--text-primary);
    font-size: 18px;
    font-weight: 500;
    text-align: left;
    letter-spacing: -0.3px;
  }
  .chapter-arrow {
    font-size: 12px;
    color: var(--text-secondary);
    transition: transform 200ms ease-in-out;
    display: inline-block;
  }
  .chapter.collapsed .chapter-arrow { transform: rotate(-90deg); }
  .chapter-name { color: var(--text-primary); }
  .chapter-count {
    font-size: 14px;
    color: var(--text-secondary);
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
  }
  .chapter-content {
    overflow: hidden;
    transition: max-height 200ms ease-in-out;
  }
  .chapter.collapsed .chapter-content { display: none; }

  .card-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
    gap: 24px;
    padding-top: 24px;
  }
  main.list-view .card-grid {
    grid-template-columns: 1fr;
  }

  .article-card {
    display: block;
    padding: 24px;
    background: transparent;
    cursor: pointer;
    transition: background 200ms ease-in-out;
  }
  .article-card:hover {
    background: var(--bg-muted);
  }
  .article-card-planned {
    opacity: 0.55;
    pointer-events: none;
  }
  .article-meta {
    font-size: 12px;
    color: var(--text-secondary);
    margin-bottom: 12px;
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
    letter-spacing: 0.3px;
  }
  .article-title {
    font-size: 20px;
    font-weight: 400;
    color: var(--text-primary);
    margin-bottom: 12px;
    letter-spacing: -0.5px;
    line-height: 1.3;
  }
  .article-desc {
    font-size: 15px;
    line-height: 25px;
    color: var(--text-secondary);
    margin-bottom: 16px;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }
  .article-footer {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
  }
  .article-tags { display: flex; gap: 6px; flex-wrap: wrap; }
  .article-tag {
    font-size: 12px;
    padding: 2px 8px;
    border: 1px solid var(--border);
    color: var(--text-secondary);
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
    letter-spacing: 0.3px;
  }
  .article-arrow {
    font-size: 18px;
    color: var(--text-primary);
    line-height: 1;
  }
  .coming-soon-badge {
    font-size: 12px;
    padding: 2px 8px;
    background: var(--text-primary);
    color: var(--bg-base);
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
    letter-spacing: 0.5px;
  }

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

  @media (max-width: 767px) {
    body { font-size: 16px; line-height: 22px; }
    #nav { padding: 0 16px; }
    .nav-links { display: none; }
    .nav-wordmark { font-size: 18px; }
    .nav-lang { font-size: 12px; padding: 4px 10px; }

    main { padding: 80px 20px 40px; }
    .page-header h1 { font-size: 32px; letter-spacing: -0.5px; }
    .page-subtitle { font-size: 16px; line-height: 22px; }
    .data-bar { grid-template-columns: 1fr 1fr; gap: 20px; margin-top: 32px; padding-top: 24px; }
    .data-value { font-size: 32px; }
    .data-label { font-size: 12px; }
    .data-caption { font-size: 12px; }

    .filter-bar { top: 56px; padding: 12px 0; flex-wrap: wrap; gap: 12px; }
    .track-tab { font-size: 12px; padding: 6px 12px; }
    .view-btn { font-size: 12px; padding: 4px 10px; }

    .track-title { font-size: 22px; }
    .track-desc { font-size: 14px; line-height: 20px; }
    .chapter-header { font-size: 16px; }
    .chapter-name { letter-spacing: -0.2px; }

    .card-grid { grid-template-columns: 1fr; gap: 16px; padding-top: 16px; }
    .article-card { padding: 16px; }
    .article-title { font-size: 17px; margin-bottom: 8px; }
    .article-desc { font-size: 14px; line-height: 20px; margin-bottom: 12px; }
    .article-meta { font-size: 11px; margin-bottom: 8px; }
    .article-tag { font-size: 11px; padding: 2px 6px; }

    footer { padding: 40px 20px; }
    .footer-grid { grid-template-columns: 1fr; gap: 24px; }
    .footer-meta { text-align: left; }
    .footer-bottom { font-size: 12px; padding-top: 16px; }
  }

  @media (prefers-reduced-motion: reduce) {
    html { scroll-behavior: auto; }
    .chapter-arrow, .article-card, .chapter-content { transition: none; }
  }
</style>
</head>
<body>
<header id="nav">
  <a href="/" class="nav-wordmark">aptbot</a>
  <nav class="nav-links">
    <a href="/">首页</a>
    <a href="/learn" class="active">知识</a>
    <a href="/demo">Demo</a>
  </nav>
  <div class="nav-actions">
    <a href="#" class="nav-lang" id="lang-toggle">EN</a>
  </div>
</header>

<main>
  <div class="page-header">
    <h1>知识体系</h1>
    <p class="page-subtitle">${totalArticles} 篇文章，${totalTracks} 个 Track · ${track1Count} 篇 ${escapeHtml(track1Title)} · ${track2Count} 篇 ${escapeHtml(track2Title)}</p>
    <div class="data-bar">
      <div>
        <div class="data-label">Articles</div>
        <div class="data-value">${totalArticles}</div>
        <div class="data-caption">篇文章</div>
      </div>
      <div>
        <div class="data-label">Tracks</div>
        <div class="data-value">${totalTracks}</div>
        <div class="data-caption">个 Track</div>
      </div>
      <div>
        <div class="data-label">Track 1</div>
        <div class="data-value">${track1Count}</div>
        <div class="data-caption">${escapeHtml(track1Title)}</div>
      </div>
      <div>
        <div class="data-label">Track 2</div>
        <div class="data-value">${track2Count}</div>
        <div class="data-caption">${escapeHtml(track2Title)}</div>
      </div>
    </div>
  </div>

  <div class="filter-bar">
    <div class="track-tabs">
      <button type="button" class="track-tab active" data-track="all">全部</button>
      <button type="button" class="track-tab" data-track="track1">Track 1</button>
      <button type="button" class="track-tab" data-track="track2">Track 2</button>
    </div>
    <div class="view-toggle">
      <button type="button" class="view-btn active" data-view="grid">网格</button>
      <button type="button" class="view-btn" data-view="list">列表</button>
    </div>
  </div>

${tracksHtml}
</main>

<footer>
  <div class="footer-grid">
    <div>
      <div class="footer-wordmark">aptbot</div>
      <div class="footer-tagline">你的个人 AI 助手</div>
    </div>
    <div class="footer-links">
      <a href="https://github.com/evan3060/aptbot">GitHub</a>
      <a href="https://github.com/evan3060/aptbot#readme">文档</a>
      <a href="https://github.com/evan3060/aptbot/releases">更新日志</a>
      <a href="https://github.com/evan3060/aptbot/blob/main/LICENSE">开源协议</a>
    </div>
    <div class="footer-meta">
      <div>v0.2.3</div>
      <div>MIT</div>
      <div>© 2026 aptbot</div>
    </div>
  </div>
  <div class="footer-bottom">用心打造 · 开源 · 可自托管</div>
</footer>

<script>
  (function () {
    var STORAGE_PREFIX = 'aptbot.learn.';
    var tabs = document.querySelectorAll('.track-tab');
    var trackContainers = document.querySelectorAll('.track-container');

    function activateTab(track) {
      tabs.forEach(function (tab) {
        tab.classList.toggle('active', tab.dataset.track === track);
      });
      trackContainers.forEach(function (container) {
        if (track === 'all') {
          container.style.display = '';
          return;
        }
        var containerTrack = container.dataset.track;
        var match = (track === 'track1' && containerTrack === 'agent-practice')
          || (track === 'track2' && containerTrack === 'ai-coding-practice');
        container.style.display = match ? '' : 'none';
      });
      var currentHash = location.hash.slice(1);
      if (currentHash !== track) {
        history.replaceState(null, '', track === 'all' ? '#learn' : '#' + track);
      }
    }

    tabs.forEach(function (tab) {
      tab.addEventListener('click', function () {
        activateTab(tab.dataset.track);
      });
    });

    var initTrack = location.hash.slice(1);
    if (initTrack === 'track1' || initTrack === 'track2') {
      activateTab(initTrack);
    } else {
      activateTab('all');
    }

    var chapters = document.querySelectorAll('.chapter');
    chapters.forEach(function (chapter) {
      var header = chapter.querySelector('.chapter-header');
      var id = chapter.dataset.chapterId;
      if (!header || !id) return;

      var isMobile = window.matchMedia('(max-width: 767px)').matches;
      var stored = null;
      try { stored = localStorage.getItem(STORAGE_PREFIX + 'chapter.' + id); } catch (e) {}
      var collapsed = stored !== null ? stored === '1' : isMobile;
      if (collapsed) {
        chapter.classList.add('collapsed');
        header.setAttribute('aria-expanded', 'false');
      }

      header.addEventListener('click', function () {
        var willCollapse = !chapter.classList.contains('collapsed');
        chapter.classList.toggle('collapsed', willCollapse);
        header.setAttribute('aria-expanded', willCollapse ? 'false' : 'true');
        try { localStorage.setItem(STORAGE_PREFIX + 'chapter.' + id, willCollapse ? '1' : '0'); } catch (e) {}
      });
    });

    var viewBtns = document.querySelectorAll('.view-btn');
    var main = document.querySelector('main');

    function activateView(view) {
      viewBtns.forEach(function (btn) {
        btn.classList.toggle('active', btn.dataset.view === view);
      });
      if (main) {
        main.classList.toggle('list-view', view === 'list');
      }
      try { localStorage.setItem(STORAGE_PREFIX + 'view', view); } catch (e) {}
    }

    viewBtns.forEach(function (btn) {
      btn.addEventListener('click', function () {
        activateView(btn.dataset.view);
      });
    });

    var initView = 'grid';
    try {
      var storedView = localStorage.getItem(STORAGE_PREFIX + 'view');
      if (storedView === 'grid' || storedView === 'list') initView = storedView;
    } catch (e) {}
    activateView(initView);

    var langToggle = document.getElementById('lang-toggle');
    if (langToggle) {
      langToggle.addEventListener('click', function (e) {
        e.preventDefault();
        var current = document.documentElement.lang;
        var next = current === 'zh-CN' ? 'en' : 'zh-CN';
        document.documentElement.lang = next;
        langToggle.textContent = next === 'zh-CN' ? 'EN' : '中';
        try { localStorage.setItem('aptbot.lang', next === 'zh-CN' ? 'zh' : 'en'); } catch (e) {}
      });
    }
  })();
</script>
</body>
</html>`;
}
