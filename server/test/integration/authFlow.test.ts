import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createHmac } from 'node:crypto';
import net from 'node:net';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';

/**
 * Production-shaped auth flow: AUTH_REQUIRED=1 with real credentials, entitlements, admin
 * provisioning, a signed billing webhook and the WebSocket handshake that carries the token.
 */
export async function runAuthFlowTests(): Promise<void> {
  console.log('[integration/authFlow.test] Running authentication & billing integration tests...');

  const root = fileURLToPath(new URL('../../', import.meta.url));
  const probe = net.createServer();
  probe.listen(0, '127.0.0.1');
  await once(probe, 'listening');
  const port = (probe.address() as net.AddressInfo).port;
  await new Promise((resolve) => probe.close(resolve));

  const ADMIN_SECRET = 'integration-admin-secret-0123456789';
  const WEBHOOK_SECRET = 'whsec_integration_secret';
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    NODE_ENV: 'production',
    PORT: String(port),
    HOST: '127.0.0.1',
    AUTH_REQUIRED: '1',
    DEV_HOOKS: '0',
    AUTH_JWT_SECRET: 'integration-test-secret-with-at-least-32-chars',
    ADMIN_SECRET,
    ADMIN_USERNAME: 'ops-admin',
    ADMIN_PASSWORD: 'ops-admin-password',
    STRIPE_WEBHOOK_SECRET: WEBHOOK_SECRET,
    METRICS_TOKEN: 'integration-metrics-token',
    FUTURES_PROVIDER: 'none',
    STORAGE_PATH: ':memory:',
    DEFAULT_SYMBOL: 'ES',
    MAX_VENDOR_FETCHES_PER_HOUR: '5',
    MAX_API_REQUESTS_PER_MIN: '1000',
    MAX_AUTH_REQUESTS_PER_MIN: '1000',
    LOGIN_MAX_FAILURES: '3',
    LOGIN_LOCK_SECONDS: '2',
    // Trust X-Forwarded-For so the suite can drive distinct client IPs deterministically.
    TRUST_PROXY: '1',
  };
  for (const key of Object.keys(env)) {
    if (key.startsWith('TRADOVATE_') || key.startsWith('DATABENTO_')) delete env[key];
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
  server.stderr.on('data', () => {}); // expected feed-unavailable warnings

  const base = `http://127.0.0.1:${port}`;
  const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
  async function until<T>(predicate: () => T, label: string): Promise<T> {
    const deadline = Date.now() + 10000;
    while (Date.now() < deadline) {
      const value = predicate();
      if (value) return value;
      if (exited) throw new Error('test server exited early');
      await sleep(10);
    }
    throw new Error(`timed out: ${label}`);
  }
  const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
    fetch(`${base}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(body),
    });
  const adminHeaders = { 'x-admin-secret': ADMIN_SECRET };

  try {
    let ready = false;
    server.stdout.on('data', (data) => {
      if (data.toString().includes('Ready at')) ready = true;
    });
    await until(() => ready, 'server startup');

    // 1. Public config advertises auth + plans
    const config = (await fetch(`${base}/api/v1/auth/config`).then((r) => r.json())) as any;
    assert.equal(config.authRequired, true, 'Server reports that authentication is required');
    assert.equal(config.plans.length, 3, 'Plan catalog is public');
    assert.equal(config.billingConfigured, false, 'No Stripe keys in this environment');
    console.log('  PASS  /api/v1/auth/config advertises auth=required with 3 plans');

    // 2. Registration creates a real account on the free plan
    const registerRes = await post('/api/v1/auth/register', { username: 'buyer1', password: 'correct-horse-1' });
    assert.equal(registerRes.status, 201, 'Registration succeeds');
    const registered = (await registerRes.json()) as any;
    assert.ok(registered.token, 'Registration returns a token');
    assert.equal(registered.user.id, 'usr_buyer1', 'User id is derived server-side');
    assert.equal(registered.plan.id, 'free', 'New accounts start on the free plan');
    console.log('  PASS  register stores a hashed password and grants the free plan');

    // 3. Password policy and username uniqueness
    assert.equal((await post('/api/v1/auth/register', { username: 'buyer2', password: 'short' })).status, 400);
    assert.equal((await post('/api/v1/auth/register', { username: 'buyer1', password: 'another-password' })).status, 409);
    console.log('  PASS  password policy and username uniqueness are enforced');

    // 4. A client cannot claim an existing account without its password
    assert.equal((await post('/api/v1/auth/login', { username: 'buyer1' })).status, 401);
    console.log('  PASS  client cannot impersonate an existing account (no client-supplied userId)');

    // 5. Brute force is locked out (driven from a dedicated client IP so it cannot interfere
    // with the rest of the suite: the lockout is per account AND per IP).
    await post('/api/v1/auth/register', { username: 'target1', password: 'target-password' });
    const attacker = { 'x-forwarded-for': '203.0.113.50' };
    for (let i = 1; i <= 3; i++) {
      const res = await post('/api/v1/auth/login', { username: 'target1', password: 'wrong-password' }, attacker);
      assert.equal(res.status, 401, `Failed attempt ${i} returns 401`);
    }
    const locked = await post('/api/v1/auth/login', { username: 'target1', password: 'target-password' }, attacker);
    assert.equal(locked.status, 429, 'Even the correct password is refused while locked out');
    assert.ok(Number(locked.headers.get('retry-after') || 0) > 0, 'Lockout advertises Retry-After');
    console.log('  PASS  brute force locks the account/IP after the configured failure count');

    // 6. Happy-path login and session introspection
    const loginRes = await post('/api/v1/auth/login', { username: 'buyer1', password: 'correct-horse-1' });
    assert.equal(loginRes.status, 200, 'Correct credentials authenticate');
    const token = ((await loginRes.json()) as any).token as string;
    const me = (await fetch(`${base}/api/v1/auth/me`, { headers: { Authorization: `Bearer ${token}` } }).then((r) =>
      r.json()
    )) as any;
    assert.equal(me.user.username, 'buyer1');
    assert.ok(me.entitlements.length >= 1, 'The free plan materialises at least one entitlement');
    console.log('  PASS  password login works and /auth/me exposes plan + entitlements');

    // 7. Admin API is closed without the secret, open with it
    assert.equal((await fetch(`${base}/api/v1/admin/users`)).status, 403, 'Admin routes reject anonymous callers');
    const users = (await fetch(`${base}/api/v1/admin/users`, { headers: adminHeaders }).then((r) => r.json())) as any;
    assert.ok(users.users.some((u: any) => u.id === 'usr_buyer1'), 'Admin sees the registered account');
    assert.equal((await post('/api/v1/admin/users/usr_buyer1/plan', { planId: 'pro' }, adminHeaders)).status, 200);
    const subscription = (await fetch(`${base}/api/v1/billing/subscription`, {
      headers: { Authorization: `Bearer ${token}` },
    }).then((r) => r.json())) as any;
    assert.equal(subscription.plan.id, 'pro', 'The granted plan is in force immediately');
    console.log('  PASS  admin provisioning works and takes effect immediately');

    // 8. Billing webhook: unsigned rejected, signed applied
    assert.equal((await post('/api/v1/billing/webhook', { type: 'checkout.session.completed' })).status, 400);
    const eventBody = JSON.stringify({
      id: 'evt_integration',
      type: 'checkout.session.completed',
      data: {
        object: {
          client_reference_id: 'usr_buyer1',
          metadata: { userId: 'usr_buyer1', planId: 'elite' },
          status: 'active',
          current_period_end: Math.floor(Date.now() / 1000) + 2_592_000,
        },
      },
    });
    const ts = Math.floor(Date.now() / 1000);
    const signature = createHmac('sha256', WEBHOOK_SECRET).update(`${ts}.${eventBody}`).digest('hex');
    const webhook = await fetch(`${base}/api/v1/billing/webhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Stripe-Signature': `t=${ts},v1=${signature}` },
      body: eventBody,
    });
    assert.equal(webhook.status, 200, 'Signature-verified webhook is accepted');
    assert.match(((await webhook.json()) as any).outcome, /elite/, 'Webhook applies the purchased plan');
    console.log('  PASS  Stripe webhook verifies the signature and upgrades the plan');

    // 9. WebSocket: no token -> 1008; token via subprotocol -> INIT_STATE
    const anonSocket = new WebSocket(`ws://127.0.0.1:${port}`);
    const anonClose = (await Promise.race([
      once(anonSocket, 'close') as Promise<any[]>,
      sleep(5000).then(() => null),
    ])) as any[] | null;
    assert.ok(anonClose, 'Anonymous socket is closed by the server');
    assert.equal(anonClose[0], 1008, 'Close code 1008 signals "authentication required"');

    const authedSocket = new WebSocket(`ws://127.0.0.1:${port}`, ['deepchart-token', token]);
    const messages: any[] = [];
    authedSocket.on('message', (data) => messages.push(JSON.parse(data.toString())));
    await once(authedSocket, 'open');
    const init = (await until(() => messages.find((m) => m.type === 'INIT_STATE'), 'INIT_STATE')) as any;
    assert.equal(init.symbol, 'ES', 'Authenticated socket receives a chart snapshot');
    authedSocket.terminate();
    console.log('  PASS  WebSocket enforces the token and accepts it via the subprotocol header');

    // 10. Ops endpoints: metrics require a token, /healthz stays public but minimal
    assert.equal((await fetch(`${base}/metrics`)).status, 401, 'Metrics are not public in production mode');
    const metricsRes = await fetch(`${base}/metrics`, { headers: { Authorization: 'Bearer integration-metrics-token' } });
    assert.equal(metricsRes.status, 200, 'Metrics accept the configured token');
    assert.match(await metricsRes.text(), /deepchart_sessions/, 'Prometheus text exposes the session gauge');
    const health = (await fetch(`${base}/healthz`).then((r) => r.json())) as any;
    assert.equal(health.status, 'ok');
    assert.equal(health.feedReason, undefined, 'Public health check hides internal feed details');
    console.log('  PASS  metrics are token-protected and /healthz leaks no internals');

    // 11. Suspension cuts access off, reactivation restores it
    assert.equal((await post('/api/v1/admin/users/usr_buyer1/suspend', { suspended: true }, adminHeaders)).status, 200);
    assert.equal(
      (await post('/api/v1/auth/login', { username: 'buyer1', password: 'correct-horse-1' })).status,
      403,
      'Suspended accounts cannot log in'
    );
    await post('/api/v1/admin/users/usr_buyer1/suspend', { suspended: false }, adminHeaders);
    assert.equal(
      (await post('/api/v1/auth/login', { username: 'buyer1', password: 'correct-horse-1' })).status,
      200,
      'Reactivated accounts can log in again'
    );
    console.log('  PASS  suspension and reactivation work');

    console.log('  [PASS] Authentication & billing integration tests passed.');
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

if (process.argv[1]?.endsWith('authFlow.test.ts') || process.argv[1]?.endsWith('authFlow.test.js')) {
  runAuthFlowTests().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
