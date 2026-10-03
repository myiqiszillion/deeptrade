import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { DatabentoLiveClient } from '../../src/databento/liveClient.js';
import { FeedStatusEvent, MarketDepthEvent, MarketTrade } from '../../src/marketData/types.js';

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

export async function runDatabentoLiveTests(): Promise<void> {
  console.log('[unit/databentoLive.test] Running DatabentoLiveClient unit tests...');

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

    // URL-based auth: verify api_key, dataset, symbols, schema in URL rather than JSON frames
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

    console.log('  PASS  Subscription lifecycle, trade processing, and depth');
  }

  console.log('  [PASS] All DatabentoLiveClient unit tests passed.');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  runDatabentoLiveTests().catch((err) => { console.error(err); process.exit(1); });
}
