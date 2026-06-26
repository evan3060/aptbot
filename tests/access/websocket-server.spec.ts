import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import WebSocket from 'ws';
import {
  startWebSocketServer,
  WS_MAX_CONNECTIONS,
  WS_INBOUND_CONTENT_MAX_BYTES,
  WS_INBOUND_RATE_LIMIT_PER_SEC,
  type WebSocketServer,
} from '../../src/access/websocket-server.js';
import { InMemoryMessageBus } from '../../src/bus/message-bus.js';
import type { MessageBus } from '../../src/bus/types.js';

const TEST_PORT = 18765;

function connect(port: number, token?: string): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const url = token ? `ws://localhost:${port}?token=${token}` : `ws://localhost:${port}`;
    const ws = new WebSocket(url);
    ws.once('open', () => resolve(ws));
    ws.once('error', reject);
  });
}

function send(ws: WebSocket, data: unknown): void {
  ws.send(JSON.stringify(data));
}

function waitForMessage(ws: WebSocket, timeoutMs = 1000): Promise<any> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('message timeout')), timeoutMs);
    ws.once('message', (data) => {
      clearTimeout(timer);
      resolve(JSON.parse(data.toString()));
    });
  });
}

describe('WebSocketServer', () => {
  let server: WebSocketServer | null = null;
  let bus: MessageBus;
  const clients: WebSocket[] = [];

  beforeEach(() => {
    bus = new InMemoryMessageBus();
  });

  afterEach(async () => {
    for (const c of clients) {
      c.removeAllListeners();
      c.close();
    }
    clients.length = 0;
    if (server) {
      await server.stop();
      server = null;
    }
  });

  it('exposes correct constants', () => {
    expect(WS_MAX_CONNECTIONS).toBe(50);
    expect(WS_INBOUND_CONTENT_MAX_BYTES).toBe(64 * 1024);
    expect(WS_INBOUND_RATE_LIMIT_PER_SEC).toBe(10);
  });

  it('starts and accepts connections', async () => {
    server = await startWebSocketServer({ port: TEST_PORT, bus });
    const ws = await connect(TEST_PORT);
    clients.push(ws);
    expect(server.getActiveConnections()).toBe(1);
  });

  it('stops cleanly', async () => {
    server = await startWebSocketServer({ port: TEST_PORT, bus });
    await server.stop();
    server = null;
    // 连接应被拒绝
    await expect(connect(TEST_PORT)).rejects.toThrow();
  });

  it('getActiveConnections returns 0 when no clients', async () => {
    server = await startWebSocketServer({ port: TEST_PORT, bus });
    expect(server.getActiveConnections()).toBe(0);
  });

  it('inbound message over 64KB returns inbound_too_large', async () => {
    server = await startWebSocketServer({ port: TEST_PORT, bus });
    const ws = await connect(TEST_PORT);
    clients.push(ws);
    const largeContent = 'x'.repeat(WS_INBOUND_CONTENT_MAX_BYTES + 1);
    send(ws, { type: 'message', content: largeContent });
    const msg = await waitForMessage(ws);
    expect(msg.type).toBe('error');
    expect(msg.code).toBe('inbound_too_large');
  });

  it('valid inbound message is published to bus', async () => {
    server = await startWebSocketServer({ port: TEST_PORT, bus });
    const ws = await connect(TEST_PORT);
    clients.push(ws);
    send(ws, { type: 'message', content: 'hello' });
    const inbound = await bus.consumeInbound();
    expect(inbound.content).toBe('hello');
  });

  it('rate limiting triggers rate_limited after exceeding 10/sec', async () => {
    server = await startWebSocketServer({ port: TEST_PORT, bus });
    const ws = await connect(TEST_PORT);
    clients.push(ws);
    // 快速发送超过限制的消息
    for (let i = 0; i < WS_INBOUND_RATE_LIMIT_PER_SEC + 5; i++) {
      send(ws, { type: 'message', content: `msg-${i}` });
    }
    // 应收到 rate_limited 错误
    let gotRateLimited = false;
    const messages: any[] = [];
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, 500);
      ws.on('message', (data) => {
        const msg = JSON.parse(data.toString());
        messages.push(msg);
        if (msg.code === 'rate_limited') {
          gotRateLimited = true;
          clearTimeout(timer);
          resolve();
        }
      });
    });
    expect(gotRateLimited).toBe(true);
  });

  it('auth token required when configured', async () => {
    server = await startWebSocketServer({ port: TEST_PORT, bus, authToken: 'secret' });
    // 无 token 连接应失败或收到 auth_error
    const ws = new WebSocket(`ws://localhost:${TEST_PORT}`);
    clients.push(ws);
    const msg = await new Promise<any>((resolve) => {
      ws.once('message', (data) => resolve(JSON.parse(data.toString())));
      ws.once('close', () => resolve({ type: 'closed' }));
    });
    expect(msg.type === 'error' || msg.type === 'closed').toBe(true);
  });

  it('auth token accepted when correct', async () => {
    server = await startWebSocketServer({ port: TEST_PORT, bus, authToken: 'secret' });
    const ws = await connect(TEST_PORT, 'secret');
    clients.push(ws);
    expect(server.getActiveConnections()).toBe(1);
  });
});
