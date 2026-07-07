import { 
  Copy, 
  ThumbsUp, 
  RotateCw, 
  FileCode, 
  Cpu, 
  User, 
  Check, 
  Sparkles,
  ExternalLink,
  MessageSquareOff
} from "lucide-react";
import { Message, Agent } from "../types";
import { useState, useRef, useEffect } from "react";

interface ChatAreaProps {
  activeAgent: Agent | null;
  messages: Message[];
  onRegenerate: (messageId: string) => void;
}

export default function ChatArea({ activeAgent, messages, onRegenerate }: ChatAreaProps) {
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [likedIds, setLikedIds] = useState<Record<string, boolean>>({});
  const messagesEndRef = useRef<HTMLDivElement | null>(null);

  // Auto-scroll to bottom of chat
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleCopy = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const handleLike = (id: string) => {
    setLikedIds(prev => ({
      ...prev,
      [id]: !prev[id]
    }));
  };

  // Simple, robust custom Markdown parser that handles:
  // - Code blocks (```lang ... ```)
  // - Bold text (**text**)
  // - Inline code (`code`)
  // - Line breaks
  const renderFormattedContent = (content: string) => {
    if (!content) return null;

    // Split by code blocks
    const parts = content.split(/(```[\s\S]*?```)/g);

    return parts.map((part, index) => {
      if (part.startsWith("```")) {
        // Extract code content and language
        const match = part.match(/```(\w*)\n([\s\S]*?)```/);
        const language = match ? match[1] : "";
        const code = match ? match[2] : part.slice(3, -3).trim();

        return (
          <div key={index} className="bg-neutral-50 text-neutral-800 p-4 rounded-lg border border-neutral-200 font-mono text-[13px] overflow-x-auto my-3 shadow-xs relative group">
            {language && (
              <div className="absolute top-2 right-3 text-[10px] text-neutral-400 uppercase tracking-wider font-bold">
                {language}
              </div>
            )}
            <pre><code className="block select-text whitespace-pre leading-relaxed">{code}</code></pre>
          </div>
        );
      } else {
        // Handle line breaks and inline formatting
        const lines = part.split("\n");
        return lines.map((line, lineIdx) => {
          // Parse bold (**text**) and inline code (`code`)
          const boldAndCodeRegex = /(\*\*.*?\*\*|`.*?`)/g;
          const lineParts = line.split(boldAndCodeRegex);

          const formattedLine = lineParts.map((subPart, subIdx) => {
            if (subPart.startsWith("**") && subPart.endsWith("**")) {
              return <strong key={subIdx} className="font-bold text-black">{subPart.slice(2, -2)}</strong>;
            } else if (subPart.startsWith("`") && subPart.endsWith("`")) {
              return (
                <code key={subIdx} className="bg-neutral-100 border border-neutral-200 text-neutral-800 px-1.5 py-0.5 rounded font-mono text-xs mx-0.5">
                  {subPart.slice(1, -1)}
                </code>
              );
            }
            return subPart;
          });

          return (
            <p key={`${lineIdx}`} className="leading-relaxed text-[15px] text-neutral-800 mb-2 last:mb-0">
              {formattedLine}
            </p>
          );
        });
      }
    });
  };

  return (
    <div className="flex-1 overflow-y-auto custom-scrollbar p-6 lg:p-8 bg-white min-h-[400px]">
      <div className="max-w-4xl mx-auto w-full flex flex-col gap-6">
        {messages.length === 0 ? (
          <div className="flex-1 flex flex-col items-center justify-center p-8 border border-neutral-200/80 rounded-xl w-full py-16 bg-neutral-50/30">
            <div className="w-16 h-16 rounded-full border border-neutral-200 flex items-center justify-center bg-white mb-6 shadow-xs">
              <Cpu className="w-8 h-8 text-black animate-pulse" />
            </div>
            <h3 className="font-bold text-2xl text-black mb-2 tracking-tight">
              欢迎使用 Aptbot 精度工作区
            </h3>
            <p className="text-sm text-neutral-500 max-w-lg mb-8 leading-relaxed text-center">
              开启高效、专业且具有深度的智能协作。我们将工作场景划分为通用与专用两个维度，帮助您在不同任务中精确掌控 AI 输出：
            </p>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 max-w-3xl w-full mb-8 text-left">
              {/* General Agent Card */}
              <div className="p-5 bg-white border border-neutral-200 rounded-xl shadow-2xs hover:shadow-xs transition-all flex flex-col justify-between">
                <div>
                  <div className="flex items-center gap-2 mb-3">
                    <span className="p-1.5 bg-neutral-100 rounded text-black font-bold">
                      <Sparkles className="w-4 h-4" />
                    </span>
                    <h4 className="font-bold text-[15px] text-black">通用智能体</h4>
                  </div>
                  <p className="text-xs text-neutral-600 leading-relaxed">
                    聚合多场景基础通用能力，支持底部的<strong>多行推荐快捷指令</strong>（如翻译专家、代码重构、查找漏洞等），一键触发高效流式作业，满足您的日常高频需求。
                  </p>
                </div>
                <div className="mt-4 pt-3 border-t border-neutral-100 flex items-center justify-between">
                  <span className="text-[10px] uppercase font-bold text-neutral-400 tracking-wider">适合高频、快速问答</span>
                  <span className="text-[10px] font-bold text-black bg-neutral-100 px-1.5 py-0.5 rounded">快速触达</span>
                </div>
              </div>

              {/* Specialized Agent Card */}
              <div className="p-5 bg-white border border-neutral-200 rounded-xl shadow-2xs hover:shadow-xs transition-all flex flex-col justify-between">
                <div>
                  <div className="flex items-center gap-2 mb-3">
                    <span className="p-1.5 bg-neutral-100 rounded text-black font-bold">
                      <Cpu className="w-4 h-4" />
                    </span>
                    <h4 className="font-bold text-[15px] text-black">专用智能体</h4>
                  </div>
                  <p className="text-xs text-neutral-600 leading-relaxed">
                    精确定制系统级指令（System Prompt），为您提供<strong>长期的专属陪伴</strong>与垂直领域深度共建（如 Python 专家、UI 设计师）。支持添加、修改或删除，打造专属私人智囊团。
                  </p>
                </div>
                <div className="mt-4 pt-3 border-t border-neutral-100 flex items-center justify-between">
                  <span className="text-[10px] uppercase font-bold text-neutral-400 tracking-wider">适合深度、专业垂类场景</span>
                  <span className="text-[10px] font-bold text-black bg-neutral-100 px-1.5 py-0.5 rounded">长期陪伴</span>
                </div>
              </div>
            </div>

            {activeAgent?.predefinedPrompts && activeAgent.predefinedPrompts.length > 0 && (
              <div className="w-full max-w-2xl border-t border-neutral-200/60 pt-6">
                <p className="text-[10px] font-bold text-neutral-400 uppercase tracking-widest mb-3 text-center">
                  当前智能体推荐快捷指令
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-w-lg mx-auto">
                  {activeAgent.predefinedPrompts.map((p, idx) => (
                    <div 
                      key={idx}
                      className="p-3 bg-white hover:bg-neutral-50 border border-neutral-200 rounded-lg text-left cursor-pointer transition-colors text-xs text-neutral-700 font-medium shadow-2xs flex items-center gap-2"
                      onClick={() => {
                        // Trigger prompt set via parent (handled in main App state)
                        const textarea = document.querySelector("textarea");
                        if (textarea) {
                          textarea.value = p.text;
                          textarea.dispatchEvent(new Event("input", { bubbles: true }));
                          textarea.focus();
                        }
                      }}
                    >
                      <span className="text-sm shrink-0">💡</span>
                      <span className="truncate">{p.label}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        ) : (
          messages.map((msg) => {
            const isAI = msg.role === "assistant";

            if (isAI) {
              return (
                <div key={msg.id} className="flex flex-col items-start message-enter w-full">
                  {/* Meta details */}
                  <div className="flex items-center gap-2 mb-2 ml-1">
                    <span className="w-6 h-6 rounded-sm border border-neutral-200 bg-neutral-50 flex items-center justify-center shadow-xs">
                      <Cpu className="w-3.5 h-3.5 text-black agent-pulse" />
                    </span>
                    <span className="text-[10px] text-black font-bold tracking-widest uppercase">
                      {msg.agentName || activeAgent?.name || "通用智能体"}
                    </span>
                    {msg.modelUsed && (
                      <span className="bg-white border border-neutral-400 px-1.5 py-0.5 rounded text-[9px] font-bold text-neutral-800 tracking-tight">
                        {msg.modelUsed.toUpperCase()}
                      </span>
                    )}
                    <span className="text-[10px] text-neutral-400 font-mono ml-2">
                      {msg.timestamp}
                    </span>
                  </div>

                  {/* Content bubble */}
                  <div className="bg-neutral-50/50 p-5 rounded-xl rounded-tl-none border border-neutral-200 text-neutral-800 shadow-sm leading-relaxed max-w-[85%] relative group">
                    {renderFormattedContent(msg.content)}

                    {/* Actions (visible on hover) */}
                    <div className="mt-4 flex items-center justify-end gap-3 opacity-40 group-hover:opacity-100 transition-opacity">
                      <button 
                        onClick={() => handleCopy(msg.content, msg.id)}
                        className="hover:text-black transition-colors"
                        title="复制内容"
                      >
                        {copiedId === msg.id ? (
                          <Check className="w-[16px] h-[16px] text-green-600" />
                        ) : (
                          <Copy className="w-[16px] h-[16px]" />
                        )}
                      </button>
                      <button 
                        onClick={() => handleLike(msg.id)}
                        className={`transition-colors ${likedIds[msg.id] ? "text-black fill-black" : "hover:text-black"}`}
                        title="有用"
                      >
                        <ThumbsUp className="w-[16px] h-[16px]" />
                      </button>
                      <button 
                        onClick={() => onRegenerate(msg.id)}
                        className="hover:text-black transition-colors animate-spin-hover"
                        title="重新生成"
                      >
                        <RotateCw className="w-[16px] h-[16px]" />
                      </button>
                    </div>
                  </div>
                </div>
              );
            } else {
              return (
                <div key={msg.id} className="flex flex-col message-enter max-w-[85%] w-fit items-end ml-auto pr-0">
                  <div className="flex items-center gap-2 mb-2 mr-1">
                    <span className="text-[10px] text-neutral-400 font-mono">
                      {msg.timestamp}
                    </span>
                    <span className="text-[10px] text-black font-bold tracking-widest uppercase">
                      管理员
                    </span>
                  </div>

                  <div className="bg-white p-4 rounded-xl border border-neutral-300 text-neutral-800 shadow-xs leading-relaxed">
                    <p className="text-[15px] whitespace-pre-wrap">{msg.content}</p>

                    {msg.files && msg.files.length > 0 && (
                      <div className="mt-3 space-y-1.5">
                        {msg.files.map((file, fIdx) => (
                          <div 
                            key={fIdx}
                            className="bg-neutral-50 p-2.5 rounded border border-neutral-200 flex items-center gap-2.5 max-w-sm"
                          >
                            <FileCode className="w-5 h-5 text-black shrink-0" />
                            <div className="min-w-0">
                              <p className="font-mono text-xs text-black font-semibold truncate">
                                {file.name}
                              </p>
                              <p className="text-[10px] text-neutral-400 font-mono font-medium">
                                ({file.size})
                              </p>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              );
            }
          })
        )}
        <div ref={messagesEndRef} />
      </div>
    </div>
  );
}
