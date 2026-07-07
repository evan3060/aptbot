#!/usr/bin/env python3
"""Debug script: send a message and dump DOM state to understand why assistant-message is hidden."""
import time
from playwright.sync_api import sync_playwright

URL = "http://localhost:8080/demo"
USERNAME = f"dbg_{int(time.time())}"
PASSWORD = "dbgpassword123"


def main():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        context = browser.new_context()
        page = context.new_page()

        logs = []
        page.on("console", lambda msg: logs.append(f"[{msg.type}] {msg.text}"))

        page.goto(URL, wait_until="domcontentloaded")
        page.wait_for_timeout(1500)

        # Register
        page.locator("#to-register").click()
        page.wait_for_timeout(300)
        page.fill("#reg-username", USERNAME)
        page.fill("#reg-password", PASSWORD)
        page.fill("#reg-password2", PASSWORD)
        page.locator("#register-form button[type='submit']").click()
        page.wait_for_timeout(2000)
        print(f"[dbg] registered as {USERNAME}")

        # Send a message
        test_msg = f"hello {int(time.time())}"
        page.locator("input-box input[type='text']").fill(test_msg)
        page.locator("input-box button[type='submit']").click()
        print(f"[dbg] sent: {test_msg}")

        # Wait 10 seconds for response
        for i in range(20):
            page.wait_for_timeout(500)
            count = page.evaluate("() => document.querySelectorAll('#messages assistant-message').length")
            text_state = page.evaluate("""() => {
                const container = document.querySelector('#messages');
                const children = Array.from(container.children).map(c => {
                    const el = c;
                    const rect = el.getBoundingClientRect();
                    return {
                        tag: c.tagName.toLowerCase(),
                        text: c.text || c.textContent || '',
                        shadowText: c.shadowRoot?.textContent || '',
                        shadowHtml: c.shadowRoot?.innerHTML?.substring(0, 200) || '',
                        rect: { x: rect.x, y: rect.y, w: rect.width, h: rect.height },
                        offsetHeight: c.offsetHeight,
                        offsetWidth: c.offsetWidth,
                    };
                });
                return children;
            }""")
            print(f"[dbg] iter={i} assistant_count={count}")
            for j, c in enumerate(text_state):
                print(f"[dbg]   child[{j}] tag={c['tag']} h={c['offsetHeight']} w={c['offsetWidth']} text='{c['text'][:50]}' shadowText='{c['shadowText'][:80]}'")
                print(f"[dbg]     shadowHtml: {c['shadowHtml']}")
            if count >= 1:
                # Check working-indicator
                working = page.evaluate("""() => {
                    const el = document.querySelector('working-indicator');
                    if (!el) return null;
                    return {
                        isWorking: el.isWorking,
                        shadowHtml: el.shadowRoot?.innerHTML?.substring(0, 200) || '',
                        offsetHeight: el.offsetHeight,
                    };
                }""")
                print(f"[dbg]   working-indicator: {working}")
                if c['offsetHeight'] > 0:
                    break

        page.screenshot(path="/tmp/dbg-final.png", full_page=True)
        print("[dbg] console logs:")
        for line in logs[-30:]:
            print(line)
        browser.close()


if __name__ == "__main__":
    main()
