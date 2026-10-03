import { FuturesInstrument } from '../futuresConfig.js';
import { FeedHandlers, MarketDataFeed } from './types.js';
import { DatabentoLiveClient } from '../databento/liveClient.js';
import { resolveDatabentoConfig } from '../databento/config.js';

export type FuturesProviderName = 'none' | 'databento' | 'binance';

export interface FeedFactoryResult {
  feed: MarketDataFeed;
  provider: FuturesProviderName;
}

export function providerForSymbol(symbol: string, env: NodeJS.ProcessEnv = process.env): FuturesProviderName {
  const cfg = resolveDatabentoConfig(env);
  const raw = (env.FUTURES_PROVIDER || (cfg.apiKey ? 'databento' : 'none')).toLowerCase();
  if (raw === 'databento' || raw === 'binance' || raw === 'none') return raw as FuturesProviderName;
  return 'databento';
}

export function createMarketDataFeed(
  symbol: string,
  instrument: FuturesInstrument,
  handlers: FeedHandlers
): FeedFactoryResult {
  const cfg = resolveDatabentoConfig();
  const provider = providerForSymbol(symbol);
  const liveSymbols = cfg.symbols;
  const isSupported = liveSymbols.includes(symbol.toUpperCase());
  const apiKey = cfg.apiKey;

  if (provider === 'databento' && isSupported && apiKey) {
    const liveClient = new DatabentoLiveClient({
      symbol,
      apiKey,
      handlers,
    });
    return { feed: liveClient, provider: 'databento' };
  }

  return {
    feed: {
      provider: provider === 'databento' ? 'databento' : 'none',
      symbol,
      connect: async () => {
        if (!apiKey && provider === 'databento') {
          handlers.onStatus({ state: 'UNAVAILABLE', reason: 'Missing Databento API key (DATABENTO_API_KEY)', provider: 'databento', symbol });
          return;
        }
        handlers.onStatus({ state: 'UNAVAILABLE', reason: `FUTURES_PROVIDER=${provider}: no active realtime stream for ${symbol}`, provider: provider === 'databento' ? 'databento' : 'none', symbol });
      },
      disconnect: async () => {},
      isConnected: () => false,
    },
    provider: provider === 'databento' && isSupported ? 'databento' : 'none',
  };
}
