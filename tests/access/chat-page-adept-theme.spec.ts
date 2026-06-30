import { describe, it, expect } from 'vitest';
import { createChatPageHtml } from '../../src/access/chat-page.js';

/**
 * Task 6: chat-page.ts adept 风格迁移
 *
 * 测试策略：纯字符串契约测试，验证 chat-page.ts 已从 v0.2.0 浅色+蓝色主题
 * 迁移到 adept 浅色暖调+深绿+Inter+pill 按钮风格。
 *
 * 断言：
 * 1. 含 13 个 adept design tokens 中的关键 CSS 变量定义（--bg-base / --text-primary / --accent）
 * 2. 含 Inter 字体 <link>
 * 3. 含 pill 圆角 border-radius: 9999px
 * 4. 不再含 v0.2.0 浅色+蓝色硬编码值
 *
 * DOM 结构、WebSocket 客户端逻辑、中文文案由现有测试套件回归保护。
 */
describe('Task 6: chat-page adept 风格迁移', () => {
  describe('adept design tokens 与 Inter 字体', () => {
    it('定义 --bg-base token', () => {
      const html = createChatPageHtml('/ws');
      expect(html).toContain('--bg-base: rgb(255, 255, 255)');
    });

    it('定义 --text-primary token', () => {
      const html = createChatPageHtml('/ws');
      expect(html).toContain('--text-primary: rgb(39, 36, 34)');
    });

    it('定义 --accent token', () => {
      const html = createChatPageHtml('/ws');
      expect(html).toContain('--accent: rgb(13, 113, 73)');
    });

    it('引入 Inter 字体 link', () => {
      const html = createChatPageHtml('/ws');
      expect(html).toContain(
        '<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&display=swap" rel="stylesheet">',
      );
    });

    it('body 字体改 Inter', () => {
      const html = createChatPageHtml('/ws');
      expect(html).toContain('font-family: Inter, system-ui, "PingFang SC", sans-serif');
    });
  });

  describe('pill 按钮圆角', () => {
    it('含 border-radius: 9999px', () => {
      const html = createChatPageHtml('/ws');
      expect(html).toContain('border-radius: 9999px');
    });
  });

  describe('可访问性：reduced-motion 与 focus outline', () => {
    it('含 prefers-reduced-motion 守护动画', () => {
      const html = createChatPageHtml('/ws');
      expect(html).toContain('@media (prefers-reduced-motion: reduce)');
      expect(html).toContain('animation: none');
    });

    it('#input:focus 含 accent outline', () => {
      const html = createChatPageHtml('/ws');
      expect(html).toContain('outline: 2px solid var(--accent)');
      expect(html).toContain('outline-offset: 1px');
    });
  });

  describe('不再含 v0.2.0 浅色+蓝色硬编码值', () => {
    const html = createChatPageHtml('/ws');

    it('不含 #f7f7f8 (body bg)', () => {
      expect(html).not.toContain('#f7f7f8');
    });

    it('不含 #fff (sidebar/header/card bg)', () => {
      // #ffffff 含 #fff 前缀，此断言同时拦截两者
      expect(html).not.toContain('#fff');
    });

    it('不含 #1f2937 (primary text)', () => {
      expect(html).not.toContain('#1f2937');
    });

    it('不含 #3b82f6 (accent)', () => {
      expect(html).not.toContain('#3b82f6');
    });

    it('不含 #6b7280 (secondary text)', () => {
      expect(html).not.toContain('#6b7280');
    });

    it('不含 #9ca3af (tertiary text)', () => {
      expect(html).not.toContain('#9ca3af');
    });

    it('不含 #e5e7eb (border)', () => {
      expect(html).not.toContain('#e5e7eb');
    });

    it('不含 #dbeafe (active session bg)', () => {
      expect(html).not.toContain('#dbeafe');
    });

    it('不含 #1e40af (active session text)', () => {
      expect(html).not.toContain('#1e40af');
    });

    it('不含 #f3f4f6 (hover bg)', () => {
      expect(html).not.toContain('#f3f4f6');
    });

    it('不含 #f59e0b (tool left border)', () => {
      expect(html).not.toContain('#f59e0b');
    });

    it('不含 #d1fae5 (status connected bg)', () => {
      expect(html).not.toContain('#d1fae5');
    });

    it('不含 #065f46 (status connected text)', () => {
      expect(html).not.toContain('#065f46');
    });

    it('不含 #fef3c7 (status default bg)', () => {
      expect(html).not.toContain('#fef3c7');
    });

    it('不含 #fee2e2 (error/status bg)', () => {
      expect(html).not.toContain('#fee2e2');
    });

    it('不含 #991b1b (error/status text)', () => {
      expect(html).not.toContain('#991b1b');
    });

    it('不含 #dc2626 (error border-left)', () => {
      expect(html).not.toContain('#dc2626');
    });
  });
});
