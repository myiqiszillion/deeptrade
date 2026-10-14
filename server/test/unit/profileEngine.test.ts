import assert from 'node:assert/strict';
import { ProfileEngine } from '../../src/profileEngine.js';
import { Tick, HistoricalBar } from '../../src/types.js';

export async function runProfileEngineTests(): Promise<void> {
  console.log('--- Testing ProfileEngine Provenance & Integrity ---');

  // Test 1: Empty engine returns UNAVAILABLE
  {
    const engine = new ProfileEngine(0.25);
    const profile = engine.getVolumeProfile();
    assert.equal(profile.provenance, 'UNAVAILABLE', 'Empty profile must have provenance UNAVAILABLE');
    assert.equal(profile.isEstimated, false, 'Empty profile must have isEstimated false');
    assert.equal(profile.totalVolume, 0, 'Empty profile must have totalVolume 0');
    assert.equal(profile.levels.length, 0, 'Empty profile must have empty levels array');
    assert.equal(engine.getProvenance(), 'UNAVAILABLE');
    assert.equal(engine.isEstimatedProfile(), false);
    console.log('  [PASS] Empty profile returns UNAVAILABLE');
  }

  // Test 2: Raw trades produce EXACT profile
  {
    const engine = new ProfileEngine(0.25);
    const t0 = 1700000000000;
    const ticks: Tick[] = [
      { id: 't1', timestamp: t0, price: 5000.0, size: 10, side: 'buy' },
      { id: 't2', timestamp: t0 + 100, price: 5000.25, size: 40, side: 'sell' },
      { id: 't3', timestamp: t0 + 200, price: 5000.25, size: 25, side: 'buy' },
      { id: 't4', timestamp: t0 + 300, price: 5000.5, size: 5, side: 'buy' },
    ];
    for (const t of ticks) {
      engine.processTick(t);
    }

    const profile = engine.getVolumeProfile();
    assert.equal(profile.provenance, 'EXACT', 'Profile built solely from raw trades must be EXACT');
    assert.equal(profile.isEstimated, false, 'EXACT profile must not be marked estimated');
    assert.equal(profile.totalVolume, 80, 'Total volume must equal sum of tick sizes (10+40+25+5)');
    assert.equal(profile.poc, 5000.25, 'POC must be 5000.25 where 65 contracts traded');
    assert.equal(engine.getProvenance(), 'EXACT');
    assert.equal(engine.isEstimatedProfile(), false);

    // Verify tick delta accuracy
    const pocLevel = profile.levels.find((l) => Math.abs(l.price - 5000.25) < 1e-4);
    assert.ok(pocLevel, 'POC level must exist');
    assert.equal(pocLevel!.buyVolume, 25);
    assert.equal(pocLevel!.sellVolume, 40);
    assert.equal(pocLevel!.delta, -15);
    console.log('  [PASS] Raw trades produce EXACT profile with genuine delta');
  }

  // Test 3: Historical bars produce ESTIMATED profile
  {
    const engine = new ProfileEngine(0.25);
    const bars: HistoricalBar[] = [
      {
        time: 1700000000000,
        open: 5000.0,
        high: 5001.0,
        low: 4999.5,
        close: 5000.75,
        volume: 1000,
      },
    ];
    engine.processHistoricalBars(bars);

    const profile = engine.getVolumeProfile();
    assert.equal(profile.provenance, 'ESTIMATED', 'Profile built from OHLCV bars must be ESTIMATED');
    assert.equal(profile.isEstimated, true, 'isEstimated flag must be true');
    assert.ok(profile.totalVolume > 0, 'Total volume must be > 0');
    assert.ok(profile.levels.length > 0, 'Levels must be populated');
    assert.equal(engine.getProvenance(), 'ESTIMATED');
    assert.equal(engine.isEstimatedProfile(), true);
    console.log('  [PASS] Historical OHLCV bars produce ESTIMATED profile');
  }

  // Test 4: Invariant - Incoming ticks CANNOT upgrade ESTIMATED profile to EXACT
  {
    const engine = new ProfileEngine(0.25);
    // Seed with estimated OHLCV bars
    engine.processHistoricalBars([
      {
        time: 1700000000000,
        open: 5000.0,
        high: 5000.5,
        low: 4999.5,
        close: 5000.25,
        volume: 500,
      },
    ]);
    assert.equal(engine.getVolumeProfile().provenance, 'ESTIMATED');

    // Stream live ticks into the profile
    engine.processTick({
      id: 'live_t1',
      timestamp: 1700000060000,
      price: 5000.25,
      size: 50,
      side: 'buy',
    });

    const compositeProfile = engine.getVolumeProfile();
    assert.equal(
      compositeProfile.provenance,
      'ESTIMATED',
      'Profile containing synthetic OHLCV volume must remain ESTIMATED when ticks arrive'
    );
    assert.equal(compositeProfile.isEstimated, true);
    console.log('  [PASS] Invariant: Live ticks cannot convert ESTIMATED profile to EXACT');
  }

  // Test 5: Reset cleans state and allows fresh EXACT profile
  {
    const engine = new ProfileEngine(0.25);
    engine.processHistoricalBars([
      {
        time: 1700000000000,
        open: 5000.0,
        high: 5000.5,
        low: 4999.5,
        close: 5000.25,
        volume: 500,
      },
    ]);
    assert.equal(engine.getProvenance(), 'ESTIMATED');
    assert.equal(engine.getCoverage(), 'PARTIAL');

    engine.reset();
    assert.equal(engine.getProvenance(), 'UNAVAILABLE');
    assert.equal(engine.getCoverage(), 'UNKNOWN');
    assert.equal(engine.getVolumeProfile().provenance, 'UNAVAILABLE');
    assert.equal(engine.getVolumeProfile().coverage, 'UNKNOWN');

    // Add raw ticks after reset
    engine.processTick({
      id: 't_fresh',
      timestamp: 1700000070000,
      price: 5000.0,
      size: 15,
      side: 'sell',
    });
    const postResetProfile = engine.getVolumeProfile();
    assert.equal(postResetProfile.provenance, 'EXACT');
    assert.equal(postResetProfile.isEstimated, false);
    assert.equal(postResetProfile.totalVolume, 15);
    console.log('  [PASS] Reset restores UNAVAILABLE and allows subsequent EXACT profile');
  }

  // Test 6: Explicit coverage setting and propagation
  {
    const engine = new ProfileEngine(0.25);
    assert.equal(engine.getCoverage(), 'UNKNOWN');

    engine.setCoverage('COMPLETE');
    assert.equal(engine.getCoverage(), 'PARTIAL', 'Unverified COMPLETE claim must be downgraded');
    assert.equal(engine.getVolumeProfile().coverage, 'PARTIAL');

    engine.setCoverage('PARTIAL', 'Feed gap during session');
    assert.equal(engine.getCoverage(), 'PARTIAL');
    assert.equal(engine.getCoverageReason(), 'Feed gap during session');
    assert.equal(engine.getVolumeProfile().coverageReason, 'Feed gap during session');
    console.log('  [PASS] Coverage transitions and reason propagation verified');
  }
}
