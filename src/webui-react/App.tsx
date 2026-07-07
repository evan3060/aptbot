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
import ToolCallView from './components/ToolCallView.js';
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

  const wsRef = useRef<WsClient | null>(null);

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
        setMessages((prev) => [
          ...prev,
          {
            id: event.messageId,
            role: 'assistant',
            text: '',
            isStreaming: true,
            timestamp: formatTime(new Date()),
          },
        ]);
        break;
      case 'message_delta': {
        setMessages((prev) => {
          // Find last assistant message and append text
          let lastAssistantIndex = -1;
          for (let i = prev.length - 1; i >= 0; i--) {
            if (prev[i].role === 'assistant') {
              lastAssistantIndex = i;
              break;
            }
          }
          if (lastAssistantIndex === -1) {
            // Defensive: delta before start — create new assistant message
            return [
              ...prev,
              {
                id: localId('m'),
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

    for (const m of msg.messages) {
      if (typeof m !== 'object' || m === null) continue;

      // JSONL format: { id, role, content, timestamp, replay }
      if ('role' in m && 'content' in m) {
        const rm = m as {
          id: string;
          role: 'user' | 'assistant';
          content: string;
          timestamp: number;
        };
        setMessages((prev) => [
          ...prev,
          {
            id: rm.id,
            role: rm.role,
            text: rm.content,
            timestamp: formatTime(rm.timestamp),
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
    wsRef.current?.sendSlash(`/resume ${sessionId}`);
  };

  /** Create new session: send /new slash command */
  const handleCreateSession = () => {
    wsRef.current?.sendSlash('/new');
  };

  /** Select agent: update local state + send /agent <slug> to backend */
  const handleSelectAgent = (slug: string) => {
    setActiveAgentSlug(slug);
    wsRef.current?.sendSlash(`/agent ${slug}`);
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
  const handleAgentSaved = () => {
    void loadAgentsAndSessions();
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
        currentUser={currentUser}
        onLoggedOut={handleLoggedOut}
        onLoginTrigger={handleLoginTrigger}
      />

      <main className="flex-1 ml-64 flex flex-col h-screen min-w-0">
        <ChatArea
          activeAgent={activeAgent}
          messages={messages}
          isWorking={ui.isWorking}
        />

        {toolCallList.length > 0 && (
          <div className="border-t border-neutral-200 px-6 py-2 max-h-40 overflow-y-auto custom-scrollbar bg-white">
            {toolCallList.map((tc) => (
              <ToolCallView key={tc.id} toolCall={tc} />
            ))}
          </div>
        )}

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
