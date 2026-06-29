import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { randomUUID, timingSafeEqual } from 'node:crypto';
import { WebSocketServer as WsServer, WebSocket } from 'ws';
import { createLogger } from '../infrastructure/logger.js';
import type { MessageBus, InboundMessage, AgentEventEnvelope } from '../bus/types.js';
import { type UserStorage, UsernameExistsError } from '../infrastructure/user-storage.js';

const log = createLogger('websocket-server');

export const WS_MAX_CONNECTIONS = 50;
export const WS_INBOUND_CONTENT_MAX_BYTES = 64 * 1024;
export const WS_INBOUND_MEDIA_MAX_BYTES = 5 * 1024 * 1024;
export const WS_INBOUND_RATE_LIMIT_PER_SEC = 10;
export const WS_HEARTBEAT_TIMEOUT_MS = 60000;
export const WS_HEARTBEAT_INTERVAL_MS = 30000;
export const WS_OUTBOUND_BUFFER_MAX = 1000;
const RATE_LIMIT_WINDOW_MS = 1000;
const RATE_LIMIT_WARN_THRESHOLD = 3;

export interface WebSocketServerOptions {
  port: number;
  bus: MessageBus;
  authToken?: string;
  /** 绑定地址，未指定时默认 0.0.0.0（LAN 可访问）。反代部署应设为 127.0.0.1 */
  host?: string;
  /** 若提供，HTTP GET / 将返回此 HTML（用于服务最小化聊天页面） */
  serveHtml?: string;
  /** Task 3: 用户存储，启用后支持 POST /api/register /api/login GET /api/me */
  userStorage?: UserStorage;
}

export interface WebSocketServer {
  stop(): Promise<void>;
  getActiveConnections(): number;
  broadcast(envelope: AgentEventEnvelope): void;
}

interface ConnectionState {
  messageTimestamps: number[];
  rateLimitWarnings: number;
  isAlive: boolean;
  userId: string;       // Task 4: 从 token 解析或匿名生成
  username?: string;    // Task 4: 注册用户有 username，匿名用户无
  sessionKey?: string;  // Task 5 填充
}

/** Task 4: 共享 authToken 的固定 userId */
const SHARED_USER_ID = '__shared__';

/** Task 4 M1: 常量时间比较 authToken，防时序攻击 */
function safeEqualAuthToken(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

/**
 * Task 4: 识别用户身份
 * 优先级：用户 token > authToken > 匿名 UUID
 * 返回 null 表示认证失败（应拒绝连接）
 */
async function identifyUser(
  token: string | null,
  authToken: string | undefined,
  userStorage: UserStorage | undefined,
): Promise<{ userId: string; username?: string } | null> {
  if (!token) {
    // 无 token：有 userStorage 时生成匿名 UUID；无 userStorage 且有 authToken 时拒绝；都无时接受为匿名
    if (userStorage) {
      return { userId: randomUUID() };
    }
    if (authToken) {
      return null; // 要求 token 但未提供
    }
    return { userId: randomUUID() }; // 开发模式：无任何认证
  }

  // 有 token：先尝试用户 token
  if (userStorage) {
    const user = await userStorage.findByToken(token);
    if (user) {
      return { userId: user.userId, username: user.username };
    }
  }

  // 用户 token 无效：尝试 authToken（常量时间比较）
  if (authToken && safeEqualAuthToken(token, authToken)) {
    return { userId: SHARED_USER_ID };
  }

  // 有 userStorage 时，无效 token 拒绝（不回退匿名）
  if (userStorage) {
    return null;
  }

  // 无 userStorage 但有 authToken：token 不匹配则拒绝
  if (authToken) {
    return null;
  }

  // 无 userStorage 无 authToken：不应到达此处（token 为非空但无验证机制），按匿名处理
  return { userId: randomUUID() };
}

/**
 * §10.1.4 startWebSocketServer: 启动 WebSocket 服务器。
 * - 最大 50 连接
 * - 入站 content 上限 64KB，超出返回 inbound_too_large 并关闭
 * - 频率 10/秒，超出返回 rate_limited，连续 3 次关闭
 * - authToken 可选，通过 query parameter ?token= 验证
 */
export function startWebSocketServer(options: WebSocketServerOptions): Promise<WebSocketServer> {
  return new Promise((resolve, reject) => {
    const { port, bus, authToken, serveHtml, host, userStorage } = options;
    const httpServer = createServer((req, res) => {
      const pathname = new URL(req.url ?? '/', `http://localhost:${port}`).pathname;

      // Task 3: 认证 API 端点
      if (userStorage && pathname.startsWith('/api/')) {
        handleAuthApi(req, res, pathname, userStorage);
        return;
      }

      // 服务最小化聊天页面（部署用）
      // 用 pathname 匹配，忽略 query string（如 ?token=xxx）
      if (serveHtml && req.method === 'GET' && (pathname === '/' || pathname === '/index.html')) {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        res.end(serveHtml);
        return;
      }
      res.writeHead(404, { 'content-type': 'text/plain' });
      res.end('Not Found');
    });
    const wss = new WsServer({ server: httpServer });
    const connections = new Map<WebSocket, ConnectionState>();
    // I1+I2 修复：per-server ring buffer，存储最近 WS_OUTBOUND_BUFFER_MAX 条 envelope 供重连重放
    const ringBuffer: AgentEventEnvelope[] = [];

    wss.on('connection', (ws, req) => {
      const url = new URL(req.url ?? '', `http://localhost:${port}`);
      const token = url.searchParams.get('token');

      // Task 4 I1/I2 修复：同步注册 close 监听器，防止 identifyUser 期间断开导致泄漏
      let closed = false;
      ws.once('close', () => { closed = true; });

      // Task 4 I2 修复：提前缓冲 identifyUser 期间到达的消息
      const earlyMessages: Buffer[] = [];
      const earlyMessageHandler = (data: Buffer) => { earlyMessages.push(data); };
      ws.on('message', earlyMessageHandler);

      // Task 4: 异步识别用户身份
      identifyUser(token, authToken, userStorage).then((identity) => {
        if (closed) return; // 连接已在认证期间关闭

        if (identity === null) {
          safeSend(ws, { type: 'error', code: 'auth_failed', message: 'Invalid or missing auth token' });
          ws.close();
          return;
        }

        // Connection limit
        if (connections.size >= WS_MAX_CONNECTIONS) {
          safeSend(ws, { type: 'error', code: 'max_connections', message: 'Server at capacity' });
          ws.close();
          return;
        }

        const state: ConnectionState = {
          messageTimestamps: [],
          rateLimitWarnings: 0,
          isAlive: true,
          userId: identity.userId,
          username: identity.username,
        };
        connections.set(ws, state);

        // 移除早期消息缓冲处理器，切换到正式处理器
        ws.removeListener('message', earlyMessageHandler);

        // Task 4: 有 userStorage 时发送 user_identified 事件
        if (userStorage) {
          safeSend(ws, { type: 'user_identified', userId: identity.userId, username: identity.username });
        }

        // I1 修复：resync 协议 — 客户端携带 lastEventSeq 重连时重放缓冲事件
        const lastEventSeqStr = url.searchParams.get('lastEventSeq');
        if (lastEventSeqStr !== null) {
          const lastEventSeq = parseInt(lastEventSeqStr, 10);
          if (!Number.isNaN(lastEventSeq)) {
            replayBufferedEvents(ws, ringBuffer, lastEventSeq);
          }
        }

        // C11 修复：heartbeat — pong 回来标记存活
        ws.on('pong', () => {
          state.isAlive = true;
        });

        ws.on('message', (data) => {
          handleMessage(ws, state, data as Buffer, bus);
        });

        // 重放缓冲的早期消息
        for (const msg of earlyMessages) {
          handleMessage(ws, state, msg, bus);
        }

        ws.on('close', () => {
          connections.delete(ws);
          log.info('connection closed', { connections: connections.size });
        });

        ws.on('error', (err) => {
          log.error('connection error', { error: String(err) });
          connections.delete(ws);
        });

        log.info('connection established', {
          connections: connections.size,
          userId: identity.userId,
          username: identity.username,
        });
      }).catch((err) => {
        log.error('user identification failed', { error: String(err) });
        if (!closed) {
          safeSend(ws, { type: 'error', code: 'auth_failed', message: 'Authentication failed' });
          ws.close();
        }
      });
    });

    // C11 修复：heartbeat interval — 每 30s ping 全部连接，超时 60s 无 pong 则 terminate
    const heartbeatInterval = setInterval(() => {
      for (const [ws, state] of connections) {
        if (state.isAlive === false) {
          log.warn('heartbeat timeout, terminating connection', { connections: connections.size });
          ws.terminate();
          continue;
        }
        state.isAlive = false;
        ws.ping();
      }
    }, WS_HEARTBEAT_INTERVAL_MS);

    httpServer.listen(port, host, () => {
      log.info('websocket server started', { port, host: host ?? '0.0.0.0', connections: connections.size });
      resolve({
        async stop(): Promise<void> {
          clearInterval(heartbeatInterval);
          for (const [ws] of connections) {
            ws.removeAllListeners();
            ws.terminate();
          }
          connections.clear();
          ringBuffer.length = 0;
          wss.close();
          await new Promise<void>((r) => httpServer.close(() => r()));
        },
        getActiveConnections(): number {
          return connections.size;
        },
        broadcast(envelope: AgentEventEnvelope): void {
          // I1+I2 修复：push to ring buffer (evict oldest if at cap)
          ringBuffer.push(envelope);
          if (ringBuffer.length > WS_OUTBOUND_BUFFER_MAX) {
            ringBuffer.shift();
          }
          // 广播 {type:'event', seq, event} wrapper 给所有已连接客户端
          const payload = JSON.stringify({ type: 'event', seq: envelope.seq, event: envelope.event });
          for (const [ws] of connections) {
            if (ws.readyState === WebSocket.OPEN) {
              ws.send(payload);
            }
          }
        },
      });
    });

    httpServer.on('error', reject);
  });
}

/**
 * I1 修复：重放 ring buffer 中 seq > lastEventSeq 的 envelope。
 * 若 lastEventSeq 过旧（小于 buffer 最旧 seq - 1），发送 resync_required。
 */
function replayBufferedEvents(ws: WebSocket, ringBuffer: AgentEventEnvelope[], lastEventSeq: number): void {
  if (ringBuffer.length === 0) return;
  const oldestSeq = ringBuffer[0].seq;
  // 若客户端的 lastEventSeq 与 buffer 最旧 seq 之间有缺口，事件已丢失
  if (lastEventSeq < oldestSeq - 1) {
    safeSend(ws, { type: 'resync_required' });
    return;
  }
  // 重放 seq > lastEventSeq 的所有缓冲事件
  for (const env of ringBuffer) {
    if (env.seq > lastEventSeq) {
      safeSend(ws, { type: 'event', seq: env.seq, event: env.event });
    }
  }
}

function safeSend(ws: WebSocket, msg: unknown): void {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(msg));
  }
}

function handleMessage(
  ws: WebSocket,
  state: ConnectionState,
  data: Buffer,
  bus: MessageBus,
): void {
  let parsed: { type?: string; content?: string };
  try {
    const str = data.toString();
    parsed = JSON.parse(str);
  } catch {
    safeSend(ws, { type: 'error', code: 'invalid_json', message: 'Invalid JSON' });
    return;
  }

  const content = typeof parsed.content === 'string' ? parsed.content : '';

  // Size check
  if (content.length > WS_INBOUND_CONTENT_MAX_BYTES) {
    safeSend(ws, { type: 'error', code: 'inbound_too_large', message: 'Content exceeds size limit' });
    ws.close();
    return;
  }

  // Rate limiting (sliding window 1 second)
  const now = Date.now();
  state.messageTimestamps = state.messageTimestamps.filter((t) => now - t < RATE_LIMIT_WINDOW_MS);
  if (state.messageTimestamps.length >= WS_INBOUND_RATE_LIMIT_PER_SEC) {
    state.rateLimitWarnings++;
    safeSend(ws, { type: 'error', code: 'rate_limited', message: 'Rate limit exceeded' });
    if (state.rateLimitWarnings >= RATE_LIMIT_WARN_THRESHOLD) {
      ws.close();
    }
    return;
  }
  state.messageTimestamps.push(now);

  // Publish valid inbound message to bus
  if (parsed.type === 'message' && content) {
    const inbound: InboundMessage = {
      channel: 'websocket',
      senderId: 'ws-client',
      chatId: 'default',
      content,
      metadata: {},
    };
    bus.publishInbound(inbound).catch((err) => {
      log.error('failed to publish inbound', { error: String(err) });
    });
  }
}

/**
 * Task 3: 处理认证 API 端点
 * - POST /api/register { username, password } → { userId, username, token }
 * - POST /api/login    { username, password } → { userId, username, token }
 * - GET  /api/me       Authorization: Bearer <token> → { userId, username }
 */
async function handleAuthApi(
  req: IncomingMessage,
  res: ServerResponse,
  pathname: string,
  userStorage: UserStorage,
): Promise<void> {
  const sendJson = (status: number, body: unknown) => {
    res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(body));
  };

  try {
    if (pathname === '/api/register' && req.method === 'POST') {
      let body;
      try {
        body = await readJsonBody(req);
      } catch (err) {
        sendJson(err instanceof BodyTooLargeError ? 413 : 400, { error: 'invalid request body' });
        return;
      }
      // Task 3 I3: 类型与长度校验
      const validation = validateCredentials(body);
      if (!validation.ok) {
        sendJson(400, { error: validation.error });
        return;
      }
      try {
        const user = await userStorage.register(validation.username, validation.password);
        sendJson(200, { userId: user.userId, username: user.username, token: user.token });
      } catch (err) {
        // Task 3 I2: 区分 409 与 500
        if (err instanceof UsernameExistsError) {
          sendJson(409, { error: 'username already exists' });
        } else {
          log.error('register failed', { error: String(err) });
          sendJson(500, { error: 'internal server error' });
        }
      }
      return;
    }

    if (pathname === '/api/login' && req.method === 'POST') {
      let body;
      try {
        body = await readJsonBody(req);
      } catch (err) {
        sendJson(err instanceof BodyTooLargeError ? 413 : 400, { error: 'invalid request body' });
        return;
      }
      const validation = validateCredentials(body);
      if (!validation.ok) {
        sendJson(400, { error: validation.error });
        return;
      }
      const user = await userStorage.login(validation.username, validation.password);
      if (!user) {
        sendJson(401, { error: 'invalid credentials' });
        return;
      }
      sendJson(200, { userId: user.userId, username: user.username, token: user.token });
      return;
    }

    if (pathname === '/api/me' && req.method === 'GET') {
      const authHeader = req.headers.authorization;
      if (!authHeader?.startsWith('Bearer ')) {
        sendJson(401, { error: 'missing token' });
        return;
      }
      const token = authHeader.slice('Bearer '.length);
      const user = await userStorage.findByToken(token);
      if (!user) {
        sendJson(401, { error: 'invalid token' });
        return;
      }
      sendJson(200, { userId: user.userId, username: user.username });
      return;
    }

    sendJson(404, { error: 'not found' });
  } catch (err) {
    log.error('auth api error', { error: String(err), pathname });
    sendJson(500, { error: 'internal server error' });
  }
}

/** Task 3 I3: 输入校验 — 类型、长度、空白检查 */
const USERNAME_MAX = 64;
const PASSWORD_MAX = 256;
function validateCredentials(body: unknown): { ok: true; username: string; password: string } | { ok: false; error: string } {
  if (!body || typeof body !== 'object') {
    return { ok: false, error: 'invalid request body' };
  }
  const { username, password } = body as Record<string, unknown>;
  if (typeof username !== 'string' || typeof password !== 'string') {
    return { ok: false, error: 'username and password must be strings' };
  }
  const trimmedUsername = username.trim();
  if (trimmedUsername.length === 0 || trimmedUsername.length > USERNAME_MAX) {
    return { ok: false, error: `username must be 1-${USERNAME_MAX} characters` };
  }
  if (password.length === 0 || password.length > PASSWORD_MAX) {
    return { ok: false, error: `password must be 1-${PASSWORD_MAX} characters` };
  }
  return { ok: true, username: trimmedUsername, password };
}

class BodyTooLargeError extends Error {
  constructor() {
    super('body too large');
    this.name = 'BodyTooLargeError';
  }
}

function readJsonBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => {
      data += chunk;
      if (data.length > 64 * 1024) {
        reject(new BodyTooLargeError());
        req.destroy();
      }
    });
    req.on('end', () => {
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch (e) {
        reject(e);
      }
    });
    req.on('error', reject);
  });
}
