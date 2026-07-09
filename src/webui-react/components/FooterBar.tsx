/**
 * Task 8 (React WebUI redesign): 底部状态栏。
 *
 * 显示当前模型名（来自 bootstrap.model）+ WebSocket 连接状态指示器。
 *
 * 连接状态指示器遵循极简黑白灰约束（brief: 避免绿/红）：
 * - connecting → 灰色脉动点
 * - open       → 黑色实心点
 * - closing    → 浅灰点
 * - closed     → 浅灰点（与 closing 视觉一致，仅文字区分）
 *
 * 由 App.tsx（Task 9）传入 model 字符串与 connectionState；
 * App.tsx 监听 WsClient 的 open/close 事件以维护 connectionState。
 */

/** WebSocket 连接状态（与 WebSocket.readyState 0/1/2/3 对应） */
export type ConnectionState = 'connecting' | 'open' | 'closing' | 'closed';

interface FooterBarProps {
  /** 当前模型名（来自 BootstrapResponse.model） */
  model: string;
  /** WebSocket 连接状态 */
  connectionState: ConnectionState;
}

export default function FooterBar({ model, connectionState }: FooterBarProps) {
  const { dotClass, label, shortLabel } = describeConnection(connectionState);

  return (
    <footer className="flex items-center justify-between gap-3 px-3 md:px-6 py-1.5 border-t border-neutral-200 bg-white text-[10px] md:text-xs font-mono text-neutral-500">
      {/* Left: model name */}
      <div className="flex items-center gap-2 min-w-0">
        <span className="text-neutral-400">model:</span>
        <span className="text-black font-semibold truncate max-w-[120px] md:max-w-none">
          {model || '—'}
        </span>
      </div>

      {/* Right: connection state indicator */}
      <div className="flex items-center gap-1.5 shrink-0">
        <span className={`inline-block w-2 h-2 rounded-full ${dotClass}`} />
        <span className="md:hidden uppercase tracking-wider text-neutral-500">{shortLabel}</span>
        <span className="hidden md:inline uppercase tracking-wider text-neutral-500">{label}</span>
      </div>
    </footer>
  );
}

/**
 * 连接状态 → 视觉描述。
 * 严格黑白灰：connecting 用 gray-400（脉动），open 用 black（实心），
 * closing/closed 用 neutral-300（淡灰）。无绿/红/黄。
 */
function describeConnection(state: ConnectionState): {
  dotClass: string;
  label: string;
  shortLabel: string;
} {
  switch (state) {
    case 'open':
      return { dotClass: 'bg-black', label: 'connected', shortLabel: 'conn' };
    case 'connecting':
      return { dotClass: 'bg-neutral-400 animate-pulse', label: 'connecting', shortLabel: 'wait' };
    case 'closing':
      return { dotClass: 'bg-neutral-300', label: 'closing', shortLabel: 'close' };
    case 'closed':
    default:
      return { dotClass: 'bg-neutral-300', label: 'disconnected', shortLabel: 'disc' };
  }
}
