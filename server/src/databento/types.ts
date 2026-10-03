/**
 * Databento Market Data Models & Schemas
 *
 * Covers normalized formats across DeepChart's multi-asset engine:
 * - Equities / ETFs (e.g. SPY, AAPL, QQQ)
 * - US Equity & Index Options (OPRA.PILLAR)
 * - CME Futures (GLBX.MDP3 - ES, NQ, CL, GC)
 */

import { HistoricalBar, Tick } from '../types.js';

// ==========================================
// Raw Databento JSON / DBN Record Interfaces
// ==========================================

export interface DbRecordHeader {
  length?: number;
  rtype?: number;
  publisher_id?: number;
  instrument_id: number;
  ts_event: string | number; // Unix nanoseconds
}

/** Databento trades schema record */
export interface DbTradeRecord {
  hd?: DbRecordHeader;
  instrument_id?: number;
  ts_event?: string | number;
  ts_recv?: string | number;
  action?: string; // 'T' = trade, 'A' = add, 'C' = cancel, etc.
  side?: string;   // 'A' = Ask (aggressor bought), 'B' = Bid (aggressor sold), 'N' = None
  price: number | string; // nanodollars or float
  size: number;
  channel_id?: number;
  order_id?: string | number;
  flags?: number;
  symbol?: string;
}

/** Databento MBP-1 schema record (top-of-book quote + trade) */
export interface DbMbp1Record {
  hd?: DbRecordHeader;
  instrument_id?: number;
  ts_event?: string | number;
  action?: string;
  side?: string;
  price?: number | string;
  size?: number;
  bid_px_00?: number | string;
  ask_px_00?: number | string;
  bid_sz_00?: number;
  ask_sz_00?: number;
  bid_ct_00?: number;
  ask_ct_00?: number;
  symbol?: string;
}

/** Databento OHLCV aggregate bar record */
export interface DbOhlcvRecord {
  hd?: DbRecordHeader;
  instrument_id?: number;
  ts_event?: string | number; // Open or close timestamp in nanoseconds
  open: number | string;
  high: number | string;
  low: number | string;
  close: number | string;
  volume: number;
  symbol?: string;
}

/** Databento definition record for options & futures */
export interface DbDefinitionRecord {
  hd?: DbRecordHeader;
  instrument_id: number;
  ts_event?: string | number;
  raw_symbol: string;
  symbol?: string;
  instrument_class?: string; // 'O' = Option, 'F' = Future, 'S' = Stock
  strike_price?: number | string; // nanodollars or float
  expiration?: string | number; // nanoseconds or ISO
  underlying_symbol?: string;
  contract_multiplier?: number;
  min_price_increment?: number | string;
  currency?: string;
}

/** Databento statistics schema record (Open Interest, Settlement, Volume) */
export interface DbStatisticsRecord {
  hd?: DbRecordHeader;
  instrument_id: number;
  ts_event?: string | number;
  stat_type: number; // 5 = Settlement, 6 = Open Interest, 7 = Cleared Volume, etc.
  price?: number | string;
  quantity?: number;
  symbol?: string;
}

// ==========================================
// Normalized DeepChart Data Interfaces
// ==========================================

export interface NormalizedTrade {
  symbol: string;
  price: number;
  size: number;
  timestamp: number; // Epoch milliseconds
  side: 'buy' | 'sell' | 'unknown';
  tradeId?: string;
  isBuyerMaker?: boolean;
}

export interface NormalizedQuote {
  symbol: string;
  bidPrice: number;
  askPrice: number;
  bidSize: number;
  askSize: number;
  timestamp: number; // Epoch milliseconds
  midPrice: number;
  spread: number;
}

export interface OptionContractDefinition {
  symbol: string;          // Full OSI symbol, e.g. SPY260320C00500000
  underlying: string;      // e.g. SPY
  expiration: string;      // YYYY-MM-DD
  expirationTimestamp: number; // Epoch ms
  type: 'call' | 'put';
  strike: number;          // e.g. 500
  dte: number;             // Days to expiration
  multiplier: number;      // Standard is 100
  instrumentId?: number;
}

export interface OptionStatisticRecord {
  symbol: string;
  timestamp: number;
  openInterest?: number;
  settlementPrice?: number;
  clearedVolume?: number;
}

export interface NormalizedOptionQuote extends NormalizedQuote {
  underlying: string;
  type: 'call' | 'put';
  strike: number;
  expiration: string;
  openInterest?: number;
  impliedVol?: number;
  delta?: number;
  gamma?: number;
  theta?: number;
  vega?: number;
}
