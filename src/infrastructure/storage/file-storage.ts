import { readdirSync, statSync, unlinkSync, existsSync, writeFileSync, readFileSync, renameSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import {
  appendJsonl,
  readJsonlTolerant,
  repairJsonl,
} from '../jsonl.js';
import { withJsonlLock } from '../jsonl-mutex.js';
import { createLogger } from '../logger.js';
import {
  type SessionEntry,
  type SessionMetadata,
  isValidSessionId,
  nowTimestamp,
} from '../../core/memory/types.js';
import { AGENT_SLUG_REGEX } from '../../core/agent/agent-profile.js';
import { USER_ID_REGEX } from '../../core/agent/agent-storage.js';

const metaLog = createLogger('file-storage');

/**
 * 生成 `${prefix}${timestamp}-${random}` 形态的 entry id。
 * timestamp 为 ms 精度（等同 nowTimestamp / Date.now），random 为 6 位 base36。
 */
export function generateEntryId(prefix: string): string {
  return `${prefix}${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Task 5: session 元数据 sidecar 文件结构。
 * 与 `<sessionId>.jsonl` 同目录，文件名 `<sessionId>.meta.json`。
 * 用于持久化 userId / label 等元信息，不混入 JSONL entries。
 *
 * §0.3.0 Task 4: 新增 agentId 字段（迁移后必填，legacy meta 可能缺省 → 视为 'default'）。
 */
interface SessionMetaFile {
  userId?: string;
  /** §0.3.0 Task 4: session 所属 agent slug（迁移后必填） */
  agentId?: string;
  label?: string;
  preview?: string;
  /** §4.10 Task 10: label 来源。'custom'=用户手动 /label（永久跳过自动摘要）；'auto'=LLM 自动摘要。 */
  labelSource?: 'custom' | 'auto';
}

/**
 * Task 5 C2 fix: claimSession 在跨用户 claim 时抛出，防止所有权被静默转移。
 */
export class SessionAlreadyClaimedError extends Error {
  constructor(
    public readonly sessionId: string,
    public readonly currentOwner: string,
    public readonly attemptedOwner: string,
  ) {
    super(`session ${sessionId} already claimed by ${currentOwner}, cannot claim to ${attemptedOwner}`);
    this.name = 'SessionAlreadyClaimedError';
  }
}

/**
 * §0.3.0 Task 4: StorageAdapter 接口扩展。
 *
 * - 所有方法支持 (id, userId, agentId, ...) 新签名（agent-scoped path）
 * - 向后兼容：旧签名 (id, ...) 仍可用（legacy flat path: `${dataDir}/${id}.jsonl`）
 * - 当 userId/agentId 提供时使用新路径：`${dataDir}/users/<userId>/agents/<agentId>/sessions/<id>.jsonl`
 * - 当 userId/agentId 缺省时使用 legacy 路径：`${dataDir}/${id}.jsonl`
 * - readSession 在新路径不存在时自动 fallback 到 legacy 路径（0.3.0 过渡期）
 */
export interface StorageAdapter {
  /** §0.3.0 Task 4: 读取 session entries（支持 legacy + new path） */
  readSession(id: string): Promise<SessionEntry[]>;
  readSession(id: string, userId: string, agentId: string): Promise<SessionEntry[]>;
  /** §0.3.0 Task 4: 追加 entry（新路径自动创建多层目录） */
  appendSession(id: string, entry: SessionEntry): Promise<void>;
  appendSession(id: string, userId: string, agentId: string, entry: SessionEntry): Promise<void>;
  /** §0.3.0 Task 4: 列出 sessions（递归扫描 users/{userId}/agents/{agentId}/sessions/ + legacy flat dir） */
  listSessions(): Promise<SessionMetadata[]>;
  listSessions(userId: string): Promise<SessionMetadata[]>;
  listSessions(userId: string, agentId: string): Promise<SessionMetadata[]>;
  /** §0.3.0 Task 4: 读取 working memory */
  readWorkingMemory(sessionId: string): Promise<string | null>;
  readWorkingMemory(sessionId: string, userId: string, agentId: string): Promise<string | null>;
  /** §0.3.0 Task 4: 写入 working memory */
  writeWorkingMemory(sessionId: string, keyInfo: string): Promise<void>;
  writeWorkingMemory(sessionId: string, userId: string, agentId: string, keyInfo: string): Promise<void>;
  /** §0.3.0 Task 4: 删除 session（幂等） */
  deleteSession(id: string): Promise<void>;
  deleteSession(id: string, userId: string, agentId: string): Promise<void>;
  /** Task 5: 将 session claim 到指定 user（幂等：同用户重复 claim 是 no-op；跨用户 claim 抛 SessionAlreadyClaimedError） */
  claimSession(id: string, userId: string): Promise<void>;
  /** §0.3.0 Task 4: claim 到指定 user + agent（写入 .meta.json 的 userId + agentId） */
  claimSession(id: string, userId: string, agentId: string): Promise<void>;
  /** 强制覆盖 session owner（用于 agent 共享 session 转移给当前登录用户） */
  forceClaimSession(id: string, userId: string): Promise<void>;
  forceClaimSession(id: string, userId: string, agentId: string): Promise<void>;
  /** Task 5: 更新 session label（写入 sidecar .meta.json）。
   *  §4.10 Task 10: source 可选，'custom'（默认，用户手动 /label）/ 'auto'（LLM 自动摘要）。 */
  updateSessionLabel(id: string, label: string, source?: 'custom' | 'auto'): Promise<void>;
  updateSessionLabel(id: string, userId: string, agentId: string, label: string, source?: 'custom' | 'auto'): Promise<void>;
  /** Task 5 C2 fix: 读取 session 当前 owner（未 claim 返回 undefined；§0.3.0 Task 4 递归扫描） */
  getSessionOwner(id: string): Promise<string | undefined>;
  /** §4.10 Task 10: 是否已有用户手动设置的 custom label（永久跳过自动摘要）。 */
  hasCustomLabel(id: string): Promise<boolean>;
  hasCustomLabel(id: string, userId: string, agentId: string): Promise<boolean>;
}

/**
 * §9.4 FileStorage: JSONL-based per-session file storage.
 * §10.1.1 / §10.1.3 边界：损坏容错、per-sessionId mutex 串行化。
 *
 * §0.3.0 Task 4: 路径迁移
 * - constructor 接受 `dataDir`（数据根目录，如 `./data`）
 * - 新路径：`${dataDir}/users/<userId>/agents/<agentId>/sessions/<id>.jsonl`
 * - Legacy 兼容路径（旧签名 / fallback）：`${dataDir}/sessions/<id>.jsonl` 或 `${dataDir}/${id}.jsonl`
 * - 路径遍历防护：userId 必须匹配 UUID 正则；agentId 必须匹配 AGENT_SLUG_REGEX
 */
export class FileStorage implements StorageAdapter {
  private readonly dataDir: string;

  constructor(dataDir: string = './data') {
    this.dataDir = dataDir;
  }

  /**
   * §0.3.0 Task 4: 校验 userId + agentId 路径遍历防护。
   * userId 必须匹配 UUID 正则；agentId 必须匹配 AGENT_SLUG_REGEX。
   */
  private validatePathParams(userId: string, agentId: string): void {
    if (!USER_ID_REGEX.test(userId)) {
      throw new Error(`invalid userId (path traversal guard): ${userId}`);
    }
    if (!AGENT_SLUG_REGEX.test(agentId)) {
      throw new Error(`invalid agentId (path traversal guard): ${agentId}`);
    }
  }

  /**
   * §0.3.0 Task 4: 新路径计算 — `${dataDir}/users/<userId>/agents/<agentId>/sessions/<id>.jsonl`
   */
  private resolveNewPath(id: string, userId: string, agentId: string): string {
    if (!isValidSessionId(id)) {
      throw new Error(`invalid sessionId: ${id}`);
    }
    this.validatePathParams(userId, agentId);
    return join(this.dataDir, 'users', userId, 'agents', agentId, 'sessions', `${id}.jsonl`);
  }

  private resolveNewMetaPath(id: string, userId: string, agentId: string): string {
    if (!isValidSessionId(id)) {
      throw new Error(`invalid sessionId: ${id}`);
    }
    this.validatePathParams(userId, agentId);
    return join(this.dataDir, 'users', userId, 'agents', agentId, 'sessions', `${id}.meta.json`);
  }

  /**
   * §0.3.0 Task 4: Legacy 路径 — `${dataDir}/${id}.jsonl`
   * 当 dataDir 是 sessions dir 本身时（旧 API / 旧测试），直接拼接。
   */
  private resolveLegacyPath(id: string): string {
    if (!isValidSessionId(id)) {
      throw new Error(`invalid sessionId: ${id}`);
    }
    return join(this.dataDir, `${id}.jsonl`);
  }

  private resolveLegacyMetaPath(id: string): string {
    if (!isValidSessionId(id)) {
      throw new Error(`invalid sessionId: ${id}`);
    }
    return join(this.dataDir, `${id}.meta.json`);
  }

  /**
   * §0.3.0 Task 4: Legacy fallback 路径（新 API 调用时新路径不存在的回退）
   * - 若 dataDir 以 `/sessions` 结尾：legacy fallback = `${dataDir}/${id}.jsonl`
   * - 否则：legacy fallback = `${dataDir}/sessions/${id}.jsonl`（dataDir 视为数据根）
   */
  private resolveLegacyFallbackPath(id: string): string {
    if (!isValidSessionId(id)) {
      throw new Error(`invalid sessionId: ${id}`);
    }
    const endsWithSessions = this.dataDir.endsWith('/sessions') || this.dataDir.endsWith('\\sessions') || this.dataDir === 'sessions';
    if (endsWithSessions) {
      return join(this.dataDir, `${id}.jsonl`);
    }
    return join(this.dataDir, 'sessions', `${id}.jsonl`);
  }

  private resolveLegacyFallbackMetaPath(id: string): string {
    if (!isValidSessionId(id)) {
      throw new Error(`invalid sessionId: ${id}`);
    }
    const endsWithSessions = this.dataDir.endsWith('/sessions') || this.dataDir.endsWith('\\sessions') || this.dataDir === 'sessions';
    if (endsWithSessions) {
      return join(this.dataDir, `${id}.meta.json`);
    }
    return join(this.dataDir, 'sessions', `${id}.meta.json`);
  }

  /** Task 5: 读取 sidecar 元数据，文件不存在返回空对象 */
  private readMetaFromPath(metaPath: string): SessionMetaFile {
    if (!existsSync(metaPath)) return {};
    try {
      const content = readFileSync(metaPath, 'utf-8');
      return JSON.parse(content) as SessionMetaFile;
    } catch (err) {
      metaLog.warn('meta.json parse failed, treating as empty', { path: metaPath, error: String(err) });
      return {};
    }
  }

  /** Task 5: 读取 sidecar 元数据（legacy path） */
  private readMeta(id: string): SessionMetaFile {
    return this.readMetaFromPath(this.resolveLegacyMetaPath(id));
  }

  /** §0.3.0 Task 4: 读取 sidecar 元数据（new path） */
  private readMetaNew(id: string, userId: string, agentId: string): SessionMetaFile {
    return this.readMetaFromPath(this.resolveNewMetaPath(id, userId, agentId));
  }

  /**
   * Task 5 C1 fix: 原子写入 sidecar 元数据（write-to-tmp + rename）。
   * 调用方必须在 withJsonlLock 内调用以防止并发读改写竞态。
   */
  private writeMetaAtomicToPath(metaPath: string, patch: SessionMetaFile): void {
    const dir = dirname(metaPath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    const existing = this.readMetaFromPath(metaPath);
    const merged: SessionMetaFile = { ...existing, ...patch };
    const tmpPath = `${metaPath}.tmp`;
    writeFileSync(tmpPath, JSON.stringify(merged, null, 2), 'utf-8');
    renameSync(tmpPath, metaPath);
  }

  private writeMetaAtomic(id: string, patch: SessionMetaFile): void {
    this.writeMetaAtomicToPath(this.resolveLegacyMetaPath(id), patch);
  }

  private writeMetaAtomicNew(id: string, userId: string, agentId: string, patch: SessionMetaFile): void {
    this.writeMetaAtomicToPath(this.resolveNewMetaPath(id, userId, agentId), patch);
  }

  async readSession(id: string): Promise<SessionEntry[]>;
  async readSession(id: string, userId: string, agentId: string): Promise<SessionEntry[]>;
  async readSession(id: string, userId?: string, agentId?: string): Promise<SessionEntry[]> {
    if (userId !== undefined && agentId !== undefined) {
      // §0.3.0 Task 4: new path
      const newPath = this.resolveNewPath(id, userId, agentId);
      if (existsSync(newPath)) {
        return withJsonlLock(id, async () => {
          await repairJsonl(newPath);
          const result = await readJsonlTolerant(newPath);
          return result.entries as SessionEntry[];
        });
      }
      // §0.3.0 Task 4: legacy fallback（迁移期间）
      const legacyPath = this.resolveLegacyFallbackPath(id);
      if (existsSync(legacyPath)) {
        return withJsonlLock(id, async () => {
          await repairJsonl(legacyPath);
          const result = await readJsonlTolerant(legacyPath);
          return result.entries as SessionEntry[];
        });
      }
      return [];
    }
    // Legacy mode: dataDir 视为 sessions dir
    const path = this.resolveLegacyPath(id);
    if (!existsSync(path)) return [];
    return withJsonlLock(id, async () => {
      await repairJsonl(path);
      const result = await readJsonlTolerant(path);
      return result.entries as SessionEntry[];
    });
  }

  async appendSession(id: string, entry: SessionEntry): Promise<void>;
  async appendSession(id: string, userId: string, agentId: string, entry: SessionEntry): Promise<void>;
  async appendSession(
    id: string,
    entryOrUserId: SessionEntry | string,
    agentIdOrEntry?: string | SessionEntry,
    maybeEntry?: SessionEntry,
  ): Promise<void> {
    if (typeof entryOrUserId === 'string' && agentIdOrEntry !== undefined && maybeEntry !== undefined) {
      // §0.3.0 Task 4: new path — appendSession(id, userId, agentId, entry)
      const userId = entryOrUserId;
      const agentId = agentIdOrEntry as string;
      const entry = maybeEntry;
      const path = this.resolveNewPath(id, userId, agentId);
      await withJsonlLock(id, async () => {
        await appendJsonl(path, entry);
        if (entry.type === 'message' && entry.message.role === 'user') {
          const meta = this.readMetaNew(id, userId, agentId);
          if (!meta.preview) {
            const content = typeof entry.message.content === 'string'
              ? entry.message.content
              : '';
            this.writeMetaAtomicNew(id, userId, agentId, { preview: content.slice(0, 30) });
          }
        }
      });
      return;
    }
    // Legacy mode — appendSession(id, entry)
    const entry = entryOrUserId as SessionEntry;
    const path = this.resolveLegacyPath(id);
    await withJsonlLock(id, async () => {
      await appendJsonl(path, entry);
      if (entry.type === 'message' && entry.message.role === 'user') {
        const meta = this.readMeta(id);
        if (!meta.preview) {
          const content = typeof entry.message.content === 'string'
            ? entry.message.content
            : '';
          this.writeMetaAtomic(id, { preview: content.slice(0, 30) });
        }
      }
    });
  }

  async listSessions(): Promise<SessionMetadata[]>;
  async listSessions(userId: string): Promise<SessionMetadata[]>;
  async listSessions(userId: string, agentId: string): Promise<SessionMetadata[]>;
  async listSessions(userId?: string, agentId?: string): Promise<SessionMetadata[]> {
    const metas: SessionMetadata[] = [];

    // §0.3.0 Task 4: 递归扫描 new path — ${dataDir}/users/*/agents/*/sessions/*.jsonl
    const usersDir = join(this.dataDir, 'users');
    if (existsSync(usersDir)) {
      try {
        const userDirs = readdirSync(usersDir);
        for (const userDir of userDirs) {
          // 路径遍历防护：跳过非法 userId 目录
          if (!USER_ID_REGEX.test(userDir)) continue;
          // userId 过滤
          if (userId !== undefined && userDir !== userId) continue;

          const agentsDir = join(usersDir, userDir, 'agents');
          if (!existsSync(agentsDir)) continue;

          const agentDirs = readdirSync(agentsDir);
          for (const agentDir of agentDirs) {
            // 路径遍历防护：跳过非法 agentId 目录
            if (!AGENT_SLUG_REGEX.test(agentDir)) continue;
            // agentId 过滤（invalid agentId 不抛错，返回空）
            if (agentId !== undefined && agentDir !== agentId) continue;

            const sessionsDir = join(agentsDir, agentDir, 'sessions');
            if (!existsSync(sessionsDir)) continue;

            const files = readdirSync(sessionsDir).filter((f) => f.endsWith('.jsonl'));
            for (const file of files) {
              const sessionId = file.replace(/\.jsonl$/, '');
              if (!isValidSessionId(sessionId)) continue;
              const path = join(sessionsDir, file);
              const stat = statSync(path);
              const metaPath = join(sessionsDir, `${sessionId}.meta.json`);
              const meta = this.readMetaFromPath(metaPath);
              metas.push({
                id: sessionId,
                createdAt: Math.floor(stat.birthtimeMs),
                updatedAt: Math.floor(stat.mtimeMs),
                userId: meta.userId,
                agentId: meta.agentId ?? agentDir,
                label: meta.label,
                preview: meta.preview,
              });
            }
          }
        }
      } catch (err) {
        metaLog.warn('recursive scan of users/ failed', { error: String(err) });
      }
    }

    // §0.3.0 Task 4: 扫描 legacy flat dir — ${dataDir}/*.jsonl
    if (existsSync(this.dataDir)) {
      try {
        const allFiles = readdirSync(this.dataDir);
        const files = allFiles.filter((f) => f.endsWith('.jsonl'));
        for (const file of files) {
          const sessionId = file.replace(/\.jsonl$/, '');
          if (!isValidSessionId(sessionId)) continue;
          const meta = this.readMeta(sessionId);
          // userId 过滤
          if (userId !== undefined && meta.userId !== userId) continue;
          // agentId 过滤（legacy sessions 无 agentId，缺省视为 'default'）
          const sessionAgentId = meta.agentId ?? 'default';
          if (agentId !== undefined && sessionAgentId !== agentId) continue;
          const path = join(this.dataDir, file);
          const stat = statSync(path);
          metas.push({
            id: sessionId,
            createdAt: Math.floor(stat.birthtimeMs),
            updatedAt: Math.floor(stat.mtimeMs),
            userId: meta.userId,
            agentId: sessionAgentId,
            label: meta.label,
            preview: meta.preview,
          });
        }
      } catch (err) {
        metaLog.warn('scan of legacy flat dir failed', { error: String(err) });
      }
    }

    // §0.3.0 Task 4: 扫描 legacy fallback dir — ${dataDir}/sessions/*.jsonl
    const legacyFallbackDir = this.dataDir.endsWith('/sessions') || this.dataDir.endsWith('\\sessions') || this.dataDir === 'sessions'
      ? null
      : join(this.dataDir, 'sessions');
    if (legacyFallbackDir && existsSync(legacyFallbackDir)) {
      try {
        const files = readdirSync(legacyFallbackDir).filter((f) => f.endsWith('.jsonl'));
        for (const file of files) {
          const sessionId = file.replace(/\.jsonl$/, '');
          if (!isValidSessionId(sessionId)) continue;
          const metaPath = join(legacyFallbackDir, `${sessionId}.meta.json`);
          const meta = this.readMetaFromPath(metaPath);
          if (userId !== undefined && meta.userId !== userId) continue;
          const sessionAgentId = meta.agentId ?? 'default';
          if (agentId !== undefined && sessionAgentId !== agentId) continue;
          const path = join(legacyFallbackDir, file);
          const stat = statSync(path);
          metas.push({
            id: sessionId,
            createdAt: Math.floor(stat.birthtimeMs),
            updatedAt: Math.floor(stat.mtimeMs),
            userId: meta.userId,
            agentId: sessionAgentId,
            label: meta.label,
            preview: meta.preview,
          });
        }
      } catch (err) {
        metaLog.warn('scan of legacy fallback dir failed', { error: String(err) });
      }
    }

    // 按 updatedAt 降序 + 去重（同一 sessionId 可能在多个目录出现）
    const seen = new Set<string>();
    const unique = metas.filter((m) => {
      if (seen.has(m.id)) return false;
      seen.add(m.id);
      return true;
    });
    unique.sort((a, b) => b.updatedAt - a.updatedAt);
    return unique;
  }

  async readWorkingMemory(sessionId: string): Promise<string | null>;
  async readWorkingMemory(sessionId: string, userId: string, agentId: string): Promise<string | null>;
  async readWorkingMemory(sessionId: string, userId?: string, agentId?: string): Promise<string | null> {
    const entries = userId !== undefined && agentId !== undefined
      ? await this.readSession(sessionId, userId, agentId)
      : await this.readSession(sessionId);
    for (let i = entries.length - 1; i >= 0; i--) {
      const e = entries[i];
      if (e.type === 'working_memory') return e.keyInfo;
    }
    return null;
  }

  async writeWorkingMemory(sessionId: string, keyInfo: string): Promise<void>;
  async writeWorkingMemory(sessionId: string, userId: string, agentId: string, keyInfo: string): Promise<void>;
  async writeWorkingMemory(
    sessionId: string,
    keyInfoOrUserId: string,
    agentIdOrKeyInfo?: string,
    maybeKeyInfo?: string,
  ): Promise<void> {
    const entry: SessionEntry = {
      type: 'working_memory',
      id: generateEntryId('wm-'),
      keyInfo: '',
      timestamp: nowTimestamp(),
    };
    if (agentIdOrKeyInfo !== undefined && maybeKeyInfo !== undefined) {
      // New mode: writeWorkingMemory(sessionId, userId, agentId, keyInfo)
      const userId = keyInfoOrUserId;
      const agentId = agentIdOrKeyInfo;
      entry.keyInfo = maybeKeyInfo;
      await this.appendSession(sessionId, userId, agentId, entry);
    } else {
      // Legacy mode: writeWorkingMemory(sessionId, keyInfo)
      entry.keyInfo = keyInfoOrUserId;
      await this.appendSession(sessionId, entry);
    }
  }

  async deleteSession(id: string): Promise<void>;
  async deleteSession(id: string, userId: string, agentId: string): Promise<void>;
  async deleteSession(id: string, userId?: string, agentId?: string): Promise<void> {
    if (!isValidSessionId(id)) return;
    const paths: string[] = [];
    if (userId !== undefined && agentId !== undefined) {
      paths.push(this.resolveNewPath(id, userId, agentId));
      paths.push(this.resolveNewMetaPath(id, userId, agentId));
    }
    paths.push(this.resolveLegacyPath(id));
    paths.push(this.resolveLegacyMetaPath(id));
    paths.push(this.resolveLegacyFallbackPath(id));
    paths.push(this.resolveLegacyFallbackMetaPath(id));
    // 去重
    const uniquePaths = [...new Set(paths)];
    for (const path of uniquePaths) {
      if (existsSync(path)) {
        try {
          unlinkSync(path);
        } catch (err) {
          metaLog.warn('deleteSession failed to unlink', { path, error: String(err) });
        }
      }
    }
  }

  /**
   * Task 5: claim session 到指定 user。
   * C1 fix: 加 withJsonlLock 防止并发读改写竞态。
   * I8 fix: 真正幂等 — 同用户重复 claim 是 no-op；跨用户 claim 抛 SessionAlreadyClaimedError。
   *
   * §0.3.0 Task 4: 新增 agentId 参数，写入 .meta.json 的 agentId 字段。
   */
  async claimSession(id: string, userId: string): Promise<void>;
  async claimSession(id: string, userId: string, agentId: string): Promise<void>;
  async claimSession(id: string, userId: string, agentId?: string): Promise<void> {
    if (!isValidSessionId(id)) {
      throw new Error(`invalid sessionId: ${id}`);
    }
    await withJsonlLock(id, async () => {
      // §0.3.0 Task 4: 跨路径 ownership 检查 — getSessionOwner 递归扫描所有可能路径
      const currentOwner = await this.findSessionOwnerSync(id);
      if (currentOwner && currentOwner !== userId) {
        throw new SessionAlreadyClaimedError(id, currentOwner, userId);
      }
      if (agentId !== undefined) {
        // §0.3.0 Task 4: new path
        const metaPath = this.resolveNewMetaPath(id, userId, agentId);
        this.writeMetaAtomicToPath(metaPath, { userId, agentId });
      } else {
        // Legacy path
        this.writeMetaAtomic(id, { userId });
      }
    });
  }

  /**
   * §0.3.0 Task 4: 同步查找 session owner（用于 claimSession 内部调用，避免 async 嵌套）。
   * 检查顺序：legacy path → legacy fallback → recursive scan。
   */
  private findSessionOwnerSync(id: string): string | undefined {
    if (!isValidSessionId(id)) return undefined;
    // 1. Legacy path
    const legacyMeta = this.readMeta(id);
    if (legacyMeta.userId) return legacyMeta.userId;
    // 2. Legacy fallback
    const legacyFallbackMetaPath = this.resolveLegacyFallbackMetaPath(id);
    if (existsSync(legacyFallbackMetaPath)) {
      const meta = this.readMetaFromPath(legacyFallbackMetaPath);
      if (meta.userId) return meta.userId;
    }
    // 3. Recursive scan
    const usersDir = join(this.dataDir, 'users');
    if (existsSync(usersDir)) {
      try {
        const userDirs = readdirSync(usersDir);
        for (const userDir of userDirs) {
          if (!USER_ID_REGEX.test(userDir)) continue;
          const agentsDir = join(usersDir, userDir, 'agents');
          if (!existsSync(agentsDir)) continue;
          const agentDirs = readdirSync(agentsDir);
          for (const agentDir of agentDirs) {
            if (!AGENT_SLUG_REGEX.test(agentDir)) continue;
            const sessionsDir = join(agentsDir, agentDir, 'sessions');
            if (!existsSync(sessionsDir)) continue;
            const metaPath = join(sessionsDir, `${id}.meta.json`);
            if (existsSync(metaPath)) {
              const meta = this.readMetaFromPath(metaPath);
              if (meta.userId) return meta.userId;
            }
          }
        }
      } catch (err) {
        metaLog.warn('findSessionOwnerSync recursive scan failed', { id, error: String(err) });
      }
    }
    return undefined;
  }

  /** Task 5: 更新 session label（加锁防竞态）。
   *  §4.10 Task 10: source 默认 'custom'（手动 /label），'auto' 为 LLM 自动摘要。
   *  §0.3.0 Task 4: 支持 (id, userId, agentId, label, source) 签名。 */
  async updateSessionLabel(id: string, label: string, source?: 'custom' | 'auto'): Promise<void>;
  async updateSessionLabel(id: string, userId: string, agentId: string, label: string, source?: 'custom' | 'auto'): Promise<void>;
  async updateSessionLabel(
    id: string,
    labelOrUserId: string,
    sourceOrAgentId?: 'custom' | 'auto' | string,
    labelOrUndefined?: string,
    source?: 'custom' | 'auto',
  ): Promise<void> {
    if (!isValidSessionId(id)) {
      throw new Error(`invalid sessionId: ${id}`);
    }
    await withJsonlLock(id, () => {
      if (typeof sourceOrAgentId === 'string' && (sourceOrAgentId === 'custom' || sourceOrAgentId === 'auto') && labelOrUndefined === undefined) {
        // Legacy: updateSessionLabel(id, label, source?)
        // §0.3.0 Task 4: 找到 session 实际 meta 路径并写入（可能在 new path）
        const existingMetaPath = this.findSessionMetaPathSync(id);
        const patch: SessionMetaFile = { label: labelOrUserId, labelSource: sourceOrAgentId };
        if (existingMetaPath) {
          this.writeMetaAtomicToPath(existingMetaPath, patch);
        } else {
          this.writeMetaAtomic(id, patch);
        }
      } else if (sourceOrAgentId !== undefined && labelOrUndefined !== undefined) {
        // New: updateSessionLabel(id, userId, agentId, label, source?)
        const userId = labelOrUserId;
        const agentId = sourceOrAgentId;
        const label = labelOrUndefined;
        this.writeMetaAtomicNew(id, userId, agentId, { label, labelSource: source ?? 'custom' });
      } else {
        // Legacy default: updateSessionLabel(id, label)
        // §0.3.0 Task 4: 找到 session 实际 meta 路径并写入
        const existingMetaPath = this.findSessionMetaPathSync(id);
        const patch: SessionMetaFile = { label: labelOrUserId, labelSource: 'custom' };
        if (existingMetaPath) {
          this.writeMetaAtomicToPath(existingMetaPath, patch);
        } else {
          this.writeMetaAtomic(id, patch);
        }
      }
      return Promise.resolve();
    });
  }

  /** §4.10 Task 10: 是否已有用户手动设置的 custom label（永久跳过自动摘要）。
   *  §0.3.0 Task 4: 2-arg legacy 形式查找 session 实际 meta 路径（可能在 new path）。 */
  async hasCustomLabel(id: string): Promise<boolean>;
  async hasCustomLabel(id: string, userId: string, agentId: string): Promise<boolean>;
  async hasCustomLabel(id: string, userId?: string, agentId?: string): Promise<boolean> {
    if (!isValidSessionId(id)) return false;
    if (userId !== undefined && agentId !== undefined) {
      return this.readMetaNew(id, userId, agentId).labelSource === 'custom';
    }
    // §0.3.0 Task 4: 找到 session 实际 meta 路径并读取
    const existingMetaPath = this.findSessionMetaPathSync(id);
    if (existingMetaPath) {
      return this.readMetaFromPath(existingMetaPath).labelSource === 'custom';
    }
    return this.readMeta(id).labelSource === 'custom';
  }

  /** Task 5 C2 fix: 读取 session 当前 owner
   *  §0.3.0 Task 4: 委托 findSessionOwnerSync 避免递归扫描逻辑重复 */
  async getSessionOwner(id: string): Promise<string | undefined> {
    if (!isValidSessionId(id)) return undefined;
    return this.findSessionOwnerSync(id);
  }

  /**
   * 强制覆盖 session owner（用于 agent 共享 session 转移给当前登录用户）。
   * 与 claimSession 不同：跨用户 claim 不抛错，直接覆盖。
   *
   * §0.3.0 Task 4: 找到旧 meta 并删除（避免 getSessionOwner 返回旧 owner），
   * 然后写新 meta 到新路径。
   */
  async forceClaimSession(id: string, userId: string): Promise<void>;
  async forceClaimSession(id: string, userId: string, agentId: string): Promise<void>;
  async forceClaimSession(id: string, userId: string, agentId?: string): Promise<void> {
    if (!isValidSessionId(id)) {
      throw new Error(`invalid sessionId: ${id}`);
    }
    await withJsonlLock(id, () => {
      if (agentId !== undefined) {
        // §0.3.0 Task 4: 找到旧 meta 路径并删除
        const oldMetaPath = this.findSessionMetaPathSync(id);
        const newMetaPath = this.resolveNewMetaPath(id, userId, agentId);
        if (oldMetaPath && oldMetaPath !== newMetaPath && existsSync(oldMetaPath)) {
          try {
            unlinkSync(oldMetaPath);
          } catch (err) {
            metaLog.warn('forceClaimSession failed to delete old meta', { path: oldMetaPath, error: String(err) });
          }
        }
        this.writeMetaAtomicToPath(newMetaPath, { userId, agentId });
      } else {
        this.writeMetaAtomic(id, { userId });
      }
      return Promise.resolve();
    });
  }

  /**
   * §0.3.0 Task 4: 查找 session 现有 meta 文件路径（同步）。
   * 检查顺序：legacy path → legacy fallback → recursive scan。
   * 返回找到的第一个 meta 文件路径（不存在返回 undefined）。
   */
  private findSessionMetaPathSync(id: string): string | undefined {
    if (!isValidSessionId(id)) return undefined;
    // 1. Legacy path
    const legacyMetaPath = this.resolveLegacyMetaPath(id);
    if (existsSync(legacyMetaPath)) return legacyMetaPath;
    // 2. Legacy fallback
    const legacyFallbackMetaPath = this.resolveLegacyFallbackMetaPath(id);
    if (existsSync(legacyFallbackMetaPath)) return legacyFallbackMetaPath;
    // 3. Recursive scan
    const usersDir = join(this.dataDir, 'users');
    if (existsSync(usersDir)) {
      try {
        const userDirs = readdirSync(usersDir);
        for (const userDir of userDirs) {
          if (!USER_ID_REGEX.test(userDir)) continue;
          const agentsDir = join(usersDir, userDir, 'agents');
          if (!existsSync(agentsDir)) continue;
          const agentDirs = readdirSync(agentsDir);
          for (const agentDir of agentDirs) {
            if (!AGENT_SLUG_REGEX.test(agentDir)) continue;
            const sessionsDir = join(agentsDir, agentDir, 'sessions');
            if (!existsSync(sessionsDir)) continue;
            const metaPath = join(sessionsDir, `${id}.meta.json`);
            if (existsSync(metaPath)) return metaPath;
          }
        }
      } catch (err) {
        metaLog.warn('findSessionMetaPathSync recursive scan failed', { id, error: String(err) });
      }
    }
    return undefined;
  }
}
