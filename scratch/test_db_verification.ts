import assert from 'node:assert/strict';
import { MarketDataStore } from '../server/src/storage/marketDataStore.js';

async function runDatabaseVerification() {
  console.log('=== STARTING DATABASE ENVIRONMENT RESOLUTION VERIFICATION ===');
  const oldNodeEnv = process.env.NODE_ENV;
  const oldDevHooks = process.env.DEV_HOOKS;
  const oldStorage = process.env.STORAGE_PATH;

  try {
    delete process.env.STORAGE_PATH;

    // -------------------------------------------------------------
    // 1. TEST ENVIRONMENT (NODE_ENV=test)
    // -------------------------------------------------------------
    console.log('[Test Mode] Setting NODE_ENV=test (and DEV_HOOKS=1)...');
    process.env.NODE_ENV = 'test';
    process.env.DEV_HOOKS = '1';

    // Calling constructor with NO arguments must automatically select :memory:
    const testStore1 = new MarketDataStore();
    testStore1.saveTrades([{
      id: 't_isolation_test_1',
      timestamp: Date.now(),
      price: 5000,
      size: 1,
      side: 'buy',
    }], 'ES', 'test_provider');

    const result1 = testStore1.queryTrades({ provider: 'test_provider', symbol: 'ES' });
    assert.equal(result1.trades.length, 1, 'Store 1 must contain the saved trade');

    // Create a second store instance with NODE_ENV=test
    const testStore2 = new MarketDataStore();
    const result2 = testStore2.queryTrades({ provider: 'test_provider', symbol: 'ES' });
    assert.equal(result2.trades.length, 0, 'Store 2 must be empty in-memory DB, proving isolation');
    console.log('  -> PASS: NODE_ENV=test strictly uses isolated :memory: database.');

    // -------------------------------------------------------------
    // 2. DEVELOPMENT ENVIRONMENT (NODE_ENV=development)
    // -------------------------------------------------------------
    console.log('[Dev Mode] Setting NODE_ENV=development with DEV_HOOKS=1...');
    process.env.NODE_ENV = 'development';
    process.env.DEV_HOOKS = '1'; // In the past, DEV_HOOKS=1 erroneously forced :memory:

    const devStore = new MarketDataStore();
    // Query real historical trades recorded in data/market_data.sqlite
    const devTrades = devStore.queryTrades({ provider: 'databento', symbol: 'ES', limit: 100 });
    console.log(`  -> Dev query returned ${devTrades.trades.length} historical trades for ES from real SQLite.`);
    assert.ok(devTrades.trades.length > 0, 'Development store MUST read real historical trades from disk SQLite');
    assert.ok(devTrades.trades.some((t) => t.id && t.price > 4000), 'Trades must contain real prices');

    // Verify DEV_HOOKS=1 did NOT force :memory:
    console.log('  -> PASS: NODE_ENV=development connects to persistent SQLite DB even when DEV_HOOKS=1.');

    console.log('\n✅ ALL DATABASE ENVIRONMENT VERIFICATION CASES PASSED!\n');
  } finally {
    process.env.NODE_ENV = oldNodeEnv;
    process.env.DEV_HOOKS = oldDevHooks;
    if (oldStorage) process.env.STORAGE_PATH = oldStorage;
  }
}

runDatabaseVerification().catch((err) => {
  console.error('❌ Database Verification Failed:', err);
  process.exit(1);
});
