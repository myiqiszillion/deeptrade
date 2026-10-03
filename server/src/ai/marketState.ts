/** Structured Market State: single JSON the AI layer consumes — no LLM call here. */
import { snapshotStore } from '../quant/snapshotStore.js';
import { marketDataStore } from '../storage/marketDataStore.js';
import { buildMarketImpact } from '../quant/dealerPositioning.js';
import { buildCrossAssetEvidence } from '../intelligence/crossAsset.js';
import { listEvents } from '../intelligence/eventEngine.js';
import { evaluateSignals } from '../signals/featureScores.js';
import { microstructureEngine } from '../microstructure/engine.js';

export function buildMarketState(underlying = 'SPY'): Record<string, unknown> {
  const u = underlying.toUpperCase();
  const snap = snapshotStore.getLatest(u) ?? (marketDataStore.getLatestExposure(u) as any);
  let bars: any[] = [];
  try { bars = marketDataStore.queryBars({ provider: 'databento', symbol: u, timeframe: '1m', limit: 1 } as any).bars; } catch {}
  const spot = snap?.spot ?? bars[0]?.close ?? null;
  const snapshot = snap ?? null;
  const dealer = snap ? (() => { try { return buildMarketImpact(snap as any); } catch { return null; } })() : null;
  const crossAsset = (() => { try { return buildCrossAssetEvidence(u); } catch { return null; } })();
  const events = listEvents(u, 20);
  const signals = (() => { try { return evaluateSignals(u); } catch { return null; } })();
  const micro = (() => { try { return microstructureEngine.snapshot(u, null); } catch { return null; } })();

  return {
    symbol: u,
    timestamp: Date.now(),
    spot,
    snapshot,
    dealer,
    crossAsset,
    events,
    signals,
    microstructure: micro,
    bars: bars.slice(-1),
    disclaimer: 'Structured state only — no trading advice. AI must cite these fields.',
  };
}
