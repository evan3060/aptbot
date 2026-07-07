/**
 * Task 2 (React WebUI redesign): 认证控制器。
 *
 * 封装与后端 /api/register、/api/login、/api/logout、/api/me 的交互。
 *
 * 鉴权机制：
 * - HttpOnly cookie 是主要认证方式（fetch 附带 `credentials: 'include'`，浏览器自动携带 cookie）。
 * - 因 HttpOnly cookie 无法被 JS 读取，token 副本存入 sessionStorage（key: `aptbot:token`），
 *   用于构建 WebSocket URL（`?token=<token>`）。
 *
 * 后端 API 约定（src/access/websocket-server.ts handleAuthApi）：
 * - POST /api/register { username, password } → 200 { userId, username, token } | 409 { error }
 * - POST /api/login    { username, password } → 200 { userId, username, token } | 401 { error }
 * - POST /api/logout                      → 200 { ok: true }（Set-Cookie 清除）
 * - GET  /api/me                          → 200 { userId, username } | 401 { error }
 */
import type { AuthUser } from '../types.js';

const TOKEN_KEY = 'aptbot:token';

/** login / register 成功响应体 */
interface AuthResponseBody {
  userId: string;
  username: string;
  token: string;
}

export class AuthController {
  token: string | null;
  userId: string | null;
  username: string | null;

  constructor() {
    this.token = sessionStorage.getItem(TOKEN_KEY);
    this.userId = null;
    this.username = null;
  }

  get isLoggedIn(): boolean {
    return this.token !== null;
  }

  /** POST /api/login — 登录成功后存储 token 副本到 sessionStorage */
  async login(username: string, password: string): Promise<AuthUser> {
    const body = await this.postJson<AuthResponseBody>('/api/login', { username, password });
    this.setToken(body.token);
    this.userId = body.userId;
    this.username = body.username;
    return { userId: body.userId, username: body.username };
  }

  /** POST /api/register — 注册成功后存储 token 副本到 sessionStorage */
  async register(username: string, password: string): Promise<AuthUser> {
    const body = await this.postJson<AuthResponseBody>('/api/register', { username, password });
    this.setToken(body.token);
    this.userId = body.userId;
    this.username = body.username;
    return { userId: body.userId, username: body.username };
  }

  /** POST /api/logout — 清除 cookie（服务端）+ 清除 sessionStorage token 副本 */
  async logout(): Promise<void> {
    try {
      await fetch('/api/logout', {
        method: 'POST',
        credentials: 'include',
      });
    } catch {
      // 即使 API 调用失败也清除本地 token（允许本地登出）
    }
    this.clearToken();
  }

  /**
   * GET /api/me — 获取当前用户信息。
   *
   * 无 token 副本时返回 null（HttpOnly cookie 可能仍有效，但无 token 副本
   * 无法构建 WebSocket URL，因此视为未登录）。
   * 401 时清除 token 副本并返回 null。
   */
  async fetchMe(): Promise<AuthUser | null> {
    if (!this.token) return null;

    let res: Response;
    try {
      res = await fetch('/api/me', {
        method: 'GET',
        credentials: 'include',
      });
    } catch {
      return null;
    }

    if (!res.ok) {
      this.clearToken();
      return null;
    }

    const body = (await res.json()) as { userId: string; username: string };
    this.userId = body.userId;
    this.username = body.username;
    return { userId: body.userId, username: body.username };
  }

  // --- 内部方法 ---

  private setToken(token: string): void {
    this.token = token;
    sessionStorage.setItem(TOKEN_KEY, token);
  }

  private clearToken(): void {
    this.token = null;
    this.userId = null;
    this.username = null;
    sessionStorage.removeItem(TOKEN_KEY);
  }

  /** POST JSON 并在非 2xx 时抛出后端返回的 error 消息 */
  private async postJson<T>(url: string, payload: Record<string, unknown>): Promise<T> {
    const res = await fetch(url, {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const body = (await res.json()) as T & { error?: string };
    if (!res.ok) {
      throw new Error(body.error ?? 'request failed');
    }
    return body;
  }
}

/** 默认单例实例，供 AuthModal 等组件直接使用 */
export const authController = new AuthController();
