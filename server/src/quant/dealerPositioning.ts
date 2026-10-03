/**
 * Dealer positioning: aggregates charm/vanna into a market impact model.
 * Pure helpers — no I/O.
 */
import type { ExposureSnapshot } from '../options/exposure.js';

export interface MarketImpactModel {
  underlying: string;
  spot: number;
  timestamp: number;
  /** Share of total GEX from charm/vanna (helps gauge dealer hedging horizon). */
  charmShare: number;
  vannaShare: number;
  gammaImpact: 'AMPLIFIED' | 'DAMPENED' | 'NEUTRAL';
  deltaHedgePressure: 'BUY' | 'SELL' | 'NEUTRAL';
  vannaCharmEffect: 'SUPPORTIVE' | 'RESISTIVE' | 'NEUTRAL';
  totals: ExposureSnapshot['totals'];
}

export function buildMarketImpact(snapshot: ExposureSnapshot): MarketImpactModel {
  const gex = snapshot.totals.gex || 0;
  const charm = (snapshot.totals as any).charm ?? 0;
  const vanna = (snapshot.totals as any).vanna ?? 0;
  const dex = snapshot.totals.dex || 0;
  const denom = Math.abs(gex) || 1;
  const charmShare = charm / denom;
  const vannaShare = vanna / denom;

  const gammaImpact: MarketImpactModel['gammaImpact'] =
    Math.abs(gex) > 5_000 ? 'AMPLIFIED' : Math.abs(gex) < 500 ? 'DAMPENED' : 'NEUTRAL';

  const deltaHedgePressure: MarketImpactModel['deltaHedgePressure'] =
    dex > 1_000 ? 'BUY' : dex < -1_000 ? 'SELL' : 'NEUTRAL';

  let vannaCharmEffect: MarketImpactModel['vannaCharmEffect'] = 'NEUTRAL';
  // Close to gamma flip, charm/vanna dominate hedging flow
  if (snapshot.gammaFlip != null && Math.abs(snapshot.spot - snapshot.gammaFlip) / snapshot.spot < 0.01) {
    if (charm > 0 || vanna > 0) vannaCharmEffect = 'SUPPORTIVE';
    else if (charm < 0 || vanna < 0) vannaCharmEffect = 'RESISTIVE';
  }

  return {
    underlying: snapshot.underlying,
    spot: snapshot.spot,
    timestamp: snapshot.timestamp,
    charmShare, vannaShare,
    gammaImpact, deltaHedgePressure, vannaCharmEffect,
    totals: snapshot.totals,
  };
}
