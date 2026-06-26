import { mkdirSync, appendFileSync, existsSync, readFileSync } from 'node:fs';
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
