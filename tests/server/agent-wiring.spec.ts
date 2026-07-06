import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import WebSocket from 'ws';
import { startServer, type ServerHandle, buildSessionSystemPrompt } from '../../src/server.js';
import { AgentStorage } from '../../src/core/agent/agent-storage.js';
import { ensureDefaultAgent, DEFAULT_AGENT_SLUG } from '../../src/core/agent/agent-migration.js';
import type { AgentProfile } from '../../src/core/agent/agent-profile.js';
import type { SkillState } from '../../src/core/skills/loader.js';

/**
 * §0.3.0 Task 17: server.ts agent 模块装配集成测试
 *
 * 覆盖 brief 行为契约：
 * - server.ts 启动时实例化 AgentStorage + 调用 migrateLegacySessions
 * - slashHandler.ctx 注入 agentStorage / currentAgentSlug / memoryAuditLogFactory / skillState
 * - systemPrompt 动态构建：不同 agent 产出不同 systemPrompt
 *
 * 测试策略：
 * 1. migration E2E：在临时 dataDir 写入 legacy session，启动 server，验证迁移发生
 * 2. slashHandler.ctx 注入：通过 WS 发送 /agent 命令验证 agentStorage 已启用
 *    （未注入时返回 "agent storage 未启用"）
 * 3. 动态 systemPrompt：直接测试导出的 buildSessionSystemPrompt 纯函数
 */

interface ServerHandleInternal extends ServerHandle {
  /* 用于在测试中复用句柄 */
}

let serverHandle: ServerHandleInternal | null = null;
let tempDir: string | null = null;
const wsClients: WebSocket[] = [];

async function stopServer() {
  if (serverHandle) {
    await serverHandle.stop();
    serverHandle = null;
  }
  if (tempDir) {
    rmSync(tempDir, { recursive: true, force: true });
    tempDir = null;
  }
  for (const c of wsClients) {
    c.removeAllListeners();
    try {
      c.close();
    } catch {
      // ignore
    }
  }
  wsClients.length = 0;
}

function makeTestConfig(dir: string): string {
  const configPath = join(dir, 'aptbot.json');
  writeFileSync(
    configPath,
    JSON.stringify({
      providers: [
        {
          id: 'test',
          name: 'Test',
          auth: { envVar: 'TEST_API_KEY' },
          models: [
            {
              id: 'test-model',
              api: 'openai-responses',
              contextWindow: 8000,
              maxTokens: 1000,
            },
          ],
        },
      ],
      defaultModel: 'test-model',
      dataDir: dir,
      deploy: 'local',
    }),
  );
  return configPath;
}

function connectWs(port: number): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}`);
    wsClients.push(ws);
    ws.once('open', () => resolve(ws));
    ws.once('error', reject);
    setTimeout(() => reject(new Error('ws connect timeout')), 5000);
  });
}

function waitForMessage(ws: WebSocket, timeoutMs = 3000): Promise<any> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('message timeout')), timeoutMs);
    ws.once('message', (data) => {
      clearTimeout(timer);
      try {
        resolve(JSON.parse(data.toString()));
      } catch (e) {
        reject(e);
      }
    });
  });
}

/**
 * 收集 WS 消息直到收到 turn_end 事件或超时。
 * 跳过 presence / session_initialized 等控制消息，仅关注 event 类型。
 * 返回所有 event 消息（含 envelope 包装层）。
 */
function collectTurnEvents(ws: WebSocket, timeoutMs = 5000): Promise<any[]> {
  return new Promise((resolve) => {
    const collected: any[] = [];
    const handler = (data: Buffer) => {
      try {
        const msg = JSON.parse(data.toString());
        collected.push(msg);
        // 检测 turn_end（事件可能包装在 envelope.event 中）
        const isTurnEnd =
          (msg.type === 'event' && msg.event?.type === 'turn_end') ||
          msg.type === 'turn_end';
        if (isTurnEnd) {
          clearTimeout(timer);
          ws.removeListener('message', handler);
          resolve(collected);
        }
      } catch {
        // ignore parse errors
      }
    };
    const timer = setTimeout(() => {
      ws.removeListener('message', handler);
      resolve(collected);
    }, timeoutMs);
    ws.on('message', handler);
  });
}

/**
 * 从消息列表中提取 message_delta 文本。
 * WS 消息格式：{ type: 'event', event: { type: 'message_delta', text: '...' }, seq }
 */
function extractDeltaText(messages: any[]): string {
  const delta = messages.find(
    (m) => m.type === 'event' && m.event?.type === 'message_delta',
  );
  return delta?.event?.text ?? '';
}

/**
 * Task 17: 启动时调用 migrateLegacySessions
 *
 * 在临时 dataDir 写入一个 legacy session（带 userId），启动 server，
 * 验证迁移发生：
 * - legacy data/sessions/<id>.jsonl 已被移走
 * - 新路径 data/users/<userId>/agents/default/sessions/<id>.jsonl 存在
 */
describe('Task 17: server.ts 启动时调用 migrateLegacySessions', () => {
  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'aptbot-task17-migration-'));
  });

  afterEach(async () => {
    await stopServer();
  });

  it('启动时迁移 legacy session 到新路径（data/users/<userId>/agents/default/sessions/）', async () => {
    const userId = 'a1b2c3d4-e5f6-7890-1234-567890abcdef';
    const sessionId = randomUUID();

    // 写入 legacy session 文件
    const legacySessionsDir = join(tempDir!, 'sessions');
    mkdirSync(legacySessionsDir, { recursive: true });
    const legacyJsonlPath = join(legacySessionsDir, `${sessionId}.jsonl`);
    const legacyMetaPath = join(legacySessionsDir, `${sessionId}.meta.json`);
    writeFileSync(
      legacyJsonlPath,
      JSON.stringify({ type: 'message', id: 'm1', message: { role: 'user', content: 'hi' }, timestamp: Date.now() }) + '\n',
      'utf-8',
    );
    writeFileSync(legacyMetaPath, JSON.stringify({ userId }), 'utf-8');

    process.env.APTBOT_CONFIG = makeTestConfig(tempDir!);
    process.env.TEST_API_KEY = 'test-key';

    const port = 23432 + Math.floor(Math.random() * 1000);
    serverHandle = await startServer({ port, deploy: 'local' });

    // 验证迁移：legacy 文件已移走
    expect(existsSync(legacyJsonlPath)).toBe(false);
    expect(existsSync(legacyMetaPath)).toBe(false);

    // 新路径存在
    const newJsonlPath = join(
      tempDir!,
      'users',
      userId,
      'agents',
      'default',
      'sessions',
      `${sessionId}.jsonl`,
    );
    expect(existsSync(newJsonlPath)).toBe(true);

    // default agent AGENT.md 已创建
    const agentMdPath = join(
      tempDir!,
      'users',
      userId,
      'agents',
      'default',
      'AGENT.md',
    );
    expect(existsSync(agentMdPath)).toBe(true);

    await serverHandle!.stop();
    serverHandle = null;
  });

  it('migrateLegacySessions 不阻塞启动（即使有损坏文件）', async () => {
    const sessionId = randomUUID();
    const legacySessionsDir = join(tempDir!, 'sessions');
    mkdirSync(legacySessionsDir, { recursive: true });
    // 写入损坏 meta（不会让 userId 校验通过）
    writeFileSync(
      join(legacySessionsDir, `${sessionId}.jsonl`),
      '{"type":"message"}\n',
      'utf-8',
    );
    writeFileSync(
      join(legacySessionsDir, `${sessionId}.meta.json`),
      '{not valid json',
      'utf-8',
    );

    process.env.APTBOT_CONFIG = makeTestConfig(tempDir!);
    process.env.TEST_API_KEY = 'test-key';

    const port = 24432 + Math.floor(Math.random() * 1000);
    // 不应抛错（迁移失败降级为 warn，server 正常启动）
    serverHandle = await startServer({ port, deploy: 'local' });
    expect(serverHandle).toBeTruthy();
  });
});

/**
 * Task 17: slashHandler.ctx 注入 agentStorage / currentAgentSlug / memoryAuditLogFactory / skillState
 *
 * 通过 WS 发送 /agent 命令验证：
 * - agentStorage 已注入 → 不返回 "agent storage 未启用"
 * - currentAgentSlug='default' 已注入 → 列表中 default agent 被标记为 (current)
 *
 * 注意：slashHandler.ctx.userId 在每个 turn 动态设置（runInboundLoop 内），
 * 但 wsServer 未发送 userId metadata 时 ctx.userId 保持 undefined，/agent 会
 * 返回 "未设置 userId"。这是 Task 12 的契约。此处仅验证 agentStorage 已注入。
 */
describe('Task 17: slashHandler.ctx 注入 4 个新字段', () => {
  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'aptbot-task17-slash-'));
  });

  afterEach(async () => {
    await stopServer();
  });

  it('agentStorage 已注入 → /agent 不返回 "agent storage 未启用"', async () => {
    process.env.APTBOT_CONFIG = makeTestConfig(tempDir!);
    process.env.TEST_API_KEY = 'test-key';

    const port = 25432 + Math.floor(Math.random() * 1000);
    serverHandle = await startServer({ port, deploy: 'local' });

    const ws = await connectWs(port);
    // 等待 session_initialized / presence 消息消化完
    await new Promise((r) => setTimeout(r, 100));

    // 发送 /agent 命令（无 userId metadata → ctx.userId 未设置）
    ws.send(JSON.stringify({
      type: 'message',
      content: '/agent',
    }));

    const messages = await collectTurnEvents(ws, 5000);
    const output = extractDeltaText(messages);
    // 关键契约：不返回 "agent storage 未启用"（即 agentStorage 已注入）
    expect(output).not.toContain('agent storage 未启用');
  });

  it('agentStorage 已注入 + userId 已设置 → /agent 列出 default agent 并标记 (current)', async () => {
    process.env.APTBOT_CONFIG = makeTestConfig(tempDir!);
    process.env.TEST_API_KEY = 'test-key';

    const port = 26432 + Math.floor(Math.random() * 1000);
    serverHandle = await startServer({ port, deploy: 'local' });

    // 1. 注册用户拿到 userId + token
    const regRes = await fetch(`http://127.0.0.1:${port}/api/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'alice', password: 'password123' }),
    });
    const regBody = await regRes.json();
    const userId: string = regBody.userId;
    const token: string = regBody.token;
    expect(userId).toBeTruthy();
    expect(token).toBeTruthy();

    // 2. 用该 userId 创建 default agent（避免依赖迁移）
    const agentStorage = new AgentStorage(tempDir!);
    await ensureDefaultAgent(userId, agentStorage);

    // 3. 用 token 连接 WS（wsServer 会将 state.userId 设为该用户的 userId）
    const ws = new WebSocket(`ws://127.0.0.1:${port}?token=${encodeURIComponent(token)}`);
    wsClients.push(ws);
    await new Promise<void>((resolve, reject) => {
      ws.once('open', () => resolve());
      ws.once('error', reject);
      setTimeout(() => reject(new Error('ws connect timeout')), 5000);
    });
    await new Promise((r) => setTimeout(r, 100));

    // 4. 发送 /agent 命令
    ws.send(JSON.stringify({
      type: 'message',
      content: '/agent',
    }));

    const messages = await collectTurnEvents(ws, 5000);
    const output = extractDeltaText(messages);
    // 列出了 default agent
    expect(output).toContain('通用助手');
    expect(output).toContain('default');
    // default agent 被标记为 (current)（currentAgentSlug='default' 已注入）
    expect(output).toContain('(current)');
  });
});

/**
 * Task 17: 动态 systemPrompt 构建 — 不同 agent 产出不同 systemPrompt
 *
 * 直接测试导出的 buildSessionSystemPrompt 纯函数：
 * - 输入 agent + memoryContent + skillState → 返回完整 systemPrompt
 * - default agent + null memoryContent → 仅 STABLE_PREFIX（无 ## Agent Memory）
 * - professional agent + 非空 memoryContent → 含 ## Agent Memory + personality
 * - 不同 agent → 不同 systemPrompt
 */
describe('Task 17: buildSessionSystemPrompt 动态构建（纯函数）', () => {
  const defaultAgent: AgentProfile = {
    name: '通用助手',
    description: 'aptbot 通用助手',
    userId: '00000000-0000-0000-0000-000000000000',
    type: 'default',
    slug: 'default',
    createdAt: 0,
    updatedAt: 0,
    personality: '',
  };

  const professionalAgent: AgentProfile = {
    name: 'Travel Planner',
    description: '专业旅行规划助手',
    userId: 'a1b2c3d4-e5f6-7890-1234-567890abcdef',
    type: 'professional',
    slug: 'agent-travel01',
    createdAt: 1700000000000,
    updatedAt: 1700000000000,
    personality: '你是一位资深旅行规划师，擅长定制行程。',
  };

  it('default agent + null memoryContent → 仅 STABLE_PREFIX，不含 ## Agent Memory / ## Personality', () => {
    const prompt = buildSessionSystemPrompt(defaultAgent, null, undefined);
    expect(prompt).toContain('You are aptbot');
    expect(prompt).not.toContain('## Agent Memory');
    expect(prompt).not.toContain('## Personality');
  });

  it('professional agent + 非空 memoryContent → 含 ## Agent Memory + ## Personality', () => {
    const memory = '## User Profile\n\n喜欢咖啡';
    const prompt = buildSessionSystemPrompt(professionalAgent, memory, undefined);
    expect(prompt).toContain('## Agent Memory');
    expect(prompt).toContain('## Personality');
    expect(prompt).toContain(professionalAgent.personality);
    expect(prompt).toContain(memory);
  });

  it('professional agent + null memoryContent → 含 ## Personality 但不含 ## Agent Memory', () => {
    const prompt = buildSessionSystemPrompt(professionalAgent, null, undefined);
    expect(prompt).not.toContain('## Agent Memory');
    expect(prompt).toContain('## Personality');
  });

  it('不同 agent → 不同 systemPrompt', () => {
    const p1 = buildSessionSystemPrompt(defaultAgent, null, undefined);
    const p2 = buildSessionSystemPrompt(professionalAgent, '记忆内容', undefined);
    expect(p1).not.toBe(p2);
  });

  it('不同 memoryContent → 不同 systemPrompt', () => {
    const p1 = buildSessionSystemPrompt(professionalAgent, 'memory v1', undefined);
    const p2 = buildSessionSystemPrompt(professionalAgent, 'memory v2', undefined);
    expect(p1).not.toBe(p2);
  });

  it('skillState 为 undefined → 仅 base，无 skills section', () => {
    const prompt = buildSessionSystemPrompt(defaultAgent, null, undefined);
    // 不应含 skills section（skillState 降级时跳过）
    expect(prompt).not.toMatch(/## Skills/i);
  });

  it('skillState 提供时 → 包含 skills section', () => {
    // 构造最小化的 SkillState mock
    const mockSkillState = {
      skills: [
        {
          name: 'test-skill',
          description: 'A test skill for verification',
          filePath: '/tmp/test-skill.md',
          frontmatter: { name: 'test-skill', description: 'A test skill for verification' },
          content: '# Test Skill\n\nThis is a test skill.',
        },
      ],
      findByFilePath: () => undefined,
      markUsed: () => false,
      reload: async () => {},
    } as unknown as SkillState;

    const prompt = buildSessionSystemPrompt(defaultAgent, null, mockSkillState);
    // 应包含 skills section（格式由 formatSkillsForSystemPrompt 决定）
    expect(prompt).toContain('test-skill');
  });

  it('不同 agent 的 systemPrompt 差异主要在 ## Agent Memory / ## Personality', () => {
    // 同一 memoryContent 下，default 与 professional 的差异仅在注入区域
    const memory = '## User Profile\n\n喜欢咖啡';
    const pDefault = buildSessionSystemPrompt(defaultAgent, memory, undefined);
    const pPro = buildSessionSystemPrompt(professionalAgent, memory, undefined);
    // professional 注入 ## Agent Memory，default 不注入
    expect(pPro).toContain('## Agent Memory');
    expect(pDefault).not.toContain('## Agent Memory');
    // 两者稳定前部相同（STABLE_PREFIX 字节级一致）
    // 通过截取到 "## Agent Memory" 之前的内容来比较稳定前部
    const stableEndPro = pPro.indexOf('\n\n## Agent Memory');
    expect(stableEndPro).toBeGreaterThan(0);
    const stablePrefix = pPro.slice(0, stableEndPro);
    // pDefault 不含 ## Agent Memory，但应包含完整 STABLE_PREFIX
    expect(pDefault).toContain(stablePrefix);
  });
});
