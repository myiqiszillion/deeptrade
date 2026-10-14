import '../../scripts/offline_guard.cjs';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtempSync,writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join,resolve } from 'node:path';
import { spawn,spawnSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { OrdinaryRuntimeGate,initializeOrdinaryRuntime } from '../src/marketData/ordinaryRuntime.js';
import { DatabentoLiveClient } from '../src/databento/liveClient.js';
import { MarketContextManager } from '../src/marketData/marketContext.js';
import { createMarketDataFeed } from '../src/marketData/registry.js';
import { ChartSession } from '../src/session.js';
import { getOrRegisterInstrument } from '../src/futuresConfig.js';
const guard=(globalThis as any)[Symbol.for('deepchart.offline.guard')];initializeOrdinaryRuntime({FUTURES_PROVIDER:'none'});
const dir=mkdtempSync(join(tmpdir(),'deepchart-lifecycle-')),cases:any[]=[];const now=Date.now();
const clock=()=>{let wall=now,mono=1;return {wall:()=>wall,mono:()=>mono,jump:(n:number)=>wall+=n,advance:(n:number)=>{wall+=n;mono+=n;}};};
const env=(path:string,id='fixture',expires=now+60000)=>({DATABENTO_APPROVAL_LEDGER:path,FUTURES_PROVIDER:'databento',DATABENTO_RUNTIME_START:'1',DATABENTO_API_KEY:'offline-sentinel',DATABENTO_RUNTIME_PROFILE:JSON.stringify({version:1,approved:true,approvalId:id,expiresAt:new Date(expires).toISOString(),dataset:'GLBX.MDP3',symbol:'ES',vendorSymbol:'ES.c.0',schema:'trades',history:false,gex:false,quoteBoard:false,reconnect:false})});
const record=(name:string,observed:any)=>{cases.push({name,observed});console.log('PASS '+name);};
for(const mode of ['reserved','attempt','subscription']){
 const path=join(dir,mode+'.sqlite');const child=spawnSync(process.execPath,['--import','tsx',resolve('test/fixtures/approvalCrash.ts'),path,'one-shot',mode,String(now)],{encoding:'utf8',env:{...process.env},timeout:10000});assert.equal(child.status,mode==='reserved'?81:mode==='attempt'?82:0);
 const c=clock(),reboot=new OrdinaryRuntimeGate(env(path,'one-shot'),now,c);assert.equal(reboot.profile,undefined);assert.match(reboot.reason,/reserved\/consumed\/revoked/);
 const db=new DatabaseSync(path,{readOnly:true});const row=db.prepare('SELECT id,state,attempts,commands,acks FROM approval_leases').get();db.close();record('Crash/restart '+mode,{childExit:child.status,row,reboot:reboot.reason});
}
const concurrentPath=join(dir,'concurrent.sqlite');
const concurrently=()=>new Promise<number|null>((resolve,reject)=>{const child=spawn(process.execPath,['--import','tsx',resolvePath(),concurrentPath,'concurrent','reserved',String(now)],{env:{...process.env},stdio:'ignore'});child.on('error',reject);child.on('exit',resolve);});
function resolvePath(){return resolve('test/fixtures/approvalCrash.ts');}
assert.deepEqual((await Promise.all([concurrently(),concurrently()])).sort(),[81,83]);record('Concurrent boots atomic reservation',{successfulReservations:1,deniedBoots:1});
assert.equal(new OrdinaryRuntimeGate(env('')).profile,undefined);record('Missing durable ledger fails closed',true);
const p=join(dir,'clock.sqlite'),c=clock(),g=new OrdinaryRuntimeGate(env(p),now,c);assert(g.allows('ES'));g.claimConnection('ES');g.subscription();assert.throws(()=>g.claimConnection('ES'),/budget/);assert.throws(()=>g.subscription(),/budget/);g.ack();g.ack();assert.equal(g.counters.subscriptionAcks,1);
c.advance(1000);assert(g.allows('ES'));c.jump(-10000);assert(!g.allows('ES'));assert.equal(new OrdinaryRuntimeGate(env(p,'fresh-after-rollback'),c.wall(),c).profile,undefined);record('Durable clock highwater / no expiry extension',{counters:g.counters});
const ep=join(dir,'expiry.sqlite'),ec=clock(),eg=new OrdinaryRuntimeGate(env(ep),now,ec);ec.advance(60001);ec.jump(-50000);assert(!eg.allows('ES'));record('Monotonic approval expiry',true);
const rp=join(dir,'revoked.sqlite'),rc=clock(),rg=new OrdinaryRuntimeGate(env(rp),now,rc);const db=new DatabaseSync(rp);db.exec("UPDATE approval_leases SET state='REVOKED'");db.close();assert(!rg.allows('ES'));assert.equal(new OrdinaryRuntimeGate(env(rp),now,rc).profile,undefined);record('Revoked approval remains denied',true);
class Socket extends EventEmitter {destroyed=false;writes:string[]=[];write(s:any){this.writes.push(String(s));return true;}destroy(){this.destroyed=true;return this;}}
function ack(){const b=Buffer.alloc(320);b[0]=80;b[1]=0x17;b[319]=1;return b;}
function trade(){const b=Buffer.alloc(48);b[0]=12;b.writeUInt32LE(800001,4);b.writeBigUInt64LE(BigInt(now)*1000000n,8);b.writeBigInt64LE(100000000000n,16);b.writeUInt32LE(2,24);b[28]=84;b[29]=66;return b;}
for(const mode of ['cancel-connect','half-open','remote-close','partial','entitlement','auth-denied','revoked-before-subscription','revoked-idle','oversized-metadata','expiry-within-chunk']) {
 const socket=new Socket(),statuses:any[]=[],errors:string[]=[];let received=0,attempts=0;const path=join(dir,mode+'.sqlite'),cl=clock(),gate=new OrdinaryRuntimeGate(env(path),now,cl);
 const f=createMarketDataFeed('ES',getOrRegisterInstrument('ES'),{onTrade:()=>{received++;if(mode==='expiry-within-chunk')cl.advance(60001);},onDepth:()=>assert.fail(),onStatus:s=>statuses.push(s),onError:e=>errors.push(e.message)},gate,(()=>{attempts++;return socket;}) as any).feed as DatabentoLiveClient;
 (f as any).clock=cl;
 await f.connect();const pending=[f.waitForLive(60000).then(()=> 'live',()=> 'cancelled'),f.waitForLive(60000).then(()=> 'live',()=> 'cancelled')];const callback=socket.listeners('data')[0] as any;
 if(mode==='revoked-before-subscription'||mode==='revoked-idle'){const d=new DatabaseSync(path);d.exec("UPDATE approval_leases SET state='REVOKED'");d.close();}
 if(mode==='revoked-idle'){const until=Date.now()+1500;while(!socket.destroyed&&Date.now()<until)await new Promise(r=>setTimeout(r,10));assert(socket.destroyed);}
 if(!['cancel-connect','half-open','remote-close','revoked-idle'].includes(mode)) {
   socket.emit('connect');socket.emit('data',Buffer.from(mode==='auth-denied'?'cram=fixture\nsuccess=0|error=denied\n':'cram=fixture\nsuccess=1\n'));
   const meta=Buffer.alloc(8);meta.write('DBN');meta[3]=3;if(mode==='oversized-metadata')meta.writeUInt32LE(1048577,4);socket.emit('data',meta);
 }
 if(mode==='expiry-within-chunk'){socket.emit('data',ack());socket.emit('data',Buffer.concat([trade(),trade()]));assert.equal(received,1,'expiry during a buffered chunk must stop subsequent records');assert.deepEqual(await Promise.all(pending),['live','live']);}
 if(mode==='oversized-metadata')assert(socket.destroyed,'oversized metadata must close without allocating it');
 if(mode==='partial'){socket.emit('data',ack());const b=trade();socket.emit('data',b.subarray(0,24));assert.equal(received,0);socket.emit('data',b.subarray(24));assert.equal(received,1);assert.deepEqual(await Promise.all(pending),['live','live']);}
 if(mode==='entitlement'){const b=Buffer.alloc(320);b[0]=80;b[1]=0x15;b.write('Not authorized for trades schema',16);socket.emit('data',b);}
 if(mode==='remote-close')socket.emit('close');
 await f.disconnect();if(!['partial','expiry-within-chunk'].includes(mode))assert.deepEqual(await Promise.all(pending),['cancelled','cancelled']);const count=received;callback(trade());assert.equal(received,count);assert(socket.destroyed);assert.equal(socket.eventNames().length,0);assert.equal((f as any).liveWaiters.size,0);assert.equal((f as any).approvalTimer,undefined);assert.equal((f as any).authorizationTimer,undefined);assert.equal((f as any).reconnectTimer,null);assert.equal(attempts,1);record('Mock lifecycle '+mode,{attempts,received,errors,commands:socket.writes.filter(s=>s.startsWith('schema=')),counters:gate.counters,statuses:statuses.map(s=>s.state),timers:0,listeners:0});
}
const failGate=new OrdinaryRuntimeGate(env(join(dir,'factory-throw.sqlite')),now,clock());const failing=createMarketDataFeed('ES',getOrRegisterInstrument('ES'),{onTrade:()=>{},onDepth:()=>{},onStatus:()=>{},onError:()=>{}},failGate,(()=>{throw new Error('fixture connect factory failed');}) as any).feed as DatabentoLiveClient;await assert.rejects(failing.connect(),/factory failed/);assert.equal((failing as any).approvalTimer,undefined);assert.equal((failing as any).authorizationTimer,undefined);assert.equal(failGate.counters.connectionAttempts,1);await assert.rejects(failing.connect(),/budget/);record('Synchronous connect failure consumes attempt / clears timers',{attempts:1,timers:0});
// Never-resolving initialization must be cancellable without a vendor retry.
let disconnects=0,h:any;const manager=new MarketContextManager(undefined,undefined,undefined,((s:string,_i:any,handlers:any)=>{h=handlers;return {provider:'pending-fixture',feed:{provider:'pending-fixture',symbol:s,connect:()=>new Promise<void>(()=>{}),disconnect:async()=>{disconnects++;},isConnected:()=>false}};}) as any);
const init=manager.getOrCreateContext('NQ');const rejected=assert.rejects(init,/disposed/);await Promise.resolve();await Promise.resolve();const started=performance.now();await Promise.race([manager.disposeAll(),new Promise((_,reject)=>setTimeout(()=>reject(new Error('shutdown hung')),500))]);await rejected;assert.equal(disconnects,1);assert.equal(manager.getAllContexts().length,0);h.onTrade({ts:now,price:100,size:1,side:'BUY'});record('Pending initialization cancellation',{disconnects,shutdownMs:performance.now()-started,contexts:0});

// Whole-session detach must also invalidate owners that have not finished initialization.
let release!:()=>void;const pendingOwners=new MarketContextManager(undefined,undefined,undefined,((s:string)=>({provider:'pending-owner',feed:{provider:'pending-owner',symbol:s,connect:()=>new Promise<void>(r=>{release=r;}),disconnect:async()=>{},isConnected:()=>false}})) as any);
const session=new ChartSession({readyState:1,bufferedAmount:0,send:()=>{}} as any);const attach=pendingOwners.subscribe(session,'NQ','1m',session.nextGeneration('pane'),'pane');await Promise.resolve();await Promise.resolve();pendingOwners.unsubscribe(session);release();await attach;assert.equal(session.subscriptionOwners.size,0);assert.equal(pendingOwners.getContext('NQ')!.subscriberCount,0);await pendingOwners.disposeAll();record('Late pending pane after whole-session detach inert',{owners:0,subscribers:0});
let closed=0;const slowSession=new ChartSession({readyState:1,bufferedAmount:16777217,close:(code:number)=>{assert.equal(code,1008);closed++;},send:()=>assert.fail()} as any);slowSession.send({type:'PONG',timestamp:now});assert.equal(closed,1);record('Backpressure overflow disconnects without queueing',{closed,bufferedBytes:16777217,applicationQueue:0});

guard.assertBackend();guard.assertClean();writeFileSync(join(dir,'evidence.json'),JSON.stringify({scope:'OFFLINE ONLY',cases,guardViolations:0},null,2));console.log('LIFECYCLE OFFLINE PASS '+cases.length+' cases '+dir);
