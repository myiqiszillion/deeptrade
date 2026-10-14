import '../../scripts/offline_guard.cjs';
import assert from 'node:assert/strict';
import net from 'node:net';
import { createServer } from 'node:http';
import { WebSocket, WebSocketServer } from 'ws';
import { OrdinaryRuntimeGate, initializeOrdinaryRuntime, validateOrdinaryProfile } from '../src/marketData/ordinaryRuntime.js';
import { createMarketDataFeed } from '../src/marketData/registry.js';
import { MarketContextManager } from '../src/marketData/marketContext.js';
import { ChartSession } from '../src/session.js';
import { getOrRegisterInstrument } from '../src/futuresConfig.js';
import { DatabentoHttpClient } from '../src/databento/client.js';
import { fetchWatchlistQuotes, quoteBoardEnabled } from '../src/marketData/quoteBoard.js';

const guard = (globalThis as any)[Symbol.for('deepchart.offline.guard')];
const key = 'offline-ordinary-sentinel';
const profile = { version: 1, approved: true, approvalId: 'offline-fixture', expiresAt: new Date(Date.now() + 60000).toISOString(), dataset: 'GLBX.MDP3', symbol: 'ES', vendorSymbol: 'ES.c.0', schema: 'trades', history: false, gex: false, quoteBoard: false, reconnect: false };
const approved = { FUTURES_PROVIDER: 'databento', DATABENTO_RUNTIME_START: '1', DATABENTO_RUNTIME_PROFILE: JSON.stringify(profile), DATABENTO_API_KEY: key };
const envs: NodeJS.ProcessEnv[] = [ {}, { DATABENTO_API_KEY: key }, { ...approved, DATABENTO_RUNTIME_START: '0' }, { ...approved, FUTURES_PROVIDER: 'unknown' }, { ...approved, DATABENTO_RUNTIME_PROFILE: '' }, { ...approved, DATABENTO_RUNTIME_PROFILE: '{' }, { ...approved, DATABENTO_API_KEY: '' } ];
for (const [k, v] of Object.entries({ schema: 'mbp-1', dataset: 'OPRA.PILLAR', symbol: 'NQ', vendorSymbol: 'NQ.c.0', history: true, gex: true, quoteBoard: true, reconnect: true, approved: false, extra: 'unknown', expiresAt: new Date(0).toISOString() })) envs.push({ ...approved, DATABENTO_RUNTIME_PROFILE: JSON.stringify({ ...profile, [k]: v }) });
const handlers = { onTrade: () => {}, onDepth: () => {}, onStatus: () => {}, onError: () => {} };
let forbiddenCalls = 0;
for (const env of envs) {
  assert.equal(validateOrdinaryProfile(env).profile, undefined);
  const denied = new OrdinaryRuntimeGate(env);
  const result = createMarketDataFeed('ES', getOrRegisterInstrument('ES'), handlers, denied, (() => { forbiddenCalls++; throw new Error('Forbidden transport'); }) as any);
  await result.feed.connect(); assert.equal(result.provider, 'none');
  assert.equal(denied.counters.connectionAttempts, 0);
}
assert.equal(forbiddenCalls, 0);
for (const schema of ['unknown', 'mbp-10', 'tbbo']) assert.equal(validateOrdinaryProfile({ ...approved, DATABENTO_RUNTIME_PROFILE: JSON.stringify({ ...profile, schema }) }).profile, undefined);
console.log(`PASS default OFF / key alone / invalid scope: ${envs.length} cases, zero transport calls`);
initializeOrdinaryRuntime({ FUTURES_PROVIDER: 'none' });
assert.throws(() => initializeOrdinaryRuntime(approved), /immutable/);
const gate = new OrdinaryRuntimeGate(approved);
assert(gate.allows('ES')); assert(!gate.allows('NQ')); assert(!gate.allows('ES.c.0'));
// Mutating the source config cannot broaden a frozen capability.
const mutated = { ...approved }; const frozen = new OrdinaryRuntimeGate(mutated); mutated.DATABENTO_RUNTIME_PROFILE = '{}'; assert(frozen.allows('ES'));
let attempts = 0; let vendorSocket: net.Socket | undefined; const commands: string[] = [];
const vendor = net.createServer(socket => {
  attempts++; vendorSocket = socket; socket.write('cram=test-challenge\n');
  let buffer = '';
  socket.on('data', chunk => { buffer += chunk.toString(); let i: number;
    while ((i = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, i); buffer = buffer.slice(i + 1);
      if (line.startsWith('auth=')) socket.write('success=1\n');
      else if (line.startsWith('schema=')) commands.push(line);
      else if (line === 'start_session=1') { const meta = Buffer.alloc(8); meta.write('DBN'); meta[3] = 3; socket.write(meta); }
      else assert.fail('Unexpected TCP command');
    }
  });
});
await new Promise<void>(r => vendor.listen(0, '127.0.0.1', r));
const mock = ((_opts: any) => net.createConnection({ host: '127.0.0.1', port: (vendor.address() as net.AddressInfo).port })) as typeof net.createConnection;
let historyCalls = 0; let httpCalls = 0;
const manager = new MarketContextManager(undefined, undefined, { fetchBars: async () => { historyCalls++; return []; }, fetchTicks: async () => { historyCalls++; return []; } }, (s, i, h) => createMarketDataFeed(s, i, h, gate, mock));
const wait = async (condition: () => boolean) => { const deadline = Date.now() + 4000; while (!condition()) { if (Date.now() > deadline) throw new Error('Fixture wait timed out'); await new Promise(r => setTimeout(r, 10)); } };
const http = createServer(); const wss = new WebSocketServer({ server: http }); const sessions = new Set<ChartSession>();
wss.on('connection', socket => {
  const session = new ChartSession(socket); session.setUser({ id: 'fixture-admin', username: 'fixture', role: 'admin', status: 'active' }); sessions.add(session);
  void manager.subscribe(session, 'ES', '1m', session.nextGeneration());
  socket.on('close', () => { manager.unsubscribe(session); sessions.delete(session); });
});
const clients: WebSocket[] = [];
try {
  // Same default warm context is shared by simultaneous authenticated browser connections.
  const ctx = await manager.getOrCreateContext('ES');
  await wait(() => gate.counters.subscriptionCommands === 1 && commands.length === 1); // Wait for mock server receipt, not just client socket.write.
  assert.equal(ctx.feedStatus, 'UNAVAILABLE'); assert.equal(ctx.feed!.isConnected(), false);
  assert.equal(gate.counters.subscriptionAcks, 0, 'Authentication is not subscription ACK');
  assert.deepEqual(commands, ['schema=trades|stype_in=continuous|symbols=ES.c.0|snapshot=0|is_last=1']);
  const ack = Buffer.alloc(320); ack[0] = 80; ack[1] = 0x17; ack[319] = 1; vendorSocket!.write(ack);
  await wait(() => gate.counters.subscriptionAcks === 1); assert.equal(ctx.feedStatus, 'UNAVAILABLE'); assert.equal(ctx.getFeedHealth().state, 'INDETERMINATE');
  await new Promise<void>(r => http.listen(0, '127.0.0.1', r));
  const open = async () => { const c = new WebSocket(`ws://127.0.0.1:${(http.address() as net.AddressInfo).port}`); clients.push(c); await new Promise<void>((r, j) => { c.once('open', r); c.once('error', j); }); return c; };
  await Promise.all([open(), open(), open()]); await wait(() => ctx.subscriberCount === 3);
  assert.equal(attempts, 1); assert.equal(commands.length, 1);
  const tickMessages: any[] = []; clients[1].on('message', d => tickMessages.push(JSON.parse(String(d))));
  const trade = Buffer.alloc(48); trade[0] = 12; trade[1] = 0; trade.writeUInt32LE(10252, 4); trade.writeBigUInt64LE(BigInt(Date.now()) * 1000000n, 8); trade.writeBigInt64LE(5000000000000n, 16); trade.writeUInt32LE(2, 24); trade[28] = 84; trade[29] = 66; trade.writeUInt32LE(1, 44); vendorSocket!.write(trade);
  await wait(() => tickMessages.some(m => m.type === 'TICK'));
  clients[0].close(); await wait(() => ctx.subscriberCount === 2); await open(); await wait(() => ctx.subscriberCount === 3);
  const denied = await manager.getOrCreateContext('NQ'); assert.equal(denied.provider, 'none'); assert.equal(denied.feedStatus, 'UNAVAILABLE');
  await ctx.ensureHistoryBars('5m', true); await ctx.backfillHistory(); await ctx.refreshGex();
  assert.equal(historyCalls, 0); assert.equal(quoteBoardEnabled({ ENABLE_QUOTE_BOARD: '1' }), false);
  assert.deepEqual(await fetchWatchlistQuotes({ symbols: ['ES'], apiKey: key, fetchFn: (async () => { httpCalls++; throw new Error('Forbidden HTTP'); }) as typeof fetch }), []);
  const rest = new DatabentoHttpClient({ requestsEnabled: false, apiKey: key, fetchFn: (async () => { httpCalls++; throw new Error('Forbidden HTTP'); }) as typeof fetch });
  assert.equal(rest.configured, false); await assert.rejects(rest.request('/timeseries.get_range')); assert.equal(httpCalls, 0);
  vendorSocket!.destroy(); await wait(() => ctx.feedStatus === 'UNAVAILABLE');
  await new Promise(r => setTimeout(r, 1100)); assert.equal(attempts, 1, 'No reconnect after remote close');
  await ctx.stopFeed(); await ctx.startFeed(); assert.equal(attempts, 1, 'No second attempt on restart');
  await manager.disposeAll();
  assert.deepEqual(gate.counters, { connectionAttempts: 1, subscriptionCommands: 1, subscriptionAcks: 1 });
  console.log('PASS ordinary mock TCP: exact trades command; authentication != ACK; warm/browser shared connection; reload/multiple clients; ES allowed/NQ denied; no history/options/GEX/quote fetch; no retry');
  console.log(JSON.stringify({ fixture: 'OFFLINE_ONLY', attempts, commands, counters: gate.counters, historyCalls, httpCalls }));
} finally {
  for (const c of clients) c.terminate(); for (const c of wss.clients) c.terminate();
  await manager.disposeAll(); vendorSocket?.destroy();
  await new Promise<void>(r => wss.close(() => r()));
  if (http.listening) await new Promise<void>(r => http.close(() => r()));
  await new Promise<void>(r => vendor.close(() => r()));
}
guard.assertBackend(); guard.assertClean();
const expiryGate = new OrdinaryRuntimeGate({ ...approved, DATABENTO_RUNTIME_PROFILE: JSON.stringify({ ...profile, expiresAt: new Date(Date.now() + 150).toISOString() }) });
let expired = false; const expirySocket = new net.Socket();
const expiryFeed = createMarketDataFeed('ES', getOrRegisterInstrument('ES'), { ...handlers, onStatus: status => { if (status.reason?.includes('approval expired')) { assert.equal(expirySocket.destroyed, true); expired = true; } } }, expiryGate, (() => expirySocket) as any).feed;
await expiryFeed.connect(); await wait(() => expired); await assert.rejects(expiryFeed.connect(), /scope\/expiry denied/);
assert.equal(expiryGate.counters.connectionAttempts, 1);
console.log('PASS approval expiry: socket destroyed before UNAVAILABLE; expired reconnect refused');
assert.equal(process.env.DATABENTO_API_KEY, ''); assert.equal(process.env.FUTURES_PROVIDER, 'none'); assert.equal(process.env.STORAGE_PATH, ':memory:');
console.log('PASS isolation: empty env key, provider none, memory DB, zero guard violations');
process.exit(0);
