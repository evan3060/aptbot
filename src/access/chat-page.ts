/**
 * 部署用最小化聊天页面（vanilla HTML/JS + WebSocket 客户端）。
 * 无需打包器，直接由 websocket-server 的 HTTP handler 服务。
 * 支持：流式文本、工具调用展示、token 认证、自动重连。
 */
export function createChatPageHtml(wsPath: string): string {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<link rel="icon" href="data:,">
<title>aptbot</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: system-ui, -apple-system, "Segoe UI", sans-serif;
    background: #f7f7f8;
    color: #1f2937;
    display: flex;
    flex-direction: row;
    height: 100vh;
  }
  #sidebar {
    width: 260px;
    background: #fff;
    border-right: 1px solid #e5e7eb;
    display: flex;
    flex-direction: column;
    flex-shrink: 0;
  }
  #sidebar-header {
    padding: 12px;
    border-bottom: 1px solid #e5e7eb;
  }
  #new-session-btn {
    width: 100%;
    padding: 8px 12px;
    background: #3b82f6;
    color: #fff;
    border: none;
    border-radius: 6px;
    font-size: 13px;
    cursor: pointer;
  }
  #new-session-btn:hover { background: #2563eb; }
  #session-list {
    flex: 1;
    overflow-y: auto;
    padding: 8px;
  }
  .session-item {
    padding: 8px 10px;
    border-radius: 6px;
    cursor: pointer;
    margin-bottom: 4px;
    font-size: 13px;
  }
  .session-item:hover { background: #f3f4f6; }
  .session-item.active { background: #dbeafe; color: #1e40af; }
  .session-item .session-label {
    font-weight: 500;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .session-item .session-time {
    font-size: 11px;
    color: #9ca3af;
    margin-top: 2px;
  }
  #user-info {
    padding: 12px;
    border-top: 1px solid #e5e7eb;
    font-size: 12px;
    color: #6b7280;
    display: flex;
    align-items: center;
    justify-content: space-between;
  }
  #logout-btn {
    background: none;
    border: 1px solid #d1d5db;
    border-radius: 4px;
    padding: 2px 8px;
    font-size: 11px;
    cursor: pointer;
    color: #6b7280;
  }
  #logout-btn:hover { background: #f3f4f6; }
  #main {
    flex: 1;
    display: flex;
    flex-direction: column;
    min-width: 0;
  }
  header {
    background: #fff;
    border-bottom: 1px solid #e5e7eb;
    padding: 12px 20px;
    display: flex;
    align-items: center;
    justify-content: space-between;
  }
  header h1 { font-size: 16px; font-weight: 600; }
  #status {
    font-size: 12px;
    padding: 4px 10px;
    border-radius: 12px;
    background: #fef3c7;
    color: #92400e;
  }
  #status.connected { background: #d1fae5; color: #065f46; }
  #status.disconnected { background: #fee2e2; color: #991b1b; }
  #messages {
    flex: 1;
    overflow-y: auto;
    padding: 20px;
    max-width: 900px;
    width: 100%;
    margin: 0 auto;
  }
  .msg {
    margin-bottom: 16px;
    padding: 12px 16px;
    border-radius: 8px;
    line-height: 1.6;
    white-space: pre-wrap;
    word-wrap: break-word;
  }
  .msg.user {
    background: #fff;
    border: 1px solid #e5e7eb;
    margin-left: 40px;
  }
  .msg.assistant {
    background: #fff;
    border-left: 3px solid #3b82f6;
  }
  .msg.tool {
    background: #f3f4f6;
    border-left: 3px solid #f59e0b;
    font-family: ui-monospace, "SF Mono", monospace;
    font-size: 13px;
  }
  .msg.tool .tool-result {
    color: #047857;
    margin-top: 4px;
    max-height: 200px;
    overflow-y: auto;
    white-space: pre-wrap;
    word-break: break-all;
  }
  .msg.tool .tool-name { color: #92400e; font-weight: 600; }
  .msg.error {
    background: #fee2e2;
    border-left: 3px solid #dc2626;
    color: #991b1b;
  }
  .msg .label {
    font-size: 11px;
    color: #6b7280;
    margin-bottom: 4px;
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }
  #input-bar {
    background: #fff;
    border-top: 1px solid #e5e7eb;
    padding: 16px 20px;
    max-width: 900px;
    width: 100%;
    margin: 0 auto;
    display: flex;
    gap: 8px;
  }
  #input {
    flex: 1;
    padding: 10px 14px;
    border: 1px solid #d1d5db;
    border-radius: 6px;
    font-size: 14px;
    outline: none;
  }
  #input:focus { border-color: #3b82f6; }
  #send {
    padding: 10px 20px;
    background: #3b82f6;
    color: #fff;
    border: none;
    border-radius: 6px;
    font-size: 14px;
    cursor: pointer;
  }
  #send:disabled { background: #9ca3af; cursor: not-allowed; }
  #working {
    text-align: center;
    padding: 8px;
    color: #6b7280;
    font-size: 13px;
    display: none;
  }
  #working.show { display: block; }
  #working::after {
    content: '';
    display: inline-block;
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: #3b82f6;
    margin-left: 6px;
    animation: pulse 1s infinite;
  }
  @keyframes pulse {
    0%, 100% { opacity: 0.3; }
    50% { opacity: 1; }
  }
  #presence {
    text-align: center;
    padding: 4px;
    color: #6b7280;
    font-size: 12px;
    background: #f9fafb;
    border-top: 1px solid #e5e7eb;
    display: none;
  }
  #presence.show { display: block; }
</style>
</head>
<body>
<div id="sidebar">
  <div id="sidebar-header">
    <button id="new-session-btn">+ 新会话</button>
  </div>
  <div id="session-list"></div>
  <div id="user-info">
    <span id="user-name">匿名用户</span>
    <button id="logout-btn">登出</button>
  </div>
</div>
<div id="main">
<header>
  <h1>aptbot</h1>
  <span id="status">connecting...</span>
</header>
<div id="messages"></div>
<div id="working">assistant working</div>
<div id="presence"></div>
<div id="input-bar">
  <input id="input" type="text" placeholder="type a message... (Enter to send)" autocomplete="off" />
  <button id="send">Send</button>
</div>
</div>
<script>
(function() {
  var messagesEl = document.getElementById('messages');
  var inputEl = document.getElementById('input');
  var sendBtn = document.getElementById('send');
  var statusEl = document.getElementById('status');
  var workingEl = document.getElementById('working');
  var presenceEl = document.getElementById('presence');
  var sessionListEl = document.getElementById('session-list');
  var newSessionBtn = document.getElementById('new-session-btn');
  var userNameEl = document.getElementById('user-name');
  var logoutBtn = document.getElementById('logout-btn');
  var currentAssistantMsg = null;
  var currentAssistantText = '';
  var lastEventSeq = 0;

  function setStatus(text, cls) {
    statusEl.textContent = text;
    statusEl.className = cls || '';
  }

  function scrollBottom() {
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  function appendUserMsg(text) {
    var el = document.createElement('div');
    el.className = 'msg user';
    el.innerHTML = '<div class="label">You</div>' + escapeHtml(text);
    messagesEl.appendChild(el);
    scrollBottom();
  }

  function startAssistantMsg() {
    if (currentAssistantMsg) return;
    currentAssistantMsg = document.createElement('div');
    currentAssistantMsg.className = 'msg assistant';
    currentAssistantMsg.innerHTML = '<div class="label">Assistant</div><div class="text"></div>';
    messagesEl.appendChild(currentAssistantMsg);
    currentAssistantText = '';
    scrollBottom();
  }

  function appendAssistantText(text) {
    startAssistantMsg();
    currentAssistantText += text;
    var textEl = currentAssistantMsg.querySelector('.text');
    if (textEl) textEl.textContent = currentAssistantText;
    scrollBottom();
  }

  function finishAssistantMsg() {
    currentAssistantMsg = null;
    currentAssistantText = '';
  }

  function appendToolMsg(toolName, args, result, success) {
    var el = document.createElement('div');
    el.className = 'msg tool';
    var html = '<div class="label">Tool</div>';
    html += '<div><span class="tool-name">' + escapeHtml(toolName) + '</span>';
    if (args) html += ' <code>' + escapeHtml(args) + '</code>';
    html += '</div>';
    if (result !== null && result !== undefined) {
      html += '<div class="tool-result">→ ' + escapeHtml(result) + (success === false ? ' [failed]' : '') + '</div>';
    }
    el.innerHTML = html;
    messagesEl.appendChild(el);
    scrollBottom();
  }

  function appendErrorMsg(text) {
    var el = document.createElement('div');
    el.className = 'msg error';
    el.innerHTML = '<div class="label">Error</div>' + escapeHtml(text);
    messagesEl.appendChild(el);
    scrollBottom();
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function(c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function setWorking(on) {
    if (on) { workingEl.classList.add('show'); sendBtn.disabled = false; }
    else { workingEl.classList.remove('show'); sendBtn.disabled = false; }
  }

  // 从 URL 或 sessionStorage 读取 token（Task 1: token 记忆与自动携带）
  // 逻辑与 src/access/chat-page-token.ts 的 resolveToken 保持一致
  // 修改此处需同步修改 chat-page-token.ts
  var TOKEN_KEY = 'aptbot:token';
  var urlToken = new URLSearchParams(window.location.search).get('token');
  var token = null;
  if (urlToken) {
    token = urlToken;  // 连接成功后才存入 sessionStorage（见 ws.onopen）
  } else {
    token = sessionStorage.getItem(TOKEN_KEY) || null;
  }

  // Task 6: sessionId 持久化（localStorage，跨刷新/重连恢复）
  // 逻辑与 src/access/chat-page-session.ts 的 resolveSessionId 保持一致
  // 修改此处需同步修改 chat-page-session.ts
  var SESSION_ID_KEY = 'aptbot:sessionId';
  var urlSessionId = new URLSearchParams(window.location.search).get('session');
  var sessionId = null;
  if (urlSessionId) {
    sessionId = urlSessionId;
    try { localStorage.setItem(SESSION_ID_KEY, sessionId); } catch (e) { /* localStorage 不可用降级 */ }
  } else {
    sessionId = localStorage.getItem(SESSION_ID_KEY) || null;
  }
  if (!sessionId) {
    // 生成新 UUID（浏览器原生 crypto.randomUUID，不支持时降级）
    sessionId = (typeof crypto !== 'undefined' && crypto.randomUUID)
      ? crypto.randomUUID()
      : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
          var r = (Math.random() * 16) | 0;
          var v = c === 'x' ? r : (r & 0x3) | 0x8;
          return v.toString(16);
        });
    try { localStorage.setItem(SESSION_ID_KEY, sessionId); } catch (e) { /* localStorage 不可用降级 */ }
  }

  function buildWsUrl() {
    var proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    var base = proto + '//' + location.host + '${wsPath}';
    var params = new URLSearchParams();
    if (token) params.set('token', token);
    if (sessionId) params.set('session', sessionId);
    // Task 6 I1 fix: 总是带 lastEventSeq（包括 0），确保 session_changed 重连时
    // 服务端能 replay 新 sessionKey 的 ring buffer（/new 后的确认 turn 事件）
    params.set('lastEventSeq', String(lastEventSeq));
    var qs = params.toString();
    return qs ? base + '?' + qs : base;
  }

  // 无 token 时显示鉴权提示并禁止发送
  if (!token) {
    appendErrorMsg('Authentication required.');
    sendBtn.disabled = true;
    inputEl.disabled = true;
    inputEl.placeholder = 'authentication required';
  }

  var ws = null;
  var reconnectDelay = 1000;

  function connect() {
    ws = new WebSocket(buildWsUrl());

    ws.onopen = function() {
      setStatus('connected', 'connected');
      reconnectDelay = 1000;
      // 连接成功后才存入 sessionStorage，避免错误 token 被持久化
      if (token) {
        try { sessionStorage.setItem(TOKEN_KEY, token); } catch (e) { /* sessionStorage 不可用时降级 */ }
      }
    };

    ws.onmessage = function(ev) {
      try {
        var msg = JSON.parse(ev.data);
        handleServerMessage(msg);
      } catch (e) {
        // ignore malformed
      }
    };

    ws.onclose = function() {
      setStatus('disconnected', 'disconnected');
      setWorking(false);
      // 自动重连（指数退避，最大 10s）
      setTimeout(function() {
        reconnectDelay = Math.min(reconnectDelay * 1.5, 10000);
        connect();
      }, reconnectDelay);
    };

    ws.onerror = function() {
      // onclose 会处理
    };
  }

  function handleServerMessage(msg) {
    // Task 10: user_identified 事件 — 更新侧边栏底部用户信息
    if (msg.type === 'user_identified') {
      if (userNameEl) {
        userNameEl.textContent = msg.username || '匿名用户';
      }
      // 收到身份后加载 session 列表
      loadSessionList();
      return;
    }
    // Task 6: session_changed 事件 — 更新 localStorage 并重连到新 session
    if (msg.type === 'session_changed' && msg.sessionId) {
      try { localStorage.setItem(SESSION_ID_KEY, msg.sessionId); } catch (e) { /* localStorage 不可用降级 */ }
      sessionId = msg.sessionId;
      lastEventSeq = 0;  // 新 session 重置 seq
      // Task 6 M2 fix: 关闭旧连接并清理所有监听器，防止缓冲帧触发递归 session_changed
      if (ws) {
        ws.onclose = null;
        ws.onmessage = null;
        ws.onerror = null;
        ws.close();
      }
      connect();
      // Task 10: 切换 session 后刷新侧边栏高亮
      loadSessionList();
      return;
    }
    // Task 9: presence 事件 — 更新在线人数指示器（N>1 时显示，N<=1 时隐藏）
    if (msg.type === 'presence') {
      if (presenceEl) {
        if (msg.onlineCount > 1) {
          presenceEl.textContent = msg.onlineCount + ' 人在线';
          presenceEl.classList.add('show');
        } else {
          presenceEl.classList.remove('show');
        }
      }
      return;
    }
    if (msg.type === 'event' && msg.event) {
      if (typeof msg.seq === 'number' && msg.seq > lastEventSeq) lastEventSeq = msg.seq;
      var e = msg.event;
      switch (e.type) {
        case 'agent_start':
          setWorking(true);
          break;
        case 'turn_start':
          setWorking(true);
          break;
        case 'message_start':
          startAssistantMsg();
          break;
        case 'message_delta':
          appendAssistantText(e.text || '');
          break;
        case 'message_end':
          finishAssistantMsg();
          break;
        case 'tool_call_start':
          // 工具调用开始，暂存名称
          window._currentTool = { name: e.toolName, id: e.toolCallId, args: '' };
          break;
        case 'tool_call_delta':
          if (window._currentTool) window._currentTool.args += e.arguments || '';
          break;
        case 'tool_call_end':
          if (window._currentTool) {
            appendToolMsg(window._currentTool.name, window._currentTool.args, null, true);
            window._pendingToolId = window._currentTool.id;
            window._currentTool = null;
          }
          break;
        case 'tool_result':
          // 找到最近的同名工具 msg 追加结果（简化：直接追加新 msg）
          if (window._pendingToolId === e.toolCallId) {
            var lastTool = messagesEl.querySelector('.msg.tool:last-child');
            if (lastTool) {
              var r = document.createElement('div');
              r.className = 'tool-result';
              var summaryText = e.summary || '';
              // 截断超长工具结果（最多 800 字符）
              if (summaryText.length > 800) {
                summaryText = summaryText.slice(0, 800) + '\\n... (' + summaryText.length + ' chars total, truncated)';
              }
              r.textContent = '→ ' + summaryText + (e.success === false ? ' [failed]' : '');
              lastTool.appendChild(r);
            }
            window._pendingToolId = null;
          } else {
            appendToolMsg('tool', '', e.summary, e.success);
          }
          break;
        case 'turn_end':
          finishAssistantMsg();
          setWorking(false);
          break;
        case 'agent_end':
          finishAssistantMsg();
          setWorking(false);
          break;
        case 'error':
          appendErrorMsg(e.message || 'unknown error');
          setWorking(false);
          break;
      }
    } else if (msg.type === 'resync_required') {
      // 服务端缓冲已丢失，重置状态
      finishAssistantMsg();
      setWorking(false);
      lastEventSeq = 0;
    } else if (msg.type === 'error') {
      appendErrorMsg(msg.message || msg.code || 'server error');
    }
  }

  function send() {
    var text = inputEl.value.trim();
    if (!text || !ws || ws.readyState !== WebSocket.OPEN) return;
    appendUserMsg(text);
    ws.send(JSON.stringify({ type: 'message', content: text }));
    inputEl.value = '';
    setWorking(true);
  }

  // Task 10: 发送 slash 命令（/new、/resume <id>）— 走 WebSocket message 协议
  function sendSlashCommand(cmd) {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify({ type: 'message', content: cmd }));
  }

  // Task 10: 格式化相对时间
  function formatRelativeTime(ts) {
    if (!ts) return '';
    var now = Date.now();
    var diff = now - ts;
    if (diff < 60000) return '刚刚';
    if (diff < 3600000) return Math.floor(diff / 60000) + ' 分钟前';
    if (diff < 86400000) return Math.floor(diff / 3600000) + ' 小时前';
    return Math.floor(diff / 86400000) + ' 天前';
  }

  // Task 10: 渲染 session 列表到侧边栏
  function renderSessionList(sessions) {
    if (!sessionListEl) return;
    sessionListEl.innerHTML = '';
    if (!sessions || sessions.length === 0) {
      sessionListEl.innerHTML = '<div style="padding:12px;color:#9ca3af;font-size:12px;text-align:center;">暂无会话</div>';
      return;
    }
    sessions.forEach(function(s) {
      var item = document.createElement('div');
      item.className = 'session-item';
      if (s.id === sessionId) item.classList.add('active');
      var label = s.label || (s.id || '').slice(0, 8);
      var time = formatRelativeTime(s.updatedAt || s.createdAt);
      item.innerHTML = '<div class="session-label">' + escapeHtml(label) + '</div>'
                     + '<div class="session-time">' + escapeHtml(time) + '</div>';
      item.addEventListener('click', function() {
        if (s.id === sessionId) return;
        // 切换到该 session
        sendSlashCommand('/resume ' + s.id);
      });
      sessionListEl.appendChild(item);
    });
  }

  // Task 10: 从 /api/sessions 加载当前用户的 session 列表
  function loadSessionList() {
    if (!token) {
      renderSessionList([]);
      return;
    }
    fetch('/api/sessions?token=' + encodeURIComponent(token))
      .then(function(res) { return res.json(); })
      .then(function(data) {
        if (data && data.sessions) {
          renderSessionList(data.sessions);
        }
      })
      .catch(function() { /* 加载失败静默处理 */ });
  }

  sendBtn.addEventListener('click', send);
  inputEl.addEventListener('keydown', function(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  });

  // Task 10: 新会话按钮 — 发送 /new 命令
  if (newSessionBtn) {
    newSessionBtn.addEventListener('click', function() {
      sendSlashCommand('/new');
    });
  }

  // Task 10: 登出按钮 — 清除 token 并刷新
  if (logoutBtn) {
    logoutBtn.addEventListener('click', function() {
      try { sessionStorage.removeItem(TOKEN_KEY); } catch (e) { /* ignore */ }
      try { localStorage.removeItem(SESSION_ID_KEY); } catch (e) { /* ignore */ }
      window.location.href = window.location.pathname;
    });
  }

  connect();
})();
</script>
</body>
</html>`;
}
