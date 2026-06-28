import { generateEntryId, type StorageAdapter } from '../../infrastructure/storage/file-storage.js';
import type { SessionEntry } from './types.js';

/**
 * §6.5 WorkingMemoryState: working memory 跨会话继承状态。
 * passedSessions 记录该 working memory 已被继承的次数。
 */
export interface WorkingMemoryState {
  keyInfo: string;
  passedSessions: number;
  inheritedFrom?: string;
}

const PS_ID_PREFIX = 'wm-ps';
const PS_ID_REGEX = /^wm-ps(\d+)-/;

/**
 * §6.5 loadWorkingMemory: 从 session entries 末尾反向查找最后一条 working_memory entry。
 * passedSessions 从 entry id 解析（若 id 由 inheritWorkingMemory 写入则带计数，否则为 0）。
 */
export async function loadWorkingMemory(
  sessionId: string,
  storage: StorageAdapter,
): Promise<WorkingMemoryState | null> {
  const entries = await storage.readSession(sessionId);
  for (let i = entries.length - 1; i >= 0; i--) {
    const e = entries[i];
    if (e.type === 'working_memory') {
      const match = e.id.match(PS_ID_REGEX);
      const passedSessions = match ? parseInt(match[1], 10) : 0;
      return { keyInfo: e.keyInfo, passedSessions };
    }
  }
  return null;
}

/**
 * §6.5 inheritWorkingMemory: 从 source session 读取最后一条 working_memory entry，
 * 写入 target session，passedSessions +1。
 * source 无 working memory 时返回空 keyInfo 但仍 +1 计数。
 * 通过 entry id 编码 passedSessions 以支持链式继承计数。
 */
export async function inheritWorkingMemory(
  sourceSessionId: string,
  targetSessionId: string,
  storage: StorageAdapter,
): Promise<WorkingMemoryState> {
  const source = await loadWorkingMemory(sourceSessionId, storage);
  const keyInfo = source?.keyInfo ?? '';
  const sourcePassed = source?.passedSessions ?? 0;
  const newPassed = sourcePassed + 1;

  const entry: SessionEntry = {
    type: 'working_memory',
    id: generateEntryId(`${PS_ID_PREFIX}${newPassed}-`),
    keyInfo,
    timestamp: Date.now(),
  };
  await storage.appendSession(targetSessionId, entry);

  return {
    keyInfo,
    passedSessions: newPassed,
    inheritedFrom: sourceSessionId,
  };
}
