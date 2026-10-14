import assert from 'node:assert/strict';
import {
  DBN,
  buildCramAuthResponse,
  determineDatabentoGateway,
  parseDbnRecord,
} from '../../src/marketData/databentoTransport.js';
import { resolveDatabentoSymbol } from '../../src/marketData/databentoAdapter.js';

/** Build a DBN record with the 16-byte common header (length in 4-byte words, rtype, ids, ts). */
function dbnRecord(rtype: number, body: Buffer, instrumentId = 4615, tsEventMs = 1_790_568_560_923): Buffer {
  const recLen = 16 + body.length;
  assert.equal(recLen % 4, 0, 'DBN records are 4-byte aligned');
  const buf = Buffer.alloc(recLen);
  buf[0] = recLen / 4;
  buf[1] = rtype;
  buf.writeUInt16LE(1, 2); // publisherId
  buf.writeUInt32LE(instrumentId, 4);
  buf.writeBigUInt64LE(BigInt(tsEventMs) * 1_000_000n, 8);
  body.copy(buf, 16);
  return buf;
}

/** 48-byte TradesMsg body (DBN v3): price@0, size@8, action@12, side@13, flags@14, channel@15, ts_recv@16, ts_in_delta@24, sequence@28. */
function tradesBody(opts: {
  price: bigint;
  size: number;
  action: string;
  side: string;
  sequence: number;
}): Buffer {
  const body = Buffer.alloc(32);
  body.writeBigInt64LE(opts.price, 0);
  body.writeUInt32LE(opts.size, 8);
  body.writeUInt8(opts.action.charCodeAt(0), 12);
  body.writeUInt8(opts.side.charCodeAt(0), 13);
  body.writeUInt8(0, 14); // flags
  body.writeUInt8(1, 15); // channel_id
  body.writeBigUInt64LE(BigInt(1_790_568_560_900) * 1_000_000n, 16); // ts_recv
  body.writeInt32LE(0, 24); // ts_in_delta
  body.writeUInt32LE(opts.sequence, 28);
  return body;
}

/** A real 48-byte TradesMsg captured from GLBX.MDP3 on 2026-09-28 (ES.c.0, price 7778.5). */
const REAL_TRADE_RECORD_HEX =
  '0c0001000c280000bb2318077961d91800b9ba12130700000200000054420000a4771c077961d918c13c000011ee1100';

/** Mbp1/Mbp10 prefix: price@16, size@24, flags@28, channel@29, action@30, side@31, ts_recv@32, sequence@44. */
function mbpPrefix(opts: {
  price: bigint;
  size: number;
  action: string;
  side: string;
  sequence: number;
  levels: number;
}): Buffer {
  const body = Buffer.alloc(32 + opts.levels * 32);
  body.writeBigInt64LE(opts.price, 0);
  body.writeUInt32LE(opts.size, 8);
  body.writeUInt8(0, 12); // flags
  body.writeUInt8(1, 13); // channel_id
  body.writeUInt8(opts.action.charCodeAt(0), 14);
  body.writeUInt8(opts.side.charCodeAt(0), 15);
  body.writeBigUInt64LE(BigInt(1_790_568_560_900) * 1_000_000n, 16); // ts_recv
  body.writeInt32LE(0, 24); // ts_in_delta
  body.writeUInt32LE(opts.sequence, 28);
  return body;
}

function writeLevel(body: Buffer, index: number, bidPx: bigint, askPx: bigint, bidSz: number, askSz: number): void {
  const offset = 32 + index * 32;
  body.writeBigInt64LE(bidPx, offset);
  body.writeBigInt64LE(askPx, offset + 8);
  body.writeUInt32LE(bidSz, offset + 16);
  body.writeUInt32LE(askSz, offset + 20);
  body.writeUInt32LE(1, offset + 24); // bid_ct
  body.writeUInt32LE(1, offset + 28); // ask_ct
}

const FIXED = 5_845_250_000_000n; // 5845.25 at the DBN 1e-9 price scale

export async function runDatabentoDbnTests(): Promise<void> {
  console.log('[unit/databentoDbn.test] Running Databento DBN decoding unit tests...');

  // 1. Gateway + CRAM handshake (verified against the live gateway: plain TCP, challenge|key).
  assert.equal(determineDatabentoGateway('GLBX.MDP3'), 'glbx-mdp3.lsg.databento.com');
  const authLine = buildCramAuthResponse('challenge-abc', 'db-TESTKEY1234567890', 'GLBX.MDP3');
  assert.match(authLine, /^auth=[0-9a-f]{64}-67890\|dataset=GLBX\.MDP3\|encoding=dbn\|ts_out=0\|compression=none\|client=/);
  assert.ok(authLine.endsWith('\n'));

  // 2. Trades arrive as 48-byte TradesMsg records; verified against a REAL captured record.
  const realRecord = Buffer.from(REAL_TRADE_RECORD_HEX, 'hex');
  const realParsed = parseDbnRecord(realRecord).parsed!;
  assert.equal(realParsed.trade?.price, 7778.5, 'real ES trade price from offset 16');
  assert.equal(realParsed.trade?.size, 2, 'real ES trade size from offset 24');
  assert.equal(realParsed.trade?.side, 'BUY', "side 'B' = buy aggressor");
  assert.equal(realParsed.instrumentId, 10252, 'instrument id from the record header');
  assert.equal(realParsed.trade?.ts, Math.floor(Number(realRecord.readBigUInt64LE(8) / 1_000_000n)));

  const tradeRecord = dbnRecord(DBN.RTYPE_TRADES, tradesBody({ price: FIXED, size: 3, action: 'T', side: 'B', sequence: 42 }));
  const trade = parseDbnRecord(tradeRecord).parsed!;
  assert.equal(trade.trade?.price, 5845.25, 'price comes from offset 16 of the record');
  assert.equal(trade.trade?.size, 3);
  assert.equal(trade.trade?.side, 'BUY', "side 'B' = buy aggressor");
  assert.equal(trade.trade?.ts, 1_790_568_560_923);
  assert.equal(trade.trade?.aggressorProvenance, 'EXCHANGE_NATIVE');
  assert.equal(trade.depth, undefined);

  // 3. Non-execution rows (add/cancel/modify/reset) must never become trades.
  for (const action of ['A', 'C', 'M', 'R', 'F']) {
    const row = parseDbnRecord(
      dbnRecord(DBN.RTYPE_TRADES, tradesBody({ price: FIXED, size: 5, action, side: 'A', sequence: 7 }))
    ).parsed!;
    assert.equal(row.trade, undefined, `action '${action}' is not a trade`);
  }

  // 4. MBP-1: top-of-book snapshot plus the embedded trade.
  const mbp1 = mbpPrefix({ price: FIXED, size: 2, action: 'T', side: 'A', sequence: 99, levels: 1 });
  writeLevel(mbp1, 0, FIXED - 250_000_000n, FIXED + 250_000_000n, 11, 7);
  const mbp1Record = parseDbnRecord(dbnRecord(DBN.RTYPE_MBP1, mbp1)).parsed!;
  const mbp1Depth = mbp1Record.depth;
  assert.ok(mbp1Depth && mbp1Depth.kind === 'snapshot');
  assert.deepEqual(mbp1Depth.bids, [{ price: 5845.0, size: 11 }]);
  assert.deepEqual(mbp1Depth.asks, [{ price: 5845.5, size: 7 }]);
  assert.equal(mbp1Depth.updateId, 99);
  assert.equal(mbp1Record.trade?.side, 'SELL', "side 'A' = sell aggressor");

  // 5. MBP-10: ten levels per side taken from the 32-byte BidAskPair layout.
  const mbp10 = mbpPrefix({ price: 0n, size: 0, action: 'A', side: 'N', sequence: 5, levels: 10 });
  for (let i = 0; i < 10; i++) {
    writeLevel(mbp10, i, FIXED - BigInt(250_000_000 * (i + 1)), FIXED + BigInt(250_000_000 * (i + 1)), 10 + i, 20 + i);
  }
  const mbp10Record = parseDbnRecord(dbnRecord(DBN.RTYPE_MBP10, mbp10)).parsed!;
  const mbp10Depth = mbp10Record.depth;
  assert.ok(mbp10Depth && mbp10Depth.kind === 'snapshot');
  assert.equal(mbp10Depth.bids.length, 10);
  assert.equal(mbp10Depth.asks.length, 10);
  assert.equal(mbp10Depth.asks[0].price, 5845.5);
  assert.equal(mbp10Depth.bids[9].size, 19);
  assert.equal(mbp10Record.trade, undefined, 'zero price/size rows are not trades');

  // 6. Undefined sentinels (empty book / no trade) are dropped, never published as numbers.
  const undefRecord = parseDbnRecord(
    dbnRecord(
      DBN.RTYPE_MBP1,
      mbpPrefix({ price: DBN.UNDEF_PRICE, size: DBN.UNDEF_SIZE, action: 'T', side: 'A', sequence: 1, levels: 1 })
    )
  ).parsed!;
  assert.equal(undefRecord.depth, undefined);
  assert.equal(undefRecord.trade, undefined);

  // 7. Control records (subscription acks, symbol mappings) carry ASCII payloads.
  const controlBody = Buffer.alloc(8);
  controlBody.write('success', 0, 'ascii');
  const control = parseDbnRecord(dbnRecord(0x17, controlBody)).parsed!;
  assert.equal(control.control, 'success');
  assert.equal(control.trade, undefined);

  // 8. Fragmented buffers report the needed length instead of mis-decoding.
  const partial = parseDbnRecord(tradeRecord.subarray(0, 20));
  assert.equal(partial.parsed, null);
  assert.equal(partial.recLen, tradeRecord.length);

  // 9. Symbol resolution: continuous front month by default, overridable, parent form supported.
  assert.deepEqual(resolveDatabentoSymbol('ES'), { vendorSymbol: 'ES.c.0', stypeIn: 'continuous' });
  assert.deepEqual(resolveDatabentoSymbol('NQ', { symbols: 'NQZ6' }), { vendorSymbol: 'NQZ6', stypeIn: 'continuous' });
  assert.deepEqual(resolveDatabentoSymbol('CL', { symbols: 'CL.FUT' }), { vendorSymbol: 'CL.FUT', stypeIn: 'parent' });

  console.log('  [PASS] All Databento DBN decoding unit tests passed.');
}

