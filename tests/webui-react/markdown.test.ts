/**
 * Task 5 (React WebUI redesign): markdown parser 单元测试。
 *
 * 验证 brief Step 1 要求的场景：
 *   - 代码块解析（```python\nprint('hi')\n``` → <pre><code> with language label）
 *   - 加粗解析（**bold** → <strong>）
 *   - 行内代码（`code` → <code>）
 *   - 普通文本换行
 *   - 不使用 dangerouslySetInnerHTML（防 XSS）
 *
 * 测试策略：renderMarkdown 返回 React 元素数组（非 HTML 字符串）。
 * 通过 isValidElement + 递归遍历检查元素类型、props、文本内容，
 * 不依赖 DOM 渲染，在 node 环境下运行。
 */
import { describe, it, expect } from 'vitest';
import { isValidElement, type ReactNode, type ReactElement } from 'react';
import { renderMarkdown } from '../../src/webui-react/lib/markdown.js';

/** 递归收集 React 树中所有 ReactElement 节点 */
function collectElements(nodes: ReactNode[]): ReactElement[] {
  const result: ReactElement[] = [];
  function walk(node: ReactNode): void {
    if (node === null || node === undefined || typeof node === 'boolean') return;
    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }
    if (isValidElement(node)) {
      result.push(node);
      walk(node.props.children);
    }
  }
  walk(nodes);
  return result;
}

/** 深度查找第一个匹配 predicate 的元素 */
function findDeep(
  nodes: ReactNode[],
  predicate: (el: ReactElement) => boolean,
): ReactElement | undefined {
  return collectElements(nodes).find(predicate);
}

/** 提取 React 节点树中的所有文本内容 */
function extractText(node: ReactNode): string {
  if (typeof node === 'string') return node;
  if (typeof node === 'number') return String(node);
  if (node === null || node === undefined || typeof node === 'boolean') return '';
  if (Array.isArray(node)) return node.map(extractText).join('');
  if (isValidElement(node)) {
    return extractText(node.props.children);
  }
  return '';
}

describe('renderMarkdown', () => {
  it('returns an array of React nodes', () => {
    const result = renderMarkdown('hello');
    expect(Array.isArray(result)).toBe(true);
  });

  it('returns empty array for empty string', () => {
    const result = renderMarkdown('');
    expect(result).toEqual([]);
  });

  describe('code blocks', () => {
    it('parses ```python\\nprint("hi")\\n``` into <pre><code> with language label', () => {
      const result = renderMarkdown('```python\nprint("hi")\n```');
      const pre = findDeep(result, (el) => el.type === 'pre');
      expect(pre).toBeDefined();
      // 语言标签通过 data-language 属性或 className 携带
      const dataLang = pre!.props['data-language'];
      const className = (pre!.props.className as string) || '';
      expect(dataLang || className).toMatch(/python/);
      // <pre> 内部包含 <code> 元素
      const code = findDeep([pre!], (el) => el.type === 'code');
      expect(code).toBeDefined();
      expect(extractText(code!)).toContain('print("hi")');
    });

    it('handles code block without language label', () => {
      const result = renderMarkdown('```\nplain code\n```');
      const pre = findDeep(result, (el) => el.type === 'pre');
      expect(pre).toBeDefined();
      const code = findDeep([pre!], (el) => el.type === 'code');
      expect(code).toBeDefined();
      expect(extractText(code!)).toContain('plain code');
    });

    it('handles code block followed by text', () => {
      const result = renderMarkdown('```js\nconst x = 1;\n```\nafter code');
      const pre = findDeep(result, (el) => el.type === 'pre');
      expect(pre).toBeDefined();
      expect(extractText(pre!)).toContain('const x = 1;');
      // 代码块后的文本也应被渲染
      expect(extractText(result)).toContain('after code');
    });
  });

  describe('bold', () => {
    it('parses **bold** into <strong>', () => {
      const result = renderMarkdown('this is **bold** text');
      const strong = findDeep(result, (el) => el.type === 'strong');
      expect(strong).toBeDefined();
      expect(extractText(strong!)).toBe('bold');
    });

    it('handles multiple bold segments in one line', () => {
      const result = renderMarkdown('**one** and **two**');
      const strongs = collectElements(result).filter((el) => el.type === 'strong');
      expect(strongs.length).toBe(2);
      expect(extractText(strongs[0])).toBe('one');
      expect(extractText(strongs[1])).toBe('two');
    });
  });

  describe('inline code', () => {
    it('parses `code` into <code>', () => {
      const result = renderMarkdown('use `npm install` to install');
      const allCodes = collectElements(result).filter((el) => el.type === 'code');
      expect(allCodes.length).toBeGreaterThanOrEqual(1);
      const inlineCode = allCodes.find((c) => extractText(c) === 'npm install');
      expect(inlineCode).toBeDefined();
    });
  });

  describe('line breaks', () => {
    it('splits plain text by newline into multiple elements', () => {
      const result = renderMarkdown('line1\nline2\nline3');
      // 每行应渲染为独立的元素（如 <p> 或 <div>）
      const lineElements = result.filter((n) => isValidElement(n));
      expect(lineElements.length).toBeGreaterThanOrEqual(3);
    });
  });

  describe('mixed content', () => {
    it('parses code block followed by bold text', () => {
      const result = renderMarkdown('```js\nconst x = 1;\n```\nThis is **important**');
      const pre = findDeep(result, (el) => el.type === 'pre');
      expect(pre).toBeDefined();
      const strong = findDeep(result, (el) => el.type === 'strong');
      expect(strong).toBeDefined();
      expect(extractText(strong!)).toBe('important');
    });

    it('parses bold and inline code in same line', () => {
      const result = renderMarkdown('**bold** and `code`');
      const strong = findDeep(result, (el) => el.type === 'strong');
      expect(strong).toBeDefined();
      expect(extractText(strong!)).toBe('bold');
      const codes = collectElements(result).filter((el) => el.type === 'code');
      expect(codes.length).toBeGreaterThanOrEqual(1);
      expect(extractText(codes[0])).toBe('code');
    });
  });

  describe('XSS prevention', () => {
    it('does not use dangerouslySetInnerHTML', () => {
      const result = renderMarkdown('<script>alert(1)</script>');
      const allElements = collectElements(result);
      for (const el of allElements) {
        expect(el.props.dangerouslySetInnerHTML).toBeUndefined();
      }
    });

    it('renders HTML-looking content as plain text (escaped)', () => {
      const result = renderMarkdown('<script>alert(1)</script>');
      const text = extractText(result);
      // HTML 标签应作为纯文本出现，而非被解析为 HTML 元素
      expect(text).toContain('<script>alert(1)</script>');
      // 不应出现 <script> 类型的 React 元素
      const scriptElements = collectElements(result).filter((el) => el.type === 'script');
      expect(scriptElements.length).toBe(0);
    });
  });
});
