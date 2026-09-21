import assert from 'node:assert';
import {
  FUTURES_INSTRUMENTS,
  formatVendorSymbol,
  getParentSymbol,
  isContinuousContract,
  isMicroContract,
  parseContractSymbol,
} from './futuresConfig.js';
import { classifyAggressor, TradovateQuoteMapper } from './marketData/tradovateMapper.js';
import { validateDepth, validateTrade } from './marketData/validate.js';
import { TradovateQuote } from './marketData/tradovateTransport.js';

console.log('======================================================');
console.log('🧪 RUNNING PHASE A VERIFICATION SUITE (CONTRACTS & METADATA)');
console.log('======================================================\n');

let passed = 0;
let failed = 0;

function check(label: string, fn: () => void): void {
  try {
    fn();
    passed++;
    console.log(`  PASS  ${label}`);
  } catch (err) {
    failed++;
    console.error(`  FAIL  ${label}:`, (err as Error).message);
  }
}

// ---------------------------------------------------------------------------
// 1. Instrument Identity & Independence Tests
// ---------------------------------------------------------------------------
check('ES and MES exist as distinct, independent instruments', () => {
  const es = FUTURES_INSTRUMENTS.ES;
  const mes = FUTURES_INSTRUMENTS.MES;
  assert.ok(es, 'ES must be defined');
  assert.ok(mes, 'MES must be defined');
  assert.notStrictEqual(es, mes, 'ES and MES must be separate objects');
  assert.strictEqual(es.symbol, 'ES');
  assert.strictEqual(mes.symbol, 'MES');
  assert.strictEqual(es.pointValue, 50.0);
  assert.strictEqual(mes.pointValue, 5.0);
  assert.strictEqual(es.tickValue, 12.5);
  assert.strictEqual(mes.tickValue, 1.25);
  assert.strictEqual(mes.isMicro, true);
  assert.strictEqual(es.isMicro, false);
  assert.strictEqual(mes.parentSymbol, 'ES');
  assert.strictEqual(es.exchange, 'CME');
  assert.strictEqual(mes.exchange, 'CME');
  assert.strictEqual(es.timezone, 'America/Chicago');
  assert.strictEqual(mes.timezone, 'America/Chicago');
});

check('NQ and MNQ exist as distinct, independent instruments', () => {
  const nq = FUTURES_INSTRUMENTS.NQ;
  const mnq = FUTURES_INSTRUMENTS.MNQ;
  assert.ok(nq, 'NQ must be defined');
  assert.ok(mnq, 'MNQ must be defined');
  assert.notStrictEqual(nq, mnq, 'NQ and MNQ must be separate objects');
  assert.strictEqual(nq.symbol, 'NQ');
  assert.strictEqual(mnq.symbol, 'MNQ');
  assert.strictEqual(nq.pointValue, 20.0);
  assert.strictEqual(mnq.pointValue, 2.0);
  assert.strictEqual(nq.tickValue, 5.0);
  assert.strictEqual(mnq.tickValue, 0.5);
  assert.strictEqual(mnq.isMicro, true);
  assert.strictEqual(nq.isMicro, false);
  assert.strictEqual(mnq.parentSymbol, 'NQ');
  assert.strictEqual(nq.exchange, 'CME');
  assert.strictEqual(mnq.exchange, 'CME');
});

check('CBOT, COMEX, NYMEX and Crypto instruments have correct exchange and timezone specifications', () => {
  assert.strictEqual(FUTURES_INSTRUMENTS.YM.exchange, 'CBOT');
  assert.strictEqual(FUTURES_INSTRUMENTS.MYM.exchange, 'CBOT');
  assert.strictEqual(FUTURES_INSTRUMENTS.YM.timezone, 'America/Chicago');

  assert.strictEqual(FUTURES_INSTRUMENTS.GC.exchange, 'COMEX');
  assert.strictEqual(FUTURES_INSTRUMENTS.MGC.exchange, 'COMEX');
  assert.strictEqual(FUTURES_INSTRUMENTS.GC.timezone, 'America/New_York');

  assert.strictEqual(FUTURES_INSTRUMENTS.CL.exchange, 'NYMEX');
  assert.strictEqual(FUTURES_INSTRUMENTS.MCL.exchange, 'NYMEX');
  assert.strictEqual(FUTURES_INSTRUMENTS.CL.timezone, 'America/New_York');

  assert.strictEqual(FUTURES_INSTRUMENTS.BTCUSDT.exchange, 'BINANCE');
  assert.strictEqual(FUTURES_INSTRUMENTS.BTCUSDT.timezone, 'UTC');
  assert.strictEqual(FUTURES_INSTRUMENTS.BTCUSDT.currency, 'USDT');
});

// ---------------------------------------------------------------------------
// 2. Data Quality & Metadata Preservation Tests
// ---------------------------------------------------------------------------
check('validateTrade preserves receiveTs, sequenceId, and native provenance', () => {
  const now = Date.now();
  const res = validateTrade(
    {
      ts: 1700000000000,
      price: 5850.25,
      size: 10,
      side: 'BUY',
      id: 'trade-123',
      symbol: 'ES',
      receiveTs: now,
      aggressorProvenance: 'EXCHANGE_NATIVE',
      sequenceId: 'seq-999',
    },
    0.25,
    'ES'
  );

  assert.ok(res.trade);
  assert.strictEqual(res.trade.price, 5850.25);
  assert.strictEqual(res.trade.size, 10);
  assert.strictEqual(res.trade.side, 'BUY');
  assert.strictEqual(res.trade.receiveTs, now);
  assert.strictEqual(res.trade.aggressorProvenance, 'EXCHANGE_NATIVE');
  assert.strictEqual(res.trade.sequenceId, 'seq-999');
});

check('TradovateQuoteMapper marks quote-rule aggressor as INFERRED_QUOTE', () => {
  const mapper = new TradovateQuoteMapper();
  const quote: TradovateQuote = {
    timestamp: '2026-01-05T14:30:00.000Z',
    entries: {
      Bid: { price: 5850.0, size: 20 },
      Offer: { price: 5850.25, size: 30 },
      Trade: { price: 5850.25, size: 5 }, // Lifted offer -> quote rule BUY
    },
  };

  const { trades } = mapper.mapQuote(quote, 'ES');
  assert.strictEqual(trades.length, 1);
  assert.strictEqual(trades[0].side, 'BUY');
  assert.strictEqual(trades[0].aggressorProvenance, 'INFERRED_QUOTE');
  assert.ok(trades[0].receiveTs && trades[0].receiveTs > 0);
});

check('TradovateQuoteMapper marks uptick-rule aggressor as INFERRED_TICK', () => {
  const mapper = new TradovateQuoteMapper();
  // 1. Establish prior trade inside spread
  mapper.mapQuote(
    {
      timestamp: '2026-01-05T14:30:00.000Z',
      entries: {
        Bid: { price: 5849.5, size: 10 },
        Offer: { price: 5850.5, size: 10 },
        Trade: { price: 5850.0, size: 2 },
      },
    },
    'ES'
  );

  // 2. Next trade inside spread but higher price -> tick rule BUY
  const { trades } = mapper.mapQuote(
    {
      timestamp: '2026-01-05T14:30:00.100Z',
      entries: {
        Bid: { price: 5849.5, size: 10 },
        Offer: { price: 5850.5, size: 10 },
        Trade: { price: 5850.25, size: 3 },
      },
    },
    'ES'
  );

  assert.strictEqual(trades.length, 1);
  assert.strictEqual(trades[0].side, 'BUY');
  assert.strictEqual(trades[0].aggressorProvenance, 'INFERRED_TICK');
});

check('validateDepth preserves receiveTs, depthLevel and sourceProvider metadata', () => {
  const now = Date.now();
  const res = validateDepth(
    {
      kind: 'snapshot',
      ts: 1700000000000,
      bids: [[5850.0, 10]],
      asks: [[5850.25, 15]],
      updateId: 101,
      symbol: 'ES',
      receiveTs: now,
      depthLevel: 'L2_50',
      sourceProvider: 'tradovate',
    },
    0.25,
    'ES'
  );

  assert.ok(res.event);
  assert.strictEqual(res.event.kind, 'snapshot');
  if (res.event.kind === 'snapshot') {
    assert.strictEqual(res.event.receiveTs, now);
    assert.strictEqual(res.event.depthLevel, 'L2_50');
    assert.strictEqual(res.event.updateId, 101);
    assert.strictEqual(res.event.sourceProvider, 'tradovate');
  }
});

// ---------------------------------------------------------------------------
// 3. Contract Parsing & Vendor Formatting Tests
// ---------------------------------------------------------------------------
check('isContinuousContract correctly distinguishes continuous vs specific contracts', () => {
  assert.strictEqual(isContinuousContract('ES'), true);
  assert.strictEqual(isContinuousContract('MES'), true);
  assert.strictEqual(isContinuousContract('NQ'), true);
  assert.strictEqual(isContinuousContract('BTCUSDT'), true);
  assert.strictEqual(isContinuousContract('ESH6'), false);
  assert.strictEqual(isContinuousContract('ESZ26'), false);
  assert.strictEqual(isContinuousContract('NQM26'), false);
});

check('parseContractSymbol decomposes root, month, and year correctly', () => {
  const continuous = parseContractSymbol('ES');
  assert.strictEqual(continuous.root, 'ES');
  assert.strictEqual(continuous.isContinuous, true);
  assert.strictEqual(continuous.month, undefined);

  const specific1 = parseContractSymbol('ESH6');
  assert.strictEqual(specific1.root, 'ES');
  assert.strictEqual(specific1.month, 'H');
  assert.strictEqual(specific1.year, 2026);
  assert.strictEqual(specific1.isContinuous, false);

  const specific2 = parseContractSymbol('MNQZ26');
  assert.strictEqual(specific2.root, 'MNQ');
  assert.strictEqual(specific2.month, 'Z');
  assert.strictEqual(specific2.year, 2026);
  assert.strictEqual(specific2.isContinuous, false);
});

check('isMicroContract and getParentSymbol correctly identify micro hierarchy without conflation', () => {
  assert.strictEqual(isMicroContract('MES'), true);
  assert.strictEqual(isMicroContract('ES'), false);
  assert.strictEqual(isMicroContract('MNQ'), true);
  assert.strictEqual(isMicroContract('NQ'), false);
  assert.strictEqual(isMicroContract('MCL'), true);
  assert.strictEqual(isMicroContract('CL'), false);

  assert.strictEqual(getParentSymbol('MES'), 'ES');
  assert.strictEqual(getParentSymbol('MNQ'), 'NQ');
  assert.strictEqual(getParentSymbol('ES'), undefined);
  assert.strictEqual(getParentSymbol('BTCUSDT'), undefined);
});

check('formatVendorSymbol matches vendor specification rules', () => {
  assert.strictEqual(formatVendorSymbol('binance', 'BTCUSDT'), 'BTCUSDT');
  assert.strictEqual(formatVendorSymbol('tradovate', 'ES'), '@ES');
  assert.strictEqual(formatVendorSymbol('tradovate', 'ES', 'H26'), 'ESH26');
  assert.strictEqual(formatVendorSymbol('databento', 'ES'), 'ES.FUT');
});

// ---------------------------------------------------------------------------
// 4. Full Instrument Specification Integrity
// ---------------------------------------------------------------------------
check('Every instrument in FUTURES_INSTRUMENTS satisfies the normalized contract schema', () => {
  for (const [key, inst] of Object.entries(FUTURES_INSTRUMENTS)) {
    assert.strictEqual(inst.symbol, key);
    assert.ok(inst.rootSymbol, `${key} must have rootSymbol`);
    assert.ok(inst.name, `${key} must have name`);
    assert.ok(inst.assetClass, `${key} must have assetClass`);
    assert.ok(inst.exchange, `${key} must have exchange`);
    assert.ok(inst.timezone, `${key} must have timezone`);
    assert.ok(inst.sessionScheduleId, `${key} must have sessionScheduleId`);
    assert.ok(inst.tickSize > 0, `${key} tickSize must be > 0`);
    assert.ok(inst.pointValue > 0, `${key} pointValue must be > 0`);
    assert.ok(inst.tickValue > 0, `${key} tickValue must be > 0`);
    assert.ok(inst.multiplier > 0, `${key} multiplier must be > 0`);
    assert.strictEqual(typeof inst.isMicro, 'boolean', `${key} isMicro must be boolean`);
    assert.strictEqual(inst.contractType, 'CONTINUOUS', `${key} default catalog is CONTINUOUS`);
  }
});

// ---------------------------------------------------------------------------
// 5. Missing Data Preservation (Never Default to 0)
// ---------------------------------------------------------------------------
check('Missing quality flags and sequenceId remain undefined, never coerced to 0 or fake values', () => {
  const res = validateTrade(
    {
      ts: 1700000000000,
      price: 5850.25,
      size: 10,
      side: 'BUY',
      id: 'trade-456',
      symbol: 'ES',
    },
    0.25,
    'ES'
  );

  assert.ok(res.trade);
  assert.strictEqual(res.trade.sequenceId, undefined);
  assert.strictEqual(res.trade.qualityFlags, undefined);
  assert.strictEqual(res.trade.sourceProvider, undefined);
});

console.log('\n======================================================');
console.log(`Results: ${passed} passed, ${failed} failed`);
console.log('======================================================\n');

if (failed > 0) process.exit(1);
process.exit(0);
