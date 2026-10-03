/**
 * Volatility surface from priced contracts.
 * Computes per-expiration/per-strike IV grid + diagnostics: skew, term structure, spikes.
 */
import type { PricedContract } from './exposure.js';

export interface VolSurfacePoint { expiration: string; dte: number; strike: number; iv: number | null; moneyness: number }
export interface TermStructurePoint { dte: number; atmIv: number | null }
export interface SkewPoint { dte: number; skew: number | null } // put IV - call IV at ~25d
export interface VolSurface {
  underlying: string; spot: number; timestamp: number;
  points: VolSurfacePoint[];
  termStructure: TermStructurePoint[];
  skewByExpiry: SkewPoint[];
  diagnostics: {
    ivSpike: boolean; skewShift: boolean; termStructureInverted: boolean; volDislocation: boolean;
    notes: string[];
  };
}

function atmIvForExpiry(points: VolSurfacePoint[], spot: number): number | null {
  const nearAtm = points.filter(p => Math.abs(p.strike - spot) / spot < 0.02 && p.iv != null);
  if (nearAtm.length === 0) return null;
  const sorted = [...nearAtm].sort((a, b) => Math.abs(a.strike! - spot) - Math.abs(b.strike! - spot));
  return sorted[0].iv!;
}

export function buildVolSurface(
  underlying: string, spot: number, contracts: PricedContract[],
  opts: { r?: number; medianIvByDte?: Map<number, number> } = {}
): VolSurface | null {
  if (!Number.isFinite(spot) || spot <= 0 || contracts.length === 0) return null;
  const r = opts.r ?? 0.045;
  const points: VolSurfacePoint[] = [];
  for (const c of contracts) {
    const T = Math.max(c.dte, 1) / 365;
    // Use settled or cached iv if already solved; else attempt from a synthetic mid if available
    let iv = c.iv;
    if (iv == null && c.greeks) {
      // No price available to invert — keep null
    }
    // If still null but we have a price-like proxy via greeks round-trip, skip
    const moneyness = c.strike / spot;
    points.push({ expiration: c.expiration, dte: c.dte, strike: c.strike, iv, moneyness });
  }

  const expiries = [...new Set(contracts.map(c => c.dte))].sort((a, b) => a - b);
  const termStructure: TermStructurePoint[] = expiries.map(dte => {
    const pts = points.filter(p => p.dte === dte);
    return { dte, atmIv: atmIvForExpiry(pts, spot) };
  });

  const skewByExpiry: SkewPoint[] = expiries.map(dte => {
    const pts = points.filter(p => p.dte === dte && p.iv != null);
    const puts = pts.filter(p => p.strike < spot).sort((a, b) => b.strike - a.strike);
    const calls = pts.filter(p => p.strike > spot).sort((a, b) => a.strike - b.strike);
    const putIv = puts[0]?.iv ?? null;
    const callIv = calls[0]?.iv ?? null;
    const skew = putIv != null && callIv != null && callIv > 0 ? (putIv - callIv) / callIv : null;
    return { dte, skew };
  });

  // Diagnostics
  const notes: string[] = [];
  let ivSpike = false, skewShift = false, termStructureInverted = false, volDislocation = false;

  if (opts.medianIvByDte) {
    for (const ts of termStructure) {
      const med = opts.medianIvByDte.get(ts.dte);
      if (med != null && ts.atmIv != null && med > 0 && ts.atmIv / med >= 1.5) {
        ivSpike = true; notes.push(`IV spike at ${ts.dte}D: ${ts.atmIv.toFixed(2)} vs median ${med.toFixed(2)}`);
      }
    }
  }
  // Term inversion: front > back
  if (termStructure.length >= 2) {
    const front = termStructure[0].atmIv, back = termStructure[termStructure.length - 1].atmIv;
    if (front != null && back != null && front > back * 1.15) {
      termStructureInverted = true; notes.push('Term structure inverted (front > back)');
    }
  }
  // Skew shift heuristic
  for (const s of skewByExpiry) if (s.skew != null && Math.abs(s.skew) > 0.3) { skewShift = true; notes.push(`Skew shift at ${s.dte}D: ${s.skew.toFixed(2)}`); break; }

  return { underlying, spot, timestamp: Date.now(), points, termStructure, skewByExpiry, diagnostics: { ivSpike, skewShift, termStructureInverted, volDislocation, notes } };
}
