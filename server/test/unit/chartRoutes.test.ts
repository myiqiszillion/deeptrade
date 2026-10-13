import assert from 'node:assert';
import { EventEmitter } from 'node:events';
import { fileURLToPath } from 'node:url';
import { createChartRouter } from '../../src/chart/routes.js';
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

export async function runChartRoutesTests(): Promise<void> {
  console.log('\n--- TradingView & Chart Routes Test Suite ---');

  const mockFetch = (async (input: RequestInfo | URL) => {
    const urlStr = String(input);

    if (urlStr.includes('schema=ohlcv-1m') || urlStr.includes('schema=ohlcv-1d')) {
      return new Response(
        JSON.stringify([
          {
            hd: { instrument_id: 101, ts_event: 1711033200000000000 },
            open: 500000000000,
            high: 501000000000,
            low: 499000000000,
            close: 500500000000,
            volume: 1000,
          },
          {
            hd: { instrument_id: 101, ts_event: 1711033260000000000 },
            open: 500500000000,
            high: 502000000000,
            low: 500000000000,
            close: 501500000000,
            volume: 1500,
          },
        ]),
        { status: 200 }
      );
    }

    if (urlStr.includes('schema=trades')) {
      return new Response(
        JSON.stringify([
          {
            hd: { instrument_id: 101, ts_event: 1711033200000000000 },
            price: 500000000000,
            size: 50,
            action: 'T',
            side: 'A',
          },
          {
            hd: { instrument_id: 101, ts_event: 1711033201000000000 },
            price: 499900000000,
            size: 75,
            action: 'T',
            side: 'B',
          },
        ]),
        { status: 200 }
      );
    }

    if (urlStr.includes('schema=mbp-10')) {
      return new Response(
        JSON.stringify([
          {
            hd: { instrument_id: 101, ts_event: 1711033200000000000 },
            bid_px_00: 500000000000,
            bid_sz_00: 10,
            ask_px_00: 500100000000,
            ask_sz_00: 15,
          },
        ]),
        { status: 200 }
      );
    }

    if (urlStr.includes('schema=statistics')) {
      return new Response(
        JSON.stringify([
          {
            symbol: 'ES',
            stat_type: 5,
            price: 500250000000,
            quantity: 250000,
            ts_event: 1711033200000000000,
          },
        ]),
        { status: 200 }
      );
    }

    if (urlStr.includes('schema=status')) {
      return new Response(
        JSON.stringify([
          {
            symbol: 'ES',
            status: 'trading',
            ts_event: 1711033200000000000,
          },
        ]),
        { status: 200 }
      );
    }

    return new Response('[]', { status: 200 });
  }) as any;

  const client = new DatabentoHttpClient({ apiKey: 'test-key', fetchFn: mockFetch });
  const handler = createChartRouter({ client });

  // 1. /api/v1/udf/config
  {
    const req = new EventEmitter() as any;
    req.method = 'GET';
    const res = new MockResponse() as any;
    const url = new URL('http://localhost:8080/api/v1/udf/config');
    const handled = await handler(req, res, url);
    assert.equal(handled, true);
    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.ok(body.supported_resolutions.includes('1'));
    assert.equal(body.supports_marks, true);
    console.log('✓ GET /api/v1/udf/config returns valid UDF config');
  }

  // 2. /api/v1/udf/time
  {
    const req = new EventEmitter() as any;
    req.method = 'GET';
    const res = new MockResponse() as any;
    const url = new URL('http://localhost:8080/api/v1/udf/time');
    const handled = await handler(req, res, url);
    assert.equal(handled, true);
    assert.equal(res.statusCode, 200);
    const time = Number(res.body);
    assert.ok(time > 1700000000);
    console.log('✓ GET /api/v1/udf/time returns server epoch time');
  }

  // 3. /api/v1/udf/symbols
  {
    const req = new EventEmitter() as any;
    req.method = 'GET';
    const res = new MockResponse() as any;
    const url = new URL('http://localhost:8080/api/v1/udf/symbols?symbol=ES');
    const handled = await handler(req, res, url);
    assert.equal(handled, true);
    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.equal(body.name, 'ES');
    assert.equal(body.exchange, 'CME');
    assert.equal(body.has_intraday, true);
    console.log('✓ GET /api/v1/udf/symbols returns symbol metadata');
  }

  // 4. /api/v1/udf/search
  {
    const req = new EventEmitter() as any;
    req.method = 'GET';
    const res = new MockResponse() as any;
    const url = new URL('http://localhost:8080/api/v1/udf/search?query=ES');
    const handled = await handler(req, res, url);
    assert.equal(handled, true);
    assert.equal(res.statusCode, 200);
    const list = JSON.parse(res.body);
    assert.ok(list.length > 0);
    assert.equal(list[0].symbol, 'ES');
    console.log('✓ GET /api/v1/udf/search returns search results');
  }

  // 5. /api/v1/udf/history
  {
    const req = new EventEmitter() as any;
    req.method = 'GET';
    const res = new MockResponse() as any;
    const url = new URL('http://localhost:8080/api/v1/udf/history?symbol=ES&resolution=1&from=1711030000&to=1711040000');
    const handled = await handler(req, res, url);
    assert.equal(handled, true);
    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.equal(body.s, 'ok');
    assert.equal(body.t.length, 2);
    assert.equal(body.c[0], 500.5);
    console.log('✓ GET /api/v1/udf/history returns standard UDF bars');
  }

  // 6. /api/v1/udf/marks
  {
    const req = new EventEmitter() as any;
    req.method = 'GET';
    const res = new MockResponse() as any;
    const url = new URL('http://localhost:8080/api/v1/udf/marks?symbol=ES&from=1711030000&to=1711040000');
    const handled = await handler(req, res, url);
    assert.equal(handled, true);
    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.ok(Array.isArray(body.id));
    console.log('✓ GET /api/v1/udf/marks returns chart marks');
  }

  // 7. /api/v1/chart/bars
  {
    const req = new EventEmitter() as any;
    req.method = 'GET';
    const res = new MockResponse() as any;
    const url = new URL('http://localhost:8080/api/v1/chart/bars?symbol=ES&resolution=1');
    const handled = await handler(req, res, url);
    assert.equal(handled, true);
    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.equal(body.count, 2);
    console.log('✓ GET /api/v1/chart/bars returns bars array');
  }

  // 8. /api/v1/chart/footprint
  {
    const req = new EventEmitter() as any;
    req.method = 'GET';
    const res = new MockResponse() as any;
    const url = new URL('http://localhost:8080/api/v1/chart/footprint?symbol=ES&resolution=1');
    const handled = await handler(req, res, url);
    assert.equal(handled, true);
    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.ok(Array.isArray(body.bars));
    console.log('✓ GET /api/v1/chart/footprint returns footprint order flow bars');
  }

  // 9. /api/v1/chart/cvd
  {
    const req = new EventEmitter() as any;
    req.method = 'GET';
    const res = new MockResponse() as any;
    const url = new URL('http://localhost:8080/api/v1/chart/cvd?symbol=ES');
    const handled = await handler(req, res, url);
    assert.equal(handled, true);
    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.equal(body.count, 2);
    assert.equal(body.series[0].buyVolume, 0);
    assert.equal(body.series[0].sellVolume, 50); // Native Databento A = sell aggressor.
    console.log('✓ GET /api/v1/chart/cvd returns CVD series');
  }

  // 10. /api/v1/chart/volume-profile
  {
    const req = new EventEmitter() as any;
    req.method = 'GET';
    const res = new MockResponse() as any;
    const url = new URL('http://localhost:8080/api/v1/chart/volume-profile?symbol=ES');
    const handled = await handler(req, res, url);
    assert.equal(handled, true);
    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.equal(body.symbol, 'ES');
    assert.ok(body.totalVolume > 0);
    assert.ok(body.poc > 0);
    console.log('✓ GET /api/v1/chart/volume-profile returns VP with POC, VAH, VAL');
  }

  // 10.5 /api/v1/chart/tpo
  {
    const req = new EventEmitter() as any;
    req.method = 'GET';
    const res = new MockResponse() as any;
    const url = new URL('http://localhost:8080/api/v1/chart/tpo?symbol=ES');
    const handled = await handler(req, res, url);
    assert.equal(handled, true);
    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.equal(body.symbol, 'ES');
    assert.ok(body.poc > 0);
    assert.ok(Array.isArray(body.brackets));
    console.log('✓ GET /api/v1/chart/tpo returns TPO profile with brackets and POC');
  }

  // 11. /api/v1/chart/vwap
  {
    const req = new EventEmitter() as any;
    req.method = 'GET';
    const res = new MockResponse() as any;
    const url = new URL('http://localhost:8080/api/v1/chart/vwap?symbol=ES');
    const handled = await handler(req, res, url);
    assert.equal(handled, true);
    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.ok(Array.isArray(body.series));
    console.log('✓ GET /api/v1/chart/vwap returns VWAP with std dev bands');
  }

  // 12. /api/v1/chart/depth-heatmap
  {
    const req = new EventEmitter() as any;
    req.method = 'GET';
    const res = new MockResponse() as any;
    const url = new URL('http://localhost:8080/api/v1/chart/depth-heatmap?symbol=ES');
    const handled = await handler(req, res, url);
    assert.equal(handled, true);
    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.equal(body.count, 1);
    assert.equal(body.snapshots[0].bids[0].price, 500);
    console.log('✓ GET /api/v1/chart/depth-heatmap returns depth snapshots');
  }

  // 13. /api/v1/chart/large-trades
  {
    const req = new EventEmitter() as any;
    req.method = 'GET';
    const res = new MockResponse() as any;
    const url = new URL('http://localhost:8080/api/v1/chart/large-trades?symbol=ES&min_size=10');
    const handled = await handler(req, res, url);
    assert.equal(handled, true);
    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.equal(body.count, 2);
    console.log('✓ GET /api/v1/chart/large-trades returns large trade prints');
  }

  // 14. /api/v1/chart/levels
  {
    const req = new EventEmitter() as any;
    req.method = 'GET';
    const res = new MockResponse() as any;
    const url = new URL('http://localhost:8080/api/v1/chart/levels?symbol=ES');
    const handled = await handler(req, res, url);
    assert.equal(handled, true);
    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.equal(body.symbol, 'ES');
    console.log('✓ GET /api/v1/chart/levels returns chart support/resistance levels');
  }

  // 14b. POST /api/v1/chart/volume-profile-range (Task 3: Visible & Fixed Range Volume Profile)
  {
    // Valid POST request
    const req = new EventEmitter() as any;
    req.method = 'POST';
    const res = new MockResponse() as any;
    const url = new URL('http://localhost:8080/api/v1/chart/volume-profile-range');
    const startTime = 1711033200000;
    const endTime = 1711033260000;

    const promise = handler(req, res, url);
    req.emit('data', JSON.stringify({ symbol: 'ES', startTime, endTime }));
    req.emit('end');

    const handled = await promise;
    assert.equal(handled, true);
    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.equal(body.symbol, 'ES');
    assert.equal(body.startTime, startTime);
    assert.equal(body.endTime, endTime);
    assert.ok(typeof body.totalVolume === 'number');
    assert.ok(typeof body.poc === 'number');
    assert.ok(typeof body.vah === 'number');
    assert.ok(typeof body.val === 'number');
    assert.ok(Array.isArray(body.levels));
    console.log('✓ POST /api/v1/chart/volume-profile-range returns range volume profile with POC, VAH, VAL');

    // Method not allowed: GET
    const reqGet = new EventEmitter() as any;
    reqGet.method = 'GET';
    const resGet = new MockResponse() as any;
    const handledGet = await handler(reqGet, resGet, url);
    assert.equal(handledGet, true);
    assert.equal(resGet.statusCode, 405);
    console.log('✓ GET /api/v1/chart/volume-profile-range rejected with 405 Method Not Allowed');

    // Invalid time range: startTime >= endTime
    const reqInvalid = new EventEmitter() as any;
    reqInvalid.method = 'POST';
    const resInvalid = new MockResponse() as any;
    const pInvalid = handler(reqInvalid, resInvalid, url);
    reqInvalid.emit('data', JSON.stringify({ symbol: 'ES', startTime: 1000, endTime: 500 }));
    reqInvalid.emit('end');
    await pInvalid;
    assert.equal(resInvalid.statusCode, 400);
    console.log('✓ POST /api/v1/chart/volume-profile-range validates startTime < endTime');

    // Invalid symbol: UNKNOWN_XYZ
    const reqUnknown = new EventEmitter() as any;
    reqUnknown.method = 'POST';
    const resUnknown = new MockResponse() as any;
    const pUnknown = handler(reqUnknown, resUnknown, url);
    reqUnknown.emit('data', JSON.stringify({ symbol: 'UNKNOWN_XYZ', startTime: 1000, endTime: 2000 }));
    reqUnknown.emit('end');
    await pUnknown;
    assert.equal(resUnknown.statusCode, 404);
    console.log('✓ POST /api/v1/chart/volume-profile-range rejects unknown symbol with 404');

    // Range exceeding 30 days
    const reqExcess = new EventEmitter() as any;
    reqExcess.method = 'POST';
    const resExcess = new MockResponse() as any;
    const pExcess = handler(reqExcess, resExcess, url);
    reqExcess.emit('data', JSON.stringify({ symbol: 'ES', startTime: 1000, endTime: 1000 + 35 * 86400000 }));
    reqExcess.emit('end');
    await pExcess;
    assert.equal(resExcess.statusCode, 400);
    console.log('✓ POST /api/v1/chart/volume-profile-range enforces maximum 30-day range limit');
  }

  // 15. Fallthrough for non-chart routes
  {
    const req = new EventEmitter() as any;
    const res = new MockResponse() as any;
    const url = new URL('http://localhost:8080/api/v1/other');
    const handled = await handler(req, res, url);
    assert.equal(handled, false);
    console.log('✓ Non-chart path returns false for fallthrough');
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  runChartRoutesTests().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
