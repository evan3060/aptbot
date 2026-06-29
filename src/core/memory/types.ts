import type { AgentMessage } from './agent-message.js';

export type SessionEntry =
  | { type: 'message'; id: string; message: AgentMessage; timestamp: number }
  | {
      type: 'compaction';
      id: string;
      summary: string;
      tokensBefore: number;
      firstKeptEntryId: string;
      timestamp: number;
    }
  | { type: 'label'; id: string; label: string; timestamp: number }
  | { type: 'working_memory'; id: string; keyInfo: string; timestamp: number };

export interface SessionMetadata {
  readonly id: string;
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly label?: string;
  readonly passedSessions?: number;
  /** Task 5: session 所属用户（未 claim 时为 undefined） */
  readonly userId?: string;
}

export interface Session {
  readonly id: string;
  readonly metadata: SessionMetadata;
  getEntries(): Promise<SessionEntry[]>;
  append(entry: SessionEntry): Promise<void>;
  updateMetadata(patch: Partial<SessionMetadata>): Promise<void>;
}

/**
 * §10.12 SESSION_ID_REGEX: UUID v4 格式（小写），用于路径遍历防护。
 */
export const SESSION_ID_REGEX = /^[a-f0-9-]{36}$/;
export const SESSIONS_DIR = './sessions';
export const MAX_PATH_LENGTH = 255;

/**
 * §10.12 getSessionPath: 返回 ./sessions/<sessionId>.jsonl。
 * sessionId 必须匹配 SESSION_ID_REGEX，否则抛错（路径遍历防护）。
 * 路径长度上限 255 字符。
 */
export function getSessionPath(sessionId: string): string {
  if (!SESSION_ID_REGEX.test(sessionId)) {
    throw new Error(`invalid sessionId (path traversal guard): ${sessionId}`);
  }
  const path = `${SESSIONS_DIR}/${sessionId}.jsonl`;
  if (path.length > MAX_PATH_LENGTH) {
    throw new Error(`session path exceeds MAX_PATH_LENGTH (${MAX_PATH_LENGTH})`);
  }
  return path;
}

/**
 * §10.12 isValidSessionId: 校验入站 ID。
 */
export function isValidSessionId(id: string): boolean {
  return SESSION_ID_REGEX.test(id);
}

/**
 * §10.10 nowTimestamp: ms 精度，UTC 存储。
 */
export function nowTimestamp(): number {
  return Date.now();
}
