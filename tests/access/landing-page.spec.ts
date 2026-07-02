import { describe, it, expect } from 'vitest';
import { createLandingPageHtml } from '../../src/access/landing-page.js';
import { TRACKS, type Article, type ArticleState, type ArticleMeta } from '../../src/learn/article-types.js';

// 检测常见彩色 emoji（避开 ▼ / → 等 BMP 几何符号 / 箭头）
const EMOJI_REGEX =
  /[\u{1F300}-\u{1FAFF}\u{1F600}-\u{1F64F}\u{1F680}-\u{1F6FF}\u{1F900}-\u{1F9FF}]/u;

// === Task 7 fixture: 19 articles / 2 tracks (13 agent + 6 coding) ===
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

const ARTICLES: Article[] = [
  // === Track 1: agent-practice (13) ===
  // 入门篇 (2)
  buildArticle(buildMeta({ slug: 'agent-overview', title: 'Agent 总览', track: 'agent-practice', chapter: '入门篇', order: 1, difficulty: 'beginner', estimatedReadingTime: 5 })),
  buildArticle(buildMeta({ slug: 'agent-quickstart', title: '快速上手 aptbot', track: 'agent-practice', chapter: '入门篇', order: 2, difficulty: 'beginner', estimatedReadingTime: 8 })),
  // 核心特性深入篇 (8) — 用于测试 +N 更多
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
  buildArticle(buildMeta({ slug: 'ai-coding-overview', title: 'AI 辅助编码总览', track: 'ai-coding-practice', chapter: '方法论', order: 1, difficulty: 'beginner', estimatedReadingTime: 6 })),
  buildArticle(buildMeta({ slug: 'prompt-engineering', title: '提示工程实践', track: 'ai-coding-practice', chapter: '方法论', order: 2, difficulty: 'intermediate', estimatedReadingTime: 10 })),
  buildArticle(buildMeta({ slug: 'context-engineering', title: '上下文工程方法论', track: 'ai-coding-practice', chapter: '方法论', order: 3, difficulty: 'intermediate', estimatedReadingTime: 12 })),
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

/**
 * Task 2: landing-page.ts 骨架 + adept design tokens
 *
 * 测试策略：纯字符串契约测试，验证骨架关键标记与 13 个 design tokens 存在。
 * 5 sections 内容由 Task 3 填充，本任务只验证骨架。
 */
describe('Task 2: landing-page 骨架与 adept design tokens', () => {
  it('返回 HTML 默认 lang="zh-CN"', () => {
    const html = createLandingPageHtml();
    expect(html).toContain('<html lang="zh-CN">');
  });

  it('引入 Inter 字体 link', () => {
    const html = createLandingPageHtml();
    expect(html).toContain(
      '<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&display=swap" rel="stylesheet">'
    );
  });

  it('定义 --bg-base token', () => {
    const html = createLandingPageHtml();
    expect(html).toContain('--bg-base: rgb(255, 255, 255)');
  });

  it('定义 --accent token', () => {
    const html = createLandingPageHtml();
    expect(html).toContain('--accent: rgb(13, 113, 73)');
  });

  it('定义 --text-primary token', () => {
    const html = createLandingPageHtml();
    expect(html).toContain('--text-primary: rgb(39, 36, 34)');
  });
});

/**
 * Task 3: landing-page 5 sections 内容 + adept 视觉契约
 *
 * 在 Task 2 骨架基础上验证 5 个 section 锚点、/demo 链接、GitHub 链接、
 * 数据条数字、data-i18n 节点、adept 真实 CSS 值（pill 圆角 / hero h1 字号字距 / nav 固定定位 + 滚动过渡）。
 */
describe('Task 3: landing-page 5 sections 内容与 adept 视觉契约', () => {
  it('含 #hero / #features / #architecture / #use-cases / #cta 锚点', () => {
    const html = createLandingPageHtml();
    expect(html).toContain('id="hero"');
    expect(html).toContain('id="features"');
    expect(html).toContain('id="architecture"');
    expect(html).toContain('id="use-cases"');
    expect(html).toContain('id="cta"');
  });

  it('含 /demo 链接（至少 3 处）', () => {
    const html = createLandingPageHtml();
    const matches = html.match(/href="\/demo"/g) || [];
    expect(matches.length).toBeGreaterThanOrEqual(3);
  });

  it('含 GitHub 链接 https://github.com/evan3060/aptbot', () => {
    const html = createLandingPageHtml();
    expect(html).toContain('https://github.com/evan3060/aptbot');
  });

  it('含数据条数字 938 / 4 / 8 / MIT（Task 7: 584→938 硬编码同步）', () => {
    const html = createLandingPageHtml();
    expect(html).toContain('938');
    expect(html).toContain('4');
    expect(html).toContain('8');
    expect(html).toContain('MIT');
  });

  it('含 data-i18n 节点（至少 10 个）', () => {
    const html = createLandingPageHtml();
    const matches = html.match(/data-i18n="/g) || [];
    expect(matches.length).toBeGreaterThanOrEqual(10);
  });

  it('含 border-radius: 9999px（adept pill 按钮）', () => {
    const html = createLandingPageHtml();
    expect(html).toContain('border-radius: 9999px');
  });

  it('含 font-size: 72px（hero h1）', () => {
    const html = createLandingPageHtml();
    expect(html).toContain('font-size: 72px');
  });

  it('含 letter-spacing: -3.6px（hero h1）', () => {
    const html = createLandingPageHtml();
    expect(html).toContain('letter-spacing: -3.6px');
  });

  it('含 position: fixed（nav 粘性顶栏）', () => {
    const html = createLandingPageHtml();
    expect(html).toContain('position: fixed');
  });

  it('含 transition 300ms ease-in-out（nav 滚动过渡）', () => {
    const html = createLandingPageHtml();
    // nav 始终有背景，transition 用于 border-color / box-shadow 滚动分层过渡
    expect(html).toMatch(/transition:[^;]*300ms[^;]*ease-in-out/);
  });
});

/**
 * Task 7: landing-page.ts 知识 section 扩展（learnEnabled 条件渲染）
 *
 * 当 learnEnabled === true（landingPage:true && learnPage:true）时：
 *   - nav 新增 "知识" 锚点 → #learn
 *   - Hero 副标题更新（含 "学习型项目"）
 *   - Hero 下方新增 "实操练习场" 小字
 *   - 架构数据条追加 articles/tracks 数字
 *   - 新增第 6 section "知识"（H2 / 副标题 / 数据条 / Track 1+2 分组 / chapter 卡片 / CTA）
 *   - 每 chapter 限显 4 张卡片，超出含 "+N 更多" 链接
 *   - planned 卡片含 coming soon 标记
 *
 * 当 learnEnabled === false 时：保持 v0.2.2 结构（5 section + 原 Hero + 原数据条 + nav 无 "知识"）。
 * 数据条测试数 938 为硬编码同步（始终应用，与 learnEnabled 无关）。
 */
describe('Task 7: learnEnabled 时知识 section 扩展', () => {
  describe('learnEnabled === true 时', () => {
    it('含 #learn 锚点（第 6 section）', () => {
      const html = createLandingPageHtml({ learnEnabled: true, articleState: STATE });
      expect(html).toContain('id="learn"');
    });

    it('nav 含 "知识" 链接 → #learn', () => {
      const html = createLandingPageHtml({ learnEnabled: true, articleState: STATE });
      expect(html).toMatch(/href="#learn"[^>]*>\s*知识/);
    });

    it('Hero 副标题含 "学习型项目"', () => {
      const html = createLandingPageHtml({ learnEnabled: true, articleState: STATE });
      expect(html).toContain('学习型项目');
    });

    it('Hero 下方含 "实操练习场" 小字', () => {
      const html = createLandingPageHtml({ learnEnabled: true, articleState: STATE });
      expect(html).toContain('实操练习场');
    });

    it('数据条含 articles/tracks 数字（19 篇文章 / 2 个 Track）', () => {
      const html = createLandingPageHtml({ learnEnabled: true, articleState: STATE });
      expect(html).toContain('篇文章');
      expect(html).toContain('个 Track');
    });

    it('含知识 section H2 "边用边学，从 0 理解 agent"', () => {
      const html = createLandingPageHtml({ learnEnabled: true, articleState: STATE });
      expect(html).toContain('边用边学，从 0 理解 agent');
    });

    it('含知识 section 副标题含 "19" + "篇结构化文章"', () => {
      const html = createLandingPageHtml({ learnEnabled: true, articleState: STATE });
      expect(html).toContain('>19<');
      expect(html).toContain('篇结构化文章');
    });

    it('含 TRACK 1 / TRACK 2 等宽标签', () => {
      const html = createLandingPageHtml({ learnEnabled: true, articleState: STATE });
      expect(html).toContain('TRACK 1');
      expect(html).toContain('TRACK 2');
    });

    it('含 Track 1 标题 "Agent 体系实践"', () => {
      const html = createLandingPageHtml({ learnEnabled: true, articleState: STATE });
      expect(html).toContain('Agent 体系实践');
    });

    it('含 Track 2 标题 "AI 辅助编码实践"', () => {
      const html = createLandingPageHtml({ learnEnabled: true, articleState: STATE });
      expect(html).toContain('AI 辅助编码实践');
    });

    it('含 "查看全部文章 →" pill 按钮 → /learn', () => {
      const html = createLandingPageHtml({ learnEnabled: true, articleState: STATE });
      expect(html).toContain('查看全部文章');
      expect(html).toMatch(/href="\/learn"/);
    });

    it('每 chapter 限显 4 张卡片超出含 "+N more" 链接（核心特性深入篇 8 篇 → +4 more）', () => {
      const html = createLandingPageHtml({ learnEnabled: true, articleState: STATE });
      expect(html).toContain('+4<');
      expect(html).toContain('更多');
    });

    it('planned 卡片含 coming soon 标记', () => {
      const html = createLandingPageHtml({ learnEnabled: true, articleState: STATE });
      expect(html).toContain('coming soon');
    });

    it('数据条测试数 938（硬编码同步）', () => {
      const html = createLandingPageHtml({ learnEnabled: true, articleState: STATE });
      expect(html).toContain('938');
    });

    it('知识 section 数据条数字动态注入（19 / 2 / 13 / 6）', () => {
      const html = createLandingPageHtml({ learnEnabled: true, articleState: STATE });
      // 用 regex 避免子串误匹配
      expect(html).toMatch(/eval-value[^>]*>\s*19\s*</);
      expect(html).toMatch(/eval-value[^>]*>\s*13\s*</);
      expect(html).toMatch(/eval-value[^>]*>\s*6\s*</);
    });

    it('不含 emoji', () => {
      const html = createLandingPageHtml({ learnEnabled: true, articleState: STATE });
      expect(EMOJI_REGEX.test(html)).toBe(false);
    });
  });

  describe('learnEnabled === false 时（v0.2.2 兼容）', () => {
    it('不含 #learn 锚点', () => {
      const html = createLandingPageHtml();
      expect(html).not.toContain('id="learn"');
    });

    it('不含 "知识" nav 链接', () => {
      const html = createLandingPageHtml();
      expect(html).not.toMatch(/href="#learn"[^>]*>\s*知识/);
    });

    it('Hero 副标题为 v0.2.2 原文（含 "不只是聊天机器人"，不含 "学习型项目"）', () => {
      const html = createLandingPageHtml();
      expect(html).toContain('不只是聊天机器人');
      expect(html).not.toContain('学习型项目');
    });

    it('Hero 下方不含 "实操练习场" 小字', () => {
      const html = createLandingPageHtml();
      expect(html).not.toContain('实操练习场');
    });

    it('数据条不含 articles/tracks（不含 "篇文章" / "个 Track"）', () => {
      const html = createLandingPageHtml();
      expect(html).not.toContain('篇文章');
      expect(html).not.toContain('个 Track');
    });

    it('不含 "查看全部文章"', () => {
      const html = createLandingPageHtml();
      expect(html).not.toContain('查看全部文章');
    });

    it('不含 "+N 更多"', () => {
      const html = createLandingPageHtml();
      expect(html).not.toMatch(/\+\d+\s+更多/);
    });

    it('数据条测试数 938（硬编码同步，与 learnEnabled 无关）', () => {
      const html = createLandingPageHtml();
      expect(html).toContain('938');
    });
  });
});
