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
  resumeFromArg?: boolean;
}

export interface CommandContext {
  sessionId: string;
  model: string;
  storage: StorageAdapter;
  /** Task 6: 当前用户 ID，用于 session 归属过滤；匿名用户为临时 UUID */
  userId?: string;
}

export interface CommandRegistry {
  register(cmd: Command): void;
  get(name: string): Command | undefined;
  has(name: string): boolean;
  list(): Command[];
  resolve(input: string): { command: Command; args: string[] } | null;
}

/**
 * §8.2 / §8.4 createCommandRegistry: 创建带 10 个内置命令的注册表。
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
  register(sessionsCommand);
  register(resumeCommand);
  register(labelCommand);

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
  async execute(_args) {
    // help 需要列出所有命令，但 Command 接口无法访问 registry。
    // 通过 ctx 传入或使用固定列表。MVP 使用固定列表。
    const lines = [
      'Available commands:',
      '  /new          - Start a new session',
      '  /clear        - Clear the current conversation',
      '  /help         - Show this help message',
      '  /model [name] - Show or set the current model',
      '  /session      - Show session information',
      '  /sessions     - List all sessions',
      '  /resume <id>  - Resume a specific session',
      '  /continue <id> - Continue from a previous session',
      '  /label <name> - Set the current session label',
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
    } catch (err) {
      console.warn('inheritWorkingMemory failed:', err);
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

/**
 * 格式化相对时间。
 */
function formatRelativeTime(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 60000) return 'just now';
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  return `${Math.floor(diff / 86400000)}d ago`;
}

/**
 * 从 entries 中提取最后一条 user/assistant 消息的摘要。
 */
function findLastMessagePreview(entries: { type: string; message?: { content: unknown } }[]): string {
  for (let i = entries.length - 1; i >= 0; i--) {
    const e = entries[i];
    if (e.type === 'message' && e.message) {
      const content = e.message.content;
      const text = typeof content === 'string' ? content : JSON.stringify(content);
      return text.length > 40 ? text.slice(0, 40) + '...' : text;
    }
  }
  return '(empty)';
}

const sessionsCommand: Command = {
  name: 'sessions',
  description: 'List all sessions',
  async execute(_args, ctx) {
    const sessions = await ctx.storage.listSessions();
    if (sessions.length === 0) {
      return { output: 'No sessions found.' };
    }
    const lines: string[] = ['Sessions:'];
    for (let i = 0; i < sessions.length; i++) {
      const s = sessions[i];
      const entries = await ctx.storage.readSession(s.id);
      const msgCount = entries.filter((e) => e.type === 'message').length;
      const preview = findLastMessagePreview(entries as { type: string; message?: { content: unknown } }[]);
      const time = formatRelativeTime(s.updatedAt);
      const shortId = s.id.slice(0, 8);
      const prefix = s.id === ctx.sessionId ? '(current) ' : '';
      lines.push(`  [${i + 1}] ${prefix}${shortId}  (${time}, ${msgCount} msgs)  "${preview}"`);
    }
    lines.push('', 'Use /resume <id> to switch to a session.');
    return { output: lines.join('\n') };
  },
};

const resumeCommand: Command = {
  name: 'resume',
  description: 'Resume a specific session by ID (short or full)',
  async execute(args, ctx) {
    if (args.length === 0) {
      return { output: 'Usage: /resume <session-id>' };
    }
    const targetId = args[0];
    const sessions = await ctx.storage.listSessions();
    const matches = sessions.filter((s) => s.id.startsWith(targetId));
    if (matches.length === 0) {
      return { output: `Session not found: ${targetId}` };
    }
    if (matches.length > 1) {
      return { output: `Ambiguous id, matches: ${matches.map((s) => s.id.slice(0, 8)).join(', ')}` };
    }
    return { action: 'new_session', continueSessionId: matches[0].id, resumeFromArg: true };
  },
};

/**
 * Task 6: /label <名称> — 设置当前 session 的 label。
 * 通过 storage.updateSessionLabel 持久化到 sidecar .meta.json。
 * Task 6 M4 fix: label 长度限制 100 字符，防止 listSessions 返回过大。
 */
const LABEL_MAX_LENGTH = 100;
const labelCommand: Command = {
  name: 'label',
  description: 'Set the current session label',
  async execute(args, ctx) {
    if (args.length === 0) {
      return { output: 'Usage: /label <name>' };
    }
    const label = args.join(' ').slice(0, LABEL_MAX_LENGTH);
    await ctx.storage.updateSessionLabel(ctx.sessionId, label);
    return { output: `Session label set: ${label}` };
  },
};
