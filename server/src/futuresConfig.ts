export type AssetClass =
  | 'EQUITY_INDEX'
  | 'COMMODITY'
  | 'ENERGY'
  | 'BOND'
  | 'METALS'
  | 'AGRICULTURE'
  | 'FX'
  | 'RATES'
  | 'CRYPTO';

/** UI grouping for the instrument picker. */
export type InstrumentCategory =
  | 'INDEX'
  | 'COMMODITY'
  | 'ENERGY'
  | 'BOND'
  | 'METALS'
  | 'AGRICULTURE'
  | 'FX'
  | 'RATES'
  | 'CRYPTO'
  /** Vendor-discovered instrument whose unit of measure we cannot categorise confidently. */
  | 'OTHER';

export type ExchangeName = 'CME' | 'NYMEX' | 'COMEX' | 'CBOT' | 'BINANCE';

export type ContractType = 'CONTINUOUS' | 'SPECIFIC';

export interface FuturesInstrument {
  symbol: string;
  rootSymbol: string;
  name: string;
  category: InstrumentCategory;
  assetClass: AssetClass;
  exchange: ExchangeName;
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
    category: 'METALS',
    assetClass: 'METALS',
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
    category: 'METALS',
    assetClass: 'METALS',
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
    microSymbol: 'MNG',
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
};

/**
 * CME Group product universe.
 *
 * Rows are declared once and expanded into full {@link FuturesInstrument} records: `tickValue` is always
 * derived as `pointValue × tickSize` so the two can never drift apart (a wrong tick/multiplier means wrong
 * P&L, wrong whale notches and wrong footprint grouping — the one class of bug this app must not ship).
 *
 * Specs (contract unit → point value, minimum price increment) come from CME Group contract
 * specifications; each row states the unit so the number is auditable:
 *   metals/energy/ags → NYMEX/COMEX/CBOT spec sheets, rates → CBOT, FX/crypto → CME.
 * `initialMargin`/`dayTradingMargin` stay 0 unless verified: the UI hides unknown margins instead of
 * inventing them (ask your broker or wire a margin feed before showing risk numbers).
 */
interface SpecRow {
  symbol: string;
  name: string;
  category: InstrumentCategory;
  assetClass: AssetClass;
  exchange: ExchangeName;
  /** USD per full point of price movement (= contract unit × quote convention). */
  pointValue: number;
  /** Minimum price increment in price units. */
  tickSize: number;
  basePrice: number;
  sessionScheduleId: string;
  underlyingIndex?: string;
  microSymbol?: string;
  microTickValue?: number;
  parentSymbol?: string;
  isMicro?: boolean;
}

const SPEC_TABLE: SpecRow[] = [
  // --- COMEX metals (unit: troy oz / lb) ---
  { symbol: 'SI', name: 'Silver', category: 'METALS', assetClass: 'METALS', exchange: 'COMEX', pointValue: 5000, tickSize: 0.005, basePrice: 48.0, sessionScheduleId: 'COMEX_METALS', microSymbol: 'SIL' },
  { symbol: 'SIL', name: 'Micro Silver', category: 'METALS', assetClass: 'METALS', exchange: 'COMEX', pointValue: 1000, tickSize: 0.005, basePrice: 48.0, sessionScheduleId: 'COMEX_METALS', parentSymbol: 'SI' },
  { symbol: 'HG', name: 'Copper', category: 'METALS', assetClass: 'METALS', exchange: 'COMEX', pointValue: 25000, tickSize: 0.0005, basePrice: 4.6, sessionScheduleId: 'COMEX_METALS', microSymbol: 'MHG' },
  { symbol: 'MHG', name: 'Micro Copper', category: 'METALS', assetClass: 'METALS', exchange: 'COMEX', pointValue: 2500, tickSize: 0.0005, basePrice: 4.6, sessionScheduleId: 'COMEX_METALS', parentSymbol: 'HG' },

  // --- NYMEX energy (unit: bbl / mmBtu / gal) ---
  { symbol: 'MNG', name: 'Micro Henry Hub Natural Gas', category: 'ENERGY', assetClass: 'ENERGY', exchange: 'NYMEX', pointValue: 1000, tickSize: 0.001, basePrice: 2.85, sessionScheduleId: 'NYMEX_ENERGY', parentSymbol: 'NG' },
  { symbol: 'RB', name: 'RBOB Gasoline', category: 'ENERGY', assetClass: 'ENERGY', exchange: 'NYMEX', pointValue: 42000, tickSize: 0.0001, basePrice: 2.05, sessionScheduleId: 'NYMEX_ENERGY' },
  { symbol: 'HO', name: 'NY Harbor ULSD (Heating Oil)', category: 'ENERGY', assetClass: 'ENERGY', exchange: 'NYMEX', pointValue: 42000, tickSize: 0.0001, basePrice: 2.35, sessionScheduleId: 'NYMEX_ENERGY' },

  // --- Grains / softs / livestock (quoted in cents: 1 full point = 100 cents) ---
  { symbol: 'ZC', name: 'Corn', category: 'AGRICULTURE', assetClass: 'AGRICULTURE', exchange: 'CBOT', pointValue: 50, tickSize: 0.25, basePrice: 430.0, sessionScheduleId: 'CBOT_AG' },
  { symbol: 'ZS', name: 'Soybeans', category: 'AGRICULTURE', assetClass: 'AGRICULTURE', exchange: 'CBOT', pointValue: 50, tickSize: 0.25, basePrice: 1050.0, sessionScheduleId: 'CBOT_AG' },
  { symbol: 'ZW', name: 'Chicago SRW Wheat', category: 'AGRICULTURE', assetClass: 'AGRICULTURE', exchange: 'CBOT', pointValue: 50, tickSize: 0.25, basePrice: 550.0, sessionScheduleId: 'CBOT_AG' },
  { symbol: 'ZL', name: 'Soybean Oil', category: 'AGRICULTURE', assetClass: 'AGRICULTURE', exchange: 'CBOT', pointValue: 600, tickSize: 0.01, basePrice: 50.0, sessionScheduleId: 'CBOT_AG' },
  { symbol: 'LE', name: 'Live Cattle', category: 'AGRICULTURE', assetClass: 'AGRICULTURE', exchange: 'CME', pointValue: 400, tickSize: 0.025, basePrice: 230.0, sessionScheduleId: 'CME_LIVESTOCK' },
  { symbol: 'HE', name: 'Lean Hogs', category: 'AGRICULTURE', assetClass: 'AGRICULTURE', exchange: 'CME', pointValue: 400, tickSize: 0.025, basePrice: 85.0, sessionScheduleId: 'CME_LIVESTOCK' },
  { symbol: 'GF', name: 'Feeder Cattle', category: 'AGRICULTURE', assetClass: 'AGRICULTURE', exchange: 'CME', pointValue: 500, tickSize: 0.025, basePrice: 300.0, sessionScheduleId: 'CME_LIVESTOCK' },

  // --- CBOT interest rates (quoted in points of par: 1 point = $1,000 / $2,000) ---
  { symbol: 'ZT', name: '2-Year T-Note', category: 'RATES', assetClass: 'RATES', exchange: 'CBOT', pointValue: 2000, tickSize: 0.00390625, basePrice: 104.0, sessionScheduleId: 'CBOT_RATES' },
  { symbol: 'ZF', name: '5-Year T-Note', category: 'RATES', assetClass: 'RATES', exchange: 'CBOT', pointValue: 1000, tickSize: 0.0078125, basePrice: 110.0, sessionScheduleId: 'CBOT_RATES' },
  { symbol: 'ZN', name: '10-Year T-Note', category: 'RATES', assetClass: 'RATES', exchange: 'CBOT', pointValue: 1000, tickSize: 0.015625, basePrice: 113.0, sessionScheduleId: 'CBOT_RATES' },
  { symbol: 'ZB', name: '30-Year T-Bond', category: 'RATES', assetClass: 'RATES', exchange: 'CBOT', pointValue: 1000, tickSize: 0.03125, basePrice: 118.0, sessionScheduleId: 'CBOT_RATES' },

  // --- CME FX (all quote in USD per unit of the foreign currency) ---
  { symbol: '6E', name: 'Euro FX', category: 'FX', assetClass: 'FX', exchange: 'CME', pointValue: 125000, tickSize: 0.00005, basePrice: 1.17, sessionScheduleId: 'CME_FX', microSymbol: 'M6E' },
  { symbol: 'M6E', name: 'Micro EUR/USD', category: 'FX', assetClass: 'FX', exchange: 'CME', pointValue: 12500, tickSize: 0.0001, basePrice: 1.17, sessionScheduleId: 'CME_FX', parentSymbol: '6E' },
  { symbol: '6J', name: 'Japanese Yen', category: 'FX', assetClass: 'FX', exchange: 'CME', pointValue: 12500000, tickSize: 0.0000005, basePrice: 0.0067, sessionScheduleId: 'CME_FX' },
  { symbol: '6B', name: 'British Pound', category: 'FX', assetClass: 'FX', exchange: 'CME', pointValue: 62500, tickSize: 0.0001, basePrice: 1.34, sessionScheduleId: 'CME_FX', microSymbol: 'M6B' },
  { symbol: 'M6B', name: 'Micro GBP/USD', category: 'FX', assetClass: 'FX', exchange: 'CME', pointValue: 6250, tickSize: 0.0001, basePrice: 1.34, sessionScheduleId: 'CME_FX', parentSymbol: '6B' },
  { symbol: '6A', name: 'Australian Dollar', category: 'FX', assetClass: 'FX', exchange: 'CME', pointValue: 100000, tickSize: 0.00005, basePrice: 0.66, sessionScheduleId: 'CME_FX', microSymbol: 'M6A' },
  { symbol: 'M6A', name: 'Micro AUD/USD', category: 'FX', assetClass: 'FX', exchange: 'CME', pointValue: 10000, tickSize: 0.0001, basePrice: 0.66, sessionScheduleId: 'CME_FX', parentSymbol: '6A' },
  { symbol: '6C', name: 'Canadian Dollar', category: 'FX', assetClass: 'FX', exchange: 'CME', pointValue: 100000, tickSize: 0.00005, basePrice: 0.72, sessionScheduleId: 'CME_FX' },
  { symbol: 'MSF', name: 'Micro CHF/USD', category: 'FX', assetClass: 'FX', exchange: 'CME', pointValue: 12500, tickSize: 0.0001, basePrice: 1.13, sessionScheduleId: 'CME_FX', isMicro: true },

  // --- CME crypto (quoted in USD; CME Globex trades Sun–Fri CT) ---
  { symbol: 'BTC', name: 'Bitcoin', category: 'CRYPTO', assetClass: 'CRYPTO', exchange: 'CME', pointValue: 5, tickSize: 5, basePrice: 95000, sessionScheduleId: 'CME_CRYPTO', microSymbol: 'MBT' },
  { symbol: 'MBT', name: 'Micro Bitcoin', category: 'CRYPTO', assetClass: 'CRYPTO', exchange: 'CME', pointValue: 0.1, tickSize: 5, basePrice: 95000, sessionScheduleId: 'CME_CRYPTO', parentSymbol: 'BTC' },
  { symbol: 'MET', name: 'Micro Ether', category: 'CRYPTO', assetClass: 'CRYPTO', exchange: 'CME', pointValue: 0.1, tickSize: 0.5, basePrice: 3200, sessionScheduleId: 'CME_CRYPTO', isMicro: true },

  // --- COMEX / NYMEX additional metals ---
  { symbol: 'PL', name: 'Platinum', category: 'METALS', assetClass: 'METALS', exchange: 'NYMEX', pointValue: 50, tickSize: 0.1, basePrice: 950.0, sessionScheduleId: 'NYMEX_METALS' },
  { symbol: 'PA', name: 'Palladium', category: 'METALS', assetClass: 'METALS', exchange: 'NYMEX', pointValue: 100, tickSize: 0.5, basePrice: 1000.0, sessionScheduleId: 'NYMEX_METALS' },

  // --- CBOT additional ags ---
  { symbol: 'ZM', name: 'Soybean Meal', category: 'AGRICULTURE', assetClass: 'AGRICULTURE', exchange: 'CBOT', pointValue: 100, tickSize: 0.1, basePrice: 320.0, sessionScheduleId: 'CBOT_AG' },

  // --- Equities & Indices (Treated as 1 point = $1, tick size 0.01) ---
  { symbol: 'SPY', name: 'SPDR S&P 500 ETF', category: 'INDEX', assetClass: 'EQUITY_INDEX', exchange: 'CME', pointValue: 100, tickSize: 0.01, basePrice: 600.0, sessionScheduleId: 'CME_EQUITY' },
  { symbol: 'QQQ', name: 'Invesco QQQ Trust', category: 'INDEX', assetClass: 'EQUITY_INDEX', exchange: 'CME', pointValue: 100, tickSize: 0.01, basePrice: 500.0, sessionScheduleId: 'CME_EQUITY' },
  { symbol: 'IWM', name: 'iShares Russell 2000 ETF', category: 'INDEX', assetClass: 'EQUITY_INDEX', exchange: 'CME', pointValue: 100, tickSize: 0.01, basePrice: 200.0, sessionScheduleId: 'CME_EQUITY' },
  { symbol: 'DIA', name: 'SPDR Dow Jones Industrial Average', category: 'INDEX', assetClass: 'EQUITY_INDEX', exchange: 'CME', pointValue: 100, tickSize: 0.01, basePrice: 400.0, sessionScheduleId: 'CME_EQUITY' },
  { symbol: 'SPX', name: 'S&P 500 Index', category: 'INDEX', assetClass: 'EQUITY_INDEX', exchange: 'CME', pointValue: 100, tickSize: 0.01, basePrice: 6000.0, sessionScheduleId: 'CME_EQUITY' },
  { symbol: 'NDX', name: 'Nasdaq 100 Index', category: 'INDEX', assetClass: 'EQUITY_INDEX', exchange: 'CME', pointValue: 100, tickSize: 0.01, basePrice: 20000.0, sessionScheduleId: 'CME_EQUITY' },
  { symbol: 'VIX', name: 'CBOE Volatility Index', category: 'INDEX', assetClass: 'EQUITY_INDEX', exchange: 'CME', pointValue: 1000, tickSize: 0.05, basePrice: 15.0, sessionScheduleId: 'CME_EQUITY' },
  { symbol: 'RUT', name: 'Russell 2000 Index', category: 'INDEX', assetClass: 'EQUITY_INDEX', exchange: 'CME', pointValue: 100, tickSize: 0.01, basePrice: 2000.0, sessionScheduleId: 'CME_EQUITY' },

  // --- Big Tech ---
  { symbol: 'AAPL', name: 'Apple Inc.', category: 'OTHER', assetClass: 'EQUITY_INDEX', exchange: 'CME', pointValue: 100, tickSize: 0.01, basePrice: 250.0, sessionScheduleId: 'CME_EQUITY' },
  { symbol: 'TSLA', name: 'Tesla, Inc.', category: 'OTHER', assetClass: 'EQUITY_INDEX', exchange: 'CME', pointValue: 100, tickSize: 0.01, basePrice: 350.0, sessionScheduleId: 'CME_EQUITY' },
  { symbol: 'NVDA', name: 'NVIDIA Corp.', category: 'OTHER', assetClass: 'EQUITY_INDEX', exchange: 'CME', pointValue: 100, tickSize: 0.01, basePrice: 130.0, sessionScheduleId: 'CME_EQUITY' },
  { symbol: 'AMZN', name: 'Amazon.com Inc.', category: 'OTHER', assetClass: 'EQUITY_INDEX', exchange: 'CME', pointValue: 100, tickSize: 0.01, basePrice: 200.0, sessionScheduleId: 'CME_EQUITY' },
  { symbol: 'MSFT', name: 'Microsoft Corp.', category: 'OTHER', assetClass: 'EQUITY_INDEX', exchange: 'CME', pointValue: 100, tickSize: 0.01, basePrice: 400.0, sessionScheduleId: 'CME_EQUITY' },
  { symbol: 'META', name: 'Meta Platforms Inc.', category: 'OTHER', assetClass: 'EQUITY_INDEX', exchange: 'CME', pointValue: 100, tickSize: 0.01, basePrice: 600.0, sessionScheduleId: 'CME_EQUITY' },
  { symbol: 'GOOGL', name: 'Alphabet Inc. Cl A', category: 'OTHER', assetClass: 'EQUITY_INDEX', exchange: 'CME', pointValue: 100, tickSize: 0.01, basePrice: 180.0, sessionScheduleId: 'CME_EQUITY' },
  { symbol: 'GOOG', name: 'Alphabet Inc. Cl C', category: 'OTHER', assetClass: 'EQUITY_INDEX', exchange: 'CME', pointValue: 100, tickSize: 0.01, basePrice: 180.0, sessionScheduleId: 'CME_EQUITY' },
  { symbol: 'MSTR', name: 'MicroStrategy Inc.', category: 'OTHER', assetClass: 'EQUITY_INDEX', exchange: 'CME', pointValue: 100, tickSize: 0.01, basePrice: 350.0, sessionScheduleId: 'CME_EQUITY' },
  { symbol: 'COIN', name: 'Coinbase Global Inc.', category: 'OTHER', assetClass: 'EQUITY_INDEX', exchange: 'CME', pointValue: 100, tickSize: 0.01, basePrice: 300.0, sessionScheduleId: 'CME_EQUITY' },
  { symbol: 'AMD', name: 'Advanced Micro Devices', category: 'OTHER', assetClass: 'EQUITY_INDEX', exchange: 'CME', pointValue: 100, tickSize: 0.01, basePrice: 150.0, sessionScheduleId: 'CME_EQUITY' },
  { symbol: 'SMCI', name: 'Super Micro Computer', category: 'OTHER', assetClass: 'EQUITY_INDEX', exchange: 'CME', pointValue: 100, tickSize: 0.01, basePrice: 50.0, sessionScheduleId: 'CME_EQUITY' },
  { symbol: 'PLTR', name: 'Palantir Technologies', category: 'OTHER', assetClass: 'EQUITY_INDEX', exchange: 'CME', pointValue: 100, tickSize: 0.01, basePrice: 50.0, sessionScheduleId: 'CME_EQUITY' },

  // --- Crypto Spot/Alts ---
  { symbol: 'SOL', name: 'Solana', category: 'CRYPTO', assetClass: 'CRYPTO', exchange: 'BINANCE', pointValue: 1, tickSize: 0.01, basePrice: 200.0, sessionScheduleId: 'CME_CRYPTO' },
  { symbol: 'XRP', name: 'XRP', category: 'CRYPTO', assetClass: 'CRYPTO', exchange: 'BINANCE', pointValue: 1, tickSize: 0.0001, basePrice: 3.0, sessionScheduleId: 'CME_CRYPTO' },
  { symbol: 'DOGE', name: 'Dogecoin', category: 'CRYPTO', assetClass: 'CRYPTO', exchange: 'BINANCE', pointValue: 1, tickSize: 0.0001, basePrice: 0.3, sessionScheduleId: 'CME_CRYPTO' },
];

export const INSTRUMENT_CATEGORIES: InstrumentCategory[] = [
  'INDEX',
  'COMMODITY',
  'ENERGY',
  'BOND',
  'METALS',
  'AGRICULTURE',
  'FX',
  'RATES',
  'CRYPTO',
  'OTHER',
];

export const EXCHANGE_NAMES: ExchangeName[] = ['CME', 'NYMEX', 'COMEX', 'CBOT', 'BINANCE'];

/** Derive tick value from the contract's point value so the two can never disagree. */
export function tickValueFor(pointValue: number, tickSize: number): number {
  return Number((pointValue * tickSize).toFixed(10));
}

function specRowToInstrument(row: SpecRow): FuturesInstrument {
  return {
    symbol: row.symbol,
    rootSymbol: row.symbol,
    name: row.name,
    category: row.category,
    assetClass: row.assetClass,
    exchange: row.exchange,
    tickSize: row.tickSize,
    pointValue: row.pointValue,
    tickValue: tickValueFor(row.pointValue, row.tickSize),
    microSymbol: row.microSymbol,
    microTickValue: row.microTickValue,
    // 0 = not verified: the picker hides unknown margins rather than showing an invented number.
    initialMargin: 0,
    dayTradingMargin: 0,
    underlyingIndex: row.underlyingIndex,
    basePrice: row.basePrice,
    timezone: 'America/Chicago',
    currency: 'USD',
    multiplier: row.pointValue,
    isMicro: row.isMicro ?? Boolean(row.parentSymbol),
    parentSymbol: row.parentSymbol,
    contractType: 'CONTINUOUS',
    sessionScheduleId: row.sessionScheduleId,
  };
}

for (const row of SPEC_TABLE) {
  if (!FUTURES_INSTRUMENTS[row.symbol]) FUTURES_INSTRUMENTS[row.symbol] = specRowToInstrument(row);
}

export const DYNAMIC_INSTRUMENTS: Record<string, FuturesInstrument> = {};

/**
 * Resolves an instrument from the catalog, parses contract expiration months,
 * or dynamically registers a valid market ticker symbol on the fly.
 * Guarantees that DeepChart never rejects genuine market tickers (stocks, ETFs, futures from Databento).
 */
export function getOrRegisterInstrument(symbol: string): FuturesInstrument {
  const norm = (symbol || '').trim().toUpperCase();
  if (!norm) {
    return FUTURES_INSTRUMENTS.ES;
  }
  if (FUTURES_INSTRUMENTS[norm]) {
    return FUTURES_INSTRUMENTS[norm];
  }
  if (DYNAMIC_INSTRUMENTS[norm]) {
    return DYNAMIC_INSTRUMENTS[norm];
  }

  // Check if it's a specific contract month of a known root (e.g. ESH6, NQZ24)
  const parsed = parseContractSymbol(norm);
  if (!parsed.isContinuous && FUTURES_INSTRUMENTS[parsed.root]) {
    const parent = FUTURES_INSTRUMENTS[parsed.root];
    const contract: FuturesInstrument = {
      ...parent,
      symbol: norm,
      contractType: 'SPECIFIC',
      contractMonth: parsed.month,
      contractYear: parsed.year,
    };
    DYNAMIC_INSTRUMENTS[norm] = contract;
    return contract;
  }

  // Dynamic registration for any valid alphanumeric ticker (e.g., AAPL, NVDA, or new futures/etfs)
  const isFutures = [
    'ES', 'MES', 'NQ', 'MNQ', 'YM', 'MYM', 'RTY', 'M2K',
    'GC', 'MGC', 'SI', 'SIL', 'HG', 'MHG', 'PL', 'PA',
    'CL', 'MCL', 'NG', 'MNG', 'RB', 'HO',
    'ZB', 'ZN', 'ZF', 'ZT',
    '6E', 'M6E', '6J', '6B', 'M6B', '6A', 'M6A', '6C', 'MSF',
    'ZC', 'ZW', 'ZS', 'ZM', 'ZL', 'HE', 'LE', 'GF',
    'BTC', 'MBT', 'MET'
  ].includes(norm);

  const dynamicInst: FuturesInstrument = {
    symbol: norm,
    rootSymbol: norm,
    name: norm,
    category: isFutures ? 'INDEX' : 'OTHER',
    assetClass: 'EQUITY_INDEX',
    exchange: 'CME',
    tickSize: isFutures ? 0.25 : 0.01,
    pointValue: isFutures ? 50 : 1,
    tickValue: isFutures ? 12.5 : 0.01,
    initialMargin: 0,
    dayTradingMargin: 0,
    underlyingIndex: norm,
    basePrice: 0,
    timezone: 'America/New_York',
    currency: 'USD',
    multiplier: isFutures ? 50 : 1,
    isMicro: false,
    contractType: 'CONTINUOUS',
    sessionScheduleId: isFutures ? 'CME_EQUITY_INDEX' : 'CME_EQUITY',
  };

  DYNAMIC_INSTRUMENTS[norm] = dynamicInst;
  return dynamicInst;
}


/**
 * Check if a symbol represents a continuous contract (e.g. 'ES', 'NQ') vs a specific contract month ('ESH6', 'ESZ26').
 */
export function isContinuousContract(symbol: string): boolean {
  const inst = FUTURES_INSTRUMENTS[symbol] || DYNAMIC_INSTRUMENTS[symbol];
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
  vendor: 'databento' | 'binance' | string,
  symbol: string,
  _contractMonth?: string
): string {
  return symbol;
}

/**
 * Operator-added instruments: `EXTRA_INSTRUMENTS="ZC:5000:0.25:Corn:AGRICULTURE:CBOT;QH:42000:0.01"`.
 *
 * Supply verified specs (contract unit → point value, minimum price increment) and the root becomes
 * a first-class instrument with no code change.
 *
 * Format: `SYMBOL:POINT_VALUE:TICK_SIZE[:NAME[:CATEGORY[:EXCHANGE[:UNDERLYING_INDEX]]]]`, `;`-separated.
 * Invalid rows are rejected with a reason (fail-closed) and surfaced through EXTRA_INSTRUMENT_ERRORS.
 */
export const EXTRA_INSTRUMENT_ERRORS: string[] = [];

export function parseExtraInstruments(
  raw: string | undefined | null
): { instruments: FuturesInstrument[]; errors: string[] } {
  const instruments: FuturesInstrument[] = [];
  const errors: string[] = [];
  if (!raw || !raw.trim()) return { instruments, errors };

  for (const chunk of raw.split(';')) {
    const entry = chunk.trim();
    if (!entry) continue;

    const [symbolRaw, pointValueRaw, tickSizeRaw, nameRaw, categoryRaw, exchangeRaw, underlyingRaw] =
      entry.split(':').map((part) => part.trim());

    const symbol = (symbolRaw || '').toUpperCase();
    if (!/^[A-Z0-9]{1,6}$/.test(symbol)) {
      errors.push(`"${entry}": symbol must be 1-6 alphanumeric characters`);
      continue;
    }

    const pointValue = Number(pointValueRaw);
    if (!Number.isFinite(pointValue) || pointValue <= 0) {
      errors.push(`"${entry}": pointValue must be a positive number (USD per full point)`);
      continue;
    }

    const tickSize = Number(tickSizeRaw);
    if (!Number.isFinite(tickSize) || tickSize <= 0) {
      errors.push(`"${entry}": tickSize must be a positive number (minimum price increment)`);
      continue;
    }

    const category = (categoryRaw ? categoryRaw.toUpperCase() : 'COMMODITY') as InstrumentCategory;
    if (!INSTRUMENT_CATEGORIES.includes(category)) {
      errors.push(`"${entry}": category must be one of ${INSTRUMENT_CATEGORIES.join(', ')}`);
      continue;
    }

    const exchange = (exchangeRaw ? exchangeRaw.toUpperCase() : 'CME') as ExchangeName;
    if (!EXCHANGE_NAMES.includes(exchange)) {
      errors.push(`"${entry}": exchange must be one of ${EXCHANGE_NAMES.join(', ')}`);
      continue;
    }

    instruments.push({
      symbol,
      rootSymbol: symbol,
      name: nameRaw || symbol,
      category,
      assetClass: category === 'INDEX' ? 'EQUITY_INDEX' : (category as AssetClass),
      exchange,
      tickSize,
      pointValue,
      tickValue: tickValueFor(pointValue, tickSize),
      initialMargin: 0,
      dayTradingMargin: 0,
      underlyingIndex: underlyingRaw ? underlyingRaw.toUpperCase() : undefined,
      basePrice: 0,
      timezone: 'America/Chicago',
      currency: 'USD',
      multiplier: pointValue,
      isMicro: false,
      contractType: 'CONTINUOUS',
      sessionScheduleId: `${exchange}_CUSTOM`,
    });
  }

  return { instruments, errors };
}

{
  const { instruments, errors } = parseExtraInstruments(process.env.EXTRA_INSTRUMENTS);
  EXTRA_INSTRUMENT_ERRORS.push(...errors);
  for (const instrument of instruments) {
    if (FUTURES_INSTRUMENTS[instrument.symbol]) {
      EXTRA_INSTRUMENT_ERRORS.push(
        `"${instrument.symbol}": already in the built-in catalog (extra entry ignored)`
      );
      continue;
    }
    FUTURES_INSTRUMENTS[instrument.symbol] = instrument;
  }
  for (const error of EXTRA_INSTRUMENT_ERRORS) {
    console.warn(`[Instruments] EXTRA_INSTRUMENTS rejected -> ${error}`);
  }
}


