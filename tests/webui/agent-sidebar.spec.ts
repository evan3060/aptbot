// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from 'vitest';
import '../../src/webui/components/agent-sidebar.js';
import '../../src/webui/components/agent-node.js';
import '../../src/webui/components/session-node.js';
import type { AgentSidebar } from '../../src/webui/components/agent-sidebar.js';
import type { AgentNode } from '../../src/webui/components/agent-node.js';
import type { SessionNode } from '../../src/webui/components/session-node.js';
import type { AgentProfile } from '../../src/core/agent/agent-profile.js';
import type { SessionMetadata } from '../../src/core/memory/types.js';

/**
 * §0.3.0 Task 13: WebUI 左侧栏树形结构测试
 *
 * 验证 7 个 brief 场景：
 * 1. 渲染多个 agent 节点
 * 2. agent 节点默认展开（子会话可见）
 * 3. 点击 agent 名切换展开/折叠
 * 4. 点击 ⚙️ 触发 settings-click 事件
 * 5. 点击 session 触发 session-click 事件
 * 6. 当前 agent + session 高亮
 * 7. 「+ 新建会话」+「+ 新建专业 agent」按钮存在
 */

async function settled(el: HTMLElement): Promise<void> {
  await (el as unknown as { updateComplete?: Promise<unknown> }).updateComplete;
  await new Promise((r) => setTimeout(r, 0));
}

async function waitFor<T>(fn: () => T, timeout = 1000): Promise<T> {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    try {
      return fn();
    } catch {
      await new Promise((r) => setTimeout(r, 10));
    }
  }
  return fn();
}

function makeAgent(overrides: Partial<AgentProfile> = {}): AgentProfile {
  return {
    name: 'Default Assistant',
    description: 'General purpose assistant',
    userId: 'user-1',
    type: 'default',
    slug: 'default',
    createdAt: 1700000000000,
    updatedAt: 1700000000000,
    personality: '',
    ...overrides,
  };
}

function makeSession(overrides: Partial<SessionMetadata> = {}): SessionMetadata {
  return {
    id: 'sess-1',
    createdAt: 1700000000000,
    updatedAt: 1700000000000,
    agentId: 'default',
    label: 'My session',
    ...overrides,
  };
}

describe('Task 13: <agent-sidebar> 左侧栏树形结构', () => {
  let sidebar: AgentSidebar;

  beforeEach(() => {
    document.body.innerHTML = '';
    sidebar = document.createElement('agent-sidebar') as AgentSidebar;
    document.body.appendChild(sidebar);
  });

  it('渲染多个 agent 节点', async () => {
    const agents: AgentProfile[] = [
      makeAgent({ slug: 'default', name: '通用助手' }),
      makeAgent({ slug: 'agent-abc123', name: '代码助手', type: 'professional' }),
      makeAgent({ slug: 'agent-xyz789', name: '写作助手', type: 'professional' }),
    ];
    sidebar.agents = agents;
    sidebar.sessions = [];
    await settled(sidebar);

    const agentNodes = sidebar.shadowRoot?.querySelectorAll('agent-node');
    expect(agentNodes?.length).toBe(3);
    const names = Array.from(agentNodes ?? []).map((n) =>
      (n.shadowRoot?.textContent ?? '').includes('通用助手'),
    );
    expect(names.filter(Boolean).length).toBe(1);
  });

  it('agent 节点默认展开子会话', async () => {
    const agents: AgentProfile[] = [
      makeAgent({ slug: 'default', name: '通用助手' }),
    ];
    const sessions: SessionMetadata[] = [
      makeSession({ id: 'sess-1', agentId: 'default', label: '会话 A' }),
      makeSession({ id: 'sess-2', agentId: 'default', label: '会话 B' }),
    ];
    sidebar.agents = agents;
    sidebar.sessions = sessions;
    await settled(sidebar);

    const agentNode = sidebar.shadowRoot?.querySelector('agent-node') as AgentNode;
    expect(agentNode).toBeTruthy();
    await settled(agentNode);

    // 默认 expanded=true，子会话可见
    expect(agentNode.expanded).toBe(true);
    const sessionNodes = agentNode.shadowRoot?.querySelectorAll('session-node');
    expect(sessionNodes?.length).toBe(2);
  });

  it('点击 agent 名切换展开/折叠（dispatch agent-click）', async () => {
    const agents: AgentProfile[] = [
      makeAgent({ slug: 'default', name: '通用助手' }),
    ];
    sidebar.agents = agents;
    sidebar.sessions = [];
    await settled(sidebar);

    const agentNode = sidebar.shadowRoot?.querySelector('agent-node') as AgentNode;
    await settled(agentNode);
    expect(agentNode.expanded).toBe(true);

    let clickedSlug = '';
    let clickedExpanded = false;
    sidebar.addEventListener('agent-click', (e: Event) => {
      const detail = (e as CustomEvent).detail as { slug: string; expanded: boolean };
      clickedSlug = detail.slug;
      clickedExpanded = detail.expanded;
    });

    const nameEl = agentNode.shadowRoot?.querySelector('.agent-name') as HTMLElement;
    expect(nameEl).toBeTruthy();
    nameEl.click();
    await settled(agentNode);

    await waitFor(() => {
      if (!clickedSlug) throw new Error('not yet');
    });
    expect(clickedSlug).toBe('default');
    // 点击后 expanded=false（切换到折叠）
    expect(clickedExpanded).toBe(false);
  });

  it('点击 ⚙️ 触发 settings-click 事件', async () => {
    const agents: AgentProfile[] = [
      makeAgent({ slug: 'default', name: '通用助手' }),
    ];
    sidebar.agents = agents;
    sidebar.sessions = [];
    await settled(sidebar);

    const agentNode = sidebar.shadowRoot?.querySelector('agent-node') as AgentNode;
    await settled(agentNode);

    let clickedSlug = '';
    sidebar.addEventListener('settings-click', (e: Event) => {
      const detail = (e as CustomEvent).detail as { slug: string };
      clickedSlug = detail.slug;
    });

    const settingsBtn = agentNode.shadowRoot?.querySelector('.settings-btn') as HTMLElement;
    expect(settingsBtn).toBeTruthy();
    settingsBtn.click();

    await waitFor(() => {
      if (!clickedSlug) throw new Error('not yet');
    });
    expect(clickedSlug).toBe('default');
  });

  it('点击 session 触发 session-click 事件', async () => {
    const agents: AgentProfile[] = [
      makeAgent({ slug: 'default', name: '通用助手' }),
    ];
    const sessions: SessionMetadata[] = [
      makeSession({ id: 'sess-1', agentId: 'default', label: '会话 A' }),
    ];
    sidebar.agents = agents;
    sidebar.sessions = sessions;
    await settled(sidebar);

    const agentNode = sidebar.shadowRoot?.querySelector('agent-node') as AgentNode;
    await settled(agentNode);

    let clickedSessionId = '';
    sidebar.addEventListener('session-click', (e: Event) => {
      const detail = (e as CustomEvent).detail as { sessionId: string };
      clickedSessionId = detail.sessionId;
    });

    const sessionNode = agentNode.shadowRoot?.querySelector('session-node') as SessionNode;
    expect(sessionNode).toBeTruthy();
    await settled(sessionNode);

    const sessionEl = sessionNode.shadowRoot?.querySelector('.session-item') as HTMLElement;
    expect(sessionEl).toBeTruthy();
    sessionEl.click();

    await waitFor(() => {
      if (!clickedSessionId) throw new Error('not yet');
    });
    expect(clickedSessionId).toBe('sess-1');
  });

  it('当前 agent + session 高亮', async () => {
    const agents: AgentProfile[] = [
      makeAgent({ slug: 'default', name: '通用助手' }),
      makeAgent({ slug: 'agent-abc', name: '代码助手', type: 'professional' }),
    ];
    const sessions: SessionMetadata[] = [
      makeSession({ id: 'sess-1', agentId: 'default', label: '默认会话' }),
      makeSession({ id: 'sess-2', agentId: 'agent-abc', label: '代码会话' }),
    ];
    sidebar.agents = agents;
    sidebar.sessions = sessions;
    sidebar.currentAgentSlug = 'agent-abc';
    sidebar.currentSessionId = 'sess-2';
    await settled(sidebar);

    const agentNodes = sidebar.shadowRoot?.querySelectorAll('agent-node') ?? [];
    expect(agentNodes.length).toBe(2);
    const codeAgent = Array.from(agentNodes).find((n) => {
      const an = n as AgentNode;
      return an.agent?.slug === 'agent-abc';
    }) as AgentNode;
    expect(codeAgent).toBeTruthy();
    await settled(codeAgent);
    // 当前 agent 高亮
    expect(codeAgent.shadowRoot?.querySelector('.agent-row.active')).toBeTruthy();

    const sessionNode = codeAgent.shadowRoot?.querySelector('session-node') as SessionNode;
    await settled(sessionNode);
    // 当前 session 高亮
    expect(sessionNode.shadowRoot?.querySelector('.session-item.active')).toBeTruthy();
  });

  it('「+ 新建会话」+「+ 新建专业 agent」按钮存在', async () => {
    const agents: AgentProfile[] = [
      makeAgent({ slug: 'default', name: '通用助手' }),
    ];
    sidebar.agents = agents;
    sidebar.sessions = [];
    await settled(sidebar);

    // + 新建专业 agent 按钮（在 sidebar 底部）
    const newAgentBtn = sidebar.shadowRoot?.querySelector('.new-agent-btn') as HTMLElement;
    expect(newAgentBtn).toBeTruthy();
    expect(newAgentBtn.textContent).toContain('新建专业 agent');

    // + 新建会话 按钮（在每个 agent-node 下）
    const agentNode = sidebar.shadowRoot?.querySelector('agent-node') as AgentNode;
    await settled(agentNode);
    const newSessionBtn = agentNode.shadowRoot?.querySelector('.new-session-btn') as HTMLElement;
    expect(newSessionBtn).toBeTruthy();
    expect(newSessionBtn.textContent).toContain('新建会话');
  });

  it('点击「+ 新建会话」触发 new-session-click 事件', async () => {
    const agents: AgentProfile[] = [
      makeAgent({ slug: 'default', name: '通用助手' }),
    ];
    sidebar.agents = agents;
    sidebar.sessions = [];
    await settled(sidebar);

    const agentNode = sidebar.shadowRoot?.querySelector('agent-node') as AgentNode;
    await settled(agentNode);

    let clickedSlug = '';
    sidebar.addEventListener('new-session-click', (e: Event) => {
      const detail = (e as CustomEvent).detail as { slug: string };
      clickedSlug = detail.slug;
    });

    const newSessionBtn = agentNode.shadowRoot?.querySelector('.new-session-btn') as HTMLElement;
    newSessionBtn.click();

    await waitFor(() => {
      if (!clickedSlug) throw new Error('not yet');
    });
    expect(clickedSlug).toBe('default');
  });

  it('点击「+ 新建专业 agent」触发 new-agent-click 事件', async () => {
    const agents: AgentProfile[] = [
      makeAgent({ slug: 'default', name: '通用助手' }),
    ];
    sidebar.agents = agents;
    sidebar.sessions = [];
    await settled(sidebar);

    let clicked = false;
    sidebar.addEventListener('new-agent-click', () => {
      clicked = true;
    });

    const newAgentBtn = sidebar.shadowRoot?.querySelector('.new-agent-btn') as HTMLElement;
    newAgentBtn.click();

    await waitFor(() => {
      if (!clicked) throw new Error('not yet');
    });
    expect(clicked).toBe(true);
  });

  it('sessions 按 агентId 分组（仅显示当前 agent 的会话）', async () => {
    const agents: AgentProfile[] = [
      makeAgent({ slug: 'default', name: '通用助手' }),
      makeAgent({ slug: 'agent-abc', name: '代码助手', type: 'professional' }),
    ];
    const sessions: SessionMetadata[] = [
      makeSession({ id: 'sess-1', agentId: 'default', label: '默认会话 1' }),
      makeSession({ id: 'sess-2', agentId: 'default', label: '默认会话 2' }),
      makeSession({ id: 'sess-3', agentId: 'agent-abc', label: '代码会话 1' }),
    ];
    sidebar.agents = agents;
    sidebar.sessions = sessions;
    await settled(sidebar);

    const agentNodes = sidebar.shadowRoot?.querySelectorAll('agent-node') ?? [];
    expect(agentNodes.length).toBe(2);

    const defaultNode = Array.from(agentNodes).find((n) => {
      const an = n as AgentNode;
      return an.agent?.slug === 'default';
    }) as AgentNode;
    await settled(defaultNode);
    const defaultSessionNodes = defaultNode.shadowRoot?.querySelectorAll('session-node') ?? [];
    expect(defaultSessionNodes.length).toBe(2);

    const codeNode = Array.from(agentNodes).find((n) => {
      const an = n as AgentNode;
      return an.agent?.slug === 'agent-abc';
    }) as AgentNode;
    await settled(codeNode);
    const codeSessionNodes = codeNode.shadowRoot?.querySelectorAll('session-node') ?? [];
    expect(codeSessionNodes.length).toBe(1);
  });

  it('<session-node> 显示 agentId 归属（0.3.0 新增）', async () => {
    const sessionNode = document.createElement('session-node') as SessionNode;
    sessionNode.session = makeSession({
      id: 'sess-1',
      agentId: 'agent-abc',
      label: '代码会话',
    });
    sessionNode.agentSlug = 'agent-abc';
    document.body.appendChild(sessionNode);
    await settled(sessionNode);

    // 应包含 agentId 归属视觉标识
    expect(sessionNode.shadowRoot?.textContent).toContain('agent-abc');
  });

  it('<session-node> 沿用 0.2.x 行为：label / preview fallback / relative time', async () => {
    const sessionNode = document.createElement('session-node') as SessionNode;
    sessionNode.session = makeSession({
      id: 'abc12345-6789-4def-8abc-def012345678',
      agentId: 'default',
      label: '会话标题',
      updatedAt: Date.now() - 5 * 60 * 1000, // 5 分钟前
    });
    document.body.appendChild(sessionNode);
    await settled(sessionNode);

    // label 显示
    expect(sessionNode.shadowRoot?.textContent).toContain('会话标题');
    // relative time 显示
    expect(sessionNode.shadowRoot?.textContent).toContain('5 分钟前');
  });

  it('<session-node> 无 label 时 fallback 到 preview / short id', async () => {
    const sessionNode = document.createElement('session-node') as SessionNode;
    sessionNode.session = makeSession({
      id: 'abc12345-6789-4def-8abc-def012345678',
      agentId: 'default',
      label: undefined,
      preview: '用户首条消息摘要',
      updatedAt: Date.now(),
    });
    document.body.appendChild(sessionNode);
    await settled(sessionNode);

    expect(sessionNode.shadowRoot?.textContent).toContain('用户首条消息摘要');
  });
});
