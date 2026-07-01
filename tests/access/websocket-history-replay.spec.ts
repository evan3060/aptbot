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

/**
 * Task 1 (0.2.2): per-sessionKey ring buffer 分片 + LRU 淘汰
 * - 单 sessionKey 上限 1000 不变
 * - 新增全局总条目上限（默认 50000），触发时按 LRU 淘汰最旧 sessionKey 的全部 buffer
 * - sessionKey refCount 归零时清理对应 buffer
 * - LRU 淘汰后新 sessionKey 可正常写入
 */
describe('Ring buffer sharding + LRU eviction (Task 1, 0.2.2)', () => {
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

  /** 等待指定毫秒 */
  function sleep(ms: number): Promise<void> {
    return new Promise((r) => setTimeout(r, ms));
  }

  /** 等待一条消息或超时返回 null（用于断言"无消息"） */
  function waitForMessageOrNull(ws: WebSocket, timeoutMs = 300): Promise<any> {
    return new Promise<any>((resolve) => {
      const timer = setTimeout(() => resolve(null), timeoutMs);
      ws.once('message', (data) => {
        clearTimeout(timer);
        resolve(JSON.parse(data.toString()));
      });
    });
  }

  it('单 sessionKey 超 1000 截断（per-sessionKey 上限不变）', async () => {
    server = await startWebSocketServer({ port: TEST_PORT, bus, fallbackSessionKey: 's1' });

    // 广播 1001 条出站事件，应被截断为最近 1000 条
    for (let i = 0; i < 1001; i++) {
      server!.broadcast(makeEnvelope(i, 's1', 'message_delta'));
    }

    // historyLimit=2000 > 1000，可观察到截断后的实际 buffer 大小
    const { ws, open } = connectWithListener(TEST_PORT, { session: 's1', historyLimit: 2000 });
    clients.push(ws);
    const replayPromise = waitForMessage(ws);
    await open;
    const replayMsg = await replayPromise;

    expect(replayMsg.type).toBe('replay');
    // 应回放 1000 条（seq 1..1000，seq 0 被截断）
    expect(replayMsg.messages.length).toBe(1000);
    const seqs = replayMsg.messages.map((m: any) => m.seq).sort((a: number, b: number) => a - b);
    expect(seqs[0]).toBe(1);
    expect(seqs[seqs.length - 1]).toBe(1000);
  });

  it('全局 limit 触发 LRU 淘汰最旧 sessionKey 的全部 buffer', async () => {
    // 使用小全局上限便于测试
    server = await startWebSocketServer({ port: TEST_PORT, bus, globalBufferLimit: 10 });

    // 向 s1 广播 6 条（older）
    for (let i = 0; i < 6; i++) {
      server!.broadcast(makeEnvelope(i, 's1', 'message_delta'));
    }
    // 向 s2 广播 6 条（newer），总 12 > 10 → 触发 LRU 淘汰 s1
    for (let i = 0; i < 6; i++) {
      server!.broadcast(makeEnvelope(i, 's2', 'message_delta'));
    }

    // s1 应被整 sessionKey 淘汰，连接 s1 请求历史 — 无 replay 消息
    // 注意：listener 必须在 open 前注册，避免错过 server 在 identifyUser().then() 中发送的 replay
    const { ws: ws1, open: ws1Open } = connectWithListener(TEST_PORT, { session: 's1', historyLimit: 20 });
    clients.push(ws1);
    const msg1Promise = waitForMessageOrNull(ws1);
    await ws1Open;
    const msg1 = await msg1Promise;
    expect(msg1).toBeNull();

    // s2 应保留，连接 s2 请求历史 — 6 条 replay
    const { ws: ws2, open: ws2Open } = connectWithListener(TEST_PORT, { session: 's2', historyLimit: 20 });
    clients.push(ws2);
    const replayPromise = waitForMessage(ws2);
    await ws2Open;
    const replayMsg = await replayPromise;
    expect(replayMsg.type).toBe('replay');
    expect(replayMsg.messages.length).toBe(6);
  });

  it('refCount 归零时清理对应 sessionKey 的 buffer', async () => {
    server = await startWebSocketServer({ port: TEST_PORT, bus, fallbackSessionKey: 's1' });

    // 连接 s1 并广播事件
    const ws1 = await connect(TEST_PORT, { session: 's1' });
    clients.push(ws1);
    server!.broadcast(makeEnvelope(0, 's1', 'agent_start'));
    // 等待事件送达 ws1，确保 ringBuffer 已填充
    await waitForMessage(ws1);

    // 关闭 ws1，refCount 归零，buffer 应被清理
    ws1.close();
    await sleep(150);

    // 新连接请求历史 — 应无 replay（buffer 已清理）
    // listener 必须在 open 前注册，确保若 buffer 未清理能捕获到 replay 并失败
    const { ws: ws2, open: ws2Open } = connectWithListener(TEST_PORT, { session: 's1', historyLimit: 20 });
    clients.push(ws2);
    const msgPromise = waitForMessageOrNull(ws2);
    await ws2Open;
    const msg = await msgPromise;
    expect(msg).toBeNull();
  });

  it('LRU 淘汰后新 sessionKey 可正常写入', async () => {
    server = await startWebSocketServer({ port: TEST_PORT, bus, globalBufferLimit: 5 });

    // 触发 LRU 淘汰：s1 写 3 条，s2 写 3 条（总 6 > 5 → 淘汰 s1）
    for (let i = 0; i < 3; i++) {
      server!.broadcast(makeEnvelope(i, 's1', 'message_delta'));
    }
    for (let i = 0; i < 3; i++) {
      server!.broadcast(makeEnvelope(i, 's2', 'message_delta'));
    }

    // 验证 s1 已被 LRU 淘汰（无 replay）
    const { ws: ws1, open: ws1Open } = connectWithListener(TEST_PORT, { session: 's1', historyLimit: 20 });
    clients.push(ws1);
    const msg1Promise = waitForMessageOrNull(ws1);
    await ws1Open;
    const msg1 = await msg1Promise;
    expect(msg1).toBeNull();

    // 写入新 sessionKey s3 — 淘汰后系统仍可正常写入
    server!.broadcast(makeEnvelope(0, 's3', 'agent_start'));

    // 连接 s3 请求历史 — 应有 1 条 replay
    const { ws, open } = connectWithListener(TEST_PORT, { session: 's3', historyLimit: 20 });
    clients.push(ws);
    const replayPromise = waitForMessage(ws);
    await open;
    const replayMsg = await replayPromise;
    expect(replayMsg.type).toBe('replay');
    expect(replayMsg.messages.length).toBe(1);
    expect(replayMsg.messages[0].event.type).toBe('agent_start');
  });
});
