import { normalizeToTick } from '../priceMath.js';
import { AggressorProvenance, DataDepthLevel, DepthLevel, MarketDepthEvent, MarketTrade, TradeSide } from './types.js';

/**
 * Validation + normalization boundary. Everything coming from a vendor passes through here
 * before any engine sees it. Invalid events are DROPPED (with a diagnostic) — never repaired,
 * never replaced by synthetic values.
 */

export interface DropStats {
  droppedInvalid: number;
  droppedStaleSymbol: number;
  droppedMisaligned: number;
}

export interface TradeValidation {
  trade: MarketTrade | null;
  dropped?: 'invalid' | 'stale-symbol';
}

function isFinitePositive(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

function normalizeSide(value: unknown): TradeSide {
  if (value === 'BUY' || value === 'buy' || value === 'A') return 'BUY';
  if (value === 'SELL' || value === 'sell' || value === 'B') return 'SELL';
  return 'UNKNOWN';
}

function normalizeAggressorProvenance(value: unknown): AggressorProvenance {
  if (
    value === 'EXCHANGE_NATIVE' ||
    value === 'INFERRED_QUOTE' ||
    value === 'INFERRED_TICK' ||
    value === 'UNKNOWN'
  ) {
    return value;
  }
  return 'UNKNOWN';
}

/**
 * Validate and tick-align a raw trade for the given symbol.
 * `activeSymbol` guards against late frames from an instrument we already switched away from.
 */
export function validateTrade(
  raw: {
    ts: unknown;
    price: unknown;
    size: unknown;
    side?: unknown;
    id?: unknown;
    symbol?: unknown;
    receiveTs?: unknown;
    aggressorProvenance?: unknown;
    sequenceId?: unknown;
    sourceProvider?: unknown;
    qualityFlags?: unknown;
  },
  tickSize: number,
  activeSymbol: string
): TradeValidation {
  if (typeof raw.symbol === 'string' && raw.symbol.toUpperCase() !== activeSymbol.toUpperCase()) {
    return { trade: null, dropped: 'stale-symbol' };
  }
  if (!isFinitePositive(raw.ts) || !isFinitePositive(raw.price) || !isFinitePositive(raw.size)) {
    return { trade: null, dropped: 'invalid' };
  }

  const aligned = normalizeToTick(raw.price, tickSize);
  if (!isFinitePositive(aligned)) return { trade: null, dropped: 'misaligned' as 'invalid' };

  const receiveTs =
    typeof raw.receiveTs === 'number' && Number.isFinite(raw.receiveTs) && raw.receiveTs > 0
      ? raw.receiveTs
      : Date.now();

  const sourceProvider = typeof raw.sourceProvider === 'string' && raw.sourceProvider.trim().length > 0
    ? raw.sourceProvider.trim()
    : undefined;

  const qualityFlags = (raw.qualityFlags && typeof raw.qualityFlags === 'object')
    ? (raw.qualityFlags as { isCoalesced?: boolean; isSuspect?: boolean; isGapBoundary?: boolean })
    : undefined;

  return {
    trade: {
      ts: raw.ts,
      price: aligned,
      size: raw.size,
      side: normalizeSide(raw.side),
      id: typeof raw.id === 'string' ? raw.id : undefined,
      receiveTs,
      aggressorProvenance: normalizeAggressorProvenance(raw.aggressorProvenance),
      sequenceId:
        typeof raw.sequenceId === 'number' || typeof raw.sequenceId === 'string'
          ? raw.sequenceId
          : undefined,
      sourceProvider,
      qualityFlags,
    },
  };
}

export interface DepthValidation {
  event: MarketDepthEvent | null;
  dropped?: 'invalid' | 'stale-symbol';
}

function cleanLevels(levels: unknown, tickSize: number): DepthLevel[] {
  if (!Array.isArray(levels)) return [];
  const out: DepthLevel[] = [];
  for (const entry of levels) {
    const [rawPrice, rawSize] = Array.isArray(entry) ? entry : [undefined, undefined];
    if (!isFinitePositive(rawPrice)) continue;
    if (typeof rawSize !== 'number' || !Number.isFinite(rawSize) || rawSize < 0) continue;
    out.push({ price: normalizeToTick(rawPrice, tickSize), size: rawSize });
  }
  return out;
}

/** Validate/normalize a snapshot or a single-level delta. */
export function validateDepth(
  raw:
    | {
        kind: 'snapshot';
        ts: unknown;
        bids: unknown;
        asks: unknown;
        updateId?: unknown;
        symbol?: unknown;
        receiveTs?: unknown;
        depthLevel?: unknown;
        sourceProvider?: unknown;
      }
    | {
        kind: 'delta';
        ts: unknown;
        side: unknown;
        price: unknown;
        size: unknown;
        updateId?: unknown;
        symbol?: unknown;
        receiveTs?: unknown;
        sourceProvider?: unknown;
      },
  tickSize: number,
  activeSymbol: string
): DepthValidation {
  if (typeof raw.symbol === 'string' && raw.symbol.toUpperCase() !== activeSymbol.toUpperCase()) {
    return { event: null, dropped: 'stale-symbol' };
  }
  if (!isFinitePositive(raw.ts)) return { event: null, dropped: 'invalid' };

  const receiveTs =
    typeof raw.receiveTs === 'number' && Number.isFinite(raw.receiveTs) && raw.receiveTs > 0
      ? raw.receiveTs
      : Date.now();

  const sourceProvider = typeof raw.sourceProvider === 'string' && raw.sourceProvider.trim().length > 0
    ? raw.sourceProvider.trim()
    : undefined;

  if (raw.kind === 'snapshot') {
    const bids = cleanLevels(raw.bids, tickSize);
    const asks = cleanLevels(raw.asks, tickSize);
    if (bids.length === 0 && asks.length === 0) return { event: null, dropped: 'invalid' };
    const depthLevel =
      raw.depthLevel === 'TOP_OF_BOOK' ||
      raw.depthLevel === 'L2_20' ||
      raw.depthLevel === 'L2_50' ||
      raw.depthLevel === 'FULL_MBO'
        ? (raw.depthLevel as DataDepthLevel)
        : undefined;

    return {
      event: {
        kind: 'snapshot',
        ts: raw.ts,
        bids,
        asks,
        updateId: typeof raw.updateId === 'number' ? raw.updateId : undefined,
        receiveTs,
        depthLevel,
        sourceProvider,
      },
    };
  }

  const side = raw.side === 'bid' || raw.side === 'ask' ? raw.side : null;
  if (!side) return { event: null, dropped: 'invalid' };
  if (!isFinitePositive(raw.price)) return { event: null, dropped: 'invalid' };
  if (typeof raw.size !== 'number' || !Number.isFinite(raw.size) || raw.size < 0) {
    return { event: null, dropped: 'invalid' };
  }

  return {
    event: {
      kind: 'delta',
      ts: raw.ts,
      side,
      price: normalizeToTick(raw.price, tickSize),
      size: raw.size,
      updateId: typeof raw.updateId === 'number' ? raw.updateId : undefined,
      receiveTs,
      sourceProvider,
    },
  };
}
