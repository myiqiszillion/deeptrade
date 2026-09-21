import { TPOBracket, TPOProfileData, VolumeProfileData, VolumeProfileLevel, Tick, classifyAggressorSide } from './types.js';
import { normalizeToTick } from './priceMath.js';

export class ProfileEngine {
  private tickSize: number;
  private volumeLevels = new Map<number, { buyVol: number; sellVol: number; unknownVol?: number }>();
  private totalVolume = 0;

  // TPO state
  private tpoBracketDurationMs = 30 * 60 * 1000; // 30 minutes per bracket
  private tpoLetters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
  private sessionStartTime: number;
  private tpoPriceLevels = new Map<number, Set<string>>(); // price -> set of letters
  private brackets: TPOBracket[] = [];
  private ibHigh = -Infinity;
  private ibLow = Infinity;

  constructor(tickSize = 0.5, sessionStartTime = 0) {
    this.tickSize = tickSize;
    this.sessionStartTime = sessionStartTime;
  }

  public reset(sessionStartTime = 0) {
    this.volumeLevels.clear();
    this.totalVolume = 0;
    this.sessionStartTime = sessionStartTime;
    this.tpoPriceLevels.clear();
    this.brackets = [];
    this.ibHigh = -Infinity;
    this.ibLow = Infinity;
  }

  private normalizePrice(price: number): number {
    return normalizeToTick(price, this.tickSize);
  }

  public processTick(tick: Tick) {
    const normPrice = this.normalizePrice(tick.price);

    // 1. Update Volume Profile
    let lvl = this.volumeLevels.get(normPrice);
    if (!lvl) {
      lvl = { buyVol: 0, sellVol: 0, unknownVol: 0 };
      this.volumeLevels.set(normPrice, lvl);
    }

    const side = classifyAggressorSide(tick);
    if (side === 'buy') {
      lvl.buyVol += tick.size;
    } else if (side === 'sell') {
      lvl.sellVol += tick.size;
    } else {
      lvl.unknownVol = (lvl.unknownVol || 0) + tick.size;
    }
    this.totalVolume += tick.size;

    // 2. Update TPO
    if (this.sessionStartTime === 0 || (this.totalVolume <= tick.size && tick.timestamp < this.sessionStartTime)) {
      this.sessionStartTime = tick.timestamp;
    }
    const elapsed = tick.timestamp - this.sessionStartTime;
    const bracketIndex = Math.floor(Math.max(0, elapsed) / this.tpoBracketDurationMs);
    const letter = this.tpoLetters[bracketIndex % this.tpoLetters.length] || 'Z';

    // Track brackets
    while (this.brackets.length <= bracketIndex) {
      const bIdx = this.brackets.length;
      const bLetter = this.tpoLetters[bIdx % this.tpoLetters.length] || 'Z';
      const bStart = this.sessionStartTime + bIdx * this.tpoBracketDurationMs;
      this.brackets.push({
        letter: bLetter,
        timeStart: bStart,
        timeEnd: bStart + this.tpoBracketDurationMs,
        prices: [],
      });
    }
    if (!this.brackets[bracketIndex].prices.includes(normPrice)) {
      this.brackets[bracketIndex].prices.push(normPrice);
    }

    // Track Initial Balance (first two brackets A & B = 1 hour)
    if (bracketIndex < 2) {
      if (normPrice > this.ibHigh) this.ibHigh = normPrice;
      if (normPrice < this.ibLow) this.ibLow = normPrice;
    }

    let letterSet = this.tpoPriceLevels.get(normPrice);
    if (!letterSet) {
      letterSet = new Set<string>();
      this.tpoPriceLevels.set(normPrice, letterSet);
    }
    letterSet.add(letter);
  }

  public getVolumeProfile(): VolumeProfileData {
    if (this.volumeLevels.size === 0) {
      return { poc: 0, vah: 0, val: 0, totalVolume: 0, levels: [] };
    }

    const sortedPrices = Array.from(this.volumeLevels.keys()).sort((a, b) => a - b);
    const levels: VolumeProfileLevel[] = [];
    let poc = sortedPrices[0];
    let maxVol = 0;

    for (const price of sortedPrices) {
      const data = this.volumeLevels.get(price)!;
      const vol = data.buyVol + data.sellVol + (data.unknownVol || 0);
      const delta = data.buyVol - data.sellVol;
      levels.push({
        price,
        volume: vol,
        buyVolume: data.buyVol,
        sellVolume: data.sellVol,
        delta,
      });

      if (vol > maxVol) {
        maxVol = vol;
        poc = price;
      }
    }

    // Calculate Value Area (70% standard)
    const targetVolume = this.totalVolume * 0.7;
    let accumulatedVolume = maxVol;
    let pocIndex = sortedPrices.indexOf(poc);
    let upperIdx = pocIndex + 1;
    let lowerIdx = pocIndex - 1;

    while (accumulatedVolume < targetVolume && (upperIdx < sortedPrices.length || lowerIdx >= 0)) {
      const upperVol1 = upperIdx < sortedPrices.length ? levels[upperIdx].volume : 0;
      const upperVol2 = upperIdx + 1 < sortedPrices.length ? levels[upperIdx + 1].volume : 0;
      const lowerVol1 = lowerIdx >= 0 ? levels[lowerIdx].volume : 0;
      const lowerVol2 = lowerIdx - 1 >= 0 ? levels[lowerIdx - 1].volume : 0;

      const upperSum = upperVol1 + upperVol2;
      const lowerSum = lowerVol1 + lowerVol2;

      if (upperSum >= lowerSum && upperIdx < sortedPrices.length) {
        accumulatedVolume += upperVol1 + (upperIdx + 1 < sortedPrices.length ? upperVol2 : 0);
        upperIdx += 2;
      } else if (lowerIdx >= 0) {
        accumulatedVolume += lowerVol1 + (lowerIdx - 1 >= 0 ? lowerVol2 : 0);
        lowerIdx -= 2;
      } else if (upperIdx < sortedPrices.length) {
        accumulatedVolume += upperVol1;
        upperIdx++;
      } else {
        break;
      }
    }

    const vah = sortedPrices[Math.min(sortedPrices.length - 1, Math.max(0, upperIdx - 1))];
    const val = sortedPrices[Math.max(0, Math.min(sortedPrices.length - 1, lowerIdx + 1))];

    return {
      poc,
      vah: Math.max(poc, vah),
      val: Math.min(poc, val),
      totalVolume: this.totalVolume,
      levels,
    };
  }

  public getTPOProfile(): TPOProfileData {
    if (this.tpoPriceLevels.size === 0) {
      return {
        poc: 0,
        vah: 0,
        val: 0,
        initialBalance: { high: 0, low: 0 },
        brackets: [],
        priceLevels: {},
      };
    }

    const priceLevelsRecord: Record<number, string[]> = {};
    let poc = 0;
    let maxLetters = 0;

    const sortedPrices = Array.from(this.tpoPriceLevels.keys()).sort((a, b) => a - b);

    for (const price of sortedPrices) {
      const letters = Array.from(this.tpoPriceLevels.get(price)!).sort();
      priceLevelsRecord[price] = letters;

      if (letters.length > maxLetters) {
        maxLetters = letters.length;
        poc = price;
      }
    }

    // TPO Value Area (70% of total TPO count)
    let totalTpos = 0;
    for (const letters of Object.values(priceLevelsRecord)) {
      totalTpos += letters.length;
    }

    const targetTpos = totalTpos * 0.7;
    let accumulatedTpos = maxLetters;
    let pocIdx = sortedPrices.indexOf(poc);
    let upperIdx = pocIdx + 1;
    let lowerIdx = pocIdx - 1;

    while (accumulatedTpos < targetTpos && (upperIdx < sortedPrices.length || lowerIdx >= 0)) {
      const upperTpos = upperIdx < sortedPrices.length ? (priceLevelsRecord[sortedPrices[upperIdx]]?.length || 0) : 0;
      const lowerTpos = lowerIdx >= 0 ? (priceLevelsRecord[sortedPrices[lowerIdx]]?.length || 0) : 0;

      if (upperTpos >= lowerTpos && upperIdx < sortedPrices.length) {
        accumulatedTpos += upperTpos;
        upperIdx++;
      } else if (lowerIdx >= 0) {
        accumulatedTpos += lowerTpos;
        lowerIdx--;
      } else {
        break;
      }
    }

    const vah = sortedPrices[Math.min(sortedPrices.length - 1, Math.max(0, upperIdx - 1))];
    const val = sortedPrices[Math.max(0, Math.min(sortedPrices.length - 1, lowerIdx + 1))];

    return {
      poc,
      vah: Math.max(poc, vah),
      val: Math.min(poc, val),
      initialBalance: {
        high: this.ibHigh === -Infinity ? poc : this.ibHigh,
        low: this.ibLow === Infinity ? poc : this.ibLow,
      },
      brackets: this.brackets,
      priceLevels: priceLevelsRecord,
    };
  }
}
