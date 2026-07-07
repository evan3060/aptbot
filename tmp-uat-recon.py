#!/usr/bin/env python3
"""UAT 侦察脚本：检查 /demo 初始页面结构"""
import json
from playwright.sync_api import sync_playwright

URL = "http://localhost:8080/demo"


def main():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        context = browser.new_context()
        page = context.new_page()

        # 收集 console 日志
        logs = []
        page.on("console", lambda msg: logs.append(f"[{msg.type}] {msg.text}"))
        page.on("pageerror", lambda err: logs.append(f"[pageerror] {err}"))

        print(f"==> Navigating to {URL}")
        page.goto(URL, wait_until="domcontentloaded")
        page.wait_for_timeout(2000)

        print("\n=== URL after load ===")
        print(page.url)

        print("\n=== Title ===")
        print(page.title())

        print("\n=== Auth modal visible? ===")
        auth_modal = page.locator("#auth-modal")
        print(f"auth-modal exists: {auth_modal.count()}")
        if auth_modal.count() > 0:
            print(f"auth-modal has 'hidden' class: {auth_modal.get_attribute('class')}")

        print("\n=== Status text ===")
        try:
            status = page.locator("#status")
            print(f"status text: {status.text_content()}")
            print(f"status class: {status.get_attribute('class')}")
        except Exception as e:
            print(f"status error: {e}")

        print("\n=== Sidebar structure ===")
        sidebar = page.locator("agent-sidebar")
        print(f"agent-sidebar count: {sidebar.count()}")
        if sidebar.count() > 0:
            # 检查 shadow DOM
            try:
                shadow_html = page.evaluate("""() => {
                    const el = document.querySelector('agent-sidebar');
                    if (!el || !el.shadowRoot) return 'no shadow';
                    return el.shadowRoot.innerHTML.substring(0, 2000);
                }""")
                print(f"sidebar shadow HTML (first 2000 chars):\n{shadow_html}")
            except Exception as e:
                print(f"sidebar shadow error: {e}")

        print("\n=== Agent count via JS ===")
        try:
            agents = page.evaluate("""() => {
                const el = document.querySelector('agent-sidebar');
                if (!el || !el.shadowRoot) return [];
                return Array.from(el.shadowRoot.querySelectorAll('agent-node')).map(n => ({
                    text: n.textContent?.trim().substring(0, 80),
                }));
            }""")
            print(f"agents: {json.dumps(agents, ensure_ascii=False, indent=2)}")
        except Exception as e:
            print(f"agents error: {e}")

        print("\n=== Sessions count via JS ===")
        try:
            sessions = page.evaluate("""() => {
                const el = document.querySelector('agent-sidebar');
                if (!el || !el.shadowRoot) return [];
                return Array.from(el.shadowRoot.querySelectorAll('session-node')).map(n => ({
                    text: n.textContent?.trim().substring(0, 80),
                }));
            }""")
            print(f"sessions: {json.dumps(sessions, ensure_ascii=False, indent=2)}")
        except Exception as e:
            print(f"sessions error: {e}")

        print("\n=== Messages container ===")
        msgs = page.locator("#messages")
        print(f"#messages count: {msgs.count()}")
        if msgs.count() > 0:
            print(f"#messages children: {msgs.evaluate('el => el.children.length')}")
            print(f"#messages innerHTML (first 500): {msgs.evaluate('el => el.innerHTML.substring(0, 500)')}")

        print("\n=== Input box ===")
        try:
            input_shadow = page.evaluate("""() => {
                const el = document.querySelector('input-box');
                if (!el || !el.shadowRoot) return 'no shadow';
                return el.shadowRoot.innerHTML.substring(0, 1500);
            }""")
            print(f"input-box shadow:\n{input_shadow}")
        except Exception as e:
            print(f"input-box error: {e}")

        print("\n=== Footer ===")
        try:
            footer_shadow = page.evaluate("""() => {
                const el = document.querySelector('footer-bar');
                if (!el || !el.shadowRoot) return 'no shadow';
                return el.shadowRoot.innerHTML.substring(0, 500);
            }""")
            print(f"footer-bar shadow:\n{footer_shadow}")
        except Exception as e:
            print(f"footer-bar error: {e}")

        print("\n=== Console logs (last 30) ===")
        for line in logs[-30:]:
            print(line)

        page.screenshot(path="/tmp/uat-recon.png", full_page=True)
        print("\nScreenshot saved: /tmp/uat-recon.png")

        browser.close()


if __name__ == "__main__":
    main()
