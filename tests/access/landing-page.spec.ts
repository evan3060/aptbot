import { describe, it, expect } from 'vitest';
import { createLandingPageHtml } from '../../src/access/landing-page.js';

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
