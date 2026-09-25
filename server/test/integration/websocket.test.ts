import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import net from 'node:net';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';

export async function runWebSocketIntegrationTests(): Promise<void> {
  console.log('[integration/websocket.test] Running WebSocket integration tests...');

  const root = fileURLToPath(new URL('../../', import.meta.url));
  const probe = net.createServer();
  probe.listen(0, '127.0.0.1');
  await once(probe, 'listening');
  const port = (probe.address() as net.AddressInfo).port;
  await new Promise((resolve) => probe.close(resolve));

  const env: NodeJS.ProcessEnv = {
    ...process.env,
    PORT: String(port),
    HOST: '127.0.0.1',
    DEV_HOOKS: '1',
    DEMO: '0',
    MAX_SESSIONS: '5',
    MAX_SESSIONS_PER_USER: '2',
  };

  const server = spawn(process.execPath, [fileURLToPath(new URL('../../dist/index.js', import.meta.url))], {
    cwd: root,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let exited = false;
  server.on('exit', () => {
    exited = true;
  });

  const base = `ws://127.0.0.1:${port}`;
  const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

  try {
    let ready = false;
    server.stdout.on('data', (data) => {
      if (data.toString().includes('Ready at')) ready = true;
    });

    const deadline = Date.now() + 5000;
    while (!ready && Date.now() < deadline) {
      if (exited) throw new Error('Test server exited early');
      await sleep(50);
    }

    // 1. Connect Client A
    const ws1 = new WebSocket(base);
    const msgs1: any[] = [];
    ws1.on('message', (d) => msgs1.push(JSON.parse(d.toString())));
    await once(ws1, 'open');

    // Wait for default BTCUSDT INIT_STATE
    const initDeadline = Date.now() + 3000;
    while (!msgs1.find((m) => m.type === 'INIT_STATE' && m.symbol === 'BTCUSDT') && Date.now() < initDeadline) {
      await sleep(50);
    }
    const initMsg = msgs1.find((m) => m.type === 'INIT_STATE' && m.symbol === 'BTCUSDT');
    assert.ok(initMsg, 'Client should receive INIT_STATE for default BTCUSDT');

    // 2. Subscribe to another instrument (NQ)
    ws1.send(JSON.stringify({ type: 'SUBSCRIBE', symbol: 'NQ', timeframe: '1m' }));
    const nqDeadline = Date.now() + 3000;
    while (!msgs1.find((m) => m.type === 'INIT_STATE' && m.symbol === 'NQ') && Date.now() < nqDeadline) {
      await sleep(50);
    }
    const nqInit = msgs1.find((m) => m.type === 'INIT_STATE' && m.symbol === 'NQ');
    assert.ok(nqInit, 'Client should receive INIT_STATE for NQ');

    ws1.close();
    await sleep(200);

    console.log('  [PASS] WebSocket integration tests passed.');
  } finally {
    if (!exited) {
      const stopped = once(server, 'exit');
      server.kill();
      await stopped;
    }
    server.stdout.destroy();
    server.stderr.destroy();
  }
}

if (process.argv[1]?.endsWith('websocket.test.ts') || process.argv[1]?.endsWith('websocket.test.js')) {
  runWebSocketIntegrationTests().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
