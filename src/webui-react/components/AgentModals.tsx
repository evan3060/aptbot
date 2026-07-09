/**
 * Task 7 (React WebUI redesign): 智能体创建/编辑弹窗组件。
 *
 * 迁移自 aistudio-design/src/components/AgentModals.tsx，保留极简黑白灰视觉风格、
 * 4 个图标选项（cpu / brain / terminal / palette）、名称/描述/System Prompt 三段表单。
 *
 * 关键适配（brief Step 1）：
 * 1. 表单的 `systemPrompt` 字段映射到后端 `personality` 字段（CreateAgentRequest.personality）
 * 2. 创建：调用 `api.createAgent({ name, description, personality, iconName })`，成功后 `onSaved()` 刷新列表
 * 3. 编辑：调用 `api.updateAgent(slug, { name, description, personality, iconName })`
 * 4. 错误处理：API 失败时在弹窗内显示错误提示（不关闭弹窗）
 * 5. 编辑弹窗在 `editingAgent` 变化时加载其字段到表单（name / description / personality / iconName）
 *
 * 与 AuthModal 的视觉一致性：背景 bg-black/40 backdrop-blur-xs、卡片 bg-white border-slate-200、
 * 文字 text-black / text-neutral-*、聚焦 ring-black；错误提示用 AlertCircle + 中性色背景（无彩色）。
 */
import { useState, useEffect } from 'react';
import { X, UserPlus, Settings2, Cpu, Terminal, Palette, Brain, AlertCircle } from 'lucide-react';
import type { AgentProfile } from '../types.js';
import { api } from '../lib/api.js';

interface AgentModalsProps {
  isCreateOpen: boolean;
  isEditOpen: boolean;
  editingAgent: AgentProfile | null;
  onCloseCreate: () => void;
  onCloseEdit: () => void;
  /** 创建/编辑成功后触发（父组件刷新 agent 列表）。
   *  创建时传入新 agent 的 slug，父组件可切换到该 agent 并新建 session。 */
  onSaved: (createdSlug?: string) => void;
}

/** 4 个图标选项（brief Step 1.4：保留 cpu / brain / terminal / palette） */
const ICON_OPTIONS = [
  { id: 'cpu', label: 'CPU', icon: <Cpu className="w-4 h-4" /> },
  { id: 'brain', label: '大脑', icon: <Brain className="w-4 h-4" /> },
  { id: 'terminal', label: '终端', icon: <Terminal className="w-4 h-4" /> },
  { id: 'palette', label: '画布', icon: <Palette className="w-4 h-4" /> },
];

const DEFAULT_ICON = 'cpu';

export default function AgentModals({
  isCreateOpen,
  isEditOpen,
  editingAgent,
  onCloseCreate,
  onCloseEdit,
  onSaved,
}: AgentModalsProps) {
  // Create Modal state
  const [createName, setCreateName] = useState('');
  const [createDescription, setCreateDescription] = useState('');
  const [createPrompt, setCreatePrompt] = useState('');
  const [createIcon, setCreateIcon] = useState(DEFAULT_ICON);
  const [createError, setCreateError] = useState('');
  const [createSubmitting, setCreateSubmitting] = useState(false);

  // Edit Modal state
  const [editName, setEditName] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [editPrompt, setEditPrompt] = useState('');
  const [editIcon, setEditIcon] = useState(DEFAULT_ICON);
  const [editError, setEditError] = useState('');
  const [editSubmitting, setEditSubmitting] = useState(false);

  // Create modal opens → reset form
  useEffect(() => {
    if (isCreateOpen) {
      setCreateName('');
      setCreateDescription('');
      setCreatePrompt('');
      setCreateIcon(DEFAULT_ICON);
      setCreateError('');
      setCreateSubmitting(false);
    }
  }, [isCreateOpen]);

  // Edit modal opens or editingAgent changes → load its values into the form
  useEffect(() => {
    if (isEditOpen && editingAgent) {
      setEditName(editingAgent.name);
      setEditDescription(editingAgent.description || '');
      setEditPrompt(editingAgent.personality || '');
      setEditIcon(editingAgent.iconName || DEFAULT_ICON);
      setEditError('');
      setEditSubmitting(false);
    }
  }, [isEditOpen, editingAgent]);

  const handleCreateSubmit = async () => {
    if (!createName.trim() || createSubmitting) return;
    setCreateSubmitting(true);
    setCreateError('');
    try {
      const created = await api.createAgent({
        name: createName.trim(),
        description: createDescription.trim(),
        personality: createPrompt,
        iconName: createIcon,
      });
      onSaved(created.slug);
      onCloseCreate();
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : '创建智能体失败');
    } finally {
      setCreateSubmitting(false);
    }
  };

  const handleEditSubmit = async () => {
    if (!editingAgent || !editName.trim() || editSubmitting) return;
    setEditSubmitting(true);
    setEditError('');
    try {
      await api.updateAgent(editingAgent.slug, {
        name: editName.trim(),
        description: editDescription.trim(),
        personality: editPrompt,
        iconName: editIcon,
      });
      onSaved();
      onCloseEdit();
    } catch (err) {
      setEditError(err instanceof Error ? err.message : '更新智能体失败');
    } finally {
      setEditSubmitting(false);
    }
  };

  return (
    <>
      {/* Create Agent Modal */}
      {isCreateOpen && (
        <div data-testid="create-agent-modal" className="fixed inset-0 z-[100] flex items-center justify-center p-0 md:p-4">
          {/* Backdrop */}
          <div
            className="absolute inset-0 bg-black/40 backdrop-blur-xs"
            onClick={onCloseCreate}
          />

          <div className="w-full max-w-full md:max-w-lg h-full md:h-auto bg-white rounded-none md:rounded-lg border border-slate-200 shadow-2xl overflow-y-auto md:overflow-hidden fixed md:relative inset-0 md:inset-auto">
            {/* Header */}
            <div className="sticky top-0 z-10 px-4 py-3 md:p-5 border-b border-slate-200 flex justify-between items-center bg-white">
              <h3 className="text-lg font-bold text-black flex items-center gap-2">
                <UserPlus className="w-5 h-5 text-black" />
                <span>新建智能体</span>
              </h3>
              <button
                className="text-neutral-400 hover:text-black transition-colors cursor-pointer"
                onClick={onCloseCreate}
                aria-label="关闭"
                data-testid="create-agent-close"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Content */}
            <div className="p-4 md:p-6 space-y-6 bg-white">
              {createError && (
                <div className="flex items-center gap-2 p-2.5 bg-neutral-50 text-black text-xs rounded-lg border border-slate-200">
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  <span>{createError}</span>
                </div>
              )}

              <div className="space-y-2">
                <label className="block text-[10px] font-bold text-neutral-400 uppercase tracking-widest">
                  智能体名称
                </label>
                <input
                  type="text"
                  value={createName}
                  onChange={(e) => setCreateName(e.target.value)}
                  data-testid="create-agent-name"
                  className="w-full bg-white border border-slate-200 rounded-lg px-4 py-2.5 text-sm focus:ring-1 focus:ring-black focus:border-black focus:outline-none text-black"
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
                  data-testid="create-agent-description"
                  className="w-full bg-white border border-slate-200 rounded-lg px-4 py-2.5 text-sm focus:ring-1 focus:ring-black focus:border-black focus:outline-none text-black"
                  placeholder="输入简短的智能体功能描述..."
                />
              </div>

              <div className="space-y-2">
                <label className="block text-[10px] font-bold text-neutral-400 uppercase tracking-widest">
                  选择图标
                </label>
                <div className="grid grid-cols-4 gap-2">
                  {ICON_OPTIONS.map((opt) => (
                    <button
                      key={opt.id}
                      type="button"
                      onClick={() => setCreateIcon(opt.id)}
                      data-testid={`create-agent-icon-${opt.id}`}
                      className={`flex flex-col items-center gap-1.5 p-2.5 rounded-lg border text-xs font-semibold cursor-pointer transition-all ${
                        createIcon === opt.id
                          ? 'border-black bg-neutral-50 text-black shadow-xs'
                          : 'border-slate-200 text-neutral-500 hover:border-neutral-400'
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
                  data-testid="create-agent-prompt"
                  className="w-full bg-white border border-slate-200 rounded-lg px-4 py-3 text-sm focus:ring-1 focus:ring-black focus:border-black focus:outline-none resize-none font-mono text-xs leading-relaxed text-black"
                  placeholder="定义智能体的性格、专业背景、任务约束等。例如：'你是一个精通 React 和 TypeScript 的高级前端专家...'"
                  rows={4}
                />
              </div>
            </div>

            {/* Footer */}
            <div className="sticky bottom-0 z-10 px-4 py-3 md:p-5 bg-neutral-50 border-t border-slate-200 flex justify-end gap-3">
              <button
                className="px-5 py-2.5 rounded-lg text-sm font-bold text-neutral-500 hover:text-black transition-all cursor-pointer"
                onClick={onCloseCreate}
                disabled={createSubmitting}
                data-testid="create-agent-cancel"
              >
                取消
              </button>
              <button
                disabled={!createName.trim() || createSubmitting}
                data-testid="create-agent-save"
                className="px-5 py-2.5 rounded-lg bg-black text-white text-sm font-bold shadow-sm hover:bg-neutral-900 transition-all active:scale-95 disabled:bg-neutral-200 disabled:text-neutral-400 disabled:shadow-none disabled:active:scale-100 cursor-pointer"
                onClick={handleCreateSubmit}
              >
                {createSubmitting ? '保存中...' : '保存'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Edit Agent Modal */}
      {isEditOpen && editingAgent && (
        <div data-testid="edit-agent-modal" className="fixed inset-0 z-[100] flex items-center justify-center p-0 md:p-4">
          {/* Backdrop */}
          <div
            className="absolute inset-0 bg-black/40 backdrop-blur-xs"
            onClick={onCloseEdit}
          />

          <div className="w-full max-w-full md:max-w-lg h-full md:h-auto bg-white rounded-none md:rounded-lg border border-slate-200 shadow-2xl overflow-y-auto md:overflow-hidden fixed md:relative inset-0 md:inset-auto">
            {/* Header */}
            <div className="sticky top-0 z-10 px-4 py-3 md:p-5 border-b border-slate-200 flex justify-between items-center bg-white">
              <h3 className="text-lg font-bold text-black flex items-center gap-2">
                <Settings2 className="w-5 h-5 text-black" />
                <span>修改智能体</span>
              </h3>
              <button
                className="text-neutral-400 hover:text-black transition-colors cursor-pointer"
                onClick={onCloseEdit}
                aria-label="关闭"
                data-testid="edit-agent-close"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Content */}
            <div className="p-4 md:p-6 space-y-6 bg-white">
              {editError && (
                <div className="flex items-center gap-2 p-2.5 bg-neutral-50 text-black text-xs rounded-lg border border-slate-200">
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  <span>{editError}</span>
                </div>
              )}

              <div className="space-y-2">
                <label className="block text-[10px] font-bold text-neutral-400 uppercase tracking-widest">
                  智能体名称
                </label>
                <input
                  type="text"
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  data-testid="edit-agent-name"
                  className="w-full bg-white border border-slate-200 rounded-lg px-4 py-2.5 text-sm focus:ring-1 focus:ring-black focus:border-black focus:outline-none text-black"
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
                  data-testid="edit-agent-description"
                  className="w-full bg-white border border-slate-200 rounded-lg px-4 py-2.5 text-sm focus:ring-1 focus:ring-black focus:border-black focus:outline-none text-black"
                  placeholder="输入简短的智能体功能描述..."
                />
              </div>

              <div className="space-y-2">
                <label className="block text-[10px] font-bold text-neutral-400 uppercase tracking-widest">
                  选择图标
                </label>
                <div className="grid grid-cols-4 gap-2">
                  {ICON_OPTIONS.map((opt) => (
                    <button
                      key={opt.id}
                      type="button"
                      onClick={() => setEditIcon(opt.id)}
                      data-testid={`edit-agent-icon-${opt.id}`}
                      className={`flex flex-col items-center gap-1.5 p-2.5 rounded-lg border text-xs font-semibold cursor-pointer transition-all ${
                        editIcon === opt.id
                          ? 'border-black bg-neutral-50 text-black shadow-xs'
                          : 'border-slate-200 text-neutral-500 hover:border-neutral-400'
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
                  data-testid="edit-agent-prompt"
                  className="w-full bg-white border border-slate-200 rounded-lg px-4 py-3 text-sm focus:ring-1 focus:ring-black focus:border-black focus:outline-none resize-none font-mono text-xs leading-relaxed text-black"
                  placeholder="定义智能体的性格和任务..."
                  rows={4}
                />
              </div>
            </div>

            {/* Footer */}
            <div className="sticky bottom-0 z-10 px-4 py-3 md:p-5 bg-neutral-50 border-t border-slate-200 flex justify-end gap-3">
              <button
                className="px-5 py-2.5 rounded-lg text-sm font-bold text-neutral-500 hover:text-black transition-all cursor-pointer"
                onClick={onCloseEdit}
                disabled={editSubmitting}
                data-testid="edit-agent-cancel"
              >
                取消
              </button>
              <button
                disabled={!editName.trim() || editSubmitting}
                data-testid="edit-agent-save"
                className="px-5 py-2.5 rounded-lg bg-black text-white text-sm font-bold shadow-sm hover:bg-neutral-900 transition-all active:scale-95 disabled:bg-neutral-200 disabled:text-neutral-400 disabled:shadow-none disabled:active:scale-100 cursor-pointer"
                onClick={handleEditSubmit}
              >
                {editSubmitting ? '保存中...' : '保存'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
