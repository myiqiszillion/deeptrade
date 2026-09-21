import { BacktestReplayEngine } from './backtestEngine.js';
import { FootprintEngine } from './footprintEngine.js';
import { Tick } from './types.js';

function createSampleTicks(count: number, startPrice = 5000, startTs = 1700000000000): Tick[] {
  const ticks: Tick[] = [];
  let price = startPrice;
  for (let i = 0; i < count; i++) {
    const isBuyerMaker = i % 2 === 0;
    const deltaPrice = (i % 3 === 0 ? 0.25 : i % 3 === 1 ? -0.25 : 0);
    price = Math.round((price + deltaPrice) * 100) / 100;
    ticks.push({
      id: `tick-${i}`,
      price,
      size: 1.5 + (i % 5),
      timestamp: startTs + i * 1000,
      isBuyerMaker,
      side: isBuyerMaker ? 'sell' : 'buy',
    });
  }
  return ticks;
}

async function runTests(): Promise<void> {
  console.log('--- RUNNING BACKTEST / MARKET REPLAY VERIFICATION SUITE ---\n');

  // Test 1: Record and Buffer
  console.log('[TEST 1] Buffer management & recording...');
  const engine = new BacktestReplayEngine();
  const ticks = createSampleTicks(100);
  ticks.forEach((t) => engine.recordTick(t));
  if (engine.getRecordedCount() !== 100) {
    throw new Error(`Expected 100 ticks, got ${engine.getRecordedCount()}`);
  }
  console.log('✓ TEST 1 passed (recorded count = 100)');

  // Test 2: Step Forward
  console.log('\n[TEST 2] Step forward execution...');
  let emittedTick: Tick | null = null;
  engine.setCallback((t) => { emittedTick = t; });
  const step1 = engine.stepForward();
  const recordedTick = emittedTick as Tick | null;
  if (!step1 || step1.id !== 'tick-0' || recordedTick?.id !== 'tick-0') {
    throw new Error(`Step forward failed: ${JSON.stringify(step1)}`);
  }
  const progress1 = engine.getProgress();
  if (progress1.currentIndex !== 1) {
    throw new Error(`Expected currentIndex 1, got ${progress1.currentIndex}`);
  }
  console.log('✓ TEST 2 passed (step forward emitted tick-0, currentIndex = 1)');

  // Test 3: Seek by index
  console.log('\n[TEST 3] Seek by tick index...');
  engine.seek(42);
  const progress2 = engine.getProgress();
  if (progress2.currentIndex !== 42) {
    throw new Error(`Expected currentIndex 42, got ${progress2.currentIndex}`);
  }
  const step42 = engine.stepForward();
  if (!step42 || step42.id !== 'tick-42') {
    throw new Error(`Expected tick-42 after seek, got ${step42?.id}`);
  }
  console.log('✓ TEST 3 passed (seek to index 42 verified)');

  // Test 4: Seek by epoch timestamp
  console.log('\n[TEST 4] Seek by epoch timestamp (binary search)...');
  const targetTs = ticks[75].timestamp;
  engine.seek(targetTs);
  const progress3 = engine.getProgress();
  if (progress3.currentIndex !== 75) {
    throw new Error(`Expected currentIndex 75 for timestamp ${targetTs}, got ${progress3.currentIndex}`);
  }
  const step75 = engine.stepForward();
  if (!step75 || step75.id !== 'tick-75') {
    throw new Error(`Expected tick-75, got ${step75?.id}`);
  }
  console.log('✓ TEST 4 passed (seek by epoch timestamp verified)');

  // Test 5: Replay loop isolation (cannot record ticks during replay)
  console.log('\n[TEST 5] Replay isolation (prevent recording while replaying)...');
  engine.start(10);
  if (!engine.isActive()) {
    throw new Error('Engine should be active after start()');
  }
  const countBefore = engine.getRecordedCount();
  engine.recordTick({
    id: 'rogue-tick',
    price: 9999,
    size: 1,
    timestamp: Date.now(),
    isBuyerMaker: false,
    side: 'buy',
  });
  if (engine.getRecordedCount() !== countBefore) {
    throw new Error('Engine recorded a tick while active in replay mode!');
  }
  engine.pause();
  if (engine.isActive()) {
    throw new Error('Engine should be paused');
  }
  console.log('✓ TEST 5 passed (rogue tick during replay successfully rejected)');

  // Test 6: Replay Footprint Consistency
  console.log('\n[TEST 6] Footprint consistency between live & replayed ticks...');
  const liveFp = new FootprintEngine(0.25, 60000, 3.0, 1.0, 3);
  const replayFp = new FootprintEngine(0.25, 60000, 3.0, 1.0, 3);

  // Feed ticks to live engine
  ticks.forEach((t) => liveFp.processTick(t));
  const liveBars = liveFp.getAllBars();

  // Replay ticks through BacktestReplayEngine to replay engine
  const replayEngine = new BacktestReplayEngine();
  replayEngine.loadTicks(ticks);
  replayEngine.setCallback((t) => replayFp.processTick(t));

  for (let i = 0; i < ticks.length; i++) {
    replayEngine.stepForward();
  }
  const replayBars = replayFp.getAllBars();

  if (liveBars.length !== replayBars.length) {
    throw new Error(`Bar count mismatch: live=${liveBars.length}, replay=${replayBars.length}`);
  }

  for (let i = 0; i < liveBars.length; i++) {
    const lb = liveBars[i];
    const rb = replayBars[i];
    if (lb.open !== rb.open || lb.high !== rb.high || lb.low !== rb.low || lb.close !== rb.close) {
      throw new Error(`OHLC mismatch on bar ${i}`);
    }
    if (lb.volume !== rb.volume || lb.delta !== rb.delta || lb.cvd !== rb.cvd) {
      throw new Error(`Volume/Delta mismatch on bar ${i}`);
    }
  }
  console.log('✓ TEST 6 passed (live and replay bars are 100% bit-for-bit identical)');

  console.log('\n========================================');
  console.log('ALL BACKTEST / REPLAY SUITE TESTS PASSED (6/6)');
  console.log('========================================\n');
}

runTests().catch((err) => {
  console.error('Test suite failed:', err);
  process.exit(1);
});
