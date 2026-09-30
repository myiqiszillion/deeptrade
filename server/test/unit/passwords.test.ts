import assert from 'node:assert/strict';
import {
  assertPasswordPolicy,
  hashPassword,
  verifyPassword,
  MIN_PASSWORD_LENGTH,
} from '../../src/auth/passwords.js';

export async function runPasswordTests(): Promise<void> {
  console.log('[unit/passwords.test] Running password hashing unit tests...');

  // 1. Hash round-trip
  const hash = hashPassword('correct horse battery staple');
  assert.match(hash, /^scrypt\$\d+\$\d+\$\d+\$/, 'Hash must carry its KDF parameters');
  assert.notEqual(hash, 'correct horse battery staple', 'Plaintext must never be stored');
  assert.equal(verifyPassword('correct horse battery staple', hash), true, 'Correct password verifies');

  // 2. Wrong password is rejected, and the salt makes hashes unique
  assert.equal(verifyPassword('wrong horse battery staple', hash), false, 'Wrong password rejected');
  const secondHash = hashPassword('correct horse battery staple');
  assert.notEqual(hash, secondHash, 'Each hash uses a fresh random salt');
  assert.equal(verifyPassword('correct horse battery staple', secondHash), true);

  // 3. Policy
  assert.throws(() => assertPasswordPolicy('short'), new RegExp(String(MIN_PASSWORD_LENGTH)));
  assert.throws(() => assertPasswordPolicy(undefined), /at least/);
  assert.throws(() => hashPassword('12345'), /at least/);
  assert.doesNotThrow(() => assertPasswordPolicy('long-enough-password'));

  // 4. Malformed / missing stored hashes never authenticate
  assert.equal(verifyPassword('anything', null), false, 'No stored hash -> false');
  assert.equal(verifyPassword('anything', ''), false, 'Empty stored hash -> false');
  assert.equal(verifyPassword('anything', 'plaintext-not-scrypt'), false, 'Unknown format -> false');
  assert.equal(verifyPassword('anything', 'scrypt$0$0$0$AAA$BBB'), false, 'Bogus parameters -> false');
  assert.equal(verifyPassword(undefined, hash), false, 'Non-string password -> false');

  console.log('  [PASS] All password hashing unit tests passed.');
}

if (process.argv[1]?.endsWith('passwords.test.ts') || process.argv[1]?.endsWith('passwords.test.js')) {
  runPasswordTests().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
