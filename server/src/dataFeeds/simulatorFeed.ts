import { Tick } from '../types.js';
import { DataFeedCallbacks } from './binanceFeed.js';

export class SimulatorFeed {
  private callbacks: DataFeedCallbacks;
  private isRunning = false;
  private basePrice: number;
  private currentPrice: number;
  private tickSize: number;
  private intervalTimer: NodeJS.Timeout | null = null;
  private depthTimer: NodeJS.Timeout | null = null;
  private tradeCount = 0;

  constructor(basePrice = 64500.0, tickSize = 0.5, callbacks: DataFeedCallbacks) {
    this.basePrice = basePrice;
    this.currentPrice = basePrice;
    this.tickSize = tickSize;
    this.callbacks = callbacks;
  }

  public start() {
    this.isRunning = true;
    this.generateInitialDepth();

    // High frequency tick emitter (every 50-150ms)
    const scheduleNextTick = () => {
      if (!this.isRunning) return;

      this.emitSimulatedTick();
      const nextDelay = Math.floor(Math.random() * 80) + 40; // 40ms to 120ms
      this.intervalTimer = setTimeout(scheduleNextTick, nextDelay);
    };
    scheduleNextTick();

    // Orderbook update timer (every 100ms)
    this.depthTimer = setInterval(() => {
      if (!this.isRunning) return;
      this.emitSimulatedDepth();
    }, 100);
  }

  public stop() {
    this.isRunning = false;
    if (this.intervalTimer) clearTimeout(this.intervalTimer);
    if (this.depthTimer) clearInterval(this.depthTimer);
  }

  private generateInitialDepth() {
    this.emitSimulatedDepth();
  }

  private emitSimulatedDepth() {
    const bids: [number, number][] = [];
    const asks: [number, number][] = [];
    const bestBid = this.currentPrice - this.tickSize / 2;
    const bestAsk = this.currentPrice + this.tickSize / 2;

    for (let i = 0; i < 30; i++) {
      const bidP = Math.round((bestBid - i * this.tickSize) * 10) / 10;
      // Realistic depth profile: volume increases away from touch + random fluctuations
      const bidBaseSize = 0.5 + (i * 0.2) + Math.random() * 2.5;
      bids.push([bidP, Math.round(bidBaseSize * 100) / 100]);

      const askP = Math.round((bestAsk + i * this.tickSize) * 10) / 10;
      const askBaseSize = 0.5 + (i * 0.2) + Math.random() * 2.5;
      asks.push([askP, Math.round(askBaseSize * 100) / 100]);
    }

    this.callbacks.onOrderbookSnapshot(bids, asks, Date.now());
  }

  private emitSimulatedTick() {
    this.tradeCount++;

    // Random walk with momentum
    const drift = (Math.random() - 0.495) * this.tickSize;
    if (Math.random() < 0.25) {
      this.currentPrice = Math.round((this.currentPrice + (drift > 0 ? this.tickSize : -this.tickSize)) * 10) / 10;
    }

    // Determine side & size
    const isBuyerMaker = Math.random() > 0.52; // true = market sell, false = market buy
    let size = Math.round((0.05 + Math.random() * 1.5) * 1000) / 1000;

    // 2% chance of a Whale / Deep Trade
    if (Math.random() < 0.02) {
      size = Math.round((2.0 + Math.random() * 8.0) * 100) / 100; // Large size
    }

    const tick: Tick = {
      id: `sim_${this.tradeCount}_${Date.now()}`,
      timestamp: Date.now(),
      price: this.currentPrice,
      size,
      side: isBuyerMaker ? 'sell' : 'buy',
      isBuyerMaker,
    };

    this.callbacks.onTick(tick);
  }
}
