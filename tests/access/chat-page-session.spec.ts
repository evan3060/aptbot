// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from 'vitest';
import {
  resolveSessionId,
  persistSessionId,
  buildWsUrlWithSession,
  applySessionChanged,
  isSessionChangedMessage,
} from '../../src/access/chat-page-session.js';
import { createChatPageHtml } from '../../src/access/chat-page.js';

/**
 * Task 6: chat-page sessionId 持久化 + session_changed 事件处理
 *
 * 测试策略：
 * 1. 纯函数契约测试（resolveSessionId / persistSessionId / buildWsUrlWithSession / applySessionChanged）
 * 2. 防漂移测试：验证 chat-page.ts 内联 JS 与纯函数逻辑同步
 * 3. session_changed 事件处理：更新 localStorage 并触发重连
 */

describe('Task 6: chat-page sessionId 持久化 + session_changed', () => {
  beforeEach(() => {
    sessionStorage.clear();
    localStorage.clear();
    window.history.replaceState({}, '', '/');
  });

  describe('resolveSessionId 纯函数', () => {
    it('localStorage 无 sessionId 时生成新 UUID 并持久化', () => {
      const sid = resolveSessionId();
      expect(sid).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
      expect(localStorage.getItem('aptbot:sessionId')).toBe(sid);
    });

    it('刷新后从 localStorage 读取同一 sessionId', () => {
      const stored = '550e8400-e29b-41d4-a716-446655440000';
      localStorage.setItem('aptbot:sessionId', stored);
      const sid = resolveSessionId();
      expect(sid).toBe(stored);
    });

    it('URL 参数 ?session= 优先级高于 localStorage', () => {
      const stored = '11111111-2222-3333-4444-555555555555';
      const urlSid = '22222222-3333-4444-5555-666666666666';
      localStorage.setItem('aptbot:sessionId', stored);
      window.history.replaceState({}, '', `/?session=${urlSid}`);
      const sid = resolveSessionId();
      expect(sid).toBe(urlSid);
    });

    it('URL ?session= 优先级高于 localStorage 且会持久化覆盖', () => {
      const stored = '11111111-2222-3333-4444-555555555555';
      const urlSid = '22222222-3333-4444-5555-666666666666';
      localStorage.setItem('aptbot:sessionId', stored);
      window.history.replaceState({}, '', `/?session=${urlSid}`);
      resolveSessionId();
      expect(localStorage.getItem('aptbot:sessionId')).toBe(urlSid);
    });
  });

  describe('persistSessionId 持久化', () => {
    it('将 sessionId 写入 localStorage', () => {
      persistSessionId('abc-123-def-456');
      expect(localStorage.getItem('aptbot:sessionId')).toBe('abc-123-def-456');
    });

    it('localStorage 不可用时静默降级不抛错', () => {
      const original = localStorage.setItem;
      localStorage.setItem = () => { throw new Error('quota exceeded'); };
      expect(() => persistSessionId('x')).not.toThrow();
      localStorage.setItem = original;
    });
  });

  describe('buildWsUrlWithSession', () => {
    it('包含 token 和 session 参数', () => {
      const url = buildWsUrlWithSession('wss://example.com/ws', 'my-token', 'sid-123', 0);
      expect(url).toContain('token=my-token');
      expect(url).toContain('session=sid-123');
    });

    it('无 token 时不包含 token 参数但仍包含 session', () => {
      const url = buildWsUrlWithSession('wss://example.com/ws', null, 'sid-456', 0);
      expect(url).not.toContain('token=');
      expect(url).toContain('session=sid-456');
    });

    it('lastEventSeq > 0 时包含 lastEventSeq 参数', () => {
      const url = buildWsUrlWithSession('wss://example.com/ws', 't', 'sid', 42);
      expect(url).toContain('lastEventSeq=42');
    });

    it('sessionId 为 null 时省略 session 参数', () => {
      const url = buildWsUrlWithSession('wss://example.com/ws', 't', null, 0);
      expect(url).not.toContain('session=');
    });
  });

  describe('isSessionChangedMessage', () => {
    it('识别 session_changed 消息', () => {
      expect(isSessionChangedMessage({ type: 'session_changed', sessionId: 'new-id' })).toBe(true);
    });

    it('拒绝其他消息类型', () => {
      expect(isSessionChangedMessage({ type: 'event', seq: 1, event: { type: 'turn_start' } })).toBe(false);
      expect(isSessionChangedMessage({ type: 'error', code: 'x' })).toBe(false);
      expect(isSessionChangedMessage({ type: 'resync_required' })).toBe(false);
    });
  });

  describe('applySessionChanged', () => {
    it('更新 localStorage 中的 sessionId', () => {
      localStorage.setItem('aptbot:sessionId', 'old-id');
      applySessionChanged({ type: 'session_changed', sessionId: 'new-id-xyz' });
      expect(localStorage.getItem('aptbot:sessionId')).toBe('new-id-xyz');
    });

    it('返回新的 sessionId 供调用方触发重连', () => {
      const result = applySessionChanged({ type: 'session_changed', sessionId: 'reconnect-me' });
      expect(result).toBe('reconnect-me');
    });

    it('localStorage 不可用时静默降级不抛错', () => {
      const original = localStorage.setItem;
      localStorage.setItem = () => { throw new Error('quota'); };
      expect(() => applySessionChanged({ type: 'session_changed', sessionId: 'x' })).not.toThrow();
      localStorage.setItem = original;
    });
  });

  describe('防漂移：chat-page.ts 内联 JS 与纯函数逻辑同步', () => {
    const html = createChatPageHtml('/ws');

    it('内联 JS 使用 localStorage 持久化 sessionId', () => {
      expect(html).toContain("'aptbot:sessionId'");
      expect(html).toContain("localStorage.getItem");
      expect(html).toContain("localStorage.setItem");
    });

    it('内联 JS buildWsUrl 附加 ?session= 参数', () => {
      expect(html).toContain("params.set('session'");
    });

    it('内联 JS 处理 session_changed 消息类型', () => {
      expect(html).toContain("'session_changed'");
    });

    it('内联 JS 收到 session_changed 后更新 localStorage 并重连', () => {
      // 验证 session_changed 处理逻辑包含 localStorage 更新
      const sessionChangedIdx = html.indexOf("session_changed");
      expect(sessionChangedIdx).toBeGreaterThan(-1);
      // 查找之后的 localStorage.setItem 调用
      const afterChanged = html.slice(sessionChangedIdx);
      expect(afterChanged).toContain('localStorage.setItem');
    });
  });
});
