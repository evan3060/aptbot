import { stat, readdir, readFile, realpath } from 'node:fs/promises';
import { basename } from 'node:path';
import type { FileInfo, FsError, Result } from './types.js';

/**
 * §8.5 / §8.6 / §4.8 ExecutionEnv：文件操作抽象。
 *
 * 设计要点：
 * - 框架内部使用，不暴露给 skill 实现者
 * - 所有文件操作返回 Result<T, FsError>，避免 try/catch 污染调用方
 * - cwd / env / permissions 暴露给框架以适配 Web/CLI 等不同环境
 * - 后续多渠道（IM/WS）可提供不同实现
 */
export interface ExecutionEnv {
  /** 当前工作目录（绝对路径） */
  readonly cwd: string;
  /** 环境变量只读快照（值可能为 undefined，对齐 NodeJS.ProcessEnv） */
  readonly env: Readonly<Record<string, string | undefined>>;
  /** 权限策略 */
  readonly permissions: ExecutionPermissions;
  fileInfo(path: string): Promise<Result<FileInfo, FsError>>;
  readTextFile(path: string): Promise<Result<string, FsError>>;
  listDir(path: string): Promise<Result<FileInfo[], FsError>>;
  canonicalPath(path: string): Promise<Result<string, FsError>>;
}

/** 权限策略，用于后续安全检查（MVP 仅暴露字段，不做强制） */
export interface ExecutionPermissions {
  /** 是否仅允许 owner 读写文件（默认 true） */
  readonly ownerOnly: boolean;
  /** 是否限制 cwd 在 skill 目录内 */
  readonly restrictToCwd: boolean;
}

export const DEFAULT_PERMISSIONS: ExecutionPermissions = {
  ownerOnly: true,
  restrictToCwd: true,
};

/** 将 node:fs 错误转换为 FsError */
function toFsError(path: string, err: unknown): FsError {
  const code = (err as NodeJS.ErrnoException | undefined)?.code;
  const message = (err as Error | undefined)?.message ?? String(err);
  if (code === 'ENOENT') return { kind: 'not_found', path, message };
  if (code === 'EACCES' || code === 'EPERM') {
    return { kind: 'permission_denied', path, message };
  }
  return { kind: 'io_error', path, message };
}

/**
 * Node.js 环境 ExecutionEnv 实现，基于 node:fs/promises。
 * 用于 CLI / 测试环境。后续多渠道可提供不同实现。
 */
export function createNodeExecutionEnv(
  cwd: string,
  options?: {
    readonly env?: Readonly<Record<string, string>>;
    readonly permissions?: ExecutionPermissions;
  },
): ExecutionEnv {
  return {
    cwd,
    env: options?.env ?? process.env,
    permissions: options?.permissions ?? DEFAULT_PERMISSIONS,
    async fileInfo(path: string): Promise<Result<FileInfo, FsError>> {
      try {
        const s = await stat(path, { bigint: true });
        return {
          ok: true,
          value: {
            path,
            name: basename(path),
            isDirectory: s.isDirectory(),
            size: Number(s.size),
            mtimeNs: s.mtimeNs,
          },
        };
      } catch (err) {
        return { ok: false, error: toFsError(path, err) };
      }
    },
    async readTextFile(path: string): Promise<Result<string, FsError>> {
      try {
        const content = await readFile(path, 'utf-8');
        return { ok: true, value: content };
      } catch (err) {
        return { ok: false, error: toFsError(path, err) };
      }
    },
    async listDir(path: string): Promise<Result<FileInfo[], FsError>> {
      try {
        const entries = await readdir(path, { withFileTypes: true });
        const infos: FileInfo[] = [];
        for (const entry of entries) {
          try {
            const s = await stat(`${path}/${entry.name}`, { bigint: true });
            infos.push({
              path: `${path}/${entry.name}`,
              name: entry.name,
              isDirectory: entry.isDirectory(),
              size: Number(s.size),
              mtimeNs: s.mtimeNs,
            });
          } catch {
            // 单个 entry 失败跳过，不影响整个目录列举
          }
        }
        return { ok: true, value: infos };
      } catch (err) {
        return { ok: false, error: toFsError(path, err) };
      }
    },
    async canonicalPath(path: string): Promise<Result<string, FsError>> {
      try {
        const resolved = await realpath(path);
        return { ok: true, value: resolved };
      } catch (err) {
        return { ok: false, error: toFsError(path, err) };
      }
    },
  };
}
