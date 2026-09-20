import { FUTURES_INSTRUMENTS, FuturesInstrument } from '../futuresConfig.js';
import { Tick } from '../types.js';
import { DataFeedCallbacks } from './binanceFeed.js';

export class CMEFuturesFeed {
  private instrument: FuturesInstrument;
  private callbacks: DataFeedCallbacks;
  private isRunning = false;
  private currentPrice: number;
  private intervalTimer: NodeJS.Timeout | null = null;
  private depthTimer: NodeJS.Timeout | null = null;
  private tradeCount = 0;

  constructor(symbol: string, callbacks: DataFeedCallbacks) {
    this.instrument = FUTURES_INSTRUMENTS[symbol] || FUTURES_INSTRUMENTS.ES;
    this.currentPrice = this.instrument.basePrice;
    this.callbacks = callbacks;
  }

  public setSymbol(symbol: string) {
    this.instrument = FUTURES_INSTRUMENTS[symbol] || FUTURES_INSTRUMENTS.ES;
    this.currentPrice = this.instrument.basePrice;
    this.emitDepth();
  }

  public getInstrument(): FuturesInstrument {
    return this.instrument;
  }

  public start() {
    this.isRunning = true;
    this.emitDepth();

    // High frequency CME Globex tick emitter
    const scheduleNextTick = () => {
      if (!this.isRunning) return;

      this.emitTick();
      const nextDelay = Math.floor(Math.random() * 90) + 30; // 30ms to 120ms
      this.intervalTimer = setTimeout(scheduleNextTick, nextDelay);
    };
    scheduleNextTick();

    // Depth update timer (every 100ms)
    this.depthTimer = setInterval(() => {
      if (!this.isRunning) return;
      this.emitDepth();
    }, 100);
  }

  public stop() {
    this.isRunning = false;
    if (this.intervalTimer) clearTimeout(this.intervalTimer);
    if (this.depthTimer) clearInterval(this.depthTimer);
  }

  private emitDepth() {
    const bids: [number, number][] = [];
    const asks: [number, number][] = [];
    const tick = this.instrument.tickSize;
    const bestBid = this.currentPrice - tick;
    const bestAsk = this.currentPrice + tick;

    for (let i = 0; i < 30; i++) {
      const bidP = Math.round((bestBid - i * tick) * 1000) / 1000;
      // Realistic CME depth: ES has 50-300 contracts per level, NQ has 10-80, GC has 20-100
      const multiplier = this.instrument.symbol === 'ES' ? 50 : this.instrument.symbol === 'NQ' ? 15 : 25;
      const bidSize = Math.max(1, Math.round((1 + i * 0.5 + Math.random() * 2) * multiplier));
      bids.push([bidP, bidSize]);

      const askP = Math.round((bestAsk + i * tick) * 1000) / 1000;
      const askSize = Math.max(1, Math.round((1 + i * 0.5 + Math.random() * 2) * multiplier));
      asks.push([askP, askSize]);
    }

    this.callbacks.onOrderbookSnapshot(bids, asks, Date.now());
  }

  private emitTick() {
    this.tradeCount++;
    const tick = this.instrument.tickSize;

    // Random walk with momentum
    if (Math.random() < 0.22) {
      const direction = Math.random() > 0.49 ? 1 : -1;
      this.currentPrice = Math.round((this.currentPrice + direction * tick) * 1000) / 1000;
    }

    const isBuyerMaker = Math.random() > 0.51;
    let size = Math.floor(Math.random() * 8) + 1; // 1 to 8 contracts standard

    // Occasional institutional block trade (10 to 80 contracts)
    if (Math.random() < 0.04) {
      size = Math.floor(Math.random() * 70) + 15;
    }

    const tickObj: Tick = {
      id: `cme_${this.instrument.symbol}_${this.tradeCount}_${Date.now()}`,
      timestamp: Date.now(),
      price: this.currentPrice,
      size,
      side: isBuyerMaker ? 'sell' : 'buy',
      isBuyerMaker,
    };

    this.callbacks.onTick(tickObj);
  }
}
