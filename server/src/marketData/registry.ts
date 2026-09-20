import { FuturesInstrument } from '../futuresConfig.js';
import { BinanceMarketDataFeed } from './binanceAdapter.js';
import { DATABENTO_SYMBOL_MAP, DatabentoMarketDataFeed } from './databentoAdapter.js';
import { TradovateMarketDataFeed } from './tradovateAdapter.js';
import { readTradovateConfig } from './tradovateConfig.js';
import { FeedHandlers, MarketDataFeed } from './types.js';

export type FuturesProviderName = 'none' | 'databento' | 'tradovate';

/** Agent that actually owns the realtime feed for a symbol (independent of vendor choice). */
export function preferredFeedSource(symbol: string): 'binance' | 'futures-vendor' {
  return symbol === 'BTCUSDT' ? 'binance' : 'futures-vendor';
}

export interface FeedFactoryResult {
  feed: MarketDataFeed;
  /** 'none' means the caller must report UNAVAILABLE for this symbol. */
  provider: 'binance' | FuturesProviderName;
}

/**
 * Single place that decides which real data source serves a DeepChart symbol.
 * `FUTURES_PROVIDER` defaults to `none`, so a fresh clone streams BTCUSDT live and reports
 * futures as UNAVAILABLE — never simulated.
 */
export function createMarketDataFeed(
  symbol: string,
  instrument: FuturesInstrument,
  handlers: FeedHandlers
): FeedFactoryResult {
  if (preferredFeedSource(symbol) === 'binance') {
    return { feed: new BinanceMarketDataFeed(symbol, instrument, handlers), provider: 'binance' };
  }

  const provider = (process.env.FUTURES_PROVIDER || 'none').toLowerCase() as FuturesProviderName;

  if (provider === 'tradovate') {
    return {
      feed: new TradovateMarketDataFeed(symbol, instrument, handlers, readTradovateConfig()),
      provider: 'tradovate',
    };
  }

  if (provider === 'databento') {
    return {
      feed: new DatabentoMarketDataFeed(symbol, handlers, {
        apiKey: process.env.DATABENTO_API_KEY,
        dataset: process.env.DATABENTO_DATASET,
        stypeIn: process.env.DATABENTO_STYPE_IN || 'parent',
        symbols: process.env.DATABENTO_SYMBOLS || DATABENTO_SYMBOL_MAP[symbol],
      }),
      provider: 'databento',
    };
  }

  return {
    feed: {
      provider: 'none',
      symbol,
      connect: async () => {
        handlers.onStatus({
          state: 'UNAVAILABLE',
          reason: `FUTURES_PROVIDER=${provider}: no licensed realtime vendor configured for futures`,
          provider: 'none',
          symbol,
        });
      },
      disconnect: async () => {},
      isConnected: () => false,
    },
    provider: 'none',
  };
}
