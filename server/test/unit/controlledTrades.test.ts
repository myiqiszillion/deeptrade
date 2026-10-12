import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import net from 'node:net';
import { ControlledTradesSession } from '../../src/acceptance/controlledTrades.js';

function record(i: number, side = 'N', size = 2): Buffer {
  const b = Buffer.alloc(48); b[0] = 12; b.writeUInt32LE(10252, 4);
  b.writeBigUInt64LE(BigInt(1791804548000 + i) * 1000000n, 8);
  b.writeBigInt64LE(BigInt(786400 + i % 3 * 25) * 10000000n, 16);
  b.writeUInt32LE(size, 24); b[28] = 84; b[29] = side.charCodeAt(0);
  b.writeBigUInt64LE(BigInt(1791804548000 + i) * 1000000n + 20n, 32);
  b.writeUInt32LE(100 + i * 10, 44); return b;
}
function admin(error = false): Buffer {
  const b = Buffer.alloc(320); b[0] = 80; b[1] = error ? 21 : 23;
  b.write(error ? 'denied' : 'subscribed', 16); b[319] = 1; return b;
}
class Socket extends EventEmitter {
  destroyed = false; writes: string[] = [];
  write(data: string) { this.writes.push(data); return true; }
  destroy() { this.destroyed = true; this.emit('close'); return this; }
}
export async function runControlledTradesTests() {
  let count = 0;
  async function run(records: Buffer[], opts: { ack?: boolean; error?: boolean; cap?: number; close?: boolean } = {}) {
    const socket = new Socket(); let connections = 0;
    const messages: ReturnType<ControlledTradesSession['message']>[] = [];
    const session = new ControlledTradesSession({ apiKey: 'fixture-key', instrumentId: 10252, resolvedContract: 'ESZ6',
      offline: true, durationMs: 20, maxRecords: opts.cap ?? 50,
      createConnection: (() => { connections++; return socket; }) as unknown as typeof net.createConnection,
      publish: m => { messages.push(m); },
    });
    await session.start();
    socket.emit('data', Buffer.from('cram=test\n')); socket.emit('data', Buffer.from('success=1\n'));
    const header = Buffer.alloc(128); header.write('DBN'); header[3] = 3; header.writeUInt32LE(120, 4);
    socket.emit('data', Buffer.concat([header, ...(opts.ack === false ? [] : [admin()]), ...(opts.error ? [admin(true)] : []), ...records]));
    if (opts.close) socket.destroy();
    await session.done;
    assert.equal(connections, 1);
    assert.equal(socket.writes.filter(w => w.startsWith('schema=')).length, 1);
    assert.equal(socket.writes.find(w => w.startsWith('schema=')), 'schema=trades|stype_in=continuous|symbols=ES.c.0|snapshot=0|is_last=1\n');
    assert(socket.destroyed);
    const finals = messages.filter(m => m.final); assert.equal(finals.length, 1);
    const before = socket.writes.length; session.finish();
    await assert.rejects(session.start());
    await session.context.backfillHistory(); await session.context.ensureHistoryBars('1m'); await session.context.refreshGex();
    assert.equal(socket.writes.length, before); assert.equal(session.context.getHistorySource(), 'NONE');
    await session.context.dispose(); count++;
    return { session, messages, final: finals[0] };
  }
  const cap = await run(Array.from({ length: 60 }, (_, i) => record(i)));
  assert.equal(cap.session.traces.length, 50); assert.equal(cap.final.acceptedCount, 50); assert.equal(cap.session.reason, 'RECORD_CAP');
  assert.equal(cap.final.acceptedVolume, 100); assert.equal(cap.final.snapshot.profile.totalVolume, 100);
  assert.equal(cap.final.unknownVolume, 100); assert.equal(cap.final.snapshot.bars.at(-1)?.cvd, 0);
  assert.equal(cap.final.snapshot.profile.coverage, 'PARTIAL');
  assert.equal(cap.final.source, 'OFFLINE_FIXTURE');
  const mixed = await run([record(0, 'B', 2), record(1, 'A', 3), record(2, 'N', 4)]);
  assert.deepEqual(mixed.final.signedContributions, [2, -3, 0]);
  assert.equal(mixed.final.acceptedVolume, 9); assert.equal(mixed.final.snapshot.bars[0].cvd, -1);
  assert.equal(mixed.final.snapshot.bars[0].buyVolume, 2); assert.equal(mixed.final.snapshot.bars[0].sellVolume, 3);
  assert.equal(mixed.final.snapshot.profile.totalVolume, 9);
  assert.deepEqual([mixed.final.snapshot.bars[0].open, mixed.final.snapshot.bars[0].high, mixed.final.snapshot.bars[0].low, mixed.final.snapshot.bars[0].close], [7864, 7864.5, 7864, 7864.5]);
  assert.equal(mixed.session.reason, 'TIMEOUT'); assert(mixed.final.elapsedMs >= 15);
  const duplicate = await run([record(0), record(0)]); assert.equal(duplicate.final.acceptedCount, 1); assert.equal(duplicate.session.traces[1].outcome, 'DEDUPLICATED');
  const invalid = record(0); invalid.writeUInt32LE(0, 24);
  const reject = await run([invalid], { cap: 1 }); assert.equal(reject.session.traces.length, 1); assert.equal(reject.final.acceptedCount, 0);
  const noAck = await run([], { ack: false }); assert.equal(noAck.session.reason, 'NO_ACK_TIMEOUT'); assert.equal(noAck.session.state, 'FAILED');
  const zero = await run([]); assert.equal(zero.session.reason, 'ZERO_RECORDS_TIMEOUT');
  const error = await run([], { error: true }); assert.equal(error.session.reason, 'Gateway ErrorMsg');
  assert.equal(error.final.gatewayErrors, 1);
  const closed = await run([], { close: true }); assert.equal(closed.session.reason, 'Unexpected socket close');
  const early = await run([record(1)], { ack: false }); assert.equal(early.session.reason, 'Market record before ACK'); assert.equal(early.final.acceptedCount, 0);
  const wrong = record(0); wrong.writeUInt32LE(999, 4);
  const mapped = await run([wrong]); assert.equal(mapped.session.reason, 'Instrument mismatch');
  const firstSocket = new Socket(); let forbiddenConnections = 0;
  const first = new ControlledTradesSession({ apiKey: 'fixture', instrumentId: 10252, resolvedContract: 'ESZ6', offline: true, durationMs: 20,
    createConnection: (() => firstSocket) as unknown as typeof net.createConnection });
  const second = new ControlledTradesSession({ apiKey: 'fixture', instrumentId: 10252, resolvedContract: 'ESZ6', offline: true,
    createConnection: (() => { forbiddenConnections++; return new Socket(); }) as unknown as typeof net.createConnection });
  await first.start(); await assert.rejects(second.start()); assert.equal(forbiddenConnections, 0);
  first.finish(); await first.done; await first.context.dispose(); await second.context.dispose();
  assert.throws(() => new ControlledTradesSession({ apiKey: 'x', instrumentId: 10252, resolvedContract: 'ESZ6', durationMs: 30001 }));
  console.log(`PASS Controlled Trades: ${count} independent offline sessions; no network, no history/GEX, cap/timeout/cleanup/UNKNOWN/duplicate/OHLCV`);
}
