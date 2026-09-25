import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import net from 'node:net';
import { fileURLToPath } from 'node:url';

export async function runHistoryApiTests(): Promise<void> {
  console.log('[integration/historyApi.test] Running /api/v1/history integration tests...');

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
    AUTH_REQUIRED: '0',
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

  const base = `http://127.0.0.1:${port}`;
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
    assert.ok(ready, 'Server should become ready');

    // 1. Query BTCUSDT history (public crypto tier)
    const btcRes = await fetch(`${base}/api/v1/history?symbol=BTCUSDT&timeframe=1m&limit=10`);
    assert.equal(btcRes.status, 200, 'BTCUSDT history should return 200');
    const btcData = (await btcRes.json()) as any;
    assert.equal(btcData.symbol, 'BTCUSDT');
    assert.equal(btcData.provider, 'binance');
    assert.ok(Array.isArray(btcData.bars));

    // 2. Query with options
    const esRes = await fetch(`${base}/api/v1/history?symbol=ES&timeframe=1m&provider=tradovate&limit=5`);
    assert.equal(esRes.status, 200);
    const esData = (await esRes.json()) as any;
    assert.equal(esData.symbol, 'ES');
    assert.equal(esData.provider, 'tradovate');
    assert.ok(Array.isArray(esData.bars));

    console.log('  [PASS] /api/v1/history integration tests passed.');
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

if (process.argv[1]?.endsWith('historyApi.test.ts') || process.argv[1]?.endsWith('historyApi.test.js')) {
  runHistoryApiTests().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
