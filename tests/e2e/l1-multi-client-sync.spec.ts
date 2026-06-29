import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import WebSocket from 'ws';
import { startWebSocketServer, type WebSocketServer } from '../../src/access/websocket-server.js';
import { InMemoryMessageBus } from '../../src/bus/message-bus.js';
import { createChannelManager } from '../../src/bus/channel-manager.js';
import type { Channel, AgentEventEnvelope, ChannelCapability } from '../../src/bus/types.js';

/**
 * Task 12: E2E 多客户端同步
 *
 * 验证完整的多客户端同步链路：
 * 1. presence 事件在多客户端场景下正确广播
 * 2. 客户端 A 发消息 → 客户端 B 收到 agent 响应（broadcast 按 sessionKey 路由）
 * 3. 客户端 B 连接时收到历史回放（入站 + 出站合并）
 * 4. /new 命令触发 session_changed 事件
 *
 * 组装真实链路：wsServer + bus + channelManager + wsChannel + 简化 inbound consumer。
 * 匿名模式（无 userStorage/authToken），聚焦多客户端同步机制。
 * inbound consumer 模拟 agent 响应：对普通消息 emit turn 序列，对 /new emit session_changed。
 */

// 端口避让：18765/18770-18778/18782 均被现有测试占用，18790+ 为本文件安全区间
const BASE_PORT = 18790;
let portCounter = 0;
function nextPort(): number {
  return BASE_PORT + portCounter++;
}

const FULL_CAP: ChannelCapability = {
  streaming: true,
  reasoning: true,
  richUi: true,
  fileEditEvents: true,
  editMessage: true,
  markdown: true,
};

/** 创建 WebSocket Channel 适配器：consume(envelope) → wsServer.broadcast(envelope) */
function createWsChannel(wsServer: WebSocketServer): Channel {
  return {
    name: 'websocket',
    capabilities: FULL_CAP,
    async start() {},
    async stop() {},
    consume(envelope: AgentEventEnvelope) {
      wsServer.broadcast(envelope);
    },
  };
}

interface ConnectParams {
  session?: string;
  historyLimit?: number;
}

function connectWithListener(
  port: number,
  params?: ConnectParams,
): { ws: WebSocket; open: Promise<void> } {
  const sp = new URLSearchParams();
  if (params?.session) sp.set('session', params.session);
  if (params?.historyLimit !== undefined) sp.set('historyLimit', String(params.historyLimit));
  const qs = sp.toString();
  const url = `ws://localhost:${port}${qs ? `?${qs}` : ''}`;
  const ws = new WebSocket(url);
  const open = new Promise<void>((resolve, reject) => {
    ws.once('open', () => resolve());
    ws.once('error', reject);
  });
  return { ws, open };
}

function waitForMessage(ws: WebSocket, timeoutMs = 3000): Promise<any> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('message timeout')), timeoutMs);
    ws.once('message', (data) => {
      clearTimeout(timer);
      resolve(JSON.parse(data.toString()));
    });
  });
}

function waitForNoMessage(ws: WebSocket, timeoutMs = 200): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => resolve(), timeoutMs);
    ws.once('message', () => {
      clearTimeout(timer);
      reject(new Error('received unexpected message'));
    });
  });
}

/** 收集 N 条消息（任意类型），完成后移除 listener */
function collectMessages(ws: WebSocket, count: number, timeoutMs = 5000): Promise<any[]> {
  return new Promise((resolve, reject) => {
    const collected: any[] = [];
    const handler = (data: Buffer) => {
      try {
        collected.push(JSON.parse(data.toString()));
      } catch {
        collected.push({ _raw: data.toString() });
      }
      if (collected.length >= count) {
        clearTimeout(timer);
        ws.removeListener('message', handler);
        resolve(collected);
      }
    };
    const timer = setTimeout(() => {
      ws.removeListener('message', handler);
      reject(new Error(`collectMessages timeout, got ${collected.length}/${count}`));
    }, timeoutMs);
    ws.on('message', handler);
  });
}

describe('Task 12: E2E 多客户端同步', () => {
  let server: WebSocketServer | null = null;
  let bus: InMemoryMessageBus;
  let channelManager: ReturnType<typeof createChannelManager>;
  let wsChannel: Channel | null = null;
  let port: number;
  let seq: number;
  let inboundLoopRunning: boolean;
  const clients: WebSocket[] = [];

  beforeEach(() => {
    bus = new InMemoryMessageBus();
    channelManager = createChannelManager(bus);
    port = nextPort();
    seq = 0;
    inboundLoopRunning = true;
    wsChannel = null;
  });

  afterEach(async () => {
    inboundLoopRunning = false;
    // 解锁 inbound consumer（若阻塞在 consumeInbound）
    bus
      .publishInbound({ channel: 'stop', senderId: '', chatId: '', content: '', metadata: {} })
      .catch(() => undefined);

    for (const c of clients) {
      try {
        c.removeAllListeners();
      } catch {
        /* ignore */
      }
      try {
        c.close();
      } catch {
        /* ignore */
      }
    }
    clients.length = 0;

    if (server) {
      await server.stop();
      server = null;
    }
    await channelManager.stopAll();
  });

  /**
   * 启动完整链路：wsServer + channelManager + wsChannel + 简化 inbound consumer。
   * inbound consumer 模拟 agent：
   * - 普通消息 → emit turn_start + message_delta + message_end + turn_end
   * - /new → sendToSessionKey(sessionKey, {type:'session_changed', sessionId: newId})
   */
  async function startServer(): Promise<void> {
    server = await startWebSocketServer({
      port,
      bus,
      onSessionBound: (sessionKey) => {
        if (wsChannel) channelManager.bindSession(sessionKey, wsChannel);
      },
      onSessionUnbound: (sessionKey) => {
        if (wsChannel) channelManager.unbindSession(sessionKey, wsChannel);
      },
    });
    wsChannel = createWsChannel(server);
    channelManager.register(wsChannel);
    await channelManager.startAll();
    void channelManager.runDispatchLoop();

    // 简化 inbound consumer：模拟 agent 响应
    void (async () => {
      while (inboundLoopRunning) {
        let msg;
        try {
          msg = await bus.consumeInbound();
        } catch {
          break;
        }
        if (!inboundLoopRunning) break;
        const sessionKey = (msg.metadata.sessionKey as string | undefined) ?? 'default';
        const text: string = msg.content;

        if (text === '/new') {
          const newId = randomUUID();
          server!.sendToSessionKey(sessionKey, { type: 'session_changed', sessionId: newId });
          continue;
        }

        // 模拟 agent 响应：完整 turn 事件序列
        const turnId = randomUUID();
        const messageId = randomUUID();
        const chatId: string = msg.chatId;
        await bus.publishOutbound({
          sessionKey,
          chatId,
          channel: 'websocket',
          event: { type: 'turn_start', turnId },
          seq: seq++,
        });
        await bus.publishOutbound({
          sessionKey,
          chatId,
          channel: 'websocket',
          event: { type: 'message_delta', text: `echo: ${text}` },
          seq: seq++,
        });
        await bus.publishOutbound({
          sessionKey,
          chatId,
          channel: 'websocket',
          event: { type: 'message_end', messageId, stopReason: 'end_turn' },
          seq: seq++,
        });
        await bus.publishOutbound({
          sessionKey,
          chatId,
          channel: 'websocket',
          event: { type: 'turn_end', turnId },
          seq: seq++,
        });
      }
    })();
  }

  it('presence: 两客户端连同一 sessionKey，第二加入时第一收到 onlineCount=2', async () => {
    await startServer();
    const sessionKey = randomUUID();

    // ws1 连接 — 首个连接，无其他 peer，不收到 presence
    const { ws: ws1, open: open1 } = connectWithListener(port, { session: sessionKey });
    clients.push(ws1);
    const ws1NoMsg = waitForNoMessage(ws1, 200);
    await open1;
    await ws1NoMsg;

    // ws2 加入 — ws1 应收到 presence onlineCount=2，ws2 不收到自己的 presence
    const ws1Presence = waitForMessage(ws1);
    const { ws: ws2, open: open2 } = connectWithListener(port, { session: sessionKey });
    clients.push(ws2);
    const ws2NoMsg = waitForNoMessage(ws2, 200);
    await open2;

    const msg = await ws1Presence;
    expect(msg.type).toBe('presence');
    expect(msg.onlineCount).toBe(2);

    await ws2NoMsg; // ws2 不收到自己的 presence
  });

  it('消息同步: 客户端 A 发消息，客户端 B 收到 agent 响应（broadcast 按 sessionKey 路由）', async () => {
    await startServer();
    const sessionKey = randomUUID();

    // ws1 连接 — 无 presence
    const { ws: ws1, open: open1 } = connectWithListener(port, { session: sessionKey });
    clients.push(ws1);
    await open1;
    await waitForNoMessage(ws1, 200);

    // ws2 加入 — ws1 收到 presence，ws2 无自己的 presence
    const ws1Presence = waitForMessage(ws1);
    const { ws: ws2, open: open2 } = connectWithListener(port, { session: sessionKey });
    clients.push(ws2);
    await open2;
    const presenceMsg = await ws1Presence;
    expect(presenceMsg.type).toBe('presence');
    await waitForNoMessage(ws2, 200);

    // 注册持久 listener 收集 4 个 event 消息
    const ws1Events = collectMessages(ws1, 4);
    const ws2Events = collectMessages(ws2, 4);

    // ws1 发送消息
    ws1.send(JSON.stringify({ type: 'message', content: 'hello' }));

    const ws1Received = await ws1Events;
    const ws2Received = await ws2Events;

    // 提取 event 类型序列
    const toTypes = (arr: any[]) =>
      arr.map((m) => (m.type === 'event' && m.event ? m.event.type : m.type));
    const ws1Types = toTypes(ws1Received);
    const ws2Types = toTypes(ws2Received);

    // 两端都收到完整 turn 序列
    expect(ws1Types).toEqual(['turn_start', 'message_delta', 'message_end', 'turn_end']);
    expect(ws2Types).toEqual(['turn_start', 'message_delta', 'message_end', 'turn_end']);

    // 验证 message_delta 内容一致
    const ws1Delta = ws1Received.find(
      (m) => m.type === 'event' && m.event?.type === 'message_delta',
    );
    const ws2Delta = ws2Received.find(
      (m) => m.type === 'event' && m.event?.type === 'message_delta',
    );
    expect(ws1Delta.event.text).toBe('echo: hello');
    expect(ws2Delta.event.text).toBe('echo: hello');

    // 验证 seq 一致（两端收到相同 envelope）
    expect(ws1Received[0].seq).toBe(ws2Received[0].seq);
  });

  it('历史回放: 客户端 A 对话后，客户端 B 连接收到 replay（含入站+出站）', async () => {
    await startServer();
    const sessionKey = randomUUID();

    // ws1 连接 — 无 presence
    const { ws: ws1, open: open1 } = connectWithListener(port, { session: sessionKey });
    clients.push(ws1);
    await open1;
    await waitForNoMessage(ws1, 200);

    // ws1 发送消息并收集 4 个 event（消费完整 turn）
    const ws1Events = collectMessages(ws1, 4);
    ws1.send(JSON.stringify({ type: 'message', content: 'earlier msg' }));
    await ws1Events;

    // ws2 连接（带 historyLimit=20）— ws1 收到 presence，ws2 收到 replay
    const ws1Presence = waitForMessage(ws1);
    const { ws: ws2, open: open2 } = connectWithListener(port, {
      session: sessionKey,
      historyLimit: 20,
    });
    clients.push(ws2);
    const ws2First = waitForMessage(ws2);
    await open2;

    // ws1 收到 ws2 加入的 presence
    const presenceMsg = await ws1Presence;
    expect(presenceMsg.type).toBe('presence');
    expect(presenceMsg.onlineCount).toBe(2);

    // ws2 第一条消息应为 replay
    const replayMsg = await ws2First;
    expect(replayMsg.type).toBe('replay');
    expect(replayMsg.replay).toBe(true);
    expect(Array.isArray(replayMsg.messages)).toBe(true);
    expect(replayMsg.messages.length).toBeGreaterThan(0);

    // 应包含入站消息 + 出站事件
    const kinds = replayMsg.messages.map((m: any) => m.kind);
    expect(kinds).toContain('inbound');
    expect(kinds).toContain('outbound');

    // 入站消息内容应为 'earlier msg'
    const inbound = replayMsg.messages.find((m: any) => m.kind === 'inbound');
    expect(inbound.content).toBe('earlier msg');
    expect(inbound.replay).toBe(true);

    // 出站事件应包含 message_delta
    const outboundDelta = replayMsg.messages.find(
      (m: any) => m.kind === 'outbound' && m.event?.type === 'message_delta',
    );
    expect(outboundDelta).toBeTruthy();
    expect(outboundDelta.event.text).toBe('echo: earlier msg');
    expect(outboundDelta.replay).toBe(true);
  });

  it('session_changed: 客户端发 /new 后收到 session_changed 事件', async () => {
    await startServer();
    const sessionKey = randomUUID();

    // ws1 连接 — 无 presence
    const { ws: ws1, open: open1 } = connectWithListener(port, { session: sessionKey });
    clients.push(ws1);
    await open1;
    await waitForNoMessage(ws1, 200);

    // ws1 发送 /new — 应收到 session_changed
    const ws1Event = waitForMessage(ws1, 3000);
    ws1.send(JSON.stringify({ type: 'message', content: '/new' }));
    const msg = await ws1Event;
    expect(msg.type).toBe('session_changed');
    expect(typeof msg.sessionId).toBe('string');
    expect(msg.sessionId).not.toBe(sessionKey);
    // 新 sessionId 应为有效 UUID v4 格式
    expect(msg.sessionId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
  });
});
