/**
 * DeepChart Multi-Tier Storage Abstractions
 *
 * Defines the unified storage interface for market data (IMarketDataStore),
 * supporting TimescaleDB hypertables, Redis caching, and hermetic SQLite memory fallbacks.
 */

import { HistoricalBar } from '../types.js';
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

  // Market Depth MBP-10 Operations
  saveDepthSnapshot(snapshot: DepthSnapshotInput): void | Promise<void>;
  saveDepthSnapshotsBatch(snapshots: DepthSnapshotInput[]): void | Promise<void>;
  queryDepthSnapshots(options: DepthQueryOptions): DepthQueryResult | Promise<DepthQueryResult>;
  cleanupOldDepthSnapshots(cutoffExchangeTs: number): number | Promise<number>;

  // Close / cleanup
  close(): void | Promise<void>;
}

export interface DepthSnapshotInput {
  symbol: string;
  exchangeTs: number;
  receiveTs?: number;
  sequenceNumber?: number | null;
  schemaVersion?: number;
  dataSource?: string;
  sessionId?: string | null;
  bids: Array<{ price: number; size: number }>;
  asks: Array<{ price: number; size: number }>;
}

export interface StoredDepthSnapshot {
  id: number;
  symbol: string;
  exchangeTs: number;
  receiveTs: number;
  sequenceNumber?: number | null;
  schemaVersion: number;
  dataSource: string;
  sessionId?: string | null;
  bids: Array<{ price: number; size: number }>;
  asks: Array<{ price: number; size: number }>;
}

export interface DepthQueryOptions {
  symbol: string;
  startTime: number;
  endTime: number;
  resolutionMs?: number;
  limit?: number;
  offset?: number;
}

export interface DepthQueryResult {
  symbol: string;
  count: number;
  totalAvailable: number;
  hasMore: boolean;
  samplingIntervalMs: number;
  dataSource: string;
  available: boolean;
  snapshots: Array<{
    time: number;
    bids: Array<{ price: number; size: number }>;
    asks: Array<{ price: number; size: number }>;
  }>;
}

export interface ICacheStore {
  getLatestQuote(symbol: string): Promise<NormalizedQuote | null>;
  setLatestQuote(symbol: string, quote: NormalizedQuote, ttlSeconds?: number): Promise<void>;
  getOptionChain(underlying: string): Promise<OptionContractDefinition[] | null>;
  setOptionChain(underlying: string, chain: OptionContractDefinition[], ttlSeconds?: number): Promise<void>;
}

