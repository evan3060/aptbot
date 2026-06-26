import pino, { type Level } from 'pino';
import {
  mkdirSync,
  appendFileSync,
  existsSync,
  statSync,
  renameSync,
  unlinkSync,
} from 'node:fs';
import { Writable } from 'node:stream';

export type LogLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error';

export interface Logger {
  readonly scope: string;
  readonly threshold: LogLevel;
  trace(msg: string, ...args: unknown[]): void;
  debug(msg: string, ...args: unknown[]): void;
  info(msg: string, ...args: unknown[]): void;
  warn(msg: string, ...args: unknown[]): void;
  error(msg: string, ...args: unknown[]): void;
  child(scope: string): Logger;
}

const LOG_DIR = './logs';
const LOG_FILE = `${LOG_DIR}/aptbot.log`;
const ROTATION_SIZE = 10 * 1024 * 1024; // 10MB
const KEEP_FILES = 5;

const LEVEL_PRIORITY: Record<LogLevel, number> = {
  trace: 10,
  debug: 20,
  info: 30,
  warn: 40,
  error: 50,
};

const LEVEL_TO_PINO: Record<LogLevel, Level> = {
  trace: 'trace',
  debug: 'debug',
  info: 'info',
  warn: 'warn',
  error: 'error',
};

/**
 * §10.7 maskSecret: 将 aptbot_XXX 形态 token / apiKey 替换为 aptbot_***。
 * 同时对 JSON 字段（apiKey/token/authorization）中的非 aptbot_ 值脱敏为 ***。
 */
export function maskSecret(value: string): string {
  // 先处理 JSON 字段值：aptbot_xxx → aptbot_***，其它值 → ***
  let masked = value.replace(
    /("(?:apiKey|token|authorization|api_key)"\s*:\s*")([^"]*)(")/gi,
    (_match, prefix, val: string, suffix) => {
      if (val.startsWith('aptbot_')) return `${prefix}aptbot_***${suffix}`;
      return `${prefix}***${suffix}`;
    },
  );
  // 再处理裸字符串中的 aptbot_xxx token
  masked = masked.replace(/aptbot_[A-Za-z0-9_-]+/g, 'aptbot_***');
  return masked;
}

function ensureLogDir(): void {
  if (!existsSync(LOG_DIR)) {
    mkdirSync(LOG_DIR, { recursive: true });
  }
}

/**
 * §10.7 rotation: 文件超过 10MB 时滚动为 aptbot.log.1 ~ aptbot.log.5。
 */
function rotateIfNeeded(): void {
  if (!existsSync(LOG_FILE)) return;
  const stat = statSync(LOG_FILE);
  if (stat.size < ROTATION_SIZE) return;
  // 删除最旧
  if (existsSync(`${LOG_FILE}.${KEEP_FILES}`)) {
    unlinkSync(`${LOG_FILE}.${KEEP_FILES}`);
  }
  // 依次重命名 .4 -> .5, .3 -> .4, ... .1 -> .2
  for (let i = KEEP_FILES - 1; i >= 1; i--) {
    const from = `${LOG_FILE}.${i}`;
    const to = `${LOG_FILE}.${i + 1}`;
    if (existsSync(from)) renameSync(from, to);
  }
  // 当前文件 -> .1
  renameSync(LOG_FILE, `${LOG_FILE}.1`);
}

function resolveThreshold(env?: string | undefined): LogLevel {
  const raw = (env ?? process.env.LOG_LEVEL ?? 'info').toLowerCase();
  if (raw in LEVEL_PRIORITY) return raw as LogLevel;
  return 'info';
}

/**
 * 同步写入文件 + stdout 的 Writable。
 * 每次 write 立即 flush 到磁盘，保证测试可读。
 */
function createSyncDestination(): Writable {
  return new Writable({
    write(chunk: Buffer, _encoding, callback) {
      try {
        const line = chunk.toString('utf-8');
        // stdout
        process.stdout.write(line);
        // file (append)
        ensureLogDir();
        rotateIfNeeded();
        appendFileSync(LOG_FILE, line, { encoding: 'utf-8' });
        callback();
      } catch (err) {
        callback(err as Error);
      }
    },
  });
}

class SyncFileLogger implements Logger {
  private readonly pinoLogger: pino.Logger;
  public readonly threshold: LogLevel;

  constructor(
    public readonly scope: string,
    threshold?: LogLevel | undefined,
  ) {
    this.threshold = threshold ?? resolveThreshold();
    ensureLogDir();
    const destination = createSyncDestination();
    this.pinoLogger = pino(
      {
        name: 'aptbot',
        level: LEVEL_TO_PINO[this.threshold],
        base: { scope },
        messageKey: 'msg',
        timestamp: () => `,"ts":${Date.now()}`,
      },
      destination,
    );
  }

  private emit(level: LogLevel, msg: string, args: unknown[]): void {
    if (LEVEL_PRIORITY[level] < LEVEL_PRIORITY[this.threshold]) return;
    const masked = maskSecret(msg);
    const props = this.collectProps(args);
    if (props) {
      const maskedProps = maskSecret(JSON.stringify(props));
      try {
        const obj = JSON.parse(maskedProps);
        (this.pinoLogger[level] as (obj: object, msg: string) => void)(
          obj,
          masked,
        );
      } catch {
        (this.pinoLogger[level] as (msg: string, ...rest: unknown[]) => void)(
          masked,
          ...args,
        );
      }
    } else {
      (this.pinoLogger[level] as (msg: string, ...rest: unknown[]) => void)(
        masked,
      );
    }
  }

  private collectProps(args: unknown[]): Record<string, unknown> | null {
    const props: Record<string, unknown> = {};
    let has = false;
    for (const a of args) {
      if (a && typeof a === 'object' && !Array.isArray(a)) {
        Object.assign(props, a);
        has = true;
      }
    }
    return has ? props : null;
  }

  trace(msg: string, ...args: unknown[]): void {
    this.emit('trace', msg, args);
  }
  debug(msg: string, ...args: unknown[]): void {
    this.emit('debug', msg, args);
  }
  info(msg: string, ...args: unknown[]): void {
    this.emit('info', msg, args);
  }
  warn(msg: string, ...args: unknown[]): void {
    this.emit('warn', msg, args);
  }
  error(msg: string, ...args: unknown[]): void {
    this.emit('error', msg, args);
  }
  child(subScope: string): Logger {
    return new SyncFileLogger(`${this.scope}:${subScope}`, this.threshold);
  }
}

export function createLogger(scope: string, threshold?: LogLevel): Logger {
  return new SyncFileLogger(scope, threshold);
}
