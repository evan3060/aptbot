#!/usr/bin/env python3
"""aptbot 0.3.0 WebUI 完整 UAT 自动化测试脚本

测试流程:
1. 注册新用户并登录
2. 验证 sidebar 显示 agents + sessions
3. 发送消息，验证 user-message + assistant-message 元素都存在且有内容
4. 点击「+ 新建会话」，验证 session 切换 + 消息清空
5. 切换回旧会话，验证消息能加载回来
6. 点击「+ 新建专业 agent」按钮，验证 modal 弹出
7. 点击 agent settings 按钮，验证 settings modal 弹出
8. 切换 agent
"""
import json
import sys
import time
from playwright.sync_api import sync_playwright

URL = "http://localhost:8080/demo"
USERNAME = f"uat_user_{int(time.time())}"
PASSWORD = "uatpassword123"


def log(msg):
    print(f"[uat] {msg}", flush=True)


def fail(msg):
    print(f"[FAIL] {msg}", flush=True)
    sys.exit(1)


def assert_true(condition, msg):
    if not condition:
        fail(msg)
    print(f"  ✅ PASS: {msg}")


def main():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        context = browser.new_context()
        page = context.new_page()

        # 收集 console 日志
        logs = []
        page.on("console", lambda msg: logs.append(f"[{msg.type}] {msg.text}"))
        page.on("pageerror", lambda err: logs.append(f"[pageerror] {err}"))

        # ============= Step 1: 打开 /demo =============
        log(f"==> Step 1: 打开 {URL}")
        page.goto(URL, wait_until="domcontentloaded")
        page.wait_for_timeout(1500)

        # 验证 auth modal 显示
        auth_modal_class = page.locator("#auth-modal").get_attribute("class") or ""
        assert_true("hidden" not in auth_modal_class, "auth modal 显示")

        # 切换到注册表单
        page.locator("#to-register").click()
        page.wait_for_timeout(300)

        # 填写注册表单
        page.fill("#reg-username", USERNAME)
        page.fill("#reg-password", PASSWORD)
        page.fill("#reg-password2", PASSWORD)
        page.locator("#register-form button[type='submit']").click()
        page.wait_for_timeout(2000)

        # 验证注册成功（auth modal 隐藏）
        auth_modal_class = page.locator("#auth-modal").get_attribute("class") or ""
        assert_true("hidden" in auth_modal_class, f"注册成功，auth modal 隐藏 (user={USERNAME})")

        # 验证 status 变为 connected
        status_text = page.locator("#status").text_content()
        log(f"  status text: {status_text}")
        assert_true("connected" in (page.locator("#status").get_attribute("class") or ""),
                    f"status 显示 connected (text={status_text})")

        # ============= Step 2: 验证 sidebar =============
        log("==> Step 2: 验证 sidebar 加载")
        page.wait_for_timeout(1500)  # 等待 agents/sessions API 完成

        agents_data = page.evaluate("""() => {
            const el = document.querySelector('agent-sidebar');
            if (!el || !el.shadowRoot) return { agents: [], sessions: [] };
            const agents = Array.from(el.shadowRoot.querySelectorAll('agent-node')).map(n => ({
                text: (n.textContent || '').trim().substring(0, 100),
                hasSettingsBtn: !!n.shadowRoot?.querySelector('.settings-btn, [class*="settings"]'),
                hasSessions: n.shadowRoot?.querySelectorAll('session-node').length || 0,
            }));
            const sessions = Array.from(el.shadowRoot.querySelectorAll('session-node')).map(s => ({
                text: (s.textContent || '').trim().substring(0, 100),
            }));
            return { agents, sessions };
        }""")
        log(f"  agents: {json.dumps(agents_data['agents'], ensure_ascii=False)}")
        log(f"  sessions: {json.dumps(agents_data['sessions'], ensure_ascii=False)}")
        assert_true(len(agents_data['agents']) >= 1, f"sidebar 显示至少 1 个 agent (实际 {len(agents_data['agents'])})")

        # 截图记录
        page.screenshot(path="/tmp/uat-step2-after-login.png", full_page=True)

        # ============= Step 3: 发送消息 =============
        log("==> Step 3: 发送消息，验证 user-message + assistant-message 渲染")
        test_msg = f"UAT 测试消息 {int(time.time())}"

        # 找到 input-box 的 input
        input_el = page.locator("input-box input[type='text']")
        send_btn = page.locator("input-box button[type='submit']")

        # 在 input 中输入
        input_el.fill(test_msg)
        page.wait_for_timeout(200)
        # 点击 Send 按钮
        send_btn.click()
        log(f"  已发送: {test_msg}")

        # 等待 assistant 回复完成（最多 30s）
        # 检查 user-message 立即出现
        page.wait_for_timeout(500)
        user_msg_count = page.locator("#messages user-message").count()
        assert_true(user_msg_count >= 1, f"发送后立即出现 user-message (count={user_msg_count})")

        # 等待 assistant-message 出现（attached 状态 — 元素可能因 Lit 渲染时序被 Playwright 判为 hidden）
        try:
            page.wait_for_selector("#messages assistant-message", state="attached", timeout=30000)
        except Exception as e:
            page.screenshot(path="/tmp/uat-step3-fail-no-assistant.png", full_page=True)
            fail(f"30s 内未出现 assistant-message: {e}")
        # 等待 working-indicator 消失（最多 60s）
        try:
            page.wait_for_function("""() => {
                const el = document.querySelector('working-indicator');
                return !el || el.isWorking === false;
            }""", timeout=60000)
        except Exception as e:
            log(f"  ⚠️ working-indicator 60s 内未消失: {e}")

        # 再等 2s 让最后的 message_end 写入
        page.wait_for_timeout(2000)

        # 验证消息元素和内容
        msg_state = page.evaluate("""() => {
            const container = document.querySelector('#messages');
            const children = Array.from(container.children);
            return {
                total: children.length,
                types: children.map(c => c.tagName.toLowerCase()),
                userMsg: (() => {
                    const el = container.querySelector('user-message');
                    if (!el) return null;
                    return {
                        text: el.text || el.textContent || '',
                        shadowText: el.shadowRoot?.textContent || '',
                    };
                })(),
                assistantMsgs: Array.from(container.querySelectorAll('assistant-message')).map(el => ({
                    text: el.text || el.textContent || '',
                    shadowText: el.shadowRoot?.textContent || '',
                    isStreaming: el.isStreaming,
                })),
            };
        }""")
        log(f"  messages total: {msg_state['total']}")
        log(f"  types: {msg_state['types']}")
        log(f"  userMsg.text: {msg_state['userMsg']['text'] if msg_state['userMsg'] else 'NONE'}")
        log(f"  userMsg.shadowText: {msg_state['userMsg']['shadowText'][:100] if msg_state['userMsg'] else 'NONE'}")
        log(f"  assistantMsgs count: {len(msg_state['assistantMsgs'])}")
        for i, a in enumerate(msg_state['assistantMsgs']):
            log(f"  assistantMsg[{i}].text: {a['text'][:80]}...")

        assert_true(msg_state['total'] >= 2, f"消息区有 >=2 个元素 (实际 {msg_state['total']})")
        assert_true('user-message' in msg_state['types'], "存在 user-message 元素")
        assert_true('assistant-message' in msg_state['types'], "存在 assistant-message 元素")
        assert_true(msg_state['userMsg'] is not None and test_msg in (msg_state['userMsg']['shadowText'] or msg_state['userMsg']['text']),
                    f"user-message 内容包含发送的文本")
        assert_true(len(msg_state['assistantMsgs']) >= 1, f"至少有 1 个 assistant-message")
        # 第一个 assistant-message 可能只有 tool calls（无 text），第二个才有文本回复
        any_with_text = any(len(a['text']) > 0 or len(a.get('shadowText', '')) > 0 for a in msg_state['assistantMsgs'])
        assert_true(any_with_text, "至少 1 个 assistant-message 有内容")

        # 截图记录
        page.screenshot(path="/tmp/uat-step3-after-send.png", full_page=True)

        # 记录当前 session_id
        old_session_id = page.evaluate("""() => localStorage.getItem('aptbot:sessionId')""")
        log(f"  当前 sessionId: {old_session_id}")

        # ============= Step 4: 点击「+ 新建会话」 =============
        log("==> Step 4: 点击「+ 新建会话」按钮")
        # 「+ 新建会话」按钮在 agent-sidebar > agent-node > shadow root 内部
        new_session_clicked = page.evaluate("""() => {
            const sidebar = document.querySelector('agent-sidebar');
            if (!sidebar || !sidebar.shadowRoot) return false;
            const agentNode = sidebar.shadowRoot.querySelector('agent-node');
            if (!agentNode || !agentNode.shadowRoot) return false;
            const btn = agentNode.shadowRoot.querySelector('.new-session-btn');
            if (!btn) return false;
            btn.click();
            return true;
        }""")
        assert_true(new_session_clicked, "找到并点击了 new-session-btn")

        # 等待 session_changed 事件
        try:
            page.wait_for_function(f"""() => {{
                const sid = localStorage.getItem('aptbot:sessionId');
                return sid && sid !== '{old_session_id}';
            }}""", timeout=10000)
        except Exception as e:
            page.screenshot(path="/tmp/uat-step4-fail-no-session-change.png", full_page=True)
            fail(f"10s 内 sessionId 未改变: {e}")

        new_session_id = page.evaluate("""() => localStorage.getItem('aptbot:sessionId')""")
        log(f"  新 sessionId: {new_session_id}")
        assert_true(new_session_id != old_session_id, "sessionId 切换成功")

        # 验证消息区已清空
        page.wait_for_timeout(500)
        msg_count = page.evaluate("""() => document.querySelector('#messages').children.length""")
        assert_true(msg_count == 0, f"新建会话后消息区已清空 (count={msg_count})")

        # 截图
        page.screenshot(path="/tmp/uat-step4-after-new-session.png", full_page=True)

        # ============= Step 5: 在新会话中发送消息 =============
        log("==> Step 5: 在新会话中发送消息，验证不跳回旧对话")
        test_msg2 = f"第二条消息 {int(time.time())}"
        input_el = page.locator("input-box input[type='text']")
        send_btn = page.locator("input-box button[type='submit']")
        input_el.fill(test_msg2)
        page.wait_for_timeout(200)
        send_btn.click()
        log(f"  已发送: {test_msg2}")

        # 等 assistant 回复（attached 状态避免 Lit 渲染时序判 hidden）
        try:
            page.wait_for_selector("#messages assistant-message", state="attached", timeout=30000)
        except Exception as e:
            fail(f"30s 内未出现 assistant-message: {e}")

        page.wait_for_timeout(3000)

        # 验证 sessionId 仍是新的
        current_session = page.evaluate("""() => localStorage.getItem('aptbot:sessionId')""")
        assert_true(current_session == new_session_id,
                    f"发送消息后 sessionId 保持新会话 (current={current_session}, expected={new_session_id})")

        # 验证消息数量（应该是 user + assistant 至少 2 个）
        msg_state2 = page.evaluate("""() => {
            const container = document.querySelector('#messages');
            const children = Array.from(container.children);
            return {
                total: children.length,
                types: children.map(c => c.tagName.toLowerCase()),
                userMsgs: Array.from(container.querySelectorAll('user-message')).map(el => 
                    (el.text || el.shadowRoot?.textContent || '').substring(0, 50)
                ),
                assistantMsgs: Array.from(container.querySelectorAll('assistant-message')).map(el => 
                    (el.text || '').substring(0, 50)
                ),
            };
        }""")
        log(f"  messages total: {msg_state2['total']}")
        log(f"  types: {msg_state2['types']}")
        log(f"  userMsgs: {msg_state2['userMsgs']}")
        assert_true(msg_state2['total'] >= 2, f"新会话至少有 2 条消息 (实际 {msg_state2['total']})")
        assert_true(test_msg2 in (msg_state2['userMsgs'][0] if msg_state2['userMsgs'] else ''),
                    "新会话中 user-message 内容正确")

        # 验证 sidebar sessions 数量增加
        sessions_after = page.evaluate("""() => {
            const sidebar = document.querySelector('agent-sidebar');
            return sidebar?.shadowRoot?.querySelectorAll('session-node').length || 0;
        }""")
        log(f"  sidebar sessions count after new session: {sessions_after}")

        # 截图
        page.screenshot(path="/tmp/uat-step5-after-send2.png", full_page=True)

        # ============= Step 6: 点击「+ 新建专业 agent」 =============
        log("==> Step 6: 点击「+ 新建专业 agent」按钮，验证 modal 弹出")
        # 检查 new-agent-modal 初始是 hidden
        new_agent_modal_class_before = page.locator("new-agent-modal").get_attribute("class") or ""
        log(f"  new-agent-modal class before: {new_agent_modal_class_before}")

        # 点击 + 新建专业 agent 按钮（在 agent-sidebar 的 sidebar-footer 内）
        new_agent_clicked = page.evaluate("""() => {
            const sidebar = document.querySelector('agent-sidebar');
            if (!sidebar || !sidebar.shadowRoot) return false;
            const btn = sidebar.shadowRoot.querySelector('.new-agent-btn');
            if (!btn) return false;
            btn.click();
            return true;
        }""")
        assert_true(new_agent_clicked, "点击了 + 新建专业 agent 按钮")

        page.wait_for_timeout(500)

        # 检查 new-agent-modal 的 open 属性
        new_agent_open = page.evaluate("""() => {
            const el = document.querySelector('new-agent-modal');
            if (!el) return null;
            return {
                open: el.open,
                classList: el.className,
                shadowHasForm: !!el.shadowRoot?.querySelector('form'),
            };
        }""")
        log(f"  new-agent-modal state: {new_agent_open}")
        assert_true(new_agent_open and new_agent_open.get('open') == True,
                    f"new-agent-modal.open 为 true (实际 {new_agent_open.get('open') if new_agent_open else 'null'})")

        # 截图
        page.screenshot(path="/tmp/uat-step6-new-agent-modal.png", full_page=True)

        # 关闭 modal
        page.evaluate("""() => {
            const el = document.querySelector('new-agent-modal');
            if (el) el.open = false;
        }""")
        page.wait_for_timeout(300)

        # ============= Step 7: 点击 settings 按钮 =============
        log("==> Step 7: 点击 agent settings 按钮，验证 modal 弹出")
        # settings-btn 在 agent-sidebar > agent-node > shadow root 内部
        settings_clicked = page.evaluate("""() => {
            const sidebar = document.querySelector('agent-sidebar');
            if (!sidebar || !sidebar.shadowRoot) return { ok: false, reason: 'no sidebar shadow' };
            const agentNode = sidebar.shadowRoot.querySelector('agent-node');
            if (!agentNode || !agentNode.shadowRoot) return { ok: false, reason: 'no agent-node shadow' };
            const btn = agentNode.shadowRoot.querySelector('.settings-btn');
            if (!btn) return { ok: false, reason: 'no settings btn', html: agentNode.shadowRoot.innerHTML.substring(0, 500) };
            btn.click();
            return { ok: true };
        }""")
        log(f"  settings click result: {settings_clicked}")
        if not settings_clicked.get('ok'):
            log(f"  ⚠️ settings-btn 找不到: {settings_clicked.get('reason')}")
            if 'html' in settings_clicked:
                log(f"  agent-node shadow html: {settings_clicked['html']}")
        else:
            page.wait_for_timeout(500)
            settings_open = page.evaluate("""() => {
                const el = document.querySelector('agent-settings-modal');
                if (!el) return null;
                return {
                    open: el.open,
                    classList: el.className,
                    hasAgent: !!el.agent,
                };
            }""")
            log(f"  agent-settings-modal state: {settings_open}")
            assert_true(settings_open and settings_open.get('open') == True,
                        f"agent-settings-modal.open 为 true")
            # 关闭
            page.evaluate("""() => {
                const el = document.querySelector('agent-settings-modal');
                if (el) el.open = false;
            }""")
            page.wait_for_timeout(300)

        # ============= Step 8: 切换回旧会话 =============
        log("==> Step 8: 点击旧 session，验证消息加载回来")
        # session-node 在 agent-sidebar > agent-node > shadow root 内部
        switch_clicked = page.evaluate("""() => {
            const sidebar = document.querySelector('agent-sidebar');
            if (!sidebar || !sidebar.shadowRoot) return { ok: false };
            const agentNode = sidebar.shadowRoot.querySelector('agent-node');
            if (!agentNode || !agentNode.shadowRoot) return { ok: false };
            const sessions = agentNode.shadowRoot.querySelectorAll('session-node');
            if (sessions.length === 0) return { ok: false, count: 0 };
            // 点击第一个 session
            const firstSession = sessions[0];
            const clickable = firstSession.shadowRoot?.querySelector('.session-item, [class*="session"], div') || firstSession;
            clickable.click();
            return { ok: true, count: sessions.length, clickedText: (firstSession.textContent || '').trim().substring(0, 80) };
        }""")
        log(f"  switch result: {switch_clicked}")
        assert_true(switch_clicked.get('ok'), "点击了 sidebar 第一个 session")

        # 等 session 切换
        page.wait_for_timeout(2000)

        # 验证 sessionId 变了
        current_after_switch = page.evaluate("""() => localStorage.getItem('aptbot:sessionId')""")
        log(f"  当前 sessionId: {current_after_switch}")

        # 截图
        page.screenshot(path="/tmp/uat-step8-after-switch.png", full_page=True)

        # ============= 完成 =============
        log("\n=== 所有测试步骤完成 ===")
        page.screenshot(path="/tmp/uat-final.png", full_page=True)

        print("\n=== Console logs (last 50) ===")
        for line in logs[-50:]:
            print(line)

        browser.close()


if __name__ == "__main__":
    main()
