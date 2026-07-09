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
import { useRef, useEffect, useState, memo } from 'react';
import { Cpu, Sparkles, Brain, Terminal, Palette, MessageSquare, ChevronRight, Loader2, Check, X } from 'lucide-react';
import type { AgentProfile } from '../types.js';
import type { Message, ToolCall } from '../lib/reducer.js';
import { renderMarkdown } from '../lib/markdown.js';
import MessageActions from './MessageActions.js';

interface ChatAreaProps {
  activeAgent: AgentProfile | null;
  messages: Message[];
  isWorking: boolean;
  /** §0.3.0 UAT: 显示新会话智能体选择卡片 */
  showNewSessionPicker?: boolean;
  /** §0.3.0 UAT: 可选智能体列表 */
  agents?: AgentProfile[];
  /** §0.3.0 UAT: 选择智能体后回调 */
  onSelectAgentForNewSession?: (slug: string) => void;
  /** §0.3.0 UAT Bug E: 当前 agent run 累积的工具调用（折叠展示在最后一条 assistant 消息前） */
  toolCalls?: ToolCall[];
}

export default function ChatArea({ activeAgent, messages, isWorking, showNewSessionPicker, agents, onSelectAgentForNewSession, toolCalls }: ChatAreaProps) {
  const messagesEndRef = useRef<HTMLDivElement | null>(null);

  // 自动滚动到底部
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // 当前后端不支持 /regenerate — 显示暂未支持提示
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
    <div
      data-testid="chat-area"
      data-streaming={isWorking ? 'true' : 'false'}
      className="flex-1 overflow-y-auto custom-scrollbar p-3 sm:p-4 md:p-6 lg:p-8 bg-white min-h-[400px]"
    >
      <div className="max-w-4xl mx-auto w-full flex flex-col gap-6">
        {showNewSessionPicker && onSelectAgentForNewSession && agents ? (
          <NewSessionPicker agents={agents} onSelect={onSelectAgentForNewSession} />
        ) : messages.length === 0 && (!toolCalls || toolCalls.length === 0) ? (
          <EmptyState activeAgent={activeAgent} />
        ) : (
          <>
          {messages.map((msg, index) => {
            const isAI = msg.role === 'assistant';
            // 最后一条 assistant 消息 + isWorking → 显示流式光标
            const showStreamingCursor = isWorking && index === lastAssistantIndex;
            // §0.3.0 UAT Bug E: 最后一条 assistant 消息展示折叠的工具调用（live streaming）
            const liveToolCalls = isAI && index === lastAssistantIndex && toolCalls && toolCalls.length > 0
              ? toolCalls
              : undefined;

            if (isAI) {
              return (
                <AssistantMessageItem
                  key={msg.id}
                  msg={msg}
                  agentName={msg.agentName || activeAgent?.name || '通用智能体'}
                  showStreamingCursor={showStreamingCursor}
                  liveToolCalls={liveToolCalls}
                  onRegenerate={handleRegenerate}
                />
              );
            } else {
              return (
                <UserMessageItem key={msg.id} msg={msg} />
              );
            }
          })
          }
          {/* §0.3.0 UAT Bug E: 工具调用进行中但尚无 assistant 文本消息时，显示占位气泡 */}
          {isWorking && toolCalls && toolCalls.length > 0 && (lastAssistantIndex === -1 || messages[lastAssistantIndex]?.text === '') && (
            <div
              data-testid="message-assistant-processing"
              data-role="assistant"
              className="flex flex-col items-start message-enter w-full"
            >
              <div className="flex items-center gap-2 mb-2 ml-1">
                <span className="w-6 h-6 rounded-sm border border-neutral-200 bg-neutral-50 flex items-center justify-center shadow-xs">
                  <Cpu className="w-3.5 h-3.5 text-black" />
                </span>
                <span className="text-[10px] text-black font-bold tracking-widest uppercase">
                  {activeAgent?.name || '通用智能体'}
                </span>
              </div>
              <div className="bg-neutral-50/50 p-5 rounded-xl rounded-tl-none border border-neutral-200 text-neutral-800 shadow-sm leading-relaxed max-w-[85%]">
                <InlineToolCalls toolCalls={toolCalls} />
                <span className="inline-block w-2 h-4 bg-black ml-0.5 animate-pulse align-middle" />
              </div>
            </div>
          )}
          </>
        )}
        <div ref={messagesEndRef} />
      </div>
    </div>
  );
}

/**
 * §0.3.0 UAT Bug L fix: AssistantMessageItem — memoized 避免工具调用更新时所有消息重渲染闪烁。
 * §0.3.0 UAT Bug M fix: 支持从 msg.toolCalls 显示历史工具调用记录。
 */
interface AssistantMessageItemProps {
  msg: Message;
  agentName: string;
  showStreamingCursor: boolean;
  liveToolCalls?: ToolCall[];
  onRegenerate: (messageId: string) => void;
}

const AssistantMessageItem = memo(function AssistantMessageItem({
  msg,
  agentName,
  showStreamingCursor,
  liveToolCalls,
  onRegenerate,
}: AssistantMessageItemProps) {
  // §0.3.0 UAT Bug M: 优先显示 live 工具调用，其次显示历史工具调用
  const toolCallsToShow = liveToolCalls ?? msg.toolCalls;

  return (
    <div
      data-testid={`message-assistant-${msg.id}`}
      data-role="assistant"
      className="flex flex-col items-start message-enter w-full"
    >
      {/* Meta details */}
      <div className="flex items-center gap-2 mb-2 ml-1">
        <span className="w-6 h-6 rounded-sm border border-neutral-200 bg-neutral-50 flex items-center justify-center shadow-xs">
          <Cpu className="w-3.5 h-3.5 text-black" />
        </span>
        <span className="text-[10px] text-black font-bold tracking-widest uppercase">
          {agentName}
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
      <div
        data-testid={`message-content-${msg.id}`}
        className="bg-neutral-50/50 p-5 rounded-xl rounded-tl-none border border-neutral-200 text-neutral-800 shadow-sm leading-relaxed max-w-[85%] relative group"
      >
        {/* §0.3.0 UAT Bug E/M: 折叠的工具调用区域 — 放在真实回复文本之前 */}
        {toolCallsToShow && toolCallsToShow.length > 0 && (
          <InlineToolCalls toolCalls={toolCallsToShow} />
        )}

        {renderMarkdown(msg.text)}

        {/* 流式光标 — 仅在 isWorking 且为最后一条 assistant 消息时显示 */}
        {showStreamingCursor && (
          <span className="inline-block w-2 h-4 bg-black ml-0.5 animate-pulse align-middle" />
        )}

        {/* Hover actions — 复制 + 重新生成 */}
        <MessageActions
          text={msg.text}
          messageId={msg.id}
          onRegenerate={onRegenerate}
        />
      </div>
    </div>
  );
});

/**
 * §0.3.0 UAT Bug L fix: UserMessageItem — memoized 避免工具调用更新时所有消息重渲染闪烁。
 */
const UserMessageItem = memo(function UserMessageItem({ msg }: { msg: Message }) {
  return (
    <div
      data-testid={`message-user-${msg.id}`}
      data-role="user"
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
});

/**
 * §0.3.0 UAT Bug E: 内联折叠的工具调用区域。
 *
 * 显示在 assistant 消息内容气泡内、真实回复文本之前。
 * 默认折叠，用户点击 header 可展开查看每个工具调用的详情。
 */
function InlineToolCalls({ toolCalls }: { toolCalls: ToolCall[] }) {
  const [expanded, setExpanded] = useState(false);
  const runningCount = toolCalls.filter((tc) => tc.status === 'running').length;
  const successCount = toolCalls.filter((tc) => tc.status === 'success').length;
  const failedCount = toolCalls.filter((tc) => tc.status === 'failed').length;

  const summary = [
    runningCount > 0 ? `${runningCount} 运行中` : null,
    successCount > 0 ? `${successCount} 成功` : null,
    failedCount > 0 ? `${failedCount} 失败` : null,
  ].filter(Boolean).join(' · ');

  return (
    <div data-testid="inline-tool-calls" className="mb-3 border border-neutral-200 rounded-md bg-white/80 overflow-hidden">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-neutral-50 transition-colors"
        aria-expanded={expanded}
      >
        <ChevronRight
          className={`w-3.5 h-3.5 text-neutral-400 shrink-0 transition-transform ${expanded ? 'rotate-90' : ''}`}
        />
        <span className="text-xs md:text-sm font-bold text-neutral-600 tracking-wide">
          工具调用 ({toolCalls.length})
        </span>
        <span className="text-[10px] text-neutral-400 font-mono ml-1">
          {summary}
        </span>
      </button>
      {expanded && (
        <div className="border-t border-neutral-200/70 px-3 py-2 space-y-1.5 text-[11px] md:text-xs">
          {toolCalls.map((tc) => (
            <InlineToolCallItem key={tc.id} toolCall={tc} />
          ))}
        </div>
      )}
    </div>
  );
}

function InlineToolCallItem({ toolCall }: { toolCall: ToolCall }) {
  const [expanded, setExpanded] = useState(false);
  const { name, status, summary, arguments: args } = toolCall;
  const hasSummary = typeof summary === 'string' && summary.length > 0;
  const canToggle = hasSummary && status !== 'running';

  return (
    <div className="bg-neutral-50 border border-neutral-200/60 rounded text-[12px]">
      <button
        type="button"
        onClick={() => canToggle && setExpanded((v) => !v)}
        disabled={!canToggle}
        className="w-full flex items-center gap-2 px-2.5 py-1.5 text-left disabled:cursor-default enabled:hover:bg-neutral-100 transition-colors rounded"
        aria-expanded={expanded}
      >
        <ToolCallStatusIcon status={status} />
        <span className="font-mono text-neutral-800 font-semibold truncate">
          {name}
        </span>
        {hasSummary && !expanded && (
          <span className="text-neutral-400 truncate flex-1 text-[11px]">
            <span className="text-neutral-300 mx-1">·</span>
            {summary!.slice(0, 80)}
            {summary!.length > 80 ? '…' : ''}
          </span>
        )}
        {status === 'running' && (
          <span className="text-neutral-400 text-[10px]">运行中…</span>
        )}
        {canToggle && (
          <ChevronRight
            className={`w-3 h-3 text-neutral-400 ml-auto shrink-0 transition-transform ${expanded ? 'rotate-90' : ''}`}
          />
        )}
      </button>
      {expanded && canToggle && (
        <div className="px-2.5 pb-2 pt-1 space-y-1.5">
          {hasSummary && (
            <div>
              <p className="text-[9px] font-bold tracking-widest uppercase text-neutral-400 mb-0.5">
                Result
              </p>
              <p className="text-neutral-700 whitespace-pre-wrap break-words leading-relaxed text-[11px]">
                {summary}
              </p>
            </div>
          )}
          {args && (
            <div>
              <p className="text-[9px] font-bold tracking-widest uppercase text-neutral-400 mb-0.5">
                Arguments
              </p>
              <pre className="font-mono text-[11px] text-neutral-600 bg-white border border-neutral-200 rounded p-1.5 overflow-x-auto whitespace-pre-wrap break-words">
                {args}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ToolCallStatusIcon({ status }: { status: ToolCall['status'] }) {
  if (status === 'running') {
    return <Loader2 className="w-3 h-3 text-neutral-500 animate-spin shrink-0" />;
  }
  if (status === 'success') {
    return <Check className="w-3 h-3 text-black shrink-0" />;
  }
  return <X className="w-3 h-3 text-neutral-700 shrink-0" />;
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
    <div
      data-testid="empty-state"
      className="flex-1 flex flex-col items-center justify-center p-8 border border-neutral-200/80 rounded-xl w-full py-16 bg-neutral-50/30"
    >
      <div className="w-16 h-16 rounded-full border border-neutral-200 flex items-center justify-center bg-white mb-6 shadow-xs">
        <Cpu className="w-8 h-8 text-black animate-pulse" />
      </div>
      <h3 className="font-bold text-2xl text-black mb-2 tracking-tight">
        欢迎使用 Aptbot 精度工作区
      </h3>
      <p className="text-sm text-neutral-500 max-w-lg mb-8 leading-relaxed text-center hidden md:block">
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

/**
 * §0.3.0 UAT: 新会话智能体选择卡片。
 *
 * 点击"新会话"按钮后显示，展示通用智能体和专用智能体两组卡片。
 * 用户点击其中一个后自动切换到该智能体的聊天会话。
 */
function NewSessionPicker({
  agents,
  onSelect,
}: {
  agents: AgentProfile[];
  onSelect: (slug: string) => void;
}) {
  const generalAgents = agents.filter((a) => !a.isCustom && a.slug === 'default');
  const specializedAgents = agents.filter((a) => a.isCustom || a.slug !== 'default');

  const getAgentIcon = (iconName: string, size = 'w-5 h-5') => {
    switch (iconName) {
      case 'brain':
        return <Brain className={`${size} text-black`} />;
      case 'terminal':
        return <Terminal className={`${size} text-neutral-600`} />;
      case 'palette':
        return <Palette className={`${size} text-neutral-600`} />;
      default:
        return <Cpu className={`${size} text-neutral-600`} />;
    }
  };

  const renderAgentCard = (agent: AgentProfile) => (
    <button
      key={agent.slug}
      data-testid={`new-session-agent-${agent.slug}`}
      onClick={() => onSelect(agent.slug)}
      className="group flex flex-col items-start gap-2 p-4 bg-white border border-neutral-200 rounded-xl hover:border-black hover:shadow-md transition-all text-left cursor-pointer active:scale-[0.98]"
    >
      <div className="flex items-center gap-2 w-full">
        <div className="w-8 h-8 rounded-lg border border-neutral-200 bg-neutral-50 flex items-center justify-center shrink-0">
          {getAgentIcon(agent.iconName)}
        </div>
        <span className="text-sm font-bold text-black truncate group-hover:text-black">
          {agent.name}
        </span>
      </div>
      {agent.description && (
        <p className="text-xs text-neutral-500 leading-relaxed line-clamp-2">
          {agent.description}
        </p>
      )}
      <div className="flex items-center gap-1 text-[10px] text-neutral-400 font-bold uppercase tracking-widest mt-auto pt-1">
        <MessageSquare className="w-3 h-3" />
        <span>点击开始对话</span>
      </div>
    </button>
  );

  return (
    <div
      data-testid="new-session-picker"
      className="flex-1 flex flex-col items-center justify-center p-8 w-full py-16"
    >
      <div className="w-16 h-16 rounded-full border border-neutral-200 flex items-center justify-center bg-white mb-6 shadow-xs">
        <Sparkles className="w-8 h-8 text-black animate-pulse" />
      </div>
      <h3 className="font-bold text-2xl text-black mb-2 tracking-tight">
        开始新会话
      </h3>
      <p className="text-sm text-neutral-500 max-w-lg mb-8 leading-relaxed text-center">
        选择一个智能体开始对话。通用智能体适用于日常任务，专用智能体针对特定场景优化。
      </p>

      <div className="w-full max-w-2xl space-y-6">
        {generalAgents.length > 0 && (
          <div>
            <p className="text-[10px] font-bold text-neutral-400 uppercase tracking-widest mb-3 px-1">
              通用智能体
            </p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2 md:gap-4">
              {generalAgents.map(renderAgentCard)}
            </div>
          </div>
        )}

        {specializedAgents.length > 0 && (
          <div>
            <p className="text-[10px] font-bold text-neutral-400 uppercase tracking-widest mb-3 px-1">
              专用智能体
            </p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2 md:gap-4">
              {specializedAgents.map(renderAgentCard)}
            </div>
          </div>
        )}

        {agents.length === 0 && (
          <p className="text-xs text-neutral-400 text-center">
            暂无可用智能体
          </p>
        )}
      </div>
    </div>
  );
}
