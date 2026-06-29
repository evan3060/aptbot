/**
 * Task 1: 聊天页面 token 记忆与自动携带
 *
 * 提取自 chat-page.ts 内联 JS 的 token 管理逻辑，使其可测试。
 * chat-page.ts 内联 JS 中的逻辑必须与此处保持一致（防漂移）。
 *
 * 注意：resolveToken 仅解析 token，不写入 sessionStorage。
 * 持久化由 persistToken 在 ws.onopen 成功后调用，避免错误 token 被持久化。
 */

const TOKEN_STORAGE_KEY = 'aptbot:token';

/**
 * 解析当前请求的 token：
 * - URL 参数 ?token= 优先级最高
 * - 其次从 sessionStorage 读取（刷新/重连场景）
 * - 无 token 时返回 null（调用方显示鉴权提示）
 *
 * 不写入 sessionStorage — 持久化时机由调用方控制（ws.onopen 成功后）。
 */
export function resolveToken(): string | null {
  const urlParams = new URLSearchParams(window.location.search);
  const urlToken = urlParams.get('token');

  if (urlToken) {
    return urlToken;
  }

  const storedToken = sessionStorage.getItem(TOKEN_STORAGE_KEY);
  return storedToken ?? null;
}

/**
 * 持久化 token 到 sessionStorage（在 WebSocket 连接成功后调用）。
 * sessionStorage 不可用时静默降级。
 */
export function persistToken(token: string): void {
  try {
    sessionStorage.setItem(TOKEN_STORAGE_KEY, token);
  } catch {
    // sessionStorage 不可用时降级（隐私模式等）
  }
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
