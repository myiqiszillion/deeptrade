import assert from 'node:assert/strict';
import {
  createToken,
  verifyToken,
  revokeToken,
  isTokenRevoked,
  clearRevocationList,
  assertProductionSecretValid,
} from '../../src/auth/token.js';
import { User } from '../../src/auth/types.js';

export async function runAuthTests(): Promise<void> {
  console.log('[unit/auth.test] Running authentication unit tests...');

  // 1. Token Creation & Verification
  const user: User = { id: 'user_1', username: 'trader1', role: 'user', status: 'active' };
  const token = createToken(user, 3600);
  assert.ok(typeof token === 'string' && token.split('.').length === 3, 'Token must be a valid 3-part JWT');

  const verified = verifyToken(token);
  assert.ok(verified, 'Valid token must be verified');
  assert.equal(verified.sub, 'user_1');
  assert.equal(verified.username, 'trader1');
  assert.equal(verified.role, 'user');
  assert.ok(verified.jti, 'Token must contain jti');
  assert.ok(verified.exp > verified.iat, 'exp must be greater than iat');

  // 2. Tampered Token Rejection
  const parts = token.split('.');
  const tampered = `${parts[0]}.${parts[1]}corrupted.${parts[2]}`;
  assert.equal(verifyToken(tampered), null, 'Tampered token signature must be rejected');

  // 3. Malformed Token Rejection
  assert.equal(verifyToken('not-a-token'), null, 'Malformed token string must return null');
  assert.equal(verifyToken('a.b'), null, '2-part token must return null');

  // 4. Token Revocation
  clearRevocationList();
  const revUser: User = { id: 'user_rev', username: 'revTrader', role: 'user', status: 'active' };
  const revToken = createToken(revUser, 3600);
  const revPayload = verifyToken(revToken);
  assert.ok(revPayload);

  assert.equal(isTokenRevoked(revPayload.jti), false, 'Token should not be revoked initially');
  revokeToken(revPayload.jti, revUser.id, revPayload.exp);
  assert.equal(isTokenRevoked(revPayload.jti), true, 'Token must be marked as revoked');
  assert.equal(verifyToken(revToken), null, 'Revoked token must fail verification');

  // 5. Production Secret Validation
  // Valid secret (>= 32 chars)
  assert.doesNotThrow(() => {
    assertProductionSecretValid('this-is-a-valid-production-secret-with-at-least-32-characters');
  });

  // Default / short secrets rejected in production
  assert.throws(() => {
    assertProductionSecretValid('short');
  }, /at least 32 characters/);

  assert.throws(() => {
    assertProductionSecretValid('deepchart-dev-fallback-secret-for-offline-testing-only');
  }, /default or insecure dev secret/);

  console.log('  [PASS] All auth unit tests passed.');
}

if (process.argv[1]?.endsWith('auth.test.ts') || process.argv[1]?.endsWith('auth.test.js')) {
  runAuthTests().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
