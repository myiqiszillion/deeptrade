import { FuturesInstrument } from '../futuresConfig.js';
import { BinanceFuturesFeed } from '../dataFeeds/binanceFeed.js';
import { FeedHandlers, MarketDataFeed, FeedConnectionState } from './types.js';
import { validateDepth, validateTrade } from './validate.js';

/**
 * Binance Futures (BTCUSDT) adapter — REAL, key-less public streams.
 *
 * Wraps the existing WebSocket client (aggTrade + depth20) and re-emits everything as
 * normalized MarketTrade / MarketDepthEvent so engines never touch vendor payloads.
 */
export class BinanceMarketDataFeed implements MarketDataFeed {
  public readonly provider = 'binance';
  private connectionState: FeedConnectionState = 'UNAVAILABLE';
  private droppedInvalid = 0;
  private droppedStale = 0;

  constructor(
    public readonly symbol: string,
    private readonly instrument: FuturesInstrument,
    private readonly handlers: FeedHandlers
  ) {}

  public isConnected(): boolean {
    return this.connectionState === 'LIVE';
  }

  public async connect(): Promise<void> {
    this.setStatus('CONNECTING', 'connecting to Binance Futures public streams');

    const feed = new BinanceFuturesFeed(this.symbol, {
      onTick: (tick) => {
        const { trade, dropped } = validateTrade(
          { ts: tick.timestamp, price: tick.price, size: tick.size, side: tick.isBuyerMaker ? 'SELL' : 'BUY', id: tick.id },
          this.instrument.tickSize,
          this.symbol
        );
        if (!trade) {
          this.countDrop(dropped);
          return;
        }
        // First validated event proves real data is flowing: only now claim LIVE.
        this.setStatus('LIVE');
        this.handlers.onTrade(trade);
      },
      onOrderbookSnapshot: (bids, asks, updateId) => {
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
        // The public Binance depth20 stream is snapshot-only; deltas are forwarded level by
        // level when a vendor (or a future @depth stream) provides them.
        for (const [price, size] of bids) {
          const { event, dropped } = validateDepth(
            { kind: 'delta', ts: Date.now(), side: 'bid', price, size, updateId, symbol: this.symbol },
            this.instrument.tickSize,
            this.symbol
          );
          if (event) this.handlers.onDepth(event);
          else this.countDrop(dropped);
        }
        for (const [price, size] of asks) {
          const { event, dropped } = validateDepth(
            { kind: 'delta', ts: Date.now(), side: 'ask', price, size, updateId, symbol: this.symbol },
            this.instrument.tickSize,
            this.symbol
          );
          if (event) this.handlers.onDepth(event);
          else this.countDrop(dropped);
        }
      },
    });

    this.feed = feed;
    feed.start();
  }

  public async disconnect(): Promise<void> {
    this.feed?.stop();
    this.feed = null;
    this.setStatus('UNAVAILABLE', 'disconnected');
  }

  private feed: BinanceFuturesFeed | null = null;

  private countDrop(reason?: 'invalid' | 'stale-symbol' | 'misaligned'): void {
    if (reason === 'stale-symbol') this.droppedStale++;
    else this.droppedInvalid++;
    // Log sparsely: a noisy vendor must not be able to flood the log.
    const total = this.droppedInvalid + this.droppedStale;
    if (total % 100 === 1) {
      console.warn(
        `[Feed:binance] dropped ${total} events (invalid=${this.droppedInvalid}, stale-symbol=${this.droppedStale})`
      );
    }
  }

  private setStatus(state: FeedConnectionState, reason?: string): void {
    if (state === this.connectionState) return;
    this.connectionState = state;
    this.handlers.onStatus({ state, reason, provider: this.provider, symbol: this.symbol });
  }
}
