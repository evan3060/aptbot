# aptblog 博客系统设计方案

> **来源：** 本设计源自 aptbot 项目 v0.3.2 规划讨论（2026-07-10）。blog 决定拆分为独立项目 `aptblog`，与 aptbot 完全隔离。本文档为讨论纪要与初始设计，可复制至 aptblog 项目作为起步 spec。
>
> **状态：** 设计已确认，待 aptblog 项目落地实施。

## 1. 背景与目标

### 1.1 需求

- 在 aptbot 站点之外建立独立 blog，承载技术随笔、开发故事、版本更新日志等内容
- blog 内容与 aptbot learn 系统（19 篇结构化技术教程）形成互补：learn 是产品文档，blog 是博客随笔
- 通过网页工具将 blog 文章同步到微信公众号及其他自媒体平台

### 1.2 关键决策

| 决策项 | 选定方案 | 理由 |
|--------|----------|------|
| 项目隔离 | 独立 GitHub 仓库 `aptblog` | blog 内容与 aptbot 代码完全解耦，迭代节奏和关注者不同 |
| 建站工具 | Hexo | Node.js 栈与 aptbot 一致，Markdown 源文件 + 静态产物，维护成本最低 |
| 公众号同步 | wechatsync（Chrome 扩展） | 开源免费，使用浏览器登录态调用平台官方 API，支持 29+ 平台 |
| 部署域名 | `blog.aptbot.de` 子域名 | 与 aptbot 主站干净隔离，Caddy 静态托管 |
| 版本号 | 不适用 | aptblog 是独立项目，自行管理版本；aptbot 侧不涉及版本变更 |

## 2. 架构设计

### 2.1 整体架构

```
本地写作（Markdown） → Hexo 构建静态站点 → git push → VPS pull + 重建 → Caddy 静态托管
                                                                        ↓
                                                              blog.aptbot.de（HTTPS）
                                                                        ↓
                                              浏览器打开文章页 → wechatsync 扩展提取 → 公众号草稿箱
```

### 2.2 组件职责

- **Hexo**：静态站点生成器，读取 `source/_posts/*.md`，应用主题渲染，输出 `public/` 静态 HTML
- **Caddy**：VPS 反向代理，为 `blog.aptbot.de` 自动签发 TLS 证书，`file_server` 托管 `public/` 目录
- **wechatsync**：Chrome 扩展，从浏览器打开的 blog 文章页提取正文+图片，调用公众号后台 Web API 推送到草稿箱
- **git**：版本管理与备份，blog 源文件即 git 仓库

### 2.3 仓库结构建议

```
aptblog/
├── source/
│   ├── _posts/           ← 已发布文章（.md）
│   ├── _drafts/          ← 草稿（hexo publish 升级为正式文章）
│   ├── about/            ← 关于页
│   └── images/           ← 文章图片资源
├── themes/               ← Hexo 主题（推荐 Next 或 Butterfly）
├── _config.yml           ← Hexo 主配置
├── _config.theme.yml     ← 主题配置
├── package.json
└── .github/workflows/    ← CI 自动部署（见 §7.1）
```

## 3. MD 格式与公众号兼容性

### 3.1 wechatsync 工作链路

Hexo 渲染 MD → HTML 网页 → 扩展提取正文 HTML → 调用公众号后台 Web API 粘贴 HTML → 公众号保存为草稿。公众号收到的是 HTML，不是 MD。

### 3.2 兼容性矩阵

**MD 能完整表达、公众号支持良好的：**
- 标题（H1-H6）、段落、有序/无序列表
- 代码块（wechatsync 保留 `<pre><code>` 并注入基础样式）
- 引用（blockquote）、粗体/斜体、行内代码
- 图片（wechatsync 自动转存到公众号素材库，替换外链 URL）
- 表格、链接、分割线

**MD 表达不了、公众号需要的（需人工处理）：**
- **封面图**：公众号图文必须有封面图（900×383 或 2.35:1）。wechatsync 尝试从文章提取第一张图作为封面，或在同步对话框手动指定
- **摘要**：公众号图文有"摘要"字段。wechatsync 自动取文章前 54 字，可在对话框编辑
- **自定义字体颜色/背景色/卡片式排版**：MD 不支持。如需，可在 MD 中嵌 HTML（Hexo 支持 MD 中嵌 HTML）
- **多图并排/瀑布流**：MD 只能单图依次排列

**结论：** 对技术/随笔类 blog，MD 完全够用。封面图和摘要在 wechatsync 同步对话框里手动确认即可（草稿模式，发布前本就要人工过一遍）。

## 4. wechatsync 集成方案

### 4.1 安装与配置

1. Chrome 网上应用店安装「文章同步助手」扩展
2. 在浏览器登录微信公众号后台（个人订阅号即可，无需服务号认证）
3. 打开 blog 文章页 → 点击扩展图标 → 选择「微信公众号」→ 确认封面图和摘要 → 同步为草稿

### 4.2 能力边界

- **不依赖服务号认证**：wechatsync 模拟公众号后台 Web 操作，个人订阅号可用
- **草稿优先**：默认同步为草稿，发布前需人工在公众号后台确认
- **图片自动转存**：blog 中的图片外链会被自动上传到公众号素材库并替换 URL
- **多平台分发**：除公众号外，可同时同步到知乎、掘金、头条等 29+ 平台
- **CLI/MCP 支持**：wechatsync 提供 `@wechatsync/cli` 和 Anthropic MCP 协议集成，可配合 AI 工具使用（未来可选）

### 4.3 对 blog 的要求

- 文章页需有清晰的正文区域（Hexo 主题默认满足，wechatsync 基于 Safari 阅读模式智能提取）
- 图片建议使用绝对 URL（Hexo `config.url` + 图片路径），便于扩展提取

## 5. 文章迁移方案

### 5.1 迁移范围

aptbot learn 系统共 19 篇文章（Track 1「Agent 体系实践」13 篇 + Track 2「AI 辅助编码实践」6 篇），位于 `src/learn/articles/`，含中英双语版本（`.md` 中文 + `.en.md` 英文）和配套图片（`images/` 目录下 `.md` 图表说明 + `.png` 架构图 + `-gpt.png` GPT 生成版本）。

### 5.2 frontmatter 字段映射

aptbot learn 文章 frontmatter 字段 → Hexo frontmatter 映射规则：

| learn 字段 | Hexo 字段 | 说明 |
|------------|-----------|------|
| `title` | `title` | 直接映射 |
| `description` | `description` | 直接映射 |
| `lastUpdated` | `date` | 作为文章日期，格式 `YYYY-MM-DD` |
| `tags` | `tags` | 直接映射 |
| `track` + `chapter` | `categories` | track 作为一级分类，chapter 作为二级分类 |
| `slug` | 文件名 + `permalink` | slug 作为文件名，permalink 设置为 `:slug.html` 或自定义 |
| `difficulty` | 自定义字段 `difficulty` | 保留为 frontmatter 自定义字段，主题可选择性展示 |
| `estimatedReadingTime` | 自定义字段 `reading_time` | 保留，主题可展示 |
| `prerequisites` | 自定义字段 `prerequisites` | 保留为相关文章 slug 列表 |
| `order` | 丢弃 | Hexo 按日期排序，order 无需保留 |
| `status: published` | 移入 `_posts/` | 已发布文章 |
| `status: planned` | 移入 `_drafts/` 或不迁移 | 草稿/占位文章 |

### 5.3 图片迁移

- `src/learn/articles/images/*.png` → `source/images/<article-slug>/`
- `*.md`（图表说明文件）→ 可选：合并为文章图注，或保留为独立文档
- `*-gpt.png`（GPT 生成版本）→ 保留，与人工版并列存放
- 文章内图片引用路径需从相对路径改为 Hexo 资源路径（`{% asset_img filename %}` 或绝对 URL）

### 5.4 双语处理

learn 文章有 `.en.md` 英文版本。Hexo 双语方案二选一：

- **方案 A（推荐）：hexo-generator-i18n 插件** — 同一仓库管理中英文，URL 结构 `/zh/2026/...` 和 `/en/2026/...`，主题切换语言
- **方案 B：独立 `_posts-en/` 目录** — 简单粗暴，英文文章单独目录，通过 Hexo 多 source 配置生成英文站点子路径

### 5.5 迁移工作量评估

- 19 篇文章 × frontmatter 转换：可写脚本批量处理（Node.js 读取 frontmatter → 转换 → 写出）
- 图片迁移：手动整理目录结构，更新文章内引用路径
- 双语：取决于选型，方案 A 需配置插件，方案 B 需调整目录
- 预计 1-2 小时可完成全部迁移

## 6. 部署方案

### 6.1 VPS 环境

复用 aptbot 现有 VPS（aptbot.de 所在服务器），aptblog 静态文件不占运行时资源。

- **反向代理**：nginx（VPS 实际使用 nginx，非 Caddy）
- **静态文件目录**：`/var/www/aptblog/public/`
- **Node.js 进程**：无（纯静态托管，不需要常驻进程）
- **内存占用**：零新增（nginx 已在运行）
- **磁盘占用**：静态 HTML+图片，预计 < 50MB

### 6.2 用户与权限

新建 `aptblog` 用户（与 aptbot 用户隔离），仅密钥登录：

- `sudo useradd -m -s /bin/bash aptblog`
- 安装 SSH 公钥到 `/home/aptblog/.ssh/authorized_keys`（参照 aptbot 用户加固模式）
- SSH 加固：`/etc/ssh/sshd_config` 的 `AllowUsers` 追加 `aptblog`，并加 `Match User aptblog` 块强制 `PasswordAuthentication no`
- 目录属主：`/var/www/aptblog` chown 给 `aptblog:aptblog`

sudoers 配置（`/etc/sudoers.d/aptblog`），仅允许 nginx 配置校验与 reload：

- `aptblog ALL=(root) NOPASSWD: /usr/sbin/nginx -t`
- `aptblog ALL=(root) NOPASSWD: /usr/bin/systemctl reload nginx`
- 路径需用 `which nginx` 核对（通常 `/usr/sbin/nginx`）
- 日常静态文件更新无需 reload nginx（nginx 每次请求从磁盘读取），仅改 nginx 配置时才需 reload

### 6.3 nginx 站点配置

创建 `/etc/nginx/sites-available/aptblog`：

- `listen 443 ssl` + `server_name blog.aptbot.de`
- `root /var/www/aptblog/public` + `index index.html`
- `location / { try_files $uri $uri/ =404; }`
- SSL 证书路径指向 `/etc/letsencrypt/live/blog.aptbot.de/`
- 80 端口 server 块做 HTTP→HTTPS 301 重定向

启用与签发证书：

- `sudo ln -s /etc/nginx/sites-available/aptblog /etc/nginx/sites-enabled/`
- `sudo nginx -t` 校验配置
- `sudo certbot --nginx -d blog.aptbot.de --non-interactive --agree-tos --register-unsafely-without-email --redirect` 签发证书并自动配置
- `sudo systemctl reload nginx`

多应用同 VPS：nginx 通过 `server_name` 区分请求路由到不同 root 目录，与 aptbot.de 站点配置（`sites-available/aptbot`）完全独立。nginx reload 是 graceful 的，不断开现有连接（aptbot.de 的 WebSocket 长连接不受影响）。

### 6.4 DNS 配置

在 aptbot.de 域名 DNS 增加 A 记录：
- `blog.aptbot.de` → VPS IP
- 等待 DNS 生效后 certbot 才能签发证书（certbot 会验证域名指向）

### 6.5 部署流程

初始部署（需 root 或 evan 密码 sudo 执行）：
1. 新建 aptblog 用户 + SSH 公钥 + sshd_config 加固（见 §6.2）
2. `sudo mkdir -p /var/www/aptblog && sudo chown aptblog:aptblog /var/www/aptblog`
3. `sudo -u aptblog git clone <aptblog-repo> /var/www/aptblog`
4. `cd /var/www/aptblog && sudo -u aptblog npm ci && sudo -u aptblog npx hexo generate`
5. 配置 sudoers（见 §6.2）
6. 创建 nginx 站点配置 + 签发证书 + reload（见 §6.3）
7. DNS 加 A 记录（见 §6.4）
8. 验证 `https://blog.aptbot.de/` 可访问

日常更新（aptblog 用户 SSH 登录执行）：
1. 本地写文章 → `hexo g` 预览 → git push
2. VPS `cd /var/www/aptblog && git pull && npm ci && npx hexo generate`
3. nginx 无需 reload（静态文件直接生效）
4. （可选）配置 GitHub Actions 自动部署，见 §7.1

## 7. 补充建议

### 7.1 CI/CD 自动部署（强烈推荐）

配置 GitHub Actions，push 到 main 分支时自动构建并部署到 VPS：

- 触发条件：push to main
- 步骤：checkout → setup-node → npm ci → hexo generate → rsync/scp `public/` 到 VPS `/var/www/aptblog/public/`
- VPS 配置部署专用 SSH key（仅允许写入 `/var/www/aptblog/`，可用 `authorized_keys` 的 `command=` 限制）
- 免去手动 SSH 登录 VPS 重建的步骤

### 7.2 图片管理策略

- **推荐：Hexo 资源文件夹**（`source/images/<article-slug>/`）— 图片与文章同仓库，git 即备份，wechatsync 可直接提取
- **备选：图床 CDN**（如 GitHub + jsDelivr、Cloudflare R2）— 适合图片量大时减轻仓库体积，但增加依赖
- **建议**：初期用资源文件夹，仓库体积超过 100MB 时再考虑图床

### 7.3 SEO 基础设施

Hexo 主题通常内置或可通过插件启用：
- `hexo-generator-sitemap`：生成 `sitemap.xml`，提交给 Google/Bing/百度
- `hexo-generator-search`：生成 `search.xml`，站内搜索
- `hexo-generator-feed`：生成 RSS `atom.xml`，便于订阅
- 主题配置 meta tags（title/description/og:tags），每篇文章 frontmatter 的 `description` 字段会被用作 meta description

### 7.4 评论系统

- **推荐：Giscus** — 基于 GitHub Discussions，开源免费，无广告，与 GitHub 仓库绑定，评论数据存 Discussions
- 备选：Disqus（国际通用但国内访问慢）、Utterances（基于 GitHub Issues，比 Giscus 简单但功能少）
- 如无需评论：主题配置关闭即可

### 7.5 草稿工作流

- Hexo 原生支持 `_drafts/` 目录：`hexo new draft <title>` 创建草稿，`hexo publish <title>` 升级为正式文章
- 草稿不会出现在生成的站点中（除非 `hexo server --draft` 本地预览）
- 建议工作流：草稿在 `_drafts/` 写作 → 完成后 `hexo publish` → git push → CI 自动部署

### 7.6 备份策略

- git 仓库即完整备份（源文件 + 主题配置 + 图片）
- 建议在 GitHub 之外增加一个远程备份（如 Gitee 镜像或本地 bare repo），防单点故障
- VPS 上的 `public/` 可随时从源文件重建，无需备份

### 7.7 主题选择

- **Hexo Next**：最经典，简洁稳重，技术博客标配，文档完善，社区活跃
- **Butterfly**：功能丰富，卡片式设计，移动端体验好，配置项多
- **Fluid**：Material 风格，视觉现代，适合偏展示型博客
- **建议**：无偏好选 Next，稳；想要更丰富视觉效果选 Butterfly

### 7.8 VPS 资源占用评估

- aptbot 当前 systemd 限制 `MemoryMax=512M`，aptblog 静态托管不新增进程，零影响
- nginx 已在运行，新增站点仅增加配置文件，内存影响可忽略
- aptblog 用户独立，与 aptbot 用户权限隔离，无安全面扩大
- 磁盘：静态文件 < 50MB，git 仓库随文章增长，预计长期 < 500MB

## 8. aptbot 侧的改动（可选）

aptblog 独立后，aptbot 主站可选择性添加 blog 入口：

- **落地页**（`/`）：导航栏或 Knowledge 区追加"Blog"链接，指向 `https://blog.aptbot.de`
- **WebUI**：FooterBar 或关于页追加 Blog 入口
- **learn 页面**：可在文章列表顶部加"更多博客文章请访问 blog.aptbot.de"提示

此项非必须，可在 aptblog 上线后视情况决定是否在 aptbot 侧加链接。如需添加，属于 aptbot 后续版本（如 0.3.2 或 0.3.3）的 minor 改动。

## 9. 待决策项

以下项目需在 aptblog 项目启动时确认：

1. **仓库名**：建议 `aptblog`，如有其他偏好可调整
2. **Hexo 主题**：Next / Butterfly / Fluid / 其他
3. **评论系统**：Giscus / Disqus / 不要评论
4. **双语方案**：i18n 插件 / 独立目录 / 仅中文
5. **CI/CD**：是否配置 GitHub Actions 自动部署
6. **DNS**：`blog.aptbot.de` 的 A 记录何时配置
7. **aptbot 侧改动**：是否在 aptbot 主站加 Blog 入口，以及哪个版本加

## 10. 参考资料

- Hexo 官方文档：https://hexo.io/
- wechatsync 项目：https://github.com/wechatsync/Wechatsync
- wechatsync CLI：`npm install -g @wechatsync/cli`
- Hexo Next 主题：https://theme-next.js.org/
- Hexo Butterfly 主题：https://butterfly.js.org/
- Giscus 评论系统：https://giscus.app/
- aptbot learn 文章源（迁移来源）：`src/learn/articles/`
