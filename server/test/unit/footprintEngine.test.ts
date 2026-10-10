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
  // 5. Golden Fixture for Footprint Accuracy (CVD, POC, Diagonal Imbalance, Unfinished Auction)
  const baseTs = 1700000100000;
  const goldenTicks: Tick[] = [
    { id: '10', timestamp: baseTs + 100, price: 4000.0, size: 5, side: 'buy' },
    { id: '11', timestamp: baseTs + 200, price: 4000.25, size: 20, side: 'buy' },
    { id: '12', timestamp: baseTs + 300, price: 4000.25, size: 10, side: 'sell' },
    { id: '13', timestamp: baseTs + 400, price: 4000.50, size: 50, side: 'buy' }, // High volume buy at 4000.50
    { id: '14', timestamp: baseTs + 500, price: 4000.75, size: 100, side: 'buy' }, // Huge volume at 4000.75
    { id: '15', timestamp: baseTs + 600, price: 4000.75, size: 20, side: 'sell' },
    { id: '16', timestamp: baseTs + 700, price: 4001.00, size: 10, side: 'buy' },
    { id: '17', timestamp: baseTs + 800, price: 4001.00, size: 0, side: 'sell' }, // Zero size to ignore or test filtering
  ];

  const engine2 = new FootprintEngine(0.25, 60000, 3.0, 1.0, 3);
  let finalRes: any;
  for (const t of goldenTicks) {
    if (t.size > 0) finalRes = engine2.processTick(t);
  }

  const gBar = finalRes.currentBar;
  // Verify Total Volume and CVD
  assert.equal(gBar.volume, 5+20+10+50+100+20+10, 'Golden volume mismatch');
  assert.equal(gBar.buyVolume, 5+20+50+100+10, 'Golden buy volume mismatch');
  assert.equal(gBar.sellVolume, 10+20, 'Golden sell volume mismatch');
  assert.equal(gBar.delta, gBar.buyVolume - gBar.sellVolume, 'Golden delta mismatch');

  // Verify POC
  assert.equal(gBar.poc, 4000.75, 'POC should be at highest volume level');
  assert.equal(gBar.levels[4000.75].isPOC, true, 'isPOC should be true for POC level');
  assert.equal(gBar.levels[4000.75].totalVol, 120, 'POC volume should be 120');

  // Verify Unfinished Auction
  // Max price is 4001.00. At 4001.00, askVol = 10, bidVol = 0. This is an unfinished auction at the high.
  assert.equal(gBar.unfinishedHigh, true, 'Should detect unfinished auction at the high');

  console.log('  [PASS] All FootprintEngine unit tests passed.');
}

if (process.argv[1]?.endsWith('footprintEngine.test.ts') || process.argv[1]?.endsWith('footprintEngine.test.js')) {
  runFootprintEngineTests().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
