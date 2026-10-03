/** Intraday microstructure metrics — pure computation over orderbook + tape. */
import type { OrderbookSnapshot, Tick } from '../types.js';

export interface MicrostructureSnapshot {
  symbol: string;
  timestamp: number;
  spread: number | null;
  spreadBps: number | null;
  depth: { bid: number; ask: number; total: number };
  tradeIntensity: number; // trades/sec over window
  aggression: { buy: number; sell: number; imbalance: number }; // imbalance in [-1,1]
  liquidityImbalance: number; // (bidDepth - askDepth)/(bidDepth+askDepth)
  volumeImbalance: number; // (buyVol - sellVol)/(buyVol+sellVol) over window
}

export class MicrostructureEngine {
  private ticks: Tick[] = [];
  private windowMs = 60_000;

  public recordTick(t: Tick) {
    this.ticks.push(t);
    const cutoff = Date.now() - this.windowMs;
    while (this.ticks.length > 0 && this.ticks[0].timestamp < cutoff) this.ticks.shift();
    if (this.ticks.length > 5000) this.ticks.shift();
  }

  public snapshot(symbol: string, book: OrderbookSnapshot | null): MicrostructureSnapshot {
    const ts = Date.now();
    let spread: number | null = null, spreadBps: number | null = null;
    if (book && book.bids[0] && book.asks[0]) {
      spread = book.asks[0].price - book.bids[0].price;
      const mid = (book.bids[0].price + book.asks[0].price) / 2;
      if (mid > 0) spreadBps = (spread / mid) * 10000;
    }
    const bidDepth = book ? book.bids.reduce((a, l) => a + l.size, 0) : 0;
    const askDepth = book ? book.asks.reduce((a, l) => a + l.size, 0) : 0;
    const totalDepth = bidDepth + askDepth;
    const liquidityImbalance = totalDepth > 0 ? (bidDepth - askDepth) / totalDepth : 0;

    const cutoff = ts - this.windowMs;
    const windowTicks = this.ticks.filter(t => t.timestamp >= cutoff);
    const tradeIntensity = windowTicks.length / (this.windowMs / 1000);
    const buy = windowTicks.filter(t => t.side === 'buy').length;
    const sell = windowTicks.filter(t => t.side === 'sell').length;
    const denom = buy + sell || 1;
    const volumeBuy = windowTicks.filter(t => t.side === 'buy').reduce((a, t) => a + t.size, 0);
    const volumeSell = windowTicks.filter(t => t.side === 'sell').reduce((a, t) => a + t.size, 0);
    const volDenom = volumeBuy + volumeSell || 1;

    return {
      symbol, timestamp: ts,
      spread, spreadBps,
      depth: { bid: bidDepth, ask: askDepth, total: totalDepth },
      tradeIntensity,
      aggression: { buy, sell, imbalance: (buy - sell) / denom },
      liquidityImbalance,
      volumeImbalance: (volumeBuy - volumeSell) / volDenom,
    };
  }
}

export const microstructureEngine = new MicrostructureEngine();
