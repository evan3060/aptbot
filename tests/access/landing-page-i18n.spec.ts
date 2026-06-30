import { describe, it, expect } from 'vitest';
import { createLandingPageHtml } from '../../src/access/landing-page.js';

/**
 * Task 3: landing-page i18n 字典契约
 *
 * 验证内联 I18N 字典 + applyLang 函数存在，zh / en key 集合一致，
 * 且每个 [data-i18n] 属性引用的 key 都在字典中存在。
 */
describe('Task 3: landing-page i18n 字典契约', () => {
  const html = createLandingPageHtml();

  /** 从 I18N 字典中提取指定语言块的 key 集合（正则解析，匹配 'key': 模式） */
  function extractI18nKeys(lang: 'zh' | 'en'): Set<string> {
    const re = new RegExp(`${lang}:\\s*\\{([\\s\\S]*?)\\}`);
    const m = html.match(re);
    if (!m) return new Set();
    return new Set([...m[1].matchAll(/'([^']+)'\s*:/g)].map((x) => x[1]));
  }

  it('含 I18N 对象定义', () => {
    expect(html).toMatch(/const\s+I18N\s*=\s*\{/);
  });

  it('含 applyLang 函数定义', () => {
    expect(html).toMatch(/function\s+applyLang\s*\(/);
  });

  it('默认 lang="zh-CN"', () => {
    expect(html).toContain('<html lang="zh-CN">');
  });

  it('I18N.zh 与 I18N.en 的 key 集合一致', () => {
    const zhKeys = extractI18nKeys('zh');
    const enKeys = extractI18nKeys('en');
    expect(zhKeys.size).toBeGreaterThan(0);
    expect(enKeys.size).toBeGreaterThan(0);
    expect(zhKeys).toEqual(enKeys);
  });

  it('每个 [data-i18n] 的 key 都在 I18N.zh 中存在', () => {
    const zhKeys = extractI18nKeys('zh');
    expect(zhKeys.size).toBeGreaterThan(0);
    const dataKeys = [...html.matchAll(/data-i18n="([^"]+)"/g)].map((m) => m[1]);
    expect(dataKeys.length).toBeGreaterThanOrEqual(10);
    for (const key of dataKeys) {
      expect(zhKeys.has(key)).toBe(true);
    }
  });
});
