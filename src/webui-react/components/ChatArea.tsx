/**
 * Task 5 (React WebUI redesign): 消息区域组件。
 *
 * 迁移自 aistudio-design/src/components/ChatArea.tsx，做以下适配：
 * 1. 消息对齐：user 靠右（ml-auto items-end），assistant 靠左（items-start）— 0.2.3 样式
 * 2. isWorking 为 true 时，最后一条 assistant 消息显示流式光标（animate-pulse）
 * 3. 空状态显示欢迎卡片 + agent 推荐指令（activeAgent.predefinedPrompts）
 * 4. renderFormattedContent 调用 markdown.ts 的 renderMarkdown
 * 5. 自动滚动到底部（useEffect + scrollIntoView）
 * 6. 消息字段使用 reducer 的 Message.text（而非 aistudio-design 的 content）
 * 7. 重新生成按钮暂未支持 — 点击弹出提示
 *
 * 消息渲染通过 renderMarkdown 返回 React 元素（非 HTML 字符串，防 XSS）。
 */
import { useRef, useEffect } from 'react';
import { Cpu, Sparkles } from 'lucide-react';
import type { AgentProfile } from '../types.js';
import type { Message } from '../lib/reducer.js';
import { renderMarkdown } from '../lib/markdown.js';
import MessageActions from './MessageActions.js';

interface ChatAreaProps {
  activeAgent: AgentProfile | null;
  messages: Message[];
  isWorking: boolean;
  onRegenerate: (messageId: string) => void;
}

export default function ChatArea({ activeAgent, messages, isWorking }: ChatAreaProps) {
  const messagesEndRef = useRef<HTMLDivElement | null>(null);

  // 自动滚动到底部
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // 当前后端不支持 /regenerate — 显示暂未支持提示
  // 后端支持后，可通过 onRegenerate prop 接入 /resume 逻辑（Task 9 App.tsx 接入）
  const handleRegenerate = (_messageId: string) => {
    alert('暂未支持：重新生成功能尚未实现');
  };

  // 找到最后一条 assistant 消息的索引（用于流式光标）
  let lastAssistantIndex = -1;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === 'assistant') {
      lastAssistantIndex = i;
      break;
    }
  }

  return (
    <div className="flex-1 overflow-y-auto custom-scrollbar p-6 lg:p-8 bg-white min-h-[400px]">
      <div className="max-w-4xl mx-auto w-full flex flex-col gap-6">
        {messages.length === 0 ? (
          <EmptyState activeAgent={activeAgent} />
        ) : (
          messages.map((msg, index) => {
            const isAI = msg.role === 'assistant';
            // 最后一条 assistant 消息 + isWorking → 显示流式光标
            const showStreamingCursor = isWorking && index === lastAssistantIndex;

            if (isAI) {
              return (
                <div
                  key={msg.id}
                  className="flex flex-col items-start message-enter w-full"
                >
                  {/* Meta details */}
                  <div className="flex items-center gap-2 mb-2 ml-1">
                    <span className="w-6 h-6 rounded-sm border border-neutral-200 bg-neutral-50 flex items-center justify-center shadow-xs">
                      <Cpu className="w-3.5 h-3.5 text-black" />
                    </span>
                    <span className="text-[10px] text-black font-bold tracking-widest uppercase">
                      {msg.agentName || activeAgent?.name || '通用智能体'}
                    </span>
                    {msg.modelUsed && (
                      <span className="bg-white border border-neutral-400 px-1.5 py-0.5 rounded text-[9px] font-bold text-neutral-800 tracking-tight">
                        {msg.modelUsed.toUpperCase()}
                      </span>
                    )}
                    {msg.timestamp && (
                      <span className="text-[10px] text-neutral-400 font-mono ml-2">
                        {msg.timestamp}
                      </span>
                    )}
                  </div>

                  {/* Content bubble */}
                  <div className="bg-neutral-50/50 p-5 rounded-xl rounded-tl-none border border-neutral-200 text-neutral-800 shadow-sm leading-relaxed max-w-[85%] relative group">
                    {renderMarkdown(msg.text)}

                    {/* 流式光标 — 仅在 isWorking 且为最后一条 assistant 消息时显示 */}
                    {showStreamingCursor && (
                      <span className="inline-block w-2 h-4 bg-black ml-0.5 animate-pulse align-middle" />
                    )}

                    {/* Hover actions — 复制 + 重新生成 */}
                    <MessageActions
                      text={msg.text}
                      messageId={msg.id}
                      onRegenerate={handleRegenerate}
                    />
                  </div>
                </div>
              );
            } else {
              // User message — 右对齐（0.2.3 样式：ml-auto items-end）
              return (
                <div
                  key={msg.id}
                  className="flex flex-col message-enter max-w-[85%] w-fit items-end ml-auto pr-0"
                >
                  <div className="flex items-center gap-2 mb-2 mr-1">
                    {msg.timestamp && (
                      <span className="text-[10px] text-neutral-400 font-mono">
                        {msg.timestamp}
                      </span>
                    )}
                    <span className="text-[10px] text-black font-bold tracking-widest uppercase">
                      管理员
                    </span>
                  </div>

                  <div className="bg-white p-4 rounded-xl border border-neutral-300 text-neutral-800 shadow-xs leading-relaxed">
                    <p className="text-[15px] whitespace-pre-wrap">{msg.text}</p>

                    {msg.files && msg.files.length > 0 && (
                      <div className="mt-3 space-y-1.5">
                        {msg.files.map((file, fIdx) => (
                          <div
                            key={fIdx}
                            className="bg-neutral-50 p-2.5 rounded border border-neutral-200 flex items-center gap-2.5 max-w-sm"
                          >
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

/**
 * 空状态 — 欢迎卡片 + agent 推荐指令。
 *
 * 当 messages 为空时显示。如果有 activeAgent.predefinedPrompts，
 * 显示推荐指令卡片（点击后填入输入框 — Task 8 InputArea 接入）。
 * 否则显示通用欢迎信息。
 */
function EmptyState({ activeAgent }: { activeAgent: AgentProfile | null }) {
  const handlePromptClick = (text: string) => {
    // Task 8 InputArea 接入后，这里通过回调填入输入框
    const textarea = document.querySelector('textarea');
    if (textarea) {
      textarea.value = text;
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
      textarea.focus();
    }
  };

  return (
    <div className="flex-1 flex flex-col items-center justify-center p-8 border border-neutral-200/80 rounded-xl w-full py-16 bg-neutral-50/30">
      <div className="w-16 h-16 rounded-full border border-neutral-200 flex items-center justify-center bg-white mb-6 shadow-xs">
        <Cpu className="w-8 h-8 text-black animate-pulse" />
      </div>
      <h3 className="font-bold text-2xl text-black mb-2 tracking-tight">
        欢迎使用 Aptbot 精度工作区
      </h3>
      <p className="text-sm text-neutral-500 max-w-lg mb-8 leading-relaxed text-center">
        开启高效、专业且具有深度的智能协作。我们将工作场景划分为通用与专用两个维度，帮助您在不同任务中精确掌控 AI 输出。
      </p>

      {/* Agent 推荐快捷指令 */}
      {activeAgent?.predefinedPrompts && activeAgent.predefinedPrompts.length > 0 ? (
        <div className="w-full max-w-2xl border-t border-neutral-200/60 pt-6">
          <p className="text-[10px] font-bold text-neutral-400 uppercase tracking-widest mb-3 text-center">
            当前智能体推荐快捷指令
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-w-lg mx-auto">
            {activeAgent.predefinedPrompts.map((p, idx) => (
              <button
                key={idx}
                className="p-3 bg-white hover:bg-neutral-50 border border-neutral-200 rounded-lg text-left cursor-pointer transition-colors text-xs text-neutral-700 font-medium shadow-2xs flex items-center gap-2"
                onClick={() => handlePromptClick(p.text)}
              >
                <span className="text-sm shrink-0">
                  <Sparkles className="w-3.5 h-3.5 text-neutral-400" />
                </span>
                <span className="truncate">{p.label}</span>
              </button>
            ))}
          </div>
        </div>
      ) : (
        <p className="text-xs text-neutral-400 max-w-md text-center">
          在下方输入框开始对话，或使用 <code className="bg-neutral-100 px-1 py-0.5 rounded font-mono">/help</code> 查看可用命令。
        </p>
      )}
    </div>
  );
}
