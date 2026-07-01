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
 * Task 4 (0.2.2): 检测 cookie 是否可用 — cookie 可用时浏览器自动带 HttpOnly cookie，
 * 无需在 WS URL 中暴露 token（防 XSS 窃取）；cookie 禁用时 fallback 到 sessionStorage。
 *
 * 逻辑与 chat-page.ts 内联 JS 的 isCookieEnabled 保持一致（防漂移）。
 * 修改此处需同步修改 chat-page.ts 内联 JS。
 */
export function isCookieEnabled(): boolean {
  if (typeof navigator !== 'undefined' && typeof navigator.cookieEnabled === 'boolean') {
    return navigator.cookieEnabled;
  }
  // 兜底：尝试写入测试 cookie
  try {
    document.cookie = 'aptbot_test=1; SameSite=Lax; path=/';
    return document.cookie.indexOf('aptbot_test=') !== -1;
  } catch {
    return false;
  }
}

/**
 * Task 4 (0.2.2): 解析 WS URL 使用的 token — URL ?token= > cookie 禁用时的 sessionStorage > null。
 * cookie 可用时返回 null（让浏览器带 cookie），避免 token 暴露在 URL 中。
 *
 * 逻辑与 chat-page.ts 内联 JS 的 resolveWsToken 保持一致（防漂移）。
 * 修改此处需同步修改 chat-page.ts 内联 JS。
 *
 * @param urlToken URL ?token= 参数（优先级最高，跨设备链接）
 * @param storedToken sessionStorage 中的 token（cookie 禁用 fallback）
 * @param cookieEnabled cookie 是否可用（isCookieEnabled() 返回值）
 */
export function resolveWsToken(
  urlToken: string | null,
  storedToken: string | null,
  cookieEnabled: boolean,
): string | null {
  if (urlToken) return urlToken;  // URL ?token= 优先级最高（跨设备链接）
  if (!cookieEnabled && storedToken) return storedToken;  // cookie 禁用 fallback
  return null;  // cookie 可用 — 浏览器自动带 cookie
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
 *
 * Task 6 I1 fix: 总是带 lastEventSeq（包括 0），确保 session_changed 重连时
 * 服务端能 replay 新 sessionKey 的 ring buffer。
 */
export function buildWsUrl(base: string, token: string | null, lastEventSeq: number): string {
  const params = new URLSearchParams();
  if (token) params.set('token', token);
  params.set('lastEventSeq', String(lastEventSeq));
  const qs = params.toString();
  return qs ? `${base}?${qs}` : base;
}
