import { FuturesInstrument } from '../futuresConfig.js';
import { BinanceFuturesFeed, DataFeedCallbacks } from '../dataFeeds/binanceFeed.js';
import { FeedConnectionState, FeedHandlers, MarketDataFeed } from './types.js';
import { validateDepth, validateTrade } from './validate.js';

/** Minimal surface the adapter needs from the legacy WebSocket client (also the test seam). */
export interface LegacyFeedLike {
  start(): void;
  stop(): Promise<void> | void;
}

export type LegacyFeedFactory = (symbol: string, callbacks: DataFeedCallbacks) => LegacyFeedLike;

/**
 * Binance Futures (BTCUSDT) adapter - REAL, key-less public streams.
 *
 * Lifecycle is generation-guarded: every socket callback captures the generation it belongs
 * to and is ignored once a newer generation exists, so a socket that was still CONNECTING
 * when we switched instruments can never emit trades, depth, reconnect or status changes
 * into the next instrument.
 */
export class BinanceMarketDataFeed implements MarketDataFeed {
  public readonly provider = 'binance';
  private connectionState: FeedConnectionState = 'UNAVAILABLE';
  /** Monotonic token: incremented on connect (new session) and on disconnect (invalidate). */
  private generation = 0;
  private feed: LegacyFeedLike | null = null;
  private droppedInvalid = 0;
  private droppedStale = 0;
  private liveWaiters: (() => void)[] = [];

  constructor(
    public readonly symbol: string,
    private readonly instrument: FuturesInstrument,
    private readonly handlers: FeedHandlers,
    private readonly legacyFactory: LegacyFeedFactory = (sym, cbs) => new BinanceFuturesFeed(sym, cbs)
  ) {}

  public isConnected(): boolean {
    return this.connectionState === 'LIVE';
  }

  /**
   * Resolve once the adapter has validated at least one real market event for the CURRENT
   * generation. Rejects honestly on timeout - it never fabricates readiness.
   */
  public waitForLive(timeoutMs = 15000): Promise<void> {
    if (this.connectionState === 'LIVE') return Promise.resolve();
    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.liveWaiters = this.liveWaiters.filter((w) => w !== onLive);
        reject(new Error(`no validated market data for ${this.symbol} within ${timeoutMs}ms`));
      }, timeoutMs);
      const onLive = () => {
        clearTimeout(timer);
        resolve();
      };
      this.liveWaiters.push(onLive);
    });
  }

  public async connect(): Promise<void> {
    const gen = ++this.generation;
    this.setStatus('CONNECTING', 'connecting to Binance Futures public streams', gen);

    const feed = this.legacyFactory(this.symbol, {
      onTick: (tick) => {
        if (gen !== this.generation) return; // stale socket: never emit into the new session
        const { trade, dropped } = validateTrade(
          { ts: tick.timestamp, price: tick.price, size: tick.size, side: tick.isBuyerMaker ? 'SELL' : 'BUY', id: tick.id },
          this.instrument.tickSize,
          this.symbol
        );
        if (!trade) {
          this.countDrop(dropped);
          return;
        }
        this.setStatus('LIVE', undefined, gen); // first VALIDATED real event, not merely open
        this.handlers.onTrade(trade);
      },
      onOrderbookSnapshot: (bids, asks, updateId) => {
        if (gen !== this.generation) return;
        const { event, dropped } = validateDepth(
          { kind: 'snapshot', ts: Date.now(), bids, asks, updateId, symbol: this.symbol },
          this.instrument.tickSize,
          this.symbol
        );
        if (!event) {
          this.countDrop(dropped);
          return;
        }
        this.handlers.onDepth(event);
      },
      onOrderbookDelta: (bids, asks, updateId) => {
        if (gen !== this.generation) return;
        const emit = (side: 'bid' | 'ask', price: number, size: number) => {
          const { event, dropped } = validateDepth(
            { kind: 'delta', ts: Date.now(), side, price, size, updateId, symbol: this.symbol },
            this.instrument.tickSize,
            this.symbol
          );
          if (event) this.handlers.onDepth(event);
          else this.countDrop(dropped);
        };
        for (const [price, size] of bids) emit('bid', price, size);
        for (const [price, size] of asks) emit('ask', price, size);
      },
    });

    this.feed = feed;
    feed.start();
  }

  public async disconnect(): Promise<void> {
    // Invalidate FIRST: any callback already queued by the old socket becomes a no-op.
    this.generation++;
    const previous = this.feed;
    this.feed = null;
    this.liveWaiters = [];
    try {
      await previous?.stop();
    } catch (err) {
      this.handlers.onError(new Error(`binance teardown failed: ${(err as Error).message}`));
    }
    this.setStatus('UNAVAILABLE', 'disconnected', this.generation);
  }

  private countDrop(reason?: 'invalid' | 'stale-symbol' | 'misaligned'): void {
    if (reason === 'stale-symbol') this.droppedStale++;
    else this.droppedInvalid++;
    const total = this.droppedInvalid + this.droppedStale;
    if (total % 100 === 1) {
      console.warn(`[Feed:binance] dropped ${total} events (invalid=${this.droppedInvalid}, stale-symbol=${this.droppedStale})`);
    }
  }

  /** Only the active generation may publish status; stale generations are silently ignored. */
  private setStatus(state: FeedConnectionState, reason: string | undefined, gen: number): void {
    if (gen !== this.generation) return;
    if (state === 'LIVE') {
      const waiters = this.liveWaiters;
      this.liveWaiters = [];
      for (const wake of waiters) wake();
    }
    if (state === this.connectionState) return;
    this.connectionState = state;
    this.handlers.onStatus({ state, reason, provider: this.provider, symbol: this.symbol });
  }
}
