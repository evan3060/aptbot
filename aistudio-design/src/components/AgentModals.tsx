import { X, UserPlus, Settings2, Cpu, Terminal, Palette, Brain } from "lucide-react";
import { Agent } from "../types";
import { useState, useEffect } from "react";

interface AgentModalsProps {
  isCreateOpen: boolean;
  isEditOpen: boolean;
  editingAgent: Agent | null;
  onCloseCreate: () => void;
  onCloseEdit: () => void;
  onSaveCreate: (name: string, description: string, prompt: string, iconName: string) => void;
  onSaveEdit: (id: string, name: string, description: string, prompt: string, iconName: string) => void;
}

export default function AgentModals({
  isCreateOpen,
  isEditOpen,
  editingAgent,
  onCloseCreate,
  onCloseEdit,
  onSaveCreate,
  onSaveEdit
}: AgentModalsProps) {
  // Create Modal state
  const [createName, setCreateName] = useState("");
  const [createDescription, setCreateDescription] = useState("");
  const [createPrompt, setCreatePrompt] = useState("");
  const [createIcon, setCreateIcon] = useState("cpu");

  // Edit Modal state
  const [editName, setEditName] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [editPrompt, setEditPrompt] = useState("");
  const [editIcon, setEditIcon] = useState("cpu");

  // Load editing agent details when open
  useEffect(() => {
    if (editingAgent) {
      setEditName(editingAgent.name);
      setEditDescription(editingAgent.description || "");
      setEditPrompt(editingAgent.systemPrompt);
      setEditIcon(editingAgent.iconName);
    }
  }, [editingAgent, isEditOpen]);

  const handleCreateSubmit = () => {
    if (!createName.trim()) return;
    onSaveCreate(createName, createDescription, createPrompt, createIcon);
    setCreateName("");
    setCreateDescription("");
    setCreatePrompt("");
    setCreateIcon("cpu");
    onCloseCreate();
  };

  const handleEditSubmit = () => {
    if (!editingAgent || !editName.trim()) return;
    onSaveEdit(editingAgent.id, editName, editDescription, editPrompt, editIcon);
    onCloseEdit();
  };

  const iconOptions = [
    { id: "cpu", label: "CPU", icon: <Cpu className="w-4 h-4" /> },
    { id: "brain", label: "大脑", icon: <Brain className="w-4 h-4" /> },
    { id: "terminal", label: "终端", icon: <Terminal className="w-4 h-4" /> },
    { id: "palette", label: "画布", icon: <Palette className="w-4 h-4" /> }
  ];

  return (
    <>
      {/* Create Agent Modal */}
      {isCreateOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center">
          {/* Backdrop */}
          <div className="absolute inset-0 bg-black/40 backdrop-blur-xs" onClick={onCloseCreate}></div>
          
          <div className="relative w-full max-w-lg bg-white rounded-lg border border-neutral-300 shadow-2xl overflow-hidden animate-in fade-in zoom-in duration-200">
            {/* Header */}
            <div className="p-5 border-b border-neutral-200 flex justify-between items-center bg-white">
              <h3 className="text-lg font-bold text-black flex items-center gap-2">
                <UserPlus className="w-5 h-5 text-black" />
                <span>新建智能体</span>
              </h3>
              <button 
                className="text-neutral-400 hover:text-black transition-colors cursor-pointer" 
                onClick={onCloseCreate}
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Content */}
            <div className="p-6 space-y-6 bg-white">
              <div className="space-y-2">
                <label className="block text-[10px] font-bold text-neutral-400 uppercase tracking-widest">
                  智能体名称
                </label>
                <input 
                  type="text"
                  value={createName}
                  onChange={(e) => setCreateName(e.target.value)}
                  className="w-full bg-white border border-neutral-300 rounded-lg px-4 py-2.5 text-sm focus:ring-1 focus:ring-black focus:border-black focus:outline-none" 
                  placeholder="输入智能体名称" 
                />
              </div>

              <div className="space-y-2">
                <label className="block text-[10px] font-bold text-neutral-400 uppercase tracking-widest">
                  智能体描述
                </label>
                <input 
                  type="text"
                  value={createDescription}
                  onChange={(e) => setCreateDescription(e.target.value)}
                  className="w-full bg-white border border-neutral-300 rounded-lg px-4 py-2.5 text-sm focus:ring-1 focus:ring-black focus:border-black focus:outline-none" 
                  placeholder="输入简短的智能体功能描述..." 
                />
              </div>

              <div className="space-y-2">
                <label className="block text-[10px] font-bold text-neutral-400 uppercase tracking-widest">
                  选择图标
                </label>
                <div className="grid grid-cols-4 gap-2">
                  {iconOptions.map((opt) => (
                    <button
                      key={opt.id}
                      type="button"
                      onClick={() => setCreateIcon(opt.id)}
                      className={`flex flex-col items-center gap-1.5 p-2.5 rounded-lg border text-xs font-semibold cursor-pointer transition-all ${
                        createIcon === opt.id 
                          ? "border-black bg-neutral-50 text-black shadow-xs" 
                          : "border-neutral-200 text-neutral-500 hover:border-neutral-400"
                      }`}
                    >
                      {opt.icon}
                      <span>{opt.label}</span>
                    </button>
                  ))}
                </div>
              </div>

              <div className="space-y-2">
                <label className="block text-[10px] font-bold text-neutral-400 uppercase tracking-widest">
                  性格与指令设定 (System Prompt)
                </label>
                <textarea 
                  value={createPrompt}
                  onChange={(e) => setCreatePrompt(e.target.value)}
                  className="w-full bg-white border border-neutral-300 rounded-lg px-4 py-3 text-sm focus:ring-1 focus:ring-black focus:border-black focus:outline-none resize-none font-mono text-xs leading-relaxed" 
                  placeholder="定义智能体的性格、专业背景、任务约束等。例如：'你是一个精通 React 和 TypeScript 的高级前端专家...'" 
                  rows={4}
                />
              </div>
            </div>

            {/* Footer */}
            <div className="p-5 bg-neutral-50 border-t border-neutral-200 flex justify-end gap-3">
              <button 
                className="px-5 py-2.5 rounded-lg text-sm font-bold text-neutral-500 hover:text-black transition-all cursor-pointer" 
                onClick={onCloseCreate}
              >
                取消
              </button>
              <button 
                disabled={!createName.trim()}
                className="px-5 py-2.5 rounded-lg bg-black text-white text-sm font-bold shadow-sm hover:bg-neutral-900 transition-all active:scale-95 disabled:bg-neutral-200 disabled:text-neutral-400 disabled:shadow-none disabled:active:scale-100 cursor-pointer" 
                onClick={handleCreateSubmit}
              >
                保存
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Edit Agent Modal */}
      {isEditOpen && editingAgent && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center">
          {/* Backdrop */}
          <div className="absolute inset-0 bg-black/40 backdrop-blur-xs" onClick={onCloseEdit}></div>
          
          <div className="relative w-full max-w-lg bg-white rounded-lg border border-neutral-300 shadow-2xl overflow-hidden animate-in fade-in zoom-in duration-200">
            {/* Header */}
            <div className="p-5 border-b border-neutral-200 flex justify-between items-center bg-white">
              <h3 className="text-lg font-bold text-black flex items-center gap-2">
                <Settings2 className="w-5 h-5 text-black" />
                <span>修改智能体</span>
              </h3>
              <button 
                className="text-neutral-400 hover:text-black transition-colors cursor-pointer" 
                onClick={onCloseEdit}
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Content */}
            <div className="p-6 space-y-6 bg-white">
              <div className="space-y-2">
                <label className="block text-[10px] font-bold text-neutral-400 uppercase tracking-widest">
                  智能体名称
                </label>
                <input 
                  type="text"
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  className="w-full bg-white border border-neutral-300 rounded-lg px-4 py-2.5 text-sm focus:ring-1 focus:ring-black focus:border-black focus:outline-none" 
                  placeholder="输入智能体名称" 
                />
              </div>

              <div className="space-y-2">
                <label className="block text-[10px] font-bold text-neutral-400 uppercase tracking-widest">
                  智能体描述
                </label>
                <input 
                  type="text"
                  value={editDescription}
                  onChange={(e) => setEditDescription(e.target.value)}
                  className="w-full bg-white border border-neutral-300 rounded-lg px-4 py-2.5 text-sm focus:ring-1 focus:ring-black focus:border-black focus:outline-none" 
                  placeholder="输入简短的智能体功能描述..." 
                />
              </div>

              <div className="space-y-2">
                <label className="block text-[10px] font-bold text-neutral-400 uppercase tracking-widest">
                  选择图标
                </label>
                <div className="grid grid-cols-4 gap-2">
                  {iconOptions.map((opt) => (
                    <button
                      key={opt.id}
                      type="button"
                      onClick={() => setEditIcon(opt.id)}
                      className={`flex flex-col items-center gap-1.5 p-2.5 rounded-lg border text-xs font-semibold cursor-pointer transition-all ${
                        editIcon === opt.id 
                          ? "border-black bg-neutral-50 text-black shadow-xs" 
                          : "border-neutral-200 text-neutral-500 hover:border-neutral-400"
                      }`}
                    >
                      {opt.icon}
                      <span>{opt.label}</span>
                    </button>
                  ))}
                </div>
              </div>

              <div className="space-y-2">
                <label className="block text-[10px] font-bold text-neutral-400 uppercase tracking-widest">
                  性格与指令设定 (System Prompt)
                </label>
                <textarea 
                  value={editPrompt}
                  onChange={(e) => setEditPrompt(e.target.value)}
                  className="w-full bg-white border border-neutral-300 rounded-lg px-4 py-3 text-sm focus:ring-1 focus:ring-black focus:border-black focus:outline-none resize-none font-mono text-xs leading-relaxed" 
                  placeholder="定义智能体的性格和任务..." 
                  rows={4}
                />
              </div>
            </div>

            {/* Footer */}
            <div className="p-5 bg-neutral-50 border-t border-neutral-200 flex justify-end gap-3">
              <button 
                className="px-5 py-2.5 rounded-lg text-sm font-bold text-neutral-500 hover:text-black transition-all cursor-pointer" 
                onClick={onCloseEdit}
              >
                取消
              </button>
              <button 
                disabled={!editName.trim()}
                className="px-5 py-2.5 rounded-lg bg-black text-white text-sm font-bold shadow-sm hover:bg-neutral-900 transition-all active:scale-95 disabled:bg-neutral-200 disabled:text-neutral-400 disabled:shadow-none disabled:active:scale-100 cursor-pointer" 
                onClick={handleEditSubmit}
              >
                保存
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
