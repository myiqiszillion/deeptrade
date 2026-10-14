import './offline_guard.cjs';
import assert from 'node:assert/strict';
import { WebSocket } from '../server/node_modules/ws/wrapper.mjs';
import { FeedHealth } from '../server/dist/marketData/feedHealth.js';
/** Finite offline exercise, never a vendor benchmark. */
export async function runLifecycleSoak({page,page2,es,nq,record,state,waitState,checkCanvas,port,token,messages,seed}) {
 const started=performance.now(),limitMs=60000,limitHeap=768*1024*1024,recordsPerSymbol=500,samples=[];
 const deadline=setTimeout(()=>{console.error('Offline soak hard deadline exceeded');process.exit(1);},limitMs);
 let slow;try {
   await page.evaluate(()=>{const r=document.getElementById('root');const k=Object.keys(r).find(k=>k.startsWith('__reactContainer$'));const q=[r[k].stateNode.current];while(q.length){const f=q.pop();if(f.child)q.push(f.child);if(f.sibling)q.push(f.sibling);if(f.type?.name==='TerminalHeader'){f.memoizedProps.onSelectSymbol('ES');return;}}});
   await waitState(page,s=>s.canvases[0]?.symbol==='ES'&&s.profile.totalVolume===15);
   const totals={ES:{volume:15,buy:8,sell:3,unknown:4,cvd:5},NQ:{volume:16,buy:7,sell:4,unknown:5,cvd:3}},bins={ES:new Map([[100,7],[100.25,3],[100.5,5]]),NQ:new Map([[100,6],[100.25,5],[100.5,5]])};
   const candles={ES:new Map(),NQ:new Map()};
   function candle(symbol,t){const time=Math.floor(t.ts/60000)*60000;const b=candles[symbol].get(time)||{time,open:t.price,high:t.price,low:t.price,close:t.price,volume:0};b.high=Math.max(b.high,t.price);b.low=Math.min(b.low,t.price);b.close=t.price;b.volume+=t.size;candles[symbol].set(time,b);}
   for(const symbol of ['ES','NQ'])for(const t of seed[symbol])candle(symbol,t);
   for(const c of [es,nq]){c.health=new FeedHealth({wall:()=>Date.UTC(2026,9,14,15),mono:()=>100});c.health.begin();c.health.signal('ACKNOWLEDGED');}
   slow=new WebSocket(`ws://127.0.0.1:${port}`,{headers:{Authorization:`Bearer ${token}`}});await new Promise((r,j)=>{slow.once('open',r);slow.once('error',j);});slow.send(JSON.stringify({type:'SUBSCRIBE',symbol:'ES',timeframe:'1m'}));await new Promise(r=>setTimeout(r,50));slow._socket.pause();
   for(let batch=0;batch<10;batch++) {
     await page.locator('button:has-text("Layout:")').click();await page.waitForSelector('.secondary-chart-pane');const sel=page.locator('select[title="Pane 2 Symbol"]');if(await sel.inputValue()!=='NQ')await sel.selectOption('NQ');
     for(let j=1;j<=50;j++)for(const [symbol,c] of [['ES',es],['NQ',nq]]) {
       const i=batch*50+j,side=['B','A','N'][(i+(symbol==='NQ'?1:0))%3],size=i%5+1,price=100+(i%4)*.25,t=record(symbol,1000+i,side,price,size,62000+i*1000);c.handleTrade(t);candle(symbol,t);
       const o=totals[symbol];o.volume+=size;o[side==='B'?'buy':side==='A'?'sell':'unknown']+=size;o.cvd=o.buy-o.sell;bins[symbol].set(price,(bins[symbol].get(price)||0)+size);
     }
     es.flushTrailingAnalytics();nq.flushTrailingAnalytics();
     await waitState(page,s=>s.profile.totalVolume===totals.ES.volume&&s.canvases.find(c=>c.symbol==='NQ')?.bars.reduce((n,b)=>n+b.volume,0)===totals.NQ.volume);
     const sample={batch,heapUsed:process.memoryUsage().heapUsed,rss:process.memoryUsage().rss,pausedLoopbackSocket:!slow._socket.destroyed,contexts:[es,nq].map(c=>({symbol:c.symbol,history:c.getHistoryTicks().length,liveQueue:c.liveBuffer.length,pending:c.getDurability().pending,subscribers:c.subscriberCount,timers:[c.healthTimer,c.trailingAnalyticsTimer,c.cleanupTimer,c.gexTimer].filter(Boolean).length})),messages:messages.length};samples.push(sample);assert(sample.heapUsed<limitHeap);assert(messages.length<20000);assert(sample.contexts.every(c=>c.liveQueue===0&&c.pending===0&&c.history<=5000));
     await page.locator('button[title="Close Split Pane (Return to Single Chart)"]').click();await page.waitForTimeout(40);
     if(batch===4){await page2.reload();await page2.waitForSelector('#chart-surface');await waitState(page2,s=>s.profile?.totalVolume===totals.NQ.volume);}
   }
   for(const [s,c]of [['ES',es],['NQ',nq]]){c.health.clock={wall:()=>Date.UTC(2026,9,14,15),mono:()=>61101};c.refreshFeedHealth();assert.equal(c.getFeedHealth().state,'STALE');c.health.clock={wall:()=>Date.UTC(2026,9,14,15),mono:()=>100};c.refreshFeedHealth();assert.equal(c.getFeedHealth().state,'LIVE');await c.stopFeed();}
   const finalES=await waitState(page,s=>s.profile.totalVolume===totals.ES.volume&&s.health.state==='UNAVAILABLE'),finalNQ=await waitState(page2,s=>s.profile.totalVolume===totals.NQ.volume&&s.health.state==='UNAVAILABLE');checkCanvas(finalES.canvases[0],totals.ES);checkCanvas(finalNQ.canvases[0],totals.NQ);
   for(const [s,ui]of [['ES',finalES],['NQ',finalNQ]]){const expectedBars=[...candles[s].values()].sort((a,b)=>a.time-b.time);assert.deepEqual(ui.canvases[0].bars.map(b=>({time:b.time,open:b.open,high:b.high,low:b.low,close:b.close,volume:b.volume})),expectedBars);totals[s].minuteBars=expectedBars.length;
     const expected=[...bins[s]].sort((a,b)=>a[0]-b[0]);assert.deepEqual(ui.profile.levels.map(l=>[l.price,l.volume]),expected);const poc=expected.reduce((a,b)=>b[1]>a[1]?b:a)[0];assert.equal(ui.profile.poc,poc);assert.equal(ui.profile.dataEvidence.coverage,'PARTIAL');assert.equal(ui.cvd,totals[s].cvd);totals[s].poc=poc;}
   slow._socket.resume();slow.terminate();await new Promise(r=>slow.once('close',r));
   const browserHeaps=[];for(const p of [page,page2]){const cdp=await p.context().newCDPSession(p);await cdp.send('Performance.enable');const metrics=await cdp.send('Performance.getMetrics');await cdp.detach();const heap=metrics.metrics.find(m=>m.name==='JSHeapUsedSize')?.value;assert(heap<512*1024*1024);browserHeaps.push(heap);}
   return {scope:'OFFLINE ONLY; finite soak, not long-duration acceptance',durationMs:performance.now()-started,limits:{deadlineMs:limitMs,serverHeapBytes:limitHeap,browserHeapBytes:512*1024*1024,workers:1,browsers:2,slowLoopbackWsConsumers:1,records:1000},recordsPerSymbol,oracle:totals,samples,browserHeaps,slowConsumer:'real authenticated loopback WS read paused, resumed and terminated; overflow threshold separately unit tested',paneCycles:10,browserReloads:1,stallRecovery:'monotonic fixture simulation, no vendor reconnect',final:{ES:finalES,NQ:finalNQ},durability:{ES:es.getDurability(),NQ:nq.getDurability()}};
 }finally{clearTimeout(deadline);slow?.terminate();}
}
