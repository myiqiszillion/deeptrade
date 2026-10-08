import assert from 'node:assert/strict';
import {
  FUTURES_INSTRUMENTS,
  formatVendorSymbol,
  getParentSymbol,
  isContinuousContract,
  isMicroContract,
  parseContractSymbol,
} from '../../src/futuresConfig.js';

export async function runValidateTests(): Promise<void> {
  console.log('[unit/validate.test] Running instrument specs unit tests...');

  // 1. Instrument Independence (ES vs MES)
  const es = FUTURES_INSTRUMENTS.ES;
  const mes = FUTURES_INSTRUMENTS.MES;
  assert.ok(es && mes);
  assert.equal(es.symbol, 'ES');
  assert.equal(mes.symbol, 'MES');
  assert.equal(es.pointValue, 50.0);
  assert.equal(mes.pointValue, 5.0);
  assert.equal(es.tickValue, 12.5);
  assert.equal(mes.tickValue, 1.25);
  assert.equal(mes.isMicro, true);
  assert.equal(es.isMicro, false);
  assert.equal(mes.parentSymbol, 'ES');

  // 2. Instrument Independence (NQ vs MNQ)
  const nq = FUTURES_INSTRUMENTS.NQ;
  const mnq = FUTURES_INSTRUMENTS.MNQ;
  assert.ok(nq && mnq);
  assert.equal(nq.symbol, 'NQ');
  assert.equal(mnq.symbol, 'MNQ');
  assert.equal(nq.pointValue, 20.0);
  assert.equal(mnq.pointValue, 2.0);
  assert.equal(mnq.isMicro, true);

  // 3. Contract Symbol Parsing
  assert.equal(isContinuousContract('ES'), true);
  assert.equal(isContinuousContract('ESH6'), false);
  assert.equal(isMicroContract('MES'), true);
  assert.equal(isMicroContract('ES'), false);
  assert.equal(getParentSymbol('MES'), 'ES');
  assert.equal(getParentSymbol('MNQ'), 'NQ');

  const parsed = parseContractSymbol('ESH6');
  assert.equal(parsed.root, 'ES');
  assert.equal(parsed.month, 'H');
  assert.equal(parsed.year, 2026);

  // Vendor symbol formatting
  assert.equal(formatVendorSymbol('databento', 'ES'), 'ES');

  console.log('  [PASS] All instrument spec unit tests passed.');
}

if (process.argv[1]?.endsWith('validate.test.ts') || process.argv[1]?.endsWith('validate.test.js')) {
  runValidateTests().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
