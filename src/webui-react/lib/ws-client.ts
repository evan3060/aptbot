/**
 * Task 3 (React WebUI redesign): WebSocket 客户端。
 *
 * 职责：
 * - 构建 `ws(s)://<host>/ws?token=<token>&session=<sessionId>&lastEventSeq=<seq>` URL 并 new WebSocket
 * - onmessage 解析 JSON，按 `type` 分发到注册的 handler
 * - 维护 lastEventSeq（ring buffer resync 协议）
 * - 收到 `resync_required` 时重置 lastEventSeq=0 并重连
 * - 收到 `session_changed` 时更新 currentSessionId、重置 lastEventSeq=0、emit 后用新 sessionId 重连
 * - 连接断开时按指数退避自动重连（3s 起，最大 30s）
 *
 * session_changed 由 WsClient 自动重连；App.tsx（Task 9）仅监听该事件以更新 UI 状态（activeSessionId、清空 messages）。
 *
 * 服务端消息形状见 src/webui-react/types.ts WsServerMessage 注释。
 */
import type { WsServerMessage, AgentEvent } from '../types.js';

/** WsClient 支持的 event 名（与 WsServerMessage.type 一致 + 'open'/'close' 生命周期） */
export type WsClientEventName =
  | 'event'
  | 'user_identified'
  | 'error'
  | 'presence'
  | 'replay'
  | 'resync_required'
  | 'session_changed'
  | 'session_renamed'
  | 'session_deleted'
  | 'open'
  | 'close';

/** 通用 handler — payload 类型由 event 名隐式决定，调用方自行断言 */
type Handler = (payload: unknown) => void;

/** 自动重连初始延迟（毫秒） */
const RECONNECT_INITIAL_MS = 3000;
/** 自动重连最大延迟（毫秒） */
const RECONNECT_MAX_MS = 30000;

/**
 * WsClient — 单连接 WebSocket 客户端，配合 React WebUI 使用。
 *
 * 典型用法：
 *   const ws = new WsClient();
 *   ws.on('event', (event: AgentEvent) => dispatch(event));
 *   ws.on('session_changed', (msg) => { setActiveSessionId(msg.sessionId); clearMessages(); });
 *   ws.connect(token, sessionId);
 */
export class WsClient {
  /** 最近一次收到的 event seq，重连时回传给服务端用于 ring buffer resync */
  lastEventSeq = 0;

  private ws: WebSocket | null = null;
  private handlers = new Map<WsClientEventName, Set<Handler>>();
  private reconnectDelay = RECONNECT_INITIAL_MS;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private shouldReconnect = false;
  private currentToken: string | null = null;
  private currentSessionId: string | null = null;

  /** 注册 handler；同一 event 可多次注册，全部按注册顺序调用 */
  on(event: WsClientEventName, handler: Handler): void {
    let set = this.handlers.get(event);
    if (!set) {
      set = new Set();
      this.handlers.set(event, set);
    }
    set.add(handler);
  }

  /** 注销 handler（与 on 配对，便于组件卸载时清理） */
  off(event: WsClientEventName, handler: Handler): void {
    const set = this.handlers.get(event);
    if (set) set.delete(handler);
  }

  private emit(event: WsClientEventName, payload: unknown): void {
    const set = this.handlers.get(event);
    if (!set) return;
    for (const h of set) {
      try {
        h(payload);
      } catch {
        // 单个 handler 抛错不影响其他 handler 与后续消息处理
      }
    }
  }

  /**
   * 连接到指定 session。
   * 同一实例多次调用 connect 会先关闭旧连接（不触发自动重连），再开新连接。
   */
  connect(token: string, sessionId: string): void {
    this.currentToken = token;
    this.currentSessionId = sessionId;
    this.shouldReconnect = true;
    this.reconnectDelay = RECONNECT_INITIAL_MS;
    this.openInternal(/* resetDelay */ false);
  }

  /**
   * 构建 WebSocket URL，含 token、session、lastEventSeq、historyLimit 四个 query 参数。
   *
   * historyLimit 触发服务端 full history replay 路径（replayHistory），合并
   * inbound（用户消息）+ outbound（assistant 事件），并在 ring buffer 空时
   * fallback 到 JSONL 历史。这是 /resume 后历史消息能正确加载的关键 —
   * 仅靠 lastEventSeq 路径（replayBufferedEvents）只回放出站事件，用户消息
   * 不会出现在历史回放中。
   */
  private buildUrl(): string {
    const proto = typeof location !== 'undefined' && location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = typeof location !== 'undefined' ? location.host : 'localhost';
    const base = `${proto}//${host}/ws`;
    const params = new URLSearchParams();
    if (this.currentToken) params.set('token', this.currentToken);
    if (this.currentSessionId) params.set('session', this.currentSessionId);
    params.set('lastEventSeq', String(this.lastEventSeq));
    params.set('historyLimit', '50');
    return `${base}?${params.toString()}`;
  }

  private openInternal(resetDelay: boolean): void {
    if (resetDelay) {
      this.reconnectDelay = RECONNECT_INITIAL_MS;
    }
    const url = this.buildUrl();
    const ws = new WebSocket(url);
    this.ws = ws;

    ws.onopen = () => {
      // 不在此处重置 reconnectDelay —— 让指数退避跨连续断开累积。
      // 仅 connect()（用户显式连接）与 resync_required（reconnectNow）会重置。
      this.emit('open', undefined);
    };

    ws.onmessage = (ev: MessageEvent) => {
      let msg: WsServerMessage;
      try {
        const raw = typeof ev.data === 'string' ? ev.data : String(ev.data);
        msg = JSON.parse(raw) as WsServerMessage;
      } catch {
        // 非 JSON 消息静默忽略
        return;
      }
      this.handleMessage(msg);
    };

    ws.onclose = () => {
      this.emit('close', undefined);
      if (this.shouldReconnect) {
        this.scheduleReconnect();
      }
    };

    ws.onerror = () => {
      // 错误由 onclose 兜底处理（自动重连）
    };
  }

  private handleMessage(msg: WsServerMessage): void {
    switch (msg.type) {
      case 'event': {
        if (typeof msg.seq === 'number' && msg.seq > this.lastEventSeq) {
          this.lastEventSeq = msg.seq;
        }
        this.emit('event', msg.event as AgentEvent);
        break;
      }
      case 'user_identified':
        this.emit('user_identified', msg);
        break;
      case 'error':
        this.emit('error', msg);
        // session_ownership_mismatch 是 fatal 错误 — 当前 sessionKey 属于其他用户，
        // 继续重连只会死循环。停止自动重连，由 App.tsx 重新 bootstrap 获取有效 sessionId。
        if (msg.code === 'session_ownership_mismatch') {
          this.shouldReconnect = false;
          if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
          }
        }
        break;
      case 'presence':
        this.emit('presence', msg);
        break;
      case 'replay':
        this.emit('replay', msg);
        break;
      case 'resync_required':
        // ring buffer 缺口 — 重置 seq 并重连，让服务端从最新 buffer 重新投递
        this.lastEventSeq = 0;
        this.emit('resync_required', undefined);
        this.reconnectNow();
        break;
      case 'session_changed': {
        // 切换到新 session：更新 currentSessionId、重置 seq、emit，再重连
        // WsClient 拥有连接生命周期，收到 session_changed 即用新 sessionId 重连；
        // App.tsx（Task 9）仅监听 'session_changed' 以更新 UI 状态（activeSessionId、清空 messages）
        this.currentSessionId = msg.sessionId;
        this.lastEventSeq = 0;
        this.emit('session_changed', msg);
        this.reconnectNow();
        break;
      }
      case 'session_renamed':
        this.emit('session_renamed', msg);
        break;
      case 'session_deleted':
        this.emit('session_deleted', msg);
        break;
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    const delay = this.reconnectDelay;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.openInternal(false);
    }, delay);
    // 指数退避：3s → 6s → 12s → 24s → 30s（封顶）
    this.reconnectDelay = Math.min(this.reconnectDelay * 2, RECONNECT_MAX_MS);
  }

  /** 立即重连：关闭当前 ws（不触发自动重连），再 openInternal */
  private reconnectNow(): void {
    if (this.ws) {
      const old = this.ws;
      // 临时摘掉 onclose，避免 close 触发额外的 scheduleReconnect
      old.onclose = null;
      old.onmessage = null;
      old.onopen = null;
      old.onerror = null;
      try {
        old.close();
      } catch {
        // 已关闭则忽略
      }
      this.ws = null;
    }
    this.openInternal(true);
  }

  /** 发送普通消息：`{ type: 'message', content }` */
  send(content: string): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    this.ws.send(JSON.stringify({ type: 'message', content }));
  }

  /** 发送 slash 命令（如 `/new`、`/resume`）；服务端按 `/` 前缀识别 */
  sendSlash(cmd: string): void {
    this.send(cmd);
  }

  /** 主动关闭连接，停止自动重连 */
  close(): void {
    this.shouldReconnect = false;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      const ws = this.ws;
      ws.onclose = null;
      ws.onmessage = null;
      ws.onopen = null;
      ws.onerror = null;
      try {
        ws.close();
      } catch {
        // 已关闭则忽略
      }
      this.ws = null;
    }
  }
}
