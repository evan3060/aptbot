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

  it('含数据条数字 584 / 4 / 8 / MIT', () => {
    const html = createLandingPageHtml();
    expect(html).toContain('584');
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

  it('含 transition: background-color 300ms ease-in-out（nav 滚动过渡）', () => {
    const html = createLandingPageHtml();
    expect(html).toContain('transition: background-color 300ms ease-in-out');
  });
});
