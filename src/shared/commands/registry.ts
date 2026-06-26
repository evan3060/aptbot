import type { StorageAdapter } from '../../infrastructure/storage/file-storage.js';
import { inheritWorkingMemory } from '../../core/memory/working-memory.js';

export interface Command {
  readonly name: string;
  readonly description: string;
  readonly aliases?: string[];
  execute(args: string[], ctx: CommandContext): Promise<CommandResult>;
}

export interface CommandResult {
  output?: string;
  action?: 'exit' | 'new_session' | 'clear' | 'continue';
  continueSessionId?: string;
}

export interface CommandContext {
  sessionId: string;
  model: string;
  storage: StorageAdapter;
}

export interface CommandRegistry {
  register(cmd: Command): void;
  get(name: string): Command | undefined;
  has(name: string): boolean;
  list(): Command[];
  resolve(input: string): { command: Command; args: string[] } | null;
}

/**
 * §8.2 / §8.4 createCommandRegistry: 创建带 7 个内置命令的注册表。
 * resolve 解析 `/cmd args` 或别名，未知命令返回 null。
 */
export function createCommandRegistry(): CommandRegistry {
  const commands = new Map<string, Command>();
  const aliases = new Map<string, string>();

  function register(cmd: Command): void {
    commands.set(cmd.name, cmd);
    if (cmd.aliases) {
      for (const alias of cmd.aliases) {
        aliases.set(alias, cmd.name);
      }
    }
  }

  // 注册 7 个内置命令
  register(newCommand);
  register(clearCommand);
  register(helpCommand);
  register(modelCommand);
  register(sessionCommand);
  register(continueCommand);
  register(exitCommand);

  return {
    register,
    get(name: string): Command | undefined {
      const realName = aliases.get(name) ?? name;
      return commands.get(realName);
    },
    has(name: string): boolean {
      const realName = aliases.get(name) ?? name;
      return commands.has(realName);
    },
    list(): Command[] {
      return Array.from(commands.values());
    },
    resolve(input: string): { command: Command; args: string[] } | null {
      if (!input.startsWith('/')) return null;
      const parts = input.slice(1).split(/\s+/);
      const name = parts[0];
      const args = parts.slice(1).filter((p) => p.length > 0);
      const cmd = this.get(name);
      if (!cmd) return null;
      return { command: cmd, args };
    },
  };
}

const newCommand: Command = {
  name: 'new',
  description: 'Start a new session',
  async execute() {
    return { action: 'new_session' };
  },
};

const clearCommand: Command = {
  name: 'clear',
  description: 'Clear the current conversation',
  async execute() {
    return { action: 'clear' };
  },
};

const helpCommand: Command = {
  name: 'help',
  description: 'Show available commands',
  async execute(_args, ctx) {
    // help 需要列出所有命令，但 Command 接口无法访问 registry。
    // 通过 ctx 传入或使用固定列表。MVP 使用固定列表。
    const lines = [
      'Available commands:',
      '  /new          - Start a new session',
      '  /clear        - Clear the current conversation',
      '  /help         - Show this help message',
      '  /model [name] - Show or set the current model',
      '  /session      - Show session information',
      '  /continue <id> - Continue from a previous session',
      '  /exit         - Exit the application',
    ];
    return { output: lines.join('\n') };
  },
};

const modelCommand: Command = {
  name: 'model',
  description: 'Show or set the current model',
  async execute(args, ctx) {
    if (args.length === 0) {
      return { output: `Current model: ${ctx.model}` };
    }
    // MVP: 仅显示，实际切换由调用方处理
    return { output: `Model: ${args[0]}` };
  },
};

const sessionCommand: Command = {
  name: 'session',
  description: 'Show session information',
  async execute(_args, ctx) {
    return { output: `Session: ${ctx.sessionId}` };
  },
};

const continueCommand: Command = {
  name: 'continue',
  description: 'Continue from a previous session by inheriting working memory',
  async execute(args, ctx) {
    if (args.length === 0) {
      return { output: 'Usage: /continue <session-id>' };
    }
    const sourceId = args[0];
    const entries = await ctx.storage.readSession(sourceId);
    if (entries.length === 0) {
      return { output: `Session not found: ${sourceId}` };
    }
    try {
      await inheritWorkingMemory(sourceId, ctx.sessionId, ctx.storage);
      return { action: 'continue', continueSessionId: sourceId };
    } catch {
      return { output: `Failed to inherit working memory from: ${sourceId}` };
    }
  },
};

const exitCommand: Command = {
  name: 'exit',
  description: 'Exit the application',
  aliases: ['quit'],
  async execute() {
    return { action: 'exit' };
  },
};
