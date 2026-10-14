import '../../../scripts/offline_guard.cjs';
import { MarketDataStore,marketDataStore } from '../../src/storage/marketDataStore.js';
import { MarketContext } from '../../src/marketData/marketContext.js';
import { initializeOrdinaryRuntime } from '../../src/marketData/ordinaryRuntime.js';
import { getOrRegisterInstrument } from '../../src/futuresConfig.js';
import { parseDbnRecord } from '../../src/databento/liveClient.js';
export function bindStore(path:string){const store=new MarketDataStore(path);for(const k of ['queryTrades','queryBars','tradeIdentityStatus','saveTrades','saveBar','saveBars'] as const)(marketDataStore as any)[k]=(store as any)[k].bind(store);return store;}
export function trade(i:number,base:number,instrument=800001){const b=Buffer.alloc(48);b[0]=12;b.writeUInt16LE(17,2);b.writeUInt32LE(instrument,4);b.writeBigUInt64LE(BigInt(base+i*1000)*1000000n+BigInt(i),8);b.writeBigInt64LE(BigInt(100000000000+i%3*250000000),16);b.writeUInt32LE(i%3+1,24);b[28]=84;b[29]=['B','A','N'][i%3].charCodeAt(0);b.writeBigUInt64LE(BigInt(base+i*1000)*1000000n+10000n,32);b.writeUInt32LE(i,44);return parseDbnRecord(b,'ES','offline-recovery',3,{dataset:'GLBX.MDP3',schema:'trades',sourceKind:'LOCAL_FIXTURE'}).parsed!.trade!;}
export function context(onTick?:()=>void){return new MarketContext('ES',getOrRegisterInstrument('ES'),undefined,onTick,undefined,undefined,((s:string,_i:any,h:any)=>({provider:'phase07-recovery',feed:{symbol:s,provider:'phase07-recovery',connect:async()=>{h.onStatus({state:'ACKNOWLEDGED',symbol:s,provider:'phase07-recovery'});},disconnect:async()=>{},isConnected:()=>true}})) as any);}
if(process.argv[1]?.endsWith('recoveryCrash.ts')){initializeOrdinaryRuntime({FUTURES_PROVIDER:'none'});const [path,base]=process.argv.slice(2);bindStore(path);const c=context(()=>process.exit(84));await c.startFeed();(c as any).handleTrade(trade(1,Number(base)));process.exit(85);}
