import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { randomUUID, timingSafeEqual } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer as WsServer, WebSocket } from 'ws';
import { createLogger } from '../infrastructure/logger.js';
import type { MessageBus, InboundMessage, AgentEventEnvelope } from '../bus/types.js';
import { type UserStorage, UsernameExistsError } from '../infrastructure/user-storage.js';
import type { StorageAdapter } from '../infrastructure/storage/file-storage.js';
import type { ReplayMessage } from '../core/memory/session-repo.js';
import type { ArticleLoader } from '../learn/article-loader.js';
import type { ArticleLang } from '../learn/article-types.js';
import type { FeedbackStorage } from '../infrastructure/feedback-storage.js';
import { handleFeedbackApi } from './feedback-api.js';
import { createLearnListHtml, createLearnArticleHtml, createFeedbackHtml } from './learn-page.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const log = createLogger('websocket-server');

export const WS_MAX_CONNECTIONS = 50;
export const WS_INBOUND_CONTENT_MAX_BYTES = 64 * 1024;
export const WS_INBOUND_MEDIA_MAX_BYTES = 5 * 1024 * 1024;
export const WS_INBOUND_RATE_LIMIT_PER_SEC = 10;
export const WS_HEARTBEAT_TIMEOUT_MS = 60000;
export const WS_HEARTBEAT_INTERVAL_MS = 30000;
export const WS_OUTBOUND_BUFFER_MAX = 1000;
/** Task 1 (0.2.2): 全局 ring buffer 总条目上限，触发时按 LRU 淘汰最旧 sessionKey 的全部 buffer */
export const WS_GLOBAL_BUFFER_MAX = 50000;
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
  /** Task 4: 若提供，HTTP GET /demo、/demo/、/demo/index.html 将返回此 HTML（用于服务 demo 聊天页面） */
  serveDemoHtml?: string;
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
  /** Task 1 (0.2.2): 全局 ring buffer 总条目上限，触发时按 LRU 淘汰最旧 sessionKey 的全部 buffer。默认 50000 */
  globalBufferLimit?: number;
  /**
   * Task 3 (0.2.2): ring buffer 未命中时从 JSONL 读取历史的回调函数。
   * 仅限 wsServer 调用，不进入 agent 工具表（agent 仍受 data/sessions/ 访问禁令）。
   * 当 historyLimit 触发历史回放且 ring buffer（inbound + outbound）为空时调用。
   */
  readHistoryForReplay?: (sessionId: string, limit: number) => Promise<ReplayMessage[]>;
  /** Task 9 (0.2.3): 文章加载器，learnEnabled 时为 /learn /learn/:slug 提供数据 */
  articleLoader?: ArticleLoader;
  /** Task 9 (0.2.3): 反馈存储，feedbackEnabled 时为 /api/feedback 提供持久化 */
  feedbackStorage?: FeedbackStorage;
  /** Task 9 (0.2.3): 是否启用 /learn /learn/:slug 路由（landingPage && learnPage） */
  learnEnabled?: boolean;
  /** Task 9 (0.2.3): 是否启用 /feedback + /api/feedback 路由（默认 true） */
  feedbackEnabled?: boolean;
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

/** Task 4 (0.2.2): HttpOnly cookie 名称，存储用户 token */
const AUTH_COOKIE_NAME = 'aptbot_token';
/** Task 4 (0.2.2): cookie Max-Age 30 天（秒） */
const AUTH_COOKIE_MAX_AGE = 2592000;

/** Task 4 M1: 常量时间比较 authToken，防时序攻击 */
function safeEqualAuthToken(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

/** Task 4 (0.2.2): 解析 Cookie 头为 name→value 映射 */
function parseCookies(cookieHeader: string | undefined): Record<string, string> {
  const result: Record<string, string> = {};
  if (!cookieHeader) return result;
  for (const part of cookieHeader.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const name = part.slice(0, idx).trim();
    const value = part.slice(idx + 1).trim();
    if (name) result[name] = decodeURIComponent(value);
  }
  return result;
}

/** Task 4 (0.2.2): 判断请求是否为 HTTPS（req.socket.encrypted 或反代 X-Forwarded-Proto） */
function isHttpsRequest(req: IncomingMessage): boolean {
  return (req.socket as { encrypted?: boolean }).encrypted === true
    || req.headers['x-forwarded-proto'] === 'https';
}

/**
 * Task 4 (0.2.2): 构建 Set-Cookie 值，HTTPS 时附加 Secure 属性。
 *
 * Secure 属性仅在 HTTPS 下附加：浏览器会拒绝在 HTTP 连接上设置带 Secure 的 cookie，
 * 这会导致本地 localhost（http://）开发环境下 cookie 无法写入。因此 Secure 必须条件附加。
 */
function buildAuthCookieValue(token: string, isHttps: boolean): string {
  const parts = [
    `${AUTH_COOKIE_NAME}=${token}`,
    'HttpOnly',
    'SameSite=Strict',
    'Path=/',
    `Max-Age=${AUTH_COOKIE_MAX_AGE}`,
  ];
  if (isHttps) parts.push('Secure');
  return parts.join('; ');
}

/** Task 4 (0.2.2): 构建清除 cookie 的 Set-Cookie 值（Max-Age=0） */
function buildClearCookieValue(isHttps: boolean): string {
  const parts = [
    `${AUTH_COOKIE_NAME}=`,
    'HttpOnly',
    'SameSite=Strict',
    'Path=/',
    'Max-Age=0',
  ];
  if (isHttps) parts.push('Secure');
  return parts.join('; ');
}

/**
 * Task 4 (0.2.2): 从请求中提取 token，优先级 cookie > Authorization: Bearer > URL ?token=
 * 用于 HTTP API 端点（/api/me 等）。
 */
function extractAuthToken(req: IncomingMessage): string | null {
  // 1. Cookie（最高优先级，HttpOnly 防 XSS）
  const cookieHeader = req.headers.cookie;
  if (cookieHeader) {
    const cookies = parseCookies(cookieHeader);
    if (cookies[AUTH_COOKIE_NAME]) return cookies[AUTH_COOKIE_NAME];
  }
  // 2. Authorization: Bearer（兼容旧客户端 / 跨设备链接）
  const authHeader = req.headers.authorization;
  if (authHeader?.startsWith('Bearer ')) {
    return authHeader.slice('Bearer '.length);
  }
  // 3. URL ?token=（兼容旧客户端）
  const url = new URL(req.url ?? '', 'http://localhost');
  return url.searchParams.get('token');
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
    const { port, bus, authToken, serveHtml, serveDemoHtml, host, userStorage, fallbackSessionKey, getCurrentSessionId, onSessionBound, onSessionUnbound, sessionStorage, onSessionRenamed, globalBufferLimit, readHistoryForReplay, articleLoader, feedbackStorage, learnEnabled, feedbackEnabled } = options;
    const globalLimit = globalBufferLimit ?? WS_GLOBAL_BUFFER_MAX;
    // Task 9 (0.2.3): learnEnabled 默认 false；feedbackEnabled 默认 true
    const isLearnEnabled = learnEnabled === true;
    const isFeedbackEnabled = feedbackEnabled !== false;
    // Task 9 (0.2.3): HTML 响应头统一（所有 HTML 响应含 nosniff）
    const htmlHeaders = {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-cache, no-store, must-revalidate',
      'x-content-type-options': 'nosniff',
    };
    // Task 9 (0.2.3): /learn/:slug 文章不存在时的友好 404 HTML
    const learnNotFoundHtml = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<link rel="icon" href="data:,">
<title>文章不存在 - aptbot 知识体系</title>
<style>
  body { font-family: Inter, system-ui, "PingFang SC", sans-serif; padding: 80px 24px; text-align: center; color: rgb(39, 36, 34); }
  h1 { font-size: 32px; font-weight: 400; margin-bottom: 16px; }
  p { color: rgb(139, 133, 127); margin-bottom: 32px; }
  a { color: rgb(13, 113, 73); }
</style>
</head>
<body>
  <h1>文章不存在</h1>
  <p>你访问的文章不存在或已删除。</p>
  <a href="/learn">← 返回知识体系</a>
</body>
</html>`;

    /**
     * 从请求中解析用户语言偏好，优先级：
     * 1. URL query parameter ?lang=en|zh
     * 2. Cookie aptbot.lang
     * 3. Accept-Language header
     * 4. 默认 'zh'
     */
    function resolveLang(req: IncomingMessage): ArticleLang {
      const url = new URL(req.url ?? '/', 'http://localhost');
      const queryLang = url.searchParams.get('lang');
      if (queryLang === 'en') return 'en';
      if (queryLang === 'zh') return 'zh';

      const cookies = parseCookies(req.headers.cookie);
      const cookieLang = cookies['aptbot.lang'];
      if (cookieLang === 'en' || cookieLang === 'zh') return cookieLang;

      const acceptLanguage = req.headers['accept-language'];
      if (acceptLanguage) {
        const langs = acceptLanguage.split(',').map(s => s.trim().split(';')[0]);
        for (const l of langs) {
          if (l.startsWith('zh')) return 'zh';
          if (l.startsWith('en')) return 'en';
        }
      }

      return 'zh';
    }

    const httpServer = createServer((req, res) => {
      const pathname = new URL(req.url ?? '/', `http://localhost:${port}`).pathname;

      // Task 9 (0.2.3): /api/feedback 必须在 /api/* 之前判断（路由优先级）
      // /api/feedback 与 /api/feedback/:id/moderate 均由 handleFeedbackApi 处理
      if (pathname === '/api/feedback' || pathname.startsWith('/api/feedback/')) {
        const effectiveStorage = isFeedbackEnabled ? feedbackStorage : undefined;
        handleFeedbackApi(req, res, pathname, effectiveStorage, articleLoader, authToken);
        return;
      }

      // Task 3: 认证 API 端点
      if (userStorage && pathname.startsWith('/api/')) {
        handleAuthApi(req, res, pathname, userStorage, sessionStorage, onSessionRenamed);
        return;
      }

      // 服务最小化聊天页面（部署用）
      // 用 pathname 匹配，忽略 query string（如 ?token=xxx）
      if (serveHtml && req.method === 'GET' && (pathname === '/' || pathname === '/index.html')) {
        res.writeHead(200, htmlHeaders);
        res.end(serveHtml);
        return;
      }
      // Task 4: 服务 demo 聊天页面（landing page CTA 跳转目标）
      // 宽松匹配 /demo、/demo/、/demo/index.html；大小写敏感（/Demo 不匹配）
      // 仅在 serveDemoHtml 提供时启用，未提供时落到下方 404（clone 用户零影响）
      if (serveDemoHtml && req.method === 'GET' &&
          (pathname === '/demo' || pathname === '/demo/' || pathname === '/demo/index.html')) {
        res.writeHead(200, htmlHeaders);
        res.end(serveDemoHtml);
        return;
      }
      // Task 9 (0.2.3): /learn 列表页（仅 learnEnabled 且 articleLoader 提供时）
      if (isLearnEnabled && articleLoader && req.method === 'GET' && pathname === '/learn') {
        const lang = resolveLang(req);
        const html = createLearnListHtml(articleLoader.getState(), lang);
        res.writeHead(200, htmlHeaders);
        res.end(html);
        return;
      }
      // 静态图片资源：/learn/articles/images/*.png|jpg|svg
      if (isLearnEnabled && req.method === 'GET' && pathname.startsWith('/learn/articles/images/')) {
        const imagesDir = path.resolve(__dirname, '../learn/articles/images');
        const requested = path.resolve(__dirname, '../learn', pathname.replace(/^\/learn\//, ''));
        const rel = path.relative(imagesDir, requested);
        if (rel && !rel.startsWith('..') && !path.isAbsolute(rel)) {
          const ext = path.extname(requested).toLowerCase();
          const mimeMap: Record<string, string> = {
            '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
            '.gif': 'image/gif', '.svg': 'image/svg+xml', '.webp': 'image/webp',
          };
          const mime = mimeMap[ext];
          if (mime && existsSync(requested)) {
            try {
              const data = readFileSync(requested);
              res.writeHead(200, {
                'Content-Type': mime,
                'Cache-Control': 'no-cache, no-store, must-revalidate',
                'X-Content-Type-Options': 'nosniff',
              });
              res.end(data);
              return;
            } catch {
              res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
              res.end('Not Found');
              return;
            }
          }
        }
        res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Forbidden');
        return;
      }
      // Task 9 (0.2.3): /learn/:slug 文章页（仅 learnEnabled 且 articleLoader 提供时）
      // 正则 ^/learn/([a-z0-9-]+)$ 严格小写匹配，大写/下划线不匹配
      if (isLearnEnabled && articleLoader && req.method === 'GET') {
        const articleMatch = pathname.match(/^\/learn\/([a-z0-9-]+)$/);
        if (articleMatch) {
          const slug = articleMatch[1];
          const lang = resolveLang(req);
          const article = articleLoader.getBySlugAndLang(slug, lang) ?? articleLoader.getBySlug(slug);
          if (article) {
            const nav = articleLoader.getArticleNav(slug, lang);
            const html = createLearnArticleHtml(article, nav, lang);
            res.writeHead(200, htmlHeaders);
            res.end(html);
            return;
          }
          // 文章不存在 → 友好 404 HTML（含 nav + 返回 /learn 链接）
          res.writeHead(404, htmlHeaders);
          res.end(learnNotFoundHtml);
          return;
        }
      }
      // Task 9 (0.2.3): /feedback 通用反馈页（仅 feedbackEnabled 时）
      if (isFeedbackEnabled && req.method === 'GET' && pathname === '/feedback') {
        const html = createFeedbackHtml();
        res.writeHead(200, htmlHeaders);
        res.end(html);
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
    // Task 1 (0.2.2): LRU 排序依据 — 最近一次写入或读取时间。
    // Map 的迭代顺序为插入顺序；每次 touch 通过 delete + set 将 sessionKey 移到末尾（最新），
    // 迭代器首个元素即为最旧（LRU 淘汰候选）。
    const lastAccess = new Map<string, number>();

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

    /** Task 1 (0.2.2): 更新 sessionKey 的 LRU 最近访问时间（写入或读取时调用） */
    function touchSession(sessionKey: string): void {
      // delete + set 把 sessionKey 移到 Map 迭代末尾（最新），保证迭代器首元素为最旧
      lastAccess.delete(sessionKey);
      lastAccess.set(sessionKey, Date.now());
    }

    /** Task 1 (0.2.2): 计算全局 ring buffer 总条目数（outbound + inbound） */
    function getGlobalBufferCount(): number {
      let total = 0;
      for (const buf of ringBuffers.values()) total += buf.length;
      for (const buf of inboundBuffers.values()) total += buf.length;
      return total;
    }

    /**
     * Task 1 (0.2.2): 淘汰最旧 sessionKey 的全部 buffer（outbound + inbound）。
     * exclude 参数防止淘汰刚写入的 sessionKey（保证写入不丢失）。
     * 返回被淘汰的 sessionKey，无可淘汰时返回 null。
     */
    function evictOldestSession(exclude?: string): string | null {
      for (const key of lastAccess.keys()) {
        if (key === exclude) continue;
        ringBuffers.delete(key);
        inboundBuffers.delete(key);
        lastAccess.delete(key);
        log.warn('LRU evicted session buffer (global limit exceeded)', { sessionKey: key });
        return key;
      }
      return null;
    }

    /**
     * Task 1 (0.2.2): 全局上限强制淘汰。循环淘汰最旧 sessionKey 直至总条目数 ≤ limit。
     * exclude 防止淘汰刚写入的 sessionKey；若无可淘汰（仅剩 exclude 自身）则记 warn 并停止。
     */
    function enforceGlobalLimit(exclude?: string): void {
      while (getGlobalBufferCount() > globalLimit) {
        const evicted = evictOldestSession(exclude);
        if (!evicted) {
          log.warn('global buffer limit exceeded but no evictable session', {
            total: getGlobalBufferCount(),
            limit: globalLimit,
            exclude,
          });
          break;
        }
      }
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
        // Task 1 (0.2.2): 清理 LRU 跟踪
        lastAccess.delete(sessionKey);
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
      // Task 4 (0.2.2): token 优先级 URL ?token= > cookie > sessionStorage（服务端不可读）
      const urlToken = url.searchParams.get('token');
      const cookieToken = parseCookies(req.headers.cookie)[AUTH_COOKIE_NAME] ?? null;
      const token = urlToken ?? cookieToken;
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
          // Task 1 (0.2.2): 读取访问更新 LRU（最近读取时间）
          touchSession(sessionKey);
          const inboundBuffer = getInboundBuffer(sessionKey);
          const outboundBuffer = getRingBuffer(sessionKey);
          // Task 3 (0.2.2): ring buffer 未命中时（服务重启后清空）从 JSONL 兜底回放
          // 仅当 inbound + outbound buffer 均为空且提供 readHistoryForReplay 回调时调用
          // 性能优先：ring buffer 有数据时不读 JSONL
          if (inboundBuffer.length === 0 && outboundBuffer.length === 0 && readHistoryForReplay) {
            try {
              const messages = await readHistoryForReplay(sessionKey, limit);
              if (messages.length > 0) {
                safeSend(ws, { type: 'replay', replay: true, source: 'jsonl', messages });
              }
            } catch (err) {
              log.warn('readHistoryForReplay failed', { error: String(err), sessionKey });
            }
          } else {
            replayHistory(ws, inboundBuffer, outboundBuffer, limit);
          }
        } else if (lastEventSeqStr !== null) {
          const lastEventSeq = parseInt(lastEventSeqStr, 10);
          if (!Number.isNaN(lastEventSeq)) {
            // Task 1 (0.2.2): 读取访问更新 LRU
            touchSession(sessionKey);
            replayBufferedEvents(ws, getRingBuffer(sessionKey), lastEventSeq);
          }
        }

        // C11 修复：heartbeat — pong 回来标记存活
        ws.on('pong', () => {
          state.isAlive = true;
        });

        ws.on('message', (data) => {
          handleMessage(ws, state, data as Buffer, bus, inboundBuffers, (sk) => {
            // Task 1 (0.2.2): 入站写入后更新 LRU + 强制全局上限淘汰
            touchSession(sk);
            enforceGlobalLimit(sk);
          });
        });

        // 重放缓冲的早期消息
        for (const msg of earlyMessages) {
          handleMessage(ws, state, msg, bus, inboundBuffers, (sk) => {
            touchSession(sk);
            enforceGlobalLimit(sk);
          });
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
          lastAccess.clear();
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
          // Task 1 (0.2.2): 写入后更新 LRU，并强制全局上限淘汰（exclude 当前 sessionKey 防止淘汰自身）
          touchSession(envelope.sessionKey);
          enforceGlobalLimit(envelope.sessionKey);
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
  /** Task 1 (0.2.2): 入站写入后回调，用于更新 LRU + 强制全局上限淘汰 */
  onInboundBuffered?: (sessionKey: string) => void,
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
      // Task 1 (0.2.2): 入站写入后更新 LRU + 强制全局上限淘汰
      onInboundBuffered?.(state.sessionKey);
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

  /** Task 4 (0.2.2): 发送 JSON 并附加 Set-Cookie 头 */
  const sendJsonWithCookie = (status: number, body: unknown, cookieValue: string) => {
    res.writeHead(status, {
      'content-type': 'application/json; charset=utf-8',
      'set-cookie': cookieValue,
    });
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
        // Task 4 (0.2.2): 设置 HttpOnly cookie（双写：cookie + body.token 供前端 sessionStorage fallback）
        sendJsonWithCookie(200, { userId: user.userId, username: user.username, token: user.token },
          buildAuthCookieValue(user.token, isHttpsRequest(req)));
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
      // Task 4 (0.2.2): 设置 HttpOnly cookie（双写：cookie + body.token 供前端 sessionStorage fallback）
      sendJsonWithCookie(200, { userId: user.userId, username: user.username, token: user.token },
        buildAuthCookieValue(user.token, isHttpsRequest(req)));
      return;
    }

    // Task 4 (0.2.2): POST /api/logout — 清除 cookie（HttpOnly 无法被 JS 清除，必须服务端设置 Max-Age=0）
    if (pathname === '/api/logout' && req.method === 'POST') {
      sendJsonWithCookie(200, { ok: true }, buildClearCookieValue(isHttpsRequest(req)));
      return;
    }

    if (pathname === '/api/me' && req.method === 'GET') {
      // Task 4 (0.2.2): 优先读 cookie，其次 Authorization: Bearer，再次 URL ?token=
      const token = extractAuthToken(req);
      if (!token) {
        sendJson(401, { error: 'missing token' });
        return;
      }
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
      // Task 4 (0.2.2): cookie > Bearer > URL ?token=
      const token = extractAuthToken(req);
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
      // Task 4 (0.2.2): cookie > Bearer > URL ?token=
      const token = extractAuthToken(req);
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
      // Task 4 (0.2.2): cookie > Bearer > URL ?token=
      const token = extractAuthToken(req);
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
