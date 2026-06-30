import { loadConfig, resolveApiKey } from './infrastructure/config-loader.js';
import { FileStorage, type StorageAdapter } from './infrastructure/storage/file-storage.js';
import { createUserStorage, type UserStorage } from './infrastructure/user-storage.js';
import type { ProviderConfig } from './infrastructure/config-types.js';
import { createToolRegistry } from './core/tool/types.js';
import { bashTool } from './core/tool/tools/bash.js';
import { readTool } from './core/tool/tools/read.js';
import { editTool } from './core/tool/tools/edit.js';
import { createUpdateWorkingMemoryTool } from './core/tool/tools/update-working-memory.js';
import { createProvider } from './core/provider/models.js';
import type { ProviderDeclaration } from './core/provider/models.js';
import type { Provider, Model } from './core/provider/types.js';
import { createAgentSession } from './core/agent/session.js';
import { agentLoop, DEFAULT_STOP_REASON } from './core/agent/loop.js';
import { createTurnId, createMessageId } from './core/agent/events.js';
import type { CommandRegistry, CommandContext, CommandResult } from './shared/commands/registry.js';
import { createCommandRegistry } from './shared/commands/registry.js';
import { InMemoryMessageBus } from './bus/message-bus.js';
import { createChannelManager } from './bus/channel-manager.js';
import type { Channel, ChannelCapability, AgentEventEnvelope } from './bus/types.js';
import { startWebSocketServer, type WebSocketServer } from './access/websocket-server.js';
import { createChatPageHtml } from './access/chat-page.js';
import { createLandingPageHtml } from './access/landing-page.js';
import {
  installProcessHandlers,
  startMemoryMonitor,
  startTurnWatchdog,
} from './infrastructure/process-handler.js';
import { createLogger } from './infrastructure/logger.js';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const FULL_CAP: ChannelCapability = {
  streaming: true,
  reasoning: true,
  richUi: true,
  fileEditEvents: true,
  editMessage: true,
  markdown: true,
};

/**
 * §7.2 WebSocketChannel: 将 WebSocketServer 适配为 Channel，
 * consume(envelope) 时 broadcast 到所有已连接 WS 客户端。
 */
function createWebSocketChannel(wsServer: WebSocketServer): Channel {
  return {
    name: 'websocket',
    capabilities: FULL_CAP,
    async start() {},
    async stop() {},
    consume(envelope: AgentEventEnvelope) {
      // I1 修复：广播完整 envelope（含 seq），供客户端 resync 协议使用
      wsServer.broadcast(envelope);
    },
  };
}

const log = createLogger('server');

export interface ServerConfig {
  port: number;
  deploy: 'local' | 'cf';
  authToken?: string;
  /** 绑定地址，未指定时默认 0.0.0.0（LAN 可访问）。反代部署应设为 127.0.0.1 */
  host?: string;
}

export interface ServerHandle {
  stop(): Promise<void>;
  readonly port: number;
  getActiveConnections(): number;
}

function findModelFromConfig(
  config: Awaited<ReturnType<typeof loadConfig>>,
): { provider: ProviderDeclaration; providerConfig: ProviderConfig; model: Model } {
  for (const p of config.providers) {
    for (const m of p.models) {
      if (m.id === config.defaultModel) {
        const decl: ProviderDeclaration = {
          id: p.id,
          name: p.name,
          baseUrl: p.baseUrl,
          // envVar 仅作为声明元数据；apiKey 解析使用原始 ProviderConfig
          auth: { envVar: p.auth.envVar ?? 'API_KEY' },
          models: p.models.map((mm) => ({
            provider: p.id,
            id: mm.id,
            api: mm.api,
            contextWindow: mm.contextWindow,
            maxTokens: mm.maxTokens,
          })),
        };
        return {
          provider: decl,
          providerConfig: p,
          model: decl.models.find((mm) => mm.id === m.id)!,
        };
      }
    }
  }
  throw new Error(`default model not found: ${config.defaultModel}`);
}

/**
 * I4 修复：resolveSessionId 自动恢复最近 session。
 * listSessions() 按 updatedAt 降序返回，取第一个即为最近活跃 session。
 * 无 session 时生成新 UUID。
 */
export async function resolveSessionId(storage: StorageAdapter): Promise<string> {
  const sessions = await storage.listSessions();
  if (sessions.length > 0) {
    return sessions[0].id;
  }
  return randomUUID();
}

export async function startServer(config: ServerConfig): Promise<ServerHandle> {
  log.info('starting server', { port: config.port, deploy: config.deploy });

  const aptbotConfig = await loadConfig();
  const sessionsDir = `${aptbotConfig.dataDir}/sessions`;
  const storage = new FileStorage(sessionsDir);
  // Task 5: 用户存储 — 始终创建，供 /api/register /api/login /api/me 与 WS 认证使用
  const userStorage: UserStorage = createUserStorage(aptbotConfig.dataDir);

  const registry = createToolRegistry();
  registry.register(bashTool);
  registry.register(readTool);
  registry.register(editTool);

  const { provider: providerDecl, providerConfig, model } = findModelFromConfig(aptbotConfig);

  // 修复 apiKey 解析：直接用原始 ProviderConfig（含 apiKey 字段），而非 ProviderDeclaration
  const apiKey = resolveApiKey(providerConfig);
  if (!apiKey) {
    throw new Error(`API key not resolved for provider ${providerDecl.id}`);
  }

  const provider: Provider = createProvider(providerDecl, apiKey);

  // I4 修复：自动恢复最近 session，而非每次启动创建新 sessionId
  const sessionId = await resolveSessionId(storage);
  registry.register(createUpdateWorkingMemoryTool(storage, sessionId));

  const systemPrompt = `You are aptbot, a personal learning and work assistant.

Important constraints:
- You are running inside a server process. NEVER execute commands that would kill, stop, or restart the server process (e.g., kill, pkill, killall, pnpm kill, shutdown, reboot). If asked to restart/stop the server, explain that you cannot do this and the user should do it manually.
- NEVER modify the server's own source code or configuration files (under /Users/evan/projects/aptbot/src/, config/, package.json) while the server is running.
- NEVER read or access files under the data/sessions/ directory. These are internal session storage files. Session history is managed automatically by the system (via /resume, /continue commands). Do not attempt to read, cat, or parse them.
- When bash command output is long, summarize the key information instead of pasting everything.`;

  const session = createAgentSession({
    storage,
    sessionId,
    agentLoop,
    provider,
    model,
    tools: registry,
    systemPrompt,
  });

  // /new 命令支持：可变 session 引用 + 工厂函数
  const sessionRef: SessionRef = { current: session, currentKey: sessionId };
  const sessionFactory: SessionFactory = (sid) =>
    createAgentSession({ storage, sessionId: sid, agentLoop, provider, model, tools: registry, systemPrompt });

  const bus = new InMemoryMessageBus();
  const channelManager = createChannelManager(bus);

  // Task 5: 根据 config.landingPage 严格等于 true 决定根路径提供落地页还是聊天页
  // landingPage 为 undefined/false 时不启用，保持原有聊天页行为（向后兼容）
  const landingEnabled = aptbotConfig.landingPage === true;
  const wsServer = await startWebSocketServer({
    port: config.port,
    bus,
    authToken: config.authToken,
    host: config.host,
    serveHtml: landingEnabled ? createLandingPageHtml() : createChatPageHtml('/ws'),
    // Task 5: 启用落地页时，/demo 路由提供聊天页作为 CTA 跳转目标；未启用时不提供
    serveDemoHtml: landingEnabled ? createChatPageHtml('/ws') : undefined,
    userStorage,
    // Task 5: 客户端未携带 ?session= 时绑定到 server 当前活跃 sessionId
    fallbackSessionKey: sessionId,
    // 验收修复：提供 agent 当前内部 sessionId，供 user_identified 事件对齐前端 localStorage
    getCurrentSessionId: () => sessionRef.currentKey,
    // Task 5: 每个新连接绑定其 sessionKey 到 wsChannel，使 dispatch 能路由到该 session
    onSessionBound: (sessionKey) => {
      channelManager.bindSession(sessionKey, wsChannel);
    },
    // Task 5 C2 fix: sessionKey 无剩余连接时解绑，避免 channelManager.bindings 无限增长
    onSessionUnbound: (sessionKey) => {
      channelManager.unbindSession(sessionKey, wsChannel);
    },
    // Task 5 C2 fix: 传入 sessionStorage 用于 ?session= ownership 检查
    sessionStorage: storage,
    // 会话重命名后广播 session_renamed 控制消息到同 session 其他客户端
    onSessionRenamed: (sid, label) => {
      wsServer.sendToSessionKey(sid, { type: 'session_renamed', sessionId: sid, label });
    },
  });

  // C8 修复：注册 WebSocket Channel 并绑定 sessionKey，使出站事件能路由到 WS 客户端
  const wsChannel = createWebSocketChannel(wsServer);
  channelManager.register(wsChannel);
  await channelManager.startAll();
  channelManager.bindSession(sessionId, wsChannel);

  let shuttingDown = false;
  const shutdown = async () => {
    if (shuttingDown) return;
    shuttingDown = true;
    log.info('shutting down server');
    await wsServer.stop();
    await channelManager.stopAll();
  };

  installProcessHandlers({
    onShutdown: shutdown,
    isShuttingDown: () => shuttingDown,
  });

  startMemoryMonitor();
  // I6 修复：捕获 watchdog 返回值并传入 runInboundLoop，驱动 markTurnStart/markTurnEnd
  const watchdog = startTurnWatchdog(() => log.warn('turn watchdog timeout'));

  // 创建 CommandRegistry 并注入 runInboundLoop，使 slash 命令在 agent 之前被拦截
  const commandRegistry = createCommandRegistry();
  const slashHandler: SlashCommandHandler = {
    registry: commandRegistry,
    ctx: { sessionId, model: model.id, storage },
  };

  void runInboundLoop(bus, sessionRef, watchdog, slashHandler, sessionFactory, (oldKey, newId) => {
    // Task 6: /new 或 /resume 后，向旧 sessionKey 的 connection 推送 session_changed
    // 客户端收到后更新 localStorage 并用 ?session=newId 重连
    log.info('onNewSession: sending session_changed', { oldKey: oldKey.slice(0, 8), newId: newId.slice(0, 8) });
    channelManager.bindSession(newId, wsChannel);
    wsServer.sendToSessionKey(oldKey, { type: 'session_changed', sessionId: newId });
  });
  void channelManager.runDispatchLoop();

  log.info('server started', { port: config.port });

  return {
    port: config.port,
    getActiveConnections(): number {
      return wsServer.getActiveConnections();
    },
    async stop() {
      await shutdown();
    },
  };
}

/**
 * Slash 命令处理器：在 agent 之前拦截 / 开头的输入。
 */
export interface SlashCommandHandler {
  registry: CommandRegistry;
  ctx: CommandContext;
}

/**
 * SessionRef：可变引用，支持 /new 命令重建 session。
 */
export interface SessionRef {
  current: ReturnType<typeof createAgentSession>;
  currentKey: string;
}

/**
 * SessionFactory：创建新 session 的工厂函数。
 */
export type SessionFactory = (sessionId: string) => ReturnType<typeof createAgentSession>;

/**
 * 将 CommandResult 转换为展示给用户的消息文本。
 * 优先使用命令显式输出；否则按 action 生成默认描述。
 */
function describeCommandResult(result: CommandResult): string {
  if (result.output) return result.output;
  switch (result.action) {
    case 'new_session':
      // /resume 成功时提示已切换的 session（loadHistory 会加载历史，agent 自然恢复上下文）
      if (result.resumeFromArg) {
        return result.continueSessionId
          ? `Resumed session: ${result.continueSessionId.slice(0, 8)}`
          : 'Session resumed.';
      }
      return result.continueSessionId
        ? `Switched to session: ${result.continueSessionId.slice(0, 8)}`
        : 'New session started.';
    case 'clear':
      return 'Conversation cleared.';
    case 'exit':
      return 'Exiting...';
    case 'continue':
      return `Inherited working memory from session: ${result.continueSessionId ?? ''}`;
    default:
      return '';
  }
}

/**
 * §7.3 runInboundLoop: 消费入站消息 → 驱动 agent session → 发布 AgentEventEnvelope 到出站队列。
 * C6 修复：InboundMessage 有 content 字段而非 type/text。
 * C7 修复：AgentEventEnvelope 需 sessionKey/chatId/channel/event/seq。
 * I6 修复：接入 watchdog，turn 开始时 markTurnStart，结束时 markTurnEnd。
 * Slash 命令拦截：若提供 slashHandler 且消息以 / 开头，命令在 agent 之前执行。
 */
export async function runInboundLoop(
  bus: InMemoryMessageBus,
  sessionRef: SessionRef,
  watchdog: { markTurnStart: () => void; markTurnEnd: () => void },
  slashHandler?: SlashCommandHandler,
  sessionFactory?: SessionFactory,
  /** Task 6: /new 或 /resume 后触发，参数为 (oldKey, newId)，用于推送 session_changed 事件 */
  onNewSession?: (oldKey: string, newId: string) => void,
): Promise<void> {
  const loopLog = createLogger('inbound-loop');
  let seq = 0;

  /**
   * Task 7: per-sessionKey 串行化。
   * 维护每个 sessionKey 的当前 turn Promise，新消息 await 前一个 turn 完成后再处理。
   * 不同 sessionKey 并行；同一 sessionKey 串行，避免 agent 响应交错。
   * turn 完成后从 map 中清理，防止内存泄漏。
   */
  const runningTurns = new Map<string, Promise<void>>();

  /**
   * 发送单个 AgentEvent envelope 到出站队列。
   * Task 7 I15 fix: sessionKey 使用传入的 senderSessionKey 而非全局 sessionRef.currentKey，
   * 使多客户端场景下事件能正确路由到发起方连接。
   */
  async function emit(
    sessionKey: string,
    chatId: string,
    channel: string,
    event: AgentEventEnvelope['event'],
  ): Promise<void> {
    await bus.publishOutbound({ sessionKey, chatId, channel, event, seq: seq++ });
  }

  for (;;) {
    try {
      const msg = await bus.consumeInbound();
      const text = msg.content;
      const chatId = msg.chatId;
      const channelName = msg.channel;
      // Task 6 I2 + Task 7 I15: 从 metadata 读取发起方 sessionKey，用于串行化分组和 envelope 路由
      const senderSessionKey = (msg.metadata.sessionKey as string | undefined) ?? sessionRef.currentKey;
      const senderUserId = msg.metadata.userId as string | undefined;

      // Task 7: 按 sessionKey 串行化 — await 前一个 turn 完成后再处理当前消息
      // C1 fix: 吞掉前一个 turn 的 rejection，防止级联跳过后续 turn 与 unhandled rejection
      const prev = (runningTurns.get(senderSessionKey) ?? Promise.resolve()).catch(() => undefined);
      const next = prev.then(async () => {
        // I5 fix: ctx.userId 在链内设置，避免并行 sessionKey 间的竞态
        if (senderUserId && slashHandler) slashHandler.ctx.userId = senderUserId;
        try {
          watchdog.markTurnStart();
        } catch (e) {
          loopLog.warn('markTurnStart failed', { error: String(e) });
        }
        try {
          // Slash 命令拦截：在 agent 之前处理 / 开头的输入
          if (slashHandler && text.startsWith('/')) {
            const resolved = slashHandler.registry.resolve(text);
            if (resolved) {
              const result: CommandResult = await resolved.command.execute(resolved.args, slashHandler.ctx);
              // /new 或 /resume：重建 session，使后续消息进入全新上下文
              if (result.action === 'new_session' && sessionFactory) {
                const oldKey = senderSessionKey;
                const newId = result.continueSessionId ?? randomUUID();
                sessionRef.current = sessionFactory(newId);
                sessionRef.currentKey = newId;
                if (slashHandler) slashHandler.ctx.sessionId = newId;
                // Task 6: 通知 server 推送 session_changed 到发起方 sessionKey 的 connection
                onNewSession?.(oldKey, newId);
                loopLog.info('session switched', { senderSessionKey: oldKey, newSessionKey: newId, resumed: !!result.continueSessionId });
              }
              // 所有命令都发送完整 turn 事件序列，确保客户端清除 working 状态
              const turnId = createTurnId();
              const messageId = createMessageId();
              await emit(senderSessionKey, chatId, channelName, { type: 'turn_start', turnId });
              await emit(senderSessionKey, chatId, channelName, { type: 'message_start', messageId });
              const outputText = describeCommandResult(result);
              if (outputText) {
                await emit(senderSessionKey, chatId, channelName, { type: 'message_delta', text: outputText });
              }
              await emit(senderSessionKey, chatId, channelName, { type: 'message_end', messageId, stopReason: DEFAULT_STOP_REASON });
              await emit(senderSessionKey, chatId, channelName, { type: 'turn_end', turnId });
              return;
            }
          }

          // 正常 agent 处理
          // 验收修复：agent 处理前 emit user_message 事件，使其他客户端能同步看到用户发送的消息
          const senderClientId = msg.metadata.clientId as string | undefined;
          await emit(senderSessionKey, chatId, channelName, { type: 'user_message', text, senderId: senderClientId ?? '' });
          for await (const event of sessionRef.current.run(text)) {
            await emit(senderSessionKey, chatId, channelName, event);
          }
        } catch (err) {
          loopLog.error('turn failed', { sessionKey: senderSessionKey, error: String(err) });
          // C1 fix: catch 块内的 emit 单独 try/catch，防止 catch 自身抛错导致 turn promise reject
          try {
            await emit(senderSessionKey, chatId, channelName, { type: 'error', message: String(err), retryable: false });
          } catch (emitErr) {
            loopLog.error('error-emit failed', { sessionKey: senderSessionKey, error: String(emitErr) });
          }
        } finally {
          // C1 fix: finally 内 markTurnEnd 防御性 try/catch，防止覆盖 turn 的完成值
          try {
            watchdog.markTurnEnd();
          } catch (e) {
            loopLog.warn('markTurnEnd failed', { error: String(e) });
          }
        }
      });
      runningTurns.set(senderSessionKey, next);
      // C1 fix: cleanup 的 finally 也加 catch，防止 unhandled rejection
      void next.finally(() => {
        if (runningTurns.get(senderSessionKey) === next) {
          runningTurns.delete(senderSessionKey);
        }
      }).catch(() => undefined);
    } catch (err) {
      loopLog.error('inbound loop error', { error: String(err) });
    }
  }
}

/**
 * Main entry: 读取 PORT / APTBOT_AUTH_TOKEN 环境变量启动服务器。
 * 用法: npm run dev  或  tsx src/server.ts
 * 仅当直接执行此模块时运行（测试 import 不触发）。
 */
const DEFAULT_PORT = 8080;

const __filename = fileURLToPath(import.meta.url);
if (process.argv[1] === __filename) {
  const PORT = parseInt(process.env.PORT ?? String(DEFAULT_PORT), 10);
  const AUTH_TOKEN = process.env.APTBOT_AUTH_TOKEN;
  const HOST = process.env.HOST;

  startServer({ port: PORT, deploy: 'local', authToken: AUTH_TOKEN, host: HOST }).catch((err) => {
    console.error('[aptbot] Failed to start server:', err);
    process.exit(1);
  });
}
