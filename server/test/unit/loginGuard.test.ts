import assert from 'node:assert/strict';
import { LoginGuard } from '../../src/auth/loginGuard.js';
import { SlidingWindowLimiter } from '../../src/util/rateLimiter.js';

export async function runLoginGuardTests(): Promise<void> {
  console.log('[unit/loginGuard.test] Running brute-force protection unit tests...');

  // 1. Lockout after N failures, per key
  const guard = new LoginGuard(5, 15 * 60_000, 15 * 60_000);
  const keys = ['user:alice', 'ip:10.0.0.1'];
  const t0 = 1_000_000;
  for (let i = 0; i < 4; i++) guard.recordFailure(keys, t0);
  assert.equal(guard.check(keys, t0).locked, false, 'Four failures must not lock yet');
  guard.recordFailure(keys, t0);
  const locked = guard.check(keys, t0);
  assert.equal(locked.locked, true, 'Fifth failure locks the account');
  assert.ok(locked.retryAfterSec > 0, 'Lockout reports a retry delay');
  assert.equal(guard.check(keys, t0 + 15 * 60_000 + 1).locked, false, 'Lockout expires');

  // 2. A success clears the counter
  const guard2 = new LoginGuard(3, 60_000, 60_000);
  guard2.recordFailure(['user:bob'], 0);
  guard2.recordFailure(['user:bob'], 0);
  guard2.recordSuccess(['user:bob']);
  guard2.recordFailure(['user:bob'], 0);
  assert.equal(guard2.check(['user:bob'], 0).locked, false, 'Success resets the failure window');

  // 3. Keys are independent (rotating usernames from one IP still throttles the IP)
  const guard3 = new LoginGuard(2, 60_000, 60_000);
  guard3.recordFailure(['user:a', 'ip:1'], 0);
  guard3.recordFailure(['user:b', 'ip:1'], 0);
  assert.equal(guard3.check(['user:c', 'ip:1'], 0).locked, true, 'IP bucket locks independently of username');

  // 4. Sliding-window limiter accounting
  const limiter = new SlidingWindowLimiter(3, 1000);
  assert.equal(limiter.hit('k', 0).allowed, true);
  assert.equal(limiter.hit('k', 1).allowed, true);
  assert.equal(limiter.hit('k', 2).allowed, true);
  const denied = limiter.hit('k', 3);
  assert.equal(denied.allowed, false, 'Fourth call in the window is denied');
  assert.ok(denied.retryAfterSec >= 1, 'Denial carries a retry hint');
  assert.equal(limiter.hit('k', 1001).allowed, true, 'Window slides: old hits expire');
  assert.equal(limiter.peek('k', 1002), 1, 'peek reports the current window size');

  // 5. Key map stays bounded
  const bounded = new SlidingWindowLimiter(1, 1000, 10);
  for (let i = 0; i < 50; i++) bounded.hit(`key-${i}`, i);
  assert.ok(bounded.size <= 10, `Limiter key map must stay bounded (got ${bounded.size})`);

  console.log('  [PASS] All brute-force protection unit tests passed.');
}

if (process.argv[1]?.endsWith('loginGuard.test.ts') || process.argv[1]?.endsWith('loginGuard.test.js')) {
  runLoginGuardTests().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
