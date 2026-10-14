import '../../scripts/offline_guard.cjs';
import assert from 'node:assert/strict';
import { mkdtempSync, copyFileSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { MarketDataStore, marketDataStore } from '../src/storage/marketDataStore.js';
import { MarketContext } from '../src/marketData/marketContext.js';
import { getOrRegisterInstrument } from '../src/futuresConfig.js';
import { ChartSession } from '../src/session.js';
import { FootprintEngine } from '../src/footprintEngine.js';
import { ProfileEngine } from '../src/profileEngine.js';
import { parseDbnRecord } from '../src/databento/liveClient.js';
import { uniqueTradeTicks } from '../src/marketData/tradeIdentity.js';
import type { Tick } from '../src/types.js';
const guard=(globalThis as any)[Symbol.for('deepchart.offline.guard')];
const dir=mkdtempSync(join(tmpdir(),'deepchart-durability-'));
const cases: any[]=[];
const base=Math.floor(Date.now()/60000)*60000-180000;
function vendor(i:number,offset:number,price:number,size:number,side:string):Tick {
 const b=Buffer.alloc(48);b[0]=12;b[1]=0;b.writeUInt16LE(1,2);b.writeUInt32LE(10252,4);
 const ns=BigInt(base+offset)*1000000n+123n;b.writeBigUInt64LE(ns,8);b.writeBigInt64LE(BigInt(price*1e9),16);b.writeUInt32LE(size,24);b[28]=84;b[29]=side.charCodeAt(0);b[30]=128;b.writeBigUInt64LE(ns+10000n,32);b.writeUInt32LE(i,44);
 const t=parseDbnRecord(b,'ES','offline-fixture',3,{schema:'trades',dataset:'GLBX.MDP3'}).parsed!.trade!;
 return {...t,id:t.id!,timestamp:t.ts,side:t.side.toLowerCase() as Tick['side'],sequenceId:String(t.sequenceId),sourceProvider:'OFFLINE_FIXTURE'};
}
const cohort=[vendor(1,1000,5000,2,'B'),vendor(2,1000,5000,2,'B'),vendor(3,2000,5000.25,3,'A'),vendor(4,61000,5000.5,4,'N'),vendor(5,121000,5000.25,5,'B'),vendor(6,62000,5000.25,1,'A'),{id:'legacy-original',timestamp:base+122000,price:5000,size:2,side:'unknown',sourceProvider:'OFFLINE_FIXTURE'} as Tick];
const delivery=[...cohort,cohort[0],cohort[3]];
const ordered=uniqueTradeTicks(cohort);
function oracle(ticks:Tick[]) {
 const buy=ticks.filter(t=>t.side==='buy').reduce((s,t)=>s+t.size,0),sell=ticks.filter(t=>t.side==='sell').reduce((s,t)=>s+t.size,0),unknown=ticks.filter(t=>t.side==='unknown').reduce((s,t)=>s+t.size,0);
 const levels=new Map<number,number>(); const bars=new Map<number,any>();
 for(const t of uniqueTradeTicks(ticks)) {levels.set(t.price,(levels.get(t.price)||0)+t.size);const ts=Math.floor(t.timestamp/60000)*60000;let b=bars.get(ts);if(!b){b={time:ts,open:t.price,high:t.price,low:t.price,close:t.price,volume:0,levels:{}};bars.set(ts,b);}b.high=Math.max(b.high,t.price);b.low=Math.min(b.low,t.price);b.close=t.price;b.volume+=t.size;const p=b.levels[t.price]||{buy:0,sell:0,unknown:0,total:0};p[t.side]+=t.size;p.total+=t.size;b.levels[t.price]=p;}
 const profile=[...levels].sort((a,b)=>a[0]-b[0]);const poc=profile.reduce((best,p)=>p[1]>best[1]?p:best,profile[0])[0];
 return {count:ticks.length,volume:buy+sell+unknown,buy,sell,unknown,cvd:buy-sell,profile,poc,bars:[...bars.values()]};
}
const expected=oracle(ordered);
assert.deepEqual({count:expected.count,volume:expected.volume,buy:expected.buy,sell:expected.sell,unknown:expected.unknown,cvd:expected.cvd,poc:expected.poc},{count:7,volume:19,buy:9,sell:4,unknown:6,cvd:5,poc:5000.25});
function analytics(ticks:Tick[]) {
 const fp=new FootprintEngine(.25),profile=new ProfileEngine(.25,ticks[0].timestamp);
 for(const t of ticks){fp.processTick(t);profile.processTick(t);}
 const vp=profile.getVolumeProfile();return {fp,profile:vp};
}
function reconcile(ticks:Tick[]) {
 assert.deepEqual(new Set(ticks.map(t=>t.id)),new Set(cohort.map(t=>t.id)));assert.deepEqual(oracle(ticks),expected);
 const {fp,profile}=analytics(uniqueTradeTicks(ticks));
 assert.equal(profile.totalVolume,expected.volume);assert.equal(profile.poc,expected.poc);assert.deepEqual(profile.levels.map(p=>[p.price,p.volume]),expected.profile);
 assert.equal(fp.getAllBars().at(-1)!.cvd,expected.cvd);
 const actual=fp.getAllBars().map(b=>({time:b.time,open:b.open,high:b.high,low:b.low,close:b.close,volume:b.volume,levels:Object.fromEntries(Object.values(b.levels).map(p=>[p.price,{buy:p.askVol,sell:p.bidVol,unknown:p.unknownVol||0,total:p.totalVol}]))}));assert.deepEqual(actual,expected.bars);
}
function rows(s:MarketDataStore){return s.queryTrades({provider:'fixture',symbol:'ES',limit:100}).trades;}
function outcome(name:string,observed:any,expectedOutcome:string){cases.push({name,expected:expectedOutcome,observed,exitCode:0});}
// All fault overrides are test-local on isolated database instances; no runtime injection endpoint.
for(const code of ['SQLITE_LOCKED','SQLITE_FULL','SQLITE_IOERR']) {
 const s=new MarketDataStore(join(dir,`${code}.sqlite`));const stmt=(s as any).insertTradeStmt,run=stmt.run.bind(stmt);let n=0;
 stmt.run=(...args:any[])=>{if(++n===2)throw new Error(code+' simulated');return run(...args);};
 const r=s.saveTrades(cohort,'ES','fixture');assert.equal(r.status,'FAILED');assert.equal(r.commitOutcome,'ROLLED_BACK');assert.equal(rows(s).length,0);assert.equal(s.getTradeDurability().committed,0);assert.equal(s.getTradeDurability().pending,0);
 outcome(code,{result:r,counters:s.getTradeDurability(),rows:0},'entire batch rolled back; zero committed; zero pending');s.close();
}
const busyPath=join(dir,'busy.sqlite'),busy=new MarketDataStore(busyPath),lock=new DatabaseSync(busyPath);(busy as any).db.exec('PRAGMA busy_timeout=0');lock.exec('BEGIN IMMEDIATE');
const br=busy.saveTrades(cohort,'ES','fixture');assert.equal(br.status,'FAILED');assert.equal(br.commitOutcome,'NOT_STARTED');assert.equal(rows(busy).length,0);lock.exec('ROLLBACK');lock.close();outcome('SQLITE_BUSY actual writer lock',{result:br,counters:busy.getTradeDurability()},'fail without insert or application retry');busy.close();
const partial=new MarketDataStore(join(dir,'partial.sqlite'));(partial as any).db.exec("CREATE TRIGGER reject_second BEFORE INSERT ON trades WHEN NEW.trade_id='legacy-original' BEGIN SELECT RAISE(ABORT,'fixture constraint'); END");
const pr=partial.saveTrades(cohort,'ES','fixture');assert.equal(pr.status,'FAILED');assert.equal(rows(partial).length,0);outcome('batch partial failure / actual constraint rollback',{result:pr,counters:partial.getTradeDurability()},'prefix rolled back, zero rows');partial.close();
const commitFault=new MarketDataStore(join(dir,'commit.sqlite'));const exec=(commitFault as any).db.exec.bind((commitFault as any).db);(commitFault as any).db.exec=(sql:string)=>{if(sql==='COMMIT')throw new Error('SQLITE_IOERR simulated commit');return exec(sql);};
const cr=commitFault.saveTrades(cohort,'ES','fixture');assert.equal(cr.status,'FAILED');assert.equal(rows(commitFault).length,0);outcome('COMMIT failure',{result:cr,counters:commitFault.getTradeDurability()},'rollback all, never count committed');commitFault.close();
const uncertain=new MarketDataStore(join(dir,'uncertain.sqlite'));const ux=(uncertain as any).db.exec.bind((uncertain as any).db);(uncertain as any).db.exec=(sql:string)=>{if(sql==='COMMIT'||sql==='ROLLBACK')throw new Error('SQLITE_IOERR uncertain outcome simulated');return ux(sql);};
const ur=uncertain.saveTrades(cohort,'ES','fixture');assert.equal(ur.commitOutcome,'UNKNOWN');assert.equal(uncertain.getTradeDurability().blocked,true);assert.equal(uncertain.getTradeDurability().committed,0);const ur2=uncertain.saveTrades(cohort,'ES','fixture');assert.equal(ur2.status,'FAILED');assert.equal(uncertain.getTradeDurability().attempts,2);outcome('rollback failure / uncertain outcome',{result:ur,counters:uncertain.getTradeDurability()},'UNKNOWN, store blocked, no success claim or retry');(uncertain as any).db.exec=ux;ux('ROLLBACK');uncertain.close();
const capacity=new MarketDataStore(':memory:');const cap=capacity.saveTrades(Array(capacity.maxTradeBatchSize+1).fill(cohort[0]),'ES','fixture');assert.equal(cap.status,'FAILED');assert.equal(capacity.getTradeDurability().pending,0);assert.equal(rows(capacity).length,0);outcome('capacity exceeded',{result:cap,counters:capacity.getTradeDurability(),queueCapacity:0,maxBatch:capacity.maxTradeBatchSize},'reject oversized batch; no application pending/retry queue');capacity.close();
// Feed ordering and failure tested through the actual normal MarketContext + ChartSession.
const messages:any[]=[];const socket={readyState:1,bufferedAmount:0,send:(s:string)=>{const m=JSON.parse(s);if(m.type==='TICK')assert.equal(marketDataStore.tradeIdentityStatus('fixture','ES',m.tick.id,m.tick),'DUPLICATE','published tick must already be committed');messages.push(m);},close:()=>{}} as any;
const ctx=new MarketContext('ES',getOrRegisterInstrument('ES'));await ctx.startFeed();ctx.provider='fixture';ctx.addSubscriber(new ChartSession(socket),'1m');
const save=marketDataStore.saveTrades.bind(marketDataStore);marketDataStore.saveTrades=(t,s,p)=>{assert.equal(messages.filter(m=>m.type==='TICK').length,ctx.getDurability().persisted);assert.equal(ctx.getDurability().pending,1);return save(t,s,p);};
for(const t of delivery)(ctx as any).handleTrade({...t,ts:t.timestamp,side:t.side.toUpperCase()});marketDataStore.saveTrades=save;
assert.equal(messages.filter(m=>m.type==='TICK').length,7);assert.equal(ctx.getDurability().persisted,7);assert.equal(ctx.getDurability().published,7);reconcile(ctx.getHistoryTicks());reconcile(marketDataStore.queryTrades({provider:'fixture',symbol:'ES',limit:100}).trades);
assert.equal(ctx.getDurability().lastCommittedId,cohort.at(-1)!.id);outcome('ordinary commit-before-publication / out-of-order',{counters:ctx.getDurability(),tickMessages:7,oracle:expected},'7 durable records before 7 TICK messages; exact independent numbers');
const liveBars=ctx.ensureFootprintEngine('1m').getAllBars();assert.deepEqual(liveBars.map(b=>({time:b.time,open:b.open,high:b.high,low:b.low,close:b.close,volume:b.volume,levels:Object.fromEntries(Object.values(b.levels).map(p=>[p.price,{buy:p.askVol,sell:p.bidVol,unknown:p.unknownVol||0,total:p.totalVol}]))})),expected.bars);assert.equal(liveBars.at(-1)!.cvd,expected.cvd);assert.equal(liveBars.reduce((a,b)=>a+b.volume,0),expected.volume);assert.equal((ctx as any).profile.getVolumeProfile().totalVolume,expected.volume);assert.equal((ctx as any).profile.getVolumeProfile().poc,expected.poc);
const failedCtx=new MarketContext('ES',getOrRegisterInstrument('ES'));await failedCtx.startFeed();failedCtx.provider='fixture-failure';let disconnected=0;(failedCtx as any).feed={disconnect:async()=>{disconnected++;}};failedCtx.addSubscriber(new ChartSession({...socket,send:(s:string)=>messages.push(JSON.parse(s))} as any),'1m');(failedCtx as any).handleTrade({...cohort[0],ts:cohort[0].timestamp,side:'BUY'});assert.equal(failedCtx.feedStatus,'UNAVAILABLE');assert.equal(failedCtx.getFeedHealth().state,'DISABLED','Fixture tick without subscription proof cannot imply Live');const before=messages.filter(m=>m.type==='TICK').length;
marketDataStore.saveTrades=()=>({status:'FAILED',insertedIds:[],duplicateIds:[],error:'SQLITE_FULL injected',commitOutcome:'ROLLED_BACK'});
(failedCtx as any).handleTrade({...cohort[1],ts:cohort[1].timestamp,side:'BUY'});(failedCtx as any).handleTrade({...cohort[2],ts:cohort[2].timestamp,side:'SELL'});marketDataStore.saveTrades=save;
assert.equal(failedCtx.feedStatus,'UNAVAILABLE');assert.equal(disconnected,1);assert.equal(failedCtx.getHistoryTicks().length,1);assert.equal(messages.filter(m=>m.type==='INIT_STATE'&&m.symbol==='ES').at(-1).feedStatus,'UNAVAILABLE');assert.equal(messages.filter(m=>m.type==='TICK').length,before);assert.equal(failedCtx.getDurability().status,'FAILED');assert.equal(failedCtx.getDurability().failed,1);assert.equal(failedCtx.getDurability().published,1);assert.equal(failedCtx.getDurability().persisted,1);await failedCtx.startFeed();assert.match(failedCtx.feedReason!,/persistence BLOCKED/);assert.equal(disconnected,1);outcome('ordinary failure containment',{counters:failedCtx.getDurability(),disconnected,feedStatus:failedCtx.feedStatus},'no analytic/TICK mutation; disconnect once; sticky FAILED');
const projectionCtx=new MarketContext('ES',getOrRegisterInstrument('ES'));await projectionCtx.startFeed();projectionCtx.provider='fixture-projection';projectionCtx.ensureFootprintEngine('1m');
(projectionCtx as any).handleTrade({...cohort[0],ts:cohort[0].timestamp,side:'BUY'});const barStmt=(marketDataStore as any).insertBarStmt,barRun=barStmt.run.bind(barStmt);barStmt.run=()=>{throw new Error('SQLITE_FULL derived cache simulated');};
(projectionCtx as any).handleTrade({...cohort[3],ts:cohort[3].timestamp,side:'UNKNOWN'});barStmt.run=barRun;
assert.equal(projectionCtx.getDurability().persisted,2);assert.equal(projectionCtx.getDurability().projectionFailed,1);assert.equal(projectionCtx.getDurability().published,1);assert.equal(projectionCtx.getDurability().status,'FAILED');assert.equal(projectionCtx.feedStatus,'UNAVAILABLE');assert.equal(marketDataStore.queryTrades({provider:'fixture-projection',symbol:'ES',limit:100}).trades.length,2);
outcome('derived bar persistence failure',{counters:projectionCtx.getDurability(),committedRows:2},'trade retained; FAILED projection, stop ingestion, require rebuild; no healthy complete claim');await projectionCtx.dispose();
// Abrupt process exits happen only in a disposable child operating a temp database.
for(const mode of ['before','after']) {
 const path=join(dir,`crash-${mode}.sqlite`);const child=spawnSync(process.execPath,['--import','tsx',resolve('test/fixtures/durabilityCrash.ts'),path,mode],{encoding:'utf8',env:{...process.env,DEEPCHART_OFFLINE_CHILD:'1'},timeout:20000});
 assert.equal(child.status,mode==='before'?71:72,child.stderr);const s=new MarketDataStore(path),r=rows(s);assert.equal(r.length,mode==='before'?0:1);
 if(mode==='after'){const replay=s.saveTrades(r,'ES','fixture');assert.equal(replay.insertedIds.length,0);assert.equal(replay.duplicateIds.length,1);assert.equal(rows(s).length,1);}
 outcome(`crash ${mode} commit`,{childExit:child.status,rows:r.length,restoredVolume:r.reduce((a,t)=>a+t.size,0),counters:s.getTradeDurability()},mode==='before'?'no row survives uncommitted crash':'committed row survives no publication; restart overlap not duplicated');s.close();
}
let disk=new MarketDataStore(join(dir,'durable.sqlite'));let started=performance.now();const committed=disk.saveTrades(delivery,'ES','fixture');assert.equal(committed.status,'COMMITTED');assert.equal(committed.insertedIds.length,7);assert.equal(committed.duplicateIds.length,2);reconcile(rows(disk));
const lastCommitId=disk.getTradeDurability().lastCommittedId;assert.equal(lastCommitId,cohort.at(-1)!.id);disk.close();started=performance.now();disk=new MarketDataStore(join(dir,'durable.sqlite'));reconcile(rows(disk));const overlap=disk.saveTrades(delivery,'ES','fixture');assert.equal(overlap.insertedIds.length,0);assert.equal(overlap.duplicateIds.length,9);assert.equal(disk.getTradeDurability().lastCommittedId,null,'process counters do not fabricate restored watermark');
const persistedWatermark=(disk as any).db.prepare('SELECT trade_id FROM trades WHERE provider=? AND symbol=? ORDER BY rowid DESC LIMIT 1').get('fixture','ES').trade_id;assert.equal(persistedWatermark,lastCommitId);
const rtoMs=performance.now()-started;outcome('disk restart / duplicate overlap',{accepted:7,committed:7,restored:7,volume:19,lastCommittedId:lastCommitId,rpoCommittedRecords:0,rtoMs,counters:disk.getTradeDurability()},'exact IDs and independent analytics, zero committed-record loss');
const legacy=rows(disk).find(t=>t.id==='legacy-original')!;assert.equal(legacy.vendorIdentity,undefined);assert.equal(legacy.eventTsNs,undefined);assert.equal(legacy.identityKind,'LEGACY');
// WAL-aware online snapshot while another writer has uncommitted work: snapshot sees only commits.
const writer=new DatabaseSync(join(dir,'durable.sqlite'));writer.exec('BEGIN IMMEDIATE');writer.prepare('INSERT INTO trades (provider,symbol,trade_id,ts,price,size,side) VALUES (?,?,?,?,?,?,?)').run('fixture','ES','not-yet-committed',base,5000,99,'buy');
const snapshot=join(dir,'snapshot.sqlite');(disk as any).db.exec(`VACUUM INTO '${snapshot.replace(/'/g,"''")}'`);writer.exec('COMMIT');writer.close();
const snapDb=new DatabaseSync(snapshot,{readOnly:true});assert.equal(snapDb.prepare('PRAGMA integrity_check').get()!.integrity_check,'ok');assert.equal(snapDb.prepare('SELECT count(*) n FROM trades').get()!.n,7);snapDb.close();
const restorePath=join(dir,'restored.sqlite');copyFileSync(snapshot,restorePath);started=performance.now();const restored=new MarketDataStore(restorePath);reconcile(rows(restored));const restoreRtoMs=performance.now()-started;outcome('WAL online backup / restore',{snapshotCount:7,writerCommittedCount:8,backupBoundaryExcludedVolume:99,restoreRtoMs,rpoSnapshotCommittedRecords:0,oracle:expected},'snapshot exact at boundary; later commit explicitly outside snapshot');restored.close();
(disk as any).db.exec('PRAGMA wal_checkpoint(TRUNCATE)');disk.close();disk=new MarketDataStore(join(dir,'durable.sqlite'));assert.equal(rows(disk).length,8);outcome('WAL checkpoint / restart',{rows:8,volume:rows(disk).reduce((a,t)=>a+t.size,0)},'all 8 committed rows survive checkpoint');disk.close();
const corrupt=join(dir,'corrupt.sqlite');copyFileSync(snapshot,corrupt);const bytes=readFileSync(corrupt);bytes.fill(0,0,100);writeFileSync(corrupt,bytes);assert.throws(()=>{const d=new DatabaseSync(corrupt,{readOnly:true});try{assert.equal(d.prepare('PRAGMA integrity_check').get()!.integrity_check,'ok');}finally{d.close();}});outcome('isolated corruption detection',{detected:true,originalSnapshotUnchanged:true},'fail integrity/read; never report restored complete');
const restartCtx=new MarketContext('ES',getOrRegisterInstrument('ES'));await restartCtx.startFeed();restartCtx.provider='fixture';restartCtx.addSubscriber(new ChartSession(socket),'1m');reconcile(restartCtx.getHistoryTicks());assert.equal(restartCtx.getDurability().restored,7);assert.equal(restartCtx.ensureFootprintEngine('1m').getAllBars().at(-1)!.cvd,5);assert.equal((restartCtx as any).profile.getVolumeProfile().totalVolume,19);for(const t of delivery)(restartCtx as any).handleTrade({...t,ts:t.timestamp,side:t.side.toUpperCase()});assert.equal(restartCtx.getHistoryTicks().length,7);assert.equal(restartCtx.getDurability().persisted,0);outcome('normal context restoration',{counters:restartCtx.getDurability(),restoredCount:7,volume:19},'restore bounded window; no duplicate overlap publication');
await ctx.dispose();await failedCtx.dispose();await restartCtx.dispose();guard.assertBackend();guard.assertClean();
const evidence={scope:'OFFLINE FIXTURE ONLY',status:'DURABLE COMPLETE FOR FINITE FIXTURE COHORT',fixtureDir:dir,expected,cases,legacy:{id:legacy.id,metadata:'NOT CAPTURED'},rpoCommittedRecords:0,rtoMs,restoreRtoMs,guardViolations:0};writeFileSync(join(dir,'evidence.json'),JSON.stringify(evidence,null,2));console.log(JSON.stringify(evidence));console.log('DURABILITY OFFLINE PASS');process.exit(0);
