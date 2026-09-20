import { FUTURES_INSTRUMENTS } from './futuresConfig.js';
import { createMarketDataFeed, preferredFeedSource } from './marketData/registry.js';
import { FeedStatusEvent, MarketDataFeed, MarketDepthEvent, MarketTrade } from './marketData/types.js';
import { validateDepth, validateTrade } from './marketData/validate.js';

/**
 * Market-data layer verification.
 * Part A (offline): normalization, validation, stale-symbol guard, fail-closed providers.
 * Part B (gated): real vendor integration, only with credentials - skipped, never faked.
 */
let failures = 0;
function check(name: string, ok: boolean, detail = ''): void {
  if (ok) console.log(`  PASS  ${name}`);
  else { failures++; console.error(`  FAIL  ${name}${detail ? ` - ${detail}` : ''}`); }
}

const ES = FUTURES_INSTRUMENTS.ES;
const BTC = FUTURES_INSTRUMENTS.BTCUSDT;
function handlersWith(sink: { trades: number; depths: number; status: FeedStatusEvent[] }) {
  return {
    onTrade: (_t: MarketTrade) => { sink.trades++; },
    onDepth: (_d: MarketDepthEvent) => { sink.depths++; },
    onStatus: (s: FeedStatusEvent) => { sink.status.push(s); },
    onError: () => undefined,
  };
}

function partA(): void {
  console.log('=== Part A: normalization / validation ===');
  const good = validateTrade({ ts: 1700000000000, price: 5850.13, size: 2, side: 'BUY' }, ES.tickSize, 'ES');
  check('trade accepted when valid', good.trade !== null);
  check('price snapped to tick grid', good.trade?.price === 5850.25, String(good.trade?.price));
  check('side normalized', good.trade?.side === 'BUY' && good.trade?.size === 2);
  check('reject NaN price', validateTrade({ ts: 1, price: NaN, size: 1 }, ES.tickSize, 'ES').trade === null);
  check('reject zero price', validateTrade({ ts: 1, price: 0, size: 1 }, ES.tickSize, 'ES').trade === null);
  check('reject negative size', validateTrade({ ts: 1, price: 5850, size: -1 }, ES.tickSize, 'ES').trade === null);
  check('reject non-finite ts', validateTrade({ ts: Infinity, price: 5850, size: 1 }, ES.tickSize, 'ES').trade === null);
  check('reject stale symbol', validateTrade({ ts: 1, price: 5850, size: 1, symbol: 'NQ' }, ES.tickSize, 'ES').dropped === 'stale-symbol');
  check('unknown side -> UNKNOWN', validateTrade({ ts: 1, price: 5850, size: 1, side: 'X' }, ES.tickSize, 'ES').trade?.side === 'UNKNOWN');

  const snap = validateDepth({ kind: 'snapshot', ts: 1700000000000, symbol: 'ES', bids: [[5850.13, 12], [5849.9, 5], ['bad', 3], [5849, -2]], asks: [[5850.24, 7]] }, ES.tickSize, 'ES');
  const snapEvent = snap.event?.kind === 'snapshot' ? snap.event : null;
  check('snapshot accepted + junk dropped', snapEvent !== null && snapEvent.bids.length === 2, String(snapEvent?.bids.length));
  check('snapshot prices snapped', snapEvent?.bids[0]?.price === 5850.25, String(snapEvent?.bids[0]?.price));
  check('snapshot keeps asks', snapEvent?.asks.length === 1);
  check('snapshot rejected when all levels invalid', validateDepth({ kind: 'snapshot', ts: 1, bids: [['x', 1]], asks: [] }, ES.tickSize, 'ES').event === null);
  check('snapshot stale symbol dropped', validateDepth({ kind: 'snapshot', ts: 1, symbol: 'NQ', bids: [[1, 1]], asks: [] }, ES.tickSize, 'ES').dropped === 'stale-symbol');

  const bidDelta = validateDepth({ kind: 'delta', ts: 1, side: 'bid', price: 5850.1, size: 3 }, ES.tickSize, 'ES');
  const bidEvent = bidDelta.event?.kind === 'delta' ? bidDelta.event : null;
  check('delta accepted + snapped to grid', bidEvent !== null && Math.abs(bidEvent.price / ES.tickSize - Math.round(bidEvent.price / ES.tickSize)) < 1e-9, String(bidEvent?.price));
  check('delta side preserved', bidEvent?.side === 'bid');
  check('delta rejects unknown side', validateDepth({ kind: 'delta', ts: 1, side: 'x', price: 5850, size: 1 }, ES.tickSize, 'ES').event === null);
  check('delta rejects negative size', validateDepth({ kind: 'delta', ts: 1, side: 'ask', price: 5850, size: -5 }, ES.tickSize, 'ES').event === null);
  check('delta allows size 0 (level removal)', validateDepth({ kind: 'delta', ts: 1, side: 'ask', price: 5850, size: 0 }, ES.tickSize, 'ES').event !== null);
  check('delta stale symbol dropped', validateDepth({ kind: 'delta', ts: 1, side: 'bid', price: 5850, size: 1, symbol: 'GC' }, ES.tickSize, 'ES').dropped === 'stale-symbol');

  check('BTCUSDT routes to binance adapter', preferredFeedSource('BTCUSDT') === 'binance');
  check('ES routes to futures vendor slot', preferredFeedSource('ES') === 'futures-vendor');
  const sink = { trades: 0, depths: 0, status: [] as FeedStatusEvent[] };
  check('BTCUSDT provider is binance', createMarketDataFeed('BTCUSDT', BTC, handlersWith(sink)).provider === 'binance');
}

async function partA2(): Promise<void> {
  console.log('=== Part A2: futures providers are fail-closed ===');
  const prev = process.env.FUTURES_PROVIDER;
  const sink = { trades: 0, depths: 0, status: [] as FeedStatusEvent[] };
  const handlers = handlersWith(sink);

  process.env.FUTURES_PROVIDER = 'none';
  const noneFeed: MarketDataFeed = createMarketDataFeed('ES', ES, handlers).feed;
  await noneFeed.connect();
  check('provider=none -> UNAVAILABLE', sink.status.at(-1)?.state === 'UNAVAILABLE');
  check('provider=none emits zero events', sink.trades === 0 && sink.depths === 0 && noneFeed.isConnected() === false);

  process.env.FUTURES_PROVIDER = 'databento';
  delete process.env.DATABENTO_API_KEY;
  delete process.env.DATABENTO_DATASET;
  delete process.env.DATABENTO_SYMBOLS;
  sink.status.length = 0;
  await createMarketDataFeed('ES', ES, handlers).feed.connect();
  check('databento without credentials -> UNAVAILABLE', sink.status.at(-1)?.state === 'UNAVAILABLE');
  check('reason names missing env vars', /DATABENTO_API_KEY|DATABENTO_DATASET/.test(String(sink.status.at(-1)?.reason)), String(sink.status.at(-1)?.reason));
  check('no market events fabricated', sink.trades === 0 && sink.depths === 0);

  process.env.DATABENTO_API_KEY = 'placeholder-not-a-real-key';
  process.env.DATABENTO_DATASET = 'GLBX.MDP3';
  process.env.DATABENTO_SYMBOLS = 'ES.FUT';
  sink.status.length = 0;
  await createMarketDataFeed('ES', ES, handlers).feed.connect();
  check('databento without spec-verified transport -> UNAVAILABLE', sink.status.at(-1)?.state === 'UNAVAILABLE');
  check('refuses to guess the wire protocol', /not implemented|spec-verified|refusing/i.test(String(sink.status.at(-1)?.reason)), String(sink.status.at(-1)?.reason));
  check('still zero fabricated events', sink.trades === 0 && sink.depths === 0);

  delete process.env.DATABENTO_API_KEY;
  delete process.env.DATABENTO_DATASET;
  delete process.env.DATABENTO_SYMBOLS;
  if (prev === undefined) delete process.env.FUTURES_PROVIDER; else process.env.FUTURES_PROVIDER = prev;
}

async function partB(): Promise<void> {
  console.log('=== Part B: real vendor integration ===');
  if (!process.env.DATABENTO_API_KEY) {
    console.log('integration test skipped - DATABENTO_API_KEY not configured');
    return;
  }
  console.log('integration test BLOCKED - DATABENTO_API_KEY present but the DBN transport is not implemented; reporting UNAVAILABLE instead of faking a PASS');
}

async function main(): Promise<void> {
  partA();
  await partA2();
  await partB();
  console.log(failures === 0 ? 'MARKET-DATA LAYER TESTS PASSED' : `${failures} MARKET-DATA TEST(S) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}
void main();

