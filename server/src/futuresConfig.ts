export type AssetClass = 'EQUITY_INDEX' | 'COMMODITY' | 'ENERGY' | 'BOND' | 'CRYPTO';
export type ContractType = 'CONTINUOUS' | 'SPECIFIC';

export interface FuturesInstrument {
  symbol: string;
  rootSymbol: string;
  name: string;
  category: 'INDEX' | 'COMMODITY' | 'ENERGY' | 'BOND' | 'CRYPTO';
  assetClass: AssetClass;
  exchange: 'CME' | 'NYMEX' | 'COMEX' | 'CBOT' | 'BINANCE';
  tickSize: number;
  pointValue: number; // USD per full point move
  tickValue: number;  // USD per minimum tick move
  microSymbol?: string;
  microTickValue?: number;
  initialMargin: number;
  dayTradingMargin: number;
  underlyingIndex?: string; // For Options & GEX correlation (e.g., SPX for ES, NDX for NQ)
  basePrice: number;
  timezone: string; // Official exchange timezone (e.g. 'America/Chicago', 'America/New_York', 'UTC')
  currency: string; // Trading currency (e.g. 'USD', 'USDT')
  multiplier: number; // Contract multiplier
  isMicro: boolean; // True for micro contracts, false for full-size
  parentSymbol?: string; // Parent full-size contract for reference/correlation (e.g. 'ES' for 'MES')
  contractType: ContractType;
  contractMonth?: string;
  contractYear?: number;
  sessionScheduleId: string;
}

export const FUTURES_INSTRUMENTS: Record<string, FuturesInstrument> = {
  ES: {
    symbol: 'ES',
    rootSymbol: 'ES',
    name: 'E-mini S&P 500',
    category: 'INDEX',
    assetClass: 'EQUITY_INDEX',
    exchange: 'CME',
    tickSize: 0.25,
    pointValue: 50.0,
    tickValue: 12.5,
    microSymbol: 'MES',
    microTickValue: 1.25,
    initialMargin: 12500,
    dayTradingMargin: 500,
    underlyingIndex: 'SPX',
    basePrice: 5850.0,
    timezone: 'America/Chicago',
    currency: 'USD',
    multiplier: 50.0,
    isMicro: false,
    contractType: 'CONTINUOUS',
    sessionScheduleId: 'CME_EQUITY_INDEX',
  },
  MES: {
    symbol: 'MES',
    rootSymbol: 'MES',
    name: 'Micro E-mini S&P 500',
    category: 'INDEX',
    assetClass: 'EQUITY_INDEX',
    exchange: 'CME',
    tickSize: 0.25,
    pointValue: 5.0,
    tickValue: 1.25,
    initialMargin: 1250,
    dayTradingMargin: 50,
    underlyingIndex: 'SPX',
    basePrice: 5850.0,
    timezone: 'America/Chicago',
    currency: 'USD',
    multiplier: 5.0,
    isMicro: true,
    parentSymbol: 'ES',
    contractType: 'CONTINUOUS',
    sessionScheduleId: 'CME_EQUITY_INDEX',
  },
  NQ: {
    symbol: 'NQ',
    rootSymbol: 'NQ',
    name: 'E-mini Nasdaq 100',
    category: 'INDEX',
    assetClass: 'EQUITY_INDEX',
    exchange: 'CME',
    tickSize: 0.25,
    pointValue: 20.0,
    tickValue: 5.0,
    microSymbol: 'MNQ',
    microTickValue: 0.5,
    initialMargin: 18000,
    dayTradingMargin: 1000,
    underlyingIndex: 'NDX',
    basePrice: 20500.0,
    timezone: 'America/Chicago',
    currency: 'USD',
    multiplier: 20.0,
    isMicro: false,
    contractType: 'CONTINUOUS',
    sessionScheduleId: 'CME_EQUITY_INDEX',
  },
  MNQ: {
    symbol: 'MNQ',
    rootSymbol: 'MNQ',
    name: 'Micro E-mini Nasdaq 100',
    category: 'INDEX',
    assetClass: 'EQUITY_INDEX',
    exchange: 'CME',
    tickSize: 0.25,
    pointValue: 2.0,
    tickValue: 0.5,
    initialMargin: 1800,
    dayTradingMargin: 100,
    underlyingIndex: 'NDX',
    basePrice: 20500.0,
    timezone: 'America/Chicago',
    currency: 'USD',
    multiplier: 2.0,
    isMicro: true,
    parentSymbol: 'NQ',
    contractType: 'CONTINUOUS',
    sessionScheduleId: 'CME_EQUITY_INDEX',
  },
  YM: {
    symbol: 'YM',
    rootSymbol: 'YM',
    name: 'E-mini Dow Jones',
    category: 'INDEX',
    assetClass: 'EQUITY_INDEX',
    exchange: 'CBOT',
    tickSize: 1.0,
    pointValue: 5.0,
    tickValue: 5.0,
    microSymbol: 'MYM',
    microTickValue: 0.5,
    initialMargin: 9500,
    dayTradingMargin: 500,
    underlyingIndex: 'DJI',
    basePrice: 42500.0,
    timezone: 'America/Chicago',
    currency: 'USD',
    multiplier: 5.0,
    isMicro: false,
    contractType: 'CONTINUOUS',
    sessionScheduleId: 'CBOT_EQUITY_INDEX',
  },
  MYM: {
    symbol: 'MYM',
    rootSymbol: 'MYM',
    name: 'Micro E-mini Dow Jones',
    category: 'INDEX',
    assetClass: 'EQUITY_INDEX',
    exchange: 'CBOT',
    tickSize: 1.0,
    pointValue: 0.5,
    tickValue: 0.5,
    initialMargin: 950,
    dayTradingMargin: 50,
    underlyingIndex: 'DJI',
    basePrice: 42500.0,
    timezone: 'America/Chicago',
    currency: 'USD',
    multiplier: 0.5,
    isMicro: true,
    parentSymbol: 'YM',
    contractType: 'CONTINUOUS',
    sessionScheduleId: 'CBOT_EQUITY_INDEX',
  },
  RTY: {
    symbol: 'RTY',
    rootSymbol: 'RTY',
    name: 'E-mini Russell 2000',
    category: 'INDEX',
    assetClass: 'EQUITY_INDEX',
    exchange: 'CME',
    tickSize: 0.1,
    pointValue: 50.0,
    tickValue: 5.0,
    microSymbol: 'M2K',
    microTickValue: 0.5,
    initialMargin: 7500,
    dayTradingMargin: 500,
    underlyingIndex: 'RUT',
    basePrice: 2280.0,
    timezone: 'America/Chicago',
    currency: 'USD',
    multiplier: 50.0,
    isMicro: false,
    contractType: 'CONTINUOUS',
    sessionScheduleId: 'CME_EQUITY_INDEX',
  },
  M2K: {
    symbol: 'M2K',
    rootSymbol: 'M2K',
    name: 'Micro E-mini Russell 2000',
    category: 'INDEX',
    assetClass: 'EQUITY_INDEX',
    exchange: 'CME',
    tickSize: 0.1,
    pointValue: 5.0,
    tickValue: 0.5,
    initialMargin: 750,
    dayTradingMargin: 50,
    underlyingIndex: 'RUT',
    basePrice: 2280.0,
    timezone: 'America/Chicago',
    currency: 'USD',
    multiplier: 5.0,
    isMicro: true,
    parentSymbol: 'RTY',
    contractType: 'CONTINUOUS',
    sessionScheduleId: 'CME_EQUITY_INDEX',
  },
  GC: {
    symbol: 'GC',
    rootSymbol: 'GC',
    name: 'Gold Futures',
    category: 'COMMODITY',
    assetClass: 'COMMODITY',
    exchange: 'COMEX',
    tickSize: 0.1,
    pointValue: 100.0,
    tickValue: 10.0,
    microSymbol: 'MGC',
    microTickValue: 1.0,
    initialMargin: 11000,
    dayTradingMargin: 1000,
    basePrice: 2650.0,
    timezone: 'America/New_York',
    currency: 'USD',
    multiplier: 100.0,
    isMicro: false,
    contractType: 'CONTINUOUS',
    sessionScheduleId: 'COMEX_METALS',
  },
  MGC: {
    symbol: 'MGC',
    rootSymbol: 'MGC',
    name: 'Micro Gold Futures',
    category: 'COMMODITY',
    assetClass: 'COMMODITY',
    exchange: 'COMEX',
    tickSize: 0.1,
    pointValue: 10.0,
    tickValue: 1.0,
    initialMargin: 1100,
    dayTradingMargin: 100,
    basePrice: 2650.0,
    timezone: 'America/New_York',
    currency: 'USD',
    multiplier: 10.0,
    isMicro: true,
    parentSymbol: 'GC',
    contractType: 'CONTINUOUS',
    sessionScheduleId: 'COMEX_METALS',
  },
  CL: {
    symbol: 'CL',
    rootSymbol: 'CL',
    name: 'Crude Oil',
    category: 'ENERGY',
    assetClass: 'ENERGY',
    exchange: 'NYMEX',
    tickSize: 0.01,
    pointValue: 1000.0,
    tickValue: 10.0,
    microSymbol: 'MCL',
    microTickValue: 1.0,
    initialMargin: 8000,
    dayTradingMargin: 1000,
    basePrice: 71.5,
    timezone: 'America/New_York',
    currency: 'USD',
    multiplier: 1000.0,
    isMicro: false,
    contractType: 'CONTINUOUS',
    sessionScheduleId: 'NYMEX_ENERGY',
  },
  MCL: {
    symbol: 'MCL',
    rootSymbol: 'MCL',
    name: 'Micro WTI Crude Oil',
    category: 'ENERGY',
    assetClass: 'ENERGY',
    exchange: 'NYMEX',
    tickSize: 0.01,
    pointValue: 100.0,
    tickValue: 1.0,
    initialMargin: 800,
    dayTradingMargin: 100,
    basePrice: 71.5,
    timezone: 'America/New_York',
    currency: 'USD',
    multiplier: 100.0,
    isMicro: true,
    parentSymbol: 'CL',
    contractType: 'CONTINUOUS',
    sessionScheduleId: 'NYMEX_ENERGY',
  },
  NG: {
    symbol: 'NG',
    rootSymbol: 'NG',
    name: 'Natural Gas',
    category: 'ENERGY',
    assetClass: 'ENERGY',
    exchange: 'NYMEX',
    tickSize: 0.001,
    pointValue: 10000.0,
    tickValue: 10.0,
    initialMargin: 6000,
    dayTradingMargin: 1000,
    basePrice: 2.85,
    timezone: 'America/New_York',
    currency: 'USD',
    multiplier: 10000.0,
    isMicro: false,
    contractType: 'CONTINUOUS',
    sessionScheduleId: 'NYMEX_ENERGY',
  },
  BTCUSDT: {
    symbol: 'BTCUSDT',
    rootSymbol: 'BTCUSDT',
    name: 'Bitcoin Perpetual',
    category: 'CRYPTO',
    assetClass: 'CRYPTO',
    exchange: 'BINANCE',
    tickSize: 0.1,
    pointValue: 1.0,
    tickValue: 0.1,
    initialMargin: 1000,
    dayTradingMargin: 100,
    basePrice: 65000.0,
    timezone: 'UTC',
    currency: 'USDT',
    multiplier: 1.0,
    isMicro: false,
    contractType: 'CONTINUOUS',
    sessionScheduleId: 'BINANCE_24_7',
  },
};

/**
 * Check if a symbol represents a continuous contract (e.g. 'ES', 'NQ') vs a specific contract month ('ESH6', 'ESZ26').
 */
export function isContinuousContract(symbol: string): boolean {
  const inst = FUTURES_INSTRUMENTS[symbol];
  if (inst) return inst.contractType === 'CONTINUOUS';
  // Specific month format e.g. ESH26 or ESZ6
  return !/^[A-Z0-9]+[FGHJKMNQUVXZ]\d{1,2}$/i.test(symbol);
}

/**
 * Parse a contract symbol into its root, month code, year, and continuous flag.
 * Standard month codes: F (Jan), G (Feb), H (Mar), J (Apr), K (May), M (Jun),
 *                       N (Jul), Q (Aug), U (Sep), V (Oct), X (Nov), Z (Dec)
 */
export function parseContractSymbol(symbol: string): {
  root: string;
  month?: string;
  year?: number;
  isContinuous: boolean;
} {
  const match = symbol.match(/^([A-Z0-9]+?)([FGHJKMNQUVXZ])(\d{1,2})$/i);
  if (match) {
    const root = match[1].toUpperCase();
    const month = match[2].toUpperCase();
    const rawYearStr = match[3];
    let yearNum: number;
    const currentYear = new Date().getFullYear();
    const currentDecade = Math.floor(currentYear / 10) * 10; // e.g. 2020

    if (rawYearStr.length === 1) {
      // 1-digit year code: e.g. '6' -> 2026
      yearNum = currentDecade + parseInt(rawYearStr, 10);
      if (yearNum < currentYear - 2) {
        yearNum += 10;
      }
    } else if (rawYearStr.length === 2) {
      // 2-digit year code: e.g. '26' -> 2026
      yearNum = 2000 + parseInt(rawYearStr, 10);
    } else {
      yearNum = parseInt(rawYearStr, 10);
    }

    return {
      root,
      month,
      year: yearNum,
      isContinuous: false,
    };
  }

  return {
    root: symbol.toUpperCase(),
    isContinuous: true,
  };
}

/** Check whether a symbol is a micro contract. */
export function isMicroContract(symbol: string): boolean {
  const parsed = parseContractSymbol(symbol);
  const inst = FUTURES_INSTRUMENTS[parsed.root];
  return inst ? inst.isMicro : false;
}

/** Get parent full-size symbol for a micro contract, or undefined if already full-size / not micro. */
export function getParentSymbol(symbol: string): string | undefined {
  const parsed = parseContractSymbol(symbol);
  const inst = FUTURES_INSTRUMENTS[parsed.root];
  return inst?.parentSymbol;
}

/** Format a symbol for vendor-specific requests according to official specifications. */
export function formatVendorSymbol(
  vendor: 'tradovate' | 'databento' | 'binance',
  symbol: string,
  contractMonth?: string
): string {
  if (vendor === 'binance') {
    return symbol.toUpperCase();
  }

  if (vendor === 'tradovate') {
    // Tradovate uses @ROOT for continuous front-month, or ROOT + MONTH + YEAR (e.g. ESH6)
    if (contractMonth) {
      return `${symbol}${contractMonth}`;
    }
    return `@${symbol}`;
  }

  if (vendor === 'databento') {
    // Databento symbology e.g. ES.FUT or ES.c.0
    return `${symbol}.FUT`;
  }

  return symbol;
}
