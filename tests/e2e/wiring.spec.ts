import { describe, it, expect, afterEach } from 'vitest';
import { WebSocket } from 'ws';
import { mkdtempSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { startServer, type ServerHandle } from '../../src/server.js';

let serverHandle: ServerHandle | null = null;
let tempDir: string | null = null;

async function stopServer() {
  if (serverHandle) {
    await serverHandle.stop();
    serverHandle = null;
  }
  if (tempDir) {
    rmSync(tempDir, { recursive: true, force: true });
    tempDir = null;
  }
}

function makeTestConfig(dir: string): string {
  const configPath = join(dir, 'aptbot.json');
  writeFileSync(
    configPath,
    JSON.stringify({
      providers: [
        {
          id: 'test',
          name: 'Test',
          auth: { envVar: 'TEST_API_KEY' },
          models: [
            {
              id: 'test-model',
              api: 'openai-responses',
              contextWindow: 8000,
              maxTokens: 1000,
            },
          ],
        },
      ],
      defaultModel: 'test-model',
      dataDir: dir,
      deploy: 'local',
    }),
  );
  return configPath;
}

describe('Server wiring', () => {
  afterEach(async () => {
    await stopServer();
  });

  it('startServer launches and accepts WebSocket connections', async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'aptbot-test-'));
    const configPath = makeTestConfig(tempDir);
    process.env.APTBOT_CONFIG = configPath;
    process.env.TEST_API_KEY = 'test-key';

    const port = 18432 + Math.floor(Math.random() * 1000);
    serverHandle = await startServer({ port, deploy: 'local' });

    const ws = new WebSocket(`ws://127.0.0.1:${port}`);
    const opened = await new Promise<boolean>((resolve) => {
      ws.on('open', () => resolve(true));
      ws.on('error', () => resolve(false));
      setTimeout(() => resolve(false), 3000);
    });

    expect(opened).toBe(true);
    ws.close();
    await new Promise((r) => setTimeout(r, 100));
  });

  it('startServer returns a handle with stop method', async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'aptbot-test-'));
    const configPath = makeTestConfig(tempDir);
    process.env.APTBOT_CONFIG = configPath;
    process.env.TEST_API_KEY = 'test-key';

    const port = 19432 + Math.floor(Math.random() * 1000);
    serverHandle = await startServer({ port, deploy: 'local' });

    expect(typeof serverHandle.stop).toBe('function');
    await serverHandle.stop();
    serverHandle = null;

    const ws = new WebSocket(`ws://127.0.0.1:${port}`);
    const opened = await new Promise<boolean>((resolve) => {
      ws.on('open', () => resolve(true));
      ws.on('error', () => resolve(false));
      setTimeout(() => resolve(false), 2000);
    });
    expect(opened).toBe(false);
    ws.close();
    await new Promise((r) => setTimeout(r, 100));
  });

  it('startServer with authToken rejects connections without token', async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'aptbot-test-'));
    const configPath = makeTestConfig(tempDir);
    process.env.APTBOT_CONFIG = configPath;
    process.env.TEST_API_KEY = 'test-key';

    const port = 20432 + Math.floor(Math.random() * 1000);
    serverHandle = await startServer({ port, deploy: 'local', authToken: 'secret-token' });

    const ws = new WebSocket(`ws://127.0.0.1:${port}`);
    let opened = false;
    let closed = false;
    await new Promise<void>((resolve) => {
      ws.on('open', () => { opened = true; });
      ws.on('close', () => { closed = true; resolve(); });
      ws.on('error', () => resolve());
      setTimeout(() => resolve(), 3000);
    });

    expect(closed).toBe(true);
    ws.close();
    await new Promise((r) => setTimeout(r, 100));
  });
});
