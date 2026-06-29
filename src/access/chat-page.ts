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
    display: flex;
    align-items: center;
    position: relative;
  }
  .session-item:hover { background: #f3f4f6; }
  .session-item.active { background: #dbeafe; color: #1e40af; }
  .session-item.menu-open { z-index: 100; }
  .session-item .session-main {
    flex: 1;
    min-width: 0;
  }
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
  .session-item .session-menu-btn {
    background: none;
    border: none;
    cursor: pointer;
    color: #9ca3af;
    font-size: 16px;
    line-height: 1;
    padding: 2px 6px;
    flex-shrink: 0;
    opacity: 0;
    border-radius: 3px;
    align-self: center;
  }
  .session-item:hover .session-menu-btn { opacity: 1; }
  .session-item .session-menu-btn:hover { background: #e5e7eb; color: #374151; }
  .session-menu {
    position: absolute;
    right: 4px;
    top: 30px;
    background: #fff;
    border: 1px solid #e5e7eb;
    border-radius: 4px;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
    z-index: 10;
    min-width: 120px;
    padding: 4px 0;
  }
  .session-menu-item {
    padding: 6px 12px;
    cursor: pointer;
    font-size: 12px;
    color: #374151;
  }
  .session-menu-item:hover { background: #f3f4f6; }
  .session-rename-input {
    width: 100%;
    padding: 2px 4px;
    border: 1px solid #3b82f6;
    border-radius: 3px;
    font-size: 13px;
    font-weight: 500;
    outline: none;
    box-sizing: border-box;
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
  #user-name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    flex: 1;
    margin-right: 8px;
  }
  #logout-btn, #auth-btn {
    background: none;
    border: 1px solid #d1d5db;
    border-radius: 4px;
    padding: 2px 8px;
    font-size: 11px;
    cursor: pointer;
    color: #6b7280;
    flex-shrink: 0;
  }
  #logout-btn:hover, #auth-btn:hover { background: #f3f4f6; }
  .hidden { display: none !important; }
  /* auth modal */
  .modal-overlay {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.5);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 1000;
  }
  .modal-content {
    background: #fff;
    border-radius: 8px;
    padding: 24px;
    width: 360px;
    max-width: 90vw;
    box-shadow: 0 10px 25px rgba(0, 0, 0, 0.15);
  }
  .modal-content h2 {
    font-size: 16px;
    font-weight: 600;
    margin-bottom: 16px;
  }
  .modal-content .form-group {
    margin-bottom: 12px;
  }
  .modal-content label {
    display: block;
    font-size: 12px;
    color: #6b7280;
    margin-bottom: 4px;
  }
  .modal-content input {
    width: 100%;
    padding: 8px 10px;
    border: 1px solid #d1d5db;
    border-radius: 4px;
    font-size: 13px;
    outline: none;
  }
  .modal-content input:focus { border-color: #3b82f6; }
  .modal-content .submit-btn {
    width: 100%;
    padding: 9px;
    background: #3b82f6;
    color: #fff;
    border: none;
    border-radius: 4px;
    font-size: 13px;
    cursor: pointer;
    margin-top: 4px;
  }
  .modal-content .submit-btn:hover { background: #2563eb; }
  .modal-content .submit-btn:disabled { background: #9ca3af; cursor: not-allowed; }
  .modal-content .switch-link {
    text-align: center;
    margin-top: 12px;
    font-size: 12px;
    color: #6b7280;
  }
  .modal-content .switch-link a {
    color: #3b82f6;
    cursor: pointer;
    text-decoration: underline;
  }
  #auth-error {
    color: #991b1b;
    background: #fee2e2;
    border-radius: 4px;
    padding: 6px 10px;
    font-size: 12px;
    margin-bottom: 8px;
    display: none;
  }
  #auth-error.show { display: block; }
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
    <span id="user-name">未登录</span>
    <button id="auth-btn">登录</button>
    <button id="logout-btn" class="hidden">登出</button>
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
<div id="auth-modal" class="modal-overlay hidden">
  <div class="modal-content">
    <div id="auth-error"></div>
    <form id="login-form">
      <h2>登录</h2>
      <div class="form-group">
        <label for="login-username">用户名</label>
        <input id="login-username" type="text" autocomplete="username" required />
      </div>
      <div class="form-group">
        <label for="login-password">密码</label>
        <input id="login-password" type="password" autocomplete="current-password" required />
      </div>
      <button type="submit" class="submit-btn">登录</button>
      <div class="switch-link">还没有账号？<a id="to-register">注册</a></div>
    </form>
    <form id="register-form" class="hidden">
      <h2>注册</h2>
      <div class="form-group">
        <label for="reg-username">用户名</label>
        <input id="reg-username" type="text" autocomplete="username" required />
      </div>
      <div class="form-group">
        <label for="reg-password">密码</label>
        <input id="reg-password" type="password" autocomplete="new-password" required />
      </div>
      <div class="form-group">
        <label for="reg-password2">确认密码</label>
        <input id="reg-password2" type="password" autocomplete="new-password" required />
      </div>
      <button type="submit" class="submit-btn">注册</button>
      <div class="switch-link">已有账号？<a id="to-login">登录</a></div>
    </form>
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
  var authBtn = document.getElementById('auth-btn');
  var authModal = document.getElementById('auth-modal');
  var authErrorEl = document.getElementById('auth-error');
  var loginForm = document.getElementById('login-form');
  var registerForm = document.getElementById('register-form');
  var toRegisterLink = document.getElementById('to-register');
  var toLoginLink = document.getElementById('to-login');
  var currentAssistantMsg = null;
  var currentAssistantText = '';
  var lastEventSeq = 0;
  // 验收修复：保存当前连接的 clientId，用于区分自己发送的消息（避免重复渲染）
  var myClientId = '';

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
    sessionId = generateUUID();
    try { localStorage.setItem(SESSION_ID_KEY, sessionId); } catch (e) { /* localStorage 不可用降级 */ }
  }

  function generateUUID() {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
      var r = (Math.random() * 16) | 0;
      var v = c === 'x' ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
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

  // 状态控制：根据 token 更新侧边栏底部 UI
  // - 有 token：显示用户名（收到 user_identified 后填充）+ 登出按钮
  // - 无 token：显示"未登录" + 登录按钮，不连接 WS
  function updateAuthUI(authenticated) {
    if (authenticated) {
      if (userNameEl) userNameEl.textContent = userNameEl.textContent === '未登录' ? '加载中...' : userNameEl.textContent;
      if (authBtn) authBtn.classList.add('hidden');
      if (logoutBtn) logoutBtn.classList.remove('hidden');
      if (inputEl) inputEl.disabled = false;
      if (inputEl) inputEl.placeholder = 'type a message... (Enter to send)';
      if (sendBtn) sendBtn.disabled = false;
    } else {
      if (userNameEl) userNameEl.textContent = '未登录';
      if (authBtn) authBtn.classList.remove('hidden');
      if (logoutBtn) logoutBtn.classList.add('hidden');
      if (inputEl) inputEl.disabled = true;
      if (inputEl) inputEl.placeholder = '请先登录';
      if (sendBtn) sendBtn.disabled = true;
    }
  }

  // 初始化 UI 状态
  updateAuthUI(!!token);
  // 验收修复：未登录时自动弹出登录框，强制用户登录后才能聊天
  if (!token) {
    showAuthModal('login');
  }

  // ===== Auth Modal =====
  function showAuthModal(mode) {
    if (!authModal) return;
    authErrorEl.classList.remove('show');
    authErrorEl.textContent = '';
    if (mode === 'register') {
      loginForm.classList.add('hidden');
      registerForm.classList.remove('hidden');
    } else {
      registerForm.classList.add('hidden');
      loginForm.classList.remove('hidden');
    }
    authModal.classList.remove('hidden');
  }

  function hideAuthModal() {
    if (!authModal) return;
    authModal.classList.add('hidden');
    // 清空表单
    loginForm.reset();
    registerForm.reset();
    authErrorEl.classList.remove('show');
    authErrorEl.textContent = '';
  }

  function showAuthError(msg) {
    if (!authErrorEl) return;
    authErrorEl.textContent = msg;
    authErrorEl.classList.add('show');
  }

  // 共享：恢复到用户最近 session（刷新/重连后自动对齐 agent 内部 sessionId）
  // callback(sessionIdChanged: boolean) 在恢复完成后调用
  function restoreSession(callback) {
    if (!token) { callback(false); return; }
    fetch('/api/sessions?token=' + encodeURIComponent(token))
      .then(function(res) { return res.json(); })
      .then(function(data) {
        var changed = false;
        if (data && data.sessions && data.sessions.length > 0) {
          var currentBelongs = data.sessions.some(function(s) { return s.id === sessionId; });
          if (!currentBelongs) {
            // 当前 sessionId 不属于用户（可能是前端生成的随机 UUID），切换到最近 session
            var latest = data.sessions[0];
            sessionId = latest.id;
            try { localStorage.setItem(SESSION_ID_KEY, sessionId); } catch (e) { /* ignore */ }
            changed = true;
          }
        }
        callback(changed);
      })
      .catch(function() { callback(false); });
  }

  // 登录成功后：持久化 token → 更新 UI → 恢复最近 session → 连接 WS
  function onAuthSuccess(newToken, username) {
    token = newToken;
    try { sessionStorage.setItem(TOKEN_KEY, token); } catch (e) { /* sessionStorage 不可用 */ }
    if (userNameEl && username) userNameEl.textContent = username;
    updateAuthUI(true);
    hideAuthModal();
    lastEventSeq = 0;
    restoreSession(function() {
      connect();
      loadSessionList();
    });
  }

  if (authBtn) {
    authBtn.addEventListener('click', function() { showAuthModal('login'); });
  }
  if (toRegisterLink) {
    toRegisterLink.addEventListener('click', function(e) { e.preventDefault(); showAuthModal('register'); });
  }
  if (toLoginLink) {
    toLoginLink.addEventListener('click', function(e) { e.preventDefault(); showAuthModal('login'); });
  }
  // 点击 modal 遮罩关闭
  if (authModal) {
    authModal.addEventListener('click', function(e) {
      if (e.target === authModal) hideAuthModal();
    });
  }
  // ESC 关闭
  document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape' && authModal && !authModal.classList.contains('hidden')) {
      hideAuthModal();
    }
  });

  // 登录表单提交
  if (loginForm) {
    loginForm.addEventListener('submit', function(e) {
      e.preventDefault();
      var username = document.getElementById('login-username').value.trim();
      var password = document.getElementById('login-password').value;
      if (!username || !password) return;
      fetch('/api/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username: username, password: password }),
      }).then(function(res) {
        return res.json().then(function(d) { return { status: res.status, data: d }; });
      }).then(function(r) {
        if (r.status === 200 && r.data.token) {
          onAuthSuccess(r.data.token, r.data.username);
        } else {
          showAuthError(r.data.error || '登录失败，请检查用户名和密码');
        }
      }).catch(function() { showAuthError('网络错误，请重试'); });
    });
  }

  // 注册表单提交
  if (registerForm) {
    registerForm.addEventListener('submit', function(e) {
      e.preventDefault();
      var username = document.getElementById('reg-username').value.trim();
      var password = document.getElementById('reg-password').value;
      var password2 = document.getElementById('reg-password2').value;
      if (!username || !password) return;
      if (password !== password2) {
        showAuthError('两次输入的密码不一致');
        return;
      }
      if (password.length < 6) {
        showAuthError('密码至少 6 位');
        return;
      }
      fetch('/api/register', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username: username, password: password }),
      }).then(function(res) {
        return res.json().then(function(d) { return { status: res.status, data: d }; });
      }).then(function(r) {
        if (r.status === 200 && r.data.token) {
          // 注册成功 → 自动登录
          onAuthSuccess(r.data.token, r.data.username);
        } else if (r.status === 409) {
          showAuthError('用户名已存在');
        } else {
          showAuthError(r.data.error || '注册失败');
        }
      }).catch(function() { showAuthError('网络错误，请重试'); });
    });
  }

  var ws = null;
  var reconnectDelay = 1000;
  // 防竞态：仅接受最新的 loadHistory 请求结果（onopen 与 user_identified 可能并发触发）
  var historyRequestId = 0;
  // 验收修复：loadHistory 进行中时忽略 ring buffer replay 事件，避免重复渲染/闪烁
  var historyLoading = false;

  // 刷新/切换 session 后从 JSONL 加载历史消息（ring buffer 仅作实时增量）
  function loadHistory(sid) {
    if (!token || !sid) return;
    var reqId = ++historyRequestId;
    historyLoading = true;
    fetch('/api/sessions/' + sid + '/messages?token=' + encodeURIComponent(token))
      .then(function(res) {
        if (res.status === 404) {
          // 新 session 无历史文件 — 清空消息区
          if (reqId !== historyRequestId) return;
          messagesEl.innerHTML = '';
          currentAssistantMsg = null;
          currentAssistantText = '';
          return null;
        }
        if (!res.ok) {
          // 401/403 — 不清空，让错误处理器接管
          return null;
        }
        return res.json();
      })
      .then(function(data) {
        // 仅接受最新的请求结果，防止旧请求覆盖新数据
        if (reqId !== historyRequestId) return;
        historyLoading = false;
        if (!data || !data.messages) return;
        messagesEl.innerHTML = '';
        currentAssistantMsg = null;
        currentAssistantText = '';
        data.messages.forEach(function(entry) {
          if (entry.type !== 'message') return;
          var msg = entry.message;
          if (!msg) return;
          var content = typeof msg.content === 'string' ? msg.content : '';
          if (msg.role === 'user') {
            appendUserMsg(content);
          } else if (msg.role === 'assistant') {
            var el = document.createElement('div');
            el.className = 'msg assistant';
            el.innerHTML = '<div class="label">Assistant</div>' + escapeHtml(content);
            messagesEl.appendChild(el);
          } else if (msg.role === 'tool') {
            appendToolMsg('tool', '', content, true);
          }
        });
        scrollBottom();
      })
      .catch(function() { historyLoading = false; /* 加载失败静默处理 */ });
  }

  function connect() {
    // 无 token 时不连接 WS（未登录状态）
    if (!token) {
      setStatus('未登录', 'disconnected');
      return;
    }
    ws = new WebSocket(buildWsUrl());

    ws.onopen = function() {
      setStatus('connected', 'connected');
      reconnectDelay = 1000;
      // 连接成功后才存入 sessionStorage，避免错误 token 被持久化
      if (token) {
        try { sessionStorage.setItem(TOKEN_KEY, token); } catch (e) { /* sessionStorage 不可用时降级 */ }
      }
      // 验收修复：重连后立即启用输入框（兜底，user_identified 也会启用）
      // 新会话切换时输入框被禁用，重连后需恢复
      if (token && inputEl) {
        inputEl.disabled = false;
        inputEl.placeholder = 'type a message... (Enter to send)';
      }
      if (token && sendBtn) sendBtn.disabled = false;
      // lastEventSeq=0 表示全新连接（页面刷新或 session 切换），需从 JSONL 加载完整历史
      // 非 0 时（WS 重连）仅靠 ring buffer replay 补齐增量即可，避免清屏闪烁
      if (lastEventSeq === 0) {
        loadHistory(sessionId);
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
      // 自动重连（指数退避，最大 10s）— 仅当仍有 token 时
      if (token) {
        setTimeout(function() {
          reconnectDelay = Math.min(reconnectDelay * 1.5, 10000);
          connect();
        }, reconnectDelay);
      }
    };

    ws.onerror = function() {
      // onclose 会处理
    };
  }

  function handleServerMessage(msg) {
    // Task 10: user_identified 事件 — 更新侧边栏底部用户信息 + 对齐 agent sessionId
    if (msg.type === 'user_identified') {
      if (userNameEl) {
        userNameEl.textContent = msg.username || '已登录';
      }
      updateAuthUI(true);
      // 验收修复：保存 clientId，用于区分自己发送的消息
      if (msg.clientId) myClientId = msg.clientId;
      // 验收修复：接收 agent 真实 sessionId，对齐 localStorage
      // 解决前端随机 UUID 与 agent 内部 sessionId 不一致导致历史查询为空的问题
      if (msg.sessionId && msg.sessionId !== sessionId) {
        sessionId = msg.sessionId;
        try { localStorage.setItem(SESSION_ID_KEY, sessionId); } catch (e) { /* ignore */ }
        // 验收修复：sessionId 变化时必须重连 WS，对齐服务器端 state.sessionKey
        // 否则 sendToSessionKey(oldKey, ...) 会发送到旧 sessionKey，前端收不到 session_changed
        lastEventSeq = 0;
        if (ws) {
          ws.onclose = null;
          ws.onmessage = null;
          ws.onerror = null;
          ws.close();
        }
        connect();
        loadSessionList();
        return;
      }
      // 全新连接时加载历史（lastEventSeq > 0 表示 WS 重连，ring buffer 已补齐增量）
      if (lastEventSeq === 0) {
        loadHistory(sessionId);
      }
      loadSessionList();
      return;
    }
    // session_ownership_mismatch 自愈：清理 localStorage sessionId → 生成新 UUID → 重连
    if (msg.type === 'error' && msg.code === 'session_ownership_mismatch') {
      console.warn('session ownership mismatch, regenerating sessionId');
      try { localStorage.removeItem(SESSION_ID_KEY); } catch (e) { /* ignore */ }
      sessionId = generateUUID();
      try { localStorage.setItem(SESSION_ID_KEY, sessionId); } catch (e) { /* ignore */ }
      lastEventSeq = 0;
      // 关闭旧连接并重连
      if (ws) {
        ws.onclose = null;
        ws.onmessage = null;
        ws.onerror = null;
        ws.close();
      }
      connect();
      return;
    }
    // auth_failed：token 失效，回到未登录状态
    if (msg.type === 'error' && msg.code === 'auth_failed') {
      token = null;
      try { sessionStorage.removeItem(TOKEN_KEY); } catch (e) { /* ignore */ }
      updateAuthUI(false);
      setStatus('未登录', 'disconnected');
      if (ws) { ws.onclose = null; ws.close(); }
      return;
    }
    // Task 6: session_changed 事件 — 更新 localStorage 并重连到新 session
    if (msg.type === 'session_changed' && msg.sessionId) {
      try { localStorage.setItem(SESSION_ID_KEY, msg.sessionId); } catch (e) { /* localStorage 不可用降级 */ }
      sessionId = msg.sessionId;
      lastEventSeq = 0;  // 新 session 重置 seq
      // 验收修复：立即清空消息区（新 session 无历史，避免 loadHistory 异步延迟期间显示旧消息）
      messagesEl.innerHTML = '';
      currentAssistantMsg = null;
      currentAssistantText = '';
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
    // 会话重命名：其他客户端重命名后广播的控制消息，刷新侧边栏
    if (msg.type === 'session_renamed' && msg.sessionId) {
      loadSessionList();
      return;
    }
    // Task 9: presence 事件 — 更新在线人数指示器（N>1 时显示，N<=1 时隐藏）
    if (msg.type === 'presence') {
      if (presenceEl) {
        if (msg.onlineCount > 1) {
          presenceEl.textContent = msg.onlineCount + ' 个客户端在线';
          presenceEl.classList.add('show');
        } else {
          presenceEl.classList.remove('show');
        }
      }
      return;
    }
    if (msg.type === 'event' && msg.event) {
      // 验收修复：loadHistory 进行中时忽略事件渲染（避免 ring buffer replay 重复渲染/闪烁）
      if (historyLoading) return;
      if (typeof msg.seq === 'number' && msg.seq > lastEventSeq) lastEventSeq = msg.seq;
      var e = msg.event;
      switch (e.type) {
        case 'agent_start':
          setWorking(true);
          break;
        case 'turn_start':
          setWorking(true);
          break;
        case 'user_message':
          // 验收修复：跨客户端同步用户消息
          // 跳过自己发送的消息（已在 send() 中本地渲染），仅渲染其他客户端的消息
          if (e.senderId !== myClientId) {
            appendUserMsg(e.text || '');
          }
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
          // turn 结束后刷新侧边栏 session 列表（新 session 创建/更新后立即可见）
          loadSessionList();
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
    // 验收修复：未登录时弹出登录框，阻止发送
    if (!token) {
      showAuthModal('login');
      return;
    }
    var text = inputEl.value.trim();
    if (!text || !ws || ws.readyState !== WebSocket.OPEN) return;
    appendUserMsg(text);
    ws.send(JSON.stringify({ type: 'message', content: text }));
    inputEl.value = '';
    setWorking(true);
  }

  // Task 10: 发送 slash 命令（/new、/resume <id>）— 走 WebSocket message 协议
  function sendSlashCommand(cmd) {
    // 验收修复：未登录时弹出登录框，阻止发送
    if (!token) {
      showAuthModal('login');
      return;
    }
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
      item.setAttribute('data-session-id', s.id || '');
      if (s.id === sessionId) item.classList.add('active');
      var label = s.label || s.preview || (s.id || '').slice(0, 8);
      var time = formatRelativeTime(s.updatedAt || s.createdAt);
      var mainEl = document.createElement('div');
      mainEl.className = 'session-main';
      mainEl.innerHTML = '<div class="session-label">' + escapeHtml(label) + '</div>'
                       + '<div class="session-time">' + escapeHtml(time) + '</div>';
      item.appendChild(mainEl);
      // 3-dot 菜单按钮
      var menuBtn = document.createElement('button');
      menuBtn.className = 'session-menu-btn';
      menuBtn.title = '更多操作';
      menuBtn.textContent = '⋮';
      menuBtn.addEventListener('click', function(e) {
        e.stopPropagation();
        showSessionMenu(item, s, label);
      });
      item.appendChild(menuBtn);
      item.addEventListener('click', function() {
        if (s.id === sessionId) return;
        // 切换到该 session
        sendSlashCommand('/resume ' + s.id);
      });
      sessionListEl.appendChild(item);
    });
  }

  // 在 session item 上显示操作菜单
  function showSessionMenu(item, session, currentLabel) {
    // 移除已有的菜单和 menu-open 标记
    var existing = sessionListEl.querySelector('.session-menu');
    if (existing) existing.remove();
    var prevOpen = sessionListEl.querySelector('.session-item.menu-open');
    if (prevOpen) prevOpen.classList.remove('menu-open');
    // 标记当前 item 为 menu-open，提升 z-index 防止被相邻 item 遮挡
    item.classList.add('menu-open');
    var menu = document.createElement('div');
    menu.className = 'session-menu';
    var renameItem = document.createElement('div');
    renameItem.className = 'session-menu-item';
    renameItem.textContent = '重命名会话';
    renameItem.addEventListener('click', function(e) {
      e.stopPropagation();
      menu.remove();
      item.classList.remove('menu-open');
      startRenameSession(item, session.id, currentLabel);
    });
    menu.appendChild(renameItem);
    item.appendChild(menu);
    // 点击页面其他位置关闭菜单
    var closeHandler = function(e) {
      if (!menu.contains(e.target)) {
        menu.remove();
        item.classList.remove('menu-open');
        document.removeEventListener('click', closeHandler);
      }
    };
    setTimeout(function() { document.addEventListener('click', closeHandler); }, 0);
  }

  // 启动 inline 重命名：将 session-label 替换为 input
  function startRenameSession(item, sid, currentLabel) {
    var labelEl = item.querySelector('.session-label');
    if (!labelEl) return;
    var originalLabel = currentLabel;
    var input = document.createElement('input');
    input.className = 'session-rename-input';
    input.type = 'text';
    input.value = currentLabel;
    input.maxLength = 100;
    labelEl.innerHTML = '';
    labelEl.appendChild(input);
    input.focus();
    input.select();
    var restored = false;
    function restoreLabel(text) {
      if (restored) return;
      restored = true;
      labelEl.innerHTML = '';
      labelEl.textContent = text;
    }
    input.addEventListener('keydown', function(e) {
      if (e.key === 'Enter') {
        e.preventDefault();
        var newLabel = input.value.trim();
        if (!newLabel || newLabel === originalLabel) {
          restoreLabel(originalLabel);
          return;
        }
        // POST 重命名请求
        fetch('/api/sessions/' + encodeURIComponent(sid) + '/label?token=' + encodeURIComponent(token), {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ label: newLabel }),
        })
          .then(function(res) { return res.json(); })
          .then(function(data) {
            if (data && data.ok) {
              restoreLabel(data.label || newLabel);
              // 更新 originalLabel 以防后续 Esc 误恢复
              item.dataset.originalLabel = data.label || newLabel;
              loadSessionList();
            } else {
              alert('重命名失败：' + (data && data.error ? data.error : '未知错误'));
              restoreLabel(originalLabel);
            }
          })
          .catch(function(err) {
            alert('重命名失败：' + String(err));
            restoreLabel(originalLabel);
          });
      } else if (e.key === 'Escape') {
        e.preventDefault();
        restoreLabel(originalLabel);
      }
    });
    input.addEventListener('blur', function() {
      // blur 视为取消，恢复原 label
      restoreLabel(originalLabel);
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

  // Task 10: 新会话按钮 — 立即清空 + 发送 /new 命令
  // 验收修复：点击时即时清空页面并禁用输入框，防止切换完成前发送消息到旧 session
  // session_changed 到达后重连并启用输入框
  if (newSessionBtn) {
    newSessionBtn.addEventListener('click', function() {
      // 即时反馈：立即清空消息区
      messagesEl.innerHTML = '';
      currentAssistantMsg = null;
      currentAssistantText = '';
      setWorking(false);
      // 禁用输入框，防止在 session 切换完成前发送消息到旧 session
      if (inputEl) {
        inputEl.disabled = true;
        inputEl.placeholder = '正在创建新会话...';
      }
      if (sendBtn) sendBtn.disabled = true;
      // 发送 /new 命令，服务器创建新 session 后推送 session_changed
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
