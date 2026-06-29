/**
 * Task 6: chat-page sessionId 持久化 + session_changed 事件处理
 *
 * 提取自 chat-page.ts 内联 JS 的 sessionId 管理逻辑，使其可测试。
 * chat-page.ts 内联 JS 中的逻辑必须与此处保持一致（防漂移）。
 *
 * 与 chat-page-token.ts 的区别：
 * - token 用 sessionStorage（标签页级，关闭即清除，安全考虑）
 * - sessionId 用 localStorage（跨标签页/刷新持久化，支持会话恢复）
 */

const SESSION_ID_STORAGE_KEY = 'aptbot:sessionId';

/**
 * 解析当前请求的 sessionId：
 * - URL 参数 ?session= 优先级最高（从其他设备/链接跳转时携带）
 * - 其次从 localStorage 读取（刷新/重连场景）
 * - 无 sessionId 时生成新 UUID 并持久化到 localStorage
 */
export function resolveSessionId(): string {
  const urlParams = new URLSearchParams(window.location.search);
  const urlSessionId = urlParams.get('session');

  if (urlSessionId) {
    persistSessionId(urlSessionId);
    return urlSessionId;
  }

  const stored = localStorage.getItem(SESSION_ID_STORAGE_KEY);
  if (stored) {
    return stored;
  }

  // 生成新 UUID（浏览器原生 crypto.randomUUID，不支持时降级）
  const newId = typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : generateFallbackUuid();
  persistSessionId(newId);
  return newId;
}

/**
 * 持久化 sessionId 到 localStorage。
 * localStorage 不可用时静默降级。
 */
export function persistSessionId(sessionId: string): void {
  try {
    localStorage.setItem(SESSION_ID_STORAGE_KEY, sessionId);
  } catch {
    // localStorage 不可用时降级（隐私模式等）
  }
}

/**
 * 构建 WebSocket 连接 URL，附加 token / session / lastEventSeq 参数。
 * sessionId 为 null 时省略 session 参数（用于匿名场景）。
 */
export function buildWsUrlWithSession(
  base: string,
  token: string | null,
  sessionId: string | null,
  lastEventSeq: number,
): string {
  const params = new URLSearchParams();
  if (token) params.set('token', token);
  if (sessionId) params.set('session', sessionId);
  if (lastEventSeq > 0) params.set('lastEventSeq', String(lastEventSeq));
  const qs = params.toString();
  return qs ? `${base}?${qs}` : base;
}

/**
 * 判断服务端消息是否为 session_changed 事件。
 */
export function isSessionChangedMessage(msg: unknown): boolean {
  return (
    typeof msg === 'object' &&
    msg !== null &&
    (msg as { type?: string }).type === 'session_changed' &&
    typeof (msg as { sessionId?: unknown }).sessionId === 'string'
  );
}

/**
 * 处理 session_changed 事件：更新 localStorage 中的 sessionId，返回新 sessionId 供调用方重连。
 */
export function applySessionChanged(msg: { type: 'session_changed'; sessionId: string }): string {
  persistSessionId(msg.sessionId);
  return msg.sessionId;
}

/**
 * 不支持 crypto.randomUUID 时的降级生成器（RFC4122 v4 简化版）。
 */
function generateFallbackUuid(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}
