import assert from 'node:assert/strict';
import { FootprintEngine } from '../../src/footprintEngine.js';
import { Tick } from '../../src/types.js';

export async function runFootprintEngineTests(): Promise<void> {
  console.log('[unit/footprintEngine.test] Running FootprintEngine unit tests...');

  const tickSize = 0.25;
  const barDurationMs = 60000; // 1m
  const engine = new FootprintEngine(tickSize, barDurationMs, 3.0, 1.0, 3);

  // 1. Process First Tick
  const t1: Tick = {
    id: '1',
    timestamp: 1700000000000,
    price: 5000.0,
    size: 10,
    side: 'buy',
  };
  const res1 = engine.processTick(t1);
  assert.ok(res1.currentBar);
  assert.equal(res1.currentBar.open, 5000.0);
  assert.equal(res1.currentBar.high, 5000.0);
  assert.equal(res1.currentBar.low, 5000.0);
  assert.equal(res1.currentBar.close, 5000.0);
  assert.equal(res1.currentBar.volume, 10);
  assert.equal(res1.currentBar.buyVolume, 10);
  assert.equal(res1.currentBar.sellVolume, 0);
  assert.equal(res1.currentBar.delta, 10);

  // 2. Process Second Tick (higher price, sell)
  const t2: Tick = {
    id: '2',
    timestamp: 1700000010000,
    price: 5000.5,
    size: 4,
    side: 'sell',
  };
  const res2 = engine.processTick(t2);
  assert.equal(res2.currentBar.high, 5000.5);
  assert.equal(res2.currentBar.close, 5000.5);
  assert.equal(res2.currentBar.volume, 14);
  assert.equal(res2.currentBar.buyVolume, 10);
  assert.equal(res2.currentBar.sellVolume, 4);
  assert.equal(res2.currentBar.delta, 6);

  // 3. Level Breakdown Verification
  const levels = res2.currentBar.levels;
  assert.ok(levels[5000.0], 'Level 5000.0 must exist');
  assert.equal(levels[5000.0].askVol, 10);
  assert.ok(levels[5000.5], 'Level 5000.5 must exist');
  assert.equal(levels[5000.5].bidVol, 4);

  // 4. Bar Rollover on New Bar Duration
  const t3: Tick = {
    id: '3',
    timestamp: 1700000065000, // New minute
    price: 5001.0,
    size: 8,
    side: 'buy',
  };
  const res3 = engine.processTick(t3);
  assert.ok(res3.closedBar, 'Previous bar must be closed');
  assert.equal(res3.closedBar.time, res1.currentBar.time);
  assert.equal(res3.closedBar.volume, 14);
  assert.ok(res3.currentBar.time > res1.currentBar.time);
  assert.equal(res3.currentBar.volume, 8);

  console.log('  [PASS] All FootprintEngine unit tests passed.');
}

if (process.argv[1]?.endsWith('footprintEngine.test.ts') || process.argv[1]?.endsWith('footprintEngine.test.js')) {
  runFootprintEngineTests().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
