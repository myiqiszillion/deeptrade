export interface GEXStrikeLevel {
  strike: number;
  callGex: number; // Millions USD per 1% move
  putGex: number;
  netGex: number;
  zeroDteGex: number;
  callOI: number;
  putOI: number;
  callVol: number;
  putVol: number;
}

export interface GEXProfile {
  underlying: string; // SPX, SPY, NDX, QQQ
  spotPrice: number;
  callWall: number;
  putWall: number;
  zeroGammaFlip: number;
  totalNetGex: number; // in Millions USD
  total0DteGex: number;
  regime: 'POSITIVE_GAMMA' | 'NEGATIVE_GAMMA';
  levels: GEXStrikeLevel[];
  timestamp: number;
  /**
   * 'CBOE_DELAYED' = computed from CBOE's free delayed option chain (real gamma + OI)
   * 'LIVE'         = reserved for a licensed real-time options feed
   * DeepChart never substitutes a synthetic gamma model.
   */
  dataSource: 'CBOE_DELAYED' | 'LIVE';
}

export interface OptionsFlowTrade {
  id: string;
  timestamp: number;
  underlying: string;
  contractType: 'CALL' | 'PUT';
  strike: number;
  expiration: string;
  dte: number;
  orderType: 'SWEEP' | 'BLOCK';
  sentiment: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
  size: number;
  price: number;
  premiumUsd: number;
  spotPrice: number;
  /** Only real providers may publish flow; DeepChart ships no synthetic tape. */
  source: 'LIVE';
}

export class GEXEngine {
  private currentProfiles: Map<string, GEXProfile> = new Map();
  private recentFlow: OptionsFlowTrade[] = [];

  constructor() {
    // Profiles are created exclusively from a real option chain via buildFromChain().
    // DeepChart ships no fabricated GEX: when the chain is unreachable the panel reports
    // "no data" instead of inventing walls.
  }


  /**
   * Build a GEX profile from a REAL option chain (CBOE delayed quotes).
   *
   * Standard dealer-gamma convention: dealers are assumed long call gamma and short put
   * gamma, so net GEX = Sigma(call gamma * OI) - Sigma(put gamma * OI), converted to dollars per 1%
   * underlying move via: gamma * OI * 100 (contract multiplier) * spot^2 * 0.01
   * Values are expressed in millions to match the units the UI already renders.
   */
  public buildFromChain(
    underlying: string,
    spotPrice: number,
    rows: { strike: number; type: 'CALL' | 'PUT'; gamma: number; openInterest: number; volume: number; dte: number }[],
    dataSource: GEXProfile['dataSource'] = 'CBOE_DELAYED'
  ): GEXProfile {
    const CONTRACT_MULTIPLIER = 100;
    const MILLIONS = 1_000_000;
    const round1 = (n: number) => Math.round(n * 10) / 10;

    interface Bucket {
      callGex: number;
      putGex: number;
      callOI: number;
      putOI: number;
      callVol: number;
      putVol: number;
      zeroDte: number;
    }

    const buckets = new Map<number, Bucket>();
    for (const row of rows) {
      if (!Number.isFinite(row.gamma) || !Number.isFinite(row.openInterest) || row.openInterest <= 0) continue;
      const gexUsd = row.gamma * row.openInterest * CONTRACT_MULTIPLIER * spotPrice * spotPrice * 0.01;
      const bucket =
        buckets.get(row.strike) ?? { callGex: 0, putGex: 0, callOI: 0, putOI: 0, callVol: 0, putVol: 0, zeroDte: 0 };

      if (row.type === 'CALL') {
        bucket.callGex += gexUsd;
        bucket.callOI += row.openInterest;
        bucket.callVol += row.volume;
      } else {
        bucket.putGex += gexUsd;
        bucket.putOI += row.openInterest;
        bucket.putVol += row.volume;
      }
      if (row.dte === 0) bucket.zeroDte += row.type === 'CALL' ? gexUsd : -gexUsd;

      buckets.set(row.strike, bucket);
    }

    // Keep a readable strike window around spot: the panel renders one row per strike and
    // a 400-strike ladder would be unusable.
    const allStrikes = [...buckets.keys()].sort((a, b) => a - b);
    const nearStrikes = allStrikes.filter((s) => Math.abs(s - spotPrice) / spotPrice <= 0.05);
    const usedStrikes = nearStrikes.length >= 10 ? nearStrikes : allStrikes.slice(0, 80);

    const levels: GEXStrikeLevel[] = usedStrikes.map((strike) => {
      const bucket = buckets.get(strike)!;
      const callGex = bucket.callGex / MILLIONS;
      const putGex = -bucket.putGex / MILLIONS;
      return {
        strike,
        callGex: round1(callGex),
        putGex: round1(putGex),
        netGex: round1(callGex + putGex),
        zeroDteGex: round1(bucket.zeroDte / MILLIONS),
        callOI: bucket.callOI,
        putOI: bucket.putOI,
        callVol: bucket.callVol,
        putVol: bucket.putVol,
      };
    });

    // Compute total chain GEX and walls across ALL strikes in the received chain
    let callWall = allStrikes[0] ?? spotPrice;
    let putWall = callWall;
    let maxCallGex = -Infinity;
    let maxPutGex = -Infinity;
    let totalNetGex = 0;
    let total0DteGex = 0;

    for (const strike of allStrikes) {
      const bucket = buckets.get(strike)!;
      const callGex = bucket.callGex / MILLIONS;
      const putGex = -bucket.putGex / MILLIONS;
      const netGex = callGex + putGex;

      totalNetGex += netGex;
      total0DteGex += bucket.zeroDte / MILLIONS;

      if (callGex > maxCallGex) {
        maxCallGex = callGex;
        callWall = strike;
      }
      if (-putGex > maxPutGex) {
        maxPutGex = -putGex;
        putWall = strike;
      }
    }

    // Zero-gamma flip: strike-level heuristic where cumulative dealer gamma changes sign.
    let cumulative = 0;
    let zeroGammaFlip = spotPrice;
    let flipFound = false;
    for (const level of levels) {
      const previous = cumulative;
      cumulative += level.netGex;
      if (!flipFound && previous < 0 && cumulative >= 0) {
        zeroGammaFlip = level.strike;
        flipFound = true;
      }
    }
    if (!flipFound) {
      for (let i = 1; i < levels.length; i++) {
        if (levels[i - 1].netGex <= 0 && levels[i].netGex > 0) {
          zeroGammaFlip = levels[i].strike;
          break;
        }
      }
    }

    const profile: GEXProfile = {
      underlying,
      spotPrice,
      callWall,
      putWall,
      zeroGammaFlip,
      totalNetGex: round1(totalNetGex),
      total0DteGex: round1(total0DteGex),
      regime: totalNetGex >= 0 ? 'POSITIVE_GAMMA' : 'NEGATIVE_GAMMA',
      levels,
      timestamp: Date.now(),
      dataSource,
    };

    this.currentProfiles.set(underlying, profile);
    return profile;
  }


  public getProfile(underlying: string): GEXProfile | undefined {
    return this.currentProfiles.get(underlying);
  }

  public getAllProfiles(): Record<string, GEXProfile> {
    const result: Record<string, GEXProfile> = {};
    for (const [k, v] of this.currentProfiles.entries()) {
      result[k] = v;
    }
    return result;
  }

  public addFlowTrade(trade: OptionsFlowTrade) {
    this.recentFlow.unshift(trade);
    if (this.recentFlow.length > 100) {
      this.recentFlow.pop();
    }
  }

  public getRecentFlow(): OptionsFlowTrade[] {
    return this.recentFlow;
  }

}
