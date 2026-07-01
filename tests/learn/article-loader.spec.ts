import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, utimesSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ArticleLoader, type ArticleLoaderLogger } from '../../src/learn/article-loader.js';

const FIXTURES_DIR = join(__dirname, 'fixtures');

/** 测试用 logger：收集 warning 到数组，便于断言 */
function createTestLogger(): { logger: ArticleLoaderLogger; warnings: string[] } {
  const warnings: string[] = [];
  const logger: ArticleLoaderLogger = {
    warn(msg: string) {
      warnings.push(msg);
    },
  };
  return { logger, warnings };
}

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'aptbot-article-loader-'));
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

/** 复制指定 fixture 到 tmpDir */
function copyFixture(fixtureName: string, destName: string = fixtureName): void {
  copyFileSync(join(FIXTURES_DIR, fixtureName), join(tmpDir, destName));
}

/** 直接写一个 markdown 文件到 tmpDir */
function writeMd(filename: string, frontmatterYaml: string, body: string): void {
  const content = `---\n${frontmatterYaml}\n---\n${body}`;
  writeFileSync(join(tmpDir, filename), content, 'utf-8');
}

const LONG_BODY = `
# 正文标题

这是第一段正文，需要超过 100 字符以满足 published 文章的最低长度要求。
这里继续补充内容，确保字符数达标，避免触发短正文警告。再加一些内容确保长度足够。
`;

const VALID_FM = (overrides: Record<string, string> = {}): string => {
  const base: Record<string, string> = {
    slug: 'agent-overview',
    title: 'Agent 总览',
    description: '介绍 agent 的整体架构。',
    track: 'agent-practice',
    chapter: '核心',
    order: '1',
    difficulty: 'beginner',
    estimatedReadingTime: '5',
    status: 'published',
    prerequisites: '[]',
    lastUpdated: '"2026-07-01"',
    tags: '[]',
  };
  return Object.entries({ ...base, ...overrides })
    .map(([k, v]) => `${k}: ${v}`)
    .join('\n');
};

describe('ArticleLoader', () => {
  describe('1. 扫描全部 .md 文件（按文件名排序）', () => {
    it('加载目录下所有 .md 文件，按文件名顺序扫描', async () => {
      // 写三个文件，文件名顺序与 order 不一致，验证扫描顺序（用于后续去重兜底）
      writeMd('03-c.md', VALID_FM({ slug: 'slug-c', order: '3' }), LONG_BODY);
      writeMd('01-a.md', VALID_FM({ slug: 'slug-a', order: '1' }), LONG_BODY);
      writeMd('02-b.md', VALID_FM({ slug: 'slug-b', order: '2' }), LONG_BODY);

      const { logger } = createTestLogger();
      const loader = new ArticleLoader(tmpDir, logger);
      await loader.load();

      const state = loader.getState();
      expect(state.articles).toHaveLength(3);
      // articles 按 (trackOrder, articleOrder) 排序，最终应为 a, b, c
      const slugs = state.articles.map((a) => a.meta.slug);
      expect(slugs).toEqual(['slug-a', 'slug-b', 'slug-c']);
    });

    it('忽略非 .md 文件', async () => {
      writeFileSync(join(tmpDir, 'README.txt'), 'not markdown', 'utf-8');
      writeFileSync(join(tmpDir, 'notes.json'), '{}', 'utf-8');
      writeMd('01-a.md', VALID_FM({ slug: 'slug-a' }), LONG_BODY);

      const { logger } = createTestLogger();
      const loader = new ArticleLoader(tmpDir, logger);
      await loader.load();

      expect(loader.getState().articles).toHaveLength(1);
    });
  });

  describe('2. frontmatter 合法与非法处理', () => {
    it('合法 frontmatter 正确解析为 ArticleMeta', async () => {
      writeMd('01-a.md', VALID_FM({ slug: 'legal-slug', title: '合法标题' }), LONG_BODY);

      const { logger } = createTestLogger();
      const loader = new ArticleLoader(tmpDir, logger);
      await loader.load();

      const article = loader.getBySlug('legal-slug');
      expect(article).not.toBeNull();
      expect(article?.meta.title).toBe('合法标题');
      expect(article?.meta.track).toBe('agent-practice');
    });

    it('非法 YAML frontmatter → warning + 跳过该文件', async () => {
      // 写入一个 YAML 解析会失败的文件（未闭合的 flow mapping）
      writeFileSync(
        join(tmpDir, 'bad-yaml.md'),
        '---\ntitle: Bad\nslug: bad-slug\ntags: [a, b\n---\nbody\n',
        'utf-8',
      );
      writeMd('01-good.md', VALID_FM({ slug: 'good-slug' }), LONG_BODY);

      const { logger, warnings } = createTestLogger();
      const loader = new ArticleLoader(tmpDir, logger);
      await loader.load();

      expect(loader.getState().articles).toHaveLength(1);
      expect(loader.getBySlug('good-slug')).not.toBeNull();
      expect(loader.getBySlug('bad-slug')).toBeNull();
      expect(warnings.some((w) => w.includes('bad-yaml.md'))).toBe(true);
    });

    it('zod 校验失败 → warning（含 zod 错误详情）+ 跳过', async () => {
      // order 不是整数
      writeMd('bad-schema.md', VALID_FM({ order: 'not-a-number' }), LONG_BODY);
      writeMd('01-good.md', VALID_FM({ slug: 'good-slug' }), LONG_BODY);

      const { logger, warnings } = createTestLogger();
      const loader = new ArticleLoader(tmpDir, logger);
      await loader.load();

      expect(loader.getState().articles).toHaveLength(1);
      expect(warnings.some((w) => w.includes('bad-schema.md'))).toBe(true);
    });
  });

  describe('3. published 文章调用 marked 渲染并缓存 renderedHtml', () => {
    it('published 文章的 renderedHtml 非 null，包含渲染后的 HTML', async () => {
      copyFixture('published-with-headings.md', '01-published.md');

      const { logger } = createTestLogger();
      const loader = new ArticleLoader(tmpDir, logger);
      await loader.load();

      const article = loader.getBySlug('published-with-headings');
      expect(article).not.toBeNull();
      expect(article?.renderedHtml).not.toBeNull();
      expect(typeof article?.renderedHtml).toBe('string');
      // h2 获得 id 属性
      expect(article?.renderedHtml).toContain('<h2 id="hello-world">');
      // h3 获得 id 属性
      expect(article?.renderedHtml).toContain('<h3 id="sub-section-title">');
      // pre 获得 data-language 属性（typescript 代码块）
      expect(article?.renderedHtml).toContain('<pre data-language="typescript">');
      expect(article?.renderedHtml).toContain('<pre data-language="bash">');
      // markdownBody 保留原始 markdown
      expect(article?.markdownBody).toContain('## Hello World');
    });

    it('同标题冲突时追加 -2 / -3 后缀', async () => {
      const body = `${LONG_BODY}\n## Same Title\n\n## Same Title\n\n## Same Title\n`;
      writeMd('01-conflict.md', VALID_FM({ slug: 'conflict-headings' }), body);

      const { logger } = createTestLogger();
      const loader = new ArticleLoader(tmpDir, logger);
      await loader.load();

      const article = loader.getBySlug('conflict-headings');
      expect(article?.renderedHtml).toContain('<h2 id="same-title">');
      expect(article?.renderedHtml).toContain('<h2 id="same-title-2">');
      expect(article?.renderedHtml).toContain('<h2 id="same-title-3">');
    });
  });

  describe('4. planned 文章跳过渲染（renderedHtml = null）', () => {
    it('planned 文章的 renderedHtml 为 null', async () => {
      copyFixture('planned-article.md', '01-planned.md');

      const { logger } = createTestLogger();
      const loader = new ArticleLoader(tmpDir, logger);
      await loader.load();

      const article = loader.getBySlug('planned-article');
      expect(article).not.toBeNull();
      expect(article?.renderedHtml).toBeNull();
      // markdownBody 仍保留
      expect(article?.markdownBody.length).toBeGreaterThan(0);
    });
  });

  describe('5. slug 重复 → warning + 保留 order 较小者', () => {
    it('两个文件 slug 相同 → 保留 order 较小者，warning', async () => {
      writeMd('01-smaller.md', VALID_FM({ slug: 'dup-slug', order: '1' }), LONG_BODY);
      writeMd('02-larger.md', VALID_FM({ slug: 'dup-slug', order: '5' }), LONG_BODY);

      const { logger, warnings } = createTestLogger();
      const loader = new ArticleLoader(tmpDir, logger);
      await loader.load();

      expect(loader.getState().articles).toHaveLength(1);
      const article = loader.getBySlug('dup-slug');
      expect(article?.meta.order).toBe(1);
      expect(warnings.some((w) => w.includes('dup-slug'))).toBe(true);
    });
  });

  describe('6. prerequisites 引用不存在 slug → warning + 清空字段', () => {
    it('prerequisites 引用不存在的 slug → 清空 prerequisites 数组 + warning', async () => {
      writeMd(
        '01-with-prereq.md',
        VALID_FM({
          slug: 'article-with-prereq',
          prerequisites: '["non-existent-slug"]',
        }),
        LONG_BODY,
      );

      const { logger, warnings } = createTestLogger();
      const loader = new ArticleLoader(tmpDir, logger);
      await loader.load();

      const article = loader.getBySlug('article-with-prereq');
      expect(article).not.toBeNull();
      expect(article?.meta.prerequisites).toEqual([]);
      expect(warnings.some((w) => w.includes('non-existent-slug'))).toBe(true);
    });

    it('prerequisites 引用已存在的 slug → 保留', async () => {
      writeMd('01-base.md', VALID_FM({ slug: 'base-slug', order: '1' }), LONG_BODY);
      writeMd(
        '02-dep.md',
        VALID_FM({ slug: 'dep-slug', order: '2', prerequisites: '["base-slug"]' }),
        LONG_BODY,
      );

      const { logger } = createTestLogger();
      const loader = new ArticleLoader(tmpDir, logger);
      await loader.load();

      const article = loader.getBySlug('dep-slug');
      expect(article?.meta.prerequisites).toEqual(['base-slug']);
    });
  });

  describe('7. track 不在 TRACKS → warning + 跳过文件', () => {
    it('track 字段为未注册 id → 该文件被跳过 + warning', async () => {
      writeMd('01-bad-track.md', VALID_FM({ track: 'unknown-track' }), LONG_BODY);
      writeMd('02-good.md', VALID_FM({ slug: 'good-slug' }), LONG_BODY);

      const { logger, warnings } = createTestLogger();
      const loader = new ArticleLoader(tmpDir, logger);
      await loader.load();

      expect(loader.getState().articles).toHaveLength(1);
      expect(loader.getBySlug('good-slug')).not.toBeNull();
      expect(warnings.some((w) => w.includes('01-bad-track.md'))).toBe(true);
    });
  });

  describe('8. order 全局重复 → warning + 文件名兜底排序', () => {
    it('两篇文章 order 相同 → warning + 按文件名排序', async () => {
      // 文件名 z-first 排序在前，但 order 相同
      writeMd('a-first.md', VALID_FM({ slug: 'slug-a', order: '5' }), LONG_BODY);
      writeMd('b-second.md', VALID_FM({ slug: 'slug-b', order: '5' }), LONG_BODY);

      const { logger, warnings } = createTestLogger();
      const loader = new ArticleLoader(tmpDir, logger);
      await loader.load();

      // 两篇都加载
      expect(loader.getState().articles).toHaveLength(2);
      // 同 track 内，order 相同时按文件名排序：a-first 在前
      const trackArticles = loader.getState().byTrack.get('agent-practice') ?? [];
      expect(trackArticles.map((a) => a.meta.slug)).toEqual(['slug-a', 'slug-b']);
      expect(warnings.some((w) => w.includes('order'))).toBe(true);
    });
  });

  describe('9. published 但 markdownBody trim < 100 字符 → warning（不阻塞）', () => {
    it('正文过短 → warning 但文章仍被加载', async () => {
      writeMd('01-short.md', VALID_FM({ slug: 'short-body' }), '短正文');

      const { logger, warnings } = createTestLogger();
      const loader = new ArticleLoader(tmpDir, logger);
      await loader.load();

      const article = loader.getBySlug('short-body');
      expect(article).not.toBeNull();
      expect(article?.renderedHtml).not.toBeNull();
      expect(warnings.some((w) => w.includes('short-body') || w.includes('short'))).toBe(true);
    });
  });

  describe('10. 目录不存在 → 返回空 ArticleState + warning', () => {
    it('articlesDir 不存在 → articles 为空 + warning', async () => {
      const { logger, warnings } = createTestLogger();
      const loader = new ArticleLoader(join(tmpDir, 'does-not-exist'), logger);
      await loader.load();

      const state = loader.getState();
      expect(state.articles).toEqual([]);
      expect(state.bySlug.size).toBe(0);
      expect(warnings.length).toBeGreaterThan(0);
    });
  });

  describe('11. 目录无 .md 文件 → 返回空 ArticleState + warning', () => {
    it('空目录 → articles 为空 + warning', async () => {
      writeFileSync(join(tmpDir, 'not-md.txt'), 'hello', 'utf-8');

      const { logger, warnings } = createTestLogger();
      const loader = new ArticleLoader(tmpDir, logger);
      await loader.load();

      const state = loader.getState();
      expect(state.articles).toEqual([]);
      expect(warnings.length).toBeGreaterThan(0);
    });
  });

  describe('12. 热重载：mtimeNs 未变 → 返回缓存状态', () => {
    it('连续 getState 返回同一缓存引用（未重载）', async () => {
      writeMd('01-a.md', VALID_FM({ slug: 'slug-a' }), LONG_BODY);

      const { logger } = createTestLogger();
      const loader = new ArticleLoader(tmpDir, logger);
      await loader.load();

      const s1 = loader.getState();
      const s2 = loader.getState();
      expect(s1).toBe(s2); // 同一引用，未触发重载
    });

    it('连续 load() 不重复扫描（mtimeNs 未变，状态引用不变）', async () => {
      writeMd('01-a.md', VALID_FM({ slug: 'slug-a' }), LONG_BODY);

      const { logger } = createTestLogger();
      const loader = new ArticleLoader(tmpDir, logger);
      await loader.load();

      const s1 = loader.getState();
      await loader.load(); // mtime 未变 → 跳过重载
      const s2 = loader.getState();
      expect(s1).toBe(s2); // 同一引用 = 未触发重载
    });
  });

  describe('13. 热重载：mtimeNs 变化 → 重新扫描', () => {
    it('文件内容修改后 getState 返回新内容', async () => {
      writeMd('01-a.md', VALID_FM({ slug: 'slug-a', title: '原标题' }), LONG_BODY);

      const { logger } = createTestLogger();
      const loader = new ArticleLoader(tmpDir, logger);
      await loader.load();

      expect(loader.getBySlug('slug-a')?.meta.title).toBe('原标题');

      // 修改文件 + 显式推进 mtimeNs（避免某些文件系统 mtime 分辨率过低）
      writeMd('01-a.md', VALID_FM({ slug: 'slug-a', title: '新标题' }), LONG_BODY);
      const future = new Date(Date.now() / 1000 + 60);
      utimesSync(join(tmpDir, '01-a.md'), future, future);

      const state = loader.getState();
      expect(state.articles).toHaveLength(1);
      expect(loader.getBySlug('slug-a')?.meta.title).toBe('新标题');
    });
  });

  describe('14. 并发 reload → mutex 串行化（仅一次重载）', () => {
    it('两个并发 load() 调用仅触发一次重载', async () => {
      // 使用短正文 published 文章：每次实际重载都会发出一条 short body warning。
      // 通过统计 warning 数量验证并发 load 是否只触发一次重载。
      writeMd('01-a.md', VALID_FM({ slug: 'slug-a' }), '短正文');

      const { logger, warnings } = createTestLogger();
      const loader = new ArticleLoader(tmpDir, logger);

      // 首次 load（建立缓存，发出 1 条 short body warning）
      await loader.load();
      expect(warnings.length).toBe(1);

      // 修改文件 + 推进 mtimeNs，然后并发 load
      writeMd('01-a.md', VALID_FM({ slug: 'slug-a', title: '改后' }), '短正文改');
      const future = new Date(Date.now() / 1000 + 120);
      utimesSync(join(tmpDir, '01-a.md'), future, future);

      await Promise.all([loader.load(), loader.load()]);

      // 并发调用只应触发一次实际重载 → 新增 1 条 warning（总计 2）
      expect(warnings.length).toBe(2);
      expect(loader.getBySlug('slug-a')?.meta.title).toBe('改后');
    });
  });

  describe('getArticleNav', () => {
    it('返回同 track 内上一篇/下一篇（按 order 排序）', async () => {
      writeMd('01-a.md', VALID_FM({ slug: 'a', order: '1' }), LONG_BODY);
      writeMd('02-b.md', VALID_FM({ slug: 'b', order: '2' }), LONG_BODY);
      writeMd('03-c.md', VALID_FM({ slug: 'c', order: '3' }), LONG_BODY);

      const { logger } = createTestLogger();
      const loader = new ArticleLoader(tmpDir, logger);
      await loader.load();

      // 中间篇
      const navB = loader.getArticleNav('b');
      expect(navB.prev?.meta.slug).toBe('a');
      expect(navB.next?.meta.slug).toBe('c');

      // 首篇
      const navA = loader.getArticleNav('a');
      expect(navA.prev).toBeNull();
      expect(navA.next?.meta.slug).toBe('b');

      // 末篇
      const navC = loader.getArticleNav('c');
      expect(navC.prev?.meta.slug).toBe('b');
      expect(navC.next).toBeNull();
    });

    it('slug 不存在 → prev/next 均为 null', async () => {
      writeMd('01-a.md', VALID_FM({ slug: 'a' }), LONG_BODY);
      const { logger } = createTestLogger();
      const loader = new ArticleLoader(tmpDir, logger);
      await loader.load();

      const nav = loader.getArticleNav('nonexistent');
      expect(nav.prev).toBeNull();
      expect(nav.next).toBeNull();
    });
  });

  describe('默认 logger', () => {
    it('未传入 logger 时使用 console.error（不抛错）', async () => {
      writeMd('01-a.md', VALID_FM({ slug: 'a' }), LONG_BODY);
      const loader = new ArticleLoader(tmpDir);
      await loader.load();
      expect(loader.getState().articles).toHaveLength(1);
    });
  });

  describe('ArticleState 结构', () => {
    it('tracks 字段包含 TRACKS 全部项', async () => {
      writeMd('01-a.md', VALID_FM({ slug: 'a' }), LONG_BODY);
      const { logger } = createTestLogger();
      const loader = new ArticleLoader(tmpDir, logger);
      await loader.load();

      const state = loader.getState();
      expect(state.tracks.map((t) => t.id)).toEqual(['agent-practice', 'ai-coding-practice']);
    });

    it('byTrack 按文章实际 track 分组', async () => {
      writeMd('01-a.md', VALID_FM({ slug: 'a', track: 'agent-practice' }), LONG_BODY);
      writeMd(
        '02-b.md',
        VALID_FM({ slug: 'b', track: 'ai-coding-practice' }),
        LONG_BODY,
      );

      const { logger } = createTestLogger();
      const loader = new ArticleLoader(tmpDir, logger);
      await loader.load();

      const state = loader.getState();
      expect(state.byTrack.get('agent-practice')?.map((a) => a.meta.slug)).toEqual(['a']);
      expect(state.byTrack.get('ai-coding-practice')?.map((a) => a.meta.slug)).toEqual(['b']);
    });
  });
});
