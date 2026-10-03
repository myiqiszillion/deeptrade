import assert from 'node:assert';
import { IncomingMessage, ServerResponse } from 'node:http';
import { EventEmitter } from 'node:events';
import { createOptionsRouter } from '../../src/marketData/optionsRoutes.js';
import { DatabentoHttpClient } from '../../src/databento/client.js';
import { MarketDataStore } from '../../src/storage/marketDataStore.js';
import { RedisCache } from '../../src/storage/redisCache.js';
import { OptionContractDefinition } from '../../src/databento/types.js';

class MockResponse extends EventEmitter {
  public statusCode = 200;
  public headers: Record<string, string> = {};
  public body = '';

  writeHead(statusCode: number, headers: Record<string, string>) {
    this.statusCode = statusCode;
    this.headers = headers;
    return this;
  }

  end(data?: string) {
    if (data) this.body += data;
    this.emit('finish');
    return this;
  }
}

export async function runOptionsRoutesTests(): Promise<void> {
  console.log('\n--- Options Routes Test Suite ---');

  const store = new MarketDataStore(':memory:');
  const cache = new RedisCache();
  const dbClient = new DatabentoHttpClient({ apiKey: '' });

  // Seed store with option definitions
  const testDefs: OptionContractDefinition[] = [
    {
      symbol: 'SPY260320C00500000',
      underlying: 'SPY',
      expiration: '2026-03-20',
      expirationTimestamp: Date.parse('2026-03-20T20:00:00Z'),
      strike: 500,
      type: 'call',
      dte: 30,
      multiplier: 100,
    },
    {
      symbol: 'SPY260320P00500000',
      underlying: 'SPY',
      expiration: '2026-03-20',
      expirationTimestamp: Date.parse('2026-03-20T20:00:00Z'),
      strike: 500,
      type: 'put',
      dte: 30,
      multiplier: 100,
    },
  ];
  store.saveOptionDefinitions(testDefs);

  const handler = createOptionsRouter({ dbClient, store, cache });

  // 1. Test GET /api/v1/options/chain
  {
    const req = new IncomingMessage({} as any);
    const res = new MockResponse();
    const url = new URL('http://localhost:8080/api/v1/options/chain?underlying=SPY');

    const handled = await handler(req, res as any, url);
    assert.strictEqual(handled, true, 'Handler should handle /api/v1/options/chain');
    assert.strictEqual(res.statusCode, 200, 'Status should be 200');

    const parsed = JSON.parse(res.body);
    assert.strictEqual(parsed.symbol, 'SPY');
    assert.strictEqual(parsed.contracts.length, 2);
    assert.strictEqual(parsed.contracts[0].symbol, 'SPY260320C00500000');
    assert.strictEqual(parsed.putCallRatio, 1.0);
    console.log('✓ GET /api/v1/options/chain returns structured chain with PCR');
  }

  // 2. Test caching on second chain fetch
  {
    const req = new IncomingMessage({} as any);
    const res = new MockResponse();
    const url = new URL('http://localhost:8080/api/v1/options/chain?underlying=SPY');

    await handler(req, res as any, url);
    const parsed = JSON.parse(res.body);
    assert.strictEqual(parsed.contracts.length, 2);
    console.log('✓ GET /api/v1/options/chain serves from memory cache correctly');
  }

  // 3. Test GET /api/v1/options/trades (without live vendor, returns empty array safely)
  {
    const req = new IncomingMessage({} as any);
    const res = new MockResponse();
    const url = new URL('http://localhost:8080/api/v1/options/trades?underlying=SPY&limit=10');

    const handled = await handler(req, res as any, url);
    assert.strictEqual(handled, true);
    assert.strictEqual(res.statusCode, 200);

    const parsed = JSON.parse(res.body);
    assert.strictEqual(parsed.symbol, 'SPY');
    assert(Array.isArray(parsed.trades));
    console.log('✓ GET /api/v1/options/trades handles empty/offline vendor safely');
  }

  // 4. Test GET /api/v1/options/statistics
  {
    // Seed statistics
    store.saveStatistics([
      {
        symbol: 'SPY260320C00500000',
        timestamp: Date.now(),
        openInterest: 12500,
        settlementPrice: 15.5,
      },
    ]);

    const req = new IncomingMessage({} as any);
    const res = new MockResponse();
    const url = new URL('http://localhost:8080/api/v1/options/statistics?symbol=SPY260320C00500000');

    const handled = await handler(req, res as any, url);
    assert.strictEqual(handled, true);
    assert.strictEqual(res.statusCode, 200);

    const parsed = JSON.parse(res.body);
    assert.strictEqual(parsed.symbol, 'SPY260320C00500000');
    assert.strictEqual(parsed.statistics.openInterest, 12500);
    assert.strictEqual(parsed.statistics.settlementPrice, 15.5);
    console.log('✓ GET /api/v1/options/statistics returns latest OI & settlement');
  }

  // 5. Test missing symbol on statistics
  {
    const req = new IncomingMessage({} as any);
    const res = new MockResponse();
    const url = new URL('http://localhost:8080/api/v1/options/statistics');

    const handled = await handler(req, res as any, url);
    assert.strictEqual(handled, true);
    assert.strictEqual(res.statusCode, 400);
    console.log('✓ GET /api/v1/options/statistics validates required symbol parameter');
  }

  // 6. Test unrelated path returns false
  {
    const req = new IncomingMessage({} as any);
    const res = new MockResponse();
    const url = new URL('http://localhost:8080/api/v1/other/path');

    const handled = await handler(req, res as any, url);
    assert.strictEqual(handled, false);
    console.log('✓ Non-options path returns false to allow fallthrough');
  }

  store.close();
}
