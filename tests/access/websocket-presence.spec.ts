import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import WebSocket from 'ws';
import {
  startWebSocketServer,
  type WebSocketServer,
} from '../../src/access/websocket-server.js';
import { InMemoryMessageBus } from '../../src/bus/message-bus.js';
import type { MessageBus } from '../../src/bus/types.js';
import { createChatPageHtml } from '../../src/access/chat-page.js';

const TEST_PORT = 18773;

interface ConnectParams {
  token?: string;
  session?: string;
}

function buildUrl(port: number, params?: ConnectParams): string {
  const sp = new URLSearchParams();
  if (params?.token) sp.set('token', params.token);
  if (params?.session) sp.set('session', params.session);
  const qs = sp.toString();
  return `ws://localhost:${port}${qs ? `?${qs}` : ''}`;
}

/**
 * 创建 WebSocket 并返回 { ws, open }，允许在 await open 之前注册 message listener。
 * Task 8 经验：server 的 presence 在 identifyUser().then() 中发送，
 * 可能早于 client open 事件后注册的 listener。
 */
function connectWithListener(port: number, params?: ConnectParams): { ws: WebSocket; open: Promise<void> } {
  const url = buildUrl(port, params);
  const ws = new WebSocket(url);
  const open = new Promise<void>((resolve, reject) => {
    ws.once('open', () => resolve());
    ws.once('error', reject);
  });
  return { ws, open };
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

/** 等待指定时间内无消息到达，用于验证 presence 不串扰到其他 sessionKey */
function waitForNoMessage(ws: WebSocket, timeoutMs = 200): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => resolve(), timeoutMs);
    ws.once('message', () => {
      clearTimeout(timer);
      reject(new Error('received unexpected message'));
    });
  });
}

async function connect(port: number, params?: ConnectParams): Promise<WebSocket> {
  const { ws, open } = connectWithListener(port, params);
  await open;
  return ws;
}

describe('WebSocket presence indicator (Task 9)', () => {
  let server: WebSocketServer | null = null;
  let bus: MessageBus;
  const clients: WebSocket[] = [];

  beforeEach(() => {
    bus = new InMemoryMessageBus();
  });

  afterEach(async () => {
    for (const c of clients) {
      c.removeAllListeners();
      try { c.close(); } catch { /* ignore */ }
    }
    clients.length = 0;
    if (server) {
      await server.stop();
      server = null;
    }
  });

  it('does not send presence to first connection in sessionKey (no other peers)', async () => {
    server = await startWebSocketServer({ port: TEST_PORT, bus, fallbackSessionKey: 's1' });
    const { ws: ws1, open: open1 } = connectWithListener(TEST_PORT, { session: 's1' });
    clients.push(ws1);
    await open1;
    // 第一个连接无其他 peer，不收到 presence
    await waitForNoMessage(ws1, 200);
  });

  it('broadcasts presence onlineCount=2 to existing connection when second joins same sessionKey', async () => {
    server = await startWebSocketServer({ port: TEST_PORT, bus, fallbackSessionKey: 's1' });

    // 第一个连接 — 无其他 peer，不收到 presence
    const { ws: ws1, open: open1 } = connectWithListener(TEST_PORT, { session: 's1' });
    clients.push(ws1);
    const ws1NoMsg = waitForNoMessage(ws1, 200);
    await open1;
    await ws1NoMsg;

    // 第二个连接加入 — ws1 应收到 onlineCount=2，ws2 不收到 presence（自己是触发者）
    const ws1Presence = waitForMessage(ws1);
    const { ws: ws2, open: open2 } = connectWithListener(TEST_PORT, { session: 's1' });
    clients.push(ws2);
    const ws2NoMsg = waitForNoMessage(ws2, 200);
    await open2;

    const msg = await ws1Presence;
    expect(msg.type).toBe('presence');
    expect(msg.onlineCount).toBe(2);

    await ws2NoMsg; // ws2 不收到自己的 presence
  });

  it('sends presence onlineCount=1 to remaining connection when one disconnects', async () => {
    server = await startWebSocketServer({ port: TEST_PORT, bus, fallbackSessionKey: 's1' });

    // ws1 连接 — 无其他 peer，不收到 presence
    const { ws: ws1, open: open1 } = connectWithListener(TEST_PORT, { session: 's1' });
    clients.push(ws1);
    await open1;
    await waitForNoMessage(ws1, 200);

    // ws2 加入 — ws1 收到 onlineCount=2
    const ws1Second = waitForMessage(ws1);
    const { ws: ws2, open: open2 } = connectWithListener(TEST_PORT, { session: 's1' });
    clients.push(ws2);
    await open2;
    const ws2JoinMsg = await ws1Second;
    expect(ws2JoinMsg.type).toBe('presence');
    expect(ws2JoinMsg.onlineCount).toBe(2);

    // ws2 断开 — ws1 应收到 onlineCount=1
    const ws1AfterClose = waitForMessage(ws1);
    ws2.close();
    const msg = await ws1AfterClose;
    expect(msg.type).toBe('presence');
    expect(msg.onlineCount).toBe(1);
  });

  it('does not send presence to connections in different sessionKey', async () => {
    server = await startWebSocketServer({ port: TEST_PORT, bus, fallbackSessionKey: 's1' });

    // ws1 连接 s1 — 无其他 peer，不收到 presence
    const { ws: ws1, open: open1 } = connectWithListener(TEST_PORT, { session: 's1' });
    clients.push(ws1);
    await open1;
    await waitForNoMessage(ws1, 200);

    // ws2 连接到不同 sessionKey s2 — ws1 不应收到 s2 的 presence
    const ws1NoMsg = waitForNoMessage(ws1, 200);
    const { ws: ws2, open: open2 } = connectWithListener(TEST_PORT, { session: 's2' });
    clients.push(ws2);
    await open2;

    await ws1NoMsg; // ws1 无消息
    await waitForNoMessage(ws2, 200); // ws2 也不收到自己的 presence
  });

  it('chat-page.ts inline JS handles presence event and shows indicator for N>1', async () => {
    const html = createChatPageHtml('/ws');
    // 验证内联 JS 包含 presence 事件处理分支
    expect(html).toContain("msg.type === 'presence'");
    // 验证读取 onlineCount 字段
    expect(html).toMatch(/onlineCount/);
    // 验证包含 "个客户端在线" 中文指示器文本
    expect(html).toMatch(/个客户端在线/);
    // 验证 N>1 时显示指示器的逻辑
    expect(html).toMatch(/onlineCount\s*>\s*1/);
  });
});
