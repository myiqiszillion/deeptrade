import '../../scripts/offline_guard.cjs';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { parseDbnRecord } from '../src/databento/liveClient.js';
import { normalizeTrade } from '../src/databento/normalizer.js';
import { DatabentoHttpClient } from '../src/databento/client.js';
import { createDatabentoHistoryProvider } from '../src/marketData/databentoHistoryProvider.js';
import { MarketContext } from '../src/marketData/marketContext.js';
import { marketDataStore, MarketDataStore } from '../src/storage/marketDataStore.js';
import { getOrRegisterInstrument } from '../src/futuresConfig.js';
import { ChartSession } from '../src/session.js';
import { ReplaySession } from '../src/replaySession.js';
import { exactNs, identityFields, resolveTradeIdentity, uniqueTradeTicks, vendorTradeId } from '../src/marketData/tradeIdentity.js';
import type { Tick } from '../src/types.js';
import type { MarketTrade } from '../src/marketData/types.js';
const guard=(globalThis as any)[Symbol.for('deepchart.offline.guard')];
const ns=BigInt(Math.floor(Date.now()/60000)*60000-30000)*1000000n;
function record(sequence:number, delta=123n, side='B', size=2, instrument=10252, publisher=1) {
 const b=Buffer.alloc(48);b[0]=12;b[1]=0;b.writeUInt16LE(publisher,2);b.writeUInt32LE(instrument,4);b.writeBigUInt64LE(ns+delta,8);b.writeBigInt64LE(5000000000000n,16);b.writeUInt32LE(size,24);b[28]=84;b[29]=side.charCodeAt(0);b[30]=128;b[31]=0;b.writeBigUInt64LE(ns+delta+10000n,32);b.writeInt32LE(-20,40);b.writeUInt32LE(sequence,44);return b;
}
function decode(b:Buffer, symbol='ES'):MarketTrade { return parseDbnRecord(b,symbol,'fixture',3,{schema:'trades',dataset:'GLBX.MDP3'}).parsed!.trade!; }
function tick(t:MarketTrade):Tick { return {id:t.id!,timestamp:t.ts,price:t.price,size:t.size,side:t.side.toLowerCase() as Tick['side'],sequenceId:String(t.sequenceId),vendorIdentity:t.vendorIdentity,eventTsNs:t.eventTsNs}; }
const cohort=[decode(record(100)),decode(record(101)),decode(record(102,123n,'A')),decode(record(103,456n,'N',4)),decode(record(800,-1000000n+789n,'B',1)),decode(record(4294967295,1000n,'A',1)),decode(record(0,1100n,'B',1)),decode(record(0,1200n,'B',1,10252))];
assert.notEqual(decode(record(0,1200n,'B',1,10253)).id,cohort[7].id,'Instrument distinction remains part of stable ID; different contracts use separate cohorts');
const expected={count:8,volume:14,buyVolume:7,sellVolume:3,unknownVolume:4,cvd:4};
assert.equal(new Set(cohort.map(t=>t.id)).size,8);
assert.notEqual(decode(record(100,123n,'A')).id,cohort[0].id,'Native side alone distinguishes otherwise identical records');
assert.notEqual(decode(record(100,124n)).id,cohort[0].id,'Nanosecond differences survive the same millisecond');
assert.equal(cohort[0].ts,cohort[1].ts);assert.equal(cohort[0].price,cohort[1].price);assert.equal(cohort[0].size,cohort[1].size);assert.notEqual(cohort[0].id,cohort[1].id);
const json={hd:{publisher_id:1,instrument_id:10252,ts_event:String(ns+123n)},price:'5000.000000000',size:2,action:'T',side:'B',flags:128,depth:0,ts_recv:String(ns+10123n),ts_in_delta:-20,sequence:100};
const historical=normalizeTrade(json,'GLBX.MDP3');assert.equal(historical.tradeId,cohort[0].id);assert.equal(historical.side,'buy');assert.equal(historical.eventTsNs,cohort[0].eventTsNs);
const historyClient=new DatabentoHttpClient({apiKey:'offline-history-sentinel',fetchFn:(async()=>new Response(JSON.stringify([json,{...json,sequence:101}]),{status:200})) as typeof fetch});
const historyTicks=await createDatabentoHistoryProvider(historyClient).fetchTicks!('ES',{}, {elements:2,beforeTime:Date.now(),signal:new AbortController().signal});
assert.deepEqual(historyTicks.map(t=>t.id),cohort.slice(0,2).map(t=>t.id));
assert.equal(uniqueTradeTicks([...historyTicks,...cohort.slice(0,2).map(tick)]).length,2,'Production history adapter and live DBN overlap share identity');
const unsafe=normalizeTrade({...json,hd:{...json.hd,ts_event:Number(ns+123n)}},'GLBX.MDP3');assert.equal(unsafe.vendorIdentity,undefined);assert.equal(unsafe.eventTsNs,undefined);
assert.equal(exactNs('2026-10-13T01:02:03.123456789Z'),String(BigInt(Date.parse('2026-10-13T01:02:03Z'))*1000000n+123456789n));
const publisherTrade=decode(record(100,123n,'B',2,10252,2));assert.notEqual(publisherTrade.id,cohort[0].id);
const differentDataset=[...cohort[0].vendorIdentity!] as any;differentDataset[0]='FIXTURE.OTHER';assert.notEqual(vendorTradeId(differentDataset),cohort[0].id);
assert.throws(()=>resolveTradeIdentity({...cohort[0],size:99}),/conflict/);
const ctx=new MarketContext('ES',getOrRegisterInstrument('ES'));await ctx.startFeed();
const deliver=(c:MarketContext,t:MarketTrade)=>(c as any).handleTrade(t);
for(const t of cohort) deliver(ctx,t);
for(const t of cohort) deliver(ctx,{...t,receiveTs:Date.now()+5000}); // Exact redelivery with new local clock.
const accepted=ctx.getHistoryTicks();const persisted=marketDataStore.queryTrades({provider:'none',symbol:'ES',limit:100}).trades;
const measured={count:accepted.length,volume:accepted.reduce((s,t)=>s+t.size,0),buyVolume:accepted.filter(t=>t.side==='buy').reduce((s,t)=>s+t.size,0),sellVolume:accepted.filter(t=>t.side==='sell').reduce((s,t)=>s+t.size,0),unknownVolume:accepted.filter(t=>t.side==='unknown').reduce((s,t)=>s+t.size,0),cvd:accepted.reduce((s,t)=>s+(t.side==='buy'?t.size:t.side==='sell'?-t.size:0),0)};
assert.deepEqual(measured,expected);
assert.equal(accepted.length,expected.count);assert.equal(persisted.length,expected.count);assert.equal(persisted.reduce((s,t)=>s+t.size,0),expected.volume);
assert.equal(ctx.ensureFootprintEngine('1m').getAllBars().reduce((s,b)=>s+b.volume,0),expected.volume);
assert.equal(marketDataStore.getGaps('ES').length,0,'Venue jumps/reset/wrap do not imply missing trades');
for(const t of persisted) assert.deepEqual(identityFields(t.id).vendorIdentity,t.vendorIdentity);
const overlap=uniqueTradeTicks([...persisted,...cohort.map(tick)]);assert.equal(overlap.length,8);
const socket={readyState:1,bufferedAmount:0,send:()=>{},close:()=>{}} as any;
const session=new ChartSession(socket);const replay=new ReplaySession(session,'ES',getOrRegisterInstrument('ES'),'1m',overlap);
let emitted=0; while(replay.replayEngine.getProgress().currentIndex<8){replay.replayEngine.stepForward();emitted++;}
assert.equal(emitted,8);assert.equal(replay.profileEngine.getVolumeProfile().totalVolume,14);
assert.equal(replay.footprintEngine.getAllBars().at(-1)!.cvd,4);
const restored=new MarketContext('ES',getOrRegisterInstrument('ES'));await restored.startFeed();restored.addSubscriber(new ChartSession(socket),'1m');
assert.equal(restored.getHistoryTicks().length,8);for(const t of cohort)deliver(restored,t);assert.equal(restored.getHistoryTicks().length,8);assert.equal(restored.ensureFootprintEngine('1m').getAllBars().reduce((s,b)=>s+b.volume,0),14);
const nq=new MarketContext('NQ',getOrRegisterInstrument('NQ'));await nq.startFeed();const nqTrade=decode(record(100,123n,'A',3,20252),'NQ');deliver(nq,nqTrade);deliver(nq,nqTrade);assert.equal(nq.getHistoryTicks().length,1);assert.equal(marketDataStore.queryTrades({provider:'none',symbol:'NQ',limit:10}).trades.length,1);
const conflict=new MarketContext('ES',getOrRegisterInstrument('ES'));await conflict.startFeed();conflict.provider='fixture-conflict';
const legacyCollision={id:'legacy-conflict-fixture',ts:Number(ns/1000000n),price:5000,size:2,side:'BUY' as const};deliver(conflict,legacyCollision);deliver(conflict,{...legacyCollision,size:9});deliver(conflict,{...legacyCollision,id:'must-not-continue'});
assert.equal(conflict.feedStatus,'UNAVAILABLE');assert.match(conflict.feedReason!,/BLOCKED.*Operator/);assert.equal(conflict.getHistoryTicks().length,1);assert.equal(marketDataStore.queryTrades({provider:'fixture-conflict',symbol:'ES',limit:10}).trades.length,1);await conflict.dispose();
const fixtureDir=mkdtempSync(join(tmpdir(),'deepchart-trade-identity-'));const dbPath=join(fixtureDir,'fixture.sqlite');let disk=new MarketDataStore(dbPath);
const legacy:Tick={id:'t_legacy_original',timestamp:1791800000000,price:5000,size:5,side:'unknown'};disk.saveTrades([legacy],'ES','fixture');disk.saveTrades(persisted,'ES','fixture');disk.saveTrades([...persisted],'ES','fixture');disk.close();
const inspect=new DatabaseSync(dbPath,{readOnly:true});assert.equal(inspect.prepare('PRAGMA integrity_check').get()!.integrity_check,'ok');assert.equal(inspect.prepare('PRAGMA foreign_key_check').all().length,0);assert.equal(inspect.prepare('PRAGMA table_info(trades)').all().some(c=>c.name==='identity_json'),false);inspect.close();
disk=new MarketDataStore(dbPath);const rows=disk.queryTrades({provider:'fixture',symbol:'ES',limit:100}).trades;assert.equal(rows.length,9);assert.equal(rows.reduce((s,t)=>s+t.size,0),19);const old=rows.find(t=>t.id===legacy.id)!;assert.equal(old.identityKind,'LEGACY');assert.equal(old.vendorIdentity,undefined);assert.equal(old.eventTsNs,undefined);
assert.deepEqual(new Set(rows.filter(t=>t.identityKind==='VENDOR_RECORD_V1').map(t=>t.id)),new Set(cohort.map(t=>t.id)));
assert.equal(disk.tradeIdentityStatus('fixture','ES',legacy.id,{...legacy,size:9}),'CONFLICT');
assert.throws(()=>uniqueTradeTicks([legacy,{...legacy,size:9}]),/conflict/);disk.close();
// Anonymous arrivals cannot be matched safely: preserve distinct deliveries, never price fingerprint.
const anonymous={ts:Number(ns/1000000n),price:5000,size:2,side:'BUY' as const};assert.notEqual(resolveTradeIdentity(anonymous).id,resolveTradeIdentity(anonymous).id);
const partial=resolveTradeIdentity({...anonymous,eventTsNs:String(ns+123n)});assert.equal(identityFields(partial.id).eventTsNs,String(ns+123n));assert.equal(identityFields(partial.id).vendorIdentity,undefined);
replay.dispose();await ctx.dispose();await restored.dispose();await nq.dispose();guard.assertBackend();guard.assertClean();
console.log(JSON.stringify({scope:'OFFLINE FIXTURE ONLY',expected,actual:{accepted:accepted.length,persisted:persisted.length,restored:restored.getHistoryTicks().length,replay:emitted,volume:persisted.reduce((s,t)=>s+t.size,0)},legacy:{count:1,volume:5,unchangedId:legacy.id,metadata:'NOT CAPTURED'},withLegacy:{count:9,volume:19},nq:{count:1,volume:3},gaps:0,migrations:'NONE',fixtureDatabase:dbPath,guardViolations:0}));
console.log('TRADE IDENTITY OFFLINE PASS: same-ms distinctions, native side, exact duplicates, overlap, ns precision, out-of-order, sequence reset/wrap/jump, rollover, reconnect/redelivery, legacy, disk restart/replay, two symbols, count/volume reconciliation');process.exit(0);
