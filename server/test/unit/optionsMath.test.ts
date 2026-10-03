import assert from 'node:assert/strict';
import { bsPrice, bsGreeks } from '../../src/options/blackScholes.js';
import { impliedVol } from '../../src/options/iv.js';
import { buildPricedChain } from '../../src/options/chain.js';
import { buildExposure } from '../../src/options/exposure.js';

export async function runOptionsMathTests(): Promise<void> {
  console.log('[unit/optionsMath.test] Running IV/Greeks/Exposure unit tests...');

  // BS parity: call price known ~10.45 for S=100 K=100 T=1 r=0.05 sigma=0.2
  {
    const price = bsPrice({ S: 100, K: 100, T: 1, r: 0.05, sigma: 0.2, type: 'call' });
    assert.ok(price !== null && Math.abs(price - 10.45) < 0.05, `call price ${price} ~10.45`);
    const greeks = bsGreeks({ S: 100, K: 100, T: 1, r: 0.05, sigma: 0.2, type: 'call' });
    assert.ok(greeks !== null && greeks.delta > 0.6 && greeks.delta < 0.65);
    assert.ok(greeks!.gamma > 0);
  }

  // IV round-trip
  {
    const price = bsPrice({ S: 100, K: 100, T: 0.5, r: 0.04, sigma: 0.3, type: 'call' })!;
    const res = impliedVol(price, 100, 100, 0.5, 0.04, 'call');
    assert.ok(res.iv !== null && Math.abs(res.iv - 0.3) < 1e-3, `iv round-trip ${res.iv}`);
  }

  // Invalid inputs -> null
  {
    assert.equal(bsPrice({ S: 0, K: 100, T: 1, r: 0.04, sigma: 0.2, type: 'call' }), null);
    assert.equal(bsGreeks({ S: 100, K: 100, T: 0, r: 0.04, sigma: 0.2, type: 'call' }), null);
    const res = impliedVol(-1, 100, 100, 1, 0.04, 'call');
    assert.equal(res.iv, null);
  }

  // Chain builder with mocked quote
  {
    const defs: any[] = [
      { symbol: 'SPY260320C00500000', underlying: 'SPY', expiration: '2026-03-20', expirationTimestamp: Date.now() + 30 * 864e5, type: 'call', strike: 500, multiplier: 100, dte: 30, instrumentId: 1 },
      { symbol: 'SPY260320P00500000', underlying: 'SPY', expiration: '2026-03-20', expirationTimestamp: Date.now() + 30 * 864e5, type: 'put', strike: 500, multiplier: 100, dte: 30, instrumentId: 2 },
    ];
    const quotes = new Map<string, any>([
      ['SPY260320C00500000', { bidPrice: 5, askPrice: 5.5, lastPrice: 5.2 }],
      ['SPY260320P00500000', { bidPrice: 4, askPrice: 4.6, lastPrice: 4.3 }],
    ]);
    const stats = new Map<string, any>([
      ['SPY260320C00500000', { openInterest: 1000 }],
      ['SPY260320P00500000', { openInterest: 1200 }],
    ]);
    const priced = buildPricedChain({ underlying: 'SPY', spot: 505, definitions: defs as any, quotes: quotes as any, statistics: stats as any, riskFreeRate: 0.04 });
    assert.equal(priced.length, 2);
    // At least one should have iv (mid ~5.25 for ~ATM)
    assert.ok(priced.some(p => p.iv !== null), 'at least one IV computed');
  }

  // Exposure aggregation
  {
    const defs: any[] = [
      { symbol: 'SPY260320C00500000', underlying: 'SPY', expiration: '2026-03-20', type: 'call', strike: 500, dte: 30 },
      { symbol: 'SPY260320P00500000', underlying: 'SPY', expiration: '2026-03-20', type: 'put', strike: 500, dte: 30 },
    ];
    const quotes = new Map<string, any>([
      ['SPY260320C00500000', { bidPrice: 8, askPrice: 8.5 }],
      ['SPY260320P00500000', { bidPrice: 6, askPrice: 6.5 }],
    ]);
    const stats = new Map<string, any>([
      ['SPY260320C00500000', { openInterest: 5000 }],
      ['SPY260320P00500000', { openInterest: 5000 }],
    ]);
    const priced = buildPricedChain({ underlying: 'SPY', spot: 502, definitions: defs as any, quotes: quotes as any, statistics: stats as any, riskFreeRate: 0.04 });
    const snap = buildExposure('SPY', 502, priced, 'DATABENTO_OPRA');
    if (snap) {
      assert.ok(Number.isFinite(snap.totals.gex));
      assert.ok(snap.levels.length > 0);
      assert.ok(snap.walls.callWall > 0);
    }
  }

  console.log('  [PASS] All IV/Greeks/Exposure unit tests passed.');
}
