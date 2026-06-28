import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import WebSocket from 'ws';
import {
  startWebSocketServer,
  WS_MAX_CONNECTIONS,
  WS_INBOUND_CONTENT_MAX_BYTES,
  WS_INBOUND_RATE_LIMIT_PER_SEC,
  WS_OUTBOUND_BUFFER_MAX,
  type WebSocketServer,
} from '../../src/access/websocket-server.js';
import { InMemoryMessageBus } from '../../src/bus/message-bus.js';
import type { MessageBus, AgentEventEnvelope } from '../../src/bus/types.js';

const TEST_PORT = 18765;

function connect(port: number, token?: string, lastEventSeq?: number): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const params = new URLSearchParams();
    if (token) params.set('token', token);
    if (lastEventSeq !== undefined) params.set('lastEventSeq', String(lastEventSeq));
    const qs = params.toString();
    const url = `ws://localhost:${port}${qs ? `?${qs}` : ''}`;
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

function makeEnvelope(seq: number, eventType: string = 'message_delta'): AgentEventEnvelope {
  const event: AgentEventEnvelope['event'] =
    eventType === 'agent_start'
      ? { type: 'agent_start' }
      : eventType === 'turn_start'
        ? { type: 'turn_start', turnId: 't1' }
        : eventType === 'turn_end'
          ? { type: 'turn_end', turnId: 't1' }
          : { type: 'message_delta', text: `delta-${seq}` };
  return { sessionKey: 's1', chatId: 'c1', channel: 'ws', event, seq };
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

  // I1+I2 回归测试：broadcast 发送 {type:'event', seq, event} wrapper
  it('broadcast wraps envelope as {type:event, seq, event} (I1)', async () => {
    server = await startWebSocketServer({ port: TEST_PORT, bus });
    const ws = await connect(TEST_PORT);
    clients.push(ws);

    server!.broadcast(makeEnvelope(42, 'agent_start'));
    const msg = await waitForMessage(ws);
    expect(msg.type).toBe('event');
    expect(msg.seq).toBe(42);
    expect(msg.event.type).toBe('agent_start');
  });

  // I1+I2 回归测试：reconnect with lastEventSeq replays buffered events
  it('replays buffered events on reconnect with lastEventSeq (I1+I2)', async () => {
    server = await startWebSocketServer({ port: TEST_PORT, bus });

    // 第一个客户端连接
    const ws1 = await connect(TEST_PORT);
    clients.push(ws1);

    // 广播 3 个事件
    server!.broadcast(makeEnvelope(0, 'agent_start'));
    server!.broadcast(makeEnvelope(1, 'turn_start'));
    server!.broadcast(makeEnvelope(2, 'turn_end'));

    // 等待 ws1 接收
    const msgs1: any[] = [];
    await new Promise<void>((resolve) => {
      let count = 0;
      ws1.on('message', (data) => {
        msgs1.push(JSON.parse(data.toString()));
        count++;
        if (count >= 3) resolve();
      });
    });
    expect(msgs1[2].seq).toBe(2);

    // 断连 ws1
    ws1.close();
    await new Promise((r) => setTimeout(r, 100));

    // 离线时广播更多事件
    server!.broadcast(makeEnvelope(3, 'agent_start'));
    server!.broadcast(makeEnvelope(4, 'turn_end'));

    // 用 lastEventSeq=2 重连 —— 先注册 message listener 再等待 open，
    // 因为 server 的 replay 在 connection handler 中同步发送（早于 client open 事件）
    const ws2 = new WebSocket(`ws://localhost:${TEST_PORT}?lastEventSeq=2`);
    clients.push(ws2);
    const msgs2: any[] = [];
    const replayDone = new Promise<void>((resolve) => {
      let count = 0;
      ws2.on('message', (data) => {
        msgs2.push(JSON.parse(data.toString()));
        count++;
        if (count >= 2) resolve();
      });
      setTimeout(resolve, 1000);
    });
    await new Promise<void>((resolve, reject) => {
      ws2.once('open', () => resolve());
      ws2.once('error', reject);
    });
    await replayDone;

    expect(msgs2.length).toBe(2);
    expect(msgs2[0].seq).toBe(3);
    expect(msgs2[1].seq).toBe(4);
  });

  // I1 回归测试：lastEventSeq 过旧时发送 resync_required
  it('sends resync_required when lastEventSeq is too old (I1)', async () => {
    server = await startWebSocketServer({ port: TEST_PORT, bus });

    // 广播超过 buffer 容量 + 2 条事件，驱逐 seq 0 和 1
    for (let i = 0; i < WS_OUTBOUND_BUFFER_MAX + 2; i++) {
      server!.broadcast(makeEnvelope(i, 'message_delta'));
    }

    // buffer 现在包含 seq 2..1001 (seq 0, 1 被驱逐)
    // 用 lastEventSeq=0 连接 (seq 1 丢失 → resync_required)
    const ws = new WebSocket(`ws://localhost:${TEST_PORT}?lastEventSeq=0`);
    clients.push(ws);
    const msg = await new Promise<any>((resolve, reject) => {
      ws.once('message', (data) => resolve(JSON.parse(data.toString())));
      ws.once('error', reject);
      setTimeout(() => reject(new Error('message timeout')), 1000);
    });
    expect(msg.type).toBe('resync_required');
  });
});
