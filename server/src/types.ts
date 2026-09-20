import { FuturesInstrument } from './futuresConfig.js';
import { GEXProfile, OptionsFlowTrade } from './gexEngine.js';
import { PropAccountConfig, PropAccountState, TrailingMode } from './propRiskEngine.js';

export type OrderSide = 'buy' | 'sell';

export interface Tick {
  id: string;
  timestamp: number;
  price: number;
  size: number;
  side: OrderSide;
  isBuyerMaker: boolean; // true = sell market order (buyer was maker), false = buy market order
}

export interface OrderbookLevel {
  price: number;
  size: number;
  ordersCount?: number;
  pullingStacking?: number; // Delta in size compared to previous snapshot
}

export interface OrderbookSnapshot {
  bids: OrderbookLevel[];
  asks: OrderbookLevel[];
  timestamp: number;
  lastUpdateId: number;
}

export interface FootprintPriceLevel {
  price: number;
  bidVol: number; // Volume sold at bid (market sell)
  askVol: number; // Volume bought at ask (market buy)
  totalVol: number;
  delta: number;
  bidImbalance: boolean; // Diagonal imbalance: bidVol significantly > askVol at price+1
  askImbalance: boolean; // Diagonal imbalance: askVol significantly > bidVol at price-1
  isPOC?: boolean;
}

export interface FootprintBar {
  id: string;
  time: number; // Open timestamp
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
  cvd: number; // Cumulative Volume Delta at bar close
  poc: number; // Price of Control for this bar
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
  priceLevels: Record<number, string[]>; // Price -> Array of bracket letters (e.g. ['A', 'B', 'C'])
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
  tps: number; // Trades per second
  volumePerSec: number;
  buyRatio: number; // 0 to 1
  acceleration: number; // -1 to 1
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
  mae: number; // Maximum Adverse Excursion
  mfe: number; // Maximum Favorable Excursion
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

export type WSClientMessage =
  | { type: 'SUBSCRIBE'; symbol: string; timeframe: string; source: 'binance' | 'simulator' | 'cme' }
  | { type: 'DOM_ORDER'; action: 'BUY' | 'SELL' | 'CANCEL' | 'FLATTEN'; price?: number; size: number; orderType: 'MARKET' | 'LIMIT'; orderId?: string }
  | { type: 'REPLAY_CONTROL'; action: 'START' | 'PAUSE' | 'SEEK' | 'SET_SPEED' | 'STEP'; speed?: number; timestamp?: number }
  | { type: 'UPDATE_COPIER'; slaves: SlaveAccount[] }
  | { type: 'SET_PROP_TRAILING_MODE'; mode: TrailingMode }
  | { type: 'RESET_PROP_ACCOUNT' }
  | { type: 'CLEAR_JOURNAL' }
  | { type: 'SET_PROP_CONFIG'; config: Partial<PropAccountConfig> };

export type WSServerMessage =
  | {
      type: 'INIT_STATE';
      symbol: string;
      instrument: FuturesInstrument;
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
      /** How the chart history was seeded: real ticks, reconstructed 1m bars, or live-only. */
      historySource?: 'NONE' | 'REAL_TICKS';
      /** 'LIVE' when a real feed streams this instrument, 'UNAVAILABLE' when none is wired. */
      feedStatus?: 'LIVE' | 'UNAVAILABLE';
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
  | { type: 'REPLAY_STATE'; progress: { isPlaying: boolean; currentIndex: number; totalTicks: number; speed: number; currentTime?: number } };
