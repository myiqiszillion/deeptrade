import { OrderbookLevel, OrderbookSnapshot } from './types.js';

export interface DepthSnapshotRecord {
  time: number; // Unix ms
  bids: Array<{ price: number; size: number }>;
  asks: Array<{ price: number; size: number }>;
}

export class OrderbookManager {
  private bids = new Map<number, number>(); // price -> size
  private asks = new Map<number, number>(); // price -> size
  private prevBids = new Map<number, number>();
  private prevAsks = new Map<number, number>();
  private lastUpdateId = 0;
  private depthLimit = 50;
  private depthHistory: DepthSnapshotRecord[] = [];
  private readonly maxDepthHistory = 1000;
  private lastSnapshotRecordTs = 0;

  public onSnapshotRecorded?: (snapshot: DepthSnapshotRecord, exchangeTs: number) => void;

  constructor(depthLimit = 50) {
    this.depthLimit = depthLimit;
  }

  public reset() {
    this.bids.clear();
    this.asks.clear();
    this.prevBids.clear();
    this.prevAsks.clear();
    this.depthHistory = [];
    this.lastUpdateId = 0;
    this.lastSnapshotRecordTs = 0;
  }

  private recordTop10Snapshot(now: number, exchangeTs?: number) {
    // Throttle to at most 1 snapshot per 100ms to preserve performance and memory
    if (now - this.lastSnapshotRecordTs < 100) return;
    this.lastSnapshotRecordTs = now;

    const sortedBids = Array.from(this.bids.entries())
      .filter(([, sz]) => sz > 0)
      .sort((a, b) => b[0] - a[0])
      .slice(0, 10)
      .map(([price, size]) => ({ price, size }));

    const sortedAsAsks = Array.from(this.asks.entries())
      .filter(([, sz]) => sz > 0)
      .sort((a, b) => a[0] - b[0])
      .slice(0, 10)
      .map(([price, size]) => ({ price, size }));

    if (sortedBids.length > 0 || sortedAsAsks.length > 0) {
      const snap: DepthSnapshotRecord = {
        time: exchangeTs || now,
        bids: sortedBids,
        asks: sortedAsAsks,
      };
      this.depthHistory.push(snap);

      if (this.depthHistory.length > this.maxDepthHistory) {
        this.depthHistory.splice(0, this.depthHistory.length - this.maxDepthHistory);
      }

      if (this.onSnapshotRecorded) {
        this.onSnapshotRecorded(snap, exchangeTs || now);
      }
    }
  }

  public getDepthHistory(fromMs?: number, toMs?: number): DepthSnapshotRecord[] {
    const start = fromMs ?? 0;
    const end = toMs ?? Infinity;
    return this.depthHistory.filter((s) => s.time >= start && s.time <= end);
  }

  public applySnapshot(bids: [number, number][], asks: [number, number][], updateId = 0, exchangeTs?: number) {
    this.prevBids = new Map(this.bids);
    this.prevAsks = new Map(this.asks);

    this.bids.clear();
    this.asks.clear();

    for (const [p, s] of bids) {
      if (s > 0) this.bids.set(p, s);
    }
    for (const [p, s] of asks) {
      if (s > 0) this.asks.set(p, s);
    }

    this.lastUpdateId = updateId;
    this.recordTop10Snapshot(Date.now(), exchangeTs);
  }

  public applyDelta(bids: [number, number][], asks: [number, number][], updateId = 0, exchangeTs?: number) {
    // Keep snapshot of previous state to calculate Pulling / Stacking
    this.prevBids = new Map(this.bids);
    this.prevAsks = new Map(this.asks);

    for (const [p, s] of bids) {
      if (s === 0) {
        this.bids.delete(p);
      } else {
        this.bids.set(p, s);
      }
    }

    for (const [p, s] of asks) {
      if (s === 0) {
        this.asks.delete(p);
      } else {
        this.asks.set(p, s);
      }
    }

    this.lastUpdateId = updateId;
    this.recordTop10Snapshot(Date.now(), exchangeTs);
  }

  public getSnapshot(): OrderbookSnapshot {
    // Sort bids descending (highest price first)
    const sortedBidPrices = Array.from(this.bids.keys()).sort((a, b) => b - a).slice(0, this.depthLimit);
    const bids: OrderbookLevel[] = sortedBidPrices.map((price) => {
      const size = this.bids.get(price) || 0;
      const prevSize = this.prevBids.get(price) || 0;
      const pullingStacking = size - prevSize;
      return { price, size, pullingStacking };
    });

    // Sort asks ascending (lowest price first)
    const sortedAskPrices = Array.from(this.asks.keys()).sort((a, b) => a - b).slice(0, this.depthLimit);
    const asks: OrderbookLevel[] = sortedAskPrices.map((price) => {
      const size = this.asks.get(price) || 0;
      const prevSize = this.prevAsks.get(price) || 0;
      const pullingStacking = size - prevSize;
      return { price, size, pullingStacking };
    });

    // NOTE: prev baseline is owned exclusively by applySnapshot/applyDelta so that
    // Pulling/Stacking always compares against the previous *book update* (not against
    // every getSnapshot() read, which would shrink the delta window and add noise).
    return {
      bids,
      asks,
      timestamp: Date.now(),
      lastUpdateId: this.lastUpdateId,
    };
  }

  public getBestBid(): number | null {
    if (this.bids.size === 0) return null;
    let max = -Infinity;
    for (const p of this.bids.keys()) {
      if (p > max) max = p;
    }
    return max === -Infinity ? null : max;
  }

  public getBestAsk(): number | null {
    if (this.asks.size === 0) return null;
    let min = Infinity;
    for (const p of this.asks.keys()) {
      if (p < min) min = p;
    }
    return min === Infinity ? null : min;
  }
}
