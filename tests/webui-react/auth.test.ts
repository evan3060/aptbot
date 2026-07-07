// @vitest-environment happy-dom
/**
 * Task 2 (React WebUI redesign): AuthController 单元测试。
 *
 * Mock `fetch` + 使用 happy-dom 提供的 sessionStorage。
 * 覆盖 brief 要求的场景：
 *   - login 成功 → token 存入 sessionStorage
 *   - login 失败 → 抛错
 *   - register 成功 → token 存入 sessionStorage
 *   - register 失败 → 抛错
 *   - logout → 清除 token
 *   - fetchMe 无 token → 返回 null
 *   - fetchMe 有效 token → 返回 AuthUser
 *   - fetchMe 无效 token → 返回 null 并清除 token
 *   - credentials: 'include' 传递给 fetch
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { AuthController } from '../../src/webui-react/lib/auth.js';

const TOKEN_KEY = 'aptbot:token';

/** 构造 fetch Response-like 对象（最小接口，匹配 AuthController 用到的字段） */
function makeResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

describe('AuthController', () => {
  let auth: AuthController;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    sessionStorage.clear();
    fetchMock = vi.fn() as unknown as ReturnType<typeof vi.fn>;
    vi.stubGlobal('fetch', fetchMock);
    auth = new AuthController();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  describe('login', () => {
    it('成功时将 token 存入 sessionStorage 并填充 userId/username', async () => {
      fetchMock.mockResolvedValueOnce(
        makeResponse(200, { userId: 'u1', username: 'alice', token: 'tok-123' }),
      );

      const user = await auth.login('alice', 'pass');

      expect(user).toEqual({ userId: 'u1', username: 'alice' });
      expect(sessionStorage.getItem(TOKEN_KEY)).toBe('tok-123');
      expect(auth.token).toBe('tok-123');
      expect(auth.userId).toBe('u1');
      expect(auth.username).toBe('alice');
      expect(auth.isLoggedIn).toBe(true);
    });

    it('附带 credentials: include 并发送 JSON body', async () => {
      fetchMock.mockResolvedValueOnce(
        makeResponse(200, { userId: 'u1', username: 'alice', token: 'tok-123' }),
      );

      await auth.login('alice', 'pass');

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe('/api/login');
      expect(init.method).toBe('POST');
      expect(init.credentials).toBe('include');
      expect(init.headers['content-type']).toBe('application/json');
      expect(JSON.parse(init.body)).toEqual({ username: 'alice', password: 'pass' });
    });

    it('失败时（401）抛错且不写入 sessionStorage', async () => {
      fetchMock.mockResolvedValueOnce(
        makeResponse(401, { error: 'invalid credentials' }),
      );

      await expect(auth.login('alice', 'wrong')).rejects.toThrow('invalid credentials');
      expect(sessionStorage.getItem(TOKEN_KEY)).toBeNull();
      expect(auth.isLoggedIn).toBe(false);
    });
  });

  describe('register', () => {
    it('成功时将 token 存入 sessionStorage', async () => {
      fetchMock.mockResolvedValueOnce(
        makeResponse(200, { userId: 'u2', username: 'bob', token: 'tok-456' }),
      );

      const user = await auth.register('bob', 'pass');

      expect(user).toEqual({ userId: 'u2', username: 'bob' });
      expect(sessionStorage.getItem(TOKEN_KEY)).toBe('tok-456');
      expect(auth.token).toBe('tok-456');
      expect(auth.isLoggedIn).toBe(true);
    });

    it('用户名已存在时（409）抛错', async () => {
      fetchMock.mockResolvedValueOnce(
        makeResponse(409, { error: 'username already exists' }),
      );

      await expect(auth.register('bob', 'pass')).rejects.toThrow('username already exists');
      expect(sessionStorage.getItem(TOKEN_KEY)).toBeNull();
    });

    it('附带 credentials: include 并发送到 /api/register', async () => {
      fetchMock.mockResolvedValueOnce(
        makeResponse(200, { userId: 'u2', username: 'bob', token: 'tok-456' }),
      );

      await auth.register('bob', 'pass');

      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe('/api/register');
      expect(init.method).toBe('POST');
      expect(init.credentials).toBe('include');
    });
  });

  describe('logout', () => {
    it('清除 sessionStorage 中的 token 并重置内存状态', async () => {
      // 先 login 建立状态
      fetchMock.mockResolvedValueOnce(
        makeResponse(200, { userId: 'u1', username: 'alice', token: 'tok-123' }),
      );
      await auth.login('alice', 'pass');
      expect(sessionStorage.getItem(TOKEN_KEY)).toBe('tok-123');

      fetchMock.mockResolvedValueOnce(makeResponse(200, { ok: true }));
      await auth.logout();

      expect(sessionStorage.getItem(TOKEN_KEY)).toBeNull();
      expect(auth.token).toBeNull();
      expect(auth.userId).toBeNull();
      expect(auth.username).toBeNull();
      expect(auth.isLoggedIn).toBe(false);
    });

    it('调用 /api/logout 并附带 credentials: include', async () => {
      fetchMock.mockResolvedValueOnce(makeResponse(200, { ok: true }));
      await auth.logout();

      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe('/api/logout');
      expect(init.method).toBe('POST');
      expect(init.credentials).toBe('include');
    });

    it('即使 API 调用失败也清除本地 token', async () => {
      sessionStorage.setItem(TOKEN_KEY, 'tok-123');
      auth = new AuthController();
      expect(auth.token).toBe('tok-123');

      fetchMock.mockRejectedValueOnce(new Error('network'));
      await auth.logout();

      expect(sessionStorage.getItem(TOKEN_KEY)).toBeNull();
      expect(auth.isLoggedIn).toBe(false);
    });
  });

  describe('fetchMe', () => {
    it('sessionStorage 无 token 时返回 null（不调用 fetch）', async () => {
      const result = await auth.fetchMe();

      expect(result).toBeNull();
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('有效 token 时返回 AuthUser 并填充内存状态', async () => {
      sessionStorage.setItem(TOKEN_KEY, 'tok-123');
      auth = new AuthController();

      fetchMock.mockResolvedValueOnce(
        makeResponse(200, { userId: 'u1', username: 'alice' }),
      );

      const result = await auth.fetchMe();

      expect(result).toEqual({ userId: 'u1', username: 'alice' });
      expect(auth.userId).toBe('u1');
      expect(auth.username).toBe('alice');
    });

    it('GET /api/me 附带 credentials: include', async () => {
      sessionStorage.setItem(TOKEN_KEY, 'tok-123');
      auth = new AuthController();

      fetchMock.mockResolvedValueOnce(
        makeResponse(200, { userId: 'u1', username: 'alice' }),
      );

      await auth.fetchMe();

      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe('/api/me');
      expect(init.method).toBe('GET');
      expect(init.credentials).toBe('include');
    });

    it('无效 token（401）时返回 null 并清除 sessionStorage token', async () => {
      sessionStorage.setItem(TOKEN_KEY, 'tok-expired');
      auth = new AuthController();

      fetchMock.mockResolvedValueOnce(
        makeResponse(401, { error: 'invalid token' }),
      );

      const result = await auth.fetchMe();

      expect(result).toBeNull();
      expect(sessionStorage.getItem(TOKEN_KEY)).toBeNull();
      expect(auth.isLoggedIn).toBe(false);
    });
  });

  describe('isLoggedIn', () => {
    it('初始无 token 时为 false', () => {
      expect(auth.isLoggedIn).toBe(false);
    });

    it('构造时从 sessionStorage 读取已有 token', () => {
      sessionStorage.setItem(TOKEN_KEY, 'persisted-tok');
      const persisted = new AuthController();
      expect(persisted.isLoggedIn).toBe(true);
      expect(persisted.token).toBe('persisted-tok');
    });
  });
});
