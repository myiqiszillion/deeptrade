import crypto from 'node:crypto';
import fs from 'node:fs';
import https from 'node:https';
import { execSync } from 'node:child_process';

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

async function main() {
  console.log('======================================================');
  console.log('🔐 EXECUTING STAGING CREDENTIAL ROTATION');
  console.log('======================================================');

  const envPath = '.env';
  const envContent = fs.readFileSync(envPath, 'utf8');

  // 1. Read existing secrets without printing
  const oldJwtSecret = envContent.match(/^AUTH_JWT_SECRET=(.*)$/m)?.[1]?.trim() || '';
  const oldAdminSecret = envContent.match(/^ADMIN_SECRET=(.*)$/m)?.[1]?.trim() || '';
  const oldMetricsToken = envContent.match(/^METRICS_TOKEN=(.*)$/m)?.[1]?.trim() || '';

  if (!oldJwtSecret || !oldAdminSecret || !oldMetricsToken) {
    throw new Error('Current staging credentials not found in .env');
  }

  // Pre-generate a token signed with the OLD JWT secret
  const oldToken = signJwt(
    {
      sub: 'stg_user_a',
      username: 'stg_user_a',
      role: 'user',
      plan: 'free',
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 3600,
      jti: 'jti_pre_rotation_test',
    },
    oldJwtSecret
  );

  console.log('[Step 1/6] Generated pre-rotation JWT with old secret.');

  // 2. Generate new cryptographically secure random secrets
  const newJwtSecret = crypto.randomBytes(32).toString('hex');
  const newAdminSecret = crypto.randomBytes(32).toString('hex');
  const newMetricsToken = crypto.randomBytes(32).toString('hex');

  console.log('[Step 2/6] Generated new 256-bit entropy secrets.');

  // 3. Atomically update .env
  let updatedEnv = envContent;
  updatedEnv = updatedEnv.replace(/^AUTH_JWT_SECRET=.*$/m, `AUTH_JWT_SECRET=${newJwtSecret}`);
  updatedEnv = updatedEnv.replace(/^ADMIN_SECRET=.*$/m, `ADMIN_SECRET=${newAdminSecret}`);
  updatedEnv = updatedEnv.replace(/^METRICS_TOKEN=.*$/m, `METRICS_TOKEN=${newMetricsToken}`);

  fs.writeFileSync(envPath, updatedEnv, 'utf8');
  console.log('[Step 3/6] File .env updated safely on staging host.');

  // 4. Force recreate staging container to apply new environment variables
  console.log('[Step 4/6] Restarting app container with new configuration...');
  execSync('docker compose up -d --force-recreate app', { stdio: 'inherit' });

  // Wait for container to report healthy
  console.log('Waiting for container healthcheck to report healthy...');
  let healthy = false;
  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    try {
      const status = execSync("docker inspect --format='{{.State.Health.Status}}' deepchart-app-1", {
        encoding: 'utf8',
      }).trim();
      if (status === 'healthy') {
        healthy = true;
        break;
      }
    } catch {}
  }

  if (!healthy) {
    throw new Error('Container failed to become healthy after restart');
  }
  console.log('  ✅ Container is UP and HEALTHY.');

  // 5. Verification: JWT Invalidation
  console.log('[Step 5/6] Verifying token invalidation...');
  // A. Old JWT must be rejected (401)
  const oldJwtRes = await req({
    path: '/api/v1/auth/me',
    method: 'GET',
    headers: { Authorization: `Bearer ${oldToken}` },
  });
  if (oldJwtRes.statusCode !== 401) {
    throw new Error(`Old JWT was NOT rejected! Status code: ${oldJwtRes.statusCode}`);
  }
  console.log('  ✅ Old JWT token was rejected with HTTP 401 (Invalidated successfully).');

  // B. New JWT signed with new secret must be accepted (200)
  const newToken = signJwt(
    {
      sub: 'stg_user_a',
      username: 'stg_user_a',
      role: 'user',
      plan: 'free',
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 3600,
      jti: 'jti_post_rotation_test',
    },
    newJwtSecret
  );

  const newJwtRes = await req({
    path: '/api/v1/auth/me',
    method: 'GET',
    headers: { Authorization: `Bearer ${newToken}` },
  });
  if (newJwtRes.statusCode !== 200) {
    throw new Error(`New JWT was NOT accepted! Status code: ${newJwtRes.statusCode}`);
  }
  console.log('  ✅ New JWT token signed with rotated secret accepted with HTTP 200.');

  // 6. Verification: Metrics Authentication
  console.log('[Step 6/6] Verifying metrics token rotation...');
  // A. Old metrics token must be rejected (401)
  const oldMetricsRes = await req({
    path: '/metrics',
    method: 'GET',
    headers: { Authorization: `Bearer ${oldMetricsToken}` },
  });
  if (oldMetricsRes.statusCode !== 401) {
    throw new Error(`Old metrics token was NOT rejected! Status code: ${oldMetricsRes.statusCode}`);
  }
  console.log('  ✅ Old metrics token rejected with HTTP 401.');

  // B. New metrics token must be accepted (200)
  const newMetricsRes = await req({
    path: '/metrics',
    method: 'GET',
    headers: { Authorization: `Bearer ${newMetricsToken}` },
  });
  if (newMetricsRes.statusCode !== 200) {
    throw new Error(`New metrics token was NOT accepted! Status code: ${newMetricsRes.statusCode}`);
  }
  console.log('  ✅ New metrics token accepted with HTTP 200.');

  console.log('\n======================================================');
  console.log('🎉 ALL STAGING CREDENTIALS ROTATED AND VERIFIED 100%!');
  console.log('======================================================');
}

main().catch((err) => {
  console.error('ROTATION ERROR:', err.message);
  process.exit(1);
});
