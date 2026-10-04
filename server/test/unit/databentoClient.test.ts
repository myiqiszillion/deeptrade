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

  // 5. Metadata and Cost API
  {
    const mockMetaFetch = (async (input: RequestInfo | URL) => {
      const urlStr = String(input);
      if (urlStr.includes('/metadata.list_datasets')) {
        return new Response(JSON.stringify(['GLBX.MDP3', 'OPRA.PILLAR', 'DBEQ.BASIC']), { status: 200 });
      }
      if (urlStr.includes('/metadata.list_schemas')) {
        return new Response(JSON.stringify(['mbo', 'mbp-1', 'mbp-10', 'trades', 'ohlcv-1m', 'definition', 'statistics']), { status: 200 });
      }
      if (urlStr.includes('/metadata.get_cost')) {
        return new Response(JSON.stringify([{ cost_usd: 1.25, size_bytes: 4500000, record_count: 50000 }]), { status: 200 });
      }
      return new Response('[]', { status: 200 });
    }) as any;

    const client = new DatabentoHttpClient({ apiKey: 'test-key', fetchFn: mockMetaFetch });
    const datasets = await client.listDatasets();
    assert.equal(datasets.length, 3);
    assert.ok(datasets.includes('GLBX.MDP3'));

    const schemas = await client.listSchemas('GLBX.MDP3');
    assert.ok(schemas.includes('mbp-10'));

    const cost = await client.getCost('GLBX.MDP3', 'trades', 'ES.FUT', '2026-03-20');
    assert.equal(cost.costUsd, 1.25);
    assert.equal(cost.recordCount, 50000);

    console.log('  PASS  Metadata (datasets, schemas) and cost estimation');
  }

  // 6. Symbology Resolve API
  {
    const mockSymbologyFetch = (async () => {
      return new Response(
        JSON.stringify([
          {
            result: {
              GOOGL: [{ d0: '2024-01-01', d1: '2024-01-02', s: '7152' }],
            },
            symbols: ['GOOGL'],
            stype_in: 'raw_symbol',
            stype_out: 'instrument_id',
          },
        ]),
        { status: 200 }
      );
    }) as any;

    const client = new DatabentoHttpClient({ apiKey: 'test-key', fetchFn: mockSymbologyFetch });
    const resolved = await client.resolveSymbology('DBEQ.BASIC', 'GOOGL');
    assert.ok(resolved.result.GOOGL);
    assert.equal(resolved.result.GOOGL[0].s, '7152');

    console.log('  PASS  Symbology resolution API');
  }

  // 7. Depth and Trading Status
  {
    const mockStatusFetch = (async (input: RequestInfo | URL) => {
      const urlStr = String(input);
      if (urlStr.includes('schema=status')) {
        return new Response(
          JSON.stringify([
            {
              hd: { instrument_id: 101, ts_event: 1711033200000000000 },
              symbol: 'ES',
              status: 'trading',
              action: 'open',
            },
          ]),
          { status: 200 }
        );
      }
      return new Response(JSON.stringify([{ hd: { instrument_id: 101, ts_event: 1711033200000000000 } }]), { status: 200 });
    }) as any;

    const client = new DatabentoHttpClient({ apiKey: 'test-key', fetchFn: mockStatusFetch });
    const depth = await client.getHistoricalDepth('GLBX.MDP3', 'ES.FUT', '2026-03-20');
    assert.equal(depth.length, 1);

    const status = await client.getTradingStatus('GLBX.MDP3', 'ES.FUT');
    assert.equal(status.length, 1);
    assert.equal(status[0].status, 'trading');

    console.log('  PASS  Depth (MBP-10) and trading status API');
  }

  // 8. Extended Metadata API (publishers, unit prices, condition, count, billable size)
  {
    const mockExtendedMetaFetch = (async (input: RequestInfo | URL) => {
      const urlStr = String(input);
      if (urlStr.includes('/metadata.list_publishers')) {
        return new Response(JSON.stringify([{ publisher_id: 1, dataset: 'GLBX.MDP3', venue: 'XCME', description: 'CME Globex' }]), { status: 200 });
      }
      if (urlStr.includes('/metadata.list_unit_prices')) {
        return new Response(JSON.stringify([{ dataset: 'GLBX.MDP3', mode: 'historical-streaming', schema: 'trades', unit_price: 0.05 }]), { status: 200 });
      }
      if (urlStr.includes('/metadata.get_dataset_condition')) {
        return new Response(JSON.stringify([{ date: '2026-03-20', condition: 'available' }]), { status: 200 });
      }
      if (urlStr.includes('/metadata.get_record_count')) {
        return new Response(JSON.stringify([{ record_count: 85000 }]), { status: 200 });
      }
      if (urlStr.includes('/metadata.get_billable_size')) {
        return new Response(JSON.stringify([{ billable_size: 12500000 }]), { status: 200 });
      }
      return new Response('[]', { status: 200 });
    }) as any;

    const client = new DatabentoHttpClient({ apiKey: 'test-key', fetchFn: mockExtendedMetaFetch });
    const publishers = await client.listPublishers();
    assert.equal(publishers.length, 1);
    assert.equal(publishers[0].venue, 'XCME');

    const prices = await client.listUnitPrices('GLBX.MDP3');
    assert.equal(prices.length, 1);
    assert.equal(prices[0].unit_price, 0.05);

    const condition = await client.getDatasetCondition('GLBX.MDP3');
    assert.equal(condition.length, 1);
    assert.equal(condition[0].condition, 'available');

    const count = await client.getRecordCount({ dataset: 'GLBX.MDP3', schema: 'trades', symbols: ['ES.FUT'], start: '2026-03-20' });
    assert.equal(count, 85000);

    const size = await client.getBillableSize({ dataset: 'GLBX.MDP3', schema: 'trades', symbols: ['ES.FUT'], start: '2026-03-20' });
    assert.equal(size, 12500000);

    console.log('  PASS  Extended Metadata APIs (publishers, unit prices, condition, count, billable size)');
  }

  // 9. Extended Timeseries (TBBO, MBO, Imbalances, generic get_range)
  {
    const mockExtendedTimeseriesFetch = (async (input: RequestInfo | URL) => {
      const urlStr = String(input);
      if (urlStr.includes('schema=tbbo')) {
        return new Response(JSON.stringify([{ hd: { instrument_id: 101, ts_event: 1711033200000000000 }, price: 500000000000, size: 10, bid_px_00: 499900000000, ask_px_00: 500100000000 }]), { status: 200 });
      }
      if (urlStr.includes('schema=mbo')) {
        return new Response(JSON.stringify([{ hd: { instrument_id: 101, ts_event: 1711033200000000000 }, order_id: 99999, action: 'A', side: 'B', price: 500000000000, size: 25 }]), { status: 200 });
      }
      if (urlStr.includes('schema=imbalance')) {
        return new Response(JSON.stringify([{ hd: { instrument_id: 101, ts_event: 1711033200000000000 }, paired_qty: 50000, total_imbalance_qty: 12000, side: 'B' }]), { status: 200 });
      }
      return new Response(JSON.stringify([{ test: true }]), { status: 200 });
    }) as any;

    const client = new DatabentoHttpClient({ apiKey: 'test-key', fetchFn: mockExtendedTimeseriesFetch });
    const tbbo = await client.getHistoricalTbbo('GLBX.MDP3', 'ES.FUT', '2026-03-20');
    assert.equal(tbbo.length, 1);
    assert.equal(tbbo[0].size, 10);

    const mbo = await client.getHistoricalMbo('GLBX.MDP3', 'ES.FUT', '2026-03-20');
    assert.equal(mbo.length, 1);
    assert.equal(mbo[0].order_id, 99999);
    assert.equal(mbo[0].action, 'A');

    const imbalances = await client.getHistoricalImbalances('GLBX.MDP3', 'ES.FUT', '2026-03-20');
    assert.equal(imbalances.length, 1);
    assert.equal(imbalances[0].paired_qty, 50000);

    const genericRange = await client.getTimeseriesRange({ dataset: 'GLBX.MDP3', schema: 'trades', symbols: ['ES.FUT'], start: '2026-03-20' });
    assert.equal(genericRange.length, 1);

    console.log('  PASS  Extended Timeseries APIs (TBBO, MBO, Imbalances, generic get_range)');
  }

  console.log('  [PASS] All DatabentoHttpClient unit tests passed.');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  runDatabentoClientTests().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
