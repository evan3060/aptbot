/**
 * Task 4 (React WebUI redesign): REST API 客户端。
 *
 * 封装所有与 aptbot 后端的 REST 交互。所有调用统一 `credentials: 'include'`，
 * 让浏览器自动携带 HttpOnly cookie（与 src/webui-react/lib/auth.ts 一致）。
 *
 * 后端约定（src/access/agent-api.ts、src/access/websocket-server.ts）：
 * - GET    /api/webui-bootstrap              → BootstrapResponse（对象直接返回）
 * - GET    /api/agents                       → AgentProfile[]（数组直接返回）
 * - GET    /api/sessions                     → { sessions: SessionMetadata[] }（wrapper 包裹）
 * - DELETE /api/sessions/:id                → { ok: true }
 * - POST   /api/sessions/:id/label { label } → { ok: true, label }
 * - POST   /api/agents                       → AgentProfile
 * - PUT    /api/agents/:slug                 → AgentProfile
 * - DELETE /api/agents/:slug                 → { ok: true, archivedPath }
 *
 * 错误处理：非 2xx 时读取响应体 `error` 字段（与后端 sendJson({ error }) 约定一致）；
 * 若响应体无 `error` 字段则回退到 HTTP 状态文本。
 */
import type {
  AgentProfile,
  BootstrapResponse,
  SessionMetadata,
} from '../types.js';

/** createAgent 请求体（仅前端必填字段，后端会补充 slug / userId / type / 时间戳） */
export interface CreateAgentRequest {
  name: string;
  description: string;
  personality: string;
  model?: string;
  temperature?: number;
  maxTokens?: number;
  reasoningEffort?: string;
  thinkingType?: string;
  thinkingBudgetTokens?: number;
}

/** updateAgent 请求体（部分字段，与后端 PUT 一致；slug 不可改） */
export interface UpdateAgentRequest {
  name?: string;
  description?: string;
  personality?: string;
  model?: string;
  temperature?: number;
  maxTokens?: number;
  reasoningEffort?: string;
  thinkingType?: string;
  thinkingBudgetTokens?: number;
}

/** renameSession 成功响应体 */
interface RenameSessionResponse {
  ok: true;
  label: string;
}

/** deleteAgent 成功响应体 */
interface DeleteAgentResponse {
  ok: true;
  archivedPath?: string;
}

/**
 * 从非 2xx 响应中提取 error 文本。
 *
 * 后端约定 `sendJson(status, { error: '...' })`，少数端点使用 `{ ok: false, error: '...' }`，
 * 两种形态都覆盖。若响应体无 `error` 字段，回退到 HTTP 状态文本。
 */
async function extractError(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { error?: string; ok?: boolean };
    if (typeof body.error === 'string' && body.error.length > 0) {
      return body.error;
    }
  } catch {
    // 响应体非 JSON 或为空 → 回退到 statusText
  }
  return res.statusText || `request failed with status ${res.status}`;
}

export const api = {
  /** GET /api/webui-bootstrap — 一次性获取 agents/sessions/skills/currentSessionId/model */
  async bootstrap(): Promise<BootstrapResponse> {
    const res = await fetch('/api/webui-bootstrap', {
      method: 'GET',
      credentials: 'include',
    });
    if (!res.ok) {
      throw new Error(await extractError(res));
    }
    return (await res.json()) as BootstrapResponse;
  },

  /** GET /api/agents — 当前用户的所有 agent */
  async listAgents(): Promise<AgentProfile[]> {
    const res = await fetch('/api/agents', {
      method: 'GET',
      credentials: 'include',
    });
    if (!res.ok) {
      throw new Error(await extractError(res));
    }
    return (await res.json()) as AgentProfile[];
  },

  /** GET /api/sessions — 当前用户的所有 session（解包 `{ sessions }` wrapper） */
  async listSessions(): Promise<SessionMetadata[]> {
    const res = await fetch('/api/sessions', {
      method: 'GET',
      credentials: 'include',
    });
    if (!res.ok) {
      throw new Error(await extractError(res));
    }
    const body = (await res.json()) as { sessions: SessionMetadata[] };
    return body.sessions;
  },

  /** DELETE /api/sessions/:id — 删除 session（后端会触发 session_deleted 广播） */
  async deleteSession(id: string): Promise<void> {
    const res = await fetch(`/api/sessions/${id}`, {
      method: 'DELETE',
      credentials: 'include',
    });
    if (!res.ok) {
      throw new Error(await extractError(res));
    }
  },

  /** POST /api/sessions/:id/label — 重命名 session（后端会触发 session_renamed 广播） */
  async renameSession(id: string, label: string): Promise<RenameSessionResponse> {
    const res = await fetch(`/api/sessions/${id}/label`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ label }),
    });
    if (!res.ok) {
      throw new Error(await extractError(res));
    }
    return (await res.json()) as RenameSessionResponse;
  },

  /** POST /api/agents — 创建新 agent（slug 由后端生成） */
  async createAgent(data: CreateAgentRequest): Promise<AgentProfile> {
    const res = await fetch('/api/agents', {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(data),
    });
    if (!res.ok) {
      throw new Error(await extractError(res));
    }
    return (await res.json()) as AgentProfile;
  },

  /** PUT /api/agents/:slug — 更新 agent（部分字段，slug 不可改） */
  async updateAgent(slug: string, data: UpdateAgentRequest): Promise<AgentProfile> {
    const res = await fetch(`/api/agents/${slug}`, {
      method: 'PUT',
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(data),
    });
    if (!res.ok) {
      throw new Error(await extractError(res));
    }
    return (await res.json()) as AgentProfile;
  },

  /** DELETE /api/agents/:slug — 归档删除（default agent 不可删，后端返回 403） */
  async deleteAgent(slug: string): Promise<DeleteAgentResponse> {
    const res = await fetch(`/api/agents/${slug}`, {
      method: 'DELETE',
      credentials: 'include',
    });
    if (!res.ok) {
      throw new Error(await extractError(res));
    }
    return (await res.json()) as DeleteAgentResponse;
  },
};
