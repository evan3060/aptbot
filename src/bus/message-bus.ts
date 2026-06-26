import type { InboundMessage, AgentEventEnvelope, MessageBus } from './types.js';

export const INBOUND_QUEUE_MAX = 100;
export const OUTBOUND_QUEUE_MAX = 1000;

const DROPPIABLE_EVENT_TYPES = new Set(['message_delta', 'reasoning_delta']);

/**
 * §7.3 / §10.1.6 InMemoryMessageBus: 内存双向队列实现。
 * - inbound 上限 100，溢出抛 `inbound_queue_full`。
 * - outbound 上限 1000，溢出丢弃最旧的 message_delta/reasoning_delta（§10.1.4）。
 * - FIFO 保证，consume 在空队列时阻塞。
 */
export class InMemoryMessageBus implements MessageBus {
  private inboundQueue: InboundMessage[] = [];
  private outboundQueue: AgentEventEnvelope[] = [];
  private inboundWaiter: ((msg: InboundMessage) => void) | null = null;
  private outboundWaiter: ((env: AgentEventEnvelope) => void) | null = null;

  async publishInbound(msg: InboundMessage): Promise<void> {
    if (this.inboundWaiter) {
      const waiter = this.inboundWaiter;
      this.inboundWaiter = null;
      waiter(msg);
      return;
    }
    if (this.inboundQueue.length >= INBOUND_QUEUE_MAX) {
      throw new Error('inbound_queue_full');
    }
    this.inboundQueue.push(msg);
  }

  async consumeInbound(): Promise<InboundMessage> {
    if (this.inboundQueue.length > 0) {
      return this.inboundQueue.shift()!;
    }
    return new Promise<InboundMessage>((resolve) => {
      this.inboundWaiter = resolve;
    });
  }

  async publishOutbound(envelope: AgentEventEnvelope): Promise<void> {
    if (this.outboundWaiter) {
      const waiter = this.outboundWaiter;
      this.outboundWaiter = null;
      waiter(envelope);
      return;
    }
    if (this.outboundQueue.length >= OUTBOUND_QUEUE_MAX) {
      const dropIndex = this.outboundQueue.findIndex(
        (e) => DROPPIABLE_EVENT_TYPES.has(e.event.type),
      );
      if (dropIndex >= 0) {
        this.outboundQueue.splice(dropIndex, 1);
      } else {
        this.outboundQueue.shift();
      }
    }
    this.outboundQueue.push(envelope);
  }

  async consumeOutbound(): Promise<AgentEventEnvelope> {
    if (this.outboundQueue.length > 0) {
      return this.outboundQueue.shift()!;
    }
    return new Promise<AgentEventEnvelope>((resolve) => {
      this.outboundWaiter = resolve;
    });
  }
}
