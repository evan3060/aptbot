import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createServer, type Server } from 'node:http';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { handleAgentApi, handleSkillApi } from '../../src/access/agent-api.js';
import { AgentStorage } from '../../src/core/agent/agent-storage.js';
import { MemoryAuditLog } from '../../src/core/agent/memory-audit-log.js';
import { UiConfigStorage } from '../../src/core/agent/ui-config.js';
import {
  AGENT_SLUG_REGEX,
  MAX_AGENTS_PER_USER,
  generateSlug,
} from '../../src/core/agent/agent-profile.js';
import { createUserStorage, type UserStorage } from '../../src/infrastructure/user-storage.js';
import { FileStorage, type StorageAdapter } from '../../src/infrastructure/storage/file-storage.js';
import type { AgentProfile } from '../../src/core/agent/agent-profile.js';
import type { AuditRecord } from '../../src/core/agent/memory-audit-log.js';
import type { Skill } from '../../src/core/skills/types.js';
import type { SkillState } from '../../src/core/skills/loader.js';

/**
 * §0.3.0 Task 9: Agent HTTP API（/api/agents 系列）
 *
 * 10 项 brief 场景：
 * 1. 401 no auth (GET /api/agents)
 * 2. 200 + list with auth (GET /api/agents)
 * 3. 200 + create (POST /api/agents)
 * 4. 400 on >50 agents (POST /api/agents)
 * 5. 200 update (PUT /api/agents/:slug)
 * 6. 403 delete default (DELETE /api/agents/default)
 * 7. 200 + archivedPath delete professional (DELETE /api/agents/:slug, Task 19)
 * 8. 403 cross-user access
 * 9. 400 invalid slug (path traversal)
 * 10. memory-log default 20
 *
 * 额外覆盖：GET /:slug 详情、GET /:slug/sessions、GET /:slug/memory
 */

const AUTH_TOKEN = 'test-admin-token';

describe('Task 9: Agent HTTP API', () => {
  let server: Server | null = null;
  let port: number;
  let tmpDir: string;
  let agentStorage: AgentStorage;
  let sessionStorage: StorageAdapter;
  let userStorage: UserStorage;
  let uiConfigStorage: UiConfigStorage;
  let aliceToken: string;
  let aliceUserId: string;
  let bobToken: string;
  let bobUserId: string;

  beforeEach(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'aptbot-agent-api-'));
    agentStorage = new AgentStorage(tmpDir);
    sessionStorage = new FileStorage(tmpDir);
    userStorage = createUserStorage(tmpDir);
    uiConfigStorage = new UiConfigStorage(tmpDir);
    const alice = await userStorage.register('alice', 'pw123456');
    aliceToken = alice.token;
    aliceUserId = alice.userId;
    const bob = await userStorage.register('bob', 'pw123456');
    bobToken = bob.token;
    bobUserId = bob.userId;
  });

  afterEach(async () => {
    if (server) {
      await new Promise<void>((r) => server!.close(() => r()));
      server = null;
    }
    rmSync(tmpDir, { recursive: true, force: true });
  });

  /** 启动测试服务器，handleAgentApi 直接挂载 */
  async function startServer(): Promise<void> {
    server = createServer((req, res) => {
      const url = new URL(req.url ?? '/', 'http://localhost');
      handleAgentApi(
        req,
        res,
        url.pathname,
        agentStorage,
        (userId, slug) => new MemoryAuditLog(userId, slug, tmpDir),
        sessionStorage,
        AUTH_TOKEN,
        userStorage,
        uiConfigStorage,
      );
    });
    await new Promise<void>((r) => server!.listen(0, '127.0.0.1', r));
    port = (server!.address() as { port: number }).port;
  }

  async function request(
    method: string,
    path: string,
    body?: unknown,
    headers?: Record<string, string>,
  ): Promise<{ status: number; body: any; headers: Headers }> {
    const url = `http://localhost:${port}${path}`;
    const init: RequestInit = {
      method,
      headers: { 'content-type': 'application/json', ...headers },
    };
    if (body !== undefined) init.body = JSON.stringify(body);
    const res = await fetch(url, init);
    const text = await res.text();
    let parsed: any = null;
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = text;
    }
    return { status: res.status, body: parsed, headers: res.headers };
  }

  /** 直接通过 AgentStorage 创建一个 agent（绕过 API，用于测试前置数据） */
  async function createAgentDirectly(
    userId: string,
    overrides: Partial<AgentProfile> = {},
  ): Promise<AgentProfile> {
    const slug = overrides.slug ?? generateSlug();
    const profile: AgentProfile = {
      name: 'Test Agent',
      description: 'A test agent',
      type: 'professional',
      slug,
      userId,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      personality: 'You are a helpful assistant.',
      ...overrides,
    };
    await agentStorage.saveAgent(profile);
    return profile;
  }

  describe('鉴权', () => {
    it('1. GET /api/agents 无 auth → 401', async () => {
      await startServer();
      const res = await request('GET', '/api/agents');
      expect(res.status).toBe(401);
      expect(res.body.error).toBeTruthy();
    });

    it('GET /api/agents 错误 token → 401', async () => {
      await startServer();
      const res = await request('GET', '/api/agents', undefined, {
        authorization: 'Bearer wrong-token',
      });
      expect(res.status).toBe(401);
    });
  });

  describe('GET /api/agents — 列表', () => {
    it('2. 正确 auth → 200 + agents 列表', async () => {
      await startServer();
      await createAgentDirectly(aliceUserId, { name: 'Agent A' });
      await createAgentDirectly(aliceUserId, { name: 'Agent B' });

      const res = await request('GET', '/api/agents', undefined, {
        authorization: `Bearer ${aliceToken}`,
      });
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body).toHaveLength(2);
      // 列表项应包含基本字段，不暴露敏感字段
      expect(res.body[0].name).toBeTruthy();
      expect(res.body[0].slug).toMatch(AGENT_SLUG_REGEX);
      expect(res.body[0].userId).toBe(aliceUserId);
    });

    it('仅返回当前用户的 agents（跨用户隔离）', async () => {
      await startServer();
      await createAgentDirectly(aliceUserId, { name: 'Alice Agent' });
      await createAgentDirectly(bobUserId, { name: 'Bob Agent' });

      const res = await request('GET', '/api/agents', undefined, {
        authorization: `Bearer ${aliceToken}`,
      });
      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(1);
      expect(res.body[0].name).toBe('Alice Agent');
    });
  });

  describe('GET /api/agents/:slug — 详情', () => {
    it('返回 agent 详情 → 200', async () => {
      await startServer();
      const agent = await createAgentDirectly(aliceUserId);

      const res = await request('GET', `/api/agents/${agent.slug}`, undefined, {
        authorization: `Bearer ${aliceToken}`,
      });
      expect(res.status).toBe(200);
      expect(res.body.slug).toBe(agent.slug);
      expect(res.body.userId).toBe(aliceUserId);
      expect(res.body.personality).toBe('You are a helpful assistant.');
    });

    it('agent 不存在 → 404', async () => {
      await startServer();
      const res = await request('GET', '/api/agents/agent-nonexist', undefined, {
        authorization: `Bearer ${aliceToken}`,
      });
      expect(res.status).toBe(404);
    });

    it('9. 非法 slug（路径遍历）→ 400', async () => {
      await startServer();
      // 路径遍历尝试：slug 包含 / 和 ..
      const res = await request('GET', '/api/agents/..%2Fetc', undefined, {
        authorization: `Bearer ${aliceToken}`,
      });
      expect(res.status).toBe(400);
    });

    it('8. 跨用户访问 → 403', async () => {
      await startServer();
      // alice 创建 agent，bob 尝试访问
      const agent = await createAgentDirectly(aliceUserId);

      const res = await request('GET', `/api/agents/${agent.slug}`, undefined, {
        authorization: `Bearer ${bobToken}`,
      });
      expect(res.status).toBe(403);
    });
  });

  describe('POST /api/agents — 创建', () => {
    it('3. 创建 agent → 200 + agent 详情', async () => {
      await startServer();
      const res = await request(
        'POST',
        '/api/agents',
        {
          name: 'My New Agent',
          description: 'A brand new agent',
          personality: 'You are a creative assistant.',
        },
        { authorization: `Bearer ${aliceToken}` },
      );
      expect(res.status).toBe(200);
      expect(res.body.slug).toMatch(AGENT_SLUG_REGEX);
      expect(res.body.name).toBe('My New Agent');
      expect(res.body.type).toBe('professional');
      expect(res.body.userId).toBe(aliceUserId);
      expect(res.body.createdAt).toBeGreaterThan(0);
      expect(res.body.updatedAt).toBeGreaterThan(0);

      // 验证已落盘
      const read = await agentStorage.getAgent(aliceUserId, res.body.slug);
      expect(read).not.toBeNull();
      expect(read!.name).toBe('My New Agent');
    });

    it('缺 name → 400', async () => {
      await startServer();
      const res = await request(
        'POST',
        '/api/agents',
        { description: 'desc', personality: 'p' },
        { authorization: `Bearer ${aliceToken}` },
      );
      expect(res.status).toBe(400);
    });

    it('4. 超 50 个 agent → 400', async () => {
      await startServer();
      // 预先创建 50 个 agent（达到上限）
      for (let i = 0; i < MAX_AGENTS_PER_USER; i++) {
        await createAgentDirectly(aliceUserId, { name: `Agent ${i}` });
      }
      // 第 51 个应被拒绝
      const res = await request(
        'POST',
        '/api/agents',
        { name: 'Over Limit', description: 'desc', personality: 'p' },
        { authorization: `Bearer ${aliceToken}` },
      );
      expect(res.status).toBe(400);
    });
  });

  describe('PUT /api/agents/:slug — 更新', () => {
    it('5. 更新 agent → 200', async () => {
      await startServer();
      const agent = await createAgentDirectly(aliceUserId);

      const res = await request(
        'PUT',
        `/api/agents/${agent.slug}`,
        {
          name: 'Updated Name',
          description: 'Updated description',
          personality: 'You are an updated assistant.',
          model: 'gpt-4',
          temperature: 0.7,
        },
        { authorization: `Bearer ${aliceToken}` },
      );
      expect(res.status).toBe(200);
      expect(res.body.name).toBe('Updated Name');
      expect(res.body.description).toBe('Updated description');
      expect(res.body.personality).toBe('You are an updated assistant.');
      expect(res.body.model).toBe('gpt-4');
      expect(res.body.temperature).toBe(0.7);
      // updatedAt 应被刷新
      expect(res.body.updatedAt).toBeGreaterThanOrEqual(agent.updatedAt);

      // 验证已落盘
      const read = await agentStorage.getAgent(aliceUserId, agent.slug);
      expect(read!.name).toBe('Updated Name');
      expect(read!.model).toBe('gpt-4');
    });

    it('更新不存在的 agent → 404', async () => {
      await startServer();
      const res = await request(
        'PUT',
        '/api/agents/agent-nonexist',
        { name: 'X' },
        { authorization: `Bearer ${aliceToken}` },
      );
      expect(res.status).toBe(404);
    });

    it('跨用户更新 → 403', async () => {
      await startServer();
      const agent = await createAgentDirectly(aliceUserId);
      const res = await request(
        'PUT',
        `/api/agents/${agent.slug}`,
        { name: 'Hacked' },
        { authorization: `Bearer ${bobToken}` },
      );
      expect(res.status).toBe(403);
    });
  });

  describe('DELETE /api/agents/:slug — 归档删除（Task 19）', () => {
    it('6. DELETE /api/agents/default → 403（不可删）', async () => {
      await startServer();
      const res = await request('DELETE', '/api/agents/default', undefined, {
        authorization: `Bearer ${aliceToken}`,
      });
      expect(res.status).toBe(403);
    });

    it('DELETE 不存在的专业 agent → 404', async () => {
      await startServer();
      const res = await request('DELETE', '/api/agents/agent-nonexist', undefined, {
        authorization: `Bearer ${aliceToken}`,
      });
      expect(res.status).toBe(404);
    });

    it('7. DELETE 专业 agent → 200 + 返回归档路径', async () => {
      await startServer();
      const agent = await createAgentDirectly(aliceUserId);
      const res = await request('DELETE', `/api/agents/${agent.slug}`, undefined, {
        authorization: `Bearer ${aliceToken}`,
      });
      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      expect(typeof res.body.archivedPath).toBe('string');
      expect(res.body.archivedPath.length).toBeGreaterThan(0);
      // 归档路径形如 .../archived-agents/<slug>-<timestamp>
      expect(res.body.archivedPath).toMatch(/archived-agents[\\/].+-\d+$/);
    });

    it('DELETE 专业 agent → 原 agent 目录已不存在', async () => {
      await startServer();
      const agent = await createAgentDirectly(aliceUserId);
      const agentDir = agentStorage.getAgentDir(aliceUserId, agent.slug);
      expect(existsSync(agentDir)).toBe(true);

      const res = await request('DELETE', `/api/agents/${agent.slug}`, undefined, {
        authorization: `Bearer ${aliceToken}`,
      });
      expect(res.status).toBe(200);

      // 原 agent 目录已删除
      expect(existsSync(agentDir)).toBe(false);
      // getAgent 返回 null（active agent 列表中已移除）
      const read = await agentStorage.getAgent(aliceUserId, agent.slug);
      expect(read).toBeNull();
    });

    it('8. 跨用户 DELETE → 403（agent 属于其他用户）', async () => {
      await startServer();
      // alice 创建 agent，bob 尝试删除
      const agent = await createAgentDirectly(aliceUserId);
      const res = await request('DELETE', `/api/agents/${agent.slug}`, undefined, {
        authorization: `Bearer ${bobToken}`,
      });
      expect(res.status).toBe(403);
      // alice 仍可访问该 agent（未被归档）
      const read = await agentStorage.getAgent(aliceUserId, agent.slug);
      expect(read).not.toBeNull();
    });
  });

  describe('GET /api/agents/:slug/sessions — session 列表', () => {
    it('返回该 agent 的 session 列表 → 200', async () => {
      await startServer();
      const agent = await createAgentDirectly(aliceUserId);
      // 直接通过 storage 创建 session
      const sid = randomUUID();
      await sessionStorage.appendSession(sid, aliceUserId, agent.slug, {
        type: 'message',
        id: 'm1',
        message: { id: 'm1', role: 'user', content: 'hi', timestamp: Date.now() },
        timestamp: Date.now(),
      });

      const res = await request('GET', `/api/agents/${agent.slug}/sessions`, undefined, {
        authorization: `Bearer ${aliceToken}`,
      });
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBeGreaterThanOrEqual(1);
      expect(res.body[0].agentId).toBe(agent.slug);
    });

    it('跨用户访问 sessions → 403', async () => {
      await startServer();
      const agent = await createAgentDirectly(aliceUserId);
      const res = await request('GET', `/api/agents/${agent.slug}/sessions`, undefined, {
        authorization: `Bearer ${bobToken}`,
      });
      expect(res.status).toBe(403);
    });
  });

  describe('GET /api/agents/:slug/memory — MEMORY.md 内容', () => {
    it('返回 MEMORY.md 内容 → 200', async () => {
      await startServer();
      const agent = await createAgentDirectly(aliceUserId);
      // 直接写入 MEMORY.md
      const memPath = join(tmpDir, 'users', aliceUserId, 'agents', agent.slug, 'MEMORY.md');
      mkdirSync(join(tmpDir, 'users', aliceUserId, 'agents', agent.slug), { recursive: true });
      writeFileSync(memPath, '## User Profile\nlikes coffee\n', 'utf-8');

      const res = await request('GET', `/api/agents/${agent.slug}/memory`, undefined, {
        authorization: `Bearer ${aliceToken}`,
      });
      expect(res.status).toBe(200);
      expect(res.body.content).toContain('likes coffee');
    });

    it('MEMORY.md 不存在 → 200 + 空字符串', async () => {
      await startServer();
      const agent = await createAgentDirectly(aliceUserId);
      const res = await request('GET', `/api/agents/${agent.slug}/memory`, undefined, {
        authorization: `Bearer ${aliceToken}`,
      });
      expect(res.status).toBe(200);
      expect(res.body.content).toBe('');
    });
  });

  describe('GET /api/agents/:slug/memory-log — 审计日志', () => {
    it('10. 默认返回最近 20 条', async () => {
      await startServer();
      const agent = await createAgentDirectly(aliceUserId);
      // 写入 25 条审计记录
      const auditLog = new MemoryAuditLog(aliceUserId, agent.slug, tmpDir);
      for (let i = 0; i < 25; i++) {
        const record: AuditRecord = {
          timestamp: new Date(Date.now() + i * 1000).toISOString(),
          sessionId: randomUUID(),
          section: 'facts',
          mode: 'append',
          contentPreview: `fact ${i}`,
          contentLength: 10,
          beforeSize: i * 10,
          afterSize: (i + 1) * 10,
        };
        await auditLog.append(record);
      }

      const res = await request('GET', `/api/agents/${agent.slug}/memory-log`, undefined, {
        authorization: `Bearer ${aliceToken}`,
      });
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body).toHaveLength(20);
      // 最新在前（倒序）
      expect(res.body[0].contentPreview).toBe('fact 24');
      expect(res.body[19].contentPreview).toBe('fact 5');
    });

    it('支持 ?limit 自定义返回数量', async () => {
      await startServer();
      const agent = await createAgentDirectly(aliceUserId);
      const auditLog = new MemoryAuditLog(aliceUserId, agent.slug, tmpDir);
      for (let i = 0; i < 10; i++) {
        const record: AuditRecord = {
          timestamp: new Date(Date.now() + i * 1000).toISOString(),
          sessionId: randomUUID(),
          section: 'facts',
          mode: 'append',
          contentPreview: `fact ${i}`,
          contentLength: 10,
          beforeSize: i * 10,
          afterSize: (i + 1) * 10,
        };
        await auditLog.append(record);
      }

      const res = await request('GET', `/api/agents/${agent.slug}/memory-log?limit=5`, undefined, {
        authorization: `Bearer ${aliceToken}`,
      });
      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(5);
    });

    it('跨用户访问 memory-log → 403', async () => {
      await startServer();
      const agent = await createAgentDirectly(aliceUserId);
      const res = await request('GET', `/api/agents/${agent.slug}/memory-log`, undefined, {
        authorization: `Bearer ${bobToken}`,
      });
      expect(res.status).toBe(403);
    });

    describe('?limit 参数校验', () => {
      it('?limit=0 → 400', async () => {
        await startServer();
        const agent = await createAgentDirectly(aliceUserId);
        const res = await request(
          'GET',
          `/api/agents/${agent.slug}/memory-log?limit=0`,
          undefined,
          { authorization: `Bearer ${aliceToken}` },
        );
        expect(res.status).toBe(400);
        expect(res.body.error).toMatch(/limit/i);
      });

      it('?limit=-5 → 400', async () => {
        await startServer();
        const agent = await createAgentDirectly(aliceUserId);
        const res = await request(
          'GET',
          `/api/agents/${agent.slug}/memory-log?limit=-5`,
          undefined,
          { authorization: `Bearer ${aliceToken}` },
        );
        expect(res.status).toBe(400);
        expect(res.body.error).toMatch(/limit/i);
      });

      it('?limit=abc → 400', async () => {
        await startServer();
        const agent = await createAgentDirectly(aliceUserId);
        const res = await request(
          'GET',
          `/api/agents/${agent.slug}/memory-log?limit=abc`,
          undefined,
          { authorization: `Bearer ${aliceToken}` },
        );
        expect(res.status).toBe(400);
        expect(res.body.error).toMatch(/limit/i);
      });

      it('?limit=1.5 → 400', async () => {
        await startServer();
        const agent = await createAgentDirectly(aliceUserId);
        const res = await request(
          'GET',
          `/api/agents/${agent.slug}/memory-log?limit=1.5`,
          undefined,
          { authorization: `Bearer ${aliceToken}` },
        );
        expect(res.status).toBe(400);
        expect(res.body.error).toMatch(/limit/i);
      });

      it('?limit=1001 → 400', async () => {
        await startServer();
        const agent = await createAgentDirectly(aliceUserId);
        const res = await request(
          'GET',
          `/api/agents/${agent.slug}/memory-log?limit=1001`,
          undefined,
          { authorization: `Bearer ${aliceToken}` },
        );
        expect(res.status).toBe(400);
        expect(res.body.error).toMatch(/limit/i);
      });
    });
  });

  describe('路由优先级 / 错误处理', () => {
    it('未匹配的 /api/agents/* 子路径 → 404', async () => {
      await startServer();
      const res = await request('GET', '/api/agents/some-slug/unknown-subpath', undefined, {
        authorization: `Bearer ${aliceToken}`,
      });
      expect(res.status).toBe(404);
    });

    it('PUT /api/agents（无 slug）→ 404 / 405', async () => {
      await startServer();
      const res = await request('PUT', '/api/agents', { name: 'X' }, {
        authorization: `Bearer ${aliceToken}`,
      });
      expect([404, 405]).toContain(res.status);
    });
  });

  describe('Task 10: GET /api/agents/default/ui-config — UI 配置', () => {
    it('无 auth → 401', async () => {
      await startServer();
      const res = await request('GET', '/api/agents/default/ui-config');
      expect(res.status).toBe(401);
    });

    it('错误 token → 401', async () => {
      await startServer();
      const res = await request('GET', '/api/agents/default/ui-config', undefined, {
        authorization: 'Bearer wrong-token',
      });
      expect(res.status).toBe(401);
    });

    it('有 auth → 200 + 配置（默认空 visibleSkills）', async () => {
      await startServer();
      const res = await request('GET', '/api/agents/default/ui-config', undefined, {
        authorization: `Bearer ${aliceToken}`,
      });
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ visibleSkills: [] });
    });

    it('用户隔离：alice 与 bob 的配置互不影响', async () => {
      await startServer();
      // alice 写入一个 skill
      await request(
        'PUT',
        '/api/agents/default/ui-config',
        { visibleSkills: [{ slug: 'alice-skill', displayName: 'Alice' }] },
        { authorization: `Bearer ${aliceToken}` },
      );
      // bob 应看不到
      const bobRes = await request('GET', '/api/agents/default/ui-config', undefined, {
        authorization: `Bearer ${bobToken}`,
      });
      expect(bobRes.status).toBe(200);
      expect(bobRes.body).toEqual({ visibleSkills: [] });
    });
  });

  describe('Task 10: PUT /api/agents/default/ui-config — 更新 UI 配置', () => {
    it('无 auth → 401', async () => {
      await startServer();
      const res = await request('PUT', '/api/agents/default/ui-config', {
        visibleSkills: [],
      });
      expect(res.status).toBe(401);
    });

    it('合法 body → 200', async () => {
      await startServer();
      const res = await request(
        'PUT',
        '/api/agents/default/ui-config',
        { visibleSkills: [{ slug: 'skill-1', displayName: 'Skill One' }] },
        { authorization: `Bearer ${aliceToken}` },
      );
      expect(res.status).toBe(200);
    });

    it('PUT 后 GET → 返回更新后的配置', async () => {
      await startServer();
      const newConfig = {
        visibleSkills: [
          { slug: 'skill-foo', displayName: 'Foo' },
          { slug: 'skill-bar', displayName: 'Bar' },
        ],
      };
      const putRes = await request('PUT', '/api/agents/default/ui-config', newConfig, {
        authorization: `Bearer ${aliceToken}`,
      });
      expect(putRes.status).toBe(200);

      const getRes = await request('GET', '/api/agents/default/ui-config', undefined, {
        authorization: `Bearer ${aliceToken}`,
      });
      expect(getRes.status).toBe(200);
      expect(getRes.body).toEqual(newConfig);
    });

    it('PUT 覆盖已存在配置 → GET 返回新值', async () => {
      await startServer();
      // 第一次写
      await request(
        'PUT',
        '/api/agents/default/ui-config',
        { visibleSkills: [{ slug: 'old', displayName: 'Old' }] },
        { authorization: `Bearer ${aliceToken}` },
      );
      // 覆盖
      await request(
        'PUT',
        '/api/agents/default/ui-config',
        { visibleSkills: [{ slug: 'new', displayName: 'New' }] },
        { authorization: `Bearer ${aliceToken}`,
      });
      const getRes = await request('GET', '/api/agents/default/ui-config', undefined, {
        authorization: `Bearer ${aliceToken}`,
      });
      expect(getRes.body.visibleSkills).toEqual([
        { slug: 'new', displayName: 'New' },
      ]);
    });

    it('非法 body（缺 visibleSkills）→ 400', async () => {
      await startServer();
      const res = await request('PUT', '/api/agents/default/ui-config', {
        notVisibleSkills: [],
      }, { authorization: `Bearer ${aliceToken}` });
      expect(res.status).toBe(400);
    });

    it('非法 body（visibleSkills 不是数组）→ 400', async () => {
      await startServer();
      const res = await request(
        'PUT',
        '/api/agents/default/ui-config',
        { visibleSkills: 'not-an-array' },
        { authorization: `Bearer ${aliceToken}` },
      );
      expect(res.status).toBe(400);
    });

    it('非法 body（item 缺 slug）→ 400', async () => {
      await startServer();
      const res = await request(
        'PUT',
        '/api/agents/default/ui-config',
        { visibleSkills: [{ displayName: 'No Slug' }] },
        { authorization: `Bearer ${aliceToken}` },
      );
      expect(res.status).toBe(400);
    });

    it('非法 body（item slug 非 string）→ 400', async () => {
      await startServer();
      const res = await request(
        'PUT',
        '/api/agents/default/ui-config',
        { visibleSkills: [{ slug: 123, displayName: 'X' }] },
        { authorization: `Bearer ${aliceToken}` },
      );
      expect(res.status).toBe(400);
    });
  });
});

describe('Task 11: GET /api/skills — Skill 列表', () => {
  let server: Server | null = null;
  let port: number;
  let tmpDir: string;
  let userStorage: UserStorage;
  let aliceToken: string;
  let skillState: SkillState;

  beforeEach(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'aptbot-skill-api-'));
    userStorage = createUserStorage(tmpDir);
    const alice = await userStorage.register('alice', 'pw123456');
    aliceToken = alice.token;

    // 构造 mock SkillState：含 template 与不含 template 的 skill 各一
    const skills: Skill[] = [
      {
        name: 'skill-with-template',
        description: 'A skill with a template field',
        content: 'body',
        filePath: '/tmp/skill-with-template/SKILL.md',
        contentLines: 1,
        contentBytes: 4,
        template: 'Summarize: {{cursor}}',
      },
      {
        name: 'skill-without-template',
        description: 'A skill without a template field',
        content: 'body',
        filePath: '/tmp/skill-without-template/SKILL.md',
        contentLines: 1,
        contentBytes: 4,
      },
    ];
    skillState = {
      skills: skills,
      findByFilePath: () => undefined,
      markUsed: () => false,
      reload: async () => {},
    };
  });

  afterEach(async () => {
    if (server) {
      await new Promise<void>((r) => server!.close(() => r()));
      server = null;
    }
    rmSync(tmpDir, { recursive: true, force: true });
  });

  async function startSkillServer(): Promise<void> {
    server = createServer((req, res) => {
      const url = new URL(req.url ?? '/', 'http://localhost');
      handleSkillApi(
        req,
        res,
        url.pathname,
        skillState,
        AUTH_TOKEN,
        userStorage,
      );
    });
    await new Promise<void>((r) => server!.listen(0, '127.0.0.1', r));
    port = (server!.address() as { port: number }).port;
  }

  async function request(
    method: string,
    path: string,
    body?: unknown,
    headers?: Record<string, string>,
  ): Promise<{ status: number; body: any; headers: Headers }> {
    const url = `http://localhost:${port}${path}`;
    const init: RequestInit = {
      method,
      headers: { 'content-type': 'application/json', ...headers },
    };
    if (body !== undefined) init.body = JSON.stringify(body);
    const res = await fetch(url, init);
    const text = await res.text();
    let parsed: any = null;
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = text;
    }
    return { status: res.status, body: parsed, headers: res.headers };
  }

  it('无 auth → 401', async () => {
    await startSkillServer();
    const res = await request('GET', '/api/skills');
    expect(res.status).toBe(401);
    expect(res.body.error).toBeTruthy();
  });

  it('错误 token → 401', async () => {
    await startSkillServer();
    const res = await request('GET', '/api/skills', undefined, {
      authorization: 'Bearer wrong-token',
    });
    expect(res.status).toBe(401);
  });

  it('正确 auth → 200 + skills 数组含 name/description', async () => {
    await startSkillServer();
    const res = await request('GET', '/api/skills', undefined, {
      authorization: `Bearer ${aliceToken}`,
    });
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body).toHaveLength(2);
    // 每项含 name + description
    for (const item of res.body) {
      expect(typeof item.name).toBe('string');
      expect(typeof item.description).toBe('string');
    }
    const names = res.body.map((s: any) => s.name);
    expect(names).toContain('skill-with-template');
    expect(names).toContain('skill-without-template');
  });

  it('template 字段：有 template 的 skill 包含该字段，无则省略', async () => {
    await startSkillServer();
    const res = await request('GET', '/api/skills', undefined, {
      authorization: `Bearer ${aliceToken}`,
    });
    expect(res.status).toBe(200);
    const withTpl = res.body.find((s: any) => s.name === 'skill-with-template');
    const withoutTpl = res.body.find((s: any) => s.name === 'skill-without-template');
    expect(withTpl.template).toBe('Summarize: {{cursor}}');
    expect(withoutTpl.template).toBeUndefined();
  });

  it('不暴露内部字段（filePath / content / contentLines 等）', async () => {
    await startSkillServer();
    const res = await request('GET', '/api/skills', undefined, {
      authorization: `Bearer ${aliceToken}`,
    });
    expect(res.status).toBe(200);
    for (const item of res.body) {
      expect(item.filePath).toBeUndefined();
      expect(item.content).toBeUndefined();
      expect(item.contentLines).toBeUndefined();
      expect(item.contentBytes).toBeUndefined();
      expect(item.tags).toBeUndefined();
      expect(item.disableModelInvocation).toBeUndefined();
      expect(item.lastUsed).toBeUndefined();
    }
  });

  it('skillState 为空时返回空数组', async () => {
    skillState = {
      skills: [],
      findByFilePath: () => undefined,
      markUsed: () => false,
      reload: async () => {},
    };
    await startSkillServer();
    const res = await request('GET', '/api/skills', undefined, {
      authorization: `Bearer ${aliceToken}`,
    });
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it('未匹配子路径 → 404', async () => {
    await startSkillServer();
    const res = await request('GET', '/api/skills/unknown-subpath', undefined, {
      authorization: `Bearer ${aliceToken}`,
    });
    expect(res.status).toBe(404);
  });
});
