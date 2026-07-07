// @vitest-environment happy-dom
/**
 * Task 4 (React WebUI redesign): REST API 客户端单元测试。
 *
 * 通过 vi.stubGlobal('fetch', ...) 替换全局 fetch，验证：
 *   - bootstrap() 调用 GET /api/webui-bootstrap 并原样返回数据
 *   - listAgents() 调用 GET /api/agents 并返回数组
 *   - listSessions() 调用 GET /api/sessions 并返回数组（解包 { sessions: [] }）
 *   - deleteSession(id) 调用 DELETE /api/sessions/:id
 *   - renameSession(id, label) 调用 POST /api/sessions/:id/label
 *   - createAgent(data) 调用 POST /api/agents
 *   - updateAgent(slug, data) 调用 PUT /api/agents/:slug
 *   - deleteAgent(slug) 调用 DELETE /api/agents/:slug
 *   - 所有调用附带 credentials: 'include'
 *   - 非 2xx 响应抛错（含后端 error 字段）
 *
 * 后端约定（src/access/agent-api.ts、src/access/websocket-server.ts）：
 * - GET  /api/webui-bootstrap → BootstrapResponse（对象直接返回，无 wrapper）
 * - GET  /api/agents          → AgentProfile[]（数组直接返回）
 * - GET  /api/sessions        → { sessions: SessionMetadata[] }（wrapper 包裹）
 * - DELETE /api/sessions/:id  → { ok: true }
 * - POST /api/sessions/:id/label { label } → { ok: true, label }
 * - POST /api/agents          → AgentProfile（对象直接返回）
 * - PUT  /api/agents/:slug    → AgentProfile（对象直接返回）
 * - DELETE /api/agents/:slug  → { ok: true, archivedPath }
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { api } from '../../src/webui-react/lib/api.js';
import type { BootstrapResponse } from '../../src/webui-react/types.js';

/** 构造 fetch Response-like 对象（最小接口，匹配 api.ts 用到的字段） */
function makeResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

describe('api (REST client)', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn() as unknown as ReturnType<typeof vi.fn>;
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  describe('bootstrap', () => {
    it('调用 GET /api/webui-bootstrap 并附带 credentials: include', async () => {
      const payload: BootstrapResponse = {
        agents: [
          {
            slug: 'default',
            name: '通用智能体',
            description: '默认',
            personality: '',
            iconName: 'cpu',
            isCustom: false,
          },
        ],
        sessions: [
          {
            id: '11111111-1111-4111-8111-111111111111',
            agentId: 'default',
            label: '会话一',
            updatedAt: 1700000000000,
          },
        ],
        visibleSkills: [],
        skills: [],
        currentAgentSlug: 'default',
        currentSessionId: '11111111-1111-4111-8111-111111111111',
        model: 'gpt-4o-mini',
      };
      fetchMock.mockResolvedValueOnce(makeResponse(200, payload));

      const result = await api.bootstrap();

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe('/api/webui-bootstrap');
      expect(init.method).toBe('GET');
      expect(init.credentials).toBe('include');
      expect(result).toEqual(payload);
    });

    it('非 2xx 时抛错并包含后端 error', async () => {
      fetchMock.mockResolvedValueOnce(makeResponse(401, { error: 'unauthorized' }));

      await expect(api.bootstrap()).rejects.toThrow('unauthorized');
    });
  });

  describe('listAgents', () => {
    it('调用 GET /api/agents 并返回数组', async () => {
      const agents = [
        {
          slug: 'default',
          name: '通用智能体',
          description: '默认',
          personality: '',
          type: 'default',
          userId: 'u1',
          createdAt: 1,
          updatedAt: 2,
        },
        {
          slug: 'agent-a1b2c3',
          name: 'Python Pro',
          description: 'python expert',
          personality: '...',
          type: 'professional',
          userId: 'u1',
          createdAt: 3,
          updatedAt: 4,
        },
      ];
      fetchMock.mockResolvedValueOnce(makeResponse(200, agents));

      const result = await api.listAgents();

      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe('/api/agents');
      expect(init.method).toBe('GET');
      expect(init.credentials).toBe('include');
      expect(result).toEqual(agents);
    });

    it('非 2xx 时抛错', async () => {
      fetchMock.mockResolvedValueOnce(makeResponse(403, { ok: false, error: 'forbidden' }));
      await expect(api.listAgents()).rejects.toThrow('forbidden');
    });
  });

  describe('listSessions', () => {
    it('调用 GET /api/sessions 并从 { sessions } 中解包数组', async () => {
      const sessions = [
        {
          id: '22222222-2222-4222-8222-222222222222',
          agentId: 'default',
          preview: 'hello',
          updatedAt: 1700000000001,
        },
      ];
      fetchMock.mockResolvedValueOnce(makeResponse(200, { sessions }));

      const result = await api.listSessions();

      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe('/api/sessions');
      expect(init.method).toBe('GET');
      expect(init.credentials).toBe('include');
      expect(result).toEqual(sessions);
    });

    it('非 2xx 时抛错', async () => {
      fetchMock.mockResolvedValueOnce(makeResponse(401, { error: 'missing token' }));
      await expect(api.listSessions()).rejects.toThrow('missing token');
    });
  });

  describe('deleteSession', () => {
    it('调用 DELETE /api/sessions/:id', async () => {
      fetchMock.mockResolvedValueOnce(makeResponse(200, { ok: true }));

      await api.deleteSession('33333333-3333-4333-8333-333333333333');

      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe('/api/sessions/33333333-3333-4333-8333-333333333333');
      expect(init.method).toBe('DELETE');
      expect(init.credentials).toBe('include');
    });

    it('非 2xx 时抛错', async () => {
      fetchMock.mockResolvedValueOnce(makeResponse(404, { error: 'session not found' }));
      await expect(
        api.deleteSession('33333333-3333-4333-8333-333333333333'),
      ).rejects.toThrow('session not found');
    });
  });

  describe('renameSession', () => {
    it('调用 POST /api/sessions/:id/label 携带 JSON body { label }', async () => {
      fetchMock.mockResolvedValueOnce(makeResponse(200, { ok: true, label: '新名称' }));

      const result = await api.renameSession(
        '44444444-4444-4444-8444-444444444444',
        '新名称',
      );

      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe('/api/sessions/44444444-4444-4444-8444-444444444444/label');
      expect(init.method).toBe('POST');
      expect(init.credentials).toBe('include');
      expect(init.headers['content-type']).toBe('application/json');
      expect(JSON.parse(init.body)).toEqual({ label: '新名称' });
      expect(result).toEqual({ ok: true, label: '新名称' });
    });

    it('非 2xx 时抛错', async () => {
      fetchMock.mockResolvedValueOnce(
        makeResponse(400, { error: 'label must be a non-empty string' }),
      );
      await expect(
        api.renameSession('44444444-4444-4444-8444-444444444444', ''),
      ).rejects.toThrow('label must be a non-empty string');
    });
  });

  describe('createAgent', () => {
    it('调用 POST /api/agents 携带 JSON body', async () => {
      const created = {
        slug: 'agent-abc123',
        name: 'Python Pro',
        description: 'python expert',
        personality: '...',
        type: 'professional',
        userId: 'u1',
        createdAt: 5,
        updatedAt: 5,
      };
      fetchMock.mockResolvedValueOnce(makeResponse(200, created));

      const result = await api.createAgent({
        name: 'Python Pro',
        description: 'python expert',
        personality: '...',
      });

      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe('/api/agents');
      expect(init.method).toBe('POST');
      expect(init.credentials).toBe('include');
      expect(init.headers['content-type']).toBe('application/json');
      expect(JSON.parse(init.body)).toEqual({
        name: 'Python Pro',
        description: 'python expert',
        personality: '...',
      });
      expect(result).toEqual(created);
    });

    it('非 2xx 时抛错', async () => {
      fetchMock.mockResolvedValueOnce(
        makeResponse(400, { ok: false, error: 'name must be a non-empty string' }),
      );
      await expect(
        api.createAgent({ name: '', description: 'x', personality: '' }),
      ).rejects.toThrow('name must be a non-empty string');
    });
  });

  describe('updateAgent', () => {
    it('调用 PUT /api/agents/:slug 携带 JSON body', async () => {
      const updated = {
        slug: 'agent-abc123',
        name: 'Python Pro v2',
        description: 'python expert',
        personality: '...',
        type: 'professional',
        userId: 'u1',
        createdAt: 5,
        updatedAt: 6,
      };
      fetchMock.mockResolvedValueOnce(makeResponse(200, updated));

      const result = await api.updateAgent('agent-abc123', {
        name: 'Python Pro v2',
      });

      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe('/api/agents/agent-abc123');
      expect(init.method).toBe('PUT');
      expect(init.credentials).toBe('include');
      expect(init.headers['content-type']).toBe('application/json');
      expect(JSON.parse(init.body)).toEqual({ name: 'Python Pro v2' });
      expect(result).toEqual(updated);
    });

    it('非 2xx 时抛错', async () => {
      fetchMock.mockResolvedValueOnce(
        makeResponse(404, { ok: false, error: 'agent not found' }),
      );
      await expect(
        api.updateAgent('agent-missing', { name: 'x' }),
      ).rejects.toThrow('agent not found');
    });
  });

  describe('deleteAgent', () => {
    it('调用 DELETE /api/agents/:slug', async () => {
      fetchMock.mockResolvedValueOnce(
        makeResponse(200, { ok: true, archivedPath: '/data/archived/...' }),
      );

      await api.deleteAgent('agent-abc123');

      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe('/api/agents/agent-abc123');
      expect(init.method).toBe('DELETE');
      expect(init.credentials).toBe('include');
    });

    it('删除 default agent 时抛错（后端 403）', async () => {
      fetchMock.mockResolvedValueOnce(
        makeResponse(403, { ok: false, error: 'default agent cannot be deleted' }),
      );
      await expect(api.deleteAgent('default')).rejects.toThrow(
        'default agent cannot be deleted',
      );
    });
  });
});
