import { FootprintBar, FootprintPriceLevel, Tick } from './types.js';
import { normalizeToTick } from './priceMath.js';

export class FootprintEngine {
  private tickSize: number;
  private barDurationMs: number;
  private imbalanceRatio: number;
  private minImbalanceVol: number;
  private stackedImbalanceLevels: number;
  private currentBar: FootprintBar | null = null;
  private closedBars: FootprintBar[] = [];
  private currentCVD = 0;
  private maxStoredBars = 100;
  private recentTickIds = new Set<string>();
  private tickIdQueue: string[] = [];

  constructor(
    tickSize = 0.5,
    barDurationMs = 60 * 1000, // 1 minute default
    imbalanceRatio = 3.0, // 300% institutional standard
    minImbalanceVol = 1.0,
    stackedImbalanceLevels = 3
  ) {
    this.tickSize = tickSize;
    this.barDurationMs = barDurationMs;
    this.imbalanceRatio = imbalanceRatio;
    this.minImbalanceVol = minImbalanceVol;
    this.stackedImbalanceLevels = stackedImbalanceLevels;
  }

  public setTickSize(tickSize: number) {
    this.tickSize = tickSize;
  }

  public setBarDuration(durationMs: number) {
    this.barDurationMs = durationMs;
  }

  public setStackedImbalanceLevels(levels: number) {
    this.stackedImbalanceLevels = levels;
  }

  private normalizePrice(price: number): number {
    // Snapping to the tick's decimal precision prevents float residue such as
    // 5850.1000000000004 from becoming a level key.
    return normalizeToTick(price, this.tickSize);
  }

  public processTick(tick: Tick): { currentBar: FootprintBar; closedBar: FootprintBar | null } {
    // Deduplication check: drop duplicate ticks by ID
    if (tick.id) {
      if (this.recentTickIds.has(tick.id)) {
        return { currentBar: this.currentBar!, closedBar: null };
      }
      this.recentTickIds.add(tick.id);
      this.tickIdQueue.push(tick.id);
      if (this.tickIdQueue.length > 2000) {
        const evicted = this.tickIdQueue.shift();
        if (evicted) this.recentTickIds.delete(evicted);
      }
    }

    const normPrice = this.normalizePrice(tick.price);
    const tickTime = tick.timestamp;
    const barStartTime = Math.floor(tickTime / this.barDurationMs) * this.barDurationMs;

    let closedBar: FootprintBar | null = null;

    // Check if new bar needs to be opened
    if (!this.currentBar || this.currentBar.time !== barStartTime) {
      if (this.currentBar) {
        this.currentBar.isClosed = true;
        this.calculateBarMetrics(this.currentBar);
        closedBar = { ...this.currentBar };
        this.closedBars.push(closedBar);
        if (this.closedBars.length > this.maxStoredBars) {
          this.closedBars.shift();
        }
      }

      // Open price is strictly the first tick of this bar, NOT the previous bar's close
      const openPrice = normPrice;
      this.currentBar = {
        id: `bar_${barStartTime}`,
        time: barStartTime,
        open: openPrice,
        high: normPrice,
        low: normPrice,
        close: normPrice,
        volume: 0,
        buyVolume: 0,
        sellVolume: 0,
        delta: 0,
        minDelta: 0,
        maxDelta: 0,
        cvd: this.currentCVD,
        poc: normPrice,
        levels: {},
        unfinishedHigh: false,
        unfinishedLow: false,
        isClosed: false,
      };
    }

    const bar = this.currentBar;

    // Update OHLC
    if (normPrice > bar.high) bar.high = normPrice;
    if (normPrice < bar.low) bar.low = normPrice;
    bar.close = normPrice;

    // Update Level
    if (!bar.levels[normPrice]) {
      bar.levels[normPrice] = {
        price: normPrice,
        bidVol: 0,
        askVol: 0,
        totalVol: 0,
        delta: 0,
        bidImbalance: false,
        askImbalance: false,
        stackedBidImbalance: false,
        stackedAskImbalance: false,
      };
    }

    const level = bar.levels[normPrice];

    // Aggressor classification:
    // Buy market order (taker) -> executed at ask
    // Sell market order (taker) -> executed at bid
    // Unknown side -> volume is counted in totalVol, but neither buy nor sell volume (delta is preserved)
    const isBuy = tick.side === 'buy' || tick.isBuyerMaker === false;
    const isSell = tick.side === 'sell' || tick.isBuyerMaker === true;

    if (isBuy) {
      level.askVol += tick.size;
      bar.buyVolume += tick.size;
    } else if (isSell) {
      level.bidVol += tick.size;
      bar.sellVolume += tick.size;
    } else {
      level.unknownVol = (level.unknownVol || 0) + tick.size;
    }

    level.totalVol = level.bidVol + level.askVol + (level.unknownVol || 0);
    level.delta = level.askVol - level.bidVol;

    bar.volume += tick.size;
    bar.delta = bar.buyVolume - bar.sellVolume;

    // Update Min/Max Delta
    if (bar.delta > bar.maxDelta) bar.maxDelta = bar.delta;
    if (bar.delta < bar.minDelta) bar.minDelta = bar.delta;

    // Cumulative Volume Delta
    bar.cvd = this.currentCVD + bar.delta;

    // Check POC
    let maxLevelVol = 0;
    let currentPoc = bar.poc;
    for (const [pStr, lvl] of Object.entries(bar.levels)) {
      lvl.isPOC = false;
      if (lvl.totalVol > maxLevelVol) {
        maxLevelVol = lvl.totalVol;
        currentPoc = Number(pStr);
      }
    }
    bar.poc = currentPoc;
    if (bar.levels[currentPoc]) {
      bar.levels[currentPoc].isPOC = true;
    }

    // Calculate Diagonal & Stacked Imbalances
    this.calculateDiagonalImbalances(bar);

    // Unfinished auction checks:
    // Only meaningful when the bar has established a range (high !== low).
    // An unfinished high occurs when buyers were still buying the offer at the bar's extreme high (askVol > 0).
    // An unfinished low occurs when sellers were still hitting the bid at the bar's extreme low (bidVol > 0).
    if (bar.high !== bar.low) {
      const highLevel = bar.levels[bar.high];
      const lowLevel = bar.levels[bar.low];
      bar.unfinishedHigh = highLevel ? highLevel.askVol > 0 : false;
      bar.unfinishedLow = lowLevel ? lowLevel.bidVol > 0 : false;
    } else {
      bar.unfinishedHigh = false;
      bar.unfinishedLow = false;
    }

    return { currentBar: bar, closedBar };
  }

  private calculateDiagonalImbalances(bar: FootprintBar) {
    const sortedPrices = Object.keys(bar.levels)
      .map(Number)
      .sort((a, b) => a - b);

    // FIRST PASS: Reset imbalances on all levels so subsequent checks don't overwrite
    for (const price of sortedPrices) {
      const level = bar.levels[price];
      level.bidImbalance = false;
      level.askImbalance = false;
      level.stackedBidImbalance = false;
      level.stackedAskImbalance = false;
    }

    // SECOND PASS: Calculate diagonal imbalances
    for (let i = 0; i < sortedPrices.length; i++) {
      const price = sortedPrices[i];
      const level = bar.levels[price];

      // Diagonal: compare Bid at price P with Ask at price P + tickSize
      const nextHigherPrice = sortedPrices[i + 1];
      if (nextHigherPrice && Math.abs(nextHigherPrice - (price + this.tickSize)) < 0.001) {
        const higherLevel = bar.levels[nextHigherPrice];

        // Bid Imbalance: sellers aggressively selling at P compared to buyers at P + tickSize
        if (
          level.bidVol >= this.minImbalanceVol &&
          level.bidVol >= (higherLevel.askVol === 0 ? 1 : higherLevel.askVol) * this.imbalanceRatio
        ) {
          level.bidImbalance = true;
        }

        // Ask Imbalance: buyers aggressively buying at P + tickSize compared to sellers at P
        if (
          higherLevel.askVol >= this.minImbalanceVol &&
          higherLevel.askVol >= (level.bidVol === 0 ? 1 : level.bidVol) * this.imbalanceRatio
        ) {
          higherLevel.askImbalance = true;
        }
      }
    }

    // THIRD PASS: Calculate stacked imbalances (>= N consecutive levels)
    let consecutiveBids = 0;
    let consecutiveAsks = 0;

    for (let i = 0; i < sortedPrices.length; i++) {
      const level = bar.levels[sortedPrices[i]];
      if (level.bidImbalance) {
        consecutiveBids++;
      } else {
        if (consecutiveBids >= this.stackedImbalanceLevels) {
          for (let j = i - consecutiveBids; j < i; j++) {
            bar.levels[sortedPrices[j]].stackedBidImbalance = true;
          }
        }
        consecutiveBids = 0;
      }

      if (level.askImbalance) {
        consecutiveAsks++;
      } else {
        if (consecutiveAsks >= this.stackedImbalanceLevels) {
          for (let j = i - consecutiveAsks; j < i; j++) {
            bar.levels[sortedPrices[j]].stackedAskImbalance = true;
          }
        }
        consecutiveAsks = 0;
      }
    }

    if (consecutiveBids >= this.stackedImbalanceLevels) {
      for (let j = sortedPrices.length - consecutiveBids; j < sortedPrices.length; j++) {
        bar.levels[sortedPrices[j]].stackedBidImbalance = true;
      }
    }
    if (consecutiveAsks >= this.stackedImbalanceLevels) {
      for (let j = sortedPrices.length - consecutiveAsks; j < sortedPrices.length; j++) {
        bar.levels[sortedPrices[j]].stackedAskImbalance = true;
      }
    }
  }

  private calculateBarMetrics(bar: FootprintBar) {
    this.calculateDiagonalImbalances(bar);
    this.currentCVD = bar.cvd;
  }

  public getClosedBars(): FootprintBar[] {
    return this.closedBars;
  }

  public getCurrentBar(): FootprintBar | null {
    return this.currentBar;
  }

  public getAllBars(): FootprintBar[] {
    if (this.currentBar) {
      return [...this.closedBars, this.currentBar];
    }
    return [...this.closedBars];
  }

  public getCurrentCVD(): number {
    return this.currentCVD;
  }
}
