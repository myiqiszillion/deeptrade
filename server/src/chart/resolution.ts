import { HistoricalBar } from '../types.js';
import { resolveDatabentoConfig } from '../databento/config.js';

export interface ResolutionConfig {
  resolution: string;
  unit: 'second' | 'minute' | 'hour' | 'day' | 'week' | 'month';
  multiplier: number;
  intervalSeconds: number;
  databentoSchema: 'ohlcv-1s' | 'ohlcv-1m' | 'ohlcv-1h' | 'ohlcv-1d';
}

/**
 * Parses a TradingView resolution string into structured interval & Databento schema.
 * Examples:
 * - '1S', '5S', '15S' -> seconds
 * - '1', '5', '15', '30' -> minutes
 * - '60', '120', '240' -> hours
 * - 'D', '1D' -> daily
 * - 'W', '1W' -> weekly
 * - 'M', '1M' -> monthly
 */
export function parseTradingViewResolution(resolution = '1'): ResolutionConfig {
  const res = resolution.toUpperCase().trim();

  // 1. Seconds (e.g., '1S', '5S', '15S', '30S')
  if (res.endsWith('S')) {
    const mult = parseInt(res.slice(0, -1), 10) || 1;
    return {
      resolution: res,
      unit: 'second',
      multiplier: mult,
      intervalSeconds: mult,
      databentoSchema: 'ohlcv-1s',
    };
  }

  // 2. Day (e.g. 'D', '1D')
  if (res === 'D' || res === '1D') {
    return {
      resolution: '1D',
      unit: 'day',
      multiplier: 1,
      intervalSeconds: 86400,
      databentoSchema: 'ohlcv-1d',
    };
  }

  // 3. Week (e.g. 'W', '1W')
  if (res === 'W' || res === '1W') {
    return {
      resolution: '1W',
      unit: 'week',
      multiplier: 1,
      intervalSeconds: 7 * 86400,
      databentoSchema: 'ohlcv-1d',
    };
  }

  // 4. Month (e.g. 'M', '1M')
  if (res === 'M' || res === '1M') {
    return {
      resolution: '1M',
      unit: 'month',
      multiplier: 1,
      intervalSeconds: 30 * 86400,
      databentoSchema: 'ohlcv-1d',
    };
  }

  // 5. Minutes / Hours (pure integer, e.g. '1', '5', '15', '30', '60', '240')
  const minutes = parseInt(res, 10);
  if (isNaN(minutes) || minutes <= 1) {
    return {
      resolution: '1',
      unit: 'minute',
      multiplier: 1,
      intervalSeconds: 60,
      databentoSchema: 'ohlcv-1m',
    };
  }

  if (minutes < 60) {
    return {
      resolution: String(minutes),
      unit: 'minute',
      multiplier: minutes,
      intervalSeconds: minutes * 60,
      databentoSchema: 'ohlcv-1m',
    };
  }

  if (minutes >= 60 && minutes < 1440) {
    const hours = Math.round(minutes / 60);
    return {
      resolution: String(minutes),
      unit: 'hour',
      multiplier: hours,
      intervalSeconds: minutes * 60,
      databentoSchema: 'ohlcv-1h',
    };
  }

  // 1440 minutes or more = 1D+
  return {
    resolution: '1D',
    unit: 'day',
    multiplier: Math.round(minutes / 1440),
    intervalSeconds: minutes * 60,
    databentoSchema: 'ohlcv-1d',
  };
}

/**
 * Aggregates finer base bars into higher-order target resolution bars.
 */
export function aggregateBars(
  bars: HistoricalBar[],
  targetIntervalSeconds: number
): HistoricalBar[] {
  if (!bars || bars.length === 0) return [];
  if (targetIntervalSeconds <= 1) return bars;

  const targetIntervalMs = targetIntervalSeconds * 1000;
  const sorted = [...bars].sort((a, b) => a.time - b.time);
  const aggregated: HistoricalBar[] = [];

  let currentBucketTime = -1;
  let currentOpen = 0;
  let currentHigh = -Infinity;
  let currentLow = Infinity;
  let currentClose = 0;
  let currentVolume = 0;

  for (const bar of sorted) {
    const bucket = Math.floor(bar.time / targetIntervalMs) * targetIntervalMs;

    if (bucket !== currentBucketTime) {
      if (currentBucketTime !== -1) {
        aggregated.push({
          time: currentBucketTime,
          open: currentOpen,
          high: currentHigh,
          low: currentLow,
          close: currentClose,
          volume: currentVolume,
        });
      }
      currentBucketTime = bucket;
      currentOpen = bar.open;
      currentHigh = bar.high;
      currentLow = bar.low;
      currentClose = bar.close;
      currentVolume = bar.volume;
    } else {
      if (bar.high > currentHigh) currentHigh = bar.high;
      if (bar.low < currentLow) currentLow = bar.low;
      currentClose = bar.close;
      currentVolume += bar.volume;
    }
  }

  if (currentBucketTime !== -1) {
    aggregated.push({
      time: currentBucketTime,
      open: currentOpen,
      high: currentHigh,
      low: currentLow,
      close: currentClose,
      volume: currentVolume,
    });
  }

  return aggregated;
}

const CME_FUTURES_ROOTS = [
  'ES', 'NQ', 'MES', 'MNQ', 'RTY', 'M2K', 'YM', 'MYM',
  'CL', 'MCL', 'NG', 'MNG', 'GC', 'MGC', 'SI', 'SIL', 'HG',
  'ZB', 'ZN', 'ZF', 'ZT', 'UB',
  '6E', '6B', '6J', '6A', '6C',
  'ZC', 'ZS', 'ZW', 'ZM', 'ZL'
];

/**
 * Maps a trading symbol to appropriate Databento dataset and symbology query format.
 */
export function resolveSymbolForDatabento(symbol: string): {
  dataset: string;
  querySymbol: string;
  stypeIn?: string;
  isFutures: boolean;
  isOption: boolean;
} {
  const s = symbol.toUpperCase().trim();
  const cfg = resolveDatabentoConfig();

  // 1. OPRA Options
  if (s.includes('.OPT') || s.match(/^[A-Z]{1,6}\d{6}[CP]\d{8}$/)) {
    return {
      dataset: cfg.opraDataset,
      querySymbol: s,
      stypeIn: s.endsWith('.OPT') ? 'parent' : 'raw_symbol',
      isFutures: false,
      isOption: true,
    };
  }

  // 2. CME Futures
  const root = s.split('.')[0].split('/')[0].replace(/[0-9]+$/, '').replace(/[FGHJKMNQUVXZ]\d{1,2}$/, '');
  if (CME_FUTURES_ROOTS.includes(root) || CME_FUTURES_ROOTS.includes(s) || s.endsWith('.FUT')) {
    let querySymbol = s;
    let stypeIn: string | undefined = undefined;

    if (!querySymbol.includes('.')) {
      querySymbol = `${querySymbol}.c.0`;
      stypeIn = 'continuous';
    } else if (querySymbol.includes('.c.') || querySymbol.includes('.v.')) {
      stypeIn = 'continuous';
    } else if (querySymbol.endsWith('.FUT')) {
      stypeIn = 'parent';
    }

    return {
      dataset: cfg.cmeDataset,
      querySymbol,
      stypeIn,
      isFutures: true,
      isOption: false,
    };
  }

  // 3. Equities / ETFs
  return {
    dataset: cfg.equitiesDataset,
    querySymbol: s,
    stypeIn: 'raw_symbol',
    isFutures: false,
    isOption: false,
  };
}
