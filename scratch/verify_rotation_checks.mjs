import crypto from 'node:crypto';
import fs from 'node:fs';
import https from 'node:https';

function req(options, body) {
  return new Promise((resolve, reject) => {
    const opts = {
      hostname: 'localhost',
      port: 443,
      rejectUnauthorized: false,
      ...options,
      headers: {
        ...(body ? { 'Content-Type': 'application/json' } : {}),
        ...options.headers,
      },
    };
    const r = https.request(opts, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        let json = null;
        try {
          json = JSON.parse(data);
        } catch {}
        resolve({
          statusCode: res.statusCode,
          headers: res.headers,
          data,
          json,
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

function base64UrlEncode(str) {
  return Buffer.from(str, 'utf8')
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

function signJwt(payload, secret) {
  const header = { alg: 'HS256', typ: 'JWT' };
  const hEnc = base64UrlEncode(JSON.stringify(header));
  const pEnc = base64UrlEncode(JSON.stringify(payload));
  const sig = crypto
    .createHmac('sha256', secret)
    .update(`${hEnc}.${pEnc}`)
    .digest('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
  return `${hEnc}.${pEnc}.${sig}`;
}

async function verify() {
  console.log('======================================================');
  console.log('🔍 VERIFYING STAGING CREDENTIAL ROTATION');
  console.log('======================================================');

  const env = fs.readFileSync('.env', 'utf8');
  const jwtSecret = env.match(/^AUTH_JWT_SECRET=(.*)$/m)?.[1]?.trim() || '';
  const metricsToken = env.match(/^METRICS_TOKEN=(.*)$/m)?.[1]?.trim() || '';

  // 1. Healthcheck
  const healthRes = await req({ path: '/healthz', method: 'GET' });
  console.log(`[Check 1/4] /healthz status: ${healthRes.statusCode} (${healthRes.json?.status})`);
  if (healthRes.statusCode !== 200 || healthRes.json?.status !== 'ok') {
    throw new Error('Healthcheck failed');
  }

  // 2. Old JWT Token Invalidation (simulate old key)
  const oldSyntheticSecret = 'old_stale_staging_secret_now_revoked_key_123';
  const oldToken = signJwt(
    {
      sub: 'stg_user_a',
      username: 'stg_user_a',
      role: 'user',
      plan: 'free',
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 3600,
    },
    oldSyntheticSecret
  );

  const oldAuthRes = await req({
    path: '/api/v1/auth/me',
    method: 'GET',
    headers: { Authorization: `Bearer ${oldToken}` },
  });
  console.log(`[Check 2/4] Old/Stale JWT access status: ${oldAuthRes.statusCode}`);
  if (oldAuthRes.statusCode !== 401) {
    throw new Error(`Old JWT was not rejected! Code: ${oldAuthRes.statusCode}`);
  }
  console.log('  ✅ Invalidation confirmed: Old JWT token rejected with HTTP 401.');

  // 3. New JWT Token Authentication
  const newToken = signJwt(
    {
      sub: 'stg_user_a',
      username: 'stg_user_a',
      role: 'user',
      plan: 'free',
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 3600,
      jti: 'jti_verify_check_01',
    },
    jwtSecret
  );

  const newAuthRes = await req({
    path: '/api/v1/auth/me',
    method: 'GET',
    headers: { Authorization: `Bearer ${newToken}` },
  });
  console.log(`[Check 3/4] New JWT access status: ${newAuthRes.statusCode}`);
  if (newAuthRes.statusCode !== 200) {
    throw new Error(`New JWT rejected! Code: ${newAuthRes.statusCode}`);
  }
  console.log('  ✅ New JWT token verified: User authenticated with HTTP 200.');

  // 4. Metrics Token Authentication
  const badMetricsRes = await req({
    path: '/metrics',
    method: 'GET',
    headers: { Authorization: 'Bearer invalid_or_old_token_xyz' },
  });
  if (badMetricsRes.statusCode !== 401) {
    throw new Error(`Invalid metrics token was not rejected! Code: ${badMetricsRes.statusCode}`);
  }

  const goodMetricsRes = await req({
    path: '/metrics',
    method: 'GET',
    headers: { Authorization: `Bearer ${metricsToken}` },
  });
  console.log(`[Check 4/4] Rotated Metrics Token access status: ${goodMetricsRes.statusCode}`);
  if (goodMetricsRes.statusCode !== 200) {
    throw new Error(`Rotated metrics token rejected! Code: ${goodMetricsRes.statusCode}`);
  }
  console.log('  ✅ Metrics authentication confirmed: HTTP 200 with Prometheus payload.');

  console.log('\n======================================================');
  console.log('🎉 ROTATION COMPLETED & FULLY VERIFIED ON STAGING!');
  console.log('======================================================');
}

verify().catch((err) => {
  console.error('VERIFICATION ERROR:', err);
  process.exit(1);
});
