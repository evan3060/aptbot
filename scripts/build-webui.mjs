/**
 * Task 1 (React WebUI redesign): Vite 构建脚本。
 *
 * 调用 Vite 构建 src/webui-react/ 到 dist/webui/，输出：
 *   - dist/webui/index.html
 *   - dist/webui/assets/index-[hash].js
 *   - dist/webui/assets/index-[hash].css
 *
 * 用法：
 *   node scripts/build-webui.mjs         # 一次性构建
 *   node scripts/build-webui.mjs --watch # watch 模式（Vite build({ watch: true })）
 *
 * 旧 Lit bundle（src/webui/index.ts）保留为 rollback backup，本脚本不再构建。
 * 开发模式请使用 `npm run webui:dev`（Vite dev server + HMR）。
 */
import { build } from 'vite';
import * as path from 'node:path';
import * as url from 'node:url';

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const configFile = path.join(root, 'src/webui-react/vite.config.ts');
const watch = process.argv.includes('--watch');

if (watch) {
  // Vite watch 模式 — 文件变更时自动重建（适用于本地开发期间的快速迭代）
  await build({
    configFile,
    build: {
      watch: {},
    },
  });
  console.log('[webui] vite build watching for changes...');
} else {
  const result = await build({ configFile });
  const output = result?.output ?? [];
  const jsChunks = output.filter((c) => c.type === 'chunk' && c.fileName.endsWith('.js'));
  const cssAssets = output.filter((c) => c.type === 'asset' && c.fileName.endsWith('.css'));
  console.log(
    `[webui] vite built: ${jsChunks.length} JS chunk(s), ${cssAssets.length} CSS asset(s) → dist/webui/`,
  );
}
