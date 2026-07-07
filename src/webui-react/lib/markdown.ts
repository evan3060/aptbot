/**
 * Task 5 (React WebUI redesign): 轻量 Markdown 解析器。
 *
 * 将 content 解析为 React 元素数组（非 HTML 字符串，防 XSS）。
 *
 * 支持的语法：
 *   - 代码块：```lang\ncode\n``` → <pre data-language="lang"><code>code</code></pre>
 *   - 加粗：**text** → <strong>text</strong>
 *   - 行内代码：`code` → <code>code</code>
 *   - 换行：按 \n 分行，每行渲染为 <p>
 *
 * 不使用 dangerouslySetInnerHTML — 所有内容通过 React 元素渲染，自动转义。
 * 设计参考：aistudio-design/src/components/ChatArea.tsx 的 renderFormattedContent。
 */
import { createElement, type ReactNode } from 'react';

/**
 * 解析 Markdown 内容为 React 元素数组。
 *
 * @param content - Markdown 字符串
 * @returns React 元素数组（已扁平化，无嵌套数组）
 */
export function renderMarkdown(content: string): ReactNode[] {
  if (!content) return [];

  // 先按 ``` 分割代码块
  const parts = content.split(/(```[\s\S]*?```)/g);
  const result: ReactNode[] = [];

  parts.forEach((part, partIndex) => {
    if (part.startsWith('```')) {
      // 代码块
      const match = part.match(/```(\w*)\n?([\s\S]*?)```/);
      const language = match ? match[1] : '';
      const code = match
        ? match[2].replace(/\n$/, '')
        : part.replace(/^```(\w*)\n?/, '').replace(/```$/, '');

      result.push(
        createElement(
          'div',
          {
            key: `code-${partIndex}`,
            className:
              'bg-neutral-50 text-neutral-800 p-4 rounded-lg border border-neutral-200 font-mono text-[13px] overflow-x-auto my-3 shadow-xs relative',
          },
          language
            ? createElement(
                'div',
                {
                  key: 'lang-label',
                  className:
                    'absolute top-2 right-3 text-[10px] text-neutral-400 uppercase tracking-wider font-bold',
                },
                language,
              )
            : null,
          createElement(
            'pre',
            {
              'data-language': language || undefined,
              key: 'pre',
            },
            createElement(
              'code',
              {
                className: 'block select-text whitespace-pre leading-relaxed',
              },
              code,
            ),
          ),
        ),
      );
    } else if (part.length > 0) {
      // 非代码段：按 \n 分行，每行解析行内格式
      const lines = part.split('\n');
      lines.forEach((line, lineIdx) => {
        result.push(
          createElement(
            'p',
            {
              key: `line-${partIndex}-${lineIdx}`,
              className: 'leading-relaxed text-[15px] text-neutral-800 mb-2 last:mb-0',
            },
            parseInline(line),
          ),
        );
      });
    }
  });

  return result;
}

/** 匹配 **bold** 或 `inline code` */
const INLINE_REGEX = /(\*\*.*?\*\*|`[^`]*?`)/g;

/**
 * 解析单行内的行内格式：**bold** → <strong>，`code` → <code>。
 * 其余文本作为字符串返回（React 自动转义，防 XSS）。
 */
function parseInline(line: string): ReactNode[] {
  if (!line) return [''];

  const segments = line.split(INLINE_REGEX);
  return segments.map((seg, idx) => {
    if (seg.startsWith('**') && seg.endsWith('**') && seg.length >= 4) {
      return createElement(
        'strong',
        { key: `bold-${idx}`, className: 'font-bold text-black' },
        seg.slice(2, -2),
      );
    }
    if (seg.startsWith('`') && seg.endsWith('`') && seg.length >= 2) {
      return createElement(
        'code',
        {
          key: `code-${idx}`,
          className:
            'bg-neutral-100 border border-neutral-200 text-neutral-800 px-1.5 py-0.5 rounded font-mono text-xs mx-0.5',
        },
        seg.slice(1, -1),
      );
    }
    return seg;
  });
}
