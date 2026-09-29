import assert from 'node:assert/strict';
import { spawn, ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import net from 'node:net';
import { fileURLToPath } from 'node:url';

async function getFreePort(): Promise<number> {
  const probe = net.createServer();
  probe.listen(0, '127.0.0.1');
  await once(probe, 'listening');
  const port = (probe.address() as net.AddressInfo).port;
  await new Promise((resolve) => probe.close(resolve));
  return port;
}

async function runAuthSecurityVerification() {
  console.log('=== STARTING AUTH SECURITY VERIFICATION ===');
  const port = await getFreePort();
  const root = fileURLToPath(new URL('../', import.meta.url));
  const serverPath = fileURLToPath(new URL('../server/dist/index.js', import.meta.url));
  const ADMIN_SECRET = 'super-secret-admin-key-at-least-32-chars-long';

  const env = {
    ...process.env,
    NODE_ENV: 'test',
    PORT: String(port),
    HOST: '127.0.0.1',
    ADMIN_SECRET,
    AUTH_REQUIRED: '1',
  };

  const server = spawn(process.execPath, [serverPath], {
    cwd: root,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let exited = false;
  server.on('exit', () => { exited = true; });

  try {
    let ready = false;
  server.stdout.on('data', (d) => {
    console.log('[server out]', d.toString());
    if (d.toString().includes('Ready at') || d.toString().includes('Web terminal')) ready = true;
  });
  server.stderr.on('data', (d) => {
    console.error('[server err]', d.toString());
  });

    const deadline = Date.now() + 6000;
    while (!ready && Date.now() < deadline) {
      if (exited) throw new Error('Server exited prematurely');
      await new Promise((r) => setTimeout(r, 50));
    }
    assert.ok(ready, 'Server started');
    const base = `http://127.0.0.1:${port}`;

    // -------------------------------------------------------------
    // Case A: Attacker attempts to self-assign role: "admin"
    // -------------------------------------------------------------
    console.log('[Case A] Testing attacker self-assigning role: admin...');
    const resA = await fetch(`${base}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'attacker_1', role: 'admin' }),
    });
    assert.equal(resA.status, 200);
    const bodyA = (await resA.json()) as any;
    assert.equal(bodyA.user.role, 'user', 'Body user.role MUST be "user"');
    const partsA = bodyA.token.split('.');
    const payloadA = JSON.parse(Buffer.from(partsA[1], 'base64url').toString());
    assert.equal(payloadA.role, 'user', 'JWT payload role MUST be "user"');
    console.log('  -> PASS: Attacker received role="user". Cannot self-assign admin.');

    // -------------------------------------------------------------
    // Case B: Normal login with no role specified
    // -------------------------------------------------------------
    console.log('[Case B] Testing normal login without role...');
    const resB = await fetch(`${base}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'trader_bob' }),
    });
    assert.equal(resB.status, 200);
    const bodyB = (await resB.json()) as any;
    assert.equal(bodyB.user.role, 'user', 'Normal login must have role="user"');
    const payloadB = JSON.parse(Buffer.from(bodyB.token.split('.')[1], 'base64url').toString());
    assert.equal(payloadB.role, 'user');
    console.log('  -> PASS: Normal login received role="user".');

    // -------------------------------------------------------------
    // Case C: Legitimate Admin Login with ADMIN_SECRET
    // -------------------------------------------------------------
    console.log('[Case C] Testing legitimate admin login with ADMIN_SECRET...');
    const resC = await fetch(`${base}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'superadmin', role: 'admin', adminSecret: ADMIN_SECRET }),
    });
    assert.equal(resC.status, 200);
    const bodyC = (await resC.json()) as any;
    assert.equal(bodyC.user.role, 'admin', 'Valid adminSecret MUST grant role="admin"');
    const payloadC = JSON.parse(Buffer.from(bodyC.token.split('.')[1], 'base64url').toString());
    assert.equal(payloadC.role, 'admin', 'JWT payload MUST be "admin"');
    console.log('  -> PASS: Authorized admin login succeeded with role="admin".');

    // -------------------------------------------------------------
    // Case D: Invalid admin secret
    // -------------------------------------------------------------
    console.log('[Case D] Testing invalid admin secret...');
    const resD = await fetch(`${base}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'fakeadmin', role: 'admin', adminSecret: 'wrong_secret_123' }),
    });
    assert.equal(resD.status, 200);
    const bodyD = (await resD.json()) as any;
    assert.equal(bodyD.user.role, 'user', 'Invalid adminSecret MUST NOT grant admin (fallback to "user")');
    const payloadD = JSON.parse(Buffer.from(bodyD.token.split('.')[1], 'base64url').toString());
    assert.equal(payloadD.role, 'user', 'JWT payload role MUST be "user"');
    console.log('  -> PASS: Invalid admin secret rejected; role="user" issued.');

    // -------------------------------------------------------------
    // Protected Endpoint Testing: /api/v1/auth/me
    // -------------------------------------------------------------
    console.log('[Protected Endpoint] Testing /api/v1/auth/me authorization...');
    // 1. Without token
    const resMeAnon = await fetch(`${base}/api/v1/auth/me`);
    assert.equal(resMeAnon.status, 401, 'Anonymous request to /api/v1/auth/me must return 401');

    // 2. With invalid token
    const resMeInvalid = await fetch(`${base}/api/v1/auth/me`, {
      headers: { Authorization: 'Bearer invalid.jwt.token' },
    });
    assert.equal(resMeInvalid.status, 401, 'Invalid token must return 401');

    // 3. With attacker token (role = user)
    const resMeAttacker = await fetch(`${base}/api/v1/auth/me`, {
      headers: { Authorization: `Bearer ${bodyA.token}` },
    });
    assert.equal(resMeAttacker.status, 200);
    const bodyMeAttacker = (await resMeAttacker.json()) as any;
    assert.equal(bodyMeAttacker.user.role, 'user', 'Attacker token must have user role in /me');

    // 4. With admin token (role = admin)
    const resMeAdmin = await fetch(`${base}/api/v1/auth/me`, {
      headers: { Authorization: `Bearer ${bodyC.token}` },
    });
    assert.equal(resMeAdmin.status, 200);
    const bodyMeAdmin = (await resMeAdmin.json()) as any;
    assert.equal(bodyMeAdmin.user.role, 'admin', 'Admin token must have admin role in /me');
    console.log('  -> PASS: /api/v1/auth/me correctly authenticates and reflects true role.');

    console.log('\n✅ ALL AUTH SECURITY VERIFICATION CASES PASSED!\n');
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

runAuthSecurityVerification().catch((err) => {
  console.error('❌ Auth Verification Failed:', err);
  process.exit(1);
});
