import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { Mutex } from 'async-mutex';
import matter from 'gray-matter';
import { Marked, type RendererObject } from 'marked';
import {
  ArticleMetaSchema,
  TRACKS,
  type Article,
  type ArticleMeta,
  type ArticleNav,
  type ArticleState,
  type TrackMeta,
} from './article-types.js';

/**
 * §0.2.3 ArticleLoader 使用的 logger 接口。
 * 默认使用 console（warn → console.error）。测试时可注入收集型 logger。
 */
export interface ArticleLoaderLogger {
  warn(msg: string): void;
}

const DEFAULT_LOGGER: ArticleLoaderLogger = {
  warn(msg: string): void {
    console.error(msg);
  },
};

const TRACK_ORDER: ReadonlyMap<string, number> = new Map(
  TRACKS.map((t) => [t.id, t.order]),
);

function trackOrder(trackId: string): number {
  return TRACK_ORDER.get(trackId) ?? Number.MAX_SAFE_INTEGER;
}

function createEmptyState(): ArticleState {
  return {
    articles: [],
    tracks: [...TRACKS] as readonly TrackMeta[],
    bySlug: new Map<string, Article>(),
    byTrack: new Map<string, readonly Article[]>(),
  };
}

/** 转义 HTML 特殊字符（用于 lang 属性与代码内容） */
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

/** slugify: 转小写 → 非字母数字替换为 - → 连续 - 压缩 → 去首尾 - */
function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** 标题 slug 冲突解决器：相同 base slug 追加 -2/-3 后缀 */
class HeadingSlugger {
  private readonly seen = new Map<string, number>();

  slug(text: string): string {
    const base = slugify(text);
    const count = this.seen.get(base) ?? 0;
    this.seen.set(base, count + 1);
    return count === 0 ? base : `${base}-${count + 1}`;
  }
}

/**
 * 渲染 markdown 为 HTML。
 * - gfm: true, breaks: false
 * - h2/h3 获得 id 属性（slugify + 冲突 -2/-3）
 * - pre 获得 data-language 属性（取自代码块 lang token）
 *
 * 每次调用创建独立 Marked 实例 + Slugger，避免全局状态污染与跨文章 slug 冲突。
 */
function renderMarkdown(md: string): string {
  const slugger = new HeadingSlugger();
  const renderer: RendererObject = {
    heading({ tokens, depth, text }) {
      const inner = this.parser.parseInline(tokens);
      if (depth === 2 || depth === 3) {
        const id = slugger.slug(text);
        return `<h${depth} id="${escapeHtml(id)}">${inner}</h${depth}>\n`;
      }
      return `<h${depth}>${inner}</h${depth}>\n`;
    },
    code({ text: codeText, lang, escaped }) {
      const langString = (lang || '').match(/\S+/)?.[0] ?? '';
      const code = codeText.replace(/\n$/, '') + '\n';
      const body = escaped ? code : escapeHtml(code);
      if (!langString) {
        return `<pre><code>${body}</code></pre>\n`;
      }
      const langAttr = escapeHtml(langString);
      return `<pre data-language="${langAttr}"><code class="language-${langAttr}">${body}</code></pre>\n`;
    },
  };
  const marked = new Marked({ gfm: true, breaks: false, renderer });
  return marked.parse(md) as string;
}

interface ParsedArticle {
  meta: ArticleMeta;
  body: string;
  filename: string;
}

/**
 * §0.2.3 ArticleLoader：扫描 articlesDir 下 *.md，解析 frontmatter → 校验 → 渲染 → 缓存 ArticleState。
 *
 * 设计要点：
 * - 热重载：每次 getState/getBySlug/getArticleNav 调用时 statSync 比较 mtimeNs（目录 + 每个文件），
 *   变化则触发 sync 重载。load() 通过 per-loader mutex 串行化并发请求。
 * - 错误处理：warning + 跳过，不阻塞启动（gray-matter 失败 / zod 失败 / slug 重复 / prerequisites 失效 /
 *   track 未注册 / order 全局重复 / published 正文过短）。目录不存在或无 .md 文件返回空 ArticleState。
 * - marked 渲染：published 文章渲染 HTML 并缓存；planned 文章 renderedHtml 为 null。
 */
export class ArticleLoader {
  private readonly articlesDir: string;
  private readonly logger: ArticleLoaderLogger;
  private readonly mutex = new Mutex();
  private state: ArticleState = createEmptyState();
  private knownFiles: readonly string[] = [];
  private mtimeSnapshot: readonly bigint[] = [];
  private initialized = false;

  constructor(articlesDir: string, logger: ArticleLoaderLogger = DEFAULT_LOGGER) {
    this.articlesDir = articlesDir;
    this.logger = logger;
  }

  /**
   * 显式加载/重载文章。per-loader mutex 串行化并发调用；
   * 首次调用或 mtimeNs 变化时执行实际重载，否则跳过。
   */
  async load(): Promise<void> {
    const release = await this.mutex.acquire();
    try {
      if (this.initialized && !this.mtimeChanged()) return;
      this.reloadSync();
      this.initialized = true;
    } finally {
      release();
    }
  }

  /**
   * 返回当前缓存快照。已 load 且 mtimeNs 变化时同步触发重载。
   * 未 load 时返回空 ArticleState（不主动触发重载）。
   */
  getState(): ArticleState {
    if (this.initialized && this.mtimeChanged()) {
      this.reloadSync();
    }
    return this.state;
  }

  /** 从 bySlug Map 查找单篇文章 */
  getBySlug(slug: string): Article | null {
    return this.getState().bySlug.get(slug) ?? null;
  }

  /**
   * 返回同 track 内上一篇/下一篇（按 order 排序，跨 chapter 边界）。
   * slug 不存在时返回 { prev: null, next: null }。
   */
  getArticleNav(slug: string): ArticleNav {
    const state = this.getState();
    const article = state.bySlug.get(slug);
    if (!article) return { prev: null, next: null };
    const trackArticles = state.byTrack.get(article.meta.track) ?? [];
    const idx = trackArticles.findIndex((a) => a.meta.slug === slug);
    if (idx < 0) return { prev: null, next: null };
    const prev = idx > 0 ? trackArticles[idx - 1] : null;
    const next = idx < trackArticles.length - 1 ? trackArticles[idx + 1] : null;
    return { prev, next };
  }

  /**
   * 比较 dir + 每个已知文件的 mtimeNs 快照。
   * 长度或任一元素不同 → true（需重载）。
   */
  private mtimeChanged(): boolean {
    const current = this.captureMtime();
    if (current.length !== this.mtimeSnapshot.length) return true;
    for (let i = 0; i < current.length; i++) {
      if (current[i] !== this.mtimeSnapshot[i]) return true;
    }
    return false;
  }

  /**
   * stat 目录 + 每个已知文件 → mtimeNs 数组。
   * 目录不存在返回 []；任一已知文件 stat 失败返回 []（强制重载）。
   */
  private captureMtime(): bigint[] {
    let dirMtimeNs: bigint;
    try {
      dirMtimeNs = statSync(this.articlesDir, { bigint: true }).mtimeNs;
    } catch {
      return [];
    }
    const result: bigint[] = [dirMtimeNs];
    for (const filename of this.knownFiles) {
      try {
        result.push(statSync(join(this.articlesDir, filename), { bigint: true }).mtimeNs);
      } catch {
        return [];
      }
    }
    return result;
  }

  /**
   * 同步全量重载：扫描 → 解析 → 校验 → 渲染 → 排序分组 → 缓存。
   * 所有错误均 warning + 跳过，不抛出。
   */
  private reloadSync(): void {
    // 1. stat 目录
    let dirMtimeNs: bigint;
    try {
      dirMtimeNs = statSync(this.articlesDir, { bigint: true }).mtimeNs;
    } catch {
      this.logger.warn(`[article-loader] articles directory not found: ${this.articlesDir}`);
      this.applyEmptyState([]);
      return;
    }

    // 2. 列出 .md 文件（按文件名排序）
    let filenames: string[];
    try {
      filenames = readdirSync(this.articlesDir)
        .filter((f) => f.endsWith('.md'))
        .sort();
    } catch {
      this.logger.warn(`[article-loader] failed to read articles directory: ${this.articlesDir}`);
      this.applyEmptyState([]);
      return;
    }

    if (filenames.length === 0) {
      this.logger.warn(`[article-loader] no .md files found in: ${this.articlesDir}`);
      this.applyEmptyState([dirMtimeNs]);
      return;
    }

    // 3. 逐文件 stat + read + gray-matter + zod
    const mtimeNsList: bigint[] = [dirMtimeNs];
    const knownFiles: string[] = [];
    const parsed: ParsedArticle[] = [];

    for (const filename of filenames) {
      const filePath = join(this.articlesDir, filename);
      let fileMtimeNs: bigint;
      let content: string;
      try {
        fileMtimeNs = statSync(filePath, { bigint: true }).mtimeNs;
        content = readFileSync(filePath, 'utf-8');
      } catch (e) {
        this.logger.warn(`[article-loader] failed to read ${filename}: ${(e as Error).message}`);
        continue;
      }

      // gray-matter 解析（YAML 非法会抛错）
      let matterResult;
      try {
        matterResult = matter(content);
      } catch (e) {
        this.logger.warn(
          `[article-loader] failed to parse frontmatter in ${filename}: ${(e as Error).message}`,
        );
        knownFiles.push(filename);
        mtimeNsList.push(fileMtimeNs);
        continue;
      }

      // zod 校验
      const zodResult = ArticleMetaSchema.safeParse(matterResult.data);
      if (!zodResult.success) {
        const details = zodResult.error.issues
          .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
          .join('; ');
        this.logger.warn(
          `[article-loader] schema validation failed for ${filename}: ${details}`,
        );
        knownFiles.push(filename);
        mtimeNsList.push(fileMtimeNs);
        continue;
      }

      knownFiles.push(filename);
      mtimeNsList.push(fileMtimeNs);
      parsed.push({ meta: zodResult.data, body: matterResult.content, filename });
    }

    // 4. slug 去重（保留 order 较小者；order 相同保留先扫描者）
    const bySlugTemp = new Map<string, ParsedArticle>();
    for (const item of parsed) {
      const existing = bySlugTemp.get(item.meta.slug);
      if (!existing) {
        bySlugTemp.set(item.meta.slug, item);
        continue;
      }
      const keepNew = item.meta.order < existing.meta.order;
      const kept = keepNew ? item : existing;
      const skipped = keepNew ? existing : item;
      bySlugTemp.set(item.meta.slug, kept);
      this.logger.warn(
        `[article-loader] duplicate slug "${item.meta.slug}" in ${skipped.filename}; keeping ${kept.filename} (order ${kept.meta.order})`,
      );
    }

    // 5. prerequisites 引用校验（清空不存在的引用）
    const slugSet = new Set(bySlugTemp.keys());
    for (const item of bySlugTemp.values()) {
      const invalid = item.meta.prerequisites.filter((p) => !slugSet.has(p));
      if (invalid.length > 0) {
        for (const p of invalid) {
          this.logger.warn(
            `[article-loader] prerequisite "${p}" referenced by ${item.filename} does not exist; clearing field`,
          );
        }
        item.meta.prerequisites = item.meta.prerequisites.filter((p) => slugSet.has(p));
      }
    }

    // 6. order 全局重复检测
    const orderGroups = new Map<number, string[]>();
    for (const item of bySlugTemp.values()) {
      const arr = orderGroups.get(item.meta.order) ?? [];
      arr.push(item.filename);
      orderGroups.set(item.meta.order, arr);
    }
    for (const [order, files] of orderGroups) {
      if (files.length > 1) {
        this.logger.warn(
          `[article-loader] duplicate order ${order} across files: ${files.join(', ')}; using filename fallback sort`,
        );
      }
    }

    // 7. 排序：trackOrder → articleOrder → filename
    const sortedItems = [...bySlugTemp.values()].sort((a, b) => {
      const trackDiff = trackOrder(a.meta.track) - trackOrder(b.meta.track);
      if (trackDiff !== 0) return trackDiff;
      const orderDiff = a.meta.order - b.meta.order;
      if (orderDiff !== 0) return orderDiff;
      return a.filename.localeCompare(b.filename);
    });

    // 8. 构建 Article 对象（published 渲染 HTML；planned → null）
    const articles: Article[] = [];
    for (const item of sortedItems) {
      let renderedHtml: string | null = null;
      if (item.meta.status === 'published') {
        if (item.body.trim().length < 100) {
          this.logger.warn(
            `[article-loader] published article ${item.filename} has short body (<100 chars); loaded anyway`,
          );
        }
        try {
          renderedHtml = renderMarkdown(item.body);
        } catch (e) {
          this.logger.warn(
            `[article-loader] failed to render ${item.filename}: ${(e as Error).message}`,
          );
        }
      }
      articles.push({
        meta: item.meta,
        renderedHtml,
        markdownBody: item.body,
      });
    }

    // 9. 构建 bySlug / byTrack
    const bySlug = new Map<string, Article>();
    const byTrack = new Map<string, Article[]>();
    for (const article of articles) {
      bySlug.set(article.meta.slug, article);
      const arr = byTrack.get(article.meta.track) ?? [];
      arr.push(article);
      byTrack.set(article.meta.track, arr);
    }

    // 10. 缓存 state + mtimeNs 快照
    this.state = {
      articles,
      tracks: [...TRACKS] as readonly TrackMeta[],
      bySlug,
      byTrack,
    };
    this.knownFiles = knownFiles;
    this.mtimeSnapshot = mtimeNsList;
  }

  private applyEmptyState(mtimeSnapshot: bigint[]): void {
    this.state = createEmptyState();
    this.knownFiles = [];
    this.mtimeSnapshot = mtimeSnapshot;
  }
}
