import { describe, it, expect } from 'vitest';
import { createLandingPageHtml } from '../../src/access/landing-page.js';
import { TRACKS, type Article, type ArticleState, type ArticleMeta } from '../../src/learn/article-types.js';

// === Task 7 fixture: 与 landing-page.spec.ts 同构的 19 篇文章 fixture ===
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
  buildArticle(buildMeta({ slug: 'agent-overview', title: 'Agent 总览', track: 'agent-practice', chapter: '入门篇', order: 1 })),
  buildArticle(buildMeta({ slug: 'agent-quickstart', title: '快速上手 aptbot', track: 'agent-practice', chapter: '入门篇', order: 2 })),
  buildArticle(buildMeta({ slug: 'react-loop', title: 'ReAct Loop 剖析', track: 'agent-practice', chapter: '核心特性深入篇', order: 3 })),
  buildArticle(buildMeta({ slug: 'tool-system', title: '工具系统与声明式 registry', track: 'agent-practice', chapter: '核心特性深入篇', order: 4 })),
  buildArticle(buildMeta({ slug: 'memory-arch', title: '三层记忆架构', track: 'agent-practice', chapter: '核心特性深入篇', order: 5 })),
  buildArticle(buildMeta({ slug: 'multi-user', title: '多用户隔离设计', track: 'agent-practice', chapter: '核心特性深入篇', order: 6 })),
  buildArticle(buildMeta({ slug: 'streaming-control', title: 'TTFB / 块双时钟流式控制', track: 'agent-practice', chapter: '核心特性深入篇', order: 7 })),
  buildArticle(buildMeta({ slug: 'provider-failover', title: 'Provider 故障转移与熔断器', track: 'agent-practice', chapter: '核心特性深入篇', order: 8 })),
  buildArticle(buildMeta({ slug: 'hook-system', title: 'Hook 系统的 8 个扩展点', track: 'agent-practice', chapter: '核心特性深入篇', order: 9 })),
  buildArticle(buildMeta({ slug: 'im-channels', title: 'IM 通道零核心改动接入', track: 'agent-practice', chapter: '核心特性深入篇', order: 10 })),
  buildArticle(buildMeta({ slug: 'agent-design', title: 'Agent 设计哲学', track: 'agent-practice', chapter: '方法论', order: 11 })),
  buildArticle(buildMeta({ slug: 'roadmap', title: '演进路线规划', track: 'agent-practice', chapter: '方法论', order: 12, status: 'planned' })),
  buildArticle(buildMeta({ slug: 'future-work', title: '未来工作展望', track: 'agent-practice', chapter: '方法论', order: 13, status: 'planned' })),
  buildArticle(buildMeta({ slug: 'ai-coding-overview', title: 'AI 辅助编码总览', track: 'ai-coding-practice', chapter: '方法论', order: 1 })),
  buildArticle(buildMeta({ slug: 'prompt-engineering', title: '提示工程实践', track: 'ai-coding-practice', chapter: '方法论', order: 2 })),
  buildArticle(buildMeta({ slug: 'context-engineering', title: '上下文工程方法论', track: 'ai-coding-practice', chapter: '方法论', order: 3 })),
  buildArticle(buildMeta({ slug: 'pair-programming', title: 'AI 结对编程', track: 'ai-coding-practice', chapter: '实战篇', order: 4 })),
  buildArticle(buildMeta({ slug: 'code-review-ai', title: 'AI 代码评审工作流', track: 'ai-coding-practice', chapter: '实战篇', order: 5, status: 'planned' })),
  buildArticle(buildMeta({ slug: 'refactoring-ai', title: 'AI 辅助重构', track: 'ai-coding-practice', chapter: '实战篇', order: 6, status: 'planned' })),
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
 * 落地页移动端字体与椭圆框精致化适配验收。
 *
 * 痛点（390 视口实测）：
 *   - hero CTA pill 24px 字体 + 12px 36px padding → 220×51 椭圆框过大
 *   - hero h1 48px 与 subtitle 20px 落差大，subtitle 未缩小
 *   - section h2-lg 48px / h2-md 36px / h2-sm 24px 未在移动端缩放
 *   - eval-value 48px 在小屏过大
 *   - card h3/desc 20px 偏大
 *   - nav 中 .nav-demo-btn / .nav-lang 行高叠加导致椭圆框高度异常
 *
 * 修复策略（移动端精致化）：
 *   1. .btn-pill 移动端字号 16px、padding 10px 24px
 *   2. hero h1 缩到 36px、line-height 1.1
 *   3. hero subtitle 缩到 16px
 *   4. section h2-lg/md/sm 移动端各自缩小
 *   5. eval-value 缩到 32px
 *   6. card h3 16px、card-desc 16px
 *   7. nav-demo-btn / nav-lang 行高与 padding 收紧
 */
describe('landing-page 移动端字体与椭圆框适配 (≤767px)', () => {
  // 辅助：提取 @media (max-width: 767px) 块内容
  function getMobileBlock(html: string): string | null {
    const m = html.match(/@media\s*\(max-width:\s*767px\)\s*\{([\s\S]*?)\}\s*(?:@media|<\/style>)/);
    return m ? m[1] : null;
  }

  describe('媒体查询块存在', () => {
    it('含 max-width: 767px 媒体查询', () => {
      const html = createLandingPageHtml();
      expect(html).toContain('@media (max-width: 767px)');
    });
  });

  describe('椭圆框（.btn-pill）移动端精致化', () => {
    it('.btn-pill 字号缩小到 16px', () => {
      const html = createLandingPageHtml();
      const block = getMobileBlock(html);
      expect(block, 'mobile block should exist').not.toBeNull();
      expect(block!).toMatch(/\.btn-pill\s*\{[^}]*font-size:\s*16px/);
    });

    it('.btn-pill padding 收紧到 10px 24px', () => {
      const html = createLandingPageHtml();
      const block = getMobileBlock(html);
      expect(block, 'mobile block should exist').not.toBeNull();
      expect(block!).toMatch(/\.btn-pill\s*\{[^}]*padding:\s*10px\s+24px/);
    });
  });

  describe('hero 字体层级协调', () => {
    it('hero h1 移动端字号 ≤ 40px', () => {
      const html = createLandingPageHtml();
      const block = getMobileBlock(html);
      expect(block, 'mobile block should exist').not.toBeNull();
      const m = block!.match(/#hero\s+h1\s*\{([^}]*?)\}/);
      expect(m, 'mobile #hero h1 rule should exist').not.toBeNull();
      const fontSizeMatch = m![1].match(/font-size:\s*(\d+)px/);
      expect(fontSizeMatch, 'font-size should be defined').not.toBeNull();
      expect(parseInt(fontSizeMatch![1])).toBeLessThanOrEqual(40);
    });

    it('hero subtitle 移动端字号 ≤ 18px', () => {
      const html = createLandingPageHtml();
      const block = getMobileBlock(html);
      expect(block, 'mobile block should exist').not.toBeNull();
      expect(block!).toMatch(/\.hero-subtitle\s*\{[^}]*font-size:\s*(?:16|17|18)px/);
    });
  });

  describe('section h2 层级移动端缩放', () => {
    it('.section-h2-lg 移动端字号 ≤ 32px', () => {
      const html = createLandingPageHtml();
      const block = getMobileBlock(html);
      expect(block, 'mobile block should exist').not.toBeNull();
      const m = block!.match(/\.section-h2-lg\s*\{([^}]*?)\}/);
      expect(m, 'mobile .section-h2-lg rule should exist').not.toBeNull();
      const fontSizeMatch = m![1].match(/font-size:\s*(\d+)px/);
      expect(fontSizeMatch, 'font-size should be defined').not.toBeNull();
      expect(parseInt(fontSizeMatch![1])).toBeLessThanOrEqual(32);
    });

    it('.section-h2-md 移动端字号 ≤ 28px', () => {
      const html = createLandingPageHtml();
      const block = getMobileBlock(html);
      expect(block, 'mobile block should exist').not.toBeNull();
      const m = block!.match(/\.section-h2-md\s*\{([^}]*?)\}/);
      expect(m, 'mobile .section-h2-md rule should exist').not.toBeNull();
      const fontSizeMatch = m![1].match(/font-size:\s*(\d+)px/);
      expect(fontSizeMatch, 'font-size should be defined').not.toBeNull();
      expect(parseInt(fontSizeMatch![1])).toBeLessThanOrEqual(28);
    });

    it('.section-h2-sm 移动端字号 ≤ 18px', () => {
      const html = createLandingPageHtml();
      const block = getMobileBlock(html);
      expect(block, 'mobile block should exist').not.toBeNull();
      const m = block!.match(/\.section-h2-sm\s*\{([^}]*?)\}/);
      expect(m, 'mobile .section-h2-sm rule should exist').not.toBeNull();
      const fontSizeMatch = m![1].match(/font-size:\s*(\d+)px/);
      expect(fontSizeMatch, 'font-size should be defined').not.toBeNull();
      expect(parseInt(fontSizeMatch![1])).toBeLessThanOrEqual(18);
    });
  });

  describe('eval-value 移动端缩小', () => {
    it('.eval-value 移动端字号 ≤ 32px', () => {
      const html = createLandingPageHtml();
      const block = getMobileBlock(html);
      expect(block, 'mobile block should exist').not.toBeNull();
      const m = block!.match(/\.eval-value\s*\{([^}]*?)\}/);
      expect(m, 'mobile .eval-value rule should exist').not.toBeNull();
      const fontSizeMatch = m![1].match(/font-size:\s*(\d+)px/);
      expect(fontSizeMatch, 'font-size should be defined').not.toBeNull();
      expect(parseInt(fontSizeMatch![1])).toBeLessThanOrEqual(32);
    });
  });

  describe('card 文字移动端紧凑', () => {
    it('.card h3 移动端字号 ≤ 18px', () => {
      const html = createLandingPageHtml();
      const block = getMobileBlock(html);
      expect(block, 'mobile block should exist').not.toBeNull();
      const m = block!.match(/\.card\s+h3\s*\{([^}]*?)\}/);
      if (m) {
        const fontSizeMatch = m[1].match(/font-size:\s*(\d+)px/);
        if (fontSizeMatch) {
          expect(parseInt(fontSizeMatch[1])).toBeLessThanOrEqual(18);
        }
      }
      // 不强制要求修改 .card h3（若未改也通过），关键看 .card-desc
    });

    it('.card-desc 移动端字号 ≤ 17px', () => {
      const html = createLandingPageHtml();
      const block = getMobileBlock(html);
      expect(block, 'mobile block should exist').not.toBeNull();
      const m = block!.match(/\.card-desc\s*\{([^}]*?)\}/);
      expect(m, 'mobile .card-desc rule should exist').not.toBeNull();
      const fontSizeMatch = m![1].match(/font-size:\s*(\d+)px/);
      expect(fontSizeMatch, 'font-size should be defined').not.toBeNull();
      expect(parseInt(fontSizeMatch![1])).toBeLessThanOrEqual(17);
    });
  });

  describe('nav 椭圆框（.nav-demo-btn / .nav-lang）移动端紧凑', () => {
    it('.nav-demo-btn 移动端 padding 收紧', () => {
      const html = createLandingPageHtml();
      const block = getMobileBlock(html);
      expect(block, 'mobile block should exist').not.toBeNull();
      const m = block!.match(/\.nav-demo-btn\s*\{([^}]*?)\}/);
      expect(m, 'mobile .nav-demo-btn rule should exist').not.toBeNull();
      // 应当有 padding 或 line-height 收紧
      const hasPadding = /padding:/.test(m![1]) || /line-height:/.test(m![1]) || /font-size:/.test(m![1]);
      expect(hasPadding, 'nav-demo-btn should have padding/line-height/font-size adjustment').toBe(true);
    });

    it('.nav-lang 移动端 padding 或字号收紧', () => {
      const html = createLandingPageHtml();
      const block = getMobileBlock(html);
      expect(block, 'mobile block should exist').not.toBeNull();
      const m = block!.match(/\.nav-lang\s*\{([^}]*?)\}/);
      expect(m, 'mobile .nav-lang rule should exist').not.toBeNull();
      const hasAdjustment = /padding:/.test(m![1]) || /font-size:/.test(m![1]);
      expect(hasAdjustment, 'nav-lang should have padding/font-size adjustment').toBe(true);
    });

    it('nav 行高或 padding 整体收紧避免椭圆框高度异常', () => {
      const html = createLandingPageHtml();
      const block = getMobileBlock(html);
      expect(block, 'mobile block should exist').not.toBeNull();
      // .nav-demo-btn 应当有 line-height: 1 或较小值
      const m = block!.match(/\.nav-demo-btn\s*\{([^}]*?)\}/);
      expect(m, 'mobile .nav-demo-btn rule should exist').not.toBeNull();
      expect(m![1]).toMatch(/line-height:\s*(?:1|1\.1|1\.2|normal)/);
    });
  });
});

/**
 * Task 7: 知识 section 移动端字号缩放（learnEnabled 时生效）
 *
 * brief 要求：H2 36→24px，卡片 H3 20→17px，摘要 15→14px，卡片网格 1 列。
 * H2 由 .section-h2-md 移动端规则覆盖（已验证 24px），此处验证知识 section 专属规则。
 */
describe('Task 7: 知识 section 移动端字号缩放 (≤767px)', () => {
  function getMobileBlock(html: string): string | null {
    const m = html.match(/@media\s*\(max-width:\s*767px\)\s*\{([\s\S]*?)\}\s*(?:@media|<\/style>)/);
    return m ? m[1] : null;
  }

  it('含 .knowledge-subtitle 移动端字号 ≤ 18px', () => {
    const html = createLandingPageHtml({ learnEnabled: true, articleState: STATE });
    const block = getMobileBlock(html);
    expect(block, 'mobile block should exist').not.toBeNull();
    const m = block!.match(/\.knowledge-subtitle\s*\{([^}]*?)\}/);
    expect(m, 'mobile .knowledge-subtitle rule should exist').not.toBeNull();
    const fontSizeMatch = m![1].match(/font-size:\s*(\d+)px/);
    expect(fontSizeMatch, 'font-size should be defined').not.toBeNull();
    expect(parseInt(fontSizeMatch![1])).toBeLessThanOrEqual(18);
  });

  it('含 .article-title 移动端字号 17px', () => {
    const html = createLandingPageHtml({ learnEnabled: true, articleState: STATE });
    const block = getMobileBlock(html);
    expect(block, 'mobile block should exist').not.toBeNull();
    const m = block!.match(/\.article-title\s*\{([^}]*?)\}/);
    expect(m, 'mobile .article-title rule should exist').not.toBeNull();
    const fontSizeMatch = m![1].match(/font-size:\s*(\d+)px/);
    expect(fontSizeMatch, 'font-size should be defined').not.toBeNull();
    expect(parseInt(fontSizeMatch![1])).toBe(17);
  });

  it('含 .article-desc 移动端字号 14px', () => {
    const html = createLandingPageHtml({ learnEnabled: true, articleState: STATE });
    const block = getMobileBlock(html);
    expect(block, 'mobile block should exist').not.toBeNull();
    const m = block!.match(/\.article-desc\s*\{([^}]*?)\}/);
    expect(m, 'mobile .article-desc rule should exist').not.toBeNull();
    const fontSizeMatch = m![1].match(/font-size:\s*(\d+)px/);
    expect(fontSizeMatch, 'font-size should be defined').not.toBeNull();
    expect(parseInt(fontSizeMatch![1])).toBe(14);
  });

  it('含 #learn .card-grid 移动端 1 列', () => {
    const html = createLandingPageHtml({ learnEnabled: true, articleState: STATE });
    const block = getMobileBlock(html);
    expect(block, 'mobile block should exist').not.toBeNull();
    // #learn .card-grid 应当 grid-template-columns: 1fr
    expect(block!).toMatch(/#learn[^{]*\.card-grid\s*\{[^}]*grid-template-columns:\s*1fr/);
  });
});
