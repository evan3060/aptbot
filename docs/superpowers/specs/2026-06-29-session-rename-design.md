# 会话重命名功能设计

**日期**：2026-06-29
**状态**：已批准，待实施
**触发**：用户希望在会话列表项右侧添加 3-dot 菜单，支持重命名会话

## 1. 目标

在侧边栏会话项右侧添加 3-dot 菜单（⋮），点击后弹出「重命名会话」选项。点击后该会话项的 label 原地变成 input 输入框，Enter 保存，Esc 取消。保存后通过实时同步机制使其他在线客户端的侧边栏立即显示新名称。

## 2. 非目标

- 不支持批量重命名
- 不支持删除会话（本次仅做重命名）
- 不修改 AgentEvent union（避免再次破坏事件序列测试）

## 3. 架构

```
[前端 A]                       [后端]                          [存储]
点击 ⋮ → 重命名             POST /api/sessions/:id/label    updateSessionLabel
  ↓ inline input 显示            ↓                              ↓ .meta.json
Enter → POST 修改请求         sendToSessionKey(sessionId,     label 字段更新
                              {type:'session_renamed', sessionId, label})
  ↓                              ↓
刷新本地 label                其他客户端收到 → loadSessionList
```

**关键决策**：
- 后端用原始控制消息（通过 `sendToSessionKey`，不走 AgentEvent union，不进 ring buffer）— 与 `session_changed` 一致，避免改事件序列测试
- 前端其他客户端收到 `session_renamed` 后直接 `loadSessionList()` — 简单实现，避免手动同步 DOM

## 4. 后端设计

### 4.1 新增 HTTP 端点

**路由**：`POST /api/sessions/:id/label`
- **路径匹配**：`/^\/api\/sessions\/([a-f0-9-]{36})\/label$/`
- **body**：JSON `{ label: string }`（label 长度限制 100 字符，超出截断；空字符串视为 400）
- **认证**：复用 `/api/sessions/:id/messages` 模式 — query `?token=` 或 `Authorization: Bearer <token>`
- **ownership 检查**：`getSessionOwner(sessionId)` === `user.userId`，否则 403
- **执行**：调用 `sessionStorage.updateSessionLabel(sessionId, label)`
- **广播**：通过新回调 `onSessionRenamed(sessionId, label)` 让 server.ts 调用 `wsServer.sendToSessionKey(sessionId, { type: 'session_renamed', sessionId, label })`
- **响应**：`200 { ok: true, label }`

### 4.2 WebSocketServerOptions 扩展

```typescript
/** 会话重命名后触发，用于广播 session_renamed 控制消息到同 session 其他连接 */
onSessionRenamed?: (sessionId: string, label: string) => void;
```

### 4.3 错误码

| HTTP | 场景 |
|------|------|
| 400 | label 为空 / 非 string |
| 401 | 缺 token / token 无效 |
| 403 | session 不属于该用户 |
| 404 | session 不存在（owner 为 undefined）|
| 405 | 非 POST 方法 |

## 5. 前端设计

### 5.1 CSS 新增

```css
.session-item { display: flex; align-items: flex-start; position: relative; }
.session-item .session-main { flex: 1; min-width: 0; }
.session-item .session-menu-btn {
  background: none; border: none; cursor: pointer;
  color: #9ca3af; font-size: 16px; padding: 2px 6px;
  opacity: 0; flex-shrink: 0;
}
.session-item:hover .session-menu-btn { opacity: 1; }
.session-menu {
  position: absolute; right: 4px; top: 28px;
  background: #fff; border: 1px solid #e5e7eb; border-radius: 4px;
  box-shadow: 0 2px 8px rgba(0,0,0,0.1); z-index: 10;
  min-width: 120px; padding: 4px 0;
}
.session-menu-item { padding: 6px 12px; cursor: pointer; font-size: 12px; }
.session-menu-item:hover { background: #f3f4f6; }
.session-rename-input {
  width: 100%; padding: 2px 4px;
  border: 1px solid #3b82f6; border-radius: 3px;
  font-size: 13px; font-weight: 500;
}
```

### 5.2 renderSessionList 改造

每个 session item 内部结构：
```html
<div class="session-item" data-session-id="...">
  <div class="session-main">
    <div class="session-label">...</div>
    <div class="session-time">...</div>
  </div>
  <button class="session-menu-btn">⋮</button>
</div>
```

### 5.3 交互流程

1. hover session item → 显示 `⋮` 按钮（CSS opacity 控制）
2. 点击 `⋮` → `e.stopPropagation()` 防止触发 `/resume`；在 item 内插入 `.session-menu` 显示「重命名会话」
3. 点击「重命名会话」→ 关闭菜单；将 `.session-label` 内容替换为 `<input class="session-rename-input">`，autofocus + 选中现有 label
4. input 监听：
   - `keydown Enter` → 取值 trim，非空则 POST `/api/sessions/:id/label`，成功后更新 label 文本，失败显示错误并保留 input
   - `keydown Escape` → 取消，恢复原 label 文本
   - `blur` → 视为取消（避免 Enter 失败时丢数据；失败时通过 alert 提示后用户需重新尝试）
5. 点击页面其他位置 → 关闭已打开的菜单（document click 监听）

### 5.4 session_renamed 控制消息处理

```javascript
if (msg.type === 'session_renamed' && msg.sessionId) {
  loadSessionList();
}
```

简单实现：直接刷新整个列表（避免手动同步 DOM 的复杂性）。

## 6. 测试

### 6.1 后端测试（扩展 `tests/access/websocket-server.spec.ts` 或新增）

- `POST /api/sessions/:id/label` 成功 → 200，meta.json 写入 label，`onSessionRenamed` 回调被调用
- 无 token → 401
- 非 owner → 403
- session 不存在 → 404
- 空 label → 400
- 非 POST 方法 → 405

### 6.2 前端测试（扩展 `tests/access/chat-page-sidebar.spec.ts`）

- `renderSessionList` 输出包含 `.session-menu-btn` 和 `data-session-id`
- 点击 `⋮` 不触发 `/resume`（stopPropagation 验证）
- 点击「重命名会话」后 `.session-label` 被替换为 input
- Enter 触发 fetch POST 请求
- Escape 关闭 input 恢复原 label
- 收到 `session_renamed` 消息后调用 `loadSessionList`

## 7. 影响范围

| 文件 | 变更类型 |
|------|----------|
| `src/access/websocket-server.ts` | 新增 POST 路由 + `onSessionRenamed` option |
| `src/server.ts` | 传入 `onSessionRenamed` 回调，调用 `wsServer.sendToSessionKey` |
| `src/access/chat-page.ts` | CSS + renderSessionList + 交互逻辑 + session_renamed 处理 |
| `tests/access/websocket-server.spec.ts` 或新增 | 后端测试 |
| `tests/access/chat-page-sidebar.spec.ts` | 前端测试 |

**不改的文件**：
- `src/core/agent/events.ts`（避免改 AgentEvent union）
- `src/infrastructure/storage/file-storage.ts`（已有 `updateSessionLabel`）

## 8. 错误处理

- 网络失败：input 不关闭，显示错误提示，允许重试或 Esc 取消
- 空字符串：忽略，视为取消
- label 长度限制：100 字符（复用 `/label` 命令的限制）
