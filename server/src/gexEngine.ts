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
  /** 'SIMULATED' = synthetic dealer gamma model, not a live OPRA/OI feed. */
  dataSource: 'SIMULATED' | 'LIVE';
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
