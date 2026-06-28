import { describe, it, expect } from 'vitest';
import {
  InMemoryMessageBus,
  INBOUND_QUEUE_MAX,
  OUTBOUND_QUEUE_MAX,
} from '../../src/bus/message-bus.js';
import type { InboundMessage, AgentEventEnvelope } from '../../src/bus/types.js';

function makeInbound(content: string): InboundMessage {
  return {
    channel: 'test',
    senderId: 'user1',
    chatId: 'chat1',
    content,
    metadata: {},
  };
}

function makeEnvelope(seq: number, eventType: string = 'message_delta'): AgentEventEnvelope {
  const event: AgentEventEnvelope['event'] =
    eventType === 'agent_start'
      ? { type: 'agent_start' }
      : eventType === 'message_end'
        ? { type: 'message_end', messageId: 'm1', stopReason: 'end_turn' }
        : eventType === 'tool_result'
          ? { type: 'tool_result', toolCallId: 'tc1', success: true, summary: 'ok' }
          : eventType === 'tool_call_start'
            ? { type: 'tool_call_start', toolCallId: 'tc1', toolName: 'bash' }
            : { type: 'message_delta', text: `delta-${seq}` };
  return { sessionKey: 's1', chatId: 'c1', channel: 'test', event, seq };
}

describe('InMemoryMessageBus', () => {
  it('inbound publish/consume round-trip', async () => {
    const bus = new InMemoryMessageBus();
    await bus.publishInbound(makeInbound('hello'));
    const msg = await bus.consumeInbound();
    expect(msg.content).toBe('hello');
  });

  it('inbound FIFO order', async () => {
    const bus = new InMemoryMessageBus();
    await bus.publishInbound(makeInbound('first'));
    await bus.publishInbound(makeInbound('second'));
    await bus.publishInbound(makeInbound('third'));
    expect((await bus.consumeInbound()).content).toBe('first');
    expect((await bus.consumeInbound()).content).toBe('second');
    expect((await bus.consumeInbound()).content).toBe('third');
  });

  it('outbound publish/consume round-trip', async () => {
    const bus = new InMemoryMessageBus();
    await bus.publishOutbound(makeEnvelope(0));
    const env = await bus.consumeOutbound();
    expect(env.seq).toBe(0);
  });

  it('outbound FIFO order', async () => {
    const bus = new InMemoryMessageBus();
    await bus.publishOutbound(makeEnvelope(0));
    await bus.publishOutbound(makeEnvelope(1));
    await bus.publishOutbound(makeEnvelope(2));
    expect((await bus.consumeOutbound()).seq).toBe(0);
    expect((await bus.consumeOutbound()).seq).toBe(1);
    expect((await bus.consumeOutbound()).seq).toBe(2);
  });

  it('consumeInbound blocks until message available', async () => {
    const bus = new InMemoryMessageBus();
    const consumePromise = bus.consumeInbound();
    await bus.publishInbound(makeInbound('delayed'));
    const msg = await consumePromise;
    expect(msg.content).toBe('delayed');
  });

  it('consumeOutbound blocks until message available', async () => {
    const bus = new InMemoryMessageBus();
    const consumePromise = bus.consumeOutbound();
    await bus.publishOutbound(makeEnvelope(42));
    const env = await consumePromise;
    expect(env.seq).toBe(42);
  });

  it('exposes queue max constants', () => {
    expect(INBOUND_QUEUE_MAX).toBe(100);
    expect(OUTBOUND_QUEUE_MAX).toBe(1000);
  });

  it('inbound queue full throws inbound_queue_full', async () => {
    const bus = new InMemoryMessageBus();
    for (let i = 0; i < INBOUND_QUEUE_MAX; i++) {
      await bus.publishInbound(makeInbound(`msg-${i}`));
    }
    await expect(bus.publishInbound(makeInbound('overflow'))).rejects.toThrow('inbound_queue_full');
  });

  it('outbound overflow drops oldest delta and keeps tool_result', async () => {
    const bus = new InMemoryMessageBus();
    // 填满 outbound 队列
    for (let i = 0; i < OUTBOUND_QUEUE_MAX; i++) {
      await bus.publishOutbound(makeEnvelope(i, 'message_delta'));
    }
    // 再推入 tool_result（触发溢出，应丢弃最旧的 delta）
    await bus.publishOutbound(makeEnvelope(999, 'tool_result'));

    // 消费第一个：应是被保留的最早 delta（seq=1，因为 seq=0 被丢弃）
    const first = await bus.consumeOutbound();
    expect(first.seq).toBe(1);

    // 找到 tool_result，应仍在队列中
    let foundToolResult = false;
    for (let i = 1; i < OUTBOUND_QUEUE_MAX; i++) {
      const env = await bus.consumeOutbound();
      if (env.event.type === 'tool_result') {
        foundToolResult = true;
        expect(env.seq).toBe(999);
        break;
      }
    }
    expect(foundToolResult).toBe(true);
  });

  it('outbound overflow preserves message_end over deltas', async () => {
    const bus = new InMemoryMessageBus();
    for (let i = 0; i < OUTBOUND_QUEUE_MAX; i++) {
      await bus.publishOutbound(makeEnvelope(i, 'message_delta'));
    }
    // 推入 message_end（重要事件，不应被丢弃）
    await bus.publishOutbound(makeEnvelope(888, 'message_end'));

    let foundMessageEnd = false;
    for (let i = 0; i < OUTBOUND_QUEUE_MAX; i++) {
      const env = await bus.consumeOutbound();
      if (env.event.type === 'message_end') {
        foundMessageEnd = true;
        expect(env.seq).toBe(888);
        break;
      }
    }
    expect(foundMessageEnd).toBe(true);
  });

  // I3 回归测试：队列满且无可丢弃 delta 时，应抛 outbound_overflow（背压）而非丢弃关键事件
  it('outbound overflow with no droppable deltas throws outbound_overflow (I3)', async () => {
    const bus = new InMemoryMessageBus();
    // 填满队列 with non-droppable events (tool_result)
    for (let i = 0; i < OUTBOUND_QUEUE_MAX; i++) {
      await bus.publishOutbound(makeEnvelope(i, 'tool_result'));
    }
    // 再推入 message_end（触发溢出，无可丢弃 delta，应抛 outbound_overflow）
    await expect(bus.publishOutbound(makeEnvelope(999, 'message_end'))).rejects.toThrow('outbound_overflow');

    // 验证原队列未被破坏 —— 第一个仍是 seq=0
    const first = await bus.consumeOutbound();
    expect(first.seq).toBe(0);
    expect(first.event.type).toBe('tool_result');
  });
});
