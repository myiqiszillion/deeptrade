import {createHash} from 'node:crypto';import {readFileSync} from 'node:fs';
const s=await(await fetch('http://127.0.0.1:8080/api/v1/status')).json();console.log(JSON.stringify({ordinaryRuntime:s.ordinaryRuntime,contexts:s.activeContexts}));
for(const f of ['marketData/dataEvidence.js','marketData/marketContext.js','profileEngine.js','storage/marketDataStore.js'])console.log(f,createHash('sha256').update(readFileSync('/app/server/dist/'+f)).digest('hex'));
