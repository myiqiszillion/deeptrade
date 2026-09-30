import assert from 'node:assert/strict';
import { marketDataStore } from '../../src/storage/marketDataStore.js';
import { HistoricalBar, Tick } from '../../src/types.js';

export async function runRetentionTests(): Promise<void> {
  console.log('[unit/retention.test] Running retention & housekeeping unit tests...');

  const provider = 'retention-test';
  const symbol = 'TST';
  const day = 24 * 60 * 60 * 1000;
  const now = Date.now();

  const bar = (time: number, close: number): HistoricalBar => ({
    time,
    open: close,
    high: close,
    low: close,
    close,
    volume: 10,
  });
  const tick = (timestamp: number, price: number, id: string): Tick => ({
    id,
    timestamp,
    price,
    size: 1,
    side: 'buy',
  });

  // 1. Seed old and fresh rows
  const oldBarTime = now - 40 * day;
  const freshBarTime = now - 2 * day;
  marketDataStore.saveBars([bar(oldBarTime, 100), bar(freshBarTime, 200)], symbol, '1m', provider);
  marketDataStore.saveTrades([tick(now - 40 * day, 100, 'old-1'), tick(now - day, 200, 'fresh-1')], symbol, provider);
  marketDataStore.recordGap(symbol, provider, now - 50 * day, now - 40 * day, 'unit-test gap');

  const seeded = marketDataStore.queryBars({ provider, symbol, timeframe: '1m', limit: 100 });
  const seededTimes = seeded.bars.map((b) => b.time);
  console.log(`    seeded bar times: ${JSON.stringify(seededTimes)}`);
  assert.ok(seededTimes.includes(oldBarTime), 'The old bar is queryable before retention runs');
  assert.ok(seededTimes.includes(freshBarTime), 'The fresh bar is queryable before retention runs');
  assert.equal(seeded.bars[0].time, oldBarTime, 'Bars come back ascending');

  // 2. Retention deletes only what is older than the cutoff
  marketDataStore.purgeOldData(30 * day);
  const after = marketDataStore.queryBars({ provider, symbol, timeframe: '1m', limit: 100 });
  const afterTimes = after.bars.map((b) => b.time);
  assert.ok(!afterTimes.includes(oldBarTime), 'The old bar was purged');
  assert.deepEqual(afterTimes, [freshBarTime], 'Only the fresh bar survived');

  const trades = marketDataStore.queryTrades({ provider, symbol, limit: 100 });
  const tradeIds = trades.trades.map((t) => t.id);
  assert.ok(!tradeIds.includes('old-1'), 'The old tick was purged');
  assert.deepEqual(tradeIds, ['fresh-1'], 'Only the fresh tick survived');

  const gaps = marketDataStore.getGaps(symbol);
  assert.equal(gaps.length, 0, 'Old gap rows are purged with the rest');

  // 3. Expired revocations are dropped, live ones stay
  const expiredJti = 'jti-expired';
  const liveJti = 'jti-live';
  marketDataStore.revokeTokenJti(expiredJti, 'usr_x', Math.floor(Date.now() / 1000) - 60);
  marketDataStore.revokeTokenJti(liveJti, 'usr_x', Math.floor(Date.now() / 1000) + 600);
  assert.equal(marketDataStore.isTokenJtiRevoked(liveJti), true, 'Fresh revocation is honoured');
  marketDataStore.purgeExpiredRevocations();
  assert.equal(marketDataStore.isTokenJtiRevoked(liveJti), true, 'Unexpired revocation survives the purge');

  // 4. stats() reports the tables used by /metrics
  const stats = marketDataStore.stats();
  assert.ok(stats.trades >= 1 && stats.bars >= 1, 'stats() counts persisted rows');
  assert.ok(typeof stats.users === 'number' && typeof stats.subscriptions === 'number');

  // 5. Maintenance primitives are safe to call on a live connection
  marketDataStore.checkpointWal();
  assert.doesNotThrow(() => marketDataStore.vacuum(), 'VACUUM must not throw on an in-memory store');

  // 6. Bars can outlive ticks: candles are tiny, so paid vendor history stays on disk for a year.
  const longLivedBarTime = now - 200 * day;
  const expiredBarTime = now - 400 * day;
  marketDataStore.saveBars([bar(longLivedBarTime, 111), bar(expiredBarTime, 222)], symbol, '5m', provider);
  marketDataStore.purgeOldData(30 * day, 365 * day);
  const barsAfterSplitRetention = marketDataStore.queryBars({ provider, symbol, timeframe: '5m', limit: 100 })
    .bars.map((b) => b.time);
  assert.ok(barsAfterSplitRetention.includes(longLivedBarTime), 'A 200-day-old bar survives a 365-day bar window');
  assert.ok(!barsAfterSplitRetention.includes(expiredBarTime), 'A 400-day-old bar is still purged');

  // 7. 0 disables deletion for that table (and 0/0 is a complete no-op)
  marketDataStore.purgeOldData(0, 0);
  const untouched = marketDataStore.queryBars({ provider, symbol, timeframe: '1m', limit: 100 }).bars.map((b) => b.time);
  assert.ok(untouched.includes(freshBarTime), 'purgeOldData(0, 0) deletes nothing');

  marketDataStore.purgeOldData(0, 365 * day);
  const tradesAfterBarsOnlyPurge = marketDataStore.queryTrades({ provider, symbol, limit: 100 }).trades.map((t) => t.id);
  assert.ok(tradesAfterBarsOnlyPurge.includes('fresh-1'), 'A 0 tick window keeps every tick (bars-only purge)');

  // 8. Vendor spend ledger lives in the same store and survives the purge path
  marketDataStore.addVendorUsage('unit-test-vendor', '2026-09', 1.25, 3);
  const usage = marketDataStore.getVendorUsage('unit-test-vendor', '2026-09');
  assert.equal(usage.usd, 1.25, 'vendor spend is written');
  assert.equal(usage.requests, 3, 'vendor request count is written');
  const history = marketDataStore.listVendorUsage('unit-test-vendor', 12);
  assert.equal(history.length, 1, 'monthly history is listed');
  assert.equal(history[0].month, '2026-09');
  marketDataStore.clearVendorUsage('unit-test-vendor');
  assert.equal(marketDataStore.getVendorUsage('unit-test-vendor', '2026-09').usd, 0, 'ledger can be cleared');

  console.log('  [PASS] All retention & housekeeping unit tests passed.');
}

if (process.argv[1]?.endsWith('retention.test.ts') || process.argv[1]?.endsWith('retention.test.js')) {
  runRetentionTests().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
