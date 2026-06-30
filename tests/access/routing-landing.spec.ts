import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { startWebSocketServer, type WebSocketServer } from '../../src/access/websocket-server.js';
import { InMemoryMessageBus } from '../../src/bus/message-bus.js';
import { createUserStorage, type UserStorage } from '../../src/infrastructure/user-storage.js';

/**
 * Task 4: /demo 路由（serveDemoHtml 已提供）
 *
 * 同时传入 serveHtml（landing 占位 HTML）与 serveDemoHtml（chat 占位 HTML），
 * 验证：
 * - GET / 返回 landing HTML（serveHtml 行为不变）
 * - GET /demo、/demo/、/demo/index.html 返回 chat HTML
 * - 所有 HTML 响应带 cache-control: no-cache, no-store, must-revalidate
 * - 大小写敏感：/Demo 返回 404
 * - /api/* 路由不受影响
 */

const TEST_PORT = 18775;

const LANDING_HTML = '<html id="landing">';
const DEMO_HTML = '<html id="chat">';

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

async function httpPostJson(
  port: number,
  path: string,
  body: unknown,
): Promise<{ status: number; body: any }> {
  const url = `http://localhost:${port}${path}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let parsed: any = text;
  try { parsed = JSON.parse(text); } catch { /* keep text */ }
  return { status: res.status, body: parsed };
}

describe('Task 4: /demo 路由（serveDemoHtml 已提供）', () => {
  let server: WebSocketServer | null = null;
  let userStorage: UserStorage;
  let tmpDir: string;

  afterEach(async () => {
    if (server) {
      await server.stop();
      server = null;
    }
    if (tmpDir) {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  async function startServer(): Promise<void> {
    tmpDir = mkdtempSync(join(tmpdir(), 'aptbot-routing-landing-'));
    userStorage = createUserStorage(tmpDir);
    server = await startWebSocketServer({
      port: TEST_PORT,
      bus: new InMemoryMessageBus(),
      userStorage,
      serveHtml: LANDING_HTML,
      serveDemoHtml: DEMO_HTML,
    });
  }

  it('GET / 返回 landing HTML（serveHtml 行为不变）', async () => {
    await startServer();
    const res = await httpGet(TEST_PORT, '/');
    expect(res.status).toBe(200);
    expect(res.body).toContain('id="landing"');
    expect(res.headers['content-type']).toContain('text/html');
    expect(res.headers['cache-control']).toBe('no-cache, no-store, must-revalidate');
  });

  it('GET /demo 返回 chat HTML', async () => {
    await startServer();
    const res = await httpGet(TEST_PORT, '/demo');
    expect(res.status).toBe(200);
    expect(res.body).toContain('id="chat"');
    expect(res.headers['content-type']).toContain('text/html');
    expect(res.headers['cache-control']).toBe('no-cache, no-store, must-revalidate');
  });

  it('GET /demo/ 返回 chat HTML（宽松匹配 trailing slash）', async () => {
    await startServer();
    const res = await httpGet(TEST_PORT, '/demo/');
    expect(res.status).toBe(200);
    expect(res.body).toContain('id="chat"');
    expect(res.headers['cache-control']).toBe('no-cache, no-store, must-revalidate');
  });

  it('GET /demo/index.html 返回 chat HTML（宽松匹配 index.html）', async () => {
    await startServer();
    const res = await httpGet(TEST_PORT, '/demo/index.html');
    expect(res.status).toBe(200);
    expect(res.body).toContain('id="chat"');
    expect(res.headers['cache-control']).toBe('no-cache, no-store, must-revalidate');
  });

  it('GET /demo?token=xxx 仍返回 chat HTML（忽略 query string）', async () => {
    await startServer();
    const res = await httpGet(TEST_PORT, '/demo?token=xxx');
    expect(res.status).toBe(200);
    expect(res.body).toContain('id="chat"');
  });

  it('GET /Demo 返回 404（大小写敏感）', async () => {
    await startServer();
    const res = await httpGet(TEST_PORT, '/Demo');
    expect(res.status).toBe(404);
  });

  it('GET /demo/foo 返回 404（子路径不匹配）', async () => {
    await startServer();
    const res = await httpGet(TEST_PORT, '/demo/foo');
    expect(res.status).toBe(404);
  });

  it('POST /api/login 路由不受 serveDemoHtml 影响（错误凭据返回 401，非 404）', async () => {
    await startServer();
    const res = await httpPostJson(TEST_PORT, '/api/login', {
      username: 'nobody',
      password: 'wrong',
    });
    // 错误凭据应返回 401，证明 auth handler 仍正常运行，未被 /demo 路由遮蔽
    expect(res.status).toBe(401);
  });
});
