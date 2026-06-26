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
 * §7.2 Channel: 通道接口。
 */
export interface Channel {
  readonly name: string;
  readonly capabilities: ChannelCapability;
  readonly messageLengthLimit?: number;
  start(bus: MessageBus): Promise<void>;
  stop(): Promise<void>;
  consume(envelope: AgentEventEnvelope): void | Promise<void>;
}

/**
 * §7.3 MessageBus: 双向队列接口。
 */
export interface MessageBus {
  publishInbound(msg: InboundMessage): Promise<void>;
  consumeInbound(): Promise<InboundMessage>;
  publishOutbound(envelope: AgentEventEnvelope): Promise<void>;
  consumeOutbound(): Promise<AgentEventEnvelope>;
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
