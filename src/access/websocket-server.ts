import { createServer, type Server as HttpServer } from 'node:http';
import { WebSocketServer as WsServer, type WebSocket } from 'ws';
import { createLogger } from '../infrastructure/logger.js';
import type { MessageBus, InboundMessage } from '../bus/types.js';

const log = createLogger('websocket-server');

export const WS_MAX_CONNECTIONS = 50;
export const WS_INBOUND_CONTENT_MAX_BYTES = 64 * 1024;
export const WS_INBOUND_MEDIA_MAX_BYTES = 5 * 1024 * 1024;
export const WS_INBOUND_RATE_LIMIT_PER_SEC = 10;
export const WS_HEARTBEAT_TIMEOUT_MS = 60000;
export const WS_OUTBOUND_BUFFER_MAX = 1000;

export interface WebSocketServerOptions {
  port: number;
  bus: MessageBus;
  authToken?: string;
}

export interface WebSocketServer {
  stop(): Promise<void>;
  getActiveConnections(): number;
}

interface ConnectionState {
  messageTimestamps: number[];
  rateLimitWarnings: number;
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
    const { port, bus, authToken } = options;
    const httpServer = createServer();
    const wss = new WsServer({ server: httpServer });
    const connections = new Map<WebSocket, ConnectionState>();

    wss.on('connection', (ws, req) => {
      // Auth check
      if (authToken) {
        const url = new URL(req.url ?? '', `http://localhost:${port}`);
        const token = url.searchParams.get('token');
        if (token !== authToken) {
          safeSend(ws, { type: 'error', code: 'auth_failed', message: 'Invalid or missing auth token' });
          ws.close();
          return;
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
      };
      connections.set(ws, state);

      ws.on('message', (data) => {
        handleMessage(ws, state, data, bus);
      });

      ws.on('close', () => {
        connections.delete(ws);
      });

      ws.on('error', () => {
        connections.delete(ws);
      });
    });

    httpServer.listen(port, () => {
      log.info('websocket server started', { port, connections: connections.size });
      resolve({
        async stop(): Promise<void> {
          for (const [ws] of connections) {
            ws.removeAllListeners();
            ws.terminate();
          }
          connections.clear();
          wss.close();
          await new Promise<void>((r) => httpServer.close(() => r()));
        },
        getActiveConnections(): number {
          return connections.size;
        },
      });
    });

    httpServer.on('error', reject);
  });
}

function safeSend(ws: WebSocket, msg: unknown): void {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(msg));
  }
}

function handleMessage(
  ws: WebSocket,
  state: ConnectionState,
  data: unknown,
  bus: MessageBus,
): void {
  let parsed: any;
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
  state.messageTimestamps = state.messageTimestamps.filter((t) => now - t < 1000);
  if (state.messageTimestamps.length >= WS_INBOUND_RATE_LIMIT_PER_SEC) {
    state.rateLimitWarnings++;
    safeSend(ws, { type: 'error', code: 'rate_limited', message: 'Rate limit exceeded' });
    if (state.rateLimitWarnings >= 3) {
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
