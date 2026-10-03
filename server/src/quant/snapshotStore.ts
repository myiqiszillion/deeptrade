/**
 * Snapshot store: persists daily/snapshot exposures for historical intelligence.
 * Wraps marketDataStore.exposure_snapshots + in-memory ring for fast queries.
 */
import { marketDataStore } from '../storage/marketDataStore.js';
import type { ExposureSnapshot } from '../options/exposure.js';

export interface MarketSnapshot {
  underlying: string;
  timestamp: number;
  spot: number;
  totals: ExposureSnapshot['totals'];
  walls: ExposureSnapshot['walls'];
  gammaFlip: number | null;
  regime: ExposureSnapshot['regime'];
  dataSource: ExposureSnapshot['dataSource'];
  /** Derived at write time from the priced chain or bar close. */
  iv?: number | null;
  putCallRatio?: number | null;
  /** Bars snapshot for backtest replay: close returns at horizon handled by research layer. */
}

const RING_LIMIT = 500;

export class SnapshotStore {
  private ring: MarketSnapshot[] = [];

  public ingest(snapshot: ExposureSnapshot, extra?: { iv?: number | null; putCallRatio?: number | null }): MarketSnapshot {
    const s: MarketSnapshot = {
      underlying: snapshot.underlying,
      timestamp: snapshot.timestamp,
      spot: snapshot.spot,
      totals: snapshot.totals,
      walls: snapshot.walls,
      gammaFlip: snapshot.gammaFlip,
      regime: snapshot.regime,
      dataSource: snapshot.dataSource,
      iv: extra?.iv ?? null,
      putCallRatio: extra?.putCallRatio ?? null,
    };
    marketDataStore.saveExposureSnapshot({
      underlying: s.underlying,
      spot: s.spot,
      timestamp: s.timestamp,
      totals: s.totals,
      walls: s.walls,
      levels: (snapshot as any).levels ?? [],
      gammaFlip: s.gammaFlip,
      regime: s.regime,
      dataSource: s.dataSource,
    });
    this.ring.push(s);
    if (this.ring.length > RING_LIMIT) this.ring.shift();
    return s;
  }

  public getLatest(underlying: string): MarketSnapshot | null {
    const u = underlying.toUpperCase();
    for (let i = this.ring.length - 1; i >= 0; i--) if (this.ring[i].underlying === u) return this.ring[i];
    const persisted = marketDataStore.getLatestExposure(u);
    if (!persisted) return null;
    return {
      underlying: persisted.underlying,
      timestamp: persisted.timestamp,
      spot: persisted.spot,
      totals: persisted.totals,
      walls: persisted.walls,
      gammaFlip: persisted.gammaFlip,
      regime: persisted.regime,
      dataSource: persisted.dataSource,
    };
  }

  public findSimilar(current: MarketSnapshot, k = 10): Array<MarketSnapshot & { distance: number }> {
    const pool = this.ring.filter((s) => s.underlying === current.underlying && s.timestamp !== current.timestamp);
    if (pool.length === 0) return [];
    const vec = (s: MarketSnapshot) => [s.totals.gex, s.totals.dex, s.totals.vex, s.spot];
    const curVec = vec(current);
    const norm = (v: number[]) => {
      const m = Math.sqrt(v.reduce((a, x) => a + x * x, 0)) || 1;
      return v.map((x) => x / m);
    };
    const cn = norm(curVec);
    const scored = pool.map((s) => {
      const sn = norm(vec(s));
      let dot = 0, d2 = 0;
      for (let i = 0; i < cn.length; i++) { dot += cn[i] * sn[i]; d2 += (cn[i] - sn[i]) ** 2; }
      const distance = Math.sqrt(d2) + (1 - dot) * 0.5;
      return { ...s, distance };
    });
    scored.sort((a, b) => a.distance - b.distance);
    return scored.slice(0, k);
  }
}

export const snapshotStore = new SnapshotStore();
