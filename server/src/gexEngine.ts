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
   * 'SIMULATED'     = synthetic dealer-gamma model (fallback, no external data)
   * 'CBOE_DELAYED'  = computed from CBOE's free delayed option chain (real gamma + OI)
   * 'LIVE'          = reserved for a licensed real-time options feed
   */
  dataSource: 'SIMULATED' | 'LIVE' | 'CBOE_DELAYED';
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
  /** 'SIMULATED' = synthetic tape, not a live options-flow provider. */
  source: 'SIMULATED' | 'LIVE';
}

export class GEXEngine {
  private currentProfiles: Map<string, GEXProfile> = new Map();
  private recentFlow: OptionsFlowTrade[] = [];

  constructor() {
    // Generate initial GEX profiles for major index underlyings
    this.generateGexProfile('SPX', 5860.0);
    this.generateGexProfile('SPY', 585.0);
    this.generateGexProfile('NDX', 20550.0);
    this.generateGexProfile('QQQ', 495.0);

    // Seed realistic whale option sweeps
    this.seedInitialFlow();
  }

  public generateGexProfile(underlying: string, spotPrice: number): GEXProfile {
    const strikeInterval = underlying === 'SPX' || underlying === 'NDX' ? 10 : 1;
    const strikeRange = 30; // 30 strikes up and down
    const centerStrike = Math.round(spotPrice / strikeInterval) * strikeInterval;

    const levels: GEXStrikeLevel[] = [];
    let maxCallGex = 0;
    let callWall = centerStrike + strikeInterval * 5;
    let maxPutGex = 0;
    let putWall = centerStrike - strikeInterval * 5;
    let totalNetGex = 0;
    let total0DteGex = 0;

    for (let i = -strikeRange; i <= strikeRange; i++) {
      const strike = centerStrike + i * strikeInterval;
      const distFromSpot = (strike - spotPrice) / spotPrice;

      // Realistic Gamma Distribution (Gaussian bell-curve peaking near ATM with skew)
      const gammaWeight = Math.exp(-Math.pow(distFromSpot * 25, 2));

      // Call GEX higher above spot
      const callWeight = distFromSpot >= -0.01 ? gammaWeight * (1 + distFromSpot * 5) : gammaWeight * 0.4;
      const callGex = Math.round(callWeight * (80 + Math.random() * 40) * 10) / 10;

      // Put GEX higher below spot (Dealer short puts -> negative gamma)
      const putWeight = distFromSpot <= 0.01 ? gammaWeight * (1 - distFromSpot * 5) : gammaWeight * 0.4;
      const putGex = -Math.round(putWeight * (90 + Math.random() * 45) * 10) / 10;

      const netGex = Math.round((callGex + putGex) * 10) / 10;
      const zeroDteGex = Math.round((netGex * (0.35 + Math.random() * 0.2)) * 10) / 10;

      const callOI = Math.round(callGex * 150 + 500);
      const putOI = Math.round(Math.abs(putGex) * 160 + 600);

      levels.push({
        strike,
        callGex,
        putGex,
        netGex,
        zeroDteGex,
        callOI,
        putOI,
        callVol: Math.round(callOI * 0.2),
        putVol: Math.round(putOI * 0.2),
      });

      if (callGex > maxCallGex) {
        maxCallGex = callGex;
        callWall = strike;
      }
      if (Math.abs(putGex) > maxPutGex) {
        maxPutGex = Math.abs(putGex);
        putWall = strike;
      }

      totalNetGex += netGex;
      total0DteGex += zeroDteGex;
    }

    // Zero Gamma Flip Point: where cumulative gamma flips from negative to positive
    let zeroGammaFlip = centerStrike;
    for (let i = 0; i < levels.length - 1; i++) {
      if (levels[i].netGex <= 0 && levels[i + 1].netGex > 0) {
        zeroGammaFlip = levels[i].strike;
        break;
      }
    }

    const regime = totalNetGex >= 0 ? 'POSITIVE_GAMMA' : 'NEGATIVE_GAMMA';

    const profile: GEXProfile = {
      underlying,
      spotPrice,
      callWall,
      putWall,
      zeroGammaFlip,
      totalNetGex: Math.round(totalNetGex * 10) / 10,
      total0DteGex: Math.round(total0DteGex * 10) / 10,
      regime,
      levels,
      timestamp: Date.now(),
      dataSource: 'SIMULATED',
    };

    this.currentProfiles.set(underlying, profile);
    return profile;
  }

  /**
   * Build a GEX profile from a REAL option chain (CBOE delayed quotes).
   *
   * Standard dealer-gamma convention: dealers are assumed long call gamma and short put
   * gamma, so net GEX = Σ(call gamma·OI) − Σ(put gamma·OI), converted to dollars per 1%
   * underlying move via:  gamma × OI × 100 (contract multiplier) × spot² × 0.01
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

    let callWall = usedStrikes[0] ?? spotPrice;
    let putWall = callWall;
    let maxCallGex = -Infinity;
    let maxPutGex = -Infinity;
    let totalNetGex = 0;
    let total0DteGex = 0;

    for (const level of levels) {
      if (level.callGex > maxCallGex) {
        maxCallGex = level.callGex;
        callWall = level.strike;
      }
      if (-level.putGex > maxPutGex) {
        maxPutGex = -level.putGex;
        putWall = level.strike;
      }
      totalNetGex += level.netGex;
      total0DteGex += level.zeroDteGex;
    }

    // Zero-gamma flip: the strike where cumulative dealer gamma changes sign.
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

  /**
   * Re-generate every tracked profile around a small random walk of its spot price.
   * Called on a timer so GEX walls/flip stay "alive" instead of freezing at boot values.
   */
  public refreshAll(): GEXProfile[] {
    const updated: GEXProfile[] = [];
    for (const [underlying, profile] of this.currentProfiles.entries()) {
      const drift = (Math.random() - 0.5) * 0.002; // +/- 10 bps per refresh
      const nextSpot = Math.round(profile.spotPrice * (1 + drift) * 100) / 100;
      updated.push(this.generateGexProfile(underlying, nextSpot));
    }
    return updated;
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

  private seedInitialFlow() {
    const now = Date.now();
    this.recentFlow = [
      {
        id: 'flow_1',
        timestamp: now - 1000 * 45,
        underlying: 'SPX',
        contractType: 'CALL',
        strike: 5880,
        expiration: '0DTE',
        dte: 0,
        orderType: 'SWEEP',
        sentiment: 'BULLISH',
        size: 250,
        price: 8.4,
        premiumUsd: 210000,
        spotPrice: 5860.5,
        source: 'SIMULATED',
      },
      {
        id: 'flow_2',
        timestamp: now - 1000 * 120,
        underlying: 'SPY',
        contractType: 'PUT',
        strike: 580,
        expiration: '2DTE',
        dte: 2,
        orderType: 'BLOCK',
        sentiment: 'BEARISH',
        size: 5000,
        price: 1.85,
        premiumUsd: 925000,
        spotPrice: 585.2,
        source: 'SIMULATED',
      },
      {
        id: 'flow_3',
        timestamp: now - 1000 * 240,
        underlying: 'QQQ',
        contractType: 'CALL',
        strike: 500,
        expiration: '0DTE',
        dte: 0,
        orderType: 'SWEEP',
        sentiment: 'BULLISH',
        size: 3200,
        price: 1.15,
        premiumUsd: 368000,
        spotPrice: 495.4,
        source: 'SIMULATED',
      },
      {
        id: 'flow_4',
        timestamp: now - 1000 * 400,
        underlying: 'SPX',
        contractType: 'PUT',
        strike: 5820,
        expiration: '0DTE',
        dte: 0,
        orderType: 'SWEEP',
        sentiment: 'BEARISH',
        size: 400,
        price: 12.2,
        premiumUsd: 488000,
        spotPrice: 5861.0,
        source: 'SIMULATED',
      },
    ];
  }
}
