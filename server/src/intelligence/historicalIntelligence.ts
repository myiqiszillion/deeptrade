/**
 * Historical Intelligence: "điều này đã từng xảy ra chưa, sau đó market làm gì?"
 * Queries local snapshots + bars to find similar structures and observed outcomes.
 */
import { snapshotStore, type MarketSnapshot } from '../quant/snapshotStore.js';
import { marketDataStore } from '../storage/marketDataStore.js';

export interface HistoricalObservation {
  date: string; // YYYY-MM-DD
  timestamp: number;
  distance: number;
  spot: number;
  totals: MarketSnapshot['totals'];
  regime: MarketSnapshot['regime'];
  nextDayReturn: number | null; // (nextClose - spot)/spot
  intradayRange: number | null; // (high-low)/spot for that day
}

function toDateStr(ts: number): string {
  return new Date(ts).toISOString().slice(0, 10);
}

export function findSimilarDays(underlying: string, k = 10): HistoricalObservation[] {
  const u = underlying.toUpperCase();
  const current = snapshotStore.getLatest(u) ?? marketDataStore.getLatestExposure(u) as any;
  if (!current) return [];
  const similar = snapshotStore.findSimilar(current as any, Math.max(k * 3, k));
  const out: HistoricalObservation[] = [];
  for (const s of similar.slice(0, k)) {
    let nextDayReturn: number | null = null;
    let intradayRange: number | null = null;
    try {
      const bars = marketDataStore.queryBars({ provider: 'databento', symbol: u, timeframe: '1m', limit: 2, beforeTime: s.timestamp + 86400000 * 2 } as any);
      // Best-effort: use bar close ~ next session if available
      if (bars.bars.length >= 2) {
        const c0 = bars.bars[0].close, c1 = bars.bars[bars.bars.length - 1].close;
        if (c0 > 0) nextDayReturn = (c1 - c0) / c0;
        const highs = bars.bars.map(b => b.high), lows = bars.bars.map(b => b.low);
        const hi = Math.max(...highs), lo = Math.min(...lows);
        if (s.spot > 0) intradayRange = (hi - lo) / s.spot;
      }
    } catch {}
    out.push({
      date: toDateStr(s.timestamp),
      timestamp: s.timestamp,
      distance: (s as any).distance ?? 0,
      spot: s.spot,
      totals: s.totals,
      regime: s.regime,
      nextDayReturn,
      intradayRange,
    });
  }
  return out;
}

export function summarizeObservations(obs: HistoricalObservation[]): { count: number; medianNextDayReturn: number | null; medianRange: number | null } {
  const rets = obs.map(o => o.nextDayReturn).filter((v): v is number => v != null).sort((a, b) => a - b);
  const ranges = obs.map(o => o.intradayRange).filter((v): v is number => v != null).sort((a, b) => a - b);
  const median = (arr: number[]) => arr.length === 0 ? null : arr.length % 2 === 1 ? arr[Math.floor(arr.length / 2)] : (arr[arr.length / 2 - 1] + arr[arr.length / 2]) / 2;
  return { count: obs.length, medianNextDayReturn: median(rets), medianRange: median(ranges) };
}
