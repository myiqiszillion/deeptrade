import assert from 'node:assert/strict';
import { SessionCalendar } from './calendar/sessionCalendar.js';
import { MarketContext } from './marketData/marketContext.js';
import { FUTURES_INSTRUMENTS } from './futuresConfig.js';
import { marketDataStore } from './storage/marketDataStore.js';
import { ChartSession } from './session.js';
import { ReplaySession } from './replaySession.js';

function createMockSocket() {
  const sent: any[] = [];
  return {
    readyState: 1, // OPEN
    bufferedAmount: 0,
    send(payload: string) {
      try {
        sent.push(JSON.parse(payload));
      } catch {
        sent.push(payload);
      }
    },
    close() {},
    sent,
  };
}

async function runPhaseDETests() {
  console.log('--- Starting Phase D & E Verification Tests ---');

  // Test 1: CME Session Calendar RTH vs ETH vs Closed
  console.log('Test 1: CME Session Calendar RTH vs ETH vs Closed...');
  // Wednesday 10:00 CT (RTH)
  // Let's construct Wednesday 2026-01-07 10:00 CT = 16:00 UTC
  const rthTime = Date.UTC(2026, 0, 7, 16, 0, 0);
  const rthInfo = SessionCalendar.getSessionInfo(rthTime, 'CME_EQUITY_INDEX');
  assert.equal(rthInfo.isOpen, true, 'Wednesday 10:00 CT must be OPEN');
  assert.equal(rthInfo.isRth, true, 'Wednesday 10:00 CT must be RTH');
  assert.equal(rthInfo.isEth, false, 'Wednesday 10:00 CT must not be ETH');

  // Wednesday 18:00 CT (ETH - next session date!)
  // 18:00 CT = 00:00 UTC next day
  const ethTime = Date.UTC(2026, 0, 8, 0, 0, 0);
  const ethInfo = SessionCalendar.getSessionInfo(ethTime, 'CME_EQUITY_INDEX');
  assert.equal(ethInfo.isOpen, true, 'Wednesday 18:00 CT must be OPEN');
  assert.equal(ethInfo.isRth, false, 'Wednesday 18:00 CT must not be RTH');
  assert.equal(ethInfo.isEth, true, 'Wednesday 18:00 CT must be ETH');
  assert.equal(ethInfo.sessionDate, '2026-01-08', 'Trades after 17:00 CT belong to 2026-01-08 session');

  // Saturday 12:00 CT (Closed)
  const satTime = Date.UTC(2026, 0, 10, 18, 0, 0);
  const satInfo = SessionCalendar.getSessionInfo(satTime, 'CME_EQUITY_INDEX');
  assert.equal(satInfo.isOpen, false, 'Saturday must be CLOSED');
  console.log('  [PASS] Test 1: CME Session Calendar trading hours verified.');

  // Test 2: Session Rollover Detection
  console.log('Test 2: Session rollover detection between two timestamps...');
  const isRollover = SessionCalendar.isNewSession(rthTime, ethTime, 'CME_EQUITY_INDEX');
  assert.equal(isRollover, true, '10:00 CT and 18:00 CT on same calendar day are different trading sessions');

  const withinSameSession = SessionCalendar.isNewSession(rthTime, rthTime + 3600000, 'CME_EQUITY_INDEX');
  assert.equal(withinSameSession, false, 'Timestamps within same session must not trigger rollover');
  console.log('  [PASS] Test 2: Session rollover detection verified.');

  // Test 3: MarketContext session rollover resets profile & VWAP
  console.log('Test 3: MarketContext session rollover resets intraday engines...');
  const ctx = new MarketContext('ES', FUTURES_INSTRUMENTS.ES);
  
  // Trade 1 in session 1
  (ctx as any).handleTrade({
    id: 't_sess1',
    ts: rthTime,
    price: 5800.0,
    size: 10,
    side: 'BUY',
  });

  // Check profile has volume
  assert.equal((ctx as any).profile.getVolumeProfile().totalVolume, 10);

  // Trade 2 in session 2 (after 17:00 CT)
  (ctx as any).handleTrade({
    id: 't_sess2',
    ts: ethTime,
    price: 5810.0,
    size: 5,
    side: 'BUY',
  });

  // Profile should have reset and only contain trade 2
  assert.equal((ctx as any).profile.getVolumeProfile().totalVolume, 5, 'Profile must reset upon session boundary');
  console.log('  [PASS] Test 3: Engine reset on session rollover verified.');

  // Test 4: Sequence gap detection on trades
  console.log('Test 4: Sequence gap detection on trades...');
  const ctxSeq = new MarketContext('ES', FUTURES_INSTRUMENTS.ES);
  (ctxSeq as any).handleTrade({
    id: 't_seq_1',
    ts: 1700000000000,
    sequenceId: 100,
    price: 5800.0,
    size: 1,
    side: 'BUY',
  });

  // Jump from sequence 100 to 105 (missing 101, 102, 103, 104)
  (ctxSeq as any).handleTrade({
    id: 't_seq_5',
    ts: 1700000001000,
    sequenceId: 105,
    price: 5800.25,
    size: 2,
    side: 'BUY',
  });

  const recordedGaps = marketDataStore.getGaps('ES', 1700000000000, 1700000002000);
  const tradeGap = recordedGaps.find((g) => g.reason.includes('Trade sequence gap'));
  assert.ok(tradeGap, 'Must record trade sequence gap in marketDataStore');
  assert.ok(tradeGap.reason.includes('4 missing'), 'Reason must mention 4 missing trades');
  console.log('  [PASS] Test 4: Trade sequence gap detection verified.');

  // Test 5: Depth sequence gap detection
  console.log('Test 5: Depth sequence gap detection...');
  (ctxSeq as any).handleDepth({
    kind: 'snapshot',
    bids: [{ price: 5800, size: 10 }],
    asks: [{ price: 5800.25, size: 10 }],
    updateId: 500,
    ts: 1700000000000,
  });

  // Delta arrives with updateId 505 (missing 501, 502, 503, 504)
  (ctxSeq as any).handleDepth({
    kind: 'delta',
    side: 'bid',
    price: 5800,
    size: 12,
    updateId: 505,
    ts: 1700000001000,
  });

  const depthGaps = marketDataStore.getGaps('ES');
  const depthGap = depthGaps.find((g) => g.reason.includes('Depth sequence gap'));
  assert.ok(depthGap, 'Must record depth sequence gap in marketDataStore');
  assert.ok(depthGap.reason.includes('4 missing'), 'Reason must mention 4 missing depth updates');
  console.log('  [PASS] Test 5: Depth sequence gap detection verified.');

  // Test 6: Multi-user Replay Isolation
  console.log('Test 6: Multi-user replay isolation...');
  const mockWsUser1 = createMockSocket();
  const sessionUser1 = new ChartSession(mockWsUser1 as any);
  const mockWsUser2 = createMockSocket();
  const sessionUser2 = new ChartSession(mockWsUser2 as any);

  const ticksForReplay = [
    { id: 't1', timestamp: 1700000000000, price: 5000, size: 1, side: 'buy' as const },
    { id: 't2', timestamp: 1700000001000, price: 5001, size: 2, side: 'sell' as const },
    { id: 't3', timestamp: 1700000002000, price: 5002, size: 3, side: 'buy' as const },
  ];

  const replay1 = new ReplaySession(sessionUser1, 'ES', FUTURES_INSTRUMENTS.ES, '1m', ticksForReplay);
  const replay2 = new ReplaySession(sessionUser2, 'ES', FUTURES_INSTRUMENTS.ES, '1m', ticksForReplay);
  sessionUser1.replaySession = replay1;
  sessionUser2.replaySession = replay2;

  // Step user 1 twice
  replay1.step();
  replay1.step();

  // User 1 is at index 2
  assert.equal(replay1.replayEngine.getProgress().currentIndex, 2);
  // User 2 has not stepped, must be at index 0
  assert.equal(replay2.replayEngine.getProgress().currentIndex, 0);

  // User 1 received 2 ticks, user 2 received 0
  const u1Ticks = mockWsUser1.sent.filter((m) => m.type === 'TICK');
  const u2Ticks = mockWsUser2.sent.filter((m) => m.type === 'TICK');
  assert.equal(u1Ticks.length, 2);
  assert.equal(u2Ticks.length, 0);

  replay1.dispose();
  replay2.dispose();
  console.log('  [PASS] Test 6: Multi-user replay isolation verified.');

  console.log('--- ALL 6 PHASE D & E TESTS PASSED SUCCESSFULLY ---');
}

runPhaseDETests().catch((err) => {
  console.error('Phase D & E verification failed:', err);
  process.exit(1);
});
