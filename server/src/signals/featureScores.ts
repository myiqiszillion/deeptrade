/**
 * Signal Engine: feature-vector scores (no BUY/SELL).
 * Gamma/Flow/Volatility/Liquidity/Momentum/Futures → 0..3 plus confidence/evidence.
 */
import { snapshotStore } from '../quant/snapshotStore.js';
import { marketDataStore } from '../storage/marketDataStore.js';
import { listEvents } from '../intelligence/eventEngine.js';
import { microstructureEngine } from '../microstructure/engine.js';

export type Score = 0 | 1 | 2 | 3;
export interface FeatureScores {
  gamma: Score; flow: Score; volatility: Score; liquidity: Score; momentum: Score; futures: Score;
}
export interface SignalResult {
  underlying: string;
  timestamp: number;
  scores: FeatureScores;
  evidence: string[];
  confidence: number; // 0..1
  evidenceCount: number;
}

function clampScore(n: number): Score { return Math.max(0, Math.min(3, Math.round(n))) as Score; }

export function evaluateSignals(underlying = 'SPY'): SignalResult {
  const u = underlying.toUpperCase();
  const snap = snapshotStore.getLatest(u) ?? (marketDataStore.getLatestExposure(u) as any);
  const events = listEvents(u, 50);
  const evidence: string[] = [];

  let gamma: Score = 0, flow: Score = 0, volatility: Score = 0, liquidity: Score = 0, momentum: Score = 0, futures: Score = 0;

  if (snap) {
    const gex = snap.totals?.gex ?? 0;
    if (Math.abs(gex) > 5000) { gamma = 3; evidence.push(`GEX ${gex} (amplified)`); }
    else if (Math.abs(gex) > 1000) { gamma = 2; evidence.push(`GEX ${gex}`); }
    else if (Math.abs(gex) > 200) { gamma = 1; evidence.push(`GEX ${gex} (muted)`); }
    if (snap.regime === 'NEGATIVE_GAMMA') evidence.push('Negative gamma regime');
    if (snap.gammaFlip != null && Math.abs(snap.spot - snap.gammaFlip) / snap.spot < 0.015) {
      evidence.push(`Near gamma flip ${snap.gammaFlip}`);
      gamma = clampScore(gamma + 1);
    }
  }

  const largeFlow = events.filter(e => e.kind === 'LARGE_FLOW').length;
  if (largeFlow >= 3) { flow = 3; evidence.push(`${largeFlow} large flow events`); }
  else if (largeFlow >= 1) { flow = 2; evidence.push(`${largeFlow} large flow`); }

  const ivSpikes = events.filter(e => e.kind === 'IV_EXPANSION').length;
  if (ivSpikes > 0) { volatility = clampScore(1 + ivSpikes); evidence.push(`IV expansion x${ivSpikes}`); }

  const liq = events.filter(e => e.kind === 'LIQUIDITY_IMBALANCE').length;
  if (liq > 0) { liquidity = clampScore(liq); evidence.push(`Liquidity imbalance x${liq}`); }
  else {
    try {
      const ms = microstructureEngine.snapshot(u, null);
      if (Math.abs(ms.liquidityImbalance) > 0.35) { liquidity = 2; evidence.push(`Liquidity imbalance ${ms.liquidityImbalance.toFixed(2)}`); }
      else if (Math.abs(ms.liquidityImbalance) > 0.15) { liquidity = 1; evidence.push(`Liquidity lean ${ms.liquidityImbalance.toFixed(2)}`); }
    } catch {}
  }

  // Momentum: recent bar direction
  try {
    const bars = (marketDataStore as any).queryBars ? marketDataStore.queryBars({ provider: 'databento', symbol: u, timeframe: '1m', limit: 5 } as any) : { bars: [] };
    if (bars.bars.length >= 3) {
      const closes = bars.bars.map((b: any) => b.close);
      const up = closes[closes.length - 1] > closes[0];
      const range = Math.max(...closes) - Math.min(...closes);
      const avg = closes.reduce((a: number, x: number) => a + x, 0) / closes.length;
      if (avg > 0 && range / avg > 0.008) { momentum = 2; evidence.push(`Momentum ${up ? 'up' : 'down'} range ${(range / avg * 100).toFixed(2)}%`); }
      else if (range / Math.max(avg, 1) > 0.003) { momentum = 1; }
    }
  } catch {}

  // Futures: ES/NQ basis proxy
  futures = 1;
  if (snap) futures = snap.totals?.gex != null && Math.abs(snap.totals.gex) > 1000 ? 2 : 1;

  const scores: FeatureScores = { gamma, flow, volatility, liquidity, momentum, futures };
  const evidenceCount = evidence.length;
  const confidence = Math.min(1, evidenceCount / 10);

  return { underlying: u, timestamp: Date.now(), scores, evidence, confidence, evidenceCount };
}
