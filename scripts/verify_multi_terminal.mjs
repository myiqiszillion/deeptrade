// Offline fixtures through the normal index/ChartSession and actual App/components.
import './offline_guard.cjs';
const { parseDbnRecord } = await import('../server/dist/databento/liveClient.js');
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import { chromium } from '@playwright/test';
import { createServer as createViteServer } from '../client/node_modules/vite/dist/node/index.js';

Object.assign(process.env, { NODE_ENV: 'test', FUTURES_PROVIDER: 'none', DATABENTO_API_KEY: '',
  STORAGE_PATH: ':memory:', AUTH_REQUIRED: '1', AUTH_JWT_SECRET: 'offline-terminal-only-fixture-secret-123456',
  ADMIN_USERNAME: 'offline_terminal', ADMIN_PASSWORD: 'OfflineFixtureOnly!123',
  PORT: '0', HOST: '127.0.0.1', ENABLE_QUOTE_BOARD: '0', DEV_HOOKS: '0' });
let externalCalls = 0;
globalThis.fetch = async () => { externalCalls++; throw new Error('Offline Terminal prohibits external fetch'); };
const backend = await import('../server/dist/index.js');
if (!backend.httpServer.listening) await new Promise(resolve => backend.httpServer.once('listening', resolve));
const port = backend.httpServer.address().port;
process.env.VITE_WS_URL = `ws://127.0.0.1:${port}`;
let vite; let browser;
const messages = []; const browserErrors = [];
const output = path.join(os.homedir(), '.codex', 'private-acceptance', `multi-terminal-offline-${Date.now()}`);
const repoRoot = process.cwd();
fs.mkdirSync(output, { recursive: true });
try {
  process.chdir(path.join(repoRoot, 'client'));
  vite = await createViteServer({ configFile: path.join(repoRoot, 'client/vite.config.ts'), root: path.join(repoRoot, 'client'),
    server: { host: '127.0.0.1', port: 0, proxy: { '/api': { target: `http://127.0.0.1:${port}`, changeOrigin: true } } } });
  await vite.listen();
  const browserRoot = path.join(os.homedir(), 'AppData/Local/ms-playwright');
  const executable = fs.readdirSync(browserRoot).filter(n => /^chromium-\d+$/.test(n)).sort((a, b) => Number(b.split('-')[1]) - Number(a.split('-')[1])).map(n => path.join(browserRoot, n, 'chrome-win64/chrome.exe')).find(n => fs.existsSync(n));
  browser = await chromium.launch({ headless: true, executablePath: executable });
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  const token = await new Promise((resolve, reject) => {
    const request = http.request({ host: '127.0.0.1', port, path: '/api/v1/auth/login', method: 'POST', headers: { 'Content-Type': 'application/json' } }, response => {
      let text = ''; response.on('data', c => { text += c; }); response.on('end', () => {
        if (response.statusCode !== 200) reject(new Error('Offline login failed')); else resolve(JSON.parse(text).token);
      });
    });
    request.on('error', reject);
    request.end(JSON.stringify({ username: 'offline_terminal', password: 'OfflineFixtureOnly!123' }));
  });
  page.on('pageerror', error => browserErrors.push(error.message));
  page.on('websocket', ws => ws.on('framereceived', frame => { try { messages.push(JSON.parse(String(frame.payload))); } catch {} }));
  await page.addInitScript(token => {
    localStorage.setItem('deepchart_jwt_token', token);
    localStorage.setItem('deepchart.onboarding.v1', 'dismissed');
    localStorage.setItem('deepchart_free_settings_v1', JSON.stringify({ symbol: 'ES', timeframe: '1m', activePanel: 'Profile', showCVD: true, chartMode: 'footprint' }));
  }, token);
  await page.goto(`http://127.0.0.1:${vite.httpServer.address().port}/`);
  await page.waitForSelector('#chart-surface');

  const es = await backend.offlineTerminalTestContext('ES');
  const nq = await backend.offlineTerminalTestContext('NQ');
  const clocks={ES:{wall:()=>Date.UTC(2026,9,14,15),mono:()=>100},NQ:{wall:()=>Date.UTC(2026,9,14,15),mono:()=>100}};
  for (const [symbol,ctx] of [['ES',es],['NQ',nq]]) { ctx.provider='phase06-ui-fixture';ctx.clock=clocks[symbol];ctx.health.clock=clocks[symbol];ctx.health.begin();for(const s of ['AUTHENTICATED','SUBSCRIBING','ACKNOWLEDGED'])ctx.health.signal(s);ctx.refreshFeedHealth(); }
  const base=Math.floor(Date.now()/60000)*60000-60000;
  function record(symbol,index,side,price,size,offset) {
    const b=Buffer.alloc(48);b[0]=12;b[1]=0;b.writeUInt16LE(17,2);b.writeUInt32LE(symbol==='ES'?800001:800002,4);b.writeBigUInt64LE(BigInt(base+offset)*1000000n+BigInt(index),8);b.writeBigInt64LE(BigInt(Math.round(price*1e9)),16);b.writeUInt32LE(size,24);b[28]=84;b[29]=side.charCodeAt(0);b.writeBigUInt64LE(BigInt(base+offset)*1000000n+1000n,32);b.writeUInt32LE(index,44);
    const t=parseDbnRecord(b,symbol,'offline-ui-fixture',3,{dataset:'GLBX.MDP3',schema:'trades',sourceKind:'LOCAL_FIXTURE'}).parsed.trade;t.receiveTs=Date.now();return t;
  }
  const cohort={ES:[record('ES',1,'B',100,2,0),record('ES',2,'A',100.25,3,1000),record('ES',3,'N',100,4,2000),record('ES',4,'B',100.5,5,61000)],NQ:[record('NQ',1,'A',100,2,0),record('NQ',2,'B',100.25,3,1000),record('NQ',3,'B',100,4,2000),record('NQ',4,'N',100.5,5,61000)]};
  const oracle={ES:{volume:14,buy:7,sell:3,unknown:4,cvd:4,poc:100},NQ:{volume:14,buy:7,sell:2,unknown:5,cvd:5,poc:100}};
  await page.locator('button:has-text("Layout:")').click();
  await page.waitForSelector('.secondary-chart-pane');
  const select=page.locator('select[title="Pane 2 Symbol"]');if(await select.inputValue()!=='NQ')await select.selectOption('NQ');
  const page2=await browser.newPage({viewport:{width:1920,height:1080}});
  page2.on('pageerror',e=>browserErrors.push(e.message));page2.on('websocket',ws=>ws.on('framereceived',f=>{try{messages.push({...JSON.parse(String(f.payload)),browser:'second'});}catch{}}));
  await page2.addInitScript(token=>{localStorage.setItem('deepchart_jwt_token',token);localStorage.setItem('deepchart.onboarding.v1','dismissed');localStorage.setItem('deepchart_free_settings_v1',JSON.stringify({symbol:'NQ',timeframe:'1m',activePanel:'Profile',showCVD:true,chartMode:'footprint'}));},token);
  await page2.goto(`http://127.0.0.1:${vite.httpServer.address().port}/`);await page2.waitForSelector('#chart-surface');
  await page.waitForFunction(()=>document.querySelector('[data-testid="pane-feed-health"]')?.textContent?.includes('INDETERMINATE'));
  for(let i=0;i<4;i++){es.handleTrade(cohort.ES[i]);nq.handleTrade(cohort.NQ[i]);}
  es.flushTrailingAnalytics();nq.flushTrailingAnalytics();
  async function state(page){return page.evaluate(()=>{const result={canvases:[]};const root=document.getElementById('root');const k=Object.keys(root).find(k=>k.startsWith('__reactContainer$'));const stack=[root[k].stateNode.current];while(stack.length){const f=stack.pop();if(f.child)stack.push(f.child);if(f.sibling)stack.push(f.sibling);const p=f.memoizedProps;if(f.type?.name==='FootprintCanvas'){let pane='default';for(let a=f.return;a;a=a.return)if(a.type?.name==='SecondaryChartPane'){pane=a.memoizedProps.id;break;}result.canvases.push({pane,symbol:p.symbol,bars:p.bars,chartMode:p.chartMode});}if(f.type?.name==='CVDPanel')result.cvd=p.currentCVD;if(f.type?.name==='ProfileOverlay')result.profile=p.volumeProfile;if(f.type?.name==='TerminalStatusBar')result.health=p.feedHealth; }return result;});}
  async function waitState(page,predicate){let s;for(let i=0;i<50;i++){s=await state(page);if(predicate(s))return s;await page.waitForTimeout(50);}throw new Error('Numeric state timeout '+JSON.stringify(s));}
  const first=await waitState(page,s=>s.canvases.length===2&&s.canvases.every(c=>c.bars.reduce((n,b)=>n+b.volume,0)===14)&&s.profile.totalVolume===14);
  const second=await waitState(page2,s=>s.canvases.find(c=>c.symbol==='NQ')?.bars.reduce((n,b)=>n+b.volume,0)===14&&s.profile.totalVolume===14);
  function checkCanvas(c,o){assert.equal(c.bars.reduce((n,b)=>n+b.volume,0),o.volume);assert.equal(c.bars.reduce((n,b)=>n+b.buyVolume,0),o.buy);assert.equal(c.bars.reduce((n,b)=>n+b.sellVolume,0),o.sell);assert.equal(c.bars.flatMap(b=>Object.values(b.levels)).reduce((n,l)=>n+(l.unknownVol||0),0),o.unknown);assert.equal(c.bars.at(-1).cvd,o.cvd);const key=c.symbol==='ES'?'GLBX.MDP3/17/800001':'GLBX.MDP3/17/800002';assert(c.bars.every(b=>b.dataEvidence.source==='LOCAL_FIXTURE'&&b.dataEvidence.coverage==='PARTIAL'&&b.dataEvidence.contracts.every(x=>x===key)));}
  for(const c of first.canvases)checkCanvas(c,oracle[c.symbol]);checkCanvas(second.canvases[0],oracle.NQ);assert.equal(first.cvd,4);assert.equal(second.cvd,5);assert.equal(first.profile.poc,100);assert.equal(second.profile.poc,100);assert.equal(second.profile.unknownVolume,5);
  assert((await page.getByTestId('pane-provenance').textContent()).includes('LOCAL_FIXTURE'));
  await select.selectOption('ES');
  const shared=await waitState(page,s=>s.canvases.length===2&&s.canvases.every(c=>c.symbol==='ES'&&c.bars.reduce((n,b)=>n+b.volume,0)===14));
  assert.equal(es.subscriberCount,1,'Two pane owners share one session attachment'); assert.equal(nq.subscriberCount,1);
  await select.selectOption('NQ');
  await waitState(page,s=>s.canvases.find(c=>c.pane==='pane2')?.symbol==='NQ'&&s.canvases.find(c=>c.pane==='pane2')?.bars.reduce((n,b)=>n+b.volume,0)===14);
  assert.equal(nq.subscriberCount,2);
  assert.equal(first.health.state,'LIVE');assert((await page.getByTestId('pane-feed-health').textContent()).includes('LIVE'));
  clocks.ES.mono=()=>61101;es.refreshFeedHealth();await page.waitForFunction(()=>document.querySelector('[data-testid="feed-health"]')?.textContent?.includes('STALE'));
  assert((await page.getByTestId('pane-feed-health').textContent()).includes('LIVE'));assert((await page2.getByTestId('feed-health').textContent()).includes('LIVE'));
  const finalES=record('ES',5,'B',100,1,62000),finalNQ=record('NQ',5,'A',100.25,2,62000);es.handleTrade(finalES);nq.handleTrade(finalNQ);await es.stopFeed();await nq.stopFeed();
  const final1=await waitState(page,s=>s.profile.totalVolume===15&&s.canvases.find(c=>c.symbol==='NQ')?.bars.reduce((n,b)=>n+b.volume,0)===16&&s.health.state==='UNAVAILABLE');
  const final2=await waitState(page2,s=>s.profile.totalVolume===16&&s.health.state==='UNAVAILABLE');
  checkCanvas(final1.canvases.find(c=>c.symbol==='ES'),{volume:15,buy:8,sell:3,unknown:4,cvd:5});checkCanvas(final1.canvases.find(c=>c.symbol==='NQ'),{volume:16,buy:7,sell:4,unknown:5,cvd:3});assert.equal(final1.cvd,5);assert.equal(final2.cvd,3);assert.equal(final1.profile.totalVolume,15);assert.equal(final2.profile.totalVolume,16);
  assert((await page.getByTestId('pane-feed-health').textContent()).includes('UNAVAILABLE'),'Queued tick must not resurrect secondary LIVE');
  assert(messages.some(m=>m.type==='BAR_CLOSE'&&m.symbol==='ES'));assert(messages.some(m=>m.type==='BAR_CLOSE'&&m.symbol==='NQ'));
  const subscriberBeforeClose=nq.subscriberCount;await page.locator('button[title="Close Split Pane (Return to Single Chart)"]').click();
  for(let i=0;i<30&&nq.subscriberCount===subscriberBeforeClose;i++)await page.waitForTimeout(50);assert.equal(nq.subscriberCount,1,'Closing pane removes only its owner, second authenticated browser retained');assert.equal(es.subscriberCount,1);
  // Primary switches to NQ using the real header; no duplicated ownership or ES data in NQ.
  await page.evaluate(()=>{const r=document.getElementById('root');const k=Object.keys(r).find(k=>k.startsWith('__reactContainer$'));const q=[r[k].stateNode.current];while(q.length){const f=q.pop();if(f.child)q.push(f.child);if(f.sibling)q.push(f.sibling);if(f.type?.name==='TerminalHeader'){f.memoizedProps.onSelectSymbol('NQ');return;}}throw new Error('Header missing');});
  const switched=await waitState(page,s=>s.canvases.length===1&&s.canvases[0].symbol==='NQ'&&s.profile.totalVolume===16);assert.equal(switched.cvd,3);assert.equal(es.subscriberCount,0);assert.equal(nq.subscriberCount,2);assert.equal(switched.health.state,'UNAVAILABLE');
  await page.screenshot({path:path.join(output,'multi-terminal.png')});await page2.close();await page.close();
  for(let i=0;i<30&&nq.subscriberCount;i++)await new Promise(r=>setTimeout(r,50));assert.equal(nq.subscriberCount,0);assert.equal(es.subscriberCount,0);assert.equal(externalCalls,0);assert.deepEqual(browserErrors,[]);
  fs.writeFileSync(path.join(output,'result.json'),JSON.stringify({scope:'OFFLINE FIXTURE — NOT LIVE',cohort,oracle,first,second,shared,final1,final2,switched,finalTrades:{ES:finalES,NQ:finalNQ},durability:{ES:es.getDurability(),NQ:nq.getDurability()},health:{ES:es.getFeedHealth(),NQ:nq.getFeedHealth()},externalCalls,browserErrors,messageCounts:messages.reduce((a,m)=>({...a,[`${m.symbol||'control'}:${m.type}`]:(a[`${m.symbol||'control'}:${m.type}`]||0)+1}),{})},null,2));
  console.log('MULTI TERMINAL UI OFFLINE PASS: two authenticated browsers / ES primary + NQ secondary / independent state / final updates / owned cleanup');console.log('Offline evidence: '+output);
} catch(error){console.error(error);process.exitCode=1;}
finally{await browser?.close();await vite?.close();await backend.closeServer();process.exit(process.exitCode??0);}
