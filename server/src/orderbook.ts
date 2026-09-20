import { OrderbookLevel, OrderbookSnapshot } from './types.js';

export class OrderbookManager {
  private bids = new Map<number, number>(); // price -> size
  private asks = new Map<number, number>(); // price -> size
  private prevBids = new Map<number, number>();
  private prevAsks = new Map<number, number>();
  private lastUpdateId = 0;
  private depthLimit = 50;

  constructor(depthLimit = 50) {
    this.depthLimit = depthLimit;
  }

  public reset() {
    this.bids.clear();
    this.asks.clear();
    this.prevBids.clear();
    this.prevAsks.clear();
    this.lastUpdateId = 0;
  }

  public applySnapshot(bids: [number, number][], asks: [number, number][], updateId = 0) {
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
  }

  public applyDelta(bids: [number, number][], asks: [number, number][], updateId = 0) {
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
