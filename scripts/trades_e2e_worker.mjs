import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import assert from 'node:assert/strict';
import { WebSocketServer } from 'ws';
import { chromium } from '@playwright/test';
import { ControlledTradesSession } from '../server/dist/acceptance/controlledTrades.js';
import { DatabentoHttpClient } from '../server/dist/databento/client.js';
import { SessionCalendar } from '../server/dist/calendar/sessionCalendar.js';
import { metadata, systemRecord, tradeRecord } from './acceptance_fixtures.mjs';
import { ChartSession } from '../server/dist/session.js';
import { getOrRegisterInstrument } from '../server/dist/futuresConfig.js';
import { verifyTerminal } from './regular_acceptance_ui.mjs';

if (!process.send || !process.env.ACCEPTANCE_ARTIFACT_DIR) throw new Error('Run through local operator supervisor only');
const offline = process.argv.includes('--offline');
const sparse = offline && process.argv.includes('--sparse');
const regular = process.argv.includes('--regular-terminal');
const frames = []; const normalPublications = []; const browserErrors = [];
let terminalEvidence;
let chartSession;
const root = process.cwd();
const receipts = []; const publications = [];
let connectionCount = 0; let subscriptionCount = 0;
let mapping = { instrumentId: 10252, resolvedContract: 'ESZ6' };
let apiKey = 'offline-fixture-key';
let mock;
let session;
let browser;
let browserServer;
let server;
let wss;
let evidenceFailure = '';
let browserFinalResolve;
const browserFinal = new Promise(resolve => { browserFinalResolve = resolve; });
function evidenceBytes() { return Buffer.byteLength(JSON.stringify({ traces: session?.traces, publications, receipts })); }
try {
  if (!offline) {
    const env = fs.readFileSync('.env', 'utf8');
    apiKey = process.env.DATABENTO_API_KEY || env.match(/^DATABENTO_API_KEY=(.+)$/m)?.[1]?.trim();
    if (!apiKey) throw new Error('API key missing');
    // Operator must first isolate normal staging with offline-staging.compose.yml.
    const { execFileSync } = await import('node:child_process');
    const app = JSON.parse(execFileSync('docker', ['inspect', 'deepchart-app-1'], { encoding: 'utf8' }))[0];
    if (!app.Config.Env.includes('FUTURES_PROVIDER=none') || !app.Config.Env.includes('DATABENTO_API_KEY=')) throw new Error('Normal staging vendor must be disabled before acceptance');
    if (!SessionCalendar.getSessionInfo(Date.now(), 'CME_EQUITY_INDEX').isOpen) throw new Error('Calendar closed');
    const client = new DatabentoHttpClient({ apiKey });
    const schemas = await client.listSchemas('GLBX.MDP3');
    if (!schemas.includes('trades')) throw new Error('Trades schema unavailable');
    const today = new Date().toISOString().slice(0, 10);
    const result = await client.resolveSymbology('GLBX.MDP3', 'ES.c.0', 'continuous', 'instrument_id', today);
    const entry = result.result?.['ES.c.0']?.find(e => e.d0 <= today && e.d1 > today);
    if (!entry) throw new Error('No effective mapping');
    const raw = await client.resolveSymbology('GLBX.MDP3', entry.s, 'instrument_id', 'raw_symbol', today);
    const contract = raw.result?.[entry.s]?.find(e => e.d0 <= today && e.d1 > today);
    if (!contract) throw new Error('No effective outright');
    mapping = { instrumentId: Number(entry.s), resolvedContract: contract.s };
  } else {
    mock = net.createServer(socket => {
      connectionCount++;
      socket.write('cram=offline-test\n');
      let buffered = '';
      socket.on('data', bytes => {
        buffered += bytes.toString();
        let newline;
        while ((newline = buffered.indexOf('\n')) !== -1) {
          const line = buffered.slice(0, newline); buffered = buffered.slice(newline + 1);
          if (line.startsWith('auth=')) socket.write('success=1\n');
          if (line.startsWith('schema=')) {
            subscriptionCount++;
            if (line !== 'schema=trades|stype_in=continuous|symbols=ES.c.0|snapshot=0|is_last=1') evidenceFailure = 'Wrong subscription';
          }
          if (line === 'start_session=1') socket.write(Buffer.concat([metadata(), systemRecord(), ...Array.from({ length: sparse ? 3 : 60 }, (_, i) => {
            const record = tradeRecord(i);
            if (regular) {
              const event = BigInt(Date.UTC(2026, 9, 12, 15, 29, 58) + i * 1000) * 1000000n;
              record.writeBigUInt64LE(event, 8); record.writeBigUInt64LE(event + 20000n, 32);
            }
            return record;
          })]));
        }
      });
    });
    await new Promise(resolve => mock.listen(0, '127.0.0.1', resolve));
  }

  // No secondary network service may be reached after read-only metadata preflight.
  let externalCalls = 0;
  globalThis.fetch = async () => { externalCalls++; throw new Error('Acceptance prohibits external analytics/history fetch'); };

  let origin;
  server = http.createServer((req, res) => {
    if (req.method !== 'GET' || !req.url) { res.writeHead(404).end(); return; }
    const pathname = new URL(req.url, 'http://localhost').pathname;
    if (regular && pathname === '/api/v1/auth/config') {
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ authRequired: false, devMode: false, registrationEnabled: false, billingConfigured: false, plans: [] })); return;
    }
    if (regular && pathname === '/api/v1/instruments') {
      res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ instruments: [getOrRegisterInstrument('ES')], total: 1 })); return;
    }
    if (regular && pathname === '/api/v1/instruments/ES') {
      res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ instrument: getOrRegisterInstrument('ES'), provider: 'databento', feedStatus: session?.context.feedStatus })); return;
    }
    if (pathname !== '/' && !/^\/assets\/[A-Za-z0-9_.-]+$/.test(pathname)) { res.writeHead(404).end(); return; }
    const filename = path.join(root, 'client', 'dist', pathname === '/' ? 'index.html' : pathname.slice(1));
    if (!fs.existsSync(filename)) { res.writeHead(404).end(); return; }
    res.setHeader('Content-Type', filename.endsWith('.js') ? 'text/javascript' : filename.endsWith('.css') ? 'text/css' : 'text/html');
    res.end(fs.readFileSync(filename));
  });
  wss = new WebSocketServer({ noServer: true, maxPayload: 4096 });
  server.on('upgrade', (req, socket, head) => {
    if (req.url !== (regular ? '/' : '/acceptance-observer') || req.headers.origin !== origin || wss.clients.size) { socket.destroy(); return; }
    wss.handleUpgrade(req, socket, head, ws => wss.emit('connection', ws));
  });
  let readyResolve;
  const ready = new Promise(resolve => { readyResolve = resolve; });
  wss.on('connection', ws => {
    if (regular) {
      chartSession = new ChartSession(ws);
      const send = ws.send.bind(ws);
      ws.send = (bytes, ...args) => {
        if (normalPublications.length >= 512) { session.finish('FAILED', 'Normal publication budget'); ws.close(1008); return; }
        const message = JSON.parse(String(bytes));
        normalPublications.push({ type: message.type, symbol: message.symbol, sessionId: session.sessionId,
          watermark: session.traces.length, vendorClosed: ['TERMINATING', 'CLOSED', 'FAILED'].includes(session.state) });
        return send(bytes, ...args);
      };
      ws.on('message', bytes => {
        let r; try { r = JSON.parse(String(bytes)); } catch { ws.close(1008); return; }
        if (r.type === 'SUBSCRIBE' && r.symbol === 'ES' && (!r.timeframe || r.timeframe === '1m')) {
          session.context.addSubscriber(chartSession, '1m'); readyResolve();
        } else if (r.type === 'PING') chartSession.send({ type: 'PONG', ts: r.ts });
        else if (r.type === 'UNSUBSCRIBE' && r.symbol === 'ES') session.context.removeSubscriber(chartSession);
        else { chartSession.send({ type: 'ERROR', code: 'ACCEPTANCE_SCOPE', message: 'Only ES/1m chart subscription; no history or vendor start' }); }
      });
      ws.on('close', () => { session.context.removeSubscriber(chartSession); if (!['CLOSED', 'FAILED'].includes(session.state)) session.finish('FAILED', 'Terminal disconnected'); });
      session.context.addSubscriber(chartSession, '1m'); readyResolve();
      return;
    }
    readyResolve();
    ws.on('message', bytes => {
      let r;
      try { r = JSON.parse(bytes.toString()); } catch { ws.close(); return; }
      const expected = publications.find(p => p.watermark === r.watermark && p.final === r.final);
      if (r.type !== 'RECEIPT' || r.sessionId !== session.sessionId || !expected || r.digest !== expected.digest || !r.ok || receipts.length >= 100) {
        evidenceFailure = 'Invalid browser receipt'; session.finish('FAILED', evidenceFailure); ws.close(); return;
      }
      // Save only numeric allowlisted fields; never arbitrary browser payloads/tokens.
      receipts.push({ watermark: r.watermark, final: r.final, digest: r.digest, volume: r.volume, buy: r.buy, sell: r.sell, unknown: r.unknown, cvd: r.cvd });
      if (evidenceBytes() > 1024 * 1024) { evidenceFailure = 'Artifact limit'; session.finish('FAILED', evidenceFailure); }
      if (r.final) browserFinalResolve();
    });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${server.address().port}`;
  session = new ControlledTradesSession({ apiKey, ...mapping, offline, normalFanout: regular,
    ...(sparse ? { durationMs: 200 } : {}),
    ...(offline ? { createConnection: () => net.createConnection({ host: '127.0.0.1', port: mock.address().port }) } : {}),
    publish: message => {
      const publication = { watermark: message.watermark, final: message.final, digest: message.digest, status: 'PENDING' };
      publications.push(publication);
      if (regular) { publication.status = 'PRIVATE_ONLY'; return; }
      if (evidenceBytes() > 1024 * 1024) { evidenceFailure = 'Artifact limit'; session.finish('FAILED', evidenceFailure); return; }
      if (!wss.clients.size) { evidenceFailure = 'Observer disconnected'; session.finish('FAILED', evidenceFailure); return; }
      for (const ws of wss.clients) ws.send(JSON.stringify(message), error => {
        publication.status = error ? 'FAILED' : 'SENT';
        if (error) { evidenceFailure = 'WebSocket publication failed'; session.finish('FAILED', evidenceFailure); }
      });
    }, onClosed: () => process.send('CLOSED'),
  });
  const browserRoot = path.join(os.homedir(), 'AppData', 'Local', 'ms-playwright');
  const installed = fs.existsSync(browserRoot) ? fs.readdirSync(browserRoot).filter(name => /^chromium-\d+$/.test(name)).sort((a, b) => Number(b.split('-')[1]) - Number(a.split('-')[1])).map(name => path.join(browserRoot, name, 'chrome-win64', 'chrome.exe')).find(filename => fs.existsSync(filename)) : undefined;
  browserServer = await chromium.launchServer({ headless: true, executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH || installed });
  process.send({ type: 'BROWSER_PID', pid: browserServer.process().pid });
  browser = await chromium.connect(browserServer.wsEndpoint());
  const page = await browser.newPage();
  await page.route('**/*', route => route.request().url().startsWith(origin) ? route.continue() : route.abort());
  page.on('pageerror', error => browserErrors.push(error.message));
  page.on('websocket', ws => ws.on('framereceived', frame => { if (regular) frames.push(JSON.parse(String(frame.payload))); }));
  if (regular) await page.addInitScript(() => {
    const NativeWebSocket = window.WebSocket;
    window.WebSocket = class extends NativeWebSocket {
      constructor(...args) { super(...args); window.__acceptanceSocket = this; }
    };
    localStorage.setItem('deepchart.onboarding.v1', 'dismissed');
    localStorage.setItem('deepchart_free_settings_v1', JSON.stringify({ symbol: 'ES', timeframe: '1m', activePanel: 'Profile', showCVD: true, chartMode: 'footprint' }));
  });
  await page.goto(`${origin}/${regular ? '' : '?acceptance=1'}`);
  await Promise.race([ready, new Promise((_, reject) => setTimeout(() => reject(new Error('Browser not ready')), 10000))]);
  assert.equal((await page.request.post(`${origin}/start`)).status(), 404);
  assert.equal((await page.request.get(`${origin}/api/v1/history?symbol=ES`)).status(), 404);
  assert.equal(connectionCount, 0); // Browser connected, but cannot start any vendor connection.
  if (regular) {
    await page.waitForSelector('#chart-surface');
    await page.waitForTimeout(150);
    assert.equal(frames.filter(m => m.type === 'TICK').length, 0);
    assert(frames.some(m => m.type === 'INIT_STATE' && m.bars.length === 0 && m.historySource === 'NONE'));
    await page.evaluate(() => {
      window.__acceptanceSocket.send(JSON.stringify({ type: 'START' }));
      window.__acceptanceSocket.send(JSON.stringify({ type: 'SUBSCRIBE', symbol: 'NQ', timeframe: '1m' }));
    });
    await page.waitForTimeout(100);
    assert.equal(connectionCount, 0);
    assert.equal(frames.filter(m => m.type === 'ERROR' && m.code === 'ACCEPTANCE_SCOPE').length, 2);
  }
  process.send('CONNECTING');
  await session.start();
  if (offline && process.argv.includes('--watchdog-probe')) {
    const until = Date.now() + 10000;
    while (Date.now() < until) { /* Offline-only event loop hang: parent must terminate tree. */ }
  }
  await session.done;
  if (offline && process.argv.includes('--cleanup-watchdog-probe')) {
    const until = Date.now() + 20000;
    while (Date.now() < until) { /* Vendor closed; supervisor must bound cleanup separately. */ }
  }
  if (regular) {
    terminalEvidence = await verifyTerminal(page, session.message(true), frames, session.traces);
    assert.deepEqual(browserErrors, []);
    assert(normalPublications.some(p => p.type === 'BAR_UPDATE' && p.vendorClosed));
    assert(normalPublications.some(p => p.type === 'PROFILE_UPDATE' && p.vendorClosed));
    if (offline && !sparse) assert(frames.some(m => m.type === 'BAR_CLOSE'));
    assert.equal(externalCalls, 0);
  } else await Promise.race([browserFinal, new Promise((_, reject) => setTimeout(() => reject(new Error('Final browser receipt missing')), 5000))]);
  const result = { label: offline ? 'OFFLINE ONLY — NOT LIVE PASS' : 'GENUINE LIVE ACCEPTANCE', mapping,
    final: session.message(true), traces: session.traces.map((trace, index) => ({ ...trace,
      webSocketPublication: regular ? (normalPublications.some(p => p.type === 'TICK' && p.watermark === index + 1) ? 'NORMAL_CHARTSESSION_SERIALIZED' : 'NOT CAPTURED') : publications.find(p => p.watermark === index + 1)?.status || 'COVERED_BY_FINAL',
      browserReceipt: regular ? 'COVERED_BY_FINAL_COMPONENT_NUMERIC_MATCH' : receipts.some(r => r.watermark >= index + 1) ? 'COVERED_BY_RENDERED_WATERMARK' : 'NOT CAPTURED' })), publications, receipts,
    connectionCount: offline ? connectionCount : 1, subscriptionCount: offline ? subscriptionCount : 1, evidenceFailure,
    ...(regular ? { terminalEvidence, normalPublications, browserErrors, externalCalls } : {}) };
  const accepted = session.traces.filter(t => t.outcome === 'ACCEPTED');
  const bins = new Map();
  for (const trade of accepted) {
    const bin = Math.round(trade.price / 0.25) * 0.25;
    const values = bins.get(bin) || { volume: 0, buy: 0, sell: 0, unknown: 0 };
    values.volume += trade.size;
    values[trade.normalizedSide === 'BUY' ? 'buy' : trade.normalizedSide === 'SELL' ? 'sell' : 'unknown'] += trade.size;
    bins.set(bin, values);
  }
  for (const level of result.final.snapshot.profile.levels) {
    const expected = bins.get(level.price); assert(expected);
    assert.equal(level.volume, expected.volume); assert.equal(level.buyVolume, expected.buy); assert.equal(level.sellVolume, expected.sell);
  }
  for (const bar of result.final.snapshot.bars) {
    const ticks = accepted.filter(t => Math.floor(Number(BigInt(t.eventTimestampNs) / 1000000n) / 60000) * 60000 === bar.time);
    assert(ticks.length > 0);
    const ordered = ticks.slice().sort((a, b) => Number(BigInt(a.eventTimestampNs) - BigInt(b.eventTimestampNs)));
    assert.equal(bar.open, Math.round(ordered[0].price / 0.25) * 0.25);
    assert.equal(bar.close, Math.round(ordered.at(-1).price / 0.25) * 0.25);
    assert.equal(bar.high, Math.max(...ticks.map(t => t.price))); assert.equal(bar.low, Math.min(...ticks.map(t => t.price)));
    for (const level of Object.values(bar.levels)) {
      const expected = ticks.filter(t => Math.round(t.price / 0.25) * 0.25 === level.price);
      assert.equal(level.totalVol, expected.reduce((n, t) => n + t.size, 0));
      assert.equal(level.unknownVol || 0, expected.filter(t => t.normalizedSide === 'UNKNOWN').reduce((n, t) => n + t.size, 0));
    }
  }
  result.reconciliation = 'PASS: counts, price bins, BUY/SELL/UNKNOWN, CVD, candle OHLCV, final React digest';
  const serialized = JSON.stringify(result, null, 2);
  if (Buffer.byteLength(serialized) > 1024 * 1024) throw new Error('Final artifact exceeds limit');
  fs.writeFileSync(path.join(process.env.ACCEPTANCE_ARTIFACT_DIR, 'evidence.json'), serialized, { mode: 0o600 });
  if (evidenceFailure || session.state !== 'CLOSED' || (offline && (connectionCount !== 1 || subscriptionCount !== 1))) throw new Error('Acceptance failed');
  console.log(`${result.label}: ${session.traces.length} market records, final React digest matched`);
} catch (error) {
  session?.finish('FAILED', 'Runner failed');
  const message = String(error.message).replaceAll(apiKey || 'unused-key', '[REDACTED]').slice(0, 500);
  const failed = { source: offline ? 'OFFLINE_FIXTURE' : 'DATABENTO_LIVE', status: 'FAILED', error: message, traces: session?.traces || [], publications, receipts };
  if (Buffer.byteLength(JSON.stringify(failed)) <= 1024 * 1024) fs.writeFileSync(path.join(process.env.ACCEPTANCE_ARTIFACT_DIR, 'failure.json'), JSON.stringify(failed), { mode: 0o600 });
  console.error(message); process.exitCode = 1;
} finally {
  await browser?.close();
  await browserServer?.close();
  for (const ws of wss?.clients || []) ws.terminate();
  wss?.close(); server?.close(); mock?.close();
  await session?.context.dispose();
  // Stop unrelated singleton retention intervals of the in-memory test process.
  process.exit(process.exitCode ?? 0);
}
