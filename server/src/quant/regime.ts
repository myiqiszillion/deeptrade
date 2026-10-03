/** Regime helpers — pure, no I/O. */
export type GammaRegime = 'POSITIVE_GAMMA' | 'NEGATIVE_GAMMA';
export type VolRegime = 'LOW' | 'NORMAL' | 'ELEVATED' | 'SPIKE';
export type FlowRegime = 'BULLISH' | 'BEARISH' | 'NEUTRAL';

export function gammaRegime(totalGex: number): GammaRegime {
  return totalGex >= 0 ? 'POSITIVE_GAMMA' : 'NEGATIVE_GAMMA';
}

export function volRegime(iv: number, median20d: number | null): VolRegime {
  if (!Number.isFinite(iv) || iv <= 0) return 'NORMAL';
  if (median20d == null || !Number.isFinite(median20d) || median20d <= 0) {
    if (iv > 0.35) return 'SPIKE';
    if (iv > 0.25) return 'ELEVATED';
    if (iv < 0.13) return 'LOW';
    return 'NORMAL';
  }
  const ratio = iv / median20d;
  if (ratio >= 1.6) return 'SPIKE';
  if (ratio >= 1.25) return 'ELEVATED';
  if (ratio <= 0.75) return 'LOW';
  return 'NORMAL';
}

export function flowRegime(netPremium: number, thresholdUsd = 1e6): FlowRegime {
  if (netPremium > thresholdUsd) return 'BULLISH';
  if (netPremium < -thresholdUsd) return 'BEARISH';
  return 'NEUTRAL';
}

export function skewSignal(callIv: number, putIv: number): number {
  if (!Number.isFinite(callIv) || !Number.isFinite(putIv) || callIv <= 0) return 0;
  return (putIv - callIv) / callIv;
}
