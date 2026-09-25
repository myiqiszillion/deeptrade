import assert from 'node:assert/strict';
import { entitlementService } from '../../src/auth/entitlementService.js';
import { AccessPolicy } from '../../src/auth/accessPolicy.js';
import { User } from '../../src/auth/types.js';

export async function runEntitlementTests(): Promise<void> {
  console.log('[unit/entitlement.test] Running entitlement unit tests...');

  entitlementService.clear();

  // 1. Default Deny
  assert.equal(entitlementService.hasEntitlement('u_none', 'ES', 'FOOTPRINT'), false);
  assert.equal(entitlementService.hasEntitlement('u_none', 'BTCUSDT', 'FOOTPRINT'), false);
  assert.equal(entitlementService.hasEntitlement('u_none', 'ES', 'REPLAY'), false);

  // 2. Specific Symbol & DataType Grant
  entitlementService.grant({
    id: 'ent_es',
    userId: 'u_es_only',
    provider: 'cme',
    exchange: 'CME',
    symbolPattern: 'ES',
    dataTypes: ['FOOTPRINT', 'TICKS', 'BARS'],
    validUntil: Date.now() + 3600000,
    createdAt: Date.now(),
  });

  assert.equal(entitlementService.hasEntitlement('u_es_only', 'ES', 'FOOTPRINT'), true);
  assert.equal(entitlementService.hasEntitlement('u_es_only', 'ES', 'TICKS'), true);
  assert.equal(entitlementService.hasEntitlement('u_es_only', 'ES', 'BARS'), true);
  assert.equal(entitlementService.hasEntitlement('u_es_only', 'ES', 'REPLAY'), false, 'REPLAY not granted');
  assert.equal(entitlementService.hasEntitlement('u_es_only', 'NQ', 'FOOTPRINT'), false, 'NQ not granted');

  // 3. Wildcard Symbol Pattern (ES*)
  entitlementService.grant({
    id: 'ent_es_wildcard',
    userId: 'u_wild',
    provider: 'cme',
    exchange: 'CME',
    symbolPattern: 'ES*',
    dataTypes: ['FOOTPRINT'],
    validUntil: Date.now() + 3600000,
    createdAt: Date.now(),
  });

  assert.equal(entitlementService.hasEntitlement('u_wild', 'ES', 'FOOTPRINT'), true);
  assert.equal(entitlementService.hasEntitlement('u_wild', 'ESH6', 'FOOTPRINT'), true);
  assert.equal(entitlementService.hasEntitlement('u_wild', 'ESM6', 'FOOTPRINT'), true);
  assert.equal(entitlementService.hasEntitlement('u_wild', 'NQ', 'FOOTPRINT'), false);

  // 4. Global Wildcard (*)
  entitlementService.grant({
    id: 'ent_global',
    userId: 'u_admin',
    provider: '*',
    symbolPattern: '*',
    dataTypes: ['FOOTPRINT', 'TICKS', 'BARS', 'REPLAY', 'L2_BOOK'],
    validUntil: Date.now() + 3600000,
    createdAt: Date.now(),
  });

  assert.equal(entitlementService.hasEntitlement('u_admin', 'ES', 'FOOTPRINT'), true);
  assert.equal(entitlementService.hasEntitlement('u_admin', 'NQ', 'REPLAY'), true);
  assert.equal(entitlementService.hasEntitlement('u_admin', 'BTCUSDT', 'L2_BOOK'), true);

  // 5. Expired Entitlement
  entitlementService.grant({
    id: 'ent_expired',
    userId: 'u_exp',
    provider: 'cme',
    symbolPattern: 'ES',
    dataTypes: ['FOOTPRINT'],
    validUntil: Date.now() - 1000, // Expired in the past
    createdAt: Date.now() - 2000,
  });

  assert.equal(entitlementService.hasEntitlement('u_exp', 'ES', 'FOOTPRINT'), false, 'Expired entitlement must be denied');

  // 6. AccessPolicy Tests
  const activeUser: User = { id: 'u_active', username: 'active1', role: 'user', status: 'active' };
  const suspendedUser: User = { id: 'u_susp', username: 'suspended1', role: 'user', status: 'suspended' };

  // Grant entitlement to both
  entitlementService.grant({
    id: 'ent_susp_test',
    userId: 'u_susp',
    provider: 'cme',
    symbolPattern: 'ES',
    dataTypes: ['FOOTPRINT'],
    validUntil: Date.now() + 3600000,
    createdAt: Date.now(),
  });

  // Suspended user is ALWAYS denied regardless of entitlement
  assert.equal(
    AccessPolicy.isAuthorized({ user: suspendedUser, symbol: 'ES', provider: 'cme', dataType: 'FOOTPRINT' }),
    false,
    'Suspended user must be rejected'
  );

  // Guest access to BTCUSDT when AUTH_REQUIRED !== '1'
  const oldAuthReq = process.env.AUTH_REQUIRED;
  try {
    process.env.AUTH_REQUIRED = '0';
    assert.equal(
      AccessPolicy.isAuthorized({ user: null, symbol: 'BTCUSDT', provider: 'binance', dataType: 'FOOTPRINT' }),
      true,
      'BTCUSDT public tier allowed when AUTH_REQUIRED !== 1'
    );

    // Guest access to CME is denied
    assert.equal(
      AccessPolicy.isAuthorized({ user: null, symbol: 'ES', provider: 'tradovate', dataType: 'FOOTPRINT' }),
      false,
      'Guest access to ES must be denied'
    );
  } finally {
    process.env.AUTH_REQUIRED = oldAuthReq;
  }

  console.log('  [PASS] All entitlement unit tests passed.');
}

if (process.argv[1]?.endsWith('entitlement.test.ts') || process.argv[1]?.endsWith('entitlement.test.js')) {
  runEntitlementTests().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
