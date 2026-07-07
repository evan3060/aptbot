import { 
  Languages, 
  Wand2, 
  BookOpen, 
  Paperclip, 
  Send, 
  X,
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
  FileCode,
  Database
} from "lucide-react";
import { Agent, ModelOption, AttachedFile } from "../types";
import { useState, useRef, KeyboardEvent, ChangeEvent } from "react";

interface InputAreaProps {
  agents: Agent[];
  activeAgentId: string;
  onSelectAgent: (agentId: string) => void;
  selectedModel: ModelOption;
  onSelectModel: (model: ModelOption) => void;
  models: ModelOption[];
  onSendMessage: (content: string, files?: AttachedFile[]) => void;
}

export default function InputArea({
  agents,
  activeAgentId,
  onSelectAgent,
  selectedModel,
  onSelectModel,
  models,
  onSendMessage
}: InputAreaProps) {
  const [inputText, setInputText] = useState("");
  const [attachedFiles, setAttachedFiles] = useState<AttachedFile[]>([]);
  const [thinkingDepth, setThinkingDepth] = useState("standard");
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const activeAgent = agents.find(a => a.id === activeAgentId) || null;

  const handleSend = () => {
    if (!inputText.trim() && attachedFiles.length === 0) return;
    onSendMessage(inputText, attachedFiles);
    setInputText("");
    setAttachedFiles([]);
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  // Trigger quick action buttons
  const triggerQuickAction = (actionType: string) => {
    let prefix = "";
    switch (actionType) {
      case "translate":
        prefix = "请作为专业翻译官，将以下内容翻译为准确、地道、优雅的表达（默认中英互译），并提供核心词汇解析：\n";
        break;
      case "polish":
        prefix = "请作为资深文案编辑，对以下文章内容进行润色和修饰，提升用词专业度、语言流畅性与整体文风：\n";
        break;
      case "layout":
        prefix = "请作为排版美化大师，使用清晰、专业且美观的 Markdown 结构（含合理标题、列表、加粗等方式）对以下文本进行重排：\n";
        break;
      case "outline":
        prefix = "请根据以下核心想法或基础素材，帮我输出一份逻辑清晰、结构严密、重点突出且可执行的方案/文章大纲：\n";
        break;
      case "mail":
        prefix = "请作为职场公文专家，帮我起草一封专业、得体、措辞严谨的电子邮件，核心要点如下：\n";
        break;
      case "meeting":
        prefix = "请帮我将以下会议记录或录音文字草稿整理成一份专业、结构化、包含核心决定和具体待办事项（Action Items）的会议纪要：\n";
        break;
      case "summary":
        prefix = "请作为职场高级经理，根据我提供的以下零散工作产出，整理成一份逻辑清晰、结果导向、凸显个人价值的工作汇报总结：\n";
        break;
      case "ppt":
        prefix = "请围绕以下主题 and 核心诉求，帮我设计一份结构完整、分章节、含有幻灯片核心要点及演讲提示的 PPT 演示大纲：\n";
        break;
      case "extract":
        prefix = "请对以下文本进行高度提炼，精简压缩其内容，并以核心金句、段落摘要或核心要点的形式提供，保留所有关键信息：\n";
        break;
      case "copywrite":
        prefix = "请作为资深品牌策划，针对以下产品或活动，撰写 3 个不同风格（创意、痛点、情怀）的吸引人的营销推广文案：\n";
        break;
      case "weekly":
        prefix = "请将我本周完成的以下零星工作记录，转化为一份结构清晰、有条理、格式规范的职场周报（包含本周进展、下周计划和遇到的难题）：\n";
        break;
      case "proofread":
        prefix = "请帮我校对以下文本，找出其中的错别字、语法错误、标点误用或不通顺的句式，列出修改对比并说明理由：\n";
        break;
      case "title":
        prefix = "请针对以下文章、视频或产品内容，起 10 个富有吸引力、符合传播学规律、适合不同平台分发的爆款标题：\n";
        break;
      case "tone":
        prefix = "请将以下内容改写，将其语气调整为[专业职场/诚恳道歉/热情风趣/委婉客气]风格，以满足特定的沟通场景需求：\n";
        break;
      case "data":
        prefix = "请作为资深数据分析师，帮我解读和分析以下指标、表格或数据结果，提取核心趋势、异常波动并给出可行的改进建议：\n";
        break;
      case "brainstorm":
        prefix = "请围绕以下主题或想要解决的问题，进行发散性的创意头脑风暴，提供 10 个独特、新颖且具备一定落地可行性的好点子：\n";
        break;
    }
    setInputText(prefix);
    const textarea = document.querySelector("textarea");
    if (textarea) textarea.focus();
  };

  // Handle local file selection
  const handleFileSelect = (e: ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    const fileList: AttachedFile[] = [];
    for (let i = 0; i < files.length; i++) {
      const f = files[i];
      // Format file size
      const sizeKB = (f.size / 1024).toFixed(1);
      fileList.push({
        name: f.name,
        size: `${sizeKB}KB`,
        content: `// [Mock contents of ${f.name}]`
      });
    }

    setAttachedFiles(prev => [...prev, ...fileList]);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const removeAttachedFile = (idx: number) => {
    setAttachedFiles(prev => prev.filter((_, i) => i !== idx));
  };

  return (
    <div className="px-6 lg:px-8 py-6 bg-white border-t border-slate-200">
      <div className="mx-auto space-y-4 w-full max-w-4xl">
        {/* Quick Actions Bar - Only shown for General Agent */}
        {activeAgentId === "general" && (
          <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-8 gap-2 w-full select-none">
            <button 
              onClick={() => triggerQuickAction("translate")}
              className="flex items-center gap-1.5 px-3 py-2 bg-white border border-slate-200 rounded-lg text-xs font-bold text-neutral-600 hover:text-black hover:border-black transition-all justify-center cursor-pointer select-none active:scale-95 w-full"
            >
              <Languages className="w-3.5 h-3.5 text-neutral-500 shrink-0" />
              <span className="truncate">通用翻译</span>
            </button>
            <button 
              onClick={() => triggerQuickAction("polish")}
              className="flex items-center gap-1.5 px-3 py-2 bg-white border border-slate-200 rounded-lg text-xs font-bold text-neutral-600 hover:text-black hover:border-black transition-all justify-center cursor-pointer select-none active:scale-95 w-full"
            >
              <Wand2 className="w-3.5 h-3.5 text-neutral-500 shrink-0" />
              <span className="truncate">文章润色</span>
            </button>
            <button 
              onClick={() => triggerQuickAction("layout")}
              className="flex items-center gap-1.5 px-3 py-2 bg-white border border-slate-200 rounded-lg text-xs font-bold text-neutral-600 hover:text-black hover:border-black transition-all justify-center cursor-pointer select-none active:scale-95 w-full"
            >
              <Sparkles className="w-3.5 h-3.5 text-neutral-500 shrink-0" />
              <span className="truncate">排版美化</span>
            </button>
            <button 
              onClick={() => triggerQuickAction("outline")}
              className="flex items-center gap-1.5 px-3 py-2 bg-white border border-slate-200 rounded-lg text-xs font-bold text-neutral-600 hover:text-black hover:border-black transition-all justify-center cursor-pointer select-none active:scale-95 w-full"
            >
              <BookOpen className="w-3.5 h-3.5 text-neutral-500 shrink-0" />
              <span className="truncate">大纲生成</span>
            </button>

            <button 
              onClick={() => triggerQuickAction("mail")}
              className="flex items-center gap-1.5 px-3 py-2 bg-white border border-slate-200 rounded-lg text-xs font-bold text-neutral-600 hover:text-black hover:border-black transition-all justify-center cursor-pointer select-none active:scale-95 w-full"
            >
              <Mail className="w-3.5 h-3.5 text-neutral-500 shrink-0" />
              <span className="truncate">邮件撰写</span>
            </button>
            <button 
              onClick={() => triggerQuickAction("meeting")}
              className="flex items-center gap-1.5 px-3 py-2 bg-white border border-slate-200 rounded-lg text-xs font-bold text-neutral-600 hover:text-black hover:border-black transition-all justify-center cursor-pointer select-none active:scale-95 w-full"
            >
              <ClipboardList className="w-3.5 h-3.5 text-neutral-500 shrink-0" />
              <span className="truncate">会议纪要</span>
            </button>
            <button 
              onClick={() => triggerQuickAction("summary")}
              className="flex items-center gap-1.5 px-3 py-2 bg-white border border-slate-200 rounded-lg text-xs font-bold text-neutral-600 hover:text-black hover:border-black transition-all justify-center cursor-pointer select-none active:scale-95 w-full"
            >
              <Briefcase className="w-3.5 h-3.5 text-neutral-500 shrink-0" />
              <span className="truncate">工作总结</span>
            </button>
            <button 
              onClick={() => triggerQuickAction("ppt")}
              className="flex items-center gap-1.5 px-3 py-2 bg-white border border-slate-200 rounded-lg text-xs font-bold text-neutral-600 hover:text-black hover:border-black transition-all justify-center cursor-pointer select-none active:scale-95 w-full"
            >
              <Presentation className="w-3.5 h-3.5 text-neutral-500 shrink-0" />
              <span className="truncate">PPT 大纲</span>
            </button>

            <button 
              onClick={() => triggerQuickAction("extract")}
              className="flex items-center gap-1.5 px-3 py-2 bg-white border border-slate-200 rounded-lg text-xs font-bold text-neutral-600 hover:text-black hover:border-black transition-all justify-center cursor-pointer select-none active:scale-95 w-full"
            >
              <Minimize2 className="w-3.5 h-3.5 text-neutral-500 shrink-0" />
              <span className="truncate">内容提炼</span>
            </button>
            <button 
              onClick={() => triggerQuickAction("copywrite")}
              className="flex items-center gap-1.5 px-3 py-2 bg-white border border-slate-200 rounded-lg text-xs font-bold text-neutral-600 hover:text-black hover:border-black transition-all justify-center cursor-pointer select-none active:scale-95 w-full"
            >
              <PenTool className="w-3.5 h-3.5 text-neutral-500 shrink-0" />
              <span className="truncate">文案策划</span>
            </button>
            <button 
              onClick={() => triggerQuickAction("weekly")}
              className="flex items-center gap-1.5 px-3 py-2 bg-white border border-slate-200 rounded-lg text-xs font-bold text-neutral-600 hover:text-black hover:border-black transition-all justify-center cursor-pointer select-none active:scale-95 w-full"
            >
              <CalendarCheck className="w-3.5 h-3.5 text-neutral-500 shrink-0" />
              <span className="truncate">周报整理</span>
            </button>
            <button 
              onClick={() => triggerQuickAction("proofread")}
              className="flex items-center gap-1.5 px-3 py-2 bg-white border border-slate-200 rounded-lg text-xs font-bold text-neutral-600 hover:text-black hover:border-black transition-all justify-center cursor-pointer select-none active:scale-95 w-full"
            >
              <CheckSquare className="w-3.5 h-3.5 text-neutral-500 shrink-0" />
              <span className="truncate">纠错校对</span>
            </button>

            <button 
              onClick={() => triggerQuickAction("title")}
              className="flex items-center gap-1.5 px-3 py-2 bg-white border border-slate-200 rounded-lg text-xs font-bold text-neutral-600 hover:text-black hover:border-black transition-all justify-center cursor-pointer select-none active:scale-95 w-full"
            >
              <Type className="w-3.5 h-3.5 text-neutral-500 shrink-0" />
              <span className="truncate">标题起名</span>
            </button>
            <button 
              onClick={() => triggerQuickAction("tone")}
              className="flex items-center gap-1.5 px-3 py-2 bg-white border border-slate-200 rounded-lg text-xs font-bold text-neutral-600 hover:text-black hover:border-black transition-all justify-center cursor-pointer select-none active:scale-95 w-full"
            >
              <MessageSquare className="w-3.5 h-3.5 text-neutral-500 shrink-0" />
              <span className="truncate">语气转换</span>
            </button>
            <button 
              onClick={() => triggerQuickAction("data")}
              className="flex items-center gap-1.5 px-3 py-2 bg-white border border-slate-200 rounded-lg text-xs font-bold text-neutral-600 hover:text-black hover:border-black transition-all justify-center cursor-pointer select-none active:scale-95 w-full"
            >
              <BarChart3 className="w-3.5 h-3.5 text-neutral-500 shrink-0" />
              <span className="truncate">数据解读</span>
            </button>
            <button 
              onClick={() => triggerQuickAction("brainstorm")}
              className="flex items-center gap-1.5 px-3 py-2 bg-white border border-slate-200 rounded-lg text-xs font-bold text-neutral-600 hover:text-black hover:border-black transition-all justify-center cursor-pointer select-none active:scale-95 w-full"
            >
              <Lightbulb className="w-3.5 h-3.5 text-neutral-500 shrink-0" />
              <span className="truncate">创意脑暴</span>
            </button>
          </div>
        )}

        {/* Selected files rendering */}
        {attachedFiles.length > 0 && (
          <div className="flex flex-wrap gap-2 p-2 bg-neutral-50 rounded-lg border border-neutral-200">
            {attachedFiles.map((file, idx) => (
              <div 
                key={idx}
                className="flex items-center gap-2 bg-white px-2.5 py-1.5 rounded border border-neutral-200 text-xs font-mono"
              >
                <FileCode className="w-4 h-4 text-black shrink-0" />
                <span className="font-semibold text-neutral-700 truncate max-w-[150px]">{file.name}</span>
                <span className="text-neutral-400 font-normal">({file.size})</span>
                <button 
                  onClick={() => removeAttachedFile(idx)}
                  className="text-neutral-400 hover:text-red-500 ml-1 transition-colors"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Text Input Block */}
        <div className="relative bg-white rounded-xl shadow-sm focus-within:shadow-md transition-all border border-slate-300">
          <textarea 
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            onKeyDown={handleKeyDown}
            className="w-full bg-transparent border-none p-4 text-[15px] focus:ring-0 resize-none placeholder:text-neutral-300 focus:outline-none custom-scrollbar" 
            placeholder={`给 ${activeAgent?.name || "Aptbot"} 发送消息...`} 
            rows={4}
          />

          <div className="absolute bottom-3 right-3 flex items-center gap-3">
            {/* Hidden native input for attaching files */}
            <input 
              type="file" 
              ref={fileInputRef} 
              onChange={handleFileSelect} 
              multiple 
              className="hidden" 
            />
            <button 
              onClick={() => fileInputRef.current?.click()}
              className="w-10 h-10 flex items-center justify-center rounded-full text-neutral-500 hover:bg-neutral-100 transition-colors cursor-pointer"
              title="附加代码文件/文档"
            >
              <Paperclip className="w-5 h-5" />
            </button>
            <button 
              onClick={handleSend}
              disabled={!inputText.trim() && attachedFiles.length === 0}
              className="w-12 h-12 flex items-center justify-center rounded-lg bg-black text-white shadow-md hover:bg-neutral-900 transition-all active:scale-95 disabled:bg-neutral-200 disabled:text-neutral-400 disabled:shadow-none disabled:active:scale-100 cursor-pointer"
              title="发送"
            >
              <Send className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Controls Bar Below */}
        <div className="flex items-center gap-2 mt-2 select-none">
          {/* Agent Selection Dropdown */}
          <div className="flex items-center gap-1 bg-white px-2.5 py-1 border border-slate-200 rounded text-[10px] shadow-2xs">
            <span className="font-bold text-neutral-400 uppercase tracking-wider">智能体</span>
            <select 
              value={activeAgentId}
              onChange={(e) => onSelectAgent(e.target.value)}
              className="bg-transparent border-none p-0 pr-6 text-[10px] font-bold text-black focus:ring-0 cursor-pointer focus:outline-none"
            >
              {agents.map(a => (
                <option key={a.id} value={a.id}>{a.name}</option>
              ))}
            </select>
          </div>

          {/* Model Selection Dropdown */}
          <div className="flex items-center gap-1 bg-white px-2.5 py-1 border border-slate-200 rounded text-[10px] shadow-2xs">
            <span className="font-bold text-neutral-400 uppercase tracking-wider">模型</span>
            <select 
              value={selectedModel.id}
              onChange={(e) => {
                const model = models.find(m => m.id === e.target.value);
                if (model) onSelectModel(model);
              }}
              className="bg-transparent border-none p-0 pr-6 text-[10px] font-bold text-black focus:ring-0 cursor-pointer focus:outline-none"
            >
              {models.map(m => (
                <option key={m.id} value={m.id}>{m.name}</option>
              ))}
            </select>
          </div>

          {/* Thinking Depth Dropdown */}
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

          {/* Context Token Indicator on Right */}
          <div className="ml-auto flex items-center gap-1.5 text-[10px] text-neutral-400 font-mono font-medium">
            <Database className="w-3.5 h-3.5 text-neutral-300" />
            <span>上下文: {inputText.length > 0 ? Math.ceil(inputText.length * 0.4 + 1200) : 1200} / 128k</span>
          </div>
        </div>

      </div>
    </div>
  );
}
