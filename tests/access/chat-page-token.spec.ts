// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from 'vitest';
import { resolveToken, persistToken, buildWsUrl } from '../../src/access/chat-page-token.js';
import { createChatPageHtml } from '../../src/access/chat-page.js';

/**
 * Task 1: 聊天页面 token 记忆与自动携带
 *
 * 测试策略：
 * 1. 纯函数契约测试（resolveToken / persistToken / buildWsUrl）
 * 2. 防漂移测试：验证 chat-page.ts 内联 JS 与纯函数逻辑同步
 * 3. UI 行为测试：验证无 token 时 HTML 包含鉴权提示
 */

describe('Task 1: chat-page token 记忆与自动携带', () => {
  beforeEach(() => {
    sessionStorage.clear();
    localStorage.clear();
    window.history.replaceState({}, '', '/');
  });

  describe('resolveToken 纯函数', () => {
    it('URL 中有 token 时返回 URL token（不写入 sessionStorage）', () => {
      window.history.replaceState({}, '', '/?token=abc123');
      const token = resolveToken();
      expect(token).toBe('abc123');
      // resolveToken 仅解析，不持久化（持久化由 persistToken 在 onopen 后调用）
      expect(sessionStorage.getItem('aptbot:token')).toBeNull();
    });

    it('刷新后从 sessionStorage 读取 token（URL 无 token 时）', () => {
      sessionStorage.setItem('aptbot:token', 'stored-token-xyz');
      window.history.replaceState({}, '', '/');
      const token = resolveToken();
      expect(token).toBe('stored-token-xyz');
    });

    it('URL token 优先级高于 sessionStorage', () => {
      sessionStorage.setItem('aptbot:token', 'old-token');
      window.history.replaceState({}, '', '/?token=new-token');
      const token = resolveToken();
      expect(token).toBe('new-token');
    });

    it('无 token 时返回 null，触发显示鉴权提示', () => {
      sessionStorage.clear();
      window.history.replaceState({}, '', '/');
      const token = resolveToken();
      expect(token).toBeNull();
    });
  });

  describe('persistToken 持久化', () => {
    it('将 token 写入 sessionStorage', () => {
      persistToken('my-token');
      expect(sessionStorage.getItem('aptbot:token')).toBe('my-token');
    });

    it('sessionStorage 不可用时静默降级不抛错', () => {
      // 模拟 sessionStorage 抛异常
      const original = sessionStorage.setItem;
      sessionStorage.setItem = () => { throw new Error('quota exceeded'); };
      expect(() => persistToken('x')).not.toThrow();
      sessionStorage.setItem = original;
    });
  });

  describe('buildWsUrl', () => {
    it('包含 token 参数', () => {
      const url = buildWsUrl('wss://example.com/ws', 'my-token', 0);
      expect(url).toContain('token=my-token');
    });

    it('无 token 时不包含 token 参数', () => {
      const url = buildWsUrl('wss://example.com/ws', null, 0);
      expect(url).not.toContain('token=');
    });

    it('lastEventSeq > 0 时包含 lastEventSeq 参数', () => {
      const url = buildWsUrl('wss://example.com/ws', 't', 42);
      expect(url).toContain('lastEventSeq=42');
    });

    it('Task 6 I1 fix: lastEventSeq=0 时也包含 lastEventSeq 参数', () => {
      const url = buildWsUrl('wss://example.com/ws', 't', 0);
      expect(url).toContain('lastEventSeq=0');
    });
  });

  describe('防漂移：chat-page.ts 内联 JS 与纯函数逻辑同步', () => {
    const html = createChatPageHtml('/ws');

    it('内联 JS 使用相同的 TOKEN_KEY', () => {
      expect(html).toContain("'aptbot:token'");
    });

    it('内联 JS resolveToken 逻辑：URL 优先，回退 sessionStorage', () => {
      // 验证内联 JS 包含 URL token 解析
      expect(html).toContain("new URLSearchParams(window.location.search).get('token')");
      // 验证内联 JS 包含 sessionStorage 回退
      expect(html).toContain("sessionStorage.getItem(TOKEN_KEY)");
    });

    it('内联 JS 持久化在 ws.onopen 中调用（不在解析时）', () => {
      // 验证 sessionStorage.setItem 在 onopen 回调中
      const onopenIdx = html.indexOf('ws.onopen');
      expect(onopenIdx).toBeGreaterThan(-1);
      // Task 4 (0.2.2): 双写策略 — onAuthSuccess 与 ws.onopen 均持久化 token
      // 验证 onopen 回调内含 setItem（从 onopenIdx 之后查找，跳过 onAuthSuccess 中的 setItem）
      const setItemInOnopen = html.indexOf("sessionStorage.setItem(TOKEN_KEY", onopenIdx);
      expect(setItemInOnopen).toBeGreaterThan(-1);
    });

    it('内联 JS buildWsUrl 逻辑：token 存在时附加参数，lastEventSeq 总是附加', () => {
      // Task 4 (0.2.2): 变量名 token → wsToken（resolveWsToken 返回值，cookie 可用时为 null）
      expect(html).toContain('params.set(\'token\', wsToken)');
      expect(html).toContain('params.set(\'lastEventSeq\'');
      // Task 6 I1 fix: lastEventSeq 总是 set（不再有 > 0 条件）
      expect(html).not.toContain('if (lastEventSeq > 0) params.set');
    });
  });

  describe('UI 行为：无 token 时未登录状态', () => {
    const html = createChatPageHtml('/ws');

    it('显示未登录文本', () => {
      expect(html).toContain('未登录');
    });

    it('显示登录按钮', () => {
      expect(html).toContain('id="auth-btn"');
    });

    it('无 token 时不连接 WS（connect 函数检查 token）', () => {
      expect(html).toContain("if (!token)");
      expect(html).toContain("setStatus('未登录'");
    });

    it('无 token 时禁用发送按钮和输入框', () => {
      expect(html).toContain('sendBtn.disabled = true');
      expect(html).toContain('inputEl.disabled = true');
    });

    it('placeholder 为请先登录', () => {
      expect(html).toContain("'请先登录'");
    });
  });
});
