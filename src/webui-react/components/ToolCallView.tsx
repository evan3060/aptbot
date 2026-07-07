/**
 * Task 8 (React WebUI redesign): 工具调用展示组件。
 *
 * 在 ChatArea 中 assistant 消息下方展示单条工具调用的执行过程：
 * - running（tool_call_start 后 / tool_result 前）→ 显示工具名 + 加载图标
 * - success（tool_result.success=true）→ 显示成功标识 + summary（折叠态，点击展开）
 * - failed（tool_result.success=false）→ 显示失败标识 + summary（折叠态，点击展开）
 *
 * 样式约束：极简黑白灰，bg-neutral-50 border-neutral-200，工具名用等宽字体。
 *
 * 由 App.tsx（Task 9）根据 reducer.state.toolCalls 渲染 0..N 个 <ToolCallView>。
 * 本组件不处理事件流，仅消费一个 ToolCall 快照。
 */
import { useState } from 'react';
import { Loader2, Check, X, ChevronRight } from 'lucide-react';
import type { ToolCall } from '../lib/reducer.js';

interface ToolCallViewProps {
  toolCall: ToolCall;
}

export default function ToolCallView({ toolCall }: ToolCallViewProps) {
  const [expanded, setExpanded] = useState(false);
  const { name, status, summary, arguments: args } = toolCall;

  const hasSummary = typeof summary === 'string' && summary.length > 0;
  const canToggle = hasSummary && status !== 'running';

  const toggle = () => {
    if (canToggle) setExpanded((v) => !v);
  };

  return (
    <div className="bg-neutral-50 border border-neutral-200 rounded-md my-2 text-[13px]">
      {/* Header row: status icon + tool name (mono) + summary preview / chevron */}
      <button
        type="button"
        onClick={toggle}
        disabled={!canToggle}
        className="w-full flex items-center gap-2 px-3 py-2 text-left disabled:cursor-default enabled:hover:bg-neutral-100 transition-colors rounded-md"
        aria-expanded={expanded}
      >
        <StatusIcon status={status} />

        <span className="font-mono text-black font-semibold tracking-tight truncate">
          {name}
        </span>

        {/* Inline summary preview when collapsed */}
        {hasSummary && !expanded && (
          <span className="text-neutral-500 truncate flex-1">
            <span className="text-neutral-300 mx-1">·</span>
            {summary}
          </span>
        )}

        {/* Running indicator text */}
        {status === 'running' && (
          <span className="text-neutral-400 ml-1 truncate">运行中…</span>
        )}

        {canToggle && (
          <ChevronRight
            className={`w-3.5 h-3.5 text-neutral-400 ml-auto shrink-0 transition-transform ${expanded ? 'rotate-90' : ''}`}
          />
        )}
      </button>

      {/* Expanded detail: full summary + (optional) arguments */}
      {expanded && canToggle && (
        <div className="px-3 pb-3 pt-1 border-t border-neutral-200/70 space-y-2">
          {hasSummary && (
            <div>
              <p className="text-[10px] font-bold tracking-widest uppercase text-neutral-400 mb-1">
                Result
              </p>
              <p className="text-neutral-800 whitespace-pre-wrap break-words leading-relaxed">
                {summary}
              </p>
            </div>
          )}
          {args && (
            <div>
              <p className="text-[10px] font-bold tracking-widest uppercase text-neutral-400 mb-1">
                Arguments
              </p>
              <pre className="font-mono text-[12px] text-neutral-700 bg-white border border-neutral-200 rounded p-2 overflow-x-auto whitespace-pre-wrap break-words">
                {args}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** 状态图标 — 全黑白灰，无绿/红 */
function StatusIcon({ status }: { status: ToolCall['status'] }) {
  if (status === 'running') {
    return <Loader2 className="w-3.5 h-3.5 text-neutral-500 animate-spin shrink-0" />;
  }
  if (status === 'success') {
    return <Check className="w-3.5 h-3.5 text-black shrink-0" />;
  }
  return <X className="w-3.5 h-3.5 text-neutral-700 shrink-0" />;
}
