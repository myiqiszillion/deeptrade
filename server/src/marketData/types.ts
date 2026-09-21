export type TradeSide = 'BUY' | 'SELL' | 'UNKNOWN';

export type AggressorProvenance =
  | 'EXCHANGE_NATIVE' // From exchange native flag (e.g. Binance isBuyerMaker, CME MBO flag)
  | 'INFERRED_QUOTE'  // Derived via Lee-Ready quote rule (bid/offer comparison)
  | 'INFERRED_TICK'   // Derived via tick rule (uptick/downtick vs previous price)
  | 'UNKNOWN';        // Undecidable or not provided

export type DataDepthLevel = 'TOP_OF_BOOK' | 'L2_20' | 'L2_50' | 'FULL_MBO';

export interface TradeQualityFlags {
  isCoalesced?: boolean; // Vendor coalesced multiple trades into this quote/update
  isSuspect?: boolean;
  isGapBoundary?: boolean;
}

/**
 * Normalized trade/tick — the ONLY shape the orderflow engines consume.
 * Vendor payloads must never reach Footprint/Profile/VWAP/Tape/Replay directly.
 */
export interface MarketTrade {
  /** Epoch milliseconds (normalized from the vendor's native time unit). */
  ts: number;
  price: number;
  size: number;
  side: TradeSide;
  /** Stable id from the vendor when available (used for dedupe). */
  id?: string;
  /** Epoch milliseconds when server received this event. */
  receiveTs?: number;
  /** Provenance of the aggressor side. */
  aggressorProvenance?: AggressorProvenance;
  /** Sequence identifier from vendor for gap detection. */
  sequenceId?: number | string;
  /** Data source provider identifier (e.g. 'binance', 'tradovate', 'databento', 'fixture'). */
  sourceProvider?: string;
  /** Quality metadata flags. */
  qualityFlags?: TradeQualityFlags;
}

export interface DepthLevel {
  price: number;
  size: number;
}

/** A full L2 replacement for one symbol. */
export interface MarketDepthSnapshot {
  kind: 'snapshot';
  ts: number;
  bids: DepthLevel[];
  asks: DepthLevel[];
  updateId?: number;
  receiveTs?: number;
  depthLevel?: DataDepthLevel;
  sourceProvider?: string;
}

/** A single-level L2 change (size 0 = remove that price). */
export interface MarketDepthDelta {
  kind: 'delta';
  ts: number;
  side: 'bid' | 'ask';
  price: number;
  size: number;
  updateId?: number;
  receiveTs?: number;
  sourceProvider?: string;
}

export type MarketDepthEvent = MarketDepthSnapshot | MarketDepthDelta;

/** Vendor-agnostic connection state. Public protocol maps this to LIVE | UNAVAILABLE. */
export type FeedConnectionState = 'UNAVAILABLE' | 'CONNECTING' | 'LIVE' | 'ERROR';

export interface FeedStatusEvent {
  state: FeedConnectionState;
  /** Human-readable, credential-free explanation (e.g. "no API key configured"). */
  reason?: string;
  provider: string;
  symbol: string;
  /** Vendor instrument identifier when the vendor reports one (contract month etc.). */
  instrumentId?: string;
}

export interface FeedHandlers {
  onTrade: (trade: MarketTrade) => void;
  onDepth: (event: MarketDepthEvent) => void;
  onStatus: (status: FeedStatusEvent) => void;
  onError: (error: Error) => void;
}

/**
 * Backend contract every market-data vendor must satisfy.
 * DeepChart only ever consumes normalized `MarketTrade` / `MarketDepthEvent`.
 */
export interface MarketDataFeed {
  readonly provider: string;
  readonly symbol: string;
  /** Resolves once the subscription request was accepted — NOT a claim of live data. */
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  isConnected(): boolean;
  /**
   * Resolve once at least one REAL validated market event has arrived for the current
   * generation. Must reject on timeout rather than pretend readiness. Optional: providers
   * that cannot stream yet simply omit it.
   */
  waitForLive?(timeoutMs?: number): Promise<void>;
}
