import { historyBeforeLive } from '../../../client/src/services/chartHistory.js';
import { FUTURES_INSTRUMENTS } from '../../src/futuresConfig.js';
import { createMarketDataFeed } from '../../src/marketData/registry.js';
import {
  TradovateMarketDataFeed,
  resolveVendorSymbol,
} from '../../src/marketData/tradovateAdapter.js';
import { credentialFreeMessage, readTradovateConfig } from '../../src/marketData/tradovateConfig.js';
import { TradovateQuoteMapper } from '../../src/marketData/tradovateMapper.js';
import {
  fetchTradovateHistoryBars,
  mapChartBar,
  normalizeBars,
} from '../../src/marketData/tradovateHistory.js';
import {
  TRADOVATE_ENDPOINTS,
  TRADOVATE_HEARTBEAT_FRAME,
  TRADOVATE_HEARTBEAT_INTERVAL_MS,
  TradovateSocketLike,
  buildTradovateFrame,
  parseTradovateFrame,
} from '../../src/marketData/tradovateTransport.js';
import { FeedHandlers, FeedStatusEvent, MarketDepthEvent, MarketTrade } from '../../src/marketData/types.js';

/**
 * Tradovate provider verification — fully OFFLINE.
 *
 * Every wire expectation asserted here is quoted from Tradovate's own reference client
 * (github.com/tradovate/example-api-js, EX-01/EX-07/EX-08/EX-09 + tutorialsURLs.js), so this
 * suite proves the adapter matches the VENDOR instead of matching an assumption.
 *
 * The real socket is replaced by a scripted one, so the suite never touches the network and
 * never needs credentials. Part E additionally proves the provider is FAIL-CLOSED: without
 * credentials it reports UNAVAILABLE and fabricates nothing.
 */
let failures = 0;
function check(name: string, ok: boolean, detail = ''): void {
  if (ok) console.log(`  PASS  ${name}`);
  else {
    failures++;
    console.error(`  FAIL  ${name}${detail ? ` - ${detail}` : ''}`);
  }
}

const ES = FUTURES_INSTRUMENTS.ES;

// Timestamps in the exact ISO form the vendor sends ("2017-04-13T04:59:06.588Z" per EX-08).
const T0 = '2026-01-05T14:30:00.000Z';
const T1 = '2026-01-05T14:30:00.250Z';

// ---------------------------------------------------------------------------
// Part A: transport primitives must match the vendor's client byte for byte
// ---------------------------------------------------------------------------
function partA(): void {
  console.log('=== Part A: wire protocol primitives ===');

  // prepareMessage(): T = raw.slice(0,1); data = raw.length > 1 ? JSON.parse(raw.slice(1)) : []
  const openFrame = parseTradovateFrame('o');
  check('open frame decodes to kind o with no items', openFrame.kind === 'o' && openFrame.items.length === 0);
  check('heartbeat frame decodes to kind h', parseTradovateFrame('h[]').kind === 'h');
  const dataFrame = parseTradovateFrame('a[{"e":"md","i":0,"s":200}]');
  check(
    'data frame decodes to kind a with items',
    dataFrame.kind === 'a' && dataFrame.items.length === 1 && dataFrame.items[0]?.e === 'md' && dataFrame.items[0]?.s === 200
  );

  // TradovateSocket.send(): `${url}\n${id}\n${query || ''}\n${JSON.stringify(body)}`
  const subscribeFrame = buildTradovateFrame('md/subscribequote', 7, { symbol: '@ES' });
  check(
    'outbound frame is newline-delimited url/id/query/body',
    subscribeFrame === 'md/subscribequote\n7\n\n{"symbol":"@ES"}',
    subscribeFrame
  );
  // TradovateSocket.connect() authorizes with `body: token`, i.e. a raw string.
  const authorizeFrame = buildTradovateFrame('authorize', 0, 'tok_abc');
  check(
    'authorize body is the RAW TOKEN STRING (JSON.stringify), not an object',
    authorizeFrame === 'authorize\n0\n\n"tok_abc"',
    authorizeFrame
  );
  check('query is carried when present', buildTradovateFrame('md/getchart', 1, { a: 1 }, 'x=1') === 'md/getchart\n1\nx=1\n{"a":1}');

  // checkHeartbeats(): socket.send('[]') once >= 2500 ms elapsed
  check("heartbeat payload is the literal '[]'", TRADOVATE_HEARTBEAT_FRAME === '[]');
  check('heartbeat threshold is 2500ms', TRADOVATE_HEARTBEAT_INTERVAL_MS === 2500);

  // tutorialsURLs.js
  check('demo REST base', TRADOVATE_ENDPOINTS.demo.restBase === 'https://demo.tradovateapi.com/v1');
  check('live REST base', TRADOVATE_ENDPOINTS.live.restBase === 'https://live.tradovateapi.com/v1');
  check('market-data socket URL', TRADOVATE_ENDPOINTS.demo.mdWsUrl === 'wss://md.tradovateapi.com/v1/websocket');
}

// ---------------------------------------------------------------------------
// Part B: configuration + credential hygiene
// ---------------------------------------------------------------------------
const FULL_ENV = {
  TRADOVATE_ENV: 'demo',
  TRADOVATE_USERNAME: 'trader',
  TRADOVATE_PASSWORD: 's3cr3t-pw',
  TRADOVATE_APP_ID: 'deepchart',
  TRADOVATE_APP_VERSION: '1.0.0',
  TRADOVATE_CID: '2',
  TRADOVATE_SEC: 'abc123sec',
};

function partB(): void {
  console.log('=== Part B: configuration and credential hygiene ===');

  const empty = readTradovateConfig({});
  check('missing credentials -> null credentials', empty.credentials === null);
  check(
    'reason names the missing env vars',
    /TRADOVATE_USERNAME/.test(empty.missingReason ?? '') && /TRADOVATE_SEC/.test(empty.missingReason ?? ''),
    empty.missingReason
  );
  check('env defaults to demo (never silently live)', empty.env === 'demo');
  check('TRADOVATE_ENV=live is honoured', readTradovateConfig({ TRADOVATE_ENV: 'live' }).env === 'live');
  check('TRADOVATE_ENV=LIVE is case-insensitive', readTradovateConfig({ TRADOVATE_ENV: 'LIVE' }).env === 'live');
  check('unknown TRADOVATE_ENV falls back to demo', readTradovateConfig({ TRADOVATE_ENV: 'paper' }).env === 'demo');

  const full = readTradovateConfig(FULL_ENV);
  check('complete credentials parse', full.credentials !== null && full.missingReason === undefined);
  check('cid parsed as a number', full.credentials?.cid === 2, String(full.credentials?.cid));
  check('appId/appVersion preserved', full.credentials?.appId === 'deepchart' && full.credentials?.appVersion === '1.0.0');
  check('all six vendor fields present',
    full.credentials !== null &&
      full.credentials.name === 'trader' &&
      full.credentials.password === 's3cr3t-pw' &&
      full.credentials.sec === 'abc123sec'
  );

  const badCid = readTradovateConfig({ ...FULL_ENV, TRADOVATE_CID: 'not-a-number' });
  check('non-numeric cid is rejected', badCid.credentials === null && /TRADOVATE_CID/.test(badCid.missingReason ?? ''), badCid.missingReason);

  const partial = readTradovateConfig({ ...FULL_ENV, TRADOVATE_PASSWORD: '' });
  check('blank password counts as missing', partial.credentials === null && /TRADOVATE_PASSWORD/.test(partial.missingReason ?? ''));

  // credentialFreeMessage is the last line of defence before a reason reaches the browser.
  process.env.TRADOVATE_PASSWORD = FULL_ENV.TRADOVATE_PASSWORD;
  process.env.TRADOVATE_SEC = FULL_ENV.TRADOVATE_SEC;
  process.env.TRADOVATE_USERNAME = FULL_ENV.TRADOVATE_USERNAME;
  const scrubbed = credentialFreeMessage(
    'auth failed for trader pw=s3cr3t-pw sec=abc123sec Authorization: Bearer eyJhbGci.token-value'
  );
  check('password is redacted from a reason', !scrubbed.includes('s3cr3t-pw'), scrubbed);
  check('secret is redacted from a reason', !scrubbed.includes('abc123sec'), scrubbed);
  check('username is redacted from a reason', !scrubbed.includes('trader'), scrubbed);
  check(
    'bearer token is redacted from a reason',
    !scrubbed.includes('eyJhbGci.token-value') && /Bearer \[redacted\]/.test(scrubbed),
    scrubbed
  );
  check('the readable part of the message survives', scrubbed.includes('auth failed for'), scrubbed);
  delete process.env.TRADOVATE_PASSWORD;
  delete process.env.TRADOVATE_SEC;
  delete process.env.TRADOVATE_USERNAME;

  // Symbol resolution
  check('default symbol is the continuous front month', resolveVendorSymbol('ES', ES, readTradovateConfig({})) === '@ES');
  check('TRADOVATE_USE_MICRO=1 streams the micro root', resolveVendorSymbol('ES', ES, readTradovateConfig({ TRADOVATE_USE_MICRO: '1' })) === '@MES');
  check('TRADOVATE_USE_MICRO=0 keeps the full-size contract', resolveVendorSymbol('ES', ES, readTradovateConfig({ TRADOVATE_USE_MICRO: '0' })) === '@ES');
  check('explicit contract month override wins', resolveVendorSymbol('ES', ES, readTradovateConfig({ TRADOVATE_SYMBOL: 'ESZ6' })) === 'ESZ6');
  check('override is trimmed', resolveVendorSymbol('ES', ES, readTradovateConfig({ TRADOVATE_SYMBOL: '  ESH6  ' })) === 'ESH6');
}

// ---------------------------------------------------------------------------
// Part C: payload mapping — the vendor publishes STATE, not EVENTS
// ---------------------------------------------------------------------------
function partC(): void {
  console.log('=== Part C: vendor payload -> DeepChart boundary ===');
  const mapper = new TradovateQuoteMapper();

  // --- Aggressor derivation (Lee-Ready quote rule) -------------------------
  // Tradovate sends NO aggressor flag, so side comes from the SAME quote's Bid/Offer.
  const lifted = mapper.mapQuote(
    { timestamp: T0, contractId: 1, entries: { Bid: { price: 5850, size: 4 }, Offer: { price: 5850.25, size: 9 }, Trade: { price: 5850.25, size: 3 } } },
    'ES'
  );
  check('print at the offer is classified BUY (offer lifted)', lifted.trades[0]?.side === 'BUY', String(lifted.trades[0]?.side));

  const hit = mapper.mapQuote(
    { timestamp: T1, contractId: 1, entries: { Bid: { price: 5850, size: 4 }, Offer: { price: 5850.25, size: 9 }, Trade: { price: 5850, size: 2 } } },
    'ES'
  );
  check('print at the bid is classified SELL (bid hit)', hit.trades[0]?.side === 'SELL', String(hit.trades[0]?.side));

  // Mid-quote: the quote rule cannot decide, so the tick rule compares to the previous print.
  const uptick = mapper.mapQuote(
    { timestamp: T1, contractId: 1, entries: { Bid: { price: 5850, size: 4 }, Offer: { price: 5850.5, size: 9 }, Trade: { price: 5850.25, size: 1 } } },
    'ES'
  );
  check('mid-quote uptick falls back to the tick rule -> BUY', uptick.trades[0]?.side === 'BUY', String(uptick.trades[0]?.side));

  // --- Honest drop: no rule can decide -------------------------------------
  const undecidable = new TradovateQuoteMapper();
  const first = undecidable.mapQuote(
    { timestamp: T0, contractId: 1, entries: { Trade: { price: 5850.25, size: 1 } } },
    'ES'
  );
  check('undecidable aggressor emits NO trade (never a 50/50 guess)', first.trades.length === 0);
  check('undecidable aggressor is counted', undecidable.counters.droppedUnresolvedSide === 1, String(undecidable.counters.droppedUnresolvedSide));

  // --- Repeated Trade entries are NOT new prints ---------------------------
  const dedupe = new TradovateQuoteMapper();
  const quote = { timestamp: T0, contractId: 1, entries: { Bid: { price: 5850, size: 4 }, Offer: { price: 5850.25, size: 9 }, Trade: { price: 5850.25, size: 3 } } };
  dedupe.mapQuote(quote, 'ES');
  const repeat = dedupe.mapQuote(quote, 'ES');
  check('an unchanged Trade entry is not re-emitted as a print', repeat.trades.length === 0);

  // --- Cumulative volume surplus is REPORTED, not fabricated ---------------
  const coalesced = new TradovateQuoteMapper();
  coalesced.mapQuote(
    { timestamp: T0, contractId: 1, entries: { Offer: { price: 5850.25, size: 9 }, Trade: { price: 5850.25, size: 1 }, TotalTradeVolume: { size: 100 } } },
    'ES'
  );
  coalesced.mapQuote(
    { timestamp: T1, contractId: 1, entries: { Offer: { price: 5850.25, size: 9 }, Trade: { price: 5850.25, size: 2 }, TotalTradeVolume: { size: 110 } } },
    'ES'
  );
  check(
    'vendor-coalesced volume is counted, not invented into prints',
    coalesced.counters.coalescedVolume === 8,
    String(coalesced.counters.coalescedVolume)
  );

  // --- Missing timestamp -> drop -------------------------------------------
  const noTime = new TradovateQuoteMapper();
  const noTs = noTime.mapQuote({ contractId: 1, entries: { Offer: { price: 5850.25, size: 9 }, Trade: { price: 5850.25, size: 1 } } }, 'ES');
  check('a print without a vendor timestamp is dropped', noTs.trades.length === 0);
  check('the drop is counted', noTime.counters.droppedNoTimestamp >= 1, String(noTime.counters.droppedNoTimestamp));

  // --- Best bid/offer deltas only on an actual change ----------------------
  const depthMapper = new TradovateQuoteMapper();
  const withBid = depthMapper.mapQuote({ timestamp: T0, contractId: 1, entries: { Bid: { price: 5850, size: 4 } } }, 'ES');
  check('a new best bid becomes a delta', withBid.depth.length === 1 && withBid.depth[0]?.side === 'bid' && withBid.depth[0]?.price === 5850);
  const sameBid = depthMapper.mapQuote({ timestamp: T1, contractId: 1, entries: { Bid: { price: 5850, size: 4 } } }, 'ES');
  check('an unchanged best bid emits nothing', sameBid.depth.length === 0);
  const newBidSize = depthMapper.mapQuote({ timestamp: T1, contractId: 1, entries: { Bid: { price: 5850, size: 11 } } }, 'ES');
  check('a changed bid size emits a delta', newBidSize.depth.length === 1 && newBidSize.depth[0]?.size === 11);

  // --- DOM frame -> full ladder snapshot -----------------------------------
  const dom = mapper.mapDom(
    {
      contractId: 1,
      timestamp: T0,
      bids: [{ price: 5850, size: 4 }, { price: 5849.75, size: 12 }],
      offers: [{ price: 5850.25, size: 9 }],
    },
    'ES'
  );
  check('DOM maps to a snapshot (the frame IS the whole ladder)', dom?.kind === 'snapshot');
  check('DOM bids preserved in order', dom?.bids.length === 2 && dom?.bids[0]?.[0] === 5850);
  check('DOM offers preserved', dom?.asks.length === 1 && dom?.asks[0]?.[1] === 9);
  check('an empty DOM ladder emits nothing', mapper.mapDom({ contractId: 1, timestamp: T0, bids: [], offers: [] }, 'ES') === null);
}

// ---------------------------------------------------------------------------
// Part D: adapter lifecycle against a scripted socket (no network, no creds)
// ---------------------------------------------------------------------------

interface Sink {
  trades: MarketTrade[];
  depth: MarketDepthEvent[];
  status: FeedStatusEvent[];
  errors: string[];
}

function newSink(): Sink {
  return { trades: [], depth: [], status: [], errors: [] };
}

function handlersFor(sink: Sink): FeedHandlers {
  return {
    onTrade: (trade: MarketTrade) => {
      sink.trades.push(trade);
    },
    onDepth: (event: MarketDepthEvent) => {
      sink.depth.push(event);
    },
    onStatus: (status: FeedStatusEvent) => {
      sink.status.push(status);
    },
    onError: (error: Error) => {
      sink.errors.push(error.message);
    },
  };
}

/**
 * Scripted stand-in for `ws`. Records every outbound frame verbatim so the suite can assert the
 * adapter speaks the vendor's protocol, and lets a test push inbound frames on demand. 'open'
 * fires on the next macrotask, like a socket that has just finished its handshake.
 */
class FakeSocket implements TradovateSocketLike {
  public readonly sent: string[] = [];
  public closed = false;
  public readonly url: string;
  private listeners = new Map<string, ((...args: unknown[]) => void)[]>();

  constructor(url: string) {
    this.url = url;
    // A real SockJS-framed connection delivers the 'o' FRAME as message data (the DOM 'open'
    // event alone carries no payload). TradovateSocket authorizes on `T === 'o'`, so the fake
    // server must send it too — otherwise authorize would legitimately never be sent.
    setTimeout(() => {
      this.emit('open');
      this.emit('message', 'o');
    }, 0);
  }

  public send(data: string): void {
    if (this.closed) throw new Error('send after close');
    this.sent.push(data);
  }

  public close(): void {
    if (this.closed) return;
    this.closed = true;
    this.emit('close');
  }

  public terminate(): void {
    this.closed = true;
  }

  public on(event: string, listener: (...args: unknown[]) => void): void {
    const list = this.listeners.get(event) ?? [];
    list.push(listener);
    this.listeners.set(event, list);
  }

  public removeAllListeners(): void {
    this.listeners.clear();
  }

  /** Push one raw inbound frame, exactly as the vendor would send it. */
  public push(frame: string): void {
    this.emit('message', frame);
  }

  /** Push one 'a' frame carrying a single item. */
  public pushItem(item: { e?: string; d?: Record<string, unknown> | null; i?: number; s?: number }): void {
    this.push(`a${JSON.stringify([item])}`);
  }

  /** Decode an outbound frame into url/id/query/body for assertions. */
  public frameAt(index: number): { url: string; id: number; query: string; body: unknown } {
    const raw = this.sent[index] ?? '';
    const [url, id, query, body] = raw.split('\n');
    return { url, id: Number(id), query, body: body === undefined || body === '' ? undefined : JSON.parse(body) };
  }

  private emit(event: string, ...args: unknown[]): void {
    for (const listener of [...(this.listeners.get(event) ?? [])]) listener(...args);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Poll until the adapter created its socket (it is built a few awaits into connect()). */
async function waitForSocket(sockets: FakeSocket[], timeoutMs = 2000): Promise<FakeSocket> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (sockets.length > 0) return sockets[0]!;
    await sleep(5);
  }
  throw new Error('adapter never created a market-data socket');
}

/** Build an adapter wired to a scripted socket + stubbed REST, then drive it to 'authorized'. */
async function startFakeFeed(sink: Sink, configEnv: NodeJS.ProcessEnv = FULL_ENV, contractId: number | null = 987654) {
  const sockets: FakeSocket[] = [];
  const feed = new TradovateMarketDataFeed('ES', ES, handlersFor(sink), readTradovateConfig(configEnv), {
    socketFactory: (url: string) => {
      const socket = new FakeSocket(url);
      sockets.push(socket);
      return socket;
    },
    authResolver: async () => ({ accessToken: 'tok_test', expirationTime: '2026-01-05T20:00:00.000Z' }),
    contractResolver: async () => contractId,
    heartbeatMs: 40,
  });

  const connecting = feed.connect();
  const socket = await waitForSocket(sockets);
  // The vendor authorizes immediately after 'open'; ack it so connect() can resolve.
  socket.pushItem({ i: 0, s: 200, d: {} });
  await connecting;
  return { feed, socket };
}

/** One quote frame in the vendor's exact 'a'-frame wire form. */
function quoteItem(quote: Record<string, unknown>) {
  return { e: 'md', i: 1, s: 200, d: { quotes: [quote] } };
}

function partD(): Promise<void> {
  console.log('=== Part D: adapter lifecycle (scripted socket) ===');
  return (async () => {
    // --- connect(): socket URL, authorize, then BOTH subscriptions ---------------
    const sink = newSink();
    const { feed, socket } = await startFakeFeed(sink);

    check('connects to the market-data socket URL', socket.url === TRADOVATE_ENDPOINTS.demo.mdWsUrl, socket.url);
    const authorize = socket.frameAt(0);
    check('first frame is authorize', authorize.url === 'authorize');
    check('authorize body is the raw token string', authorize.body === 'tok_test', JSON.stringify(authorize.body));

    const quoteSub = socket.frameAt(1);
    check('subscribes md/subscribequote', quoteSub.url === 'md/subscribequote');
    check(
      'quote subscription carries the continuous symbol',
      JSON.stringify(quoteSub.body) === '{"symbol":"@ES"}',
      JSON.stringify(quoteSub.body)
    );
    const domSub = socket.frameAt(2);
    check('subscribes md/subscribedom', domSub.url === 'md/subscribedom');
    check('both subscriptions use the same symbol', JSON.stringify(domSub.body) === '{"symbol":"@ES"}');

    check('contractId resolved from REST', feed.resolvedContractId === 987654, String(feed.resolvedContractId));
    check('resolvedVendorSymbol is the continuous root', feed.resolvedVendorSymbol === '@ES', feed.resolvedVendorSymbol);
    check('authorized is NOT live (no data validated yet)', feed.isConnected() === false);
    check(
      'status never reports LIVE before real data',
      sink.status.every((s) => s.state !== 'LIVE'),
      sink.status.map((s) => s.state).join(',')
    );
    // --- waitForLive is a REAL-data gate ----------------------------------------
    let waited = false;
    const livePromise = feed.waitForLive(2000).then(() => {
      waited = true;
    });

    // --- A refused subscription is reported verbatim, never faked ---------------
    const sink2 = newSink();
    const refused = await startFakeFeed(sink2);
    refused.socket.pushItem({ i: 1, s: 400, d: { errorText: 'Market Data subscription required' } });
    await sleep(20);
    check(
      'a refused subscription reports UNAVAILABLE with the vendor reason',
      sink2.status.some((s) => s.state === 'UNAVAILABLE' && /Market Data subscription required/.test(s.reason ?? '')),
      sink2.status.map((s) => `${s.state}:${s.reason}`).join(' | ')
    );
    check('a refusal produces zero trades', sink2.trades.length === 0, String(sink2.trades.length));
    await refused.feed.disconnect();

    // --- A real print moves the feed LIVE ---------------------------------------
    socket.pushItem(
      quoteItem({
        timestamp: T0,
        contractId: 987654,
        entries: { Bid: { price: 5850, size: 4 }, Offer: { price: 5850.25, size: 9 }, Trade: { price: 5850.25, size: 3 } },
      })
    );
    await livePromise;
    check('waitForLive resolves only after validated data', waited);
    check('feed is LIVE after a validated print', feed.isConnected() === true);
    check('exactly one print reached the handler', sink.trades.length === 1, String(sink.trades.length));

    const trade = sink.trades[0]!;
    check('price passed through', trade.price === 5850.25, String(trade.price));
    check('size passed through', trade.size === 3, String(trade.size));
    check('aggressor derived as BUY (offer lifted)', trade.side === 'BUY', trade.side);
    check('ts is the vendor timestamp in epoch ms', trade.ts === Date.parse(T0), String(trade.ts));
    // Tradovate publishes no trade id. Inventing one would fabricate a dedupe key, so the
    // adapter must leave it undefined and let the validated event stand on its own.
    check('no fabricated trade id', trade.id === undefined, String(trade.id));
    const liveReason = sink.status[sink.status.length - 1]?.reason ?? '';
    check(
      'the LIVE reason names vendor + contract',
      /tradovate demo/.test(liveReason) && /contract 987654/.test(liveReason),
      liveReason
    );

    // --- DOM frame -> full ladder snapshot --------------------------------------
    socket.pushItem({
      e: 'md',
      i: 2,
      s: 200,
      d: { doms: [{ contractId: 987654, timestamp: T1, bids: [{ price: 5850, size: 4 }], offers: [{ price: 5850.25, size: 9 }] }] },
    });
    await sleep(20);
    const snapshot = sink.depth.find((d) => d.kind === 'snapshot');
    check('a DOM frame becomes a snapshot', snapshot !== undefined);
    check('snapshot bids survive validation', snapshot?.bids.length === 1 && snapshot.bids[0]?.price === 5850);
    check('snapshot offers survive validation', snapshot?.asks.length === 1 && snapshot.asks[0]?.price === 5850.25);
    // --- Heartbeat keeps the vendor socket alive --------------------------------
    await sleep(150);
    const heartbeats = socket.sent.filter((f) => f === TRADOVATE_HEARTBEAT_FRAME).length;
    check('heartbeats are sent as the literal []', heartbeats > 0, `${heartbeats} heartbeat(s)`);

    // --- Contract filter: a foreign contractId must not reach the engines --------
    const beforeForeign = sink.trades.length;
    socket.pushItem(
      quoteItem({
        timestamp: T1,
        contractId: 555555,
        entries: { Offer: { price: 5850.25, size: 9 }, Trade: { price: 5850.25, size: 7 } },
      })
    );
    await sleep(20);
    check('a foreign contractId is ignored', sink.trades.length === beforeForeign, String(sink.trades.length));

    // --- Throttled subscription is replayed with its p-ticket -------------------
    socket.pushItem({ i: 1, s: 200, d: { 'p-ticket': 'ticket_abc', 'p-time': 0.02 } });
    await sleep(120);
    const replay = socket.sent.find((f) => f.includes('ticket_abc'));
    check('a throttled subscription is replayed with its p-ticket', replay !== undefined, replay ?? 'no replay');
    check('the replay repeats the original url', replay?.startsWith('md/subscribequote') === true, replay ?? '');

    // --- disconnect() kills the socket and invalidates the generation -----------
    await feed.disconnect();
    check('the socket is closed on disconnect', socket.closed === true);
    check('isConnected() is false after disconnect', feed.isConnected() === false);

    const afterDisconnect = sink.trades.length;
    socket.pushItem(
      quoteItem({
        timestamp: T1,
        contractId: 987654,
        entries: { Offer: { price: 5850.25, size: 9 }, Trade: { price: 5850.5, size: 1 } },
      })
    );
    await sleep(20);
    check('a late frame after disconnect cannot reach the engines', sink.trades.length === afterDisconnect, String(sink.trades.length));

    // --- A second connect() must not orphan the first socket --------------------
    const sink3 = newSink();
    const sockets3: FakeSocket[] = [];
    const feed3 = new TradovateMarketDataFeed('ES', ES, handlersFor(sink3) as never, readTradovateConfig(FULL_ENV), {
      socketFactory: (url: string) => {
        const sock = new FakeSocket(url);
        sockets3.push(sock);
        return sock;
      },
      authResolver: async () => ({ accessToken: 'tok_test' }),
      contractResolver: async () => 1,
      heartbeatMs: 40,
    });
    const first3 = feed3.connect();
    const socketA = await waitForSocket(sockets3);
    socketA.pushItem({ i: 0, s: 200, d: {} });
    await first3;
    const second3 = feed3.connect();
    await sleep(30);
    sockets3[1]?.pushItem({ i: 0, s: 200, d: {} });
    await second3;
    check('reconnecting closes the previous socket', socketA.closed === true);
    check('a fresh socket is created on reconnect', sockets3.length === 2, String(sockets3.length));
    await feed3.disconnect();
  })();
}

// ---------------------------------------------------------------------------
// Part E: the provider is FAIL-CLOSED — no credentials means no data, never fake
// ---------------------------------------------------------------------------
function partE(): Promise<void> {
  console.log('=== Part E: fail-closed without credentials ===');
  return (async () => {
    const sink = newSink();
    const feed = new TradovateMarketDataFeed('ES', ES, handlersFor(sink) as never, readTradovateConfig({}));
    await feed.connect();
    await sleep(20);

    check('without credentials the state is UNAVAILABLE', feed.isConnected() === false);
    check(
      'the reason names the missing env vars',
      sink.status.some((s) => s.state === 'UNAVAILABLE' && /TRADOVATE_USERNAME/.test(s.reason ?? '')),
      sink.status.map((s) => `${s.state}:${s.reason}`).join(' | ')
    );
    check('zero trades fabricated', sink.trades.length === 0, String(sink.trades.length));
    check('zero depth fabricated', sink.depth.length === 0, String(sink.depth.length));

    let rejected = false;
    const rejectStart = Date.now();
    await feed.waitForLive(5000).catch(() => {
      rejected = true;
    });
    const rejectMs = Date.now() - rejectStart;
    check('waitForLive rejects honestly instead of faking readiness', rejected);
    check(
      'waitForLive fails fast for a permanently dead feed (no 5s stall)',
      rejected && rejectMs < 1000,
      `${rejectMs}ms`
    );

    let terminalMessage = '';
    await feed.waitForLive(5000).catch((err: Error) => {
      terminalMessage = err.message;
    });
    check('the fail-fast rejection carries the real reason', /TRADOVATE_USERNAME/.test(terminalMessage), terminalMessage);
    await feed.disconnect();

    // --- the registry selects the provider from FUTURES_PROVIDER -----------------
    const previousProvider = process.env.FUTURES_PROVIDER;
    process.env.FUTURES_PROVIDER = 'tradovate';
    for (const name of ['TRADOVATE_USERNAME', 'TRADOVATE_PASSWORD', 'TRADOVATE_APP_ID', 'TRADOVATE_APP_VERSION', 'TRADOVATE_CID', 'TRADOVATE_SEC']) {
      delete process.env[name];
    }

    const registrySink = newSink();
    const { feed: registryFeed, provider } = createMarketDataFeed('ES', ES, handlersFor(registrySink) as never);
    check('registry returns the tradovate provider', provider === 'tradovate', provider);
    await registryFeed.connect();
    await sleep(20);
    check('registry-built feed is fail-closed without credentials', registryFeed.isConnected() === false);
    check(
      'registry-built feed fabricated nothing',
      registrySink.trades.length === 0 && registrySink.depth.length === 0,
      `${registrySink.trades.length} trades / ${registrySink.depth.length} depth`
    );
    await registryFeed.disconnect();

    if (previousProvider === undefined) delete process.env.FUTURES_PROVIDER;
    else process.env.FUTURES_PROVIDER = previousProvider;
  })();
}

// ---------------------------------------------------------------------------
// Part F: REAL historical chart bars (md/getchart, EX-10)
// ---------------------------------------------------------------------------
function partF(): Promise<void> {
  console.log('=== Part F: historical chart bars (md/getchart) ===');
  return (async () => {
    const T1 = '2026-01-05T14:30:00.000Z';
    const T2 = '2026-01-05T14:31:00.000Z';

    // --- vendor bar -> HistoricalBar: values pass through VERBATIM --------------
    const mapped = mapChartBar({
      timestamp: T2,
      open: 5850,
      high: 5852,
      low: 5849,
      close: 5851.5,
      upVolume: 120,
      downVolume: 30,
      upTicks: 40,
      downTicks: 9,
      bidVolume: 25,
      offerVolume: 125,
    });
    check('a real chart bar maps to a HistoricalBar', mapped !== null);
    check('bar time is the vendor timestamp in epoch ms', mapped?.time === Date.parse(T2), String(mapped?.time));
    check('volume is the vendor up+down volume', mapped?.volume === 150, String(mapped?.volume));
    check(
      'buyVolume uses the vendor OFFER volume (aggressor split)',
      mapped?.buyVolume === 125,
      String(mapped?.buyVolume)
    );
    check('sellVolume uses the vendor BID volume', mapped?.sellVolume === 25, String(mapped?.sellVolume));
    check('delta is offer-bid, not inferred from the OHLC shape', mapped?.delta === 100, String(mapped?.delta));
    check('OHLC is untouched', mapped?.open === 5850 && mapped?.high === 5852 && mapped?.low === 5849);

    // --- a bar CANNOT yield a per-price split: there is no place to put one -----
    check(
      'the mapped bar has NO per-price levels field (nothing to fabricate)',
      mapped !== null && !('levels' in mapped),
      Object.keys(mapped ?? {}).join(',')
    );

    // --- fallback is still vendor data, never an inference ---------------------
    const fallback = mapChartBar({
      timestamp: T2,
      open: 1,
      high: 2,
      low: 1,
      close: 2,
      upVolume: 10,
      downVolume: 4,
    });
    check(
      'without a bid/offer split aggressor volume stays unknown',
      fallback?.volume === 14 && fallback.buyVolume === undefined && fallback.sellVolume === undefined && fallback.delta === undefined,
      `${fallback?.buyVolume}/${fallback?.sellVolume}`
    );

    // --- refuse rather than repair --------------------------------------------
    const bad = (over: Record<string, unknown>) =>
      mapChartBar({
        timestamp: T2,
        open: 100,
        high: 102,
        low: 99,
        close: 101,
        upVolume: 5,
        downVolume: 5,
        ...over,
      } as never);
    check('a bar with no timestamp is dropped', bad({ timestamp: undefined }) === null);
    check('a bar with an unparseable timestamp is dropped', bad({ timestamp: 'not-a-date' }) === null);
    check('a bar missing a price leg is dropped', bad({ low: undefined }) === null);
    check('a bar with high<low is refused, not repaired', bad({ high: 90 }) === null);
    check('a bar with zero prices is dropped', bad({ open: 0 }) === null);
    check('a bar with no volume at all is dropped', bad({ upVolume: undefined, downVolume: undefined }) === null);
    check(
      'a bar with only half a volume split is dropped (mixing halves would invent a number)',
      bad({ downVolume: undefined }) === null
    );
    check('a reported zero-volume bar is preserved', bad({ upVolume: 0, downVolume: 0 })?.volume === 0);
    check('open outside high/low is refused', bad({ open: 200 }) === null);
    check('close outside high/low is refused', bad({ close: 98 }) === null);

    // --- ordering + dedupe ----------------------------------------------------
    const bar = (minute: number, close = 100) => ({
      time: Date.parse(`2026-01-05T14:${String(minute).padStart(2, '0')}:00.000Z`),
      open: close,
      high: close,
      low: close,
      close,
      volume: 10,
      buyVolume: 5,
      sellVolume: 5,
      delta: 0,
    });
    const ordered = normalizeBars([bar(3), bar(1), bar(2), bar(2, 99)]);
    check('bars are sorted ascending by time', ordered.length === 3 && ordered[0]!.time < ordered[1]!.time);
    const resent = ordered.find((b) => b.time === bar(2).time);
    check('a resent bar replaces the earlier one for the same time', resent?.close === 99, String(resent?.close));

    // --- the request matches EX-10 verbatim, and the fetch is CANCELLED ---------
    const sockets: FakeSocket[] = [];
    const pending = fetchTradovateHistoryBars('@ES', readTradovateConfig(FULL_ENV), {
      authResolver: async () => ({ accessToken: 'tok_test' }),
      socketFactory: (url: string) => {
        const sock = new FakeSocket(url);
        sockets.push(sock);
        return sock;
      },
      timeoutMs: 2000,
      idleMs: 40,
      barMinutes: 1,
      elements: 300,
    });

    const chartSocket = await waitForSocket(sockets);
    check('history uses the vendor market-data socket', chartSocket.url === TRADOVATE_ENDPOINTS.demo.mdWsUrl);
    chartSocket.pushItem({ i: 0, s: 200, d: {} }); // authorize ack
    await sleep(20);

    const req = chartSocket.frameAt(1);
    check('requests md/getchart', req.url === 'md/getchart', req.url);
    const body = req.body as Record<string, never>;
    const desc = (body?.chartDescription ?? {}) as Record<string, unknown>;
    const range = (body?.timeRange ?? {}) as Record<string, unknown>;
    check('the request carries the vendor symbol', body?.symbol === '@ES', JSON.stringify(body?.symbol));
    check('uses MinuteBar', desc.underlyingType === 'MinuteBar', String(desc.underlyingType));
    check('uses the requested element size', desc.elementSize === 1, String(desc.elementSize));
    check('elementSizeUnit is UnderlyingUnits', desc.elementSizeUnit === 'UnderlyingUnits');
    check(
      'plain OHLC requested without a histogram',
      desc.withHistogram === false,
      String(desc.withHistogram)
    );
    check('the time range asks for the requested element count', range.asMuchAsElements === 300);

    // --- stream real bars (out of order), then end of history ------------------
    // Correlated reply is separate from the md event (as on the real wire).
    chartSocket.pushItem({ i: req.id, s: 200, d: { historicalId: 4241, realtimeId: 4242 } });
    chartSocket.pushItem({
      e: 'md',
      d: {
        charts: [
          {
            id: 4241,
            bars: [
              { timestamp: T2, open: 5850, high: 5852, low: 5849, close: 5851, upVolume: 120, downVolume: 30, bidVolume: 25, offerVolume: 125 },
              { timestamp: T1, open: 5848, high: 5851, low: 5847, close: 5850, upVolume: 90, downVolume: 60, bidVolume: 50, offerVolume: 100 },
            ],
          },
        ],
      },
    });
    chartSocket.pushItem({ e: 'md', d: { charts: [{ id: 4241, eoh: true, bars: [] }] } });

    const historical = await pending;
    check('end of history resolves the fetch', historical.length === 2, String(historical.length));
    check('bars arrive sorted oldest -> newest', historical[0]?.time === Date.parse(T1), String(historical[0]?.time));
    check('real bar volume survives the round trip', historical[0]?.volume === 150, String(historical[0]?.volume));
    check(
      'the vendor aggressor split survives the round trip',
      historical[0]?.buyVolume === 100 && historical[0]?.sellVolume === 50,
      `${historical[0]?.buyVolume}/${historical[0]?.sellVolume}`
    );

    const cancelFrame = chartSocket.sent.find((f) => f.startsWith('md/cancelChart'));
    check('the chart subscription is cancelled', cancelFrame !== undefined, cancelFrame ?? 'no cancelChart');
    check('the cancel carries the vendor realtimeId', cancelFrame?.includes('4242') === true, cancelFrame ?? '');
    check('the history socket is closed', chartSocket.closed === true);

    // --- a refusal yields no bars, never invented ones -------------------------
    const refusedSockets: FakeSocket[] = [];
    const refused = fetchTradovateHistoryBars('@ES', readTradovateConfig(FULL_ENV), {
      authResolver: async () => ({ accessToken: 'tok_test' }),
      socketFactory: (url: string) => {
        const sock = new FakeSocket(url);
        refusedSockets.push(sock);
        return sock;
      },
      timeoutMs: 2000,
      idleMs: 40,
    });
    const refusedSocket = await waitForSocket(refusedSockets);
    refusedSocket.pushItem({ i: 0, s: 200, d: {} });
    await sleep(20);
    refusedSocket.pushItem({ i: refusedSocket.frameAt(1).id, s: 401, d: { errorText: 'Market Data subscription required' } });
    const refusedBars = await refused;
    check('a refused chart request returns zero bars', refusedBars.length === 0, String(refusedBars.length));

    // --- no credentials: no socket, no bars -----------------------------------
    let socketAttempted = false;
    const noCreds = await fetchTradovateHistoryBars('@ES', readTradovateConfig({}), {
      socketFactory: () => {
        socketAttempted = true;
        throw new Error('history must not open a socket without credentials');
      },
    });
    check('no credentials means no bars', noCreds.length === 0, String(noCreds.length));
    check('and no socket is opened at all', socketAttempted === false);

    // --- nothing arrives: give up on the timeout, fabricate nothing ------------
    const emptySockets: FakeSocket[] = [];
    const started = Date.now();
    const empty = await fetchTradovateHistoryBars('@ES', readTradovateConfig(FULL_ENV), {
      authResolver: async () => ({ accessToken: 'tok_test' }),
      socketFactory: (url: string) => {
        const sock = new FakeSocket(url);
        emptySockets.push(sock);
        return sock;
      },
      timeoutMs: 150,
      idleMs: 40,
    });
    check('an unresponsive chart request resolves empty', empty.length === 0, String(empty.length));
    check('and it gives up on its own timeout', Date.now() - started < 1500, `${Date.now() - started}ms`);
  })();
}

async function partG(): Promise<void> {
  console.log('=== Part G: history cancellation, correlation and chart rendering boundary ===');
  const config = readTradovateConfig(FULL_ENV);
  const time = Date.parse('2026-01-05T14:30:00Z');
  const raw = { timestamp: new Date(time).toISOString(), open: 100, high: 101, low: 99, close: 100,
    upVolume: 5, downVolume: 5 };
  const setup = async (extra: Parameters<typeof fetchTradovateHistoryBars>[2] = {}) => {
    const sockets: FakeSocket[] = [];
    const pending = fetchTradovateHistoryBars('@ES', config, {
      authResolver: async () => ({ accessToken: 'test' }),
      socketFactory: (url) => { const s = new FakeSocket(url); sockets.push(s); return s; },
      timeoutMs: 1000, idleMs: 30, beforeTime: time + 300000, barMinutes: 5,
      ...extra,
    });
    const socket = await waitForSocket(sockets);
    socket.pushItem({ i: 0, s: 200, d: {} });
    const request = socket.frameAt(1);
    socket.pushItem({ i: request.id, s: 200, d: { historicalId: 101, realtimeId: 102 } });
    return { socket, pending, request };
  };

  const route = await setup();
  const body = route.request.body as { chartDescription: { elementSize: number }; timeRange: { closestTimestamp: string } };
  check('5m history requests five-minute vendor bars', body.chartDescription.elementSize === 5);
  check('history request has a fixed before-live boundary', Date.parse(body.timeRange.closestTimestamp) === time + 300000 - 1);
  route.socket.pushItem({ e: 'md', d: { charts: [{ id: 999, eoh: true, bars: [raw] }] } });
  check('a foreign eoh cannot close the history request', !route.socket.closed);
  route.socket.push('a[null,3,"bad",{"e":"md","d":{"charts":[null,{}, {"id":101,"bars":"bad"}]}}]');
  route.socket.pushItem({ e: 'md', d: { charts: [{ id: 101, bars: [null, raw,
    { ...raw, timestamp: new Date(time + 60000).toISOString() }] }] } });
  route.socket.pushItem({ e: 'md', d: { charts: [{ id: 101, eoh: true }] } });
  const routed = await route.pending;
  check('only matched, valid, completed bars survive', routed.length === 1 && routed[0].time === time);

  const idle = await setup();
  idle.socket.pushItem({ e: 'md', d: { charts: [{ id: 101, bars: [raw, { ...raw, close: 101 }] }] } });
  const partial = await idle.pending;
  check('idle fallback retains actual bars and newest revisions', partial.length === 1 && partial[0].close === 101);
  check('idle fallback closes the socket', idle.socket.closed);

  const controller = new AbortController();
  const cancelled = await setup({ signal: controller.signal });
  cancelled.socket.pushItem({ e: 'md', d: { charts: [{ id: 101, bars: [raw] }] } });
  controller.abort();
  check('switch cancellation discards old history even after a batch', (await cancelled.pending).length === 0);
  check('switch cancellation releases the socket', cancelled.socket.closed);
  cancelled.socket.pushItem({ e: 'md', d: { charts: [{ id: 101, eoh: true, bars: [raw] }] } });

  const failure = await setup();
  failure.socket.pushItem({ i: failure.request.id, s: 200, d: { errorText: 'not entitled' } });
  check('HTTP 200 with an errorText is a refusal', (await failure.pending).length === 0 && failure.socket.closed);
  const throttled = await setup();
  throttled.socket.pushItem({ i: throttled.request.id, s: 200, d: { 'p-ticket': 'wait', 'p-time': 60 } });
  check('throttled history fails closed without an early retry', (await throttled.pending).length === 0);

  let attempts = 0;
  const start = Date.now();
  const hung = await fetchTradovateHistoryBars('@ES', config, {
    authResolver: () => new Promise(() => {}), timeoutMs: 30,
    socketFactory: () => { attempts++; throw new Error('unexpected socket'); },
  });
  check('whole-fetch timeout also bounds authentication', hung.length === 0 && attempts === 0 && Date.now() - start < 500);
  const authCancel = new AbortController();
  const waiting = fetchTradovateHistoryBars('@ES', config, {
    authResolver: () => new Promise(() => {}), timeoutMs: 5000, signal: authCancel.signal,
  });
  authCancel.abort();
  check('authentication is cancellable on a chart switch', (await waiting).length === 0);

  const noSocket = await fetchTradovateHistoryBars('@ES', config, {
    authResolver: async () => ({ accessToken: 'test' }),
    socketFactory: () => { throw new Error('socket unavailable'); }, timeoutMs: 100,
  });
  check('socket factory failure resolves empty', noSocket.length === 0);
  const early = new AbortController();
  early.abort();
  const preCancelled = await fetchTradovateHistoryBars('@ES', config, {
    signal: early.signal, authResolver: async () => { attempts++; return {}; },
  });
  check('pre-cancelled fetch makes no auth or socket request', preCancelled.length === 0 && attempts === 0);

  const history = [{ time: 3 }, { time: 1 }, { time: 2 }, { time: 1 }];
  const visible = historyBeforeLive(history, [{ time: 3 }, { time: 2 }]);
  check('renderer excludes overlapping/future history by timestamp', visible.length === 1 && visible[0].time === 1);
  const historyOnly = historyBeforeLive(history, []);
  check('history-only chart sorts and deduplicates without fake live bars', historyOnly.length === 3 && historyOnly[0].time === 1);
}

async function main(): Promise<void> {
  partA();
  partB();
  partC();
  await partD();
  await partE();
  await partF();
  await partG();

  console.log('');
  if (failures > 0) {
    console.error(`TRADOVATE PROVIDER TESTS FAILED: ${failures} check(s)`);
    process.exit(1);
  }
  console.log('TRADOVATE PROVIDER TESTS PASSED');
}

// A pending promise must fail loudly, not silently exit 0 when the event loop drains.
const watchdog = setTimeout(() => {
  console.error('verify_tradovate timed out before completing all parts');
  process.exit(1);
}, 15000);
void main().then(() => clearTimeout(watchdog)).catch((err) => {
  console.error('verify_tradovate crashed:', err);
  process.exit(1);
});
