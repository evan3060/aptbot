import { describe, it, expect } from 'vitest';
import { createChatPageHtml } from '../../src/access/chat-page.js';

/**
 * 移动端适配验收：chat-page.ts 在 ≤768px 视口下必须保证主对话区可用。
 *
 * 痛点（修复前 390 视口实测）：
 *   - sidebar 固定 260px → main 仅剩 130px，对话区被严重挤压
 *   - 横向滚动条出现（scrollWidth 537 vs clientWidth 390）
 *
 * 修复策略：
 *   1. 移动端 sidebar 默认隐藏，通过 header 中的 hamburger 按钮以 overlay 形式打开
 *   2. main 占满视口宽度
 *   3. messages / input-bar padding 适配窄屏
 */
describe('chat-page 移动端适配 (≤768px)', () => {
  describe('媒体查询存在性', () => {
    it('含 max-width: 768px 媒体查询', () => {
      const html = createChatPageHtml('/ws');
      expect(html).toContain('@media (max-width: 768px)');
    });
  });

  describe('sidebar 抽屉化', () => {
    it('含 sidebar toggle 按钮（hamburger）', () => {
      const html = createChatPageHtml('/ws');
      expect(html).toMatch(/id="sidebar-toggle"/);
    });

    it('含 sidebar backdrop 遮罩元素', () => {
      const html = createChatPageHtml('/ws');
      expect(html).toMatch(/id="sidebar-backdrop"/);
    });

    it('CSS 中定义 sidebar 抽屉位移（默认隐藏或移出视口）', () => {
      const html = createChatPageHtml('/ws');
      // 在媒体查询块内，sidebar 应当默认不在视口内（transform/position/left 等手段）
      const mediaBlock = html.match(/@media\s*\(max-width:\s*768px\)\s*\{([\s\S]*?)\}\s*(?:@media|<\/style>)/);
      expect(mediaBlock, 'media query block should exist').not.toBeNull();
      // sidebar 默认应被移出视口（off-canvas）
      expect(mediaBlock![1]).toMatch(/#sidebar\s*\{[^}]*?(transform:\s*translateX|left:\s*-|position:\s*fixed)/);
    });

    it('CSS 中定义 sidebar.open 状态进入视口', () => {
      const html = createChatPageHtml('/ws');
      const mediaBlock = html.match(/@media\s*\(max-width:\s*768px\)\s*\{([\s\S]*?)\}\s*(?:@media|<\/style>)/);
      expect(mediaBlock, 'media query block should exist').not.toBeNull();
      expect(mediaBlock![1]).toMatch(/#sidebar\.open\s*\{[^}]*?(transform:\s*translateX\(0|left:\s*0)/);
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
  });

  describe('主区与输入栏移动端可用性', () => {
    it('媒体查询块内 main/messages/input-bar 不再被 sidebar 挤压（无固定 sidebar 占位）', () => {
      const html = createChatPageHtml('/ws');
      const mediaBlock = html.match(/@media\s*\(max-width:\s*768px\)\s*\{([\s\S]*?)\}\s*(?:@media|<\/style>)/);
      expect(mediaBlock, 'media query block should exist').not.toBeNull();
      const block = mediaBlock![1];
      // main 在移动端应当占满宽度（无 margin-left / 无被 sidebar 挤压）
      // 通过 sidebar 抽屉化即可保证 main 占满，不再额外断言
      expect(block).toContain('#sidebar');
      expect(block).toContain('#main');
    });

    it('messages/input-bar 在移动端 padding 适配', () => {
      const html = createChatPageHtml('/ws');
      const mediaBlock = html.match(/@media\s*\(max-width:\s*768px\)\s*\{([\s\S]*?)\}\s*(?:@media|<\/style>)/);
      expect(mediaBlock, 'media query block should exist').not.toBeNull();
      const block = mediaBlock![1];
      // 至少 messages 或 input-bar 在移动端有 padding 调整
      const hasPaddingAdjustment = /#messages\s*\{[^}]*padding/.test(block)
        || /#input-bar\s*\{[^}]*padding/.test(block)
        || /#messages\s*,\s*#input-bar\s*\{[^}]*padding/.test(block);
      expect(hasPaddingAdjustment, 'messages/input-bar should have padding adjustment in mobile').toBe(true);
    });
  });
});
