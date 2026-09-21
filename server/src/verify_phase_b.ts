import assert from 'node:assert';
import http from 'node:http';
import { AddressInfo } from 'node:net';
import WebSocket from 'ws';
import { createToken, verifyToken, revokeToken, isTokenRevoked, clearRevocationList } from './auth/token.js';
import { entitlementService } from './auth/entitlementService.js';
import { User } from './auth/types.js';

console.log('======================================================');
console.log('🧪 RUNNING PHASE B VERIFICATION SUITE (AUTH & ENTITLEMENT)');
console.log('======================================================\n');

let passed = 0;
let failed = 0;

function check(label: string, fn: () => Promise<void> | void): Promise<void> {
  return Promise.resolve()
    .then(() => fn())
    .then(() => {
      passed++;
      console.log(`  PASS  ${label}`);
    })
    .catch((err) => {
      failed++;
      console.error(`  FAIL  ${label}:`, (err as Error).message);
    });
}

async function runAll() {
  // ---------------------------------------------------------------------------
  // 1. Token Creation, Verification and Revocation
  // ---------------------------------------------------------------------------
  await check('Token creation and verification works with HMAC-SHA256', () => {
    const user: User = { id: 'u1', username: 'trader1', role: 'user', status: 'active' };
    const token = createToken(user, 3600);
    assert.ok(typeof token === 'string' && token.split('.').length === 3);

    const verified = verifyToken(token);
    assert.ok(verified);
    assert.strictEqual(verified.sub, 'u1');
    assert.strictEqual(verified.username, 'trader1');
    assert.strictEqual(verified.role, 'user');
    assert.ok(verified.exp > verified.iat);
  });

  await check('Tampered token is rejected', () => {
    const user: User = { id: 'u2', username: 'trader2', role: 'user', status: 'active' };
    const token = createToken(user, 3600);
    const parts = token.split('.');
    const tampered = `${parts[0]}.${parts[1]}xyz.${parts[2]}`;

    const verified = verifyToken(tampered);
    assert.strictEqual(verified, null);
  });

  await check('Token revocation blocks previously valid token', () => {
    clearRevocationList();
    const user: User = { id: 'u3', username: 'trader3', role: 'user', status: 'active' };
    const token = createToken(user, 3600);
    const verified = verifyToken(token);
    assert.ok(verified);

    revokeToken(verified.jti);
    assert.strictEqual(isTokenRevoked(verified.jti), true);

    const recheck = verifyToken(token);
    assert.strictEqual(recheck, null);
  });

  // ---------------------------------------------------------------------------
  // 2. Entitlement Scoping & Fail-Closed Logic
  // ---------------------------------------------------------------------------
  await check('Entitlement default-deny: user with no entitlement is denied', () => {
    entitlementService.clear();
    assert.strictEqual(entitlementService.hasEntitlement('u_no_ent', 'ES', 'FOOTPRINT'), false);
    assert.strictEqual(entitlementService.hasEntitlement('u_no_ent', 'BTCUSDT', 'FOOTPRINT'), false);
    assert.strictEqual(entitlementService.hasEntitlement('u_no_ent', 'ES', 'REPLAY'), false);
  });

  await check('Entitlement granted specifically for CME ES allows ES but denies NQ', () => {
    entitlementService.clear();
    entitlementService.grant({
      id: 'ent-1',
      userId: 'u_es_only',
      provider: 'cme',
      exchange: 'CME',
      symbolPattern: 'ES',
      dataTypes: ['FOOTPRINT', 'TICKS', 'BARS'],
      validUntil: Date.now() + 3600000,
      createdAt: Date.now(),
    });

    assert.strictEqual(entitlementService.hasEntitlement('u_es_only', 'ES', 'FOOTPRINT'), true);
    assert.strictEqual(entitlementService.hasEntitlement('u_es_only', 'ES', 'TICKS'), true);
    assert.strictEqual(entitlementService.hasEntitlement('u_es_only', 'ES', 'BARS'), true);
    assert.strictEqual(entitlementService.hasEntitlement('u_es_only', 'ES', 'REPLAY'), false); // REPLAY not granted
    assert.strictEqual(entitlementService.hasEntitlement('u_es_only', 'NQ', 'FOOTPRINT'), false); // NQ not granted
  });

  await check('Entitlement with wildcard symbol pattern ES* covers ES and MES', () => {
    entitlementService.clear();
    entitlementService.grant({
      id: 'ent-2',
      userId: 'u_es_pattern',
      provider: 'cme',
      exchange: 'CME',
      symbolPattern: 'ES*',
      dataTypes: ['*'],
      validUntil: Date.now() + 3600000,
      createdAt: Date.now(),
    });

    assert.strictEqual(entitlementService.hasEntitlement('u_es_pattern', 'ES', 'FOOTPRINT'), true);
    assert.strictEqual(entitlementService.hasEntitlement('u_es_pattern', 'ES', 'REPLAY'), true);
    assert.strictEqual(entitlementService.hasEntitlement('u_es_pattern', 'NQ', 'FOOTPRINT'), false);
  });

  await check('Expired entitlement is rejected (fail-closed)', () => {
    entitlementService.clear();
    entitlementService.grant({
      id: 'ent-expired',
      userId: 'u_expired',
      provider: 'cme',
      symbolPattern: '*',
      dataTypes: ['*'],
      validUntil: Date.now() - 1000, // expired 1s ago
      createdAt: Date.now() - 3600000,
    });

    assert.strictEqual(entitlementService.hasEntitlement('u_expired', 'ES', 'FOOTPRINT'), false);
  });

  await check('Revoking entitlement notifies listeners and immediately removes access', () => {
    entitlementService.clear();
    let notifiedUser = '';
    let notifiedEntId = '';

    const unsub = entitlementService.onRevocation((userId, ent) => {
      notifiedUser = userId;
      notifiedEntId = ent.id;
    });

    entitlementService.grant({
      id: 'ent-to-revoke',
      userId: 'u_revoked',
      provider: 'cme',
      symbolPattern: 'ES',
      dataTypes: ['FOOTPRINT'],
      validUntil: Date.now() + 3600000,
      createdAt: Date.now(),
    });

    assert.strictEqual(entitlementService.hasEntitlement('u_revoked', 'ES', 'FOOTPRINT'), true);

    const revoked = entitlementService.revoke('u_revoked', 'ent-to-revoke');
    assert.strictEqual(revoked, true);
    assert.strictEqual(entitlementService.hasEntitlement('u_revoked', 'ES', 'FOOTPRINT'), false);
    assert.strictEqual(notifiedUser, 'u_revoked');
    assert.strictEqual(notifiedEntId, 'ent-to-revoke');

    unsub();
  });

  console.log('\n======================================================');
  console.log(`Results: ${passed} passed, ${failed} failed`);
  console.log('======================================================\n');

  if (failed > 0) process.exit(1);
  process.exit(0);
}

void runAll();
