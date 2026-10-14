import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
const status=await (await fetch('http://127.0.0.1:8080/api/v1/status')).json();
console.log(JSON.stringify({ordinaryRuntime:status.ordinaryRuntime,contexts:status.activeContexts}));
for(const p of ['/app/server/dist/storage/marketDataStore.js','/app/server/dist/marketData/marketContext.js']) { console.log(p,createHash('sha256').update(readFileSync(p)).digest('hex')); }
