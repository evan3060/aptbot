import type {
  Channel,
  ChannelCapability,
  MessageBus,
  TransportChannel,
  AgentEventEnvelope,
} from './types.js';

/**
 * §4.12 SessionKeyResolver: 将 IM 标识（senderId, chatId）映射到 sessionKey。
 * IM channel 不依赖 ?session= 参数，由 resolver 内部决定路由。
 */
export type SessionKeyResolver = (senderId: string, chatId: string) => string;

export interface WrapTransportChannelOptions {
  readonly capabilities: ChannelCapability;
  /** Channel.name，未指定时使用 tc.type */
  readonly name?: string;
  /** IM sessionKey 映射，未指定时默认 `${type}:${chatId}` */
  readonly sessionKeyResolver?: SessionKeyResolver;
}

/**
 * §4.12 TransportChannelAdapter: wrapTransportChannel 返回类型。
 * 在完整 Channel 之上额外暴露传输类型与 sessionKey 解析，供 IM 集成层使用。
 */
export interface TransportChannelAdapter extends Channel {
  readonly transportType: string;
  resolveSessionKey(senderId: string, chatId: string): string;
}

/**
 * §4.12 wrapTransportChannel: 将最小 TransportChannel 适配为完整 bus-facing Channel。
 * - name = tc.type（或 options.name）
 * - capabilities = options.capabilities
 * - start(bus) = no-op（传输已启动）
 * - stop() = tc.close()
 * - consume(envelope) = tc.send(JSON.stringify(envelope))
 * - isAlive() = tc.isAlive()（供 ChannelManager 在 consume 失败后判断是否 unbind）
 * IM channel 的实际接入（resolver 路由、inbound 桥接）在 0.4.0 完成。
 */
export function wrapTransportChannel(
  tc: TransportChannel,
  options: WrapTransportChannelOptions,
): TransportChannelAdapter {
  const name = options.name ?? tc.type;
  const resolver: SessionKeyResolver = options.sessionKeyResolver
    ?? ((_senderId, chatId) => `${tc.type}:${chatId}`);

  return {
    name,
    capabilities: options.capabilities,
    get transportType(): string {
      return tc.type;
    },
    async start(_bus: MessageBus): Promise<void> {
      // 传输已启动，无需 bus 句柄
    },
    async stop(): Promise<void> {
      await tc.close();
    },
    async consume(envelope: AgentEventEnvelope): Promise<void> {
      await tc.send(JSON.stringify(envelope));
    },
    isAlive(): boolean {
      return tc.isAlive();
    },
    resolveSessionKey(senderId: string, chatId: string): string {
      return resolver(senderId, chatId);
    },
  };
}
