/**
 * Chain builder: joins definitions + quotes + OI + spot into PricedContracts.
 * No vendor calls — caller injects data.
 */
import type { OptionContractDefinition, OptionStatisticRecord, NormalizedQuote } from '../databento/types.js';
import type { PricedContract } from './exposure.js';
import { bsGreeks } from './blackScholes.js';
import { impliedVol, midQuotePrice } from './iv.js';

export interface ChainBuildInputs {
  underlying: string;
  spot: number | null;
  definitions: OptionContractDefinition[];
  quotes: Map<string, NormalizedQuote>;
  statistics: Map<string, OptionStatisticRecord>;
  riskFreeRate: number;
}

export function buildPricedChain(inputs: ChainBuildInputs): PricedContract[] {
  const { spot, definitions, quotes, statistics, riskFreeRate } = inputs;
  if (spot == null || !Number.isFinite(spot) || spot <= 0) return [];
  const out: PricedContract[] = [];
  for (const def of definitions) {
    if (def.dte < 0) continue;
    const q = quotes.get(def.symbol);
    const stat = statistics.get(def.symbol);
    const oi = stat?.openInterest ?? null;
    let mid: number | null = null;
    if (q) mid = midQuotePrice((q as any).bidPrice ?? (q as any).bid ?? null, (q as any).askPrice ?? (q as any).ask ?? null, (q as any).lastPrice ?? null);
    const T = Math.max(def.dte, 1) / 365;
    let iv: number | null = null;
    let greeks: PricedContract['greeks'] = null;
    if (mid != null && Number.isFinite(mid) && mid > 0) {
      const r = impliedVol(mid, spot, def.strike, T, riskFreeRate, def.type);
      if (r.iv != null) {
        iv = r.iv;
        greeks = bsGreeks({ S: spot, K: def.strike, T, r: riskFreeRate, sigma: iv, type: def.type });
      }
    }
    out.push({
      symbol: def.symbol, underlying: def.underlying, expiration: def.expiration, dte: def.dte,
      type: def.type, strike: def.strike,
      openInterest: oi != null && Number.isFinite(oi) ? oi : null,
      iv, greeks,
    });
  }
  return out;
}
