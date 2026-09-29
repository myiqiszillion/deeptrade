import assert from 'node:assert/strict';
import { findBarIndexByTime } from '../client/src/services/viewportMath.js';

function runSignalBoundaryVerification() {
  console.log('=== STARTING SIGNAL VIEWPORT BOUNDARY VERIFICATION ===');

  const bars = [
    { time: 1700000000000 }, // Bar 0: 00:00 (interval 60s)
    { time: 1700000060000 }, // Bar 1: 01:00
    { time: 1700000120000 }, // Bar 2: 02:00
    { time: 1700000180000 }, // Bar 3: 03:00 (ends at 04:00 = 1700000240000)
  ];

  // 1. Signal strictly before earliest bar
  console.log('[Case 1] Signal before visible range...');
  const before1 = findBarIndexByTime(1700000000000 - 1, bars);
  assert.equal(before1, -1, 'Timestamp 1ms before bar 0 must return -1');
  const before2 = findBarIndexByTime(1699999000000, bars);
  assert.equal(before2, -1, 'Old historical signal must return -1');
  console.log('  -> PASS: Signals before viewport return -1.');

  // 2. Signal strictly after latest bar duration
  console.log('[Case 2] Signal after visible range...');
  const after1 = findBarIndexByTime(1700000240000, bars);
  assert.equal(after1, -1, 'Timestamp at or after bar 3 end must return -1');
  const after2 = findBarIndexByTime(1700000500000, bars);
  assert.equal(after2, -1, 'Future signal must return -1');
  console.log('  -> PASS: Signals after viewport return -1.');

  // 3. Exact boundary timestamps
  console.log('[Case 3] Boundary exact match...');
  const exact0 = findBarIndexByTime(1700000000000, bars);
  assert.equal(exact0, 0, 'Exact start of bar 0 must return 0');

  const mid0 = findBarIndexByTime(1700000030000, bars);
  assert.equal(mid0, 0, 'Midway through bar 0 must return 0');

  const exact1 = findBarIndexByTime(1700000060000, bars);
  assert.equal(exact1, 1, 'Exact start of bar 1 must return 1');

  const lastBarMid = findBarIndexByTime(1700000200000, bars);
  assert.equal(lastBarMid, 3, 'Inside last bar must return 3');

  const lastBarEndMinus1 = findBarIndexByTime(1700000239999, bars);
  assert.equal(lastBarEndMinus1, 3, '1ms before last bar ends must return 3');
  console.log('  -> PASS: Inside signals map to exact candle indices.');

  // 4. Edge cases: empty bars
  console.log('[Case 4] Empty bars array...');
  assert.equal(findBarIndexByTime(1700000000000, []), -1);
  assert.equal(findBarIndexByTime(1700000000000, null as any), -1);
  console.log('  -> PASS: Empty bars safely returns -1.');

  console.log('\n✅ ALL SIGNAL BOUNDARY VERIFICATION CASES PASSED!\n');
}

runSignalBoundaryVerification();
