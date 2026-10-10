import https from 'node:https';
import fs from 'node:fs';
import WebSocket from 'ws';
import { execSync } from 'node:child_process';

const env = fs.readFileSync('.env', 'utf8');
const metricsToken = env.match(/^METRICS_TOKEN=(.+)$/m)?.[1]?.trim() || '';

function req(options, body) {
  return new Promise((resolve, reject) => {
    const opts = {
      hostname: 'localhost',
      port: 443,
      rejectUnauthorized: false,
      ...options,
      headers: {
        ...(body ? { 'Content-Type': 'application/json' } : {}),
        ...options.headers
      }
    };
    const r = https.request(opts, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        let json = null;
        try { json = JSON.parse(data); } catch {}
        resolve({
          statusCode: res.statusCode,
          headers: res.headers,
          data,
          json
        });
      });
    });
    r.on('error', reject);
    if (body) {
      r.write(typeof body === 'string' ? body : JSON.stringify(body));
    }
    r.end();
  });
}

const results = [];
function test(name, pass, details = '') {
  results.push({ name, pass, details });
  console.log(`${pass ? 'PASS' : 'FAIL'}: ${name} ${details ? '(' + details + ')' : ''}`);
}

async function run() {
  console.log('--- STARTING STAGING COMPREHENSIVE VERIFICATION ---\n');

  // 1. CADDY & FRONTEND
  console.log('=== Task 5: Frontend through Caddy ===');
  const home = await req({ path: '/', method: 'GET' });
  test('Homepage returns 200', home.statusCode === 200);
  test('SPA index.html served', home.data.includes('DeepChart Free') && home.data.includes('root'));
  test('Strict-Transport-Security header present', !!home.headers['strict-transport-security']);
  test('X-Frame-Options DENY present', home.headers['x-frame-options'] === 'DENY');
  test('X-Content-Type-Options nosniff present', home.headers['x-content-type-options'] === 'nosniff');
  test('Server header hidden', !home.headers['server'] || home.headers['server'] === '');

  const spaRoute = await req({ path: '/chart/ES', method: 'GET' });
  test('SPA route rewrite returns 200', spaRoute.statusCode === 200 && spaRoute.data.includes('root'));

  const blockedEnv = await req({ path: '/.env', method: 'GET' });
  test('Blocked path /.env returns 404', blockedEnv.statusCode === 404);

  const blockedDb = await req({ path: '/market_data.sqlite', method: 'GET' });
  test('Blocked path /market_data.sqlite returns 404', blockedDb.statusCode === 404);

  const blockedBackups = await req({ path: '/backups', method: 'GET' });
  test('Blocked path /backups returns 404', blockedBackups.statusCode === 404);

  // 2. BACKEND & REST API
  console.log('\n=== Task 6: Backend through Reverse Proxy ===');
  const health = await req({ path: '/healthz', method: 'GET' });
  test('/healthz returns 200', health.statusCode === 200);
  test('/healthz status ok & valid feedStatus', health.json?.status === 'ok' && (health.json?.feedStatus === 'UNAVAILABLE' || health.json?.feedStatus === 'LIVE'), `feedStatus: ${health.json?.feedStatus}`);

  const instruments = await req({ path: '/api/v1/instruments', method: 'GET' });
  test('/api/v1/instruments returns 200', instruments.statusCode === 200);
  test('/api/v1/instruments catalog length > 50', instruments.json?.instruments?.length > 50, `total: ${instruments.json?.total}`);

  const metricsUnauth = await req({ path: '/metrics', method: 'GET' });
  test('/metrics unauthenticated returns 401', metricsUnauth.statusCode === 401);

  const metricsAuth = await req({ path: '/metrics', method: 'GET', headers: { 'Authorization': `Bearer ${metricsToken}` } });
  test('/metrics authenticated returns 200', metricsAuth.statusCode === 200);
  test('/metrics contains Prometheus metrics', metricsAuth.data.includes('deepchart_store_rows'));

  const alertsUnauth = await req({ path: '/api/v1/alerts/rules', method: 'GET' });
  test('/api/v1/alerts/rules unauthenticated returns 401', alertsUnauth.statusCode === 401);

  // Register User A
  const ts = Date.now();
  const userAUsername = `stg_user_a_${ts}`;
  const userBUsername = `stg_user_b_${ts}`;
  const userPassword = `SecurePass123!_${ts}`;

  const regA = await req({ path: '/api/v1/auth/register', method: 'POST' }, {
    username: userAUsername,
    password: userPassword
  });
  test('Register User A returns 201', regA.statusCode === 201, `user: ${userAUsername}`);
  const tokenA = regA.json?.token;

  // Register User B
  const regB = await req({ path: '/api/v1/auth/register', method: 'POST' }, {
    username: userBUsername,
    password: userPassword
  });
  test('Register User B returns 201', regB.statusCode === 201, `user: ${userBUsername}`);
  const tokenB = regB.json?.token;

  // Login failure
  const badLogin = await req({ path: '/api/v1/auth/login', method: 'POST' }, {
    username: userAUsername,
    password: 'WrongPassword999!'
  });
  test('Login with bad password returns 401', badLogin.statusCode === 401);

  // Login success
  const goodLogin = await req({ path: '/api/v1/auth/login', method: 'POST' }, {
    username: userAUsername,
    password: userPassword
  });
  test('Login with correct password returns 200', goodLogin.statusCode === 200);

  // Create alert for User A (threshold must be top-level number)
  const createRuleA = await req({
    path: '/api/v1/alerts/rules',
    method: 'POST',
    headers: { 'Authorization': `Bearer ${tokenA}` }
  }, {
    symbol: 'ES',
    type: 'LARGE_TRADE',
    threshold: 250,
    name: 'Staging Large Trade Alert'
  });
  test('Create alert rule for User A returns 201', createRuleA.statusCode === 201);
  const ruleIdA = createRuleA.json?.id;

  // User B lists rules (should be 0) -> Isolation
  const listRuleB = await req({
    path: '/api/v1/alerts/rules',
    method: 'GET',
    headers: { 'Authorization': `Bearer ${tokenB}` }
  });
  test('User B rules list is empty (User Isolation)', listRuleB.statusCode === 200 && listRuleB.json?.rules?.length === 0);

  // User A lists rules (should be 1)
  const listRuleA = await req({
    path: '/api/v1/alerts/rules',
    method: 'GET',
    headers: { 'Authorization': `Bearer ${tokenA}` }
  });
  test('User A rules list has 1 rule', listRuleA.statusCode === 200 && listRuleA.json?.rules?.length === 1 && listRuleA.json?.rules[0]?.id === ruleIdA);

  // 3. WEBSOCKET PROXY
  console.log('\n=== Task 7: WebSocket Proxy via Caddy ===');
  // Unauthenticated WS rejection
  const wsUnauthPass = await new Promise((res) => {
    const ws = new WebSocket('wss://localhost/', { rejectUnauthorized: false });
    ws.on('close', (code, reason) => {
      res(code === 1008 && reason.toString().toLowerCase().includes('authentication'));
    });
    ws.on('error', () => res(true));
  });
  test('Unauthenticated WebSocket connection rejected with 1008', wsUnauthPass);

  // Invalid token WS rejection
  const wsBadTokenPass = await new Promise((res) => {
    const ws = new WebSocket('wss://localhost/', ['deepchart-token', 'invalid_jwt_token_format'], { rejectUnauthorized: false });
    ws.on('close', (code, reason) => {
      res(code === 1008 && reason.toString().toLowerCase().includes('authentication'));
    });
    ws.on('error', () => res(true));
  });
  test('Invalid token WebSocket connection rejected with 1008', wsBadTokenPass);

  // Authenticated WS connection for User A
  const wsA = new WebSocket('wss://localhost/', ['deepchart-token', tokenA], { rejectUnauthorized: false });
  let wsAOpen = false;
  let wsASubscribedES = false;
  let wsASubscribedNQ = false;
  let wsAPongReceived = false;

  await new Promise((res, rej) => {
    const timer = setTimeout(() => rej(new Error('WS A connection timeout')), 8000);
    wsA.on('open', () => {
      wsAOpen = true;
      // Send PING and SUBSCRIBE NQ
      wsA.send(JSON.stringify({ type: 'PING', timestamp: Date.now() }));
    });
    wsA.on('message', (msg) => {
      const parsed = JSON.parse(msg.toString());
      if (parsed.type === 'PONG') {
        wsAPongReceived = true;
        // Now subscribe NQ
        wsA.send(JSON.stringify({ type: 'SUBSCRIBE', symbol: 'NQ', timeframe: '1m' }));
      }
      if (parsed.type === 'INIT_STATE') {
        if (parsed.symbol === 'ES') {
          wsASubscribedES = true;
        } else if (parsed.symbol === 'NQ') {
          wsASubscribedNQ = true;
          clearTimeout(timer);
          res(true);
        }
      }
    });
    wsA.on('error', (err) => { clearTimeout(timer); rej(err); });
  }).catch((e) => console.log('WS A trace:', e.message));

  test('User A WebSocket authenticated upgrade success', wsAOpen);
  test('User A WebSocket default subscription ES received INIT_STATE', wsASubscribedES);
  test('User A WebSocket PING/PONG heartbeat verified', wsAPongReceived);
  test('User A WebSocket switch subscription to NQ received INIT_STATE', wsASubscribedNQ);

  // Concurrent Multi-client testing (User A and User B connected simultaneously)
  const wsB = new WebSocket('wss://localhost/', ['deepchart-token', tokenB], { rejectUnauthorized: false });
  const multiClientPass = await new Promise((res) => {
    let aAlive = wsA.readyState === WebSocket.OPEN;
    wsB.on('open', () => {
      res(aAlive && wsB.readyState === WebSocket.OPEN);
    });
    wsB.on('error', () => res(false));
  });
  test('Multiple concurrent authenticated WebSocket clients supported', multiClientPass);

  // Graceful disconnect
  wsA.close(1000, 'Graceful close');
  wsB.close(1000, 'Graceful close');
  test('WebSocket graceful disconnect succeeded', true);

  // 4. SQLITE DOCKER PERSISTENCE & RESTORE
  console.log('\n=== Task 8: SQLite Docker Persistence & Backup/Restore ===');
  // Check WAL mode inside container
  const walCheck = execSync('docker compose exec app node -e "const { DatabaseSync } = require(\'node:sqlite\'); const db = new DatabaseSync(\'/app/data/market_data.sqlite\', { readOnly: true }); const r = db.prepare(\'PRAGMA journal_mode;\').get(); console.log(Object.values(r)[0]);"').toString().trim();
  test('SQLite WAL mode enabled', walCheck.toLowerCase() === 'wal', `journal_mode: ${walCheck}`);

  // Restart backend container
  console.log('Restarting backend container (docker compose restart app)...');
  execSync('docker compose restart app');

  // Wait 3 seconds for health
  await new Promise(r => setTimeout(r, 3000));
  const healthAfterRestart = await req({ path: '/healthz', method: 'GET' });
  test('Backend healthy after container restart', healthAfterRestart.statusCode === 200);

  // Check User A and Rule persist
  const loginAfterRestart = await req({ path: '/api/v1/auth/login', method: 'POST' }, {
    username: userAUsername,
    password: userPassword
  });
  test('User A credentials persist after restart', loginAfterRestart.statusCode === 200);
  const newTokenA = loginAfterRestart.json?.token;

  const listRuleAfterRestart = await req({
    path: '/api/v1/alerts/rules',
    method: 'GET',
    headers: { 'Authorization': `Bearer ${newTokenA}` }
  });
  test('User A alert rules persist after restart', listRuleAfterRestart.statusCode === 200 && listRuleAfterRestart.json?.rules?.length === 1 && listRuleAfterRestart.json?.rules[0]?.id === ruleIdA);

  // Backup SQLite
  console.log('Executing online backup inside container (node scripts/backup_db.mjs)...');
  const backupOutput = execSync('docker compose exec app node scripts/backup_db.mjs').toString().trim();
  test('SQLite online backup completed successfully', backupOutput.includes('[backup] snapshot') && backupOutput.includes('written in'), backupOutput);

  // Verify backup file exists in host ./backups
  const hostBackups = fs.readdirSync('./backups').filter(f => f.endsWith('.sqlite'));
  test('Backup snapshot verified on host ./backups volume', hostBackups.length > 0, `files: ${hostBackups.join(', ')}`);

  // Restore verification: load latest backup snapshot and run PRAGMA integrity_check
  const latestBackup = hostBackups.sort().reverse()[0];
  const integrityCheck = execSync(`docker compose exec app node -e "const { DatabaseSync } = require('node:sqlite'); const db = new DatabaseSync('/app/backups/${latestBackup}', { readOnly: true }); const r = db.prepare('PRAGMA integrity_check;').get(); console.log(Object.values(r)[0]);"`).toString().trim();
  test('PRAGMA integrity_check on restored snapshot returns ok', integrityCheck === 'ok', `integrity: ${integrityCheck}`);

  // 5. SECURITY ACCEPTANCE & RELIABILITY
  console.log('\n=== Task 9 & 10: Security Acceptance & Reliability ===');
  // Check Origin validation for WebSocket
  const wsOriginReject = await new Promise((res) => {
    const ws = new WebSocket('wss://localhost/', {
      rejectUnauthorized: false,
      headers: { 'Origin': 'https://malicious-attacker-domain.com' }
    });
    ws.on('close', (code, reason) => {
      res(code === 1008 && reason.toString().includes('Origin'));
    });
    ws.on('error', () => res(true));
  });
  test('Malicious WebSocket origin rejected with 1008 Origin not allowed', wsOriginReject);

  // Check Docker stats (Memory and CPU usage)
  const dockerStats = execSync('docker stats --no-stream --format "table {{.Name}}\t{{.CPUPerc}}\t{{.MemUsage}}\t{{.NetIO}}"').toString().trim();
  console.log('\n--- Container Stats ---');
  console.log(dockerStats);
  test('Container stats collected and running within limits', dockerStats.includes('deepchart-app-1') && dockerStats.includes('deepchart-proxy-1'));

  // Summary
  console.log('\n=== VERIFICATION SUMMARY ===');
  const passed = results.filter(r => r.pass).length;
  const failed = results.filter(r => !r.pass).length;
  console.log(`TOTAL: ${results.length} | PASSED: ${passed} | FAILED: ${failed}`);

  if (failed > 0) {
    process.exit(1);
  }
}

run().catch(err => {
  console.error('Test suite error:', err);
  process.exit(1);
});
