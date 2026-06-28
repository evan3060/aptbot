import { describe, it, expect, vi } from 'vitest';
import { createChannelManager, DEAD_LETTER_MAX } from '../../src/bus/channel-manager.js';
import { InMemoryMessageBus } from '../../src/bus/message-bus.js';
import type { Channel, AgentEventEnvelope, ChannelCapability } from '../../src/bus/types.js';

const FULL_CAP: ChannelCapability = {
  streaming: true,
  reasoning: true,
  richUi: true,
  fileEditEvents: true,
  editMessage: true,
  markdown: true,
};

function makeMockChannel(name: string, cap: ChannelCapability = FULL_CAP): Channel & {
  consumed: AgentEventEnvelope[];
  startMock: ReturnType<typeof vi.fn>;
  consumeMock: ReturnType<typeof vi.fn>;
  setConsumeThrow(shouldThrow: boolean): void;
} {
  const consumed: AgentEventEnvelope[] = [];
  const startMock = vi.fn(async () => {});
  const consumeMock = vi.fn((env: AgentEventEnvelope) => {
    consumed.push(env);
  });
  let shouldThrow = false;
  return {
    name,
    capabilities: cap,
    start: startMock,
    stop: vi.fn(async () => {}),
    consume(env) {
      consumeMock(env);
      if (shouldThrow) throw new Error('consume_failed');
    },
    consumed,
    startMock,
    consumeMock,
    setConsumeThrow(s: boolean) {
      shouldThrow = s;
    },
  };
}

function makeEnvelope(sessionKey: string, eventType: string = 'message_delta', seq: number = 0): AgentEventEnvelope {
  const event: AgentEventEnvelope['event'] =
    eventType === 'agent_start'
      ? { type: 'agent_start' }
      : eventType === 'message_end'
        ? { type: 'message_end', messageId: 'm1', stopReason: 'end_turn' }
        : eventType === 'reasoning_delta'
          ? { type: 'reasoning_delta', text: 'think' }
          : { type: 'message_delta', text: `delta-${seq}` };
  return { sessionKey, chatId: 'c1', channel: 'test', event, seq };
}

describe('ChannelManager', () => {
  it('DEAD_LETTER_MAX is 100', () => {
    expect(DEAD_LETTER_MAX).toBe(100);
  });

  it('bindSession is idempotent (repeat bind same channel does not error)', () => {
    const bus = new InMemoryMessageBus();
    const mgr = createChannelManager(bus);
    const ch = makeMockChannel('cli');
    mgr.register(ch);
    expect(() => mgr.bindSession('s1', ch)).not.toThrow();
    expect(() => mgr.bindSession('s1', ch)).not.toThrow();
  });

  it('unbindSession is idempotent (unbinding unregistered sessionKey does not error)', () => {
    const bus = new InMemoryMessageBus();
    const mgr = createChannelManager(bus);
    expect(() => mgr.unbindSession('nonexistent', makeMockChannel('cli'))).not.toThrow();
  });

  it('startAll starts all channels; single failure does not block others', async () => {
    const bus = new InMemoryMessageBus();
    const mgr = createChannelManager(bus);
    const ch1 = makeMockChannel('cli');
    const ch2 = makeMockChannel('web');
    ch2.startMock.mockRejectedValueOnce(new Error('start_failed'));
    mgr.register(ch1);
    mgr.register(ch2);
    await mgr.startAll();
    // 两个 channel 都被调用了 start
    expect(ch1.startMock).toHaveBeenCalled();
    expect(ch2.startMock).toHaveBeenCalled();
  });

  it('dispatch filters by capability (streaming=false filters message_delta)', async () => {
    const bus = new InMemoryMessageBus();
    const mgr = createChannelManager(bus);
    const noStreamingCap: ChannelCapability = { ...FULL_CAP, streaming: false };
    const chNoStream = makeMockChannel('im', noStreamingCap);
    const chStream = makeMockChannel('cli', FULL_CAP);
    mgr.register(chNoStream);
    mgr.register(chStream);
    mgr.bindSession('s1', chNoStream);
    mgr.bindSession('s1', chStream);

    await bus.publishOutbound(makeEnvelope('s1', 'message_delta', 0));
    // 启动 dispatch loop 后会消费并投递
    const loopPromise = mgr.runDispatchLoop();
    await new Promise((r) => setTimeout(r, 50));
    mgr.stopAll();
    await loopPromise.catch(() => {});

    // chStream 收到 message_delta，chNoStream 未收到
    expect(chStream.consumed.some((e) => e.event.type === 'message_delta')).toBe(true);
    expect(chNoStream.consumed.length).toBe(0);
  });

  it('all delivery failures go to dead letter queue', async () => {
    const bus = new InMemoryMessageBus();
    const mgr = createChannelManager(bus);
    const ch = makeMockChannel('cli');
    ch.setConsumeThrow(true);
    mgr.register(ch);
    mgr.bindSession('s1', ch);

    await bus.publishOutbound(makeEnvelope('s1', 'message_delta', 0));
    const loopPromise = mgr.runDispatchLoop();
    await new Promise((r) => setTimeout(r, 50));
    mgr.stopAll();
    await loopPromise.catch(() => {});

    expect(mgr.getDeadLetters().length).toBe(1);
    expect(mgr.getDeadLetters()[0].event.type).toBe('message_delta');
  });

  it('consume exception skips that channel without affecting others', async () => {
    const bus = new InMemoryMessageBus();
    const mgr = createChannelManager(bus);
    const chBad = makeMockChannel('bad');
    chBad.setConsumeThrow(true);
    const chGood = makeMockChannel('good');
    mgr.register(chBad);
    mgr.register(chGood);
    mgr.bindSession('s1', chBad);
    mgr.bindSession('s1', chGood);

    await bus.publishOutbound(makeEnvelope('s1', 'agent_start', 0));
    const loopPromise = mgr.runDispatchLoop();
    await new Promise((r) => setTimeout(r, 50));
    mgr.stopAll();
    await loopPromise.catch(() => {});

    // chGood 收到了事件（agent_start 始终投递）
    expect(chGood.consumed.some((e) => e.event.type === 'agent_start')).toBe(true);
    // chBad 抛异常但没崩溃
    expect(chBad.consumeMock).toHaveBeenCalled();
  });

  it('dead letter queue capped at DEAD_LETTER_MAX', async () => {
    const bus = new InMemoryMessageBus();
    const mgr = createChannelManager(bus);
    const ch = makeMockChannel('cli');
    ch.setConsumeThrow(true);
    mgr.register(ch);
    mgr.bindSession('s1', ch);

    // 推入超过 DEAD_LETTER_MAX 条消息
    for (let i = 0; i < DEAD_LETTER_MAX + 50; i++) {
      await bus.publishOutbound(makeEnvelope('s1', 'message_delta', i));
    }
    const loopPromise = mgr.runDispatchLoop();
    await new Promise((r) => setTimeout(r, 200));
    mgr.stopAll();
    await loopPromise.catch(() => {});

    expect(mgr.getDeadLetters().length).toBeLessThanOrEqual(DEAD_LETTER_MAX);
  });

  // I13 回归测试：无绑定 session 的 envelope 应 warn+drop，不入死信队列
  it('no-bound envelope is dropped without entering dead letter queue (I13)', async () => {
    const bus = new InMemoryMessageBus();
    const mgr = createChannelManager(bus);

    // 推入一个没有 session 绑定的 envelope
    await bus.publishOutbound(makeEnvelope('unbound-session', 'agent_start', 0));
    const loopPromise = mgr.runDispatchLoop();
    await new Promise((r) => setTimeout(r, 50));
    mgr.stopAll();
    await loopPromise.catch(() => {});

    // 不应进入死信队列（无订阅者是正常情况，非投递失败）
    expect(mgr.getDeadLetters().length).toBe(0);
  });
});
