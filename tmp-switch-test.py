#!/usr/bin/env python3
"""测试点击会话切换是否能加载历史消息"""
import time
from playwright.sync_api import sync_playwright

URL = "http://localhost:8080/demo"
USERNAME = f"swtest_{int(time.time())}"
PASSWORD = "swtestpassword123"


def main():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        context = browser.new_context()
        page = context.new_page()

        logs = []
        page.on("console", lambda msg: logs.append(f"[{msg.type}] {msg.text}"))

        # 注册并登录
        page.goto(URL, wait_until="domcontentloaded")
        page.wait_for_timeout(1500)
        page.locator("#to-register").click()
        page.wait_for_timeout(300)
        page.fill("#reg-username", USERNAME)
        page.fill("#reg-password", PASSWORD)
        page.fill("#reg-password2", PASSWORD)
        page.locator("#register-form button[type='submit']").click()
        page.wait_for_timeout(2000)
        print(f"[sw] registered as {USERNAME}")

        # 发送第一条消息
        msg1 = f"第一条消息 {int(time.time())}"
        page.locator("input-box input[type='text']").fill(msg1)
        page.locator("input-box button[type='submit']").click()
        print(f"[sw] sent: {msg1}")

        # 等待回复
        page.wait_for_selector("#messages assistant-message", state="attached", timeout=30000)
        page.wait_for_timeout(3000)
        old_session = page.evaluate("() => localStorage.getItem('aptbot:sessionId')")
        msg_count_1 = page.evaluate("() => document.querySelectorAll('#messages > *').length")
        print(f"[sw] session1: {old_session}, msg_count: {msg_count_1}")

        # 新建第二个会话
        clicked = page.evaluate("""() => {
            const sidebar = document.querySelector('agent-sidebar');
            if (!sidebar || !sidebar.shadowRoot) return false;
            const agentNode = sidebar.shadowRoot.querySelector('agent-node');
            if (!agentNode || !agentNode.shadowRoot) return false;
            const btn = agentNode.shadowRoot.querySelector('.new-session-btn');
            if (!btn) return false;
            btn.click();
            return true;
        }""")
        print(f"[sw] clicked new-session: {clicked}")
        page.wait_for_timeout(2000)
        session2 = page.evaluate("() => localStorage.getItem('aptbot:sessionId')")
        print(f"[sw] session2: {session2}")

        # 在第二个会话发送消息
        msg2 = f"第二条消息 {int(time.time())}"
        page.locator("input-box input[type='text']").fill(msg2)
        page.locator("input-box button[type='submit']").click()
        print(f"[sw] sent: {msg2}")
        page.wait_for_selector("#messages assistant-message", state="attached", timeout=30000)
        page.wait_for_timeout(3000)
        msg_count_2 = page.evaluate("() => document.querySelectorAll('#messages > *').length")
        print(f"[sw] session2 msg_count: {msg_count_2}")

        # 现在点击第一个 session（切换回去）
        print("[sw] === 点击第一个 session 切换回去 ===")
        switch_result = page.evaluate("""() => {
            const sidebar = document.querySelector('agent-sidebar');
            if (!sidebar || !sidebar.shadowRoot) return { ok: false, reason: 'no sidebar' };
            const agentNode = sidebar.shadowRoot.querySelector('agent-node');
            if (!agentNode || !agentNode.shadowRoot) return { ok: false, reason: 'no agent-node' };
            const sessions = agentNode.shadowRoot.querySelectorAll('session-node');
            if (sessions.length === 0) return { ok: false, reason: 'no sessions' };
            // 点击第一个 session
            const firstSession = sessions[0];
            const item = firstSession.shadowRoot?.querySelector('.session-item');
            if (item) item.click();
            else firstSession.click();
            return { ok: true, count: sessions.length };
        }""")
        print(f"[sw] switch result: {switch_result}")

        # 等待 session 切换 + 历史加载
        page.wait_for_timeout(4000)
        current_session = page.evaluate("() => localStorage.getItem('aptbot:sessionId')")
        msg_count_3 = page.evaluate("() => document.querySelectorAll('#messages > *').length")
        msg_html = page.evaluate("""() => {
            const container = document.querySelector('#messages');
            return Array.from(container.children).map(c => {
                const tag = c.tagName.toLowerCase();
                const text = c.text || c.shadowRoot?.textContent || '';
                return { tag, text: text.substring(0, 60) };
            });
        }""")
        print(f"[sw] after switch: session={current_session}, msg_count={msg_count_3}")
        print(f"[sw] messages: {msg_html}")

        # 验证：是否切换回旧 session 且历史消息已加载
        if current_session == old_session:
            print(f"[sw] ✅ sessionId 切换回旧会话")
        else:
            print(f"[sw] ❌ sessionId 未切换回旧会话 (expected={old_session}, actual={current_session})")

        if msg_count_3 >= 2:
            print(f"[sw] ✅ 历史消息已加载 ({msg_count_3} 条)")
        else:
            print(f"[sw] ❌ 历史消息未加载 (仅 {msg_count_3} 条)")

        # 检查是否包含第一条消息
        contains_msg1 = any(msg1 in (m.get('text', '') or '') for m in msg_html)
        if contains_msg1:
            print(f"[sw] ✅ 历史中包含第一条消息")
        else:
            print(f"[sw] ❌ 历史中不包含第一条消息")

        page.screenshot(path="/tmp/sw-test-final.png", full_page=True)
        print("\n[sw] console logs (last 20):")
        for line in logs[-20:]:
            print(line)
        browser.close()


if __name__ == "__main__":
    main()
