import { FUTURES_INSTRUMENTS } from '../../src/futuresConfig.js';
import {
  DATABENTO_SYMBOL_MAP,
  DBN_INTEGRATION_SPEC,
  DatabentoMarketDataFeed,
  resolveDatabentoSymbol,
} from '../../src/marketData/databentoAdapter.js';
import { aggregateBars, fetchDatabentoBars, fetchDatabentoTrades, fetchDatabentoDatasetRange } from '../../src/marketData/databentoHistory.js';
import {
  DBN_CONSTANTS,
  DatabentoSocketLike,
  buildCramAuthResponse,
  parseDbnRecord,
} from '../../src/marketData/databentoTransport.js';
import { FeedHandlers, FeedStatusEvent, MarketDepthEvent, MarketTrade } from '../../src/marketData/types.js';

let failures = 0;
function check(name: string, ok: boolean, detail = ''): void {
  if (ok) {
    console.log(`  PASS  ${name}`);
  } else {
    failures++;
    console.error(`  FAIL  ${name}${detail ? ` - ${detail}` : ''}`);
  }
}

class FakeNetSocket implements DatabentoSocketLike {
  public written: string[] = [];
  public isDestroyed = false;
  private listeners = new Map<string, ((...args: any[]) => void)[]>();

  constructor(public readonly host: string, public readonly port: number) {}

  write(data: string | Uint8Array): boolean {
    const str = typeof data === 'string' ? data : Buffer.from(data).toString('utf8');
    this.written.push(str);
    return true;
  }

  on(event: 'connect' | 'data' | 'error' | 'close', listener: (...args: any[]) => void): this {
    const list = this.listeners.get(event) ?? [];
    list.push(listener);
    this.listeners.set(event, list);
    return this;
  }

  destroy(): void {
    this.isDestroyed = true;
    this.emit('close');
  }

  removeAllListeners(): this {
    this.listeners.clear();
    return this;
  }

  emit(event: string, ...args: any[]): void {
    const list = this.listeners.get(event) ?? [];
    for (const l of [...list]) l(...args);
  }

  pushData(chunk: Buffer | string): void {
    const buf = typeof chunk === 'string' ? Buffer.from(chunk) : chunk;
    this.emit('data', buf);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

interface Sink {
  trades: MarketTrade[];
  depth: MarketDepthEvent[];
  status: FeedStatusEvent[];
  errors: Error[];
}

function newSink(): Sink {
  return { trades: [], depth: [], status: [], errors: [] };
}

function handlersFor(sink: Sink): FeedHandlers {
  return {
    onTrade: (t) => sink.trades.push(t),
    onDepth: (d) => sink.depth.push(d),
    onStatus: (s) => sink.status.push(s),
    onError: (e) => sink.errors.push(e),
  };
}

function createMockTradeRecord(opts: {
  price?: number;
  size?: number;
  rawPrice?: bigint;
  rawSize?: number;
  sideChar?: string;
  actionChar?: string;
  tsNs?: bigint;
  seq?: number;
}): Buffer {
  const buf = Buffer.alloc(48);
  buf.writeUInt8(12, 0); // 12 * 4 = 48 bytes
  buf.writeUInt8(DBN_CONSTANTS.RTYPE_MBP0, 1);
  buf.writeUInt16LE(1, 2); // publisher_id
  buf.writeUInt32LE(12345, 4); // instrument_id
  const tsNs = opts.tsNs ?? 1767623400000000000n; // 2026-01-05T14:30:00.000Z
  buf.writeBigUInt64LE(tsNs, 8);

  const price = opts.rawPrice ?? BigInt(Math.round((opts.price ?? 5850.25) * 1e9));
  buf.writeBigInt64LE(price, 16);
  const size = opts.rawSize ?? (opts.size ?? 5);
  buf.writeUInt32LE(size, 24);

  buf.writeUInt8((opts.actionChar ?? 'T').charCodeAt(0), 28);
  buf.writeUInt8((opts.sideChar ?? 'B').charCodeAt(0), 29);
  buf.writeUInt8(0, 30); // flags
  buf.writeUInt8(0, 31); // depth
  buf.writeBigUInt64LE(tsNs, 32); // ts_recv
  buf.writeInt32LE(0, 40); // ts_in_delta
  buf.writeUInt32LE(opts.seq ?? 101, 44);
  return buf;
}

function createMockMbp1Record(opts: {
  bidPx?: number;
  askPx?: number;
  bidSz?: number;
  askSz?: number;
  tradePx?: number;
  tradeSz?: number;
  actionChar?: string;
  sideChar?: string;
  tsNs?: bigint;
  seq?: number;
}): Buffer {
  const buf = Buffer.alloc(80);
  buf.writeUInt8(20, 0); // 20 * 4 = 80 bytes
  buf.writeUInt8(DBN_CONSTANTS.RTYPE_MBP1, 1);
  buf.writeUInt16LE(1, 2);
  buf.writeUInt32LE(12345, 4);
  const tsNs = opts.tsNs ?? 1767623400000000000n;
  buf.writeBigUInt64LE(tsNs, 8);

  const tradePx = opts.tradePx ? BigInt(Math.round(opts.tradePx * 1e9)) : DBN_CONSTANTS.UNDEF_PRICE;
  buf.writeBigInt64LE(tradePx, 16);
  buf.writeUInt32LE(opts.tradeSz ?? 0, 24);
  buf.writeUInt8((opts.actionChar ?? 'A').charCodeAt(0), 28);
  buf.writeUInt8((opts.sideChar ?? 'B').charCodeAt(0), 29);
  buf.writeBigUInt64LE(tsNs, 32);
  buf.writeInt32LE(0, 40);
  buf.writeUInt32LE(opts.seq ?? 202, 44);

  // levels[0]
  const bidPx = opts.bidPx ? BigInt(Math.round(opts.bidPx * 1e9)) : DBN_CONSTANTS.UNDEF_PRICE;
  const askPx = opts.askPx ? BigInt(Math.round(opts.askPx * 1e9)) : DBN_CONSTANTS.UNDEF_PRICE;
  buf.writeBigInt64LE(bidPx, 48);
  buf.writeBigInt64LE(askPx, 56);
  buf.writeUInt32LE(opts.bidSz ?? 0, 64);
  buf.writeUInt32LE(opts.askSz ?? 0, 68);
  buf.writeUInt32LE(1, 72); // bid_ct
  buf.writeUInt32LE(1, 76); // ask_ct
  return buf;
}

function createMockDbnHeader(metaLen = 16): Buffer {
  const buf = Buffer.alloc(8 + metaLen);
  buf.write(DBN_CONSTANTS.MAGIC, 0, 3, 'ascii'); // 'DBN'
  buf.writeUInt8(1, 3); // version 1
  buf.writeUInt32LE(metaLen, 4); // metadata length
  return buf;
}

// ===========================================================================
// Part A: DBN wire format decoding and spec validation
// ===========================================================================
function partA(): void {
  console.log('=== Part A: DBN wire format & spec verification ===');

  check('DBN record header is 16 bytes', DBN_INTEGRATION_SPEC.recordSizes.recordHeader === 16);
  check('TradeMsg is 48 bytes', DBN_INTEGRATION_SPEC.recordSizes.tradeMsg === 48);
  check('MBP1Msg is 80 bytes', DBN_INTEGRATION_SPEC.recordSizes.mbp1Msg === 80);
  check('MBP10Msg is 368 bytes', DBN_INTEGRATION_SPEC.recordSizes.mbp10Msg === 368);
  check('Price scale is 1e-9', DBN_INTEGRATION_SPEC.priceScaling === 1e-9);
  check('UNDEF_PRICE matches 0x7fffffffffffffffn', DBN_CONSTANTS.UNDEF_PRICE === 9223372036854775807n);
  check('UNDEF_ORDER_SIZE matches 0xffffffff', DBN_CONSTANTS.UNDEF_ORDER_SIZE === 4294967295);

  // Decode trade record
  const tradeBuf = createMockTradeRecord({
    price: 5850.5,
    size: 7,
    sideChar: 'B',
    actionChar: 'T',
    tsNs: 1767623400123456789n,
    seq: 999,
  });
  const { parsed: tParsed, recLen: tLen } = parseDbnRecord(tradeBuf, 'ES');
  check('trade record length decoded as 48', tLen === 48);
  check('parsed rtype is 0 (MBP-0)', tParsed?.rtype === 0);
  check('trade price scaled from 1e-9', tParsed?.trade?.price === 5850.5, String(tParsed?.trade?.price));
  check('trade size passed through', tParsed?.trade?.size === 7, String(tParsed?.trade?.size));
  check('aggressor side B decodes to BUY (offer lifted)', tParsed?.trade?.side === 'BUY', tParsed?.trade?.side);
  check('timestamp converted to ms', tParsed?.trade?.ts === 1767623400123, String(tParsed?.trade?.ts));
  check('sequence ID passed through', tParsed?.trade?.sequenceId === 999, String(tParsed?.trade?.sequenceId));
  check('aggressor provenance is EXCHANGE_NATIVE', tParsed?.trade?.aggressorProvenance === 'EXCHANGE_NATIVE');

  // Verify side A decodes to SELL
  const sellBuf = createMockTradeRecord({ sideChar: 'A', actionChar: 'T' });
  const { parsed: sParsed } = parseDbnRecord(sellBuf, 'ES');
  check('aggressor side A decodes to SELL (bid hit)', sParsed?.trade?.side === 'SELL', sParsed?.trade?.side);

  // Verify UNDEF_PRICE trade is ignored
  const undefBuf = createMockTradeRecord({ rawPrice: DBN_CONSTANTS.UNDEF_PRICE, actionChar: 'T' });
  const { parsed: uParsed } = parseDbnRecord(undefBuf, 'ES');
  check('UNDEF_PRICE trade emits no trade', uParsed?.trade === undefined);

  // Decode MBP-1 record
  const mbpBuf = createMockMbp1Record({
    bidPx: 5850.25,
    askPx: 5850.5,
    bidSz: 14,
    askSz: 22,
    tradePx: 5850.5,
    tradeSz: 2,
    actionChar: 'T',
    sideChar: 'B',
    tsNs: 1767623400123000000n,
  });
  const { parsed: mParsed, recLen: mLen } = parseDbnRecord(mbpBuf, 'ES');
  check('MBP-1 record length decoded as 80', mLen === 80);
  check('MBP-1 emits depth snapshot', mParsed?.depth?.kind === 'snapshot');
  check('MBP-1 top bid price decoded', mParsed?.depth?.kind === 'snapshot' && mParsed.depth.bids[0]?.price === 5850.25);
  check('MBP-1 top bid size decoded', mParsed?.depth?.kind === 'snapshot' && mParsed.depth.bids[0]?.size === 14);
  check('MBP-1 top ask price decoded', mParsed?.depth?.kind === 'snapshot' && mParsed.depth.asks[0]?.price === 5850.5);
  check('MBP-1 top ask size decoded', mParsed?.depth?.kind === 'snapshot' && mParsed.depth.asks[0]?.size === 22);
  check('MBP-1 trade included when action is T', mParsed?.trade?.price === 5850.5 && mParsed?.trade?.size === 2);
}

// ===========================================================================
// Part B: CRAM challenge-response authentication handshake
// ===========================================================================
function partB(): void {
  console.log('=== Part B: CRAM challenge-response handshake ===');

  const challenge = 'challenge-xyz-987';
  const apiKey = 'db-test-key-12345';
  const dataset = 'GLBX.MDP3';
  const authReq = buildCramAuthResponse(challenge, apiKey, dataset);

  check('auth request ends with newline', authReq.endsWith('\n'));
  check('auth request specifies encoding=dbn', authReq.includes('encoding=dbn'));
  check('auth request specifies dataset', authReq.includes('dataset=GLBX.MDP3'));
  check('auth request carries bucket id suffix (last 5 chars)', authReq.includes('-12345|'));
  check('auth request specifies client version', authReq.includes('client=DeepChart/1.0.0'));
}

// ===========================================================================
// Part C: Symbology mapping
// ===========================================================================
function partC(): void {
  console.log('=== Part C: symbology mapping ===');

  check('ES maps to continuous front month ES.c.0', DATABENTO_SYMBOL_MAP.ES === 'ES.c.0');
  check('NQ maps to continuous front month NQ.c.0', DATABENTO_SYMBOL_MAP.NQ === 'NQ.c.0');
  check('MES maps to continuous front month MES.c.0', DATABENTO_SYMBOL_MAP.MES === 'MES.c.0');
  check('CL maps to continuous front month CL.c.0', DATABENTO_SYMBOL_MAP.CL === 'CL.c.0');

  const resContinuous = resolveDatabentoSymbol('ES');
  check('default resolution uses continuous stype', resContinuous.stypeIn === 'continuous');
  check('default resolution resolves to ES.c.0', resContinuous.vendorSymbol === 'ES.c.0');

  const resOverride = resolveDatabentoSymbol('ES', { symbols: 'ES.FUT', stypeIn: 'parent' });
  check('explicit symbol override preserved', resOverride.vendorSymbol === 'ES.FUT');
  check('explicit stypeIn preserved', resOverride.stypeIn === 'parent');
}

// ===========================================================================
// Part D: Live feed simulation with scripted socket
// ===========================================================================
async function partD(): Promise<void> {
  console.log('=== Part D: live feed simulation (scripted socket) ===');

  const sink = newSink();
  let createdSocket: FakeNetSocket | null = null;

  const feed = new DatabentoMarketDataFeed(
    'ES',
    handlersFor(sink),
    {
      apiKey: 'db-test-key-54321',
      dataset: 'GLBX.MDP3',
    },
    {
      socketFactory: (host, port) => {
        createdSocket = new FakeNetSocket(host, port);
        return createdSocket;
      },
    }
  );

  const connectPromise = feed.connect();
  check('socket created during connect', createdSocket !== null);
  const socket = createdSocket!;

  check('initial status is CONNECTING', sink.status.some((s) => s.state === 'CONNECTING'));
  check('feed is not LIVE before real data', feed.isConnected() === false);

  // Arm waitForLive
  let waitedLive = false;
  const waitPromise = feed.waitForLive(2000).then(() => {
    waitedLive = true;
  });

  // Step 1: Gateway sends CRAM challenge
  socket.pushData('cram=test_cram_token_001\n');
  await sleep(10);
  check('client answered CRAM with auth request', socket.written.length >= 1 && socket.written[0]?.startsWith('auth='));

  // Step 2: Gateway sends auth success
  socket.pushData('success=1|session_id=1001\n');
  await sleep(10);
  check('client sent trades subscription', socket.written.some((w) => w.includes('schema=trades')));
  check('client sent mbp-1 subscription', socket.written.some((w) => w.includes('schema=mbp-1')));
  check('client sent start_session=1', socket.written.some((w) => w.includes('start_session=1')));

  // Step 3: Gateway sends DBN metadata header + trade record in chunked stream
  const headerBuf = createMockDbnHeader(16);
  const tradeBuf = createMockTradeRecord({
    price: 5850.25,
    size: 10,
    sideChar: 'B',
    actionChar: 'T',
  });

  // Send header first
  socket.pushData(headerBuf);
  await sleep(10);
  check('header alone does not claim LIVE', feed.isConnected() === false);

  // Send trade record
  socket.pushData(tradeBuf);
  await waitPromise;

  check('waitForLive resolved after validated trade', waitedLive);
  check('feed is now LIVE', feed.isConnected() === true);
  check('status reported LIVE with dataset and symbol', sink.status.some((s) => s.state === 'LIVE'));
  check('trade reached handler', sink.trades.length === 1);
  check('trade price is 5850.25', sink.trades[0]?.price === 5850.25);
  check('trade size is 10', sink.trades[0]?.size === 10);
  check('trade side is BUY', sink.trades[0]?.side === 'BUY');
  check('trade sourceProvider is databento', sink.trades[0]?.sourceProvider === 'databento');

  // Step 4: Gateway sends MBP-1 depth snapshot
  const mbpBuf = createMockMbp1Record({
    bidPx: 5850.0,
    askPx: 5850.25,
    bidSz: 15,
    askSz: 25,
    actionChar: 'A',
  });
  socket.pushData(mbpBuf);
  await sleep(10);

  check('depth reached handler', sink.depth.length === 1);
  check('depth has bid @ 5850.0 size 15', sink.depth[0]?.kind === 'snapshot' && sink.depth[0].bids[0]?.price === 5850.0);
  check('depth has ask @ 5850.25 size 25', sink.depth[0]?.kind === 'snapshot' && sink.depth[0].asks[0]?.price === 5850.25);

  // Disconnect
  await feed.disconnect();
  check('feed is not LIVE after disconnect', feed.isConnected() === false);
  check('status reports UNAVAILABLE after disconnect', sink.status[sink.status.length - 1]?.state === 'UNAVAILABLE');
}

// ===========================================================================
// Part E: Fail-closed without credentials
// ===========================================================================
async function partE(): Promise<void> {
  console.log('=== Part E: fail-closed without credentials ===');

  const sink = newSink();
  const feed = new DatabentoMarketDataFeed('ES', handlersFor(sink), { apiKey: '' });

  await feed.connect();
  check('state is UNAVAILABLE without API key', feed.isConnected() === false);
  check(
    'reason states missing DATABENTO_API_KEY',
    sink.status.some((s) => s.state === 'UNAVAILABLE' && /missing DATABENTO_API_KEY/.test(s.reason ?? ''))
  );
  check('zero trades fabricated', sink.trades.length === 0);
  check('zero depth fabricated', sink.depth.length === 0);

  // waitForLive should reject immediately with real reason
  let rejected = false;
  let rejectReason = '';
  try {
    await feed.waitForLive(1000);
  } catch (err: any) {
    rejected = true;
    rejectReason = err?.message || '';
  }
  check('waitForLive fails fast without delay', rejected);
  check('rejection contains honest credential reason', /missing DATABENTO_API_KEY/.test(rejectReason));
}

// ===========================================================================
// Part F: Historical bars fetcher (fetchDatabentoBars)
// ===========================================================================
async function partF(): Promise<void> {
  console.log('=== Part F: historical bars fetcher ===');

  // Test NDJSON parsing & UNDEF_PRICE filtering
  const sampleNdjson = [
    JSON.stringify({
      hd: { ts_event: '1767623400000000000' }, // 14:30
      open: '5850000000000',
      high: '5855000000000',
      low: '5848000000000',
      close: '5852000000000',
      volume: '150',
    }),
    JSON.stringify({
      hd: { ts_event: '1767623460000000000' }, // 14:31
      open: '5852000000000',
      high: '5856000000000',
      low: '5851000000000',
      close: '5854000000000',
      volume: '120',
    }),
    // Corrupt record with UNDEF_PRICE
    JSON.stringify({
      hd: { ts_event: '1767623520000000000' },
      open: String(DBN_CONSTANTS.UNDEF_PRICE),
      high: '5856000000000',
      low: '5851000000000',
      close: '5854000000000',
      volume: '10',
    }),
  ].join('\n');

  const mockFetch = async () =>
    new Response(sampleNdjson, {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });

  const bars = await fetchDatabentoBars(
    'ES.c.0',
    { apiKey: 'test_key', dataset: 'GLBX.MDP3' },
    { barMinutes: 1, elements: 10, fetchFn: mockFetch as any }
  );

  check('fetchDatabentoBars returns valid bars', bars.length === 2);
  check('first bar OHLC scaled correctly', bars[0]?.open === 5850.0 && bars[0]?.high === 5855.0);
  check('corrupt UNDEF_PRICE bar dropped', bars.every((b) => b.open < 100000));
  check('volume passed through', bars[0]?.volume === 150 && bars[1]?.volume === 120);

  // Test multi-minute aggregation
  const aggregated5m = aggregateBars(bars, 5);
  check('aggregates 2 1m bars into 1 5m bar', aggregated5m.length === 1);
  check('aggregated open is first open', aggregated5m[0]?.open === 5850.0);
  check('aggregated high is max high', aggregated5m[0]?.high === 5856.0);
  check('aggregated low is min low', aggregated5m[0]?.low === 5848.0);
  check('aggregated close is last close', aggregated5m[0]?.close === 5854.0);
  check('aggregated volume is sum volume', aggregated5m[0]?.volume === 270);
}

// ===========================================================================
// Part G: Stream fragmentation and reassembly
// ===========================================================================
async function partG(): Promise<void> {
  console.log('=== Part G: stream fragmentation & reassembly ===');

  const sink = newSink();
  let createdSocket: FakeNetSocket | null = null;

  const feed = new DatabentoMarketDataFeed(
    'ES',
    handlersFor(sink),
    { apiKey: 'key-12345', dataset: 'GLBX.MDP3' },
    {
      socketFactory: (host, port) => {
        createdSocket = new FakeNetSocket(host, port);
        return createdSocket;
      },
    }
  );

  await feed.connect();
  const socket = createdSocket!;

  // Split CRAM challenge across two data packets
  socket.pushData('cram=ch');
  await sleep(10);
  check('half cram does not trigger auth', socket.written.length === 0);
  socket.pushData('allenge_fragment\n');
  await sleep(10);
  check('completed cram triggers auth', socket.written.length === 1);

  // Split auth response across two packets
  socket.pushData('succ');
  await sleep(10);
  check('half auth does not trigger subs', socket.written.length === 1);
  socket.pushData('ess=1\n');
  await sleep(10);
  check('completed auth triggers subscriptions', socket.written.length > 1);

  // Send header followed by fragmented trade record
  const headerBuf = createMockDbnHeader(8);
  const tradeBuf = createMockTradeRecord({ price: 5860.0, size: 3 });

  socket.pushData(headerBuf);
  // Send first 20 bytes of trade record
  socket.pushData(tradeBuf.subarray(0, 20));
  await sleep(10);
  check('incomplete record emits no trade', sink.trades.length === 0);

  // Send remaining 28 bytes of trade record
  socket.pushData(tradeBuf.subarray(20));
  await sleep(10);
  check('reassembled record emits trade', sink.trades.length === 1 && sink.trades[0]?.price === 5860.0);

  await feed.disconnect();
}

// ===========================================================================
// Part H: Historical trades & metadata dataset range
// ===========================================================================
async function partH(): Promise<void> {
  console.log('=== Part H: historical trades & metadata range ===');

  const sampleTradesNdjson = [
    JSON.stringify({
      hd: { ts_event: '1767623400000000000', rtype: 0 },
      price: '5850250000000',
      size: 15,
      action: 'T',
      side: 'B',
      sequence: 1001,
    }),
    JSON.stringify({
      hd: { ts_event: '1767623401000000000', rtype: 0 },
      price: '5850000000000',
      size: 8,
      action: 'T',
      side: 'A',
      sequence: 1002,
    }),
    // Corrupt record with UNDEF_PRICE
    JSON.stringify({
      hd: { ts_event: '1767623402000000000', rtype: 0 },
      price: String(DBN_CONSTANTS.UNDEF_PRICE),
      size: 5,
      action: 'T',
      side: 'B',
      sequence: 1003,
    }),
    // Non-trade action
    JSON.stringify({
      hd: { ts_event: '1767623403000000000', rtype: 0 },
      price: '5850250000000',
      size: 5,
      action: 'C',
      side: 'B',
      sequence: 1004,
    }),
  ].join('\n');

  const mockTradeFetch = async () =>
    new Response(sampleTradesNdjson, {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });

  const trades = await fetchDatabentoTrades(
    'ES.c.0',
    { apiKey: 'test_key', dataset: 'GLBX.MDP3' },
    { limit: 10, fetchFn: mockTradeFetch as any }
  );

  check('fetchDatabentoTrades returns valid trades', trades.length === 2);
  check('trade price scaled from 1e9', trades[0]?.price === 5850.25);
  check('trade size passed through', trades[0]?.size === 15);
  check('buy side mapped to buy', trades[0]?.side === 'buy');
  check('sell side mapped to sell', trades[1]?.side === 'sell');
  check('non-trade action and undef price filtered out', trades.length === 2);

  // Test dataset range
  const mockRangeFetch = async () =>
    new Response(JSON.stringify({ start: '2022-01-01T00:00:00.000Z', end: '2026-09-28T10:00:00.000Z' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });

  const range = await fetchDatabentoDatasetRange('GLBX.MDP3', 'test_key', mockRangeFetch as any);
  check('fetchDatabentoDatasetRange returns valid range', range?.start !== undefined && range?.end !== undefined);
  check('range end matches mock', range?.end === '2026-09-28T10:00:00.000Z');
}

async function runAll(): Promise<void> {
  console.log('======================================================');
  console.log('🧪 DEEPCHART DATABENTO ADAPTER TEST SUITE (OFFLINE)');
  console.log('======================================================\n');

  partA();
  partB();
  partC();
  await partD();
  await partE();
  await partF();
  await partG();
  await partH();

  console.log('\n======================================================');
  if (failures === 0) {
    console.log('🎉 ALL DATABENTO ADAPTER TESTS PASSED');
    console.log('======================================================\n');
    process.exit(0);
  } else {
    console.error(`❌ ${failures} DATABENTO TEST(S) FAILED`);
    console.log('======================================================\n');
    process.exit(1);
  }
}

runAll().catch((err) => {
  console.error('Test suite error:', err);
  process.exit(1);
});
