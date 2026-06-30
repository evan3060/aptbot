import { describe, it, expect } from 'vitest';
import { createChatPageHtml } from '../../src/access/chat-page.js';

/**
 * 移动端适配验收：chat-page.ts 在 ≤768px 视口下必须保证主对话区可用且视觉精致。
 *
 * 痛点（修复前 390 视口实测）：
 *   - sidebar 固定 260px → main 仅剩 130px，对话区被严重挤压
 *   - 横向滚动条出现（scrollWidth 537 vs clientWidth 390）
 *   - 视觉粗糙：字符 ☰ hamburger、无阴影、过渡生硬
 *
 * 修复策略（v2 精致化）：
 *   1. sidebar 真正浮动化：box-shadow + cubic-bezier 过渡
 *   2. hamburger 用 SVG 三横线图标（非字符）
 *   3. backdrop 加 backdrop-filter 模糊背景
 *   4. 主体对话区最大化：移除 messages/input-bar 的 max-width: 900px 限制
 *   5. header 紧凑：padding/字号优化
 */
describe('chat-page 移动端适配 (≤768px)', () => {
  describe('媒体查询存在性', () => {
    it('含 max-width: 768px 媒体查询', () => {
      const html = createChatPageHtml('/ws');
      expect(html).toContain('@media (max-width: 768px)');
    });
  });

  describe('sidebar 抽屉化与浮动感', () => {
    it('含 sidebar toggle 按钮（hamburger）', () => {
      const html = createChatPageHtml('/ws');
      expect(html).toMatch(/id="sidebar-toggle"/);
    });

    it('hamburger 按钮使用 SVG 图标（非字符 ☰）', () => {
      const html = createChatPageHtml('/ws');
      const toggleBlock = html.match(/<button[^>]*id="sidebar-toggle"[^>]*>([\s\S]*?)<\/button>/);
      expect(toggleBlock, 'sidebar-toggle button should exist').not.toBeNull();
      expect(toggleBlock![1]).toContain('<svg');
      // 不再使用字符 ☰
      expect(toggleBlock![1]).not.toContain('☰');
    });

    it('含 sidebar backdrop 遮罩元素', () => {
      const html = createChatPageHtml('/ws');
      expect(html).toMatch(/id="sidebar-backdrop"/);
    });

    it('CSS 中定义 sidebar 抽屉位移（默认移出视口）', () => {
      const html = createChatPageHtml('/ws');
      const mediaBlock = html.match(/@media\s*\(max-width:\s*768px\)\s*\{([\s\S]*?)\}\s*(?:@media|<\/style>)/);
      expect(mediaBlock, 'media query block should exist').not.toBeNull();
      expect(mediaBlock![1]).toMatch(/#sidebar\s*\{[^}]*?(transform:\s*translateX|left:\s*-|position:\s*fixed)/);
    });

    it('CSS 中定义 sidebar.open 状态进入视口', () => {
      const html = createChatPageHtml('/ws');
      const mediaBlock = html.match(/@media\s*\(max-width:\s*768px\)\s*\{([\s\S]*?)\}\s*(?:@media|<\/style>)/);
      expect(mediaBlock, 'media query block should exist').not.toBeNull();
      expect(mediaBlock![1]).toMatch(/#sidebar\.open\s*\{[^}]*?(transform:\s*translateX\(0|left:\s*0)/);
    });

    it('媒体查询块内 sidebar 含 box-shadow 强化浮动感', () => {
      const html = createChatPageHtml('/ws');
      const mediaBlock = html.match(/@media\s*\(max-width:\s*768px\)\s*\{([\s\S]*?)\}\s*(?:@media|<\/style>)/);
      expect(mediaBlock, 'media query block should exist').not.toBeNull();
      expect(mediaBlock![1]).toMatch(/#sidebar\s*\{[^}]*box-shadow/);
    });

    it('sidebar 过渡动画使用 cubic-bezier（更顺滑）', () => {
      const html = createChatPageHtml('/ws');
      const mediaBlock = html.match(/@media\s*\(max-width:\s*768px\)\s*\{([\s\S]*?)\}\s*(?:@media|<\/style>)/);
      expect(mediaBlock, 'media query block should exist').not.toBeNull();
      expect(mediaBlock![1]).toMatch(/#sidebar\s*\{[^}]*transition:[^}]*cubic-bezier/);
    });

    it('backdrop 含 backdrop-filter 模糊背景', () => {
      const html = createChatPageHtml('/ws');
      expect(html).toMatch(/backdrop-filter:\s*blur/);
    });
  });

  describe('toggle 交互 JS', () => {
    it('JS 含 toggle 逻辑绑定到 sidebar-toggle 按钮', () => {
      const html = createChatPageHtml('/ws');
      expect(html).toMatch(/sidebar-toggle/);
      expect(html).toMatch(/addEventListener\(['"]click['"]/);
      expect(html).toMatch(/classList\.toggle\(['"]open['"]\)|classList\.add\(['"]open['"]\)/);
    });

    it('JS 含 backdrop 关闭 sidebar 逻辑', () => {
      const html = createChatPageHtml('/ws');
      expect(html).toMatch(/sidebar-backdrop/);
    });

    it('JS 含 session 项点击后自动收起 sidebar（移动端切换后缩回）', () => {
      const html = createChatPageHtml('/ws');
      expect(html).toMatch(/sessionListEl[\s\S]*addEventListener\(['"]click['"]/);
      expect(html).toMatch(/matchMedia\(['"]\(max-width:\s*768px\)['"]\)/);
      expect(html).toMatch(/closeSidebar\(\)/);
    });
  });

  describe('主对话区最大化', () => {
    it('媒体查询块内 main 占满视口', () => {
      const html = createChatPageHtml('/ws');
      const mediaBlock = html.match(/@media\s*\(max-width:\s*768px\)\s*\{([\s\S]*?)\}\s*(?:@media|<\/style>)/);
      expect(mediaBlock, 'media query block should exist').not.toBeNull();
      const block = mediaBlock![1];
      expect(block).toContain('#main');
      // main 应当占满（width: 100% 或无显式宽度，由 flex 控制）
      expect(block).toMatch(/#main\s*\{[^}]*width:\s*100%/);
    });

    it('媒体查询块内 messages 含 max-width: 100%（移除 900px 桌面限制）', () => {
      const html = createChatPageHtml('/ws');
      const mediaBlock = html.match(/@media\s*\(max-width:\s*768px\)\s*\{([\s\S]*?)\}\s*(?:@media|<\/style>)/);
      expect(mediaBlock, 'media query block should exist').not.toBeNull();
      const block = mediaBlock![1];
      expect(block).toMatch(/#messages\s*\{[^}]*max-width:\s*100%/);
    });

    it('媒体查询块内 input-bar 含 max-width: 100%（移除 900px 桌面限制）', () => {
      const html = createChatPageHtml('/ws');
      const mediaBlock = html.match(/@media\s*\(max-width:\s*768px\)\s*\{([\s\S]*?)\}\s*(?:@media|<\/style>)/);
      expect(mediaBlock, 'media query block should exist').not.toBeNull();
      const block = mediaBlock![1];
      expect(block).toMatch(/#input-bar\s*\{[^}]*max-width:\s*100%/);
    });

    it('媒体查询块内 messages/input-bar 含紧凑 padding', () => {
      const html = createChatPageHtml('/ws');
      const mediaBlock = html.match(/@media\s*\(max-width:\s*768px\)\s*\{([\s\S]*?)\}\s*(?:@media|<\/style>)/);
      expect(mediaBlock, 'media query block should exist').not.toBeNull();
      const block = mediaBlock![1];
      const hasPadding = /#messages\s*\{[^}]*padding/.test(block)
        || /#input-bar\s*\{[^}]*padding/.test(block);
      expect(hasPadding, 'messages/input-bar should have padding in mobile').toBe(true);
    });

    it('媒体查询块内 header 紧凑 padding', () => {
      const html = createChatPageHtml('/ws');
      const mediaBlock = html.match(/@media\s*\(max-width:\s*768px\)\s*\{([\s\S]*?)\}\s*(?:@media|<\/style>)/);
      expect(mediaBlock, 'media query block should exist').not.toBeNull();
      expect(mediaBlock![1]).toMatch(/header\s*\{[^}]*padding/);
    });
  });
});
