import { CboeOptionsProvider } from '../dataFeeds/cboeOptionsFeed.js';
import { fetchBinanceAggTrades } from '../dataFeeds/historyFeed.js';
import { FootprintEngine } from '../footprintEngine.js';
import { FUTURES_INSTRUMENTS, FuturesInstrument } from '../futuresConfig.js';
import { GEXEngine, GEXProfile } from '../gexEngine.js';
import { OrderbookManager } from '../orderbook.js';
import { ProfileEngine } from '../profileEngine.js';
import { ChartSession } from '../session.js';
import { TapeEngine } from '../tapeEngine.js';
import {
  HistoricalBar,
  OrderbookSnapshot,
  Tick,
  WSServerMessage,
} from '../types.js';
import { VWAPEngine } from '../vwapEngine.js';
import { createMarketDataFeed } from './registry.js';
import { resolveVendorSymbol } from './tradovateAdapter.js';
import { readTradovateConfig } from './tradovateConfig.js';
import { fetchTradovateHistoryBars } from './tradovateHistory.js';
import { FeedStatusEvent, MarketDataFeed, MarketDepthEvent, MarketTrade } from './types.js';

export const TIMEFRAMES: Record<string, number> = {
  '1s': 1000,
  '5s': 5000,
  '15s': 15000,
  '30s': 30000,
  '1m': 60000,
  '5m': 300000,
  '15m': 900000,
  '1h': 3600000,
};

const WHALE_LOTS_EQUIVALENT = 10;
const CRYPTO_WHALE_USD = 50000;

export type HistorySource = 'NONE' | 'REAL_TICKS' | 'REAL_BARS';

/**
 * MarketContext manages the live feed, orderbook, footprint engines, profile,
 * vwap, tape and subscribers for a single instrument.
 *
 * Multiple tabs watching the same instrument share the same underlying feed
 * and engines without duplicate connections or cross-tab state pollution.
 */
export class MarketContext {
  public readonly symbol: string;
  public readonly instrument: FuturesInstrument;
  public feed: MarketDataFeed | null = null;
  public provider = 'none';
  public feedStatus: 'LIVE' | 'UNAVAILABLE' = 'UNAVAILABLE';
  public feedReason: string | undefined = 'no feed connected yet';
  public lastTradeTs = 0;
  public lastDepthTs = 0;

  private activeFeedToken = 0;
  private orderbook: OrderbookManager;
  private tape: TapeEngine;
  private profile: ProfileEngine;
  private vwap: VWAPEngine;
  private footprintEngines = new Map<string, FootprintEngine>();
  private subscribers = new Set<ChartSession>();

  private historySource: HistorySource = 'NONE';
  private historyBars: HistoricalBar[] = [];
  private historyTicks: Tick[] = [];
  private historyRequest = new AbortController();
  private historyBoundary = Date.now();

  private cachedBook: OrderbookSnapshot | null = null;
  private cachedBookTime = 0;
  private lastOrderbookUpdate = 0;
  private lastBarUpdateByTf = new Map<string, number>();
  private lastSpeedOfTapeUpdate = 0;
  private lastProfileUpdate = 0;
  private lastVwapUpdate = 0;

  private gexEngine: GEXEngine;
  private cboeProvider: CboeOptionsProvider;
  private cachedGexProfile?: GEXProfile;

  // Cleanup grace timer when subscriber count reaches 0
  private cleanupTimer: NodeJS.Timeout | null = null;

  constructor(
    symbol: string,
    instrument: FuturesInstrument,
    gexEngine: GEXEngine,
    cboeProvider: CboeOptionsProvider,
    private onTickRecord?: (tick: Tick) => void
  ) {
    this.symbol = symbol;
    this.instrument = instrument;
    this.gexEngine = gexEngine;
    this.cboeProvider = cboeProvider;

    this.orderbook = new OrderbookManager(50);
    this.profile = new ProfileEngine(this.instrument.tickSize);
    this.vwap = new VWAPEngine();
    this.tape = new TapeEngine(this.computeDeepTradeThresholdUsd(), 15.0);

    // Initialize default footprint engine (1m)
    this.ensureFootprintEngine('1m');
  }

  public computeDeepTradeThresholdUsd(): number {
    if (this.instrument.category === 'CRYPTO') return CRYPTO_WHALE_USD;
    return Math.round(this.instrument.pointValue * this.instrument.basePrice * WHALE_LOTS_EQUIVALENT);
  }

  public get subscriberCount(): number {
    return this.subscribers.size;
  }

  public getBook(): OrderbookSnapshot {
    const now = Date.now();
    if (!this.cachedBook || now - this.cachedBookTime > 5) {
      this.cachedBook = this.orderbook.getSnapshot();
      this.cachedBookTime = now;
    }
    return this.cachedBook;
  }

  public ensureFootprintEngine(timeframe: string): FootprintEngine {
    let engine = this.footprintEngines.get(timeframe);
    if (!engine) {
      const durationMs = TIMEFRAMES[timeframe] || 60000;
      engine = new FootprintEngine(this.instrument.tickSize, durationMs, 3.0, 1.0, 3);
      // Seed with recent history ticks if available
      for (const tick of this.historyTicks) {
        engine.processTick(tick);
      }
      this.footprintEngines.set(timeframe, engine);
    }
    return engine;
  }

  public async startFeed(): Promise<void> {
    await this.stopFeed();

    const token = ++this.activeFeedToken;
    this.lastTradeTs = 0;
    this.lastDepthTs = 0;

    const { feed, provider } = createMarketDataFeed(this.symbol, this.instrument, {
      onTrade: (trade: MarketTrade) => {
        if (token !== this.activeFeedToken) return;
        this.handleTrade(trade);
      },
      onDepth: (event: MarketDepthEvent) => {
        if (token !== this.activeFeedToken) return;
        this.handleDepth(event);
      },
      onStatus: (status: FeedStatusEvent) => {
        if (token !== this.activeFeedToken) return;
        if (status.provider !== provider) return;
        this.feedReason = status.reason;
        this.setFeedStatus(status.state === 'LIVE' ? 'LIVE' : 'UNAVAILABLE');
      },
      onError: (error: Error) => {
        if (token !== this.activeFeedToken) return;
        console.warn(`[Feed:${provider}] ${this.symbol}: ${error.message}`);
        this.setFeedStatus('UNAVAILABLE');
      },
    });

    this.feed = feed;
    this.provider = provider;
    this.feedReason = provider === 'none' ? 'no licensed realtime vendor configured for futures' : 'connecting';
    console.log(`[MarketContext] Feed provider '${provider}' starting for ${this.symbol}`);

    try {
      await feed.connect();
    } catch (err) {
      this.feedReason = (err as Error).message;
      this.setFeedStatus('UNAVAILABLE');
      console.warn(`[Feed:${provider}] ${this.symbol} failed to connect: ${this.feedReason}`);
    }

    // Refresh GEX and backfill history
    if (this.instrument.underlyingIndex) {
      void this.refreshGex();
    }
    void this.backfillHistory();
  }

  public async stopFeed(): Promise<void> {
    const previous = this.feed;
    this.feed = null;
    if (!previous) return;
    try {
      await previous.disconnect();
    } catch (err) {
      console.warn(`[Feed:${previous.provider}] disconnect failed: ${(err as Error).message}`);
    }
  }

  public setFeedStatus(next: 'UNAVAILABLE' | 'LIVE'): void {
    if (next === this.feedStatus) return;
    this.feedStatus = next;
    console.log(`[MarketContext] ${this.symbol}: ${this.feedStatus}${this.feedReason ? ` (${this.feedReason})` : ''}`);

    // Update subscribers of this symbol
    for (const session of this.subscribers) {
      session.send(this.buildInitState(session, session.subscribedTimeframe));
    }
  }

  private handleTrade(trade: MarketTrade): void {
    this.lastTradeTs = Date.now();
    if (this.feedStatus !== 'LIVE') this.setFeedStatus('LIVE');

    const tick: Tick = {
      id: trade.id ?? `md_${this.symbol}_${trade.ts}`,
      timestamp: trade.ts,
      price: trade.price,
      size: trade.size,
      side: trade.side === 'BUY' ? 'buy' : trade.side === 'SELL' ? 'sell' : 'unknown',
      isBuyerMaker: trade.side === 'BUY' ? false : trade.side === 'SELL' ? true : undefined,
    };

    // Buffer recent ticks (bounded to 2000)
    this.historyTicks.push(tick);
    if (this.historyTicks.length > 2000) {
      this.historyTicks.shift();
    }

    if (this.onTickRecord) {
      this.onTickRecord(tick);
    }

    // 1. Process footprint for each active timeframe
    const now = Date.now();
    for (const [tf, engine] of this.footprintEngines.entries()) {
      const { currentBar, closedBar } = engine.processTick(tick);

      // Send to subscribers subscribed to this timeframe
      for (const session of this.subscribers) {
        if (session.subscribedTimeframe !== tf) continue;

        if (closedBar) {
          session.send({ type: 'BAR_CLOSE', bar: closedBar });
        }

        const lastBarUpdate = this.lastBarUpdateByTf.get(tf) || 0;
        if (now - lastBarUpdate > 100) {
          session.send({ type: 'BAR_UPDATE', bar: currentBar });
        }
      }

      const lastBarUpdate = this.lastBarUpdateByTf.get(tf) || 0;
      if (now - lastBarUpdate > 100) {
        this.lastBarUpdateByTf.set(tf, now);
      }
    }

    // 2. Process Profile & VWAP
    this.profile.processTick(tick);
    const vwapPoint = this.vwap.processTick(tick);

    // 3. Process Tape
    const currentBook = this.getBook();
    const { speed, deepTrade, absorption } = this.tape.processTick(
      tick,
      currentBook,
      this.instrument.pointValue,
      this.instrument.tickSize
    );

    // Send tick, tape, deep trade and absorption to all subscribers of this symbol
    for (const session of this.subscribers) {
      session.send({ type: 'TICK', tick });

      if (now - this.lastSpeedOfTapeUpdate > 250) {
        session.send({ type: 'SPEED_OF_TAPE', tape: speed });
      }

      if (deepTrade) {
        session.send({ type: 'DEEP_TRADE', trade: deepTrade });
      }

      if (absorption) {
        session.send({ type: 'ABSORPTION', alert: absorption });
      }

      // Throttled live profile updates (500ms)
      if (now - this.lastProfileUpdate > 500) {
        session.send({
          type: 'PROFILE_UPDATE',
          volumeProfile: this.profile.getVolumeProfile(),
          tpo: this.profile.getTPOProfile(),
        });
      }

      // Throttled live VWAP updates (500ms)
      if (vwapPoint && now - this.lastVwapUpdate > 500) {
        session.send({
          type: 'VWAP_UPDATE',
          point: vwapPoint,
        });
      }
    }

    if (now - this.lastSpeedOfTapeUpdate > 250) {
      this.lastSpeedOfTapeUpdate = now;
    }
    if (now - this.lastProfileUpdate > 500) {
      this.lastProfileUpdate = now;
    }
    if (vwapPoint && now - this.lastVwapUpdate > 500) {
      this.lastVwapUpdate = now;
    }
  }

  private handleDepth(event: MarketDepthEvent): void {
    this.lastDepthTs = Date.now();
    this.cachedBook = null;

    if (event.kind === 'snapshot') {
      this.orderbook.applySnapshot(
        event.bids.map((l) => [l.price, l.size] as [number, number]),
        event.asks.map((l) => [l.price, l.size] as [number, number]),
        event.updateId ?? event.ts
      );
    } else if (event.side === 'bid') {
      this.orderbook.applyDelta([[event.price, event.size]], [], event.updateId ?? event.ts);
    } else {
      this.orderbook.applyDelta([], [[event.price, event.size]], event.updateId ?? event.ts);
    }

    const now = Date.now();
    if (now - this.lastOrderbookUpdate > 100) {
      const snap = this.orderbook.getSnapshot();
      for (const session of this.subscribers) {
        session.send({ type: 'ORDERBOOK_UPDATE', orderbook: snap });
      }
      this.lastOrderbookUpdate = now;
    }
  }

  public async refreshGex(force = false): Promise<void> {
    const underlying = this.instrument.underlyingIndex;
    if (!underlying) return;

    const chain = await this.cboeProvider.fetchChain(underlying, force);
    if (!chain) return;

    const profile = this.gexEngine.buildFromChain(underlying, chain.spotPrice, chain.contracts);
    this.cachedGexProfile = profile;
    for (const session of this.subscribers) {
      session.send({ type: 'GEX_UPDATE', profile });
    }
  }

  public async backfillHistory(timeframe = '1m'): Promise<void> {
    const symbol = this.symbol;
    const signal = this.historyRequest.signal;
    const beforeTime = this.historyBoundary;
    let ticks: Tick[] = [];
    let source: HistorySource = 'NONE';

    try {
      if (symbol === 'BTCUSDT') {
        ticks = await fetchBinanceAggTrades(symbol, 3);
        if (ticks.length > 0) source = 'REAL_TICKS';
      } else if ((process.env.FUTURES_PROVIDER || '').toLowerCase() === 'tradovate') {
        const tfMs = TIMEFRAMES[timeframe] || 60000;
        if (tfMs < 60000) return;
        const config = readTradovateConfig();
        const bars = await fetchTradovateHistoryBars(
          resolveVendorSymbol(symbol, this.instrument, config),
          config,
          { barMinutes: tfMs / 60000, elements: 300, beforeTime, signal }
        );
        if (signal.aborted) return;
        if (bars.length > 0) {
          this.historyBars = bars;
          this.historySource = 'REAL_BARS';
          console.log(`[History] ${symbol}: ${bars.length} real bar(s) from tradovate`);
          for (const session of this.subscribers) {
            session.send(this.buildInitState(session, session.subscribedTimeframe));
          }
        } else {
          this.historySource = 'NONE';
        }
        return;
      }

      if (signal.aborted) return;

      this.historySource = source;
      if (ticks.length === 0) return;

      this.historyTicks = [...ticks];
      if (this.onTickRecord) {
        for (const tick of ticks) {
          this.onTickRecord(tick);
        }
      }
      for (const engine of this.footprintEngines.values()) {
        for (const tick of ticks) {
          engine.processTick(tick);
        }
      }
      for (const tick of ticks) {
        this.profile.processTick(tick);
        this.vwap.processTick(tick);
      }

      console.log(`[History] ${symbol}: seeded ${ticks.length} ticks (${source})`);
      for (const session of this.subscribers) {
        session.send(this.buildInitState(session, session.subscribedTimeframe));
      }
    } catch (err) {
      console.warn(`[History] backfill failed for ${symbol}: ${(err as Error).message}`);
    }
  }

  public addSubscriber(session: ChartSession, timeframe: string): void {
    if (this.cleanupTimer) {
      clearTimeout(this.cleanupTimer);
      this.cleanupTimer = null;
    }

    session.subscribedSymbol = this.symbol;
    session.subscribedTimeframe = timeframe;
    this.ensureFootprintEngine(timeframe);
    this.subscribers.add(session);

    session.send(this.buildInitState(session, timeframe));
  }

  public removeSubscriber(session: ChartSession): void {
    this.subscribers.delete(session);
  }

  public changeTimeframe(session: ChartSession, timeframe: string): void {
    session.subscribedTimeframe = timeframe;
    this.ensureFootprintEngine(timeframe);
    session.send(this.buildInitState(session, timeframe));
  }

  public buildInitState(session: ChartSession, timeframe: string): WSServerMessage {
    const engine = this.ensureFootprintEngine(timeframe);
    const underlying = this.instrument.underlyingIndex || 'SPX';
    return {
      type: 'INIT_STATE',
      symbol: this.symbol,
      instrument: this.instrument,
      bars: engine.getAllBars(),
      orderbook: this.orderbook.getSnapshot(),
      volumeProfile: this.profile.getVolumeProfile(),
      tpo: this.profile.getTPOProfile(),
      vwap: this.vwap.getHistory(),
      cvdHistory: engine.getAllBars().map((b) => ({ time: b.time, cvd: b.cvd })),
      gexProfile: this.cachedGexProfile || (this.instrument.underlyingIndex ? this.gexEngine.getProfile(underlying) : undefined),
      optionsFlow: this.gexEngine.getRecentFlow(),
      deepTradeThresholdUsd: this.computeDeepTradeThresholdUsd(),
      timeframe,
      historySource: this.historySource,
      historyBars: this.historyBars,
      feedStatus: this.feedStatus,
    };
  }

  public scheduleCleanup(onDispose: () => void, graceMs = 10000): void {
    if (this.cleanupTimer) clearTimeout(this.cleanupTimer);
    this.cleanupTimer = setTimeout(() => {
      if (this.subscribers.size === 0) {
        void this.stopFeed().then(() => onDispose());
      }
    }, graceMs);
  }
}

/**
 * Global manager for all instrument contexts.
 */
export class MarketContextManager {
  private contexts = new Map<string, MarketContext>();
  private gexEngine = new GEXEngine();
  private cboeProvider = new CboeOptionsProvider();

  constructor(private onTickRecord?: (tick: Tick) => void) {}

  public getContext(symbol: string): MarketContext | undefined {
    return this.contexts.get(symbol);
  }

  public async getOrCreateContext(symbol: string): Promise<MarketContext> {
    let ctx = this.contexts.get(symbol);
    if (!ctx) {
      const instrument = FUTURES_INSTRUMENTS[symbol] || FUTURES_INSTRUMENTS.ES;
      ctx = new MarketContext(symbol, instrument, this.gexEngine, this.cboeProvider, this.onTickRecord);
      this.contexts.set(symbol, ctx);
      await ctx.startFeed();
    }
    return ctx;
  }

  public async subscribe(session: ChartSession, symbol: string, timeframe: string): Promise<void> {
    // If currently subscribed to another symbol, remove from old context
    if (session.subscribedSymbol && session.subscribedSymbol !== symbol) {
      const oldCtx = this.contexts.get(session.subscribedSymbol);
      if (oldCtx) {
        oldCtx.removeSubscriber(session);
        if (oldCtx.subscriberCount === 0 && oldCtx.symbol !== 'BTCUSDT') {
          oldCtx.scheduleCleanup(() => {
            this.contexts.delete(oldCtx.symbol);
          });
        }
      }
    }

    const ctx = await this.getOrCreateContext(symbol);
    ctx.addSubscriber(session, timeframe);
  }

  public unsubscribe(session: ChartSession): void {
    if (session.subscribedSymbol) {
      const ctx = this.contexts.get(session.subscribedSymbol);
      if (ctx) {
        ctx.removeSubscriber(session);
        if (ctx.subscriberCount === 0 && ctx.symbol !== 'BTCUSDT') {
          ctx.scheduleCleanup(() => {
            this.contexts.delete(ctx.symbol);
          });
        }
      }
    }
  }

  public getGexEngine(): GEXEngine {
    return this.gexEngine;
  }
}
