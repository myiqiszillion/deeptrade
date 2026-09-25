import assert from 'node:assert/strict';
import {
  FUTURES_INSTRUMENTS,
  formatVendorSymbol,
  getParentSymbol,
  isContinuousContract,
  isMicroContract,
  parseContractSymbol,
} from '../../src/futuresConfig.js';
import { validateDepth, validateTrade } from '../../src/marketData/validate.js';

export async function runValidateTests(): Promise<void> {
  console.log('[unit/validate.test] Running validation and instrument specs unit tests...');

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

  // 4. Trade Validation
  const validRes = validateTrade(
    {
      price: 5000.25,
      size: 10,
      side: 'buy',
      ts: 1700000000000,
      receiveTs: 1700000000005,
      sequenceId: 'seq_1',
      aggressorProvenance: 'EXCHANGE_NATIVE',
    },
    es.tickSize,
    es.symbol
  );
  assert.ok(validRes.trade);
  assert.equal(validRes.trade.price, 5000.25);
  assert.equal(validRes.trade.size, 10);
  assert.equal(validRes.trade.receiveTs, 1700000000005);
  assert.equal(validRes.trade.sequenceId, 'seq_1');

  // Invalid trades rejected
  const negPriceRes = validateTrade(
    { price: -1, size: 10, side: 'buy', ts: 1700000000000 },
    es.tickSize,
    es.symbol
  );
  assert.equal(negPriceRes.trade, null, 'Negative price rejected');

  const zeroSizeRes = validateTrade(
    { price: 5000, size: 0, side: 'buy', ts: 1700000000000 },
    es.tickSize,
    es.symbol
  );
  assert.equal(zeroSizeRes.trade, null, 'Zero size rejected');

  // 5. Depth Validation
  const validDepthRes = validateDepth(
    {
      kind: 'snapshot',
      symbol: 'ES',
      bids: [[5000.0, 20]],
      asks: [[5000.25, 25]],
      ts: 1700000000000,
    },
    es.tickSize,
    es.symbol
  );
  assert.ok(validDepthRes.event);
  assert.equal(validDepthRes.event.kind, 'snapshot');
  if (validDepthRes.event.kind === 'snapshot') {
    assert.equal(validDepthRes.event.bids.length, 1);
    assert.equal(validDepthRes.event.asks.length, 1);
  }

  // Empty book rejected
  const emptyRes = validateDepth(
    {
      kind: 'snapshot',
      symbol: 'ES',
      bids: [],
      asks: [],
      ts: 1700000000000,
    },
    es.tickSize,
    es.symbol
  );
  assert.equal(emptyRes.event, null, 'Empty snapshot rejected');

  console.log('  [PASS] All validation unit tests passed.');
}

if (process.argv[1]?.endsWith('validate.test.ts') || process.argv[1]?.endsWith('validate.test.js')) {
  runValidateTests().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
