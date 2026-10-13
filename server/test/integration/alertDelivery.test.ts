import '../../../scripts/offline_guard.cjs';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import WebSocket from 'ws';
import { randomUUID } from 'node:crypto';

export async function runAlertDeliveryTests(): Promise<void> {
  console.log('[integration/alertDelivery.test] Running private WebSocket alert delivery isolation tests...');

  const oldEnv = { ...process.env };
  process.env.NODE_ENV = 'test';
  process.env.FUTURES_PROVIDER = 'none'; process.env.DATABENTO_API_KEY = ''; process.env.ENABLE_QUOTE_BOARD = '0';
  process.env.PORT = '0';
  process.env.HOST = '127.0.0.1';
  process.env.AUTH_REQUIRED = '1';
  process.env.DEV_HOOKS = '0';
  process.env.AUTH_JWT_SECRET = 'test-secret-with-at-least-32-chars-for-tests';
  process.env.STORAGE_PATH = ':memory:';

  // Dynamic imports so env applies before module load
  const { httpServer } = await import('../../src/index.js');
  const { alertEngine } = await import('../../src/alerts/alertEngine.js');
  const { marketDataStore } = await import('../../src/storage/marketDataStore.js');
  const { alertService } = await import('../../src/alerts/alertService.js');

  // Wait for server to bind
  if (!httpServer.listening) {
    await once(httpServer, 'listening');
  }
  const addr = httpServer.address() as any;
  const baseUrl = `http://127.0.0.1:${addr.port}`;
  const wsUrl = `ws://127.0.0.1:${addr.port}`;
  const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

  try {
    // Register User A
    const resA = await fetch(`${baseUrl}/api/v1/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: `usera_${Date.now()}`, password: 'Password123!', name: 'User A' })
    });
    const dataA = await resA.json();
    const tokenA = dataA.token;
    const userIdA = dataA.user.id;
    assert.ok(tokenA, 'User A should receive JWT token');

    // Register User B
    const resB = await fetch(`${baseUrl}/api/v1/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: `userb_${Date.now()}`, password: 'Password123!', name: 'User B' })
    });
    const dataB = await resB.json();
    const tokenB = dataB.token;
    assert.ok(tokenB, 'User B should receive JWT token');

    // User A creates an alert rule via internal service directly (or API, but service is easier in-process)
    const rule = alertService.createRule(userIdA, 'free', {
      symbol: 'NQ',
      type: 'LARGE_TRADE',
      threshold: 1,
      cooldownSec: 1
    });

    // Connect WebSocket for User A
    const wsA = new WebSocket(wsUrl, ['deepchart-token', tokenA]);
    const msgsA: any[] = [];
    wsA.on('message', (d) => msgsA.push(JSON.parse(d.toString())));
    await once(wsA, 'open');

    // Connect WebSocket for User B
    const wsB = new WebSocket(wsUrl, ['deepchart-token', tokenB]);
    const msgsB: any[] = [];
    wsB.on('message', (d) => msgsB.push(JSON.parse(d.toString())));
    await once(wsB, 'open');

    // Wait a bit for connections to register
    await sleep(200);

    // Trigger alert engine manually as if a tick arrived
    alertEngine.evaluateTick('NQ', {
      id: randomUUID(),
      timestamp: Date.now(),
      price: 20000.5,
      size: 5,
      side: 'buy'
    });

    // Wait for the alert to propagate over WebSocket
    const alertDeadline = Date.now() + 2000;
    while (!msgsA.find((m) => m.type === 'ALERT_EVENT') && Date.now() < alertDeadline) {
      await sleep(50);
    }

    const alertA = msgsA.find((m) => m.type === 'ALERT_EVENT');
    assert.ok(alertA, 'User A should receive ALERT_EVENT over WebSocket');
    assert.strictEqual(alertA.alert.ruleId, rule.id, 'Alert should match the rule created');

    const alertB = msgsB.find((m) => m.type === 'ALERT_EVENT');
    assert.strictEqual(alertB, undefined, 'User B should NOT receive ALERT_EVENT because rule belongs to User A');

    wsA.close();
    wsB.close();
    
    // Clean up
    marketDataStore.deleteAlertRule(rule.id, userIdA);

    console.log('  [PASS] Private WebSocket alert delivery isolation tests passed.');
  } finally {
    // Restore env
    Object.assign(process.env, oldEnv);
    try {
      const { closeServer } = await import('../../src/index.js');
      await closeServer();
    } catch {}
    try {
      const { marketDataStore } = await import('../../src/storage/marketDataStore.js');
      marketDataStore.close();
    } catch {}
  }
}

if (process.argv[1]?.endsWith('alertDelivery.test.ts') || process.argv[1]?.endsWith('alertDelivery.test.js')) {
  runAlertDeliveryTests().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
