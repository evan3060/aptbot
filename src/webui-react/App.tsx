/**
 * Task 9 (React WebUI redesign): App 主入口 + 状态管理 + 路由组装。
 *
 * 组合所有 Task 1-8 产生的组件和 lib 模块，管理全局状态：
 * - auth 状态（AuthController）— 未登录时显示 AuthModal
 * - ws 状态（WsClient）— 登录后建立 WebSocket 连接
 * - messages 状态 — 本地维护的消息列表（user + assistant），处理 WebSocket 事件
 * - ui 状态（reducer）— 处理 toolCalls 和 isWorking（reducer.messages 不使用）
 * - agents / sessions 状态 — 来自 api.bootstrap()
 * - activeAgentSlug / activeSessionId 状态 — 当前选中
 * - connectionState 状态 — WebSocket 连接状态（用于 FooterBar）
 *
 * 关键设计决策：
 * - messages 在 App.tsx 本地维护（不使用 reducer.messages），因为 reducer 的
 *   user_message case 是 no-op（设计意图："用户消息在 send 时本地渲染"）。
 *   本地维护保证了 user/assistant 消息的正确交错顺序与跨客户端同步去重。
 * - reducer 仍用于 toolCalls 和 isWorking 跟踪（dispatch 所有 AgentEvent）。
 * - WsClient 的 session_changed 事件由 WsClient 自动重连；App.tsx 仅更新 UI 状态
 *   （activeSessionId、清空 messages、刷新 session 列表）。
 * - ToolCallView 在 ChatArea 下方独立面板渲染（ChatArea 不接受 toolCalls prop，
 *   修改 ChatArea 超出 Task 9 范围）。
 */
import { useEffect, useReducer, useRef, useState, useMemo } from 'react';
import { authController } from './lib/auth.js';
import { WsClient } from './lib/ws-client.js';
import { uiReducer, initialUiState } from './lib/reducer.js';
import type { Message } from './lib/reducer.js';
import { api } from './lib/api.js';
import { useIsDesktop } from './lib/use-media-query.js';
import type {
  AgentProfile,
  AgentEvent,
  AuthUser,
  ModelOption,
  SessionMetadata,
} from './types.js';
import AuthModal from './components/AuthModal.js';
import Sidebar from './components/Sidebar.js';
import ChatArea from './components/ChatArea.js';
import InputArea from './components/InputArea.js';
import AgentModals from './components/AgentModals.js';
import MemoryToast from './components/MemoryToast.js';
import FooterBar, { type ConnectionState } from './components/FooterBar.js';

/** 本地生成短随机 ID（用于乐观 user 消息，避免与 server UUID 冲突） */
function localId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/** 格式化时间戳为 HH:MM:SS */
function formatTime(ts: number | Date): string {
  const d = ts instanceof Date ? ts : new Date(ts);
  return d.toLocaleTimeString();
}

export default function App() {
  // --- Auth state ---
  const [authChecked, setAuthChecked] = useState(false);
  const [currentUser, setCurrentUser] = useState<AuthUser | null>(null);
  const [authModalOpen, setAuthModalOpen] = useState(false);

  // --- App state (from bootstrap) ---
  const [agents, setAgents] = useState<AgentProfile[]>([]);
  const [sessions, setSessions] = useState<SessionMetadata[]>([]);
  const [activeAgentSlug, setActiveAgentSlug] = useState('default');
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [model, setModel] = useState<string>('');

  // --- WebSocket connection state ---
  const [connectionState, setConnectionState] = useState<ConnectionState>('closed');

  // --- Messages state (local; reducer.messages unused — see file header) ---
  const [messages, setMessages] = useState<Message[]>([]);

  // --- Reducer for toolCalls and isWorking ---
  const [ui, dispatch] = useReducer(uiReducer, initialUiState);

  // --- Agent modal state ---
  const [isCreateAgentOpen, setIsCreateAgentOpen] = useState(false);
  const [isEditAgentOpen, setIsEditAgentOpen] = useState(false);
  const [editingAgent, setEditingAgent] = useState<AgentProfile | null>(null);

  // §0.3.0 UAT: 新会话选择器 — 点击"新会话"时显示智能体选择卡片
  const [showNewSessionPicker, setShowNewSessionPicker] = useState(false);

  // --- §0.3.1 mobile adaptation: sidebar drawer state ---
  const isDesktop = useIsDesktop();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const wsRef = useRef<WsClient | null>(null);

  // §0.3.0 UAT Bug H fix: 跟踪 pending message id。
  // message_start 时只记录 id，不创建消息；message_delta 时才创建消息（避免空消息框出现又消失）。
  const pendingMessageIdRef = useRef<string | null>(null);

  // §0.3.0 UAT Bug N fix: 用户在 NewSessionPicker 状态下直接输入消息时，
  // 先创建新会话（/agent default + /new），消息暂存到 pendingUserMessage，
  // session_changed 后自动发送。
  const pendingUserMessageRef = useRef<{ content: string; files?: { name: string; size: string }[] } | null>(null);

  // --- Derived values ---
  const activeAgent = useMemo(
    () => agents.find((a) => a.slug === activeAgentSlug) || null,
    [agents, activeAgentSlug],
  );

  const selectedModel: ModelOption = useMemo(
    () => ({ id: model, name: model, backendModel: model }),
    [model],
  );
  const models: ModelOption[] = useMemo(() => [selectedModel], [selectedModel]);

  // =========================================================================
  // Auth + Bootstrap flow
  // =========================================================================

  useEffect(() => {
    let isMounted = true;
    (async () => {
      const user = await authController.fetchMe();
      if (!isMounted) return;
      if (user) {
        setCurrentUser(user);
        await bootstrap();
      } else {
        setAuthModalOpen(true);
      }
      setAuthChecked(true);
    })();
    return () => {
      isMounted = false;
      wsRef.current?.close();
      wsRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // =========================================================================
  // §0.3.1 mobile adaptation: sidebar drawer effects
  // =========================================================================

  // Body scroll lock: when sidebar drawer is open on mobile, prevent body scroll
  useEffect(() => {
    if (sidebarOpen && !isDesktop) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [sidebarOpen, isDesktop]);

  // Esc key closes sidebar drawer when open
  useEffect(() => {
    if (!sidebarOpen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setSidebarOpen(false);
    };
    window.addEventListener('keydown', handler);
    return () => {
      window.removeEventListener('keydown', handler);
    };
  }, [sidebarOpen]);

  const bootstrap = async () => {
    try {
      const data = await api.bootstrap();
      setAgents(data.agents);
      setSessions(data.sessions);
      setActiveAgentSlug(data.currentAgentSlug || 'default');
      setActiveSessionId(data.currentSessionId);
      setModel(data.model);
      connectWs(data.currentSessionId);
    } catch (err) {
      console.error('[App] bootstrap failed', err);
    }
  };

  const loadAgentsAndSessions = async () => {
    try {
      const [ags, sess] = await Promise.all([api.listAgents(), api.listSessions()]);
      setAgents(ags);
      setSessions(sess);
    } catch (err) {
      console.error('[App] loadAgentsAndSessions failed', err);
    }
  };

  // =========================================================================
  // WebSocket connection + event handlers
  // =========================================================================

  const connectWs = (sessionId: string) => {
    if (!authController.token || !sessionId) return;

    // Close existing connection (stops auto-reconnect)
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }

    const ws = new WsClient();
    wsRef.current = ws;
    setConnectionState('connecting');

    ws.on('open', () => setConnectionState('open'));
    ws.on('close', () => setConnectionState('closed'));
    ws.on('event', (payload) => {
      const event = payload as AgentEvent;
      // Dispatch to reducer for toolCalls + isWorking tracking
      dispatch(event);
      // Also handle message events locally for display
      handleMessageEvent(event);
      // turn_end → refresh session list (memory constraint:
      // "Session list must refresh after turn_end to display new session with preview")
      // First user message in a new session generates the session entry + preview
      // server-side after the turn completes; frontend must re-fetch to display it.
      if (event.type === 'turn_end') {
        void loadAgentsAndSessions();
      }
    });
    ws.on('replay', (payload) => handleReplay(payload));
    ws.on('session_changed', (payload) => handleSessionChanged(payload));
    ws.on('session_renamed', (payload) => {
      const msg = payload as { type: 'session_renamed'; sessionId: string; label: string };
      setSessions((prev) =>
        prev.map((s) => (s.id === msg.sessionId ? { ...s, label: msg.label } : s)),
      );
    });
    ws.on('session_deleted', (payload) => {
      const msg = payload as { type: 'session_deleted'; sessionId: string };
      setSessions((prev) => prev.filter((s) => s.id !== msg.sessionId));
    });
    ws.on('error', (payload) => {
      const msg = payload as { type: 'error'; code: string; message: string };
      console.error('[App] ws error:', msg.code, msg.message);
      // session_ownership_mismatch: 当前 sessionKey 属于其他用户（可能是切换用户后缓存过期）。
      // 重新 bootstrap 获取当前用户的有效 sessionId，然后重连。
      if (msg.code === 'session_ownership_mismatch') {
        void bootstrap();
      }
    });

    ws.connect(authController.token, sessionId);
  };

  /**
   * Handle AgentEvent for messages (local state).
   * Reducer already receives the event for toolCalls/isWorking; this function
   * mirrors the message-specific logic to maintain the local messages array.
   */
  const handleMessageEvent = (event: AgentEvent) => {
    switch (event.type) {
      case 'message_start':
        // §0.3.0 UAT Bug H fix: 不在 message_start 时创建消息。
        // 只记录 pending messageId，等 message_delta 有实际文本时才创建消息。
        // 这样工具调用轮次（无文本输出）不会产生空消息框。
        pendingMessageIdRef.current = event.messageId;
        break;
      case 'message_delta': {
        // §0.3.0 UAT Bug H/K fix: 只在 event.text 非空时才创建/追加消息
        // 避免空 delta 创建空消息框
        if (!event.text) break;
        setMessages((prev) => {
          // Find last assistant message and append text
          let lastAssistantIndex = -1;
          for (let i = prev.length - 1; i >= 0; i--) {
            if (prev[i].role === 'assistant') {
              lastAssistantIndex = i;
              break;
            }
          }
          // If no existing assistant message or the last one is not the pending message,
          // create a new message (this is the first delta for this message)
          if (lastAssistantIndex === -1 ||
            (pendingMessageIdRef.current && prev[lastAssistantIndex].id !== pendingMessageIdRef.current)) {
            return [
              ...prev,
              {
                id: pendingMessageIdRef.current ?? localId('m'),
                role: 'assistant',
                text: event.text,
                isStreaming: true,
                timestamp: formatTime(new Date()),
              },
            ];
          }
          return prev.map((m, i) =>
            i === lastAssistantIndex ? { ...m, text: m.text + event.text } : m,
          );
        });
        break;
      }
      case 'message_end':
        // §0.3.0 UAT Bug H fix: 清除 pending messageId。
        // 如果消息从未被创建（工具调用轮次无文本），不做任何操作 — 不会有空消息框。
        // 如果消息已存在，标记为非 streaming。
        pendingMessageIdRef.current = null;
        setMessages((prev) =>
          prev.map((m) =>
            m.id === event.messageId ? { ...m, isStreaming: false } : m,
          ),
        );
        break;
      case 'user_message':
        // Cross-client sync: dedup against last optimistic user message
        setMessages((prev) => {
          const last = prev[prev.length - 1];
          if (last && last.role === 'user' && last.text === event.text) {
            return prev; // Skip — already added optimistically at send time
          }
          return [
            ...prev,
            {
              id: localId('user'),
              role: 'user',
              text: event.text,
              timestamp: formatTime(new Date()),
            },
          ];
        });
        break;
      default:
        // Other events (tool_call_*, turn_*, reasoning_*) handled by reducer only
        break;
    }
  };

  /**
   * Handle replay message — load historical messages.
   * Supports two formats:
   * 1. JSONL (source: 'jsonl'): { id, role, content, timestamp, replay }
   * 2. Ring buffer: { kind: 'inbound'|'outbound', timestamp, content?/event?, seq? }
   */
  const handleReplay = (payload: unknown) => {
    const msg = payload as { type: 'replay'; messages: unknown[]; source?: string };
    // Clear local messages + reducer state before loading replay
    setMessages([]);
    dispatch({ type: 'clear' });
    pendingMessageIdRef.current = null;

    for (const m of msg.messages) {
      if (typeof m !== 'object' || m === null) continue;

      // JSONL format: { id, role, content, timestamp, replay, toolCalls? }
      if ('role' in m && 'content' in m) {
        const rm = m as {
          id: string;
          role: 'user' | 'assistant';
          content: string;
          timestamp: number;
          toolCalls?: Array<{
            id: string;
            name: string;
            arguments: string;
            status: 'running' | 'success' | 'failed';
            summary?: string;
          }>;
        };
        setMessages((prev) => [
          ...prev,
          {
            id: rm.id,
            role: rm.role,
            text: rm.content,
            timestamp: formatTime(rm.timestamp),
            // §0.3.0 UAT Bug M fix: 保留历史消息的工具调用记录
            toolCalls: rm.toolCalls,
          },
        ]);
      }
      // Ring buffer format: { kind, timestamp, content?/event? }
      else if ('kind' in m) {
        const rm = m as {
          kind: string;
          timestamp: number;
          content?: string;
          event?: AgentEvent;
        };
        if (rm.kind === 'inbound' && typeof rm.content === 'string') {
          // Capture narrowed value — typeof guard doesn't persist into setMessages closure
          const content = rm.content;
          setMessages((prev) => [
            ...prev,
            {
              id: `replay-user-${rm.timestamp}`,
              role: 'user',
              text: content,
              timestamp: formatTime(rm.timestamp),
            },
          ]);
        } else if (rm.kind === 'outbound' && rm.event) {
          // Dispatch event to reducer (for toolCalls/isWorking)
          dispatch(rm.event);
          // Also handle message events locally
          handleMessageEvent(rm.event);
        }
      }
    }
  };

  /**
   * Handle session_changed — WsClient already auto-reconnected with new sessionId.
   * App.tsx only updates UI state: activeSessionId, clear messages, refresh sessions.
   */
  const handleSessionChanged = (payload: unknown) => {
    const msg = payload as { type: 'session_changed'; sessionId: string };
    setActiveSessionId(msg.sessionId);
    setMessages([]);
    dispatch({ type: 'clear' });
    pendingMessageIdRef.current = null;
    // §0.3.0 UAT: session 切换后隐藏新会话选择器
    setShowNewSessionPicker(false);
    // §0.3.0 UAT Bug N fix: 如果有 pending user message（用户在 NewSessionPicker 状态下直接输入），
    // 在新会话创建后自动发送
    const pending = pendingUserMessageRef.current;
    if (pending) {
      pendingUserMessageRef.current = null;
      // 添加乐观用户消息并发送
      setMessages((prev) => [
        ...prev,
        {
          id: localId('local'),
          role: 'user',
          text: pending.content,
          timestamp: formatTime(new Date()),
          files: pending.files,
        },
      ]);
      // 延迟发送确保 ws 已重连到新 session
      setTimeout(() => wsRef.current?.send(pending.content), 500);
    }
    // Refresh session list (e.g., /new creates a new session that should appear)
    void loadAgentsAndSessions();
  };

  // =========================================================================
  // User actions
  // =========================================================================

  /** Send regular message: optimistic local user message + ws.send */
  const handleSendMessage = (
    content: string,
    files?: { name: string; size: string }[],
  ) => {
    // §0.3.0 UAT Bug N fix: 当显示 NewSessionPicker 时用户直接输入消息，
    // 根据输入框下方当前显示的智能体（activeAgentSlug）新建对应智能体的会话，
    // 消息暂存到 pendingUserMessage，session_changed 后发送
    if (showNewSessionPicker) {
      const targetSlug = activeAgentSlug || 'default';
      pendingUserMessageRef.current = { content, files };
      setShowNewSessionPicker(false);
      wsRef.current?.sendSlash(`/agent ${targetSlug}`);
      setTimeout(() => wsRef.current?.sendSlash('/new'), 200);
      return;
    }
    setMessages((prev) => [
      ...prev,
      {
        id: localId('local'),
        role: 'user',
        text: content,
        timestamp: formatTime(new Date()),
        files,
      },
    ]);
    wsRef.current?.send(content);
  };

  /** Send slash command (e.g., /new, /resume, /help) */
  const handleSendSlash = (cmd: string) => {
    wsRef.current?.sendSlash(cmd);
  };

  /** Select existing session: send /resume <id> slash command */
  const handleSelectSession = (sessionId: string) => {
    // §0.3.0 UAT Bug J fix: 点击会话时自动切换到该会话所属的智能体
    const session = sessions.find((s) => s.id === sessionId);
    if (session?.agentId) {
      setActiveAgentSlug(session.agentId);
    }
    wsRef.current?.sendSlash(`/resume ${sessionId}`);
    if (!isDesktop) setSidebarOpen(false);
  };

  /** Create new session: show agent picker instead of directly sending /new */
  const handleCreateSession = () => {
    setShowNewSessionPicker(true);
    if (!isDesktop) setSidebarOpen(false);
  };

  /** §0.3.0 UAT: 新会话选择器 — 点击智能体后切换到该 agent 并创建新会话 */
  const handleStartNewSessionWithAgent = (slug: string) => {
    setActiveAgentSlug(slug);
    // 先发 /agent <slug> 切换 agent 上下文（更新 currentAgentSlug），
    // 再发 /new 创建新会话（归属当前 agent）。
    // /agent <slug> 会切换到该 agent 的最新 session，/new 会创建新 session 覆盖。
    wsRef.current?.sendSlash(`/agent ${slug}`);
    setTimeout(() => wsRef.current?.sendSlash('/new'), 200);
    setShowNewSessionPicker(false);
    if (!isDesktop) setSidebarOpen(false);
  };

  /** Select agent: update local state + send /agent <slug> to backend */
  const handleSelectAgent = (slug: string) => {
    setActiveAgentSlug(slug);
    wsRef.current?.sendSlash(`/agent ${slug}`);
    setShowNewSessionPicker(false);
    if (!isDesktop) setSidebarOpen(false);
  };

  /** Login success callback from AuthModal */
  const handleLoginSuccess = async (_username: string) => {
    // authController already has userId/username from login()
    setCurrentUser({
      userId: authController.userId || '',
      username: authController.username || _username,
    });
    await bootstrap();
  };

  /** Login trigger from Sidebar (when not logged in) */
  const handleLoginTrigger = () => {
    setAuthModalOpen(true);
  };

  /** Logout callback from Sidebar */
  const handleLoggedOut = () => {
    wsRef.current?.close();
    wsRef.current = null;
    setCurrentUser(null);
    setAgents([]);
    setSessions([]);
    setActiveSessionId(null);
    setActiveAgentSlug('default');
    setModel('');
    setMessages([]);
    setConnectionState('closed');
    dispatch({ type: 'clear' });
    setAuthModalOpen(true);
  };

  // --- Agent modal handlers ---

  const handleOpenCreateAgentModal = () => setIsCreateAgentOpen(true);
  const handleCloseCreateAgentModal = () => setIsCreateAgentOpen(false);
  const handleOpenEditAgentModal = (agent: AgentProfile) => {
    setEditingAgent(agent);
    setIsEditAgentOpen(true);
  };
  const handleCloseEditAgentModal = () => {
    setIsEditAgentOpen(false);
    setEditingAgent(null);
  };
  const handleAgentSaved = (createdSlug?: string) => {
    void loadAgentsAndSessions();
    // §0.3.0 UAT fix: 创建专用 agent 后自动切换到该 agent。
    // /agent <slug> 会自动查找该 agent 的最新 session（新 agent 无 session → 自动新建），
    // 无需额外发 /new（会导致创建第二个 session）。
    if (createdSlug) {
      setActiveAgentSlug(createdSlug);
      wsRef.current?.sendSlash(`/agent ${createdSlug}`);
    }
  };

  const handleDeleteAgent = async (slug: string) => {
    try {
      await api.deleteAgent(slug);
      await loadAgentsAndSessions();
    } catch (err) {
      console.error('[App] deleteAgent failed', err);
      alert(err instanceof Error ? err.message : '删除智能体失败');
    }
  };

  /** Session deleted via Sidebar (after api.deleteSession) — remove from state */
  const handleSessionDeleted = (sessionId: string) => {
    setSessions((prev) => prev.filter((s) => s.id !== sessionId));
  };

  /** §0.3.0 UAT Bug D: 会话重命名 — 通过 /label <name> slash 命令修改当前会话显示名 */
  const handleRenameSession = (sessionId: string, newLabel: string) => {
    // 乐观更新本地 sessions 列表（/label slash 不广播 session_renamed 事件）
    setSessions((prev) =>
      prev.map((s) => (s.id === sessionId ? { ...s, label: newLabel } : s)),
    );
    if (activeSessionId === sessionId) {
      // 当前会话：通过 /label slash 命令（server-side 持久化到 .meta.json）
      wsRef.current?.sendSlash(`/label ${newLabel}`);
    } else {
      // 非当前会话：直接调用 API（POST /api/sessions/:id/label 会广播 session_renamed）
      api.renameSession(sessionId, newLabel).catch((err) => {
        console.error('[App] renameSession (direct api) failed', err);
      });
    }
  };

  /** Model selection (MVP: single model from bootstrap, no-op essentially) */
  const handleSelectModel = (selected: ModelOption) => {
    setModel(selected.id);
  };

  // =========================================================================
  // Render
  // =========================================================================

  // Don't render main UI until auth check completes
  if (!authChecked) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-white">
        <div className="text-neutral-400 text-sm animate-pulse font-mono">加载中…</div>
      </div>
    );
  }

  const toolCallList = Array.from(ui.toolCalls.values());

  return (
    <div className="flex h-screen bg-white">
      <Sidebar
        agents={agents}
        sessions={sessions}
        activeAgentSlug={activeAgentSlug}
        activeSessionId={activeSessionId || ''}
        onSelectAgent={handleSelectAgent}
        onSelectSession={handleSelectSession}
        onCreateSession={handleCreateSession}
        onOpenCreateAgentModal={handleOpenCreateAgentModal}
        onOpenEditAgentModal={handleOpenEditAgentModal}
        onDeleteAgent={handleDeleteAgent}
        onSessionDeleted={handleSessionDeleted}
        onRenameSession={handleRenameSession}
        currentUser={currentUser}
        onLoggedOut={handleLoggedOut}
        onLoginTrigger={handleLoginTrigger}
        isDesktop={isDesktop}
        isOpen={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
      />

      <main className="flex-1 ml-0 md:ml-64 flex flex-col h-screen min-w-0">
        <ChatArea
          activeAgent={activeAgent}
          messages={messages}
          isWorking={ui.isWorking}
          showNewSessionPicker={showNewSessionPicker}
          agents={agents}
          onSelectAgentForNewSession={handleStartNewSessionWithAgent}
          toolCalls={toolCallList}
        />

        <InputArea
          agents={agents}
          activeAgentSlug={activeAgentSlug}
          onSelectAgent={handleSelectAgent}
          selectedModel={selectedModel}
          onSelectModel={handleSelectModel}
          models={models}
          onSendMessage={handleSendMessage}
          onSendSlash={handleSendSlash}
        />

        <FooterBar model={model} connectionState={connectionState} />
      </main>

      <MemoryToast toolCalls={ui.toolCalls} />

      <AgentModals
        isCreateOpen={isCreateAgentOpen}
        isEditOpen={isEditAgentOpen}
        editingAgent={editingAgent}
        onCloseCreate={handleCloseCreateAgentModal}
        onCloseEdit={handleCloseEditAgentModal}
        onSaved={handleAgentSaved}
      />

      <AuthModal
        isOpen={authModalOpen}
        onClose={() => setAuthModalOpen(false)}
        onLoginSuccess={handleLoginSuccess}
      />
    </div>
  );
}
