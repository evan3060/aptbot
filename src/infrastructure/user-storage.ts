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

const USERS_FILE = 'users.jsonl';
const SCRYPT_KEYLEN = 64;
const SCRYPT_SALT_LEN = 16;

/** scrypt 哈希密码，返回 "salt:hash" 格式（均为 hex） */
function hashPassword(password: string): string {
  const salt = randomBytes(SCRYPT_SALT_LEN);
  const hash = scryptSync(password, salt, SCRYPT_KEYLEN);
  return `${salt.toString('hex')}:${hash.toString('hex')}`;
}

/** 验证密码是否匹配哈希 */
function verifyPassword(password: string, stored: string): boolean {
  const [saltHex, hashHex] = stored.split(':');
  if (!saltHex || !hashHex) return false;
  const salt = Buffer.from(saltHex, 'hex');
  const expectedHash = Buffer.from(hashHex, 'hex');
  const actualHash = scryptSync(password, salt, SCRYPT_KEYLEN);
  if (actualHash.length !== expectedHash.length) return false;
  return timingSafeEqual(actualHash, expectedHash);
}

/** 生成 32 字节随机 token（hex 编码，64 字符） */
function generateToken(): string {
  return randomBytes(32).toString('hex');
}

export function createUserStorage(dataDir: string): UserStorage {
  const usersPath = join(dataDir, USERS_FILE);
  // per-file lock key，避免与 session JSONL 锁冲突
  const lockKey = `users-jsonl`;

  async function readAllUsers(): Promise<UserRecord[]> {
    if (!existsSync(usersPath)) return [];
    return withJsonlLock(lockKey, async () => {
      await repairJsonl(usersPath);
      const result = await readJsonlTolerant(usersPath);
      return result.entries as UserRecord[];
    });
  }

  async function appendUser(record: UserRecord): Promise<void> {
    return withJsonlLock(lockKey, () => appendJsonl(usersPath, record));
  }

  return {
    async register(username: string, password: string): Promise<UserRecord> {
      const users = await readAllUsers();
      if (users.some((u) => u.username === username)) {
        throw new Error(`username already exists: ${username}`);
      }
      const record: UserRecord = {
        userId: randomUUID(),
        username,
        passwordHash: hashPassword(password),
        token: generateToken(),
        createdAt: Date.now(),
      };
      await appendUser(record);
      return record;
    },

    async login(username: string, password: string): Promise<UserRecord | null> {
      const users = await readAllUsers();
      const user = users.find((u) => u.username === username);
      if (!user) return null;
      if (!verifyPassword(password, user.passwordHash)) return null;
      return user;
    },

    async findByToken(token: string): Promise<UserRecord | null> {
      const users = await readAllUsers();
      return users.find((u) => u.token === token) ?? null;
    },

    async findByUserId(userId: string): Promise<UserRecord | null> {
      const users = await readAllUsers();
      return users.find((u) => u.userId === userId) ?? null;
    },
  };
}
