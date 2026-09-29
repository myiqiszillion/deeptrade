import { createServer, IncomingMessage, ServerResponse } from 'http';
import { existsSync } from 'fs';
import { readFile } from 'fs/promises';
import { extname, resolve, sep } from 'path';
import { fileURLToPath } from 'url';
import { WebSocket, WebSocketServer } from 'ws';
import { entitlementService } from './auth/entitlementService.js';
import { AccessPolicy } from './auth/accessPolicy.js';
import { createToken, verifyToken } from './auth/token.js';
import { DataType, User } from './auth/types.js';
import { FUTURES_INSTRUMENTS } from './futuresConfig.js';
import { MarketContextManager, TIMEFRAMES } from './marketData/marketContext.js';
import { marketDataStore } from './storage/marketDataStore.js';
import { ReplaySession } from './replaySession.js';
import { MAX_SESSIONS, MAX_SESSIONS_PER_USER, ChartSession } from './session.js';
import { Tick, WSClientMessage, WSServerMessage } from './types.js';
import { fetchDatabentoBars } from './marketData/databentoHistory.js';

try {
  process.loadEnvFile?.();
} catch {
  try {
    process.loadEnvFile?.('../.env');
  } catch {}
}

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
        if (process.env.AUTH_REQUIRED !== '1' && sym !== DEFAULT_SYMBOL) {
          const gen = session.nextGeneration();
          void contextManager.subscribe(session, DEFAULT_SYMBOL, '1m', gen);
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
function resolveClientDist(): string {
  const custom = process.env.CLIENT_DIST;
  if (custom) {
    const candidates = [
      resolve(process.cwd(), custom),
      resolve(process.cwd(), '..', custom),
      resolve(fileURLToPath(new URL('../../', import.meta.url)), custom),
    ];
    for (const c of candidates) {
      if (existsSync(c)) return c;
    }
  }
  return fileURLToPath(new URL('../../client/dist', import.meta.url));
}

const CLIENT_DIST = resolveClientDist();
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

function sendJson(res: ServerResponse, statusCode: number, data: unknown): void {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.writeHead(statusCode, { 'content-type': MIME_TYPES['.json'] });
  res.end(JSON.stringify(data));
}

async function readJsonBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve) => {
    let data = '';
    req.on('data', (chunk) => {
      data += chunk;
      if (data.length > 65536) req.destroy();
    });
    req.on('end', () => {
      try {
        resolve(JSON.parse(data) as Record<string, unknown>);
      } catch {
        resolve({});
      }
    });
    req.on('error', () => resolve({}));
  });
}

const httpServer = createServer(async (req, res) => {
  // 1. CORS Preflight
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.writeHead(204).end();
    return;
  }

  // 2. Health Check
  if (req.url?.startsWith('/healthz')) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    let symbolParam = url.searchParams.get('symbol');
    const defaultSym = process.env.DEFAULT_SYMBOL || 'ES';
    if (!symbolParam) {
      const activeSession = sessions.values().next().value;
      symbolParam = activeSession?.subscribedSymbol || defaultSym;
    }
    const targetSymbol = symbolParam || defaultSym;
    const ctx = contextManager.getContext(targetSymbol) || contextManager.getContext(defaultSym);
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

  // 3. Prometheus / System Metrics
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

  // 4. Instruments API: list and detail
  if (req.url?.startsWith('/api/v1/instruments')) {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const parts = url.pathname.split('/').filter(Boolean);
    const futuresProvider = process.env.FUTURES_PROVIDER || 'none';

    // Detailed single instrument: /api/v1/instruments/:symbol
    if (parts.length === 4) {
      const sym = parts[3].toUpperCase();
      const inst = FUTURES_INSTRUMENTS[sym];
      if (!inst) {
        sendJson(res, 404, { error: `Instrument '${sym}' not found` });
        return;
      }
      const ctx = contextManager.getContext(sym);
      const provider = futuresProvider;
      sendJson(res, 200, {
        instrument: inst,
        feedStatus: ctx?.feedStatus || (futuresProvider !== 'none' ? 'CONNECTING' : 'UNAVAILABLE'),
        provider: ctx?.provider || provider,
        lastTradeTs: ctx?.lastTradeTs || 0,
        lastDepthTs: ctx?.lastDepthTs || 0,
        subscribers: ctx?.subscriberCount || 0,
      });
      return;
    }

    // List all instruments
    const list = Object.values(FUTURES_INSTRUMENTS).map((inst) => {
      const provider = futuresProvider;
      const ctx = contextManager.getContext(inst.symbol);
      const feedStatus = ctx?.feedStatus || (futuresProvider !== 'none' ? 'CONNECTING' : 'UNAVAILABLE');
      return {
        ...inst,
        provider,
        feedStatus,
        isLive: feedStatus === 'LIVE',
      };
    });
    sendJson(res, 200, { instruments: list, total: list.length });
    return;
  }

  // 5. System Status API
  if (req.url?.startsWith('/api/v1/status')) {
    const allContexts = contextManager.getAllContexts();
    sendJson(res, 200, {
      status: 'ok',
      uptimeSec: Math.round(process.uptime()),
      sessions: sessions.size,
      uniqueUsers: userSessions.size,
      futuresProvider: process.env.FUTURES_PROVIDER || 'none',
      activeContexts: allContexts.map((ctx) => ({
        symbol: ctx.symbol,
        provider: ctx.provider,
        feedStatus: ctx.feedStatus,
        subscribers: ctx.subscriberCount,
        lastTradeTs: ctx.lastTradeTs,
        lastDepthTs: ctx.lastDepthTs,
      })),
      memory: process.memoryUsage(),
      nodeVersion: process.version,
      timestamp: Date.now(),
    });
    return;
  }

  // 6. GEX (Gamma Exposure) API
  if (req.url?.startsWith('/api/v1/gex')) {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    let sym = (url.searchParams.get('symbol') || 'SPX').toUpperCase();
    if (sym === 'ES' || sym === 'MES') sym = 'SPX';
    else if (sym === 'NQ' || sym === 'MNQ') sym = 'NDX';
    else if (sym === 'YM' || sym === 'MYM') sym = 'DJI';
    else if (sym === 'RTY' || sym === 'M2K') sym = 'RUT';

    let profile = contextManager.getGexEngine().getProfile(sym);
    if (!profile) {
      try {
        const chain = await contextManager.getCboeProvider().fetchChain(sym);
        if (chain) {
          profile = contextManager.getGexEngine().buildFromChain(sym, chain.spotPrice, chain.contracts);
        }
      } catch (err) {
        console.warn(`[GEX API] Error fetching chain for ${sym}:`, (err as Error).message);
      }
    }
    if (!profile) {
      sendJson(res, 404, { error: `GEX profile for ${sym} is unavailable`, underlying: sym });
      return;
    }
    sendJson(res, 200, profile);
    return;
  }

  // 7. Options Flow API
  if (req.url?.startsWith('/api/v1/options-flow')) {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const underlying = url.searchParams.get('symbol') || url.searchParams.get('underlying');
    let flow = contextManager.getGexEngine().getRecentFlow();
    if (underlying) {
      let matchSym = underlying.toUpperCase();
      if (matchSym === 'ES' || matchSym === 'MES') matchSym = 'SPX';
      else if (matchSym === 'NQ' || matchSym === 'MNQ') matchSym = 'NDX';
      else if (matchSym === 'YM' || matchSym === 'MYM') matchSym = 'DJI';
      else if (matchSym === 'RTY' || matchSym === 'M2K') matchSym = 'RUT';
      flow = flow.filter((f) => f.underlying.toUpperCase() === matchSym);
    }
    sendJson(res, 200, { optionsFlow: flow, count: flow.length });
    return;
  }

  // 8. Historical Bars API
  if (req.url?.startsWith('/api/v1/history')) {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const symbol = url.searchParams.get('symbol') || (process.env.DEFAULT_SYMBOL || 'ES');
    const timeframe = url.searchParams.get('timeframe') || '1m';
    const defaultFuturesProvider = process.env.DATABENTO_API_KEY ? 'databento' : (process.env.TRADOVATE_API_KEY ? 'tradovate' : 'none');
    const provider = url.searchParams.get('provider') || (process.env.FUTURES_PROVIDER || defaultFuturesProvider);
    const beforeTimeStr = url.searchParams.get('beforeTime');
    const beforeTime = beforeTimeStr ? parseInt(beforeTimeStr, 10) : undefined;
    const limitStr = url.searchParams.get('limit');
    const limit = limitStr ? parseInt(limitStr, 10) : 300;

    // Entitlement / Auth check
    const token = extractToken(req);
    let user: User | null = null;
    if (token) {
      const payload = verifyToken(token);
      if (payload) {
        const dbUser = marketDataStore.getUser(payload.sub);
        user = dbUser || { id: payload.sub, username: payload.username, role: payload.role, status: 'active' };
      }
    }

    const hasAccess = AccessPolicy.isAuthorized({
      user,
      symbol,
      provider,
      dataType: 'BARS',
    });

    if (!hasAccess) {
      sendJson(res, 403, { error: 'Entitlement denied', symbol, provider, dataType: 'BARS' });
      return;
    }

    const result = marketDataStore.queryBars({ provider, symbol, timeframe, beforeTime, limit });
    sendJson(res, 200, {
      provider,
      symbol,
      timeframe,
      bars: result.bars,
      hasMore: result.hasMore,
      cursor: result.cursor,
    });
    return;
  }

  // 9. Historical Trades / Ticks API
  if (req.url?.startsWith('/api/v1/trades')) {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const symbol = url.searchParams.get('symbol') || (process.env.DEFAULT_SYMBOL || 'ES');
    const provider = url.searchParams.get('provider') || (process.env.FUTURES_PROVIDER || 'none');
    const beforeTimeStr = url.searchParams.get('beforeTime');
    const beforeTime = beforeTimeStr ? parseInt(beforeTimeStr, 10) : undefined;
    const beforeId = url.searchParams.get('beforeId') || undefined;
    const limitStr = url.searchParams.get('limit');
    const limit = limitStr ? parseInt(limitStr, 10) : 100;

    const token = extractToken(req);
    let user: User | null = null;
    if (token) {
      const payload = verifyToken(token);
      if (payload) {
        const dbUser = marketDataStore.getUser(payload.sub);
        user = dbUser || { id: payload.sub, username: payload.username, role: payload.role, status: 'active' };
      }
    }

    const hasAccess = AccessPolicy.isAuthorized({
      user,
      symbol,
      provider,
      dataType: 'TICKS',
    });

    if (!hasAccess) {
      sendJson(res, 403, { error: 'Entitlement denied', symbol, provider, dataType: 'TICKS' });
      return;
    }

    const result = marketDataStore.queryTrades({ provider, symbol, beforeTime, beforeId, limit });
    sendJson(res, 200, {
      provider,
      symbol,
      trades: result.trades,
      hasMore: result.hasMore,
      cursor: result.cursor,
    });
    return;
  }

  // 10. Recorded Sequence & Market Data Gaps API
  if (req.url?.startsWith('/api/v1/gaps')) {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const symbol = url.searchParams.get('symbol') || (process.env.DEFAULT_SYMBOL || 'ES');
    const fromTs = url.searchParams.get('fromTs') ? parseInt(url.searchParams.get('fromTs')!, 10) : 0;
    const toTs = url.searchParams.get('toTs') ? parseInt(url.searchParams.get('toTs')!, 10) : Number.MAX_SAFE_INTEGER;
    const gaps = marketDataStore.getGaps(symbol, fromTs, toTs);
    sendJson(res, 200, { symbol, gaps, count: gaps.length });
    return;
  }

  // 11. Data Coverage & Capability Matrix API
  if (req.url?.startsWith('/api/v1/coverage')) {
    const futuresProvider = process.env.FUTURES_PROVIDER || 'none';
    const coverage = Object.values(FUTURES_INSTRUMENTS).map((inst) => {
      const provider = futuresProvider;
      const ctx = contextManager.getContext(inst.symbol);
      const isLive = futuresProvider !== 'none' && ctx?.feedStatus === 'LIVE';
      return {
        symbol: inst.symbol,
        name: inst.name,
        exchange: inst.exchange,
        category: inst.category,
        provider,
        realtime: isLive ? 'LIVE' : (futuresProvider !== 'none' ? 'DEGRADED' : 'UNAVAILABLE'),
        history: futuresProvider !== 'none' ? 'BARS' : 'NONE',
        footprint: isLive ? 'AVAILABLE' : 'UNAVAILABLE',
        orderbook: futuresProvider === 'databento' ? 'L2' : 'NONE',
        gapStatus: 'NONE',
      };
    });
    sendJson(res, 200, { coverage });
    return;
  }

  // 12. Authentication / Login API
  if (req.url?.startsWith('/api/v1/auth/login') && req.method === 'POST') {
    const body = await readJsonBody(req);
    const username = typeof body.username === 'string' && body.username.trim() ? body.username.trim() : 'guest';
    const role: 'user' | 'admin' = body.role === 'admin' ? 'admin' : 'user';
    const userId = typeof body.userId === 'string' && body.userId ? body.userId : `usr_${username}`;
    const user: User = {
      id: userId,
      username,
      role,
      status: 'active',
    };
    marketDataStore.saveUser(user);
    const token = createToken(user);
    const entitlements = marketDataStore.getEntitlementsForUser(user.id);
    sendJson(res, 200, {
      token,
      user,
      entitlements,
      message: 'Authentication successful',
    });
    return;
  }

  // 13. Current User & Entitlements API
  if (req.url?.startsWith('/api/v1/auth/me')) {
    const token = extractToken(req);
    if (!token) {
      sendJson(res, 401, { error: 'No authorization token provided' });
      return;
    }
    const payload = verifyToken(token);
    if (!payload) {
      sendJson(res, 401, { error: 'Invalid or expired token' });
      return;
    }
    const dbUser = marketDataStore.getUser(payload.sub);
    const user = dbUser || { id: payload.sub, username: payload.username, role: payload.role, status: 'active' };
    const entitlements = marketDataStore.getEntitlementsForUser(user.id);
    sendJson(res, 200, { user, entitlements, sessionPayload: payload });
    return;
  }

  // 14. Replay Statistics & Dataset Range API
  if (req.url?.startsWith('/api/v1/replay/stats')) {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const symbol = url.searchParams.get('symbol') || (process.env.DEFAULT_SYMBOL || 'ES');
    const provider = url.searchParams.get('provider') || (process.env.FUTURES_PROVIDER || 'none');
    const trades = marketDataStore.queryTrades({ provider, symbol, limit: 5000 }).trades;
    const ctx = contextManager.getContext(symbol);
    const liveTicks = ctx ? ctx.getHistoryTicks() : [];
    const totalTicks = Math.max(trades.length, liveTicks.length);
    const minTs = trades.length > 0 ? trades[0].timestamp : (liveTicks[0]?.timestamp || 0);
    const maxTs = trades.length > 0 ? trades[trades.length - 1].timestamp : (liveTicks[liveTicks.length - 1]?.timestamp || 0);

    sendJson(res, 200, {
      symbol,
      provider,
      storedTicksCount: trades.length,
      memoryTicksCount: liveTicks.length,
      availableTicksCount: totalTicks,
      earliestTimestamp: minTs,
      latestTimestamp: maxTs,
      canReplay: totalTicks > 0,
    });
    return;
  }

  await serveStatic(req, res);
});

interface ExtWebSocket extends WebSocket {
  isAlive?: boolean;
}

const wss = new WebSocketServer({ server: httpServer, maxPayload: MAX_PAYLOAD_BYTES });

// Warm default market context for primary CME instrument
const DEFAULT_SYMBOL = process.env.DEFAULT_SYMBOL || 'ES';
void contextManager.getOrCreateContext(DEFAULT_SYMBOL);

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
      const dbUser = marketDataStore.getUser(payload.sub);
      user = dbUser || { id: payload.sub, username: payload.username, role: payload.role, status: 'active' };
      if (user.status === 'suspended') {
        console.warn(`[DeepChart Server] Rejecting connection: user ${user.id} is suspended`);
        ws.close(1008, 'User account is suspended');
        return;
      }
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

  // Subscribe new connection to default symbol (1m)
  const defaultSym = process.env.DEFAULT_SYMBOL || 'ES';
  const gen = session.nextGeneration();
  void contextManager.subscribe(session, defaultSym, '1m', gen);

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

        // Entitlement check via centralized AccessPolicy
        const defaultFuturesProvider = process.env.DATABENTO_API_KEY ? 'databento' : (process.env.TRADOVATE_API_KEY ? 'tradovate' : 'none');
        const provider = process.env.FUTURES_PROVIDER || defaultFuturesProvider;
        const hasAccess = AccessPolicy.isAuthorized({
          user: session.user,
          symbol: requestedSymbol,
          provider,
          dataType: 'FOOTPRINT',
        });

        if (!hasAccess) {
          console.warn(`[DeepChart Server] Denied SUBSCRIBE for '${requestedSymbol}': user '${session.user?.id || 'guest'}' lacks entitlement`);
          session.send({
            type: 'ERROR',
            code: 'ENTITLEMENT_DENIED',
            message: `User '${session.user?.id || 'guest'}' lacks entitlement for ${requestedSymbol}`,
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

        // Entitlement check for REPLAY via centralized AccessPolicy
        const defaultFuturesProvider = process.env.DATABENTO_API_KEY ? 'databento' : (process.env.TRADOVATE_API_KEY ? 'tradovate' : 'none');
        const provider = process.env.FUTURES_PROVIDER || defaultFuturesProvider;
        const hasReplayAccess = AccessPolicy.isAuthorized({
          user: session.user,
          symbol: session.subscribedSymbol,
          provider,
          dataType: 'REPLAY',
        });

        if (!hasReplayAccess) {
          console.warn(`[DeepChart Server] Denied REPLAY for '${session.subscribedSymbol}': user '${session.user?.id || 'guest'}' lacks REPLAY entitlement`);
          session.send({
            type: 'ERROR',
            code: 'ENTITLEMENT_DENIED',
            message: `User '${session.user?.id || 'guest'}' lacks REPLAY entitlement for ${session.subscribedSymbol}`,
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
            let ticks = marketDataStore.queryTrades({ provider, symbol: sym, limit: 5000 }).trades;
            if (ticks.length === 0) {
              ticks = contextManager.getTicksForReplay(sym);
            }
            if (ticks.length === 0) {
              const ctx = contextManager.getContext(sym);
              ticks = ctx ? ctx.getHistoryTicks() : [];
            }
            if (ticks.length === 0) {
              const now = Date.now();
              const baseP = inst.basePrice || 5000;
              ticks = Array.from({ length: 50 }, (_, i) => ({
                id: `replay_seed_${i}`,
                timestamp: now - (50 - i) * 1000,
                price: baseP + (i % 5) * inst.tickSize,
                size: 1 + (i % 3),
                side: i % 2 === 0 ? 'buy' : 'sell',
              }));
            }
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
        const defaultFuturesProvider = process.env.DATABENTO_API_KEY ? 'databento' : (process.env.TRADOVATE_API_KEY ? 'tradovate' : 'none');
        const provider = typeof msg.provider === 'string' ? msg.provider : (process.env.FUTURES_PROVIDER || defaultFuturesProvider);
        const beforeTime = typeof msg.beforeTime === 'number' && Number.isFinite(msg.beforeTime) ? msg.beforeTime : undefined;
        const limit = typeof msg.limit === 'number' && Number.isFinite(msg.limit) ? msg.limit : 300;
        const requestId = typeof msg.requestId === 'string' ? msg.requestId : undefined;

        const hasAccess = AccessPolicy.isAuthorized({
          user: session.user,
          symbol,
          provider,
          dataType: 'BARS',
        });

        if (!hasAccess) {
          session.send({
            type: 'ERROR',
            code: 'ENTITLEMENT_DENIED',
            message: `User '${session.user?.id || 'guest'}' lacks BARS entitlement for ${symbol}`,
          });
          return;
        }

        let result = marketDataStore.queryBars({ provider, symbol, timeframe, beforeTime, limit });
        if (result.bars.length < limit && provider === 'databento' && process.env.DATABENTO_API_KEY) {
          const tfMs = TIMEFRAMES[timeframe] || 60000;
          const barMinutes = Math.max(Math.floor(tfMs / 60000), 1);
          try {
            const olderBars = await fetchDatabentoBars(
              symbol,
              {
                apiKey: process.env.DATABENTO_API_KEY,
                dataset: process.env.DATABENTO_DATASET,
                stypeIn: process.env.DATABENTO_STYPE_IN,
              },
              { barMinutes, elements: limit, beforeTime }
            );
            if (olderBars.length > 0) {
              marketDataStore.saveBars(olderBars, symbol, timeframe, provider);
              result = marketDataStore.queryBars({ provider, symbol, timeframe, beforeTime, limit });
            }
          } catch (fetchErr) {
            console.warn(`[History:databento] Pagination fetch failed for ${symbol}:`, (fetchErr as Error).message);
          }
        }
        session.send({
          type: 'HISTORY_RESPONSE',
          provider,
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
