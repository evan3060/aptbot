import { describe, it, expect, afterEach } from 'vitest';
import { startWebSocketServer, type WebSocketServer } from '../../src/access/websocket-server.js';
import { InMemoryMessageBus } from '../../src/bus/message-bus.js';

/**
 * Task 4: 默认路由行为（未提供 serveDemoHtml）
 *
 * 仅传入 serveHtml，不传 serveDemoHtml，
 * 验证 clone 用户零影响：
 * - GET / 仍返回 serveHtml（行为不变）
 * - GET /demo、/demo/、/demo/index.html 返回 404（默认行为）
 */

const TEST_PORT = 18776;

const CHAT_HTML = '<html id="chat">';

async function httpGet(
  port: number,
  path: string,
  headers?: Record<string, string>,
): Promise<{ status: number; body: string; headers: Record<string, string> }> {
  const url = `http://localhost:${port}${path}`;
  const res = await fetch(url, { method: 'GET', headers });
  const text = await res.text();
  const headerMap: Record<string, string> = {};
  res.headers.forEach((v, k) => { headerMap[k.toLowerCase()] = v; });
  return { status: res.status, body: text, headers: headerMap };
}

describe('Task 4: 默认路由行为（未提供 serveDemoHtml）', () => {
  let server: WebSocketServer | null = null;

  afterEach(async () => {
    if (server) {
      await server.stop();
      server = null;
    }
  });

  async function startServer(): Promise<void> {
    server = await startWebSocketServer({
      port: TEST_PORT,
      bus: new InMemoryMessageBus(),
      serveHtml: CHAT_HTML,
    });
  }

  it('GET / 返回 serveHtml（默认行为不变）', async () => {
    await startServer();
    const res = await httpGet(TEST_PORT, '/');
    expect(res.status).toBe(200);
    expect(res.body).toContain('id="chat"');
    expect(res.headers['cache-control']).toBe('no-cache, no-store, must-revalidate');
  });

  it('GET /demo 返回 404（未提供 serveDemoHtml）', async () => {
    await startServer();
    const res = await httpGet(TEST_PORT, '/demo');
    expect(res.status).toBe(404);
  });

  it('GET /demo/ 返回 404（未提供 serveDemoHtml）', async () => {
    await startServer();
    const res = await httpGet(TEST_PORT, '/demo/');
    expect(res.status).toBe(404);
  });

  it('GET /demo/index.html 返回 404（未提供 serveDemoHtml）', async () => {
    await startServer();
    const res = await httpGet(TEST_PORT, '/demo/index.html');
    expect(res.status).toBe(404);
  });
});
