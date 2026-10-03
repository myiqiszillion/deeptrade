/**
 * Exposure aggregation: GEX/DEX/VEX/TEX + Gamma Map (walls/flip/regime).
 * Reuses GEXEngine wall/flip conventions; pure functions where possible.
 */
import { GEXEngine } from '../gexEngine.js';
import type { Greeks } from './blackScholes.js';

export interface PricedContract {
  symbol: string; underlying: string; expiration: string; dte: number;
  type: 'call' | 'put'; strike: number;
  openInterest: number | null;
  iv: number | null;
  greeks: Greeks | null;
}

export interface ExposureLevel {
  strike: number;
  gex: number; dex: number; vex: number; tex: number; notional: number;
  callGex: number; putGex: number;
  callOi: number; putOi: number;
  charm?: number; vanna?: number;
}
export interface ExposureSnapshot {
  underlying: string; spot: number; timestamp: number;
  dataSource: 'DATABENTO_OPRA' | 'CBOE_DELAYED';
  levels: ExposureLevel[];
  totals: { gex: number; dex: number; vex: number; tex: number; notional: number; charm: number; vanna: number };
  walls: { callWall: number; putWall: number };
  gammaFlip: number | null;
  regime: 'POSITIVE_GAMMA' | 'NEGATIVE_GAMMA';
}

const CONTRACT_MULT = 100;
const MILLIONS = 1_000_000;

function round1(n: number) { return Math.round(n * 10) / 10; }

export function buildExposure(
  underlying: string, spot: number, contracts: PricedContract[],
  dataSource: ExposureSnapshot['dataSource'] = 'DATABENTO_OPRA'
): ExposureSnapshot | null {
  if (!Number.isFinite(spot) || spot <= 0 || contracts.length === 0) return null;

  const buckets = new Map<number, { callGex: number; putGex: number; callOi: number; putOi: number; dex: number; vex: number; tex: number; notional: number; charm: number; vanna: number }>();

  for (const c of contracts) {
    if (c.openInterest == null || c.openInterest <= 0 || !c.greeks) continue;
    const { delta, gamma, vega, theta, charm, vanna } = c.greeks;
    if (![delta, gamma, vega, theta].every(Number.isFinite)) continue;
    const oi = c.openInterest;
    const gexUsd = gamma * oi * CONTRACT_MULT * spot * spot * 0.01;
    const dexUsd = delta * oi * CONTRACT_MULT * spot;
    const vexUsd = vega * oi * CONTRACT_MULT;
    const texUsd = theta * oi * CONTRACT_MULT;
    const notional = oi * CONTRACT_MULT * spot;
    const charmUsd = (charm ?? 0) * oi * CONTRACT_MULT * spot;
    const vannaUsd = (vanna ?? 0) * oi * CONTRACT_MULT;
    const b = buckets.get(c.strike) ?? { callGex: 0, putGex: 0, callOi: 0, putOi: 0, dex: 0, vex: 0, tex: 0, notional: 0, charm: 0, vanna: 0 };
    if (c.type === 'call') { b.callGex += gexUsd; b.callOi += oi; } else { b.putGex += gexUsd; b.putOi += oi; }
    b.dex += dexUsd; b.vex += vexUsd; b.tex += texUsd; b.notional += notional;
    b.charm += charmUsd; b.vanna += vannaUsd;
    buckets.set(c.strike, b);
  }

  if (buckets.size === 0) return null;

  const allStrikes = [...buckets.keys()].sort((a, b) => a - b);
  const nearStrikes = allStrikes.filter((s) => Math.abs(s - spot) / spot <= 0.05);
  const usedStrikes = nearStrikes.length >= 10 ? nearStrikes : allStrikes.slice(0, 80);

  const levels: ExposureLevel[] = usedStrikes.map((strike) => {
    const b = buckets.get(strike)!;
    const callGex = b.callGex / MILLIONS;
    const putGex = -b.putGex / MILLIONS;
    return {
      strike,
      callGex: round1(callGex), putGex: round1(putGex),
      gex: round1(callGex + putGex),
      dex: round1(b.dex / MILLIONS), vex: round1(b.vex / MILLIONS), tex: round1(b.tex / MILLIONS),
      notional: round1(b.notional / MILLIONS),
      charm: round1(b.charm / MILLIONS), vanna: round1(b.vanna / MILLIONS),
      callOi: b.callOi, putOi: b.putOi,
    };
  });

  let callWall = allStrikes[0] ?? spot;
  let putWall = callWall;
  let maxCall = -Infinity, maxPut = -Infinity;
  let totalGex = 0, totalDex = 0, totalVex = 0, totalTex = 0, totalNotional = 0, totalCharm = 0, totalVanna = 0;
  for (const s of allStrikes) {
    const b = buckets.get(s)!;
    const cg = b.callGex / MILLIONS, pg = -b.putGex / MILLIONS;
    totalGex += cg + pg; totalDex += b.dex / MILLIONS; totalVex += b.vex / MILLIONS; totalTex += b.tex / MILLIONS; totalNotional += b.notional / MILLIONS;
    totalCharm += b.charm / MILLIONS; totalVanna += b.vanna / MILLIONS;
    if (cg > maxCall) { maxCall = cg; callWall = s; }
    if (-pg > maxPut) { maxPut = -pg; putWall = s; }
  }

  let cumulative = 0, gammaFlip: number | null = null;
  for (const lv of levels) {
    const prev = cumulative; cumulative += lv.gex;
    if (gammaFlip === null && prev < 0 && cumulative >= 0) gammaFlip = lv.strike;
  }
  if (gammaFlip === null) {
    for (let i = 1; i < levels.length; i++) {
      if (levels[i - 1].gex <= 0 && levels[i].gex > 0) { gammaFlip = levels[i].strike; break; }
    }
  }

  return {
    underlying, spot, timestamp: Date.now(), dataSource,
    levels,
    totals: { gex: round1(totalGex), dex: round1(totalDex), vex: round1(totalVex), tex: round1(totalTex), notional: round1(totalNotional), charm: round1(totalCharm), vanna: round1(totalVanna) },
    walls: { callWall, putWall },
    gammaFlip,
    regime: totalGex >= 0 ? 'POSITIVE_GAMMA' : 'NEGATIVE_GAMMA',
  };
}
