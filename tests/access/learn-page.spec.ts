import { describe, it, expect } from 'vitest';
import { createLearnListHtml } from '../../src/access/learn-page.js';
import { TRACKS, type Article, type ArticleState, type ArticleMeta } from '../../src/learn/article-types.js';

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
      // Track 1 / Track 2 用真实 track title 作为 tab 标签
      expect(html).toContain('Agent 体系实践');
      expect(html).toContain('AI 辅助编码实践');
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
