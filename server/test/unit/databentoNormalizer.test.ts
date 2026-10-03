import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  parseOsiSymbol,
  normalizeTrade,
  normalizeQuote,
  normalizeDefinition,
  normalizeStatistic,
  parsePrice,
  parseTimestampMs,
} from '../../src/databento/normalizer.js';
import {
  DbTradeRecord,
  DbMbp1Record,
  DbDefinitionRecord,
  DbStatisticsRecord,
} from '../../src/databento/types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixturesDir = join(__dirname, '../fixtures/databento');

export async function runDatabentoNormalizerTests(): Promise<void> {
  console.log('[unit/databentoNormalizer.test] Running Databento normalizer unit tests...');

  // 1. OSI Option Symbol Parsing
  {
    const parsed = parseOsiSymbol('SPY260320C00500000');
    assert.ok(parsed, 'Failed to parse valid OSI symbol');
    assert.equal(parsed.underlying, 'SPY');
    assert.equal(parsed.expiration, '2026-03-20');
    assert.equal(parsed.type, 'call');
    assert.equal(parsed.strike, 500);

    const putParsed = parseOsiSymbol('NVDA260320P00125500');
    assert.ok(putParsed, 'Failed to parse valid NVDA put OSI symbol');
    assert.equal(putParsed.underlying, 'NVDA');
    assert.equal(putParsed.expiration, '2026-03-20');
    assert.equal(putParsed.type, 'put');
    assert.equal(putParsed.strike, 125.5);

    const invalid = parseOsiSymbol('INVALID_SYMBOL');
    assert.equal(invalid, null, 'Should return null for invalid OSI symbol');
    console.log('  PASS  OSI option symbol parsing');
  }

  // 2. Price and Timestamp Parsers
  {
    assert.equal(parsePrice(520250000000), 520.25);
    assert.equal(parsePrice('520.25'), 520.25);
    assert.equal(parsePrice(175.5), 175.5);

    // 1711033200000000000 nanoseconds -> 1711033200000 milliseconds
    assert.equal(parseTimestampMs(1711033200000000000n), 1711033200000);
    assert.equal(parseTimestampMs(1711033200000000000), 1711033200000);
    assert.equal(parseTimestampMs('1711033200000000000'), 1711033200000);
    console.log('  PASS  Price & timestamp parsing');
  }

  // 3. Trade Normalization
  {
    const tradesFixture: DbTradeRecord[] = JSON.parse(
      readFileSync(join(fixturesDir, 'trades_equity.json'), 'utf8')
    );

    const norm0 = normalizeTrade(tradesFixture[0]);
    assert.equal(norm0.symbol, 'SPY');
    assert.equal(norm0.price, 520.25);
    assert.equal(norm0.size, 100);
    assert.equal(norm0.side, 'buy'); // Action 'T' with side 'A' (Ask) is a buyer-initiated trade
    assert.equal(norm0.timestamp, 1711033200000);

    const norm1 = normalizeTrade(tradesFixture[1]);
    assert.equal(norm1.side, 'sell'); // Action 'T' with side 'B' (Bid) is a seller-initiated trade
    assert.equal(norm1.price, 520.20);
    assert.equal(norm1.size, 250);

    const norm2 = normalizeTrade(tradesFixture[2]);
    assert.equal(norm2.symbol, 'AAPL');
    assert.equal(norm2.side, 'unknown'); // Side 'N' -> unknown
    assert.equal(norm2.price, 175.5);

    console.log('  PASS  Trade normalization');
  }

  // 4. Quote Normalization
  {
    const quotesFixture: DbMbp1Record[] = JSON.parse(
      readFileSync(join(fixturesDir, 'quotes_options.json'), 'utf8')
    );

    const q0 = normalizeQuote(quotesFixture[0]);
    assert.equal(q0.symbol, 'SPY260320C00500000');
    assert.equal(q0.bidPrice, 25.5);
    assert.equal(q0.askPrice, 25.7);
    assert.equal(q0.bidSize, 50);
    assert.equal(q0.askSize, 80);
    assert.equal(q0.midPrice, 25.6);
    assert.equal(Number(q0.spread.toFixed(2)), 0.2);
    assert.equal(q0.timestamp, 1711033200500);

    console.log('  PASS  Quote normalization');
  }

  // 5. Option Definition Normalization
  {
    const defsFixture: DbDefinitionRecord[] = JSON.parse(
      readFileSync(join(fixturesDir, 'definitions_options.json'), 'utf8')
    );

    const def0 = normalizeDefinition(defsFixture[0]);
    assert.equal(def0.symbol, 'SPY260320C00500000');
    assert.equal(def0.underlying, 'SPY');
    assert.equal(def0.strike, 500);
    assert.equal(def0.type, 'call');
    assert.equal(def0.multiplier, 100);
    assert.equal(def0.expiration, '2026-03-20');
    assert.ok(def0.dte >= 0);

    console.log('  PASS  Option definition normalization');
  }

  // 6. Statistics Normalization
  {
    const statsFixture: DbStatisticsRecord[] = JSON.parse(
      readFileSync(join(fixturesDir, 'statistics_options.json'), 'utf8')
    );

    const stat0 = normalizeStatistic(statsFixture[0]);
    assert.equal(stat0.symbol, 'SPY260320C00500000');
    assert.equal(stat0.openInterest, 14500);

    const stat1 = normalizeStatistic(statsFixture[1]);
    assert.equal(stat1.settlementPrice, 25.6);

    const stat2 = normalizeStatistic(statsFixture[2]);
    assert.equal(stat2.clearedVolume, 3820);

    console.log('  PASS  Statistics normalization');
  }

  console.log('  [PASS] All Databento normalizer unit tests passed.');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  runDatabentoNormalizerTests().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
