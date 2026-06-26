import { loadConfig, resolveApiKey } from './infrastructure/config-loader.js';
import { FileStorage } from './infrastructure/storage/file-storage.js';
import { createToolRegistry } from './core/tool/types.js';
import { bashTool } from './core/tool/tools/bash.js';
import { readTool } from './core/tool/tools/read.js';
import { editTool } from './core/tool/tools/edit.js';
import { createUpdateWorkingMemoryTool } from './core/tool/tools/update-working-memory.js';
import { createProvider } from './core/provider/models.js';
import type { ProviderDeclaration } from './core/provider/models.js';
import type { Provider, Model } from './core/provider/types.js';
import { createAgentSession } from './core/agent/session.js';
import { agentLoop } from './core/agent/loop.js';
import { InMemoryMessageBus } from './bus/message-bus.js';
import { createChannelManager } from './bus/channel-manager.js';
import { startWebSocketServer } from './access/websocket-server.js';
import {
  installProcessHandlers,
  startMemoryMonitor,
  startTurnWatchdog,
} from './infrastructure/process-handler.js';
import { createCommandRegistry } from './shared/commands/registry.js';
import { createLogger } from './infrastructure/logger.js';
import { randomUUID } from 'crypto';

const log = createLogger('server');

export interface ServerConfig {
  port: number;
  deploy: 'local' | 'cf';
  authToken?: string;
}

export interface ServerHandle {
  stop(): Promise<void>;
  readonly port: number;
}

function findModelFromConfig(
  config: Awaited<ReturnType<typeof loadConfig>>,
): { provider: ProviderDeclaration; model: Model } {
  for (const p of config.providers) {
    for (const m of p.models) {
      if (m.id === config.defaultModel) {
        const decl: ProviderDeclaration = {
          id: p.id,
          name: p.name,
          baseUrl: p.baseUrl,
          auth: { envVar: p.auth.envVar ?? p.auth.apiKey ?? 'API_KEY' },
          models: p.models.map((mm) => ({
            provider: p.id,
            id: mm.id,
            api: mm.api,
            contextWindow: mm.contextWindow,
            maxTokens: mm.maxTokens,
          })),
        };
        return { provider: decl, model: decl.models.find((mm) => mm.id === m.id)! };
      }
    }
  }
  throw new Error(`default model not found: ${config.defaultModel}`);
}

export async function startServer(config: ServerConfig): Promise<ServerHandle> {
  log.info('starting server', { port: config.port, deploy: config.deploy });

  const aptbotConfig = await loadConfig();
  const sessionsDir = `${aptbotConfig.dataDir}/sessions`;
  const storage = new FileStorage(sessionsDir);

  const registry = createToolRegistry();
  registry.register(bashTool);
  registry.register(readTool);
  registry.register(editTool);

  const { provider: providerDecl, model } = findModelFromConfig(aptbotConfig);

  const apiKey = resolveApiKey({
    id: providerDecl.id,
    name: providerDecl.name,
    baseUrl: providerDecl.baseUrl,
    auth: { envVar: providerDecl.auth.envVar },
    models: [],
  });
  if (!apiKey) {
    throw new Error(`API key not resolved for provider ${providerDecl.id}`);
  }

  const provider: Provider = createProvider(providerDecl, apiKey);

  const sessionId = randomUUID();
  registry.register(createUpdateWorkingMemoryTool(storage, sessionId));

  const session = createAgentSession({
    storage,
    sessionId,
    agentLoop,
    provider,
    model,
    tools: registry,
    systemPrompt: 'You are aptbot, a personal learning and work assistant.',
  });

  const bus = new InMemoryMessageBus();
  const channelManager = createChannelManager(bus);
  const commandRegistry = createCommandRegistry();

  const wsServer = await startWebSocketServer({
    port: config.port,
    bus,
    authToken: config.authToken,
  });

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
  startTurnWatchdog(() => log.warn('turn watchdog timeout'));

  void runInboundLoop(bus, session, storage, sessionId, commandRegistry, aptbotConfig.defaultModel);
  void channelManager.runDispatchLoop();

  log.info('server started', { port: config.port });

  return {
    port: config.port,
    async stop() {
      await shutdown();
    },
  };
}

async function runInboundLoop(
  bus: InMemoryMessageBus,
  session: ReturnType<typeof createAgentSession>,
  storage: FileStorage,
  sessionId: string,
  _registry: ReturnType<typeof createCommandRegistry>,
  _model: string,
): Promise<void> {
  const log = createLogger('inbound-loop');
  for (;;) {
    try {
      const msg = await bus.consumeInbound();
      if (msg.type === 'message' && typeof msg.text === 'string') {
        const text = msg.text;
        void (async () => {
          try {
            for await (const event of session.run(text)) {
              await bus.publishOutbound({
                event,
                sessionId,
                channelId: msg.channelId ?? 'unknown',
                timestamp: Date.now(),
              });
            }
          } catch (err) {
            log.error('agent run failed', { error: String(err) });
          }
        })();
      }
    } catch (err) {
      log.error('inbound loop error', { error: String(err) });
    }
  }
}
