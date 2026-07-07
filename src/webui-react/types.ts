/**
 * Task 2 (React WebUI redesign): 共享类型定义。
 *
 * 后续 Task 会在此文件追加更多类型（session、agent、message 等）。
 */

/** 已认证用户的基本信息（GET /api/me 与 login/register 响应的子集） */
export interface AuthUser {
  userId: string;
  username: string;
}

/** 认证状态：当前用户与 token 副本（token 副本用于 WebSocket URL 构建） */
export interface AuthState {
  user: AuthUser | null;
  token: string | null;
}
