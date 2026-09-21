import { AggressorProvenance } from './types.js';
import { TradovateDom, TradovateDomLevel, TradovatePriceSize, TradovateQuote } from './tradovateTransport.js';

/**
 * Vendor payload -> DeepChart boundary candidates.
 *
 * Tradovate's quote feed reports STATE, not EVENTS, and — unlike Binance's `aggTrade` — it
 * publishes **no aggressor flag**. Two consequences drive every decision in this file:
 *
 * 1. AGGRESSOR SIDE IS DERIVED, NEVER INVENTED.
 *    `entries.Trade` carries price+size only. The side is recovered with the Lee-Ready
 *    quote rule, which compares the print against the SAME quote's Bid/Offer:
 *      price >= Offer  -> BUY  (a buyer lifted the offer)
 *      price <= Bid    -> SELL (a seller hit the bid)
 *      otherwise       -> tick rule vs. the previous print price
 *    When neither the quote rule nor the tick rule can decide, the trade is DROPPED and
 *    counted (`droppedUnresolvedSide`). A 50/50 guess would silently poison delta, CVD,
 *    footprint imbalance and absorption — the exact numbers this terminal exists to show.
 *
 * 2. A REPEATED `Trade` ENTRY IS NOT A NEW PRINT.
 *    The quote's `Trade` entry persists until the next print, so consecutive frames repeat
 *    it. A print is emitted only when it differs from the last emitted one. Cumulative
 *    session volume (`TotalTradeVolume.size`) is tracked alongside: when it advances by
 *    more than the prints we observed, the surplus is real volume the vendor coalesced
 *    away. That gap is COUNTED AND REPORTED (`coalescedVolume`) rather than fabricated
 *    into invented prints.
 */

/** Raw candidate handed to validateTrade(); the validator stays the single normalization point. */
export interface RawTradeCandidate {
  ts: number;
  price: number;
  size: number;
  side: 'BUY' | 'SELL';
  symbol: string;
  receiveTs?: number;
  aggressorProvenance?: AggressorProvenance;
  sourceProvider?: string;
  qualityFlags?: { isCoalesced?: boolean; isSuspect?: boolean; isGapBoundary?: boolean };
}

/** Raw single-level depth change handed to validateDepth(). */
export interface RawDepthDeltaCandidate {
  kind: 'delta';
  ts: number;
  side: 'bid' | 'ask';
  price: number;
  size: number;
  symbol: string;
  receiveTs?: number;
  sourceProvider?: string;
}

/** Raw full-ladder replacement handed to validateDepth(). */
export interface RawDepthSnapshotCandidate {
  kind: 'snapshot';
  ts: number;
  bids: [number, number][];
  asks: [number, number][];
  symbol: string;
  receiveTs?: number;
  sourceProvider?: string;
}

export interface QuoteMappingResult {
  trades: RawTradeCandidate[];
  depth: RawDepthDeltaCandidate[];
}

export interface MapperCounters {
  /** Prints seen but with no derivable aggressor side. */
  droppedUnresolvedSide: number;
  /** Frames whose timestamp was absent/undecodable. */
  droppedNoTimestamp: number;
  /** Real volume the vendor coalesced away between frames. */
  coalescedVolume: number;
}

/** How a print's aggressor side was determined — surfaced for diagnostics. */
export type SideRule = 'quote' | 'tick' | 'unresolved';

function toEpochMs(timestamp: unknown): number | null {
  if (typeof timestamp !== 'string' || timestamp.length === 0) return null;
  const ms = Date.parse(timestamp);
  return Number.isFinite(ms) && ms > 0 ? ms : null;
}

function finitePositive(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

/** Read one `{price,size}` entry, tolerating either field being absent (documented schema). */
function readEntry(entry: TradovatePriceSize | undefined): { price: number | null; size: number | null } {
  if (!entry) return { price: null, size: null };
  return {
    price: finitePositive(entry.price) ? entry.price : null,
    size: typeof entry.size === 'number' && Number.isFinite(entry.size) && entry.size >= 0 ? entry.size : null,
  };
}

/**
 * Lee-Ready classification. Returns the side plus the rule that produced it, so callers can
 * tell a firm quote-rule read from a weaker tick-rule inference.
 */
export function classifyAggressor(
  tradePrice: number,
  bidPrice: number | null,
  offerPrice: number | null,
  prevTradePrice: number | null
): { side: 'BUY' | 'SELL' | null; rule: SideRule } {
  // Quote rule first: it is the stronger signal because it uses the contemporaneous book.
  if (offerPrice !== null && tradePrice >= offerPrice) return { side: 'BUY', rule: 'quote' };
  if (bidPrice !== null && tradePrice <= bidPrice) return { side: 'SELL', rule: 'quote' };
  // Tick rule fallback for a print strictly inside the spread (or when one side is missing).
  if (prevTradePrice !== null && tradePrice !== prevTradePrice) {
    return { side: tradePrice > prevTradePrice ? 'BUY' : 'SELL', rule: 'tick' };
  }
  // Undecidable. Callers must drop rather than guess.
  return { side: null, rule: 'unresolved' };
}

/**
 * Stateful translator for one contract. All state is per-instance, so an instrument switch
 * creates a fresh mapper and can never carry the previous contract's bid/tick memory over.
 */
export class TradovateQuoteMapper {
  private lastBid: number | null = null;
  private lastOffer: number | null = null;
  private lastTradePrice: number | null = null;
  private lastTradeKey: string | null = null;
  private lastTotalVolume: number | null = null;
  private lastBidSize: number | null = null;
  private lastOfferSize: number | null = null;

  public readonly counters: MapperCounters = {
    droppedUnresolvedSide: 0,
    droppedNoTimestamp: 0,
    coalescedVolume: 0,
  };

  /** Last known top-of-book, used for diagnostics and the UI status reason. */
  public get bestBid(): number | null {
    return this.lastBid;
  }

  public get bestOffer(): number | null {
    return this.lastOffer;
  }

  /** True once a print has been classified, i.e. the feed is producing usable orderflow. */
  public get hasTrades(): boolean {
    return this.lastTradeKey !== null;
  }


  /**
   * Translate one quote frame into trade + best-bid/offer depth candidates.
   * `symbol` is echoed onto every candidate so validateTrade/validateDepth can reject late
   * frames belonging to an instrument we already switched away from.
   */
  public mapQuote(quote: TradovateQuote, symbol: string): QuoteMappingResult {
    const trades: RawTradeCandidate[] = [];
    const depth: RawDepthDeltaCandidate[] = [];
    const entries = quote.entries;
    if (!entries) return { trades, depth };

    const ts = toEpochMs(quote.timestamp);
    const bid = readEntry(entries.Bid);
    const offer = readEntry(entries.Offer);

    // Capture the previous top-of-book BEFORE overwriting it, so the change detection below
    // compares against what we last published and the quote rule sees THIS frame's book.
    const prevBid = this.lastBid;
    const prevBidSize = this.lastBidSize;
    const prevOffer = this.lastOffer;
    const prevOfferSize = this.lastOfferSize;
    if (bid.price !== null) this.lastBid = bid.price;
    if (offer.price !== null) this.lastOffer = offer.price;

    // --- trades ---------------------------------------------------------------
    const trade = readEntry(entries.Trade);
    if (trade.price !== null && trade.size !== null && trade.size > 0) {
      const key = `${trade.price}@${trade.size}`;
      if (key !== this.lastTradeKey) {
        this.lastTradeKey = key;

        // Cumulative session volume advances by >= the print size; any surplus is volume the
        // vendor coalesced into one frame. Count it — never invent prints to cover it.
        const totalVolume = readEntry(entries.TotalTradeVolume).size;
        if (totalVolume !== null) {
          if (this.lastTotalVolume !== null) {
            const surplus = totalVolume - this.lastTotalVolume - trade.size;
            if (surplus > 0) this.counters.coalescedVolume += surplus;
          }
          this.lastTotalVolume = totalVolume;
        }

        const classified = classifyAggressor(trade.price, this.lastBid, this.lastOffer, this.lastTradePrice);
        this.lastTradePrice = trade.price;

        if (classified.side === null) {
          // Honest drop: an undecidable aggressor would corrupt delta/CVD/imbalance.
          this.counters.droppedUnresolvedSide++;
        } else if (ts === null) {
          // A print with no vendor time cannot be bucketed into a bar without lying.
          this.counters.droppedNoTimestamp++;
        } else {
          const provenance: AggressorProvenance = classified.rule === 'quote' ? 'INFERRED_QUOTE' : 'INFERRED_TICK';
          trades.push({
            ts,
            price: trade.price,
            size: trade.size,
            side: classified.side,
            symbol,
            receiveTs: Date.now(),
            aggressorProvenance: provenance,
            sourceProvider: 'tradovate',
          });
        }
      }
    } else {
      // No Trade entry this frame: keep the cumulative-volume baseline current so the next
      // real print is measured against the right total.
      const totalVolume = readEntry(entries.TotalTradeVolume).size;
      if (totalVolume !== null) this.lastTotalVolume = totalVolume;
    }

    // --- best bid / offer deltas ---------------------------------------------
    // The quote frame repeats unchanged state, so emit only on an actual level change.
    if (ts !== null) {
      if (bid.price !== null && bid.size !== null && (bid.price !== prevBid || bid.size !== prevBidSize)) {
        this.lastBidSize = bid.size;
        depth.push({ kind: 'delta', ts, side: 'bid', price: bid.price, size: bid.size, symbol, sourceProvider: 'tradovate' });
      }
      if (
        offer.price !== null &&
        offer.size !== null &&
        (offer.price !== prevOffer || offer.size !== prevOfferSize)
      ) {
        this.lastOfferSize = offer.size;
        depth.push({ kind: 'delta', ts, side: 'ask', price: offer.price, size: offer.size, symbol, sourceProvider: 'tradovate' });
      }
    }

    return { trades, depth };
  }

  /**
   * Translate one DOM frame into a full-ladder snapshot.
   *
   * Each DOM frame IS the complete current ladder (bids descending, offers ascending, per
   * the vendor's EX-09 schema), so it maps to a `snapshot` replacement — exactly what
   * OrderbookManager.applySnapshot expects. `validateDepth.cleanLevels` takes
   * `[price, size]` tuples, so the vendor's `{price,size}` objects are converted here.
   */
  public mapDom(dom: TradovateDom, symbol: string): RawDepthSnapshotCandidate | null {
    const ts = toEpochMs(dom.timestamp);
    if (ts === null) {
      this.counters.droppedNoTimestamp++;
      return null;
    }
    const bids = toTuples(dom.bids);
    const asks = toTuples(dom.offers);
    if (bids.length === 0 && asks.length === 0) return null;
    return { kind: 'snapshot', ts, bids, asks, symbol, sourceProvider: 'tradovate' };
  }
}

/** Convert the vendor's `{price,size}` levels into the `[price,size]` tuples the validator takes. */
function toTuples(levels: TradovateDomLevel[] | undefined): [number, number][] {
  if (!Array.isArray(levels)) return [];
  const out: [number, number][] = [];
  for (const level of levels) {
    const price = finitePositive(level.price) ? level.price : null;
    const size =
      typeof level.size === 'number' && Number.isFinite(level.size) && level.size >= 0 ? level.size : null;
    if (price === null || size === null) continue;
    out.push([price, size]);
  }
  return out;
}

