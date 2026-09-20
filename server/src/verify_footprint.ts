import assert from 'node:assert/strict';
import { FootprintEngine } from './footprintEngine.js';
import { Tick } from './types.js';

console.log('======================================================');
console.log('🧪 RUNNING FOOTPRINT ENGINE REGRESSION SUITE');
console.log('======================================================\n');

let passed = 0;
let failed = 0;

function check(label: string, fn: () => void) {
  try {
    fn();
    passed++;
    console.log(`  PASS  ${label}`);
  } catch (err) {
    failed++;
    console.error(`  FAIL  ${label}: ${(err as Error).message}`);
  }
}

// 1. Test ask imbalance not reset
check('Diagonal Ask Imbalance is NOT reset by subsequent iterations', () => {
  const engine = new FootprintEngine(0.5, 60000, 3.0, 1.0);

  // Price 100.0: sell volume = 1 (bidVol)
  // Price 100.5: buy volume = 10 (askVol) -> Ask Imbalance against 100.0 (10 >= 1 * 3)
  // Price 101.0: sell volume = 1 (bidVol)
  // Price 101.5: buy volume = 10 (askVol) -> Ask Imbalance against 101.0 (10 >= 1 * 3)

  const t0 = 1700000000000;
  engine.processTick({ id: '1', timestamp: t0, price: 100.0, size: 1, side: 'sell', isBuyerMaker: true });
  engine.processTick({ id: '2', timestamp: t0 + 10, price: 100.5, size: 10, side: 'buy', isBuyerMaker: false });
  engine.processTick({ id: '3', timestamp: t0 + 20, price: 101.0, size: 1, side: 'sell', isBuyerMaker: true });
  engine.processTick({ id: '4', timestamp: t0 + 30, price: 101.5, size: 10, side: 'buy', isBuyerMaker: false });

  const bar = engine.getCurrentBar()!;
  assert.ok(bar, 'Bar exists');

  // Verify ask imbalance at 100.5
  const lvl100_5 = bar.levels[100.5];
  assert.ok(lvl100_5, 'Level 100.5 exists');
  assert.equal(lvl100_5.askImbalance, true, 'Ask imbalance at 100.5 must be true (not reset)');

  // Verify ask imbalance at 101.5
  const lvl101_5 = bar.levels[101.5];
  assert.ok(lvl101_5, 'Level 101.5 exists');
  assert.equal(lvl101_5.askImbalance, true, 'Ask imbalance at 101.5 must be true');
});

// 2. Test bar open price is first tick of the bar
check('Bar open price is strictly first tick of the bar (not previous close)', () => {
  const engine = new FootprintEngine(0.5, 60000);
  const t0 = 1700000000000;

  // Bar 1 starts with tick at 100.0, closes at 105.0
  engine.processTick({ id: '1', timestamp: t0, price: 100.0, size: 1, side: 'buy', isBuyerMaker: false });
  engine.processTick({ id: '2', timestamp: t0 + 1000, price: 105.0, size: 1, side: 'buy', isBuyerMaker: false });

  // Bar 2 opens 60s later with a gap tick at 112.0
  const t1 = t0 + 60000;
  const { currentBar, closedBar } = engine.processTick({ id: '3', timestamp: t1, price: 112.0, size: 1, side: 'buy', isBuyerMaker: false });

  assert.ok(closedBar, 'First bar was closed');
  assert.equal(closedBar.close, 105.0, 'Bar 1 close was 105.0');
  assert.equal(currentBar.open, 112.0, 'Bar 2 open must be 112.0 (first tick), NOT 105.0');
});

// 3. Test stacked imbalances
check('Stacked imbalances detected across >= N consecutive levels', () => {
  const engine = new FootprintEngine(0.5, 60000, 3.0, 1.0, 3);
  const t0 = 1700000000000;

  // Create 3 consecutive levels with ask imbalances:
  // 100.0 (bidVol=1) -> 100.5 (askVol=10) [Imbalance 1]
  // 100.5 (bidVol=1) -> 101.0 (askVol=10) [Imbalance 2]
  // 101.0 (bidVol=1) -> 101.5 (askVol=10) [Imbalance 3]
  engine.processTick({ id: '1', timestamp: t0, price: 100.0, size: 1, side: 'sell', isBuyerMaker: true });
  engine.processTick({ id: '2', timestamp: t0 + 1, price: 100.5, size: 1, side: 'sell', isBuyerMaker: true });
  engine.processTick({ id: '3', timestamp: t0 + 2, price: 100.5, size: 10, side: 'buy', isBuyerMaker: false });
  engine.processTick({ id: '4', timestamp: t0 + 3, price: 101.0, size: 1, side: 'sell', isBuyerMaker: true });
  engine.processTick({ id: '5', timestamp: t0 + 4, price: 101.0, size: 10, side: 'buy', isBuyerMaker: false });
  engine.processTick({ id: '6', timestamp: t0 + 5, price: 101.5, size: 10, side: 'buy', isBuyerMaker: false });

  const bar = engine.getCurrentBar()!;
  assert.equal(bar.levels[100.5].askImbalance, true);
  assert.equal(bar.levels[101.0].askImbalance, true);
  assert.equal(bar.levels[101.5].askImbalance, true);

  assert.equal(bar.levels[100.5].stackedAskImbalance, true, 'Stacked ask imbalance on 100.5');
  assert.equal(bar.levels[101.0].stackedAskImbalance, true, 'Stacked ask imbalance on 101.0');
  assert.equal(bar.levels[101.5].stackedAskImbalance, true, 'Stacked ask imbalance on 101.5');
});

// 4. Test unfinished auction
check('Unfinished auction detection at high and low', () => {
  const engine = new FootprintEngine(0.5, 60000);
  const t0 = 1700000000000;

  // Unfinished high: buyers bought ask at highest price (askVol > 0)
  // Finished low: only buyers bought at lowest price (bidVol === 0)
  engine.processTick({ id: '1', timestamp: t0, price: 100.0, size: 5, side: 'buy', isBuyerMaker: false }); // low: askVol=5, bidVol=0
  engine.processTick({ id: '2', timestamp: t0 + 1, price: 105.0, size: 10, side: 'buy', isBuyerMaker: false }); // high: askVol=10

  const bar1 = engine.getCurrentBar()!;
  assert.equal(bar1.unfinishedHigh, true, 'High has askVol > 0 -> unfinishedHigh is true');
  assert.equal(bar1.unfinishedLow, false, 'Low has bidVol === 0 -> unfinishedLow is false');

  // Now hit the bid at the low (sellers active at low -> unfinished low)
  engine.processTick({ id: '3', timestamp: t0 + 2, price: 100.0, size: 3, side: 'sell', isBuyerMaker: true });
  assert.equal(engine.getCurrentBar()!.unfinishedLow, true, 'Low has bidVol > 0 -> unfinishedLow is true');
});

// 5. Test unknown aggressor handling
check('Unknown aggressor side adds to total volume but preserves delta and buy/sell volumes', () => {
  const engine = new FootprintEngine(0.5, 60000);
  const t0 = 1700000000000;

  engine.processTick({ id: '1', timestamp: t0, price: 100.0, size: 10, side: 'buy', isBuyerMaker: false });
  engine.processTick({ id: '2', timestamp: t0 + 1, price: 100.0, size: 4, side: 'sell', isBuyerMaker: true });
  // Unknown trade
  engine.processTick({ id: '3', timestamp: t0 + 2, price: 100.0, size: 7, side: 'unknown', isBuyerMaker: undefined });

  const bar = engine.getCurrentBar()!;
  assert.equal(bar.buyVolume, 10, 'buyVolume is 10');
  assert.equal(bar.sellVolume, 4, 'sellVolume is 4');
  assert.equal(bar.delta, 6, 'delta is 10 - 4 = 6');
  assert.equal(bar.volume, 21, 'total volume is 10 + 4 + 7 = 21');
  assert.equal(bar.levels[100.0].totalVol, 21, 'level totalVol is 21');
  assert.equal(bar.levels[100.0].delta, 6, 'level delta is 6');
});

// 6. Test duplicate tick suppression
check('Duplicate ticks by ID are suppressed from volume and delta', () => {
  const engine = new FootprintEngine(0.5, 60000);
  const t0 = 1700000000000;

  engine.processTick({ id: 'tick_dup', timestamp: t0, price: 100.0, size: 5, side: 'buy', isBuyerMaker: false });
  // Same tick arrives again
  engine.processTick({ id: 'tick_dup', timestamp: t0, price: 100.0, size: 5, side: 'buy', isBuyerMaker: false });

  const bar = engine.getCurrentBar()!;
  assert.equal(bar.volume, 5, 'Volume must be 5 (duplicate suppressed)');
  assert.equal(bar.buyVolume, 5, 'Buy volume must be 5');
});

// 7. Test POC and CVD
check('POC tracks maximum total volume level, CVD tracks cumulative delta', () => {
  const engine = new FootprintEngine(0.5, 60000);
  const t0 = 1700000000000;

  engine.processTick({ id: '1', timestamp: t0, price: 100.0, size: 5, side: 'buy', isBuyerMaker: false });
  engine.processTick({ id: '2', timestamp: t0 + 1, price: 101.0, size: 20, side: 'buy', isBuyerMaker: false });
  engine.processTick({ id: '3', timestamp: t0 + 2, price: 102.0, size: 8, side: 'buy', isBuyerMaker: false });

  const bar = engine.getCurrentBar()!;
  assert.equal(bar.poc, 101.0, 'POC must be 101.0 (level with highest volume = 20)');
  assert.equal(bar.levels[101.0].isPOC, true, 'isPOC flag set on 101.0');
  assert.equal(bar.levels[100.0].isPOC, false, 'isPOC false on other levels');
  assert.equal(bar.cvd, 33, 'CVD is sum of delta');
});

console.log(`\n======================================================`);
console.log(`Results: ${passed} passed, ${failed} failed`);
console.log(`======================================================\n`);

process.exit(failed === 0 ? 0 : 1);
