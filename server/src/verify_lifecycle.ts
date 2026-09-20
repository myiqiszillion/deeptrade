/**
 * Deterministic lifecycle regression suite for the real market-data feed layer.
 *
 * Runs fully OFFLINE: the Binance adapter is driven through its `legacyFactory` seam (generation
 * guard cases) and the legacy feed through its `socketFactory` seam (teardown/reconnect cases).
 * The scripted events used here exist ONLY to prove lifecycle isolation — they are never claimed
 * as a LIVE feed, never touch the P0 integration path, and never reach the orderflow engines.
 * A real LIVE state still requires a validated event from the real vendor (see verify_p0 TEST 10).
 */
import WebSocket from 'ws';
import { FUTURES_INSTRUMENTS } from './futuresConfig.js';
import { BinanceFuturesFeed, DataFeedCallbacks, SocketFactory } from './dataFeeds/binanceFeed.js';
import { BinanceMarketDataFeed, LegacyFeedFactory, LegacyFeedLike } from './marketData/binanceAdapter.js';
import { FeedStatusEvent, MarketDepthEvent, MarketTrade } from './marketData/types.js';

let passed = 0;
let failed = 0;

function check(label: string, ok: boolean, detail = ''): void {
  if (ok) {
    passed++;
    console.log(`  PASS  ${label}${detail ? ` — ${detail}` : ''}`);
  } else {
    failed++;
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`);
  }
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** Settle a promise without hanging the suite, so a readiness race fails instead of blocking. */
async function settle(promise: Promise<unknown>, ms: number): Promise<'resolved' | 'rejected' | 'pending'> {
  return Promise.race([
    promise.then(
      () => 'resolved' as const,
      () => 'rejected' as const
    ),
    sleep(ms).then(() => 'pending' as const),
  ]);
}

/** Legacy-feed stub used by the generation-guard cases (no sockets, no network). */
class ScriptedLegacyFeed implements LegacyFeedLike {
  public starts = 0;
  public stops = 0;
  constructor(private readonly callbacks: DataFeedCallbacks) {}

  public start(): void {
    this.starts++;
  }

  public async stop(): Promise<void> {
    this.stops++;
  }

  public trade(price: number, size: number): void {
    this.callbacks.onTick({
      id: `scripted_${price}_${size}`,
      timestamp: Date.now(),
      price,
      size,
      side: 'buy',
      isBuyerMaker: false,
    });
  }

  public depthSnapshot(bid = 80000.1, ask = 80000.2): void {
    this.callbacks.onOrderbookSnapshot([[bid, 1]], [[ask, 1]], 1);
  }
}

/** Scripted ws socket: lets a test settle, drop and revive sockets synchronously. */
class ScriptedSocket {
  public readyState: number = WebSocket.CONNECTING;
  public terminates = 0;
  public closes = 0;
  private listeners = new Map<string, ((...args: unknown[]) => void)[]>();

  constructor(public readonly url: string) {}

  public on(event: string, listener: (...args: unknown[]) => void): this {
    const list = this.listeners.get(event) ?? [];
    list.push(listener);
    this.listeners.set(event, list);
    return this;
  }

  public once(event: string, listener: (...args: unknown[]) => void): this {
    return this.on(event, listener);
  }

  public removeAllListeners(): this {
    this.listeners.clear();
    return this;
  }

  public emit(event: string, ...args: unknown[]): void {
    for (const listener of [...(this.listeners.get(event) ?? [])]) listener(...args);
  }

  public open(): void {
    this.readyState = WebSocket.OPEN;
    this.emit('open');
  }

  public message(payload: unknown): void {
    this.emit('message', Buffer.from(JSON.stringify(payload)));
  }

  /** Unexpected drop: emits close while the feed is still running. */
  public drop(): void {
    this.readyState = WebSocket.CLOSED;
    this.emit('close');
  }

  public terminate(): void {
    this.terminates++;
    this.drop();
  }

  public close(): void {
    this.closes++;
    this.drop();
  }
}

/** Records every socket a feed opens, so lifecycle balance is observable. */
class ScriptedSockets {
  public readonly created: ScriptedSocket[] = [];
  public readonly factory: SocketFactory = (url) => {
    const socket = new ScriptedSocket(url);
    this.created.push(socket);
    return socket as unknown as WebSocket;
  };

  public get tradeSockets(): ScriptedSocket[] {
    return this.created.filter((s) => s.url.includes('aggTrade'));
  }

  public get depthSockets(): ScriptedSocket[] {
    return this.created.filter((s) => s.url.includes('depth20'));
  }

  public get trade(): ScriptedSocket {
    return this.tradeSockets[this.tradeSockets.length - 1];
  }

  public get depth(): ScriptedSocket {
    return this.depthSockets[this.depthSockets.length - 1];
  }
}

interface Recorder {
  trades: MarketTrade[];
  depths: MarketDepthEvent[];
  statuses: FeedStatusEvent[];
  errors: Error[];
}

function recorder(): Recorder {
  return { trades: [], depths: [], statuses: [], errors: [] };
}

function handlersFor(rec: Recorder) {
  return {
    onTrade: (trade: MarketTrade) => rec.trades.push(trade),
    onDepth: (event: MarketDepthEvent) => rec.depths.push(event),
    onStatus: (status: FeedStatusEvent) => rec.statuses.push(status),
    onError: (error: Error) => rec.errors.push(error),
  };
}

/** Adapter over the scripted legacy feed (generation-guard cases). */
function scriptedAdapter() {
  const rec = recorder();
  const legacyFeeds: ScriptedLegacyFeed[] = [];
  const factory: LegacyFeedFactory = (_symbol, callbacks) => {
    const feed = new ScriptedLegacyFeed(callbacks);
    legacyFeeds.push(feed);
    return feed;
  };
  const feed = new BinanceMarketDataFeed('BTCUSDT', FUTURES_INSTRUMENTS.BTCUSDT, handlersFor(rec), factory);
  return { feed, legacyFeeds, ...rec };
}

/** Adapter over the real legacy feed with scripted sockets (teardown/reconnect cases). */
function socketAdapter() {
  const rec = recorder();
  const sockets = new ScriptedSockets();
  const feed = new BinanceMarketDataFeed(
    'BTCUSDT',
    FUTURES_INSTRUMENTS.BTCUSDT,
    handlersFor(rec),
    (symbol, callbacks) => new BinanceFuturesFeed(symbol, callbacks, sockets.factory)
  );
  return { feed, sockets, ...rec };
}

function aggTrade(price: number, size: number): unknown {
  return { e: 'aggTrade', E: Date.now(), s: 'BTCUSDT', a: '1', p: String(price), q: String(size), T: Date.now(), m: false };
}

function depthMessage(price = 80000.1): unknown {
  return { bids: [[String(price), '1.5']], asks: [[String(price + 0.1), '2']], lastUpdateId: 42 };
}

async function runVerifyLifecycle(): Promise<void> {
  console.log('======================================================');
  console.log('🧪 DEEPCHART FEED LIFECYCLE REGRESSION SUITE (offline)');
  console.log('======================================================\n');

  // Case A — rapid stop/start: a superseded session cannot emit into the new one
  console.log('--- Case A: rapid stop/start (stale generation isolation) ---');
  {
    const h = scriptedAdapter();
    await h.feed.connect();
    const first = h.legacyFeeds[0];
    first.trade(80000, 1);
    check('A1 a session reaches LIVE from its own validated event', h.feed.isConnected() && h.trades.length === 1);

    await h.feed.disconnect();
    check('A2 teardown invalidates the session (not LIVE)', !h.feed.isConnected(), `last=${h.statuses[h.statuses.length - 1]?.state}`);

    await h.feed.connect();
    const second = h.legacyFeeds[1];
    check('A3 the fresh session is not LIVE before real data', !h.feed.isConnected());

    const tradesBefore = h.trades.length;
    const depthsBefore = h.depths.length;
    const statusesBefore = h.statuses.length;
    first.trade(81000, 5); // stale trade from the dead session
    first.depthSnapshot(); // stale depth from the dead session
    check('A4 stale trade/depth from the old session are dropped', h.trades.length === tradesBefore && h.depths.length === depthsBefore);
    check('A5 a stale session cannot publish status', h.statuses.length === statusesBefore && !h.feed.isConnected());

    second.trade(80500, 2);
    check('A6 the new session reaches LIVE from its own event', h.feed.isConnected() && h.trades[h.trades.length - 1]?.price === 80500);
  }

  // Case B/C/D — stale trade, depth and status cannot clobber the active session
  console.log('\n--- Case B/C/D: stale trade, depth and status vs the active session ---');
  {
    const h = scriptedAdapter();
    await h.feed.connect();
    const stale = h.legacyFeeds[0];
    await h.feed.disconnect();
    await h.feed.connect();
    const active = h.legacyFeeds[1];
    active.trade(80010, 1);
    const tradesAfterLive = h.trades.length;
    const statusesAfterLive = h.statuses.length;

    stale.trade(70000, 9);
    check('B1 stale trade never reaches the engines', h.trades.length === tradesAfterLive && !h.trades.some((t) => t.price === 70000));

    stale.depthSnapshot(70000.1, 70000.2);
    check('C1 stale depth never reaches the L2 handlers', !h.depths.some((d) => d.kind === 'snapshot' && d.bids.some((l) => l.price === 70000.1)));

    check(
      'D1 stale generation cannot flip the active status',
      h.statuses.length === statusesAfterLive && h.statuses[h.statuses.length - 1]?.state === 'LIVE',
      `last=${h.statuses[h.statuses.length - 1]?.state}`
    );
  }

  // Cross-instance contract enforced by index.ts's feed-session token.
  {
    const superseded = scriptedAdapter();
    const active = scriptedAdapter();
    await superseded.feed.connect();
    superseded.legacyFeeds[0].trade(80000, 1);
    await active.feed.connect();
    active.legacyFeeds[0].trade(80010, 1);
    const statusesBefore = active.statuses.length;
    await superseded.feed.disconnect();
    check(
      'D2 teardown of a superseded adapter cannot publish into the active one',
      active.statuses.length === statusesBefore && active.feed.isConnected()
    );
  }

  // Case E — socket lifecycle through the real legacy feed (scripted sockets)
  console.log('\n--- Case E: teardown and reconnect (scripted sockets, no network) ---');
  {
    const h = socketAdapter();
    await h.feed.connect();
    h.sockets.trade.open();
    h.sockets.depth.open();
    check('E1 socket OPEN alone is not LIVE', !h.feed.isConnected(), `last=${h.statuses[h.statuses.length - 1]?.state}`);

    h.sockets.trade.message(aggTrade(80000, 1));
    check('E2 a validated real event is what reaches LIVE', h.feed.isConnected());
    h.sockets.depth.message(depthMessage());
    check('E3 real depth reaches the L2 handlers', h.depths.length === 1);

    h.sockets.trade.drop();
    const beforeReconnect = h.sockets.tradeSockets.length;
    await sleep(3300);
    check(
      'E4 an unexpected drop still reconnects (reconnect preserved)',
      h.sockets.tradeSockets.length === beforeReconnect + 1,
      `trade sockets=${h.sockets.tradeSockets.length}`
    );

    h.sockets.trade.drop(); // schedules one more reconnect for the feed we are about to stop
    const createdBeforeStop = h.sockets.tradeSockets.length;
    const teardownStart = Date.now();
    await h.feed.disconnect();
    const teardownMs = Date.now() - teardownStart;
    check('E5 teardown settles immediately (close watcher armed before terminate/close)', teardownMs < 800, `${teardownMs}ms`);
    await h.feed.disconnect();
    check('E6 disconnect is safe to call twice', !h.feed.isConnected());

    await sleep(3300);
    check(
      'E7 a stopped feed is never resurrected by a pending reconnect',
      h.sockets.tradeSockets.length === createdBeforeStop,
      `trade sockets=${h.sockets.tradeSockets.length}`
    );
    check('E8 every socket the feed created is closed', h.sockets.created.every((s) => s.readyState === WebSocket.CLOSED));
  }

  // Case F — waitForLive races and honest readiness
  console.log('\n--- Case F: waitForLive races (no lost wakeup, no faked readiness) ---');
  {
    const already = scriptedAdapter();
    await already.feed.connect();
    already.legacyFeeds[0].trade(80000, 1); // LIVE happens BEFORE the waiter registers
    const first = await settle(already.feed.waitForLive(300), 150);
    check('F1 waitForLive resolves when LIVE was already reached', first === 'resolved', `outcome=${first}`);

    const waiting = scriptedAdapter();
    await waiting.feed.connect();
    const awaiting = waiting.feed.waitForLive(1500); // waiter registers BEFORE the event
    waiting.legacyFeeds[0].trade(80010, 1);
    const second = await settle(awaiting, 400);
    check('F2 waitForLive resolves on the first validated event', second === 'resolved', `outcome=${second}`);

    const silent = scriptedAdapter();
    await silent.feed.connect();
    const third = await settle(silent.feed.waitForLive(150), 600);
    check('F3 waitForLive rejects honestly when no real data arrives', third === 'rejected', `outcome=${third}`);
    check('F4 no real data means not LIVE', !silent.feed.isConnected());

    const invalid = scriptedAdapter();
    await invalid.feed.connect();
    invalid.legacyFeeds[0].trade(0, 1); // price must be > 0
    invalid.legacyFeeds[0].trade(80000, 0); // size must be > 0
    check('F5 invalid events never reach LIVE', !invalid.feed.isConnected() && invalid.trades.length === 0);
    const fourth = await settle(invalid.feed.waitForLive(150), 600);
    check('F6 invalid events cannot satisfy waitForLive', fourth === 'rejected', `outcome=${fourth}`);
  }

  console.log('\n======================================================');
  if (failed === 0) {
    console.log(`🎉 ALL ${passed} LIFECYCLE CHECKS PASSED`);
  } else {
    console.log(`❌ ${failed} OF ${passed + failed} LIFECYCLE CHECKS FAILED`);
  }
  console.log('======================================================\n');
}

runVerifyLifecycle()
  .then(() => {
    // Let the console flush before tearing the event loop down.
    setTimeout(() => process.exit(failed === 0 ? 0 : 1), 250);
  })
  .catch((err) => {
    console.error('\n❌ LIFECYCLE SUITE FAILED:', err);
    process.exit(1);
  });


