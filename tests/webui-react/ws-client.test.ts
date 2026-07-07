// @vitest-environment happy-dom
/**
 * Task 3 (React WebUI redesign): WsClient 单元测试。
 *
 * 通过 vi.stubGlobal('WebSocket', MockWebSocket) 替换全局 WebSocket，
 * 验证：
 *   - connect(token, sessionId) 构建 URL（含 token、session、lastEventSeq）并 new WebSocket
 *   - send(content) 发送 `{ type: 'message', content }` JSON
 *   - sendSlash(cmd) 发送 slash 命令（如 `/new`）
 *   - 收到 `{ type: 'event', seq, event }` 时更新 lastEventSeq 并触发 'event' handler
 *   - 'user_identified' / 'error' / 'presence' / 'replay' 各自触发对应 handler
 *   - 'resync_required' 重置 lastEventSeq=0 并重连（触发 'open' 二次）
 *   - 'session_changed' 触发 handler、重置 lastEventSeq=0、并用新 sessionId 自动重连
 *   - close() 关闭 ws 并停止自动重连
 *
 * happy-dom 提供 location.protocol / location.host（构建 URL 用）。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { WsClient } from '../../src/webui-react/lib/ws-client.js';

/** 标准 readyState 常量 */
const CONNECTING = 0;
const OPEN = 1;
const CLOSING = 2;
const CLOSED = 3;

/** 记录最近一次构造的实例，供测试触发 onopen/onmessage/onclose */
let lastInstance: MockWebSocket | null = null;

/** 捕获所有 send 调用的原始字符串 */
class MockWebSocket {
  static instances: MockWebSocket[] = [];
  static OPEN = OPEN;
  static CONNECTING = CONNECTING;
  static CLOSING = CLOSING;
  static CLOSED = CLOSED;

  url: string;
  readyState: number = OPEN;
  onopen: ((ev: Event) => void) | null = null;
  onmessage: ((ev: MessageEvent) => void) | null = null;
  onclose: ((ev: CloseEvent) => void) | null = null;
  onerror: ((ev: Event) => void) | null = null;
  sent: string[] = [];
  closed = false;

  constructor(url: string) {
    this.url = url;
    MockWebSocket.instances.push(this);
    lastInstance = this;
  }

  send(data: string): void {
    this.sent.push(data);
  }

  close(): void {
    this.closed = true;
    this.readyState = CLOSED;
  }

  /** 测试辅助：模拟服务端消息到达 */
  emitMessage(data: unknown): void {
    if (!this.onmessage) return;
    this.onmessage({ data: typeof data === 'string' ? data : JSON.stringify(data) } as MessageEvent);
  }

  /** 测试辅助：触发 onopen */
  emitOpen(): void {
    this.readyState = OPEN;
    this.onopen?.({} as Event);
  }

  /** 测试辅助：触发 onclose */
  emitClose(): void {
    this.readyState = CLOSED;
    this.onclose?.({} as CloseEvent);
  }
}

describe('WsClient', () => {
  let originalWebSocket: typeof WebSocket | undefined;

  beforeEach(() => {
    MockWebSocket.instances = [];
    lastInstance = null;
    originalWebSocket = (globalThis as { WebSocket?: typeof WebSocket }).WebSocket;
    vi.stubGlobal('WebSocket', MockWebSocket);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    if (originalWebSocket !== undefined) {
      (globalThis as { WebSocket?: typeof WebSocket }).WebSocket = originalWebSocket;
    }
  });

  describe('connect(token, sessionId)', () => {
    it('构建 ws(s)://<host>/ws?token=&session=&lastEventSeq= URL', () => {
      const client = new WsClient();
      client.connect('tok-123', 'sess-abc');

      expect(MockWebSocket.instances.length).toBe(1);
      const ws = MockWebSocket.instances[0];
      const url = new URL(ws.url);
      // happy-dom 默认 location.protocol = 'http:'，故 ws:
      expect(url.protocol).toBe('ws:');
      expect(url.host).toBe(location.host);
      expect(url.pathname).toBe('/ws');
      expect(url.searchParams.get('token')).toBe('tok-123');
      expect(url.searchParams.get('session')).toBe('sess-abc');
      expect(url.searchParams.get('lastEventSeq')).toBe('0');
    });

    it('lastEventSeq 累积后反映在重连 URL 上', () => {
      const client = new WsClient();
      client.connect('tok-123', 'sess-abc');
      const ws = MockWebSocket.instances[0];
      ws.emitOpen();
      ws.emitMessage({ type: 'event', seq: 5, event: { type: 'message_delta', text: 'hi' } });

      expect(client.lastEventSeq).toBe(5);

      // 触发重连（通过 resync_required）
      ws.emitMessage({ type: 'resync_required' });

      const newWs = MockWebSocket.instances[1];
      expect(newWs).toBeDefined();
      expect(newWs.url).toContain('lastEventSeq=0');
    });
  });

  describe('send(content)', () => {
    it('通过 OPEN 状态的 WebSocket 发送 { type: "message", content } JSON', () => {
      const client = new WsClient();
      client.connect('tok', 'sess');
      const ws = MockWebSocket.instances[0];
      ws.emitOpen();

      client.send('hello world');

      expect(ws.sent.length).toBe(1);
      const parsed = JSON.parse(ws.sent[0]);
      expect(parsed).toEqual({ type: 'message', content: 'hello world' });
    });

    it('未连接时 send 静默忽略', () => {
      const client = new WsClient();
      // 未调用 connect，无 ws 实例
      expect(() => client.send('hi')).not.toThrow();
    });

    it('readyState 非 OPEN 时静默忽略', () => {
      const client = new WsClient();
      client.connect('tok', 'sess');
      const ws = MockWebSocket.instances[0];
      ws.readyState = CONNECTING;

      client.send('hi');

      expect(ws.sent.length).toBe(0);
    });
  });

  describe('sendSlash(cmd)', () => {
    it('发送 /new 作为 message content', () => {
      const client = new WsClient();
      client.connect('tok', 'sess');
      const ws = MockWebSocket.instances[0];
      ws.emitOpen();

      client.sendSlash('/new');

      expect(ws.sent.length).toBe(1);
      const parsed = JSON.parse(ws.sent[0]);
      expect(parsed).toEqual({ type: 'message', content: '/new' });
    });

    it('发送 /resume 作为 message content', () => {
      const client = new WsClient();
      client.connect('tok', 'sess');
      const ws = MockWebSocket.instances[0];
      ws.emitOpen();

      client.sendSlash('/resume');

      const parsed = JSON.parse(ws.sent[0]);
      expect(parsed).toEqual({ type: 'message', content: '/resume' });
    });
  });

  describe('on(event, handler) 分发', () => {
    it('收到 { type: "event", seq, event } 时更新 lastEventSeq 并触发 "event" handler', () => {
      const client = new WsClient();
      client.connect('tok', 'sess');
      const ws = MockWebSocket.instances[0];
      ws.emitOpen();

      const events: unknown[] = [];
      client.on('event', (e) => events.push(e));

      ws.emitMessage({ type: 'event', seq: 1, event: { type: 'message_delta', text: 'Hi' } });
      ws.emitMessage({ type: 'event', seq: 2, event: { type: 'message_delta', text: ' there' } });

      expect(client.lastEventSeq).toBe(2);
      expect(events).toEqual([
        { type: 'message_delta', text: 'Hi' },
        { type: 'message_delta', text: ' there' },
      ]);
    });

    it('seq 回退或相等时不更新 lastEventSeq', () => {
      const client = new WsClient();
      client.connect('tok', 'sess');
      const ws = MockWebSocket.instances[0];
      ws.emitOpen();

      client.on('event', () => {});
      ws.emitMessage({ type: 'event', seq: 10, event: { type: 'message_start', messageId: 'm1' } });
      ws.emitMessage({ type: 'event', seq: 5, event: { type: 'message_delta', text: 'old' } }); // 旧 seq
      ws.emitMessage({ type: 'event', seq: 10, event: { type: 'message_delta', text: 'dup' } }); // 同 seq

      expect(client.lastEventSeq).toBe(10);
    });

    it('收到 user_identified 时触发对应 handler（携带 userId/sessionId 等）', () => {
      const client = new WsClient();
      client.connect('tok', 'sess');
      const ws = MockWebSocket.instances[0];
      ws.emitOpen();

      const calls: unknown[] = [];
      client.on('user_identified', (payload) => calls.push(payload));

      ws.emitMessage({
        type: 'user_identified',
        userId: 'u1',
        username: 'alice',
        sessionId: 'sess-agent',
        clientId: 'c1',
      });

      expect(calls).toEqual([{
        type: 'user_identified',
        userId: 'u1',
        username: 'alice',
        sessionId: 'sess-agent',
        clientId: 'c1',
      }]);
    });

    it('收到 error 时触发 "error" handler', () => {
      const client = new WsClient();
      client.connect('tok', 'sess');
      const ws = MockWebSocket.instances[0];
      ws.emitOpen();

      const calls: unknown[] = [];
      client.on('error', (p) => calls.push(p));

      ws.emitMessage({ type: 'error', code: 'rate_limited', message: 'Rate limit exceeded' });

      expect(calls).toEqual([{ type: 'error', code: 'rate_limited', message: 'Rate limit exceeded' }]);
    });

    it('收到 presence 时触发 "presence" handler', () => {
      const client = new WsClient();
      client.connect('tok', 'sess');
      const ws = MockWebSocket.instances[0];
      ws.emitOpen();

      const calls: unknown[] = [];
      client.on('presence', (p) => calls.push(p));

      ws.emitMessage({ type: 'presence', onlineCount: 3 });

      expect(calls).toEqual([{ type: 'presence', onlineCount: 3 }]);
    });

    it('收到 replay 时触发 "replay" handler', () => {
      const client = new WsClient();
      client.connect('tok', 'sess');
      const ws = MockWebSocket.instances[0];
      ws.emitOpen();

      const calls: unknown[] = [];
      client.on('replay', (p) => calls.push(p));

      ws.emitMessage({ type: 'replay', replay: true, source: 'jsonl', messages: [{ id: 'm1' }] });

      expect(calls).toEqual([{
        type: 'replay',
        replay: true,
        source: 'jsonl',
        messages: [{ id: 'm1' }],
      }]);
    });

    it('收到 session_changed 时触发 handler，重置 lastEventSeq=0，并用新 sessionId 自动重连', () => {
      const client = new WsClient();
      client.connect('tok', 'sess');
      const ws = MockWebSocket.instances[0];
      ws.emitOpen();

      // 先累积 seq，验证 session_changed 会重置
      client.on('event', () => {});
      ws.emitMessage({ type: 'event', seq: 9, event: { type: 'message_delta', text: 'x' } });
      expect(client.lastEventSeq).toBe(9);

      const calls: unknown[] = [];
      client.on('session_changed', (p) => calls.push(p));

      ws.emitMessage({ type: 'session_changed', sessionId: 'new-session' });

      // handler 被调用，携带完整 server 消息
      expect(calls).toEqual([{ type: 'session_changed', sessionId: 'new-session' }]);
      // lastEventSeq 重置为 0（新 session 全量 replay）
      expect(client.lastEventSeq).toBe(0);
      // 自动重连 — 新建一个 WebSocket 实例
      expect(MockWebSocket.instances.length).toBe(2);
      // 新连接使用新 sessionId、保留 token、含重置后的 lastEventSeq=0
      const newWs = MockWebSocket.instances[1];
      const newUrl = new URL(newWs.url);
      expect(newUrl.searchParams.get('session')).toBe('new-session');
      expect(newUrl.searchParams.get('token')).toBe('tok');
      expect(newUrl.searchParams.get('lastEventSeq')).toBe('0');
      // 旧 ws 被关闭
      expect(ws.closed).toBe(true);
    });

    it('收到 session_renamed 时触发 handler', () => {
      const client = new WsClient();
      client.connect('tok', 'sess');
      const ws = MockWebSocket.instances[0];
      ws.emitOpen();

      const calls: unknown[] = [];
      client.on('session_renamed', (p) => calls.push(p));

      ws.emitMessage({ type: 'session_renamed', sessionId: 'sess-1', label: 'My Chat' });

      expect(calls).toEqual([{ type: 'session_renamed', sessionId: 'sess-1', label: 'My Chat' }]);
    });

    it('收到 session_deleted 时触发 handler', () => {
      const client = new WsClient();
      client.connect('tok', 'sess');
      const ws = MockWebSocket.instances[0];
      ws.emitOpen();

      const calls: unknown[] = [];
      client.on('session_deleted', (p) => calls.push(p));

      ws.emitMessage({ type: 'session_deleted', sessionId: 'sess-1' });

      expect(calls).toEqual([{ type: 'session_deleted', sessionId: 'sess-1' }]);
    });

    it('收到 resync_required 时触发 handler 并重置 lastEventSeq=0 并重连', () => {
      const client = new WsClient();
      client.connect('tok', 'sess');
      const ws = MockWebSocket.instances[0];
      ws.emitOpen();

      // 先累积 seq
      client.on('event', () => {});
      ws.emitMessage({ type: 'event', seq: 7, event: { type: 'message_delta', text: 'x' } });
      expect(client.lastEventSeq).toBe(7);

      const resyncCalls: unknown[] = [];
      client.on('resync_required', (p) => resyncCalls.push(p));

      ws.emitMessage({ type: 'resync_required' });

      // lastEventSeq 重置
      expect(client.lastEventSeq).toBe(0);
      // handler 被调用
      expect(resyncCalls.length).toBe(1);
      // 自动重连 — 新建一个 WebSocket 实例（含 lastEventSeq=0）
      expect(MockWebSocket.instances.length).toBe(2);
      expect(MockWebSocket.instances[1].url).toContain('lastEventSeq=0');
    });

    it('onopen 时触发 "open" handler，onclose 时触发 "close" handler', () => {
      const client = new WsClient();
      client.connect('tok', 'sess');
      const ws = MockWebSocket.instances[0];

      const openCalls: unknown[] = [];
      const closeCalls: unknown[] = [];
      client.on('open', () => openCalls.push(null));
      client.on('close', () => closeCalls.push(null));

      ws.emitOpen();
      expect(openCalls.length).toBe(1);

      ws.emitClose();
      expect(closeCalls.length).toBe(1);
    });

    it('多个 handler 可注册同一 event', () => {
      const client = new WsClient();
      client.connect('tok', 'sess');
      const ws = MockWebSocket.instances[0];
      ws.emitOpen();

      const calls1: unknown[] = [];
      const calls2: unknown[] = [];
      client.on('event', (e) => calls1.push(e));
      client.on('event', (e) => calls2.push(e));

      ws.emitMessage({ type: 'event', seq: 1, event: { type: 'agent_start' } });

      expect(calls1).toEqual([{ type: 'agent_start' }]);
      expect(calls2).toEqual([{ type: 'agent_start' }]);
    });

    it('未注册 handler 的 event 静默忽略（不抛错）', () => {
      const client = new WsClient();
      client.connect('tok', 'sess');
      const ws = MockWebSocket.instances[0];
      ws.emitOpen();

      expect(() => {
        ws.emitMessage({ type: 'presence', onlineCount: 1 });
      }).not.toThrow();
    });

    it('handler 抛错不影响其他 handler 与后续消息', () => {
      const client = new WsClient();
      client.connect('tok', 'sess');
      const ws = MockWebSocket.instances[0];
      ws.emitOpen();

      const good: unknown[] = [];
      client.on('event', () => { throw new Error('handler bug'); });
      client.on('event', (e) => good.push(e));

      ws.emitMessage({ type: 'event', seq: 1, event: { type: 'agent_start' } });
      ws.emitMessage({ type: 'event', seq: 2, event: { type: 'agent_end' } });

      expect(good.length).toBe(2);
      expect(client.lastEventSeq).toBe(2);
    });

    it('收到非 JSON 消息静默忽略', () => {
      const client = new WsClient();
      client.connect('tok', 'sess');
      const ws = MockWebSocket.instances[0];
      ws.emitOpen();

      expect(() => ws.emitMessage('not-json{')).not.toThrow();
      expect(client.lastEventSeq).toBe(0);
    });
  });

  describe('自动重连', () => {
    it('连接断开时按指数退避重连（初始 3 秒，最大 30 秒）', () => {
      vi.useFakeTimers();
      try {
        const client = new WsClient();
        client.connect('tok', 'sess');
        const ws1 = MockWebSocket.instances[0];
        ws1.emitOpen();

        // 触发 close — 应在 3 秒后重连
        ws1.emitClose();

        expect(MockWebSocket.instances.length).toBe(1);
        vi.advanceTimersByTime(2999);
        expect(MockWebSocket.instances.length).toBe(1);
        vi.advanceTimersByTime(2);
        expect(MockWebSocket.instances.length).toBe(2);

        // 第二次断开 — 应在 6 秒后重连（指数退避）
        MockWebSocket.instances[1].emitOpen();
        MockWebSocket.instances[1].emitClose();
        vi.advanceTimersByTime(5999);
        expect(MockWebSocket.instances.length).toBe(2);
        vi.advanceTimersByTime(2);
        expect(MockWebSocket.instances.length).toBe(3);

        // 第三次断开 — 12 秒
        MockWebSocket.instances[2].emitOpen();
        MockWebSocket.instances[2].emitClose();
        vi.advanceTimersByTime(11999);
        expect(MockWebSocket.instances.length).toBe(3);
        vi.advanceTimersByTime(2);
        expect(MockWebSocket.instances.length).toBe(4);
      } finally {
        vi.useRealTimers();
      }
    });

    it('退避时间封顶 30 秒', () => {
      vi.useFakeTimers();
      try {
        const client = new WsClient();
        client.connect('tok', 'sess');
        let ws = MockWebSocket.instances[0];
        ws.emitOpen();

        // 模拟多次断开 — 3, 6, 12, 24, 30, 30, 30...
        const delays: number[] = [3000, 6000, 12000, 24000, 30000, 30000];
        for (const delay of delays) {
          ws.emitClose();
          expect(MockWebSocket.instances.length).toBe(MockWebSocket.instances.indexOf(ws) + 1);
          vi.advanceTimersByTime(delay - 1);
          expect(MockWebSocket.instances.length).toBe(MockWebSocket.instances.indexOf(ws) + 1);
          vi.advanceTimersByTime(2);
          ws = MockWebSocket.instances[MockWebSocket.instances.length - 1];
          ws.emitOpen();
        }
      } finally {
        vi.useRealTimers();
      }
    });

    it('close() 后不再自动重连', () => {
      vi.useFakeTimers();
      try {
        const client = new WsClient();
        client.connect('tok', 'sess');
        const ws = MockWebSocket.instances[0];
        ws.emitOpen();

        client.close();
        // close() 内部已调用 ws.close()，触发 onclose
        if (ws.onclose) ws.onclose({} as CloseEvent);

        vi.advanceTimersByTime(60000);
        expect(MockWebSocket.instances.length).toBe(1);
      } finally {
        vi.useRealTimers();
      }
    });
  });

  describe('close()', () => {
    it('关闭底层 WebSocket 并清理重连定时器', () => {
      vi.useFakeTimers();
      try {
        const client = new WsClient();
        client.connect('tok', 'sess');
        const ws = MockWebSocket.instances[0];
        ws.emitOpen();

        // 触发一次重连调度（但未到时）
        ws.emitClose();
        // 此时调度了 3 秒重连
        client.close();

        vi.advanceTimersByTime(60000);
        expect(MockWebSocket.instances.length).toBe(1);
        expect(ws.closed).toBe(true);
      } finally {
        vi.useRealTimers();
      }
    });

    it('多次 close 幂等', () => {
      const client = new WsClient();
      client.connect('tok', 'sess');

      expect(() => {
        client.close();
        client.close();
        client.close();
      }).not.toThrow();
    });
  });
});
