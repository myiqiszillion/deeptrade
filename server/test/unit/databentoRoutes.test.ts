import assert from 'node:assert';
import { IncomingMessage, ServerResponse } from 'node:http';
import { EventEmitter } from 'node:events';
import { fileURLToPath } from 'node:url';
import { createDatabentoRouter } from '../../src/databento/routes.js';
import { DatabentoHttpClient } from '../../src/databento/client.js';

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

export async function runDatabentoRoutesTests(): Promise<void> {
  console.log('\n--- Databento Routes Test Suite ---');

  // 1. Unconfigured client returns 503
  {
    const unconfiguredClient = new DatabentoHttpClient({ apiKey: '' });
    const handler = createDatabentoRouter({ client: unconfiguredClient });

    const req = new EventEmitter() as any;
    req.method = 'GET';
    const res = new MockResponse() as any;
    const url = new URL('http://localhost:8080/api/v1/databento/datasets');

    const handled = await handler(req, res, url);
    assert.equal(handled, true);
    assert.equal(res.statusCode, 503);
    const body = JSON.parse(res.body);
    assert.equal(body.status, 'error');
    console.log('✓ GET /api/v1/databento/datasets handles unconfigured client');
  }

  // 2. Configured mock client routes
  {
    const mockFetch = (async (input: RequestInfo | URL) => {
      const urlStr = String(input);
      if (urlStr.includes('/metadata.list_datasets')) {
        return new Response(JSON.stringify(['GLBX.MDP3', 'OPRA.PILLAR', 'DBEQ.BASIC']), { status: 200 });
      }
      if (urlStr.includes('/metadata.list_schemas')) {
        return new Response(JSON.stringify(['mbo', 'mbp-1', 'mbp-10', 'trades']), { status: 200 });
      }
      if (urlStr.includes('/symbology.resolve')) {
        return new Response(JSON.stringify([{ result: { AAPL: [{ s: '101' }] }, symbols: ['AAPL'] }]), { status: 200 });
      }
      if (urlStr.includes('/metadata.list_publishers')) {
        return new Response(JSON.stringify([{ publisher_id: 1, dataset: 'GLBX.MDP3', venue: 'XCME' }]), { status: 200 });
      }
      if (urlStr.includes('/metadata.list_unit_prices')) {
        return new Response(JSON.stringify([{ dataset: 'GLBX.MDP3', unit_price: 0.05 }]), { status: 200 });
      }
      if (urlStr.includes('/metadata.get_dataset_condition')) {
        return new Response(JSON.stringify([{ date: '2026-03-20', condition: 'available' }]), { status: 200 });
      }
      if (urlStr.includes('/metadata.get_record_count')) {
        return new Response(JSON.stringify([{ record_count: 50000 }]), { status: 200 });
      }
      if (urlStr.includes('/metadata.get_billable_size')) {
        return new Response(JSON.stringify([{ billable_size: 4500000 }]), { status: 200 });
      }
      if (urlStr.includes('/metadata.list_fields')) {
        return new Response(JSON.stringify([{ name: 'price', type: 'int64' }]), { status: 200 });
      }
      if (urlStr.includes('/metadata.get_dataset_range')) {
        return new Response(JSON.stringify([{ start: '2020-01-01T00:00:00Z', end: '2026-10-01T00:00:00Z' }]), { status: 200 });
      }
      if (urlStr.includes('/metadata.get_cost')) {
        return new Response(JSON.stringify([{ cost_usd: 1.25, size_bytes: 1048576, record_count: 1000 }]), { status: 200 });
      }
      if (urlStr.includes('/timeseries.get_range')) {
        return new Response(JSON.stringify([{ hd: { instrument_id: 101, ts_event: 1711033200000000000 }, open: 500000000000, high: 501000000000, low: 499000000000, close: 500500000000, volume: 1000, price: 500000000000, size: 10, order_id: 123, action: 'A', side: 'B', paired_qty: 1000, instrument_class: 'O', raw_symbol: 'AAPL260320C00150000', stat_type: 1, quantity: 500, symbol: 'ES.FUT', status: 'trading' }]), { status: 200 });
      }
      return new Response('[]', { status: 200 });
    }) as any;

    const client = new DatabentoHttpClient({ apiKey: 'test-key', fetchFn: mockFetch });
    const handler = createDatabentoRouter({ client });

    // Test datasets route
    {
      const req = new EventEmitter() as any;
      req.method = 'GET';
      const res = new MockResponse() as any;
      const url = new URL('http://localhost:8080/api/v1/databento/datasets');
      const handled = await handler(req, res, url);
      assert.equal(handled, true);
      assert.equal(res.statusCode, 200);
      const body = JSON.parse(res.body);
      assert.equal(body.count, 3);
      console.log('✓ GET /api/v1/databento/datasets returns dataset list');
    }

    // Test publishers route
    {
      const req = new EventEmitter() as any;
      req.method = 'GET';
      const res = new MockResponse() as any;
      const url = new URL('http://localhost:8080/api/v1/databento/publishers');
      const handled = await handler(req, res, url);
      assert.equal(handled, true);
      assert.equal(res.statusCode, 200);
      const body = JSON.parse(res.body);
      assert.equal(body.count, 1);
      assert.equal(body.publishers[0].venue, 'XCME');
      console.log('✓ GET /api/v1/databento/publishers returns publisher list');
    }

    // Test unit-prices route
    {
      const req = new EventEmitter() as any;
      req.method = 'GET';
      const res = new MockResponse() as any;
      const url = new URL('http://localhost:8080/api/v1/databento/unit-prices?dataset=GLBX.MDP3');
      const handled = await handler(req, res, url);
      assert.equal(handled, true);
      assert.equal(res.statusCode, 200);
      const body = JSON.parse(res.body);
      assert.equal(body.unitPrices.length, 1);
      console.log('✓ GET /api/v1/databento/unit-prices returns unit prices');
    }

    // Test condition route
    {
      const req = new EventEmitter() as any;
      req.method = 'GET';
      const res = new MockResponse() as any;
      const url = new URL('http://localhost:8080/api/v1/databento/condition?dataset=GLBX.MDP3');
      const handled = await handler(req, res, url);
      assert.equal(handled, true);
      assert.equal(res.statusCode, 200);
      const body = JSON.parse(res.body);
      assert.equal(body.condition[0].condition, 'available');
      console.log('✓ GET /api/v1/databento/condition returns dataset condition');
    }

    // Test record-count route
    {
      const req = new EventEmitter() as any;
      req.method = 'GET';
      const res = new MockResponse() as any;
      const url = new URL('http://localhost:8080/api/v1/databento/record-count?dataset=GLBX.MDP3&symbols=ES.FUT');
      const handled = await handler(req, res, url);
      assert.equal(handled, true);
      assert.equal(res.statusCode, 200);
      const body = JSON.parse(res.body);
      assert.equal(body.count, 50000);
      console.log('✓ GET /api/v1/databento/record-count returns record count');
    }

    // Test billable-size route
    {
      const req = new EventEmitter() as any;
      req.method = 'GET';
      const res = new MockResponse() as any;
      const url = new URL('http://localhost:8080/api/v1/databento/billable-size?dataset=GLBX.MDP3&symbols=ES.FUT');
      const handled = await handler(req, res, url);
      assert.equal(handled, true);
      assert.equal(res.statusCode, 200);
      const body = JSON.parse(res.body);
      assert.equal(body.sizeBytes, 4500000);
      console.log('✓ GET /api/v1/databento/billable-size returns billable size');
    }

    // Test schemas route
    {
      const req = new EventEmitter() as any;
      req.method = 'GET';
      const res = new MockResponse() as any;
      const url = new URL('http://localhost:8080/api/v1/databento/schemas?dataset=GLBX.MDP3');
      const handled = await handler(req, res, url);
      assert.equal(handled, true);
      assert.equal(res.statusCode, 200);
      const body = JSON.parse(res.body);
      assert.equal(body.schemas.length, 4);
      console.log('✓ GET /api/v1/databento/schemas returns schema list');
    }

    // Test symbology resolve route
    {
      const req = new EventEmitter() as any;
      req.method = 'GET';
      const res = new MockResponse() as any;
      const url = new URL('http://localhost:8080/api/v1/databento/symbology/resolve?symbols=AAPL');
      const handled = await handler(req, res, url);
      assert.equal(handled, true);
      assert.equal(res.statusCode, 200);
      const body = JSON.parse(res.body);
      assert.ok(body.result.AAPL);
      console.log('✓ GET /api/v1/databento/symbology/resolve resolves symbol');
    }

    // Test bars route
    {
      const req = new EventEmitter() as any;
      req.method = 'GET';
      const res = new MockResponse() as any;
      const url = new URL('http://localhost:8080/api/v1/databento/bars?dataset=GLBX.MDP3&symbols=ES.FUT');
      const handled = await handler(req, res, url);
      assert.equal(handled, true);
      assert.equal(res.statusCode, 200);
      const body = JSON.parse(res.body);
      assert.equal(body.count, 1);
      assert.equal(body.bars[0].close, 500.5);
      console.log('✓ GET /api/v1/databento/bars returns historical bars');
    }

    // Test tbbo, mbo, imbalances routes
    {
      const req = new EventEmitter() as any;
      req.method = 'GET';
      const res = new MockResponse() as any;
      const url = new URL('http://localhost:8080/api/v1/databento/tbbo?dataset=GLBX.MDP3&symbols=ES.FUT');
      const handled = await handler(req, res, url);
      assert.equal(handled, true);
      assert.equal(res.statusCode, 200);
      const body = JSON.parse(res.body);
      assert.equal(body.count, 1);
      console.log('✓ GET /api/v1/databento/tbbo returns TBBO records');
    }

    {
      const req = new EventEmitter() as any;
      req.method = 'GET';
      const res = new MockResponse() as any;
      const url = new URL('http://localhost:8080/api/v1/databento/mbo?dataset=GLBX.MDP3&symbols=ES.FUT');
      const handled = await handler(req, res, url);
      assert.equal(handled, true);
      assert.equal(res.statusCode, 200);
      const body = JSON.parse(res.body);
      assert.equal(body.count, 1);
      console.log('✓ GET /api/v1/databento/mbo returns MBO records');
    }

    {
      const req = new EventEmitter() as any;
      req.method = 'GET';
      const res = new MockResponse() as any;
      const url = new URL('http://localhost:8080/api/v1/databento/imbalances?dataset=GLBX.MDP3&symbols=ES.FUT');
      const handled = await handler(req, res, url);
      assert.equal(handled, true);
      assert.equal(res.statusCode, 200);
      const body = JSON.parse(res.body);
      assert.equal(body.count, 1);
      console.log('✓ GET /api/v1/databento/imbalances returns Imbalance records');
    }

    {
      const req = new EventEmitter() as any;
      req.method = 'GET';
      const res = new MockResponse() as any;
      const url = new URL('http://localhost:8080/api/v1/databento/fields?dataset=GLBX.MDP3&schema=trades');
      const handled = await handler(req, res, url);
      assert.equal(handled, true);
      assert.equal(res.statusCode, 200);
      const body = JSON.parse(res.body);
      assert.equal(body.fields.length, 1);
      console.log('✓ GET /api/v1/databento/fields returns fields list');
    }

    {
      const req = new EventEmitter() as any;
      req.method = 'GET';
      const res = new MockResponse() as any;
      const url = new URL('http://localhost:8080/api/v1/databento/range?dataset=GLBX.MDP3');
      const handled = await handler(req, res, url);
      assert.equal(handled, true);
      assert.equal(res.statusCode, 200);
      const body = JSON.parse(res.body);
      assert.ok(body.start);
      assert.ok(body.end);
      console.log('✓ GET /api/v1/databento/range returns dataset date range');
    }

    {
      const req = new EventEmitter() as any;
      req.method = 'GET';
      const res = new MockResponse() as any;
      const url = new URL('http://localhost:8080/api/v1/databento/cost?dataset=GLBX.MDP3&schema=trades&symbols=ES.FUT');
      const handled = await handler(req, res, url);
      assert.equal(handled, true);
      assert.equal(res.statusCode, 200);
      const body = JSON.parse(res.body);
      assert.equal(body.costUsd, 1.25);
      console.log('✓ GET /api/v1/databento/cost returns query cost estimate');
    }

    {
      const req = new EventEmitter() as any;
      req.method = 'GET';
      const res = new MockResponse() as any;
      const url = new URL('http://localhost:8080/api/v1/databento/trades?dataset=GLBX.MDP3&symbols=ES.FUT');
      const handled = await handler(req, res, url);
      assert.equal(handled, true);
      assert.equal(res.statusCode, 200);
      const body = JSON.parse(res.body);
      assert.equal(body.count, 1);
      console.log('✓ GET /api/v1/databento/trades returns historical trades');
    }

    {
      const req = new EventEmitter() as any;
      req.method = 'GET';
      const res = new MockResponse() as any;
      const url = new URL('http://localhost:8080/api/v1/databento/quotes?dataset=GLBX.MDP3&symbols=ES.FUT');
      const handled = await handler(req, res, url);
      assert.equal(handled, true);
      assert.equal(res.statusCode, 200);
      const body = JSON.parse(res.body);
      assert.equal(body.count, 1);
      console.log('✓ GET /api/v1/databento/quotes returns historical quotes');
    }

    {
      const req = new EventEmitter() as any;
      req.method = 'GET';
      const res = new MockResponse() as any;
      const url = new URL('http://localhost:8080/api/v1/databento/depth?dataset=GLBX.MDP3&symbols=ES.FUT');
      const handled = await handler(req, res, url);
      assert.equal(handled, true);
      assert.equal(res.statusCode, 200);
      const body = JSON.parse(res.body);
      assert.equal(body.count, 1);
      console.log('✓ GET /api/v1/databento/depth returns MBP-10 depth');
    }

    {
      const req = new EventEmitter() as any;
      req.method = 'GET';
      const res = new MockResponse() as any;
      const url = new URL('http://localhost:8080/api/v1/databento/definitions?dataset=OPRA.PILLAR&underlying=AAPL');
      const handled = await handler(req, res, url);
      assert.equal(handled, true);
      assert.equal(res.statusCode, 200);
      const body = JSON.parse(res.body);
      assert.equal(body.count, 1);
      console.log('✓ GET /api/v1/databento/definitions returns option definitions');
    }

    {
      const req = new EventEmitter() as any;
      req.method = 'GET';
      const res = new MockResponse() as any;
      const url = new URL('http://localhost:8080/api/v1/databento/statistics?dataset=OPRA.PILLAR&symbols=AAPL260320C00150000');
      const handled = await handler(req, res, url);
      assert.equal(handled, true);
      assert.equal(res.statusCode, 200);
      const body = JSON.parse(res.body);
      assert.equal(body.count, 1);
      console.log('✓ GET /api/v1/databento/statistics returns settlement and OI');
    }

    {
      const req = new EventEmitter() as any;
      req.method = 'GET';
      const res = new MockResponse() as any;
      const url = new URL('http://localhost:8080/api/v1/databento/status?dataset=GLBX.MDP3&symbols=ES.FUT');
      const handled = await handler(req, res, url);
      assert.equal(handled, true);
      assert.equal(res.statusCode, 200);
      const body = JSON.parse(res.body);
      assert.equal(body.count, 1);
      console.log('✓ GET /api/v1/databento/status returns market trading status');
    }

    {
      const req = new EventEmitter() as any;
      req.method = 'GET';
      const res = new MockResponse() as any;
      const url = new URL('http://localhost:8080/api/v1/databento/timeseries?dataset=GLBX.MDP3&schema=trades&symbols=ES.FUT');
      const handled = await handler(req, res, url);
      assert.equal(handled, true);
      assert.equal(res.statusCode, 200);
      const body = JSON.parse(res.body);
      assert.equal(body.count, 1);
      console.log('✓ GET /api/v1/databento/timeseries returns generic timeseries records');
    }

    // Non-databento path returns false
    {
      const req = new EventEmitter() as any;
      const res = new MockResponse() as any;
      const url = new URL('http://localhost:8080/api/v1/other');
      const handled = await handler(req, res, url);
      assert.equal(handled, false);
      console.log('✓ Non-databento path returns false for fallthrough');
    }
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  runDatabentoRoutesTests().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
