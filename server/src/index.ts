import { createServer, IncomingMessage, ServerResponse } from 'http';
import { readFile } from 'fs/promises';
import { extname, resolve, sep } from 'path';
import { fileURLToPath } from 'url';
import { WebSocket, WebSocketServer } from 'ws';
import { BacktestReplayEngine } from './backtestEngine.js';
import { FUTURES_INSTRUMENTS } from './futuresConfig.js';
import { MarketContextManager, TIMEFRAMES } from './marketData/marketContext.js';
import { MAX_SESSIONS, ChartSession } from './session.js';
import { Tick, WSClientMessage, WSServerMessage } from './types.js';

const PORT = parseInt(process.env.PORT || '8080', 10);
const HOST = process.env.HOST || '0.0.0.0';

// Per-connection chart sessions
const sessions = new Map<WebSocket, ChartSession>();

// Replay engine for backtest replay
const backtest = new BacktestReplayEngine();

// Multi-instrument market context manager
const contextManager = new MarketContextManager((tick: Tick) => {
  if (!backtest.isActive()) {
    backtest.recordTick(tick);
  }
});
let lastSubscribedSymbol = 'BTCUSDT';

function createSession(socket: WebSocket): ChartSession {
  return new ChartSession(socket);
}

function broadcast(msg: WSServerMessage) {
  const json = JSON.stringify(msg);
  for (const client of wss.clients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(json);
    }
  }
}

// Setup Backtest Replay Callback
backtest.setCallback((tick: Tick) => {
  const ctx = contextManager.getContext(lastSubscribedSymbol) || contextManager.getContext('BTCUSDT');
  if (ctx) {
    // Process replayed tick through context
    ctx.ensureFootprintEngine('1m').processTick(tick);
    broadcast({ type: 'TICK', tick });
  }
});

backtest.setProgressCallback((progress) => {
  broadcast({ type: 'REPLAY_STATE', progress });
});

// Broadcast replay progress periodically while replaying
setInterval(() => {
  if (backtest.isActive()) {
    broadcast({ type: 'REPLAY_STATE', progress: backtest.getProgress() });
  }
}, 500);

// Setup HTTP + WebSocket server on ONE port so a free host only needs to expose 8080:
// the built client is served as static files, /healthz reports status, and the WS upgrade
// happens on the same listener.
const CLIENT_DIST = process.env.CLIENT_DIST || fileURLToPath(new URL('../../client/dist', import.meta.url));
const MAX_PAYLOAD_BYTES = parseInt(process.env.MAX_PAYLOAD_BYTES || '65536', 10);

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.map': 'application/json; charset=utf-8',
};

async function serveStatic(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const urlPath = (req.url || '/').split('?')[0];
  const requested = urlPath === '/' ? '/index.html' : urlPath;
  // Resolve inside the dist folder only — blocks ../ traversal.
  const target = resolve(CLIENT_DIST, `.${requested}`);
  if (!target.startsWith(CLIENT_DIST + sep) && target !== resolve(CLIENT_DIST, 'index.html')) {
    res.writeHead(403).end('Forbidden');
    return;
  }

  try {
    const body = await readFile(target);
    res.writeHead(200, { 'content-type': MIME_TYPES[extname(target)] || 'application/octet-stream' });
    res.end(body);
  } catch {
    // SPA fallback: unknown paths return index.html so client routing keeps working.
    try {
      const fallback = await readFile(resolve(CLIENT_DIST, 'index.html'));
      res.writeHead(200, { 'content-type': MIME_TYPES['.html'] });
      res.end(fallback);
    } catch {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('Client build not found. Run `pnpm build` first (or set CLIENT_DIST).');
    }
  }
}

const httpServer = createServer(async (req, res) => {
  if (req.url?.startsWith('/healthz')) {
    const ctx = contextManager.getContext(lastSubscribedSymbol) || contextManager.getContext('BTCUSDT');
    res.writeHead(200, { 'content-type': MIME_TYPES['.json'] });
    res.end(
      JSON.stringify({
        status: 'ok',
        uptimeSec: Math.round(process.uptime()),
        sessions: sessions.size,
        symbol: ctx?.symbol || lastSubscribedSymbol,
        timeframe: '1m',
        feed: ctx?.provider || 'none',
        feedStatus: ctx?.feedStatus || 'UNAVAILABLE',
        feedReason: ctx?.feedReason,
        lastTradeTs: ctx?.lastTradeTs || 0,
        lastDepthTs: ctx?.lastDepthTs || 0,
        futuresProvider: process.env.FUTURES_PROVIDER || 'none',
        historySource: ctx ? (ctx as any).historySource || 'NONE' : 'NONE',
        gexSource: ctx?.instrument.underlyingIndex
          ? contextManager.getGexEngine().getProfile(ctx.instrument.underlyingIndex)?.dataSource
          : undefined,
      })
    );
    return;
  }
  await serveStatic(req, res);
});

const wss = new WebSocketServer({ server: httpServer, maxPayload: MAX_PAYLOAD_BYTES });

// Warm default market context for BTCUSDT
void contextManager.getOrCreateContext('BTCUSDT');

// Handle WebSocket Client Connections
wss.on('connection', async (ws: WebSocket) => {
  if (sessions.size >= MAX_SESSIONS) {
    console.warn(`[DeepChart Server] Rejecting connection: session limit (${MAX_SESSIONS}) reached.`);
    ws.close(1013, 'Server at capacity — please retry shortly');
    return;
  }

  const session = createSession(ws);
  sessions.set(ws, session);
  console.log(`[DeepChart Server] Client connected (${session.id}). Active sessions: ${sessions.size}`);

  // Subscribe new connection to default BTCUSDT (1m)
  await contextManager.subscribe(session, 'BTCUSDT', '1m');

  ws.on('message', async (raw: WebSocket.Data) => {
    try {
      const msg = JSON.parse(raw.toString()) as WSClientMessage;

      // A public server cannot trust any single client's send rate.
      if (!session.allowMessage()) {
        console.warn(`[DeepChart Server] Rate limit exceeded for session ${session.id}`);
        return;
      }

      // Safe rejection of deprecated/legacy trading messages
      const legacyTradingTypes = new Set([
        'DOM_ORDER',
        'UPDATE_COPIER',
        'SET_PROP_TRAILING_MODE',
        'RESET_PROP_ACCOUNT',
        'CLEAR_JOURNAL',
        'SET_PROP_CONFIG',
      ]);
      if (legacyTradingTypes.has((msg as { type: string }).type)) {
        console.warn(`[DeepChart Server] Rejected deprecated trading message: ${(msg as { type: string }).type}`);
        return;
      }

      if (msg.type === 'SUBSCRIBE') {
        const requestedSymbol = msg.symbol;
        const requestedTf = msg.timeframe || session.subscribedTimeframe || '1m';

        if (requestedSymbol && !FUTURES_INSTRUMENTS[requestedSymbol]) {
          console.warn(`[DeepChart Server] Ignoring SUBSCRIBE for unknown symbol '${requestedSymbol}'`);
          // Re-sync caller with its current subscription
          const currentCtx = contextManager.getContext(session.subscribedSymbol);
          if (currentCtx) {
            session.send(currentCtx.buildInitState(session, session.subscribedTimeframe));
          }
          return;
        }

        if (requestedSymbol) {
          lastSubscribedSymbol = requestedSymbol;
        }

        if (requestedSymbol && requestedSymbol !== session.subscribedSymbol) {
          await contextManager.subscribe(session, requestedSymbol, requestedTf);
        } else if (requestedTf && requestedTf !== session.subscribedTimeframe && TIMEFRAMES[requestedTf]) {
          const ctx = contextManager.getContext(session.subscribedSymbol);
          if (ctx) {
            ctx.changeTimeframe(session, requestedTf);
          }
        } else {
          // Re-send current state if subscribe called with same symbol and timeframe
          const ctx = contextManager.getContext(session.subscribedSymbol);
          if (ctx) {
            session.send(ctx.buildInitState(session, session.subscribedTimeframe));
          }
        }
      } else if (msg.type === 'REPLAY_CONTROL') {
        if (msg.action === 'START') {
          backtest.start(msg.speed || 1);
        } else if (msg.action === 'PAUSE') {
          backtest.pause();
        } else if (msg.action === 'SEEK' && typeof msg.timestamp === 'number') {
          backtest.seek(msg.timestamp);
        } else if (msg.action === 'SET_SPEED' && typeof msg.speed === 'number') {
          backtest.setSpeed(msg.speed);
        } else if (msg.action === 'STEP') {
          backtest.stepForward();
        }
        broadcast({ type: 'REPLAY_STATE', progress: backtest.getProgress() });
      }
    } catch (err) {
      console.error('[DeepChart Server] Error handling client message:', err);
    }
  });

  ws.on('close', () => {
    contextManager.unsubscribe(session);
    sessions.delete(ws);
    console.log(`[DeepChart Server] Client disconnected (${session.id}). Active sessions: ${sessions.size}`);
  });
});

httpServer.listen(PORT, HOST, () => {
  console.log(`[DeepChart Free — Order Flow Charts] Ready at ws://localhost:${PORT} (bound to ${HOST})`);
  console.log(`[DeepChart Server] Web terminal: http://localhost:${PORT} | health: http://localhost:${PORT}/healthz`);
  console.log(`[DeepChart Server] Serving client build from ${CLIENT_DIST}`);
});
