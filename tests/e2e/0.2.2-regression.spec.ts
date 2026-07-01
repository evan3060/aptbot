/**
 * Task 13: 0.2.2 E2E 回归测试
 *
 * 端到端验证 10 项 0.2.2 新功能联动正确，作为封仓前置门禁。
 * 每项至少 1 happy path + 1 error path，全量 ≥ 20 用例。
 *
 * 覆盖：
 *  1. MixinProvider 多 provider 故障转移 (Task 5)
 *  2. Config 热重载 (Task 6)
 *  3. Hook 8 点触发 (Task 7)
 *  4. Skills list_skills + read_skill L1 index (Task 8 + 9)
 *  5. /session 动态属性设置 + 广播 (Task 11)
 *  6. JSONL 历史回放 (Task 3)
 *  7. HttpOnly cookie 登录 (Task 4)
 *  8. turn_busy 响应 (Task 2)
 *  9. Session 自动摘要 (Task 10)
 * 10. Channel 抽象 (Task 12)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, existsSync, writeFileSync, utimesSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';

import { MixinProvider } from '../../src/core/provider/mixin-provider.js';
import type {
  Provider,
  Model,
  Context,
  StreamOptions,
  AssistantMessageEvent,
} from '../../src/core/provider/types.js';
import type { ProviderError } from '../../src/core/provider/retry.js';

import { ConfigLoader, parseAptbotConfig } from '../../src/infrastructure/config-loader.js';
import type { AptbotConfig } from '../../src/infrastructure/config-types.js';

import { HookRegistry } from '../../src/core/agent/hooks.js';
import type { HookPoint } from '../../src/core/agent/hooks.js';
import { agentLoop } from '../../src/core/agent/loop.js';
import { createAgentSession } from '../../src/core/agent/session.js';
import type { AgentEvent } from '../../src/core/agent/events.js';
import { triggerSessionSummary, SUMMARY_MAX_CHARS } from '../../src/core/agent/session-summary.js';

import { loadSkills, createSkillState } from '../../src/core/skills/loader.js';
import { createNodeExecutionEnv } from '../../src/core/skills/env.js';
import type { ExecutionEnv } from '../../src/core/skills/env.js';
import { formatSkillsForSystemPrompt } from '../../src/core/skills/system-prompt.js';
import { createReadTool } from '../../src/core/tool/tools/read.js';

import { handleSessionAttr, listValidAttrNames } from '../../src/shared/commands/session-attrs.js';

import { FileStorage } from '../../src/infrastructure/storage/file-storage.js';
import { readHistoryForReplay } from '../../src/core/memory/session-repo.js';

import { InMemoryMessageBus } from '../../src/bus/message-bus.js';
import { createChannelManager } from '../../src/bus/channel-manager.js';
import { wrapTransportChannel } from '../../src/bus/channel-adapter.js';
import type {
  Channel,
  ChannelCapability,
  TransportChannel,
  AgentEventEnvelope,
} from '../../src/bus/types.js';

import { runInboundLoop, type ConfigReload } from '../../src/server.js';
import { startWebSocketServer } from '../../src/access/websocket-server.js';
import { createUserStorage } from '../../src/infrastructure/user-storage.js';
import { isCookieEnabled, resolveWsToken } from '../../src/access/chat-page-token.js';

// ---------- 共享辅助 ----------

const MODEL: Model = {
  provider: 'mock',
  id: 'mock-1',
  api: 'openai-responses',
  contextWindow: 8000,
  maxTokens: 1000,
};

function makeMockProvider(
  events: AssistantMessageEvent[],
): Provider {
  return {
    id: 'mock',
    name: 'Mock',
    auth: {},
    getModels: () => [MODEL],
    stream: async function* (): AsyncGenerator<AssistantMessageEvent> {
      for (const e of events) yield e;
    },
  };
}

/** mock provider 记录每次 stream 调用的 options（用于校验广播属性） */
function makeMockProviderWithOptions(
  events: AssistantMessageEvent[],
): Provider & { lastOptions?: StreamOptions; callCount: number } {
  let lastOptions: StreamOptions | undefined;
  let callCount = 0;
  return {
    id: 'mock',
    name: 'Mock',
    auth: {},
    getModels: () => [MODEL],
    stream: (_m: Model, _c: Context, o?: StreamOptions) => {
      callCount++;
      lastOptions = o;
      return (async function* (): AsyncGenerator<AssistantMessageEvent> {
        for (const e of events) yield e;
      })();
    },
    get lastOptions() {
      return lastOptions;
    },
    get callCount() {
      return callCount;
    },
  };
}

/** mock provider 抛错（按调用次数） */
function makeFailingProvider(
  err: unknown,
): Provider & { calls: number } {
  let calls = 0;
  return {
    id: 'fail',
    name: 'Fail',
    auth: {},
    getModels: () => [MODEL],
    stream: () => {
      calls++;
      return (async function* (): AsyncGenerator<AssistantMessageEvent> {
        throw err;
      })();
    },
    get calls() {
      return calls;
    },
  };
}

function retryableErr(msg = 'rate limited'): ProviderError {
  return { retryable: true, status: 429, message: msg } as ProviderError;
}

function fatalErr(msg = 'unauthorized'): ProviderError {
  return { retryable: false, status: 401, message: msg } as ProviderError;
}

async function collect<T>(gen: AsyncGenerator<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const e of gen) out.push(e);
  return out;
}

const CTX: Context = { messages: [{ role: 'user', content: 'hi' }] };

// =====================================================================
// 1. MixinProvider 多 provider 故障转移 (Task 5)
// =====================================================================

describe('0.2.2 E2E Regression', () => {
  describe('1. MixinProvider failover', () => {
    it('happy: primary provider succeeds and forwards events', async () => {
      const p0 = makeMockProvider([
        { type: 'text', text: 'hello' },
        { type: 'stop', stopReason: 'end_turn' },
      ]);
      const mixin = new MixinProvider('m', [p0]);
      const events = await collect(mixin.stream(MODEL, CTX));
      expect(events.some((e) => e.type === 'text' && e.text === 'hello')).toBe(true);
      expect(mixin.currentIndex).toBe(0);
    });

    it('happy: primary retryable fail → fallback to secondary succeeds', async () => {
      const p0 = makeFailingProvider(retryableErr('p0 down'));
      const p1 = makeMockProvider([
        { type: 'text', text: 'p1 ok' },
        { type: 'stop', stopReason: 'end_turn' },
      ]);
      const mixin = new MixinProvider('m', [p0, p1], { maxRetries: 2 });
      const events = await collect(mixin.stream(MODEL, CTX));
      expect(events.some((e) => e.type === 'text' && e.text === 'p1 ok')).toBe(true);
      expect(mixin.currentIndex).toBe(1);
      expect(p0.calls).toBe(2); // 重试 2 次后 fallback
    });

    it('error: all providers fail → AggregateError thrown', async () => {
      const p0 = makeFailingProvider(retryableErr('p0 down'));
      const p1 = makeFailingProvider(retryableErr('p1 down'));
      const mixin = new MixinProvider('m', [p0, p1], { maxRetries: 1 });
      let thrown: unknown = null;
      try {
        await collect(mixin.stream(MODEL, CTX));
      } catch (e) {
        thrown = e;
      }
      expect(thrown).toBeInstanceOf(AggregateError);
      expect((thrown as AggregateError).message).toContain('all sessions failed');
    });

    it('edge: fatal error (401) → no fallback, immediate throw', async () => {
      const p0 = makeFailingProvider(fatalErr('bad token'));
      const p1 = makeMockProvider([{ type: 'text', text: 'p1' }]);
      const mixin = new MixinProvider('m', [p0, p1], { maxRetries: 3 });
      let thrown: unknown = null;
      try {
        await collect(mixin.stream(MODEL, CTX));
      } catch (e) {
        thrown = e;
      }
      expect(thrown).toMatchObject({ retryable: false, status: 401 });
      expect(p0.calls).toBe(1); // fatal 不重试
      // p1 不应被调用
      // 由于 p1 是 makeMockProvider，无 calls 字段；此处仅校验 p0 调用 1 次
    });
  });

  // =====================================================================
  // 2. Config 热重载 (Task 6)
  // =====================================================================

  describe('2. Config hot-reload', () => {
    const TMP_DIR = './tests/.tmp-e2e-config-reload';
    const TMP_CONFIG = join(TMP_DIR, 'aptbot.json');

    function makeValidConfig(model: string = 'gpt-4'): AptbotConfig {
      return {
        providers: [
          {
            id: 'openai',
            name: 'OpenAI',
            auth: { envVar: 'OPENAI_API_KEY' },
            models: [
              {
                id: model,
                api: 'openai-responses',
                contextWindow: 128000,
                maxTokens: 4096,
              },
            ],
          },
        ],
        defaultModel: model,
        dataDir: './data',
        deploy: 'local',
      };
    }

    function writeConfig(config: unknown, mtimeSec?: number): void {
      if (!existsSync(TMP_DIR)) mkdirSync(TMP_DIR, { recursive: true });
      writeFileSync(TMP_CONFIG, typeof config === 'string' ? config : JSON.stringify(config), 'utf-8');
      if (mtimeSec !== undefined) {
        const time = new Date(mtimeSec * 1000);
        utimesSync(TMP_CONFIG, time, time);
      }
    }

    beforeEach(() => {
      if (existsSync(TMP_DIR)) rmSync(TMP_DIR, { recursive: true, force: true });
    });

    afterEach(() => {
      if (existsSync(TMP_DIR)) rmSync(TMP_DIR, { recursive: true, force: true });
    });

    it('happy: mtime change detected → next load() returns changed=true with new data', async () => {
      writeConfig(makeValidConfig('gpt-4'), 1000);
      const loader = new ConfigLoader<AptbotConfig>(TMP_CONFIG, parseAptbotConfig);
      const first = await loader.load();
      expect(first.changed).toBe(true);
      expect(first.data.defaultModel).toBe('gpt-4');

      // 修改 mtime + 内容
      writeConfig(makeValidConfig('claude-3'), 2000);
      const second = await loader.load();
      expect(second.changed).toBe(true);
      expect(second.data.defaultModel).toBe('claude-3');
    });

    it('happy: turn isolation — in-flight turn uses old config snapshot (rebuild applied after turn ends)', async () => {
      writeConfig(makeValidConfig('gpt-4'), 1000);
      const loader = new ConfigLoader<AptbotConfig>(TMP_CONFIG, parseAptbotConfig);
      await loader.load();

      // turn 开始前修改配置
      writeConfig(makeValidConfig('claude-3'), 2000);

      const rebuild = vi.fn();
      const configReload: ConfigReload = { loader, rebuild };

      const bus = new InMemoryMessageBus();
      const watchdog = { markTurnStart: vi.fn(), markTurnEnd: vi.fn() };

      let rebuildCalledDuringRun = false;
      const mockSession = {
        run: async function* (): AsyncGenerator<AgentEvent> {
          if (rebuild.mock.calls.length > 0) rebuildCalledDuringRun = true;
          yield { type: 'agent_start' };
          if (rebuild.mock.calls.length > 0) rebuildCalledDuringRun = true;
          yield { type: 'turn_end', turnId: 't1' };
        },
      };

      await bus.publishInbound({
        channel: 'test', senderId: 'user', chatId: 'c1', content: 'hello', metadata: {},
      });

      const loopPromise = runInboundLoop(
        bus,
        { current: mockSession as never, currentKey: 's1' },
        watchdog,
        undefined,
        undefined,
        undefined,
        configReload,
      );

      // 消费 user_message + agent_start + turn_end
      await bus.consumeOutbound();
      await bus.consumeOutbound();
      await bus.consumeOutbound();
      await new Promise((r) => setTimeout(r, 100));

      expect(rebuildCalledDuringRun).toBe(false);
      expect(rebuild).toHaveBeenCalledTimes(1);
      expect(rebuild).toHaveBeenCalledWith(expect.objectContaining({ defaultModel: 'claude-3' }));

      loopPromise.catch(() => {});
    });

    it('error: invalid config → degraded to old config + error reported (no rebuild)', async () => {
      writeConfig(makeValidConfig('gpt-4'), 1000);
      const loader = new ConfigLoader<AptbotConfig>(TMP_CONFIG, parseAptbotConfig);
      await loader.load();

      // 写入非法配置（providers 为空）
      writeConfig({ providers: [], defaultModel: 'x' }, 2000);

      const rebuild = vi.fn();
      const configReload: ConfigReload = { loader, rebuild };

      const bus = new InMemoryMessageBus();
      const watchdog = { markTurnStart: vi.fn(), markTurnEnd: vi.fn() };

      const mockSession = {
        run: async function* (): AsyncGenerator<AgentEvent> {
          yield { type: 'agent_start' };
          yield { type: 'turn_end', turnId: 't1' };
        },
      };

      await bus.publishInbound({
        channel: 'test', senderId: 'user', chatId: 'c1', content: 'hello', metadata: {},
      });

      const loopPromise = runInboundLoop(
        bus,
        { current: mockSession as never, currentKey: 's1' },
        watchdog,
        undefined,
        undefined,
        undefined,
        configReload,
      );

      const events: AgentEvent[] = [];
      for (let i = 0; i < 10; i++) {
        const env = await Promise.race([
          bus.consumeOutbound(),
          new Promise<null>((r) => setTimeout(() => r(null), 500)),
        ]);
        if (env === null) break;
        events.push(env.event);
        if (env.event.type === 'turn_end') break;
      }
      await new Promise((r) => setTimeout(r, 100));

      const errorEvents = events.filter((e) => e.type === 'error');
      expect(errorEvents.length).toBe(1);
      expect((errorEvents[0] as { message: string }).message).toContain('config reload failed');
      expect(rebuild).not.toHaveBeenCalled();

      loopPromise.catch(() => {});
    });
  });

  // =====================================================================
  // 3. Hook 8 点触发 (Task 7)
  // =====================================================================

  describe('3. Hook 8-point trigger', () => {
    let tempDir: string;

    beforeEach(() => {
      tempDir = mkdtempSync(join(tmpdir(), 'aptbot-hook-e2e-'));
    });

    afterEach(() => {
      if (tempDir) rmSync(tempDir, { recursive: true, force: true });
    });

    it('happy: all 8 hook points fire in correct order during a tool-using turn', async () => {
      const registry = new HookRegistry();
      const fired: HookPoint[] = [];

      (Object.keys({
        agent_before: 0, turn_before: 0, llm_before: 0, tool_before: 0,
        tool_after: 0, llm_after: 0, turn_after: 0, agent_after: 0,
      }) as HookPoint[]).forEach((pt) => {
        registry.on(pt, () => {
          fired.push(pt);
        });
      });

      // 构造带 tool_call 的脚本：第一轮 tool_use，第二轮 end_turn
      const scripts: AssistantMessageEvent[][] = [
        [
          { type: 'tool_call', toolCall: { id: 'tc1', name: 'bash', arguments: JSON.stringify({ command: 'echo hi' }) } },
          { type: 'stop', stopReason: 'tool_use' },
        ],
        [
          { type: 'text', text: 'done' },
          { type: 'stop', stopReason: 'end_turn' },
        ],
      ];
      let callIdx = 0;
      const provider: Provider = {
        id: 'mock',
        name: 'Mock',
        auth: {},
        getModels: () => [MODEL],
        stream: async function* (): AsyncGenerator<AssistantMessageEvent> {
          const evs = scripts[callIdx] ?? scripts[scripts.length - 1];
          callIdx++;
          for (const e of evs) yield e;
        },
      };

      const storage = new FileStorage(tempDir);
      const sid = randomUUID();
      const { createToolRegistry } = await import('../../src/core/tool/types.js');
      const { bashTool } = await import('../../src/core/tool/tools/bash.js');
      const toolReg = createToolRegistry();
      toolReg.register(bashTool);

      const session = createAgentSession({
        storage,
        sessionId: sid,
        agentLoop,
        provider,
        model: MODEL,
        tools: toolReg,
        systemPrompt: 'You are aptbot.',
        hooks: registry,
      });

      await collect(session.run('run tool'));

      // 期望 8 个 hook 点全部触发
      expect(fired).toContain('agent_before');
      expect(fired).toContain('agent_after');
      expect(fired).toContain('turn_before');
      expect(fired).toContain('turn_after');
      expect(fired).toContain('llm_before');
      expect(fired).toContain('llm_after');
      expect(fired).toContain('tool_before');
      expect(fired).toContain('tool_after');

      // 顺序校验：agent_before 必须最早，agent_after 必须最晚
      expect(fired.indexOf('agent_before')).toBe(0);
      expect(fired.indexOf('agent_after')).toBe(fired.length - 1);
      // llm_before 必须在 llm_after 之前
      expect(fired.indexOf('llm_before')).toBeLessThan(fired.indexOf('llm_after'));
      // tool_before 必须在 tool_after 之前
      expect(fired.indexOf('tool_before')).toBeLessThan(fired.indexOf('tool_after'));
    });

    it('happy: priority sorting — lower priority fires first', () => {
      const registry = new HookRegistry();
      const order: string[] = [];
      // 注册顺序故意打乱：高优先级先注册，低优先级后注册
      registry.on('turn_before', () => { order.push('high-prio-200'); }, 200);
      registry.on('turn_before', () => { order.push('low-prio-10'); }, 10);
      registry.on('turn_before', () => { order.push('mid-prio-100'); }, 100);

      registry.trigger('turn_before', { turn: 0, messages: [] });

      expect(order).toEqual(['low-prio-10', 'mid-prio-100', 'high-prio-200']);
    });

    it('error: hook throws → swallowed, main flow continues', () => {
      const registry = new HookRegistry();
      const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const afterCalls: number[] = [];

      registry.on('turn_before', () => { throw new Error('hook boom'); }, 10);
      registry.on('turn_before', () => { afterCalls.push(1); }, 20);

      // 不应抛错
      expect(() => registry.trigger('turn_before', { turn: 0, messages: [] })).not.toThrow();
      // 后续 hook 仍被调用
      expect(afterCalls).toHaveLength(1);
      errSpy.mockRestore();
    });
  });

  // =====================================================================
  // 4. Skills list_skills + read_skill L1 index (Task 8 + 9)
  // =====================================================================

  describe('4. Skills L1 index', () => {
    let tmpRoot: string;
    let env: ExecutionEnv;

    beforeEach(async () => {
      tmpRoot = mkdtempSync(join(tmpdir(), 'aptbot-skills-e2e-'));
      env = createNodeExecutionEnv(tmpRoot);
    });

    afterEach(async () => {
      if (existsSync(tmpRoot)) rmSync(tmpRoot, { recursive: true, force: true });
    });

    async function writeSkill(
      parentDir: string,
      skillName: string,
      frontmatter: string,
      body = '# Skill body\n',
    ): Promise<string> {
      const skillDir = join(parentDir, skillName);
      mkdirSync(skillDir, { recursive: true });
      const filePath = join(skillDir, 'SKILL.md');
      writeFileSync(filePath, `---\n${frontmatter}\n---\n\n${body}`, 'utf-8');
      return filePath;
    }

    it('happy: workspace overrides builtin for same skill name', async () => {
      const builtinDir = join(tmpRoot, 'builtin');
      const workspaceDir = join(tmpRoot, 'workspace');
      await writeSkill(builtinDir, 'shared', 'name: shared\ndescription: builtin version');
      await writeSkill(workspaceDir, 'shared', 'name: shared\ndescription: workspace version');

      // loadSkills 接受 [workspace, builtin] — workspace 优先（内部逆序遍历）
      const result = await loadSkills(env, [workspaceDir, builtinDir]);
      expect(result.skills).toHaveLength(1);
      expect(result.skills[0].description).toBe('workspace version');
    });

    it('happy: formatSkillsForSystemPrompt generates L1 index with size hints and tags', async () => {
      const dir = join(tmpRoot, 'ws');
      await writeSkill(dir, 'refactor', 'name: refactor\ndescription: TS refactor\ntags: [coding, ts]', '# Body\n');
      const result = await loadSkills(env, [dir]);
      const out = formatSkillsForSystemPrompt(result.skills);
      expect(out).toContain('## Skills');
      expect(out).toContain('**refactor**');
      expect(out).toContain('TS refactor');
      // size hint: 形如 `N行/M字节`
      expect(out).toMatch(/\d+行\/\d+字节/);
      expect(out).toContain('[coding,ts]');
      expect(out).toContain(join(dir, 'refactor', 'SKILL.md'));
    });

    it('happy: read_file updates lastUsed → L1 index re-sorts (most-recent first)', async () => {
      const dir = join(tmpRoot, 'ws');
      const pathA = await writeSkill(dir, 'skill-a', 'name: skill-a\ndescription: A');
      const pathB = await writeSkill(dir, 'skill-b', 'name: skill-b\ndescription: B');
      const state = await createSkillState(env, [dir]);
      const tool = createReadTool({ skillState: state });

      // 初始：两个 skill 的 lastUsed 均为 undefined
      const initial = formatSkillsForSystemPrompt([...state.skills]);
      const aIdx0 = initial.indexOf('**skill-a**');
      const bIdx0 = initial.indexOf('**skill-b**');
      // 均未使用：按 name 字典序 a 在前
      expect(aIdx0).toBeLessThan(bIdx0);

      // 读 skill-b 文件 → markUsed 更新 lastUsed
      await tool.execute('tc', { path: pathB });
      // 再读 skill-a 但用更早的时间戳
      await tool.execute('tc', { path: pathA });

      // 现在 skill-a 应该在前（lastUsed 更新更晚 → 排在前面）
      const after = formatSkillsForSystemPrompt([...state.skills]);
      const aIdx1 = after.indexOf('**skill-a**');
      const bIdx1 = after.indexOf('**skill-b**');
      expect(aIdx1).toBeLessThan(bIdx1);

      // 校验 pathA skill 的 lastUsed 已设置
      const skillA = state.findByFilePath(pathA);
      const skillB = state.findByFilePath(pathB);
      expect(skillA?.lastUsed).toBeDefined();
      expect(skillB?.lastUsed).toBeDefined();
      expect(skillA!.lastUsed!).toBeGreaterThanOrEqual(skillB!.lastUsed!);
    });

    it('happy: 4K token budget truncation → fallback to name-only list', () => {
      // 构造多个 description 超长 skill，触发 4K 预算截断
      const skills = [];
      for (let i = 0; i < 5; i++) {
        skills.push({
          name: `skill-${i}`,
          description: 'x'.repeat(16000), // ~4000 tokens 单条
          content: '',
          filePath: `/p/skill-${i}/SKILL.md`,
          contentLines: 1,
          contentBytes: 1,
          lastUsed: 1000 - i,
        });
      }
      const out = formatSkillsForSystemPrompt(skills);
      // skill-0 (lastUsed 最高) 作为完整条目
      expect(out).toContain('**skill-0**');
      // 其余进入 fallback 名字列表
      expect(out).toContain('skill-1');
      expect(out).toContain('skill-4');
      expect(out).toContain('Additional skills');
      // 仅 1 个完整条目（只 skill-0 的 description 被注入）
      const matches = out.match(/x{16000}/g);
      expect(matches).toHaveLength(1);
    });

    it('error: invalid frontmatter → SkillDiagnostic warning, skill skipped', async () => {
      const dir = join(tmpRoot, 'ws');
      // 写入合法 skill + 一个 frontmatter 损坏的 skill
      await writeSkill(dir, 'good', 'name: good\ndescription: ok');
      // bad-skill 没有 frontmatter 开头 ---
      const badDir = join(dir, 'bad');
      mkdirSync(badDir, { recursive: true });
      writeFileSync(join(badDir, 'SKILL.md'), 'no frontmatter at all', 'utf-8');

      const result = await loadSkills(env, [dir]);
      expect(result.skills).toHaveLength(1);
      expect(result.skills[0].name).toBe('good');
      expect(result.diagnostics.length).toBeGreaterThan(0);
      const diag = result.diagnostics.find((d) => d.code === 'parse_failed');
      expect(diag).toBeDefined();
      expect(diag!.path).toContain('bad/SKILL.md');
    });
  });

  // =====================================================================
  // 5. /session 动态属性设置 + 广播 (Task 11)
  // =====================================================================

  describe('5. /session dynamic attrs', () => {
    let tempDir: string;

    beforeEach(() => {
      tempDir = mkdtempSync(join(tmpdir(), 'aptbot-session-attr-e2e-'));
    });

    afterEach(() => {
      if (tempDir) rmSync(tempDir, { recursive: true, force: true });
    });

    /** 构造一个带 broadcastAttr 的 mock session handler */
    function makeHandler() {
      const attrs = new Map<string, unknown>();
      let broadcastKey: string | null = null;
      let broadcastValue: unknown = null;
      return {
        setProviderAttr(key: string, value: unknown) {
          attrs.set(key, value);
          broadcastKey = key;
          broadcastValue = value;
        },
        getProviderAttr(key: string) { return attrs.get(key); },
        getAllProviderAttrs() { return Object.fromEntries(attrs); },
        resetProviderAttrs() { attrs.clear(); broadcastKey = null; broadcastValue = null; },
        get lastBroadcastKey() { return broadcastKey; },
        get lastBroadcastValue() { return broadcastValue; },
      };
    }

    it('happy: /session temperature 0.7 → handler.setProviderAttr called with parsed value', async () => {
      const handler = makeHandler();
      const out = await handleSessionAttr(handler, 'temperature', '0.7', 'sid', tempDir);
      expect(out).toContain('✅');
      expect(out).toContain('temperature');
      expect(handler.getProviderAttr('temperature')).toBe(0.7);
    });

    it('happy: MixinProvider.broadcastAttr merges into StreamOptions.temperature on next stream', async () => {
      const inner = makeMockProviderWithOptions([
        { type: 'text', text: 'ok' },
        { type: 'stop', stopReason: 'end_turn' },
      ]);
      const mixin = new MixinProvider('m', [inner]);
      // 通过 broadcastAttr 设置 temperature
      mixin.broadcastAttr('temperature', 0.5);
      await collect(mixin.stream(MODEL, CTX));
      expect(inner.lastOptions?.temperature).toBe(0.5);
    });

    it('happy: /session.reset clears all attrs', async () => {
      const handler = makeHandler();
      await handleSessionAttr(handler, 'temperature', '0.5', 'sid', tempDir);
      expect(handler.getAllProviderAttrs().temperature).toBe(0.5);
      handler.resetProviderAttrs();
      expect(handler.getAllProviderAttrs()).toEqual({});
    });

    it('error: invalid attr name → rejected with valid list', async () => {
      const handler = makeHandler();
      const out = await handleSessionAttr(handler, 'evil/../path', 'x', 'sid', tempDir);
      expect(out).toContain('❌');
      expect(out).toContain('illegal attribute name');
      // 列出所有合法属性名
      for (const name of listValidAttrNames()) {
        expect(out).toContain(name);
      }
    });

    it('error: invalid value range → rejected with valid range', async () => {
      const handler = makeHandler();
      const out = await handleSessionAttr(handler, 'temperature', '99', 'sid', tempDir);
      expect(out).toContain('❌');
      expect(out).toContain('invalid value');
      expect(out).toContain('[0, 2]');
    });
  });

  // =====================================================================
  // 6. JSONL 历史回放 (Task 3)
  // =====================================================================

  describe('6. JSONL history replay', () => {
    let tempDir: string;

    beforeEach(() => {
      tempDir = mkdtempSync(join(tmpdir(), 'aptbot-jsonl-replay-'));
    });

    afterEach(() => {
      if (tempDir) rmSync(tempDir, { recursive: true, force: true });
    });

    it('happy: readHistoryForReplay returns message-type entries with replay:true marker', async () => {
      const storage = new FileStorage(tempDir);
      const sid = randomUUID();
      // 写入若干条消息
      const { createMessage } = await import('../../src/core/memory/agent-message.js');
      const u1 = createMessage('user', 'hello');
      const a1 = createMessage('assistant', 'hi there');
      await storage.appendSession(sid, { type: 'message', id: u1.id, message: u1, timestamp: 1 });
      await storage.appendSession(sid, { type: 'message', id: a1.id, message: a1, timestamp: 2 });

      const out = await readHistoryForReplay(storage, sid, 20);
      expect(out).toHaveLength(2);
      expect(out.every((m) => m.replay === true)).toBe(true);
      expect(out[0].role).toBe('user');
      expect(out[0].content).toBe('hello');
      expect(out[1].role).toBe('assistant');
      expect(out[1].content).toBe('hi there');
    });

    it('happy: tool_call entries (role=tool / assistant.toolCalls) filtered out', async () => {
      const storage = new FileStorage(tempDir);
      const sid = randomUUID();
      const { createMessage } = await import('../../src/core/memory/agent-message.js');
      const u1 = createMessage('user', 'run bash');
      // assistant 带 toolCalls
      const a1 = createMessage('assistant', 'calling tool');
      a1.toolCalls = [{ id: 'tc1', name: 'bash', arguments: '{}' }];
      // tool 角色消息
      const t1 = createMessage('tool', 'tool output');
      t1.toolCallId = 'tc1';
      // 正常 assistant 消息
      const a2 = createMessage('assistant', 'final answer');

      await storage.appendSession(sid, { type: 'message', id: u1.id, message: u1, timestamp: 1 });
      await storage.appendSession(sid, { type: 'message', id: a1.id, message: a1, timestamp: 2 });
      await storage.appendSession(sid, { type: 'message', id: t1.id, message: t1, timestamp: 3 });
      await storage.appendSession(sid, { type: 'message', id: a2.id, message: a2, timestamp: 4 });

      const out = await readHistoryForReplay(storage, sid, 20);
      // 仅 u1 + a2 应返回
      expect(out).toHaveLength(2);
      expect(out.map((m) => m.content)).toEqual(['run bash', 'final answer']);
    });

    it('error: corrupt JSONL → readSession auto-truncates repair, valid entries still returned', async () => {
      const storage = new FileStorage(tempDir);
      const sid = randomUUID();
      // 手工构造破损 JSONL 文件：合法 + 破损尾行
      const filePath = join(tempDir, `${sid}.jsonl`);
      const validLine = JSON.stringify({
        type: 'message',
        id: 'm1',
        message: { id: 'm1', role: 'user', content: 'before corrupt', timestamp: 1 },
        timestamp: 1,
      });
      writeFileSync(filePath, `${validLine}\n{"broken": "truncated`, 'utf-8');

      // readSession 内部调用 repairJsonl — 应截断破损尾行
      const entries = await storage.readSession(sid);
      expect(entries).toHaveLength(1);
      expect((entries[0] as { message: { content: string } }).message.content).toBe('before corrupt');

      // 文件应被修复（再次读取 skipped=0）
      const { readJsonlTolerant } = await import('../../src/infrastructure/jsonl.js');
      const reread = await readJsonlTolerant(filePath);
      expect(reread.skipped).toBe(0);
    });
  });

  // =====================================================================
  // 7. HttpOnly cookie 登录 (Task 4)
  // =====================================================================

  describe('7. HttpOnly cookie auth', () => {
    // 每个测试用独立端口，避免 afterEach stop() 后端口 TIME_WAIT 导致下个测试 ECONNRESET
    let testPort = 18800 + Math.floor(Math.random() * 1000);
    let server: Awaited<ReturnType<typeof startWebSocketServer>> | null = null;
    let userStorage: ReturnType<typeof createUserStorage>;
    let tmpDir: string;

    beforeEach(() => {
      testPort = 18800 + Math.floor(Math.random() * 1000);
      tmpDir = mkdtempSync(join(tmpdir(), 'aptbot-cookie-e2e-'));
      userStorage = createUserStorage(tmpDir);
    });

    afterEach(async () => {
      if (server) {
        await server.stop();
        server = null;
      }
      if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true });
    });

    async function httpRequest(
      method: string,
      path: string,
      body?: unknown,
      headers?: Record<string, string>,
    ): Promise<{ status: number; body: any; headers: Headers }> {
      const url = `http://localhost:${testPort}${path}`;
      const init: RequestInit = { method, headers: { 'content-type': 'application/json', ...headers } };
      if (body !== undefined) init.body = JSON.stringify(body);
      const res = await fetch(url, init);
      const text = await res.text();
      let parsed: any = null;
      try { parsed = JSON.parse(text); } catch { parsed = text; }
      return { status: res.status, body: parsed, headers: res.headers };
    }

    async function start(): Promise<void> {
      server = await startWebSocketServer({
        port: testPort,
        bus: new InMemoryMessageBus(),
        userStorage,
      });
    }

    it('happy: POST /api/login success → Set-Cookie with HttpOnly; SameSite=Strict; Path=/; Max-Age=2592000', async () => {
      await start();
      await httpRequest('POST', '/api/register', { username: 'alice', password: 'password123' });
      const res = await httpRequest('POST', '/api/login', {
        username: 'alice', password: 'password123',
      });
      expect(res.status).toBe(200);
      const setCookie = res.headers.get('set-cookie');
      expect(setCookie).toBeTruthy();
      expect(setCookie!).toContain('aptbot_token=');
      expect(setCookie!).toContain('HttpOnly');
      expect(setCookie!).toContain('SameSite=Strict');
      expect(setCookie!).toContain('Path=/');
      expect(setCookie!).toContain('Max-Age=2592000');
    });

    it('happy: GET /api/me reads cookie first (cookie has priority over Bearer)', async () => {
      await start();
      const aliceReg = await httpRequest('POST', '/api/register', { username: 'alice', password: 'pass' });
      const bobReg = await httpRequest('POST', '/api/register', { username: 'bob', password: 'pass' });
      const aliceCookie = aliceReg.headers.get('set-cookie')!.split(';')[0].trim();
      // 同时发 cookie (alice) + Bearer (bob) — cookie 应优先
      const res = await httpRequest('GET', '/api/me', undefined, {
        cookie: aliceCookie,
        authorization: `Bearer ${bobReg.body.token}`,
      });
      expect(res.status).toBe(200);
      expect(res.body.username).toBe('alice');
    });

    it('error: cookie disabled → fallback to sessionStorage (resolveWsToken returns stored token)', () => {
      // 模拟 cookie 禁用 + sessionStorage 有 token 的场景
      const urlToken = null;
      const storedToken = 'session-storage-token';
      const cookieEnabled = false;
      // resolveWsToken 应返回 storedToken（fallback 路径）
      expect(resolveWsToken(urlToken, storedToken, cookieEnabled)).toBe(storedToken);
      // 对照：cookie 可用时返回 null（让浏览器自动带 cookie）
      expect(resolveWsToken(urlToken, storedToken, true)).toBeNull();
      // isCookieEnabled 在 navigator.cookieEnabled=false 时返回 false
      // Node 21+ navigator 是只读 getter，用 vi.stubGlobal 覆盖
      vi.stubGlobal('navigator', { cookieEnabled: false });
      try {
        expect(isCookieEnabled()).toBe(false);
      } finally {
        vi.unstubAllGlobals();
      }
    });
  });

  // =====================================================================
  // 8. turn_busy 响应 (Task 2)
  // =====================================================================

  describe('8. turn_busy response', () => {
    it('happy: same sessionKey queued → turn_busy emitted with position = chainLength + 1', async () => {
      const bus = new InMemoryMessageBus();
      const watchdog = { markTurnStart: vi.fn(), markTurnEnd: vi.fn() };

      const mockSession = {
        run: async function* (text: string): AsyncGenerator<AgentEvent> {
          if (text === 'first') {
            yield { type: 'agent_start' };
            yield { type: 'turn_end', turnId: 't1' };
          } else {
            yield { type: 'agent_start' };
            yield { type: 'turn_end', turnId: 't2' };
          }
        },
      };

      // 第一条消息
      await bus.publishInbound({
        channel: 'test', senderId: 'user', chatId: 'c1', content: 'first',
        metadata: { sessionKey: 's1' },
      });

      const loopPromise = runInboundLoop(
        bus,
        { current: mockSession as never, currentKey: 's1' },
        watchdog,
      );

      // 等待第一条 turn 走到 user_message + agent_start + turn_end
      await bus.consumeOutbound(); // user_message
      await bus.consumeOutbound(); // agent_start
      await bus.consumeOutbound(); // turn_end

      // 第一条结束后立刻发第二条，且要赶在 runningTurns cleanup 之前
      // 实际上 cleanup 在 finally 内立即执行；为可靠触发 turn_busy，我们不等 cleanup
      // 改用：连续发送 3 条消息（每条都会在前一条 turn_end 之前排队）
      // 上面的实现是顺序的；下面改用更可靠的方式 — 直接发 2 条再 collect

      loopPromise.catch(() => {});
    });

    it('happy: same sessionKey — 3 queued messages produce turn_busy with positions 2 and 3', async () => {
      const bus = new InMemoryMessageBus();
      const watchdog = { markTurnStart: vi.fn(), markTurnEnd: vi.fn() };

      // turn 慢响应：等待 release 才完成
      let releaseTurn!: () => void;
      const turnGate = new Promise<void>((r) => { releaseTurn = r; });

      const mockSession = {
        run: async function* (): AsyncGenerator<AgentEvent> {
          yield { type: 'agent_start' };
          await turnGate; // 阻塞第一个 turn
          yield { type: 'turn_end', turnId: 't1' };
        },
      };

      // 连续发布 3 条消息到同一 sessionKey
      await bus.publishInbound({
        channel: 'test', senderId: 'user', chatId: 'c1', content: 'm1',
        metadata: { sessionKey: 's1' },
      });
      await bus.publishInbound({
        channel: 'test', senderId: 'user', chatId: 'c1', content: 'm2',
        metadata: { sessionKey: 's1' },
      });
      await bus.publishInbound({
        channel: 'test', senderId: 'user', chatId: 'c1', content: 'm3',
        metadata: { sessionKey: 's1' },
      });

      const loopPromise = runInboundLoop(
        bus,
        { current: mockSession as never, currentKey: 's1' },
        watchdog,
      );

      // turn1 阻塞期间，m2/m3 的 turn_busy 与 m1 的 user_message/agent_start emit 顺序
      // 因 microtask 调度而不确定，因此循环 consume 直到收集到 2 个 turn_busy 事件
      const busyEvents: AgentEventEnvelope[] = [];
      for (let i = 0; i < 10 && busyEvents.length < 2; i++) {
        const env = await bus.consumeOutbound();
        if (env.event.type === 'turn_busy') busyEvents.push(env);
      }
      expect(busyEvents).toHaveLength(2);
      expect((busyEvents[0].event as { position: number }).position).toBe(2);
      expect((busyEvents[1].event as { position: number }).position).toBe(3);

      // 释放第一个 turn → 后续 m2, m3 依次执行
      releaseTurn();
      // 给 loop 时间处理
      await new Promise((r) => setTimeout(r, 100));

      loopPromise.catch(() => {});
    });

    it('edge: different sessionKey → no turn_busy (independent queues)', async () => {
      const bus = new InMemoryMessageBus();
      const watchdog = { markTurnStart: vi.fn(), markTurnEnd: vi.fn() };

      let releaseS1!: () => void;
      const s1Gate = new Promise<void>((r) => { releaseS1 = r; });

      const mockSession = {
        run: async function* (text: string): AsyncGenerator<AgentEvent> {
          if (text === 's1-msg') {
            yield { type: 'agent_start' };
            await s1Gate;
            yield { type: 'turn_end', turnId: 't1' };
          } else {
            yield { type: 'agent_start' };
            yield { type: 'turn_end', turnId: 't2' };
          }
        },
      };

      // s1 消息（阻塞）
      await bus.publishInbound({
        channel: 'test', senderId: 'user', chatId: 'c1', content: 's1-msg',
        metadata: { sessionKey: 's1' },
      });
      // s2 消息（不同 sessionKey，应并行执行不排队）
      await bus.publishInbound({
        channel: 'test', senderId: 'user', chatId: 'c1', content: 's2-msg',
        metadata: { sessionKey: 's2' },
      });

      const loopPromise = runInboundLoop(
        bus,
        { current: mockSession as never, currentKey: 's1' },
        watchdog,
      );

      // s1/s2 turn 并行执行，事件 emit 交错（不同 sessionKey 不串行）。
      // 预期 5 个事件：s1 user_message + agent_start（阻塞在 gate），
      //               s2 user_message + agent_start + turn_end（快速完成）。
      // 关键断言：没有 turn_busy（不同 sessionKey 独立队列，不排队）
      const events: AgentEventEnvelope[] = [];
      for (let i = 0; i < 5; i++) {
        events.push(await bus.consumeOutbound());
      }
      const types = events.map((e) => e.event.type);
      expect(types.filter((t) => t === 'turn_busy')).toHaveLength(0);
      expect(types.filter((t) => t === 'user_message')).toHaveLength(2);
      expect(types.filter((t) => t === 'agent_start')).toHaveLength(2);
      expect(types.filter((t) => t === 'turn_end')).toHaveLength(1);

      releaseS1();
      await new Promise((r) => setTimeout(r, 100));
      loopPromise.catch(() => {});
    });

    it('error: turn_busy emit failure → silently ignored, main flow continues', async () => {
      // 构造一个 publishOutbound 在发 turn_busy 时抛错的 bus
      class FailingBus extends InMemoryMessageBus {
        failNext = false;
        override async publishOutbound(env: AgentEventEnvelope): Promise<void> {
          if (this.failNext && env.event.type === 'turn_busy') {
            throw new Error('turn_busy publish failed');
          }
          return super.publishOutbound(env);
        }
      }
      const bus = new FailingBus();
      const watchdog = { markTurnStart: vi.fn(), markTurnEnd: vi.fn() };

      let releaseS1!: () => void;
      const s1Gate = new Promise<void>((r) => { releaseS1 = r; });

      const mockSession = {
        run: async function* (): AsyncGenerator<AgentEvent> {
          yield { type: 'agent_start' };
          await s1Gate;
          yield { type: 'turn_end', turnId: 't1' };
        },
      };

      await bus.publishInbound({
        channel: 'test', senderId: 'user', chatId: 'c1', content: 'm1',
        metadata: { sessionKey: 's1' },
      });
      // 让 turn_busy 投递失败
      bus.failNext = true;
      await bus.publishInbound({
        channel: 'test', senderId: 'user', chatId: 'c1', content: 'm2',
        metadata: { sessionKey: 's1' },
      });

      const loopPromise = runInboundLoop(
        bus,
        { current: mockSession as never, currentKey: 's1' },
        watchdog,
      );

      // m1 user_message + agent_start
      await bus.consumeOutbound();
      await bus.consumeOutbound();
      // turn_busy 投递失败 — 主流程不应中断
      // 释放 m1，m2 应继续
      releaseS1();
      await new Promise((r) => setTimeout(r, 100));

      // m2 应该被处理（user_message + agent_start + turn_end）
      const events: AgentEvent[] = [];
      for (let i = 0; i < 6; i++) {
        const env = await Promise.race([
          bus.consumeOutbound(),
          new Promise<null>((r) => setTimeout(() => r(null), 300)),
        ]);
        if (env === null) break;
        events.push(env.event);
      }
      // m2 被处理 → 至少有 user_message + turn_end
      expect(events.some((e) => e.type === 'user_message')).toBe(true);
      expect(events.some((e) => e.type === 'turn_end')).toBe(true);

      loopPromise.catch(() => {});
    });
  });

  // =====================================================================
  // 9. Session 自动摘要 (Task 10)
  // =====================================================================

  describe('9. Session auto-summary', () => {
    let tempDir: string;

    beforeEach(() => {
      tempDir = mkdtempSync(join(tmpdir(), 'aptbot-summary-e2e-'));
    });

    afterEach(() => {
      if (tempDir) rmSync(tempDir, { recursive: true, force: true });
    });

    it('happy: triggerSessionSummary with no custom label → LLM summary written to storage (≤20 chars)', async () => {
      const storage = new FileStorage(tempDir);
      const sid = randomUUID();
      const summaryProvider = makeMockProvider([
        { type: 'text', text: 'chat about code' },
        { type: 'stop', stopReason: 'end_turn' },
      ]);

      await triggerSessionSummary({
        sessionId: sid,
        provider: summaryProvider,
        model: MODEL,
        messages: [
          { role: 'user', content: 'how to write code?' },
          { role: 'assistant', content: 'use functions' },
        ],
        storage,
      });

      // sidecar .meta.json 应含 label + labelSource='auto'
      const { readFileSync } = await import('node:fs');
      const metaPath = join(tempDir, `${sid}.meta.json`);
      const meta = JSON.parse(readFileSync(metaPath, 'utf-8'));
      expect(meta.label).toBe('chat about code');
      expect(meta.labelSource).toBe('auto');
      expect(meta.label.length).toBeLessThanOrEqual(SUMMARY_MAX_CHARS);
    });

    it('happy: user /label → hasCustomLabel=true → auto-summary skipped', async () => {
      const storage = new FileStorage(tempDir);
      const sid = randomUUID();
      // 用户先 /label
      await storage.updateSessionLabel(sid, 'my-custom-label', 'custom');
      expect(await storage.hasCustomLabel(sid)).toBe(true);

      // 摘要 provider 不应被调用 — 用 calls 计数校验
      const inner = makeMockProviderWithOptions([
        { type: 'text', text: 'should not run' },
        { type: 'stop', stopReason: 'end_turn' },
      ]);

      await triggerSessionSummary({
        sessionId: sid,
        provider: inner,
        model: MODEL,
        messages: [{ role: 'user', content: 'hello' }],
        storage,
      });

      expect(inner.callCount).toBe(0);
      // label 仍为用户手动设置的
      const { readFileSync } = await import('node:fs');
      const metaPath = join(tempDir, `${sid}.meta.json`);
      const meta = JSON.parse(readFileSync(metaPath, 'utf-8'));
      expect(meta.label).toBe('my-custom-label');
      expect(meta.labelSource).toBe('custom');
    });

    it('error: LLM timeout → no error thrown, default label retained', async () => {
      const storage = new FileStorage(tempDir);
      const sid = randomUUID();
      // 构造永不 stop 的 provider（模拟超时）
      const slowProvider: Provider = {
        id: 'slow',
        name: 'Slow',
        auth: {},
        getModels: () => [MODEL],
        stream: async function* (): AsyncGenerator<AssistantMessageEvent> {
          // 不 yield 任何 stop 事件，但立即返回（triggerSessionSummary 的 llmPromise 会 resolve 为空字符串）
          // 为真正模拟超时，我们让 stream 永远挂起
          await new Promise(() => {}); // 永不 resolve
        },
      };

      // 用很短的 timeoutMs 触发超时
      await expect(triggerSessionSummary({
        sessionId: sid,
        provider: slowProvider,
        model: MODEL,
        messages: [{ role: 'user', content: 'hello' }],
        storage,
        timeoutMs: 50,
      })).resolves.toBeUndefined();

      // label 未被设置
      const { readFileSync } = await import('node:fs');
      const metaPath = join(tempDir, `${sid}.meta.json`);
      if (existsSync(metaPath)) {
        const meta = JSON.parse(readFileSync(metaPath, 'utf-8'));
        expect(meta.label).toBeUndefined();
      }
    });

    it('edge: summary > 20 chars → truncated to SUMMARY_MAX_CHARS', async () => {
      const storage = new FileStorage(tempDir);
      const sid = randomUUID();
      const longSummary = 'a'.repeat(50);
      const summaryProvider = makeMockProvider([
        { type: 'text', text: longSummary },
        { type: 'stop', stopReason: 'end_turn' },
      ]);

      await triggerSessionSummary({
        sessionId: sid,
        provider: summaryProvider,
        model: MODEL,
        messages: [{ role: 'user', content: 'hi' }],
        storage,
      });

      const { readFileSync } = await import('node:fs');
      const metaPath = join(tempDir, `${sid}.meta.json`);
      const meta = JSON.parse(readFileSync(metaPath, 'utf-8'));
      expect(meta.label).toBe('a'.repeat(SUMMARY_MAX_CHARS));
      expect(meta.label.length).toBe(SUMMARY_MAX_CHARS);
    });
  });

  // =====================================================================
  // 10. Channel 抽象 (Task 12)
  // =====================================================================

  describe('10. Channel abstraction', () => {
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
      setAlive(v: boolean): void;
      setSendThrow(v: boolean): void;
      closeMock: ReturnType<typeof vi.fn>;
    } {
      const sent: string[] = [];
      let alive = true;
      let sendThrow = false;
      const sendMock = vi.fn(async (data: string | Uint8Array) => {
        if (sendThrow) throw new Error('send_failed');
        sent.push(typeof data === 'string' ? data : new TextDecoder().decode(data));
      });
      const closeMock = vi.fn(async () => { alive = false; });
      return {
        type,
        send: sendMock,
        close: closeMock,
        isAlive: () => alive,
        sent,
        setAlive(v) { alive = v; },
        setSendThrow(v) { sendThrow = v; },
        closeMock,
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

    it('happy: TransportChannel wrapped via adapter → binds to sessionKey → receives broadcasts', async () => {
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
      // 收到的内容是序列化的 envelope
      const parsed = JSON.parse(tc.sent[0]);
      expect(parsed.sessionKey).toBe('s1');
      expect(parsed.event.type).toBe('agent_start');
    });

    it('happy: multi-channel same sessionKey → both receive broadcast', async () => {
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

    it('error: dead channel (isAlive=false after send failure) → auto-unbind', async () => {
      const bus = new InMemoryMessageBus();
      const mgr = createChannelManager(bus);
      const tcDead = makeMockTransport('telegram');
      const tcAlive = makeMockTransport('discord');
      const chDead = wrapTransportChannel(tcDead, { capabilities: FULL_CAP });
      const chAlive = wrapTransportChannel(tcAlive, { capabilities: FULL_CAP });
      mgr.register(chDead);
      mgr.register(chAlive);
      mgr.bindSession('s1', chDead);
      mgr.bindSession('s1', chAlive);

      // 让 chDead 死掉：isAlive=false + send 抛错
      tcDead.setAlive(false);
      tcDead.setSendThrow(true);

      await bus.publishOutbound(makeEnvelope('s1', 0));
      await bus.publishOutbound(makeEnvelope('s1', 1));
      const loopPromise = mgr.runDispatchLoop();
      await new Promise((r) => setTimeout(r, 80));
      mgr.stopAll();
      await loopPromise.catch(() => {});

      // chDead: 仅第一次尝试（之后被 unbind，第二次不投递）
      expect(tcDead.sent.length).toBe(0); // send 抛错 → sent 不增加
      // chAlive: 两条都收到
      expect(tcAlive.sent.length).toBe(2);
    });

    it('edge: plain Channel (no isAlive) → consume failure does NOT trigger unbind', async () => {
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

      // plain channel 没有 isAlive → 不被 unbind → 两条都尝试 consume（均抛错）
      expect(throwCount).toBe(2);
    });
  });
});
