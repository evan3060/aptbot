# aptbot 部署指南

> 本文记录 aptbot 部署到 VPS 的完整流程，覆盖 systemd 进程管理、反向代理（nginx 或 Caddy）、TLS 签发、SSH 加固与 sudoers 配置。所有敏感字段以 `<placeholder>` 表示。

> **当前部署版本：** v0.2.0（L1）。详见 [CHANGELOG.md](../CHANGELOG.md)。

## 部署架构

```
浏览器 → HTTPS(443) → 反向代理(nginx/Caddy) → 127.0.0.1:8080 → aptbot(Node.js)
                         ↓
                    TLS 终止 + WebSocket 升级
```

- aptbot 以非 root 用户（`aptbot`）运行，由 systemd 管理
- Node.js 绑定 `127.0.0.1:8080`，外部无法直连，必须经反向代理
- 反向代理负责 TLS 终止、HTTP→HTTPS 重定向、WebSocket 升级
- L1+：用户系统自动启用（`UserStorage` 默认开启，用户数据存 `data/users.jsonl`），无需额外 env 配置
- L1+：Token 优先级 `URL ?token=` > 用户登录 token > `APTBOT_AUTH_TOKEN` > 匿名 UUID

## 1. 环境准备

### 1.1 安装 Node.js 20+

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs
node --version    # 应 >= v20
```

### 1.2 安装反向代理

nginx：

```bash
sudo apt-get install -y nginx
```

或 Caddy（自动 TLS，配置更简）：

```bash
sudo apt install -y debian-keyring debian-archive-keyring apt-transport-https
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo apt update && sudo apt install -y caddy
```

### 1.3 安装 git

```bash
sudo apt-get install -y git
```

## 2. 创建 aptbot 用户

为安全起见，aptbot 以独立非 root 用户运行：

```bash
sudo useradd -m -s /bin/bash aptbot
```

安装 SSH 公钥（本地 `~/.ssh/id_ed25519.pub`）到 aptbot 用户：

```bash
sudo mkdir -p /home/aptbot/.ssh
sudo tee /home/aptbot/.ssh/authorized_keys < ~/.ssh/id_ed25519.pub
sudo chmod 700 /home/aptbot/.ssh
sudo chmod 600 /home/aptbot/.ssh/authorized_keys
sudo chown -R aptbot:aptbot /home/aptbot/.ssh
```

## 3. 部署代码

```bash
sudo mkdir -p /opt/aptbot
sudo chown aptbot:aptbot /opt/aptbot
sudo -u aptbot git clone https://github.com/evan3060/aptbot.git /opt/aptbot
cd /opt/aptbot
sudo -u aptbot npm ci
sudo -u aptbot npm run build
```

## 4. 配置环境变量

创建 `/opt/aptbot/.env`（仅 aptbot 用户可读）：

```bash
CUSTOM_API_KEY=<your-provider-api-key>
APTBOT_AUTH_TOKEN=<openssl-rand-hex-32-生成的随机-token>
HOST=127.0.0.1
PORT=8080
```

生成强随机 token：

```bash
openssl rand -hex 32
```

> **安全提示：** `HOST=127.0.0.1` 必须设置，否则 Node.js 默认绑定 `0.0.0.0`，外部可绕过反向代理直连 8080 端口。

## 5. 配置 config/aptbot.json

```json
{
  "providers": [{
    "id": "custom",
    "name": "Custom API",
    "baseUrl": "https://<your-provider-endpoint>/v1",
    "auth": { "envVar": "CUSTOM_API_KEY" },
    "models": [{
      "id": "<your-model-id>",
      "api": "openai-completions",
      "contextWindow": 64000,
      "maxTokens": 4096
    }]
  }],
  "defaultModel": "<your-model-id>",
  "dataDir": "./data",
  "deploy": "local"
}
```

> **注意：** `baseUrl` 必须包含 `/v1` 后缀（标准 OpenAI 兼容格式），否则请求会 404。

## 6. systemd 服务

创建 `/etc/systemd/system/aptbot.service`：

```ini
[Unit]
Description=aptbot personal assistant
After=network.target

[Service]
Type=simple
User=aptbot
Group=aptbot
WorkingDirectory=/opt/aptbot
Environment=NODE_ENV=production
Environment=PORT=8080
ExecStart=/usr/bin/node --env-file=/opt/aptbot/.env /opt/aptbot/dist/server.js
Restart=on-failure
RestartSec=5
MemoryMax=512M
StandardOutput=journal
StandardError=journal
SyslogIdentifier=aptbot

[Install]
WantedBy=multi-user.target
```

启用并启动：

```bash
sudo systemctl daemon-reload
sudo systemctl enable aptbot
sudo systemctl start aptbot
sudo systemctl status aptbot    # 应为 active (running)
```

## 7. 反向代理配置

### 7.1 nginx 方案

创建 `/etc/nginx/sites-available/aptbot`：

```nginx
server {
    server_name <your-domain>;
    location / {
        proxy_pass http://127.0.0.1:8080;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 86400;
        proxy_send_timeout 86400;
    }
    listen 443 ssl;
    ssl_certificate /etc/letsencrypt/live/<your-domain>/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/<your-domain>/privkey.pem;
    include /etc/letsencrypt/options-ssl-nginx.conf;
    ssl_dhparam /etc/letsencrypt/ssl-dhparams.pem;
}
server {
    if ($host = <your-domain>) {
        return 301 https://$host$request_uri;
    }
    listen 80;
    server_name <your-domain>;
    return 404;
}
```

启用并签发 TLS（certbot）：

```bash
sudo ln -s /etc/nginx/sites-available/aptbot /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
sudo certbot --nginx -d <your-domain> --non-interactive --agree-tos --register-unsafely-without-email --redirect
```

### 7.2 Caddy 方案（自动 TLS，配置更简）

编辑 `/etc/caddy/Caddyfile`：

```caddy
<your-domain> {
    reverse_proxy 127.0.0.1:8080
    encode zstd gzip
}
```

Caddy 会自动为该域名签发并续期 Let's Encrypt 证书，无需手动 certbot：

```bash
sudo systemctl reload caddy
```

> 多应用同 VPS 场景：Caddy 通过 SNI（域名）自动路由到不同 reverse_proxy 端口，无需额外配置。

## 8. sudoers 配置（aptbot 免密重启服务）

为让 aptbot 用户能自行部署更新（`git pull && npm run build && systemctl restart`），配置受限 sudo：

创建 `/etc/sudoers.d/aptbot`：

```
aptbot ALL=(root) NOPASSWD: /usr/bin/systemctl restart aptbot
aptbot ALL=(root) NOPASSWD: /usr/bin/systemctl status aptbot
aptbot ALL=(root) NOPASSWD: /usr/bin/systemctl status aptbot *
aptbot ALL=(root) NOPASSWD: /usr/bin/systemctl stop aptbot
aptbot ALL=(root) NOPASSWD: /usr/bin/systemctl start aptbot
aptbot ALL=(root) NOPASSWD: /usr/bin/journalctl -u aptbot
aptbot ALL=(root) NOPASSWD: /usr/bin/journalctl -u aptbot *
```

```bash
sudo visudo -c -f /etc/sudoers.d/aptbot    # 校验语法
```

> **路径核对：** 用 `which systemctl` 确认实际路径（通常 `/usr/bin/systemctl`，非 `/bin/systemctl`），路径错会导致 sudoers 不生效。

## 9. SSH 加固

编辑 `/etc/ssh/sshd_config`：

```
PermitRootLogin no
PasswordAuthentication yes
AllowUsers aptbot evan

Match User aptbot
    PasswordAuthentication no
```

- `PermitRootLogin no`：禁止 root SSH 登录（仅 VPS 控制台可访问 root）
- `AllowUsers`：白名单限制可登录用户
- `Match User aptbot` 块：强制 aptbot 仅密钥登录（部署账号），其他用户可保留密码登录

```bash
sudo systemctl restart sshd
```

## 10. 部署后验证

| 检查项 | 命令 | 期望结果 |
|--------|------|----------|
| 服务运行 | `sudo systemctl status aptbot` | active (running) |
| 端口绑定 | `ss -tlnp \| grep 8080` | 127.0.0.1:8080 |
| 8080 外部封堵 | `curl http://<your-vps-ip>:8080/` | 连接拒绝 |
| HTTPS 可用 | `curl -I https://<your-domain>/` | HTTP 200 |
| HTTP 重定向 | `curl -I http://<your-domain>/` | HTTP 301 |
| aptbot SSH | `ssh aptbot@<your-vps-ip> 'whoami'` | aptbot |
| root SSH 封堵 | `ssh root@<your-vps-ip> 'whoami'` | Permission denied |
| 聊天页面 | 浏览器访问 `https://<your-domain>/?token=<your-auth-token>` | 正常加载并可对话 |

## 11. 日常维护

```bash
# 以 aptbot 用户 SSH 登录（仅密钥）
ssh aptbot@<your-vps-ip>

# 更新部署（v0.2.0+ 切换到 l1-user-system 分支）
cd /opt/aptbot && git fetch origin && git checkout l1-user-system && git pull origin l1-user-system
# 注意：config/aptbot.json 含本地配置，git pull 前用 git stash 保留
git stash push -m "preserve config" config/aptbot.json
git pull origin l1-user-system
git stash pop 2>/dev/null || cp /tmp/aptbot.json.backup config/aptbot.json  # 防止冲突
npm ci && npm run build && sudo systemctl restart aptbot

# 查看最近日志
sudo journalctl -u aptbot --no-pager -n 50

# 实时日志
sudo journalctl -u aptbot -f

# 访问地址（v0.2.0+ 支持注册/登录，无需 ?token=）
# 老链接：https://<your-domain>/?token=<your-auth-token>
# 新链接：https://<your-domain>/  → 注册新用户或登录已有账号
```

### 11.1 数据文件位置（v0.2.0+）

| 文件 | 用途 | 清理策略 |
|------|------|----------|
| `data/users.jsonl` | 注册用户（scrypt 哈希密码 + token） | 永久保留 |
| `data/sessions/*.jsonl` | 会话消息历史（per-sessionId） | 永久保留（L2 计划自动归档） |
| `data/sessions/*.meta.json` | 会话元数据（owner / label） | 永久保留 |
| `data/telegram_sessions.jsonl` | Telegram chatId 映射（L2+） | 永久保留 |

> **重要：** Agent 进程不可直接读 `data/sessions/` 目录（受 Global Constraint 限制）。仅 `websocket-server.ts` 通过 `readHistoryForReplay` 受限路径访问，用于服务器重启后历史回放。

### 11.2 切换分支/回滚

```bash
# 回滚到 v0.1.0（main 分支）
cd /opt/aptbot
git stash push -m "preserve config" config/aptbot.json
git checkout main
git stash pop 2>/dev/null || cp /tmp/aptbot.json.backup config/aptbot.json
npm ci && npm run build && sudo systemctl restart aptbot

# 切换到 L1+（l1-user-system 分支）
git checkout l1-user-system && git pull origin l1-user-system
npm ci && npm run build && sudo systemctl restart aptbot
```

## 12. 常见问题排查

### 问题：聊天页面 404 Not Found

**现象：** 访问 `https://<your-domain>/?token=xxx` 返回 "Not Found"。

**根因：** HTTP 服务器用 `req.url === '/'` 精确匹配，但带 query string 时 `req.url` 为 `/?token=xxx`，匹配失败。

**修复：** 已在 commit `d38309e` 修复，代码改用 `new URL(req.url).pathname` 解析路径，忽略 query string。

### 问题：WebSocket 鉴权失败 "Invalid or missing auth token"

**现象：** 聊天页面加载后 WebSocket 连接被拒，返回 `auth_failed`。

**根因：** `.env` 设置了 `APTBOT_AUTH_TOKEN`，但访问 URL 未带 `?token=` 参数。

**修复：** 访问时在 URL 带上 token：`https://<your-domain>/?token=<your-auth-token>`。

> **Token 记忆（v0.2.0+）：** 首次带 `?token=` 访问并成功连接后，token 会存入 `sessionStorage`。后续刷新或重连在同一标签页内自动携带，无需每次手动加 `?token=` 参数。标签页关闭后 `sessionStorage` 自动清除。如需切换 token，在 URL 中带新 token 访问即可覆盖。

### 问题：agent run failed（API 404）

**现象：** 发送消息后无回复，日志显示 `"agent run failed"`。

**根因：** `baseUrl` 配置缺少 `/v1` 后缀，provider 代码拼接 `${baseUrl}/chat/completions` 后命中错误路径返回 404 HTML 页面。

**修复：** `baseUrl` 改为 `https://<your-provider-endpoint>/v1`（标准 OpenAI 兼容格式）。

### 问题：端口 8080 对外暴露

**现象：** `curl http://<your-vps-ip>:8080/` 返回 200，可绕过反向代理/TLS 直连。

**根因：** `httpServer.listen(port)` 未指定 host，Node.js 默认绑定所有接口。

**修复：** 设置 `HOST=127.0.0.1` 环境变量（commit `73d5b2a` 已支持）。

### 问题：sudoers 不生效

**现象：** aptbot 用户执行 `sudo systemctl status aptbot` 提示需要密码。

**根因：** sudoers 文件写的路径（如 `/bin/systemctl`）与实际路径（`/usr/bin/systemctl`）不符。

**修复：** 用 `which systemctl` 确认路径后更新 sudoers。

### 问题：session ownership mismatch 无限循环（v0.2.0+）

**现象：** 浏览器控制台反复出现 `session ownership mismatch, regenerating sessionId`，消息发不出去，`/api/sessions/:id/messages` 返回 403 Forbidden。

**根因：** localStorage 中的 sessionId 是被旧用户 claim 的 agent 共享 session。新用户登录后，前端用该 sessionId 连接 WebSocket，server 端 ownership 检查拒绝（owner 是旧用户）→ 前端 regenerate 新 sessionId → server 返回 user_identified 带 agent sessionId → 前端用 agent sessionId 重连 → 再次拒绝 → 死循环。

**修复：** v0.2.0 已修复。server 端检测到 `?session` 等于 agent 当前 sessionId 时，调用 `forceClaimSession` 强制转移 owner 给当前登录用户，跳过严格 ownership 检查。其他 session 保持严格 ownership。

**应急处理（旧客户端缓存旧 sessionId）：**
1. 浏览器 F12 → Application → Local Storage → 删除 `aptbot:sessionId`
2. 刷新页面，让前端重新走 `?session=` 流程

### 问题：HEAD 请求返回 404

**现象：** `curl -I https://<your-domain>/` 返回 404，但浏览器访问正常。

**根因：** aptbot HTTP 服务器仅在 `GET /` 时返回 chat-page HTML，未处理 HEAD 方法。这是已知行为，不影响浏览器（浏览器用 GET）。

**修复：** 无需修复。如需 HEAD 探测，使用 `curl -s -o /dev/null -w "%{http_code}\n" https://<your-domain>/`（GET 方法）。

## 相关提交

| commit | 说明 |
|--------|------|
| `73d5b2a` | fix: add HOST env var to bind loopback behind reverse proxy |
| `d38309e` | fix: serve chat page when URL has query params like ?token= |
| `af21d51` | feat: persist auth token in sessionStorage for chat page (L1 Task 1) |
| `fb1d1ba` | feat: add session rename with 3-dot menu and cross-client sync |
| `9fedcd4` | fix: break session ownership mismatch infinite loop |
| `94e4145` | feat(l1): complete L1 with user system and multi-client sync |
