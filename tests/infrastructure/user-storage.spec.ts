import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createUserStorage, type UserStorage } from '../../src/infrastructure/user-storage.js';

/**
 * Task 3: 用户模型 + 存储 + 认证 API
 *
 * 测试 UserStorage 的核心契约：
 * - register: 创建用户，返回带 token 的 UserRecord，密码用 scrypt 哈希
 * - login: 验证密码，返回 UserRecord 或 null
 * - findByToken: 通过 token 查询用户
 * - findByUserId: 通过 userId 查询用户
 * - 重复用户名注册失败
 * - 错误密码登录失败
 * - 持久化到 data/users.jsonl
 */

describe('Task 3: UserStorage', () => {
  let tmpDir: string;
  let storage: UserStorage;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'aptbot-user-test-'));
    storage = createUserStorage(tmpDir);
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('register', () => {
    it('成功注册新用户，返回 UserRecord', async () => {
      const user = await storage.register('alice', 'password123');
      expect(user.userId).toBeTruthy();
      expect(user.username).toBe('alice');
      expect(user.passwordHash).toBeTruthy();
      expect(user.passwordHash).not.toBe('password123'); // 必须是哈希
      expect(user.token).toBeTruthy();
      expect(user.token.length).toBeGreaterThanOrEqual(32); // 强 token
      expect(user.createdAt).toBeGreaterThan(0);
    });

    it('不同用户生成不同 userId 和 token', async () => {
      const alice = await storage.register('alice', 'pass1');
      const bob = await storage.register('bob', 'pass2');
      expect(alice.userId).not.toBe(bob.userId);
      expect(alice.token).not.toBe(bob.token);
    });

    it('重复用户名注册失败，抛错', async () => {
      await storage.register('alice', 'pass1');
      await expect(storage.register('alice', 'pass2')).rejects.toThrow(/exists/i);
    });

    it('持久化到 users.jsonl 文件', async () => {
      await storage.register('alice', 'pass1');
      const usersFile = join(tmpDir, 'users.jsonl');
      expect(existsSync(usersFile)).toBe(true);
    });
  });

  describe('login', () => {
    it('正确密码登录成功，返回 UserRecord', async () => {
      const registered = await storage.register('alice', 'password123');
      const loggedIn = await storage.login('alice', 'password123');
      expect(loggedIn).not.toBeNull();
      expect(loggedIn!.userId).toBe(registered.userId);
      expect(loggedIn!.username).toBe('alice');
      expect(loggedIn!.token).toBe(registered.token);
    });

    it('错误密码登录失败，返回 null', async () => {
      await storage.register('alice', 'password123');
      const result = await storage.login('alice', 'wrong-password');
      expect(result).toBeNull();
    });

    it('不存在的用户登录失败，返回 null', async () => {
      const result = await storage.login('ghost', 'any-password');
      expect(result).toBeNull();
    });
  });

  describe('findByToken', () => {
    it('有效 token 返回用户', async () => {
      const registered = await storage.register('alice', 'pass');
      const found = await storage.findByToken(registered.token);
      expect(found).not.toBeNull();
      expect(found!.userId).toBe(registered.userId);
      expect(found!.username).toBe('alice');
    });

    it('无效 token 返回 null', async () => {
      const found = await storage.findByToken('invalid-token');
      expect(found).toBeNull();
    });
  });

  describe('findByUserId', () => {
    it('有效 userId 返回用户', async () => {
      const registered = await storage.register('alice', 'pass');
      const found = await storage.findByUserId(registered.userId);
      expect(found).not.toBeNull();
      expect(found!.username).toBe('alice');
    });

    it('无效 userId 返回 null', async () => {
      const found = await storage.findByUserId('nonexistent-id');
      expect(found).toBeNull();
    });
  });

  describe('持久化与重启', () => {
    it('重新加载存储后用户数据不丢失', async () => {
      const registered = await storage.register('alice', 'pass');
      // 模拟重启：用同目录创建新 storage 实例
      const reloadedStorage = createUserStorage(tmpDir);
      const found = await reloadedStorage.findByToken(registered.token);
      expect(found).not.toBeNull();
      expect(found!.username).toBe('alice');
    });
  });
});
