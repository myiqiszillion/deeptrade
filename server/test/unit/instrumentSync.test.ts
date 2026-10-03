import assert from 'node:assert/strict';
import { MarketDataStore } from '../../src/storage/marketDataStore.js';
import { DatabentoHttpClient } from '../../src/databento/client.js';
import { syncInstrumentSpecs } from '../../src/marketData/instrumentSync.js';

export async function runInstrumentSyncTests(): Promise<void> {
  console.log('[unit/instrumentSync.test] Running instrumentSync unit tests...');

  // Not configured -> synced false
  {
    const store = new MarketDataStore(':memory:');
    const prevKey = process.env.DATABENTO_API_KEY;
    delete process.env.DATABENTO_API_KEY;
    const client = new DatabentoHttpClient({ apiKey: '' });
    const res = await syncInstrumentSpecs(client, store);
    assert.equal(res.synced, false);
    assert.ok(res.errors.length > 0);
    store.close();
    if (prevKey) process.env.DATABENTO_API_KEY = prevKey;
  }

  // Mocked fetch -> upserts specs
  {
    const mockFetch = (async (url: string) => {
      const body = JSON.stringify([
        { instrument_id: 1, raw_symbol: 'ES.FUT', instrument_class: 'F', currency: 'USD', min_price_increment: 250000000 },
        { instrument_id: 2, raw_symbol: 'SPY', instrument_class: 'S', currency: 'USD', min_price_increment: 10000000 },
      ]);
      return new Response(body, { status: 200, headers: { 'content-type': 'application/json' } });
    }) as any;

    process.env.DATABENTO_API_KEY = 'test-key-sync';
    const client = new DatabentoHttpClient({ apiKey: 'test-key-sync', fetchFn: mockFetch });
    const store = new MarketDataStore(':memory:');
    const res = await syncInstrumentSpecs(client, store);
    assert.equal(res.synced, true);
    assert.ok(res.total >= 1);
    const specs = store.listInstrumentSpecs('databento');
    assert.ok(specs.length >= 1);
    store.close();
  }

  console.log('  [PASS] All instrumentSync unit tests passed.');
}
