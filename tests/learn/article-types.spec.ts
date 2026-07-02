import { describe, it, expect } from 'vitest';
import {
  ArticleMetaSchema,
  TRACKS,
  type ArticleMeta,
  type Article,
  type ArticleState,
  type ArticleNav,
  type TrackMeta,
} from '../../src/learn/article-types.js';

// 合法基准输入，所有字段都给出有效值；各字段边界测试在此基础上覆盖单字段
const validInput = {
  slug: 'agent-architecture-overview',
  title: 'Agent 架构总览',
  description: '介绍 aptbot agent 的整体架构与核心抽象。',
  track: 'agent-practice',
  chapter: '核心抽象',
  order: 1,
  difficulty: 'beginner' as const,
  estimatedReadingTime: 8,
  status: 'published' as const,
  prerequisites: [] as string[],
  lastUpdated: '2026-07-01',
  tags: ['architecture'],
};

describe('ArticleMetaSchema', () => {
  describe('合法输入', () => {
    it('接受完整的合法 frontmatter', () => {
      const result = ArticleMetaSchema.safeParse(validInput);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.slug).toBe('agent-architecture-overview');
        expect(result.data.track).toBe('agent-practice');
      }
    });

    it('返回的数据满足 ArticleMeta 类型结构', () => {
      const result = ArticleMetaSchema.safeParse(validInput);
      expect(result.success).toBe(true);
      if (result.success) {
        const meta: ArticleMeta = result.data;
        expect(meta).toBeDefined();
      }
    });
  });

  describe('默认值', () => {
    it('prerequisites 缺省时返回空数组', () => {
      const { prerequisites: _omitted, ...rest } = validInput;
      void _omitted;
      const result = ArticleMetaSchema.safeParse(rest);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.prerequisites).toEqual([]);
      }
    });

    it('tags 缺省时返回空数组', () => {
      const { tags: _omitted, ...rest } = validInput;
      void _omitted;
      const result = ArticleMetaSchema.safeParse(rest);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.tags).toEqual([]);
      }
    });
  });

  describe('slug 边界', () => {
    it('拒绝包含大写字母的 slug', () => {
      const result = ArticleMetaSchema.safeParse({
        ...validInput,
        slug: 'Agent-Overview',
      });
      expect(result.success).toBe(false);
    });

    it('拒绝包含下划线的 slug', () => {
      const result = ArticleMetaSchema.safeParse({
        ...validInput,
        slug: 'agent_overview',
      });
      expect(result.success).toBe(false);
    });

    it('拒绝空 slug', () => {
      const result = ArticleMetaSchema.safeParse({ ...validInput, slug: '' });
      expect(result.success).toBe(false);
    });

    it('接受长度恰好 64 的 slug', () => {
      const slug = 'a'.repeat(64);
      const result = ArticleMetaSchema.safeParse({ ...validInput, slug });
      expect(result.success).toBe(true);
    });

    it('拒绝长度 65 的 slug', () => {
      const slug = 'a'.repeat(65);
      const result = ArticleMetaSchema.safeParse({ ...validInput, slug });
      expect(result.success).toBe(false);
    });
  });

  describe('title 边界', () => {
    it('拒绝空 title', () => {
      const result = ArticleMetaSchema.safeParse({
        ...validInput,
        title: '',
      });
      expect(result.success).toBe(false);
    });

    it('接受长度恰好 120 的 title', () => {
      const title = '章'.repeat(120);
      const result = ArticleMetaSchema.safeParse({ ...validInput, title });
      expect(result.success).toBe(true);
    });

    it('拒绝长度 121 的 title', () => {
      const title = '章'.repeat(121);
      const result = ArticleMetaSchema.safeParse({ ...validInput, title });
      expect(result.success).toBe(false);
    });
  });

  describe('description 边界', () => {
    it('拒绝空 description', () => {
      const result = ArticleMetaSchema.safeParse({
        ...validInput,
        description: '',
      });
      expect(result.success).toBe(false);
    });

    it('接受长度恰好 200 的 description', () => {
      const description = '描'.repeat(200);
      const result = ArticleMetaSchema.safeParse({
        ...validInput,
        description,
      });
      expect(result.success).toBe(true);
    });

    it('拒绝长度 201 的 description', () => {
      const description = '描'.repeat(201);
      const result = ArticleMetaSchema.safeParse({
        ...validInput,
        description,
      });
      expect(result.success).toBe(false);
    });
  });

  describe('track 边界', () => {
    it('拒绝空 track', () => {
      const result = ArticleMetaSchema.safeParse({
        ...validInput,
        track: '',
      });
      expect(result.success).toBe(false);
    });

    it('拒绝不在 TRACKS 注册表中的 track', () => {
      const result = ArticleMetaSchema.safeParse({
        ...validInput,
        track: 'unknown-track',
      });
      expect(result.success).toBe(false);
    });

    it('接受长度恰好 32 的 track（若在注册表内）', () => {
      // 注：当前 TRACKS 注册表中无 32 字符 id，仅校验 max 边界逻辑不误拒
      // 此处验证 agent-practice 合法通过即可
      const result = ArticleMetaSchema.safeParse({
        ...validInput,
        track: 'agent-practice',
      });
      expect(result.success).toBe(true);
    });

    it('拒绝长度 33 的 track', () => {
      const result = ArticleMetaSchema.safeParse({
        ...validInput,
        track: 'x'.repeat(33),
      });
      expect(result.success).toBe(false);
    });
  });

  describe('chapter 边界', () => {
    it('拒绝空 chapter', () => {
      const result = ArticleMetaSchema.safeParse({
        ...validInput,
        chapter: '',
      });
      expect(result.success).toBe(false);
    });

    it('拒绝长度 33 的 chapter', () => {
      const chapter = '章'.repeat(33);
      const result = ArticleMetaSchema.safeParse({ ...validInput, chapter });
      expect(result.success).toBe(false);
    });
  });

  describe('order 边界', () => {
    it('拒绝 order = 0', () => {
      const result = ArticleMetaSchema.safeParse({
        ...validInput,
        order: 0,
      });
      expect(result.success).toBe(false);
    });

    it('接受 order = 1', () => {
      const result = ArticleMetaSchema.safeParse({
        ...validInput,
        order: 1,
      });
      expect(result.success).toBe(true);
    });

    it('接受 order = 999', () => {
      const result = ArticleMetaSchema.safeParse({
        ...validInput,
        order: 999,
      });
      expect(result.success).toBe(true);
    });

    it('拒绝 order = 1000', () => {
      const result = ArticleMetaSchema.safeParse({
        ...validInput,
        order: 1000,
      });
      expect(result.success).toBe(false);
    });

    it('拒绝非整数 order', () => {
      const result = ArticleMetaSchema.safeParse({
        ...validInput,
        order: 1.5,
      });
      expect(result.success).toBe(false);
    });
  });

  describe('difficulty 枚举', () => {
    it('接受 beginner / intermediate / advanced', () => {
      for (const d of ['beginner', 'intermediate', 'advanced'] as const) {
        const result = ArticleMetaSchema.safeParse({
          ...validInput,
          difficulty: d,
        });
        expect(result.success).toBe(true);
      }
    });

    it('拒绝 expert', () => {
      const result = ArticleMetaSchema.safeParse({
        ...validInput,
        difficulty: 'expert',
      });
      expect(result.success).toBe(false);
    });
  });

  describe('estimatedReadingTime 边界', () => {
    it('拒绝 0', () => {
      const result = ArticleMetaSchema.safeParse({
        ...validInput,
        estimatedReadingTime: 0,
      });
      expect(result.success).toBe(false);
    });

    it('接受 1 和 300', () => {
      for (const t of [1, 300]) {
        const result = ArticleMetaSchema.safeParse({
          ...validInput,
          estimatedReadingTime: t,
        });
        expect(result.success).toBe(true);
      }
    });

    it('拒绝 301', () => {
      const result = ArticleMetaSchema.safeParse({
        ...validInput,
        estimatedReadingTime: 301,
      });
      expect(result.success).toBe(false);
    });
  });

  describe('status 枚举', () => {
    it('接受 published / planned', () => {
      for (const s of ['published', 'planned'] as const) {
        const result = ArticleMetaSchema.safeParse({
          ...validInput,
          status: s,
        });
        expect(result.success).toBe(true);
      }
    });

    it('拒绝 draft', () => {
      const result = ArticleMetaSchema.safeParse({
        ...validInput,
        status: 'draft',
      });
      expect(result.success).toBe(false);
    });
  });

  describe('lastUpdated 日期格式', () => {
    it('接受 YYYY-MM-DD 格式', () => {
      const result = ArticleMetaSchema.safeParse({
        ...validInput,
        lastUpdated: '2026-07-01',
      });
      expect(result.success).toBe(true);
    });

    it('拒绝 YYYY/M/D 格式', () => {
      const result = ArticleMetaSchema.safeParse({
        ...validInput,
        lastUpdated: '2026/7/1',
      });
      expect(result.success).toBe(false);
    });

    it('拒绝缺少前导零的 YYYY-M-D', () => {
      const result = ArticleMetaSchema.safeParse({
        ...validInput,
        lastUpdated: '2026-7-1',
      });
      expect(result.success).toBe(false);
    });

    it('拒绝非日期字符串', () => {
      const result = ArticleMetaSchema.safeParse({
        ...validInput,
        lastUpdated: 'not-a-date',
      });
      expect(result.success).toBe(false);
    });
  });

  describe('prerequisites 元素格式', () => {
    it('接受符合 slug 正则的 prerequisites', () => {
      const result = ArticleMetaSchema.safeParse({
        ...validInput,
        prerequisites: ['agent-overview', 'core-loop'],
      });
      expect(result.success).toBe(true);
    });

    it('拒绝包含大写字母的 prerequisite', () => {
      const result = ArticleMetaSchema.safeParse({
        ...validInput,
        prerequisites: ['Bad-Slug'],
      });
      expect(result.success).toBe(false);
    });
  });

  describe('tags 元素边界', () => {
    it('接受长度恰好 32 的 tag', () => {
      const tag = 't'.repeat(32);
      const result = ArticleMetaSchema.safeParse({
        ...validInput,
        tags: [tag],
      });
      expect(result.success).toBe(true);
    });

    it('拒绝长度 33 的 tag', () => {
      const tag = 't'.repeat(33);
      const result = ArticleMetaSchema.safeParse({
        ...validInput,
        tags: [tag],
      });
      expect(result.success).toBe(false);
    });

    it('拒绝空字符串 tag', () => {
      const result = ArticleMetaSchema.safeParse({
        ...validInput,
        tags: [''],
      });
      expect(result.success).toBe(false);
    });
  });
});

describe('TRACKS 注册表', () => {
  it('包含两项', () => {
    expect(TRACKS).toHaveLength(2);
  });

  it('ids 唯一', () => {
    const ids = TRACKS.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('orders 唯一', () => {
    const orders = TRACKS.map((t) => t.order);
    expect(new Set(orders).size).toBe(orders.length);
  });

  it('包含 agent-practice (order 1)', () => {
    const t = TRACKS.find((x) => x.id === 'agent-practice');
    expect(t).toBeDefined();
    expect(t?.title).toBe('Agent 体系实践');
    expect(t?.order).toBe(1);
    expect(t?.description).toBe(
      '围绕 aptbot 项目展开，从 agent 原理到实现到演进路线',
    );
  });

  it('包含 ai-coding-practice (order 2)', () => {
    const t = TRACKS.find((x) => x.id === 'ai-coding-practice');
    expect(t).toBeDefined();
    expect(t?.title).toBe('AI 辅助编码实践');
    expect(t?.order).toBe(2);
    expect(t?.description).toBe(
      'AI 辅助开发的通用经验总结与学习方法论，与具体项目无关',
    );
  });

  it('每项满足 TrackMeta 结构', () => {
    for (const t of TRACKS) {
      const _: TrackMeta = t;
      void _;
      expect(typeof t.id).toBe('string');
      expect(typeof t.title).toBe('string');
      expect(typeof t.description).toBe('string');
      expect(typeof t.order).toBe('number');
    }
  });
});

// 接口结构静态检查：通过类型注解确保接口形状符合设计
describe('接口结构（类型层面）', () => {
  it('Article 包含 meta / renderedHtml / markdownBody', () => {
    const article: Article = {
      meta: { ...validInput } as ArticleMeta,
      renderedHtml: '<p>html</p>',
      markdownBody: '# body',
    };
    expect(article.meta).toBeDefined();
    expect(article.renderedHtml).toBe('<p>html</p>');
    expect(article.markdownBody).toBe('# body');
  });

  it('Article.renderedHtml 允许 null（planned 状态）', () => {
    const article: Article = {
      meta: { ...validInput, status: 'planned' } as ArticleMeta,
      renderedHtml: null,
      markdownBody: '',
    };
    expect(article.renderedHtml).toBeNull();
  });

  it('ArticleState 包含 articles / tracks / bySlug / byTrack', () => {
    const bySlug = new Map<string, Article>();
    const byTrack = new Map<string, readonly Article[]>();
    const state: ArticleState = {
      articles: [],
      tracks: [...TRACKS],
      bySlug,
      byTrack,
    };
    expect(state.articles).toEqual([]);
    expect(state.tracks).toHaveLength(2);
    expect(state.bySlug).toBe(bySlug);
    expect(state.byTrack).toBe(byTrack);
  });

  it('ArticleNav 包含 prev / next，允许 null', () => {
    const nav: ArticleNav = { prev: null, next: null };
    expect(nav.prev).toBeNull();
    expect(nav.next).toBeNull();
  });
});
