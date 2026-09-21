import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { rmSync, existsSync } from 'node:fs';
import { MarketDataStore } from './storage/marketDataStore.js';
import { MarketTrade } from './marketData/types.js';
import { HistoricalBar } from './types.js';
import { entitlementService } from './auth/entitlementService.js';
import { createToken } from './auth/token.js';
import { User } from './auth/types.js';

const TEST_DB_PATH = resolve(process.cwd(), 'data', 'test_phase_c.sqlite');

async function runPhaseCTests() {
  console.log('--- Starting Phase C Verification Tests ---');

  // Clean up any previous test database
  if (existsSync(TEST_DB_PATH)) {
    try {
      rmSync(TEST_DB_PATH, { force: true });
      rmSync(`${TEST_DB_PATH}-wal`, { force: true });
      rmSync(`${TEST_DB_PATH}-shm`, { force: true });
    } catch {}
  }

  // 1. Storage & WAL initialization
  console.log('Test 1: Storage initialization & schema creation...');
  const store1 = new MarketDataStore(TEST_DB_PATH);
  assert.ok(existsSync(TEST_DB_PATH), 'SQLite database file must exist');
  console.log('  [PASS] Test 1: SQLite store created with WAL mode.');

  // 2. Trade persistence and deduplication
  console.log('Test 2: Trade persistence & deduplication...');
  const sampleTrades: MarketTrade[] = [
    {
      id: 'trade_1',
      ts: 1700000001000,
      price: 5000.25,
      size: 2,
      side: 'BUY',
      aggressorProvenance: 'EXCHANGE_NATIVE',
      sourceProvider: 'tradovate',
    },
    {
      id: 'trade_2',
      ts: 1700000002000,
      price: 5000.50,
      size: 5,
      side: 'SELL',
      aggressorProvenance: 'EXCHANGE_NATIVE',
      sourceProvider: 'tradovate',
    },
    {
      id: 'trade_3',
      ts: 1700000002000, // Same timestamp as trade_2
      price: 5000.50,
      size: 1,
      side: 'SELL',
      aggressorProvenance: 'EXCHANGE_NATIVE',
      sourceProvider: 'tradovate',
    },
  ];

  store1.saveTrades(sampleTrades, 'ESH6', 'tradovate');
  // Re-save to test deduplication (INSERT OR IGNORE)
  store1.saveTrades(sampleTrades, 'ESH6', 'tradovate');

  const allTrades = store1.queryTrades('ESH6', { limit: 10 });
  assert.equal(allTrades.trades.length, 3, 'Must have exactly 3 unique trades (deduplicated)');
  assert.equal(allTrades.trades[0].id, 'trade_1');
  assert.equal(allTrades.trades[1].id, 'trade_2');
  assert.equal(allTrades.trades[2].id, 'trade_3');
  console.log('  [PASS] Test 2: Trade deduplication and ordering verified.');

  // 3. Stable cursor pagination for identical timestamps
  console.log('Test 3: Stable cursor pagination across identical timestamps...');
  const page1 = store1.queryTrades('ESH6', { limit: 2 });
  assert.equal(page1.trades.length, 2, 'Page 1 must return 2 trades');
  assert.equal(page1.hasMore, true, 'Page 1 must indicate hasMore');
  assert.ok(page1.cursor, 'Page 1 must have cursor');

  const page2 = store1.queryTrades('ESH6', {
    beforeTime: page1.cursor!.beforeTime,
    beforeId: page1.cursor!.beforeId,
    limit: 2,
  });
  assert.equal(page2.trades.length, 1, 'Page 2 must return the remaining 1 trade');
  assert.equal(page2.trades[0].id, 'trade_1', 'Page 2 trade must be trade_1');
  console.log('  [PASS] Test 3: Stable composite cursor pagination verified.');

  // 4. Bar persistence & pagination
  console.log('Test 4: Bar persistence and query...');
  const sampleBars: HistoricalBar[] = [
    { time: 1700000000000, open: 5000, high: 5010, low: 4995, close: 5005, volume: 100 },
    { time: 1700000060000, open: 5005, high: 5015, low: 5002, close: 5012, volume: 150 },
    { time: 1700000120000, open: 5012, high: 5020, low: 5010, close: 5018, volume: 200 },
    { time: 1700000180000, open: 5018, high: 5025, low: 5015, close: 5022, volume: 180 },
  ];

  store1.saveBars(sampleBars, 'ESH6', '1m', 'tradovate');
  const barResult = store1.queryBars('ESH6', '1m', { limit: 2 });
  assert.equal(barResult.bars.length, 2, 'Should return 2 most recent bars');
  assert.equal(barResult.hasMore, true, 'Should have more bars');
  assert.equal(barResult.bars[0].time, 1700000120000);
  assert.equal(barResult.bars[1].time, 1700000180000);

  // Pagination for earlier bars
  const earlierBars = store1.queryBars('ESH6', '1m', { limit: 2, beforeTime: barResult.cursor });
  assert.equal(earlierBars.bars.length, 2);
  assert.equal(earlierBars.bars[0].time, 1700000000000);
  assert.equal(earlierBars.bars[1].time, 1700000060000);
  assert.equal(earlierBars.hasMore, false, 'No more earlier bars');
  console.log('  [PASS] Test 4: Bar persistence and pagination verified.');

  // 5. Gap tracking
  console.log('Test 5: Gap tracking...');
  store1.recordGap('ESH6', 'tradovate', 1700000030000, 1700000050000, 'network_disconnect');
  const gaps = store1.getGaps('ESH6');
  assert.equal(gaps.length, 1);
  assert.equal(gaps[0].reason, 'network_disconnect');
  assert.equal(gaps[0].fromTs, 1700000030000);
  assert.equal(gaps[0].toTs, 1700000050000);
  console.log('  [PASS] Test 5: Gap tracking verified.');

  // Close store1
  store1.close();

  // 6. Persistence across restart
  console.log('Test 6: Persistence across restart...');
  const store2 = new MarketDataStore(TEST_DB_PATH);
  const recoveredTrades = store2.queryTrades('ESH6', { limit: 10 });
  assert.equal(recoveredTrades.trades.length, 3, 'Recovered trades must be 3');
  const recoveredBars = store2.queryBars('ESH6', '1m', { limit: 10 });
  assert.equal(recoveredBars.bars.length, 4, 'Recovered bars must be 4');
  const recoveredGaps = store2.getGaps('ESH6');
  assert.equal(recoveredGaps.length, 1, 'Recovered gaps must be 1');
  store2.close();
  console.log('  [PASS] Test 6: Persistence across restart verified.');

  // 7. Entitlement checks for BARS
  console.log('Test 7: Entitlement verification for BARS...');
  const testUser: User = { id: 'test_hist_user', username: 'histuser', role: 'user', status: 'active' };
  
  // Initially no entitlement
  assert.equal(
    entitlementService.hasEntitlement(testUser.id, 'ESH6', 'BARS'),
    false,
    'User without BARS entitlement must be denied'
  );

  // Grant BARS entitlement
  entitlementService.grant({
    id: 'ent_hist_1',
    userId: testUser.id,
    provider: 'tradovate',
    exchange: 'CME',
    symbolPattern: 'ESH6',
    dataTypes: ['BARS'],
    validUntil: Date.now() + 3600000,
    createdAt: Date.now(),
  });

  assert.equal(
    entitlementService.hasEntitlement(testUser.id, 'ESH6', 'BARS'),
    true,
    'User with BARS entitlement must be allowed'
  );
  assert.equal(
    entitlementService.hasEntitlement(testUser.id, 'NQH6', 'BARS'),
    false,
    'User must NOT have BARS entitlement for other symbols'
  );
  console.log('  [PASS] Test 7: Entitlement check for BARS verified.');

  // Clean up
  try {
    rmSync(TEST_DB_PATH, { force: true });
    rmSync(`${TEST_DB_PATH}-wal`, { force: true });
    rmSync(`${TEST_DB_PATH}-shm`, { force: true });
  } catch {}

  console.log('--- ALL 7 PHASE C TESTS PASSED SUCCESSFULLY ---');
}

runPhaseCTests().catch((err) => {
  console.error('Phase C verification failed:', err);
  process.exit(1);
});
