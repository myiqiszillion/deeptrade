/**
 * Databento Normalizer
 *
 * Converts Databento DBN / JSON records (trades, MBP-1 quotes, definitions, statistics)
 * into unified DeepChart types (NormalizedTrade, NormalizedQuote, OptionContractDefinition, OptionStatisticRecord).
 */

import {
  DbTradeRecord,
  DbMbp1Record,
  DbDefinitionRecord,
  DbStatisticsRecord,
  NormalizedTrade,
  NormalizedQuote,
  OptionContractDefinition,
  OptionStatisticRecord,
} from './types.js';

/**
 * Parses Databento fixed-point price.
 * In Databento DBN, prices are represented in nanodollars (1e9 = $1.00).
 * If the value is already a small decimal (e.g. 520.25), returns it directly.
 */
export function parsePrice(price: number | string | undefined | null): number {
  if (price === undefined || price === null || price === '') return 0;
  if (typeof price === 'string') {
    const num = parseFloat(price);
    if (isNaN(num)) return 0;
    if (price.includes('.')) {
      return num;
    }
    // Integer string: check if nanodollar scale
    if (Math.abs(num) >= 1_000_000_000 || Math.abs(num) >= 100_000_000) {
      return num / 1e9;
    }
    return num;
  }
  if (typeof price === 'number') {
    if (Math.abs(price) >= 100_000_000) {
      return price / 1e9;
    }
    return price;
  }
  return 0;
}

/**
 * Converts Databento nanosecond timestamps to Unix epoch milliseconds.
 */
export function parseTimestampMs(ts: string | number | bigint | undefined | null): number {
  if (!ts) return Date.now();
  if (typeof ts === 'bigint') {
    return Number(ts / 1_000_000n);
  }
  if (typeof ts === 'number') {
    if (ts > 1e15) {
      // Nanoseconds
      return Math.floor(ts / 1e6);
    }
    if (ts > 1e12) {
      // Microseconds
      return Math.floor(ts / 1e3);
    }
    return Math.floor(ts);
  }
  if (typeof ts === 'string') {
    if (/^\d+$/.test(ts)) {
      const num = BigInt(ts);
      return Number(num / 1_000_000n);
    }
    const parsed = Date.parse(ts);
    return isNaN(parsed) ? Date.now() : parsed;
  }
  return Date.now();
}

/**
 * Standard OSI Option Symbol parser.
 * Example: SPY260320C00500000 -> { underlying: 'SPY', expiration: '2026-03-20', type: 'call', strike: 500 }
 */
export function parseOsiSymbol(symbol: string): {
  underlying: string;
  expiration: string;
  expirationTs: number;
  type: 'call' | 'put';
  strike: number;
} | null {
  if (!symbol) return null;
  const match = symbol.trim().match(/^([A-Z]{1,6})(\d{2})(\d{2})(\d{2})([CP])(\d{8})$/);
  if (!match) return null;

  const [, rawUnderlying, yy, mm, dd, typeChar, strikeRaw] = match;
  const year = 2000 + parseInt(yy, 10);
  const expiration = `${year}-${mm}-${dd}`;
  const expirationTs = Date.parse(`${expiration}T20:00:00Z`);
  const type = typeChar === 'C' ? 'call' : 'put';
  const strike = parseInt(strikeRaw, 10) / 1000;

  return {
    underlying: rawUnderlying,
    expiration,
    expirationTs: isNaN(expirationTs) ? 0 : expirationTs,
    type,
    strike,
  };
}

/**
 * Normalizes a Databento trade record.
 */
export function normalizeTrade(rec: DbTradeRecord): NormalizedTrade {
  const ts = rec.ts_event ?? rec.hd?.ts_event;
  const timestamp = parseTimestampMs(ts);
  const price = parsePrice(rec.price);
  const size = Number(rec.size || 0);

  let side: 'buy' | 'sell' | 'unknown' = 'unknown';
  if (rec.side === 'A') {
    side = 'buy';
  } else if (rec.side === 'B') {
    side = 'sell';
  }

  return {
    symbol: rec.symbol || '',
    price,
    size,
    timestamp,
    side,
    tradeId: rec.order_id !== undefined ? String(rec.order_id) : undefined,
    isBuyerMaker: side === 'sell',
  };
}

/**
 * Normalizes a Databento MBP-1 top-of-book quote record.
 */
export function normalizeQuote(rec: DbMbp1Record): NormalizedQuote {
  const ts = rec.ts_event ?? rec.hd?.ts_event;
  const timestamp = parseTimestampMs(ts);
  const bidPrice = parsePrice(rec.bid_px_00);
  const askPrice = parsePrice(rec.ask_px_00);
  const bidSize = Number(rec.bid_sz_00 || 0);
  const askSize = Number(rec.ask_sz_00 || 0);
  const midPrice = (bidPrice + askPrice) / 2;
  const spread = askPrice - bidPrice;

  return {
    symbol: rec.symbol || '',
    bidPrice,
    askPrice,
    bidSize,
    askSize,
    timestamp,
    midPrice,
    spread,
  };
}

/**
 * Normalizes a Databento definition record for options.
 */
export function normalizeDefinition(rec: DbDefinitionRecord): OptionContractDefinition {
  const symbol = rec.raw_symbol || rec.symbol || '';
  const osi = parseOsiSymbol(symbol);

  const underlying = rec.underlying_symbol || osi?.underlying || '';
  const strike = rec.strike_price !== undefined ? parsePrice(rec.strike_price) : osi?.strike || 0;
  const type = osi?.type || (symbol.includes('C') ? 'call' : 'put');

  let expiration = osi?.expiration || '';
  let expirationTimestamp = osi?.expirationTs || 0;

  if (!expiration && rec.expiration) {
    expirationTimestamp = parseTimestampMs(rec.expiration);
    const d = new Date(expirationTimestamp);
    expiration = d.toISOString().split('T')[0];
  }

  const now = Date.now();
  const dte = Math.max(0, Math.ceil((expirationTimestamp - now) / (86400 * 1000)));

  return {
    symbol,
    underlying,
    expiration,
    expirationTimestamp,
    type,
    strike,
    dte,
    multiplier: rec.contract_multiplier || 100,
    instrumentId: rec.instrument_id,
  };
}

/**
 * Normalizes a Databento statistics record.
 * Stat types:
 * 5: Settlement price
 * 6: Open interest
 * 7: Cleared volume
 */
export function normalizeStatistic(rec: DbStatisticsRecord): OptionStatisticRecord {
  const ts = rec.ts_event ?? rec.hd?.ts_event;
  const timestamp = parseTimestampMs(ts);
  const result: OptionStatisticRecord = {
    symbol: rec.symbol || '',
    timestamp,
  };

  if (rec.stat_type === 5) {
    result.settlementPrice = parsePrice(rec.price);
  } else if (rec.stat_type === 6) {
    result.openInterest = rec.quantity ?? (rec.price !== undefined ? Math.round(parsePrice(rec.price)) : undefined);
  } else if (rec.stat_type === 7) {
    result.clearedVolume = rec.quantity ?? (rec.price !== undefined ? Math.round(parsePrice(rec.price)) : undefined);
  }

  return result;
}
