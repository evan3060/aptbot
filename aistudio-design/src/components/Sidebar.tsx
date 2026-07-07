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
  FolderGit2, 
  Trash2,
  Cpu
} from "lucide-react";
import { Agent, Session } from "../types";
import { useState } from "react";

interface SidebarProps {
  agents: Agent[];
  sessions: Session[];
  activeAgentId: string;
  activeSessionId: string;
  onSelectAgent: (agentId: string) => void;
  onSelectSession: (sessionId: string) => void;
  onCreateSession: (agentId: string, title?: string) => void;
  onOpenCreateAgentModal: () => void;
  onOpenEditAgentModal: (agent: Agent) => void;
  onDeleteAgent: (agentId: string) => void;
  currentUser: string | null;
  onLogout: () => void;
  onLoginTrigger: () => void;
}

export default function Sidebar({
  agents,
  sessions,
  activeAgentId,
  activeSessionId,
  onSelectAgent,
  onSelectSession,
  onCreateSession,
  onOpenCreateAgentModal,
  onOpenEditAgentModal,
  onDeleteAgent,
  currentUser,
  onLogout,
  onLoginTrigger
}: SidebarProps) {
  // Toggle states for collapsible specialized agents
  const [expandedAgents, setExpandedAgents] = useState<Record<string, boolean>>({
    "python-pro": true,
    "ui-designer": false
  });

  const toggleAgentExpand = (agentId: string) => {
    setExpandedAgents(prev => ({
      ...prev,
      [agentId]: !prev[agentId]
    }));
  };

  const generalAgents = agents.filter(a => !a.isCustom && a.id === "general");
  const specializedAgents = agents.filter(a => a.isCustom || a.id !== "general");

  const getAgentIcon = (iconName: string) => {
    switch (iconName) {
      case "brain": return <Brain className="w-[18px] h-[18px] text-black" />;
      case "terminal": return <Terminal className="w-[18px] h-[18px] text-neutral-600" />;
      case "palette": return <Palette className="w-[18px] h-[18px] text-neutral-600" />;
      default: return <Cpu className="w-[18px] h-[18px] text-neutral-600" />;
    }
  };

  return (
    <aside className="flex flex-col h-full py-6 px-4 w-64 fixed left-0 top-0 bg-white border-r border-slate-200 z-20">
      {/* Brand Logo */}
      <div className="mb-6 flex items-center gap-3 px-2">
        <div className="w-10 h-10 text-black flex items-center justify-center bg-white">
          <Brain className="w-6 h-6 animate-pulse" />
        </div>
        <div>
          <h1 className="font-sans text-[18px] font-bold text-black uppercase tracking-tighter leading-none">Aptbot</h1>
          <p className="text-[10px] font-bold uppercase tracking-widest text-neutral-400 mt-1">精度工作区</p>
        </div>
      </div>

      {/* New Session CTA */}
      <button 
        onClick={() => onCreateSession(activeAgentId)}
        className="w-full flex items-center gap-2 bg-transparent text-black hover:bg-black hover:text-white rounded-lg font-bold transition-all mb-6 active:scale-[0.98] justify-start px-2 py-1.5 text-xs"
      >
        <Plus className="w-3.5 h-3.5" />
        <span>新会话</span>
      </button>

      <nav className="flex-1 overflow-y-auto custom-scrollbar space-y-6 pr-1">
        {/* General Agent Section */}
        {generalAgents.map(agent => {
          const agentSessions = sessions.filter(s => s.agentId === agent.id);
          return (
            <section key={agent.id}>
              <div className="flex items-center justify-between px-2 mb-2">
                <div 
                  onClick={() => onSelectAgent(agent.id)}
                  className="flex items-center gap-2 text-black font-bold cursor-pointer hover:text-neutral-600"
                >
                  <Cpu className="w-4 h-4 text-black" />
                  <span className="text-xs uppercase tracking-wider font-bold">通用智能体</span>
                </div>
                <button 
                  onClick={() => onOpenEditAgentModal(agent)}
                  className="text-neutral-400 hover:text-black transition-colors"
                  title="设置智能体"
                >
                  <Settings className="w-4 h-4" />
                </button>
              </div>

              <div className="space-y-1">
                {agentSessions.length === 0 ? (
                  <button
                    onClick={() => onCreateSession(agent.id, "新对话")}
                    className="w-full flex items-center gap-2 px-3 py-1.5 rounded-lg text-neutral-400 hover:bg-neutral-50 text-xs transition-colors justify-start"
                  >
                    <MessageSquare className="w-3.5 h-3.5" />
                    <span>暂无会话，点击创建</span>
                  </button>
                ) : (
                  agentSessions.map(session => (
                    <div 
                      key={session.id}
                      className="group relative flex items-center"
                    >
                      <button
                        onClick={() => onSelectSession(session.id)}
                        className={`w-full flex items-center gap-2 px-3 py-1.5 rounded-lg text-left transition-colors border ${
                          activeSessionId === session.id 
                            ? "bg-neutral-100 border-neutral-200/50 text-neutral-700 font-normal" 
                            : "text-neutral-500 hover:bg-neutral-50 hover:text-neutral-700 border-transparent"
                        }`}
                      >
                        <MessageSquare className="w-3.5 h-3.5 shrink-0 text-neutral-400" />
                        <span className="text-xs truncate pr-6">{session.title}</span>
                      </button>
                    </div>
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
            {specializedAgents.map(agent => {
              const isExpanded = !!expandedAgents[agent.id];
              const agentSessions = sessions.filter(s => s.agentId === agent.id);

              return (
                <div key={agent.id} className="mb-1">
                  <div 
                    className={`flex items-center justify-between px-3 py-1.5 rounded-lg group hover:bg-neutral-50 transition-colors ${
                      activeAgentId === agent.id ? "bg-neutral-50/50" : ""
                    }`}
                  >
                    <div 
                      className="flex items-center gap-2 cursor-pointer flex-1 min-w-0"
                      onClick={() => {
                        onSelectAgent(agent.id);
                        toggleAgentExpand(agent.id);
                      }}
                    >
                      {isExpanded ? (
                        <ChevronDown className="w-4 h-4 text-neutral-400 animate-pulse" />
                      ) : (
                        <ChevronRight className="w-4 h-4 text-neutral-400" />
                      )}
                      <div className="flex items-center gap-1.5 min-w-0">
                        {getAgentIcon(agent.iconName)}
                        <span className="text-sm text-neutral-700 font-medium truncate">{agent.name}</span>
                      </div>
                    </div>

                    <div className="flex items-center gap-1 shrink-0">
                      <button 
                        title="设置智能体"
                        onClick={(e) => {
                          e.stopPropagation();
                          onOpenEditAgentModal(agent);
                        }}
                        className="text-neutral-400 hover:text-black transition-colors"
                      >
                        <Settings className="w-4 h-4" />
                      </button>
                      {agent.isCustom && (
                        <button 
                          title="删除智能体"
                          onClick={(e) => {
                            e.stopPropagation();
                            onDeleteAgent(agent.id);
                          }}
                          className="text-neutral-400 hover:text-red-600 transition-colors ml-1"
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
                          onClick={() => onCreateSession(agent.id, "新对话")}
                          className="w-full flex items-center gap-1 px-2 py-1.5 rounded-lg text-neutral-400 hover:bg-neutral-50 text-xs transition-colors justify-start"
                        >
                          <Plus className="w-3 h-3" />
                          <span>新建会话</span>
                        </button>
                      ) : (
                        agentSessions.map(session => (
                          <button
                            key={session.id}
                            onClick={() => onSelectSession(session.id)}
                            className={`w-full flex items-center gap-2 px-3 py-1.5 rounded-lg text-left transition-colors border ${
                              activeSessionId === session.id 
                                ? "bg-neutral-100 border-neutral-200/50 text-neutral-700 font-normal" 
                                : "text-neutral-500 hover:bg-neutral-50 hover:text-neutral-700 border-transparent"
                            }`}
                          >
                            <MessageSquare className="w-3.5 h-3.5 shrink-0 text-neutral-400" />
                            <span className="text-xs truncate">{session.title}</span>
                          </button>
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
            className="w-full flex items-center gap-2 bg-transparent text-black rounded-lg font-bold hover:bg-black hover:text-white transition-all mt-4 active:scale-[0.98] justify-start px-2 py-1.5 text-xs"
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
                {currentUser.slice(0, 2)}
              </div>
              <div className="absolute bottom-0 right-0 w-3 h-3 bg-green-500 border-2 border-white rounded-full"></div>
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-bold text-black truncate">{currentUser}</p>
              <p className="text-[10px] text-neutral-500 truncate font-semibold">Apt-Link: 已激活</p>
            </div>
            <button 
              onClick={onLogout}
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
