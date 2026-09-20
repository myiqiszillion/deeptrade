import { AbsorptionAlert, DeepTrade, OrderbookSnapshot, SpeedOfTapeData, Tick } from './types.js';

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
    pointValue: number = 1
  ): {
    speed: SpeedOfTapeData;
    deepTrade: DeepTrade | null;
    absorption: AbsorptionAlert | null;
  } {
    const now = tick.timestamp;
    this.recentTicks.push(tick);

    // Keep only last 3 seconds of ticks for Speed of Tape calculation
    const cutoff = now - 3000;
    while (this.recentTicks.length > 0 && this.recentTicks[0].timestamp < cutoff) {
      this.recentTicks.shift();
    }

    // 1. Calculate Speed of Tape
    const count = this.recentTicks.length;
    const durationSec = Math.max(0.1, (now - (this.recentTicks[0]?.timestamp || now)) / 1000);
    const tps = Math.round((count / durationSec) * 10) / 10;

    let totalVol = 0;
    let buyVol = 0;
    for (const t of this.recentTicks) {
      totalVol += t.size;
      if (!t.isBuyerMaker) buyVol += t.size;
    }

    const volumePerSec = Math.round((totalVol / durationSec) * 100) / 100;
    const buyRatio = totalVol > 0 ? buyVol / totalVol : 0.5;
    const acceleration = this.prevTps > 0 ? Math.min(1, Math.max(-1, (tps - this.prevTps) / this.prevTps)) : 0;
    this.prevTps = tps;

    const speed: SpeedOfTapeData = {
      tps,
      volumePerSec,
      buyRatio,
      acceleration,
    };

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

    if (!tick.isBuyerMaker) {
      priceData.buyVol += tick.size;
    } else {
      priceData.sellVol += tick.size;
    }
    priceData.lastTime = now;

    // Detect Sell Absorption (High aggressive selling absorbed by limit buy)
    if (priceData.sellVol >= this.absorptionVolumeThreshold) {
      const bestBid = currentBook?.bids[0]?.price;
      // If selling occurred near best bid without breaking down
      if (bestBid && Math.abs(tick.price - bestBid) <= 1.0) {
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
      // If buying occurred near best ask without breaking up
      if (bestAsk && Math.abs(tick.price - bestAsk) <= 1.0) {
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
