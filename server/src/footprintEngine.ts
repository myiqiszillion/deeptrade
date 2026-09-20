import { FootprintBar, FootprintPriceLevel, Tick } from './types.js';

export class FootprintEngine {
  private tickSize: number;
  private barDurationMs: number;
  private imbalanceRatio: number;
  private minImbalanceVol: number;
  private currentBar: FootprintBar | null = null;
  private closedBars: FootprintBar[] = [];
  private currentCVD = 0;
  private maxStoredBars = 100;

  constructor(
    tickSize = 0.5,
    barDurationMs = 60 * 1000, // 1 minute default
    imbalanceRatio = 3.0, // 300% institutional standard
    minImbalanceVol = 1.0
  ) {
    this.tickSize = tickSize;
    this.barDurationMs = barDurationMs;
    this.imbalanceRatio = imbalanceRatio;
    this.minImbalanceVol = minImbalanceVol;
  }

  public setTickSize(tickSize: number) {
    this.tickSize = tickSize;
  }

  public setBarDuration(durationMs: number) {
    this.barDurationMs = durationMs;
  }

  private normalizePrice(price: number): number {
    return Math.round(price / this.tickSize) * this.tickSize;
  }

  public processTick(tick: Tick): { currentBar: FootprintBar; closedBar: FootprintBar | null } {
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

      const openPrice = this.currentBar ? this.currentBar.close : normPrice;
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
      };
    }

    const level = bar.levels[normPrice];
    const isSell = tick.isBuyerMaker; // buyer was maker => market sell executed at bid
    const isBuy = !tick.isBuyerMaker; // buyer was taker => market buy executed at ask

    if (isBuy) {
      level.askVol += tick.size;
      bar.buyVolume += tick.size;
    } else {
      level.bidVol += tick.size;
      bar.sellVolume += tick.size;
    }

    level.totalVol = level.bidVol + level.askVol;
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

    // Calculate Diagonal Imbalances
    this.calculateDiagonalImbalances(bar);

    // Unfinished auction checks
    const highLevel = bar.levels[bar.high];
    const lowLevel = bar.levels[bar.low];
    bar.unfinishedHigh = highLevel ? highLevel.askVol > 0 : false;
    bar.unfinishedLow = lowLevel ? lowLevel.bidVol > 0 : false;

    return { currentBar: bar, closedBar };
  }

  private calculateDiagonalImbalances(bar: FootprintBar) {
    const sortedPrices = Object.keys(bar.levels)
      .map(Number)
      .sort((a, b) => a - b);

    for (let i = 0; i < sortedPrices.length; i++) {
      const price = sortedPrices[i];
      const level = bar.levels[price];

      level.bidImbalance = false;
      level.askImbalance = false;

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
