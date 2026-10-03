import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { MarketDataStore } from '../../src/storage/marketDataStore.js';
import { TimescaleStore } from '../../src/storage/timescaleStore.js';
import { RedisCache } from '../../src/storage/redisCache.js';
import { OptionContractDefinition, OptionStatisticRecord, NormalizedQuote } from '../../src/databento/types.js';

export async function runDatabentoStorageTests(): Promise<void> {
  console.log('[unit/databentoStorage.test] Running Databento storage & cache unit tests...');

  // 1. MarketDataStore Options Definitions & Statistics (SQLite in-memory)
  {
    const store = new MarketDataStore(':memory:');

    const sampleDefs: OptionContractDefinition[] = [
      {
        symbol: 'SPY260320C00500000',
        underlying: 'SPY',
        expiration: '2026-03-20',
        expirationTimestamp: 1774051200000,
        type: 'call',
        strike: 500,
        dte: 10,
        multiplier: 100,
      },
      {
        symbol: 'SPY260320P00500000',
        underlying: 'SPY',
        expiration: '2026-03-20',
        expirationTimestamp: 1774051200000,
        type: 'put',
        strike: 500,
        dte: 10,
        multiplier: 100,
      },
    ];

    store.saveOptionDefinitions(sampleDefs);
    const retrieved = store.getOptionDefinitions('SPY');
    assert.equal(retrieved.length, 2);
    assert.equal(retrieved[0].symbol, 'SPY260320C00500000');
    assert.equal(retrieved[0].strike, 500);
    assert.equal(retrieved[1].symbol, 'SPY260320P00500000');

    // Save statistics
    const stats: OptionStatisticRecord[] = [
      {
        symbol: 'SPY260320C00500000',
        timestamp: 1711033200000,
        openInterest: 15400,
        settlementPrice: 25.4,
        clearedVolume: 4200,
      },
    ];
    store.saveStatistics(stats);

    const latestStat = store.getLatestStatistics('SPY260320C00500000');
    assert.ok(latestStat);
    assert.equal(latestStat.openInterest, 15400);
    assert.equal(latestStat.settlementPrice, 25.4);
    assert.equal(latestStat.clearedVolume, 4200);

    // TimescaleStore proxying
    const timescale = new TimescaleStore({ fallbackStore: store });
    assert.equal(timescale.isFallback, true);
    const tsDefs = await timescale.getOptionDefinitions('SPY');
    assert.equal(tsDefs.length, 2);

    console.log('  PASS  IMarketDataStore options definitions and statistics');
  }

  // 2. RedisCache TTL and in-memory cache operations
  {
    const cache = new RedisCache();
    assert.equal(cache.isInMemory, true);

    const sampleQuote: NormalizedQuote = {
      symbol: 'SPY',
      bidPrice: 520.10,
      askPrice: 520.15,
      bidSize: 100,
      askSize: 150,
      timestamp: Date.now(),
      midPrice: 520.125,
      spread: 0.05,
    };

    await cache.setLatestQuote('SPY', sampleQuote, 1);
    const cachedQuote = await cache.getLatestQuote('SPY');
    assert.ok(cachedQuote);
    assert.equal(cachedQuote.bidPrice, 520.10);
    assert.equal(cachedQuote.askPrice, 520.15);

    // Option chain caching
    const chainDefs: OptionContractDefinition[] = [
      {
        symbol: 'AAPL260320C00180000',
        underlying: 'AAPL',
        expiration: '2026-03-20',
        expirationTimestamp: 1774051200000,
        type: 'call',
        strike: 180,
        dte: 10,
        multiplier: 100,
      },
    ];

    await cache.setOptionChain('AAPL', chainDefs, 5);
    const cachedChain = await cache.getOptionChain('AAPL');
    assert.ok(cachedChain);
    assert.equal(cachedChain.length, 1);
    assert.equal(cachedChain[0].symbol, 'AAPL260320C00180000');

    cache.close();
    console.log('  PASS  RedisCache quotes and chain operations');
  }

  console.log('  [PASS] All Databento storage & cache unit tests passed.');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  runDatabentoStorageTests().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
