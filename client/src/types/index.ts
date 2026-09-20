export type OrderSide = 'buy' | 'sell';

export interface FuturesInstrument {
  symbol: string;
  name: string;
  category: 'INDEX' | 'COMMODITY' | 'ENERGY' | 'BOND' | 'CRYPTO';
  exchange: 'CME' | 'NYMEX' | 'COMEX' | 'CBOT' | 'BINANCE';
  tickSize: number;
  pointValue: number;
  tickValue: number;
  microSymbol?: string;
  microTickValue?: number;
  initialMargin: number;
  dayTradingMargin: number;
  underlyingIndex?: string;
  basePrice: number;
}

export interface Tick {
  id: string;
  timestamp: number;
  price: number;
  size: number;
  side: OrderSide;
  isBuyerMaker: boolean;
}

export interface OrderbookLevel {
  price: number;
  size: number;
  ordersCount?: number;
  pullingStacking?: number;
}

export interface OrderbookSnapshot {
  bids: OrderbookLevel[];
  asks: OrderbookLevel[];
  timestamp: number;
  lastUpdateId: number;
}

export interface FootprintPriceLevel {
  price: number;
  bidVol: number;
  askVol: number;
  totalVol: number;
  delta: number;
  bidImbalance: boolean;
  askImbalance: boolean;
  isPOC?: boolean;
}

export interface FootprintBar {
  id: string;
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  buyVolume: number;
  sellVolume: number;
  delta: number;
  minDelta: number;
  maxDelta: number;
  cvd: number;
  poc: number;
  levels: Record<number, FootprintPriceLevel>;
  unfinishedHigh: boolean;
  unfinishedLow: boolean;
  isClosed: boolean;
}

export interface VolumeProfileLevel {
  price: number;
  volume: number;
  buyVolume: number;
  sellVolume: number;
  delta: number;
}

export interface VolumeProfileData {
  poc: number;
  vah: number;
  val: number;
  totalVolume: number;
  levels: VolumeProfileLevel[];
}

export interface TPOBracket {
  letter: string;
  timeStart: number;
  timeEnd: number;
  prices: number[];
}

export interface TPOProfileData {
  poc: number;
  vah: number;
  val: number;
  initialBalance: { high: number; low: number };
  brackets: TPOBracket[];
  priceLevels: Record<number, string[]>;
}

export interface VWAPPoint {
  time: number;
  vwap: number;
  upper1: number;
  lower1: number;
  upper2: number;
  lower2: number;
  upper3: number;
  lower3: number;
}

export interface SpeedOfTapeData {
  tps: number;
  volumePerSec: number;
  buyRatio: number;
  acceleration: number;
}

export interface DeepTrade {
  id: string;
  timestamp: number;
  price: number;
  size: number;
  valueUsd: number;
  side: OrderSide;
}

export interface AbsorptionAlert {
  id: string;
  timestamp: number;
  price: number;
  volume: number;
  side: 'buy_absorption' | 'sell_absorption';
  description: string;
}

export interface SlaveAccount {
  id: string;
  name: string;
  multiplier: number;
  enabled: boolean;
  status: 'connected' | 'idle' | 'error';
  lastCopiedOrder?: string;
  latencyMs?: number;
}

export interface JournalTrade {
  id: string;
  symbol: string;
  timestamp: number;
  exitTimestamp?: number;
  side: 'LONG' | 'SHORT';
  entryPrice: number;
  exitPrice?: number;
  size: number;
  pnl?: number;
  pnlPercent?: number;
  fee: number;
  status: 'OPEN' | 'CLOSED';
  mae: number;
  mfe: number;
  notes: string;
  imbalanceContext?: string;
}

export interface RestingOrder {
  id: string;
  symbol: string;
  side: 'LONG' | 'SHORT';
  price: number;
  size: number;
  createdAt: number;
}

export interface ReplayProgress {
  isPlaying: boolean;
  currentIndex: number;
  totalTicks: number;
  speed: number;
  currentTime?: number;
}

export interface GEXStrikeLevel {
  strike: number;
  callGex: number;
  putGex: number;
  netGex: number;
  zeroDteGex: number;
  callOI: number;
  putOI: number;
  callVol: number;
  putVol: number;
}

export interface GEXProfile {
  underlying: string;
  spotPrice: number;
  callWall: number;
  putWall: number;
  zeroGammaFlip: number;
  totalNetGex: number;
  total0DteGex: number;
  regime: 'POSITIVE_GAMMA' | 'NEGATIVE_GAMMA';
  levels: GEXStrikeLevel[];
  timestamp: number;
  dataSource: 'SIMULATED' | 'LIVE' | 'CBOE_DELAYED';
}

export interface OptionsFlowTrade {
  id: string;
  timestamp: number;
  underlying: string;
  contractType: 'CALL' | 'PUT';
  strike: number;
  expiration: string;
  dte: number;
  orderType: 'SWEEP' | 'BLOCK';
  sentiment: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
  size: number;
  price: number;
  premiumUsd: number;
  spotPrice: number;
  source: 'SIMULATED' | 'LIVE';
}

export type TrailingMode = 'INTRADAY_PEAK' | 'END_OF_DAY';

export interface PropAccountConfig {
  accountName: string;
  firmName: 'Topstep' | 'Apex' | 'MyFundedFutures' | 'Bulenox' | 'FTMO';
  initialBalance: number;
  profitTarget: number;
  maxTrailingDrawdown: number;
  dailyLossLimit: number;
  maxContractsMini: number;
  maxContractsMicro: number;
  trailingMode: TrailingMode;
  consistencyTargetPercent: number;
}

export interface PropAccountState {
  balance: number;
  equity: number;
  peakHighWaterMark: number;
  trailingThreshold: number;
  trailingBufferRemaining: number;
  trailingBufferPercent: number;
  todayPnL: number;
  dailyLossRemaining: number;
  dailyLossPercent: number;
  profitTargetProgressPercent: number;
  highestDayProfit: number;
  consistencyPercent: number;
  isDailyLossBreached: boolean;
  isDrawdownBreached: boolean;
  isLockedOut: boolean;
  openContractsCount: number;
}

export type WSClientMessage =
  | { type: 'SUBSCRIBE'; symbol: string; timeframe: string; source?: 'binance' | 'simulator' | 'cme' }
  | {
      type: 'DOM_ORDER';
      action: 'BUY' | 'SELL' | 'CANCEL' | 'FLATTEN';
      price?: number;
      size: number;
      orderType: 'MARKET' | 'LIMIT';
      orderId?: string;
    }
  | {
      type: 'REPLAY_CONTROL';
      action: 'START' | 'PAUSE' | 'SEEK' | 'SET_SPEED' | 'STEP';
      speed?: number;
      timestamp?: number;
    }
  | { type: 'UPDATE_COPIER'; slaves: SlaveAccount[] }
  | { type: 'SET_PROP_TRAILING_MODE'; mode: TrailingMode }
  | { type: 'RESET_PROP_ACCOUNT' }
  | { type: 'CLEAR_JOURNAL' }
  /** Only honoured when the server runs with DEV_HOOKS=1 (testing). */
  | { type: 'SET_PROP_CONFIG'; config: Partial<PropAccountConfig> };

export type WSServerMessage =
  | {
      type: 'INIT_STATE';
      symbol: string;
      instrument?: FuturesInstrument;
      bars: FootprintBar[];
      orderbook: OrderbookSnapshot;
      volumeProfile: VolumeProfileData;
      tpo: TPOProfileData;
      vwap: VWAPPoint[];
      cvdHistory: { time: number; cvd: number }[];
      gexProfile?: GEXProfile;
      optionsFlow?: OptionsFlowTrade[];
      propState?: PropAccountState;
      propConfig?: PropAccountConfig;
      deepTradeThresholdUsd?: number;
      slaves?: SlaveAccount[];
      timeframe?: string;
    }
  | { type: 'TICK'; tick: Tick }
  | { type: 'BAR_UPDATE'; bar: FootprintBar }
  | { type: 'BAR_CLOSE'; bar: FootprintBar }
  | { type: 'ORDERBOOK_UPDATE'; orderbook: OrderbookSnapshot }
  | { type: 'SPEED_OF_TAPE'; tape: SpeedOfTapeData }
  | { type: 'DEEP_TRADE'; trade: DeepTrade }
  | { type: 'ABSORPTION'; alert: AbsorptionAlert }
  | { type: 'TRADE_COPIED'; slaveId: string; symbol: string; size: number; price: number; latencyMs: number }
  | { type: 'JOURNAL_UPDATE'; trade: JournalTrade }
  | { type: 'JOURNAL_CLEARED' }
  | { type: 'GEX_UPDATE'; profile: GEXProfile }
  | { type: 'OPTIONS_FLOW'; trade: OptionsFlowTrade }
  | { type: 'PROP_STATE_UPDATE'; state: PropAccountState }
  | { type: 'PROP_BREACH_ALERT'; breachType: 'DAILY_LOSS' | 'MAX_DRAWDOWN'; message: string }
  | { type: 'OPEN_ORDERS'; symbol: string; orders: RestingOrder[] }
  | { type: 'ORDER_ACK'; action: 'PLACED' | 'FILLED' | 'CANCELLED'; orderId?: string; price?: number; size?: number }
  | { type: 'ORDER_REJECT'; reason: string; orderId?: string; size?: number }
  | { type: 'REPLAY_STATE'; progress: ReplayProgress };
