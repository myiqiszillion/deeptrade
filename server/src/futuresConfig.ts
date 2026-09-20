export interface FuturesInstrument {
  symbol: string;
  name: string;
  category: 'INDEX' | 'COMMODITY' | 'ENERGY' | 'BOND' | 'CRYPTO';
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
}

export const FUTURES_INSTRUMENTS: Record<string, FuturesInstrument> = {
  ES: {
    symbol: 'ES',
    name: 'E-mini S&P 500',
    category: 'INDEX',
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
  },
  NQ: {
    symbol: 'NQ',
    name: 'E-mini Nasdaq 100',
    category: 'INDEX',
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
  },
  YM: {
    symbol: 'YM',
    name: 'E-mini Dow Jones',
    category: 'INDEX',
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
  },
  RTY: {
    symbol: 'RTY',
    name: 'E-mini Russell 2000',
    category: 'INDEX',
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
  },
  GC: {
    symbol: 'GC',
    name: 'Gold Futures',
    category: 'COMMODITY',
    exchange: 'COMEX',
    tickSize: 0.1,
    pointValue: 100.0,
    tickValue: 10.0,
    microSymbol: 'MGC',
    microTickValue: 1.0,
    initialMargin: 11000,
    dayTradingMargin: 1000,
    basePrice: 2650.0,
  },
  CL: {
    symbol: 'CL',
    name: 'Crude Oil',
    category: 'ENERGY',
    exchange: 'NYMEX',
    tickSize: 0.01,
    pointValue: 1000.0,
    tickValue: 10.0,
    microSymbol: 'MCL',
    microTickValue: 1.0,
    initialMargin: 8000,
    dayTradingMargin: 1000,
    basePrice: 71.5,
  },
  NG: {
    symbol: 'NG',
    name: 'Natural Gas',
    category: 'ENERGY',
    exchange: 'NYMEX',
    tickSize: 0.001,
    pointValue: 10000.0,
    tickValue: 10.0,
    initialMargin: 6000,
    dayTradingMargin: 1000,
    basePrice: 2.85,
  },
  BTCUSDT: {
    symbol: 'BTCUSDT',
    name: 'Bitcoin Perpetual',
    category: 'CRYPTO',
    exchange: 'BINANCE',
    tickSize: 0.1,
    pointValue: 1.0,
    tickValue: 0.1,
    initialMargin: 1000,
    dayTradingMargin: 100,
    basePrice: 65000.0,
  },
};
