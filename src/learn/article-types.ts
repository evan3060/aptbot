import { z } from 'zod';

// TRACKS 注册表：0.2.3 含两个 track。未来扩展只需在数组追加一项。
export interface TrackMeta {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly order: number;
}

export const TRACKS: readonly TrackMeta[] = [
  {
    id: 'agent-practice',
    title: 'Agent 体系实践',
    description: '围绕 aptbot 项目展开，从 agent 原理到实现到演进路线',
    order: 1,
  },
  {
    id: 'ai-coding-practice',
    title: 'AI 辅助编码实践',
    description: 'AI 辅助开发的通用经验总结与学习方法论，与具体项目无关',
    order: 2,
  },
];

const TRACK_IDS: ReadonlySet<string> = new Set(TRACKS.map((t) => t.id));

const slugRegex = /^[a-z0-9-]+$/;
const dateRegex = /^\d{4}-\d{2}-\d{2}$/;

export const ArticleMetaSchema = z.object({
  slug: z.string().regex(slugRegex).max(64),
  title: z.string().min(1).max(120),
  description: z.string().min(1).max(200),
  track: z
    .string()
    .min(1)
    .max(32)
    .refine((v) => TRACK_IDS.has(v), {
      message: 'track must be one of TRACKS ids',
    }),
  chapter: z.string().min(1).max(32),
  order: z.number().int().min(1).max(999),
  difficulty: z.enum(['beginner', 'intermediate', 'advanced']),
  estimatedReadingTime: z.number().int().min(1).max(300),
  status: z.enum(['published', 'planned']),
  prerequisites: z.array(z.string().regex(slugRegex).max(64)).default([]),
  lastUpdated: z.string().regex(dateRegex),
  tags: z.array(z.string().min(1).max(32)).default([]),
});

export type ArticleMeta = z.infer<typeof ArticleMetaSchema>;

export interface Article {
  readonly meta: ArticleMeta;
  readonly renderedHtml: string | null;
  readonly markdownBody: string;
}

export interface ArticleState {
  readonly articles: readonly Article[];
  readonly tracks: readonly TrackMeta[];
  readonly bySlug: ReadonlyMap<string, Article>;
  readonly byTrack: ReadonlyMap<string, readonly Article[]>;
}

export interface ArticleNav {
  readonly prev: Article | null;
  readonly next: Article | null;
}
