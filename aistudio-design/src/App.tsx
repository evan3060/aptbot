import { useState, useEffect } from "react";
import Sidebar from "./components/Sidebar";
import ChatArea from "./components/ChatArea";
import InputArea from "./components/InputArea";
import AgentModals from "./components/AgentModals";
import AuthModal from "./components/AuthModal";
import { Agent, Session, Message, ModelOption, AttachedFile } from "./types";
import { 
  Search, 
  Bell, 
  HelpCircle, 
  Cpu, 
  Loader2,
  Sparkles,
  Info,
  User,
  LogOut
} from "lucide-react";

// Predefined models mapping to Gemini
const AVAILABLE_MODELS: ModelOption[] = [
  { id: "gpt-4o", name: "GPT-4o", backendModel: "gemini-3.5-flash" },
  { id: "claude-3-5", name: "Claude 3.5 Sonnet", backendModel: "gemini-3.1-pro-preview" },
  { id: "deepseek-v3", name: "DeepSeek-V3", backendModel: "gemini-3.5-flash" }
];

// Predefined agents
const PREDEFINED_AGENTS: Agent[] = [
  {
    id: "general",
    name: "通用智能体",
    description: "面向多场景的通用型智能助手，擅长代码优化、文本整理和日常问答。",
    systemPrompt: "你是一个面向多场景的通用型智能助手。请使用专业、简洁、清晰、到位的中文来解答用户的任何指令。支持 Markdown 格式，代码需要使用 ``` 块级包裹，并标记语言。",
    iconName: "brain",
    isCustom: false,
    predefinedPrompts: [
      { label: "代码重构优化", text: "请帮我重构和优化以下代码逻辑，提高可读性并减少开销：\n\n", icon: "code" },
      { label: "会议纪要整理", text: "这里有一些凌乱的会议速记内容，请帮我梳理并生成一份结构清晰、包含关键行动项的会议纪要：\n\n", icon: "book" }
    ]
  },
  {
    id: "python-pro",
    name: "Python 专家",
    description: "精通 Python 核心语法、数据分析、Django/Flask Web 开发及自动化脚本。",
    systemPrompt: "你是一个精通 Python 语言的高级架构师。你对 Python 的高级特性（生成器、装饰器、列表推导式、内存管理等）、Django/Flask 框架，以及 NumPy 等数据工具有着极深的理解。请用中文帮用户分析及重构 Python 代码，指出瓶颈所在，并提供高质量、符合 PEP 8 规范的高性能代码示例。",
    iconName: "terminal",
    isCustom: false,
    predefinedPrompts: [
      { label: "Django 项目部署", text: "请提供一个详细的 Django 项目在 Linux 生产环境中使用 Gunicorn + Nginx + Systemd 进行高可用部署的配置和步骤指南：", icon: "terminal" }
    ]
  },
  {
    id: "ui-designer",
    name: "UI 设计师",
    description: "深谙用户体验与现代前端 UI 设计规范，擅长设计极简、高对比度、呼吸感强的界面。",
    systemPrompt: "你是一个顶级的高端 UI 设计师和前端开发专家。你深谙现代界面设计原理（如 Glassmorphism 玻璃拟态、Fluid Typography 流式排版、极简布局、高对比度黑白灰及微妙渐变等），并且对 Tailwind CSS 有着极致的掌控。请用中文为用户的界面构想、CSS 方案提供专业且富有高度美感的 UI 设计方案和 Tailwind 代码实现。",
    iconName: "palette",
    isCustom: false,
    predefinedPrompts: []
  }
];

// High fidelity initial mock session matching the screenshot
const INITIAL_MESSAGES: Message[] = [
  {
    id: "m-init-1",
    role: "assistant",
    content: "当然可以。在处理大数据量时，常见的瓶颈通常出现在 **不必要的对象创建**、**复杂度较高的嵌套循环** 以及 **缺乏批处理操作**。\n\n```python\n# 优化建议示例\n# 使用生成器代替列表以节省内存\nresults = (process_item(i) for i in large_dataset if validate(i))\n\n# 尽可能使用 NumPy 的向量化操作\nimport numpy as np\ndata_array = np.array(large_dataset)\noptimized_result = data_array * 1.5\n```\n\n请提供具体的代码片段，我会为你进行详细的复杂度分析并给出重构后的代码。",
    timestamp: "14:21",
    modelUsed: "GPT-4o",
    agentName: "通用智能体"
  },
  {
    id: "m-init-2",
    role: "user",
    content: "好的，这是目前正在使用的主要循环逻辑：",
    timestamp: "14:22",
    files: [
      {
        name: "main_logic.py",
        size: "1.2KB",
        content: "# Loop logic here"
      }
    ]
  }
];

const INITIAL_SESSIONS: Session[] = [
  {
    id: "s-init-1",
    title: "代码重构优化",
    agentId: "general",
    messages: INITIAL_MESSAGES,
    createdAt: Date.now() - 3600 * 1000
  },
  {
    id: "s-init-2",
    title: "会议纪要整理",
    agentId: "general",
    messages: [],
    createdAt: Date.now() - 1800 * 1000
  },
  {
    id: "s-init-3",
    title: "Django 项目部署",
    agentId: "python-pro",
    messages: [],
    createdAt: Date.now()
  }
];

export default function App() {
  const [agents, setAgents] = useState<Agent[]>(() => {
    const saved = localStorage.getItem("aptbot_agents");
    if (saved) {
      try { return JSON.parse(saved); } catch (e) { console.error(e); }
    }
    return PREDEFINED_AGENTS;
  });

  const [sessions, setSessions] = useState<Session[]>(() => {
    const saved = localStorage.getItem("aptbot_sessions");
    if (saved) {
      try { return JSON.parse(saved); } catch (e) { console.error(e); }
    }
    return INITIAL_SESSIONS;
  });

  const [activeAgentId, setActiveAgentId] = useState<string>("general");
  const [activeSessionId, setActiveSessionId] = useState<string>(() => {
    return INITIAL_SESSIONS[0].id;
  });

  const [selectedModel, setSelectedModel] = useState<ModelOption>(AVAILABLE_MODELS[0]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");

  // Modals visibility
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [editingAgent, setEditingAgent] = useState<Agent | null>(null);

  // Authentication State
  const [currentUser, setCurrentUser] = useState<string | null>(() => {
    return localStorage.getItem("workspace_current_user");
  });
  const [isAuthModalOpen, setIsAuthModalOpen] = useState(() => {
    // Show automatically on first visit (if not logged in)
    return !localStorage.getItem("workspace_current_user");
  });

  const handleLoginSuccess = (username: string) => {
    setCurrentUser(username);
    localStorage.setItem("workspace_current_user", username);
  };

  const handleLogout = () => {
    if (window.confirm("确定要退出登录吗？")) {
      setCurrentUser(null);
      localStorage.removeItem("workspace_current_user");
    }
  };

  // Sync state to localStorage on changes
  useEffect(() => {
    localStorage.setItem("aptbot_agents", JSON.stringify(agents));
  }, [agents]);

  useEffect(() => {
    localStorage.setItem("aptbot_sessions", JSON.stringify(sessions));
  }, [sessions]);

  const activeSession = sessions.find(s => s.id === activeSessionId) || null;
  const activeAgent = agents.find(a => a.id === activeAgentId) || null;

  // Format current local time (e.g., "14:21")
  const getFormattedTime = () => {
    const now = new Date();
    const h = String(now.getHours()).padStart(2, "0");
    const m = String(now.getMinutes()).padStart(2, "0");
    return `${h}:${m}`;
  };

  // Create new session/chat
  const handleCreateSession = (agentId: string, title?: string) => {
    const newSession: Session = {
      id: `s-${Date.now()}`,
      title: title || `新会话 ${getFormattedTime()}`,
      agentId: agentId,
      messages: [],
      createdAt: Date.now()
    };
    setSessions(prev => [newSession, ...prev]);
    setActiveAgentId(agentId);
    setActiveSessionId(newSession.id);
  };

  // Delete session if empty or customized
  const handleDeleteSession = (sessionId: string) => {
    setSessions(prev => prev.filter(s => s.id !== sessionId));
    if (activeSessionId === sessionId) {
      const remaining = sessions.filter(s => s.id !== sessionId);
      if (remaining.length > 0) {
        setActiveSessionId(remaining[0].id);
        setActiveAgentId(remaining[0].agentId);
      }
    }
  };

  // Handle Select Agent
  const handleSelectAgent = (agentId: string) => {
    setActiveAgentId(agentId);
    // Find first session belonging to this agent, or create one
    const agentSession = sessions.find(s => s.agentId === agentId);
    if (agentSession) {
      setActiveSessionId(agentSession.id);
    } else {
      handleCreateSession(agentId, "新会话");
    }
  };

  // Handle Select Session
  const handleSelectSession = (sessionId: string) => {
    const session = sessions.find(s => s.id === sessionId);
    if (session) {
      setActiveSessionId(sessionId);
      setActiveAgentId(session.agentId);
    }
  };

  // Handle Send Message (and request response from backend)
  const handleSendMessage = async (content: string, files?: AttachedFile[]) => {
    if (!content.trim() && (!files || files.length === 0)) return;

    let targetSessionId = activeSessionId;
    let currentSession = activeSession;

    // Auto-create session if active session is missing or doesn't match active agent
    if (!currentSession || currentSession.agentId !== activeAgentId) {
      const newSId = `s-${Date.now()}`;
      const title = content.trim().slice(0, 16) || "代码咨询";
      const newSession: Session = {
        id: newSId,
        title: title,
        agentId: activeAgentId,
        messages: [],
        createdAt: Date.now()
      };
      setSessions(prev => [newSession, ...prev]);
      targetSessionId = newSId;
      currentSession = newSession;
      setActiveSessionId(newSId);
    }

    const userMsg: Message = {
      id: `m-u-${Date.now()}`,
      role: "user",
      content,
      timestamp: getFormattedTime(),
      files
    };

    // Update session title to the first user question if it was unnamed
    const isFirstMsg = currentSession.messages.length === 0;
    const updatedTitle = isFirstMsg 
      ? (content.trim().slice(0, 15) || "新会话") 
      : currentSession.title;

    // Append user message immediately
    setSessions(prev => prev.map(s => {
      if (s.id === targetSessionId) {
        return {
          ...s,
          title: updatedTitle,
          messages: [...s.messages, userMsg]
        };
      }
      return s;
    }));

    // Add placeholder AI reply
    const aiPlaceholderId = `m-a-${Date.now()}`;
    const aiPlaceholder: Message = {
      id: aiPlaceholderId,
      role: "assistant",
      content: "思考中...",
      timestamp: getFormattedTime(),
      modelUsed: selectedModel.name,
      agentName: activeAgent?.name || "通用智能体"
    };

    setSessions(prev => prev.map(s => {
      if (s.id === targetSessionId) {
        return {
          ...s,
          messages: [...s.messages, aiPlaceholder]
        };
      }
      return s;
    }));

    setIsGenerating(true);

    try {
      // Gather dialogue history for context
      const chatHistory = currentSession.messages.map(m => ({
        role: m.role,
        content: m.content
      }));

      // Post to our server endpoint
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: content,
          history: chatHistory,
          systemPrompt: activeAgent?.systemPrompt,
          model: selectedModel.backendModel
        })
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || "获取回复失败");
      }

      // Update AI Message with actual text
      setSessions(prev => prev.map(s => {
        if (s.id === targetSessionId) {
          return {
            ...s,
            messages: s.messages.map(m => {
              if (m.id === aiPlaceholderId) {
                return { ...m, content: data.text, timestamp: getFormattedTime() };
              }
              return m;
            })
          };
        }
        return s;
      }));

    } catch (err: any) {
      console.error(err);
      const errMsg = `⚠️ 获取 AI 响应时出错：${err.message || "未知错误"}\n\n可能的原因：\n1. 请检查您的 **Settings > Secrets** 里的 **GEMINI_API_KEY** 是否配置并激活。\n2. 服务器连接异常，请稍后重试。`;
      
      setSessions(prev => prev.map(s => {
        if (s.id === targetSessionId) {
          return {
            ...s,
            messages: s.messages.map(m => {
              if (m.id === aiPlaceholderId) {
                return { ...m, content: errMsg, timestamp: getFormattedTime() };
              }
              return m;
            })
          };
        }
        return s;
      }));
    } finally {
      setIsGenerating(false);
    }
  };

  // Regenerate assistant message
  const handleRegenerate = async (messageId: string) => {
    if (!activeSession) return;

    // Find the message index
    const idx = activeSession.messages.findIndex(m => m.id === messageId);
    if (idx === -1) return;

    // Find previous user message
    let userMessageContent = "";
    let userFiles: AttachedFile[] | undefined;
    for (let i = idx - 1; i >= 0; i--) {
      if (activeSession.messages[i].role === "user") {
        userMessageContent = activeSession.messages[i].content;
        userFiles = activeSession.messages[i].files;
        break;
      }
    }

    if (!userMessageContent) return;

    // Delete everything after the previous user message
    const trimmedMessages = activeSession.messages.slice(0, idx);
    setSessions(prev => prev.map(s => {
      if (s.id === activeSessionId) {
        return { ...s, messages: trimmedMessages };
      }
      return s;
    }));

    // Trigger sending again
    handleSendMessage(userMessageContent, userFiles);
  };

  // Create custom agent
  const handleSaveCreateAgent = (name: string, description: string, prompt: string, iconName: string) => {
    const newAgent: Agent = {
      id: `agent-${Date.now()}`,
      name,
      description: description.trim() || prompt.slice(0, 64) || "自定义专业助手",
      systemPrompt: prompt,
      iconName,
      isCustom: true
    };
    setAgents(prev => [...prev, newAgent]);
    setActiveAgentId(newAgent.id);
    handleCreateSession(newAgent.id, `${name}会话`);
  };

  // Edit custom agent
  const handleSaveEditAgent = (id: string, name: string, description: string, prompt: string, iconName: string) => {
    setAgents(prev => prev.map(a => {
      if (a.id === id) {
        return {
          ...a,
          name,
          description: description.trim() || prompt.slice(0, 64) || "自定义专业助手",
          systemPrompt: prompt,
          iconName
        };
      }
      return a;
    }));
  };

  // Delete custom agent
  const handleDeleteAgent = (agentId: string) => {
    if (window.confirm("确定要删除这个智能体吗？此操作不可恢复。")) {
      setAgents(prev => prev.filter(a => a.id !== agentId));
      setSessions(prev => prev.filter(s => s.agentId !== agentId));
      if (activeAgentId === agentId) {
        setActiveAgentId("general");
        const generalSession = sessions.find(s => s.agentId === "general");
        if (generalSession) setActiveSessionId(generalSession.id);
      }
    }
  };

  // Search Sessions Filter
  const filteredSessions = searchQuery.trim()
    ? sessions.filter(s => s.title.toLowerCase().includes(searchQuery.toLowerCase()))
    : sessions;

  return (
    <div className="flex h-screen overflow-hidden text-black font-sans">
      
      {/* Sidebar */}
      <Sidebar 
        agents={agents}
        sessions={filteredSessions}
        activeAgentId={activeAgentId}
        activeSessionId={activeSessionId}
        onSelectAgent={handleSelectAgent}
        onSelectSession={handleSelectSession}
        onCreateSession={handleCreateSession}
        onOpenCreateAgentModal={() => setIsCreateOpen(true)}
        onOpenEditAgentModal={(agent) => {
          setEditingAgent(agent);
          setIsEditOpen(true);
        }}
        onDeleteAgent={handleDeleteAgent}
        currentUser={currentUser}
        onLogout={handleLogout}
        onLoginTrigger={() => setIsAuthModalOpen(true)}
      />

      {/* Main Workspace Frame */}
      <main className="flex-1 ml-64 flex flex-col h-screen relative bg-white">
        
        {/* Header */}
        <header className="flex justify-between items-center w-full px-6 lg:px-8 h-16 sticky top-0 bg-white border-b border-slate-200 z-10 select-none">
          <div className="flex items-center gap-4">
            <h2 className="font-sans text-[20px] font-bold text-black tracking-tight flex items-center gap-2">
              <span>Aptbot Workspace</span>
              {isGenerating && <Loader2 className="w-4 h-4 text-neutral-400 animate-spin" />}
            </h2>
          </div>
          
          <div className="flex items-center gap-4">
            {/* Search Input */}
            <div className="relative hidden md:block">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400 w-4 h-4" />
              <input 
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-10 pr-4 py-1.5 bg-neutral-50 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-1 focus:ring-black focus:bg-white w-64 transition-all placeholder:text-neutral-400"
                placeholder="搜索会话..."
              />
            </div>

            <button 
              onClick={() => alert("暂无新通知。")}
              className="w-10 h-10 flex items-center justify-center rounded-full text-neutral-500 hover:bg-neutral-100 transition-colors cursor-pointer"
              title="通知中心"
            >
              <Bell className="w-5 h-5" />
            </button>
            <button 
              onClick={() => alert("Aptbot 精度工作区：\n1. 支持自定义智能体，配置专属性格 (System Instruction)。\n2. 多模型一键切换。\n3. 支持上传文件协同解析代码。")}
              className="w-10 h-10 flex items-center justify-center rounded-full text-neutral-500 hover:bg-neutral-100 transition-colors cursor-pointer"
              title="帮助说明"
            >
              <HelpCircle className="w-5 h-5" />
            </button>
          </div>
        </header>

        {/* Chat Area Panel */}
        <ChatArea 
          activeAgent={activeAgent}
          messages={activeSession ? activeSession.messages : []}
          onRegenerate={handleRegenerate}
        />

        {/* Input Area Panel */}
        <InputArea 
          agents={agents}
          activeAgentId={activeAgentId}
          onSelectAgent={handleSelectAgent}
          selectedModel={selectedModel}
          onSelectModel={setSelectedModel}
          models={AVAILABLE_MODELS}
          onSendMessage={handleSendMessage}
        />

      </main>

      {/* Modals for Customizing Agents */}
      <AgentModals 
        isCreateOpen={isCreateOpen}
        isEditOpen={isEditOpen}
        editingAgent={editingAgent}
        onCloseCreate={() => setIsCreateOpen(false)}
        onCloseEdit={() => {
          setIsEditOpen(false);
          setEditingAgent(null);
        }}
        onSaveCreate={handleSaveCreateAgent}
        onSaveEdit={handleSaveEditAgent}
      />

      <AuthModal 
        isOpen={isAuthModalOpen}
        onClose={() => setIsAuthModalOpen(false)}
        onLoginSuccess={handleLoginSuccess}
      />

    </div>
  );
}

