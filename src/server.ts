import { loadConfig, resolveApiKey, ConfigLoader, parseAptbotConfig, DEFAULT_CONFIG_PATH } from './infrastructure/config-loader.js';
import { FileStorage, type StorageAdapter } from './infrastructure/storage/file-storage.js';
import { createUserStorage, type UserStorage } from './infrastructure/user-storage.js';
import type { AptbotConfig, ProviderConfig } from './infrastructure/config-types.js';
import { createToolRegistry } from './core/tool/types.js';
import { bashTool } from './core/tool/tools/bash.js';
import { createReadTool } from './core/tool/tools/read.js';
import { editTool } from './core/tool/tools/edit.js';
import { createUpdateWorkingMemoryTool } from './core/tool/tools/update-working-memory.js';
import { createSkillState, type SkillState } from './core/skills/loader.js';
import { formatSkillsForSystemPrompt } from './core/skills/system-prompt.js';
import { createNodeExecutionEnv } from './core/skills/env.js';
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
import { ArticleLoader } from './learn/article-loader.js';
import { FeedbackStorage } from './infrastructure/feedback-storage.js';
import { readHistoryForReplay } from './core/memory/session-repo.js';
import {
  installProcessHandlers,
  startMemoryMonitor,
  startTurnWatchdog,
} from './infrastructure/process-handler.js';
import { createLogger } from './infrastructure/logger.js';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import * as os from 'node:os';
import * as path from 'node:path';

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

/**
 * §4.9 L1 索引：拼装 system prompt = base + skills 索引段。
 * - skillState 为 undefined（创建失败降级）时仅返回 base
 * - formatSkillsForSystemPrompt 失败时降级到 base（不阻塞 server 启动 / rebuild）
 * - 热重载后调用方传入 reloaded skillState 以拿到最新索引
 */
function buildSystemPrompt(skillState: SkillState | undefined): string {
  const base = `You are aptbot, a personal learning and work assistant.

Important constraints:
- You are running inside a server process. NEVER execute commands that would kill, stop, or restart the server process (e.g., kill, pkill, killall, pnpm kill, shutdown, reboot). If asked to restart/stop the server, explain that you cannot do this and the user should do it manually.
- NEVER modify the server's own source code or configuration files (under /Users/evan/projects/aptbot/src/, config/, package.json) while the server is running.
- NEVER read or access files under the data/sessions/ directory. These are internal session storage files. Session history is managed automatically by the system (via /resume, /continue commands). Do not attempt to read, cat, or parse them.
- When bash command output is long, summarize the key information instead of pasting everything.`;
  if (!skillState) return base;
  try {
    const skillsSection = formatSkillsForSystemPrompt([...skillState.skills]);
    if (!skillsSection) return base;
    return `${base}\n\n${skillsSection}`;
  } catch (e) {
    log.warn('format skills for system prompt failed', { error: String(e) });
    return base;
  }
}

/**
 * Task 11 (0.2.3): learn system 装配决策。
 *
 * 根据 config 推导 learnEnabled / feedbackEnabled，并按需实例化 ArticleLoader + FeedbackStorage。
 * - learnEnabled = config.landingPage === true && config.learnPage === true
 *   （两者均需显式 true；缺省视为 false，确保 clone 用户零影响）
 * - feedbackEnabled = config.feedbackEnabled !== false（缺省视为 true）
 * - ArticleLoader 实例化条件：learnEnabled || feedbackEnabled
 *   （feedback 校验 category=article 的 articleSlug 依赖 ArticleLoader，故 feedback 启用时也需创建）
 * - FeedbackStorage 实例化条件：feedbackEnabled
 * - ArticleLoader 实例化后调用 load() 预加载（articlesDir 不存在时降级为空 state，不抛错）
 *
 * 抽出为独立可测函数，避免为装配逻辑启动完整 server。
 */
export interface LearnWiringInput {
  readonly aptbotConfig: AptbotConfig;
  /** articles 目录绝对路径（src/learn/articles/） */
  readonly articlesDir: string;
}

export interface LearnWiringResult {
  readonly learnEnabled: boolean;
  readonly feedbackEnabled: boolean;
  readonly articleLoader?: ArticleLoader;
  readonly feedbackStorage?: FeedbackStorage;
}

export async function resolveLearnWiring(input: LearnWiringInput): Promise<LearnWiringResult> {
  const { aptbotConfig, articlesDir } = input;
  // === true 严格检查：landingPage/learnPage 可能为 undefined（缺省），防御性处理
  const learnEnabled = aptbotConfig.landingPage === true && aptbotConfig.learnPage === true;
  // !== false：feedbackEnabled 缺省视为 true，仅显式 false 才禁用
  const feedbackEnabled = aptbotConfig.feedbackEnabled !== false;

  let articleLoader: ArticleLoader | undefined;
  // ArticleLoader 在 learnEnabled 或 feedbackEnabled 任一启用时创建
  // （feedback 的 category=article 校验依赖 ArticleLoader.getBySlug）
  if (learnEnabled || feedbackEnabled) {
    articleLoader = new ArticleLoader(articlesDir);
    await articleLoader.load();
  }

  let feedbackStorage: FeedbackStorage | undefined;
  if (feedbackEnabled) {
    feedbackStorage = new FeedbackStorage(aptbotConfig.dataDir);
  }

  return { learnEnabled, feedbackEnabled, articleLoader, feedbackStorage };
}

export async function startServer(config: ServerConfig): Promise<ServerHandle> {
  log.info('starting server', { port: config.port, deploy: config.deploy });

  const aptbotConfig = await loadConfig();
  // §4.6 Config 热重载：ConfigLoader 在 beforeTurn 检查 mtimeNs 变化（懒加载）
  const configLoader = new ConfigLoader<AptbotConfig>(
    process.env.APTBOT_CONFIG ?? DEFAULT_CONFIG_PATH,
    parseAptbotConfig,
  );
  const sessionsDir = `${aptbotConfig.dataDir}/sessions`;
  const storage = new FileStorage(sessionsDir);
  // Task 5: 用户存储 — 始终创建，供 /api/register /api/login /api/me 与 WS 认证使用
  const userStorage: UserStorage = createUserStorage(aptbotConfig.dataDir);

  // §4.8 Skills 系统：workspace (~/.aptbot/skills/) + builtin (src/skills/) 双层加载
  // workspace 优先级高（覆盖 builtin 同名），builtin 兜底
  // 降级：SkillState 创建失败时 skillState=undefined，server 仍可启动（无 skills 索引）
  const skillEnv = createNodeExecutionEnv(process.cwd());
  const workspaceSkillsDir = path.join(os.homedir(), '.aptbot', 'skills');
  const builtinSkillsDir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'skills');
  let skillState: SkillState | undefined;
  try {
    skillState = await createSkillState(skillEnv, [workspaceSkillsDir, builtinSkillsDir]);
    log.info('skills loaded', {
      count: skillState.skills.length,
      workspace: workspaceSkillsDir,
      builtin: builtinSkillsDir,
    });
  } catch (e) {
    log.warn('skill state creation failed, continuing without skills', { error: String(e) });
    skillState = undefined;
  }

  const registry = createToolRegistry();
  registry.register(bashTool);
  // §12.5 read_file 特判：传入 skillState 后，读取 skill 文件时更新 lastUsed（联动 L1 索引重排序）
  registry.register(createReadTool({ skillState }));
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

  // §4.9 L1 索引注入 system prompt（skillState 降级时仅 base）
  const systemPrompt = buildSystemPrompt(skillState);

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
  // Task 11 (0.2.3): learn system 装配 — 根据 config 实例化 ArticleLoader + FeedbackStorage
  // articlesDir 解析为 src/learn/articles/（与 server.ts 同目录的 learn/articles/）
  const articlesDir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'learn', 'articles');
  const learnWiring = await resolveLearnWiring({ aptbotConfig, articlesDir });
  const wsServer = await startWebSocketServer({
    port: config.port,
    bus,
    authToken: config.authToken,
    host: config.host,
    // Task 11: learnEnabled 时向落地页注入 articleState 供知识 section 渲染
    serveHtml: landingEnabled
      ? createLandingPageHtml({
          learnEnabled: learnWiring.learnEnabled,
          articleState: learnWiring.learnEnabled ? learnWiring.articleLoader?.getState() : undefined,
        })
      : createChatPageHtml('/ws'),
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
    // Task 3 (0.2.2): ring buffer 未命中时从 JSONL 兜底回放历史
    // 仅限 wsServer 调用，agent 仍受 data/sessions/ 访问禁令
    readHistoryForReplay: (id, limit) => readHistoryForReplay(storage, id, limit),
    // Task 11 (0.2.3): learn system 选项注入
    articleLoader: learnWiring.articleLoader,
    feedbackStorage: learnWiring.feedbackStorage,
    learnEnabled: learnWiring.learnEnabled,
    feedbackEnabled: learnWiring.feedbackEnabled,
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
    configLoader.stop();
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
    ctx: {
      sessionId,
      model: model.id,
      storage,
      // Task 11: /session 动态属性句柄 + 文件逃生口数据目录
      sessionAttrs: session,
      dataDir: aptbotConfig.dataDir,
      // Task 12: /feedback 命令使用的反馈存储；feedbackEnabled:false 时为 undefined
      feedbackStorage: learnWiring.feedbackStorage,
    },
  };

  // §4.6 Config 热重载 rebuild：用新配置重建 provider/model/session（下个 turn 生效）
  // 当前 turn 不受影响（sessionRef.current 在 afterTurn 才被替换）
  // §4.9 Skills 热重载联动：rebuild 前 await skillState.reload()，新 session 拿到最新 skills
  const rebuildSession: (newConfig: AptbotConfig) => Promise<void> = async (newConfig) => {
    try {
      // Skills 热重载优先于 session 重建（失败降级到旧 skills，不阻塞 provider/model rebuild）
      if (skillState) {
        try {
          await skillState.reload();
        } catch (e) {
          log.warn('skills reload failed, keeping old skills', { error: String(e) });
        }
      }
      const { provider: newDecl, providerConfig: newPc, model: newModel } = findModelFromConfig(newConfig);
      const newApiKey = resolveApiKey(newPc);
      if (!newApiKey) {
        log.error('hot-reload: API key not resolved, keeping old config', { provider: newDecl.id });
        return;
      }
      const newProvider = createProvider(newDecl, newApiKey);
      const newSystemPrompt = buildSystemPrompt(skillState);
      sessionRef.current = createAgentSession({
        storage,
        sessionId: sessionRef.currentKey,
        agentLoop,
        provider: newProvider,
        model: newModel,
        tools: registry,
        systemPrompt: newSystemPrompt,
      });
      if (slashHandler) slashHandler.ctx.model = newModel.id;
      log.info('config hot-reloaded', { model: newModel.id, provider: newDecl.id });
    } catch (e) {
      log.error('hot-reload rebuild failed, keeping old config', { error: String(e) });
    }
  };

  const configReload: ConfigReload = { loader: configLoader, rebuild: rebuildSession };

  void runInboundLoop(bus, sessionRef, watchdog, slashHandler, sessionFactory, (oldKey, newId) => {
    // /new 或 /resume 后，向旧 sessionKey 的 connection 推送 session_changed
    // 客户端收到后更新 localStorage 并用 ?session=newId 重连
    log.info('onNewSession: sending session_changed', { oldKey: oldKey.slice(0, 8), newId: newId.slice(0, 8) });
    channelManager.bindSession(newId, wsChannel);
    wsServer.sendToSessionKey(oldKey, { type: 'session_changed', sessionId: newId });
  }, configReload);
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
 * §4.6/§12.2 Config 热重载句柄：runInboundLoop 在 beforeTurn 检查 mtimeNs 变化，
 * 变化时重建 session（当前 turn 用旧快照，下个 turn 用新配置）。
 * 校验失败降级到旧配置 + 发 error 事件到 channel。
 */
export interface ConfigReload {
  readonly loader: ConfigLoader<AptbotConfig>;
  /** 用新配置重建 provider/model/session（下个 turn 生效）。
   *  返回 void | Promise<void>：允许同步或异步 rebuild（§4.9 Skills 热重载联动需要 async reload） */
  rebuild: (config: AptbotConfig) => void | Promise<void>;
}

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
  /** /new 或 /resume 后触发，参数为 (oldKey, newId)，用于推送 session_changed 事件 */
  onNewSession?: (oldKey: string, newId: string) => void,
  /** §4.6 Config 热重载：beforeTurn 检查 mtimeNs，变化时准备 pending，afterTurn 应用 */
  configReload?: ConfigReload,
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
   * Task 2: per-sessionKey 链长跟踪，用于计算 turn_busy 的 position。
   * chainLength = 当前 sessionKey 上正在执行 + 排队中的 turn 总数。
   * 新消息到达时若有 running turn，position = chainLength + 1（包含自身）。
   */
  const chainLength = new Map<string, number>();

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

      // Task 2: 同 sessionKey 已有 turn 执行时，新消息入队前发 turn_busy
      // position = chainLength + 1（前方队列 + 自身），失败时静默忽略不阻塞主流程
      if (runningTurns.has(senderSessionKey)) {
        const position = (chainLength.get(senderSessionKey) ?? 0) + 1;
        try {
          await emit(senderSessionKey, chatId, channelName, { type: 'turn_busy', position });
        } catch (e) {
          loopLog.warn('turn_busy emit failed', { sessionKey: senderSessionKey, error: String(e) });
        }
        chainLength.set(senderSessionKey, position);
      } else {
        chainLength.set(senderSessionKey, 1);
      }

      const next = prev.then(async () => {
        // I5 fix: ctx.userId 在链内设置，避免并行 sessionKey 间的竞态
        if (senderUserId && slashHandler) slashHandler.ctx.userId = senderUserId;
        // Task 11: 每个 turn 刷新 sessionAttrs 句柄，使 /new /resume /热重载后的新 session 生效
        if (slashHandler) slashHandler.ctx.sessionAttrs = sessionRef.current;
        // §4.6 beforeTurn：检查 config mtimeNs 变化（当前 turn 用旧快照，pending 等 afterTurn 应用）
        // rebuild 可同步或异步（§4.9 Skills 热重载联动需 await skillState.reload()）
        let pendingConfigApply: (() => void | Promise<void>) | null = null;
        if (configReload) {
          try {
            const reloadResult = await configReload.loader.load();
            if (reloadResult.error) {
              // 校验失败降级到旧配置 + channel 错误通知（不中断服务）
              // 操作侧日志：记录降级原因（emit 给 channel 的是脱敏的通用消息）
              loopLog.warn('config reload degraded', { error: reloadResult.error });
              try {
                await emit(senderSessionKey, chatId, channelName, { type: 'error', message: 'config reload failed, using old config', retryable: false });
              } catch (e) {
                loopLog.warn('config error emit failed', { error: String(e) });
              }
            }
            if (reloadResult.changed && !reloadResult.error) {
              const newConfig = reloadResult.data;
              pendingConfigApply = () => configReload.rebuild(newConfig);
            }
          } catch (e) {
            loopLog.warn('config reload check failed', { error: String(e) });
          }
        }
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
                if (slashHandler) {
                  slashHandler.ctx.sessionId = newId;
                  // Task 11: 同步刷新 sessionAttrs 句柄到新 session
                  slashHandler.ctx.sessionAttrs = sessionRef.current;
                }
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
          // §4.6 afterTurn：应用 pending config（下个 turn 生效）
          // §4.9 Skills 热重载联动：rebuild 内部 await skillState.reload()，需 await 以确保
          // 下个 turn 看到新 skills（reload 失败降级到旧 skills，不阻塞 rebuild）
          if (pendingConfigApply) {
            try {
              await pendingConfigApply();
            } catch (e) {
              loopLog.error('config apply failed', { error: String(e) });
            }
          }
        }
      });
      runningTurns.set(senderSessionKey, next);
      // C1 fix: cleanup 的 finally 也加 catch，防止 unhandled rejection
      void next.finally(() => {
        if (runningTurns.get(senderSessionKey) === next) {
          runningTurns.delete(senderSessionKey);
        }
        // Task 2: turn 完成后递减 chainLength，归零时清理
        const len = chainLength.get(senderSessionKey) ?? 0;
        if (len <= 1) {
          chainLength.delete(senderSessionKey);
        } else {
          chainLength.set(senderSessionKey, len - 1);
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
