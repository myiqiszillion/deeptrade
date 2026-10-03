import assert from 'node:assert/strict';
import {
  clearQuoteBoardCache,
  fetchWatchlistQuotes,
  normaliseQuoteSymbols,
  quoteBoardEnabled,
  quoteBoardTtlMs,
} from '../../src/marketData/quoteBoard.js';

const TRADE_RESPONSE = JSON.stringify({
  data: [
    {
      id: 'uw-12345',
      ticker_symbol: 'ES',
      executed_at: new Date(Date.now() - 5_000).toISOString(),
      price: '5850.25',
      size: '3',
      side: 'Ask',
    },
  ],
});

export async function runQuoteBoardTests(): Promise<void> {
  console.log('[unit/quoteBoard.test] Running watchlist quote-board unit tests...');

  // 1. Request normalisation: junk in, safe list out (cap 8, upper-case, de-duplicated).
  assert.deepEqual(normaliseQuoteSymbols('es, nq ,es, bad symbol!, ,cl'), ['ES', 'NQ', 'CL']);
  assert.deepEqual(normaliseQuoteSymbols(undefined), []);
  assert.equal(normaliseQuoteSymbols('a,b,c,d,e,f,g,h,i,j,k').length, 8, 'hard cap of 8 symbols');

  // 2. Opt-in + TTL knobs.
  assert.equal(quoteBoardEnabled({} as NodeJS.ProcessEnv), false, 'quote board is OFF by default');
  assert.equal(quoteBoardEnabled({ ENABLE_QUOTE_BOARD: '1' } as NodeJS.ProcessEnv), true);
  assert.equal(quoteBoardTtlMs({} as NodeJS.ProcessEnv), 60_000, 'default TTL');
  assert.equal(quoteBoardTtlMs({ QUOTE_BOARD_TTL_MS: '5000' } as NodeJS.ProcessEnv), 5_000);
  assert.equal(quoteBoardTtlMs({ QUOTE_BOARD_TTL_MS: '10' } as NodeJS.ProcessEnv), 60_000, 'absurd TTL falls back');

  // 3. Fetch: one vendor call per symbol, price decoded, then served from cache.
  clearQuoteBoardCache();
  const requests: string[] = [];
  const fetchFn = (async (url: string | URL) => {
    const href = String(url);
    requests.push(href);
    return new Response(TRADE_RESPONSE, { status: 200, headers: { 'Content-Type': 'application/json' } });
  }) as unknown as typeof fetch;

  const first = await fetchWatchlistQuotes({ symbols: ['ES', 'NQ'], apiKey: 'db-test-key', fetchFn });
  assert.equal(first.length, 2, 'one quote per symbol');
  assert.equal(first[0].price, 5850.25, 'price parsed correctly');
  assert.equal(first[0].symbol, 'ES');
  assert.equal(first[0].source, 'databento');
  assert.equal(first[0].stale, false);
  assert.ok(first[0].ageMs >= 0);
  const paidCalls = requests.filter((href) => href.includes('trades')).length;
  assert.equal(paidCalls, 2, 'two symbols -> two pulls');

  // 4. Second call inside the TTL is served from cache: no extra vendor spend.
  const second = await fetchWatchlistQuotes({ symbols: ['ES', 'NQ'], apiKey: 'db-test-key', fetchFn });
  assert.equal(second.length, 2);
  assert.equal(
    requests.filter((href) => href.includes('trades')).length,
    2,
    'cached quotes must not trigger new pulls'
  );

  // 5. A failing refresh keeps the previous value, flagged stale (never invented). ttlMs:0 forces the
  //    refresh path, which is what an expired TTL does in production.
  clearQuoteBoardCache();
  let failNext = false;
  const flakyFetch = (async (url: string | URL) => {
    const href = String(url);
    if (failNext) return new Response('boom', { status: 500 });
    return new Response(TRADE_RESPONSE, { status: 200, headers: { 'Content-Type': 'application/json' } });
  }) as unknown as typeof fetch;

  const fresh = await fetchWatchlistQuotes({ symbols: ['CL'], apiKey: 'db-test-key', fetchFn: flakyFetch });
  assert.equal(fresh[0].stale, false, 'first pull is fresh');
  failNext = true;
  const afterFailure = await fetchWatchlistQuotes({
    symbols: ['CL'],
    apiKey: 'db-test-key',
    fetchFn: flakyFetch,
    ttlMs: 0,
  });
  assert.equal(afterFailure.length, 1, 'stale quote is still reported');
  assert.equal(afterFailure[0].stale, true, 'failed refresh is flagged stale');
  assert.equal(afterFailure[0].price, 5850.25, 'the stale value is the last real price, not a re-invention');

  // 6. Empty input never touches the network.
  const before = requests.length;
  assert.deepEqual(await fetchWatchlistQuotes({ symbols: [], apiKey: 'db-test-key', fetchFn }), []);
  assert.equal(requests.length, before, 'no request for an empty symbol list');

  clearQuoteBoardCache();
  console.log('  [PASS] Watchlist quote-board unit tests passed.');
}

if (process.argv[1]?.endsWith('quoteBoard.test.ts') || process.argv[1]?.endsWith('quoteBoard.test.js')) {
  runQuoteBoardTests().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
