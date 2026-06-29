/**
 * Task 1: 聊天页面 token 记忆与自动携带
 *
 * 提取自 chat-page.ts 内联 JS 的 token 管理逻辑，使其可测试。
 * chat-page.ts 在 buildWsUrl 等函数中调用这些工具函数。
 */

const TOKEN_STORAGE_KEY = 'aptbot:token';

/**
 * 解析当前请求的 token：
 * - URL 参数 ?token= 优先级最高
 * - 其次从 sessionStorage 读取（刷新/重连场景）
 * - URL 有 token 时同步写入 sessionStorage
 * - 无 token 时返回 null（调用方显示鉴权提示）
 */
export function resolveToken(): string | null {
  const urlParams = new URLSearchParams(window.location.search);
  const urlToken = urlParams.get('token');

  if (urlToken) {
    sessionStorage.setItem(TOKEN_STORAGE_KEY, urlToken);
    return urlToken;
  }

  const storedToken = sessionStorage.getItem(TOKEN_STORAGE_KEY);
  return storedToken ?? null;
}

/**
 * 构建 WebSocket 连接 URL，附加 token 和 lastEventSeq 参数。
 * token 为 null 时省略 token 参数。
 */
export function buildWsUrl(base: string, token: string | null, lastEventSeq: number): string {
  const params = new URLSearchParams();
  if (token) params.set('token', token);
  if (lastEventSeq > 0) params.set('lastEventSeq', String(lastEventSeq));
  const qs = params.toString();
  return qs ? `${base}?${qs}` : base;
}
