import { describe, it, expect, vi } from 'vitest';
import { createChannelManager } from '../../src/bus/channel-manager.js';
import { InMemoryMessageBus } from '../../src/bus/message-bus.js';
import {
  wrapTransportChannel,
  type TransportChannelAdapter,
  type SessionKeyResolver,
} from '../../src/bus/channel-adapter.js';
import type {
  TransportChannel,
  Channel,
  ChannelCapability,
  AgentEventEnvelope,
} from '../../src/bus/types.js';

const FULL_CAP: ChannelCapability = {
  streaming: true,
  reasoning: true,
  richUi: true,
  fileEditEvents: true,
  editMessage: false,
  markdown: true,
};

function makeMockTransport(type: string): TransportChannel & {
  sent: string[];
  sendMock: ReturnType<typeof vi.fn>;
  closeMock: ReturnType<typeof vi.fn>;
  setAlive(v: boolean): void;
  setSendThrow(v: boolean): void;
} {
  const sent: string[] = [];
  let alive = true;
  let sendThrow = false;
  const sendMock = vi.fn(async (data: string | Uint8Array) => {
    if (sendThrow) throw new Error('send_failed');
    sent.push(typeof data === 'string' ? data : new TextDecoder().decode(data));
  });
  const closeMock = vi.fn(async () => {
    alive = false;
  });
  return {
    type,
    send: sendMock,
    close: closeMock,
    isAlive: () => alive,
    sent,
    sendMock,
    closeMock,
    setAlive(v) {
      alive = v;
    },
    setSendThrow(v) {
      sendThrow = v;
    },
  };
}

function makeEnvelope(sessionKey: string, seq: number = 0): AgentEventEnvelope {
  return {
    sessionKey,
    chatId: 'c1',
    channel: 'test',
    event: { type: 'agent_start' },
    seq,
  };
}

describe('TransportChannel interface (4 methods: type/send/close/isAlive)', () => {
  it('exposes type/send/close/isAlive', () => {
    const tc: TransportChannel = makeMockTransport('websocket');
    expect(tc.type).toBe('websocket');
    expect(typeof tc.send).toBe('function');
    expect(typeof tc.close).toBe('function');
    expect(typeof tc.isAlive).toBe('function');
  });

  it('isAlive returns true before close, false after close', async () => {
    const tc = makeMockTransport('telegram');
    expect(tc.isAlive()).toBe(true);
    await tc.close();
    expect(tc.isAlive()).toBe(false);
  });
});

describe('wrapTransportChannel adapter', () => {
  it('wraps a TransportChannel into a Channel with name=type', () => {
    const tc = makeMockTransport('telegram');
    const ch = wrapTransportChannel(tc, { capabilities: FULL_CAP });
    expect(ch.name).toBe('telegram');
    expect(ch.capabilities).toBe(FULL_CAP);
    expect(typeof ch.start).toBe('function');
    expect(typeof ch.stop).toBe('function');
    expect(typeof ch.consume).toBe('function');
    expect(typeof ch.isAlive).toBe('function');
  });

  it('exposes transportType and resolveSessionKey', () => {
    const tc = makeMockTransport('discord');
    const ch: TransportChannelAdapter = wrapTransportChannel(tc, { capabilities: FULL_CAP });
    expect(ch.transportType).toBe('discord');
    expect(typeof ch.resolveSessionKey).toBe('function');
  });

  it('start is a no-op (transport already started)', async () => {
    const tc = makeMockTransport('telegram');
    const ch = wrapTransportChannel(tc, { capabilities: FULL_CAP });
    const bus = new InMemoryMessageBus();
    await expect(ch.start(bus)).resolves.toBeUndefined();
  });

  it('stop calls tc.close()', async () => {
    const tc = makeMockTransport('telegram');
    const ch = wrapTransportChannel(tc, { capabilities: FULL_CAP });
    await ch.stop();
    expect(tc.closeMock).toHaveBeenCalledTimes(1);
    expect(ch.isAlive!()).toBe(false);
  });

  it('consume serializes envelope to JSON and sends via transport', async () => {
    const tc = makeMockTransport('telegram');
    const ch = wrapTransportChannel(tc, { capabilities: FULL_CAP });
    const env = makeEnvelope('s1', 5);
    await ch.consume(env);
    expect(tc.sent.length).toBe(1);
    expect(JSON.parse(tc.sent[0])).toMatchObject({
      sessionKey: 's1',
      chatId: 'c1',
      channel: 'test',
      seq: 5,
    });
  });

  it('isAlive delegates to transport', () => {
    const tc = makeMockTransport('telegram');
    const ch = wrapTransportChannel(tc, { capabilities: FULL_CAP });
    expect(ch.isAlive!()).toBe(true);
    tc.setAlive(false);
    expect(ch.isAlive!()).toBe(false);
  });
});

describe('wrapTransportChannel sessionKey resolver (IM mapping)', () => {
  it('default resolver maps (senderId, chatId) to `${type}:${chatId}`', () => {
    const tc = makeMockTransport('telegram');
    const ch = wrapTransportChannel(tc, { capabilities: FULL_CAP });
    expect(ch.resolveSessionKey('user123', 'chat456')).toBe('telegram:chat456');
  });

  it('custom resolver overrides default', () => {
    const tc = makeMockTransport('discord');
    const resolver: SessionKeyResolver = (senderId, _chatId) => `dm:${senderId}`;
    const ch = wrapTransportChannel(tc, { capabilities: FULL_CAP, sessionKeyResolver: resolver });
    expect(ch.resolveSessionKey('user123', 'chat456')).toBe('dm:user123');
  });
});

describe('register rejects unknown channel type', () => {
  it('rejects channel with empty name', () => {
    const bus = new InMemoryMessageBus();
    const mgr = createChannelManager(bus);
    const bad: Channel = {
      name: '',
      capabilities: FULL_CAP,
      async start() {},
      async stop() {},
      consume() {},
    };
    expect(() => mgr.register(bad)).toThrow();
  });
});

describe('bindSession accepts wrapped TransportChannel', () => {
  it('delivers envelopes to a wrapped TransportChannel', async () => {
    const bus = new InMemoryMessageBus();
    const mgr = createChannelManager(bus);
    const tc = makeMockTransport('telegram');
    const ch = wrapTransportChannel(tc, { capabilities: FULL_CAP });
    mgr.register(ch);
    mgr.bindSession('s1', ch);

    await bus.publishOutbound(makeEnvelope('s1', 0));
    const loopPromise = mgr.runDispatchLoop();
    await new Promise((r) => setTimeout(r, 50));
    mgr.stopAll();
    await loopPromise.catch(() => {});

    expect(tc.sent.length).toBe(1);
  });
});

describe('multiple channels sharing same sessionKey', () => {
  it('broadcasts to multiple wrapped TransportChannels bound to same sessionKey', async () => {
    const bus = new InMemoryMessageBus();
    const mgr = createChannelManager(bus);
    const tc1 = makeMockTransport('telegram');
    const tc2 = makeMockTransport('discord');
    const ch1 = wrapTransportChannel(tc1, { capabilities: FULL_CAP });
    const ch2 = wrapTransportChannel(tc2, { capabilities: FULL_CAP });
    mgr.register(ch1);
    mgr.register(ch2);
    mgr.bindSession('s1', ch1);
    mgr.bindSession('s1', ch2);

    await bus.publishOutbound(makeEnvelope('s1', 0));
    const loopPromise = mgr.runDispatchLoop();
    await new Promise((r) => setTimeout(r, 50));
    mgr.stopAll();
    await loopPromise.catch(() => {});

    expect(tc1.sent.length).toBe(1);
    expect(tc2.sent.length).toBe(1);
  });
});

describe('auto-unbind on dead channel', () => {
  it('unbinds a wrapped TransportChannel when send throws and isAlive=false', async () => {
    const bus = new InMemoryMessageBus();
    const mgr = createChannelManager(bus);
    const tcDead = makeMockTransport('telegram');
    const chDead = wrapTransportChannel(tcDead, { capabilities: FULL_CAP });
    const tcAlive = makeMockTransport('discord');
    const chAlive = wrapTransportChannel(tcAlive, { capabilities: FULL_CAP });
    mgr.register(chDead);
    mgr.register(chAlive);
    mgr.bindSession('s1', chDead);
    mgr.bindSession('s1', chAlive);

    // Make chDead dead: isAlive=false and send throws
    tcDead.setAlive(false);
    tcDead.setSendThrow(true);

    await bus.publishOutbound(makeEnvelope('s1', 0));
    await bus.publishOutbound(makeEnvelope('s1', 1));
    const loopPromise = mgr.runDispatchLoop();
    await new Promise((r) => setTimeout(r, 80));
    mgr.stopAll();
    await loopPromise.catch(() => {});

    // chDead: only the first envelope attempted (then unbound, second not delivered)
    expect(tcDead.sendMock).toHaveBeenCalledTimes(1);
    // chAlive: both envelopes received
    expect(tcAlive.sent.length).toBe(2);
  });

  it('does NOT unbind plain Channel (no isAlive) when consume throws (backward compat)', async () => {
    const bus = new InMemoryMessageBus();
    const mgr = createChannelManager(bus);
    let throwCount = 0;
    const plainCh: Channel = {
      name: 'plain',
      capabilities: FULL_CAP,
      async start() {},
      async stop() {},
      consume() {
        throwCount++;
        throw new Error('plain_fail');
      },
    };
    mgr.register(plainCh);
    mgr.bindSession('s1', plainCh);

    await bus.publishOutbound(makeEnvelope('s1', 0));
    await bus.publishOutbound(makeEnvelope('s1', 1));
    const loopPromise = mgr.runDispatchLoop();
    await new Promise((r) => setTimeout(r, 80));
    mgr.stopAll();
    await loopPromise.catch(() => {});

    // Plain channel has no isAlive → not unbound → consume called for BOTH envelopes
    expect(throwCount).toBe(2);
  });
});
