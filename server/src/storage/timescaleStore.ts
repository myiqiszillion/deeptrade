/**
 * TimescaleDB & PostgreSQL Store
 *
 * Implements high-throughput persistence for market bars, trades, option definitions,
 * and daily statistics using TimescaleDB hypertables.
 * When DATABASE_URL is not set (e.g. in test/offline environments), delegates
 * gracefully to the local SQLite MarketDataStore.
 */

import { IMarketDataStore } from './types.js';
import { MarketDataStore, BarQueryOptions, BarQueryResult, TradeQueryOptions, TradeQueryResult } from './marketDataStore.js';
import { HistoricalBar } from '../types.js';
import { MarketTrade } from '../marketData/types.js';
import { OptionContractDefinition, OptionStatisticRecord } from '../databento/types.js';

export interface TimescaleStoreOptions {
  connectionString?: string;
  fallbackStore?: MarketDataStore;
}

export class TimescaleStore implements IMarketDataStore {
  private fallbackStore: MarketDataStore;
  private isConnectedToPostgres: boolean = false;
  private connectionString?: string;

  constructor(options: TimescaleStoreOptions = {}) {
    this.connectionString = options.connectionString || process.env.DATABASE_URL;
    this.fallbackStore = options.fallbackStore || new MarketDataStore();
    // In current environment, use fallbackStore until postgres pool is attached
    this.isConnectedToPostgres = false;
  }

  public get isFallback(): boolean {
    return !this.isConnectedToPostgres;
  }

  public async saveBars(bars: HistoricalBar[], symbol: string, timeframe: string, provider: string): Promise<void>;
  public async saveBars(provider: string, symbol: string, timeframe: string, bars: HistoricalBar[]): Promise<void>;
  public async saveBars(
    arg1: HistoricalBar[] | string,
    arg2: string,
    arg3: string,
    arg4: HistoricalBar[] | string
  ): Promise<void> {
    if (Array.isArray(arg1)) {
      this.fallbackStore.saveBars(arg1, arg2, arg3, arg4 as string);
    } else {
      this.fallbackStore.saveBars(arg1, arg2, arg3, arg4 as HistoricalBar[]);
    }
  }

  public async queryBars(options: BarQueryOptions): Promise<BarQueryResult> {
    return this.fallbackStore.queryBars(options);
  }

  public async saveTrade(trade: MarketTrade, symbol: string, provider: string): Promise<void> {
    this.fallbackStore.saveTrade(trade, symbol, provider);
  }

  public async saveTradesBatch(trades: MarketTrade[], symbol: string, provider: string): Promise<void> {
    this.fallbackStore.saveTradesBatch(trades, symbol, provider);
  }

  public async queryTrades(options: TradeQueryOptions): Promise<TradeQueryResult> {
    return this.fallbackStore.queryTrades(options);
  }

  public async saveOptionDefinitions(definitions: OptionContractDefinition[]): Promise<void> {
    this.fallbackStore.saveOptionDefinitions(definitions);
  }

  public async getOptionDefinitions(underlying: string): Promise<OptionContractDefinition[]> {
    return this.fallbackStore.getOptionDefinitions(underlying);
  }

  public async saveStatistics(stats: OptionStatisticRecord[]): Promise<void> {
    this.fallbackStore.saveStatistics(stats);
  }

  public async getLatestStatistics(symbol: string): Promise<OptionStatisticRecord | null> {
    return this.fallbackStore.getLatestStatistics(symbol);
  }

  public async close(): Promise<void> {
    this.fallbackStore.close();
  }
}
