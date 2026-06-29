import { randomUUID, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { appendJsonl, readJsonlTolerant, repairJsonl } from './jsonl.js';
import { withJsonlLock } from './jsonl-mutex.js';

/**
 * Task 3: 用户模型 + 存储 + 认证 API
 *
 * 用户数据存储在 ${dataDir}/users.jsonl，每行一个 UserRecord。
 * 密码用 scrypt + salt 哈希，token 用 32 字节随机 hex。
 * 复用 JSONL 基建（appendJsonl + readJsonlTolerant + withJsonlLock）。
 */

export interface UserRecord {
  readonly userId: string;
  readonly username: string;
  readonly passwordHash: string; // scrypt 格式：salt:hash（均为 hex）
  readonly token: string;
  readonly createdAt: number;
}

export interface UserStorage {
  register(username: string, password: string): Promise<UserRecord>;
  login(username: string, password: string): Promise<UserRecord | null>;
  findByToken(token: string): Promise<UserRecord | null>;
  findByUserId(userId: string): Promise<UserRecord | null>;
}

/** Task 3 I2: 专用错误类型，用于区分 409 与 500 */
export class UsernameExistsError extends Error {
  constructor(username: string) {
    super(`username already exists: ${username}`);
    this.name = 'UsernameExistsError';
  }
}

const USERS_FILE = 'users.jsonl';
const SCRYPT_KEYLEN = 64;
const SCRYPT_SALT_LEN = 16;
// Task 3 M1: 显式 scrypt 参数（OWASP 最低线）
const SCRYPT_PARAMS = { N: 16384, r: 8, p: 1 } as const;
// Task 3 I4: dummy 密码用于拉平 login 时序（用户不存在时也跑一次 scrypt）
const DUMMY_PASSWORD_HASH = hashPassword('__dummy__');

/** scrypt 哈希密码，返回 "salt:hash" 格式（均为 hex） */
function hashPassword(password: string): string {
  const salt = randomBytes(SCRYPT_SALT_LEN);
  const hash = scryptSync(password, salt, SCRYPT_KEYLEN, SCRYPT_PARAMS);
  return `${salt.toString('hex')}:${hash.toString('hex')}`;
}

/** 验证密码是否匹配哈希 */
function verifyPassword(password: string, stored: string): boolean {
  const [saltHex, hashHex] = stored.split(':');
  if (!saltHex || !hashHex) return false;
  const salt = Buffer.from(saltHex, 'hex');
  const expectedHash = Buffer.from(hashHex, 'hex');
  const actualHash = scryptSync(password, salt, SCRYPT_KEYLEN, SCRYPT_PARAMS);
  if (actualHash.length !== expectedHash.length) return false;
  return timingSafeEqual(actualHash, expectedHash);
}

/** Task 3 I5: 常量时间比较 token */
function safeEqualToken(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

/** 生成 32 字节随机 token（hex 编码，64 字符） */
function generateToken(): string {
  return randomBytes(32).toString('hex');
}

export function createUserStorage(dataDir: string): UserStorage {
  const usersPath = join(dataDir, USERS_FILE);
  // per-file lock key，避免与 session JSONL 锁冲突
  const lockKey = `users-jsonl`;

  async function readAllUsersUnlocked(): Promise<UserRecord[]> {
    if (!existsSync(usersPath)) return [];
    await repairJsonl(usersPath);
    const result = await readJsonlTolerant(usersPath);
    return result.entries as UserRecord[];
  }

  async function appendUserUnlocked(record: UserRecord): Promise<void> {
    await appendJsonl(usersPath, record);
  }

  return {
    async register(username: string, password: string): Promise<UserRecord> {
      // Task 3 I1 修复：read + append 在同一锁闭包内，避免 TOCTOU 竞态
      return withJsonlLock(lockKey, async () => {
        const users = await readAllUsersUnlocked();
        if (users.some((u) => u.username === username)) {
          throw new UsernameExistsError(username);
        }
        const record: UserRecord = {
          userId: randomUUID(),
          username,
          passwordHash: hashPassword(password),
          token: generateToken(),
          createdAt: Date.now(),
        };
        await appendUserUnlocked(record);
        return record;
      });
    },

    async login(username: string, password: string): Promise<UserRecord | null> {
      const users = await withJsonlLock(lockKey, readAllUsersUnlocked);
      const user = users.find((u) => u.username === username);
      // Task 3 I4 修复：用户不存在时跑 dummy scrypt 拉平时序
      if (!user) {
        verifyPassword(password, DUMMY_PASSWORD_HASH);
        return null;
      }
      if (!verifyPassword(password, user.passwordHash)) return null;
      return user;
    },

    async findByToken(token: string): Promise<UserRecord | null> {
      const users = await withJsonlLock(lockKey, readAllUsersUnlocked);
      // Task 3 I5: 常量时间比较 token
      return users.find((u) => safeEqualToken(u.token, token)) ?? null;
    },

    async findByUserId(userId: string): Promise<UserRecord | null> {
      const users = await withJsonlLock(lockKey, readAllUsersUnlocked);
      return users.find((u) => u.userId === userId) ?? null;
    },
  };
}
