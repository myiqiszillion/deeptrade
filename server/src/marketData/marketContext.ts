import { FootprintEngine } from '../footprintEngine.js';
import { FuturesInstrument, getOrRegisterInstrument } from '../futuresConfig.js';
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
import { historyBarsTarget } from './historyDepth.js';
import { FeedStatusEvent, MarketDataFeed, MarketDepthEvent, MarketTrade } from './types.js';
import { marketDataStore } from '../storage/marketDataStore.js';
import { SessionCalendar } from '../calendar/sessionCalendar.js';
import { microstructureEngine } from '../microstructure/engine.js';
import { alertEngine } from '../alerts/alertEngine.js';

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
const GEX_REFRESH_MS = parseInt(process.env.GEX_REFRESH_MS || '300000', 10);

/** Upper bound for the per-timeframe pre-live bar cache that is shipped in INIT_STATE. */
const MAX_HISTORY_BARS_PER_TF = 1500;

/**
 * Merge two pre-live bar series by open time. A vendor page can be shorter/staler than the bars that
 * are already cached (delayed dataset, truncated page, store priming); replacing instead of merging
 * would drop the freshest candles and leave a hole before "now". Later input wins on equal timestamps
 * because freshly fetched vendor bars are the more authoritative row for that minute.
 */
function mergeHistoryBars(previous: HistoricalBar[], incoming: HistoricalBar[]): HistoricalBar[] {
  if (previous.length === 0) return incoming;
  const byTime = new Map<number, HistoricalBar>();
  for (const bar of previous) byTime.set(bar.time, bar);
  for (const bar of incoming) byTime.set(bar.time, bar);
  const merged = Array.from(byTime.values()).sort((a, b) => a.time - b.time);
  return merged.length > MAX_HISTORY_BARS_PER_TF ? merged.slice(-MAX_HISTORY_BARS_PER_TF) : merged;
}

type HistorySource = 'NONE' | 'REAL_TICKS' | 'REAL_BARS';

export interface HistoryProvider {
  fetchBars(
    symbol: string,
    config: any,
    options: { barMinutes: number; elements: number; beforeTime: number; signal: AbortSignal }
  ): Promise<HistoricalBar[]>;
  fetchTicks?(
    symbol: string,
    config: any,
    options: { elements: number; beforeTime: number; signal: AbortSignal }
  ): Promise<Tick[]>;
}

export const defaultHistoryProvider: HistoryProvider = {
  fetchBars: async () => [],
  fetchTicks: async () => [],
};

export interface IsolatedAcceptanceContext {
  createFeed: (handlers: import('./types.js').FeedHandlers) => MarketDataFeed;
  onOutcome: (trade: MarketTrade, outcome: 'ACCEPTED' | 'REJECTED' | 'DEDUPLICATED') => void;
}

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

  public getEffectiveProvider(): string {
    if (this.provider && this.provider !== 'none') return this.provider;
    if (this.provider === 'none') {
      if (this.feedLifecycleState !== 'STOPPED') return 'none';
      const feedResult = createMarketDataFeed(this.symbol, this.instrument, {
        onTrade: () => {},
        onDepth: () => {},
        onStatus: () => {},
        onError: () => {},
      });
      return feedResult.provider;
    }
    return (process.env.FUTURES_PROVIDER || 'databento').toLowerCase();
  }

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
  private trailingAnalyticsTimer: NodeJS.Timeout | null = null;

  private gexEngine: GEXEngine;
  private cachedGexProfile?: GEXProfile;
  private gexTimer: NodeJS.Timeout | null = null;

  // Cleanup grace timer when subscriber count reaches 0
  private cleanupTimer: NodeJS.Timeout | null = null;

  constructor(
    symbol: string,
    instrument: FuturesInstrument,
    gexEngine = new GEXEngine(),
    private onTickRecord?: (tick: Tick) => void,
    private historyProvider: HistoryProvider = defaultHistoryProvider,
    private acceptance?: IsolatedAcceptanceContext
  ) {
    this.symbol = symbol;
    this.instrument = instrument;
    this.gexEngine = gexEngine;

    this.orderbook = new OrderbookManager(50);
    this.orderbook.onSnapshotRecorded = (snap, exchTs) => {
      marketDataStore.enqueueDepthSnapshot({
        symbol: this.symbol,
        exchangeTs: exchTs,
        receiveTs: snap.time,
        sequenceNumber: this.lastDepthUpdateId,
        dataSource: this.provider,
        bids: snap.bids,
        asks: snap.asks,
      });
    };
    this.profile = new ProfileEngine(this.instrument.tickSize);
    this.vwap = new VWAPEngine();
    this.tape = new TapeEngine(this.computeDeepTradeThresholdUsd(), this.computeAbsorptionVolumeThreshold());

    // Initialize default footprint engine (1m)
    this.ensureFootprintEngine('1m');

    if (this.acceptance) { this.provider = 'databento'; return; }
    const initialFeed = createMarketDataFeed(this.symbol, this.instrument, {
      onTrade: () => {},
      onDepth: () => {},
      onStatus: () => {},
      onError: () => {},
    });
    this.provider = initialFeed.provider;
  }

  public computeDeepTradeThresholdUsd(): number {
    return Math.round(this.instrument.pointValue * this.instrument.basePrice * WHALE_LOTS_EQUIVALENT);
  }

  public computeAbsorptionVolumeThreshold(): number {
    const root = this.symbol.toUpperCase().split('.')[0];
    if (root === 'ES' || root === 'MES' || root === 'SPX' || root === 'SPY') return 500;
    if (root === 'NQ' || root === 'MNQ' || root === 'NDX' || root === 'QQQ') return 100;
    if (root === 'YM' || root === 'MYM' || root === 'DJI') return 200;
    if (root === 'RTY' || root === 'M2K' || root === 'RUT') return 150;
    return Math.max(50, WHALE_LOTS_EQUIVALENT * 5);
  }

  public get subscriberCount(): number {
    return this.subscribers.size;
  }

  public getHistoryTicks(): Tick[] {
    if (this.historyTicks.length > 0) {
      return [...this.historyTicks];
    }
    return [];
  }

  public acceptanceSnapshot() {
    if (!this.acceptance) throw new Error('Not an isolated acceptance context');
    return { bars: this.ensureFootprintEngine('1m').getAllBars(), profile: this.profile.getVolumeProfile() };
  }

  public getDepthHistory(fromMs?: number, toMs?: number) {
    return this.orderbook.getDepthHistory(fromMs, toMs);
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
    this.isBackfillingHistory = !this.acceptance;
    this.liveBuffer = [];

    const handlers = {
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
            if (!this.acceptance) void this.backfillHistory();
          }
        }
      },
      onError: (error: Error) => {
        if (token !== this.activeFeedToken) return;
        console.warn(`[Feed:${provider}] ${this.symbol}: ${error.message}`);
        this.setFeedStatus('UNAVAILABLE');
      },
    };
    const { feed, provider } = this.acceptance
      ? { feed: this.acceptance.createFeed(handlers), provider: 'databento' }
      : createMarketDataFeed(this.symbol, this.instrument, handlers);

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
    if (!this.acceptance && this.instrument.underlyingIndex) {
      void this.refreshGex();
      if (this.gexTimer) clearInterval(this.gexTimer);
      this.gexTimer = setInterval(() => {
        void this.refreshGex();
      }, GEX_REFRESH_MS);
    }
    if (!this.acceptance) void this.backfillHistory();
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
    if (!this.acceptance) {
      this.flushTrailingAnalytics();
      this.feedReason = 'feed stopped';
      this.setFeedStatus('UNAVAILABLE');
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
      session.send(this.buildInitState(session, session.getTimeframe(this.symbol)));
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
      this.acceptance?.onOutcome(trade, 'REJECTED');
      return;
    }

    // 2. Centralized Deduplication: drop duplicate vendor trades before fan-out
    let tickId: string;
    if (trade.id) {
      if (!this.trackVendorTickId(trade.id)) {
        this.acceptance?.onOutcome(trade, 'DEDUPLICATED');
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
    // Check for contiguous sequence gaps if the provider supplies dedicated trade-level sequencing.
    if (!this.acceptance && trade.sequenceId !== undefined) {
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
    if (!this.acceptance && this.lastTradeEventTs > 0 && SessionCalendar.isNewSession(this.lastTradeEventTs, trade.ts, this.instrument.sessionScheduleId)) {
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

    if (this.acceptance) {
      for (const engine of this.footprintEngines.values()) engine.processTick(tick);
      this.profile.processTick(tick);
      this.profile.setCoverage('PARTIAL', 'Bounded acceptance observation; not full session');
      this.historyTicks.push(tick);
      this.acceptance.onOutcome(trade, 'ACCEPTED');
      for (const session of this.subscribers) {
        session.send({ type: 'TICK', symbol: this.symbol, tick });
      }
      return;
    }

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
    microstructureEngine.recordTick(tick);

    if (this.isBackfillingHistory) {
      this.liveBuffer.push(tick);
      for (const session of this.subscribers) {
        if (session.isReplay()) continue;
        session.send({ type: 'TICK', symbol: this.symbol, tick });
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
        alertEngine.evaluateFootprintBar(this.symbol, closedBar, this.instrument.tickSize);
      } else if (currentBar) {
        alertEngine.evaluateFootprintBar(this.symbol, currentBar, this.instrument.tickSize);
      }

      // Send to subscribers subscribed to this timeframe
      for (const session of this.subscribers) {
        if (session.isReplay()) continue;
        if (session.getTimeframe(this.symbol) !== tf) continue;

        if (affectedBars && affectedBars.length > 0) {
          for (const bar of affectedBars) {
            session.send({ type: 'BAR_UPDATE', symbol: this.symbol, bar });
          }
        } else {
          if (correctedBar) {
            session.send({ type: 'BAR_UPDATE', symbol: this.symbol, bar: correctedBar });
          }

          if (closedBar) {
            session.send({ type: 'BAR_CLOSE', symbol: this.symbol, bar: closedBar });
          }

          const lastBarUpdate = this.lastBarUpdateByTf.get(tf) || 0;
          if (now - lastBarUpdate > 100 || correctedBar) {
            session.send({ type: 'BAR_UPDATE', symbol: this.symbol, bar: currentBar });
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

    // Evaluate alert rules against live market events
    alertEngine.evaluateTick(this.symbol, tick, this.profile.getVolumeProfile());
    if (absorption) {
      alertEngine.evaluateAbsorption(this.symbol, absorption);
    }

    // Send tick, tape, deep trade and absorption to all subscribers of this symbol
    for (const session of this.subscribers) {
      if (session.isReplay()) continue;
      session.send({ type: 'TICK', symbol: this.symbol, tick });

      if (now - this.lastSpeedOfTapeUpdate > 250) {
        session.send({ type: 'SPEED_OF_TAPE', symbol: this.symbol, tape: speed });
      }

      if (deepTrade) {
        session.send({ type: 'DEEP_TRADE', symbol: this.symbol, trade: deepTrade });
      }

      if (absorption) {
        session.send({ type: 'ABSORPTION', symbol: this.symbol, alert: absorption });
      }

      // Throttled live profile updates (500ms)
      if (now - this.lastProfileUpdate > 500) {
        session.send({ type: 'PROFILE_UPDATE', symbol: this.symbol,
          volumeProfile: this.profile.getVolumeProfile(),
          tpo: this.profile.getTPOProfile(),
        });
      }

      // Throttled live VWAP updates (500ms)
      if (vwapPoint && now - this.lastVwapUpdate > 500) {
        session.send({ type: 'VWAP_UPDATE', symbol: this.symbol,
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
    // Leading-edge throttling must not leave the last quiet-market trade invisible.
    if (!this.trailingAnalyticsTimer) {
      this.trailingAnalyticsTimer = setTimeout(() => this.flushTrailingAnalytics(), 500);
      this.trailingAnalyticsTimer.unref();
    }
  }

  private flushTrailingAnalytics(): void {
    if (this.trailingAnalyticsTimer) {
      clearTimeout(this.trailingAnalyticsTimer);
      this.trailingAnalyticsTimer = null;
    }
    for (const session of this.subscribers) {
      if (session.isReplay()) continue;
      const bar = this.footprintEngines.get(session.getTimeframe(this.symbol))?.getCurrentBar();
      if (bar) session.send({ type: 'BAR_UPDATE', symbol: this.symbol, bar });
      session.send({ type: 'PROFILE_UPDATE', symbol: this.symbol,
        volumeProfile: this.profile.getVolumeProfile(), tpo: this.profile.getTPOProfile() });
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
        snapUpdateId,
        event.ts
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
        this.orderbook.applyDelta([[event.price, event.size]], [], deltaUpdateId, event.ts);
      } else {
        this.orderbook.applyDelta([], [[event.price, event.size]], deltaUpdateId, event.ts);
      }
    }

    const now = Date.now();
    if (now - this.lastOrderbookUpdate > 100) {
      const snap = this.orderbook.getSnapshot();
      for (const session of this.subscribers) {
        if (session.isReplay()) continue;
        session.send({ type: 'ORDERBOOK_UPDATE', symbol: this.symbol, orderbook: snap });
      }
      this.lastOrderbookUpdate = now;
      alertEngine.evaluateOrderbook(this.symbol, snap);
    }
  }

  public async refreshGex(_force = false): Promise<void> {
    if (this.acceptance) return;
    const underlying = this.instrument.underlyingIndex;
    if (!underlying) return;

    const snap = marketDataStore.getLatestExposure(underlying === 'SPX' ? 'SPY' : underlying);
    if (!snap) return;

    const profile: GEXProfile = {
      underlying,
      spotPrice: snap.spot || 0,
      callWall: snap.walls?.callWall ?? 0,
      putWall: snap.walls?.putWall ?? 0,
      zeroGammaFlip: snap.gammaFlip || 0,
      totalNetGex: snap.totals?.gex ?? 0,
      total0DteGex: 0,
      regime: snap.regime || 'POSITIVE_GAMMA',
      levels: (Array.isArray(snap.levels) ? snap.levels : []).map((l: any) => ({
        strike: l.strike,
        callGex: l.callGex || 0,
        putGex: l.putGex || 0,
        netGex: (l.callGex || 0) - (l.putGex || 0),
        zeroDteGex: 0,
        callOI: l.callOi || 0,
        putOI: l.putOi || 0,
        callVol: 0,
        putVol: 0,
      })),
      timestamp: snap.timestamp,
      dataSource: 'LIVE',
    };

    this.cachedGexProfile = profile;
    const recentFlow = this.gexEngine.getRecentFlow();
    for (const session of this.subscribers) {
      if (session.isReplay()) continue;
      session.send({ type: 'GEX_UPDATE', symbol: this.symbol, profile });
      for (const flow of recentFlow.slice(0, 5)) {
        session.send({ type: 'OPTIONS_FLOW', symbol: this.symbol, trade: flow });
      }
    }
  }

  public async backfillHistory(timeframe = '1m'): Promise<void> {
    if (this.acceptance) return;
    const token = this.activeFeedToken;
    const symbol = this.symbol;
    const signal = this.historyRequest.signal;
    const beforeTime = this.historyBoundary;
    let ticks: Tick[] = [];
    let source: HistorySource = 'NONE';

    try {
      const effectiveProvider = this.getEffectiveProvider();

        if (effectiveProvider === 'databento' && process.env.DATABENTO_API_KEY) {
          try {
            if (this.historyProvider.fetchTicks) {
              const fetched = await this.historyProvider.fetchTicks(
                this.symbol,
                { apiKey: process.env.DATABENTO_API_KEY },
                { elements: 10000, beforeTime, signal }
              );
              if (fetched.length > 0) {
                ticks = fetched;
                source = 'REAL_TICKS';
              }
            }

            if (ticks.length === 0) {
              const stored = marketDataStore.queryTrades({
                provider: 'databento',
                symbol: this.symbol,
                limit: 10000,
                beforeTime,
              });
              if (stored.trades.length > 0) {
                ticks = stored.trades;
                source = 'REAL_TICKS';
              }
            }
          } catch (tradesErr) {
            console.warn(`[History] Databento trades load failed for ${symbol}: ${(tradesErr as Error).message}`);
          }
        }

        // Always ensure historical bars are loaded so the chart has deep candlestick history from past to present
        try {
          const bars = await this.ensureHistoryBars(timeframe, this.needsHistoryRefresh(timeframe));
          if (bars.length > 0) {
            console.log(`[History] ${symbol}: loaded ${bars.length} real bar(s) (${timeframe})`);
          }
        } catch (barErr) {
          console.warn(`[History] ensureHistoryBars failed for ${symbol}: ${(barErr as Error).message}`);
        }

        if (ticks.length === 0) {
          if (signal.aborted || token !== this.activeFeedToken) return;
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
        session.send(this.buildInitState(session, session.getTimeframe(this.symbol)));
      }
    }
  }

  public async ensureHistoryBars(timeframe: string, forceRefresh = false): Promise<HistoricalBar[]> {
    if (this.acceptance) return [];
    const cached = this.historyBarsByTf.get(timeframe);
    if (cached && cached.length > 0 && !forceRefresh) return cached;

    const effectiveProvider = this.getEffectiveProvider();

    if (effectiveProvider !== 'databento') {
      // Check persistent store if no live futures provider configured
      const stored = marketDataStore.queryBars({
        provider: effectiveProvider,
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
        let bars: HistoricalBar[] = [];
        const providerName = effectiveProvider;

        if (providerName === 'databento' && process.env.DATABENTO_API_KEY) {
          bars = await this.historyProvider.fetchBars(
            this.symbol,
            { apiKey: process.env.DATABENTO_API_KEY },
            { barMinutes: tfMs / 60000, elements: historyBarsTarget(), beforeTime: this.historyBoundary, signal }
          );
        }

        if (signal.aborted || token !== this.activeFeedToken) return [];
        if (bars.length > 0) {
          marketDataStore.saveBars(bars, this.symbol, timeframe, providerName);
          // A vendor window can be shorter and staler than what is already cached (delayed dataset,
          // partial page, store priming): merge by time instead of replacing, so the chart never
          // loses fresher candles and never keeps a hole between history and the live edge.
          const previous = this.historyBarsByTf.get(timeframe) ?? [];
          const merged = mergeHistoryBars(previous, bars);
          this.historyBarsByTf.set(timeframe, merged);
          this.historyBars = merged;
          if (this.historySource !== 'REAL_TICKS') {
            this.historySource = 'REAL_BARS';
          }
          this.vwap.processHistoricalBars(bars);
        }
        return bars;
      } catch (err) {
        // Fallback to persistent store on provider error
        const provider = effectiveProvider;
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
          this.vwap.processHistoricalBars(stored.bars);
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

  /** How this instrument's pre-live history was seeded (used by /healthz and the status strip). */
  public getHistorySource(): HistorySource {
    return this.historySource;
  }

  /**
   * Instant local cache priming: populate the chart's pre-live history straight from the
   * persistent store so the chart never opens with an empty left side. Runs for every
   * timeframe (including sub-minute ones that have no vendor bar schema) and is used both when
   * a client first subscribes and when it only switches timeframe.
   */
  private primeHistoryBarsFromStore(timeframe: string): void {
    if (this.acceptance) return;
    if (this.historyBarsByTf.has(timeframe)) return;

    const stored = marketDataStore.queryBars({
      provider: this.getEffectiveProvider(),
      symbol: this.symbol,
      timeframe,
      limit: 500,
      beforeTime: this.historyBoundary,
    });
    if (stored.bars.length === 0) return;

    this.historyBarsByTf.set(timeframe, stored.bars);
    this.historyBars = stored.bars;
    if (this.historySource === 'NONE') {
      this.historySource = 'REAL_BARS';
    }
  }

  /**
   * A cached history set that stops well before the live edge still needs a vendor refresh:
   * delayed vendor publication, sparse store rows or an earlier truncated page would otherwise
   * leave a hole between the last historical candle and "now".
   */
  private needsHistoryRefresh(timeframe: string): boolean {
    const cached = this.historyBarsByTf.get(timeframe);
    if (!cached || cached.length < 50) return true;
    const tfMs = TIMEFRAMES[timeframe] || 60000;
    const newest = cached[cached.length - 1]?.time ?? 0;
    const toleranceMs = Math.max(3 * tfMs, 15 * 60 * 1000);
    return this.historyBoundary - newest > toleranceMs;
  }

  public addSubscriber(session: ChartSession, timeframe: string): void {
    if (this.cleanupTimer) {
      clearTimeout(this.cleanupTimer);
      this.cleanupTimer = null;
    }

    session.subscribedSymbol = this.symbol;
    session.subscriptions.set(this.symbol, timeframe);
    const gen = session.subscriptionGeneration;
    this.ensureFootprintEngine(timeframe);
    this.subscribers.add(session);

    // Instant local cache priming: if in-memory history is empty, populate from persistent store immediately
    this.primeHistoryBarsFromStore(timeframe);

    if (!this.acceptance && this.historyTicks.length === 0) {
      const storedTrades = marketDataStore.queryTrades({
        provider: this.getEffectiveProvider(),
        symbol: this.symbol,
        limit: 1000,
        beforeTime: this.historyBoundary,
      });
      // Only replay stored trades into the live footprint engine if they belong to the current active session
      // (within the last 24h, or within 1h of the newest history bar) rather than stale ticks from days ago
      const newestTradeTs = storedTrades.trades.length > 0 ? storedTrades.trades[0].timestamp : 0;
      const cachedHistory = this.historyBarsByTf.get(timeframe) || this.historyBars;
      const newestHistoryTs = cachedHistory.length > 0 ? cachedHistory[cachedHistory.length - 1].time : 0;
      const isRecentEnough = newestTradeTs >= Math.max(Date.now() - 24 * 3600 * 1000, newestHistoryTs - 3600 * 1000);

      if (storedTrades.trades.length > 0 && isRecentEnough) {
        this.historyTicks = storedTrades.trades.slice().reverse();
        const firstTs = this.historyTicks[0]?.timestamp || 0;
        this.profile.reset(firstTs);
        this.vwap.reset(firstTs);
        const engine = this.ensureFootprintEngine(timeframe);
        for (const t of this.historyTicks) {
          engine.processTick(t);
          this.profile.processTick(t);
          this.vwap.processTick(t);
        }
        if (this.historySource === 'NONE') {
          this.historySource = 'REAL_TICKS';
        }
      }
    }

    // Deliver instant snapshot in <1ms
    session.send(this.buildInitState(session, timeframe));

    // Asynchronously refresh and backfill in background without blocking initial render
    if (this.needsHistoryRefresh(timeframe)) {
      void this.ensureHistoryBars(timeframe, true).then((bars) => {
        if (
          bars.length > 0 &&
          this.subscribers.has(session) &&
          session.subscribedSymbol === this.symbol &&
          session.getTimeframe(this.symbol) === timeframe &&
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
    session.subscriptions.set(this.symbol, timeframe);
    const gen = session.subscriptionGeneration;
    this.ensureFootprintEngine(timeframe);
    // Prime from the store BEFORE the snapshot is built, otherwise switching timeframe (which does
    // not go through addSubscriber) would show an empty left side until a vendor fetch completes —
    // and sub-minute timeframes have no vendor bar schema at all.
    this.primeHistoryBarsFromStore(timeframe);
    session.send(this.buildInitState(session, timeframe));

    if (this.needsHistoryRefresh(timeframe)) {
      void this.ensureHistoryBars(timeframe, true).then((bars) => {
        if (
          bars.length > 0 &&
          this.subscribers.has(session) &&
          session.subscriptions.has(this.symbol) &&
          session.getTimeframe(this.symbol) === timeframe &&
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
      recentTicks: this.getHistoryTicks().slice(-50).reverse(),
      feedStatus: this.feedStatus,
      mode: session.isReplay() ? session.mode : 'LIVE',
    };
  }

  public scheduleCleanup(onDispose: () => void, graceMs = 10000): void {
    if (this.acceptance) return;
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

  constructor(
    private onTickRecord?: (tick: Tick) => void,
    gexEngine?: GEXEngine,
    private historyProvider: HistoryProvider = defaultHistoryProvider
  ) {
    this.gexEngine = gexEngine || new GEXEngine();
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
          const instrument = getOrRegisterInstrument(symbol);
          const newCtx = new MarketContext(
            symbol,
            instrument,
            this.gexEngine,
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

    const ctx = await this.getOrCreateContext(symbol);

    // Guard: check if session is still alive and this request is still the newest generation
    if (!session.isOpen || session.subscriptionGeneration !== gen) {
      if (ctx.subscriberCount === 0 && ctx.symbol !== (process.env.DEFAULT_SYMBOL || 'ES')) {
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

  public unsubscribe(session: ChartSession, symbol?: string): void {
    const targetSymbol = symbol || session.subscribedSymbol;
    if (targetSymbol) {
      const ctx = this.contexts.get(targetSymbol);
      if (ctx) {
        ctx.removeSubscriber(session);
        if (ctx.subscriberCount === 0 && ctx.symbol !== (process.env.DEFAULT_SYMBOL || 'ES')) {
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
