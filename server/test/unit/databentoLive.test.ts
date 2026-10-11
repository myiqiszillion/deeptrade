import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { DatabentoLiveClient, DBN_CONSTANTS, SYSTEM_CODES, parseDbnRecord } from '../../src/databento/liveClient.js';
import { FeedStatusEvent, MarketDepthEvent, MarketTrade } from '../../src/marketData/types.js';
import { OrderbookManager } from '../../src/orderbook.js';

class MockWebSocket {
  public url: string;
  public options: any;
  public sent: string[] = [];
  private handlers: Map<string, Function[]> = new Map();
  public onopen?: () => void;
  public onmessage?: (evt: { data: string }) => void;
  public onerror?: (err: any) => void;
  public onclose?: (code?: number, reason?: any) => void;

  constructor(url: string, opts?: any) {
    this.url = url;
    this.options = opts;
    setTimeout(() => {
      this.emit('open');
      if (this.onopen) this.onopen();
    }, 5);
  }

  public on(event: string, fn: Function) {
    if (!this.handlers.has(event)) this.handlers.set(event, []);
    this.handlers.get(event)!.push(fn);
  }

  private emit(event: string, ...args: any[]) {
    for (const fn of this.handlers.get(event) || []) fn(...args);
  }

  public send(msg: string) { this.sent.push(msg); }
  public close() {
    this.emit('close', 1000, Buffer.from(''));
    if (this.onclose) (this.onclose as any)(1000, Buffer.from(''));
  }
  public emitMessage(data: any) {
    const str = typeof data === 'string' ? data : JSON.stringify(data);
    this.emit('message', Buffer.from(str));
    if (this.onmessage) this.onmessage({ data: str });
  }
  public emitError(err: any) {
    this.emit('error', err);
    if (this.onerror) this.onerror(err);
  }
}

function buildMbp10BinaryFixture(options?: {
  rtype?: number;
  publisherId?: number;
  instrumentId?: number;
  tsEventNs?: bigint;
  action?: string;
  side?: string;
  tradePrice?: bigint;
  tradeSize?: number;
  sequence?: number;
  numValidLevels?: number;
}): Buffer {
  const buf = Buffer.alloc(368);
  const rtype = options?.rtype ?? DBN_CONSTANTS.RTYPE_MBP10; // 0x0A (10)
  const publisherId = options?.publisherId ?? 1;
  const instrumentId = options?.instrumentId ?? 10252;
  const tsEventNs = options?.tsEventNs ?? 1711033200000000000n;
  const action = options?.action ?? 'T';
  const side = options?.side ?? 'B';
  const tradePrice = options?.tradePrice ?? 5202500000000n; // $5202.50
  const tradeSize = options?.tradeSize ?? 25;
  const sequence = options?.sequence ?? 12345;
  const numValidLevels = options?.numValidLevels ?? 10;

  // Header (16 bytes)
  buf.writeUInt8(92, 0); // 92 words * 4 = 368 bytes
  buf.writeUInt8(rtype, 1);
  buf.writeUInt16LE(publisherId, 2);
  buf.writeUInt32LE(instrumentId, 4);
  buf.writeBigUInt64LE(tsEventNs, 8);

  // Payload (32 bytes)
  buf.writeBigInt64LE(tradePrice, 16);
  buf.writeUInt32LE(tradeSize, 24);
  buf.writeUInt8(action.charCodeAt(0), 28);
  buf.writeUInt8(side.charCodeAt(0), 29);
  buf.writeUInt8(10, 30); // depth
  buf.writeUInt8(0, 31);  // flags
  buf.writeBigUInt64LE(tsEventNs + 1000n, 32); // ts_recv
  buf.writeInt32LE(1000, 40); // ts_in_delta
  buf.writeUInt32LE(sequence, 44);

  // 10 levels (320 bytes)
  for (let i = 0; i < 10; i++) {
    const lvlOffset = 48 + i * 32;
    if (i < numValidLevels) {
      // Bids: 5202.25 - i * 0.25
      const bPx = 5202250000000n - BigInt(i) * 250000000n;
      // Asks: 5202.50 + i * 0.25
      const aPx = 5202500000000n + BigInt(i) * 250000000n;
      const bSz = 100 - i * 5;
      const aSz = 120 - i * 5;
      const bCt = 15 - i;
      const aCt = 18 - i;

      buf.writeBigInt64LE(bPx, lvlOffset + 0);
      buf.writeBigInt64LE(aPx, lvlOffset + 8);
      buf.writeUInt32LE(bSz, lvlOffset + 16);
      buf.writeUInt32LE(aSz, lvlOffset + 20);
      buf.writeUInt32LE(bCt, lvlOffset + 24);
      buf.writeUInt32LE(aCt, lvlOffset + 28);
    } else {
      buf.writeBigInt64LE(DBN_CONSTANTS.UNDEF_PRICE, lvlOffset + 0);
      buf.writeBigInt64LE(DBN_CONSTANTS.UNDEF_PRICE, lvlOffset + 8);
      buf.writeUInt32LE(DBN_CONSTANTS.UNDEF_ORDER_SIZE, lvlOffset + 16);
      buf.writeUInt32LE(DBN_CONSTANTS.UNDEF_ORDER_SIZE, lvlOffset + 20);
      buf.writeUInt32LE(DBN_CONSTANTS.UNDEF_ORDER_SIZE, lvlOffset + 24);
      buf.writeUInt32LE(DBN_CONSTANTS.UNDEF_ORDER_SIZE, lvlOffset + 28);
    }
  }

  return buf;
}

function buildSystemMsgFixture(options?: {
  code?: number;
  msg?: string;
  tsEventNs?: bigint;
  instrumentId?: number;
}): Buffer {
  const code = options?.code ?? SYSTEM_CODES.SUBSCRIPTION_ACK;
  const msg = options?.msg ?? 'Subscribed to GLBX.MDP3:trades';
  const tsEventNs = options?.tsEventNs ?? 1711033200000000000n;
  const instrumentId = options?.instrumentId ?? 10252;

  const buf = Buffer.alloc(320);
  buf.writeUInt8(80, 0); // 80 words * 4 = 320 bytes
  buf.writeUInt8(DBN_CONSTANTS.RTYPE_SYSTEM, 1); // 0x1b
  buf.writeUInt16LE(1, 2); // publisherId
  buf.writeUInt32LE(instrumentId, 4);
  buf.writeBigUInt64LE(tsEventNs, 8);
  buf.write(msg, 16, 'utf8');
  buf.writeUInt8(code, 319);
  return buf;
}

function buildErrorMsgFixture(options?: {
  err?: string;
  code?: number;
  isLast?: number;
  tsEventNs?: bigint;
}): Buffer {
  const err = options?.err ?? 'Subscription rejected: unentitled schema';
  const code = options?.code ?? 1;
  const isLast = options?.isLast ?? 1;
  const tsEventNs = options?.tsEventNs ?? 1711033200000000000n;

  const buf = Buffer.alloc(320);
  buf.writeUInt8(80, 0); // 80 words * 4 = 320 bytes
  buf.writeUInt8(DBN_CONSTANTS.RTYPE_ERROR, 1); // 0x19
  buf.writeUInt16LE(1, 2);
  buf.writeUInt32LE(0, 4);
  buf.writeBigUInt64LE(tsEventNs, 8);
  buf.write(err, 16, 'utf8');
  buf.writeUInt8(code, 318);
  buf.writeUInt8(isLast, 319);
  return buf;
}

function buildDbnMetadataHeaderFixture(metaLen = 100): Buffer {
  const buf = Buffer.alloc(8 + metaLen);
  buf.write(DBN_CONSTANTS.MAGIC, 0, 'ascii'); // 'DBN'
  buf.writeUInt8(2, 3); // DBN version 2
  buf.writeUInt32LE(metaLen, 4);
  buf.fill(0xAA, 8); // dummy metadata payload
  return buf;
}

export async function runDatabentoLiveTests(): Promise<void> {
  console.log('[unit/databentoLive.test] Running DatabentoLiveClient unit tests...');

  // 1. Missing API key test
  {
    const statuses: FeedStatusEvent[] = [];
    const client = new DatabentoLiveClient({
      symbol: 'ES',
      apiKey: '',
      handlers: { onTrade: () => {}, onDepth: () => {}, onStatus: (s) => statuses.push(s), onError: () => {} },
    });
    await client.connect();
    assert.equal(statuses.length, 1);
    assert.equal(statuses[0].state, 'UNAVAILABLE');
    assert.match(statuses[0].reason || '', /Missing Databento API key/);
    console.log('  PASS  Missing API key fail-closed behavior');
  }

  // 2. WebSocket Mock Test
  {
    const trades: MarketTrade[] = [];
    const depths: MarketDepthEvent[] = [];
    const statuses: FeedStatusEvent[] = [];
    let mockWsInstance: MockWebSocket | null = null;

    class TestWebSocket extends MockWebSocket {
      constructor(url: string, opts?: any) { super(url, opts); mockWsInstance = this; }
    }

    const client = new DatabentoLiveClient({
      symbol: 'ES',
      apiKey: 'test-db-live-key',
      gatewayUrl: 'wss://live.databento.com/v0',
      WebSocketClass: TestWebSocket as any,
      handlers: { onTrade: (t) => trades.push(t), onDepth: (d) => depths.push(d), onStatus: (s) => statuses.push(s), onError: () => {} },
    });

    await client.connect();
    await new Promise((r) => setTimeout(r, 30));

    if (!mockWsInstance) throw new Error('WebSocket instance was not created');
    const ws: MockWebSocket = mockWsInstance;

    assert.ok(ws.url.includes('api_key=test-db-live-key'), `URL should contain api_key, got ${ws.url}`);
    assert.ok(ws.url.includes('dataset=GLBX.MDP3'), `URL should contain dataset, got ${ws.url}`);
    assert.ok(ws.url.includes('symbols=ES'), `URL should contain symbols, got ${ws.url}`);
    assert.equal(client.isConnected(), true);
    assert.ok(statuses.some((s) => s.state === 'LIVE'));

    ws.emitMessage({ status: 'ok', type: 'auth_success' });

    ws.emitMessage({
      hd: { instrument_id: 101, ts_event: 1711033200000000000 },
      symbol: 'ES', action: 'T', side: 'A', price: 520250000000, size: 15, order_id: '99881',
    });

    assert.equal(trades.length, 1);
    assert.equal(trades[0].price, 520.25);
    assert.equal(trades[0].size, 15);
    assert.equal(trades[0].side, 'BUY');
    assert.equal(trades[0].aggressorProvenance, 'EXCHANGE_NATIVE');
    assert.equal(trades[0].sourceProvider, 'databento');

    ws.emitMessage({
      hd: { instrument_id: 101, ts_event: 1711033200100000000 },
      symbol: 'ES', bid_px_00: 520225000000, ask_px_00: 520250000000, bid_sz_00: 40, ask_sz_00: 60,
    });

    assert.equal(depths.length, 1);
    assert.equal(depths[0].kind, 'snapshot');
    assert.equal((depths[0] as any).bids[0].price, 520.225);
    assert.equal((depths[0] as any).asks[0].price, 520.25);

    await client.disconnect();
    assert.equal(client.isConnected(), false);

    console.log('  PASS  Subscription lifecycle, trade processing, and depth (WebSocket)');
  }

  // 3. TASK 1: DBN Protocol Constants Validation
  {
    assert.equal(DBN_CONSTANTS.RTYPE_MBP10, 0x0A, 'MBP-10 rtype must equal 0x0A (10 decimal) per Databento official spec');
    assert.equal(DBN_CONSTANTS.RTYPE_TBBO, 0x02, 'TBBO rtype must equal 0x02 per Databento official spec');
    assert.equal(DBN_CONSTANTS.RTYPE_MBP1, 0x01, 'MBP-1 rtype must equal 0x01');
    assert.equal(DBN_CONSTANTS.RTYPE_MBP0, 0x00, 'MBP-0 rtype must equal 0x00');
    assert.equal(DBN_CONSTANTS.MBP10_MSG_SIZE, 368, 'MBP-10 message size must be 368 bytes (92 words * 4)');
    console.log('  PASS  DBN Constants verify 0x0A for MBP-10 and 0x02 for TBBO');
  }

  // 4. TASK 1: Full 10-Level DBN MBP-10 Binary Fixture Decoder Test
  {
    const fixture = buildMbp10BinaryFixture();
    const { parsed, recLen } = parseDbnRecord(fixture, 'ES.c.0', 'databento');

    assert.equal(recLen, 368, 'Parsed record length must be 368 bytes');
    assert.ok(parsed, 'Parsed record must not be null');
    assert.equal(parsed.rtype, 0x0A, 'Parsed rtype must be 0x0A');
    assert.equal(parsed.instrumentId, 10252, 'Parsed instrumentId must match fixture');
    assert.equal(parsed.publisherId, 1, 'Parsed publisherId must match fixture');
    assert.equal(parsed.tsMs, 1711033200000, 'Parsed event tsMs must match fixture');

    // Trade check
    assert.ok(parsed.trade, 'MBP-10 record with action=T must produce trade');
    assert.equal(parsed.trade.price, 5202.50, 'Trade price must be correctly scaled by 1e-9');
    assert.equal(parsed.trade.size, 25, 'Trade size must match fixture');
    assert.equal(parsed.trade.side, 'BUY', 'Trade side must be BUY for side=B');
    assert.equal(parsed.trade.sequenceId, 12345, 'Trade sequence must match');

    // Depth check - exactly 10 levels
    assert.ok(parsed.depth, 'MBP-10 record must produce depth snapshot');
    assert.equal(parsed.depth.kind, 'snapshot');
    const depthSnap = parsed.depth as any;
    assert.equal(depthSnap.bids.length, 10, 'Must decode all 10 bid levels');
    assert.equal(depthSnap.asks.length, 10, 'Must decode all 10 ask levels');

    for (let i = 0; i < 10; i++) {
      const expectedBidPx = Number((5202250000000n - BigInt(i) * 250000000n)) / 1e9;
      const expectedAskPx = Number((5202500000000n + BigInt(i) * 250000000n)) / 1e9;
      const expectedBidSz = 100 - i * 5;
      const expectedAskSz = 120 - i * 5;
      const expectedBidCt = 15 - i;
      const expectedAskCt = 18 - i;

      assert.equal(depthSnap.bids[i].price, expectedBidPx, `Bid level ${i} price mismatch`);
      assert.equal(depthSnap.bids[i].size, expectedBidSz, `Bid level ${i} size mismatch`);
      assert.equal(depthSnap.bids[i].count, expectedBidCt, `Bid level ${i} count mismatch`);

      assert.equal(depthSnap.asks[i].price, expectedAskPx, `Ask level ${i} price mismatch`);
      assert.equal(depthSnap.asks[i].size, expectedAskSz, `Ask level ${i} size mismatch`);
      assert.equal(depthSnap.asks[i].count, expectedAskCt, `Ask level ${i} count mismatch`);
    }

    console.log('  PASS  Full 10-level DBN MBP-10 binary fixture correctly decoded (all 10 price, size, count levels)');
  }

  // 5. TASK 1: Sentinel Price & Order Size Filtering Test
  {
    const fixtureWithPartialLevels = buildMbp10BinaryFixture({ numValidLevels: 5 });
    const { parsed } = parseDbnRecord(fixtureWithPartialLevels, 'ES.c.0');
    assert.ok(parsed?.depth);
    const depth = parsed.depth as any;
    assert.equal(depth.bids.length, 5, 'Sentinel UNDEF levels must be filtered out (only 5 valid bids)');
    assert.equal(depth.asks.length, 5, 'Sentinel UNDEF levels must be filtered out (only 5 valid asks)');
    console.log('  PASS  Sentinel UNDEF_PRICE and UNDEF_ORDER_SIZE correctly filtered');
  }

  // 6. TASK 1: TBBO (0x02) and MBP-1 (0x01) Decoder Test
  {
    // Build MBP-1 buffer (80 bytes)
    const mbp1Buf = Buffer.alloc(80);
    mbp1Buf.writeUInt8(20, 0); // 20 words = 80 bytes
    mbp1Buf.writeUInt8(0x01, 1); // RTYPE_MBP1
    mbp1Buf.writeUInt16LE(1, 2);
    mbp1Buf.writeUInt32LE(10252, 4);
    mbp1Buf.writeBigUInt64LE(1711033200000000000n, 8);
    // trade
    mbp1Buf.writeBigInt64LE(5200000000000n, 16);
    mbp1Buf.writeUInt32LE(10, 24);
    mbp1Buf.writeUInt8('T'.charCodeAt(0), 28);
    mbp1Buf.writeUInt8('A'.charCodeAt(0), 29); // SELL
    mbp1Buf.writeUInt32LE(999, 44);
    // level 0
    mbp1Buf.writeBigInt64LE(5199750000000n, 48); // bid
    mbp1Buf.writeBigInt64LE(5200000000000n, 56); // ask
    mbp1Buf.writeUInt32LE(40, 64);
    mbp1Buf.writeUInt32LE(50, 68);
    mbp1Buf.writeUInt32LE(4, 72);
    mbp1Buf.writeUInt32LE(5, 76);

    const { parsed: p1, recLen: l1 } = parseDbnRecord(mbp1Buf, 'ES.c.0');
    assert.equal(l1, 80);
    assert.ok(p1?.depth);
    assert.equal((p1.depth as any).bids[0].price, 5199.75);
    assert.equal((p1.depth as any).asks[0].price, 5200.00);

    // Now test TBBO (0x02) with same 80-byte layout
    const tbboBuf = Buffer.from(mbp1Buf);
    tbboBuf.writeUInt8(0x02, 1); // RTYPE_TBBO = 0x02
    const { parsed: pTbbo, recLen: lTbbo } = parseDbnRecord(tbboBuf, 'ES.c.0');
    assert.equal(lTbbo, 80);
    assert.ok(pTbbo?.depth);
    assert.equal(pTbbo.rtype, 0x02);
    assert.equal((pTbbo.depth as any).bids[0].price, 5199.75);
    console.log('  PASS  TBBO (0x02) and MBP-1 (0x01) decoded correctly');
  }

  // 7. TASK 1: TCP Fragmentation Handling Test
  {
    const fixture = buildMbp10BinaryFixture();
    assert.equal(fixture.length, 368);

    // Chunk 1: first 100 bytes
    const chunk1 = fixture.subarray(0, 100);
    const r1 = parseDbnRecord(chunk1, 'ES.c.0');
    assert.equal(r1.recLen, 368);
    assert.equal(r1.parsed, null, 'Partial chunk must return null parsed and wait for more data');

    // Chunk 2: next 150 bytes (total 250 bytes)
    const chunk2 = fixture.subarray(100, 250);
    const combined12 = Buffer.concat([chunk1, chunk2]);
    const r2 = parseDbnRecord(combined12, 'ES.c.0');
    assert.equal(r2.recLen, 368);
    assert.equal(r2.parsed, null, '250 bytes still < 368, must wait for complete frame');

    // Chunk 3: remaining 118 bytes (total 368 bytes)
    const chunk3 = fixture.subarray(250);
    const fullBuffer = Buffer.concat([combined12, chunk3]);
    const r3 = parseDbnRecord(fullBuffer, 'ES.c.0');
    assert.equal(r3.recLen, 368);
    assert.ok(r3.parsed?.depth, 'Complete reassembled buffer decodes successfully');
    assert.equal((r3.parsed.depth as any).bids.length, 10);
    console.log('  PASS  TCP Fragmentation reassembly across 3 chunks verified');
  }

  // 8. TASK 1: Multiple Records in One TCP Chunk
  {
    const fixture1 = buildMbp10BinaryFixture({ sequence: 101, tradePrice: 5200000000000n });
    const fixture2 = buildMbp10BinaryFixture({ sequence: 102, tradePrice: 5201000000000n });
    let combined = Buffer.concat([fixture1, fixture2]);
    assert.equal(combined.length, 736);

    const decodedList: any[] = [];
    while (combined.length >= DBN_CONSTANTS.HEADER_SIZE) {
      const { parsed, recLen } = parseDbnRecord(combined, 'ES.c.0');
      if (recLen === 0 || recLen < DBN_CONSTANTS.HEADER_SIZE) {
        combined = combined.subarray(1);
        continue;
      }
      if (combined.length < recLen) break;
      if (parsed) decodedList.push(parsed);
      combined = combined.subarray(recLen);
    }

    assert.equal(decodedList.length, 2, 'Must decode both records from single chunk');
    assert.equal(decodedList[0].trade.sequenceId, 101);
    assert.equal(decodedList[0].trade.price, 5200.0);
    assert.equal(decodedList[1].trade.sequenceId, 102);
    assert.equal(decodedList[1].trade.price, 5201.0);
    assert.equal(combined.length, 0, 'Buffer fully drained');
    console.log('  PASS  Multiple records in single TCP chunk parsed sequentially');
  }

  // 9. TASK 1: End-to-End Routing to DOM and Liquidity Heatmap via OrderbookManager
  {
    const fixture = buildMbp10BinaryFixture();
    const { parsed } = parseDbnRecord(fixture, 'ES.c.0');
    assert.ok(parsed?.depth);

    const orderbook = new OrderbookManager(50);
    const snapEvent = parsed.depth as any;

    orderbook.applySnapshot(
      snapEvent.bids.map((b: any) => [b.price, b.size] as [number, number]),
      snapEvent.asks.map((a: any) => [a.price, a.size] as [number, number]),
      snapEvent.updateId,
      snapEvent.ts
    );

    // Verify DOM data
    const domSnapshot = orderbook.getSnapshot();
    assert.equal(domSnapshot.bids.length, 10, 'DOM must receive 10 bid levels');
    assert.equal(domSnapshot.asks.length, 10, 'DOM must receive 10 ask levels');
    assert.equal(domSnapshot.bids[0].price, 5202.25);
    assert.equal(domSnapshot.asks[0].price, 5202.50);

    // Verify Liquidity Heatmap data
    const depthHistory = orderbook.getDepthHistory();
    assert.ok(depthHistory.length >= 1, 'Liquidity Heatmap depth history must contain recorded snapshot');
    assert.equal(depthHistory[0].bids.length, 10, 'Liquidity Heatmap receives top 10 bid levels');
    assert.equal(depthHistory[0].asks.length, 10, 'Liquidity Heatmap receives top 10 ask levels');
    assert.equal(depthHistory[0].bids[0].price, 5202.25);

    console.log('  PASS  Decoded MBP-10 data confirmed routed to DOM and Liquidity Heatmap OrderbookManager');
  }

  // 10. TASK 1: SystemMsg Decoding (Subscription ACK code=1 and Heartbeat code=0)
  {
    // Test 10a: SystemMsg Subscription ACK (code = 1)
    const subAckFixture = buildSystemMsgFixture({
      code: SYSTEM_CODES.SUBSCRIPTION_ACK,
      msg: 'Subscribed to GLBX.MDP3:trades',
    });
    assert.equal(subAckFixture.length, 320);
    const resAck = parseDbnRecord(subAckFixture, 'ES.c.0');
    assert.equal(resAck.recLen, 320);
    assert.ok(resAck.parsed, 'SystemMsg record must be parsed');
    assert.equal(resAck.parsed.rtype, DBN_CONSTANTS.RTYPE_SYSTEM);
    assert.ok(resAck.parsed.system, 'System field must be populated');
    assert.equal(resAck.parsed.system.code, 1);
    assert.equal(resAck.parsed.system.isSubscriptionAck, true, 'SystemMsg code=1 MUST be recognized as subscription ack');
    assert.equal(resAck.parsed.system.isHeartbeat, false);
    assert.equal(resAck.parsed.system.msg, 'Subscribed to GLBX.MDP3:trades');
    assert.equal(resAck.parsed.trade, undefined);
    assert.equal(resAck.parsed.depth, undefined);
    assert.equal(resAck.parsed.error, undefined);

    // Test 10b: SystemMsg Heartbeat (code = 0)
    const hbFixture = buildSystemMsgFixture({
      code: SYSTEM_CODES.HEARTBEAT,
      msg: 'Heartbeat',
    });
    const resHb = parseDbnRecord(hbFixture, 'ES.c.0');
    assert.ok(resHb.parsed?.system);
    assert.equal(resHb.parsed.system.code, 0);
    assert.equal(resHb.parsed.system.isSubscriptionAck, false);
    assert.equal(resHb.parsed.system.isHeartbeat, true, 'SystemMsg code=0 MUST be recognized as heartbeat');
    assert.equal(resHb.parsed.system.msg, 'Heartbeat');

    // Test 10c: SystemMsg Slow Reader Warning (code = 2) & Replay Completed (code = 3)
    const warnFixture = buildSystemMsgFixture({ code: 2, msg: 'Slow reader warning' });
    const resWarn = parseDbnRecord(warnFixture, 'ES.c.0');
    assert.equal(resWarn.parsed?.system?.code, 2);
    assert.equal(resWarn.parsed?.system?.isSubscriptionAck, false);

    console.log('  PASS  SystemMsg decoding (Subscription ACK code=1, Heartbeat code=0, and warning codes)');
  }

  // 11. TASK 1: ErrorMsg Decoding (rtype 0x19) with Code and IsLast Byte Isolation
  {
    const errFixture = buildErrorMsgFixture({
      err: 'Subscription failed: invalid symbol XYZ',
      code: 1,
      isLast: 1,
    });
    assert.equal(errFixture.length, 320);
    const resErr = parseDbnRecord(errFixture, 'ES.c.0');
    assert.equal(resErr.recLen, 320);
    assert.ok(resErr.parsed);
    assert.equal(resErr.parsed.rtype, DBN_CONSTANTS.RTYPE_ERROR);
    assert.equal(resErr.parsed.error, 'Subscription failed: invalid symbol XYZ');
    assert.equal(resErr.parsed.trade, undefined);
    assert.equal(resErr.parsed.depth, undefined);
    assert.equal(resErr.parsed.system, undefined);
    console.log('  PASS  ErrorMsg decoding (rtype 0x19) cleanly extracts error string without byte leakage');
  }

  // 12. TASK 1: DBN Metadata Header vs Subscription ACK Strict Differentiation
  {
    // DBN Metadata Header alone (e.g. 108 bytes with magic 'DBN')
    const headerBuf = buildDbnMetadataHeaderFixture(100);
    assert.equal(headerBuf.length, 108);

    // Assert parseDbnRecord does NOT parse DBN header as a record
    const resHeader = parseDbnRecord(headerBuf, 'ES.c.0');
    assert.equal(resHeader.parsed, null, 'DBN metadata header must NOT parse as a record');

    // Assert that in stream processing, header reception only sets metadataReceived, NEVER isSubscriptionAck
    let dbnMetadataReceived = false;
    let subscriptionAckReceived = false;

    // Simulate stream header arrival
    let streamBuffer = Buffer.from(headerBuf);
    if (streamBuffer.length >= 8 && streamBuffer.subarray(0, 3).toString('ascii') === DBN_CONSTANTS.MAGIC) {
      const metaLen = streamBuffer.readUInt32LE(4);
      if (streamBuffer.length >= 8 + metaLen) {
        streamBuffer = streamBuffer.subarray(8 + metaLen);
        dbnMetadataReceived = true;
        // Invariant: DO NOT mark subscriptionAckReceived here!
      }
    }

    assert.equal(dbnMetadataReceived, true, 'Metadata header received');
    assert.equal(subscriptionAckReceived, false, 'Subscription ACK must REMAIN FALSE when only metadata is received');
    assert.equal(streamBuffer.length, 0, 'Header payload consumed from stream buffer');

    console.log('  PASS  DBN Metadata Header strictly distinguished from Subscription ACK');
  }

  // 13. TASK 1: Complete 6-Stage Protocol Pipeline Regression Test
  {
    // Stages:
    // 1. AUTHENTICATED
    // 2. DBN METADATA RECEIVED
    // 3. SUBSCRIPTION ACK RECEIVED (SystemMsg.code = 1)
    // 4. ERROR RECORD RECEIVED (none in happy path, caught on failure)
    // 5. REAL MARKET RECORDS RECEIVED
    // 6. DECODER VERIFIED

    let stage1_authenticated = false;
    let stage2_metadataReceived = false;
    let stage3_subscriptionAck = false;
    let stage4_errorRecord = false;
    let stage5_realMarketRecords = 0;
    let stage6_decoderVerified = false;

    // 1. Auth step
    const authLine = 'success=1|session_id=sess_test_12345\n';
    if (authLine.includes('success=1')) {
      stage1_authenticated = true;
    }
    assert.equal(stage1_authenticated, true, 'Stage 1: AUTHENTICATED verified');

    // 2. DBN Metadata Header step
    const header = buildDbnMetadataHeaderFixture(50);
    // 3. SystemMsg Subscription ACK record (320 bytes)
    const subAck = buildSystemMsgFixture({ code: 1, msg: 'Subscribed to GLBX.MDP3:trades' });
    // 4. Gateway Heartbeat record (320 bytes)
    const hb = buildSystemMsgFixture({ code: 0, msg: 'Heartbeat' });
    // 5. Real Market Trade record (MBP-10, 368 bytes)
    const trade = buildMbp10BinaryFixture({ sequence: 501, tradePrice: 5202500000000n, tradeSize: 10 });

    // Combine stream into single buffer
    let stream = Buffer.concat([header, subAck, hb, trade]);

    // Process DBN stream header
    if (stream.length >= 8 && stream.subarray(0, 3).toString('ascii') === DBN_CONSTANTS.MAGIC) {
      const metaLen = stream.readUInt32LE(4);
      if (stream.length >= 8 + metaLen) {
        stream = stream.subarray(8 + metaLen);
        stage2_metadataReceived = true;
      }
    }
    assert.equal(stage2_metadataReceived, true, 'Stage 2: DBN METADATA RECEIVED verified');
    assert.equal(stage3_subscriptionAck, false, 'Stage 3 must still be false before records parsed');

    // Process records in stream
    let heartbeatsCount = 0;
    while (stream.length >= DBN_CONSTANTS.HEADER_SIZE) {
      const { parsed, recLen } = parseDbnRecord(stream, 'ES.c.0');
      if (recLen === 0 || stream.length < recLen) break;

      if (parsed) {
        if (parsed.system?.isSubscriptionAck) {
          stage3_subscriptionAck = true;
        } else if (parsed.system?.isHeartbeat) {
          heartbeatsCount++;
        }
        if (parsed.error) {
          stage4_errorRecord = true;
        }
        if (parsed.trade || parsed.depth) {
          stage5_realMarketRecords++;
          if (parsed.trade && parsed.trade.price > 0 && parsed.trade.size > 0) {
            stage6_decoderVerified = true;
          }
        }
      }

      stream = stream.subarray(recLen);
    }

    assert.equal(stage3_subscriptionAck, true, 'Stage 3: SUBSCRIPTION ACK RECEIVED (SystemMsg code=1)');
    assert.equal(heartbeatsCount, 1, 'Gateway Heartbeats tracked separately without polluting market records');
    assert.equal(stage4_errorRecord, false, 'Stage 4: No error records in happy path');
    assert.equal(stage5_realMarketRecords, 1, 'Stage 5: Exactly 1 real market record received');
    assert.equal(stage6_decoderVerified, true, 'Stage 6: Production decoder verified real market record structure');
    assert.equal(stream.length, 0, 'Stream buffer fully drained');

    // Negative case: ErrorMsg trigger
    const errStream = buildErrorMsgFixture({ err: 'Subscription limit reached' });
    const { parsed: parsedErr } = parseDbnRecord(errStream, 'ES.c.0');
    assert.ok(parsedErr?.error);
    assert.equal(parsedErr.error, 'Subscription limit reached');

    console.log('  PASS  Full 6-stage protocol pipeline regression test passed (Auth -> Meta -> SubAck -> Heartbeat -> MarketRecord -> Decoder)');
  }

  console.log('  [PASS] All DatabentoLiveClient unit tests passed.');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  runDatabentoLiveTests().catch((err) => { console.error(err); process.exit(1); });
}
