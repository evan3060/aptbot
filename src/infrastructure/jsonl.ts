import { mkdirSync, appendFileSync, existsSync, readFileSync, writeFileSync, truncateSync, statSync, copyFileSync } from 'node:fs';
import { dirname } from 'node:path';

/**
 * §10.11 appendJsonl: 将 entry 用 JSON.stringify 序列化 + `\n` (LF)。
 * 首次写入时 mkdirp 递归创建目录（权限 0o755）。
 * 文件编码 UTF-8 无 BOM，文件末尾保持 trailing newline。
 */
export async function appendJsonl(path: string, entry: unknown): Promise<void> {
  const dir = dirname(path);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true, mode: 0o755 });
  }
  const line = `${JSON.stringify(entry)}\n`;
  appendFileSync(path, line, { encoding: 'utf-8' });
}

/**
 * §10.11 readJsonl: 对不存在的文件返回 []。逐行解析非空行。
 * 破损行容错由 readJsonlTolerant (Task 8) 提供，这里抛错。
 */
export async function readJsonl(path: string): Promise<unknown[]> {
  if (!existsSync(path)) return [];
  const content = readFileSync(path, { encoding: 'utf-8' });
  const lines = content.split('\n');
  const entries: unknown[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed === '') continue;
    entries.push(JSON.parse(trimmed));
  }
  return entries;
}

/**
 * §10.1.1 readJsonlTolerant: 逐行解析；JSON.parse 失败时递增 skipped 并继续（不抛错）。
 * 处理空文件（skipped: 0）与全破损文件（entries: [], skipped: N）。
 */
export async function readJsonlTolerant(path: string): Promise<JsonlReadResult> {
  return readJsonlTolerantSync(path);
}

export interface JsonlReadResult {
  entries: unknown[];
  skipped: number;
}

export interface JsonlRepairResult {
  truncated: boolean;
  bytesRemoved: number;
  backedUp?: string;
}

/**
 * §10.1.1 repairJsonl: 若 readJsonlTolerant 报告 skipped > 0，重写文件仅保留合法行。
 * 使用 truncateSync + writeFileSync 截断破损尾部数据。
 * 完全损坏时备份原文件到 <path>.corrupt.bak 后返回空文件。
 */
export async function repairJsonl(path: string): Promise<JsonlRepairResult> {
  if (!existsSync(path)) {
    return { truncated: false, bytesRemoved: 0 };
  }
  const before = statSync(path).size;
  const result = readJsonlTolerantSync(path);
  if (result.skipped === 0) {
    return { truncated: false, bytesRemoved: 0 };
  }
  // 完全损坏（entries 全空）时备份原文件
  if (result.entries.length === 0) {
    const backup = `${path}.corrupt.bak`;
    copyFileSync(path, backup);
    truncateSync(path, 0);
    return { truncated: true, bytesRemoved: before, backedUp: backup };
  }
  // 部分损坏：重写为仅含合法行
  const validContent = result.entries
    .map((e) => JSON.stringify(e))
    .join('\n') + '\n';
  truncateSync(path, 0);
  writeFileSync(path, validContent, { encoding: 'utf-8' });
  const after = statSync(path).size;
  return {
    truncated: true,
    bytesRemoved: before - after,
  };
}

function readJsonlTolerantSync(path: string): JsonlReadResult {
  if (!existsSync(path)) return { entries: [], skipped: 0 };
  const content = readFileSync(path, { encoding: 'utf-8' });
  const lines = content.split('\n');
  const entries: unknown[] = [];
  let skipped = 0;
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed === '') continue;
    try {
      entries.push(JSON.parse(trimmed));
    } catch {
      skipped++;
    }
  }
  return { entries, skipped };
}
