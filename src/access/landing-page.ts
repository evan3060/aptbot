/**
 * 落地页 HTML 生成器（adept.ai 风格）。
 *
 * 纯字符串拼接函数，无 I/O，无异常路径。
 * 此文件为 Task 2 骨架：仅含 <head> + <style> design tokens + 空 <body>。
 * 5 sections 内容、i18n 字典、交互脚本由 Task 3 填充。
 */
export function createLandingPageHtml(): string {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<link rel="icon" href="data:,">
<title>aptbot</title>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&display=swap" rel="stylesheet">
<style>
  :root {
    --bg-base: rgb(255, 255, 255);
    --bg-warm: rgb(245, 242, 241);
    --bg-muted: rgb(249, 247, 244);
    --bg-dark: rgb(39, 36, 34);
    --bg-darker: rgb(18, 18, 18);
    --text-primary: rgb(39, 36, 34);
    --text-secondary: rgb(139, 133, 127);
    --accent: rgb(13, 113, 73);
    --decor-pink: rgb(241, 195, 214);
    --decor-red: rgb(254, 190, 191);
    --border: rgb(229, 231, 235);
    --surface-translucent: rgba(255, 255, 255, 0.98);
    --dark-translucent: rgba(39, 36, 34, 0.9);
  }
</style>
</head>
<body>
<main></main>
<script></script>
</body>
</html>`;
}
