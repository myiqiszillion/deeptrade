import '../../../scripts/offline_guard.cjs';
import { OrdinaryRuntimeGate } from '../../src/marketData/ordinaryRuntime.js';
const [path,id,mode,wall]=process.argv.slice(2);
const now=Number(wall);const clock={wall:()=>now,mono:()=>1};
const gate=new OrdinaryRuntimeGate({DATABENTO_APPROVAL_LEDGER:path,FUTURES_PROVIDER:'databento',DATABENTO_RUNTIME_START:'1',DATABENTO_API_KEY:'offline-child-sentinel',DATABENTO_RUNTIME_PROFILE:JSON.stringify({version:1,approved:true,approvalId:id,expiresAt:new Date(now+60000).toISOString(),dataset:'GLBX.MDP3',symbol:'ES',vendorSymbol:'ES.c.0',schema:'trades',history:false,gex:false,quoteBoard:false,reconnect:false})},now,clock);
if(!gate.profile){console.log(gate.reason);process.exit(83);}
if(mode==='reserved')process.exit(81);
gate.claimConnection('ES');if(mode==='attempt')process.exit(82);
gate.subscription();process.exit(0);
