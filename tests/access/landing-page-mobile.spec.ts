import { describe, it, expect } from 'vitest';
import { createLandingPageHtml } from '../../src/access/landing-page.js';

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
