import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { randomUUID, timingSafeEqual } from 'node:crypto';
import { WebSocketServer as WsServer, WebSocket } from 'ws';
import { createLogger } from '../infrastructure/logger.js';
import type { MessageBus, InboundMessage, AgentEventEnvelope } from '../bus/types.js';
import { type UserStorage, UsernameExistsError } from '../infrastructure/user-storage.js';
import type { StorageAdapter } from '../infrastructure/storage/file-storage.js';

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
  /** Task 5: 连接未携带 ?session= 时使用的默认 sessionKey（通常为 server 当前活跃 sessionId） */
  fallbackSessionKey?: string;
  /** 获取 agent 当前内部 sessionId（用于 user_identified 事件和历史查询对齐） */
  getCurrentSessionId?: () => string;
  /** Task 5: 连接建立并绑定 sessionKey 后触发（用于 channelManager.bindSession） */
  onSessionBound?: (sessionKey: string, ws: WebSocket) => void;
  /** Task 5 C2 fix: 连接关闭且 sessionKey 无剩余连接时触发（用于 channelManager.unbindSession + ringBuffer 清理） */
  onSessionUnbound?: (sessionKey: string) => void;
  /** Task 5 C2 fix: session 存储引用，启用后 ?session= 会进行 ownership 检查 */
  sessionStorage?: StorageAdapter;
  /** 会话重命名后触发，用于广播 session_renamed 控制消息到同 session 其他连接 */
  onSessionRenamed?: (sessionId: string, label: string) => void;
}

export interface WebSocketServer {
  stop(): Promise<void>;
  getActiveConnections(): number;
  broadcast(envelope: AgentEventEnvelope): void;
  /** Task 6: 向指定 sessionKey 的所有 connection 发送原始消息（不走 ring buffer，不参与 seq 协议）。用于 session_changed 等控制消息。 */
  sendToSessionKey(sessionKey: string, msg: unknown): void;
}

interface ConnectionState {
  messageTimestamps: number[];
  rateLimitWarnings: number;
  isAlive: boolean;
  userId: string;       // Task 4: 从 token 解析或匿名生成
  username?: string;    // Task 4: 注册用户有 username，匿名用户无
  sessionKey?: string;  // Task 5 填充
  clientId: string;     // 验收修复：每连接唯一 ID，用于 user_message 事件区分发送者
}

/** Task 8: 出站事件 ring buffer 条目，附带 timestamp 用于历史回放合并排序 */
interface BufferedEvent {
  envelope: AgentEventEnvelope;
  timestamp: number;
}

/** Task 8: 入站消息 ring buffer 条目 */
interface BufferedInbound {
  content: string;
  timestamp: number;
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
 *
 * Task 5 修正：authToken 存在时（部署模式），无论是否有 userStorage 都要求 token。
 * userStorage 不绕过 authToken 的强制要求。仅当无 authToken 时才接受匿名连接。
 */
async function identifyUser(
  token: string | null,
  authToken: string | undefined,
  userStorage: UserStorage | undefined,
): Promise<{ userId: string; username?: string } | null> {
  // 有 authToken 时（部署模式），必须提供 token
  if (authToken && !token) {
    return null;
  }

  // 无 token 且无 authToken：开发模式，接受匿名
  if (!token) {
    return { userId: randomUUID() };
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

  // 有 userStorage 或 authToken 时，无效 token 拒绝
  if (userStorage || authToken) {
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
    const { port, bus, authToken, serveHtml, host, userStorage, fallbackSessionKey, getCurrentSessionId, onSessionBound, onSessionUnbound, sessionStorage, onSessionRenamed } = options;
    const httpServer = createServer((req, res) => {
      const pathname = new URL(req.url ?? '/', `http://localhost:${port}`).pathname;

      // Task 3: 认证 API 端点
      if (userStorage && pathname.startsWith('/api/')) {
        handleAuthApi(req, res, pathname, userStorage, sessionStorage, onSessionRenamed);
        return;
      }

      // 服务最小化聊天页面（部署用）
      // 用 pathname 匹配，忽略 query string（如 ?token=xxx）
      if (serveHtml && req.method === 'GET' && (pathname === '/' || pathname === '/index.html')) {
        res.writeHead(200, {
          'content-type': 'text/html; charset=utf-8',
          // 验收修复：禁止缓存，确保用户每次访问拿到最新 HTML（避免旧版前端逻辑残留）
          'cache-control': 'no-cache, no-store, must-revalidate',
        });
        res.end(serveHtml);
        return;
      }
      res.writeHead(404, { 'content-type': 'text/plain' });
      res.end('Not Found');
    });
    const wss = new WsServer({ server: httpServer });
    const connections = new Map<WebSocket, ConnectionState>();
    // Task 8: per-sessionKey 出站 ring buffer，存储 BufferedEvent（含 timestamp）
    const ringBuffers = new Map<string, BufferedEvent[]>();
    // Task 8: per-sessionKey 入站 ring buffer，存储 BufferedInbound
    const inboundBuffers = new Map<string, BufferedInbound[]>();
    // Task 5 C2 fix: 跟踪每个 sessionKey 的活跃连接数，归零时触发 onSessionUnbound
    const sessionRefCount = new Map<string, number>();

    function getRingBuffer(sessionKey: string): BufferedEvent[] {
      let buf = ringBuffers.get(sessionKey);
      if (!buf) {
        buf = [];
        ringBuffers.set(sessionKey, buf);
      }
      return buf;
    }

    /** Task 8: 获取或创建入站 buffer */
    function getInboundBuffer(sessionKey: string): BufferedInbound[] {
      let buf = inboundBuffers.get(sessionKey);
      if (!buf) {
        buf = [];
        inboundBuffers.set(sessionKey, buf);
      }
      return buf;
    }

    function incSessionRef(sessionKey: string): void {
      const c = sessionRefCount.get(sessionKey) ?? 0;
      sessionRefCount.set(sessionKey, c + 1);
    }

    function decSessionRef(sessionKey: string): void {
      const c = (sessionRefCount.get(sessionKey) ?? 0) - 1;
      if (c <= 0) {
        sessionRefCount.delete(sessionKey);
        // I4/I5 fix: 无剩余连接时清理 ringBuffer，避免内存泄漏
        ringBuffers.delete(sessionKey);
        // Task 8: 清理 inboundBuffer
        inboundBuffers.delete(sessionKey);
        // 通知 server.ts 解绑 channelManager
        if (onSessionUnbound) {
          try {
            onSessionUnbound(sessionKey);
          } catch (err) {
            log.error('onSessionUnbound callback failed', { error: String(err), sessionKey });
          }
        }
      } else {
        sessionRefCount.set(sessionKey, c);
      }
    }

    /**
     * Task 9: 向同 sessionKey 的所有活跃 connection 直发 presence 事件（排除触发者自己）。
     * 不经过 bus / ChannelManager，由 wsServer 直接发送。
     * onlineCount = 当前 sessionKey 的活跃 connection 数（含触发者，但触发者不收到）。
     * 设计理由：触发者无需被通知自己加入；其他连接需要知道在线人数变化。
     * 连接关闭时调用，触发者已从 connections 删除，自然不会收到。
     */
    function broadcastPresence(sessionKey: string, excludeWs?: WebSocket): void {
      let onlineCount = 0;
      for (const [, state] of connections) {
        if (state.sessionKey === sessionKey) onlineCount++;
      }
      const payload = JSON.stringify({ type: 'presence', onlineCount });
      for (const [ws, state] of connections) {
        if (ws === excludeWs) continue;
        if (state.sessionKey === sessionKey && ws.readyState === WebSocket.OPEN) {
          try {
            ws.send(payload);
          } catch (err) {
            log.warn('presence send failed for one connection', { error: String(err) });
          }
        }
      }
    }

    wss.on('connection', (ws, req) => {
      const url = new URL(req.url ?? '', `http://localhost:${port}`);
      const token = url.searchParams.get('token');
      // Task 5: 解析 ?session=，未提供时使用 fallbackSessionKey
      const sessionKey = url.searchParams.get('session') ?? fallbackSessionKey ?? randomUUID();

      // Task 4 I1/I2 修复：同步注册 close 监听器，防止 identifyUser 期间断开导致泄漏
      let closed = false;
      ws.once('close', () => { closed = true; });

      // Task 4 I2 修复：提前缓冲 identifyUser 期间到达的消息
      const earlyMessages: Buffer[] = [];
      const earlyMessageHandler = (data: Buffer) => { earlyMessages.push(data); };
      ws.on('message', earlyMessageHandler);

      // Task 4: 异步识别用户身份
      identifyUser(token, authToken, userStorage).then(async (identity) => {
        if (closed) return; // 连接已在认证期间关闭

        if (identity === null) {
          safeSend(ws, { type: 'error', code: 'auth_failed', message: 'Invalid or missing auth token' });
          ws.close();
          return;
        }

        // Task 5 C2 fix: ownership 检查 — 若 sessionStorage 与 userStorage 都提供，且 ?session= 显式指定，
        // 验证 session 当前 owner 与连接用户匹配（未 claim 时允许并自动 claim）
        // 例外：当 sessionKey === agentSessionId 时，agent session 是共享单实例，
        // 应该转移给当前登录用户，跳过严格 ownership 检查并 force claim
        const agentSessionIdForCheck = getCurrentSessionId ? getCurrentSessionId() : undefined;
        if (sessionStorage && userStorage && url.searchParams.has('session')) {
          const isAgentSharedSession = sessionKey === agentSessionIdForCheck;
          const currentOwner = await sessionStorage.getSessionOwner(sessionKey);
          if (isAgentSharedSession) {
            // agent 共享 session：强制转移给当前登录用户（覆盖旧 owner）
            if (currentOwner && currentOwner !== identity.userId) {
              log.info('agent session ownership transfer', {
                sessionKey,
                oldOwner: currentOwner,
                newOwner: identity.userId,
              });
            }
            try {
              await sessionStorage.forceClaimSession(sessionKey, identity.userId);
            } catch (err) {
              log.warn('forceClaimSession failed for agent session', { sessionKey, error: String(err) });
            }
          } else {
            // 普通 session：严格 ownership 检查
            if (currentOwner && currentOwner !== identity.userId) {
              log.warn('session ownership mismatch, rejecting', {
                sessionKey,
                currentOwner,
                attemptedUser: identity.userId,
              });
              safeSend(ws, { type: 'error', code: 'session_ownership_mismatch', message: 'Session belongs to another user' });
              ws.close();
              return;
            }
            // 未 claim 或同 user — 自动 claim
            try {
              await sessionStorage.claimSession(sessionKey, identity.userId);
            } catch (err) {
              // 并发场景下可能 SessionAlreadyClaimedError — 再次检查
              const owner = await sessionStorage.getSessionOwner(sessionKey);
              if (owner && owner !== identity.userId) {
                safeSend(ws, { type: 'error', code: 'session_ownership_mismatch', message: 'Session belongs to another user' });
                ws.close();
                return;
              }
            }
          }
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
          sessionKey,
          clientId: randomUUID(),
        };
        connections.set(ws, state);
        incSessionRef(sessionKey);

        // 移除早期消息缓冲处理器，切换到正式处理器
        ws.removeListener('message', earlyMessageHandler);

        // Task 4: 有 userStorage 时发送 user_identified 事件
        // 验收修复：携带 agent 真实 sessionId，使前端能对齐 localStorage 并查询正确的历史文件
        if (userStorage) {
          const agentSessionId = getCurrentSessionId ? getCurrentSessionId() : undefined;
          // 将 agent 当前 sessionId claim 给该用户（使 history API ownership 检查通过）
          if (agentSessionId && sessionStorage && agentSessionId !== sessionKey) {
            try {
              await sessionStorage.claimSession(agentSessionId, identity.userId);
            } catch (err) {
              log.warn('failed to claim agent session for user', { agentSessionId, error: String(err) });
            }
          }
          safeSend(ws, { type: 'user_identified', userId: identity.userId, username: identity.username, sessionId: agentSessionId, clientId: state.clientId });
        }

        // Task 9: presence 广播 — 通知同 sessionKey 的其他连接（不含自己）当前在线数
        broadcastPresence(sessionKey, ws);

        // I1 修复：resync 协议 — 客户端携带 lastEventSeq 重连时重放缓冲事件
        // Task 5: 仅重放该 sessionKey 的 buffer
        // Task 8: historyLimit 优先触发历史回放（inbound + outbound 合并）
        const lastEventSeqStr = url.searchParams.get('lastEventSeq');
        const historyLimitStr = url.searchParams.get('historyLimit');
        if (historyLimitStr !== null) {
          // Task 8: 历史回放 — 合并入站+出站消息，限制数量
          const parsed = parseInt(historyLimitStr, 10);
          const limit = Number.isNaN(parsed) || parsed <= 0 ? 20 : parsed;
          replayHistory(ws, getInboundBuffer(sessionKey), getRingBuffer(sessionKey), limit);
        } else if (lastEventSeqStr !== null) {
          const lastEventSeq = parseInt(lastEventSeqStr, 10);
          if (!Number.isNaN(lastEventSeq)) {
            replayBufferedEvents(ws, getRingBuffer(sessionKey), lastEventSeq);
          }
        }

        // C11 修复：heartbeat — pong 回来标记存活
        ws.on('pong', () => {
          state.isAlive = true;
        });

        ws.on('message', (data) => {
          handleMessage(ws, state, data as Buffer, bus, inboundBuffers);
        });

        // 重放缓冲的早期消息
        for (const msg of earlyMessages) {
          handleMessage(ws, state, msg, bus, inboundBuffers);
        }

        ws.on('close', () => {
          connections.delete(ws);
          // Task 9: presence 广播 — 通知剩余连接当前在线数
          broadcastPresence(sessionKey);
          // I4/I5 fix: 引用计数减一，归零时清理 ringBuffer + 通知 server.ts unbind
          decSessionRef(sessionKey);
          log.info('connection closed', { connections: connections.size, sessionKey });
        });

        ws.on('error', (err) => {
          log.error('connection error', { error: String(err) });
          connections.delete(ws);
          decSessionRef(sessionKey);
        });

        // Task 5: 触发 onSessionBound 回调，让 server.ts 调用 channelManager.bindSession
        if (onSessionBound) {
          try {
            onSessionBound(sessionKey, ws);
          } catch (err) {
            log.error('onSessionBound callback failed', { error: String(err) });
          }
        }

        log.info('connection established', {
          connections: connections.size,
          userId: identity.userId,
          username: identity.username,
          sessionKey,
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
          ringBuffers.clear();
          inboundBuffers.clear();
          sessionRefCount.clear();
          wss.close();
          await new Promise<void>((r) => httpServer.close(() => r()));
        },
        getActiveConnections(): number {
          return connections.size;
        },
        broadcast(envelope: AgentEventEnvelope): void {
          // Task 5: 仅向 sessionKey 匹配的 connection 发送，避免跨 session 串扰
          // Task 8: 存储 BufferedEvent（含 timestamp）供历史回放使用
          const ringBuffer = getRingBuffer(envelope.sessionKey);
          ringBuffer.push({ envelope, timestamp: Date.now() });
          if (ringBuffer.length > WS_OUTBOUND_BUFFER_MAX) {
            ringBuffer.shift();
          }
          // 广播 {type:'event', seq, event} wrapper 给 sessionKey 匹配的客户端
          const payload = JSON.stringify({ type: 'event', seq: envelope.seq, event: envelope.event });
          for (const [ws, state] of connections) {
            if (state.sessionKey === envelope.sessionKey && ws.readyState === WebSocket.OPEN) {
              ws.send(payload);
            }
          }
        },
        // Task 6: 向指定 sessionKey 的 connection 发送原始消息（控制消息，不进 ring buffer）
        // Task 6 M7 fix: 每个 ws.send 单独 try/catch，防止一个 socket 异常中断其他连接的投递
        sendToSessionKey(sessionKey: string, msg: unknown): void {
          const payload = JSON.stringify(msg);
          for (const [ws, state] of connections) {
            if (state.sessionKey === sessionKey && ws.readyState === WebSocket.OPEN) {
              try {
                ws.send(payload);
              } catch (err) {
                log.warn('sendToSessionKey failed for one connection', { error: String(err) });
              }
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
 *
 * Task 6 I1 fix: lastEventSeq=0 表示客户端为全新连接（如 session_changed 重连到新 sessionKey），
 * 此时回放整个 buffer 而非触发 resync，确保 /new 后的确认 turn 事件能送达。
 *
 * Task 8: ringBuffer 类型从 AgentEventEnvelope[] 改为 BufferedEvent[]（含 timestamp）。
 */
function replayBufferedEvents(ws: WebSocket, ringBuffer: BufferedEvent[], lastEventSeq: number): void {
  if (ringBuffer.length === 0) return;
  // lastEventSeq=0：全新连接，回放所有 buffer 内容
  if (lastEventSeq === 0) {
    for (const buf of ringBuffer) {
      safeSend(ws, { type: 'event', seq: buf.envelope.seq, event: buf.envelope.event });
    }
    return;
  }
  const oldestSeq = ringBuffer[0].envelope.seq;
  // 若客户端的 lastEventSeq 与 buffer 最旧 seq 之间有缺口，事件已丢失
  if (lastEventSeq < oldestSeq - 1) {
    safeSend(ws, { type: 'resync_required' });
    return;
  }
  // 重放 seq > lastEventSeq 的所有缓冲事件
  for (const buf of ringBuffer) {
    if (buf.envelope.seq > lastEventSeq) {
      safeSend(ws, { type: 'event', seq: buf.envelope.seq, event: buf.envelope.event });
    }
  }
}

/**
 * Task 8: 历史回放 — 合并入站+出站消息，按 timestamp 排序，限制数量后发送。
 * 回放消息格式：{ type: 'replay', replay: true, messages: [...] }
 * 每条 message 标记 replay: true，kind 区分 inbound/outbound。
 * 空历史时不发送 replay 消息。
 */
function replayHistory(
  ws: WebSocket,
  inboundBuffer: BufferedInbound[],
  outboundBuffer: BufferedEvent[],
  historyLimit: number,
): void {
  type MergedItem =
    | { kind: 'inbound'; timestamp: number; content: string }
    | { kind: 'outbound'; timestamp: number; event: AgentEventEnvelope['event']; seq: number };

  const merged: MergedItem[] = [
    ...inboundBuffer.map((m) => ({ kind: 'inbound' as const, timestamp: m.timestamp, content: m.content })),
    ...outboundBuffer.map((b) => ({ kind: 'outbound' as const, timestamp: b.timestamp, event: b.envelope.event, seq: b.envelope.seq })),
  ];
  merged.sort((a, b) => a.timestamp - b.timestamp);

  // Apply historyLimit — 保留全部 inbound（用户消息是关键上下文），outbound 取最近 N 条
  // 设计理由：流式 message_delta 可能产生大量 outbound 事件，若按总数 slice(-N) 会把
  // 早期的 inbound 用户消息挤出回放窗口，导致历史上下文丢失。
  const allInbound = merged.filter((m) => m.kind === 'inbound');
  const allOutbound = merged.filter((m) => m.kind === 'outbound');
  const limitedOutbound = allOutbound.slice(-historyLimit);
  const limited = [...allInbound, ...limitedOutbound].sort((a, b) => a.timestamp - b.timestamp);
  if (limited.length === 0) return;

  const messages = limited.map((m) => {
    const base = { kind: m.kind, timestamp: m.timestamp, replay: true };
    if (m.kind === 'inbound') {
      return { ...base, content: m.content };
    }
    return { ...base, event: m.event, seq: m.seq };
  });

  safeSend(ws, { type: 'replay', replay: true, messages });
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
  inboundBuffers: Map<string, BufferedInbound[]>,
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
    // Task 8: 缓存入站消息到 inboundBuffer，供历史回放使用
    if (state.sessionKey) {
      let inboundBuffer = inboundBuffers.get(state.sessionKey);
      if (!inboundBuffer) {
        inboundBuffer = [];
        inboundBuffers.set(state.sessionKey, inboundBuffer);
      }
      inboundBuffer.push({ content, timestamp: Date.now() });
      if (inboundBuffer.length > WS_OUTBOUND_BUFFER_MAX) {
        inboundBuffer.shift();
      }
    }
    const inbound: InboundMessage = {
      channel: 'websocket',
      senderId: 'ws-client',
      chatId: 'default',
      content,
      // Task 6 I2 fix: 携带发起方 sessionKey 和 userId，供 runInboundLoop 识别 /new 的来源连接
      // 验收修复：携带 clientId，供 user_message 事件区分发送者（跨客户端同步）
      metadata: {
        sessionKey: state.sessionKey,
        userId: state.userId,
        username: state.username,
        clientId: state.clientId,
      },
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
 * - GET  /api/sessions?token=<token> → { sessions: SessionMetadata[] } (Task 10)
 */
async function handleAuthApi(
  req: IncomingMessage,
  res: ServerResponse,
  pathname: string,
  userStorage: UserStorage,
  sessionStorage?: StorageAdapter,
  onSessionRenamed?: (sessionId: string, label: string) => void,
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

    // GET /api/sessions/:id/messages — 返回 session 历史消息（仅 message 条目）
    const messagesMatch = pathname.match(/^\/api\/sessions\/([a-f0-9-]{36})\/messages$/);
    if (messagesMatch && req.method === 'GET') {
      const sessionId = messagesMatch[1];
      const url = new URL(req.url ?? '', `http://localhost`);
      const queryToken = url.searchParams.get('token');
      const authHeader = req.headers.authorization;
      const bearerToken = authHeader?.startsWith('Bearer ') ? authHeader.slice('Bearer '.length) : null;
      const token = queryToken ?? bearerToken;
      if (!token) {
        sendJson(401, { error: 'missing token' });
        return;
      }
      const user = await userStorage.findByToken(token);
      if (!user) {
        sendJson(401, { error: 'invalid token' });
        return;
      }
      if (!sessionStorage) {
        sendJson(200, { messages: [] });
        return;
      }
      const owner = await sessionStorage.getSessionOwner(sessionId);
      if (!owner) {
        sendJson(404, { error: 'session not found' });
        return;
      }
      if (owner !== user.userId) {
        sendJson(403, { error: 'forbidden' });
        return;
      }
      const entries = await sessionStorage.readSession(sessionId);
      const messages = entries.filter((e) => e.type === 'message');
      sendJson(200, { messages });
      return;
    }

    // 会话重命名：POST /api/sessions/:id/label
    const labelMatch = pathname.match(/^\/api\/sessions\/([a-f0-9-]{36})\/label$/);
    if (labelMatch) {
      const sessionId = labelMatch[1];
      if (req.method !== 'POST') {
        sendJson(405, { error: 'method not allowed' });
        return;
      }
      const url = new URL(req.url ?? '', 'http://localhost');
      const queryToken = url.searchParams.get('token');
      const authHeader = req.headers.authorization;
      const bearerToken = authHeader?.startsWith('Bearer ') ? authHeader.slice('Bearer '.length) : null;
      const token = queryToken ?? bearerToken;
      if (!token) {
        sendJson(401, { error: 'missing token' });
        return;
      }
      const user = await userStorage.findByToken(token);
      if (!user) {
        sendJson(401, { error: 'invalid token' });
        return;
      }
      if (!sessionStorage) {
        sendJson(500, { error: 'session storage unavailable' });
        return;
      }
      const owner = await sessionStorage.getSessionOwner(sessionId);
      if (!owner) {
        sendJson(404, { error: 'session not found' });
        return;
      }
      if (owner !== user.userId) {
        sendJson(403, { error: 'forbidden' });
        return;
      }
      let body: unknown;
      try {
        body = await readJsonBody(req);
      } catch (err) {
        sendJson(err instanceof BodyTooLargeError ? 413 : 400, { error: 'invalid request body' });
        return;
      }
      if (!body || typeof body !== 'object' || typeof (body as { label?: unknown }).label !== 'string') {
        sendJson(400, { error: 'label must be a string' });
        return;
      }
      const label = ((body as { label: string }).label).trim().slice(0, 100);
      if (!label) {
        sendJson(400, { error: 'label must be a non-empty string' });
        return;
      }
      await sessionStorage.updateSessionLabel(sessionId, label);
      if (onSessionRenamed) {
        try {
          onSessionRenamed(sessionId, label);
        } catch (err) {
          log.error('onSessionRenamed callback failed', { error: String(err), sessionId });
        }
      }
      sendJson(200, { ok: true, label });
      return;
    }

    // Task 10: GET /api/sessions — 返回当前用户的 session 列表（按 userId 过滤）
    if (pathname === '/api/sessions' && req.method === 'GET') {
      const url = new URL(req.url ?? '', `http://localhost`);
      const queryToken = url.searchParams.get('token');
      const authHeader = req.headers.authorization;
      const bearerToken = authHeader?.startsWith('Bearer ') ? authHeader.slice('Bearer '.length) : null;
      const token = queryToken ?? bearerToken;
      if (!token) {
        sendJson(401, { error: 'missing token' });
        return;
      }
      const user = await userStorage.findByToken(token);
      if (!user) {
        sendJson(401, { error: 'invalid token' });
        return;
      }
      if (!sessionStorage) {
        sendJson(200, { sessions: [] });
        return;
      }
      const sessions = await sessionStorage.listSessions(user.userId);
      sendJson(200, { sessions });
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
