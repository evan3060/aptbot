import { describe, it, expect } from 'vitest';
import { createLearnListHtml, createLearnArticleHtml, createFeedbackHtml } from '../../src/access/learn-page.js';
import { TRACKS, type Article, type ArticleState, type ArticleMeta, type ArticleNav } from '../../src/learn/article-types.js';

/**
 * Task 4: learn-page.ts 列表页 — createLearnListHtml
 *
 * 测试策略：纯字符串契约测试。构建 19 篇文章的 ArticleState fixture
 * （Track 1: 13 篇 / Track 2: 6 篇，跨多 chapter，published + planned 混合），
 * 验证渲染产物的关键标记：nav / 数据条 / sticky 筛选栏 / TRACK 标签 /
 * chapter 分组 / 文章卡片标题 / planned coming soon / 移动端媒体查询 / 不含 emoji。
 *
 * Task 5 将在同名 describe 之外追加 createLearnArticleHtml 测试。
 * Task 6 将追加 createFeedbackHtml 测试。
 */

// 检测常见彩色 emoji（避开 ▼ / → 等 BMP 几何符号 / 箭头）
const EMOJI_REGEX =
  /[\u{1F300}-\u{1FAFF}\u{1F600}-\u{1F64F}\u{1F680}-\u{1F6FF}\u{1F900}-\u{1F9FF}]/u;

function buildMeta(overrides: Partial<ArticleMeta> & { slug: string; title: string; track: string; chapter: string; order: number }): ArticleMeta {
  return {
    description: '默认描述，介绍这一篇内容。',
    difficulty: 'beginner',
    estimatedReadingTime: 5,
    status: 'published',
    prerequisites: [],
    lastUpdated: '2026-07-01',
    tags: [],
    ...overrides,
  };
}

function buildArticle(meta: ArticleMeta): Article {
  return {
    meta,
    renderedHtml: meta.status === 'published' ? `<p>${meta.title} rendered html</p>` : null,
    markdownBody: meta.status === 'published' ? `# ${meta.title}\n\n正文内容...` : '',
  };
}

// Fixture: 19 articles, 2 tracks (13 in agent-practice, 6 in ai-coding-practice)
// Track 1 chapters: 入门篇 (2), 核心特性深入篇 (8), 方法论 (3)
// Track 2 chapters: 方法论 (3), 实战篇 (3)
const ARTICLES: Article[] = [
  // === Track 1: agent-practice (13) ===
  // 入门篇 (2)
  buildArticle(buildMeta({ slug: 'agent-overview', title: 'Agent 总览', track: 'agent-practice', chapter: '入门篇', order: 1, difficulty: 'beginner', estimatedReadingTime: 5, tags: ['architecture'] })),
  buildArticle(buildMeta({ slug: 'agent-quickstart', title: '快速上手 aptbot', track: 'agent-practice', chapter: '入门篇', order: 2, difficulty: 'beginner', estimatedReadingTime: 8, tags: ['getting-started'] })),
  // 核心特性深入篇 (8)
  buildArticle(buildMeta({ slug: 'react-loop', title: 'ReAct Loop 剖析', track: 'agent-practice', chapter: '核心特性深入篇', order: 3, difficulty: 'intermediate', estimatedReadingTime: 12 })),
  buildArticle(buildMeta({ slug: 'tool-system', title: '工具系统与声明式 registry', track: 'agent-practice', chapter: '核心特性深入篇', order: 4, difficulty: 'intermediate', estimatedReadingTime: 10 })),
  buildArticle(buildMeta({ slug: 'memory-arch', title: '三层记忆架构', track: 'agent-practice', chapter: '核心特性深入篇', order: 5, difficulty: 'intermediate', estimatedReadingTime: 15 })),
  buildArticle(buildMeta({ slug: 'multi-user', title: '多用户隔离设计', track: 'agent-practice', chapter: '核心特性深入篇', order: 6, difficulty: 'intermediate', estimatedReadingTime: 9 })),
  buildArticle(buildMeta({ slug: 'streaming-control', title: 'TTFB / 块双时钟流式控制', track: 'agent-practice', chapter: '核心特性深入篇', order: 7, difficulty: 'advanced', estimatedReadingTime: 11 })),
  buildArticle(buildMeta({ slug: 'provider-failover', title: 'Provider 故障转移与熔断器', track: 'agent-practice', chapter: '核心特性深入篇', order: 8, difficulty: 'advanced', estimatedReadingTime: 8 })),
  buildArticle(buildMeta({ slug: 'hook-system', title: 'Hook 系统的 8 个扩展点', track: 'agent-practice', chapter: '核心特性深入篇', order: 9, difficulty: 'advanced', estimatedReadingTime: 13 })),
  buildArticle(buildMeta({ slug: 'im-channels', title: 'IM 通道零核心改动接入', track: 'agent-practice', chapter: '核心特性深入篇', order: 10, difficulty: 'intermediate', estimatedReadingTime: 7 })),
  // 方法论 (3)
  buildArticle(buildMeta({ slug: 'agent-design', title: 'Agent 设计哲学', track: 'agent-practice', chapter: '方法论', order: 11, difficulty: 'advanced', estimatedReadingTime: 14 })),
  buildArticle(buildMeta({ slug: 'roadmap', title: '演进路线规划', track: 'agent-practice', chapter: '方法论', order: 12, difficulty: 'advanced', estimatedReadingTime: 6, status: 'planned' })),
  buildArticle(buildMeta({ slug: 'future-work', title: '未来工作展望', track: 'agent-practice', chapter: '方法论', order: 13, difficulty: 'advanced', estimatedReadingTime: 5, status: 'planned' })),

  // === Track 2: ai-coding-practice (6) ===
  // 方法论 (3)
  buildArticle(buildMeta({ slug: 'ai-coding-overview', title: 'AI 辅助编码总览', track: 'ai-coding-practice', chapter: '方法论', order: 1, difficulty: 'beginner', estimatedReadingTime: 6 })),
  buildArticle(buildMeta({ slug: 'prompt-engineering', title: '提示工程实践', track: 'ai-coding-practice', chapter: '方法论', order: 2, difficulty: 'intermediate', estimatedReadingTime: 10 })),
  buildArticle(buildMeta({ slug: 'context-engineering', title: '上下文工程方法论', track: 'ai-coding-practice', chapter: '方法论', order: 3, difficulty: 'intermediate', estimatedReadingTime: 12 })),
  // 实战篇 (3)
  buildArticle(buildMeta({ slug: 'pair-programming', title: 'AI 结对编程', track: 'ai-coding-practice', chapter: '实战篇', order: 4, difficulty: 'intermediate', estimatedReadingTime: 9 })),
  buildArticle(buildMeta({ slug: 'code-review-ai', title: 'AI 代码评审工作流', track: 'ai-coding-practice', chapter: '实战篇', order: 5, difficulty: 'intermediate', estimatedReadingTime: 7, status: 'planned' })),
  buildArticle(buildMeta({ slug: 'refactoring-ai', title: 'AI 辅助重构', track: 'ai-coding-practice', chapter: '实战篇', order: 6, difficulty: 'advanced', estimatedReadingTime: 11, status: 'planned' })),
];

const BY_SLUG = new Map<string, Article>(ARTICLES.map((a) => [a.meta.slug, a]));
const BY_TRACK = new Map<string, readonly Article[]>();
for (const t of TRACKS) {
  BY_TRACK.set(t.id, ARTICLES.filter((a) => a.meta.track === t.id));
}

const STATE: ArticleState = {
  articles: ARTICLES,
  tracks: [...TRACKS],
  bySlug: BY_SLUG,
  byTrack: BY_TRACK,
};

describe('Task 4: createLearnListHtml 列表页', () => {
  describe('骨架与 design tokens', () => {
    it('返回 HTML 默认 lang="zh-CN" + title "知识体系 - aptbot"', () => {
      const html = createLearnListHtml(STATE);
      expect(html).toContain('<html lang="zh-CN">');
      expect(html).toContain('<title>知识体系 - aptbot</title>');
    });

    it('引入 Inter 字体 link（与 landing-page.ts 一致）', () => {
      const html = createLearnListHtml(STATE);
      expect(html).toContain(
        '<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&display=swap" rel="stylesheet">',
      );
    });

    it('定义 adept tokens CSS 变量（--bg-base / --text-primary / --text-secondary / --bg-muted）', () => {
      const html = createLearnListHtml(STATE);
      expect(html).toContain('--bg-base:');
      expect(html).toContain('--bg-muted:');
      expect(html).toContain('--text-primary:');
      expect(html).toContain('--text-secondary:');
    });
  });

  describe('nav 结构', () => {
    it('含 aptbot wordmark 链接到 /', () => {
      const html = createLearnListHtml(STATE);
      expect(html).toContain('href="/"');
      expect(html).toContain('aptbot');
    });

    it('含 nav 链接：首页 / 知识（active） / Demo', () => {
      const html = createLearnListHtml(STATE);
      expect(html).toContain('首页');
      expect(html).toContain('href="/learn"');
      expect(html).toContain('知识');
      expect(html).toContain('href="/demo"');
      expect(html).toContain('Demo');
      // 知识 tab 标记 active
      expect(html).toMatch(/href="\/learn"[^>]*class="[^"]*active/);
    });

    it('含中/EN 语言切换', () => {
      const html = createLearnListHtml(STATE);
      expect(html).toContain('EN');
    });
  });

  describe('main 内容与数据条', () => {
    it('含 H1 "知识体系" + 副标题（19 篇文章 / 2 个 Track）', () => {
      const html = createLearnListHtml(STATE);
      expect(html).toContain('<h1>知识体系</h1>');
      expect(html).toContain('19 篇文章');
      expect(html).toContain('2 个 Track');
    });

    it('含数据条（19 / 2 / 13 / 6 — total / tracks / track1 / track2）', () => {
      const html = createLearnListHtml(STATE);
      // 结构化数据条存在
      expect(html).toContain('data-bar');
      // 4 个数据值（用 regex 避免子串误匹配）
      expect(html).toMatch(/data-value[^>]*>\s*19\s*</);
      expect(html).toMatch(/data-value[^>]*>\s*13\s*</);
      expect(html).toMatch(/data-value[^>]*>\s*6\s*</);
      // 2 容易误匹配，用更具体的上下文
      expect(html).toMatch(/data-value[^>]*>\s*2\s*</);
    });
  });

  describe('sticky 筛选栏 + Track / 视图切换', () => {
    it('含 sticky 筛选栏 top: 56px', () => {
      const html = createLearnListHtml(STATE);
      expect(html).toMatch(/top:\s*56px/);
      expect(html).toContain('filter-bar');
    });

    it('含 [全部] [Track 1] [Track 2] tab 切换', () => {
      const html = createLearnListHtml(STATE);
      expect(html).toContain('全部');
      // tab 按钮可见标签为 Track 1 / Track 2（与 data-bar 一致，符合 brief）
      expect(html).toContain('data-track="track1">Track 1');
      expect(html).toContain('data-track="track2">Track 2');
      // track-tab 按钮结构存在
      expect(html).toContain('track-tab');
    });

    it('含网格 / 列表视图切换按钮', () => {
      const html = createLearnListHtml(STATE);
      expect(html).toContain('view-btn');
      expect(html).toContain('网格');
      expect(html).toContain('列表');
    });
  });

  describe('Track 容器与 chapter 分组', () => {
    it('含 TRACK 1 / TRACK 2 等宽标签', () => {
      const html = createLearnListHtml(STATE);
      expect(html).toContain('TRACK 1');
      expect(html).toContain('TRACK 2');
    });

    it('含 Track 1 标题 "Agent 体系实践" + 描述', () => {
      const html = createLearnListHtml(STATE);
      expect(html).toContain('Agent 体系实践');
      // track description（来自 TRACKS 注册表）
      expect(html).toContain('围绕 aptbot 项目展开');
    });

    it('含 Track 2 标题 "AI 辅助编码实践" + 描述', () => {
      const html = createLearnListHtml(STATE);
      expect(html).toContain('AI 辅助编码实践');
      expect(html).toContain('AI 辅助开发的通用经验总结');
    });

    it('含 chapter 分组（入门篇 / 核心特性深入篇 / 方法论 / 实战篇）', () => {
      const html = createLearnListHtml(STATE);
      expect(html).toContain('入门篇');
      expect(html).toContain('核心特性深入篇');
      expect(html).toContain('方法论');
      expect(html).toContain('实战篇');
    });

    it('chapter 折叠头含 ▼ 几何符号 + 章节计数', () => {
      const html = createLearnListHtml(STATE);
      expect(html).toContain('▼');
      // 入门篇 (2) — 允许 HTML 标签介于名字与计数之间（视觉上仍为 "入门篇 (2)"）
      expect(html).toMatch(/入门篇[\s\S]{0,200}?\(2\)/);
      // 核心特性深入篇 (8)
      expect(html).toMatch(/核心特性深入篇[\s\S]{0,200}?\(8\)/);
    });
  });

  describe('文章卡片', () => {
    it('含全部 published 文章卡片标题', () => {
      const html = createLearnListHtml(STATE);
      const publishedTitles = ARTICLES
        .filter((a) => a.meta.status === 'published')
        .map((a) => a.meta.title);
      expect(publishedTitles.length).toBeGreaterThanOrEqual(10);
      for (const title of publishedTitles) {
        expect(html).toContain(title);
      }
    });

    it('含 planned 文章标题（即使不可点击也展示）', () => {
      const html = createLearnListHtml(STATE);
      const plannedTitles = ARTICLES
        .filter((a) => a.meta.status === 'planned')
        .map((a) => a.meta.title);
      expect(plannedTitles.length).toBeGreaterThanOrEqual(2);
      for (const title of plannedTitles) {
        expect(html).toContain(title);
      }
    });

    it('含 planned 卡片 coming soon 标记', () => {
      const html = createLearnListHtml(STATE);
      expect(html).toContain('coming soon');
    });

    it('planned 卡片有 opacity 0.55 + pointer-events none', () => {
      const html = createLearnListHtml(STATE);
      expect(html).toMatch(/opacity:\s*0\.55/);
      expect(html).toMatch(/pointer-events:\s*none/);
    });

    it('published 卡片含 /learn/<slug> 链接', () => {
      const html = createLearnListHtml(STATE);
      expect(html).toContain('href="/learn/agent-overview"');
      expect(html).toContain('href="/learn/react-loop"');
      expect(html).toContain('href="/learn/ai-coding-overview"');
    });

    it('含卡片底部 → 箭头（指向详情页）', () => {
      const html = createLearnListHtml(STATE);
      expect(html).toContain('→');
    });

    it('卡片含 meta 行（难度 · 阅读时间）', () => {
      const html = createLearnListHtml(STATE);
      // 难度标签
      expect(html).toContain('入门');
      expect(html).toContain('进阶');
      expect(html).toContain('深入');
      // 阅读时间单位
      expect(html).toContain('分钟');
    });
  });

  describe('网格布局与移动端响应式', () => {
    it('含桌面网格布局 repeat(auto-fit, minmax(320px, 1fr)) gap 24px', () => {
      const html = createLearnListHtml(STATE);
      expect(html).toContain('repeat(auto-fit, minmax(320px, 1fr))');
      expect(html).toContain('gap: 24px');
    });

    it('含移动端 CSS 媒体查询 @media (max-width: 767px)', () => {
      const html = createLearnListHtml(STATE);
      expect(html).toContain('@media (max-width: 767px)');
    });

    it('卡片 hover 背景 bg-muted + transition 200ms', () => {
      const html = createLearnListHtml(STATE);
      expect(html).toContain('background: var(--bg-muted)');
      expect(html).toMatch(/transition:[^;]*200ms/);
    });

    it('卡片无 border-radius / 无 box-shadow（adept stack card 风格）', () => {
      const html = createLearnListHtml(STATE);
      // article-card 规则块内不应出现 border-radius 或 box-shadow
      const cardRuleMatch = html.match(/\.article-card\s*\{[^}]*\}/);
      expect(cardRuleMatch).not.toBeNull();
      const cardRule = cardRuleMatch![0];
      expect(cardRule).not.toContain('border-radius');
      expect(cardRule).not.toContain('box-shadow');
    });

    it('摘要 description 有 2 行 ellipsis', () => {
      const html = createLearnListHtml(STATE);
      expect(html).toContain('-webkit-line-clamp: 2');
    });
  });

  describe('footer（与 landing-page.ts 一致）', () => {
    it('含 aptbot wordmark + GitHub + MIT + © 2026 aptbot', () => {
      const html = createLearnListHtml(STATE);
      expect(html).toContain('https://github.com/evan3060/aptbot');
      expect(html).toContain('MIT');
      expect(html).toContain('© 2026 aptbot');
    });
  });

  describe('内联 script 与状态记忆', () => {
    it('含内联 <script>', () => {
      const html = createLearnListHtml(STATE);
      expect(html).toContain('<script>');
      expect(html).toContain('</script>');
    });

    it('script 使用 localStorage 记忆 chapter 折叠 + 视图模式', () => {
      const html = createLearnListHtml(STATE);
      expect(html).toContain('localStorage');
      // 视图模式记忆
      expect(html).toMatch(/localStorage\.\w+\([^)]*view/);
      // chapter 折叠记忆
      expect(html).toMatch(/localStorage\.\w+\([^)]*chapter/);
    });

    it('script 含 Track tab 切换 + URL hash 记忆', () => {
      const html = createLearnListHtml(STATE);
      expect(html).toContain('track-tab');
      expect(html).toContain('location.hash');
    });
  });

  describe('无 emoji 契约', () => {
    it('渲染产物不含彩色 emoji（允许 ▼ / → 等 BMP 几何符号）', () => {
      const html = createLearnListHtml(STATE);
      expect(EMOJI_REGEX.test(html)).toBe(false);
    });
  });
});

/**
 * Task 5: learn-page.ts 文章页 — createLearnArticleHtml
 *
 * 测试策略：纯字符串契约测试。构建 published + planned 两个 Article fixture，
 * 配合 ArticleNav（prev + next），验证渲染产物：
 * - published：标题 / meta 行 / marked 渲染正文 / 上下篇导航 / 反馈表单 / 返回 /learn / 720px max-width / 无 emoji
 * - planned：PLANNED 标签 / 大纲列表 / 无反馈表单 / 返回知识体系链接
 */

// === Article page fixtures ===

const PUBLISHED_ARTICLE: Article = {
  meta: {
    slug: 'react-loop',
    title: 'ReAct Loop 剖析',
    description: '深入剖析 aptbot 的 ReAct Loop 实现，包括工具调用、流式输出与错误恢复机制。',
    track: 'agent-practice',
    chapter: '核心特性深入篇',
    order: 3,
    difficulty: 'intermediate',
    estimatedReadingTime: 12,
    status: 'published',
    prerequisites: ['agent-overview', 'agent-quickstart'],
    lastUpdated: '2026-06-15',
    tags: ['react', 'loop', 'architecture'],
  },
  renderedHtml:
    '<h2>什么是 ReAct Loop</h2>\n<p>ReAct Loop 是 aptbot 的核心推理循环，负责协调工具调用与模型推理。</p>\n<pre><code>const loop = new ReActLoop();</code></pre>\n<blockquote>ReAct = Reasoning + Acting</blockquote>',
  markdownBody: '## 什么是 ReAct Loop\n\nReAct Loop 是 aptbot 的核心推理循环...',
};

const PREV_ARTICLE: Article = buildArticle(
  buildMeta({
    slug: 'agent-quickstart',
    title: '快速上手 aptbot',
    track: 'agent-practice',
    chapter: '入门篇',
    order: 2,
    difficulty: 'beginner',
    estimatedReadingTime: 8,
  }),
);

const NEXT_ARTICLE: Article = buildArticle(
  buildMeta({
    slug: 'tool-system',
    title: '工具系统与声明式 registry',
    track: 'agent-practice',
    chapter: '核心特性深入篇',
    order: 4,
    difficulty: 'intermediate',
    estimatedReadingTime: 10,
  }),
);

const PUBLISHED_NAV: ArticleNav = {
  prev: PREV_ARTICLE,
  next: NEXT_ARTICLE,
};

const PLANNED_ARTICLE: Article = {
  meta: {
    slug: 'roadmap',
    title: '演进路线规划',
    description:
      '短期：性能优化与文档完善；中期：插件系统与多模态支持；长期：自主任务编排与跨 agent 协作',
    track: 'agent-practice',
    chapter: '方法论',
    order: 12,
    difficulty: 'advanced',
    estimatedReadingTime: 6,
    status: 'planned',
    prerequisites: [],
    lastUpdated: '2026-07-01',
    tags: ['roadmap'],
  },
  renderedHtml: null,
  markdownBody: '',
};

describe('Task 5: createLearnArticleHtml 文章页', () => {
  describe('published 文章 — 骨架与 head', () => {
    it('返回 HTML 默认 lang="zh-CN" + title 为 "文章标题 - aptbot 知识体系"', () => {
      const html = createLearnArticleHtml(PUBLISHED_ARTICLE, PUBLISHED_NAV);
      expect(html).toContain('<html lang="zh-CN">');
      expect(html).toContain('<title>ReAct Loop 剖析 - aptbot 知识体系</title>');
    });

    it('引入 Inter 字体 link（与列表页一致）', () => {
      const html = createLearnArticleHtml(PUBLISHED_ARTICLE, PUBLISHED_NAV);
      expect(html).toContain(
        '<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&display=swap" rel="stylesheet">',
      );
    });

    it('复用列表页 design tokens（--bg-base / --text-primary / --text-secondary / --bg-muted）', () => {
      const html = createLearnArticleHtml(PUBLISHED_ARTICLE, PUBLISHED_NAV);
      expect(html).toContain('--bg-base:');
      expect(html).toContain('--text-primary:');
      expect(html).toContain('--text-secondary:');
      expect(html).toContain('--bg-muted:');
    });
  });

  describe('published 文章 — nav（同列表页）', () => {
    it('含 aptbot wordmark + 首页 / 知识（active） / Demo', () => {
      const html = createLearnArticleHtml(PUBLISHED_ARTICLE, PUBLISHED_NAV);
      expect(html).toContain('href="/"');
      expect(html).toContain('aptbot');
      expect(html).toContain('首页');
      expect(html).toContain('href="/learn"');
      expect(html).toContain('知识');
      expect(html).toContain('href="/demo"');
      expect(html).toContain('Demo');
      // 知识 tab 标记 active
      expect(html).toMatch(/href="\/learn"[^>]*class="[^"]*active/);
    });
  });

  describe('published 文章 — article header', () => {
    it('含 ← 返回知识体系 链接到 /learn', () => {
      const html = createLearnArticleHtml(PUBLISHED_ARTICLE, PUBLISHED_NAV);
      expect(html).toContain('返回知识体系');
      expect(html).toContain('href="/learn"');
      expect(html).toContain('←');
    });

    it('含 H1 文章标题', () => {
      const html = createLearnArticleHtml(PUBLISHED_ARTICLE, PUBLISHED_NAV);
      expect(html).toContain('ReAct Loop 剖析');
      expect(html).toMatch(/<h1[^>]*>\s*ReAct Loop 剖析\s*<\/h1>/);
    });

    it('含 meta 行（TRACK · chapter · difficulty · reading time）', () => {
      const html = createLearnArticleHtml(PUBLISHED_ARTICLE, PUBLISHED_NAV);
      // track label TRACK 1（agent-practice → order 1）
      expect(html).toContain('TRACK 1');
      // chapter
      expect(html).toContain('核心特性深入篇');
      // difficulty（原始值）
      expect(html).toContain('intermediate');
      // 阅读时间 + min
      expect(html).toContain('12 min');
      // 用 · 分隔
      expect(html).toContain('·');
    });

    it('含摘要 description（italic secondary）', () => {
      const html = createLearnArticleHtml(PUBLISHED_ARTICLE, PUBLISHED_NAV);
      expect(html).toContain(PUBLISHED_ARTICLE.meta.description);
      expect(html).toMatch(/font-style:\s*italic/);
    });

    it('含最后更新日期 + 前置文章', () => {
      const html = createLearnArticleHtml(PUBLISHED_ARTICLE, PUBLISHED_NAV);
      expect(html).toContain('2026-06-15');
      // prerequisites slugs
      expect(html).toContain('agent-overview');
      expect(html).toContain('agent-quickstart');
    });
  });

  describe('published 文章 — article body', () => {
    it('含 marked 渲染的 renderedHtml 内容', () => {
      const html = createLearnArticleHtml(PUBLISHED_ARTICLE, PUBLISHED_NAV);
      expect(html).toContain('什么是 ReAct Loop');
      expect(html).toContain('ReAct Loop 是 aptbot 的核心推理循环');
      expect(html).toContain('const loop = new ReActLoop();');
      expect(html).toContain('ReAct = Reasoning + Acting');
    });

    it('含 720px max-width CSS（header / body / footer 居中）', () => {
      const html = createLearnArticleHtml(PUBLISHED_ARTICLE, PUBLISHED_NAV);
      expect(html).toContain('max-width: 720px');
    });

    it('含文章正文排版 CSS（h2 / h3 / p / code / pre / blockquote）', () => {
      const html = createLearnArticleHtml(PUBLISHED_ARTICLE, PUBLISHED_NAV);
      // h2 28px margin-top 48px border-bottom
      expect(html).toMatch(/h2\s*\{[^}]*font-size:\s*28px/);
      expect(html).toMatch(/h2\s*\{[^}]*margin-top:\s*48px/);
      expect(html).toMatch(/h2\s*\{[^}]*border-bottom:\s*1px/);
      // h3 22px margin-top 32px
      expect(html).toMatch(/h3\s*\{[^}]*font-size:\s*22px/);
      expect(html).toMatch(/h3\s*\{[^}]*margin-top:\s*32px/);
      // p 18px line-height 1.7
      expect(html).toMatch(/p\s*\{[^}]*font-size:\s*18px/);
      expect(html).toMatch(/p\s*\{[^}]*line-height:\s*1\.7/);
      // code inline bg-muted
      expect(html).toMatch(/code\s*\{[^}]*background:\s*var\(--bg-muted\)/);
      // pre bg-darker + border-radius 8px + overflow-x auto
      expect(html).toMatch(/pre\s*\{[^}]*border-radius:\s*8px/);
      expect(html).toMatch(/pre\s*\{[^}]*overflow-x:\s*auto/);
      // blockquote border-left accent（3px solid var(--accent)）
      expect(html).toMatch(/blockquote\s*\{[^}]*border-left:\s*3px\s+solid\s+var\(--accent\)/);
      // a color accent
      expect(html).toMatch(/a\s*\{[^}]*color:\s*var\(--accent\)/);
      // img max-width 100%
      expect(html).toMatch(/img\s*\{[^}]*max-width:\s*100%/);
    });
  });

  describe('published 文章 — 上下篇导航', () => {
    it('nav 不为 null 时显示上一篇 + 下一篇', () => {
      const html = createLearnArticleHtml(PUBLISHED_ARTICLE, PUBLISHED_NAV);
      // 上一篇 + 下一篇 文案
      expect(html).toContain('上一篇');
      expect(html).toContain('下一篇');
      // 链接到 prev / next slug
      expect(html).toContain('href="/learn/agent-quickstart"');
      expect(html).toContain('href="/learn/tool-system"');
      // prev / next 标题
      expect(html).toContain('快速上手 aptbot');
      expect(html).toContain('工具系统与声明式 registry');
    });

    it('nav.prev 为 null 时不显示上一篇', () => {
      const html = createLearnArticleHtml(PUBLISHED_ARTICLE, { prev: null, next: NEXT_ARTICLE });
      expect(html).not.toContain('上一篇');
      expect(html).toContain('下一篇');
    });

    it('nav.next 为 null 时不显示下一篇', () => {
      const html = createLearnArticleHtml(PUBLISHED_ARTICLE, { prev: PREV_ARTICLE, next: null });
      expect(html).toContain('上一篇');
      expect(html).not.toContain('下一篇');
    });

    it('nav 全为 null 时上下篇导航均不显示', () => {
      const html = createLearnArticleHtml(PUBLISHED_ARTICLE, { prev: null, next: null });
      expect(html).not.toContain('上一篇');
      expect(html).not.toContain('下一篇');
    });
  });

  describe('published 文章 — 反馈表单', () => {
    it('含反馈区引导文案', () => {
      const html = createLearnArticleHtml(PUBLISHED_ARTICLE, PUBLISHED_NAV);
      expect(html).toContain('这篇文章对你有帮助吗');
    });

    it('含 form method POST action /api/feedback', () => {
      const html = createLearnArticleHtml(PUBLISHED_ARTICLE, PUBLISHED_NAV);
      expect(html).toMatch(/<form[^>]*method="post"[^>]*action="\/api\/feedback"/);
      expect(html).toContain('/api/feedback');
    });

    it('含 category=article 隐藏域', () => {
      const html = createLearnArticleHtml(PUBLISHED_ARTICLE, PUBLISHED_NAV);
      expect(html).toMatch(/<input[^>]*type="hidden"[^>]*name="category"[^>]*value="article"/);
    });

    it('含 articleSlug 隐藏域（值为当前文章 slug）', () => {
      const html = createLearnArticleHtml(PUBLISHED_ARTICLE, PUBLISHED_NAV);
      expect(html).toMatch(/<input[^>]*type="hidden"[^>]*name="articleSlug"[^>]*value="react-loop"/);
    });

    it('含 textarea maxlength 2000 required', () => {
      const html = createLearnArticleHtml(PUBLISHED_ARTICLE, PUBLISHED_NAV);
      expect(html).toMatch(/<textarea[^>]*name="message"[^>]*maxlength="2000"[^>]*required/);
    });

    it('含 contact 输入框 maxlength 120（可选）', () => {
      const html = createLearnArticleHtml(PUBLISHED_ARTICLE, PUBLISHED_NAV);
      expect(html).toMatch(/<input[^>]*name="contact"[^>]*maxlength="120"/);
    });

    it('含提交按钮（pill 样式）', () => {
      const html = createLearnArticleHtml(PUBLISHED_ARTICLE, PUBLISHED_NAV);
      expect(html).toContain('提交');
      expect(html).toMatch(/border-radius:\s*9999px/);
    });

    it('含状态提示区 div', () => {
      const html = createLearnArticleHtml(PUBLISHED_ARTICLE, PUBLISHED_NAV);
      expect(html).toContain('feedback-status');
    });
  });

  describe('published 文章 — 内联 script 反馈交互', () => {
    it('含内联 <script>', () => {
      const html = createLearnArticleHtml(PUBLISHED_ARTICLE, PUBLISHED_NAV);
      expect(html).toContain('<script>');
      expect(html).toContain('</script>');
    });

    it('script 含 fetch POST /api/feedback 调用', () => {
      const html = createLearnArticleHtml(PUBLISHED_ARTICLE, PUBLISHED_NAV);
      expect(html).toContain('fetch(');
      expect(html).toContain('/api/feedback');
      expect(html).toMatch(/method:\s*['"]POST['"]/);
    });

    it('script 含 preventDefault + 提交中状态切换', () => {
      const html = createLearnArticleHtml(PUBLISHED_ARTICLE, PUBLISHED_NAV);
      expect(html).toContain('preventDefault');
      expect(html).toContain('提交中');
    });

    it('script 含成功 / 400 / 429 / 网络错误 文案', () => {
      const html = createLearnArticleHtml(PUBLISHED_ARTICLE, PUBLISHED_NAV);
      expect(html).toContain('感谢反馈，已记录到待办');
      expect(html).toContain('提交过于频繁，请稍后再试');
      expect(html).toContain('网络错误，请检查连接');
    });
  });

  describe('published 文章 — footer（同列表页）', () => {
    it('含 aptbot wordmark + GitHub + MIT + © 2026 aptbot', () => {
      const html = createLearnArticleHtml(PUBLISHED_ARTICLE, PUBLISHED_NAV);
      expect(html).toContain('https://github.com/evan3060/aptbot');
      expect(html).toContain('MIT');
      expect(html).toContain('© 2026 aptbot');
    });
  });

  describe('published 文章 — 无 emoji 契约', () => {
    it('渲染产物不含彩色 emoji', () => {
      const html = createLearnArticleHtml(PUBLISHED_ARTICLE, PUBLISHED_NAV);
      expect(EMOJI_REGEX.test(html)).toBe(false);
    });
  });

  describe('planned 文章 — 计划中状态', () => {
    it('返回 HTML lang="zh-CN" + title 为 "文章标题 - aptbot 知识体系"', () => {
      const html = createLearnArticleHtml(PLANNED_ARTICLE, { prev: null, next: null });
      expect(html).toContain('<html lang="zh-CN">');
      expect(html).toContain('<title>演进路线规划 - aptbot 知识体系</title>');
    });

    it('含 PLANNED 文字标签（非 emoji）', () => {
      const html = createLearnArticleHtml(PLANNED_ARTICLE, { prev: null, next: null });
      expect(html).toContain('PLANNED');
    });

    it('PLANNED 标签使用 CSS 边框（非 emoji）', () => {
      const html = createLearnArticleHtml(PLANNED_ARTICLE, { prev: null, next: null });
      // PLANNED 标签样式含 border（CSS 边框渲染）
      expect(html).toMatch(/planned-label[\s\S]{0,200}border/);
    });

    it('含 "本章正在撰写中" 提示', () => {
      const html = createLearnArticleHtml(PLANNED_ARTICLE, { prev: null, next: null });
      expect(html).toContain('本章正在撰写中');
    });

    it('含 "计划内容：" 大纲列表（从 description 渲染）', () => {
      const html = createLearnArticleHtml(PLANNED_ARTICLE, { prev: null, next: null });
      expect(html).toContain('计划内容');
      // description 拆分后的大纲项
      expect(html).toContain('短期：性能优化与文档完善');
      expect(html).toContain('中期：插件系统与多模态支持');
      expect(html).toContain('长期：自主任务编排与跨 agent 协作');
      // 列表结构
      expect(html).toContain('<ul');
      expect(html).toContain('<li>');
    });

    it('含 "返回知识体系" 链接到 /learn', () => {
      const html = createLearnArticleHtml(PLANNED_ARTICLE, { prev: null, next: null });
      expect(html).toContain('返回知识体系');
      expect(html).toContain('href="/learn"');
    });

    it('不含反馈表单', () => {
      const html = createLearnArticleHtml(PLANNED_ARTICLE, { prev: null, next: null });
      expect(html).not.toContain('/api/feedback');
      expect(html).not.toContain('feedback-status');
    });

    it('不含上下篇导航', () => {
      const html = createLearnArticleHtml(PLANNED_ARTICLE, { prev: null, next: null });
      expect(html).not.toContain('上一篇');
      expect(html).not.toContain('下一篇');
    });

    it('含 H1 文章标题', () => {
      const html = createLearnArticleHtml(PLANNED_ARTICLE, { prev: null, next: null });
      expect(html).toContain('演进路线规划');
      expect(html).toMatch(/<h1[^>]*>\s*演进路线规划\s*<\/h1>/);
    });

    it('含 720px max-width CSS（与 published 一致）', () => {
      const html = createLearnArticleHtml(PLANNED_ARTICLE, { prev: null, next: null });
      expect(html).toContain('max-width: 720px');
    });

    it('渲染产物不含彩色 emoji', () => {
      const html = createLearnArticleHtml(PLANNED_ARTICLE, { prev: null, next: null });
      expect(EMOJI_REGEX.test(html)).toBe(false);
    });
  });
});

/**
 * Task 6: learn-page.ts 反馈页 — createFeedbackHtml
 *
 * 测试策略：纯字符串契约测试。createFeedbackHtml() 无参数，返回 /feedback 通用反馈
 * 表单页 HTML。验证渲染产物：H1 "留言反馈" + 简介 + 反馈表单（method POST /api/feedback,
 * category=general 隐藏域，无 articleSlug）+ textarea maxlength 2000 required +
 * contact maxlength 120 可选 + pill 提交按钮 + 状态提示 div + nav + footer + 内联
 * script（fetch POST /api/feedback 交互）/ 无 emoji。
 *
 * Brief 要求：createFeedbackHtml(): string — NO parameters，返回表单页（非列表页）。
 */

describe('Task 6: createFeedbackHtml 反馈表单页', () => {
  describe('签名与 head', () => {
    it('createFeedbackHtml 无参数可调用（不接收 FeedbackEntry[]）', () => {
      // 调用时不传任何参数 — 若签名改为接收数组，TS 编译期会报错；运行期也应有返回
      const html = createFeedbackHtml();
      expect(typeof html).toBe('string');
      expect(html.length).toBeGreaterThan(0);
    });

    it('返回 HTML 默认 lang="zh-CN" + title "留言反馈 - aptbot"', () => {
      const html = createFeedbackHtml();
      expect(html).toContain('<html lang="zh-CN">');
      expect(html).toContain('<title>留言反馈 - aptbot</title>');
    });

    it('引入 Inter 字体 link（与列表页一致）', () => {
      const html = createFeedbackHtml();
      expect(html).toContain(
        '<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&display=swap" rel="stylesheet">',
      );
    });

    it('复用列表页 design tokens（--bg-base / --text-primary / --text-secondary / --bg-muted）', () => {
      const html = createFeedbackHtml();
      expect(html).toContain('--bg-base:');
      expect(html).toContain('--text-primary:');
      expect(html).toContain('--text-secondary:');
      expect(html).toContain('--bg-muted:');
    });
  });

  describe('nav（同列表页）', () => {
    it('含 aptbot wordmark + 首页 / 知识（active） / Demo', () => {
      const html = createFeedbackHtml();
      expect(html).toContain('href="/"');
      expect(html).toContain('aptbot');
      expect(html).toContain('首页');
      expect(html).toContain('href="/learn"');
      expect(html).toContain('知识');
      expect(html).toContain('href="/demo"');
      expect(html).toContain('Demo');
      // 知识 tab 标记 active
      expect(html).toMatch(/href="\/learn"[^>]*class="[^"]*active/);
    });
  });

  describe('main 头部 — H1 + 简介', () => {
    it('含 H1 "留言反馈"（48px 400 primary）', () => {
      const html = createFeedbackHtml();
      expect(html).toMatch(/<h1[^>]*>\s*留言反馈\s*<\/h1>/);
      // 48px 400 primary 样式（与列表页 H1 一致）
      expect(html).toMatch(/h1\s*\{[^}]*font-size:\s*48px/);
      expect(html).toMatch(/h1\s*\{[^}]*font-weight:\s*400/);
      expect(html).toMatch(/h1\s*\{[^}]*color:\s*var\(--text-primary\)/);
    });

    it('含简介 "有想法、问题或需求？提交给我们，会记录到待办。"（20px secondary）', () => {
      const html = createFeedbackHtml();
      expect(html).toContain('有想法、问题或需求？提交给我们，会记录到待办。');
      // 20px secondary 样式（与列表页 page-subtitle 一致）
      expect(html).toMatch(/page-subtitle\s*\{[^}]*font-size:\s*20px/);
      expect(html).toMatch(/page-subtitle\s*\{[^}]*color:\s*var\(--text-secondary\)/);
    });
  });

  describe('反馈表单结构', () => {
    it('含 form method POST action /api/feedback', () => {
      const html = createFeedbackHtml();
      expect(html).toMatch(/<form[^>]*method="post"[^>]*action="\/api\/feedback"/);
      expect(html).toContain('/api/feedback');
    });

    it('含 category=general 隐藏域', () => {
      const html = createFeedbackHtml();
      expect(html).toMatch(/<input[^>]*type="hidden"[^>]*name="category"[^>]*value="general"/);
    });

    it('不含 articleSlug 隐藏域（通用反馈无关联文章）', () => {
      const html = createFeedbackHtml();
      expect(html).not.toMatch(/name="articleSlug"/);
    });

    it('含 textarea maxlength 2000 required', () => {
      const html = createFeedbackHtml();
      expect(html).toMatch(/<textarea[^>]*name="message"[^>]*maxlength="2000"[^>]*required/);
    });

    it('含 contact 输入框 maxlength 120（可选，无 required）', () => {
      const html = createFeedbackHtml();
      expect(html).toMatch(/<input[^>]*name="contact"[^>]*maxlength="120"/);
      // contact 输入框标签内不应有 required 属性
      const contactMatch = html.match(/<input[^>]*name="contact"[^>]*>/);
      expect(contactMatch).not.toBeNull();
      expect(contactMatch![0]).not.toContain('required');
    });

    it('含提交按钮（pill 样式 border-radius 9999px）', () => {
      const html = createFeedbackHtml();
      expect(html).toContain('提交');
      expect(html).toMatch(/<button[^>]*type="submit"[^>]*>/);
      // pill 样式：border-radius 9999px
      expect(html).toMatch(/border-radius:\s*9999px/);
    });

    it('含状态提示区 div（feedback-status）', () => {
      const html = createFeedbackHtml();
      expect(html).toContain('feedback-status');
      // 状态提示区为 div 元素
      expect(html).toMatch(/<div[^>]*class="[^"]*feedback-status[^"]*"/);
    });
  });

  describe('footer（同列表页）', () => {
    it('含 aptbot wordmark + GitHub + MIT + © 2026 aptbot', () => {
      const html = createFeedbackHtml();
      expect(html).toContain('https://github.com/evan3060/aptbot');
      expect(html).toContain('MIT');
      expect(html).toContain('© 2026 aptbot');
    });
  });

  describe('内联 script — 反馈表单交互（同文章页）', () => {
    it('含内联 <script>', () => {
      const html = createFeedbackHtml();
      expect(html).toContain('<script>');
      expect(html).toContain('</script>');
    });

    it('script 含 fetch POST /api/feedback 调用', () => {
      const html = createFeedbackHtml();
      expect(html).toContain('fetch(');
      expect(html).toContain('/api/feedback');
      expect(html).toMatch(/method:\s*['"]POST['"]/);
    });

    it('script 含 preventDefault + 提交中状态切换', () => {
      const html = createFeedbackHtml();
      expect(html).toContain('preventDefault');
      expect(html).toContain('提交中');
    });

    it('script 含成功 / 429 / 网络错误 文案', () => {
      const html = createFeedbackHtml();
      expect(html).toContain('感谢反馈，已记录到待办');
      expect(html).toContain('提交过于频繁，请稍后再试');
      expect(html).toContain('网络错误，请检查连接');
    });
  });

  describe('无 emoji 契约', () => {
    it('渲染产物不含彩色 emoji', () => {
      const html = createFeedbackHtml();
      expect(EMOJI_REGEX.test(html)).toBe(false);
    });
  });
});
