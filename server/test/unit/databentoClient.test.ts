import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { DatabentoHttpClient } from '../../src/databento/client.js';

export async function runDatabentoClientTests(): Promise<void> {
  console.log('[unit/databentoClient.test] Running DatabentoHttpClient unit tests...');

  // 1. Unconfigured client throws on request
  {
    const unconfigured = new DatabentoHttpClient({ apiKey: '' });
    assert.equal(unconfigured.configured, false);
    await assert.rejects(
      () => unconfigured.getHistoricalBars('GLBX.MDP3', 'ES.FUT', 'ohlcv-1m', '2026-03-20'),
      /API key is not configured/
    );
    console.log('  PASS  Unconfigured client fail-closed behavior');
  }

  // 2. Basic Auth and Historical Bars Query
  {
    let capturedUrl = '';
    let capturedAuth = '';

    const mockFetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      capturedUrl = String(input);
      capturedAuth = String(init?.headers && (init.headers as any).Authorization);

      const mockBody = JSON.stringify([
        {
          hd: { instrument_id: 101, ts_event: 1711033200000000000 },
          open: 520250000000,
          high: 520500000000,
          low: 520100000000,
          close: 520400000000,
          volume: 1500,
        },
      ]);

      return new Response(mockBody, {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as any;

    const client = new DatabentoHttpClient({
      apiKey: 'test-db-key-12345',
      fetchFn: mockFetch,
    });

    assert.equal(client.configured, true);

    const bars = await client.getHistoricalBars('GLBX.MDP3', 'ES', 'ohlcv-1m', '2026-03-20T00:00:00Z');
    assert.equal(bars.length, 1);
    assert.equal(bars[0].open, 520.25);
    assert.equal(bars[0].high, 520.50);
    assert.equal(bars[0].low, 520.10);
    assert.equal(bars[0].close, 520.40);
    assert.equal(bars[0].volume, 1500);
    assert.equal(bars[0].time, 1711033200000);

    // Verify Basic Auth
    const expectedAuth = 'Basic ' + Buffer.from('test-db-key-12345:').toString('base64');
    assert.equal(capturedAuth, expectedAuth);

    // Verify URL parameters
    assert.ok(capturedUrl.includes('schema=ohlcv-1m'));
    assert.ok(capturedUrl.includes('dataset=GLBX.MDP3'));
    assert.ok(capturedUrl.includes('symbols=ES'));

    console.log('  PASS  Historical bars query & Basic Auth header');
  }

  // 3. Historical Trades Query with NDJSON response
  {
    const mockNdjson = (async () => {
      const body = [
        JSON.stringify({
          hd: { instrument_id: 101, ts_event: 1711033200000000000 },
          symbol: 'SPY',
          action: 'T',
          side: 'A',
          price: 520250000000,
          size: 100,
        }),
        JSON.stringify({
          hd: { instrument_id: 101, ts_event: 1711033201000000000 },
          symbol: 'SPY',
          action: 'T',
          side: 'B',
          price: 520200000000,
          size: 200,
        }),
      ].join('\n');

      return new Response(body, {
        status: 200,
        headers: { 'content-type': 'application/x-ndjson' },
      });
    }) as any;

    const client = new DatabentoHttpClient({
      apiKey: 'test-key',
      fetchFn: mockNdjson,
    });

    const trades = await client.getHistoricalTrades('DBEQ.BASIC', 'SPY', '2026-03-20T00:00:00Z');
    assert.equal(trades.length, 2);
    assert.equal(trades[0].side, 'buy');
    assert.equal(trades[0].price, 520.25);
    assert.equal(trades[1].side, 'sell');
    assert.equal(trades[1].size, 200);

    console.log('  PASS  Historical trades with NDJSON streaming');
  }

  // 4. Option Definitions and Statistics Queries
  {
    const mockOptionsFetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('schema=definition')) {
        return new Response(
          JSON.stringify([
            {
              instrument_id: 2001,
              raw_symbol: 'SPY260320C00500000',
              instrument_class: 'O',
              strike_price: 500000000000,
              expiration: 1774051200000000000,
              underlying_symbol: 'SPY',
              contract_multiplier: 100,
            },
          ]),
          { status: 200 }
        );
      }
      if (url.includes('schema=statistics')) {
        return new Response(
          JSON.stringify([
            {
              symbol: 'SPY260320C00500000',
              stat_type: 6,
              quantity: 12500,
              ts_event: 1711033200000000000,
            },
          ]),
          { status: 200 }
        );
      }
      return new Response('[]', { status: 200 });
    }) as any;

    const client = new DatabentoHttpClient({
      apiKey: 'test-key',
      fetchFn: mockOptionsFetch,
    });

    const defs = await client.getOptionDefinitions('OPRA.PILLAR', 'SPY');
    assert.equal(defs.length, 1);
    assert.equal(defs[0].symbol, 'SPY260320C00500000');
    assert.equal(defs[0].strike, 500);
    assert.equal(defs[0].type, 'call');

    const stats = await client.getStatistics('OPRA.PILLAR', 'SPY260320C00500000');
    assert.equal(stats.length, 1);
    assert.equal(stats[0].openInterest, 12500);

    console.log('  PASS  Option definitions and statistics queries');
  }

  console.log('  [PASS] All DatabentoHttpClient unit tests passed.');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  runDatabentoClientTests().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
