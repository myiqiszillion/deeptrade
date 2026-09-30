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
    NODE_ENV: 'test',
    PORT: String(port),
    HOST: '127.0.0.1',
    DEV_HOOKS: '1',
    AUTH_REQUIRED: '0',
    // Hermetic run: STORAGE_PATH outranks NODE_ENV=test in MarketDataStore, so an inherited value
    // from the dev shell would make the test server read/write the real market_data.sqlite.
    STORAGE_PATH: ':memory:',
    // Pin the vendor away too: the feed-state assertions below must not depend on the developer's shell
    // (an inherited FUTURES_PROVIDER would start a real vendor connection during the test run).
    FUTURES_PROVIDER: 'none',
    DATABENTO_TRANSPORT_READY: '0',
    DATABENTO_API_KEY: '',
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

    // 1. Query ES history (default CME futures)
    const esRes = await fetch(`${base}/api/v1/history?symbol=ES&timeframe=1m&limit=10`);
    assert.equal(esRes.status, 200, 'ES history should return 200');
    const esData = (await esRes.json()) as any;
    assert.equal(esData.symbol, 'ES');
    assert.ok(Array.isArray(esData.bars));

    // 2. Query with options
    const nqRes = await fetch(`${base}/api/v1/history?symbol=NQ&timeframe=1m&provider=tradovate&limit=5`);
    assert.equal(nqRes.status, 200);
    const nqData = (await nqRes.json()) as any;
    assert.equal(nqData.symbol, 'NQ');
    assert.equal(nqData.provider, 'tradovate');
    assert.ok(Array.isArray(nqData.bars));

    // 3. P0 Auth Regression: Client cannot self-assign admin role via POST /api/v1/auth/login
    const loginRes = await fetch(`${base}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: 'attacker',
        role: 'admin',
      }),
    });
    assert.equal(loginRes.status, 200, 'Login should succeed');
    const loginData = (await loginRes.json()) as any;
    assert.ok(loginData.token, 'Should receive token');
    assert.equal(loginData.user.role, 'user', 'Client MUST NOT be able to self-assign admin role in user response');
    const tokenParts = loginData.token.split('.');
    const payload = JSON.parse(Buffer.from(tokenParts[1], 'base64url').toString('utf8'));
    assert.equal(payload.role, 'user', 'JWT token role MUST NOT be admin');

    // 4. P2 Instruments API: Returns dynamic instruments list
    const instRes = await fetch(`${base}/api/v1/instruments`);
    assert.equal(instRes.status, 200);
    const instData = (await instRes.json()) as any;
    assert.ok(Array.isArray(instData.instruments), 'Instruments API must return instruments array');
    const es = instData.instruments.find((i: any) => i.symbol === 'ES');
    assert.ok(es, 'ES instrument must be present in dynamic list');
    assert.equal(es.symbol, 'ES');

    // 4b. Feed state must be honest: CONNECTING/LIVE may only appear for symbols the server actually tracks.
    // ES is the default symbol, so the server warms a context for it at boot (here with no vendor configured,
    // which is UNAVAILABLE — not "connecting", and definitely not live).
    assert.equal(es.subscribed, true, 'the default symbol is warmed at boot, so it has a market context');
    assert.equal(es.feedStatus, 'UNAVAILABLE', 'a warmed context without a vendor reports UNAVAILABLE');
    assert.equal(es.feedConfigured, false, 'FUTURES_PROVIDER=none means no vendor is configured');

    const untouched = instData.instruments.find((i: any) => i.symbol === 'CL');
    assert.ok(untouched, 'CL must be listed');
    assert.equal(untouched.feedStatus, 'IDLE', 'an instrument nobody subscribed to reports IDLE, not CONNECTING');
    assert.equal(untouched.subscribed, false, 'no market context exists for CL');

    const dishonest = instData.instruments.filter((i: any) => i.feedStatus === 'CONNECTING');
    assert.equal(
      dishonest.length,
      0,
      `no instrument may claim CONNECTING without a subscription: ${dishonest.map((i: any) => i.symbol).join(', ')}`
    );
    const live = instData.instruments.filter((i: any) => i.feedStatus === 'LIVE');
    assert.equal(live.length, 0, 'no instrument may claim LIVE without a configured vendor and validated data');
    assert.ok(
      instData.instruments.every((i: any) => i.feedConfigured === false),
      'every instrument reports feedConfigured=false when no vendor is configured'
    );

    // 4c. Quote board is opt-in and metered: with the flag off it must answer without touching the vendor.
    const quotesRes = await fetch(`${base}/api/v1/quotes?symbols=ES,NQ`);
    assert.equal(quotesRes.status, 200, 'quote board endpoint answers even when disabled');
    const quotesData = (await quotesRes.json()) as any;
    assert.equal(quotesData.enabled, false, 'quote board is disabled by default (metered feature)');
    assert.deepEqual(quotesData.quotes, [], 'no quotes are fabricated when the board is off');
    assert.ok(typeof quotesData.hint === 'string' && quotesData.hint.includes('ENABLE_QUOTE_BOARD'), 'hint explains how to enable it');

    console.log('  [PASS] /api/v1/history, auth login & instruments integration tests passed.');
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
