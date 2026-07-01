import { createLogger } from '../infrastructure/logger.js';
import { matchesCapability, type Channel, type AgentEventEnvelope } from './types.js';
import type { MessageBus } from './types.js';

const log = createLogger('channel-manager');

export const DEAD_LETTER_MAX = 100;

export interface ChannelManager {
  register(channel: Channel): void;
  startAll(): Promise<void>;
  stopAll(): Promise<void>;
  bindSession(sessionKey: string, channel: Channel): void;
  unbindSession(sessionKey: string, channel: Channel): void;
  runDispatchLoop(): Promise<void>;
  getDeadLetters(): readonly AgentEventEnvelope[];
}

/**
 * §7.2 / §10.1.6 createChannelManager: 创建 ChannelManager。
 * - startAll 并行启动所有 channel，单个失败不阻塞（记录 channel_start_failed）。
 * - bindSession/unbindSession 幂等。
 * - runDispatchLoop 按 capability 过滤 + 路由 + 重试。所有 channel 投递失败时入死信队列（上限 100）。
 */
export function createChannelManager(bus: MessageBus): ChannelManager {
  const channels = new Map<string, Channel>();
  const bindings = new Map<string, Set<Channel>>();
  const deadLetters: AgentEventEnvelope[] = [];
  let running = false;
  let stopResolve: () => void = () => {};
  let stopPromise = new Promise<void>((r) => {
    stopResolve = r;
  });

  function addDeadLetter(envelope: AgentEventEnvelope): void {
    if (deadLetters.length >= DEAD_LETTER_MAX) {
      deadLetters.shift();
    }
    deadLetters.push(envelope);
    log.warn('dispatch_dead_letter', { seq: envelope.seq, eventType: envelope.event.type });
  }

  async function dispatchEnvelope(envelope: AgentEventEnvelope): Promise<void> {
    const bound = bindings.get(envelope.sessionKey);
    if (!bound || bound.size === 0) {
      // I13 修复：无绑定 session 是正常情况（无订阅者），warn+drop 而非入死信队列
      log.warn('dispatch_no_binding', { sessionKey: envelope.sessionKey, seq: envelope.seq });
      return;
    }

    const targets: Channel[] = [];
    for (const ch of bound) {
      if (matchesCapability(ch.capabilities, envelope.event)) {
        targets.push(ch);
      }
    }

    if (targets.length === 0) {
      addDeadLetter(envelope);
      return;
    }

    const results = await Promise.allSettled(
      targets.map((ch) => Promise.resolve().then(() => ch.consume(envelope))),
    );

    // §4.12 channel 断开时自动 unbind：consume 失败且 isAlive()=false 的 channel 从该 sessionKey 解绑。
    // 仅对实现了 isAlive 的 channel（TransportChannel-backed adapter）生效；普通 Channel 保持原行为。
    for (let i = 0; i < targets.length; i++) {
      const r = results[i];
      if (r.status !== 'rejected') continue;
      const ch = targets[i];
      if (typeof ch.isAlive === 'function' && !ch.isAlive()) {
        bindings.get(envelope.sessionKey)?.delete(ch);
        log.warn('dispatch_unbind_dead_channel', {
          sessionKey: envelope.sessionKey,
          channel: ch.name,
          seq: envelope.seq,
        });
      }
    }

    const allFailed = results.every((r) => r.status === 'rejected');
    if (allFailed) {
      addDeadLetter(envelope);
    }
  }

  return {
    register(channel: Channel): void {
      // §4.12 channel type 未知时拒绝注册：name 必须为非空字符串（不做白名单，IM type 留待 0.4.0）
      if (typeof channel.name !== 'string' || channel.name.length === 0) {
        throw new Error(`channel_register_rejected: name must be a non-empty string`);
      }
      channels.set(channel.name, channel);
    },

    async startAll(): Promise<void> {
      const all = Array.from(channels.values());
      const results = await Promise.allSettled(all.map((ch) => ch.start(bus)));
      for (let i = 0; i < results.length; i++) {
        if (results[i].status === 'rejected') {
          const reason = (results[i] as PromiseRejectedResult).reason;
          log.warn('channel_start_failed', {
            channel: all[i].name,
            error: String(reason),
          });
        }
      }
    },

    async stopAll(): Promise<void> {
      running = false;
      stopResolve();
      await Promise.allSettled(Array.from(channels.values()).map((ch) => ch.stop()));
      stopPromise = new Promise<void>((r) => {
        stopResolve = r;
      });
    },

    bindSession(sessionKey: string, channel: Channel): void {
      if (!bindings.has(sessionKey)) bindings.set(sessionKey, new Set());
      bindings.get(sessionKey)!.add(channel);
    },

    unbindSession(sessionKey: string, channel: Channel): void {
      bindings.get(sessionKey)?.delete(channel);
    },

    async runDispatchLoop(): Promise<void> {
      running = true;
      while (running) {
        const envelope = await Promise.race([
          bus.consumeOutbound(),
          stopPromise.then(() => null as AgentEventEnvelope | null),
        ]);
        if (envelope === null) break;
        await dispatchEnvelope(envelope);
      }
    },

    getDeadLetters(): readonly AgentEventEnvelope[] {
      return deadLetters;
    },
  };
}
