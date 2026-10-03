/**
 * Research Lab: structured query over snapshots/bars.
 * DSL: simple JSON { underlying, gexBelow, ivAbove, ... } → filtered count + aggregations.
 */
import { IncomingMessage, ServerResponse } from 'http';
import { marketDataStore } from '../storage/marketDataStore.js';
import { runBacktest } from './backtest.js';

export function createLabRouter() {
  return async (req: IncomingMessage, res: ServerResponse, url: URL): Promise<boolean> => {
    if (!url.pathname.startsWith('/api/v1/research/query')) return false;
    const send = (status: number, data: any) => { res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(data)); return true; };
    if (req.method !== 'POST') return send(405, { error: 'Use POST' });
    let raw = ''; await new Promise<void>(r => { req.on('data', (c: any) => raw += c); req.on('end', () => r()); req.on('error', () => r()); });
    let body: any = {};
    try { body = raw ? JSON.parse(raw) : {}; } catch { return send(400, { error: 'Invalid JSON' }); }
    // Reuse backtest metrics as aggregation; query is alias for backtest with DSL
    const underlying = String(body.underlying || body.symbol || 'SPY').toUpperCase();
    const gexBelow = body.gexBelow ?? body['GEX<'] ?? undefined;
    const gexAbove = body.gexAbove ?? undefined;
    const ivAbove = body.ivAbove ?? body['IV>'] ?? undefined;
    const regime = body.regime ?? undefined;
    const m = runBacktest({ underlying, gexBelow, gexAbove, ivAbove, regime, horizonBars: body.horizonBars ?? 390 });
    // Add range aggregation
    let medianRange: number | null = null;
    try {
      const bars = marketDataStore.queryBars({ provider: 'databento', symbol: underlying, timeframe: '1m', limit: 390 } as any);
      if (bars.bars.length) {
        const hi = Math.max(...bars.bars.map((b: any) => b.high));
        const lo = Math.min(...bars.bars.map((b: any) => b.low));
        const base = bars.bars[0].close || 1;
        medianRange = (hi - lo) / base;
      }
    } catch {}
    return send(200, { underlying, occurrences: m.occurrences, medianNextDayReturn: m.medianMove, medianRange, metrics: m });
  };
}
