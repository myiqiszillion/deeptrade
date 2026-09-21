import { AbsorptionAlert, DeepTrade, OrderbookSnapshot, SpeedOfTapeData, Tick, classifyAggressorSide } from './types.js';

export class TapeEngine {
  private recentTicks: Tick[] = [];
  private deepTradeThresholdUsd: number;
  private absorptionVolumeThreshold: number;
  private prevTps = 0;

  // Level volume tracker for absorption
  private rollingPriceVolumes = new Map<number, { buyVol: number; sellVol: number; lastTime: number }>();

  constructor(deepTradeThresholdUsd = 50000, absorptionVolumeThreshold = 10.0) {
    this.deepTradeThresholdUsd = deepTradeThresholdUsd;
    this.absorptionVolumeThreshold = absorptionVolumeThreshold;
  }

  public setThresholds(deepTradeThresholdUsd: number, absorptionVolumeThreshold: number) {
    this.deepTradeThresholdUsd = deepTradeThresholdUsd;
    this.absorptionVolumeThreshold = absorptionVolumeThreshold;
  }

  public processTick(
    tick: Tick,
    currentBook?: OrderbookSnapshot | null,
    pointValue: number = 1,
    tickSize: number = 0.01
  ): {
    speed: SpeedOfTapeData;
    deepTrade: DeepTrade | null;
    absorption: AbsorptionAlert | null;
  } {
    const now = tick.timestamp;
    this.recentTicks.push(tick);

    // Keep only last 3 seconds of ticks for Speed of Tape calculation
    const cutoff = now - 3000;
    this.recentTicks = this.recentTicks.filter((t) => t.timestamp >= cutoff && t.timestamp <= now + 5000);

    // 1. Calculate Speed of Tape
    const count = this.recentTicks.length;
    let minTs = now;
    let totalVol = 0;
    let buyVol = 0;
    let knownVol = 0;
    for (const t of this.recentTicks) {
      if (t.timestamp < minTs) minTs = t.timestamp;
      totalVol += t.size;
      const side = classifyAggressorSide(t);
      if (side === 'buy') {
        buyVol += t.size;
        knownVol += t.size;
      } else if (side === 'sell') {
        knownVol += t.size;
      }
    }
    const durationSec = Math.max(0.1, (now - minTs) / 1000);
    const tps = Math.round((count / durationSec) * 10) / 10;
    const volumePerSec = Math.round((totalVol / durationSec) * 100) / 100;
    // Base buyRatio only on trades with known aggressor side to avoid skew from unknown volume
    const buyRatio = knownVol > 0 ? buyVol / knownVol : 0.5;
    const acceleration = this.prevTps > 0 ? Math.min(1, Math.max(-1, (tps - this.prevTps) / this.prevTps)) : 0;
    this.prevTps = tps;

    const speed: SpeedOfTapeData = {
      tps,
      volumePerSec,
      buyRatio,
      acceleration,
    };

    // Periodic eviction of stale price levels (older than 10s)
    if (this.rollingPriceVolumes.size > 50) {
      for (const [p, d] of this.rollingPriceVolumes.entries()) {
        if (now - d.lastTime > 10000) {
          this.rollingPriceVolumes.delete(p);
        }
      }
    }

    // 2. Check for Deep Trade (Whale)
    const valueUsd = tick.price * tick.size * pointValue;
    let deepTrade: DeepTrade | null = null;
    if (valueUsd >= this.deepTradeThresholdUsd) {
      deepTrade = {
        id: `dt_${tick.id}`,
        timestamp: tick.timestamp,
        price: tick.price,
        size: tick.size,
        valueUsd,
        side: tick.side,
      };
    }

    // 3. Check for Absorption
    let absorption: AbsorptionAlert | null = null;
    let priceData = this.rollingPriceVolumes.get(tick.price);
    if (!priceData || now - priceData.lastTime > 5000) {
      priceData = { buyVol: 0, sellVol: 0, lastTime: now };
      this.rollingPriceVolumes.set(tick.price, priceData);
    }

    const side = classifyAggressorSide(tick);
    if (side === 'buy') {
      priceData.buyVol += tick.size;
    } else if (side === 'sell') {
      priceData.sellVol += tick.size;
    }
    priceData.lastTime = now;

    // Detect Sell Absorption (High aggressive selling absorbed by limit buy)
    if (priceData.sellVol >= this.absorptionVolumeThreshold) {
      const bestBid = currentBook?.bids[0]?.price;
      // Tolerance is tick-relative: 1.0 point would be 4 ticks on ES but 100 ticks on CL.
      if (bestBid && Math.abs(tick.price - bestBid) <= tickSize * 1.5) {
        absorption = {
          id: `abs_${now}_${tick.price}`,
          timestamp: now,
          price: tick.price,
          volume: Math.round(priceData.sellVol * 100) / 100,
          side: 'sell_absorption',
          description: `Passive Buyer Absorption: ${priceData.sellVol.toFixed(2)} absorbed at ${tick.price}`,
        };
        priceData.sellVol = 0; // Reset after alert
      }
    }

    // Detect Buy Absorption (High aggressive buying absorbed by limit sell)
    if (priceData.buyVol >= this.absorptionVolumeThreshold) {
      const bestAsk = currentBook?.asks[0]?.price;
      // Tick-relative tolerance (see sell-absorption note above).
      if (bestAsk && Math.abs(tick.price - bestAsk) <= tickSize * 1.5) {
        absorption = {
          id: `abs_${now}_${tick.price}`,
          timestamp: now,
          price: tick.price,
          volume: Math.round(priceData.buyVol * 100) / 100,
          side: 'buy_absorption',
          description: `Passive Seller Absorption: ${priceData.buyVol.toFixed(2)} absorbed at ${tick.price}`,
        };
        priceData.buyVol = 0; // Reset after alert
      }
    }

    return { speed, deepTrade, absorption };
  }
}
