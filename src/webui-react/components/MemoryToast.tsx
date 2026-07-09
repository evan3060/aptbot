/**
 * Task 8 (React WebUI redesign): 记忆写入 Toast 组件。
 *
 * 当 agent 调用 write_agent_memory 工具成功完成后，显示一条轻量 toast 提示。
 *
 * 工作模式（brief Step 2 + Ambiguity Resolution）：
 * - 消费 reducer state 的 toolCalls Map（由 tool_call_start / tool_call_delta /
 *   tool_result 事件聚合而成）
 * - useEffect 扫描 Map，发现 name === 'write_agent_memory' 且 status === 'success'
 *   且未展示过的条目时，解析 arguments JSON 取 section + content，构造 toast 文案
 * - toast 显示 3 秒后自动消失；多次写入会替换当前 toast 并重置计时器
 * - 用 useRef 跟踪 seen id 集合 + setTimeout 句柄，卸载时清理（防泄漏）
 *
 * 保留 0.3.0 的 section title 映射（user_profile → User Profile 等），
 * 与 src/core/tool/tools/read-agent-memory.ts 的 SECTION_HEADER_MAP 保持一致。
 */
import { useEffect, useRef, useState } from 'react';
import { BookOpen, X } from 'lucide-react';
import type { ToolCall } from '../lib/reducer.js';

interface MemoryToastProps {
  /** 来自 reducer state.toolCalls 的不可变 Map 快照 */
  toolCalls: Map<string, ToolCall>;
}

/** §0.3.0 Task 16: write_agent_memory section 标题（snake_case → Title Case）映射。
 *  与 src/core/tool/tools/read-agent-memory.ts SECTION_HEADER_MAP 一致。 */
const SECTION_DISPLAY_MAP: Record<string, string> = {
  user_profile: 'User Profile',
  facts: 'Facts',
  preferences: 'Preferences',
  history: 'History',
};

/** toast 中 contentPreview 的最大字符数 */
const TOAST_PREVIEW_MAX = 60;

/** toast 自动消失延迟（brief: 3 秒） */
const AUTO_DISMISS_MS = 3000;

/** write_agent_memory 工具名 */
const MEMORY_WRITE_TOOL_NAME = 'write_agent_memory';

/**
 * 构造 toast 文案 — 复用 0.3.0 buildMemoryToastMessage 逻辑：
 *   "agent 已更新记忆：User Profile — <content preview>"
 * section 缺失时退化为 "agent 已更新记忆"。
 */
function buildMemoryToastMessage(section: string, contentPreview: string): string {
  const sectionTitle = SECTION_DISPLAY_MAP[section] ?? section ?? '';
  const base = sectionTitle
    ? `agent 已更新记忆：${sectionTitle}`
    : 'agent 已更新记忆';
  const preview = (contentPreview ?? '').trim();
  if (!preview) return base;
  const truncated =
    preview.length > TOAST_PREVIEW_MAX
      ? `${preview.slice(0, TOAST_PREVIEW_MAX)}…`
      : preview;
  return `${base} — ${truncated}`;
}

/**
 * 安全解析 toolCall.arguments（JSON 字符串累积自 tool_call_delta）。
 * 失败时返回空对象 — 退化为通用文案。
 */
function parseMemoryArgs(raw: string): { section?: string; content?: string } {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as { section?: unknown; content?: unknown };
    return {
      section: typeof parsed.section === 'string' ? parsed.section : undefined,
      content: typeof parsed.content === 'string' ? parsed.content : undefined,
    };
  } catch {
    return {};
  }
}

export default function MemoryToast({ toolCalls }: MemoryToastProps) {
  const [message, setMessage] = useState<string | null>(null);
  const seenIdsRef = useRef<Set<string>>(new Set());
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 扫描 toolCalls Map，对未展示过的成功 write_agent_memory 条目触发 toast
  useEffect(() => {
    for (const [id, tc] of toolCalls) {
      if (tc.name !== MEMORY_WRITE_TOOL_NAME) continue;
      if (tc.status !== 'success') continue;
      if (seenIdsRef.current.has(id)) continue;

      seenIdsRef.current.add(id);
      const { section, content } = parseMemoryArgs(tc.arguments);
      setMessage(buildMemoryToastMessage(section ?? '', content ?? ''));

      // 重置自动消失计时器（多次写入会替换当前 toast 并重置 3 秒）
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current);
      }
      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        setMessage(null);
      }, AUTO_DISMISS_MS);
    }
  }, [toolCalls]);

  // 卸载时清理 setTimeout，防止内存泄漏与 setState-on-unmounted 警告
  useEffect(() => {
    return () => {
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, []);

  // 不渲染空 toast — 与 0.3.0 Lit 版 visible=false 时不渲染一致
  if (message === null) return null;

  const dismiss = () => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    setMessage(null);
  };

  return (
    <div className="fixed top-0 left-0 right-0 md:top-4 md:left-auto md:right-4 z-[1000] pointer-events-none">
      <div
        role="status"
        aria-live="polite"
        className="flex items-start gap-2 w-full md:max-w-[320px] px-3.5 py-2 bg-white text-neutral-800 border border-neutral-200 border-l-[3px] border-l-black rounded-none md:rounded-md shadow-md text-[13px] leading-relaxed pointer-events-auto"
      >
        <BookOpen className="w-3.5 h-3.5 text-black mt-[2px] shrink-0" />
        <span className="break-words flex-1 select-none">{message}</span>
        <button
          type="button"
          onClick={dismiss}
          className="shrink-0 mt-[1px] text-neutral-400 hover:text-black transition-colors cursor-pointer"
          aria-label="关闭提示"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}
