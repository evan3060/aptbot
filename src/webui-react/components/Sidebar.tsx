/**
 * Task 4 (React WebUI redesign): 左侧栏组件。
 *
 * 迁移自 aistudio-design/src/components/Sidebar.tsx，保留极简黑白灰视觉风格、
 * 通用/专用 agent 分区、可折叠专用 agent、底部用户卡片。
 *
 * 关键适配（brief Step 6）：
 * 1. Agent 标识从 `id` 改为 `slug`（`activeAgentSlug` 替代 `activeAgentId`）
 * 2. Session 列表来自 `GET /api/sessions`（server-side 持久化），而非 localStorage
 * 3. 点击会话项调用 `onSelectSession(sessionId)` — App.tsx 在 Task 9 中转 `/resume <id>` slash
 * 4. 新会话按钮调用 `onCreateSession()` — App.tsx 在 Task 9 中转 `/new` slash
 * 5. 删除会话：弹出确认 UI → `api.deleteSession(id)` → `onSessionDeleted(id)` 通知父组件
 * 6. 新建 agent 按钮调用 `onOpenCreateAgentModal()`
 * 7. 用户卡片显示 `currentUser`（来自 auth），登出按钮调用 `authController.logout()` +
 *    `onLoggedOut()` 让父组件更新状态
 *
 * Sidebar 仅 emit 事件；slash 命令的实际发送由 App.tsx（Task 9）通过 WsClient.sendSlash 完成。
 */
import { useState } from 'react';
import {
  Brain,
  Plus,
  Settings,
  MessageSquare,
  ChevronDown,
  ChevronRight,
  Sparkles,
  Terminal,
  Palette,
  LogOut,
  Trash2,
  Cpu,
  AlertCircle,
} from 'lucide-react';
import type { AgentProfile, SessionMetadata, AuthUser } from '../types.js';
import { authController } from '../lib/auth.js';
import { api } from '../lib/api.js';

interface SidebarProps {
  agents: AgentProfile[];
  sessions: SessionMetadata[];
  activeAgentSlug: string;
  activeSessionId: string;
  onSelectAgent: (slug: string) => void;
  onSelectSession: (sessionId: string) => void;
  onCreateSession: () => void;
  onOpenCreateAgentModal: () => void;
  onOpenEditAgentModal: (agent: AgentProfile) => void;
  onDeleteAgent: (slug: string) => void;
  onSessionDeleted: (sessionId: string) => void;
  currentUser: AuthUser | null;
  onLoggedOut: () => void;
  onLoginTrigger: () => void;
}

/** Session 显示文本：优先 label，其次 preview，最后回退「新对话」 */
function sessionDisplay(s: SessionMetadata): string {
  if (s.label && s.label.trim().length > 0) return s.label;
  if (s.preview && s.preview.trim().length > 0) return s.preview;
  return '新对话';
}

export default function Sidebar({
  agents,
  sessions,
  activeAgentSlug,
  activeSessionId,
  onSelectAgent,
  onSelectSession,
  onCreateSession,
  onOpenCreateAgentModal,
  onOpenEditAgentModal,
  onDeleteAgent,
  onSessionDeleted,
  currentUser,
  onLoggedOut,
  onLoginTrigger,
}: SidebarProps) {
  // 折叠状态：专用 agent 展开记录（默认全部折叠）
  const [expandedAgents, setExpandedAgents] = useState<Record<string, boolean>>({});

  // 删除会话确认状态：记录正在确认删除的 sessionId（null = 未显示确认 UI）
  const [pendingDeleteSessionId, setPendingDeleteSessionId] = useState<string | null>(null);
  const [deletingSessionId, setDeletingSessionId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const toggleAgentExpand = (slug: string) => {
    setExpandedAgents((prev) => ({ ...prev, [slug]: !prev[slug] }));
  };

  // 默认 agent 分区：slug === 'default' && !isCustom
  const generalAgents = agents.filter((a) => !a.isCustom && a.slug === 'default');
  // 专用 agent 分区：isCustom 或非 default slug
  const specializedAgents = agents.filter((a) => a.isCustom || a.slug !== 'default');

  const getAgentIcon = (iconName: string) => {
    switch (iconName) {
      case 'brain':
        return <Brain className="w-[18px] h-[18px] text-black" />;
      case 'terminal':
        return <Terminal className="w-[18px] h-[18px] text-neutral-600" />;
      case 'palette':
        return <Palette className="w-[18px] h-[18px] text-neutral-600" />;
      default:
        return <Cpu className="w-[18px] h-[18px] text-neutral-600" />;
    }
  };

  /** 删除会话：调用 api.deleteSession + 通知父组件 */
  const handleConfirmDeleteSession = async (sessionId: string) => {
    setDeletingSessionId(sessionId);
    setDeleteError(null);
    try {
      await api.deleteSession(sessionId);
      onSessionDeleted(sessionId);
      setPendingDeleteSessionId(null);
    } catch (err) {
      const message = err instanceof Error ? err.message : '删除会话失败';
      setDeleteError(message);
    } finally {
      setDeletingSessionId(null);
    }
  };

  /** 登出：调用 authController.logout + 通知父组件更新状态 */
  const handleLogout = async () => {
    await authController.logout();
    onLoggedOut();
  };

  return (
    <aside className="flex flex-col h-full py-6 px-4 w-64 fixed left-0 top-0 bg-white border-r border-slate-200 z-20">
      {/* Brand Logo */}
      <div className="mb-6 flex items-center gap-3 px-2">
        <div className="w-10 h-10 text-black flex items-center justify-center bg-white">
          <Brain className="w-6 h-6 animate-pulse" />
        </div>
        <div>
          <h1 className="font-sans text-[18px] font-bold text-black uppercase tracking-tighter leading-none">
            Aptbot
          </h1>
          <p className="text-[10px] font-bold uppercase tracking-widest text-neutral-400 mt-1">
            精度工作区
          </p>
        </div>
      </div>

      {/* New Session CTA — 触发 onCreateSession()，App.tsx 转 /new slash */}
      <button
        onClick={onCreateSession}
        className="w-full flex items-center gap-2 bg-transparent text-black hover:bg-black hover:text-white rounded-lg font-bold transition-all mb-6 active:scale-[0.98] justify-start px-2 py-1.5 text-xs cursor-pointer"
      >
        <Plus className="w-3.5 h-3.5" />
        <span>新会话</span>
      </button>

      <nav className="flex-1 overflow-y-auto custom-scrollbar space-y-6 pr-1">
        {/* General Agent Section */}
        {generalAgents.map((agent) => {
          const agentSessions = sessions.filter((s) => s.agentId === agent.slug);
          return (
            <section key={agent.slug}>
              <div className="flex items-center justify-between px-2 mb-2">
                <div
                  onClick={() => onSelectAgent(agent.slug)}
                  className="flex items-center gap-2 text-black font-bold cursor-pointer hover:text-neutral-600"
                >
                  <Cpu className="w-4 h-4 text-black" />
                  <span className="text-xs uppercase tracking-wider font-bold">通用智能体</span>
                </div>
                <button
                  onClick={() => onOpenEditAgentModal(agent)}
                  className="text-neutral-400 hover:text-black transition-colors cursor-pointer"
                  title="设置智能体"
                >
                  <Settings className="w-4 h-4" />
                </button>
              </div>

              <div className="space-y-1">
                {agentSessions.length === 0 ? (
                  <button
                    onClick={onCreateSession}
                    className="w-full flex items-center gap-2 px-3 py-1.5 rounded-lg text-neutral-400 hover:bg-neutral-50 text-xs transition-colors justify-start cursor-pointer"
                  >
                    <MessageSquare className="w-3.5 h-3.5" />
                    <span>暂无会话，点击创建</span>
                  </button>
                ) : (
                  agentSessions.map((session) => (
                    <SessionItem
                      key={session.id}
                      session={session}
                      isActive={activeSessionId === session.id}
                      onSelect={onSelectSession}
                      isPendingDelete={pendingDeleteSessionId === session.id}
                      isDeleting={deletingSessionId === session.id}
                      deleteError={pendingDeleteSessionId === session.id ? deleteError : null}
                      onRequestDelete={() => {
                        setPendingDeleteSessionId(session.id);
                        setDeleteError(null);
                      }}
                      onCancelDelete={() => setPendingDeleteSessionId(null)}
                      onConfirmDelete={() => handleConfirmDeleteSession(session.id)}
                    />
                  ))
                )}
              </div>
            </section>
          );
        })}

        {/* Specialized Agents Section */}
        <section>
          <div className="flex items-center justify-between px-2 mb-2">
            <div className="flex items-center gap-2 font-bold text-black">
              <Sparkles className="w-4 h-4 text-black animate-bounce" />
              <span className="text-xs uppercase tracking-wider font-bold">专用智能体</span>
            </div>
          </div>

          <div className="space-y-2">
            {specializedAgents.length === 0 && (
              <div className="px-3 py-2 text-[11px] text-neutral-400">
                暂无专用智能体
              </div>
            )}
            {specializedAgents.map((agent) => {
              const isExpanded = !!expandedAgents[agent.slug];
              const agentSessions = sessions.filter((s) => s.agentId === agent.slug);

              return (
                <div key={agent.slug} className="mb-1">
                  <div
                    className={`flex items-center justify-between px-3 py-1.5 rounded-lg group hover:bg-neutral-50 transition-colors ${
                      activeAgentSlug === agent.slug ? 'bg-neutral-50/50' : ''
                    }`}
                  >
                    <div
                      className="flex items-center gap-2 cursor-pointer flex-1 min-w-0"
                      onClick={() => {
                        onSelectAgent(agent.slug);
                        toggleAgentExpand(agent.slug);
                      }}
                    >
                      {isExpanded ? (
                        <ChevronDown className="w-4 h-4 text-neutral-400 animate-pulse" />
                      ) : (
                        <ChevronRight className="w-4 h-4 text-neutral-400" />
                      )}
                      <div className="flex items-center gap-1.5 min-w-0">
                        {getAgentIcon(agent.iconName)}
                        <span className="text-sm text-neutral-700 font-medium truncate">
                          {agent.name}
                        </span>
                      </div>
                    </div>

                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        title="设置智能体"
                        onClick={(e) => {
                          e.stopPropagation();
                          onOpenEditAgentModal(agent);
                        }}
                        className="text-neutral-400 hover:text-black transition-colors cursor-pointer"
                      >
                        <Settings className="w-4 h-4" />
                      </button>
                      {agent.isCustom && (
                        <button
                          title="删除智能体"
                          onClick={(e) => {
                            e.stopPropagation();
                            onDeleteAgent(agent.slug);
                          }}
                          className="text-neutral-400 hover:text-red-600 transition-colors ml-1 cursor-pointer"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  </div>

                  {isExpanded && (
                    <div className="pl-6 space-y-1 mt-1 border-l border-neutral-100 ml-5">
                      {agentSessions.length === 0 ? (
                        <button
                          onClick={onCreateSession}
                          className="w-full flex items-center gap-1 px-2 py-1.5 rounded-lg text-neutral-400 hover:bg-neutral-50 text-xs transition-colors justify-start cursor-pointer"
                        >
                          <Plus className="w-3 h-3" />
                          <span>新建会话</span>
                        </button>
                      ) : (
                        agentSessions.map((session) => (
                          <SessionItem
                            key={session.id}
                            session={session}
                            isActive={activeSessionId === session.id}
                            onSelect={onSelectSession}
                            isPendingDelete={pendingDeleteSessionId === session.id}
                            isDeleting={deletingSessionId === session.id}
                            deleteError={
                              pendingDeleteSessionId === session.id ? deleteError : null
                            }
                            onRequestDelete={() => {
                              setPendingDeleteSessionId(session.id);
                              setDeleteError(null);
                            }}
                            onCancelDelete={() => setPendingDeleteSessionId(null)}
                            onConfirmDelete={() => handleConfirmDeleteSession(session.id)}
                          />
                        ))
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          <button
            onClick={onOpenCreateAgentModal}
            className="w-full flex items-center gap-2 bg-transparent text-black rounded-lg font-bold hover:bg-black hover:text-white transition-all mt-4 active:scale-[0.98] justify-start px-2 py-1.5 text-xs cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>新建智能体</span>
          </button>
        </section>
      </nav>

      {/* Bottom Profile */}
      <div className="pt-4 border-t border-slate-200 mt-auto">
        {currentUser ? (
          <div className="flex items-center gap-3 p-2 bg-white rounded-lg border border-slate-200 shadow-xs">
            <div className="relative shrink-0">
              <div className="w-10 h-10 bg-slate-100 border border-slate-200 rounded-full flex items-center justify-center text-sm font-bold text-black uppercase">
                {currentUser.username.slice(0, 2)}
              </div>
              <div className="absolute bottom-0 right-0 w-3 h-3 bg-green-500 border-2 border-white rounded-full"></div>
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-bold text-black truncate">{currentUser.username}</p>
              <p className="text-[10px] text-neutral-500 truncate font-semibold">Apt-Link: 已激活</p>
            </div>
            <button
              onClick={handleLogout}
              className="text-neutral-400 hover:text-rose-600 transition-colors p-1 rounded hover:bg-slate-50 cursor-pointer"
              title="退出登录"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        ) : (
          <div className="p-2 bg-slate-50 rounded-lg border border-slate-200 flex flex-col gap-2">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 bg-slate-200 rounded-full flex items-center justify-center text-xs font-bold text-slate-500 uppercase">
                ?
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-bold text-slate-700 truncate">未登录</p>
                <p className="text-[9px] text-slate-400 truncate">访问受限，请先登录</p>
              </div>
            </div>
            <button
              onClick={onLoginTrigger}
              className="w-full flex items-center justify-center gap-1.5 py-1.5 bg-black hover:bg-neutral-800 text-white font-bold text-xs rounded-lg transition-all active:scale-[0.98] cursor-pointer"
            >
              <span>立即登录</span>
            </button>
          </div>
        )}
      </div>
    </aside>
  );
}

/**
 * Session 列表项 — 显示 label/preview + hover 时显示删除按钮 + 确认删除 UI。
 *
 * 删除流程（brief Step 6.5）：
 * 1. hover session 项 → 显示 Trash2 按钮（右侧）
 * 2. 点击 Trash2 → 切换为确认 UI（"确认删除？" + 是/否按钮）
 * 3. 点"是" → 调用 onConfirmDelete(id) → Sidebar 调 api.deleteSession + onSessionDeleted
 * 4. 点"否" → 取消，回到普通状态
 */
interface SessionItemProps {
  session: SessionMetadata;
  isActive: boolean;
  onSelect: (sessionId: string) => void;
  isPendingDelete: boolean;
  isDeleting: boolean;
  deleteError: string | null;
  onRequestDelete: () => void;
  onCancelDelete: () => void;
  onConfirmDelete: () => void;
}

function SessionItem({
  session,
  isActive,
  onSelect,
  isPendingDelete,
  isDeleting,
  deleteError,
  onRequestDelete,
  onCancelDelete,
  onConfirmDelete,
}: SessionItemProps) {
  if (isPendingDelete) {
    return (
      <div className="px-3 py-1.5 rounded-lg bg-rose-50 border border-rose-200 space-y-1">
        <div className="flex items-center gap-1.5 text-[11px] text-rose-700 font-bold">
          <AlertCircle className="w-3 h-3 shrink-0" />
          <span className="truncate">确认删除此会话？</span>
        </div>
        {deleteError && (
          <div className="text-[10px] text-rose-600 truncate">{deleteError}</div>
        )}
        <div className="flex items-center gap-1">
          <button
            onClick={onConfirmDelete}
            disabled={isDeleting}
            className="flex-1 px-2 py-1 bg-rose-600 hover:bg-rose-700 text-white text-[11px] font-bold rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
          >
            {isDeleting ? '删除中...' : '确认'}
          </button>
          <button
            onClick={onCancelDelete}
            disabled={isDeleting}
            className="flex-1 px-2 py-1 bg-white hover:bg-slate-50 text-slate-700 text-[11px] font-bold rounded border border-slate-200 transition-colors disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
          >
            取消
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="group relative flex items-center">
      <button
        onClick={() => onSelect(session.id)}
        className={`w-full flex items-center gap-2 px-3 py-1.5 rounded-lg text-left transition-colors border cursor-pointer ${
          isActive
            ? 'bg-neutral-100 border-neutral-200/50 text-neutral-700 font-normal'
            : 'text-neutral-500 hover:bg-neutral-50 hover:text-neutral-700 border-transparent'
        }`}
      >
        <MessageSquare className="w-3.5 h-3.5 shrink-0 text-neutral-400" />
        <span className="text-xs truncate pr-6">{sessionDisplay(session)}</span>
      </button>
      <button
        onClick={onRequestDelete}
        title="删除会话"
        className="absolute right-2 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 text-neutral-400 hover:text-rose-600 transition-all p-0.5 cursor-pointer"
      >
        <Trash2 className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}
