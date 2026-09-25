import assert from 'node:assert/strict';
import { existsSync, unlinkSync } from 'node:fs';
import { resolve } from 'node:path';
import { MarketDataStore } from '../../src/storage/marketDataStore.js';
import { sampleHistoricalBars } from '../fixtures/bars.js';
import { sampleTicks } from '../fixtures/trades.js';

const TEST_DB = resolve(process.cwd(), 'test_market_data_store.sqlite');

export async function runMarketDataStoreTests(): Promise<void> {
  console.log('[unit/marketDataStore.test] Running MarketDataStore unit tests...');

  if (existsSync(TEST_DB)) unlinkSync(TEST_DB);

  try {
    const store = new MarketDataStore(TEST_DB);

    // 1. Trade Persistence & Deduplication
    store.saveTrades(sampleTicks, 'ES', 'tradovate');
    // Save again to verify deduplication
    store.saveTrades(sampleTicks, 'ES', 'tradovate');

    const tradesResult = store.queryTrades({ provider: 'tradovate', symbol: 'ES', limit: 10 });
    assert.equal(tradesResult.trades.length, 3, 'Must have exactly 3 deduplicated trades');
    assert.equal(tradesResult.trades[0].id, 't_1');
    assert.equal(tradesResult.trades[1].id, 't_2');
    assert.equal(tradesResult.trades[2].id, 't_3');

    // 2. Composite Cursor Pagination
    const page1 = store.queryTrades({ provider: 'tradovate', symbol: 'ES', limit: 2 });
    assert.equal(page1.trades.length, 2, 'Page 1 must return 2 trades');
    assert.equal(page1.hasMore, true, 'Page 1 must have more trades');
    assert.ok(page1.cursor, 'Page 1 must return cursor');

    const page2 = store.queryTrades({
      provider: 'tradovate',
      symbol: 'ES',
      beforeTime: page1.cursor!.beforeTime,
      beforeId: page1.cursor!.beforeId,
      limit: 2,
    });
    assert.equal(page2.trades.length, 1, 'Page 2 must return the remaining 1 trade');
    assert.equal(page2.trades[0].id, 't_1');

    // 3. Provider Scoping (no cross-provider leakage)
    const binanceTrades = store.queryTrades({ provider: 'binance', symbol: 'ES', limit: 10 });
    assert.equal(binanceTrades.trades.length, 0, 'Querying different provider must return 0 trades');

    // 4. Bar Persistence & Pagination
    store.saveBars(sampleHistoricalBars, 'ES', '1m', 'tradovate');
    const barsResult = store.queryBars({ provider: 'tradovate', symbol: 'ES', timeframe: '1m', limit: 2 });
    assert.equal(barsResult.bars.length, 2, 'Must return 2 most recent bars');
    assert.equal(barsResult.hasMore, true);
    assert.ok(barsResult.cursor);

    const earlierBars = store.queryBars({
      provider: 'tradovate',
      symbol: 'ES',
      timeframe: '1m',
      beforeTime: barsResult.cursor!.beforeTime,
      limit: 2,
    });
    assert.equal(earlierBars.bars.length, 2);
    assert.equal(earlierBars.hasMore, false);

    // 5. Gap Recording
    store.recordGap('ES', 'tradovate', 1700000000000, 1700000010000, 'network_disconnect');
    const gaps = store.getGaps('ES');
    assert.equal(gaps.length, 1);
    assert.equal(gaps[0].reason, 'network_disconnect');

    // 6. User & Entitlement & Revocation Persistence
    store.saveUser({ id: 'u_p1', username: 'persistent1', role: 'user', status: 'active' });
    const user = store.getUser('u_p1');
    assert.ok(user);
    assert.equal(user.username, 'persistent1');

    store.saveEntitlement({
      id: 'ent_p1',
      userId: 'u_p1',
      provider: 'cme',
      symbolPattern: 'ES',
      dataTypes: ['FOOTPRINT'],
      validUntil: Date.now() + 100000,
      createdAt: Date.now(),
    });
    const ents = store.getEntitlementsForUser('u_p1');
    assert.equal(ents.length, 1);
    assert.equal(ents[0].symbolPattern, 'ES');

    store.revokeTokenJti('jti_p1', 'u_p1', Math.floor(Date.now() / 1000) + 3600);
    assert.equal(store.isTokenJtiRevoked('jti_p1'), true);

    // Close and Reopen Store
    store.close();

    const reopenedStore = new MarketDataStore(TEST_DB);
    assert.equal(reopenedStore.queryTrades({ provider: 'tradovate', symbol: 'ES', limit: 10 }).trades.length, 3);
    assert.equal(reopenedStore.queryBars({ provider: 'tradovate', symbol: 'ES', timeframe: '1m', limit: 10 }).bars.length, 4);
    assert.equal(reopenedStore.getUser('u_p1')?.username, 'persistent1');
    assert.equal(reopenedStore.isTokenJtiRevoked('jti_p1'), true);
    reopenedStore.close();

    console.log('  [PASS] All MarketDataStore unit tests passed.');
  } finally {
    if (existsSync(TEST_DB)) unlinkSync(TEST_DB);
  }
}

if (process.argv[1]?.endsWith('marketDataStore.test.ts') || process.argv[1]?.endsWith('marketDataStore.test.js')) {
  runMarketDataStoreTests().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
