import assert from 'node:assert/strict';
import { FootprintEngine } from '../../src/footprintEngine.js';
import { ChartService } from '../../src/chart/chartService.js';
import { marketDataStore } from '../../src/storage/marketDataStore.js';
import { DatabentoHttpClient } from '../../src/databento/client.js';
import { bsGreeks } from '../../src/options/blackScholes.js';
import { buildPricedChain } from '../../src/options/chain.js';
import { GEXEngine } from '../../src/gexEngine.js';
import { Tick } from '../../src/types.js';

export async function runBehavioralContractTests(): Promise<void> {
  console.log('[integration/behavioral_contracts.test] Running behavioral & data integrity tests...');

  // =========================================================================
  // GROUP A: Footprint Aggregation & Arithmetic Invariants
  // =========================================================================
  console.log('  Testing Group A: Footprint Aggregation & Arithmetic...');
  {
    const engine = new FootprintEngine(0.25, 60000); // 1m bar, 0.25 tick size
    const baseTime = 1700000000000;

    // Controlled tick fixtures
    const fixtureTicks: Tick[] = [
      { id: '1', timestamp: baseTime + 1000, price: 5000.25, size: 4, side: 'buy', receiveTs: baseTime + 1002 },
      { id: '2', timestamp: baseTime + 2000, price: 5000.25, size: 2, side: 'sell', receiveTs: baseTime + 2002 },
      { id: '3', timestamp: baseTime + 3000, price: 5000.50, size: 3, side: 'buy', receiveTs: baseTime + 3002 },
      { id: '4', timestamp: baseTime + 4000, price: 5000.50, size: 5, side: 'sell', receiveTs: baseTime + 4002 },
      { id: '5', timestamp: baseTime + 5000, price: 5000.75, size: 1, side: 'buy', receiveTs: baseTime + 5002 },
    ];

    let currentBar = null;
    for (const t of fixtureTicks) {
      currentBar = engine.processTick(t).currentBar;
    }

    assert.ok(currentBar, 'Engine must produce FootprintBar');
    assert.equal(currentBar.open, 5000.25, 'Open price matches first tick');
    assert.equal(currentBar.high, 5000.75, 'High price matches peak tick');
    assert.equal(currentBar.low, 5000.25, 'Low price matches lowest tick');
    assert.equal(currentBar.close, 5000.75, 'Close price matches last tick');
    assert.equal(currentBar.volume, 4 + 2 + 3 + 5 + 1, 'Total bar volume is exact sum (15)');

    // Delta calculation: buys - sells
    // buys = 4 (at 5000.25) + 3 (at 5000.50) + 1 (at 5000.75) = 8
    // sells = 2 (at 5000.25) + 5 (at 5000.50) = 7
    // net delta = 8 - 7 = 1
    assert.equal(currentBar.delta, 1, 'Net bar delta must equal total buy vol - total sell vol (+1)');

    // Price-level footprint ladder validation
    const lvl25 = currentBar.levels[5000.25];
    const lvl50 = currentBar.levels[5000.50];
    const lvl75 = currentBar.levels[5000.75];

    assert.ok(lvl25, 'Level 5000.25 exists in footprint');
    assert.equal(lvl25.bidVol, 2, '5000.25 bid (sell market) volume is 2');
    assert.equal(lvl25.askVol, 4, '5000.25 ask (buy market) volume is 4');
    assert.equal(lvl25.totalVol, 6, '5000.25 total volume is 6');

    assert.ok(lvl50, 'Level 5000.50 exists in footprint');
    assert.equal(lvl50.bidVol, 5, '5000.50 bid volume is 5');
    assert.equal(lvl50.askVol, 3, '5000.50 ask volume is 3');
    assert.equal(lvl50.totalVol, 8, '5000.50 total volume is 8');

    assert.ok(lvl75, 'Level 5000.75 exists in footprint');
    assert.equal(lvl75.bidVol, 0, '5000.75 bid volume is 0');
    assert.equal(lvl75.askVol, 1, '5000.75 ask volume is 1');

    // POC must be the level with highest total volume (5000.50 has 8 vs 6 vs 1)
    assert.equal(currentBar.poc, 5000.50, 'POC must be 5000.50 (highest volume level)');
    console.log('    [PASS] Group A: Footprint Aggregation & Arithmetic valid.');
  }

  // =========================================================================
  // GROUP B: Volume Profile API & Zero-Inference Integrity
  // =========================================================================
  console.log('  Testing Group B: Volume Profile & Fail-Closed Queries...');
  {
    const client = new DatabentoHttpClient({ apiKey: '' });
    const chartService = new ChartService(client);

    // Case 1: Empty database must return unavailable status without fabricating profiles
    const emptyResult = await chartService.getVolumeProfileRange('ES', 1500000000000, 1500001000000);
    assert.equal(emptyResult.available, false, 'Empty data must report available: false');
    assert.equal(emptyResult.status, 'unavailable', 'Status must be unavailable');
    assert.equal(emptyResult.totalVolume, 0, 'Total volume must be 0');
    assert.equal(emptyResult.levels.length, 0, 'Levels array must be empty');

    // Case 2: Ingest real trade records into SQLite and query range
    const t0 = 1700000100000;
    const testTrades: Tick[] = [
      { id: 'b1', timestamp: t0, price: 5000.00, size: 10, side: 'buy' },
      { id: 'b2', timestamp: t0 + 1000, price: 5000.25, size: 50, side: 'sell' },
      { id: 'b3', timestamp: t0 + 2000, price: 5000.50, size: 20, side: 'buy' },
    ];
    marketDataStore.saveTrades(testTrades, 'ES', 'databento');

    const rangeResult = await chartService.getVolumeProfileRange('ES', t0 - 500, t0 + 5000);
    assert.equal(rangeResult.available, true, 'Range with trades must be available');
    assert.equal(rangeResult.status, 'ok', 'Status must be ok');
    assert.equal(rangeResult.totalVolume, 80, 'Total volume must equal 10 + 50 + 20 = 80');
    assert.equal(rangeResult.poc, 5000.25, 'POC must be 5000.25 (volume 50)');

    // Value Area: 70% of 80 is 56. The POC alone has 50, so VAH/VAL encompass the primary volume distribution
    assert.ok(rangeResult.vah >= rangeResult.val, 'VAH must be >= VAL');
    assert.ok(rangeResult.vah >= rangeResult.poc, 'VAH must be >= POC');
    assert.ok(rangeResult.val <= rangeResult.poc, 'VAL must be <= POC');

    // Case 3: Out of boundary timestamp range
    const outResult = await chartService.getVolumeProfileRange('ES', t0 + 500000, t0 + 600000);
    assert.equal(outResult.available, false, 'Non-matching range must be unavailable');

    console.log('    [PASS] Group B: Volume Profile integrity verified.');
  }

  // =========================================================================
  // GROUP C: Options Chain & Greeks Contract Integrity
  // =========================================================================
  console.log('  Testing Group C: Options Chain & Greeks Contracts...');
  {
    // 1. Black-Scholes Greeks arithmetic validity
    const callGreeks = bsGreeks({ S: 5000, K: 5000, T: 30 / 365, r: 0.04, sigma: 0.20, type: 'call' });
    assert.ok(callGreeks, 'Call Greeks must be computed');
    assert.ok(callGreeks.delta > 0.45 && callGreeks.delta < 0.65, `ATM Call Delta must be ~0.50, got ${callGreeks.delta}`);
    assert.ok(callGreeks.gamma > 0, `Gamma must be positive, got ${callGreeks.gamma}`);
    assert.ok(callGreeks.vega > 0, `Vega must be positive, got ${callGreeks.vega}`);
    assert.ok(callGreeks.theta < 0, `Theta must be negative (time decay), got ${callGreeks.theta}`);

    const putGreeks = bsGreeks({ S: 5000, K: 5000, T: 30 / 365, r: 0.04, sigma: 0.20, type: 'put' });
    assert.ok(putGreeks, 'Put Greeks must be computed');
    assert.ok(putGreeks.delta < -0.35 && putGreeks.delta > -0.55, `ATM Put Delta must be ~-0.50, got ${putGreeks.delta}`);
    // Put-call parity for delta: delta_call - delta_put = e^(-q*T) approx 1
    assert.ok(Math.abs(callGreeks.delta - putGreeks.delta - 1) < 0.05, 'Put-call parity delta relationship holds');

    // 2. Chain builder without fake data
    const emptyChain = buildPricedChain({
      underlying: 'SPY',
      spot: 500,
      definitions: [],
      quotes: new Map(),
      statistics: new Map(),
      riskFreeRate: 0.04,
    });
    assert.equal(emptyChain.length, 0, 'Empty definitions produces 0 contracts');

    // 3. GEXEngine fail-closed verification: never returns fake walls when no real chain ingested
    const gexEngine = new GEXEngine();
    const profile = gexEngine.getProfile('SPY');
    assert.equal(profile, undefined, 'GEXEngine returns undefined for SPY before real option chain is fed');

    console.log('    [PASS] Group C: Options & Greeks contracts verified.');
  }

  // =========================================================================
  // GROUP D: Fail-Closed & Stale Feed Guard
  // =========================================================================
  console.log('  Testing Group D: Fail-Closed Runtime Verification...');
  {
    // Verify provider behavior without vendor keys: FUTURES_PROVIDER defaults to none/fail-closed
    const prevKey = process.env.DATABENTO_API_KEY;
    const client = new DatabentoHttpClient({ apiKey: '' });
    const chartService = new ChartService(client);

    // Queries on un-entitled / un-streamed symbol return graceful fail-closed responses
    const trades = await chartService.getLargeTrades('SYM_UNSTREAMED', undefined, undefined, 100);
    assert.equal(trades.length, 0, 'No large trades fabricated when storage is empty');

    const heatmap = await chartService.getDepthHeatmap('SYM_UNSTREAMED', undefined, undefined, []);
    assert.equal(heatmap.length, 0, 'No fake depth reconstructed when historical depth is empty');

    // Also verify out-of-range historical depth returns empty without fabrication
    const emptyRangeHeatmap = await chartService.getDepthHeatmap('ES', 1000, 2000, []);
    assert.equal(emptyRangeHeatmap.length, 0, 'No fake depth reconstructed outside recorded range');

    if (prevKey) process.env.DATABENTO_API_KEY = prevKey;
    console.log('    [PASS] Group D: Fail-closed safeguards verified.');
  }

  console.log('  [PASS] All behavioral & data integrity tests passed.\n');
}

if (process.argv[1]?.endsWith('behavioral_contracts.test.ts') || process.argv[1]?.endsWith('behavioral_contracts.test.js')) {
  runBehavioralContractTests().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
