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
import { marketDataStore } from '../storage/marketDataStore.js';
import { SessionCalendar } from '../calendar/sessionCalendar.js';

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
const GEX_REFRESH_MS = parseInt(process.env.GEX_REFRESH_MS || '300000', 10);

export type HistorySource = 'NONE' | 'REAL_TICKS' | 'REAL_BARS';

export interface HistoryProvider {
  fetchBinanceAggTrades(symbol: string, pages?: number): Promise<Tick[]>;
  fetchTradovateBars(
    vendorSymbol: string,
    config: any,
    options: { barMinutes: number; elements: number; beforeTime: number; signal: AbortSignal }
  ): Promise<HistoricalBar[]>;
}

export const defaultHistoryProvider: HistoryProvider = {
  fetchBinanceAggTrades,
  fetchTradovateBars: fetchTradovateHistoryBars,
};

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
  private historyBarsByTf = new Map<string, HistoricalBar[]>();
  private historyTicks: Tick[] = [];
  private historyRequest = new AbortController();
  private historyBoundary = Date.now();
  private isBackfillingHistory = false;
  private liveBuffer: Tick[] = [];

  private recentVendorTickIds = new Map<string, true>();
  private readonly MAX_DEDUP_IDS = 5000;
  private generatedSeq = 0;
  private pendingHistoryFetches = new Map<string, { token: number; promise: Promise<HistoricalBar[]> }>();
  private feedLifecycleState: 'STARTING' | 'RUNNING' | 'STOPPING' | 'STOPPED' = 'STOPPED';
  private feedTransitionPromise: Promise<void> = Promise.resolve();
  private lastTradeSeq: number | undefined;
  private lastTradeEventTs = 0;
  private lastDepthUpdateId: number | undefined;

  private trackVendorTickId(id: string): boolean {
    if (this.recentVendorTickIds.has(id)) {
      return false;
    }
    this.recentVendorTickIds.set(id, true);
    if (this.recentVendorTickIds.size > this.MAX_DEDUP_IDS) {
      const oldest = this.recentVendorTickIds.keys().next().value;
      if (oldest !== undefined) this.recentVendorTickIds.delete(oldest);
    }
    return true;
  }

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
  private gexTimer: NodeJS.Timeout | null = null;

  // Cleanup grace timer when subscriber count reaches 0
  private cleanupTimer: NodeJS.Timeout | null = null;

  constructor(
    symbol: string,
    instrument: FuturesInstrument,
    gexEngine = new GEXEngine(),
    cboeProvider = new CboeOptionsProvider(),
    private onTickRecord?: (tick: Tick) => void,
    private historyProvider: HistoryProvider = defaultHistoryProvider
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

  public getHistoryTicks(): Tick[] {
    return [...this.historyTicks];
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
    this.feedTransitionPromise = this.feedTransitionPromise
      .then(() => this.doStartFeed())
      .catch((err) => {
        console.warn(`[MarketContext] startFeed failed for ${this.symbol}:`, err);
      });
    return this.feedTransitionPromise;
  }

  public async stopFeed(): Promise<void> {
    this.feedTransitionPromise = this.feedTransitionPromise
      .then(() => this.doStopFeed())
      .catch((err) => {
        console.warn(`[MarketContext] stopFeed failed for ${this.symbol}:`, err);
      });
    return this.feedTransitionPromise;
  }

  private async doStartFeed(): Promise<void> {
    if (this.feedLifecycleState === 'RUNNING' || this.feedLifecycleState === 'STARTING') {
      await this.doStopFeed();
    }

    this.feedLifecycleState = 'STARTING';
    const token = ++this.activeFeedToken;
    this.lastTradeTs = 0;
    this.lastDepthTs = 0;
    this.historyBoundary = Date.now();
    this.historyRequest = new AbortController();
    this.isBackfillingHistory = true;
    this.liveBuffer = [];

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
        const prevStatus = this.feedStatus;
        this.feedReason = status.reason;
        const nextStatus = status.state === 'LIVE' ? 'LIVE' : 'UNAVAILABLE';
        this.setFeedStatus(nextStatus);

        // Reconnect gap detection: if returning to LIVE after being UNAVAILABLE
        if (prevStatus === 'UNAVAILABLE' && nextStatus === 'LIVE' && this.lastTradeTs > 0) {
          const disconnectDurationMs = Date.now() - this.lastTradeTs;
          if (disconnectDurationMs > 3000) {
            console.warn(`[MarketContext] Reconnected after ${disconnectDurationMs}ms. Backfilling gap.`);
            marketDataStore.recordGap(
              this.symbol,
              this.provider,
              this.lastTradeTs,
              Date.now(),
              `Feed reconnected after ${Math.round(disconnectDurationMs / 1000)}s`
            );
            void this.backfillHistory();
          }
        }
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
      if (token !== this.activeFeedToken) return;
      this.feedReason = (err as Error).message;
      this.setFeedStatus('UNAVAILABLE');
      console.warn(`[Feed:${provider}] ${this.symbol} failed to connect: ${this.feedReason}`);
    }

    if (token !== this.activeFeedToken) {
      // Feed token superseded while connecting — disconnect this feed
      try {
        await feed.disconnect();
      } catch {
        // ignore
      }
      return;
    }

    this.feedLifecycleState = 'RUNNING';

    // Refresh GEX and backfill history
    if (this.instrument.underlyingIndex) {
      void this.refreshGex();
      if (this.gexTimer) clearInterval(this.gexTimer);
      this.gexTimer = setInterval(() => {
        void this.refreshGex();
      }, GEX_REFRESH_MS);
    }
    void this.backfillHistory();
  }

  private async doStopFeed(): Promise<void> {
    this.feedLifecycleState = 'STOPPING';
    // Invalidate token immediately to drop in-flight events
    ++this.activeFeedToken;
    if (this.gexTimer) {
      clearInterval(this.gexTimer);
      this.gexTimer = null;
    }
    this.historyRequest.abort();
    this.isBackfillingHistory = false;
    this.liveBuffer = [];
    const previous = this.feed;
    this.feed = null;
    if (previous) {
      try {
        await previous.disconnect();
      } catch (err) {
        console.warn(`[Feed:${previous.provider}] disconnect failed: ${(err as Error).message}`);
      }
    }
    this.feedLifecycleState = 'STOPPED';
  }

  public setFeedStatus(next: 'UNAVAILABLE' | 'LIVE'): void {
    if (next === this.feedStatus) return;
    this.feedStatus = next;
    console.log(`[MarketContext] ${this.symbol}: ${this.feedStatus}${this.feedReason ? ` (${this.feedReason})` : ''}`);

    // Update subscribers of this symbol
    for (const session of this.subscribers) {
      if (session.isReplay()) continue;
      session.send(this.buildInitState(session, session.subscribedTimeframe));
    }
  }

  private handleTrade(trade: MarketTrade): void {
    // 1. Validation: reject malformed or non-positive trade values
    if (
      !Number.isFinite(trade.price) ||
      trade.price <= 0 ||
      !Number.isFinite(trade.size) ||
      trade.size <= 0 ||
      !Number.isFinite(trade.ts) ||
      trade.ts <= 0
    ) {
      return;
    }

    // 2. Centralized Deduplication: drop duplicate vendor trades before fan-out
    let tickId: string;
    if (trade.id) {
      if (!this.trackVendorTickId(trade.id)) {
        return;
      }
      tickId = trade.id;
    } else {
      // Distinct ID for trades without vendor ID prevents accidental collision
      tickId = `gen_${this.symbol}_${trade.ts}_${++this.generatedSeq}`;
    }

    this.lastTradeTs = Date.now();
    if (this.feedStatus !== 'LIVE') this.setFeedStatus('LIVE');

    // 3. Trade Sequence Gap Detection
    if (trade.sequenceId !== undefined) {
      const seq = typeof trade.sequenceId === 'number' ? trade.sequenceId : parseInt(String(trade.sequenceId), 10);
      if (Number.isFinite(seq)) {
        if (this.lastTradeSeq !== undefined && seq > this.lastTradeSeq + 1) {
          const gapCount = seq - (this.lastTradeSeq + 1);
          console.warn(`[MarketContext] Trade sequence gap for ${this.symbol}: expected ${this.lastTradeSeq + 1}, got ${seq} (${gapCount} missing)`);
          marketDataStore.recordGap(
            this.symbol,
            this.provider,
            this.lastTradeEventTs || trade.ts,
            trade.ts,
            `Trade sequence gap (${gapCount} missing): ${this.lastTradeSeq} -> ${seq}`
          );
        }
        this.lastTradeSeq = seq;
      }
    }

    // 4. Session Rollover Detection (Reset VWAP & Profile on official session boundaries)
    if (this.lastTradeEventTs > 0 && SessionCalendar.isNewSession(this.lastTradeEventTs, trade.ts, this.instrument.sessionScheduleId)) {
      console.log(`[MarketContext] Session boundary crossed for ${this.symbol}. Resetting intraday profile & VWAP.`);
      this.profile.reset(trade.ts);
      this.vwap.reset(trade.ts);
    }
    this.lastTradeEventTs = trade.ts;

    const tick: Tick = {
      id: tickId,
      timestamp: trade.ts,
      price: trade.price,
      size: trade.size,
      side: trade.side === 'BUY' ? 'buy' : trade.side === 'SELL' ? 'sell' : 'unknown',
      isBuyerMaker: trade.side === 'BUY' ? false : trade.side === 'SELL' ? true : undefined,
      receiveTs: trade.receiveTs,
      aggressorProvenance: trade.aggressorProvenance,
      sequenceId: trade.sequenceId !== undefined ? String(trade.sequenceId) : undefined,
      sourceProvider: trade.sourceProvider || this.provider,
      qualityFlags: trade.qualityFlags,
    };

    // Persist normalized trade
    marketDataStore.saveTrades([trade], this.symbol, this.provider);

    // Buffer recent ticks (strictly maintained in timestamp ascending order)
    if (!this.isBackfillingHistory) {
      if (this.historyTicks.length > 0 && tick.timestamp < this.historyTicks[this.historyTicks.length - 1].timestamp) {
        let low = 0;
        let high = this.historyTicks.length - 1;
        while (low <= high) {
          const mid = Math.floor((low + high) / 2);
          if (this.historyTicks[mid].timestamp <= tick.timestamp) {
            low = mid + 1;
          } else {
            high = mid - 1;
          }
        }
        this.historyTicks.splice(low, 0, tick);
      } else {
        this.historyTicks.push(tick);
      }
      if (this.historyTicks.length > 5000) {
        this.historyTicks.shift();
      }
    }

    if (this.onTickRecord) {
      this.onTickRecord(tick);
    }

    if (this.isBackfillingHistory) {
      this.liveBuffer.push(tick);
      for (const session of this.subscribers) {
        if (session.isReplay()) continue;
        session.send({ type: 'TICK', tick });
      }
      return;
    }

    // 1. Process footprint for each active timeframe
    const now = Date.now();
    for (const [tf, engine] of this.footprintEngines.entries()) {
      const { currentBar, closedBar, correctedBar, affectedBars } = engine.processTick(tick);

      // Persist closed bar to store
      if (closedBar) {
        marketDataStore.saveBar(closedBar, this.symbol, tf, this.provider);
      }

      // Send to subscribers subscribed to this timeframe
      for (const session of this.subscribers) {
        if (session.isReplay()) continue;
        if (session.subscribedTimeframe !== tf) continue;

        if (affectedBars && affectedBars.length > 0) {
          for (const bar of affectedBars) {
            session.send({ type: 'BAR_UPDATE', bar });
          }
        } else {
          if (correctedBar) {
            session.send({ type: 'BAR_UPDATE', bar: correctedBar });
          }

          if (closedBar) {
            session.send({ type: 'BAR_CLOSE', bar: closedBar });
          }

          const lastBarUpdate = this.lastBarUpdateByTf.get(tf) || 0;
          if (now - lastBarUpdate > 100 || correctedBar) {
            session.send({ type: 'BAR_UPDATE', bar: currentBar });
          }
        }
      }

      const lastBarUpdate = this.lastBarUpdateByTf.get(tf) || 0;
      if (now - lastBarUpdate > 100 || correctedBar || (affectedBars && affectedBars.length > 0)) {
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
      if (session.isReplay()) continue;
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
      const snapUpdateId = event.updateId ?? event.ts;
      this.lastDepthUpdateId = snapUpdateId;
      this.orderbook.applySnapshot(
        event.bids.map((l) => [l.price, l.size] as [number, number]),
        event.asks.map((l) => [l.price, l.size] as [number, number]),
        snapUpdateId
      );
    } else {
      const deltaUpdateId = event.updateId ?? event.ts;
      if (event.updateId !== undefined && this.lastDepthUpdateId !== undefined && event.updateId > this.lastDepthUpdateId + 1) {
        const gapCount = event.updateId - (this.lastDepthUpdateId + 1);
        console.warn(`[MarketContext] Depth sequence gap for ${this.symbol}: expected ${this.lastDepthUpdateId + 1}, got ${event.updateId} (${gapCount} missing)`);
        marketDataStore.recordGap(
          this.symbol,
          this.provider,
          this.lastDepthTs || event.ts,
          event.ts,
          `Depth sequence gap (${gapCount} missing): ${this.lastDepthUpdateId} -> ${event.updateId}`
        );
      }
      this.lastDepthUpdateId = deltaUpdateId;

      if (event.side === 'bid') {
        this.orderbook.applyDelta([[event.price, event.size]], [], deltaUpdateId);
      } else {
        this.orderbook.applyDelta([], [[event.price, event.size]], deltaUpdateId);
      }
    }

    const now = Date.now();
    if (now - this.lastOrderbookUpdate > 100) {
      const snap = this.orderbook.getSnapshot();
      for (const session of this.subscribers) {
        if (session.isReplay()) continue;
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
      if (session.isReplay()) continue;
      session.send({ type: 'GEX_UPDATE', profile });
    }
  }

  public async backfillHistory(timeframe = '1m'): Promise<void> {
    const token = this.activeFeedToken;
    const symbol = this.symbol;
    const signal = this.historyRequest.signal;
    const beforeTime = this.historyBoundary;
    let ticks: Tick[] = [];
    let source: HistorySource = 'NONE';

    try {
      if (symbol === 'BTCUSDT') {
        try {
          ticks = await this.historyProvider.fetchBinanceAggTrades(symbol, 3);
          if (ticks.length > 0) {
            source = 'REAL_TICKS';
            marketDataStore.saveTrades(ticks, symbol, 'binance');
          }
        } catch (fetchErr) {
          console.warn(`[History] fetchBinanceAggTrades failed for ${symbol}: ${(fetchErr as Error).message}`);
          const stored = marketDataStore.queryTrades({ provider: 'binance', symbol, limit: 5000, beforeTime });
          if (stored.trades.length > 0) {
            ticks = stored.trades;
            source = 'REAL_TICKS';
          }
        }
      } else {
        const bars = await this.ensureHistoryBars(timeframe);
        if (signal.aborted || token !== this.activeFeedToken) return;
        if (bars.length > 0) {
          console.log(`[History] ${symbol}: ${bars.length} real bar(s) (${timeframe})`);
        }
        return;
      }

      if (signal.aborted || token !== this.activeFeedToken) return;

      this.historySource = source;
      const combined = [...this.historyTicks, ...ticks, ...this.liveBuffer];
      this.liveBuffer = [];

      if (combined.length > 0) {
        // Dedup and sort merged ticks strictly by timestamp ascending
        const seenKeys = new Set<string>();
        const uniqueSortedTicks = combined
          .filter((t) => {
            const key = t.id || `${t.timestamp}:${t.price}:${t.size}:${t.side}`;
            if (seenKeys.has(key)) return false;
            seenKeys.add(key);
            return true;
          })
          .sort((a, b) => a.timestamp - b.timestamp);

        this.historyTicks = uniqueSortedTicks.slice(-5000);

        // Seed recentVendorTickIds so live stream cannot re-ingest ticks that were already in history
        // Invariant: each ID has exactly one entry, maintaining strict LRU ordering
        for (const tick of uniqueSortedTicks) {
          if (tick.id) {
            this.recentVendorTickIds.delete(tick.id);
            this.recentVendorTickIds.set(tick.id, true);
            if (this.recentVendorTickIds.size > this.MAX_DEDUP_IDS) {
              const oldest = this.recentVendorTickIds.keys().next().value;
              if (oldest !== undefined) this.recentVendorTickIds.delete(oldest);
            }
          }
        }

        if (this.onTickRecord) {
          for (const tick of uniqueSortedTicks) {
            this.onTickRecord(tick);
          }
        }

        // Reset engines with deterministic first timestamp before seeding
        const firstTs = uniqueSortedTicks[0]?.timestamp || 0;
        this.profile.reset(firstTs);
        this.vwap.reset(firstTs);

        for (const [tf] of this.footprintEngines) {
          const durationMs = TIMEFRAMES[tf] || 60000;
          this.footprintEngines.set(tf, new FootprintEngine(this.instrument.tickSize, durationMs, 3.0, 1.0, 3));
        }

        for (const engine of this.footprintEngines.values()) {
          for (const tick of uniqueSortedTicks) {
            engine.processTick(tick);
          }
        }
        for (const tick of uniqueSortedTicks) {
          this.profile.processTick(tick);
          this.vwap.processTick(tick);
        }

        console.log(`[History] ${symbol}: seeded ${uniqueSortedTicks.length} ticks (${source})`);
      }
    } catch (err) {
      console.warn(`[History] backfill failed for ${symbol}: ${(err as Error).message}`);
    } finally {
      // Guard before ANY mutation: if this backfill run is no longer current or was aborted,
      // DO NOT touch this.isBackfillingHistory or this.liveBuffer!
      if (token !== this.activeFeedToken || signal.aborted) {
        return;
      }

      this.isBackfillingHistory = false;

      // Drain any ticks that arrived during the processing window
      while (this.liveBuffer.length > 0) {
        const remaining = this.liveBuffer.splice(0, this.liveBuffer.length);
        remaining.sort((a, b) => a.timestamp - b.timestamp);
        for (const tick of remaining) {
          if (this.historyTicks.length > 0 && tick.timestamp < this.historyTicks[this.historyTicks.length - 1].timestamp) {
            let low = 0;
            let high = this.historyTicks.length - 1;
            while (low <= high) {
              const mid = Math.floor((low + high) / 2);
              if (this.historyTicks[mid].timestamp <= tick.timestamp) {
                low = mid + 1;
              } else {
                high = mid - 1;
              }
            }
            this.historyTicks.splice(low, 0, tick);
          } else {
            this.historyTicks.push(tick);
          }
          if (this.historyTicks.length > 5000) this.historyTicks.shift();
          for (const engine of this.footprintEngines.values()) {
            engine.processTick(tick);
          }
          this.profile.processTick(tick);
          this.vwap.processTick(tick);
        }
      }

      for (const session of this.subscribers) {
        if (session.isReplay()) continue;
        session.send(this.buildInitState(session, session.subscribedTimeframe));
      }
    }
  }

  public async ensureHistoryBars(timeframe: string): Promise<HistoricalBar[]> {
    const cached = this.historyBarsByTf.get(timeframe);
    if (cached && cached.length > 0) return cached;

    if ((process.env.FUTURES_PROVIDER || '').toLowerCase() !== 'tradovate') {
      // Check persistent store if no live futures provider configured
      const provider = this.provider || (this.symbol === 'BTCUSDT' ? 'binance' : (process.env.FUTURES_PROVIDER || 'tradovate'));
      const stored = marketDataStore.queryBars({
        provider,
        symbol: this.symbol,
        timeframe,
        limit: 300,
        beforeTime: this.historyBoundary,
      });
      if (stored.bars.length > 0) {
        this.historyBarsByTf.set(timeframe, stored.bars);
        this.historyBars = stored.bars;
        this.historySource = 'REAL_BARS';
        return stored.bars;
      }
      return [];
    }

    const currentToken = this.activeFeedToken;
    const existing = this.pendingHistoryFetches.get(timeframe);
    if (existing && existing.token === currentToken) {
      return existing.promise;
    }

    const fetchPromise = (async () => {
      const token = currentToken;
      const signal = this.historyRequest.signal;
      try {
        const tfMs = TIMEFRAMES[timeframe] || 60000;
        if (tfMs < 60000) return [];
        const config = readTradovateConfig();
        const bars = await this.historyProvider.fetchTradovateBars(
          resolveVendorSymbol(this.symbol, this.instrument, config),
          config,
          { barMinutes: tfMs / 60000, elements: 300, beforeTime: this.historyBoundary, signal }
        );
        if (signal.aborted || token !== this.activeFeedToken) return [];
        if (bars.length > 0) {
          marketDataStore.saveBars(bars, this.symbol, timeframe, 'tradovate');
          this.historyBarsByTf.set(timeframe, bars);
          this.historyBars = bars;
          this.historySource = 'REAL_BARS';
        }
        return bars;
      } catch (err) {
        // Fallback to persistent store on provider error
        const provider = this.provider || (this.symbol === 'BTCUSDT' ? 'binance' : 'tradovate');
        const stored = marketDataStore.queryBars({
          provider,
          symbol: this.symbol,
          timeframe,
          limit: 300,
          beforeTime: this.historyBoundary,
        });
        if (stored.bars.length > 0) {
          this.historyBarsByTf.set(timeframe, stored.bars);
          this.historyBars = stored.bars;
          this.historySource = 'REAL_BARS';
          return stored.bars;
        }
        throw err;
      } finally {
        const current = this.pendingHistoryFetches.get(timeframe);
        if (current && current.token === token) {
          this.pendingHistoryFetches.delete(timeframe);
        }
      }
    })();

    this.pendingHistoryFetches.set(timeframe, { token: currentToken, promise: fetchPromise });
    return fetchPromise;
  }

  public addSubscriber(session: ChartSession, timeframe: string): void {
    if (this.cleanupTimer) {
      clearTimeout(this.cleanupTimer);
      this.cleanupTimer = null;
    }

    session.subscribedSymbol = this.symbol;
    session.subscribedTimeframe = timeframe;
    const gen = session.subscriptionGeneration;
    this.ensureFootprintEngine(timeframe);
    this.subscribers.add(session);

    session.send(this.buildInitState(session, timeframe));

    if (!this.historyBarsByTf.has(timeframe) && this.instrument.category !== 'CRYPTO') {
      void this.ensureHistoryBars(timeframe).then((bars) => {
        if (
          bars.length > 0 &&
          this.subscribers.has(session) &&
          session.subscribedSymbol === this.symbol &&
          session.subscribedTimeframe === timeframe &&
          session.subscriptionGeneration === gen &&
          session.isOpen &&
          !session.isReplay()
        ) {
          session.send(this.buildInitState(session, timeframe));
        }
      }).catch((err) => {
        console.warn(`[History] ensureHistoryBars failed for ${this.symbol}/${timeframe}: ${(err as Error).message}`);
      });
    }
  }

  public removeSubscriber(session: ChartSession): void {
    this.subscribers.delete(session);
  }

  public changeTimeframe(session: ChartSession, timeframe: string): void {
    session.subscribedTimeframe = timeframe;
    const gen = session.subscriptionGeneration;
    this.ensureFootprintEngine(timeframe);
    session.send(this.buildInitState(session, timeframe));

    if (!this.historyBarsByTf.has(timeframe) && this.instrument.category !== 'CRYPTO') {
      void this.ensureHistoryBars(timeframe).then((bars) => {
        if (
          bars.length > 0 &&
          this.subscribers.has(session) &&
          session.subscribedSymbol === this.symbol &&
          session.subscribedTimeframe === timeframe &&
          session.subscriptionGeneration === gen &&
          session.isOpen &&
          !session.isReplay()
        ) {
          session.send(this.buildInitState(session, timeframe));
        }
      }).catch((err) => {
        console.warn(`[History] ensureHistoryBars failed for ${this.symbol}/${timeframe}: ${(err as Error).message}`);
      });
    }
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
      historyBars: this.historyBarsByTf.get(timeframe) || [],
      feedStatus: this.feedStatus,
      mode: session.isReplay() ? session.mode : 'LIVE',
    };
  }

  public scheduleCleanup(onDispose: () => void, graceMs = 10000): void {
    if (this.cleanupTimer) clearTimeout(this.cleanupTimer);
    this.cleanupTimer = setTimeout(async () => {
      if (this.subscribers.size === 0) {
        await this.stopFeed();
        if (this.subscribers.size === 0) {
          onDispose();
        } else {
          // A new subscriber arrived during stopFeed teardown!
          await this.startFeed();
        }
      }
    }, graceMs);
  }

  public async dispose(): Promise<void> {
    if (this.cleanupTimer) {
      clearTimeout(this.cleanupTimer);
      this.cleanupTimer = null;
    }
    if (this.gexTimer) {
      clearInterval(this.gexTimer);
      this.gexTimer = null;
    }
    await this.stopFeed();
    this.subscribers.clear();
    this.historyBarsByTf.clear();
    this.pendingHistoryFetches.clear();
  }
}

/**
 * Global manager for all instrument contexts.
 */
export class MarketContextManager {
  private contexts = new Map<string, MarketContext>();
  private pendingInits = new Map<string, Promise<MarketContext>>();
  private gexEngine: GEXEngine;
  private cboeProvider: CboeOptionsProvider;

  constructor(
    private onTickRecord?: (tick: Tick) => void,
    gexEngine?: GEXEngine,
    cboeProvider?: CboeOptionsProvider,
    private historyProvider: HistoryProvider = defaultHistoryProvider
  ) {
    this.gexEngine = gexEngine || new GEXEngine();
    this.cboeProvider = cboeProvider || new CboeOptionsProvider();
  }

  public getContext(symbol: string): MarketContext | undefined {
    return this.contexts.get(symbol);
  }

  public getAllContexts(): MarketContext[] {
    return Array.from(this.contexts.values());
  }

  public getTicksForReplay(symbol: string): Tick[] {
    const ctx = this.contexts.get(symbol);
    return ctx ? ctx.getHistoryTicks() : [];
  }

  public async getOrCreateContext(symbol: string): Promise<MarketContext> {
    let ctx = this.contexts.get(symbol);
    if (ctx) return ctx;

    let initPromise = this.pendingInits.get(symbol);
    if (!initPromise) {
      initPromise = (async () => {
        try {
          const instrument = FUTURES_INSTRUMENTS[symbol] || FUTURES_INSTRUMENTS.ES;
          const newCtx = new MarketContext(
            symbol,
            instrument,
            this.gexEngine,
            this.cboeProvider,
            this.onTickRecord,
            this.historyProvider
          );
          await newCtx.startFeed();
          this.contexts.set(symbol, newCtx);
          return newCtx;
        } finally {
          this.pendingInits.delete(symbol);
        }
      })();
      this.pendingInits.set(symbol, initPromise);
    }
    return initPromise;
  }

  public async subscribe(
    session: ChartSession,
    symbol: string,
    timeframe: string,
    generation?: number
  ): Promise<void> {
    const gen = generation ?? session.subscriptionGeneration;

    // If currently subscribed to another symbol, remove from old context
    if (session.subscribedSymbol && session.subscribedSymbol !== symbol) {
      const oldCtx = this.contexts.get(session.subscribedSymbol);
      if (oldCtx) {
        oldCtx.removeSubscriber(session);
        if (oldCtx.subscriberCount === 0 && oldCtx.symbol !== 'BTCUSDT') {
          oldCtx.scheduleCleanup(() => {
            if (this.contexts.get(oldCtx.symbol) === oldCtx) {
              this.contexts.delete(oldCtx.symbol);
            }
          });
        }
      }
    }

    const ctx = await this.getOrCreateContext(symbol);

    // Guard: check if session is still alive and this request is still the newest generation
    if (!session.isOpen || session.subscriptionGeneration !== gen) {
      if (ctx.subscriberCount === 0 && ctx.symbol !== 'BTCUSDT') {
        ctx.scheduleCleanup(() => {
          if (this.contexts.get(ctx.symbol) === ctx) {
            this.contexts.delete(ctx.symbol);
          }
        });
      }
      return;
    }

    ctx.addSubscriber(session, timeframe);
  }

  public unsubscribe(session: ChartSession): void {
    if (session.subscribedSymbol) {
      const ctx = this.contexts.get(session.subscribedSymbol);
      if (ctx) {
        ctx.removeSubscriber(session);
        if (ctx.subscriberCount === 0 && ctx.symbol !== 'BTCUSDT') {
          ctx.scheduleCleanup(() => {
            if (this.contexts.get(ctx.symbol) === ctx) {
              this.contexts.delete(ctx.symbol);
            }
          });
        }
      }
    }
  }

  public async disposeAll(): Promise<void> {
    for (const ctx of this.contexts.values()) {
      await ctx.dispose();
    }
    this.contexts.clear();
  }

  public getGexEngine(): GEXEngine {
    return this.gexEngine;
  }
}
