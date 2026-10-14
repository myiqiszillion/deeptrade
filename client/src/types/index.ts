export interface DataEvidence { source: 'VENDOR_LIVE'|'VENDOR_HISTORICAL'|'LOCAL_FIXTURE'|'PERSISTED_VENDOR'|'HISTORICAL_ESTIMATE'|'LEGACY'|'UNKNOWN'|'MIXED'; quality: 'EXACT'|'ESTIMATED'|'UNKNOWN'; coverage:'COMPLETE'|'PARTIAL'|'UNKNOWN';reason:string; delivery?:'OBSERVED'|'SQLITE'|'REPLAY';originalSource?:DataEvidence['source'];contracts?:string[];fromTs?:number;toTs?:number;cvdBaseline?:'OBSERVED_START'; }
export type OrderSide = 'buy' | 'sell' | 'unknown';

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
  | 'OTHER';

export type ContractType = 'CONTINUOUS' | 'SPECIFIC';

export interface FuturesInstrument {
  symbol: string;
  rootSymbol?: string;
  name: string;
  category: InstrumentCategory;
  assetClass?: AssetClass;
  exchange: 'CME' | 'NYMEX' | 'COMEX' | 'CBOT';
  tickSize: number;
  pointValue: number;
  tickValue: number;
  microSymbol?: string;
  microTickValue?: number;
  initialMargin: number;
  dayTradingMargin: number;
  underlyingIndex?: string;
  basePrice: number;
  timezone?: string;
  currency?: string;
  multiplier?: number;
  isMicro?: boolean;
  parentSymbol?: string;
  contractType?: ContractType;
  contractMonth?: string;
  contractYear?: number;
  sessionScheduleId?: string;
}

export type AggressorProvenance =
  | 'EXCHANGE_NATIVE'
  | 'INFERRED_QUOTE'
  | 'INFERRED_TICK'
  | 'UNKNOWN';

export interface Tick {
  dataEvidence?: DataEvidence;
  id: string;
  timestamp: number;
  price: number;
  size: number;
  side: OrderSide;
  isBuyerMaker?: boolean;
  receiveTs?: number;
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
  unknownVol?: number;
  totalVol: number;
  delta: number;
  bidImbalance: boolean;
  askImbalance: boolean;
  stackedBidImbalance?: boolean;
  stackedAskImbalance?: boolean;
  isPOC?: boolean;
}

export interface FootprintBar {
  dataEvidence?: DataEvidence;
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
  firstTradeTs?: number;
  lastTradeTs?: number;
}

/**
 * A REAL historical bar from before the live session (e.g. Tradovate `md/getchart`).
 *
 * Bar aggregate only — there is deliberately no `levels` field, because a bar cannot yield a
 * per-price bid/ask split. It is drawn as a plain candle behind the live footprint.
 */
export interface HistoricalBar {
  dataEvidence?: DataEvidence;
  /** Bar OPEN time, epoch milliseconds. */
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  /** Vendor aggressor split; missing is not zero and is not inferred from up/down ticks. */
  buyVolume?: number;
  sellVolume?: number;
  delta?: number;
  sourceProvider?: string;
  isPartial?: boolean;
}

export interface VolumeProfileLevel {
  unknownVolume?: number;
  price: number;
  volume: number;
  buyVolume: number;
  sellVolume: number;
  delta: number;
}

export type ProfileProvenance = 'EXACT' | 'ESTIMATED' | 'UNAVAILABLE';
export type ProfileCoverage = 'COMPLETE' | 'PARTIAL' | 'UNKNOWN';

export interface VolumeProfileData {
  unknownVolume?: number;
  dataEvidence?: DataEvidence;
  poc: number;
  vah: number;
  val: number;
  totalVolume: number;
  levels: VolumeProfileLevel[];
  provenance?: ProfileProvenance;
  coverage?: ProfileCoverage;
  coverageReason?: string;
  isEstimated?: boolean;
}

export interface TPOBracket {
  letter: string;
  timeStart: number;
  timeEnd: number;
  prices: number[];
}

export interface TPOProfileData {
  dataEvidence?: DataEvidence;
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

export interface ChartViewport {
  panX: number;
  panY: number;
  barWidth: number;
  barSpacing: number;
  priceScale: number;
  anchorPrice?: number;
  autoFollow?: boolean;
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

export interface DataCoverage {
  provider: string;
  realtime: 'LIVE' | 'UNAVAILABLE' | 'DEGRADED';
  history: 'NONE' | 'BARS' | 'TICKS';
  footprint: 'AVAILABLE' | 'UNAVAILABLE' | 'PARTIAL';
  orderbook: 'NONE' | 'L2' | 'MBO' | 'PARTIAL';
  gapStatus: 'NONE' | 'DETECTED' | 'RECOVERED' | 'UNRECOVERED';
}

export interface ReplayProgress {
  isPlaying: boolean;
  currentIndex: number;
  totalTicks: number;
  speed: number;
  currentTime?: number;
  isEnded?: boolean;
  mode?: 'REPLAY' | 'REPLAY_PAUSED' | 'REPLAY_ENDED';
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
  dataSource: 'CBOE_DELAYED' | 'LIVE';
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
  source: 'LIVE';
}

export type WSClientMessage =
  | { type: 'SUBSCRIBE'; subscriptionId?: string; symbol: string; timeframe: string; source?: 'cme' | 'databento' | 'tradovate' | string }
  | { type: 'UNSUBSCRIBE'; subscriptionId?: string; symbol?: string }
  | {
      type: 'REPLAY_CONTROL';
      action: 'START' | 'PAUSE' | 'SEEK' | 'SET_SPEED' | 'STEP' | 'RETURN_TO_LIVE';
      speed?: number;
      timestamp?: number;
    }
  | { type: 'FETCH_HISTORY'; symbol: string; timeframe: string; provider?: string; beforeTime?: number; limit?: number; requestId?: string }
  | { type: 'PING'; timestamp?: number };

export type WSServerMessage =
  | {
      type: 'INIT_STATE';
      dataEvidence?: DataEvidence;
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
      deepTradeThresholdUsd?: number;
      timeframe?: string;
      historySource?: 'NONE' | 'REAL_TICKS' | 'REAL_BARS';
      /** REAL vendor bars preceding the live session; plain candles, no per-price breakdown. */
      historyBars?: HistoricalBar[];
      recentTicks?: Tick[];
      feedStatus?: 'LIVE' | 'UNAVAILABLE';
      mode?: 'LIVE' | 'REPLAY' | 'REPLAY_PAUSED' | 'REPLAY_ENDED';
    }
  | { type: 'TICK'; tick: Tick; symbol?: string }
  | { type: 'BAR_UPDATE'; bar: FootprintBar; symbol?: string }
  | { type: 'BAR_CLOSE'; bar: FootprintBar; symbol?: string }
  | { type: 'ORDERBOOK_UPDATE'; orderbook: OrderbookSnapshot; symbol?: string }
  | { type: 'SPEED_OF_TAPE'; tape: SpeedOfTapeData; symbol?: string }
  | { type: 'DEEP_TRADE'; trade: DeepTrade; symbol?: string }
  | { type: 'ABSORPTION'; alert: AbsorptionAlert; symbol?: string }
  | { type: 'PROFILE_UPDATE'; volumeProfile: VolumeProfileData; tpo?: TPOProfileData; symbol?: string }
  | { type: 'VWAP_UPDATE'; point: VWAPPoint; symbol?: string }
  | { type: 'GEX_UPDATE'; profile: GEXProfile; symbol?: string }
  | { type: 'OPTIONS_FLOW'; trade: OptionsFlowTrade; symbol?: string }
  | { type: 'REPLAY_STATE'; progress: ReplayProgress; symbol?: string }
  | { type: 'PONG'; timestamp: number; symbol?: string }
  | { type: 'ERROR'; code: string; message: string; symbol?: string }
  | { type: 'HISTORY_RESPONSE'; symbol: string; timeframe: string; provider?: string; bars: HistoricalBar[]; hasMore: boolean; cursor?: number | { provider: string; symbol: string; timeframe?: string; beforeTime: number; beforeId?: string }; requestId?: string }
  | { type: 'ALERT_EVENT'; alert: AlertEvent; symbol?: string };

export interface FeedHealthSnapshot { state: string; reason: string; times: Record<string, number | null>; counters: Record<string, number>; policy: string }

export type EnhancedFeedStatus =
  | 'LIVE'
  | 'REALTIME'
  | 'DELAYED'
  | 'STALE'
  | 'RECONNECTING'
  | 'UNAVAILABLE'
  | 'MARKET_CLOSED';

export interface OptionContract {
  symbol: string;
  underlying: string;
  expiration: string;
  expirationTimestamp?: number;
  type: 'call' | 'put';
  strike: number;
  multiplier?: number;
  dte?: number;
  bid?: number;
  ask?: number;
  last?: number;
  volume?: number;
  openInterest?: number;
  iv?: number;
  delta?: number;
  gamma?: number;
  vega?: number;
  theta?: number;
}

export interface OptionChainResponse {
  symbol: string;
  spotPrice: number;
  gex?: number;
  netGamma?: number;
  zeroGamma?: number;
  maxPain?: number;
  totalCallOi: number;
  totalPutOi: number;
  putCallRatio: number;
  contracts: OptionContract[];
  source: string;
  timestamp: number;
}

export interface ChartLevels {
  symbol: string;
  currentPrice: number;
  gammaFlip?: number;
  callWall?: number;
  putWall?: number;
  maxPain?: number;
  supportLevels: number[];
  resistanceLevels: number[];
  source: string;
}

export interface VolumeProfileRangeData extends VolumeProfileData {
  symbol: string;
  startTime: number;
  endTime: number;
  requestedStart?: number;
  requestedEnd?: number;
  actualDataStart?: number | null;
  actualDataEnd?: number | null;
  available?: boolean;
  status?: 'ok' | 'unavailable' | 'no_data';
  message?: string;
}

export interface DepthHeatmapSnapshot {
  time?: number;
  timestamp?: number;
  bids: Array<{ price: number; size: number }>;
  asks: Array<{ price: number; size: number }>;
}

export interface DepthHeatmapResponse {
  symbol: string;
  count: number;
  totalAvailable?: number;
  hasMore?: boolean;
  samplingIntervalMs?: number;
  dataSource?: string;
  available?: boolean;
  snapshots: DepthHeatmapSnapshot[];
}

export type AlertType =
  | 'STACKED_IMBALANCE'
  | 'ABSORPTION'
  | 'LARGE_TRADE'
  | 'POC_VAH_VAL'
  | 'LIQUIDITY_WALL';

export type AlertSeverity = 'INFO' | 'WARNING' | 'CRITICAL';

export interface AlertRule {
  id: string;
  userId: string;
  symbol: string;
  type: AlertType;
  threshold: number;
  timeframe: string;
  cooldownSec: number;
  cooldownSeconds?: number;
  enabled: boolean;
  createdAt: number;
  lastTriggeredAt: number | null;
  lastTriggeredTs?: number | null;
  note?: string;
  metadata?: Record<string, any>;
}

export interface CreateAlertRuleInput {
  symbol: string;
  type: AlertType;
  threshold: number;
  timeframe?: string;
  cooldownSec?: number;
  cooldownSeconds?: number;
  enabled?: boolean;
  note?: string;
  metadata?: Record<string, any>;
}

export interface AlertEvent {
  id: string;
  ruleId: string;
  userId: string;
  symbol: string;
  type: AlertType;
  severity: AlertSeverity;
  message: string;
  price?: number;
  timestamp: number;
  metadata?: Record<string, any>;
}

export interface AlertHistoryItem {
  id: string;
  ruleId: string;
  userId: string;
  symbol: string;
  type: AlertType;
  severity: AlertSeverity;
  message: string;
  price?: number;
  triggerTime: number;
  timestamp?: number;
  acknowledged: boolean;
  read?: boolean;
  metadata?: Record<string, any>;
}


