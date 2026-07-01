import type { AgentEvent } from '../core/agent/events.js';

/**
 * §7.2 InboundMessage: 入站消息载体。
 */
export interface InboundMessage {
  readonly channel: string;
  readonly senderId: string;
  readonly chatId: string;
  readonly content: string;
  readonly media?: MediaContent[];
  readonly metadata: Record<string, unknown>;
  readonly sessionKey?: string;
}

export interface MediaContent {
  type: 'image' | 'file';
  mediaType: string;
  data: string;
  sizeBytes: number;
}

/**
 * §7.2 AgentEventEnvelope: 出站事件信封。
 */
export interface AgentEventEnvelope {
  readonly sessionKey: string;
  readonly chatId: string;
  readonly channel: string;
  readonly event: AgentEvent;
  readonly seq: number;
}

/**
 * §7.4 ChannelCapability: 能力声明。
 */
export interface ChannelCapability {
  streaming: boolean;
  reasoning: boolean;
  richUi: boolean;
  fileEditEvents: boolean;
  editMessage: boolean;
  markdown: boolean | 'limited';
}

/**
 * §7.2 Channel: 通道接口（bus-facing，应用层）。
 */
export interface Channel {
  readonly name: string;
  readonly capabilities: ChannelCapability;
  readonly messageLengthLimit?: number;
  start(bus: MessageBus): Promise<void>;
  stop(): Promise<void>;
  consume(envelope: AgentEventEnvelope): void | Promise<void>;
  /**
   * §4.12 可选健康检查：TransportChannel-backed adapter 实现此方法，
   * ChannelManager 在 consume 失败后调用以判断是否自动 unbind。
   * 普通 Channel 不实现（保持向后兼容，consume 抛错不触发 unbind）。
   */
  isAlive?(): boolean;
}

/**
 * §4.12 TransportChannel: 最小传输层接口（4 个方法），供 IM-style channel 实现。
 * 与 bus-facing Channel 解耦：IM channel（Telegram bot chat、Discord channel）实现此接口，
 * 通过 wrapTransportChannel 适配为完整 Channel 后注册到 ChannelManager。
 */
export interface TransportChannel {
  /** 传输类型标识：'websocket' | 'telegram' | 'discord' | ... */
  readonly type: string;
  /** 发送原始数据（JSON 字符串或二进制），传输断开时抛错 */
  send(data: string | Uint8Array): Promise<void>;
  /** 关闭传输连接 */
  close(): Promise<void>;
  /** 传输是否仍存活 */
  isAlive(): boolean;
}

/**
 * §7.3 MessageBus: 双向队列接口。
 */
export interface MessageBus {
  publishInbound(msg: InboundMessage): Promise<void>;
  consumeInbound(): Promise<InboundMessage>;
  publishOutbound(envelope: AgentEventEnvelope): Promise<void>;
  consumeOutbound(): Promise<AgentEventEnvelope>;
  // I14 修复：取消 pending consumeOutbound 的 waiter，使 unmount 后事件保留在队列中
  cancelOutboundWaiter?(): void;
}

/**
 * §7.4 matchesCapability: 按 §7.4 能力过滤规则实现。
 * - message_delta 需 streaming
 * - reasoning_delta 需 reasoning
 * - tool_* 始终投递（richUi=false 时由 consumer 降级处理）
 * - 其他始终投递
 */
export function matchesCapability(cap: ChannelCapability, event: AgentEvent): boolean {
  switch (event.type) {
    case 'message_delta':
      return cap.streaming;
    case 'reasoning_delta':
      return cap.reasoning;
    default:
      return true;
  }
}
