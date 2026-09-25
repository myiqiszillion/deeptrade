import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import net from 'node:net';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';

export async function runChartSmokeTests(): Promise<void> {
  console.log('[integration/chartSmoke.test] Running chart smoke integration test...');

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
    FUTURES_PROVIDER: 'tradovate',
    DEMO: '0',
    DEV_HOOKS: '1',
  };
  for (const key of Object.keys(env)) {
    if (key.startsWith('TRADOVATE_')) delete env[key];
  }

  const server = spawn(process.execPath, [fileURLToPath(new URL('../../dist/index.js', import.meta.url))], {
    cwd: root,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let exited = false;
  server.on('exit', () => {
    exited = true;
  });
  server.stderr.on('data', () => {}); // expected unavailable-provider warnings
  const base = `http://127.0.0.1:${port}`;
  let socket: WebSocket | undefined;
  const messages: any[] = [];
  const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

  async function until<T>(predicate: () => T, label: string): Promise<T> {
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline) {
      const value = predicate();
      if (value) return value;
      if (exited) throw new Error('test server exited early');
      await sleep(10);
    }
    throw new Error(`timed out: ${label}`);
  }

  try {
    let ready = false;
    server.stdout.on('data', (data) => {
      if (data.toString().includes('Ready at')) ready = true;
    });
    await until(() => ready, 'server startup');

    const page = await fetch(base);
    assert.equal(page.status, 200);
    assert.match(await page.text(), /<div id="root">/);

    socket = new WebSocket(`ws://127.0.0.1:${port}`);
    socket.on('message', (data) => messages.push(JSON.parse(data.toString())));
    await once(socket, 'open');

    for (const [symbol, timeframe] of [
      ['ES', '1m'],
      ['ES', '5m'],
      ['ES', '1s'],
      ['NQ', '1m'],
      ['ES', '1m'],
    ]) {
      const mark = messages.length;
      socket.send(JSON.stringify({ type: 'SUBSCRIBE', symbol, timeframe }));
      const init = await until(
        () =>
          messages
            .slice(mark)
            .find((m) => m.type === 'INIT_STATE' && m.symbol === symbol && m.timeframe === timeframe),
        `${symbol}/${timeframe} snapshot`
      );
      assert.equal(init.feedStatus, 'UNAVAILABLE');
      assert.equal(init.historySource, 'NONE');
      assert.deepEqual(init.historyBars, []);
      assert.deepEqual(init.bars, []);
      console.log(`  PASS  server snapshot ${symbol}/${timeframe}: empty history, unavailable feed`);
    }

    const mark = messages.length;
    await sleep(500);
    assert.equal(
      messages.slice(mark).filter((m) => m.type === 'TICK' || m.type === 'ORDERBOOK_UPDATE').length,
      0
    );

    const health = (await fetch(`${base}/healthz`).then((r) => r.json())) as any;
    assert.equal(health.feed, 'tradovate');
    assert.equal(health.historySource, 'NONE');
    assert.match(health.feedReason, /TRADOVATE_USERNAME/);
    console.log('  [PASS] Chart history server smoke test passed.');
  } finally {
    socket?.terminate();
    if (!exited) {
      const stopped = once(server, 'exit');
      server.kill();
      await stopped;
    }
    server.stdout.destroy();
    server.stderr.destroy();
  }
}

if (process.argv[1]?.endsWith('chartSmoke.test.ts') || process.argv[1]?.endsWith('chartSmoke.test.js')) {
  runChartSmokeTests().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
