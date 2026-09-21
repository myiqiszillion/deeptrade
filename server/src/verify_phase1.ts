import assert from 'node:assert/strict';
import { parseBinanceAggTrades } from './dataFeeds/historyFeed.js';
import { FootprintEngine } from './footprintEngine.js';
import { FUTURES_INSTRUMENTS } from './futuresConfig.js';
import { MarketContext, MarketContextManager } from './marketData/marketContext.js';
import { ProfileEngine } from './profileEngine.js';
import { ReplaySession } from './replaySession.js';
import { ChartSession } from './session.js';
import { Tick, WSServerMessage } from './types.js';

console.log('======================================================');
console.log('🧪 RUNNING PHASE 1 REGRESSION SUITE (P0 CORRECTNESS)');
console.log('======================================================\n');

let passed = 0;
let failed = 0;

async function checkAsync(label: string, fn: () => Promise<void>) {
  try {
    await fn();
    passed++;
    console.log(`  PASS  ${label}`);
  } catch (err) {
    failed++;
    console.error(`  FAIL  ${label}: ${(err as Error).message}`);
  }
}

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

// Mock WebSocket for session testing
function createMockSocket() {
  const sent: WSServerMessage[] = [];
  return {
    readyState: 1, // OPEN
    send: (data: string) => {
      sent.push(JSON.parse(data));
    },
    close: () => {},
    sent,
  };
}

// Mock CBOE provider that performs no network requests (offline safe)
class MockCboeProvider {
  async fetchChain() {
    return null;
  }
}

class MockGexEngine {
  buildFromChain() {
    return {
      underlying: 'SPX',
      spotPrice: 5000,
      totalGex: 0,
      strikes: [],
      zeroGamma: null,
      updatedAt: Date.now(),
    };
  }
  getProfile() {
    return undefined;
  }
  getRecentFlow() {
    return [];
  }
}

// 1. Subscription Generation Guard (Race condition prevention)
await checkAsync('Subscription Generation Guard discards stale switch requests', async () => {
  const mgr = new MarketContextManager(undefined, new MockGexEngine() as any, new MockCboeProvider() as any);
  const mockWs = createMockSocket();
  const session = new ChartSession(mockWs as any);

  // Client triggers switch to ES (gen 1)
  const gen1 = session.nextGeneration();
  const p1 = mgr.subscribe(session, 'ES', '1m', gen1);

  // Rapid switch to NQ (gen 2) before ES finishes
  const gen2 = session.nextGeneration();
  const p2 = mgr.subscribe(session, 'NQ', '1m', gen2);

  await Promise.all([p1, p2]);

  // Session must end up subscribed to NQ, not ES
  assert.equal(session.subscribedSymbol, 'NQ', 'Session must be subscribed to NQ');
  assert.equal(session.subscriptionGeneration, gen2, 'Session generation must be gen 2');

  // Verify ES context does NOT contain this session
  const esCtx = mgr.getContext('ES');
  if (esCtx) {
    assert.equal(esCtx.subscriberCount, 0, 'Stale ES subscription must not be retained');
  }

  // Verify NQ context contains this session
  const nqCtx = mgr.getContext('NQ');
  assert.ok(nqCtx, 'NQ context exists');
  assert.equal(nqCtx.subscriberCount, 1, 'NQ context has session subscribed');
});

// 2. Replay Isolation from Live Market Data (P0: Replay must NEVER receive live data)
check('Replay Session Isolation completely blocks live market data and restores live snapshot on Return', () => {
  const ctx = new MarketContext(
    'ES',
    FUTURES_INSTRUMENTS.ES,
    new MockGexEngine() as any,
    new MockCboeProvider() as any
  );

  const mockWsLive = createMockSocket();
  const sessionLive = new ChartSession(mockWsLive as any);
  ctx.addSubscriber(sessionLive, '1m');

  const mockWsReplay = createMockSocket();
  const sessionReplay = new ChartSession(mockWsReplay as any);
  ctx.addSubscriber(sessionReplay, '1m');

  // Clear initial messages from addSubscriber
  mockWsLive.sent.length = 0;
  mockWsReplay.sent.length = 0;

  // SessionReplay enters Replay mode
  const replay = new ReplaySession(sessionReplay, 'ES', FUTURES_INSTRUMENTS.ES, '1m', [
    { id: 't_hist1', timestamp: 1700000000000, price: 5000.0, size: 1, side: 'buy', isBuyerMaker: false },
  ]);
  sessionReplay.replaySession = replay;

  // Verify ReplaySession sent an initial INIT_STATE to reset client
  assert.equal(sessionReplay.mode, 'REPLAY', 'Session must be in REPLAY mode');
  assert.ok(sessionReplay.isReplay(), 'isReplay() must return true');
  const replayInit = mockWsReplay.sent.find((m) => m.type === 'INIT_STATE');
  assert.ok(replayInit, 'ReplaySession must send initial INIT_STATE reset');
  mockWsReplay.sent.length = 0;

  // Simulate live trade arriving from market feed
  (ctx as any).handleTrade({
    id: 'live_trade_1',
    ts: Date.now(),
    price: 5010.25,
    size: 5,
    side: 'BUY',
  });

  // Simulate live orderbook update
  (ctx as any).handleDepth({
    kind: 'snapshot',
    bids: [{ price: 5010.0, size: 10 }],
    asks: [{ price: 5010.5, size: 12 }],
    ts: Date.now(),
  });

  // Simulate live GEX refresh
  void ctx.refreshGex(false);

  // SessionLive MUST receive live data
  const liveTicks = mockWsLive.sent.filter((m) => m.type === 'TICK');
  assert.equal(liveTicks.length, 1, 'Live session must receive 1 live TICK');
  assert.equal((liveTicks[0] as any).tick.id, 'live_trade_1');

  const liveBooks = mockWsLive.sent.filter((m) => m.type === 'ORDERBOOK_UPDATE');
  assert.equal(liveBooks.length, 1, 'Live session must receive live ORDERBOOK_UPDATE');

  // SessionReplay MUST receive ZERO live data!
  const replayLiveTicks = mockWsReplay.sent.filter((m) => m.type === 'TICK');
  assert.equal(replayLiveTicks.length, 0, 'Replay session must receive ZERO live TICKs');
  const replayOrderbooks = mockWsReplay.sent.filter((m) => m.type === 'ORDERBOOK_UPDATE');
  assert.equal(replayOrderbooks.length, 0, 'Replay session must receive ZERO live ORDERBOOK_UPDATEs');
  const replayGex = mockWsReplay.sent.filter((m) => m.type === 'GEX_UPDATE');
  assert.equal(replayGex.length, 0, 'Replay session must receive ZERO live GEX_UPDATEs');

  // Step replay for SessionReplay: only replay ticks should arrive
  replay.step();
  const replayedTicks = mockWsReplay.sent.filter((m) => m.type === 'TICK');
  assert.equal(replayedTicks.length, 1, 'Replay session receives its replayed tick');
  assert.equal((replayedTicks[0] as any).tick.id, 't_hist1');

  // Return to Live: verify clean transition back and live snapshot restoration
  replay.dispose();
  sessionReplay.replaySession = null;
  assert.equal(sessionReplay.mode, 'LIVE', 'Session returns to LIVE mode');
  assert.equal(sessionReplay.isReplay(), false, 'isReplay() is false');

  // Server sends live snapshot upon return to live
  sessionReplay.send(ctx.buildInitState(sessionReplay, sessionReplay.subscribedTimeframe));
  const restoredSnap = mockWsReplay.sent.filter((m) => m.type === 'INIT_STATE').pop() as any;
  assert.ok(restoredSnap, 'Restored INIT_STATE must be sent');
  assert.equal(restoredSnap.symbol, 'ES', 'Snapshot contains current symbol ES');
  assert.ok(restoredSnap.bars.length > 0, 'Snapshot contains live bars');

  ctx.removeSubscriber(sessionLive);
  ctx.removeSubscriber(sessionReplay);
});

// 3. Real History/Live Merge, Seam Dedup & Validation (P0 Correctness via Production Path)
await checkAsync('Real backfillHistory() merges live buffer, deduplicates, and seeds live dedup filter', async () => {
  const tLive1 = 1700000010000;
  const tLive2 = 1700000020000;

  // 1. Test empty history: zero tick loss from live buffer
  const emptyHistoryProvider = {
    fetchBinanceAggTrades: async () => [],
    fetchTradovateBars: async () => [],
  };

  const ctxEmpty = new MarketContext(
    'BTCUSDT',
    FUTURES_INSTRUMENTS.BTCUSDT,
    new MockGexEngine() as any,
    new MockCboeProvider() as any,
    undefined,
    emptyHistoryProvider
  );

  // Buffer live ticks while backfilling
  (ctxEmpty as any).isBackfillingHistory = true;
  (ctxEmpty as any).handleTrade({ id: 'live_1', ts: tLive1, price: 50000.0, size: 2, side: 'BUY' });
  (ctxEmpty as any).handleTrade({ id: 'live_2', ts: tLive2, price: 50001.0, size: 3, side: 'SELL' });
  assert.equal((ctxEmpty as any).liveBuffer.length, 2, 'Live buffer has 2 ticks');

  // Run REAL production backfillHistory()
  await ctxEmpty.backfillHistory();

  assert.equal(ctxEmpty.getHistoryTicks().length, 2, 'Both live ticks preserved through real backfillHistory()');
  assert.equal(ctxEmpty.getHistoryTicks()[0].id, 'live_1');
  assert.equal(ctxEmpty.getHistoryTicks()[1].id, 'live_2');

  // 2. Test overlapping history: real merge and deduplication
  const histTrade1: Tick = { id: 'hist_1', timestamp: tLive1 - 5000, price: 49990.0, size: 1, side: 'buy', isBuyerMaker: false };
  const histTrade2: Tick = { id: 'live_dup', timestamp: tLive1, price: 50000.0, size: 2, side: 'buy', isBuyerMaker: false };

  const overlapHistoryProvider = {
    fetchBinanceAggTrades: async () => [histTrade1, histTrade2],
    fetchTradovateBars: async () => [],
  };

  const ctxOverlap = new MarketContext(
    'BTCUSDT',
    FUTURES_INSTRUMENTS.BTCUSDT,
    new MockGexEngine() as any,
    new MockCboeProvider() as any,
    undefined,
    overlapHistoryProvider
  );

  (ctxOverlap as any).isBackfillingHistory = true;
  (ctxOverlap as any).handleTrade({ id: 'live_dup', ts: tLive1, price: 50000.0, size: 2, side: 'BUY' });
  (ctxOverlap as any).handleTrade({ id: 'live_new', ts: tLive2, price: 50005.0, size: 4, side: 'BUY' });

  // Run REAL production backfillHistory()
  await ctxOverlap.backfillHistory();

  const mergedTicks = ctxOverlap.getHistoryTicks();
  assert.equal(mergedTicks.length, 3, 'Real backfillHistory() deduplicated live_dup without tick loss');
  assert.equal(mergedTicks[0].id, 'hist_1');
  assert.equal(mergedTicks[1].id, 'live_dup');
  assert.equal(mergedTicks[2].id, 'live_new');

  // 3. Test Dedup Seam: Live trade sent AFTER backfill must be dropped if already in history
  const countBefore = ctxOverlap.getHistoryTicks().length;
  (ctxOverlap as any).handleTrade({ id: 'hist_1', ts: Date.now(), price: 49990.0, size: 10, side: 'BUY' });
  assert.equal(
    ctxOverlap.getHistoryTicks().length,
    countBefore,
    'Live trade with ID from history must be dropped by recentVendorTickIds'
  );

  // 4. Test Finite Number Validation: Infinity and NaN must be rejected
  (ctxOverlap as any).handleTrade({ id: 'invalid_inf', ts: Date.now(), price: Infinity, size: 1, side: 'BUY' });
  (ctxOverlap as any).handleTrade({ id: 'invalid_nan', ts: Date.now(), price: NaN, size: 1, side: 'BUY' });
  (ctxOverlap as any).handleTrade({ id: 'invalid_neg', ts: Date.now(), price: 50000.0, size: -1, side: 'BUY' });
  assert.equal(
    ctxOverlap.getHistoryTicks().length,
    countBefore,
    'Non-finite and non-positive trades must be rejected'
  );
});

// 4. Late Tick, Multi-Bar CVD Ripple & Non-destructive OHLC (P0 Correctness)
check('Late ticks ripple CVD through all intermediate closed bars and preserve bar close price', () => {
  const engine = new FootprintEngine(0.5, 60000);
  const t0 = Math.floor(1700000000000 / 60000) * 60000; // Bar 0 start: aligned to 60s boundary

  // Bar 0: t0 (trade 1 at t0, trade 2 at t0 + 10000)
  // Delta = +10, CVD = 10
  engine.processTick({ id: '1', timestamp: t0, price: 100.0, size: 10, side: 'buy', isBuyerMaker: false });
  engine.processTick({ id: '2', timestamp: t0 + 10000, price: 102.0, size: 5, side: 'buy', isBuyerMaker: false });
  // Bar 0: delta = 15, CVD = 15, close = 102.0

  // Bar 1: t0 + 60000
  // Delta = +5, CVD = 20
  const t1 = t0 + 60000;
  engine.processTick({ id: '3', timestamp: t1, price: 105.0, size: 5, side: 'buy', isBuyerMaker: false });

  // Bar 2: t0 + 120000
  // Delta = -3, CVD = 17
  const t2 = t0 + 120000;
  engine.processTick({ id: '4', timestamp: t2, price: 104.0, size: 3, side: 'sell', isBuyerMaker: true });

  // Bar 3: t0 + 180000 (Current active bar)
  // Delta = +8, CVD = 25
  const t3 = t0 + 180000;
  const { currentBar: bar3 } = engine.processTick({
    id: '5',
    timestamp: t3,
    price: 106.0,
    size: 8,
    side: 'buy',
    isBuyerMaker: false,
  });
  assert.equal(bar3.cvd, 25, 'Initial Bar 3 CVD is 25');

  // Late tick arrives for Bar 0 at timestamp t0 + 5000 (between trade 1 and trade 2 of Bar 0)
  // Price is 99.0 (new low), size 4 (buy) -> DeltaDelta = +4
  const { currentBar: bar3AfterLate, closedBar, correctedBar, affectedBars } = engine.processTick({
    id: 'late_t0',
    timestamp: t0 + 5000,
    price: 99.0,
    size: 4,
    side: 'buy',
    isBuyerMaker: false,
  });

  assert.equal(closedBar, null, 'Late tick must NOT close active bar');
  assert.ok(correctedBar, 'correctedBar must be returned');
  assert.equal(correctedBar.id, `bar_${t0}`);

  // Bar 0 (past bar) verification:
  assert.equal(correctedBar.low, 99.0, 'Bar 0 low updated to 99.0');
  // Close must NOT be overwritten because late tick (t0 + 5000) is earlier than trade 2 (t0 + 10000)!
  assert.equal(correctedBar.close, 102.0, 'Bar 0 close preserved at 102.0');
  // Delta was 15, now 15 + 4 = 19
  assert.equal(correctedBar.delta, 19, 'Bar 0 delta updated to 19');
  // CVD for Bar 0 was 15, now 19
  assert.equal(correctedBar.cvd, 19, 'Bar 0 CVD updated to 19');

  // Verify affectedBars contains all 4 bars
  assert.ok(affectedBars, 'affectedBars must be returned');
  assert.equal(affectedBars.length, 4, 'All 4 bars must be in affectedBars');
  assert.equal(affectedBars[0].id, `bar_${t0}`);
  assert.equal(affectedBars[0].cvd, 19, 'Bar 0 CVD rippled to 19');
  assert.equal(affectedBars[1].id, `bar_${t1}`);
  assert.equal(affectedBars[1].cvd, 24, 'Bar 1 CVD rippled from 20 to 24');
  assert.equal(affectedBars[2].id, `bar_${t2}`);
  assert.equal(affectedBars[2].cvd, 21, 'Bar 2 CVD rippled from 17 to 21');
  assert.equal(affectedBars[3].id, `bar_${t3}`);
  assert.equal(affectedBars[3].cvd, 29, 'Bar 3 (active) CVD rippled from 25 to 29');

  assert.equal(bar3AfterLate.cvd, 29, 'Bar 3 CVD rippled forward to 29');
  assert.equal(engine.getCurrentCVD(), 21, 'Engine baseline currentCVD updated to 21');
});

// 5. Replay VWAP and TPO Anchor Initialization & Seek Consistency (P0/P1)
check('Replay VWAP and Profile dynamically anchor to historical ticks and maintain seek consistency', () => {
  const mockWs = createMockSocket();
  const session = new ChartSession(mockWs as any);

  // Historical ticks from 2 hours ago
  const histT0 = Date.now() - 7200000;
  const sampleTicks: Tick[] = [
    { id: 'h1', timestamp: histT0, price: 5000.0, size: 10, side: 'buy', isBuyerMaker: false },
    { id: 'h2', timestamp: histT0 + 30000, price: 5002.0, size: 10, side: 'buy', isBuyerMaker: false },
    { id: 'h3', timestamp: histT0 + 3600000, price: 5004.0, size: 10, side: 'sell', isBuyerMaker: true },
    { id: 'h4', timestamp: histT0 + 7100000, price: 5006.0, size: 15, side: 'buy', isBuyerMaker: false },
  ];

  const replay = new ReplaySession(session, 'ES', FUTURES_INSTRUMENTS.ES, '1m', sampleTicks);

  // 1. Sequential replay (step 3 ticks)
  replay.step();
  replay.step();
  replay.step();

  const seqVwapPoints = [...replay.vwapEngine.getHistory()];
  const seqTpo = replay.profileEngine.getTPOProfile();

  assert.ok(seqVwapPoints.length > 0, 'Sequential replay must produce VWAP points');
  assert.ok(seqTpo.brackets.length >= 2, 'TPO must have multiple brackets for 2-hour span');

  // 2. Rebuild via Seek to the same position
  replay.seek(histT0 + 7100000);

  const seekVwapPoints = replay.vwapEngine.getHistory();
  const seekTpo = replay.profileEngine.getTPOProfile();

  // Assert sequential and seek produce identical VWAP history length and values
  assert.equal(seekVwapPoints.length, seqVwapPoints.length, 'VWAP history length must match between sequential and seek');
  if (seekVwapPoints.length > 0 && seqVwapPoints.length > 0) {
    assert.equal(
      seekVwapPoints[seekVwapPoints.length - 1].vwap,
      seqVwapPoints[seqVwapPoints.length - 1].vwap,
      'Final VWAP value must match between sequential and seek'
    );
  }

  // Assert TPO bracket count matches
  assert.equal(seekTpo.brackets.length, seqTpo.brackets.length, 'TPO bracket count must match between sequential and seek');

  replay.dispose();
});

// 6. Active Bar Out-of-Order Tick Handling (P0 Correctness)
check('Active bar preserves open and close prices according to event timestamp, not arrival order', () => {
  const engine = new FootprintEngine(0.5, 60000);
  const t0 = Math.floor(1700000000000 / 60000) * 60000;

  // 1. Arrives first: trade at t0 + 20000 with price 102.0
  const { currentBar: bar1 } = engine.processTick({
    id: 't_20s',
    timestamp: t0 + 20000,
    price: 102.0,
    size: 5,
    side: 'buy',
    isBuyerMaker: false,
  });
  assert.equal(bar1.open, 102.0, 'First arriving tick sets initial open to 102.0');
  assert.equal(bar1.close, 102.0, 'First arriving tick sets initial close to 102.0');

  // 2. Arrives second (out-of-order): trade at t0 + 10000 (earlier) with price 100.0
  const { currentBar: bar2 } = engine.processTick({
    id: 't_10s',
    timestamp: t0 + 10000,
    price: 100.0,
    size: 2,
    side: 'buy',
    isBuyerMaker: false,
  });
  // Event time: 10s is earlier than 20s. Therefore, open MUST update to 100.0, but close MUST stay 102.0!
  assert.equal(bar2.open, 100.0, 'Earlier trade at t0+10s updates bar.open to 100.0');
  assert.equal(bar2.close, 102.0, 'Later trade at t0+20s remains bar.close at 102.0 (not overwritten by t0+10s)');

  // 3. Arrives third: trade at t0 + 30000 with price 105.0
  const { currentBar: bar3 } = engine.processTick({
    id: 't_30s',
    timestamp: t0 + 30000,
    price: 105.0,
    size: 3,
    side: 'buy',
    isBuyerMaker: false,
  });
  assert.equal(bar3.open, 100.0, 'bar.open remains 100.0');
  assert.equal(bar3.close, 105.0, 'Latest trade at t0+30s updates bar.close to 105.0');

  // 4. Arrives fourth: late trade at t0 + 15000 with price 95.0 (new low, intermediate time)
  const { currentBar: bar4 } = engine.processTick({
    id: 't_15s',
    timestamp: t0 + 15000,
    price: 95.0,
    size: 4,
    side: 'sell',
    isBuyerMaker: true,
  });
  assert.equal(bar4.low, 95.0, 'Intermediate trade updates low to 95.0');
  assert.equal(bar4.open, 100.0, 'Intermediate trade does not overwrite open (100.0 at t0+10s)');
  assert.equal(bar4.close, 105.0, 'Intermediate trade does not overwrite close (105.0 at t0+30s)');
});

// 7. ProfileEngine Unknown-side Volume Preservation (P1 Correctness)
check('ProfileEngine preserves unknown-side volume at price levels and matches totalVolume', () => {
  const profile = new ProfileEngine(0.5);

  // Ingest buy, sell, and unknown ticks
  profile.processTick({ id: 'u1', timestamp: 1700000000000, price: 100.0, size: 10, side: 'buy', isBuyerMaker: false });
  profile.processTick({ id: 'u2', timestamp: 1700000001000, price: 100.0, size: 5, side: 'sell', isBuyerMaker: true });
  profile.processTick({ id: 'u3', timestamp: 1700000002000, price: 100.0, size: 7, side: 'unknown' });
  profile.processTick({ id: 'u4', timestamp: 1700000003000, price: 101.0, size: 3, side: 'unknown' });

  const vp = profile.getVolumeProfile();
  assert.equal(vp.totalVolume, 25, 'Total volume must be 10 + 5 + 7 + 3 = 25');

  const level100 = vp.levels.find((l) => l.price === 100.0);
  assert.ok(level100, 'Level 100.0 exists');
  assert.equal(level100.buyVolume, 10, 'Level 100 buyVolume is 10');
  assert.equal(level100.sellVolume, 5, 'Level 100 sellVolume is 5');
  assert.equal(level100.volume, 22, 'Level 100 total volume is 10 + 5 + 7 = 22');
  assert.equal(level100.delta, 5, 'Level 100 delta is 10 - 5 = 5 (unknown does not skew delta)');

  const level101 = vp.levels.find((l) => l.price === 101.0);
  assert.ok(level101, 'Level 101.0 exists');
  assert.equal(level101.buyVolume, 0, 'Level 101 buyVolume is 0');
  assert.equal(level101.sellVolume, 0, 'Level 101 sellVolume is 0');
  assert.equal(level101.volume, 3, 'Level 101 total volume is 3');
  assert.equal(level101.delta, 0, 'Level 101 delta is 0');

  const sumLevels = vp.levels.reduce((acc, l) => acc + l.volume, 0);
  assert.equal(sumLevels, vp.totalVolume, 'Sum of level volumes must EXACTLY equal totalVolume');
  assert.equal(vp.poc, 100.0, 'POC must be 100.0 (volume 22 > 3)');
});

// 8. ReplaySession Dynamic Profile & TPO Updates (Phase 2 Correctness)
check('ReplaySession emits PROFILE_UPDATE on step() to prevent frozen profile', () => {
  const mockWs = createMockSocket();
  const session = new ChartSession(mockWs as any);

  const ticks: Tick[] = [
    { id: 'r1', timestamp: 1700000000000, price: 5000.0, size: 5, side: 'buy', isBuyerMaker: false },
    { id: 'r2', timestamp: 1700000005000, price: 5001.0, size: 8, side: 'sell', isBuyerMaker: true },
  ];

  const replay = new ReplaySession(session, 'ES', FUTURES_INSTRUMENTS.ES, '1m', ticks);
  mockWs.sent.length = 0; // Clear INIT_STATE

  replay.step();

  const profileUpdates = mockWs.sent.filter((m) => m.type === 'PROFILE_UPDATE');
  assert.equal(profileUpdates.length, 1, 'ReplaySession.step() must emit 1 PROFILE_UPDATE');
  const pu = profileUpdates[0] as any;
  assert.ok(pu.volumeProfile, 'PROFILE_UPDATE contains volumeProfile');
  assert.ok(pu.tpo, 'PROFILE_UPDATE contains tpo');
  assert.equal(pu.volumeProfile.totalVolume, 5, 'Volume profile reflects stepped tick volume');

  replay.dispose();
});

// 9. LRU Map Dedup Invariant & Eviction Bound
check('LRU Map maintains strict 5,000 ID bound and single-entry invariant under high volume', () => {
  const ctx = new MarketContext(
    'BTCUSDT',
    FUTURES_INSTRUMENTS.BTCUSDT,
    new MockGexEngine() as any,
    new MockCboeProvider() as any
  );

  // Ingest 5,100 unique trades
  for (let i = 0; i < 5100; i++) {
    (ctx as any).handleTrade({
      id: `trade_${i}`,
      ts: 1700000000000 + i,
      price: 50000.0,
      size: 1,
      side: 'BUY',
    });
  }

  const dedupMap = (ctx as any).recentVendorTickIds as Map<string, true>;
  assert.equal(dedupMap.size, 5000, 'Dedup map must never exceed MAX_DEDUP_IDS (5000)');

  // Earliest trade_0 to trade_99 must be evicted
  assert.equal(dedupMap.has('trade_0'), false, 'trade_0 must be evicted');
  assert.equal(dedupMap.has('trade_99'), false, 'trade_99 must be evicted');

  // Latest trade_100 to trade_5099 must still be present
  assert.equal(dedupMap.has('trade_100'), true, 'trade_100 must be retained');
  assert.equal(dedupMap.has('trade_5099'), true, 'trade_5099 must be retained');
});

// 10. Live Snapshot Includes mode: 'LIVE'
check('Live MarketContext snapshot includes mode: LIVE to reset client replayProgress', () => {
  const ctx = new MarketContext(
    'BTCUSDT',
    FUTURES_INSTRUMENTS.BTCUSDT,
    new MockGexEngine() as any,
    new MockCboeProvider() as any
  );
  const mockWs = createMockSocket();
  const session = new ChartSession(mockWs as any);

  const snap = ctx.buildInitState(session, '1m') as any;
  assert.equal(snap.mode, 'LIVE', 'Live context snapshot must provide mode: LIVE');
  assert.equal(snap.symbol, 'BTCUSDT');
});

// 11. Timeframe History Loading via ensureHistoryBars
await checkAsync('ensureHistoryBars loads and caches timeframe bars without duplicate requests', async () => {
  let fetchCount = 0;
  const mockProvider = {
    fetchBinanceAggTrades: async () => [],
    fetchTradovateBars: async () => {
      fetchCount++;
      return [
        { time: 1700000000000, open: 5000, high: 5010, low: 4990, close: 5005, volume: 100 },
      ];
    },
  };

  const prevEnv = process.env.FUTURES_PROVIDER;
  process.env.FUTURES_PROVIDER = 'tradovate';
  try {
    const ctx = new MarketContext(
      'ES',
      FUTURES_INSTRUMENTS.ES,
      new MockGexEngine() as any,
      new MockCboeProvider() as any,
      undefined,
      mockProvider as any
    );

    // First call: fetches from provider
    const bars1 = await ctx.ensureHistoryBars('5m');
    assert.equal(bars1.length, 1, 'Returns 1 bar');
    assert.equal(fetchCount, 1, 'Provider called once');

    // Second call: returns from cache without calling provider again
    const bars2 = await ctx.ensureHistoryBars('5m');
    assert.equal(bars2.length, 1, 'Returns cached bar');
    assert.equal(fetchCount, 1, 'Provider not called again (cached)');
  } finally {
    process.env.FUTURES_PROVIDER = prevEnv;
  }
});

// 12. Stale Backfill Completion must NOT wipe liveBuffer or clear isBackfillingHistory of restarted feed
await checkAsync('Stale backfill completion does not mutate restarted feed buffer or state', async () => {
  let resolveBackfillA!: (ticks: Tick[]) => void;
  const backfillAPromise = new Promise<Tick[]>((resolve) => {
    resolveBackfillA = resolve;
  });

  const provider = {
    fetchBinanceAggTrades: async () => backfillAPromise,
    fetchTradovateBars: async () => [],
  };

  const ctx = new MarketContext(
    'BTCUSDT',
    FUTURES_INSTRUMENTS.BTCUSDT,
    new MockGexEngine() as any,
    new MockCboeProvider() as any,
    undefined,
    provider
  );

  // Start Feed A (token 1)
  (ctx as any).isBackfillingHistory = true;
  const backfillA = ctx.backfillHistory();
  assert.equal((ctx as any).isBackfillingHistory, true, 'Backfill A is active');

  // Feed restarts: token changes to token 2, creating new historyRequest and liveBuffer
  const token2 = ++(ctx as any).activeFeedToken;
  (ctx as any).historyRequest = new AbortController();
  (ctx as any).isBackfillingHistory = true;
  (ctx as any).liveBuffer = [];

  // Ticks arrive during Feed 2 backfill
  (ctx as any).handleTrade({ id: 'live_b1', ts: Date.now(), price: 50000, size: 1, side: 'BUY' });
  (ctx as any).handleTrade({ id: 'live_b2', ts: Date.now() + 1, price: 50001, size: 2, side: 'SELL' });
  assert.equal((ctx as any).liveBuffer.length, 2, 'Feed 2 has 2 buffered live ticks');

  // Now backfill A completes late
  resolveBackfillA([
    { id: 'hist_a', timestamp: 1700000000000, price: 49999, size: 1, side: 'buy', isBuyerMaker: false },
  ]);
  await backfillA;

  // Assert that Feed 2's buffer and state are PRESERVED:
  assert.equal((ctx as any).liveBuffer.length, 2, 'Feed 2 live buffer must NOT be wiped by stale backfill A');
  assert.equal((ctx as any).isBackfillingHistory, true, 'isBackfillingHistory must remain true for Feed 2');
});

// 13. Stale History Completion must NOT send snapshot to session that switched symbol
await checkAsync('Stale history completion does not leak snapshot across symbol switch', async () => {
  let resolveEsBars!: (bars: any[]) => void;
  const esBarsPromise = new Promise<any[]>((resolve) => {
    resolveEsBars = resolve;
  });

  const provider = {
    fetchBinanceAggTrades: async () => [],
    fetchTradovateBars: async (symbol: string) => {
      if (symbol.includes('ES')) {
        return esBarsPromise;
      }
      return [];
    },
  };

  const prevEnv = process.env.FUTURES_PROVIDER;
  process.env.FUTURES_PROVIDER = 'tradovate';
  try {
    const mgr = new MarketContextManager(undefined, new MockGexEngine() as any, new MockCboeProvider() as any, provider as any);
    const mockWs = createMockSocket();
    const session = new ChartSession(mockWs as any);

    // 1. Session subscribes to ES / 5m (gen 1)
    const gen1 = session.nextGeneration();
    await mgr.subscribe(session, 'ES', '5m', gen1);

    // Clear messages sent during initial subscribe
    mockWs.sent.length = 0;

    // 2. Session switches to NQ / 5m (gen 2) while ES history is still pending
    const gen2 = session.nextGeneration();
    await mgr.subscribe(session, 'NQ', '5m', gen2);

    // Clear messages sent during NQ subscribe
    mockWs.sent.length = 0;

    // 3. Now ES history finishes loading!
    resolveEsBars([
      { time: 1700000000000, open: 5000, high: 5010, low: 4990, close: 5005, volume: 100 },
    ]);
    // Give microtask queue time to process
    await new Promise((r) => setTimeout(r, 20));

    // Assert that session did NOT receive an ES snapshot!
    const leakedSnaps = mockWs.sent.filter((m) => m.type === 'INIT_STATE' && (m as any).symbol === 'ES');
    assert.equal(leakedSnaps.length, 0, 'Session must NOT receive ES snapshot after switching to NQ');
  } finally {
    process.env.FUTURES_PROVIDER = prevEnv;
  }
});

// 14. Concurrent ensureHistoryBars Coalescing (Single Provider Call)
await checkAsync('Concurrent ensureHistoryBars calls coalesce into a single provider call', async () => {
  let fetchCount = 0;
  let resolveBars!: (bars: any[]) => void;
  const provider = {
    fetchBinanceAggTrades: async () => [],
    fetchTradovateBars: async () => {
      fetchCount++;
      return new Promise<any[]>((resolve) => {
        resolveBars = resolve;
      });
    },
  };

  const prevEnv = process.env.FUTURES_PROVIDER;
  process.env.FUTURES_PROVIDER = 'tradovate';
  try {
    const ctx = new MarketContext(
      'ES',
      FUTURES_INSTRUMENTS.ES,
      new MockGexEngine() as any,
      new MockCboeProvider() as any,
      undefined,
      provider as any
    );

    // Call ensureHistoryBars concurrently 3 times
    const p1 = ctx.ensureHistoryBars('15m');
    const p2 = ctx.ensureHistoryBars('15m');
    const p3 = ctx.ensureHistoryBars('15m');

    assert.equal(fetchCount, 1, 'Provider must only be called once for concurrent requests');

    resolveBars([
      { time: 1700000000000, open: 5000, high: 5010, low: 4990, close: 5005, volume: 100 },
    ]);

    const [b1, b2, b3] = await Promise.all([p1, p2, p3]);
    assert.equal(b1.length, 1);
    assert.equal(b2.length, 1);
    assert.equal(b3.length, 1);
    assert.equal(fetchCount, 1, 'Provider was still only called once');
  } finally {
    process.env.FUTURES_PROVIDER = prevEnv;
  }
});

// 15. Strict Binance aggTrades Parsing & Edge Cases
check('parseBinanceAggTrades strictly rejects malformed rows and handles buyerMaker flags without misclassification', () => {
  const malformedRows = [
    // Trailing chars e.g. "100.5abc" must be rejected (not parsed as 100.5)
    { a: 1, p: '100.5abc', q: '1.0', T: 1700000000000, m: true },
    // Non-positive or non-finite price/size/timestamp
    { a: 2, p: '0', q: '1.0', T: 1700000000000, m: true },
    { a: 3, p: '-100', q: '1.0', T: 1700000000000, m: true },
    { a: 4, p: 'NaN', q: '1.0', T: 1700000000000, m: true },
    { a: 5, p: 'Infinity', q: '1.0', T: 1700000000000, m: true },
    { a: 6, p: '100.5', q: '0', T: 1700000000000, m: true },
    { a: 7, p: '100.5', q: '-1', T: 1700000000000, m: true },
    { a: 8, p: '100.5', q: '1.0', T: 0, m: true },
    // Empty or missing id
    { a: '', p: '100.5', q: '1.0', T: 1700000000000, m: true },
    { a: null, p: '100.5', q: '1.0', T: 1700000000000, m: true },
    { a: undefined, p: '100.5', q: '1.0', T: 1700000000000, m: true },
    // Invalid buyer-maker flag (non-boolean, neither "true" nor "false")
    { a: 9, p: '100.5', q: '1.0', T: 1700000000000, m: 'maybe' },
    // Valid buy trade (m is false)
    { a: 10, p: '100.5', q: '2.5', T: 1700000000000, m: false },
    // Valid sell trade (m is true)
    { a: 11, p: '101.0', q: '3.0', T: 1700000001000, m: true },
    // Valid buy trade with string "false" (must NOT become sell!)
    { a: 12, p: '101.5', q: '1.5', T: 1700000002000, m: 'false' },
    // Valid sell trade with string "true"
    { a: 13, p: '102.0', q: '4.0', T: 1700000003000, m: 'true' },
    // Duplicate id: must be deduplicated
    { a: 10, p: '100.5', q: '2.5', T: 1700000000000, m: false },
  ];

  const parsed = parseBinanceAggTrades(malformedRows);
  assert.equal(parsed.length, 4, 'Only 4 valid, deduplicated trades should be parsed');

  assert.equal(parsed[0].id, '10');
  assert.equal(parsed[0].side, 'buy');
  assert.equal(parsed[0].isBuyerMaker, false);

  assert.equal(parsed[1].id, '11');
  assert.equal(parsed[1].side, 'sell');
  assert.equal(parsed[1].isBuyerMaker, true);

  // Critical: string "false" must be BUY, not SELL
  assert.equal(parsed[2].id, '12');
  assert.equal(parsed[2].side, 'buy', 'String "false" must be classified as buy');
  assert.equal(parsed[2].isBuyerMaker, false);

  assert.equal(parsed[3].id, '13');
  assert.equal(parsed[3].side, 'sell');
  assert.equal(parsed[3].isBuyerMaker, true);
});

// 16. Replay State Machine & Mode Transitions
check('ReplaySession maintains a unified mode state machine across play, pause, step, seek, and clean dispose', () => {
  const mockWs = createMockSocket();
  const session = new ChartSession(mockWs as any);

  const ticks: Tick[] = [
    { id: 't1', timestamp: 1700000000000, price: 5000.0, size: 1, side: 'buy', isBuyerMaker: false },
    { id: 't2', timestamp: 1700000001000, price: 5001.0, size: 2, side: 'sell', isBuyerMaker: true },
  ];

  const replay = new ReplaySession(session, 'ES', FUTURES_INSTRUMENTS.ES, '1m', ticks);

  // Initial state: REPLAY (snapshot sent)
  assert.equal(session.mode, 'REPLAY');
  mockWs.sent.length = 0;

  // 1. Pause
  replay.pause();
  assert.equal(session.mode, 'REPLAY_PAUSED', 'Mode becomes REPLAY_PAUSED on pause');

  // 2. Step 1: index = 1 (< total 2)
  replay.step();
  assert.equal(session.mode, 'REPLAY_PAUSED', 'Mode remains REPLAY_PAUSED after step 1');

  // 3. Step 2: index = 2 (= total 2, ended)
  replay.step();
  assert.equal(session.mode, 'REPLAY_ENDED', 'Mode transitions to REPLAY_ENDED when last tick stepped');

  // 4. Seek back to 0: transitions from REPLAY_ENDED -> REPLAY_PAUSED
  replay.seek(0);
  assert.equal(session.mode, 'REPLAY_PAUSED', 'Mode transitions from REPLAY_ENDED to REPLAY_PAUSED upon seek(0)');
  const seekInitState = mockWs.sent.filter((m) => m.type === 'INIT_STATE').pop() as any;
  assert.ok(seekInitState, 'rebuildState emits INIT_STATE');
  assert.equal(seekInitState.mode, 'REPLAY_PAUSED', 'INIT_STATE after seek carries REPLAY_PAUSED mode');

  // 5. Clean Dispose: no progress or replay messages emitted during dispose
  mockWs.sent.length = 0;
  replay.dispose();
  assert.equal(session.mode, 'LIVE', 'Session mode transitions to LIVE on dispose');
  const leftoverReplayStates = mockWs.sent.filter((m) => m.type === 'REPLAY_STATE');
  assert.equal(leftoverReplayStates.length, 0, 'No leftover REPLAY_STATE messages emitted during dispose');
});

console.log('\n======================================================');
console.log(`Results: ${passed} passed, ${failed} failed`);
console.log('======================================================\n');

if (failed > 0) process.exit(1);
process.exit(0);

