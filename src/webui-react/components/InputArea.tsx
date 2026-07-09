/**
 * Task 6 (React WebUI redesign): 输入区组件。
 *
 * 迁移自 aistudio-design/src/components/InputArea.tsx，做以下适配：
 * 1. 16 个快捷指令按钮（仅在 activeAgentSlug === 'default' 即通用智能体时显示），
 *    点击时填充 textarea
 * 2. handleSend：trim 后的文本以 `/` 开头 → onSendSlash(content)，否则 → onSendMessage(content)。
 *    发送后清空 textarea 和附件
 * 3. Agent 选择下拉框使用 `slug`（与 Sidebar 一致，替代原 aistudio-design 的 id）
 * 4. Model 选择下拉框：bootstrap.model 单一默认模型，下拉仅显示当前选中
 *    （App.tsx 在 Task 9 把 bootstrap.model 字符串包装成单元素 ModelOption[] 传入）
 * 5. 思考深度下拉框保留 UI（前端状态，后端暂未支持）
 * 6. 文件附件：保留 UI，但后端暂未支持文件上传，点击按钮提示"文件附件功能开发中"
 * 7. 上下文 token 显示保留（mock 计算：基于 textarea 长度估算）
 *
 * 仅 emit 事件；WebSocket 发送由 App.tsx（Task 9）通过 WsClient.send / sendSlash 完成。
 *
 * 0.3.1 移动端适配 (Task 7)：
 * - 快捷指令区：useQuickActionsLayout hook 自适应缩放，溢出按钮收入「更多 ⋯」面板
 * - 下拉框（agent/model/思考深度）移动端收入「⚙️ 设置」toggle collapsible panel
 * - textarea：text-base（防 iOS 缩放） + 响应式 min-height
 */
import { useState, useRef, useLayoutEffect, useEffect, type KeyboardEvent, type ReactNode } from 'react';
import {
  Languages,
  Wand2,
  BookOpen,
  Paperclip,
  Send,
  Sparkles,
  Mail,
  ClipboardList,
  Briefcase,
  Presentation,
  Minimize2,
  PenTool,
  CalendarCheck,
  CheckSquare,
  Type,
  MessageSquare,
  BarChart3,
  Lightbulb,
  Database,
  Settings,
  MoreHorizontal,
} from 'lucide-react';
import type { AgentProfile, ModelOption } from '../types.js';
import { useQuickActionsLayout, type QuickActionButton } from '../lib/use-quick-actions-layout.js';

/** 附件条目（与 reducer.ts Message.files 形状一致） */
interface AttachedFile {
  name: string;
  size: string;
}

interface InputAreaProps {
  agents: AgentProfile[];
  activeAgentSlug: string;
  onSelectAgent: (slug: string) => void;
  selectedModel: ModelOption;
  onSelectModel: (model: ModelOption) => void;
  models: ModelOption[];
  onSendMessage: (content: string, files?: AttachedFile[]) => void;
  onSendSlash: (content: string) => void;
}

/** 16 个快捷指令配置（id/label），供 useQuickActionsLayout hook 计算可见/溢出布局 */
const QUICK_ACTIONS: QuickActionButton[] = [
  { id: 'translate', label: '通用翻译' },
  { id: 'polish', label: '文章润色' },
  { id: 'layout', label: '排版美化' },
  { id: 'outline', label: '大纲生成' },
  { id: 'mail', label: '邮件撰写' },
  { id: 'meeting', label: '会议纪要' },
  { id: 'summary', label: '工作总结' },
  { id: 'ppt', label: 'PPT 大纲' },
  { id: 'extract', label: '内容提炼' },
  { id: 'copywrite', label: '文案策划' },
  { id: 'weekly', label: '周报整理' },
  { id: 'proofread', label: '纠错校对' },
  { id: 'title', label: '标题起名' },
  { id: 'tone', label: '语气转换' },
  { id: 'data', label: '数据解读' },
  { id: 'brainstorm', label: '创意脑暴' },
];

/** 快捷指令图标映射（按 id），与 QUICK_ACTIONS 顺序对应 */
const QUICK_ACTION_ICONS: Record<string, ReactNode> = {
  translate: <Languages className="w-3.5 h-3.5 text-neutral-500 shrink-0" />,
  polish: <Wand2 className="w-3.5 h-3.5 text-neutral-500 shrink-0" />,
  layout: <Sparkles className="w-3.5 h-3.5 text-neutral-500 shrink-0" />,
  outline: <BookOpen className="w-3.5 h-3.5 text-neutral-500 shrink-0" />,
  mail: <Mail className="w-3.5 h-3.5 text-neutral-500 shrink-0" />,
  meeting: <ClipboardList className="w-3.5 h-3.5 text-neutral-500 shrink-0" />,
  summary: <Briefcase className="w-3.5 h-3.5 text-neutral-500 shrink-0" />,
  ppt: <Presentation className="w-3.5 h-3.5 text-neutral-500 shrink-0" />,
  extract: <Minimize2 className="w-3.5 h-3.5 text-neutral-500 shrink-0" />,
  copywrite: <PenTool className="w-3.5 h-3.5 text-neutral-500 shrink-0" />,
  weekly: <CalendarCheck className="w-3.5 h-3.5 text-neutral-500 shrink-0" />,
  proofread: <CheckSquare className="w-3.5 h-3.5 text-neutral-500 shrink-0" />,
  title: <Type className="w-3.5 h-3.5 text-neutral-500 shrink-0" />,
  tone: <MessageSquare className="w-3.5 h-3.5 text-neutral-500 shrink-0" />,
  data: <BarChart3 className="w-3.5 h-3.5 text-neutral-500 shrink-0" />,
  brainstorm: <Lightbulb className="w-3.5 h-3.5 text-neutral-500 shrink-0" />,
};

export default function InputArea({
  agents,
  activeAgentSlug,
  onSelectAgent,
  selectedModel,
  onSelectModel,
  models,
  onSendMessage,
  onSendSlash,
}: InputAreaProps) {
  const [inputText, setInputText] = useState('');
  const [attachedFiles, setAttachedFiles] = useState<AttachedFile[]>([]);
  const [thinkingDepth, setThinkingDepth] = useState('standard');
  // 0.3.1: 移动端下拉框 collapsible 状态
  const [showSettings, setShowSettings] = useState(false);
  // 0.3.1: 快捷指令溢出面板展开状态
  const [showOverflowPanel, setShowOverflowPanel] = useState(false);
  // 0.3.1: 快捷指令容器实测宽度（ResizeObserver 写入）
  const [containerWidth, setContainerWidth] = useState(0);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const quickActionsContainerRef = useRef<HTMLDivElement>(null);
  const overflowPanelRef = useRef<HTMLDivElement>(null);
  const moreButtonRef = useRef<HTMLButtonElement>(null);

  const activeAgent = agents.find((a) => a.slug === activeAgentSlug) || null;

  /**
   * 0.3.1: 测量快捷指令容器宽度。
   * useLayoutEffect 内同步读取一次 getBoundingClientRect（避免首次渲染闪烁），
   * 随后挂载 ResizeObserver 监听后续变化；卸载时 disconnect。
   *
   * §0.3.1 Task 10 fix: 依赖 activeAgentSlug === 'default' — 切换 agent 时 quick-actions div
   * 会被移除/重建，ResizeObserver 会因元素移除触发 width=0 回调重置 containerWidth。
   * 当切回 default agent 时新 div 创建但旧 observer 已失效，effect 不再 re-run，
   * 导致 containerWidth 停留在 0（isMeasuring=true，按钮不渲染）。
   * 添加依赖确保 div 重建时 effect 重新挂载新 observer。
   */
  useLayoutEffect(() => {
    const el = quickActionsContainerRef.current;
    if (!el) return;
    setContainerWidth(el.getBoundingClientRect().width);
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setContainerWidth(entry.contentRect.width);
      }
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [activeAgentSlug === 'default']);

  /**
   * 0.3.1: 点击溢出面板与「更多」按钮之外的区域时关闭面板。
   * 仅在 showOverflowPanel 为 true 时挂载监听器，避免不必要的全局事件。
   */
  useEffect(() => {
    if (!showOverflowPanel) return;
    const handleMouseDown = (e: MouseEvent) => {
      const panel = overflowPanelRef.current;
      const moreBtn = moreButtonRef.current;
      const target = e.target as Node;
      if (panel && !panel.contains(target) && moreBtn && !moreBtn.contains(target)) {
        setShowOverflowPanel(false);
      }
    };
    document.addEventListener('mousedown', handleMouseDown);
    return () => document.removeEventListener('mousedown', handleMouseDown);
  }, [showOverflowPanel]);

  const { visibleButtons, overflowButtons, isMeasuring } = useQuickActionsLayout(
    containerWidth,
    QUICK_ACTIONS,
  );

  /**
   * 发送逻辑（brief Step 2）：
   * - trim 后为空 → 直接返回
   * - 以 `/` 开头 → onSendSlash（slash 命令）
   * - 否则 → onSendMessage（普通消息）
   * - 发送后清空 textarea 和附件
   */
  const handleSend = () => {
    const trimmed = inputText.trim();
    if (!trimmed) return;
    if (trimmed.startsWith('/')) {
      onSendSlash(trimmed);
    } else {
      onSendMessage(trimmed, attachedFiles.length > 0 ? attachedFiles : undefined);
    }
    setInputText('');
    setAttachedFiles([]);
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  /**
   * 16 个快捷指令：点击时把对应模板前缀填入 textarea，并聚焦 textarea。
   * 仅在 activeAgentSlug === 'default'（通用智能体）时显示整组按钮。
   */
  const handleQuickAction = (id: string) => {
    let prefix = '';
    switch (id) {
      case 'translate':
        prefix = '请作为专业翻译官，将以下内容翻译为准确、地道、优雅的表达（默认中英互译），并提供核心词汇解析：\n';
        break;
      case 'polish':
        prefix = '请作为资深文案编辑，对以下文章内容进行润色和修饰，提升用词专业度、语言流畅性与整体文风：\n';
        break;
      case 'layout':
        prefix = '请作为排版美化大师，使用清晰、专业且美观的 Markdown 结构（含合理标题、列表、加粗等方式）对以下文本进行重排：\n';
        break;
      case 'outline':
        prefix = '请根据以下核心想法或基础素材，帮我输出一份逻辑清晰、结构严密、重点突出且可执行的方案/文章大纲：\n';
        break;
      case 'mail':
        prefix = '请作为职场公文专家，帮我起草一封专业、得体、措辞严谨的电子邮件，核心要点如下：\n';
        break;
      case 'meeting':
        prefix = '请帮我将以下会议记录或录音文字草稿整理成一份专业、结构化、包含核心决定和具体待办事项（Action Items）的会议纪要：\n';
        break;
      case 'summary':
        prefix = '请作为职场高级经理，根据我提供的以下零散工作产出，整理成一份逻辑清晰、结果导向、凸显个人价值的工作汇报总结：\n';
        break;
      case 'ppt':
        prefix = '请围绕以下主题 and 核心诉求，帮我设计一份结构完整、分章节、含有幻灯片核心要点及演讲提示的 PPT 演示大纲：\n';
        break;
      case 'extract':
        prefix = '请对以下文本进行高度提炼，精简压缩其内容，并以核心金句、段落摘要或核心要点的形式提供，保留所有关键信息：\n';
        break;
      case 'copywrite':
        prefix = '请作为资深品牌策划，针对以下产品或活动，撰写 3 个不同风格（创意、痛点、情怀）的吸引人的营销推广文案：\n';
        break;
      case 'weekly':
        prefix = '请将我本周完成的以下零星工作记录，转化为一份结构清晰、有条理、格式规范的职场周报（包含本周进展、下周计划和遇到的难题）：\n';
        break;
      case 'proofread':
        prefix = '请帮我校对以下文本，找出其中的错别字、语法错误、标点误用或不通顺的句式，列出修改对比并说明理由：\n';
        break;
      case 'title':
        prefix = '请针对以下文章、视频或产品内容，起 10 个富有吸引力、符合传播学规律、适合不同平台分发的爆款标题：\n';
        break;
      case 'tone':
        prefix = '请将以下内容改写，将其语气调整为[专业职场/诚恳道歉/热情风趣/委婉客气]风格，以满足特定的沟通场景需求：\n';
        break;
      case 'data':
        prefix = '请作为资深数据分析师，帮我解读和分析以下指标、表格或数据结果，提取核心趋势、异常波动并给出可行的改进建议：\n';
        break;
      case 'brainstorm':
        prefix = '请围绕以下主题或想要解决的问题，进行发散性的创意头脑风暴，提供 10 个独特、新颖且具备一定落地可行性的好点子：\n';
        break;
    }
    setInputText(prefix);
    textareaRef.current?.focus();
  };

  /** 文件附件：后端暂未支持文件上传，点击按钮提示"开发中" */
  const handleAttachClick = () => {
    alert('文件附件功能开发中');
  };

  /** mock 上下文 token：基于 textarea 长度估算（输入长度 * 0.4 + 1200 基础值） */
  const tokenCount = inputText.length > 0 ? Math.ceil(inputText.length * 0.4 + 1200) : 1200;

  /**
   * 渲染单个快捷指令按钮。visible 行与 overflow 面板复用此函数。
   * - inOverflow=false：visible 行按钮，shrink-0 防压缩
   * - inOverflow=true：面板内按钮，w-full 填充网格单元格；点击后关闭面板
   */
  const renderQuickActionButton = (btn: QuickActionButton, inOverflow: boolean) => (
    <button
      key={btn.id}
      onClick={() => {
        handleQuickAction(btn.id);
        if (inOverflow) setShowOverflowPanel(false);
      }}
      className={`flex items-center gap-1.5 px-3 py-2 bg-white border border-slate-200 rounded-lg text-xs font-bold text-neutral-600 hover:text-black hover:border-black transition-all justify-center cursor-pointer select-none active:scale-95 ${
        inOverflow ? 'w-full' : 'shrink-0'
      }`}
    >
      {QUICK_ACTION_ICONS[btn.id]}
      <span className="truncate">{btn.label}</span>
    </button>
  );

  /**
   * 三个下拉框（agent / model / 思考深度）的 JSX 渲染函数。
   * 桌面端（hidden md:flex）横排显示，移动端（md:hidden）收入 collapsible 垂直堆叠。
   *
   * 0.3.1 fix: 接受 suffix 参数（'desktop' / 'mobile'）拼入 data-testid，
   * 避免桌面/移动两个实例同时渲染时出现重复 testid（否则 getByTestId 会抛
   * "multiple elements found"）。模型/思考深度下拉无 testid，仅 agent 下拉需要区分。
   */
  const renderSettingsDropdowns = (suffix: 'desktop' | 'mobile') => (
    <>
      {/* 智能体选择下拉框（slug 维度，与 Sidebar 一致） */}
      <div className="flex items-center gap-1 bg-white px-2.5 py-1 border border-slate-200 rounded text-[10px] shadow-2xs">
        <span className="font-bold text-neutral-400 uppercase tracking-wider">智能体</span>
        <select
          value={activeAgentSlug}
          onChange={(e) => onSelectAgent(e.target.value)}
          data-testid={`agent-select-${suffix}`}
          className="bg-transparent border-none p-0 pr-6 text-[10px] font-bold text-black focus:ring-0 cursor-pointer focus:outline-none"
        >
          {agents.map((a) => (
            <option key={a.slug} value={a.slug}>{a.name}</option>
          ))}
        </select>
      </div>

      {/* 模型选择下拉框 — 单一默认模型，下拉仅显示当前选中 */}
      <div className="flex items-center gap-1 bg-white px-2.5 py-1 border border-slate-200 rounded text-[10px] shadow-2xs">
        <span className="font-bold text-neutral-400 uppercase tracking-wider">模型</span>
        <select
          value={selectedModel.id}
          onChange={(e) => {
            const model = models.find((m) => m.id === e.target.value);
            if (model) onSelectModel(model);
          }}
          className="bg-transparent border-none p-0 pr-6 text-[10px] font-bold text-black focus:ring-0 cursor-pointer focus:outline-none"
        >
          {models.map((m) => (
            <option key={m.id} value={m.id}>{m.name}</option>
          ))}
        </select>
      </div>

      {/* 思考深度下拉框 — 前端状态，后端暂未支持 */}
      <div className="flex items-center gap-1 bg-white px-2.5 py-1 border border-slate-200 rounded text-[10px] shadow-2xs">
        <span className="font-bold text-neutral-400 uppercase tracking-wider">思考深度</span>
        <select
          value={thinkingDepth}
          onChange={(e) => setThinkingDepth(e.target.value)}
          className="bg-transparent border-none p-0 pr-6 text-[10px] font-bold text-black focus:ring-0 cursor-pointer focus:outline-none"
        >
          <option value="standard">标准</option>
          <option value="medium">中等</option>
          <option value="deep">深度</option>
        </select>
      </div>
    </>
  );

  return (
    <div data-testid="input-area" className="px-6 lg:px-8 py-6 bg-white border-t border-slate-200">
      <div className="mx-auto space-y-4 w-full max-w-4xl">
        {/* 快捷指令栏 — 仅在通用智能体（activeAgentSlug === 'default'）时显示。
            0.3.1: useQuickActionsLayout 自适应缩放 + 「更多」溢出面板 */}
        {activeAgentSlug === 'default' && (
          <div
            ref={quickActionsContainerRef}
            data-testid="quick-actions"
            className="relative select-none"
          >
            {isMeasuring ? (
              /* 测量阶段渲染占位（与按钮同高），避免首屏闪烁 */
              <div className="h-9" aria-hidden />
            ) : (
              <div className="flex flex-wrap gap-2">
                {visibleButtons.map((btn) => renderQuickActionButton(btn, false))}
                {overflowButtons.length > 0 && (
                  <button
                    ref={moreButtonRef}
                    onClick={() => setShowOverflowPanel((v) => !v)}
                    aria-label="更多快捷指令"
                    aria-expanded={showOverflowPanel}
                    className="flex items-center gap-1.5 px-3 py-2 bg-white border border-slate-200 rounded-lg text-xs font-bold text-neutral-600 hover:text-black hover:border-black transition-all justify-center cursor-pointer select-none active:scale-95 shrink-0"
                  >
                    <MoreHorizontal className="w-3.5 h-3.5 text-neutral-500 shrink-0" />
                    <span className="truncate">更多</span>
                  </button>
                )}
              </div>
            )}
            {showOverflowPanel && overflowButtons.length > 0 && !isMeasuring && (
              <div
                ref={overflowPanelRef}
                data-testid="quick-actions-overflow-panel"
                className="absolute top-full right-0 mt-2 z-20 p-2 bg-white border border-slate-200 rounded-lg shadow-lg grid grid-cols-3 md:grid-cols-4 gap-2"
              >
                {overflowButtons.map((btn) => renderQuickActionButton(btn, true))}
              </div>
            )}
          </div>
        )}

        {/* 文本输入区 */}
        <div className="relative bg-white rounded-xl shadow-sm focus-within:shadow-md transition-all border border-slate-300">
          <textarea
            ref={textareaRef}
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            onKeyDown={handleKeyDown}
            data-testid="input-textarea"
            className="w-full bg-transparent border-none p-4 text-base focus:ring-0 resize-none placeholder:text-neutral-300 focus:outline-none custom-scrollbar min-h-[60px] md:min-h-[80px]"
            placeholder={`给 ${activeAgent?.name || 'Aptbot'} 发送消息...`}
            rows={4}
          />

          <div className="absolute bottom-3 right-3 flex items-center gap-3">
            {/* 文件附件 — 后端暂未支持，点击提示开发中 */}
            <button
              onClick={handleAttachClick}
              data-testid="attach-button"
              className="w-10 h-10 flex items-center justify-center rounded-full text-neutral-500 hover:bg-neutral-100 transition-colors cursor-pointer"
              title="附加代码文件/文档"
            >
              <Paperclip className="w-5 h-5" />
            </button>
            <button
              onClick={handleSend}
              disabled={!inputText.trim()}
              data-testid="send-button"
              className="w-12 h-12 flex items-center justify-center rounded-lg bg-black text-white shadow-md hover:bg-neutral-900 transition-all active:scale-95 disabled:bg-neutral-200 disabled:text-neutral-400 disabled:shadow-none disabled:active:scale-100 cursor-pointer"
              title="发送"
            >
              <Send className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* 控制栏 — agent / model / 思考深度 / token
            0.3.1: 桌面端横排（hidden md:flex），移动端收入「⚙️ 设置」collapsible（md:hidden） */}
        <div className="hidden md:flex items-center gap-2 mt-2 select-none">
          {renderSettingsDropdowns('desktop')}

          {/* 上下文 token 指示器（mock 计算） */}
          <div className="ml-auto flex items-center gap-1.5 text-[10px] text-neutral-400 font-mono font-medium">
            <Database className="w-3.5 h-3.5 text-neutral-300" />
            <span>上下文: {tokenCount} / 128k</span>
          </div>
        </div>

        {/* 移动端：⚙️ 设置 toggle + collapsible 面板 */}
        <div className="md:hidden mt-2 select-none">
          <div className="flex items-center justify-between">
            <button
              onClick={() => setShowSettings((v) => !v)}
              aria-expanded={showSettings}
              aria-label="设置"
              className="flex items-center gap-1.5 px-3 py-1.5 bg-white border border-slate-200 rounded text-xs font-bold text-neutral-600 hover:text-black hover:border-black transition-all cursor-pointer"
            >
              <Settings className="w-3.5 h-3.5 text-neutral-500" />
              <span>设置</span>
            </button>
            {/* 上下文 token 指示器（移动端始终可见） */}
            <div className="flex items-center gap-1.5 text-[10px] text-neutral-400 font-mono font-medium">
              <Database className="w-3.5 h-3.5 text-neutral-300" />
              <span>上下文: {tokenCount} / 128k</span>
            </div>
          </div>
          <div
            className={`overflow-hidden transition-all duration-200 ${showSettings ? 'max-h-96' : 'max-h-0'}`}
          >
            <div className="flex flex-col gap-2 pt-2">{renderSettingsDropdowns('mobile')}</div>
          </div>
        </div>
      </div>
    </div>
  );
}
