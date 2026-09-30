import assert from 'node:assert/strict';
import {
  DATABENTO_EXCHANGE_MAP,
  aggregateSpecsByRoot,
  decodeFixedPoint,
  exchangeValueFactor,
  parseDefinitionRecord,
  rootFromRawSymbol,
} from '../../src/marketData/databentoDefinitions.js';
import { applyStoredVendorSpecs, applySpecsToCatalog, categoryFromUnit } from '../../src/marketData/instrumentSync.js';
import { fetchDatabentoInstrumentSpecs } from '../../src/marketData/databentoDefinitions.js';
import { FUTURES_INSTRUMENTS } from '../../src/futuresConfig.js';
import { marketDataStore } from '../../src/storage/marketDataStore.js';

const FUTURE = new Date(Date.now() + 200 * 24 * 60 * 60 * 1000).toISOString();
const PAST = new Date(Date.now() - 200 * 24 * 60 * 60 * 1000).toISOString();

/** Definition record as GLBX.MDP3 returns it (pretty_px decimals, per Databento's own tutorial). */
function definitionRecord(overrides: Record<string, unknown> = {}): any {
  return {
    hd: { ts_event: '1767623400000000000', rtype: 22 },
    raw_symbol: 'ESM6',
    exchange: 'XCME',
    currency: 'USD',
    instrument_class: 'F',
    contract_multiplier: '50',
    min_price_increment: '0.25',
    min_price_increment_amount: '12.5',
    unit_of_measure: 'Index Points',
    unit_of_measure_qty: '50',
    activation: PAST,
    expiration: FUTURE,
    ...overrides,
  };
}

export async function runInstrumentDefinitionTests(): Promise<void> {
  console.log('[unit/instrumentDefinitions.test] Running Databento definition & instrument sync tests...');

  // 1. Fixed-point decoding: decimal strings pass through, implicit 1e-9 integers do not become huge ticks.
  assert.equal(decodeFixedPoint('0.25'), 0.25);
  assert.equal(decodeFixedPoint('250000000'), 0.25, 'implicitly scaled 1e-9 integer decoded');
  assert.equal(decodeFixedPoint('50000000000'), 50);
  assert.equal(decodeFixedPoint('1000'), 1000, 'small integers are multipliers, not scaled');
  assert.equal(decodeFixedPoint(0.25), 0.25);
  assert.equal(decodeFixedPoint('abc'), null);
  assert.equal(decodeFixedPoint(null), null);

  // 2. Root extraction: outright futures only (spreads, TAS, options and user-defined symbols are not roots).
  assert.equal(rootFromRawSymbol('ESM6'), 'ES');
  assert.equal(rootFromRawSymbol('M6EU6'), 'M6E');
  assert.equal(rootFromRawSymbol('KEM6'), 'KE');
  assert.equal(rootFromRawSymbol('ZCZ6'), 'ZC');
  assert.equal(rootFromRawSymbol('6JU6'), '6J');
  assert.equal(rootFromRawSymbol('ESM6-ESU6'), null, 'calendar spread is not an outright');
  assert.equal(rootFromRawSymbol('ESM6-TAS'), null, 'TAS instrument is not an outright');
  assert.equal(rootFromRawSymbol('DIF 89 7813548'), null, 'user-defined instrument');
  assert.equal(rootFromRawSymbol(''), null);

  // 3. CBOT keeps its cents convention — the factor Databento's tutorial applies.
  assert.equal(exchangeValueFactor('XCBT'), 0.01);
  assert.equal(exchangeValueFactor('XCME'), 1);
  assert.equal(DATABENTO_EXCHANGE_MAP.XCEC, 'COMEX');

  // 4. Parsing a normal CME future.
  const es = parseDefinitionRecord(definitionRecord());
  assert.ok(es.spec, 'ES definition parses');
  assert.equal(es.spec!.root, 'ES');
  assert.equal(es.spec!.exchange, 'CME');
  assert.equal(es.spec!.pointValue, 50);
  assert.equal(es.spec!.tickSize, 0.25);
  assert.equal(es.spec!.tickValue, 12.5);
  assert.equal(es.spec!.unitOfMeasure, 'Index Points');

  // 5. CBOT grain: 5,000 bushels, quarter-cent tick -> 50 USD per point, 12.50 USD per tick.
  const corn = parseDefinitionRecord(
    definitionRecord({ raw_symbol: 'ZCZ6', exchange: 'XCBT', contract_multiplier: '5000', unit_of_measure: 'Bushels', unit_of_measure_qty: '5000', min_price_increment: '0.25' })
  );
  assert.ok(corn.spec, 'corn definition parses');
  assert.equal(corn.spec!.pointValue, 50, 'XCBT factor 0.01 applied');
  assert.equal(corn.spec!.tickValue, 12.5);

  // 6. Implicitly scaled (pretty_px=false) payloads still decode to the same numbers.
  const fixedPoint = parseDefinitionRecord(
    definitionRecord({ contract_multiplier: '50000000000', min_price_increment: '250000000', unit_of_measure_qty: '50000000000', min_price_increment_amount: '12500000000' })
  );
  assert.ok(fixedPoint.spec);
  assert.equal(fixedPoint.spec!.pointValue, 50);
  assert.equal(fixedPoint.spec!.tickSize, 0.25);
  assert.equal(fixedPoint.spec!.tickValue, 12.5);

  // 7. Noise and junk are rejected with a reason, never guessed.
  assert.equal(parseDefinitionRecord(definitionRecord({ instrument_class: 'C' })).spec, null, 'call option skipped');
  assert.equal(parseDefinitionRecord(definitionRecord({ raw_symbol: 'ESM6-ESU6' })).spec, null, 'spread skipped');
  assert.equal(parseDefinitionRecord(definitionRecord({ exchange: 'XDCE' })).spec, null, 'non-CME-Group venue skipped');
  assert.equal(parseDefinitionRecord(definitionRecord({ expiration: PAST })).spec, null, 'expired contract skipped');
  assert.equal(parseDefinitionRecord(definitionRecord({ contract_multiplier: '0' })).spec, null, 'missing multiplier');
  assert.equal(parseDefinitionRecord(definitionRecord({ min_price_increment: '0' })).spec, null, 'missing tick');

  // 8. One spec per root, keeping the still-listed contract.
  const aggregated = aggregateSpecsByRoot([
    { ...es.spec!, rawSymbol: 'ESH6', expiration: PAST },
    { ...es.spec!, rawSymbol: 'ESM6', expiration: FUTURE },
    { ...corn.spec! },
  ]);
  assert.equal(aggregated.length, 2, 'two roots from three records');
  assert.deepEqual(aggregated.map((s) => s.root), ['ES', 'ZC'], 'sorted by root');
  assert.equal(aggregated[0].rawSymbol, 'ESM6', 'later expiry wins');

  await runSyncTests();

  console.log('  [PASS] Databento definition & instrument sync unit tests passed.');
}

/** Catalog merge + storage roundtrip + a scripted definition pull (no network, no real API key). */
async function runSyncTests(): Promise<void> {
  // Category inference from the vendor's own unit of measure.
  assert.equal(categoryFromUnit('Bushels'), 'AGRICULTURE');
  assert.equal(categoryFromUnit('Troy Ounces'), 'METALS');
  assert.equal(categoryFromUnit('Barrels'), 'ENERGY');
  assert.equal(categoryFromUnit('MMBtu'), 'ENERGY');
  assert.equal(categoryFromUnit('Index Points'), 'INDEX');
  assert.equal(categoryFromUnit('Bitcoin'), 'CRYPTO');
  assert.equal(categoryFromUnit('Currency'), 'FX');
  assert.equal(categoryFromUnit('Pounds'), 'OTHER', 'ambiguous unit stays Other instead of a wrong guess');
  assert.equal(categoryFromUnit(undefined), 'OTHER');

  const vendorSpec = {
    root: 'QM',
    rawSymbol: 'QMM6',
    exchange: 'NYMEX' as const,
    currency: 'USD',
    instrumentClass: 'F',
    pointValue: 500,
    tickSize: 0.025,
    tickValue: 12.5,
    unitOfMeasure: 'Barrels',
    unitOfMeasureQty: 500,
  };

  // Unknown roots are added to the live catalog using the vendor's authoritative numbers...
  const added = applySpecsToCatalog([vendorSpec]);
  assert.deepEqual(added.added, ['QM']);
  assert.equal(FUTURES_INSTRUMENTS.QM.pointValue, 500);
  assert.equal(FUTURES_INSTRUMENTS.QM.tickValue, 12.5);
  assert.equal(FUTURES_INSTRUMENTS.QM.category, 'ENERGY');
  assert.equal(FUTURES_INSTRUMENTS.QM.exchange, 'NYMEX');

  // ...non-USD products are refused (the app has no FX table anywhere)...
  const nonUsd = applySpecsToCatalog([{ ...vendorSpec, root: 'MJY', currency: 'JPY' }]);
  assert.deepEqual(nonUsd.skippedNonUsd, ['MJY']);
  assert.equal(FUTURES_INSTRUMENTS.MJY, undefined, 'non-USD instrument is not served');

  // ...and a disagreement with a curated spec is reported instead of silently rewritten.
  const conflict = applySpecsToCatalog([{ ...vendorSpec, root: 'ES', pointValue: 49, tickSize: 0.5 }]);
  assert.equal(conflict.conflicts.length, 1, 'disagreement reported');
  assert.equal(conflict.conflicts[0].root, 'ES');
  assert.equal(FUTURES_INSTRUMENTS.ES.tickSize, 0.25, 'curated spec wins');
  assert.equal(FUTURES_INSTRUMENTS.ES.pointValue, 50);

  // Storage roundtrip + restore path: this is what makes the catalog survive a restart with no network call.
  marketDataStore.clearInstrumentSpecs('test-provider');
  const stored = marketDataStore.upsertInstrumentSpecs('test-provider', [
    { ...vendorSpec, root: 'QG', rawSymbol: 'QGM6', tickSize: 0.005, pointValue: 2500 },
  ]);
  assert.equal(stored, 1, 'spec row written');
  const listed = marketDataStore.listInstrumentSpecs('test-provider');
  assert.equal(listed.length, 1);
  assert.equal(listed[0].root, 'QG');
  assert.equal(listed[0].unitOfMeasure, 'Barrels');
  delete FUTURES_INSTRUMENTS.QG;
  const restored = applyStoredVendorSpecs('test-provider');
  assert.deepEqual(restored.added, ['QG'], 'stored specs re-expand the catalog');
  assert.equal(FUTURES_INSTRUMENTS.QG.pointValue, 2500);
  marketDataStore.clearInstrumentSpecs('test-provider');

  // A definitions pull is a paid request: with no API key nothing is even attempted.
  const noKey = await fetchDatabentoInstrumentSpecs({
    apiKey: '',
    fetchFn: (async () => {
      throw new Error('must not fetch without a key');
    }) as unknown as typeof fetch,
  });
  assert.equal(noKey.specs.length, 0);
  assert.equal(noKey.skipped['no-api-key'], 1);

  // With a key the payload is parsed into specs (guard off => exactly one request, definition schema).
  marketDataStore.clearVendorUsage('databento');
  const requests: string[] = [];
  const mockFetch = (async (url: string | URL) => {
    requests.push(String(url));
    const lines = [
      JSON.stringify(definitionRecord()),
      JSON.stringify(
        definitionRecord({
          raw_symbol: 'ZCZ6',
          exchange: 'XCBT',
          contract_multiplier: '5000',
          unit_of_measure: 'Bushels',
          unit_of_measure_qty: '5000',
        })
      ),
    ].join('\n');
    return new Response(lines, { status: 200 });
  }) as unknown as typeof fetch;

  const pulled = await fetchDatabentoInstrumentSpecs({ apiKey: 'db-test-key', fetchFn: mockFetch });
  assert.deepEqual(
    pulled.specs.map((s) => s.root),
    ['ES', 'ZC'],
    'definitions aggregated per root'
  );
  assert.equal(requests.length, 1, 'one request when the spend guard is off');
  assert.ok(requests[0].includes('schema=definition'), 'definition schema requested');
  assert.ok(requests[0].includes('pretty_px=true'), 'decimal prices requested');
  assert.ok(requests[0].includes('symbols=ALL_SYMBOLS'), 'whole dataset requested');
  assert.equal(marketDataStore.getVendorUsage('databento', new Date().toISOString().slice(0, 7)).usd, 0, 'no spend without a guard');

  // HTTP errors are reported, never invented.
  const failing = await fetchDatabentoInstrumentSpecs({
    apiKey: 'db-test-key',
    fetchFn: (async () => new Response('nope', { status: 402 })) as unknown as typeof fetch,
  });
  assert.equal(failing.specs.length, 0);
  assert.equal(failing.skipped['http-402'], 1);

  // Leave the shipped catalog exactly as other suites expect it.
  delete FUTURES_INSTRUMENTS.QM;
}

if (
  process.argv[1]?.endsWith('instrumentDefinitions.test.ts') ||
  process.argv[1]?.endsWith('instrumentDefinitions.test.js')
) {
  runInstrumentDefinitionTests().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
