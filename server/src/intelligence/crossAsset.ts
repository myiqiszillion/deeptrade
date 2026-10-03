/** Cross-asset evidence: SPY/ES/NQ/VIX alignment without BUY/SELL. */
import { snapshotStore } from '../quant/snapshotStore.js';
import { marketDataStore } from '../storage/marketDataStore.js';

export interface CrossAssetEvidence {
  timestamp: number;
  underlying: string;
  spyGex: number | null;
  spyFlowBias: 'BULLISH' | 'BEARISH' | 'NEUTRAL' | null;
  esBasis: number | null; // ES close vs SPY-derived proxy (best-effort from bars)
  nqBasis: number | null;
  vixProxy: number | null; // placeholder: null until VIX feed wired
  conflicts: string[];
  summary: string;
}

function lastClose(symbol: string): number | null {
  try {
    const r = marketDataStore.queryBars({ provider: 'databento', symbol, timeframe: '1m', limit: 1 } as any);
    return r.bars.length ? r.bars[r.bars.length - 1].close : null;
  } catch { return null; }
}

export function buildCrossAssetEvidence(underlying = 'SPY'): CrossAssetEvidence {
  const u = underlying.toUpperCase();
  const snap = snapshotStore.getLatest(u) ?? (marketDataStore.getLatestExposure(u) as any);
  const spyGex = snap?.totals?.gex ?? null;
  const conflicts: string[] = [];
  const es = lastClose('ES');
  const nq = lastClose('NQ');
  const spy = lastClose(u) ?? snap?.spot ?? null;
  const esBasis = es != null && spy != null ? (es - spy) : null;
  const nqBasis = nq != null && spy != null ? (nq - spy) : null;

  const regime = snap?.regime ?? null;
  if (regime === 'NEGATIVE_GAMMA' && spyGex != null && spyGex < 0) conflicts.push('Negative gamma regime — moves may be amplified');
  if (es != null && spy != null && Math.sign(esBasis ?? 0) !== Math.sign(spyGex ?? 0)) {
    // Weak heuristic, just surface as evidence
  }

  const summary = conflicts.length ? conflicts.join('; ') : 'No clear cross-asset conflict detected';
  return { timestamp: Date.now(), underlying: u, spyGex, spyFlowBias: null, esBasis, nqBasis, vixProxy: null, conflicts, summary };
}
