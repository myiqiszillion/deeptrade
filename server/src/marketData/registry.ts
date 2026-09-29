import { FuturesInstrument } from '../futuresConfig.js';
import { DatabentoMarketDataFeed } from './databentoAdapter.js';
import { TradovateMarketDataFeed } from './tradovateAdapter.js';
import { readTradovateConfig } from './tradovateConfig.js';
import { FeedHandlers, MarketDataFeed } from './types.js';

export type FuturesProviderName = 'none' | 'databento' | 'tradovate';

export interface FeedFactoryResult {
  feed: MarketDataFeed;
  /** 'none' means the caller must report UNAVAILABLE for this symbol. */
  provider: FuturesProviderName;
}

/**
 * Single place that decides which real data source serves a DeepChart symbol.
 * Selects databento or tradovate based on FUTURES_PROVIDER.
 */
export function createMarketDataFeed(
  symbol: string,
  instrument: FuturesInstrument,
  handlers: FeedHandlers
): FeedFactoryResult {
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
        stypeIn: process.env.DATABENTO_STYPE_IN,
        symbols: symbol === 'ES' ? process.env.DATABENTO_SYMBOLS : undefined,
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
