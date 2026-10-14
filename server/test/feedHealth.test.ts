import '../../scripts/offline_guard.cjs';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FeedHealth, HealthClock } from '../src/marketData/feedHealth.js';
import { DatabentoLiveClient } from '../src/databento/liveClient.js';
import { MarketContext } from '../src/marketData/marketContext.js';
import { OrdinaryRuntimeGate, initializeOrdinaryRuntime } from '../src/marketData/ordinaryRuntime.js';
import { createMarketDataFeed } from '../src/marketData/registry.js';
import { getOrRegisterInstrument } from '../src/futuresConfig.js';
import { ChartSession } from '../src/session.js';
import { marketDataStore } from '../src/storage/marketDataStore.js';
import { SessionCalendar } from '../src/calendar/sessionCalendar.js';
const guard=(globalThis as any)[Symbol.for('deepchart.offline.guard')];
initializeOrdinaryRuntime({FUTURES_PROVIDER:'none'});
const cases:any[]=[];
function clock() { let wall=Date.UTC(2026,9,13,15),mono=100; return {wall:()=>wall,mono:()=>mono, advance:(ms:number)=>{wall+=ms;mono+=ms;},jump:(ms:number)=>{wall+=ms;}}; }
function record(name:string,h:FeedHealth,extra:any={}) { const snapshot=h.snapshot(); assert(snapshot.reason);cases.push({name,snapshot,...extra}); console.log('PASS '+name); }
const offClock=clock();const env={FUTURES_PROVIDER:'databento',DATABENTO_API_KEY:'offline-health-sentinel',DATABENTO_RUNTIME_START:'1',DATABENTO_RUNTIME_PROFILE:JSON.stringify({version:1,approved:true,approvalId:'offline-health',expiresAt:new Date(offClock.wall()+600000).toISOString(),dataset:'GLBX.MDP3',symbol:'ES',vendorSymbol:'ES.c.0',schema:'trades',history:false,gex:false,quoteBoard:false,reconnect:false})};
for(const [name,e] of [['OFF/key present',{...env,DATABENTO_RUNTIME_START:'0'}],['Missing/invalid/expired approval',{...env,DATABENTO_RUNTIME_PROFILE:'{}'}]] as const) {
 const h=new FeedHealth(offClock),gate=new OrdinaryRuntimeGate(e,offClock.wall(),offClock);let attempts=0;
 const f=createMarketDataFeed('ES',getOrRegisterInstrument('ES'),{onTrade:()=>assert.fail(),onDepth:()=>assert.fail(),onError:()=>assert.fail(),onStatus:s=>h.signal(s.state,s.reason)},gate,(()=>{attempts++;assert.fail();}) as any);
 await f.feed.connect();assert.equal(h.snapshot().state,'DISABLED');assert.equal(attempts,0);record(name,h,{gate:gate.counters});
}
class Socket extends EventEmitter { writes:string[]=[]; destroyed=false; write(b:any){this.writes.push(String(b));return true;} destroy(){this.destroyed=true;return this;} }
function system(code:number) {const b=Buffer.alloc(320);b[0]=80;b[1]=0x17;b[319]=code;return b;}
function trade(c:HealthClock,i=1,instrument=10252) {const b=Buffer.alloc(48);b[0]=12;b[1]=0;b.writeUInt16LE(1,2);b.writeUInt32LE(instrument,4);b.writeBigUInt64LE(BigInt(c.wall())*1000000n+BigInt(i),8);b.writeBigInt64LE(5000000000000n,16);b.writeUInt32LE(2,24);b[28]=84;b[29]=66;b.writeBigUInt64LE(BigInt(c.wall())*1000000n+1000n,32);b.writeUInt32LE(i,44);return b;}
async function fixture() {
 // Singleton storage is guard-pinned :memory:; isolate each mock cohort from previous fixtures.
 assert.equal(process.env.STORAGE_PATH,':memory:'); (marketDataStore as any).db.exec('DELETE FROM trades; DELETE FROM bars;');
 const c=clock(),socket=new Socket(),gate=new OrdinaryRuntimeGate({...env,DATABENTO_APPROVAL_LEDGER:join(mkdtempSync(join(tmpdir(),'deepchart-health-lease-')),'approval.sqlite')},c.wall(),c);let expire:()=>void=()=>{};
 const messages:any[]=[];const ws:any={readyState:1,bufferedAmount:0,send:(s:string)=>messages.push(JSON.parse(s))};
 let client!:DatabentoLiveClient;
 const factory:any=(_s:any,_i:any,handlers:any)=>({provider:'databento',feed:client=new DatabentoLiveClient({symbol:'ES.c.0',dataset:'GLBX.MDP3',schema:'trades',apiKey:'offline-health-sentinel',handlers,clock:c,timers:{set:(fn)=>{expire=fn;return {unref(){}} as any;},clear:()=>{}},ordinary:{expiresAt:gate.profile!.expiresAt,createConnection:(()=>socket) as any,beforeConnect:()=>gate.claimConnection('ES'),onSubscription:()=>gate.subscription(),onAck:()=>gate.ack()}})});
 const ctx=new MarketContext('ES',getOrRegisterInstrument('ES'),undefined,undefined,undefined,undefined,factory,c);
 await ctx.startFeed(); const session=new ChartSession(ws);ctx.addSubscriber(session,'1m');socket.emit('connect');
 const auth=()=>{socket.emit('data',Buffer.from('cram=offline\nsuccess=1\n'));const meta=Buffer.alloc(8);meta.write('DBN');meta[3]=3;socket.emit('data',meta);};
 return {ctx,c,socket,gate,messages,client,session,auth,expire:()=>expire()};
}
const invalidH=new FeedHealth(offClock);
for (const p of ['', '{', JSON.stringify({...JSON.parse(env.DATABENTO_RUNTIME_PROFILE),expiresAt:new Date(offClock.wall()-1).toISOString()})]) { const g=new OrdinaryRuntimeGate({...env,DATABENTO_RUNTIME_PROFILE:p},offClock.wall(),offClock);assert.equal(g.profile,undefined);assert.equal(g.counters.connectionAttempts,0); }
assert.equal(invalidH.snapshot().state,'DISABLED');
const f=await fixture();assert.equal(f.ctx.getFeedHealth().state,'CONNECTING');record('TCP connecting no auth',f.ctx.health,{gate:f.gate.counters});
let ready=false;const readiness=f.client.waitForLive(600000).then(()=>{ready=true;});
f.auth();await Promise.resolve();assert.equal(ready,false,'Authentication must not resolve market readiness');assert.equal(f.ctx.getFeedHealth().state,'SUBSCRIBING');assert.equal(f.gate.counters.subscriptionAcks,0);assert(f.ctx.getFeedHealth().times.authenticatedAt);record('Auth success not ACK',f.ctx.health,{commands:f.socket.writes.filter(s=>s.startsWith('schema='))});
f.socket.emit('data',system(1));await Promise.resolve();assert.equal(ready,false,'ACK must not resolve pending waitForLive');assert.equal(f.ctx.getFeedHealth().state,'INDETERMINATE');f.socket.emit('data',trade(f.c));await readiness;assert.equal(ready,true);assert.equal(f.ctx.getFeedHealth().state,'LIVE');assert.equal(f.ctx.getFeedHealth().counters.accepted,1);assert.equal(f.ctx.getFeedHealth().times.decoderReceiveAt,f.c.wall());assert.equal(f.ctx.getFeedHealth().vendorEventNs,(BigInt(f.c.wall())*1000000n+1n).toString());assert.equal(f.ctx.getFeedHealth().vendorReceiveNs,(BigInt(f.c.wall())*1000000n+1000n).toString());record('ACK and committed market observation',f.ctx.health);
const denied=await fixture();denied.auth(); const error=Buffer.alloc(320);error[0]=80;error[1]=0x15;error.write('Not authorized for trades schema',16);denied.socket.emit('data',error);assert.equal(denied.ctx.getFeedHealth().state,'UNAVAILABLE');assert(denied.socket.destroyed);record('Gateway denied/error',denied.ctx.health);
const quiet=await fixture();quiet.auth();quiet.socket.emit('data',system(1));quiet.socket.emit('data',system(0));assert.equal(quiet.ctx.getFeedHealth().state,'INDETERMINATE');assert.equal(quiet.ctx.getFeedHealth().counters.accepted,0);record('Control only no market records',quiet.ctx.health);
f.c.advance(61000);for(let i=0;i<4;i++){/* Browser PONG has no API to mutate vendor health. */f.session.send({type:'PONG',ts:f.c.wall()} as any);}f.ctx.refreshFeedHealth();assert.equal(f.ctx.getFeedHealth().state,'STALE');assert.equal(f.ctx.getFeedHealth().counters.accepted,1);record('Browser PONG cannot refresh stalled vendor',f.ctx.health);
quiet.c.advance(31000);quiet.socket.emit('data',system(0));assert.equal(quiet.ctx.getFeedHealth().state,'INDETERMINATE');record('Quiet active transport is indeterminate',quiet.ctx.health);
assert.equal(quiet.ctx.health.snapshot(false).state,'MARKET_CLOSED');assert.equal(SessionCalendar.getSessionInfo(Date.UTC(2026,9,13,21,30)).isOpen,false);assert.equal(SessionCalendar.getSessionInfo(Date.UTC(2026,9,13,22,1)).isOpen,true);record('Static calendar boundary',quiet.ctx.health,{closed:quiet.ctx.health.snapshot(false)});
const closed=await fixture();closed.auth();closed.socket.emit('close');assert.equal(closed.ctx.getFeedHealth().state,'UNAVAILABLE');record('Remote socket close no retry',closed.ctx.health,{gate:closed.gate.counters});
const partial=await fixture();partial.auth();const b=system(0);partial.socket.emit('data',b.subarray(0,100));assert.equal(partial.ctx.getFeedHealth().counters.controls,0);partial.socket.emit('data',b.subarray(100));const admin=Buffer.alloc(16);admin[0]=4;admin[1]=0x18;partial.socket.emit('data',admin);assert.equal(partial.ctx.getFeedHealth().counters.accepted,0);partial.socket.emit('data',Buffer.alloc(16));assert.equal(partial.ctx.getFeedHealth().state,'UNAVAILABLE');assert(partial.socket.destroyed);record('Partial/admin/malformed DBN not market freshness',partial.ctx.health);
const failed=await fixture();failed.auth();failed.socket.emit('data',system(1));const save=marketDataStore.saveTrades;marketDataStore.saveTrades=(()=>({status:'FAILED',insertedIds:[],duplicateIds:[],error:'fixture SQL_IOERR',commitOutcome:'ROLLED_BACK'})) as any;failed.socket.emit('data',trade(failed.c,41));marketDataStore.saveTrades=save;assert.equal(failed.ctx.getFeedHealth().state,'BLOCKED');assert.equal(failed.ctx.getFeedHealth().counters.accepted,0);record('SQLite failure beats transport health',failed.ctx.health,{durability:failed.ctx.getDurability()});
const mismatch=await fixture();mismatch.auth();mismatch.socket.emit('data',system(1));mismatch.socket.emit('data',trade(mismatch.c,51));mismatch.socket.emit('data',trade(mismatch.c,52,10253));assert.equal(mismatch.ctx.getFeedHealth().state,'BLOCKED');assert.equal(mismatch.ctx.getFeedHealth().counters.accepted,1);record('Contract mismatch fail closed',mismatch.ctx.health);
const expiry=await fixture();expiry.auth();expiry.socket.emit('data',system(1));expiry.c.jump(-3600000);expiry.c.advance(600001);expiry.expire();assert(expiry.socket.destroyed);assert.equal(expiry.ctx.getFeedHealth().state,'BLOCKED');record('Approval expiry despite wall clock rollback',expiry.ctx.health,{gate:expiry.gate.counters});
const stop=await fixture();stop.auth();stop.socket.emit('data',system(1));stop.socket.emit('data',trade(stop.c,61));await stop.ctx.stopFeed();const n=stop.ctx.getDurability().received;stop.socket.emit('data',trade(stop.c,62));assert.equal(stop.ctx.getDurability().received,n);assert.equal(stop.ctx.getFeedHealth().state,'UNAVAILABLE');record('Stop and late callbacks inert',stop.ctx.health);
quiet.ctx.removeSubscriber(quiet.session);quiet.ctx.addSubscriber(quiet.session,'1m');assert.equal(quiet.gate.counters.connectionAttempts,1);assert.equal(quiet.gate.counters.subscriptionCommands,1);record('Browser resubscribe shares existing context',quiet.ctx.health,{gate:quiet.gate.counters});
const last=stop.messages.filter(m=>m.type==='INIT_STATE').at(-1);assert.equal(last.feedHealth.state,'UNAVAILABLE');assert.equal(last.volumeProfile.totalVolume,2);assert(stop.messages.some(m=>m.type==='PROFILE_UPDATE'&&m.volumeProfile.totalVolume===2));assert(stop.messages.some(m=>m.type==='BAR_UPDATE'&&m.bar.volume===2));record('Final committed BAR/PROFILE and stopped DTO',stop.ctx.health,{messages:stop.messages.map(m=>m.type)});
const forward=await fixture();forward.auth();forward.c.jump(86400000);forward.ctx.refreshFeedHealth();assert(forward.socket.destroyed);assert.equal(forward.ctx.getFeedHealth().state,'BLOCKED');assert.equal(forward.messages.filter(m=>m.type==='INIT_STATE').at(-1).feedHealth.state,'BLOCKED');record('Wall clock forward expiry closes before blocked snapshot',forward.ctx.health,{socketDestroyed:forward.socket.destroyed,gate:forward.gate.counters});await forward.ctx.dispose();
const cc=clock(),h=new FeedHealth(cc);h.begin();h.signal('AUTHENTICATED');assert.equal(h.snapshot().state,'AUTHENTICATED');h.signal('SUBSCRIBING');h.signal('ACKNOWLEDGED');h.accepted(1,true);const before=h.snapshot();cc.jump(-86400000);assert.equal(h.snapshot().state,'LIVE');cc.jump(172800000);assert.equal(h.snapshot().state,'LIVE');cc.advance(31000);assert.equal(h.snapshot().state,'INDETERMINATE');assert.equal(h.snapshot().times.vendorEventAt,before.times.vendorEventAt);record('Monotonic freshness unaffected by UTC jumps',h);
for(const x of [f,denied,quiet,closed,partial,failed,mismatch,expiry,stop])await x.ctx.dispose();guard.assertBackend();guard.assertClean();const dir=mkdtempSync(join(tmpdir(),'deepchart-health-'));writeFileSync(join(dir,'evidence.json'),JSON.stringify({scope:'OFFLINE ONLY',cases},null,2));console.log('FEED HEALTH OFFLINE PASS '+cases.length+' cases '+dir);process.exit(0);
