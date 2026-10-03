/**
 * Black-Scholes pricing and Greeks (European, no dividends).
 * Pure math — no I/O. All helpers fail-closed (null on invalid).
 */

function normPdf(x: number): number {
  return Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI);
}

// Abramowitz-Stegun 7.1.26, error < 7.5e-8
function normCdf(x: number): number {
  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const p = 0.3275911;
  const sign = x < 0 ? -1 : 1;
  const absX = Math.abs(x) / Math.SQRT2;
  const t = 1 / (1 + p * absX);
  const y = 1 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-absX * absX);
  return 0.5 * (1 + sign * y);
}

export interface BsInputs {
  S: number; K: number; T: number; r: number; sigma: number; type: 'call' | 'put';
}
export interface Greeks {
  delta: number; gamma: number; theta: number; vega: number; rho: number;
  /** Charm = dDelta/dT (per day), Vanna = dVega/dSpot — used for dealer positioning. */
  charm?: number; vanna?: number;
}

function d1d2({ S, K, T, r, sigma }: BsInputs): { d1: number; d2: number } | null {
  if (!Number.isFinite(S) || !Number.isFinite(K) || !Number.isFinite(T) || !Number.isFinite(r) || !Number.isFinite(sigma)) return null;
  if (S <= 0 || K <= 0 || T <= 0 || sigma <= 0) return null;
  const sqrtT = Math.sqrt(T);
  const d1 = (Math.log(S / K) + (r + 0.5 * sigma * sigma) * T) / (sigma * sqrtT);
  const d2 = d1 - sigma * sqrtT;
  if (!Number.isFinite(d1) || !Number.isFinite(d2)) return null;
  return { d1, d2 };
}

export function bsPrice(inputs: BsInputs): number | null {
  const dd = d1d2(inputs);
  if (!dd) return null;
  const { S, K, T, r, type } = inputs;
  const { d1, d2 } = dd;
  const df = Math.exp(-r * T);
  if (type === 'call') return S * normCdf(d1) - K * df * normCdf(d2);
  return K * df * normCdf(-d2) - S * normCdf(-d1);
}

export function bsGreeks(inputs: BsInputs): Greeks | null {
  const dd = d1d2(inputs);
  if (!dd) return null;
  const { S, K, T, r, sigma, type } = inputs;
  const { d1, d2 } = dd;
  const sqrtT = Math.sqrt(T);
  const pdf = normPdf(d1);
  const df = Math.exp(-r * T);
  const gamma = pdf / (S * sigma * sqrtT);
  const vega = (S * pdf * sqrtT) / 100; // per 1% vol
  let delta: number;
  let rho: number;
  let theta: number;
  if (type === 'call') {
    delta = normCdf(d1);
    rho = (K * T * df * normCdf(d2)) / 100;
    theta = (-(S * pdf * sigma) / (2 * sqrtT) - r * K * df * normCdf(d2)) / 365;
  } else {
    delta = normCdf(d1) - 1;
    rho = (-K * T * df * normCdf(-d2)) / 100;
    theta = (-(S * pdf * sigma) / (2 * sqrtT) + r * K * df * normCdf(-d2)) / 365;
  }
  if (![delta, gamma, theta, vega, rho].every(Number.isFinite)) return null;
  // Higher-order Greeks for dealer positioning (no dividends, q=0).
  let charm: number | undefined;
  let vanna: number | undefined;
  try {
    const vannaRaw = -pdf * d2 / sigma;
    if (Number.isFinite(vannaRaw)) vanna = vannaRaw / 100; // per 1% vol like vega
    const denom = 2 * T * sigma * sqrtT;
    if (denom !== 0 && Number.isFinite(denom)) {
      const charmYearCall = -pdf * (2 * r * T - d2 * sigma * sqrtT) / denom;
      const charmYear = type === 'call' ? charmYearCall : -charmYearCall;
      if (Number.isFinite(charmYear)) charm = charmYear / 365; // per day like theta
    }
  } catch { /* charm/vanna optional — core greeks already validated */ }
  return { delta, gamma, theta, vega, rho, charm, vanna };
}

export { normCdf, normPdf, d1d2 };
