// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * Task 1: 聊天页面 token 记忆与自动携带
 *
 * 测试 chat-page.ts 内联 JS 中的 token 管理逻辑：
 * - 首次连接成功后，将 URL 中的 token 存入 sessionStorage
 * - 后续连接优先从 sessionStorage 读取 token，URL 参数优先级更高
 * - sessionStorage 中无 token 且 URL 无 token 时，显示鉴权提示并禁止发送
 *
 * 由于 chat-page.ts 导出的是完整 HTML 字符串，无法直接测试内联 JS。
 * 采用策略：提取 token 管理逻辑为可测试的纯函数，在测试中验证其行为。
 * 实现时将此逻辑提取到 chat-page.ts 内部的可导出函数，或直接测试 HTML 字符串内容。
 */

describe('Task 1: chat-page token 记忆与自动携带', () => {
  beforeEach(() => {
    sessionStorage.clear();
    localStorage.clear();
    // 重置 URL
    window.history.replaceState({}, '', '/');
  });

  it('URL 中有 token 时，首次连接成功后存入 sessionStorage', async () => {
    // 模拟 URL 带 token
    window.history.replaceState({}, '', '/?token=abc123');
    const { resolveToken } = await import('../../src/access/chat-page-token.js');
    const token = resolveToken();
    expect(token).toBe('abc123');
    // 连接成功后应存入 sessionStorage
    expect(sessionStorage.getItem('aptbot:token')).toBe('abc123');
  });

  it('刷新后从 sessionStorage 读取 token（URL 无 token 时）', async () => {
    // 模拟之前已存储 token
    sessionStorage.setItem('aptbot:token', 'stored-token-xyz');
    // URL 无 token
    window.history.replaceState({}, '', '/');
    const { resolveToken } = await import('../../src/access/chat-page-token.js');
    const token = resolveToken();
    expect(token).toBe('stored-token-xyz');
  });

  it('URL token 优先级高于 sessionStorage', async () => {
    sessionStorage.setItem('aptbot:token', 'old-token');
    window.history.replaceState({}, '', '/?token=new-token');
    const { resolveToken } = await import('../../src/access/chat-page-token.js');
    const token = resolveToken();
    expect(token).toBe('new-token');
    // URL token 应更新 sessionStorage
    expect(sessionStorage.getItem('aptbot:token')).toBe('new-token');
  });

  it('无 token 时返回 null，触发显示鉴权提示', async () => {
    sessionStorage.clear();
    window.history.replaceState({}, '', '/');
    const { resolveToken } = await import('../../src/access/chat-page-token.js');
    const token = resolveToken();
    expect(token).toBeNull();
  });

  it('WebSocket 连接 URL 应包含 token 参数', async () => {
    sessionStorage.setItem('aptbot:token', 'my-token');
    const { buildWsUrl } = await import('../../src/access/chat-page-token.js');
    const url = buildWsUrl('wss://example.com/ws', 'my-token', 0);
    expect(url).toContain('token=my-token');
  });

  it('无 token 时 WebSocket 连接 URL 不包含 token 参数', async () => {
    const { buildWsUrl } = await import('../../src/access/chat-page-token.js');
    const url = buildWsUrl('wss://example.com/ws', null, 0);
    expect(url).not.toContain('token=');
  });
});
