import { WebSocket, WebSocketServer } from 'ws';
import { BacktestReplayEngine } from './backtestEngine.js';
import { BinanceFuturesFeed, DataFeedCallbacks } from './dataFeeds/binanceFeed.js';
import { CMEFuturesFeed } from './dataFeeds/cmeFuturesFeed.js';
import { SimulatorFeed } from './dataFeeds/simulatorFeed.js';
import { FootprintEngine } from './footprintEngine.js';
import { FUTURES_INSTRUMENTS, FuturesInstrument } from './futuresConfig.js';
import { GEXEngine } from './gexEngine.js';
import { JournalEngine } from './journalEngine.js';
import { OrderbookManager } from './orderbook.js';
import { ProfileEngine } from './profileEngine.js';
import { PropRiskEngine } from './propRiskEngine.js';
import { TapeEngine } from './tapeEngine.js';
import { TradeCopierEngine } from './tradeCopier.js';
import {
  OrderbookSnapshot,
  RestingOrder,
  Tick,
  WSClientMessage,
  WSServerMessage,
} from './types.js';
import { VWAPEngine } from './vwapEngine.js';

const PORT = parseInt(process.env.PORT || '8080', 10);
let currentSymbol = 'ES';
let currentInstrument: FuturesInstrument = FUTURES_INSTRUMENTS.ES;

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
let lastPropStateUpdate = 0;
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
const copier = new TradeCopierEngine();
const journal = new JournalEngine();
const gex = new GEXEngine();
const propRisk = new PropRiskEngine();

journal.setPointValue(currentInstrument.pointValue);

function getBook(): OrderbookSnapshot {
  const now = Date.now();
  if (!cachedBook || now - cachedBookTime > 5) {
    cachedBook = orderbook.getSnapshot();
    cachedBookTime = now;
  }
  return cachedBook;
}

function getPendingContracts(symbol = currentSymbol) {
  return restingOrders.filter((o) => o.symbol === symbol).reduce((s, o) => s + o.size, 0);
}

function broadcastOpenOrders() {
  broadcast({ type: 'OPEN_ORDERS', symbol: currentSymbol, orders: restingOrders.filter((o) => o.symbol === currentSymbol) });
}

function clearRestingOrders(reason: string) {
  if (restingOrders.length === 0) return;
  console.log(`[Orders] Cleared ${restingOrders.length} resting order(s): ${reason}`);
  restingOrders = [];
  broadcastOpenOrders();
}

function settleClosedTrades(exitPrice: number) {
  const closed = journal.closeAllTrades(currentSymbol, exitPrice);
  for (const c of closed) {
    propRisk.recordClosedTrade(c.pnl ?? 0);
    broadcast({ type: 'JOURNAL_UPDATE', trade: c });
  }
  return closed;
}

let currentFeedType: 'binance' | 'simulator' | 'cme' = 'cme';
let activeFeed: { stop: () => void } | null = null;

// Setup WebSocket Server
const wss = new WebSocketServer({ port: PORT });

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

    // 1. Pending auto-flatten from breach callback
    if (pendingAutoFlatten && !isReplay) {
      pendingAutoFlatten = false;
      clearRestingOrders('prop breach');
      settleClosedTrades(tick.price);
      broadcast({ type: 'PROP_STATE_UPDATE', state: propRisk.getState() });
    }

    // 2. Day rollover check
    const today = new Date().toISOString().slice(0, 10);
    if (today !== sessionDate) {
      sessionDate = today;
      propRisk.rollDay();
      broadcast({ type: 'PROP_STATE_UPDATE', state: propRisk.getState() });
    }

    // 3. Record for backtesting (only when live, not during replay)
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

    // 7. Process resting orders - ONLY when !isReplay
    if (!isReplay) {
      if (propRisk.getState().isLockedOut) {
        clearRestingOrders('account locked out');
      } else {
        const filled: RestingOrder[] = [];
        restingOrders = restingOrders.filter((ord) => {
          if (ord.symbol !== currentSymbol) return true;
          const hit = ord.side === 'LONG' ? tick.price <= ord.price : tick.price >= ord.price;
          if (hit) {
            filled.push(ord);
            return false;
          }
          return true;
        });

        for (const ord of filled) {
          const validation = propRisk.validateOrder(ord.symbol, ord.size, getPendingContracts());
          if (!validation.allowed) {
            broadcast({ type: 'ORDER_REJECT', reason: 'Contract limit exceeded at fill time', orderId: ord.id });
            continue;
          }
          const trade = journal.openTrade(ord.symbol, ord.side, ord.price, ord.size, 'DOM Limit Fill', 'Prop Firm Scalp');
          broadcast({ type: 'JOURNAL_UPDATE', trade });
          void copier.copyOrder(ord.symbol, ord.side === 'LONG' ? 'BUY' : 'SELL', ord.size, ord.price);
        }
        if (filled.length > 0) {
          broadcastOpenOrders();
        }
      }

      // 8. Update Open Journal Trades & Prop Risk - ONLY when !isReplay
      journal.updatePriceForOpenTrades(currentSymbol, tick.price);
      lastPriceBySymbol.set(currentSymbol, tick.price);

      // Equity must include positions on *every* instrument the account holds, using each
      // trade's own point value and last seen price. Counting only the visible contract
      // would freeze the PnL of any position left open on another symbol.
      let totalUnrealized = 0;
      let openContracts = 0;
      for (const t of journal.getTrades()) {
        if (t.status !== 'OPEN') continue;
        const lastPx = lastPriceBySymbol.get(t.symbol);
        if (lastPx === undefined) continue; // no price observed yet for that contract
        const pointValue = FUTURES_INSTRUMENTS[t.symbol]?.pointValue ?? currentInstrument.pointValue;
        const pointDiff = t.side === 'LONG' ? lastPx - t.entryPrice : t.entryPrice - lastPx;
        totalUnrealized += pointDiff * pointValue * t.size;
        // Contract limits are enforced per instrument, so only the active symbol counts.
        if (t.symbol === currentSymbol) openContracts += t.size;
      }

      propRisk.updateEquity(totalUnrealized, openContracts);
      if (now - lastPropStateUpdate > 250) {
        broadcast({ type: 'PROP_STATE_UPDATE', state: propRisk.getState() });
        lastPropStateUpdate = now;
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
function switchInstrument(symbol: string, source: 'binance' | 'simulator' | 'cme' = 'cme') {
  currentSymbol = symbol;
  currentInstrument = FUTURES_INSTRUMENTS[symbol] || FUTURES_INSTRUMENTS.ES;

  orderbook = new OrderbookManager(50);
  footprint = new FootprintEngine(currentInstrument.tickSize, 60 * 1000, 3.0, 1.0);
  profile = new ProfileEngine(currentInstrument.tickSize);
  vwap = new VWAPEngine();
  tape = new TapeEngine(computeDeepTradeThresholdUsd(), 15.0);
  cachedBook = null;
  clearRestingOrders('switch instrument');
  journal.setPointValue(currentInstrument.pointValue);

  startFeed(source);

  // If instrument has underlying, update GEX
  if (currentInstrument.underlyingIndex) {
    const p = gex.getProfile(currentInstrument.underlyingIndex);
    if (p) {
      broadcast({ type: 'GEX_UPDATE', profile: p });
    }
  }
}

// Start Data Feed
function startFeed(source: 'binance' | 'simulator' | 'cme') {
  if (activeFeed) {
    activeFeed.stop();
    activeFeed = null;
  }

  currentFeedType = source;
  if (source === 'binance' || currentSymbol === 'BTCUSDT') {
    const feed = new BinanceFuturesFeed(currentSymbol, callbacks);
    feed.start();
    activeFeed = feed;
    console.log(`[DeepChart Server] Connected to Binance Feed for ${currentSymbol}`);
  } else if (source === 'cme') {
    const feed = new CMEFuturesFeed(currentSymbol, callbacks);
    feed.start();
    activeFeed = feed;
    console.log(`[DeepChart Server] CME Globex Feed started for ${currentSymbol} (${currentInstrument.name})`);
  } else {
    const feed = new SimulatorFeed(currentInstrument.basePrice, currentInstrument.tickSize, callbacks);
    feed.start();
    activeFeed = feed;
    console.log(`[DeepChart Server] Simulator Feed started for ${currentSymbol}`);
  }
}

startFeed('cme');

// Setup Backtest Replay Callback
backtest.setCallback((tick: Tick) => {
  callbacks.onTick(tick);
});

backtest.setProgressCallback((progress) => {
  broadcast({ type: 'REPLAY_STATE', progress });
});

// Setup Copier Callback
copier.setCallback((slaveId, symbol, size, price, latencyMs) => {
  broadcast({
    type: 'TRADE_COPIED',
    slaveId,
    symbol,
    size,
    price,
    latencyMs,
  });
});

// Setup Prop Risk Callback
propRisk.setCallback((breachType, message) => {
  console.log(`[Prop Firm Alert] ${breachType}: ${message}`);
  pendingAutoFlatten = true;
  clearRestingOrders('prop breach');
  broadcast({
    type: 'PROP_BREACH_ALERT',
    breachType,
    message,
  });
});

// Broadcast replay progress periodically while replaying
setInterval(() => {
  if (backtest.isActive()) {
    broadcast({ type: 'REPLAY_STATE', progress: backtest.getProgress() });
  }
}, 500);

// Refresh Gamma Exposure periodically so walls / zero-gamma stay alive instead of
// freezing at their boot values.
setInterval(() => {
  gex.refreshAll();
  const underlying = currentInstrument.underlyingIndex || 'SPX';
  const profile = gex.getProfile(underlying);
  if (profile) {
    broadcast({ type: 'GEX_UPDATE', profile });
  }
}, 30000);

// Periodically emit simulated Options Flow Whale Trades
setInterval(() => {
  const underlyings = ['SPX', 'SPY', 'NDX', 'QQQ'];
  const und = underlyings[Math.floor(Math.random() * underlyings.length)];
  const spot = und === 'SPX' ? 5860 : und === 'SPY' ? 585 : und === 'NDX' ? 20550 : 495;
  const isCall = Math.random() > 0.45;
  const strikeDiff = (Math.floor(Math.random() * 6) - 2) * (und === 'SPX' || und === 'NDX' ? 10 : 1);
  const strike = spot + strikeDiff;
  const dte = Math.random() < 0.6 ? 0 : Math.floor(Math.random() * 5) + 1;
  const size = Math.floor(Math.random() * 400) + 50;
  const price = Math.round((Math.random() * 15 + 2) * 100) / 100;
  const premiumUsd = Math.round(size * price * 100);

  const flowTrade = {
    id: `flow_${Date.now()}`,
    timestamp: Date.now(),
    underlying: und,
    contractType: (isCall ? 'CALL' : 'PUT') as 'CALL' | 'PUT',
    strike,
    expiration: dte === 0 ? '0DTE' : `${dte}DTE`,
    dte,
    orderType: (Math.random() > 0.5 ? 'SWEEP' : 'BLOCK') as 'SWEEP' | 'BLOCK',
    sentiment: (isCall ? 'BULLISH' : 'BEARISH') as 'BULLISH' | 'BEARISH',
    size,
    price,
    premiumUsd,
    spotPrice: spot,
    source: 'SIMULATED' as const,
  };

  gex.addFlowTrade(flowTrade);
  broadcast({ type: 'OPTIONS_FLOW', trade: flowTrade });
}, 12000);

// Build the full client snapshot. Used on connect and again whenever the client
// switches instrument, so the chart never mixes bars from two contracts.
function buildInitState(): WSServerMessage {
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
    propState: propRisk.getState(),
    propConfig: propRisk.getConfig(),
    deepTradeThresholdUsd: computeDeepTradeThresholdUsd(),
    slaves: copier.getSlaves(),
    timeframe: currentTimeframe,
  };
}

// Handle WebSocket Client Connections
wss.on('connection', (ws: WebSocket) => {
  console.log('[DeepChart Server] Client connected. Active clients:', wss.clients.size);

  ws.send(JSON.stringify(buildInitState()));
  ws.send(JSON.stringify({ type: 'OPEN_ORDERS', symbol: currentSymbol, orders: restingOrders.filter((o) => o.symbol === currentSymbol) }));

  ws.on('message', async (raw: WebSocket.Data) => {
    try {
      const msg = JSON.parse(raw.toString()) as WSClientMessage;

      if (msg.type === 'SUBSCRIBE') {
        if (msg.symbol && msg.symbol !== currentSymbol) {
          switchInstrument(msg.symbol, msg.source || currentFeedType);
          // Give the requesting client a fresh snapshot for the new contract.
          ws.send(JSON.stringify(buildInitState()));
          ws.send(
            JSON.stringify({
              type: 'OPEN_ORDERS',
              symbol: currentSymbol,
              orders: restingOrders.filter((o) => o.symbol === currentSymbol),
            })
          );
        } else if (msg.source && msg.source !== currentFeedType) {
          startFeed(msg.source);
        }

        // Timeframe change: rebuild the footprint engine with the requested bar duration.
        if (msg.timeframe && msg.timeframe !== currentTimeframe && TIMEFRAMES[msg.timeframe]) {
          currentTimeframe = msg.timeframe;
          footprint = new FootprintEngine(currentInstrument.tickSize, TIMEFRAMES[currentTimeframe], 3.0, 1.0);
          console.log(`[DeepChart Server] Timeframe changed to ${currentTimeframe}`);
          ws.send(JSON.stringify(buildInitState()));
        }
      } else if (msg.type === 'DOM_ORDER') {
        if (msg.action === 'CANCEL') {
          if (msg.orderId) {
            const prevLen = restingOrders.length;
            restingOrders = restingOrders.filter((o) => o.id !== msg.orderId);
            if (restingOrders.length < prevLen) {
              broadcast({ type: 'ORDER_ACK', action: 'CANCELLED', orderId: msg.orderId });
            }
          } else {
            clearRestingOrders('Client CANCEL ALL');
            broadcast({ type: 'ORDER_ACK', action: 'CANCELLED' });
          }
          broadcastOpenOrders();
        } else if (msg.action === 'FLATTEN') {
          clearRestingOrders('FLATTEN');
          // Exit at the mid price: a side-aware best-bid/best-ask would systematically
          // penalise one direction and require per-trade handling.
          const bestBid = orderbook.getBestBid();
          const bestAsk = orderbook.getBestAsk();
          const midPrice =
            bestBid !== null && bestAsk !== null ? (bestBid + bestAsk) / 2 : currentInstrument.basePrice;
          settleClosedTrades(msg.price && msg.price > 0 ? msg.price : midPrice);
          broadcast({ type: 'PROP_STATE_UPDATE', state: propRisk.getState() });
        } else if (msg.action === 'BUY' || msg.action === 'SELL') {
          const validation = propRisk.validateOrder(currentSymbol, msg.size, getPendingContracts());
          if (!validation.allowed) {
            console.warn(`[Prop Firm Safeguard] Order rejected: ${validation.reason}`);
            broadcast({ type: 'ORDER_REJECT', reason: validation.reason || 'Order rejected by prop risk', orderId: msg.orderId, size: msg.size });
            return;
          }

          const side = msg.action === 'BUY' ? 'LONG' : 'SHORT';
          if (msg.orderType === 'LIMIT') {
            if (!msg.price || typeof msg.price !== 'number') {
              broadcast({ type: 'ORDER_REJECT', reason: 'LIMIT order requires a valid price', orderId: msg.orderId });
              return;
            }
            const orderId = msg.orderId || `ord_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;
            const newOrder: RestingOrder = {
              id: orderId,
              symbol: currentSymbol,
              side,
              price: msg.price,
              size: msg.size,
              createdAt: Date.now(),
            };
            restingOrders.push(newOrder);
            broadcast({ type: 'ORDER_ACK', action: 'PLACED', orderId, price: msg.price, size: msg.size });
            broadcastOpenOrders();
          } else {
            // MARKET
            const currentPrice = orderbook.getBestAsk() || currentInstrument.basePrice;
            const execPrice = (msg.action === 'BUY' ? orderbook.getBestAsk() : orderbook.getBestBid()) || currentPrice;
            const trade = journal.openTrade(currentSymbol, side, execPrice, msg.size, 'DOM 1-Click Execution', 'Prop Firm Scalp');
            broadcast({ type: 'ORDER_ACK', action: 'FILLED', orderId: msg.orderId, price: execPrice, size: msg.size });
            broadcast({ type: 'JOURNAL_UPDATE', trade });
            void copier.copyOrder(currentSymbol, msg.action, msg.size, execPrice);
          }
        }
      } else if (msg.type === 'SET_PROP_TRAILING_MODE') {
        propRisk.setTrailingMode(msg.mode);
        broadcast({ type: 'PROP_STATE_UPDATE', state: propRisk.getState() });
      } else if (msg.type === 'RESET_PROP_ACCOUNT') {
        propRisk.resetAccount();
        broadcast({ type: 'PROP_STATE_UPDATE', state: propRisk.getState() });
      } else if (msg.type === 'SET_PROP_CONFIG') {
        if (process.env.DEV_HOOKS === '1' && msg.config) {
          propRisk.setConfig(msg.config);
          broadcast({ type: 'PROP_STATE_UPDATE', state: propRisk.getState() });
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
          copier.updateSlave(s);
        }
      }
    } catch (err) {
      console.error('[DeepChart Server] Error handling client message:', err);
    }
  });

  ws.on('close', () => {
    console.log('[DeepChart Server] Client disconnected.');
  });
});

console.log(`[DeepChart Server - Prop Firm Edition] Ready at ws://localhost:${PORT}`);
