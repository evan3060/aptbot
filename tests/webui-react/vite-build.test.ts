/**
 * Task 1 (React WebUI redesign): Vite 构建产物验证。
 *
 * 验证 `npm run webui:build` 产出的 dist/webui/ 结构：
 *   - dist/webui/index.html 存在
 *   - dist/webui/assets/ 目录存在
 *   - assets/ 下至少有 1 个 .js 和 1 个 .css 文件（Vite 默认输出 hash 文件名）
 *   - index.html 中包含 /webui/assets/ 引用（验证 base: '/webui/' 生效）
 *
 * 注意：此测试会真实运行 Vite build，构建时长约 1-3 秒。
 * 测试通过后 dist/webui/ 留在磁盘上，由 server.ts 在运行时读取。
 */
import { describe, it, expect } from 'vitest';
import { build } from 'vite';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..', '..');
const configFile = path.join(projectRoot, 'src/webui-react/vite.config.ts');
const distWebuiDir = path.join(projectRoot, 'dist/webui');
const distHtml = path.join(distWebuiDir, 'index.html');
const distAssetsDir = path.join(distWebuiDir, 'assets');

describe('Task 1: Vite build output', () => {
  it('produces dist/webui/index.html and assets/ with JS + CSS chunks', async () => {
    // 触发真实 Vite 构建（与 `npm run webui:build` 等价）
    await build({ configFile });

    // 1. index.html 存在
    expect(existsSync(distHtml)).toBe(true);

    // 2. assets/ 目录存在
    expect(existsSync(distAssetsDir)).toBe(true);

    // 3. assets/ 下至少 1 个 .js 和 1 个 .css 文件
    const assetFiles = readdirSync(distAssetsDir);
    expect(assetFiles.length).toBeGreaterThan(0);
    expect(assetFiles.some((f) => f.endsWith('.js'))).toBe(true);
    expect(assetFiles.some((f) => f.endsWith('.css'))).toBe(true);

    // 4. index.html 中应包含 /webui/assets/ 引用（验证 base: '/webui/' 生效）
    const htmlContent = readFileSync(distHtml, 'utf-8');
    expect(htmlContent).toContain('/webui/assets/');

    // 5. index.html 中应包含 #root（React 挂载点）
    expect(htmlContent).toContain('id="root"');
  }, 30000);
});
