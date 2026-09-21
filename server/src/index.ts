import { createServer, IncomingMessage, ServerResponse } from 'http';
import { readFile } from 'fs/promises';
import { extname, resolve, sep } from 'path';
import { fileURLToPath } from 'url';
import { WebSocket, WebSocketServer } from 'ws';
import { entitlementService } from './auth/entitlementService.js';
import { verifyToken } from './auth/token.js';
import { DataType, User } from './auth/types.js';
import { FUTURES_INSTRUMENTS } from './futuresConfig.js';
import { MarketContextManager, TIMEFRAMES } from './marketData/marketContext.js';
import { marketDataStore } from './storage/marketDataStore.js';
import { ReplaySession } from './replaySession.js';
import { MAX_SESSIONS, MAX_SESSIONS_PER_USER, ChartSession } from './session.js';
import { Tick, WSClientMessage, WSServerMessage } from './types.js';

const PORT = parseInt(process.env.PORT || '8080', 10);
const HOST = process.env.HOST || '0.0.0.0';

// Per-connection chart sessions
const sessions = new Map<WebSocket, ChartSession>();

// Per-user active sessions tracking for connection limit enforcement
const userSessions = new Map<string, Set<ChartSession>>();

function addUserSession(userId: string, session: ChartSession): void {
  let set = userSessions.get(userId);
  if (!set) {
    set = new Set();
    userSessions.set(userId, set);
  }
  set.add(session);
}

function removeUserSession(userId: string, session: ChartSession): void {
  const set = userSessions.get(userId);
  if (set) {
    set.delete(session);
    if (set.size === 0) userSessions.delete(userId);
  }
}

// Origin verification
const ALLOWED_ORIGINS_RAW = process.env.ALLOWED_ORIGINS;
const allowedOrigins = ALLOWED_ORIGINS_RAW
  ? new Set(ALLOWED_ORIGINS_RAW.split(',').map((s) => s.trim().toLowerCase()))
  : null;

function isOriginAllowed(origin: string | undefined): boolean {
  if (!origin) return true; // Direct client, scripts, or same-origin without Origin header
  const lower = origin.trim().toLowerCase();
  if (allowedOrigins) {
    return allowedOrigins.has(lower);
  }
  try {
    const u = new URL(lower);
    if (u.hostname === 'localhost' || u.hostname === '127.0.0.1' || u.hostname === '0.0.0.0') {
      return true;
    }
  } catch {
    return false;
  }
  return true;
}

// Token extractor from IncomingMessage
function extractToken(req: IncomingMessage): string | null {
  // 1. Authorization header: "Bearer <token>"
  const authHeader = req.headers['authorization'];
  if (typeof authHeader === 'string' && authHeader.startsWith('Bearer ')) {
    return authHeader.slice(7).trim();
  }

  // 2. Sec-WebSocket-Protocol header (common for browser WebSocket token passing)
  const subprotocol = req.headers['sec-websocket-protocol'];
  if (typeof subprotocol === 'string') {
    const parts = subprotocol.split(',').map((s) => s.trim());
    if (parts.length >= 2 && parts[0] === 'deepchart-token') {
      return parts[1];
    }
    if (parts.length === 1 && parts[0].includes('.')) {
      return parts[0];
    }
  }

  // 3. Cookie "dc_token=<token>"
  const cookie = req.headers['cookie'];
  if (typeof cookie === 'string') {
    const match = cookie.match(/(?:^|;\s*)dc_token=([^;]+)/);
    if (match) return decodeURIComponent(match[1]);
  }

  // 4. Query param "token=" (only permitted when DEV_HOOKS=1 for local test convenience)
  if (process.env.DEV_HOOKS === '1' && req.url) {
    try {
      const u = new URL(req.url, 'http://localhost');
      const qToken = u.searchParams.get('token');
      if (qToken) return qToken.trim();
    } catch {}
  }

  return null;
}

// Multi-instrument market context manager
const contextManager = new MarketContextManager();

function createSession(socket: WebSocket): ChartSession {
  return new ChartSession(socket);
}

// Revocation listener: when an entitlement is revoked, notify and adjust affected sessions
entitlementService.onRevocation((userId, revoked) => {
  for (const session of sessions.values()) {
    if (session.user?.id === userId) {
      const sym = session.subscribedSymbol;
      const isAffected =
        revoked.symbolPattern === '*' ||
        !revoked.symbolPattern ||
        revoked.symbolPattern.toUpperCase() === sym.toUpperCase() ||
        (revoked.symbolPattern.endsWith('*') && sym.toUpperCase().startsWith(revoked.symbolPattern.slice(0, -1).toUpperCase()));

      if (isAffected) {
        console.warn(`[DeepChart Server] Entitlement revoked for user ${userId} on ${sym}. Resetting subscription.`);
        session.send({
          type: 'ERROR',
          code: 'ENTITLEMENT_REVOKED',
          message: `Entitlement for ${sym} has been revoked`,
        });
        if (session.replaySession) {
          session.replaySession.dispose();
          session.replaySession = null;
        }
        if (process.env.AUTH_REQUIRED !== '1' && sym !== 'BTCUSDT') {
          const gen = session.nextGeneration();
          void contextManager.subscribe(session, 'BTCUSDT', '1m', gen);
        } else {
          session.close(1008, 'Entitlement revoked');
        }
      }
    }
  }
});

// Setup HTTP + WebSocket server on ONE port so a free host only needs to expose 8080:
// the built client is served as static files, /healthz reports status, and the WS upgrade
// happens on the same listener.
const CLIENT_DIST = resolve(process.cwd(), process.env.CLIENT_DIST || fileURLToPath(new URL('../../client/dist', import.meta.url)));
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
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    let symbolParam = url.searchParams.get('symbol');
    if (!symbolParam) {
      const activeSession = sessions.values().next().value;
      symbolParam = activeSession?.subscribedSymbol || 'BTCUSDT';
    }
    const ctx = contextManager.getContext(symbolParam) || contextManager.getContext('BTCUSDT');
    res.writeHead(200, { 'content-type': MIME_TYPES['.json'] });
    res.end(
      JSON.stringify({
        status: 'ok',
        uptimeSec: Math.round(process.uptime()),
        sessions: sessions.size,
        symbol: ctx?.symbol || symbolParam,
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

  if (req.url?.startsWith('/metrics')) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.writeHead(200, { 'content-type': MIME_TYPES['.json'] });
    res.end(
      JSON.stringify({
        uptimeSec: Math.round(process.uptime()),
        sessions: sessions.size,
        uniqueUsers: userSessions.size,
        memory: process.memoryUsage(),
        nodeVersion: process.version,
        activeContexts: contextManager.getAllContexts().map((ctx) => ({
          symbol: ctx.symbol,
          provider: ctx.provider,
          feedStatus: ctx.feedStatus,
          subscribers: ctx.subscriberCount,
          lastTradeTs: ctx.lastTradeTs,
          lastDepthTs: ctx.lastDepthTs,
        })),
      })
    );
    return;
  }

  if (req.url?.startsWith('/api/v1/history')) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    if (req.method === 'OPTIONS') {
      res.writeHead(204).end();
      return;
    }

    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const symbol = url.searchParams.get('symbol') || 'BTCUSDT';
    const timeframe = url.searchParams.get('timeframe') || '1m';
    const beforeTimeStr = url.searchParams.get('beforeTime');
    const beforeTime = beforeTimeStr ? parseInt(beforeTimeStr, 10) : undefined;
    const limitStr = url.searchParams.get('limit');
    const limit = limitStr ? parseInt(limitStr, 10) : 300;

    // Entitlement / Auth check
    const token = extractToken(req);
    let userId = 'guest';
    if (token) {
      const payload = verifyToken(token);
      if (payload) userId = payload.sub;
    }
    const isFreeCrypto = symbol === 'BTCUSDT' && process.env.AUTH_REQUIRED !== '1';
    const devBypass = process.env.DEV_HOOKS === '1' && process.env.AUTH_REQUIRED !== '1';
    const hasAccess = devBypass || isFreeCrypto || entitlementService.hasEntitlement(userId, symbol, 'BARS');

    if (!hasAccess) {
      res.writeHead(403, { 'content-type': MIME_TYPES['.json'] });
      res.end(JSON.stringify({ error: 'Entitlement denied', symbol }));
      return;
    }

    const result = marketDataStore.queryBars(symbol, timeframe, { beforeTime, limit });
    res.writeHead(200, { 'content-type': MIME_TYPES['.json'] });
    res.end(JSON.stringify({
      symbol,
      timeframe,
      bars: result.bars,
      hasMore: result.hasMore,
      cursor: result.cursor,
    }));
    return;
  }
  await serveStatic(req, res);
});

interface ExtWebSocket extends WebSocket {
  isAlive?: boolean;
}

const wss = new WebSocketServer({ server: httpServer, maxPayload: MAX_PAYLOAD_BYTES });

// Warm default market context for BTCUSDT
void contextManager.getOrCreateContext('BTCUSDT');

// Heartbeat to detect and clean up zombie connections
const heartbeatInterval = setInterval(() => {
  wss.clients.forEach((client) => {
    const extWs = client as ExtWebSocket;
    if (extWs.isAlive === false) {
      console.warn('[DeepChart Server] Terminating inactive connection (heartbeat timeout)');
      return extWs.terminate();
    }
    extWs.isAlive = false;
    extWs.ping();
  });
}, 30000);

wss.on('close', () => {
  clearInterval(heartbeatInterval);
});

// Handle WebSocket Client Connections
wss.on('connection', async (ws: WebSocket, req: IncomingMessage) => {
  // 1. Origin Verification
  const origin = req.headers.origin;
  if (!isOriginAllowed(origin)) {
    console.warn(`[DeepChart Server] Rejecting connection: unauthorized origin '${origin}'`);
    ws.close(1008, 'Origin not allowed');
    return;
  }

  // 2. Capacity Check
  if (sessions.size >= MAX_SESSIONS) {
    console.warn(`[DeepChart Server] Rejecting connection: session limit (${MAX_SESSIONS}) reached.`);
    ws.close(1013, 'Server at capacity — please retry shortly');
    return;
  }

  // 3. User Authentication
  const token = extractToken(req);
  let user: User | null = null;
  if (token) {
    const payload = verifyToken(token);
    if (payload) {
      user = { id: payload.sub, username: payload.username, role: payload.role, status: 'active' };
    } else {
      console.warn(`[DeepChart Server] Invalid or expired token provided`);
      if (process.env.AUTH_REQUIRED === '1') {
        ws.close(1008, 'Invalid authentication token');
        return;
      }
    }
  }

  if (!user) {
    if (process.env.AUTH_REQUIRED === '1') {
      console.warn(`[DeepChart Server] Rejecting unauthenticated connection (AUTH_REQUIRED=1)`);
      ws.close(1008, 'Authentication required');
      return;
    }
    user = { id: 'guest', username: 'guest', role: 'user', status: 'active' };
  }

  // 4. Per-user Connection Limit Check
  const activeForUser = userSessions.get(user.id)?.size || 0;
  if (user.id !== 'guest' && activeForUser >= MAX_SESSIONS_PER_USER) {
    console.warn(`[DeepChart Server] Rejecting connection: user ${user.id} reached session limit (${MAX_SESSIONS_PER_USER})`);
    ws.close(1008, `User session limit (${MAX_SESSIONS_PER_USER}) reached`);
    return;
  }

  const extWs = ws as ExtWebSocket;
  extWs.isAlive = true;
  extWs.on('pong', () => {
    extWs.isAlive = true;
  });

  const session = createSession(ws);
  session.setUser(user);
  addUserSession(user.id, session);
  sessions.set(ws, session);
  console.log(`[DeepChart Server] Client connected (${session.id}, user: ${user.username} [${user.id}]). Active sessions: ${sessions.size}`);

  ws.on('close', () => {
    if (session.replaySession) {
      session.replaySession.dispose();
      session.replaySession = null;
    }
    contextManager.unsubscribe(session);
    removeUserSession(session.user?.id || 'guest', session);
    sessions.delete(ws);
    console.log(`[DeepChart Server] Client disconnected (${session.id}). Active sessions: ${sessions.size}`);
  });

  // Subscribe new connection to default BTCUSDT (1m)
  const gen = session.nextGeneration();
  void contextManager.subscribe(session, 'BTCUSDT', '1m', gen);

  ws.on('message', async (raw: WebSocket.Data) => {
    try {
      // 1. Rate limit check before parsing
      if (!session.allowMessage()) {
        console.warn(`[DeepChart Server] Rate limit exceeded for session ${session.id}`);
        return;
      }

      // 2. Safe JSON parsing & shape validation
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw.toString());
      } catch {
        console.warn(`[DeepChart Server] Malformed JSON from session ${session.id}`);
        return;
      }

      if (!parsed || typeof parsed !== 'object' || !('type' in parsed)) {
        console.warn(`[DeepChart Server] Message missing type field from session ${session.id}`);
        return;
      }

      const msg = parsed as Record<string, unknown>;

      // 3. Safe rejection of deprecated/legacy trading messages
      const legacyTradingTypes = new Set([
        'DOM_ORDER',
        'UPDATE_COPIER',
        'SET_PROP_TRAILING_MODE',
        'RESET_PROP_ACCOUNT',
        'CLEAR_JOURNAL',
        'SET_PROP_CONFIG',
      ]);
      if (typeof msg.type === 'string' && legacyTradingTypes.has(msg.type)) {
        console.warn(`[DeepChart Server] Rejected deprecated trading message: ${msg.type}`);
        return;
      }

      if (msg.type === 'SUBSCRIBE') {
        const requestedSymbol = typeof msg.symbol === 'string' ? msg.symbol : undefined;
        const requestedTf = typeof msg.timeframe === 'string' ? msg.timeframe : session.subscribedTimeframe || '1m';

        // Validate symbol
        if (!requestedSymbol || !FUTURES_INSTRUMENTS[requestedSymbol]) {
          console.warn(`[DeepChart Server] Ignoring SUBSCRIBE for invalid symbol '${requestedSymbol}'`);
          const currentCtx = contextManager.getContext(session.subscribedSymbol);
          if (currentCtx && session.isOpen) {
            session.send(currentCtx.buildInitState(session, session.subscribedTimeframe));
          }
          return;
        }

        // Validate timeframe
        if (!TIMEFRAMES[requestedTf]) {
          console.warn(`[DeepChart Server] Ignoring SUBSCRIBE for invalid timeframe '${requestedTf}'`);
          return;
        }

        // Entitlement check
        const userId = session.user?.id || 'guest';
        const isFreeCrypto = requestedSymbol === 'BTCUSDT' && process.env.AUTH_REQUIRED !== '1';
        const devBypass = process.env.DEV_HOOKS === '1' && process.env.AUTH_REQUIRED !== '1';
        const hasAccess =
          devBypass ||
          isFreeCrypto ||
          entitlementService.hasEntitlement(userId, requestedSymbol, 'FOOTPRINT');

        if (!hasAccess) {
          console.warn(`[DeepChart Server] Denied SUBSCRIBE for '${requestedSymbol}': user '${userId}' lacks entitlement`);
          session.send({
            type: 'ERROR',
            code: 'ENTITLEMENT_DENIED',
            message: `User '${userId}' lacks entitlement for ${requestedSymbol}`,
          });
          return;
        }

        // Only dispose replay session after validation and entitlement pass
        if (session.replaySession) {
          session.replaySession.dispose();
          session.replaySession = null;
        }

        const gen = session.nextGeneration();
        if (requestedSymbol !== session.subscribedSymbol) {
          await contextManager.subscribe(session, requestedSymbol, requestedTf, gen);
        } else if (requestedTf !== session.subscribedTimeframe) {
          const ctx = contextManager.getContext(session.subscribedSymbol);
          if (ctx && session.isOpen && session.subscriptionGeneration === gen) {
            ctx.changeTimeframe(session, requestedTf);
          }
        } else {
          // Re-send current state if subscribe called with same symbol and timeframe
          const ctx = contextManager.getContext(session.subscribedSymbol);
          if (ctx && session.isOpen && session.subscriptionGeneration === gen) {
            session.send(ctx.buildInitState(session, session.subscribedTimeframe));
          }
        }
      } else if (msg.type === 'REPLAY_CONTROL') {
        const action = typeof msg.action === 'string' ? msg.action : '';
        const validActions = new Set(['START', 'PAUSE', 'SEEK', 'SET_SPEED', 'STEP', 'RETURN_TO_LIVE']);
        if (!validActions.has(action)) {
          console.warn(`[DeepChart Server] Ignoring unknown REPLAY_CONTROL action '${action}'`);
          return;
        }

        // Entitlement check for REPLAY
        const userId = session.user?.id || 'guest';
        const isFreeCryptoReplay = session.subscribedSymbol === 'BTCUSDT' && process.env.AUTH_REQUIRED !== '1';
        const devBypass = process.env.DEV_HOOKS === '1' && process.env.AUTH_REQUIRED !== '1';
        const hasReplayAccess =
          devBypass ||
          isFreeCryptoReplay ||
          entitlementService.hasEntitlement(userId, session.subscribedSymbol, 'REPLAY');

        if (!hasReplayAccess) {
          console.warn(`[DeepChart Server] Denied REPLAY for '${session.subscribedSymbol}': user '${userId}' lacks REPLAY entitlement`);
          session.send({
            type: 'ERROR',
            code: 'ENTITLEMENT_DENIED',
            message: `User '${userId}' lacks REPLAY entitlement for ${session.subscribedSymbol}`,
          });
          return;
        }

        if (action === 'RETURN_TO_LIVE') {
          if (session.replaySession) {
            session.replaySession.dispose();
            session.replaySession = null;
          }
          session.setMode('LIVE');
          const ctx = contextManager.getContext(session.subscribedSymbol);
          if (ctx && session.isOpen) {
            session.send(ctx.buildInitState(session, session.subscribedTimeframe));
          }
          return;
        }

        // Validate speed if provided
        let speed: number | undefined;
        if (msg.speed !== undefined) {
          if (typeof msg.speed !== 'number' || !Number.isFinite(msg.speed) || msg.speed < 0.1 || msg.speed > 100) {
            console.warn(`[DeepChart Server] Invalid replay speed: ${msg.speed}`);
            return;
          }
          speed = msg.speed;
        }

        // Validate seek target if action is SEEK
        let seekTarget: number | undefined;
        if (action === 'SEEK') {
          if (typeof msg.timestamp !== 'number' || !Number.isFinite(msg.timestamp) || msg.timestamp < 0) {
            console.warn(`[DeepChart Server] Invalid seek target: ${msg.timestamp}`);
            return;
          }
          // If seeking by index (<= 1_000_000_000), require integer
          if (msg.timestamp <= 1_000_000_000 && !Number.isInteger(msg.timestamp)) {
            console.warn(`[DeepChart Server] Fractional seek index rejected: ${msg.timestamp}`);
            return;
          }
          seekTarget = msg.timestamp;
        }

        if (action === 'START' || action === 'STEP' || action === 'SEEK') {
          if (!session.replaySession) {
            const sym = session.subscribedSymbol;
            const inst = FUTURES_INSTRUMENTS[sym] || FUTURES_INSTRUMENTS.ES;
            const ticks = contextManager.getTicksForReplay(sym);
            session.replaySession = new ReplaySession(session, sym, inst, session.subscribedTimeframe, ticks);
          }
        }

        if (!session.replaySession) {
          return;
        }

        if (action === 'START') {
          session.replaySession.start(speed || 1);
        } else if (action === 'PAUSE') {
          session.replaySession.pause();
        } else if (action === 'SEEK' && seekTarget !== undefined) {
          session.replaySession.seek(seekTarget);
        } else if (action === 'SET_SPEED' && speed !== undefined) {
          session.replaySession.setSpeed(speed);
        } else if (action === 'STEP') {
          session.replaySession.step();
        }
      } else if (msg.type === 'FETCH_HISTORY') {
        const symbol = typeof msg.symbol === 'string' ? msg.symbol : session.subscribedSymbol;
        const timeframe = typeof msg.timeframe === 'string' ? msg.timeframe : session.subscribedTimeframe || '1m';
        const beforeTime = typeof msg.beforeTime === 'number' && Number.isFinite(msg.beforeTime) ? msg.beforeTime : undefined;
        const limit = typeof msg.limit === 'number' && Number.isFinite(msg.limit) ? msg.limit : 300;
        const requestId = typeof msg.requestId === 'string' ? msg.requestId : undefined;

        const userId = session.user?.id || 'guest';
        const isFreeCrypto = symbol === 'BTCUSDT' && process.env.AUTH_REQUIRED !== '1';
        const devBypass = process.env.DEV_HOOKS === '1' && process.env.AUTH_REQUIRED !== '1';
        const hasAccess = devBypass || isFreeCrypto || entitlementService.hasEntitlement(userId, symbol, 'BARS');

        if (!hasAccess) {
          session.send({
            type: 'ERROR',
            code: 'ENTITLEMENT_DENIED',
            message: `User '${userId}' lacks BARS entitlement for ${symbol}`,
          });
          return;
        }

        const result = marketDataStore.queryBars(symbol, timeframe, { beforeTime, limit });
        session.send({
          type: 'HISTORY_RESPONSE',
          symbol,
          timeframe,
          bars: result.bars,
          hasMore: result.hasMore,
          cursor: result.cursor,
          requestId,
        });
      }
    } catch (err) {
      console.error('[DeepChart Server] Error handling client message:', err);
    }
  });
});

httpServer.listen(PORT, HOST, () => {
  console.log(`[DeepChart Free — Order Flow Charts] Ready at ws://localhost:${PORT} (bound to ${HOST})`);
  console.log(`[DeepChart Server] Web terminal: http://localhost:${PORT} | health: http://localhost:${PORT}/healthz`);
  console.log(`[DeepChart Server] Serving client build from ${CLIENT_DIST}`);
});

async function gracefulShutdown(signal: string) {
  console.log(`[DeepChart Server] Received ${signal}, starting graceful shutdown...`);
  clearInterval(heartbeatInterval);
  for (const session of sessions.values()) {
    if (session.replaySession) {
      session.replaySession.dispose();
      session.replaySession = null;
    }
  }
  await contextManager.disposeAll();
  wss.close(() => {
    httpServer.close(() => {
      console.log('[DeepChart Server] Shutdown complete.');
      process.exit(0);
    });
  });
  setTimeout(() => process.exit(0), 5000).unref();
}

process.on('SIGTERM', () => void gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => void gracefulShutdown('SIGINT'));
