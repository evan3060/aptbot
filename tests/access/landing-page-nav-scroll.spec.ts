import { describe, it, expect } from 'vitest';
import { createLandingPageHtml } from '../../src/access/landing-page.js';

/**
 * nav 滚动文字叠加问题修复验收。
 *
 * 痛点（实测）：
 *   - nav 是 fixed 设计，滚动时固定不动 ✓
 *   - 但 #nav 默认 background-color: rgba(0,0,0,0) 透明
 *   - #nav.scrolled 的 background-color: var(--surface-translucent) 实测未生效
 *   - IntersectionObserver 在移动端触发时机太晚
 *   - 结果：滚动时下层 hero/section 文字透出，与 nav 文字叠加
 *
 * 修复策略：
 *   1. nav 始终有半透明白色背景（不依赖 .scrolled）
 *   2. nav 始终有 backdrop-filter: blur() 强化遮挡
 *   3. .scrolled 只调整 border-bottom 或轻微加深，不再是"是否遮挡"的开关
 */
describe('landing-page nav 滚动文字叠加修复', () => {
  describe('nav 始终有遮挡背景（不依赖 .scrolled）', () => {
    it('#nav 默认状态含 background-color（非透明）', () => {
      const html = createLandingPageHtml();
      const navBlock = html.match(/#nav\s*\{([^}]*?)\}/);
      expect(navBlock, '#nav rule should exist').not.toBeNull();
      // 不应再含 background-color: rgba(0, 0, 0, 0) 或 transparent
      expect(navBlock![1]).not.toMatch(/background-color:\s*(?:rgba\(0,\s*0,\s*0,\s*0\)|transparent)/);
      // 应当有非透明背景
      expect(navBlock![1]).toMatch(/background-color:\s*rgba\(255,\s*255,\s*255,\s*0\.\d+\)/);
    });

    it('#nav 默认状态含 backdrop-filter: blur', () => {
      const html = createLandingPageHtml();
      const navBlock = html.match(/#nav\s*\{([^}]*?)\}/);
      expect(navBlock, '#nav rule should exist').not.toBeNull();
      expect(navBlock![1]).toMatch(/backdrop-filter:\s*blur/);
    });
  });

  describe('.scrolled 不再是遮挡开关', () => {
    it('.scrolled 不再含 background-color（避免覆盖默认背景）或仅微调', () => {
      const html = createLandingPageHtml();
      const scrolledBlock = html.match(/#nav\.scrolled\s*\{([^}]*?)\}/);
      expect(scrolledBlock, '#nav.scrolled rule should exist').not.toBeNull();
      // .scrolled 应当只调整 border-bottom 或阴影，不再用 background-color 切换
      // 如果含 background-color，必须也是非透明白色
      if (/background-color:/.test(scrolledBlock![1])) {
        expect(scrolledBlock![1]).toMatch(/background-color:\s*rgba\(255,\s*255,\s*255,\s*0\.\d+\)/);
        expect(scrolledBlock![1]).not.toMatch(/background-color:\s*(?:rgba\(0,\s*0,\s*0,\s*0\)|transparent)/);
      }
    });

    it('.scrolled 含 border-bottom 强化视觉分层', () => {
      const html = createLandingPageHtml();
      const scrolledBlock = html.match(/#nav\.scrolled\s*\{([^}]*?)\}/);
      expect(scrolledBlock, '#nav.scrolled rule should exist').not.toBeNull();
      expect(scrolledBlock![1]).toMatch(/border-bottom/);
    });
  });

  describe('移动端 nav 遮挡', () => {
    it('移动端媒体查询块内 nav 不移除背景（继承默认非透明）', () => {
      const html = createLandingPageHtml();
      const mobileBlock = html.match(/@media\s*\(max-width:\s*767px\)\s*\{([\s\S]*?)\}\s*(?:@media|<\/style>)/);
      expect(mobileBlock, 'mobile block should exist').not.toBeNull();
      const navRuleInMobile = mobileBlock![1].match(/#nav\s*\{([^}]*?)\}/);
      if (navRuleInMobile) {
        // 若移动端覆盖了 #nav，不应将背景设为透明
        expect(navRuleInMobile[1]).not.toMatch(/background-color:\s*(?:rgba\(0,\s*0,\s*0,\s*0\)|transparent)/);
      }
      // 不在移动端重置背景即默认继承非透明背景
    });
  });
});
