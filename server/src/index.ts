import { createServer, IncomingMessage, ServerResponse } from 'http';
import { readFile } from 'fs/promises';
import { extname, resolve, sep } from 'path';
import { fileURLToPath } from 'url';
import { WebSocket, WebSocketServer } from 'ws';
import { BacktestReplayEngine } from './backtestEngine.js';
import { DataFeedCallbacks } from './dataFeeds/binanceFeed.js';
import { FootprintEngine } from './footprintEngine.js';
import { FUTURES_INSTRUMENTS, FuturesInstrument } from './futuresConfig.js';
import { GEXEngine } from './gexEngine.js';
import { CboeOptionsProvider } from './dataFeeds/cboeOptionsFeed.js';
import { fetchBinanceAggTrades } from './dataFeeds/historyFeed.js';
import { createMarketDataFeed } from './marketData/registry.js';
import { resolveVendorSymbol } from './marketData/tradovateAdapter.js';
import { readTradovateConfig } from './marketData/tradovateConfig.js';
import { fetchTradovateHistoryBars } from './marketData/tradovateHistory.js';
import { FeedStatusEvent, MarketDataFeed, MarketDepthEvent, MarketTrade } from './marketData/types.js';
import { OrderbookManager } from './orderbook.js';
import { ProfileEngine } from './profileEngine.js';
import { MAX_SESSIONS, TradingSession } from './session.js';
import { TapeEngine } from './tapeEngine.js';
import {
  HistoricalBar,
  JournalTrade,
  OrderbookSnapshot,
  RestingOrder,
  Tick,
  WSClientMessage,
  WSServerMessage,
} from './types.js';
import { VWAPEngine } from './vwapEngine.js';

const PORT = parseInt(process.env.PORT || '8080', 10);
// Default to the instrument that actually has a real, key-less feed. Futures can be added
// by plugging a licensed vendor — until then they report "feed unavailable" instead of
// showing fabricated data.
let currentSymbol = 'BTCUSDT';
let currentInstrument: FuturesInstrument = FUTURES_INSTRUMENTS.BTCUSDT;

// Deep-trade (whale) notional threshold scales with the instrument so that a single
// 1-lot ES trade (~$292k notional) is not flagged as a whale.
const WHALE_LOTS_EQUIVALENT = 10;
const CRYPTO_WHALE_USD = 50000;

function computeDeepTradeThresholdUsd(): number {
  if (currentInstrument.category === 'CRYPTO') return CRYPTO_WHALE_USD;
  return Math.round(currentInstrument.pointValue * currentInstrument.basePrice * WHALE_LOTS_EQUIVALENT);
}

let restingOrders: RestingOrder[] = [];
let pendingAutoFlatten = false;
let sessionDate = new Date().toISOString().slice(0, 10);
const round2 = (n: number) => Math.round(n * 100) / 100;
// Per-connection trading state: markets are global, accounts are not.
const sessions = new Map<WebSocket, TradingSession>();

type HistorySource = 'NONE' | 'REAL_TICKS' | 'REAL_BARS';
let historySource: HistorySource = 'NONE';
/**
 * REAL vendor bars from before the live session. Bar aggregates only — they are shown as plain
 * candles and are NEVER expanded into synthetic ticks, so they never enter the orderflow engines.
 */
let historyBars: HistoricalBar[] = [];
let historyRequest = new AbortController();
let historyBoundary = Date.now();

function resetHistory(): void {
  historyRequest.abort();
  historyRequest = new AbortController();
  historyBoundary = Date.now();
  historyBars = [];
  historySource = 'NONE';
}
let lastOrderbookUpdate = 0;
let lastBarUpdate = 0;
let lastSpeedOfTapeUpdate = 0;

// Supported footprint bar durations; the client picks one via SUBSCRIBE.timeframe.
const TIMEFRAMES: Record<string, number> = {
  '1s': 1000,
  '5s': 5000,
  '15s': 15000,
  '1m': 60000,
  '5m': 300000,
};
let currentTimeframe = '1m';

// Last traded price per instrument so equity can value positions left open on other symbols.
const lastPriceBySymbol = new Map<string, number>();
let cachedBook: OrderbookSnapshot | null = null;
let cachedBookTime = 0;

console.log(`[DeepChart Server - Prop Firm Edition] Starting on port ${PORT}...`);

// Initialize Engines
let orderbook = new OrderbookManager(50);
let footprint = new FootprintEngine(currentInstrument.tickSize, 60 * 1000, 3.0, 1.0);
let profile = new ProfileEngine(currentInstrument.tickSize);
let vwap = new VWAPEngine();
let tape = new TapeEngine(computeDeepTradeThresholdUsd(), 15.0);
const backtest = new BacktestReplayEngine();
const gex = new GEXEngine();
const cboe = new CboeOptionsProvider();

function getBook(): OrderbookSnapshot {
  const now = Date.now();
  if (!cachedBook || now - cachedBookTime > 5) {
    cachedBook = orderbook.getSnapshot();
    cachedBookTime = now;
  }
  return cachedBook;
}

function broadcastOpenOrders(session: TradingSession) {
  session.send({
    type: 'OPEN_ORDERS',
    symbol: currentSymbol,
    orders: session.restingOrders.filter((o) => o.symbol === currentSymbol),
  });
}

function clearRestingOrders(session: TradingSession, reason: string) {
  if (session.restingOrders.length === 0) return;
  console.log(`[Orders][${session.id}] Cleared ${session.restingOrders.length} resting order(s): ${reason}`);
  session.restingOrders = [];
  broadcastOpenOrders(session);
}

function settleClosedTrades(session: TradingSession, exitPrice: number): JournalTrade[] {
  const closed = session.journal.closeAllTrades(currentSymbol, exitPrice);
  for (const c of closed) {
    session.propRisk.recordClosedTrade(c.pnl ?? 0);
    session.send({ type: 'JOURNAL_UPDATE', trade: c });
  }
  return closed;
}

/**
 * Close every open trade regardless of instrument (account reset). Positions left open on
 * other symbols are valued at their last seen price, falling back to the supplied price.
 */
function flattenEveryOpenTrade(session: TradingSession, fallbackPrice: number): JournalTrade[] {
  const closed: JournalTrade[] = [];
  for (const t of session.journal.getTrades()) {
    if (t.status !== 'OPEN') continue;
    const exitPrice = lastPriceBySymbol.get(t.symbol) ?? fallbackPrice;
    const c = session.journal.closeTrade(t.id, exitPrice);
    if (c) closed.push(c);
  }
  for (const c of closed) {
    session.propRisk.recordClosedTrade(c.pnl ?? 0);
    session.send({ type: 'JOURNAL_UPDATE', trade: c });
  }
  return closed;
}

/** Create a session and wire the callbacks that used to live on the global engines. */
function createSession(socket: WebSocket): TradingSession {
  const session = new TradingSession(socket);
  session.setPointValue(currentInstrument.pointValue);

  session.propRisk.setCallback((breachType, message) => {
    console.log(`[Prop Alert][${session.id}] ${breachType}: ${message}`);
    // Handled on the next tick so we never re-enter propRisk.recalculate() while it runs.
    session.pendingAutoFlatten = true;
    clearRestingOrders(session, 'prop breach');
    session.send({ type: 'PROP_BREACH_ALERT', breachType, message });
  });

  session.copier.setCallback((slaveId, symbol, size, price, latencyMs) => {
    session.send({ type: 'TRADE_COPIED', slaveId, symbol, size, price, latencyMs });
  });

  return session;
}

// Market-data feed state (provider-agnostic; the vendor is chosen in marketData/registry.ts).
let activeFeed: MarketDataFeed | null = null;
/** Feed-session token: only the newest session's adapter may publish status or market events. */
let activeFeedToken = 0;
let activeProvider = 'none';
let feedStatus: 'UNAVAILABLE' | 'LIVE' = 'UNAVAILABLE';
let feedReason: string | undefined = 'no feed connected yet';
let lastTradeTs = 0;
let lastDepthTs = 0;

// Setup HTTP + WebSocket server on ONE port so a free host only needs to expose 8080:
// the built client is served as static files, /healthz reports status, and the WS upgrade
// happens on the same listener.
const HOST = process.env.HOST || '127.0.0.1';
const CLIENT_DIST = process.env.CLIENT_DIST || fileURLToPath(new URL('../../client/dist', import.meta.url));
const MAX_PAYLOAD_BYTES = parseInt(process.env.MAX_PAYLOAD_BYTES || '65536', 10);

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.map': 'application/json; charset=utf-8',
};

async function serveStatic(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const urlPath = (req.url || '/').split('?')[0];
  const requested = urlPath === '/' ? '/index.html' : urlPath;
  // Resolve inside the dist folder only — blocks ../ traversal.
  const target = resolve(CLIENT_DIST, `.${requested}`);
  if (!target.startsWith(CLIENT_DIST + sep) && target !== resolve(CLIENT_DIST, 'index.html')) {
    res.writeHead(403).end('Forbidden');
    return;
  }

  try {
    const body = await readFile(target);
    res.writeHead(200, { 'content-type': MIME_TYPES[extname(target)] || 'application/octet-stream' });
    res.end(body);
  } catch {
    // SPA fallback: unknown paths return index.html so client routing keeps working.
    try {
      const fallback = await readFile(resolve(CLIENT_DIST, 'index.html'));
      res.writeHead(200, { 'content-type': MIME_TYPES['.html'] });
      res.end(fallback);
    } catch {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('Client build not found. Run `pnpm build` first (or set CLIENT_DIST).');
    }
  }
}

const httpServer = createServer(async (req, res) => {
  if (req.url?.startsWith('/healthz')) {
    res.writeHead(200, { 'content-type': MIME_TYPES['.json'] });
    res.end(
      JSON.stringify({
        status: 'ok',
        uptimeSec: Math.round(process.uptime()),
        sessions: sessions.size,
        symbol: currentSymbol,
        timeframe: currentTimeframe,
        feed: activeProvider,
        feedStatus,
        feedReason,
        lastTradeTs,
        lastDepthTs,
        futuresProvider: process.env.FUTURES_PROVIDER || 'none',
        historySource,
        gexSource: currentInstrument.underlyingIndex ? gex.getProfile(currentInstrument.underlyingIndex)?.dataSource : undefined,
      })
    );
    return;
  }
  await serveStatic(req, res);
});

const wss = new WebSocketServer({ server: httpServer, maxPayload: MAX_PAYLOAD_BYTES });

function broadcast(msg: WSServerMessage) {
  const json = JSON.stringify(msg);
  for (const client of wss.clients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(json);
    }
  }
}

// Orderflow pipeline callback
const callbacks: DataFeedCallbacks = {
  onTick: (tick: Tick) => {
    const isReplay = backtest.isActive();

    // 1. Record for backtesting (only when live, not during replay)
    if (!isReplay) {
      backtest.recordTick(tick);
    }

    // 4. Process Footprint
    const { currentBar, closedBar } = footprint.processTick(tick);
    if (closedBar) {
      broadcast({ type: 'BAR_CLOSE', bar: closedBar });
    }
    const now = Date.now();
    if (now - lastBarUpdate > 100) {
      broadcast({ type: 'BAR_UPDATE', bar: currentBar });
      lastBarUpdate = now;
    }

    // 5. Process Volume Profile & TPO & VWAP
    profile.processTick(tick);
    vwap.processTick(tick);

    // 6. Process Tape, Deep Trades & Absorption
    const currentBook = getBook();
    const { speed, deepTrade, absorption } = tape.processTick(
      tick,
      currentBook,
      currentInstrument.pointValue,
      currentInstrument.tickSize
    );

    broadcast({ type: 'TICK', tick });
    if (now - lastSpeedOfTapeUpdate > 250) {
      broadcast({ type: 'SPEED_OF_TAPE', tape: speed });
      lastSpeedOfTapeUpdate = now;
    }

    if (deepTrade) {
      broadcast({ type: 'DEEP_TRADE', trade: deepTrade });
    }

    if (absorption) {
      broadcast({ type: 'ABSORPTION', alert: absorption });
    }

    // 7. Per-session account pipeline: orders, journal and prop risk are private to each
    // visitor, while the market-data pipeline above is shared by everyone.
    if (!isReplay) {
      lastPriceBySymbol.set(currentSymbol, tick.price);
      const accountNow = Date.now();

      for (const session of sessions.values()) {
        // 7a. Auto-flatten requested by a breach on a previous tick
        if (session.pendingAutoFlatten) {
          session.pendingAutoFlatten = false;
          clearRestingOrders(session, 'prop breach');
          settleClosedTrades(session, tick.price);
          session.send({ type: 'PROP_STATE_UPDATE', state: session.propRisk.getState() });
        }

        // 7b. Day rollover (each account ages independently)
        const today = new Date().toISOString().slice(0, 10);
        if (today !== session.sessionDate) {
          session.sessionDate = today;
          session.propRisk.rollDay();
          session.send({ type: 'PROP_STATE_UPDATE', state: session.propRisk.getState() });
        }

        // 7c. Fill this session's resting limit orders
        if (session.propRisk.getState().isLockedOut) {
          clearRestingOrders(session, 'account locked out');
        } else {
          const filled: RestingOrder[] = [];
          session.restingOrders = session.restingOrders.filter((ord) => {
          if (ord.symbol !== currentSymbol) return true;
          const hit = ord.side === 'LONG' ? tick.price <= ord.price : tick.price >= ord.price;
          if (hit) {
            filled.push(ord);
            return false;
          }
          return true;
        });

          for (const ord of filled) {
            const validation = session.propRisk.validateOrder(ord.symbol, ord.size, session.pendingContracts(ord.symbol));
            if (!validation.allowed) {
              session.send({ type: 'ORDER_REJECT', reason: 'Contract limit exceeded at fill time', orderId: ord.id });
              continue;
            }
            const trade = session.journal.openTrade(ord.symbol, ord.side, ord.price, ord.size, 'DOM Limit Fill', 'Prop Firm Scalp');
            session.send({ type: 'JOURNAL_UPDATE', trade });
            void session.copier.copyOrder(ord.symbol, ord.side === 'LONG' ? 'BUY' : 'SELL', ord.size, ord.price);
          }
          if (filled.length > 0) {
            broadcastOpenOrders(session);
          }
        }

        // 7d. Mark-to-market this session's account
        session.journal.updatePriceForOpenTrades(currentSymbol, tick.price);

        // Equity must include positions on *every* instrument the account holds, using each
        // trade's own point value and last seen price. Counting only the visible contract
        // would freeze the PnL of any position left open on another symbol.
        let totalUnrealized = 0;
        let openContracts = 0;
        for (const t of session.journal.getTrades()) {
          if (t.status !== 'OPEN') continue;
          const lastPx = lastPriceBySymbol.get(t.symbol);
          if (lastPx === undefined) continue; // no price observed yet for that contract
          const pointValue = FUTURES_INSTRUMENTS[t.symbol]?.pointValue ?? currentInstrument.pointValue;
          const pointDiff = t.side === 'LONG' ? lastPx - t.entryPrice : t.entryPrice - lastPx;
          totalUnrealized += pointDiff * pointValue * t.size;
          // Contract limits are enforced per instrument, so only the active symbol counts.
          if (t.symbol === currentSymbol) openContracts += t.size;
        }

        session.propRisk.updateEquity(totalUnrealized, openContracts);
        if (accountNow - session.lastPropBroadcast > 250) {
          session.send({ type: 'PROP_STATE_UPDATE', state: session.propRisk.getState() });
          session.lastPropBroadcast = accountNow;
        }
      }
    }
  },

  onOrderbookSnapshot: (bids, asks, updateId) => {
    cachedBook = null;
    orderbook.applySnapshot(bids, asks, updateId);
    const now = Date.now();
    if (now - lastOrderbookUpdate > 100) {
      broadcast({ type: 'ORDERBOOK_UPDATE', orderbook: orderbook.getSnapshot() });
      lastOrderbookUpdate = now;
    }
  },

  onOrderbookDelta: (bids, asks, updateId) => {
    cachedBook = null;
    orderbook.applyDelta(bids, asks, updateId);
    const now = Date.now();
    if (now - lastOrderbookUpdate > 100) {
      broadcast({ type: 'ORDERBOOK_UPDATE', orderbook: orderbook.getSnapshot() });
      lastOrderbookUpdate = now;
    }
  },
};

// Switch Symbol & Reinitialize Instrument
//
// Ordering is the invariant here: every snapshot that leaves the server must pair the active
// symbol with its own market state. The old feed is therefore torn down WHILE the old identity is
// still in place (so the UNAVAILABLE snapshot its teardown publishes stays coherent), then the
// identity flips and every engine is rebuilt synchronously, and only then does the new feed start
// publishing status. Starting the feed right after the symbol flip published `symbol=ES` while the
// footprint still held the previous instrument's bars (TEST 13: "ES returned N fabricated bars").
async function applyInstrumentSwitch(symbol: string): Promise<void> {
  // Invalidate history before awaiting teardown, including ES -> NQ -> ES races.
  resetHistory();
  // 1. Kill the old feed first: its listeners are dead before anything below runs.
  await stopFeed();

  // 2. Flip identity and rebuild every engine. This block is synchronous, so no await point exists
  //    at which a feed status publish could observe a half-switched market state.
  currentSymbol = symbol;
  currentInstrument = FUTURES_INSTRUMENTS[symbol] || FUTURES_INSTRUMENTS.ES;

  orderbook = new OrderbookManager(50);
  footprint = new FootprintEngine(currentInstrument.tickSize, TIMEFRAMES[currentTimeframe], 3.0, 1.0);
  profile = new ProfileEngine(currentInstrument.tickSize);
  vwap = new VWAPEngine();
  tape = new TapeEngine(computeDeepTradeThresholdUsd(), 15.0);
  cachedBook = null;
  // The previous contract's candles must not linger on the new contract's chart.
  historyBars = [];
  for (const session of sessions.values()) {
    clearRestingOrders(session, 'switch instrument');
    session.setPointValue(currentInstrument.pointValue);
  }

  // 3. Only now attach the new feed, so every CONNECTING/LIVE/UNAVAILABLE snapshot it publishes is
  //    built from the rebuilt engines of this symbol.
  await startFeed();

  // Readiness gate: when a live vendor is attached, wait for its first VALIDATED event so the
  // snapshot returned to the caller already carries feedStatus=LIVE. The timeout fails
  // honestly (status stays UNAVAILABLE) — readiness is never faked with a synthetic tick.
  if (activeFeed && typeof activeFeed.waitForLive === 'function') {
    try {
      await activeFeed.waitForLive(parseInt(process.env.FEED_LIVE_TIMEOUT_MS || '15000', 10));
    } catch (err) {
      console.warn(`[Feed:${activeProvider}] ${currentSymbol}: ${(err as Error).message}`);
    }
  }

  // 4. Refresh GEX (real CBOE chain when reachable) and re-seed history for the new contract.
  if (currentInstrument.underlyingIndex) {
    void refreshGex();
  }
  historySource = 'NONE';
  void backfillHistory();
}

// Serialise switches. Two overlapping switches would interleave at their await points and leave
// whichever finished LAST as the active instrument (and could orphan a live socket), so rapid
// SUBSCRIBE bursts are queued: each lifecycle fully settles before the next one starts.
let switchChain: Promise<void> = Promise.resolve();
function switchInstrument(symbol: string): Promise<void> {
  const run = switchChain.then(
    () => applyInstrumentSwitch(symbol),
    () => applyInstrumentSwitch(symbol)
  );
  // A failed switch must not poison the queue for later requests.
  switchChain = run.then(
    () => undefined,
    () => undefined
  );
  return run;
}

// Start Data Feed through the MarketDataFeed abstraction.
//
// Lifecycle is strict: the previous feed is fully disconnected (listeners dead) BEFORE a new
// adapter is created, so a late frame from the old instrument can never reach the new book.
// Only validated real events can move the status to LIVE — a successful connection is not data.
async function startFeed(): Promise<void> {
  await stopFeed();

  // New session token: a torn-down adapter must never publish into the next session. Without
  // this, a late 'disconnected' from the previous adapter flipped a freshly LIVE feed back to
  // UNAVAILABLE, and the real-only order guard then rejected valid orders.
  const token = ++activeFeedToken;

  lastTradeTs = 0;
  lastDepthTs = 0;

  const { feed, provider } = createMarketDataFeed(currentSymbol, currentInstrument, {
    onTrade: (trade: MarketTrade) => {
      if (token !== activeFeedToken) return; // stale session: never reach the engines
      lastTradeTs = Date.now();
      if (feedStatus !== 'LIVE') setFeedStatus('LIVE');
      // Boundary translation into the existing engine contract (engines stay untouched).
      callbacks.onTick({
        id: trade.id ?? `md_${currentSymbol}_${trade.ts}`,
        timestamp: trade.ts,
        price: trade.price,
        size: trade.size,
        side: trade.side === 'BUY' ? 'buy' : 'sell',
        isBuyerMaker: trade.side !== 'BUY',
      });
    },
    onDepth: (event: MarketDepthEvent) => {
      if (token !== activeFeedToken) return; // stale session: never contaminate the book
      lastDepthTs = Date.now();
      if (event.kind === 'snapshot') {
        callbacks.onOrderbookSnapshot(
          event.bids.map((l) => [l.price, l.size] as [number, number]),
          event.asks.map((l) => [l.price, l.size] as [number, number]),
          event.updateId ?? event.ts
        );
      } else if (event.side === 'bid') {
        callbacks.onOrderbookDelta([[event.price, event.size]], [], event.updateId ?? event.ts);
      } else {
        callbacks.onOrderbookDelta([], [[event.price, event.size]], event.updateId ?? event.ts);
      }
    },
    onStatus: (status: FeedStatusEvent) => {
      if (token !== activeFeedToken) return; // the actual race fix: stale status is ignored
      if (status.provider !== provider) return;
      feedReason = status.reason;
      setFeedStatus(status.state === 'LIVE' ? 'LIVE' : 'UNAVAILABLE');
    },
    onError: (error: Error) => {
      if (token !== activeFeedToken) return;
      console.warn(`[Feed:${provider}] ${currentSymbol}: ${error.message}`);
      setFeedStatus('UNAVAILABLE');
    },
  });

  activeFeed = feed;
  activeProvider = provider;
  feedReason = provider === 'none' ? 'no licensed realtime vendor configured for futures' : 'connecting';
  console.log(`[DeepChart Server] Feed provider '${provider}' starting for ${currentSymbol}`);

  try {
    await feed.connect();
  } catch (err) {
    feedReason = (err as Error).message;
    setFeedStatus('UNAVAILABLE');
    console.warn(`[Feed:${provider}] ${currentSymbol} failed to connect: ${feedReason}`);
  }
}

/** Stop and release the active feed. Resolves only after listeners are dead. */
async function stopFeed(): Promise<void> {
  const previous = activeFeed;
  activeFeed = null;
  if (!previous) return;
  try {
    await previous.disconnect();
  } catch (err) {
    console.warn(`[Feed:${previous.provider}] disconnect failed: ${(err as Error).message}`);
  }
}

/** Publish a status change and re-snapshot clients so the UI reflects availability at once. */
function setFeedStatus(next: 'UNAVAILABLE' | 'LIVE'): void {
  if (next === feedStatus) return;
  feedStatus = next;
  console.log(`[Feed] ${currentSymbol}: ${feedStatus}${feedReason ? ` (${feedReason})` : ''}`);
  // TEMP DIAGNOSTIC (FEED_DIAG=1): prove whether a publish pairs the active symbol with its own
  // market state, i.e. whether an instrument switch can publish a mixed snapshot.
  if (process.env.FEED_DIAG === '1') {
    const diagBars = footprint.getAllBars();
    console.log(
      `[InitState] symbol=${currentSymbol} tf=${currentTimeframe} feedStatus=${feedStatus} bars=${diagBars.length} ` +
        `firstBar=${diagBars[0]?.time ?? 0} reason=${feedReason}`
    );
  }
  for (const session of sessions.values()) session.send(buildInitState(session));
}

void startFeed();

// Seed the chart with real history as soon as the server is up (fire-and-forget).
void backfillHistory();

// Setup Backtest Replay Callback
backtest.setCallback((tick: Tick) => {
  callbacks.onTick(tick);
});

backtest.setProgressCallback((progress) => {
  broadcast({ type: 'REPLAY_STATE', progress });
});

// Copier and prop-risk callbacks are wired per session inside createSession().

// Broadcast replay progress periodically while replaying
setInterval(() => {
  if (backtest.isActive()) {
    broadcast({ type: 'REPLAY_STATE', progress: backtest.getProgress() });
  }
}, 500);

/**
 * Refresh Gamma Exposure for the active instrument from CBOE's free delayed chain.
 * If the chain is unreachable we keep the previous real profile (or none) — DeepChart does
 * not substitute a synthetic model.
 */
async function refreshGex(force = false): Promise<void> {
  const underlying = currentInstrument.underlyingIndex;
  if (!underlying) return;

  const chain = await cboe.fetchChain(underlying, force);
  if (!chain) {
    console.warn(`[GEX] ${underlying}: CBOE chain unavailable — keeping the last real profile.`);
    return;
  }

  const profile = gex.buildFromChain(underlying, chain.spotPrice, chain.contracts);
  broadcast({ type: 'GEX_UPDATE', profile });
}

setInterval(() => {
  void refreshGex();
}, parseInt(process.env.GEX_REFRESH_MS || '300000', 10));

// Warm the cache at boot so the first snapshot already carries real GEX when reachable.
void refreshGex();

// Simulated options flow was removed: DeepChart only publishes flow from a real provider.
// The scanner widget stays in the UI and simply reports that no source is configured.
// (No synthetic flow generator: OPTIONS_FLOW is only emitted by a real provider.)

/**
 * Seed the market engines with history so the chart is not empty on first load.
 *
 * Crypto  -> REAL Binance trades (true tick history): the footprint is built from real ticks.
 * Futures -> REAL Tradovate `md/getchart` bars, when the tradovate provider is configured.
 *            Bars are bar-level aggregates, NOT ticks, so they are published on their own
 *            channel (`historyBars`) and NEVER expanded into a synthetic intra-bar tick path:
 *            inventing per-price prints would fabricate the exact footprint microstructure
 *            this terminal claims to measure. Historical bars have no `levels` field.
 *
 * If no source is reachable the chart simply accumulates live ticks and the UI says so.
 */
async function backfillHistory(): Promise<void> {
  const symbol = currentSymbol;
  const timeframe = currentTimeframe;
  const signal = historyRequest.signal;
  const beforeTime = historyBoundary;
  let ticks: Tick[] = [];
  let source: HistorySource = 'NONE';

  try {
    // Only REAL history is seeded. Crypto has public real trades; anything else would have
    // to be reconstructed from bars, which would produce a fabricated footprint.
    if (symbol === 'BTCUSDT') {
      ticks = await fetchBinanceAggTrades(symbol, 3);
      if (ticks.length > 0) source = 'REAL_TICKS';
    } else if ((process.env.FUTURES_PROVIDER || '').toLowerCase() === 'tradovate') {
      // REAL bars straight from the vendor. They stay bar-shaped: see the note above the function.
      // MinuteBar cannot represent sub-minute history; do not expand 1m bars into fake seconds.
      if (TIMEFRAMES[timeframe] < 60000) return;
      const config = readTradovateConfig();
      const bars = await fetchTradovateHistoryBars(
        resolveVendorSymbol(symbol, FUTURES_INSTRUMENTS[symbol] || FUTURES_INSTRUMENTS.ES, config),
        config,
        { barMinutes: TIMEFRAMES[timeframe] / 60000, elements: 300, beforeTime, signal }
      );
      if (signal.aborted || symbol !== currentSymbol || timeframe !== currentTimeframe) return;
      if (bars.length > 0) {
        historyBars = bars;
        historySource = 'REAL_BARS';
        console.log(`[History] ${symbol}: ${bars.length} real bar(s) from tradovate`);
        for (const session of sessions.values()) session.send(buildInitState(session));
      } else {
        historySource = 'NONE';
        console.log(`[History] ${symbol}: no real history available — accumulating live ticks only.`);
      }
      return;
    }

    // Discard even if the instrument switched away and then back to the same name.
    if (signal.aborted || symbol !== currentSymbol) return;

    historySource = source;
    if (ticks.length === 0) {
      console.log(`[History] ${symbol}: no real history available — accumulating live ticks only.`);
      return;
    }

    // Avoid duplicating the same history in the replay buffer when a symbol is revisited.
    const buffered = backtest.getRecordedTicks();
    const lastBufferedTs = buffered.length > 0 ? buffered[buffered.length - 1].timestamp : 0;

    for (const tick of ticks) {
      if (tick.timestamp > lastBufferedTs) backtest.recordTick(tick);
      footprint.processTick(tick);
      profile.processTick(tick);
      vwap.processTick(tick);
      lastPriceBySymbol.set(symbol, tick.price);
    }

    console.log(`[History] ${symbol}: seeded ${ticks.length} ticks (${source})`);
    for (const session of sessions.values()) session.send(buildInitState(session));
  } catch (err) {
    console.warn(`[History] backfill failed for ${symbol}: ${(err as Error).message}`);
  }
}

// Build the full client snapshot. Used on connect and again whenever the client
// switches instrument, so the chart never mixes bars from two contracts.
function buildInitState(session: TradingSession): WSServerMessage {
  const underlying = currentInstrument.underlyingIndex || 'SPX';
  return {
    type: 'INIT_STATE',
    symbol: currentSymbol,
    instrument: currentInstrument,
    bars: footprint.getAllBars(),
    orderbook: orderbook.getSnapshot(),
    volumeProfile: profile.getVolumeProfile(),
    tpo: profile.getTPOProfile(),
    vwap: vwap.getHistory(),
    cvdHistory: footprint.getAllBars().map((b) => ({ time: b.time, cvd: b.cvd })),
    gexProfile: gex.getProfile(underlying),
    optionsFlow: gex.getRecentFlow(),
    propState: session.propRisk.getState(),
    propConfig: session.propRisk.getConfig(),
    deepTradeThresholdUsd: computeDeepTradeThresholdUsd(),
    slaves: session.copier.getSlaves(),
    timeframe: currentTimeframe,
    historySource,
    historyBars,
    feedStatus,
  };
}

// Handle WebSocket Client Connections
wss.on('connection', (ws: WebSocket) => {
  if (sessions.size >= MAX_SESSIONS) {
    console.warn(`[DeepChart Server] Rejecting connection: session limit (${MAX_SESSIONS}) reached.`);
    ws.close(1013, 'Server at capacity — please retry shortly');
    return;
  }

  const session = createSession(ws);
  sessions.set(ws, session);
  console.log(`[DeepChart Server] Client connected (${session.id}). Active sessions: ${sessions.size}`);

  session.send(buildInitState(session));
  broadcastOpenOrders(session);

  ws.on('message', async (raw: WebSocket.Data) => {
    try {
      const msg = JSON.parse(raw.toString()) as WSClientMessage;

      // A public server cannot trust any single client's send rate.
      if (!session.allowMessage()) {
        session.send({ type: 'ORDER_REJECT', reason: 'Rate limit exceeded — slow down' });
        return;
      }

      if (msg.type === 'SUBSCRIBE') {
        if (msg.symbol && msg.symbol !== currentSymbol) {
          if (!FUTURES_INSTRUMENTS[msg.symbol]) {
            console.warn(`[DeepChart Server] Ignoring SUBSCRIBE for unknown symbol '${msg.symbol}'`);
            // Re-sync the caller with the real server state so the UI cannot get stuck on
            // an instrument the server does not know.
            session.send(buildInitState(session));
            return;
          }
          await switchInstrument(msg.symbol);
          // Give the requesting client a fresh snapshot for the new contract.
          session.send(buildInitState(session));
          broadcastOpenOrders(session);
        }
        // Feed source selection is server-side (FUTURES_PROVIDER / symbol) — the client's
        // `source` field is accepted but no longer able to switch vendors.

        // Timeframe change: rebuild the footprint engine with the requested bar duration.
        if (msg.timeframe && msg.timeframe !== currentTimeframe && TIMEFRAMES[msg.timeframe]) {
          currentTimeframe = msg.timeframe;
          if (currentSymbol !== 'BTCUSDT') resetHistory();
          footprint = new FootprintEngine(currentInstrument.tickSize, TIMEFRAMES[currentTimeframe], 3.0, 1.0);
          console.log(`[DeepChart Server] Timeframe changed to ${currentTimeframe}`);
          session.send(buildInitState(session));
          if (currentSymbol !== 'BTCUSDT') void backfillHistory();
        }
      } else if (msg.type === 'DOM_ORDER') {
        if (msg.action === 'CANCEL') {
          if (msg.orderId) {
            const prevLen = session.restingOrders.length;
            session.restingOrders = session.restingOrders.filter((o) => o.id !== msg.orderId);
            if (session.restingOrders.length < prevLen) {
              session.send({ type: 'ORDER_ACK', action: 'CANCELLED', orderId: msg.orderId });
            }
          } else {
            clearRestingOrders(session, 'Client CANCEL ALL');
            session.send({ type: 'ORDER_ACK', action: 'CANCELLED' });
          }
          broadcastOpenOrders(session);
        } else if (msg.action === 'FLATTEN') {
          clearRestingOrders(session, 'FLATTEN');
          // Exit at the mid price when there is a live book; otherwise use the last REAL
          // observed price for this instrument (never the synthetic base price).
          const bestBid = orderbook.getBestBid();
          const bestAsk = orderbook.getBestAsk();
          const midPrice =
            bestBid !== null && bestAsk !== null
              ? (bestBid + bestAsk) / 2
              : lastPriceBySymbol.get(currentSymbol) ?? currentInstrument.basePrice;
          settleClosedTrades(session, msg.price && msg.price > 0 ? msg.price : midPrice);
          session.send({ type: 'PROP_STATE_UPDATE', state: session.propRisk.getState() });
        } else if (msg.action === 'BUY' || msg.action === 'SELL') {
          // --- Real-only guard: a fill price must come from a live real book ---
          if (feedStatus !== 'LIVE') {
            session.send({
              type: 'ORDER_REJECT',
              reason: `No real market-data feed for ${currentSymbol} — orders are rejected instead of being filled at a fabricated price`,
              orderId: msg.orderId,
            });
            return;
          }

          // --- Runtime input validation: WebSocket payloads are untrusted ---
          const size = msg.size;
          if (typeof size !== 'number' || !Number.isFinite(size) || size <= 0) {
            session.send({ type: 'ORDER_REJECT', reason: 'Order size must be a positive number', orderId: msg.orderId });
            return;
          }
          if (currentInstrument.category !== 'CRYPTO' && !Number.isInteger(size)) {
            session.send({
              type: 'ORDER_REJECT',
              reason: 'Futures orders must use whole contract sizes',
              orderId: msg.orderId,
              size,
            });
            return;
          }

          const validation = session.propRisk.validateOrder(currentSymbol, size, session.pendingContracts(currentSymbol));
          if (!validation.allowed) {
            console.warn(`[Prop Firm Safeguard][${session.id}] Order rejected: ${validation.reason}`);
            session.send({
              type: 'ORDER_REJECT',
              reason: validation.reason || 'Order rejected by prop risk',
              orderId: msg.orderId,
              size,
            });
            return;
          }

          const side = msg.action === 'BUY' ? 'LONG' : 'SHORT';
          if (msg.orderType === 'LIMIT') {
            if (typeof msg.price !== 'number' || !Number.isFinite(msg.price) || msg.price <= 0) {
              session.send({ type: 'ORDER_REJECT', reason: 'LIMIT order requires a valid price', orderId: msg.orderId });
              return;
            }
            const orderId = msg.orderId || `ord_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;
            const newOrder: RestingOrder = {
              id: orderId,
              symbol: currentSymbol,
              side,
              price: msg.price,
              size,
              createdAt: Date.now(),
            };
            session.restingOrders.push(newOrder);
            session.send({ type: 'ORDER_ACK', action: 'PLACED', orderId, price: msg.price, size });
            broadcastOpenOrders(session);
          } else {
            // MARKET
            const currentPrice = orderbook.getBestAsk() || currentInstrument.basePrice;
            const execPrice = (msg.action === 'BUY' ? orderbook.getBestAsk() : orderbook.getBestBid()) || currentPrice;
            const trade = session.journal.openTrade(currentSymbol, side, execPrice, size, 'DOM 1-Click Execution', 'Prop Firm Scalp');
            session.send({ type: 'ORDER_ACK', action: 'FILLED', orderId: msg.orderId, price: execPrice, size });
            session.send({ type: 'JOURNAL_UPDATE', trade });
            void session.copier.copyOrder(currentSymbol, msg.action, size, execPrice);
          }
        }
      } else if (msg.type === 'CLEAR_JOURNAL') {
        session.journal.reset();
        console.log(`[DeepChart Server] Journal cleared by ${session.id}.`);
        session.send({ type: 'JOURNAL_CLEARED' });
      } else if (msg.type === 'SET_PROP_TRAILING_MODE') {
        session.propRisk.setTrailingMode(msg.mode);
        session.send({ type: 'PROP_STATE_UPDATE', state: session.propRisk.getState() });
      } else if (msg.type === 'RESET_PROP_ACCOUNT') {
        // Flatten FIRST, then reset: a pre-existing position would otherwise keep feeding
        // PnL into the freshly reset balance.
        clearRestingOrders(session, 'account reset');
        const bestBid = orderbook.getBestBid();
        const bestAsk = orderbook.getBestAsk();
        const resetExit =
          bestBid !== null && bestAsk !== null ? (bestBid + bestAsk) / 2 : currentInstrument.basePrice;
        flattenEveryOpenTrade(session, resetExit);
        session.propRisk.resetAccount();
        session.send({ type: 'PROP_STATE_UPDATE', state: session.propRisk.getState() });
      } else if (msg.type === 'SET_PROP_CONFIG') {
        if (process.env.DEV_HOOKS === '1' && msg.config) {
          session.propRisk.setConfig(msg.config);
          session.send({ type: 'PROP_STATE_UPDATE', state: session.propRisk.getState() });
        }
      } else if (msg.type === 'REPLAY_CONTROL') {
        if (msg.action === 'START') {
          backtest.start(msg.speed || 1);
        } else if (msg.action === 'PAUSE') {
          backtest.pause();
        } else if (msg.action === 'SEEK' && typeof msg.timestamp === 'number') {
          backtest.seek(msg.timestamp);
        } else if (msg.action === 'SET_SPEED' && typeof msg.speed === 'number') {
          backtest.setSpeed(msg.speed);
        } else if (msg.action === 'STEP') {
          backtest.stepForward();
        }
        broadcast({ type: 'REPLAY_STATE', progress: backtest.getProgress() });
      } else if (msg.type === 'UPDATE_COPIER') {
        for (const s of msg.slaves) {
          session.copier.updateSlave(s);
        }
      }
    } catch (err) {
      console.error('[DeepChart Server] Error handling client message:', err);
    }
  });

  ws.on('close', () => {
    sessions.delete(ws);
    console.log(`[DeepChart Server] Client disconnected (${session.id}). Active sessions: ${sessions.size}`);
  });
});

httpServer.listen(PORT, HOST, () => {
  console.log(`[DeepChart Server - Prop Firm Edition] Ready at ws://localhost:${PORT} (bound to ${HOST})`);
  console.log(`[DeepChart Server] Web terminal: http://localhost:${PORT} | health: http://localhost:${PORT}/healthz`);
  console.log(`[DeepChart Server] Serving client build from ${CLIENT_DIST}`);
});

