import assert from 'node:assert/strict';
import { marketDataStore } from '../../src/storage/marketDataStore.js';
import { metrics } from '../../src/util/metrics.js';
import {
  VENDOR_USAGE_PROVIDER,
  currentMonthSpend,
  estimateDatabentoCost,
  guardVendorSpend,
  parseUsd,
  recordVendorSpend,
  vendorMonthKey,
} from '../../src/marketData/databentoUsage.js';
import {
  HISTORY_BARS_DEFAULT,
  HISTORY_BARS_MAX,
  HISTORY_BARS_MIN,
  historyBarsTarget,
} from '../../src/marketData/historyDepth.js';
import { fetchDatabentoBars } from '../../src/marketData/databentoHistory.js';

const SEPT_2026 = Date.UTC(2026, 8, 15, 12, 0, 0);

interface CapturedRequest {
  url: string;
  method: string;
  body?: any;
  headers?: Record<string, string>;
}

/** fetch stand-in that routes by endpoint path and records every call. */
function scriptedFetch(
  requests: CapturedRequest[],
  routes: { cost?: () => Response }
): typeof fetch {
  return (async (url: string | URL, init: any = {}) => {
    const href = String(url);
    requests.push({
      url: href,
      method: init?.method || 'GET',
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
      headers: init?.headers as Record<string, string>,
    });
    if (href.includes('metadata.get_cost')) {
      return routes.cost ? routes.cost() : new Response('{}', { status: 200 });
    }
    throw new Error(`unexpected request: ${href}`);
  }) as unknown as typeof fetch;
}

const ENV_KEYS = [
  'DATABENTO_API_KEY',
  'DATABENTO_MONTHLY_USD_BUDGET',
  'DATABENTO_COST_LOG',
  'DATABENTO_TRANSPORT_READY',
] as const;

function withEnv(overrides: Record<string, string | undefined>, fn: () => Promise<void> | void): Promise<void> {
  const saved = ENV_KEYS.map((key) => [key, process.env[key]] as const);
  for (const key of ENV_KEYS) delete process.env[key];
  for (const [key, value] of Object.entries(overrides)) {
    if (value !== undefined) process.env[key] = value;
  }
  return Promise.resolve()
    .then(fn)
    .finally(() => {
      for (const [key, value] of saved) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    });
}

export async function runDatabentoUsageTests(): Promise<void> {
  console.log('[unit/databentoUsage.test] Running Databento spend-guard & history depth unit tests...');

  // 1. Cost parsing tolerates the shapes the vendor returns (string with $ and separators).
  assert.equal(parseUsd('0.0123'), 0.0123, 'plain decimal string');
  assert.equal(parseUsd('$1,234.56'), 1234.56, 'currency string with separators');
  assert.equal(parseUsd(2.5), 2.5, 'numeric cost');
  assert.equal(parseUsd(''), null, 'empty string is not a cost');
  assert.equal(parseUsd('n/a'), null, 'non-numeric text is not a cost');
  assert.equal(parseUsd(null), null, 'null is not a cost');
  assert.equal(parseUsd(Number.NaN), null, 'NaN is not a cost');

  // 2. Ledger buckets by UTC month so the guard resets when the vendor bill resets.
  assert.equal(vendorMonthKey(SEPT_2026), '2026-09');
  assert.equal(vendorMonthKey(Date.UTC(2026, 11, 31, 23, 59)), '2026-12');
  assert.equal(vendorMonthKey(Date.UTC(2027, 0, 1)), '2027-01');

  // 3. Spend accumulates per provider+month; junk amounts never corrupt the total.
  marketDataStore.clearVendorUsage('test-provider');
  const first = recordVendorSpend('test-provider', 0.5, 2, SEPT_2026);
  assert.equal(first.month, '2026-09');
  assert.equal(first.usd, 0.5, 'first charge recorded');
  assert.equal(first.requests, 2, 'request counted');
  const second = recordVendorSpend('test-provider', 0.25, 1, SEPT_2026);
  assert.equal(second.usd, 0.75, 'charges accumulate');
  assert.equal(second.requests, 3, 'requests accumulate');
  recordVendorSpend('test-provider', -5, 1, SEPT_2026);
  assert.equal(recordVendorSpend('test-provider', Number.NaN, 1, SEPT_2026).usd, 0.75, 'negative/NaN ignored');
  assert.equal(marketDataStore.getVendorUsage('test-provider', '2026-10').usd, 0, 'next month starts at zero');
  assert.equal(currentMonthSpend('test-provider', SEPT_2026).usd, 0.75, 'snapshot reads the ledger');
  const gauge = metrics.snapshot()['deepchart_vendor_estimated_spend_usd'];
  assert.ok(
    Array.isArray(gauge) && gauge.some((s: any) => s.labels?.provider === 'test-provider'),
    'spend gauge exported'
  );
  marketDataStore.clearVendorUsage('test-provider');
  assert.equal(marketDataStore.getVendorUsage('test-provider', '2026-09').usd, 0, 'ledger can be reset');

  // 4. History depth is env-tunable and clamped to what the client can render.
  assert.equal(historyBarsTarget({} as NodeJS.ProcessEnv), HISTORY_BARS_DEFAULT, 'default depth');
  assert.equal(historyBarsTarget({ HISTORY_BARS_TARGET: '900' } as NodeJS.ProcessEnv), 900, 'explicit depth honoured');
  assert.equal(historyBarsTarget({ HISTORY_BARS_TARGET: '99999' } as NodeJS.ProcessEnv), HISTORY_BARS_MAX, 'clamped above');
  assert.equal(historyBarsTarget({ HISTORY_BARS_TARGET: '1' } as NodeJS.ProcessEnv), HISTORY_BARS_MIN, 'clamped below');
  assert.equal(
    historyBarsTarget({ HISTORY_BARS_TARGET: 'garbage' } as NodeJS.ProcessEnv),
    HISTORY_BARS_DEFAULT,
    'garbage falls back to the default'
  );

  await runEstimateTests();
  await runGuardTests();

  console.log('  [PASS] Databento spend-guard & history depth unit tests passed.');
}

/** The estimate call must be a POST with the vendor's documented body and basic auth. */
async function runEstimateTests(): Promise<void> {
  const requests: CapturedRequest[] = [];
  const estimate = await estimateDatabentoCost(
    {
      dataset: 'GLBX.MDP3',
      schema: 'ohlcv-1m',
      start: '2026-09-01T00:00:00.000Z',
      end: '2026-09-02T00:00:00.000Z',
      symbols: 'ES.c.0',
      stype_in: 'continuous',
    },
    {
      apiKey: 'db-test-key',
      fetchFn: scriptedFetch(requests, { cost: () => new Response('{"cost":"0.0123"}', { status: 200 }) }),
    }
  );
  assert.equal(estimate, 0.0123, 'estimate parsed from vendor response');
  const req = requests[0];
  assert.equal(req.method, 'POST', 'cost estimate uses POST');
  assert.ok(req.url.endsWith('/v0/metadata.get_cost'), 'cost endpoint path');
  assert.equal(req.body.dataset, 'GLBX.MDP3');
  assert.equal(req.body.schema, 'ohlcv-1m');
  assert.equal(req.body.symbols, 'ES.c.0');
  assert.equal(req.body.stype_in, 'continuous');
  assert.equal(req.body.mode, 'historical-streaming', 'mode matches the timeseries.get_range default');
  assert.equal(
    req.headers?.Authorization,
    'Basic ' + Buffer.from('db-test-key:').toString('base64'),
    'basic auth carries the API key as username'
  );

  // Alternate response shape and the fail-open paths.
  assert.equal(
    await estimateDatabentoCost(
      { dataset: 'GLBX.MDP3', schema: 'trades', start: '2026-09-01T00:00:00.000Z' },
      {
        apiKey: 'db-test-key',
        fetchFn: scriptedFetch([], { cost: () => new Response('{"cost_usd":2}', { status: 200 }) }),
      }
    ),
    2,
    'cost_usd shape accepted'
  );
  assert.equal(
    await estimateDatabentoCost(
      { dataset: 'GLBX.MDP3', schema: 'trades', start: '2026-09-01T00:00:00.000Z' },
      { apiKey: 'db-test-key', fetchFn: scriptedFetch([], { cost: () => new Response('nope', { status: 500 }) }) }
    ),
    null,
    'HTTP error -> null'
  );
  assert.equal(
    await estimateDatabentoCost(
      { dataset: 'GLBX.MDP3', schema: 'trades', start: '2026-09-01T00:00:00.000Z' },
      { apiKey: 'db-test-key', fetchFn: scriptedFetch([], { cost: () => new Response('{not json', { status: 200 }) }) }
    ),
    null,
    'unparseable body -> null'
  );
  assert.equal(
    await estimateDatabentoCost(
      { dataset: 'GLBX.MDP3', schema: 'trades', start: '2026-09-01T00:00:00.000Z' },
      { fetchFn: scriptedFetch([], {}) }
    ),
    null,
    'no API key -> no estimate (and no request)'
  );
}

/** Budget enforcement: off by default, blocks only what would exceed the cap, never throws. */
async function runGuardTests(): Promise<void> {
  const provider = 'guard-test-provider';
  const query = { dataset: 'GLBX.MDP3', schema: 'ohlcv-1m', start: '2026-09-01T00:00:00.000Z' };
  const costSixTenths = () => new Response('{"cost":"0.6"}', { status: 200 });

  marketDataStore.clearVendorUsage(provider);

  // No budget, no cost logging: zero extra requests to the vendor.
  await withEnv({ DATABENTO_API_KEY: 'db-test-key' }, async () => {
    const requests: CapturedRequest[] = [];
    const verdict = await guardVendorSpend({
      provider,
      label: 'no-budget',
      query,
      fetchFn: scriptedFetch(requests, { cost: costSixTenths }),
    });
    assert.equal(verdict.allowed, true, 'fetch allowed without a budget');
    assert.equal(verdict.estimatedUsd, null, 'no estimate taken when the guard is off');
    assert.equal(requests.length, 0, 'guard is a no-op without budget/cost logging');
  });

  // Budget 0.75 with a 0.6 estimate: the first pull fits, the second would overshoot.
  await withEnv({ DATABENTO_API_KEY: 'db-test-key', DATABENTO_MONTHLY_USD_BUDGET: '0.75' }, async () => {
    const requests: CapturedRequest[] = [];
    const fetchFn = scriptedFetch(requests, { cost: costSixTenths });

    const allowed = await guardVendorSpend({ provider, label: 'first', query, fetchFn });
    assert.equal(allowed.allowed, true, 'first pull fits the budget');
    assert.equal(allowed.estimatedUsd, 0.6);
    assert.equal(allowed.budgetMonth, 0.75);
    recordVendorSpend(provider, allowed.estimatedUsd as number, 1);

    const blocked = await guardVendorSpend({ provider, label: 'second', query, fetchFn });
    assert.equal(blocked.allowed, false, 'second pull would exceed the budget');
    assert.equal(blocked.reason, 'budget');
    assert.equal(blocked.spentMonth, 0.6, 'spend from the ledger is reported back');
    const blockedMetric = metrics.snapshot()['deepchart_vendor_budget_blocked_total'];
    assert.ok(
      Array.isArray(blockedMetric) && blockedMetric.some((s: any) => s.value > 0),
      'budget block is exported as a metric'
    );

    // Estimate endpoint unavailable -> fail-open with a reason.
    const unavailable = await guardVendorSpend({
      provider: 'guard-test-provider-2',
      label: 'unavailable',
      query,
      fetchFn: scriptedFetch([], { cost: () => new Response('boom', { status: 503 }) }),
    });
    assert.equal(unavailable.allowed, true, 'unavailable estimate must not block the terminal');
    assert.equal(unavailable.reason, 'estimate-unavailable');
  });

  // Cost logging without a budget: estimate taken, nothing blocked.
  await withEnv({ DATABENTO_API_KEY: 'db-test-key', DATABENTO_COST_LOG: '1' }, async () => {
    const requests: CapturedRequest[] = [];
    const logged = await guardVendorSpend({
      provider,
      label: 'logged',
      query,
      fetchFn: scriptedFetch(requests, { cost: costSixTenths }),
    });
    assert.equal(logged.allowed, true, 'logging alone never blocks');
    assert.equal(logged.estimatedUsd, 0.6, 'estimate still taken for the log line');
    assert.equal(requests.length, 1, 'exactly one estimate request');
  });

  marketDataStore.clearVendorUsage(provider);
  marketDataStore.clearVendorUsage('guard-test-provider-2');

  await runBarsGuardTests();
}

/** End-to-end: the guard sits inside fetchDatabentoBars, so no paid request leaves once the cap is hit. */
async function runBarsGuardTests(): Promise<void> {
  await withEnv({ DATABENTO_API_KEY: 'db-test-key', DATABENTO_MONTHLY_USD_BUDGET: '1' }, async () => {
    marketDataStore.clearVendorUsage(VENDOR_USAGE_PROVIDER);

    const requests: CapturedRequest[] = [];
    const fetchFn = (async (url: string | URL, init: any = {}) => {
      const href = String(url);
      requests.push({ url: href, method: init?.method || 'GET' });
      if (href.includes('metadata.get_dataset_range')) {
        return new Response(
          JSON.stringify({
            start: '2020-01-01T00:00:00.000000000Z',
            end: new Date(Date.now() - 3600_000).toISOString(),
          }),
          { status: 200 }
        );
      }
      if (href.includes('metadata.get_cost')) return new Response('{"cost":"0.4"}', { status: 200 });
      if (href.includes('timeseries.get_range')) {
        const lines = [
          JSON.stringify({
            hd: { ts_event: '1767623400000000000' },
            open: '5850000000000',
            high: '5855000000000',
            low: '5849000000000',
            close: '5852000000000',
            volume: '150',
          }),
          JSON.stringify({
            hd: { ts_event: '1767623460000000000' },
            open: '5852000000000',
            high: '5856000000000',
            low: '5851000000000',
            close: '5854000000000',
            volume: '120',
          }),
        ].join('\n');
        return new Response(lines, { status: 200 });
      }
      throw new Error(`unexpected request: ${href}`);
    }) as unknown as typeof fetch;

    const barsConfig = { apiKey: 'db-test-key', dataset: 'GLBX.MDP3' };
    const opts = { barMinutes: 1, elements: 5, fetchFn };

    const firstBars = await fetchDatabentoBars('ES.c.0', barsConfig, opts);
    assert.equal(firstBars.length, 2, 'paid bars pull succeeds under the budget');
    assert.equal(marketDataStore.getVendorUsage(VENDOR_USAGE_PROVIDER, vendorMonthKey()).usd, 0.4, 'spend recorded');

    const secondBars = await fetchDatabentoBars('ES.c.0', barsConfig, opts);
    assert.equal(secondBars.length, 2, 'second pull still fits under $1');
    assert.equal(marketDataStore.getVendorUsage(VENDOR_USAGE_PROVIDER, vendorMonthKey()).usd, 0.8, 'spend accumulates');

    const timeseriesCalls = () => requests.filter((r) => r.url.includes('timeseries.get_range')).length;
    const before = timeseriesCalls();
    const blockedBars = await fetchDatabentoBars('ES.c.0', barsConfig, opts);
    assert.equal(blockedBars.length, 0, 'third pull is refused once it would exceed the budget');
    assert.equal(timeseriesCalls(), before, 'no paid request left the building when the budget was hit');
    assert.equal(
      marketDataStore.getVendorUsage(VENDOR_USAGE_PROVIDER, vendorMonthKey()).usd,
      0.8,
      'blocked pull adds no spend'
    );
  });

  marketDataStore.clearVendorUsage(VENDOR_USAGE_PROVIDER);
}

if (process.argv[1]?.endsWith('databentoUsage.test.ts') || process.argv[1]?.endsWith('databentoUsage.test.js')) {
  runDatabentoUsageTests().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
