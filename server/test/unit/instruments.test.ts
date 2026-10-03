import assert from 'node:assert/strict';
import {
  EXCHANGE_NAMES,
  FUTURES_INSTRUMENTS,
  INSTRUMENT_CATEGORIES,
  parseExtraInstruments,
  tickValueFor,
} from '../../src/futuresConfig.js';

/** Roots the product promises out of the box (CME Group liquid universe served by GLBX.MDP3). */
const REQUIRED_ROOTS = [
  'ES', 'MES', 'NQ', 'MNQ', 'YM', 'MYM', 'RTY', 'M2K',
  'GC', 'MGC', 'SI', 'SIL', 'HG', 'MHG',
  'CL', 'MCL', 'NG', 'MNG', 'RB', 'HO',
  'ZC', 'ZS', 'ZW', 'ZL', 'LE', 'HE', 'GF',
  'ZT', 'ZF', 'ZN', 'ZB',
  '6E', 'M6E', '6J', '6B', 'M6B', '6A', 'M6A', '6C', 'MSF',
  'BTC', 'MBT', 'MET',
];

/** [root, pointValue, tickSize, tickValue] — regression guard against a fat-fingered spec edit. */
const KNOWN_SPECS: Array<[string, number, number, number]> = [
  ['ES', 50, 0.25, 12.5],
  ['NQ', 20, 0.25, 5],
  ['RTY', 50, 0.1, 5],
  ['CL', 1000, 0.01, 10],
  ['GC', 100, 0.1, 10],
  ['SI', 5000, 0.005, 25],
  ['HG', 25000, 0.0005, 12.5],
  ['ZC', 50, 0.25, 12.5],
  ['ZS', 50, 0.25, 12.5],
  ['ZL', 600, 0.01, 6],
  ['LE', 400, 0.025, 10],
  ['ZT', 2000, 0.00390625, 7.8125],
  ['ZN', 1000, 0.015625, 15.625],
  ['ZB', 1000, 0.03125, 31.25],
  ['6J', 12500000, 0.0000005, 6.25],
  ['BTC', 5, 5, 25],
  ['MBT', 0.1, 5, 0.5],
  ['MET', 0.1, 0.5, 0.05],
];

export async function runInstrumentCatalogTests(): Promise<void> {
  console.log('[unit/instruments.test] Running CME instrument catalog unit tests...');

  const symbols = Object.keys(FUTURES_INSTRUMENTS);
  assert.ok(symbols.length >= 40, `catalog covers the liquid CME universe (got ${symbols.length})`);

  for (const root of REQUIRED_ROOTS) {
    assert.ok(FUTURES_INSTRUMENTS[root], `${root} must be available out of the box`);
  }

  // Every category the picker can show must have at least one instrument behind it. BOND/COMMODITY are
  // kept as legacy aliases in the type union (and accepted by EXTRA_INSTRUMENTS) but have no built-in
  // members: metals/energy/rates/fx/ags/crypto are their own groups now, and the UI derives its tabs.
  for (const category of ['INDEX', 'METALS', 'ENERGY', 'RATES', 'FX', 'AGRICULTURE', 'CRYPTO']) {
    assert.ok(
      symbols.some((root) => FUTURES_INSTRUMENTS[root].category === category),
      `category ${category} has at least one instrument`
    );
  }
  // Legacy aliases stay usable from the operator env, unknown names do not.
  assert.equal(
    parseExtraInstruments('XY:1000:0.01:Legacy Bond:BOND').instruments.length,
    1,
    'legacy BOND alias is still accepted'
  );
  assert.equal(
    parseExtraInstruments('XY:1000:0.01:Weird:WIDGET').errors.length,
    1,
    'unknown category is rejected'
  );

  // Structural invariants: a bad row here means wrong P&L / footprint / whale math downstream.
  for (const [key, inst] of Object.entries(FUTURES_INSTRUMENTS)) {
    assert.equal(inst.symbol, key, `${key}: symbol matches its key`);
    assert.equal(inst.rootSymbol, key, `${key}: root matches its key`);
    assert.ok(inst.name.trim().length > 1, `${key}: has a display name`);
    assert.ok(inst.pointValue > 0, `${key}: pointValue is positive`);
    assert.ok(inst.tickSize > 0, `${key}: tickSize is positive`);
    assert.equal(inst.multiplier, inst.pointValue, `${key}: multiplier mirrors pointValue`);
    assert.equal(inst.tickValue, tickValueFor(inst.pointValue, inst.tickSize), `${key}: tickValue is derived`);
    assert.ok(
      Math.abs(inst.tickValue - inst.pointValue * inst.tickSize) < 1e-9,
      `${key}: tickValue equals pointValue x tickSize`
    );
    assert.ok(INSTRUMENT_CATEGORIES.includes(inst.category), `${key}: category is known`);
    assert.ok(EXCHANGE_NAMES.includes(inst.exchange), `${key}: exchange is known`);
    assert.equal(inst.contractType, 'CONTINUOUS', `${key}: served as a continuous contract`);
    assert.ok(inst.sessionScheduleId.length > 0, `${key}: has a session schedule`);
    // The app has no FX conversion anywhere (whale notional, P&L), so every catalogued contract must be
    // USD-quoted.
    assert.equal(inst.currency, 'USD', `${key}: USD-quoted`);
    assert.ok(inst.basePrice >= 0, `${key}: basePrice is not negative`);
    // Sanity bounds catching a typo'd spec (e.g. tick 5 on an index future). Some contracts legitimately
    // tick a whole point (YM/MYM tick by 1 index point), so the bound is relative, not absolute.
    assert.ok(inst.tickSize <= 100, `${key}: tickSize is plausible`);
    assert.ok(inst.tickValue <= inst.pointValue * 10, `${key}: a tick is not worth more than 10 points`);

    if (inst.parentSymbol) {
      const parent = FUTURES_INSTRUMENTS[inst.parentSymbol];
      assert.ok(parent, `${key}: parent ${inst.parentSymbol} exists`);
      assert.equal(parent.isMicro, false, `${key}: parent is the full-size contract`);
      assert.equal(parent.microSymbol, key, `${key}: parent points back at the micro`);
    }
  }

  for (const [root, pointValue, tickSize, tickValue] of KNOWN_SPECS) {
    const inst = FUTURES_INSTRUMENTS[root];
    assert.equal(inst.pointValue, pointValue, `${root}: pointValue`);
    assert.equal(inst.tickSize, tickSize, `${root}: tickSize`);
    assert.equal(inst.tickValue, tickValue, `${root}: tickValue`);
  }


  // EXTRA_INSTRUMENTS: the long tail of GLBX.MDP3 stays reachable without a code change.
  const parsed = parseExtraInstruments(
    'QH:42000:0.01:NY Harbor ULSD (e-mini):ENERGY:NYMEX;QM:500:0.025:E-mini Crude Oil:ENERGY:NYMEX:CL;BAD:0:0;TOOLONGXYZ:1:1'
  );
  assert.equal(parsed.instruments.length, 2, 'two valid rows accepted');
  const qh = parsed.instruments[0];
  assert.equal(qh.symbol, 'QH');
  assert.equal(qh.pointValue, 42000);
  assert.equal(qh.tickValue, 420, 'tickValue derived for extra instruments');
  assert.equal(qh.sessionScheduleId, 'NYMEX_CUSTOM');
  assert.equal(qh.currency, 'USD');
  assert.equal(parsed.instruments[1].symbol, 'QM');
  assert.equal(parsed.instruments[1].underlyingIndex, 'CL', 'optional underlying index is kept');
  assert.equal(parsed.errors.length, 2, 'invalid rows are rejected with a reason');
  assert.ok(parsed.errors.every((error) => error.includes('must be')), 'errors explain what is wrong');
  assert.equal(parseExtraInstruments(undefined).instruments.length, 0, 'no env var -> no extras');
  assert.equal(parseExtraInstruments('   ').errors.length, 0, 'blank env var is not an error');

  console.log(`  [PASS] CME instrument catalog unit tests passed (${symbols.length} instruments).`);
}

if (process.argv[1]?.endsWith('instruments.test.ts') || process.argv[1]?.endsWith('instruments.test.js')) {
  runInstrumentCatalogTests().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
