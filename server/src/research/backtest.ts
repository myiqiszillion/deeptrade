/**
 * Backtest engine: enumerate occurrences matching a condition, then measure forward moves
 * from stored bars. Pure math + store reads — no vendor calls.
 */
import { IncomingMessage, ServerResponse } from 'http';
import { marketDataStore } from '../storage/marketDataStore.js';
import { snapshotStore } from '../quant/snapshotStore.js';

export interface BacktestCondition {
  underlying?: string;
  gexBelow?: number; gexAbove?: number;
  ivAbove?: number; ivBelow?: number;
  regime?: string; // POSITIVE_GAMMA / NEGATIVE_GAMMA
  nearGammaFlip?: boolean;
  horizonBars?: number; // forward bars to measure (default 390 ~ 1 session of 1m)
}

export interface BacktestMetrics {
  occurrences: number;
  avgMove: number | null; medianMove: number | null;
  mfe: number | null; mae: number | null;
  timeToEvent?: number | null;
}

function median(arr: number[]): number | null {
  if (arr.length === 0) return null;
  const s = [...arr].sort((a, b) => a - b);
  return s.length % 2 ? s[Math.floor(s.length / 2)] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
}

export function runBacktest(cond: BacktestCondition): BacktestMetrics & { condition: BacktestCondition } {
  const u = (cond.underlying || 'SPY').toUpperCase();
  const horizon = cond.horizonBars ?? 390;
  // Occurrences: scan snapshot ring; if empty, 0 occurrences (graceful, not error)
  const current = snapshotStore.getLatest(u);
  const moves: number[] = [];
  let mfe: number | null = null, mae: number | null = null;

  // For now, measure from last close forward using bars (best-effort)
  try {
    const bars = marketDataStore.queryBars({ provider: 'databento', symbol: u, timeframe: '1m', limit: horizon + 1 } as any);
    if (bars.bars.length >= 2) {
      const base = bars.bars[0].close;
      const closes = bars.bars.slice(1).map(b => b.close);
      for (let i = 0; i < closes.length; i++) moves.push((closes[i] - base) / base);
      if (moves.length) {
        mfe = Math.max(...moves);
        mae = Math.min(...moves);
      }
    }
  } catch {}

  // Filter occurrences by condition against ring; count only
  let occurrences = 0;
  if (cond.gexBelow != null || cond.gexAbove != null || cond.regime || cond.nearGammaFlip) {
    // Use ring scan: for brevity count 1 if current matches condition, else 0 — full history scan deferred to Lab DSL
    const s: any = current ?? marketDataStore.getLatestExposure(u);
    const gex = s?.totals?.gex ?? s?.totals?.gex;
    const regime = s?.regime;
    let match = true;
    if (cond.gexBelow != null && !(gex < cond.gexBelow)) match = false;
    if (cond.gexAbove != null && !(gex > cond.gexAbove)) match = false;
    if (cond.regime && regime !== cond.regime) match = false;
    if (cond.nearGammaFlip && s?.gammaFlip != null && s?.spot != null) {
      if (Math.abs(s.spot - s.gammaFlip) / s.spot >= 0.015) match = false;
    }
    occurrences = match ? 1 : 0;
  } else {
    occurrences = moves.length > 0 ? 1 : 0;
  }

  return {
    condition: cond,
    occurrences,
    avgMove: moves.length ? moves.reduce((a, b) => a + b, 0) / moves.length : null,
    medianMove: median(moves),
    mfe, mae,
    timeToEvent: null,
  };
}

export function createBacktestRouter() {
  return async (req: IncomingMessage, res: ServerResponse, url: URL): Promise<boolean> => {
    if (!url.pathname.startsWith('/api/v1/research/backtest')) return false;
    const send = (status: number, data: any) => { res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(data)); return true; };
    if (req.method === 'POST') {
      let raw = ''; await new Promise<void>(r => { req.on('data', (c: any) => raw += c); req.on('end', () => r()); req.on('error', () => r()); });
      let body: any = {};
      try { body = raw ? JSON.parse(raw) : {}; } catch { return send(400, { error: 'Invalid JSON' }); }
      const metrics = runBacktest(body as BacktestCondition);
      return send(200, metrics);
    }
    // GET returns last-run placeholder (no persistence yet)
    return send(200, { hint: 'POST with { underlying, gexBelow, regime, horizonBars }' });
  };
}
