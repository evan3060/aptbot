#!/usr/bin/env node
/**
 * Task 3 视觉验收：用 playwright 加载 landing HTML，截图与 adept.ai 对比
 */
import pkg from '/Users/evan/.npm-global/lib/node_modules/playwright/index.js';
const { chromium } = pkg;
import { writeFileSync } from 'node:fs';
import { createLandingPageHtml } from '/Users/evan/projects/aptbot/src/access/landing-page.ts';

const html = createLandingPageHtml();
const OUT_DIR = '/Users/evan/projects/aptbot/docs/research/adept';

const browser = await chromium.connectOverCDP('http://localhost:9222');
const ctx = await browser.newContext();
const page = await ctx.newPage();

// 加载 landing HTML
await page.setContent(html, { waitUntil: 'networkidle', timeout: 30000 });
await page.setViewportSize({ width: 1440, height: 900 });
await page.waitForTimeout(1500);

// 全页截图
await page.screenshot({
  path: `${OUT_DIR}/screenshots/aptbot-landing-full-1440.png`,
  fullPage: true,
});
console.log('✓ aptbot-landing-full-1440.png');

// Hero 区裁切
await page.evaluate(() => window.scrollTo(0, 0));
await page.waitForTimeout(500);
await page.screenshot({
  path: `${OUT_DIR}/screenshots/aptbot-landing-hero-1440.png`,
  clip: { x: 0, y: 0, width: 1440, height: 900 },
});
console.log('✓ aptbot-landing-hero-1440.png');

// 移动端
await page.setViewportSize({ width: 390, height: 844 });
await page.waitForTimeout(800);
await page.screenshot({
  path: `${OUT_DIR}/screenshots/aptbot-landing-mobile-390.png`,
  fullPage: true,
});
console.log('✓ aptbot-landing-mobile-390.png');

// 切回桌面视口再读取计算样式（spec 验收基准为 1440）
await page.setViewportSize({ width: 1440, height: 900 });
await page.evaluate(() => window.scrollTo(0, 0));
await page.waitForTimeout(800);

// 提取实际计算样式验证
const heroH1 = await page.evaluate(() => {
  const h1 = document.querySelector('#hero h1');
  if (!h1) return null;
  const cs = getComputedStyle(h1);
  return {
    fontSize: cs.fontSize,
    fontWeight: cs.fontWeight,
    letterSpacing: cs.letterSpacing,
    lineHeight: cs.lineHeight,
    color: cs.color,
    fontFamily: cs.fontFamily.slice(0, 80),
  };
});
console.log('Hero h1 computed:', JSON.stringify(heroH1, null, 2));

const ctaBtn = await page.evaluate(() => {
  const btn = document.querySelector('#hero a[href="/demo"]');
  if (!btn) return null;
  const cs = getComputedStyle(btn);
  return {
    borderRadius: cs.borderRadius,
    padding: cs.padding,
    fontSize: cs.fontSize,
    backgroundColor: cs.backgroundColor,
    color: cs.color,
  };
});
console.log('Hero CTA computed:', JSON.stringify(ctaBtn, null, 2));

await ctx.close();
process.exit(0);
