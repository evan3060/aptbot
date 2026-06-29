import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import WebSocket from 'ws';
import {
  startWebSocketServer,
  type WebSocketServer,
} from '../../src/access/websocket-server.js';
import { InMemoryMessageBus } from '../../src/bus/message-bus.js';
import type { MessageBus, AgentEventEnvelope } from '../../src/bus/types.js';

const TEST_PORT = 18770;

interface ConnectParams {
  token?: string;
  session?: string;
  lastEventSeq?: number;
  historyLimit?: number;
}

function buildUrl(port: number, params?: ConnectParams): string {
  const sp = new URLSearchParams();
  if (params?.token) sp.set('token', params.token);
  if (params?.session) sp.set('session', params.session);
  if (params?.lastEventSeq !== undefined) sp.set('lastEventSeq', String(params.lastEventSeq));
  if (params?.historyLimit !== undefined) sp.set('historyLimit', String(params.historyLimit));
  const qs = sp.toString();
  return `ws://localhost:${port}${qs ? `?${qs}` : ''}`;
}

/**
 * 创建 WebSocket 并等待 open。
 * 注意：message listener 必须在 open 前注册，因为 server 的 replay 在 identifyUser().then() 中发送，
 * 可能早于 client 的 open 事件之后注册的 listener。
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

function makeEnvelope(seq: number, sessionKey: string = 's1', eventType: string = 'message_delta'): AgentEventEnvelope {
  const event: AgentEventEnvelope['event'] =
    eventType === 'agent_start'
      ? { type: 'agent_start' }
      : eventType === 'turn_start'
        ? { type: 'turn_start', turnId: 't1' }
        : eventType === 'turn_end'
          ? { type: 'turn_end', turnId: 't1' }
          : { type: 'message_delta', text: `delta-${seq}` };
  return { sessionKey, chatId: 'c1', channel: 'ws', event, seq };
}

/** 连接并等待 open（用于不需要立即监听 message 的场景） */
async function connect(port: number, params?: ConnectParams): Promise<WebSocket> {
  const { ws, open } = connectWithListener(port, params);
  await open;
  return ws;
}

describe('WebSocket history replay (Task 8)', () => {
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

  it('replays inbound + outbound history on new connection with historyLimit', async () => {
    server = await startWebSocketServer({ port: TEST_PORT, bus, fallbackSessionKey: 's1' });

    // 第一个客户端连接并发送入站消息
    const ws1 = await connect(TEST_PORT, { session: 's1' });
    clients.push(ws1);
    send(ws1, { type: 'message', content: 'hello from client1' });
    // 等待入站消息被 bus 消费，确保 handleMessage 已执行（inboundBuffer 已填充）
    const inbound = await bus.consumeInbound();
    expect(inbound.content).toBe('hello from client1');

    // 广播出站事件
    server!.broadcast(makeEnvelope(0, 's1', 'agent_start'));
    server!.broadcast(makeEnvelope(1, 's1', 'message_delta'));

    // 等待 ws1 接收出站事件（确保 ringBuffer 已填充）
    await new Promise<void>((resolve) => {
      let count = 0;
      ws1.on('message', () => {
        count++;
        if (count >= 2) resolve();
      });
      setTimeout(resolve, 500);
    });

    // 第二个客户端连接，请求历史回放
    // message listener 必须在 open 前注册，因为 server 的 replay 在 identifyUser().then() 中发送
    const { ws: ws2, open: ws2Open } = connectWithListener(TEST_PORT, { session: 's1', historyLimit: 20 });
    clients.push(ws2);
    const replayPromise = waitForMessage(ws2);
    await ws2Open;
    const replayMsg = await replayPromise;

    expect(replayMsg.type).toBe('replay');
    expect(replayMsg.replay).toBe(true);
    expect(Array.isArray(replayMsg.messages)).toBe(true);
    // 应包含 1 条入站 + 2 条出站 = 3 条
    expect(replayMsg.messages.length).toBe(3);

    // 验证消息分类
    const inboundMsgs = replayMsg.messages.filter((m: any) => m.kind === 'inbound');
    const outboundMsgs = replayMsg.messages.filter((m: any) => m.kind === 'outbound');
    expect(inboundMsgs.length).toBe(1);
    expect(outboundMsgs.length).toBe(2);
    expect(inboundMsgs[0].content).toBe('hello from client1');
    expect(outboundMsgs[0].event.type).toBe('agent_start');
    expect(outboundMsgs[1].event.type).toBe('message_delta');
  });

  it('historyLimit parameter limits replayed messages count', async () => {
    server = await startWebSocketServer({ port: TEST_PORT, bus, fallbackSessionKey: 's1' });

    // 广播 10 条出站事件
    for (let i = 0; i < 10; i++) {
      server!.broadcast(makeEnvelope(i, 's1', 'message_delta'));
    }

    // 用 historyLimit=5 连接 — 应只回放最近 5 条
    const { ws, open } = connectWithListener(TEST_PORT, { session: 's1', historyLimit: 5 });
    clients.push(ws);
    const replayPromise = waitForMessage(ws);
    await open;
    const replayMsg = await replayPromise;

    expect(replayMsg.type).toBe('replay');
    expect(replayMsg.messages.length).toBe(5);
    // 应回放 seq 5..9（最近 5 条）
    const seqs = replayMsg.messages.map((m: any) => m.seq).sort((a: number, b: number) => a - b);
    expect(seqs).toEqual([5, 6, 7, 8, 9]);
  });

  it('replay messages are marked with replay: true', async () => {
    server = await startWebSocketServer({ port: TEST_PORT, bus, fallbackSessionKey: 's1' });

    server!.broadcast(makeEnvelope(0, 's1', 'agent_start'));

    const { ws, open } = connectWithListener(TEST_PORT, { session: 's1', historyLimit: 20 });
    clients.push(ws);
    const replayPromise = waitForMessage(ws);
    await open;
    const replayMsg = await replayPromise;

    expect(replayMsg.type).toBe('replay');
    expect(replayMsg.replay).toBe(true);
    // 每条消息也应标记 replay: true
    for (const m of replayMsg.messages) {
      expect(m.replay).toBe(true);
    }
  });

  it('different sessionKey histories do not cross-contaminate', async () => {
    server = await startWebSocketServer({ port: TEST_PORT, bus });

    // 为 s1 广播事件
    server!.broadcast(makeEnvelope(0, 's1', 'agent_start'));
    // 为 s2 广播事件
    server!.broadcast(makeEnvelope(0, 's2', 'turn_start'));

    // 连接 s2 客户端，请求历史 — 应只看到 s2 的事件
    const { ws, open } = connectWithListener(TEST_PORT, { session: 's2', historyLimit: 20 });
    clients.push(ws);
    const replayPromise = waitForMessage(ws);
    await open;
    const replayMsg = await replayPromise;

    expect(replayMsg.type).toBe('replay');
    expect(replayMsg.messages.length).toBe(1);
    expect(replayMsg.messages[0].event.type).toBe('turn_start');
  });

  it('no history replay when historyLimit absent', async () => {
    server = await startWebSocketServer({ port: TEST_PORT, bus, fallbackSessionKey: 's1' });

    server!.broadcast(makeEnvelope(0, 's1', 'agent_start'));

    // 无 historyLimit 连接 — 不应收到 replay 消息
    const ws = await connect(TEST_PORT, { session: 's1' });
    clients.push(ws);

    // 等待一小段时间，确认没有 replay 消息
    const msg = await new Promise<any>((resolve) => {
      const timer = setTimeout(() => resolve(null), 300);
      ws.once('message', (data) => {
        clearTimeout(timer);
        resolve(JSON.parse(data.toString()));
      });
    });
    if (msg !== null) {
      expect(msg.type).not.toBe('replay');
    }
  });

  it('empty history produces no replay message', async () => {
    server = await startWebSocketServer({ port: TEST_PORT, bus, fallbackSessionKey: 's1' });

    // 不广播任何事件，连接请求历史 — 不应收到 replay 消息
    const ws = await connect(TEST_PORT, { session: 's1', historyLimit: 20 });
    clients.push(ws);

    const msg = await new Promise<any>((resolve) => {
      const timer = setTimeout(() => resolve(null), 300);
      ws.once('message', (data) => {
        clearTimeout(timer);
        resolve(JSON.parse(data.toString()));
      });
    });
    expect(msg).toBeNull();
  });

  it('inbound messages are replayed with historyLimit', async () => {
    server = await startWebSocketServer({ port: TEST_PORT, bus, fallbackSessionKey: 's1' });

    // 连接并发送 5 条入站消息
    const ws1 = await connect(TEST_PORT, { session: 's1' });
    clients.push(ws1);
    for (let i = 0; i < 5; i++) {
      send(ws1, { type: 'message', content: `msg-${i}` });
      await bus.consumeInbound();
    }

    // historyLimit=100 请求全部历史 — inbound 应有 5 条
    const { ws: ws2, open: ws2Open } = connectWithListener(TEST_PORT, { session: 's1', historyLimit: 100 });
    clients.push(ws2);
    const replayPromise = waitForMessage(ws2);
    await ws2Open;
    const replayMsg = await replayPromise;

    const inboundMsgs = replayMsg.messages.filter((m: any) => m.kind === 'inbound');
    expect(inboundMsgs.length).toBe(5);
  });

  it('historyLimit takes precedence over lastEventSeq when both present', async () => {
    server = await startWebSocketServer({ port: TEST_PORT, bus, fallbackSessionKey: 's1' });

    // 广播 3 条出站事件
    server!.broadcast(makeEnvelope(10, 's1', 'agent_start'));
    server!.broadcast(makeEnvelope(11, 's1', 'turn_start'));
    server!.broadcast(makeEnvelope(12, 's1', 'turn_end'));

    // 同时带 historyLimit=20 和 lastEventSeq=11
    // historyLimit 优先 → replay 消息（而非 seq-based event 消息）
    const { ws, open } = connectWithListener(TEST_PORT, { session: 's1', historyLimit: 20, lastEventSeq: 11 });
    clients.push(ws);
    const replayPromise = waitForMessage(ws);
    await open;
    const msg = await replayPromise;

    // 应回放 replay 消息（historyLimit 优先），而非逐条 event 消息
    expect(msg.type).toBe('replay');
    expect(msg.replay).toBe(true);
    // historyLimit=20 回放所有 3 条（而非 seq>11 的 1 条）
    expect(msg.messages.length).toBe(3);
  });

  it('historyLimit with invalid value defaults to 20', async () => {
    server = await startWebSocketServer({ port: TEST_PORT, bus, fallbackSessionKey: 's1' });

    // 广播 25 条出站事件
    for (let i = 0; i < 25; i++) {
      server!.broadcast(makeEnvelope(i, 's1', 'message_delta'));
    }

    // historyLimit=abc 无效 → 默认 20 → 只回放最近 20 条
    const { ws, open } = connectWithListener(TEST_PORT, { session: 's1', historyLimit: 'abc' as any });
    clients.push(ws);
    const replayPromise = waitForMessage(ws);
    await open;
    const replayMsg = await replayPromise;

    expect(replayMsg.type).toBe('replay');
    expect(replayMsg.messages.length).toBe(20);
    // 应回放 seq 5..24（最近 20 条）
    const seqs = replayMsg.messages.map((m: any) => m.seq).sort((a: number, b: number) => a - b);
    expect(seqs[0]).toBe(5);
    expect(seqs[seqs.length - 1]).toBe(24);
  });
});
