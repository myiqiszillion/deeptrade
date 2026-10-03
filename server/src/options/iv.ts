/**
 * Implied volatility solver: Newton-Raphson with bisection fallback.
 * Returns null when marketPrice violates arbitrage bounds or inputs invalid.
 */
import { bsPrice, bsGreeks } from './blackScholes.js';

export interface IvResult { iv: number | null; priceUsed: number; iterations: number; converged: boolean }

function intrinsic(S: number, K: number, type: 'call' | 'put'): number {
  return type === 'call' ? Math.max(0, S - K) : Math.max(0, K - S);
}

export function impliedVol(
  marketPrice: number, S: number, K: number, T: number, r: number, type: 'call' | 'put',
  opts: { tol?: number; maxIter?: number; low?: number; high?: number } = {}
): IvResult {
  const tol = opts.tol ?? 1e-4;
  const maxIter = opts.maxIter ?? 100;
  const low = opts.low ?? 0.01;
  const high = opts.high ?? 5.0;

  if (![marketPrice, S, K, T, r].every(Number.isFinite) || marketPrice <= 0 || S <= 0 || K <= 0 || T <= 0) {
    return { iv: null, priceUsed: marketPrice, iterations: 0, converged: false };
  }
  const intr = intrinsic(S, K, type);
  if (marketPrice < intr - 1e-9) return { iv: null, priceUsed: marketPrice, iterations: 0, converged: false };
  // Price cannot exceed S for calls (no dividends) — loose guard
  if (type === 'call' && marketPrice > S) return { iv: null, priceUsed: marketPrice, iterations: 0, converged: false };

  // Newton
  let iv = 0.3;
  for (let i = 0; i < maxIter; i++) {
    const price = bsPrice({ S, K, T, r, sigma: iv, type });
    if (price === null) break;
    const diff = price - marketPrice;
    if (Math.abs(diff) < tol) return { iv, priceUsed: marketPrice, iterations: i + 1, converged: true };
    const greeks = bsGreeks({ S, K, T, r, sigma: iv, type });
    const vega = greeks ? greeks.vega * 100 : 0; // bsGreeks vega is per 1%, need raw
    if (!Number.isFinite(vega) || Math.abs(vega) < 1e-8) break;
    const next = iv - diff / vega;
    if (!Number.isFinite(next) || next <= low || next >= high) break;
    iv = next;
  }

  // Bisection fallback
  let lo = low, hi = high;
  const loPrice = bsPrice({ S, K, T, r, sigma: lo, type });
  const hiPrice = bsPrice({ S, K, T, r, sigma: hi, type });
  if (loPrice === null || hiPrice === null) return { iv: null, priceUsed: marketPrice, iterations: 0, converged: false };
  // Bracket check
  const loDiff = loPrice - marketPrice;
  const hiDiff = hiPrice - marketPrice;
  if (loDiff > 0 || hiDiff < 0) return { iv: null, priceUsed: marketPrice, iterations: 0, converged: false };

  for (let i = 0; i < maxIter; i++) {
    const mid = (lo + hi) / 2;
    const price = bsPrice({ S, K, T, r, sigma: mid, type });
    if (price === null) break;
    const diff = price - marketPrice;
    if (Math.abs(diff) < tol) return { iv: mid, priceUsed: marketPrice, iterations: i + 1, converged: true };
    if (diff > 0) hi = mid; else lo = mid;
  }
  return { iv: null, priceUsed: marketPrice, iterations: maxIter, converged: false };
}

export function midQuotePrice(bid: number | null | undefined, ask: number | null | undefined, last?: number | null): number | null {
  if (Number.isFinite(bid as number) && Number.isFinite(ask as number) && (bid as number) > 0 && (ask as number) > 0) {
    if ((bid as number) > (ask as number)) return null; // crossed
    const mid = ((bid as number) + (ask as number)) / 2;
    const spread = (ask as number) - (bid as number);
    if (spread / mid > 0.5) return null; // too wide
    return mid;
  }
  if (Number.isFinite(last as number) && (last as number) > 0) return last as number;
  return null;
}
