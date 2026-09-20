import { Tick, VWAPPoint } from './types.js';

export class VWAPEngine {
  private cumulativePV = 0; // Sum of (Price * Volume)
  private cumulativeVolume = 0; // Sum of Volume
  private cumulativePV2 = 0; // Sum of (Price^2 * Volume) for variance calculation
  private history: VWAPPoint[] = [];
  private anchorTimestamp: number;
  private lastSampleTime = 0;
  private sampleIntervalMs = 5000; // 5s interval for smooth curve

  constructor(anchorTimestamp = Date.now()) {
    this.anchorTimestamp = anchorTimestamp;
  }

  public reset(anchorTimestamp = Date.now()) {
    this.cumulativePV = 0;
    this.cumulativeVolume = 0;
    this.cumulativePV2 = 0;
    this.history = [];
    this.anchorTimestamp = anchorTimestamp;
    this.lastSampleTime = 0;
  }

  public processTick(tick: Tick): VWAPPoint | null {
    if (tick.timestamp < this.anchorTimestamp) return null;

    const p = tick.price;
    const v = tick.size;

    this.cumulativePV += p * v;
    this.cumulativeVolume += v;
    this.cumulativePV2 += p * p * v;

    if (this.cumulativeVolume === 0) return null;

    const vwap = this.cumulativePV / this.cumulativeVolume;

    // Variance = (sum(P^2 * V) / sum(V)) - vwap^2
    const variance = Math.max(0, (this.cumulativePV2 / this.cumulativeVolume) - (vwap * vwap));
    const stdDev = Math.sqrt(variance);

    const point: VWAPPoint = {
      time: tick.timestamp,
      vwap,
      upper1: vwap + stdDev,
      lower1: vwap - stdDev,
      upper2: vwap + 2 * stdDev,
      lower2: vwap - 2 * stdDev,
      upper3: vwap + 3 * stdDev,
      lower3: vwap - 3 * stdDev,
    };

    if (tick.timestamp - this.lastSampleTime >= this.sampleIntervalMs) {
      this.history.push(point);
      if (this.history.length > 500) {
        this.history.shift();
      }
      this.lastSampleTime = tick.timestamp;
    }

    return point;
  }

  public getHistory(): VWAPPoint[] {
    return this.history;
  }
}
