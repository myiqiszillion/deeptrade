import { FuturesInstrument } from './futuresConfig.js';
import { GEXProfile, OptionsFlowTrade } from './gexEngine.js';

export type OrderSide = 'buy' | 'sell' | 'unknown';

export type AggressorProvenance =
  | 'EXCHANGE_NATIVE' // Native flag from exchange (e.g. Binance isBuyerMaker, CME MBO)
  | 'INFERRED_QUOTE'  // Derived via Lee-Ready quote rule (bid/offer comparison)
  | 'INFERRED_TICK'   // Derived via tick rule (uptick/downtick vs previous price)
  | 'UNKNOWN';        // Undecidable or not provided

export interface Tick {
  id: string;
  timestamp: number;
  price: number;
  size: number;
  side: OrderSide;
  isBuyerMaker?: boolean; // true = sell market order (buyer was maker), false = buy market order, undefined = unknown
  receiveTs?: number; // Server receive timestamp (epoch ms)
  aggressorProvenance?: AggressorProvenance;
  sequenceId?: string;
  sourceProvider?: string;
  qualityFlags?: {
    isCoalesced?: boolean;
    isSuspect?: boolean;
    isGapBoundary?: boolean;
  };
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
  unknownVol?: number; // Volume where aggressor was undecidable
  totalVol: number;
  delta: number;
  bidImbalance: boolean; // Diagonal imbalance: bidVol significantly > askVol at price+1
  askImbalance: boolean; // Diagonal imbalance: askVol significantly > bidVol at price-1
  stackedBidImbalance?: boolean;
  stackedAskImbalance?: boolean;
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
  firstTradeTs?: number;
  lastTradeTs?: number;
}

/** Classify whether an incoming trade was aggressor buy, sell, or unknown. */
export function classifyAggressorSide(tick: Tick): 'buy' | 'sell' | 'unknown' {
  if (tick.side === 'unknown') return 'unknown';
  if (tick.side === 'buy' || tick.isBuyerMaker === false) return 'buy';
  if (tick.side === 'sell' || tick.isBuyerMaker === true) return 'sell';
  return 'unknown';
}

/**
 * A REAL historical bar that preceded the live session (e.g. Tradovate `md/getchart`).
 *
 * Deliberately NOT a `FootprintBar`: a bar is an aggregate and physically cannot yield a
 * per-price bid/ask split. Keeping a separate, narrower type makes that limitation structural
 * instead of a convention someone could forget — there is no `levels` field to fabricate.
 */
export interface HistoricalBar {
  /** Bar OPEN time, epoch milliseconds. */
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  /** upVolume + downVolume, as reported by the vendor. */
  volume: number;
  /** Vendor aggressor split, absent when not supplied (never inferred from up/down ticks). */
  buyVolume?: number;
  sellVolume?: number;
  delta?: number;
  sourceProvider?: string;
  isPartial?: boolean;
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

export type WSClientMessage =
  | { type: 'SUBSCRIBE'; symbol: string; timeframe: string; source?: 'binance' | 'simulator' | 'cme' }
  | { type: 'REPLAY_CONTROL'; action: 'START' | 'PAUSE' | 'SEEK' | 'SET_SPEED' | 'STEP' | 'RETURN_TO_LIVE'; speed?: number; timestamp?: number }
  | { type: 'FETCH_HISTORY'; symbol: string; timeframe: string; beforeTime?: number; limit?: number; requestId?: string };

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
      deepTradeThresholdUsd?: number;
      timeframe?: string;
      /** How the chart history was seeded: real ticks, real vendor bars, or live-only. */
      historySource?: 'NONE' | 'REAL_TICKS' | 'REAL_BARS';
      /**
       * REAL vendor bars that preceded the live session (Tradovate `md/getchart`).
       *
       * Bar-level aggregates ONLY — there is deliberately no per-price breakdown, because a
       * bar cannot yield one. Expanding these into synthetic prints would invent the footprint
       * microstructure this terminal claims to measure, so the client draws them as plain
       * candles and the live footprint starts where real ticks start.
       */
      historyBars?: HistoricalBar[];
      /** 'LIVE' when a real feed streams this instrument, 'UNAVAILABLE' when none is wired. */
      feedStatus?: 'LIVE' | 'UNAVAILABLE';
      mode?: 'LIVE' | 'REPLAY' | 'REPLAY_PAUSED' | 'REPLAY_ENDED';
    }
  | { type: 'TICK'; tick: Tick }
  | { type: 'BAR_UPDATE'; bar: FootprintBar }
  | { type: 'BAR_CLOSE'; bar: FootprintBar }
  | { type: 'ORDERBOOK_UPDATE'; orderbook: OrderbookSnapshot }
  | { type: 'SPEED_OF_TAPE'; tape: SpeedOfTapeData }
  | { type: 'DEEP_TRADE'; trade: DeepTrade }
  | { type: 'ABSORPTION'; alert: AbsorptionAlert }
  | { type: 'PROFILE_UPDATE'; volumeProfile: VolumeProfileData; tpo?: TPOProfileData }
  | { type: 'VWAP_UPDATE'; point: VWAPPoint }
  | { type: 'GEX_UPDATE'; profile: GEXProfile }
  | { type: 'OPTIONS_FLOW'; trade: OptionsFlowTrade }
  | { type: 'REPLAY_STATE'; progress: { isPlaying: boolean; currentIndex: number; totalTicks: number; speed: number; currentTime?: number; isEnded?: boolean; mode?: 'REPLAY' | 'REPLAY_PAUSED' | 'REPLAY_ENDED' } }
  | { type: 'ERROR'; code: string; message: string }
  | { type: 'HISTORY_RESPONSE'; symbol: string; timeframe: string; bars: HistoricalBar[]; hasMore: boolean; cursor?: number; requestId?: string };

