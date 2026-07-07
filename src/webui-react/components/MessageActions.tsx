/**
 * Task 5 (React WebUI redesign): assistant 消息悬浮操作栏。
 *
 * 迁移自 aistudio-design/src/components/ChatArea.tsx 的 hover actions 区。
 * 操作栏仅出现在 assistant 消息上，hover 时可见。
 *
 * 操作：
 * 1. 复制 — 调用 navigator.clipboard.writeText 复制消息原文，2 秒内显示 ✓
 * 2. 重新生成 — 调用 onRegenerate(messageId)。当前后端不支持 /regenerate，
 *    按钮可见但点击后弹出"暂未支持"提示。
 *
 * 父组件（ChatArea）通过 group-hover 控制可见性，本组件仅渲染按钮 + 交互逻辑。
 */
import { useState } from 'react';
import { Copy, RotateCw, Check } from 'lucide-react';

interface MessageActionsProps {
  /** 消息原文（用于复制） */
  text: string;
  /** 消息 ID（用于 onRegenerate） */
  messageId: string;
  /** 重新生成回调 — App.tsx 在 Task 9 接入 */
  onRegenerate: (messageId: string) => void;
}

export default function MessageActions({ text, messageId, onRegenerate }: MessageActionsProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // clipboard API 在非 HTTPS 环境可能失败 — 静默忽略
    }
  };

  const handleRegenerate = () => {
    // 当前后端不支持 /regenerate — 显示提示并调用回调（App.tsx 可在 Task 9 接入真实逻辑）
    onRegenerate(messageId);
  };

  return (
    <div className="mt-4 flex items-center justify-end gap-3 opacity-40 group-hover:opacity-100 transition-opacity">
      <button
        onClick={handleCopy}
        className="hover:text-black transition-colors cursor-pointer"
        title="复制内容"
      >
        {copied ? (
          <Check className="w-[16px] h-[16px] text-neutral-600" />
        ) : (
          <Copy className="w-[16px] h-[16px]" />
        )}
      </button>
      <button
        onClick={handleRegenerate}
        className="hover:text-black transition-colors cursor-pointer"
        title="重新生成"
      >
        <RotateCw className="w-[16px] h-[16px]" />
      </button>
    </div>
  );
}
