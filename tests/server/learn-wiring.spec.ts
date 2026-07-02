import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ArticleLoader } from '../../src/learn/article-loader.js';
import { FeedbackStorage } from '../../src/infrastructure/feedback-storage.js';
import type { AptbotConfig } from '../../src/infrastructure/config-types.js';
// resolveLearnWiring 将在 src/server.ts 中导出（TDD RED：当前未实现）
import { resolveLearnWiring } from '../../src/server.js';
import { createCommandRegistry } from '../../src/shared/commands/registry.js';
import type { StorageAdapter } from '../../src/infrastructure/storage/file-storage.js';

/**
 * Task 11 (0.2.3): server.ts 装配测试
 *
 * 验证 config → WebSocketServerOptions 装配逻辑：
 * - learnEnabled = config.landingPage === true && config.learnPage === true
 * - feedbackEnabled = config.feedbackEnabled !== false（默认 true）
 * - ArticleLoader 实例化条件：learnEnabled || feedbackEnabled
 *   （feedback 校验 category=article 的 articleSlug 依赖 ArticleLoader）
 * - FeedbackStorage 实例化条件：feedbackEnabled
 * - ArticleLoader 实例化后调用 load() 预加载
 *
 * 通过导出的 resolveLearnWiring 纯函数测试装配决策，避免启动完整 server。
 */

function makeConfig(overrides: Partial<AptbotConfig> = {}): AptbotConfig {
  return {
    providers: [
      {
        id: 'anthropic',
        name: 'Anthropic',
        auth: { envVar: 'ANTHROPIC_API_KEY' },
        models: [
          {
            id: 'claude-3-5-sonnet-20241022',
            api: 'anthropic-messages',
            contextWindow: 200000,
            maxTokens: 8192,
          },
        ],
      },
    ],
    defaultModel: 'claude-3-5-sonnet-20241022',
    dataDir: './data',
    deploy: 'local',
    ...overrides,
  } as AptbotConfig;
}

describe('Task 11: server.ts learn wiring (resolveLearnWiring)', () => {
  let tempDir: string;
  let loadSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'aptbot-wiring-'));
    // 监视 ArticleLoader.prototype.load 以验证预加载调用
    loadSpy = vi.spyOn(ArticleLoader.prototype, 'load');
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
    loadSpy.mockRestore();
  });

  describe('learnEnabled = landingPage === true && learnPage === true', () => {
    it('landingPage=true && learnPage=true → learnEnabled=true，创建 ArticleLoader 并调用 load()，创建 FeedbackStorage', async () => {
      const config = makeConfig({
        landingPage: true,
        learnPage: true,
        // feedbackEnabled 缺省视为 true
        dataDir: tempDir,
      });
      const articlesDir = join(tempDir, 'articles');

      const result = await resolveLearnWiring({ aptbotConfig: config, articlesDir });

      expect(result.learnEnabled).toBe(true);
      expect(result.feedbackEnabled).toBe(true);
      expect(result.articleLoader).toBeInstanceOf(ArticleLoader);
      expect(result.feedbackStorage).toBeInstanceOf(FeedbackStorage);
      // ArticleLoader 预加载调用
      expect(loadSpy).toHaveBeenCalledTimes(1);
    });

    it('landingPage 缺省（undefined）→ learnEnabled=false，即使 learnPage=true', async () => {
      const config = makeConfig({ learnPage: true, dataDir: tempDir });
      const result = await resolveLearnWiring({ aptbotConfig: config, articlesDir: join(tempDir, 'articles') });

      expect(result.learnEnabled).toBe(false);
    });

    it('learnPage 缺省（undefined）→ learnEnabled=false，即使 landingPage=true', async () => {
      const config = makeConfig({ landingPage: true, dataDir: tempDir });
      const result = await resolveLearnWiring({ aptbotConfig: config, articlesDir: join(tempDir, 'articles') });

      expect(result.learnEnabled).toBe(false);
    });

    it('landingPage=false → learnEnabled=false', async () => {
      const config = makeConfig({ landingPage: false, learnPage: true, dataDir: tempDir });
      const result = await resolveLearnWiring({ aptbotConfig: config, articlesDir: join(tempDir, 'articles') });

      expect(result.learnEnabled).toBe(false);
    });
  });

  describe('feedbackEnabled = config.feedbackEnabled !== false（默认 true）', () => {
    it('feedbackEnabled 缺省 → 视为 true', async () => {
      const config = makeConfig({ dataDir: tempDir });
      const result = await resolveLearnWiring({ aptbotConfig: config, articlesDir: join(tempDir, 'articles') });

      expect(result.feedbackEnabled).toBe(true);
    });

    it('feedbackEnabled=false → feedbackEnabled=false', async () => {
      const config = makeConfig({ feedbackEnabled: false, dataDir: tempDir });
      const result = await resolveLearnWiring({ aptbotConfig: config, articlesDir: join(tempDir, 'articles') });

      expect(result.feedbackEnabled).toBe(false);
    });

    it('feedbackEnabled=true → feedbackEnabled=true', async () => {
      const config = makeConfig({ feedbackEnabled: true, dataDir: tempDir });
      const result = await resolveLearnWiring({ aptbotConfig: config, articlesDir: join(tempDir, 'articles') });

      expect(result.feedbackEnabled).toBe(true);
    });
  });

  describe('ArticleLoader 实例化条件：learnEnabled || feedbackEnabled', () => {
    it('feedbackEnabled=true 但 learnEnabled=false → 仍创建 ArticleLoader（供 articleSlug 校验）', async () => {
      const config = makeConfig({ dataDir: tempDir }); // landingPage 缺省 → learnEnabled=false
      const result = await resolveLearnWiring({ aptbotConfig: config, articlesDir: join(tempDir, 'articles') });

      expect(result.learnEnabled).toBe(false);
      expect(result.feedbackEnabled).toBe(true);
      expect(result.articleLoader).toBeInstanceOf(ArticleLoader);
      expect(loadSpy).toHaveBeenCalledTimes(1);
      expect(result.feedbackStorage).toBeInstanceOf(FeedbackStorage);
    });

    it('learnEnabled=true 且 feedbackEnabled=false → 创建 ArticleLoader，不创建 FeedbackStorage', async () => {
      const config = makeConfig({
        landingPage: true,
        learnPage: true,
        feedbackEnabled: false,
        dataDir: tempDir,
      });
      const result = await resolveLearnWiring({ aptbotConfig: config, articlesDir: join(tempDir, 'articles') });

      expect(result.learnEnabled).toBe(true);
      expect(result.feedbackEnabled).toBe(false);
      expect(result.articleLoader).toBeInstanceOf(ArticleLoader);
      expect(loadSpy).toHaveBeenCalledTimes(1);
      expect(result.feedbackStorage).toBeUndefined();
    });
  });

  describe('都禁用时（learnEnabled=false && feedbackEnabled=false）', () => {
    it('不创建 ArticleLoader 也不创建 FeedbackStorage，不调用 load()', async () => {
      const config = makeConfig({ feedbackEnabled: false, dataDir: tempDir });
      const result = await resolveLearnWiring({ aptbotConfig: config, articlesDir: join(tempDir, 'articles') });

      expect(result.learnEnabled).toBe(false);
      expect(result.feedbackEnabled).toBe(false);
      expect(result.articleLoader).toBeUndefined();
      expect(result.feedbackStorage).toBeUndefined();
      expect(loadSpy).not.toHaveBeenCalled();
    });
  });

  describe('articlesDir 不存在时 load() 不抛错（降级为空 state）', () => {
    it('articlesDir 指向不存在的目录 → ArticleLoader 仍创建，load() resolve 为空 state', async () => {
      const config = makeConfig({ landingPage: true, learnPage: true, dataDir: tempDir });
      const result = await resolveLearnWiring({
        aptbotConfig: config,
        articlesDir: join(tempDir, 'does-not-exist'),
      });

      expect(result.articleLoader).toBeInstanceOf(ArticleLoader);
      // load() 不抛错，state 为空（articles 数组为空）
      const state = result.articleLoader!.getState();
      expect(state.articles).toEqual([]);
      expect(loadSpy).toHaveBeenCalledTimes(1);
    });
  });
});

/**
 * Task 12 回归测试：server.ts slashHandler.ctx 必须注入 feedbackStorage
 *
 * Bug（0.2.3 whole-branch review）：server.ts 的 slashHandler.ctx 漏掉 feedbackStorage，
 * 导致 Web UI（WS server 上下文）下 /feedback 即使 feedbackEnabled=true 也提示
 * "反馈功能未启用"。CLI（src/cli/index.tsx）正确注入，server.ts 未注入。
 *
 * 此处复现 server.ts 的 ctx 装配契约：feedbackStorage: learnWiring.feedbackStorage，
 * 并实际执行 /feedback 命令验证不会误报"未启用"。
 */
describe('Task 12 回归: slashHandler.ctx 注入 feedbackStorage（server.ts 装配契约）', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'aptbot-slash-feedback-'));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('feedbackEnabled=true → learnWiring.feedbackStorage 注入 ctx 后 /feedback 不提示未启用', async () => {
    const config = makeConfig({ dataDir: tempDir }); // feedbackEnabled 缺省视为 true
    const learnWiring = await resolveLearnWiring({ aptbotConfig: config, articlesDir: join(tempDir, 'articles') });

    // 回归断言：feedbackEnabled=true 时 learnWiring 必须返回 feedbackStorage
    expect(learnWiring.feedbackEnabled).toBe(true);
    expect(learnWiring.feedbackStorage).toBeInstanceOf(FeedbackStorage);

    // 复现 server.ts slashHandler.ctx 装配（src/server.ts:353-365）
    const mockStorage = {} as StorageAdapter;
    const ctx = {
      sessionId: 'test-session',
      model: 'test-model',
      storage: mockStorage,
      dataDir: tempDir,
      feedbackStorage: learnWiring.feedbackStorage, // ← 修复前 server.ts 漏掉此行
    };

    const registry = createCommandRegistry();
    const resolved = registry.resolve('/feedback');
    expect(resolved).not.toBeNull();
    const result = await resolved!.command.execute(resolved!.args, ctx);

    // 关键回归断言：feedbackStorage 已注入 → 不应提示"反馈功能未启用"
    expect(result.output).not.toBe('反馈功能未启用');
    // 空库时应返回 "No open feedback."
    expect(result.output).toBe('No open feedback.');
  });

  it('feedbackEnabled=false → learnWiring.feedbackStorage 为 undefined，/feedback 提示未启用', async () => {
    const config = makeConfig({ feedbackEnabled: false, dataDir: tempDir });
    const learnWiring = await resolveLearnWiring({ aptbotConfig: config, articlesDir: join(tempDir, 'articles') });

    expect(learnWiring.feedbackEnabled).toBe(false);
    expect(learnWiring.feedbackStorage).toBeUndefined();

    // 复现 server.ts slashHandler.ctx 装配：feedbackStorage 为 undefined
    const mockStorage = {} as StorageAdapter;
    const ctx = {
      sessionId: 'test-session',
      model: 'test-model',
      storage: mockStorage,
      dataDir: tempDir,
      feedbackStorage: learnWiring.feedbackStorage,
    };

    const registry = createCommandRegistry();
    const resolved = registry.resolve('/feedback');
    const result = await resolved!.command.execute(resolved!.args, ctx);

    expect(result.output).toBe('反馈功能未启用');
  });
});
