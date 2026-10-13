// Offline fixtures through the normal index/ChartSession and actual App/components.
import './offline_guard.cjs';
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
const output = path.join(os.homedir(), '.codex', 'private-acceptance', `regular-terminal-offline-${Date.now()}`);
const repoRoot = process.cwd();
fs.mkdirSync(output, { recursive: true });
function fixture(index, side, price, size) {
  return { id: `fixture-${index}`, ts: Date.UTC(2026, 9, 12, 15, 33, 58) + index * 1000,
    price, size, side, sourceProvider: 'fixture', aggressorProvenance: side === 'UNKNOWN' ? 'UNKNOWN' : 'EXCHANGE_NATIVE' };
}
const trades = [fixture(0, 'BUY', 100, 2), fixture(1, 'SELL', 100.25, 3), fixture(2, 'UNKNOWN', 100, 4), fixture(3, 'BUY', 100.5, 5)];
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
  await page.evaluate(() => {
    const label = document.createElement('div'); label.textContent = 'OFFLINE FIXTURE — NOT DATABENTO LIVE';
    Object.assign(label.style, { position: 'fixed', top: '0', left: '35%', zIndex: '99999', background: '#7c2d12', color: 'white', pointerEvents: 'none' });
    document.body.append(label);
  });
  await page.waitForTimeout(1000);
  assert(messages.some(m => m.type === 'INIT_STATE' && m.symbol === 'ES'));
  const context = await backend.offlineTerminalTestContext('ES');
  context.provider = 'fixture'; // Explicit provenance; no vendor factory is started.
  for (const trade of trades) context.handleTrade(trade); // Runtime private method, test-only process.
  await page.waitForTimeout(800);
  async function components() {
    return page.evaluate(() => {
      const result = {};
      const root = document.getElementById('root');
      const key = Object.keys(root).find(k => k.startsWith('__reactContainer$'));
      const stack = key ? [root[key].stateNode.current] : [];
      while (stack.length) {
          const fiber = stack.pop();
          if (fiber.child) stack.push(fiber.child);
          if (fiber.sibling) stack.push(fiber.sibling);
          const name = fiber.type?.name;
          if (['FootprintCanvas', 'CVDPanel', 'ProfileOverlay', 'TerminalHeader'].includes(name)) {
            const p = fiber.memoizedProps;
            result[name] = { bars: p.bars, historyBars: p.historyBars, currentCVD: p.currentCVD,
              volumeProfile: p.volumeProfile, symbol: p.symbol, timeframe: p.timeframe, chartMode: p.chartMode, tickSize: p.tickSize,
              instrument: p.instrument, feedStatus: p.feedStatus };
          }
      }
      return result;
    });
  }
  const state = await components();
  fs.writeFileSync(path.join(output, 'before-stop.json'), JSON.stringify({ source: 'OFFLINE_FIXTURE', messages, state }, null, 2));
  const ticks = messages.filter(m => m.type === 'TICK' && m.symbol === 'ES');
  assert.equal(ticks.length, 4); assert(ticks.every(m => m.tick.sourceProvider === 'fixture'));
  assert(messages.some(m => m.type === 'BAR_UPDATE')); assert(messages.some(m => m.type === 'BAR_CLOSE')); assert(messages.some(m => m.type === 'PROFILE_UPDATE'));
  assert(state.FootprintCanvas && state.CVDPanel && state.ProfileOverlay, 'Actual normal UI components mounted');
  const volume = state.FootprintCanvas.bars.reduce((n, b) => n + b.volume, 0);
  assert.equal(volume, 14, 'Final Footprint received all fixture volume');
  assert.equal(state.ProfileOverlay.volumeProfile.totalVolume, 14, 'Final Profile propagated through normal WS');
  assert.equal(state.CVDPanel.currentCVD, 4);
  assert.equal(state.FootprintCanvas.symbol, 'ES'); assert.equal(state.FootprintCanvas.timeframe, '1m');
  assert.equal(state.TerminalHeader.instrument.symbol, 'ES'); assert.equal(state.TerminalHeader.instrument.pointValue, 50);
  assert.equal(state.ProfileOverlay.volumeProfile.poc, 100);
  assert.equal(state.ProfileOverlay.volumeProfile.provenance, 'EXACT');
  assert.notEqual(state.ProfileOverlay.volumeProfile.coverage, 'COMPLETE');
  const bars = state.FootprintCanvas.bars;
  assert.deepEqual(bars.map(b => [b.time, b.open, b.high, b.low, b.close, b.volume, b.buyVolume, b.sellVolume]), [
    [Date.UTC(2026, 9, 12, 15, 33), 100, 100.25, 100, 100.25, 5, 2, 3],
    [Date.UTC(2026, 9, 12, 15, 34), 100, 100.5, 100, 100.5, 9, 5, 0],
  ]);
  assert.equal(bars[1].levels['100'].unknownVol, 4);
  assert.equal(state.ProfileOverlay.volumeProfile.levels.find(l => l.price === 100).volume, 6);
  assert.deepEqual(state.ProfileOverlay.volumeProfile.levels.map(l => [l.price, l.volume, l.buyVolume, l.sellVolume]), [[100, 6, 2, 0], [100.25, 3, 0, 3], [100.5, 5, 5, 0]]);
  assert(await page.locator('#chart-surface canvas').evaluate(canvas => canvas.width > 0 && canvas.height > 0));
  // Exercise the actual candle drawing branch in the same FootprintCanvas component.
  await page.locator('button[title="Switch to candles mode"]').click();
  await page.waitForTimeout(200);
  const candleState = await components(); assert.equal(candleState.FootprintCanvas.chartMode, 'candles');
  assert.deepEqual(candleState.FootprintCanvas.bars, bars);
  const stopIndex = messages.length;
  const finalTrade = fixture(4, 'UNKNOWN', 101, 1);
  context.handleTrade(finalTrade);
  await context.stopFeed();
  await page.waitForTimeout(150);
  const stopped = await components();
  assert.equal(stopped.ProfileOverlay.volumeProfile.totalVolume, 15);
  assert.equal(stopped.CVDPanel.currentCVD, 4);
  assert.equal(stopped.FootprintCanvas.bars.reduce((n, b) => n + b.volume, 0), 15);
  assert(messages.slice(stopIndex).some(m => m.type === 'BAR_UPDATE' && m.bar.volume === 10));
  assert(messages.slice(stopIndex).some(m => m.type === 'PROFILE_UPDATE' && m.volumeProfile.totalVolume === 15));
  assert.equal(context.feedStatus, 'UNAVAILABLE');
  // Invoke the real header's normal symbol-selection callback, not a test reducer.
  await page.evaluate(() => {
    const root = document.getElementById('root');
    const key = Object.keys(root).find(k => k.startsWith('__reactContainer$'));
    const stack = [root[key].stateNode.current];
    while (stack.length) {
      const f = stack.pop();
      if (f.child) stack.push(f.child); if (f.sibling) stack.push(f.sibling);
      if (f.type?.name === 'TerminalHeader') { f.memoizedProps.onSelectSymbol('NQ'); return; }
    }
    throw new Error('Normal TerminalHeader missing');
  });
  await page.waitForTimeout(400);
  const nq = await backend.offlineTerminalTestContext('NQ'); nq.provider = 'fixture';
  nq.handleTrade({ ...fixture(0, 'SELL', 201, 6), id: 'fixture-nq' });
  context.handleTrade({ ...fixture(6, 'BUY', 100, 20), id: 'fixture-late-es' });
  await page.waitForTimeout(600);
  const nqState = await components();
  assert.equal(nqState.FootprintCanvas.symbol, 'NQ');
  assert.equal(nqState.TerminalHeader.instrument.symbol, 'NQ'); assert.equal(nqState.TerminalHeader.instrument.pointValue, 20);
  assert.equal(nqState.FootprintCanvas.bars.reduce((n, b) => n + b.volume, 0), 6);
  assert.equal(nqState.CVDPanel.currentCVD, -6); assert.equal(nqState.ProfileOverlay.volumeProfile.totalVolume, 6);
  assert.equal(externalCalls, 0); assert.deepEqual(browserErrors, []);
  await page.screenshot({ path: path.join(output, 'terminal.png') });
  fs.writeFileSync(path.join(output, 'result.json'), JSON.stringify({ status: 'OFFLINE PASS — NOT LIVE', trades, finalTrade, state, candleState, stopped, nqState,
    messageCounts: messages.reduce((a, m) => ({ ...a, [m.type]: (a[m.type] || 0) + 1 }), {}), externalCalls, browserErrors }, null, 2));
  console.log('OFFLINE REGULAR TERMINAL PASS: normal TICK/BAR_UPDATE/BAR_CLOSE/PROFILE_UPDATE → App → real chart components');
  console.log(`Offline evidence: ${output}`);
} catch (error) { console.error(error); process.exitCode = 1; }
finally { await browser?.close(); await vite?.close(); await backend.closeServer(); process.exit(process.exitCode ?? 0); }
