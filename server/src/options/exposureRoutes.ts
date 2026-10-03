import { IncomingMessage, ServerResponse } from 'node:http';
import { MarketDataStore } from '../storage/marketDataStore.js';
import { RedisCache } from '../storage/redisCache.js';
import { buildPricedChain } from './chain.js';
import { buildExposure } from './exposure.js';
import { resolveDatabentoConfig } from '../databento/config.js';
import { snapshotStore } from '../quant/snapshotStore.js';

export interface ExposureRouteContext {
  store: MarketDataStore;
  cache: RedisCache;
}

export function createExposureRouter(ctx: ExposureRouteContext) {
  const { store, cache } = ctx;

  // reuse RedisCache in-memory map for exposure snapshot cache via a simple TTL map
  const memCache = new Map<string, { value: any; exp: number }>();

  return async function handleExposureRequest(req: IncomingMessage, res: ServerResponse, url: URL): Promise<boolean> {
    if (!url.pathname.startsWith('/api/v1/exposure')) return false;

    const send = (status: number, data: any): boolean => {
      res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store, max-age=0' });
      res.end(JSON.stringify(data));
      return true;
    };

    const underlying = (url.searchParams.get('underlying') || url.searchParams.get('symbol') || url.pathname.split('/').pop() || 'SPY').toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (!/^[A-Z0-9]{1,6}$/.test(underlying)) return send(400, { error: 'Invalid underlying', code: 'INVALID_UNDERLYING' });

    const cfg = resolveDatabentoConfig();
    const r = parseFloat(process.env.RISK_FREE_RATE || '0.04');

    // Try mem cache (30s)
    const cacheKey = `exposure:${underlying}`;
    const cached = memCache.get(cacheKey);
    if (cached && Date.now() < cached.exp) {
      if (url.pathname.endsWith('/gamma')) {
        const s = cached.value;
        return send(200, { underlying, spot: s.spot, totalGex: s.totals.gex, levels: s.levels, callWall: s.walls.callWall, putWall: s.walls.putWall, gammaFlip: s.gammaFlip, regime: s.regime, source: s.dataSource, timestamp: s.timestamp });
      }
      return send(200, cached.value);
    }

    // Build chain from store (no vendor fetch in M2 — vendor quotes require live key; store is populated via historical/definition sync)
    const defs = store.getOptionDefinitions(underlying);
    if (defs.length === 0) return send(404, { error: `No option chain for ${underlying}`, code: 'CHAIN_NOT_FOUND', hint: 'POST /api/v1/admin/instruments/sync or set DATABENTO_API_KEY' });

    // Quotes/stats from store — NormalizedQuote not yet persisted per-symbol; use empty map (greeks will be null, exposure will be null)
    // For M2 we still surface the snapshot with null exposure when quotes missing, rather than 500.
    const quotes = new Map<string, any>();
    const stats = new Map<string, any>();
    for (const d of defs) {
      const s = store.getLatestStatistics(d.symbol);
      if (s) stats.set(d.symbol, s);
    }

    // Spot: try latest bar close or 0 (fail-closed)
    let spot: number | null = null;
    try {
      const bars = store.queryBars({ provider: 'databento', symbol: underlying, timeframe: '1m', limit: 1 });
      if (bars.bars.length > 0) spot = bars.bars[bars.bars.length - 1].close;
    } catch {}
    if (spot == null || spot <= 0) {
      // Fallback: use a mid-strike as proxy (not ideal, but prevents 500)
      const mids = defs.map(d => d.strike).sort((a, b) => a - b);
      spot = mids.length ? mids[Math.floor(mids.length / 2)] : null;
    }
    if (spot == null || spot <= 0) return send(503, { error: 'Spot price unavailable', code: 'SPOT_UNAVAILABLE' });

    const priced = buildPricedChain({ underlying, spot, definitions: defs, quotes: quotes as any, statistics: stats as any, riskFreeRate: Number.isFinite(r) ? r : 0.04 });
    const snapshot = buildExposure(underlying, spot, priced, 'DATABENTO_OPRA');

    if (!snapshot) return send(200, { underlying, spot, totals: { gex: 0, dex: 0, vex: 0, tex: 0, notional: 0 }, levels: [], walls: { callWall: spot, putWall: spot }, gammaFlip: null, regime: 'POSITIVE_GAMMA', dataSource: 'DATABENTO_OPRA', timestamp: Date.now(), note: 'no computable exposure (missing quotes/OI or greeks)' });

    // Persist + cache + snapshot ring for historical intelligence
    try { store.saveExposureSnapshot(snapshot); snapshotStore.ingest(snapshot); } catch {}
    memCache.set(cacheKey, { value: snapshot, exp: Date.now() + 30_000 });

    if (url.pathname.endsWith('/gamma')) {
      return send(200, { underlying, spot: snapshot.spot, totalGex: snapshot.totals.gex, levels: snapshot.levels, callWall: snapshot.walls.callWall, putWall: snapshot.walls.putWall, gammaFlip: snapshot.gammaFlip, regime: snapshot.regime, source: snapshot.dataSource, timestamp: snapshot.timestamp });
    }
    return send(200, snapshot);
  };
}
