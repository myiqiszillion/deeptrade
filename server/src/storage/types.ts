/**
 * DeepChart Multi-Tier Storage Abstractions
 *
 * Defines the unified storage interface for market data (IMarketDataStore),
 * supporting TimescaleDB hypertables, Redis caching, and hermetic SQLite memory fallbacks.
 */

import { HistoricalBar, Tick } from '../types.js';
import { MarketTrade } from '../marketData/types.js';
import { OptionContractDefinition, OptionStatisticRecord, NormalizedQuote } from '../databento/types.js';
import { BarQueryOptions, BarQueryResult, TradeQueryOptions, TradeQueryResult } from './marketDataStore.js';

export interface IMarketDataStore {
  // OHLCV Bar Operations
  saveBars(bars: HistoricalBar[], symbol: string, timeframe: string, provider: string): void | Promise<void>;
  saveBars(provider: string, symbol: string, timeframe: string, bars: HistoricalBar[]): void | Promise<void>;
  queryBars(options: BarQueryOptions): BarQueryResult | Promise<BarQueryResult>;

  // Trade / Tick Operations
  saveTrade(trade: MarketTrade, symbol: string, provider: string): void | Promise<void>;
  saveTradesBatch(trades: MarketTrade[], symbol: string, provider: string): void | Promise<void>;
  queryTrades(options: TradeQueryOptions): TradeQueryResult | Promise<TradeQueryResult>;

  // Options Symbology & Definitions
  saveOptionDefinitions(definitions: OptionContractDefinition[]): void | Promise<void>;
  getOptionDefinitions(underlying: string): OptionContractDefinition[] | Promise<OptionContractDefinition[]>;

  // Statistics (Open Interest, Settlement, Volume)
  saveStatistics(stats: OptionStatisticRecord[]): void | Promise<void>;
  getLatestStatistics(symbol: string): OptionStatisticRecord | null | Promise<OptionStatisticRecord | null>;

  // Close / cleanup
  close(): void | Promise<void>;
}

export interface ICacheStore {
  getLatestQuote(symbol: string): Promise<NormalizedQuote | null>;
  setLatestQuote(symbol: string, quote: NormalizedQuote, ttlSeconds?: number): Promise<void>;
  getOptionChain(underlying: string): Promise<OptionContractDefinition[] | null>;
  setOptionChain(underlying: string, chain: OptionContractDefinition[], ttlSeconds?: number): Promise<void>;
}
