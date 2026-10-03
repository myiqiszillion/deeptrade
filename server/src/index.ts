import { createServer, IncomingMessage, ServerResponse } from 'http';
import { timingSafeEqual } from 'node:crypto';
import { existsSync, watch } from 'fs';
import { readFile } from 'fs/promises';
import { extname, resolve, sep } from 'path';
import { fileURLToPath } from 'url';
import { WebSocket, WebSocketServer } from 'ws';
import { User } from './auth/types.js';
import { entitlementService } from './auth/entitlementService.js';
import { AccessPolicy } from './auth/accessPolicy.js';
import { createToken, verifyToken, assertAuthConfig, revokeToken } from './auth/token.js';
import { hashPassword, verifyPassword, assertPasswordPolicy } from './auth/passwords.js';
import { LoginGuard } from './auth/loginGuard.js';
import { billingService } from './billing/billingService.js';
import { DEFAULT_PLAN_ID, getPlan, listPlans } from './billing/plans.js';
import { applyStripeEvent, createCheckoutSession, verifyStripeSignature, StripeEvent } from './billing/stripe.js';
import { PlanId } from './billing/types.js';
import { startMaintenance } from './maintenance.js';
import { installConsoleBridge } from './util/logger.js';
import { metrics } from './util/metrics.js';
import { clientIpFrom, SlidingWindowLimiter } from './util/rateLimiter.js';
import { FUTURES_INSTRUMENTS, getOrRegisterInstrument } from './futuresConfig.js';
import { MarketContextManager, TIMEFRAMES } from './marketData/marketContext.js';
import { marketDataStore } from './storage/marketDataStore.js';
import { ReplaySession } from './replaySession.js';
import { MAX_SESSIONS, MAX_SESSIONS_PER_USER, ChartSession } from './session.js';
import { Tick, WSClientMessage, WSServerMessage } from './types.js';
import {
  fetchWatchlistQuotes,
  normaliseQuoteSymbols,
  quoteBoardEnabled,
  quoteBoardTtlMs,
} from './marketData/quoteBoard.js';
import { historyBarsTarget } from './marketData/historyDepth.js';
import { DatabentoHttpClient } from './databento/client.js';
import { RedisCache } from './storage/redisCache.js';
import { createOptionsRouter } from './marketData/optionsRoutes.js';
import { syncInstrumentSpecs } from './marketData/instrumentSync.js';
import { createExposureRouter } from './options/exposureRoutes.js';
import { createVolSurfaceRouter } from './options/volSurfaceRoutes.js';
import { snapshotStore } from './quant/snapshotStore.js';
import { microstructureEngine } from './microstructure/engine.js';
import { buildMarketImpact } from './quant/dealerPositioning.js';
import { findSimilarDays, summarizeObservations } from './intelligence/historicalIntelligence.js';
import { buildCrossAssetEvidence } from './intelligence/crossAsset.js';
import { emitEvent, listEvents } from './intelligence/eventEngine.js';
import { evaluateSignals } from './signals/featureScores.js';
import { createBacktestRouter } from './research/backtest.js';
import { createLabRouter } from './research/lab.js';
import { buildMarketState } from './ai/marketState.js';
import { createCopilotRouter } from './ai/copilot.js';
import { listDatasets } from './datasets/capabilities.js';
import { listSchemas } from './datasets/schemaRegistry.js';
import { instrumentMaster } from './instruments/master.js';
import { symbolEngine } from './symbols/engine.js';
import { optionsSymbolResolver } from './symbols/optionsResolver.js';
import { futuresSymbolResolver } from './symbols/futuresResolver.js';
import { getTradingHours } from './sessions/tradingSessions.js';
import { marketStatusEngine } from './sessions/marketStatus.js';
import { historicalEngine } from './databento/historicalEngine.js';
import { rawStore } from './storage/rawStore.js';

// Test runs must stay hermetic: hydrating the developer's .env would re-introduce vendor
// credentials and STORAGE_PATH after the suites deliberately stripped them.
if (process.env.NODE_ENV !== 'test') {
  const reloadEnv = () => {
    try {
      process.loadEnvFile?.('../.env');
    } catch {}
    try {
      process.loadEnvFile?.();
    } catch {}
  };
  reloadEnv();

  // Watch for runtime changes to .env files so keys are instantly hot-reloaded
  for (const envPath of ['.env', '../.env', resolve(process.cwd(), '.env'), resolve(process.cwd(), '../.env')]) {
    if (existsSync(envPath)) {
      try {
        watch(envPath, () => {
          reloadEnv();
          console.log('[Config] .env modified and reloaded into process.env');
        });
      } catch {}
    }
  }
}

// Structured logs first (LOG_FORMAT=json), then the configuration guard: a server that requires
// authentication must never boot on the public dev secret or with DEV_HOOKS enabled.
installConsoleBridge();
assertAuthConfig();

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

/**
 * WebSocket origin policy.
 *
 * `ALLOWED_ORIGINS` wins when set. Otherwise only localhost (dev servers on any port) and the
 * app's own host are accepted — a random third-party site can no longer open a socket to us.
 */
function isOriginAllowed(origin: string | undefined, requestHost?: string): boolean {
  if (!origin) return true; // Direct client, scripts, or same-origin without Origin header
  const lower = origin.trim().toLowerCase();
  if (allowedOrigins) {
    return allowedOrigins.has(lower);
  }
  try {
    const u = new URL(lower);
    const host = u.hostname;
    if (host === 'localhost' || host === '127.0.0.1' || host === '0.0.0.0' || host === '::1' || host === '[::1]') {
      return true;
    }
    if (requestHost) {
      const bareHost = requestHost.split(':')[0].toLowerCase();
      if (host === bareHost) return true;
    }
    return false;
  } catch {
    return false;
  }
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

/* ------------------------------------------------------------------ HTTP hardening */

const AUTH_REQUIRED = process.env.AUTH_REQUIRED === '1';
const DEV_MODE = !AUTH_REQUIRED;

const apiLimiter = new SlidingWindowLimiter(parseInt(process.env.MAX_API_REQUESTS_PER_MIN || '240', 10), 60_000);
const authLimiter = new SlidingWindowLimiter(parseInt(process.env.MAX_AUTH_REQUESTS_PER_MIN || '15', 10), 60_000);
const loginGuard = new LoginGuard(
  parseInt(process.env.LOGIN_MAX_FAILURES || '5', 10),
  parseInt(process.env.LOGIN_FAILURE_WINDOW_SECONDS || '900', 10) * 1000,
  parseInt(process.env.LOGIN_LOCK_SECONDS || '900', 10) * 1000
);
/** Bounds paid-vendor spend: history pagination can trigger billable upstream calls. */
const vendorFetchLimiter = new SlidingWindowLimiter(
  parseInt(process.env.MAX_VENDOR_FETCHES_PER_HOUR || '120', 10),
  60 * 60_000
);

const CSP_POLICY =
  "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; " +
  "connect-src 'self' ws: wss:; font-src 'self' data:; frame-ancestors 'none'; base-uri 'self'; " +
  "form-action 'self'; object-src 'none'";

/** Echo only trusted origins (never a blanket '*'). */
function applyCors(req: IncomingMessage, res: ServerResponse): void {
  const origin = req.headers.origin;
  if (typeof origin !== 'string' || !origin) return;
  if (!isOriginAllowed(origin)) return;
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, Stripe-Signature, X-Admin-Secret');
  res.setHeader('Access-Control-Max-Age', '600');
}

function applySecurityHeaders(res: ServerResponse, options: { html?: boolean } = {}): void {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
  if (process.env.NODE_ENV === 'production' || process.env.ENABLE_HSTS === '1') {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
  if (options.html) {
    res.setHeader('Content-Security-Policy', CSP_POLICY);
  }
}

function constantTimeEquals(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

function adminSecretFrom(req: IncomingMessage): string | null {
  const header = req.headers['x-admin-secret'];
  if (typeof header === 'string' && header.trim()) return header.trim();
  const bearer = extractToken(req);
  return bearer && bearer.trim() ? bearer.trim() : null;
}

/** Admin authorization: shared ADMIN_SECRET (constant-time) or a JWT whose role is admin. */
function isAdminRequest(req: IncomingMessage): boolean {
  const secret = adminSecretFrom(req);
  const configured = process.env.ADMIN_SECRET;
  if (secret && configured && constantTimeEquals(secret, configured)) return true;

  const token = extractToken(req);
  if (!token) return false;
  const payload = verifyToken(token);
  return payload?.role === 'admin';
}

/** Resolve the authenticated user of an HTTP request (JWT → store row, status checked). */
function authenticatedUser(req: IncomingMessage): User | null {
  const token = extractToken(req);
  if (!token) return null;
  const payload = verifyToken(token);
  if (!payload) return null;
  const stored = marketDataStore.getUser(payload.sub);
  const user: User = stored || { id: payload.sub, username: payload.username, role: payload.role, status: 'active' };
  return user.status === 'suspended' ? null : user;
}

function isMetricsAuthorized(req: IncomingMessage): boolean {
  const expected = process.env.METRICS_TOKEN;
  if (!expected) return DEV_MODE;
  const token = extractToken(req);
  if (token && constantTimeEquals(token, expected)) return true;
  return isAdminRequest(req);
}

function rateLimitOrReject(
  req: IncomingMessage,
  res: ServerResponse,
  limiter: SlidingWindowLimiter,
  bucket: string
): boolean {
  const ip = clientIpFrom(req);
  const verdict = limiter.hit(`${bucket}:${ip}`);
  if (verdict.allowed) return true;
  metrics.inc('deepchart_rate_limited_total', 'Requests rejected by rate limiting', { bucket });
  applyCors(req, res);
  applySecurityHeaders(res);
  res.setHeader('Retry-After', String(verdict.retryAfterSec));
  sendJson(res, 429, { error: 'Rate limit exceeded', retryAfterSec: verdict.retryAfterSec });
  return false;
}

/** Read the raw body (Stripe signatures are computed over the exact bytes). */
function readRawBody(req: IncomingMessage, maxBytes = 262144): Promise<string> {
  return new Promise((resolve) => {
    let data = '';
    req.on('data', (chunk) => {
      data += chunk;
      if (data.length > maxBytes) {
        req.destroy();
        resolve(data);
      }
    });
    req.on('end', () => resolve(data));
    req.on('error', () => resolve(data));
  });
}



/** Usernames are the only public identifier; ids are derived from them server-side. */
function normalizeUsername(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!/^[A-Za-z0-9._-]{3,32}$/.test(trimmed)) return null;
  return trimmed;
}

function userIdForUsername(username: string): string {
  return `usr_${username.toLowerCase()}`;
}

// Multi-instrument market context manager
import { createDatabentoHistoryProvider } from './marketData/databentoHistoryProvider.js';
const databentoClient = new DatabentoHttpClient();
const databentoHistoryProvider = createDatabentoHistoryProvider(databentoClient);
const contextManager = new MarketContextManager(undefined, undefined, undefined, databentoHistoryProvider);
const redisCache = new RedisCache();
const handleOptionsRequest = createOptionsRouter({
  dbClient: databentoClient,
  store: marketDataStore,
  cache: redisCache,
});
const handleExposureRequest = createExposureRouter({ store: marketDataStore, cache: redisCache });
const handleVolSurfaceRequest = createVolSurfaceRouter();
const handleBacktestRequest = createBacktestRouter();
const handleLabRequest = createLabRouter();
const handleCopilotRequest = createCopilotRouter();

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
    const ext = extname(target);
    const isHtml = ext === '.html';
    // Vite fingerprints /assets/* so they can be cached forever; the shell must never be cached.
    if (target.includes(`${sep}assets${sep}`)) {
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    } else if (isHtml) {
      res.setHeader('Cache-Control', 'no-store');
    } else {
      res.setHeader('Cache-Control', 'public, max-age=3600');
    }
    applySecurityHeaders(res, { html: isHtml });
    res.writeHead(200, { 'content-type': MIME_TYPES[ext] || 'application/octet-stream' });
    res.end(body);
  } catch {
    // SPA fallback: unknown paths return index.html so client routing keeps working.
    try {
      const fallback = await readFile(resolve(CLIENT_DIST, 'index.html'));
      res.setHeader('Cache-Control', 'no-store');
      applySecurityHeaders(res, { html: true });
      res.writeHead(200, { 'content-type': MIME_TYPES['.html'] });
      res.end(fallback);
    } catch {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('Client build not found. Run `pnpm build` first (or set CLIENT_DIST).');
    }
  }
}

function sendJson(res: ServerResponse, statusCode: number, data: unknown): void {
  applySecurityHeaders(res);
  res.setHeader('Cache-Control', 'no-store');
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
  // 1. CORS: echo only trusted origins, plus the standard hardening headers.
  applyCors(req, res);
  applySecurityHeaders(res);

  if (req.method === 'OPTIONS') {
    res.writeHead(204).end();
    return;
  }

  // 1b. Per-IP request budget. Auth endpoints are stricter, and both are separate from the
  // per-session WebSocket message budget.
  if (req.url?.startsWith('/api/')) {
    if (!rateLimitOrReject(req, res, apiLimiter, 'api')) return;
    if (req.url.startsWith('/api/v1/auth/') && !rateLimitOrReject(req, res, authLimiter, 'auth')) return;

  }

  // 2. Health Check — public summary, full detail only for operators.
  if (req.url?.startsWith('/healthz')) {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    let symbolParam = url.searchParams.get('symbol');
    const defaultSym = process.env.DEFAULT_SYMBOL || 'ES';
    if (!symbolParam) {
      const activeSession = sessions.values().next().value;
      symbolParam = activeSession?.subscribedSymbol || defaultSym;
    }
    const targetSymbol = symbolParam || defaultSym;
    const ctx = contextManager.getContext(targetSymbol) || contextManager.getContext(defaultSym);
    const detailed = isAdminRequest(req);

    if (!detailed) {
      res.writeHead(200, { 'content-type': MIME_TYPES['.json'] });
      res.end(
        JSON.stringify({
          status: 'ok',
          uptimeSec: Math.round(process.uptime()),
          sessions: sessions.size,
          feedStatus: ctx?.feedStatus || 'UNAVAILABLE',
        })
      );
      return;
    }

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
        databento: {
          configured: Boolean(process.env.DATABENTO_API_KEY),
          opraDataset: process.env.DATABENTO_OPRA_DATASET || 'OPRA.PILLAR',
          equitiesDataset: process.env.DATABENTO_EQUITIES_DATASET || 'DBEQ.BASIC',
          cmeDataset: process.env.DATABENTO_CME_DATASET || 'GLBX.MDP3',
          costCapUsd: parseFloat(process.env.DATABENTO_COST_CAP_USD || '50'),
          vendorUsage: marketDataStore.listVendorUsage('databento', 3),
          instrumentSpecs: marketDataStore.listInstrumentSpecs('databento').length,
        },
        historySource: ctx?.getHistorySource() || 'NONE',
        gexSource: ctx?.instrument.underlyingIndex
          ? contextManager.getGexEngine().getProfile(ctx.instrument.underlyingIndex)?.dataSource
          : undefined,
      })
    );
    return;
  }

  // 3. Prometheus metrics (token/admin protected unless running in development).
  if (req.url?.startsWith('/metrics')) {
    if (!isMetricsAuthorized(req)) {
      sendJson(res, 401, { error: 'Metrics endpoint requires METRICS_TOKEN or admin credentials' });
      return;
    }
    metrics.set('deepchart_sessions', sessions.size, 'Active chart sessions');
    metrics.set('deepchart_unique_users', userSessions.size, 'Distinct users with an active session');
    metrics.set('deepchart_process_resident_memory_bytes', process.memoryUsage().rss, 'Resident memory');
    metrics.set('deepchart_process_heap_used_bytes', process.memoryUsage().heapUsed, 'JS heap in use');
    metrics.set('deepchart_uptime_seconds', Math.round(process.uptime()), 'Process uptime');
    const storeStats = marketDataStore.stats();
    metrics.set('deepchart_store_rows', storeStats.users, 'Rows currently stored', { table: 'users' });
    metrics.set('deepchart_store_rows', storeStats.subscriptions, 'Rows currently stored', { table: 'subscriptions' });

    const accept = String(req.headers.accept || '');
    if (accept.includes('application/json') && !accept.includes('text/plain')) {
      sendJson(res, 200, {
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
        metrics: metrics.snapshot(),
      });
      return;
    }

    const body = metrics.renderPrometheus();
    res.writeHead(200, { 'content-type': 'text/plain; version=0.0.4; charset=utf-8' });
    res.end(body);
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
      const inst = getOrRegisterInstrument(sym);
      if (!inst) {
        sendJson(res, 404, { error: `Instrument '${sym}' not found` });
        return;
      }
      const ctx = contextManager.getContext(sym);
      const provider = futuresProvider;
      // Honest feed state: a symbol with no market context is NOT connecting — the server starts the vendor
      // feed lazily on subscribe, so it is IDLE. Claiming CONNECTING for 42 untouched symbols is a lie.
      const feedStatus = ctx?.feedStatus ?? 'IDLE';
      sendJson(res, 200, {
        instrument: inst,
        feedStatus,
        subscribed: Boolean(ctx),
        feedConfigured: futuresProvider !== 'none',
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
      const feedStatus = ctx?.feedStatus ?? 'IDLE';
      return {
        ...inst,
        provider,
        feedStatus,
        subscribed: Boolean(ctx),
        feedConfigured: futuresProvider !== 'none',
        isLive: feedStatus === 'LIVE',
      };
    });
    sendJson(res, 200, { instruments: list, total: list.length });
    return;
  }

  // 4b. Watchlist quotes (opt-in, metered): disabled unless the operator enables the quote board.
  if (req.url?.startsWith('/api/v1/quotes')) {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const requested = normaliseQuoteSymbols(url.searchParams.get('symbols') || '');
    if (!quoteBoardEnabled()) {
      sendJson(res, 200, {
        enabled: false,
        quotes: [],
        hint: 'Set ENABLE_QUOTE_BOARD=1 to fetch last-trade quotes for the watchlist (metered vendor data).',
      });
      return;
    }
    const quotes = await fetchWatchlistQuotes({ symbols: requested });
    sendJson(res, 200, {
      enabled: true,
      ttlMs: quoteBoardTtlMs(),
      requested: requested.length,
      quotes,
    });
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

  // 7b. Databento Options Intelligence API
  if (req.url?.startsWith('/api/v1/options/')) {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const handled = await handleOptionsRequest(req, res, url);
    if (handled) return;
  }

  // 7c. Exposure API (GEX/DEX/VEX)
  if (req.url?.startsWith('/api/v1/exposure')) {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const handled = await handleExposureRequest(req, res, url);
    if (handled) return;
  }

  // 7d. Vol Surface + Dealer + Microstructure + Snapshot
  if (req.url?.startsWith('/api/v1/vol-surface')) {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const handled = await handleVolSurfaceRequest(req, res, url);
    if (handled) return;
  }
  if (req.url?.startsWith('/api/v1/dealer-impact')) {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const underlying = (url.searchParams.get('underlying') || url.searchParams.get('symbol') || 'SPY').toUpperCase();
    const snap = snapshotStore.getLatest(underlying) ?? marketDataStore.getLatestExposure(underlying);
    if (!snap) { sendJson(res, 404, { error: `No snapshot for ${underlying}` }); return; }
    // Rebuild ExposureSnapshot shape for dealer model (totals already include charm/vanna after exposure.ts update)
    const model = buildMarketImpact(snap as any);
    sendJson(res, 200, model); return;
  }
  if (req.url?.startsWith('/api/v1/microstructure')) {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const sym = (url.searchParams.get('symbol') || 'ES').toUpperCase();
    const ctx = contextManager.getContext(sym);
    const snap2 = microstructureEngine.snapshot(sym, ctx ? ctx.getBook() : null);
    sendJson(res, 200, snap2); return;
  }
  if (req.url?.startsWith('/api/v1/snapshots/')) {
    const underlying = (new URL(req.url, `http://${req.headers.host || 'localhost'}`).pathname.split('/').pop() || 'SPY').toUpperCase();
    const snap = snapshotStore.getLatest(underlying) ?? marketDataStore.getLatestExposure(underlying);
    if (!snap) { sendJson(res, 404, { error: `No snapshot for ${underlying}` }); return; }
    sendJson(res, 200, snap); return;
  }
  // Intelligence & Research & AI (grouped for readability; each router returns false if not matched)
  if (req.url?.startsWith('/api/v1/intelligence/')) {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    if (url.pathname === '/api/v1/intelligence/similar') {
      const u = (url.searchParams.get('underlying') || url.searchParams.get('symbol') || 'SPY').toUpperCase();
      const obs = findSimilarDays(u, 10);
      const summary = summarizeObservations(obs);
      sendJson(res, 200, { underlying: u, observations: obs, summary }); return;
    }
  }
  if (req.url?.startsWith('/api/v1/cross-asset')) {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const u = url.searchParams.get('underlying') || url.searchParams.get('symbol') || 'SPY';
    sendJson(res, 200, buildCrossAssetEvidence(u)); return;
  }
  if (req.url?.startsWith('/api/v1/events')) {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    if (req.method === 'POST') {
      const raw = await readRawBody(req);
      try {
        const b = JSON.parse(raw);
        const ev = emitEvent({ timestamp: Date.now(), underlying: String(b.underlying||'SPY').toUpperCase(), kind: b.kind || 'LARGE_FLOW', title: b.title || b.kind || 'Event', detail: b.detail, meta: b.meta });
        sendJson(res, 201, ev); return;
      } catch { sendJson(res, 400, { error: 'Invalid JSON' }); return; }
    }
    const u = url.searchParams.get('underlying') || url.searchParams.get('symbol') || undefined;
    sendJson(res, 200, { events: listEvents(u, 100) }); return;
  }
  if (req.url?.startsWith('/api/v1/signals')) {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const u = url.searchParams.get('underlying') || url.searchParams.get('symbol') || 'SPY';
    sendJson(res, 200, evaluateSignals(u)); return;
  }
  if (req.url?.startsWith('/api/v1/research/backtest')) {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const handled = await handleBacktestRequest(req, res, url);
    if (handled) return;
  }
  if (req.url?.startsWith('/api/v1/research/query')) {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const handled = await handleLabRequest(req, res, url);
    if (handled) return;
  }
  if (req.url?.startsWith('/api/v1/ai/')) {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    if (url.pathname.startsWith('/api/v1/ai/market-state')) {
      const u = url.searchParams.get('underlying') || url.searchParams.get('symbol') || 'SPY';
      sendJson(res, 200, buildMarketState(u)); return;
    }
    const handled = await handleCopilotRequest(req, res, url);
    if (handled) return;
  }
  // QuantDecay public API — datasets, schemas, instruments, symbols, symbology, futures, reference
  if (req.url?.startsWith('/api/v1/datasets')) { sendJson(res, 200, { datasets: listDatasets() }); return; }
  if (req.url?.startsWith('/api/v1/schemas')) { sendJson(res, 200, { schemas: listSchemas() }); return; }
  if (req.url?.startsWith('/api/v1/instruments/search')) {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const q = url.searchParams.get('q') || url.searchParams.get('asset') || '';
    const dataset = url.searchParams.get('dataset') || undefined;
    const results = instrumentMaster.search({ asset: q || undefined, dataset });
    sendJson(res, 200, { instruments: results }); return;
  }
  if (req.url?.startsWith('/api/v1/symbols/options/chain')) {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const u = (url.searchParams.get('underlying') || 'SPY').toUpperCase();
    const chain = await optionsSymbolResolver.chain(u);
    sendJson(res, 200, { underlying: u, chain }); return;
  }
  if (req.url?.startsWith('/api/v1/symbols/futures/strip')) {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const root = (url.searchParams.get('root') || 'ES').toUpperCase();
    const strip = await futuresSymbolResolver.strip(root);
    sendJson(res, 200, { root, strip }); return;
  }
  if (req.url?.startsWith('/api/v1/symbols/search')) {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const q = url.searchParams.get('q') || '';
    const results = instrumentMaster.search({ asset: q || undefined });
    sendJson(res, 200, { query: q, results }); return;
  }
  if (req.url?.startsWith('/api/v1/symbology/resolve')) {
    if (req.method === 'POST') {
      const raw = await readRawBody(req);
      try {
        const b = JSON.parse(raw);
        const { dataset, symbols, stypeIn, stypeOut } = b;
        const { SymbologyResolver } = await import('./symbols/engine.js');
        const resolver = new SymbologyResolver();
        const m = await resolver.resolve({ symbols: symbols ?? [], dataset: dataset ?? 'OPRA.PILLAR', stypeIn: stypeIn ?? 'raw_symbol', stypeOut: stypeOut ?? 'instrument_id' });
        sendJson(res, 200, { mappings: Object.fromEntries(m) }); return;
      } catch (e: any) { sendJson(res, 400, { error: e.message }); return; }
    }
    sendJson(res, 405, { error: 'Use POST' }); return;
  }
  if (req.url?.startsWith('/api/v1/reference/corporate-actions')) {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    sendJson(res, 200, { actions: [] }); return;
  }
  if (req.url?.startsWith('/api/v1/sessions/trading-hours')) {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const date = url.searchParams.get('date') || new Date().toISOString().slice(0,10);
    const iid = parseInt(url.searchParams.get('instrument_id') || '0', 10);
    sendJson(res, 200, getTradingHours(iid, date)); return;
  }
  if (req.url?.startsWith('/api/v1/sessions/status')) {
    sendJson(res, 200, { status: marketStatusEngine.getStatus('OPRA.PILLAR') ?? 'unknown' }); return;
  }
  if (req.url?.startsWith('/api/v1/raw/manifest')) {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const dataset = url.searchParams.get('dataset') || 'OPRA.PILLAR';
    const schema = url.searchParams.get('schema') || 'trades';
    const date = url.searchParams.get('date') || new Date().toISOString().slice(0,10);
    const files = await rawStore.locate({ dataset, schema, date });
    sendJson(res, 200, { dataset, schema, date, files }); return;
  }
  if (req.url?.startsWith('/api/v1/futures/continuous')) {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const root = url.pathname.split('/').pop() || 'ES';
    const c = await futuresSymbolResolver.continuousToContract(root);
    sendJson(res, 200, { root, contract: c }); return;
  }
  if (req.url?.startsWith('/api/v1/futures/roll')) {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const root = url.searchParams.get('root') || 'ES';
    sendJson(res, 200, { root, rolls: [] }); return;
  }
  if (req.url?.startsWith('/api/v1/monitoring/live')) {
    sendJson(res, 200, { sessions: [] }); return;
  }
  if (req.url?.startsWith('/api/v1/monitoring/quality')) {
    sendJson(res, 200, { alerts: [] }); return;
  }
  if (req.url?.startsWith('/api/v1/monitoring/vendor')) {
    sendJson(res, 200, { usage: marketDataStore.listVendorUsage('databento', 12) }); return;
  }

  // 8. Historical Bars API
  if (req.url?.startsWith('/api/v1/history')) {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const symbol = url.searchParams.get('symbol') || (process.env.DEFAULT_SYMBOL || 'ES');
    const timeframe = url.searchParams.get('timeframe') || '1m';
    const defaultFuturesProvider = process.env.DATABENTO_API_KEY ? 'databento' : 'none';
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

  // 12a. Registration: creates the account, hashes the password and grants the free plan
  if (req.url?.startsWith('/api/v1/auth/register') && req.method === 'POST') {
    const body = await readJsonBody(req);
    const username = normalizeUsername(body.username);
    if (!username) {
      sendJson(res, 400, { error: 'Username must be 3-32 characters: letters, digits, dot, dash or underscore.' });
      return;
    }
    if (marketDataStore.findUserByUsername(username)) {
      sendJson(res, 409, { error: 'Username already taken' });
      return;
    }
    try {
      assertPasswordPolicy(body.password);
    } catch (err) {
      sendJson(res, 400, { error: (err as Error).message });
      return;
    }

    const user: User = { id: userIdForUsername(username), username, role: 'user', status: 'active' };
    marketDataStore.saveUser(user);
    marketDataStore.setUserPassword(user.id, hashPassword(body.password as string));
    billingService.applyPlan(user, DEFAULT_PLAN_ID, { provider: 'trial' });
    metrics.inc('deepchart_auth_events_total', 'Authentication events', { event: 'register' });
    console.log(`[Auth] Registered '${username}' on the ${DEFAULT_PLAN_ID} plan`);

    const token = createToken(user);
    sendJson(res, 201, {
      token,
      user,
      plan: billingService.getEffectivePlan(user.id).plan,
      entitlements: marketDataStore.getEntitlementsForUser(user.id),
    });
    return;
  }

  // 12. Authentication: password login with per-account/IP lockout
  if (req.url?.startsWith('/api/v1/auth/login') && req.method === 'POST') {
    const body = await readJsonBody(req);
    const identifier = typeof body.username === 'string' && body.username.trim() ? body.username.trim() : 'guest';
    const ip = clientIpFrom(req);
    const guardKeys = [`user:${identifier.toLowerCase()}`, `ip:${ip}`];

    const lockout = loginGuard.check(guardKeys);
    if (lockout.locked) {
      metrics.inc('deepchart_auth_events_total', 'Authentication events', { event: 'lockout' });
      res.setHeader('Retry-After', String(lockout.retryAfterSec));
      sendJson(res, 429, { error: 'Too many failed attempts. Try again later.', retryAfterSec: lockout.retryAfterSec });
      return;
    }

    const credentials = marketDataStore.getUserCredentials(identifier);
    const configuredAdminSecret = process.env.ADMIN_SECRET;
    const providedAdminSecret = typeof body.adminSecret === 'string' ? body.adminSecret : '';
    const adminSecretValid = Boolean(
      configuredAdminSecret && providedAdminSecret && constantTimeEquals(providedAdminSecret, configuredAdminSecret)
    );

    // A stored hash always requires the matching password; the password-less path only exists for
    // dev/demo accounts while AUTH_REQUIRED is off.
    let passwordOk = false;
    if (credentials?.passwordHash) {
      passwordOk = verifyPassword(body.password, credentials.passwordHash);
    } else if (!credentials) {
      passwordOk = DEV_MODE;
    } else {
      passwordOk = DEV_MODE;
    }

    if (!passwordOk && !adminSecretValid) {
      loginGuard.recordFailure(guardKeys);
      metrics.inc('deepchart_auth_events_total', 'Authentication events', { event: 'login_failed' });
      sendJson(res, 401, {
        error: credentials?.passwordHash
          ? 'Invalid username or password'
          : 'This account needs a password: register first or sign in with the admin secret',
      });
      return;
    }

    let user: User | null = credentials?.user ?? null;
    if (!user) {
      const username = normalizeUsername(identifier) || 'guest';
      user = { id: userIdForUsername(username), username, role: 'user', status: 'active' };
      marketDataStore.saveUser(user);
      billingService.applyPlan(user, DEFAULT_PLAN_ID, { provider: 'trial' });
    }

    if (user.status === 'suspended') {
      loginGuard.recordFailure(guardKeys);
      sendJson(res, 403, { error: 'Account suspended' });
      return;
    }

    // Role stays server-controlled: the shared admin secret is the only way to mint an admin token.
    if (adminSecretValid && user.role !== 'admin') {
      user = { ...user, role: 'admin' };
      marketDataStore.saveUser(user);
      billingService.applyPlan(user, 'elite', { provider: 'manual' });
      console.log(`[Auth] Promoted '${user.username}' to admin via ADMIN_SECRET`);
    }

    loginGuard.recordSuccess(guardKeys);
    metrics.inc('deepchart_auth_events_total', 'Authentication events', { event: 'login_success' });
    const token = createToken(user);
    sendJson(res, 200, {
      token,
      user,
      plan: billingService.getEffectivePlan(user.id).plan,
      entitlements: marketDataStore.getEntitlementsForUser(user.id),
      message: 'Authentication successful',
    });
    return;
  }

  // 12b. Session termination (JWT revocation)
  if (req.url?.startsWith('/api/v1/auth/logout') && req.method === 'POST') {
    const token = extractToken(req);
    const payload = token ? verifyToken(token) : null;
    if (payload) {
      revokeToken(payload.jti, payload.sub, payload.exp);
      metrics.inc('deepchart_auth_events_total', 'Authentication events', { event: 'logout' });
    }
    sendJson(res, 200, { message: 'Signed out' });
    return;
  }

  // 12c. Public client configuration: does the SPA need a login screen, and what is for sale?
  if (req.url?.startsWith('/api/v1/auth/config')) {
    sendJson(res, 200, {
      authRequired: AUTH_REQUIRED,
      devMode: DEV_MODE && process.env.DEV_HOOKS === '1',
      registrationEnabled: true,
      billingConfigured: Boolean(process.env.STRIPE_SECRET_KEY && process.env.STRIPE_PRICE_PRO),
      defaultPlanId: DEFAULT_PLAN_ID,
      plans: listPlans().map((plan) => ({
        id: plan.id,
        name: plan.name,
        priceUsdMonthly: plan.priceUsdMonthly,
        features: plan.features,
        maxConcurrentSessions: plan.maxConcurrentSessions,
        historyDays: plan.historyDays,
        dataTypes: plan.dataTypes,
        symbolPatterns: plan.symbolPatterns,
      })),
    });
    return;
  }

  // 13b. Billing: catalog is public, checkout/subscription need a session, webhook is signature-verified
  if (req.url?.startsWith('/api/v1/billing/plans')) {
    sendJson(res, 200, {
      plans: listPlans(),
      billingConfigured: Boolean(process.env.STRIPE_SECRET_KEY && process.env.STRIPE_PRICE_PRO),
    });
    return;
  }

  if (req.url?.startsWith('/api/v1/billing/subscription')) {
    const user = authenticatedUser(req);
    if (!user) {
      sendJson(res, 401, { error: 'Authentication required' });
      return;
    }
    const { subscription, plan } = billingService.getEffectivePlan(user.id);
    sendJson(res, 200, {
      subscription,
      plan,
      entitlements: marketDataStore.getEntitlementsForUser(user.id),
    });
    return;
  }

  if (req.url?.startsWith('/api/v1/billing/checkout') && req.method === 'POST') {
    const user = authenticatedUser(req);
    if (!user) {
      sendJson(res, 401, { error: 'Authentication required' });
      return;
    }
    const body = await readJsonBody(req);
    const planId = typeof body.planId === 'string' ? body.planId : '';
    if (!getPlan(planId) || planId === DEFAULT_PLAN_ID) {
      sendJson(res, 400, { error: 'Choose a paid plan (pro or elite)' });
      return;
    }
    const forwardedProto = req.headers['x-forwarded-proto'];
    const scheme = forwardedProto === 'https' || process.env.NODE_ENV === 'production' ? 'https' : 'http';
    const origin = `${scheme}://${req.headers.host || `localhost:${PORT}`}`;
    const result = await createCheckoutSession({
      user,
      planId: planId as PlanId,
      successUrl: `${origin}/?checkout=success`,
      cancelUrl: `${origin}/?checkout=cancel`,
    });
    if ('error' in result) {
      sendJson(res, 503, { error: result.error });
      return;
    }
    sendJson(res, 200, { url: result.url });
    return;
  }

  if (req.url?.startsWith('/api/v1/billing/webhook') && req.method === 'POST') {
    const raw = await readRawBody(req);
    const signature = req.headers['stripe-signature'];
    if (!verifyStripeSignature(raw, typeof signature === 'string' ? signature : undefined, process.env.STRIPE_WEBHOOK_SECRET)) {
      metrics.inc('deepchart_billing_webhook_total', 'Billing webhook outcomes', { result: 'invalid_signature' });
      sendJson(res, 400, { error: 'Invalid signature' });
      return;
    }
    let event: StripeEvent;
    try {
      event = JSON.parse(raw) as StripeEvent;
    } catch {
      sendJson(res, 400, { error: 'Invalid JSON payload' });
      return;
    }
    const outcome = applyStripeEvent(event);
    metrics.inc('deepchart_billing_webhook_total', 'Billing webhook outcomes', { result: outcome.split(':')[0] });
    console.log(`[Billing] Stripe event '${event.type}' -> ${outcome}`);
    sendJson(res, 200, { received: true, outcome });
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
    sendJson(res, 200, {
      user,
      entitlements,
      plan: billingService.getEffectivePlan(user.id).plan,
      subscription: billingService.getEffectivePlan(user.id).subscription,
      sessionPayload: payload,
    });
    return;
  }

  // 13c. Admin API: provisioning, suspension, GDPR deletion, ops metrics
  if (req.url?.startsWith('/api/v1/admin/')) {
    if (!isAdminRequest(req)) {
      sendJson(res, 403, { error: 'Admin credentials required' });
      return;
    }
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const parts = url.pathname.split('/').filter(Boolean);

    if (parts[3] === 'users' && parts.length === 4) {
      const subscriptions = marketDataStore.listSubscriptions();
      const byUser = new Map(subscriptions.map((s) => [s.userId, s]));
      sendJson(res, 200, {
        users: marketDataStore.listUsers(500).map((u) => ({
          ...u,
          planId: byUser.get(u.id)?.planId ?? DEFAULT_PLAN_ID,
          subscriptionStatus: byUser.get(u.id)?.status ?? 'none',
          currentPeriodEnd: byUser.get(u.id)?.currentPeriodEnd ?? null,
        })),
      });
      return;
    }

    if (parts[3] === 'users' && parts[5] === 'plan' && req.method === 'POST') {
      const target = marketDataStore.getUser(decodeURIComponent(parts[4]));
      if (!target) {
        sendJson(res, 404, { error: 'User not found' });
        return;
      }
      const body = await readJsonBody(req);
      const planId = typeof body.planId === 'string' ? body.planId : '';
      if (!getPlan(planId)) {
        sendJson(res, 400, { error: `Unknown plan '${planId}'`, availablePlans: listPlans().map((p) => p.id) });
        return;
      }
      const days = Number(body.days);
      const subscription = billingService.applyPlan(target, planId as PlanId, {
        provider: 'manual',
        validUntil: Number.isFinite(days) && days > 0 ? Date.now() + days * 24 * 60 * 60 * 1000 : undefined,
      });
      console.log(`[Admin] plan ${planId} applied to ${target.id}`);
      sendJson(res, 200, { subscription, entitlements: marketDataStore.getEntitlementsForUser(target.id) });
      return;
    }

    if (parts[3] === 'users' && parts[5] === 'suspend' && req.method === 'POST') {
      const target = marketDataStore.getUser(decodeURIComponent(parts[4]));
      if (!target) {
        sendJson(res, 404, { error: 'User not found' });
        return;
      }
      const body = await readJsonBody(req);
      const suspended = body.suspended !== false;
      const updated: User = { ...target, status: suspended ? 'suspended' : 'active' };
      marketDataStore.saveUser(updated);
      if (suspended) {
        for (const session of sessions.values()) {
          if (session.user?.id === updated.id) session.close(1008, 'Account suspended');
        }
      }
      console.log(`[Admin] ${suspended ? 'suspended' : 'reactivated'} ${updated.id}`);
      sendJson(res, 200, { user: updated });
      return;
    }

    if (parts[3] === 'users' && parts.length === 5 && req.method === 'DELETE') {
      const userId = decodeURIComponent(parts[4]);
      const target = marketDataStore.getUser(userId);
      if (!target) {
        sendJson(res, 404, { error: 'User not found' });
        return;
      }
      for (const session of sessions.values()) {
        if (session.user?.id === userId) session.close(1008, 'Account deleted');
      }
      entitlementService.revokeAll(userId);
      marketDataStore.deleteUser(userId);
      console.log(`[Admin] deleted account ${userId} (GDPR erasure)`);
      sendJson(res, 200, { deleted: true, userId });
      return;
    }

    // Vendor definitions: catalog instruments status
    if (parts[3] === 'instruments' && parts[4] === 'sync' && req.method === 'POST') {
      const result = await syncInstrumentSpecs(databentoClient, marketDataStore);
      sendJson(res, result.synced ? 200 : 502, result);
      return;
    }

    if (parts[3] === 'instruments' && parts[4] === 'specs') {
      const specs = marketDataStore.listInstrumentSpecs('databento');
      sendJson(res, 200, {
        total: Object.keys(FUTURES_INSTRUMENTS).length,
        storedSpecs: specs.length,
        specs: specs.map((s) => ({
          root: s.root,
          rawSymbol: s.rawSymbol,
          exchange: s.exchange,
          currency: s.currency,
          tickSize: s.tickSize,
          pointValue: s.pointValue,
          tickValue: s.tickValue,
          unitOfMeasure: s.unitOfMeasure,
          updatedAt: s.updatedAt,
        })),
      });
      return;
    }

    if (parts[3] === 'metrics') {
      sendJson(res, 200, {
        metrics: metrics.snapshot(),
        store: marketDataStore.stats(),
        vendorUsage: {
          provider: 'databento',
          history: marketDataStore.listVendorUsage('databento', 12),
        },
      });
      return;
    }

    sendJson(res, 404, { error: 'Unknown admin route' });
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

/**
 * Ensure the operator account from env (ADMIN_USERNAME + ADMIN_PASSWORD) exists with the admin role
 * and the top plan, so a fresh production deployment is usable without touching SQLite by hand.
 */
function bootstrapAdmin(): void {
  const username = normalizeUsername(process.env.ADMIN_USERNAME);
  const password = process.env.ADMIN_PASSWORD;
  if (!username || !password) return;
  try {
    assertPasswordPolicy(password);
  } catch (err) {
    console.warn(`[Auth] ADMIN_PASSWORD rejected: ${(err as Error).message}`);
    return;
  }
  const user: User = { id: userIdForUsername(username), username, role: 'admin', status: 'active' };
  marketDataStore.saveUser(user);
  marketDataStore.setUserPassword(user.id, hashPassword(password));
  billingService.applyPlan(user, 'elite', { provider: 'manual' });
  console.log(`[Auth] Operator account '${username}' ensured with the elite plan`);
}

bootstrapAdmin();

const maintenance = startMaintenance();

console.log(
  `[DeepChart Server] auth=${AUTH_REQUIRED ? 'required' : 'guest-allowed'} devHooks=${
    process.env.DEV_HOOKS === '1' ? 'on' : 'off'
  } provider=${process.env.FUTURES_PROVIDER || (process.env.DATABENTO_API_KEY ? 'databento' : 'none')} billing=${
    process.env.STRIPE_SECRET_KEY ? 'stripe' : 'manual-only'
  } metrics=${process.env.METRICS_TOKEN ? 'token' : DEV_MODE ? 'open(dev)' : 'admin-only'} retention=${
    process.env.STORE_RETENTION_DAYS || '30'
  }d bars=${process.env.STORE_BARS_RETENTION_DAYS || process.env.STORE_RETENTION_DAYS || '30'}d history=${
    historyBarsTarget()
  }bars logFormat=${process.env.LOG_FORMAT || 'plain'}`
);

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
  // 1. Origin Verification — default allows the app's own host plus local development ports only.
  const origin = req.headers.origin;
  if (!isOriginAllowed(origin, req.headers.host)) {
    console.warn(`[DeepChart Server] Rejecting connection: unauthorized origin '${origin}'`);
    metrics.inc('deepchart_ws_rejected_total', 'WebSocket connections refused', { reason: 'origin' });
    ws.close(1008, 'Origin not allowed');
    return;
  }

  // 2. Capacity Check
  if (sessions.size >= MAX_SESSIONS) {
    console.warn(`[DeepChart Server] Rejecting connection: session limit (${MAX_SESSIONS}) reached.`);
    metrics.inc('deepchart_ws_rejected_total', 'WebSocket connections refused', { reason: 'capacity' });
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
  metrics.inc('deepchart_ws_connections_total', 'WebSocket connections accepted');
  metrics.inc('deepchart_ws_connections_total', 'WebSocket connections accepted', { user: user.id === 'guest' ? 'guest' : 'account' });

  ws.on('close', () => {
    metrics.inc('deepchart_ws_disconnects_total', 'WebSocket connections closed');
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
      metrics.inc('deepchart_ws_messages_total', 'Inbound WebSocket messages');
      // 1. Rate limit check before parsing
      if (!session.allowMessage()) {
        metrics.inc('deepchart_ws_messages_total', 'Inbound WebSocket messages', { result: 'rate_limited' });
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

      if (msg.type === 'PING') {
        session.send({
          type: 'PONG',
          timestamp: typeof msg.timestamp === 'number' ? msg.timestamp : Date.now(),
        });
        return;
      }

      if (msg.type === 'SUBSCRIBE') {
        const requestedSymbol = typeof msg.symbol === 'string' ? msg.symbol : undefined;
        const requestedTf = typeof msg.timeframe === 'string' ? msg.timeframe : session.subscribedTimeframe || '1m';

        // Validate symbol
        const validInst = requestedSymbol ? getOrRegisterInstrument(requestedSymbol) : null;
        if (!validInst) {
          console.warn(`[DeepChart Server] Ignoring SUBSCRIBE for invalid symbol '${requestedSymbol}'`);
          const currentCtx = contextManager.getContext(session.subscribedSymbol);
          if (currentCtx && session.isOpen) {
            session.send(currentCtx.buildInitState(session, session.subscribedTimeframe));
          }
          return;
        }

        const targetSymbol = validInst.symbol;

        // Validate timeframe
        if (!TIMEFRAMES[requestedTf]) {
          console.warn(`[DeepChart Server] Ignoring SUBSCRIBE for invalid timeframe '${requestedTf}'`);
          return;
        }

        // Entitlement check via centralized AccessPolicy
        const defaultFuturesProvider = process.env.DATABENTO_API_KEY ? 'databento' : 'none';
        const provider = process.env.FUTURES_PROVIDER || defaultFuturesProvider;
        const hasAccess = AccessPolicy.isAuthorized({
          user: session.user,
          symbol: targetSymbol,
          provider,
          dataType: 'FOOTPRINT',
        });

        if (!hasAccess) {
          console.warn(`[DeepChart Server] Denied SUBSCRIBE for '${targetSymbol}': user '${session.user?.id || 'guest'}' lacks entitlement`);
          session.send({
            type: 'ERROR',
            code: 'ENTITLEMENT_DENIED',
            message: `User '${session.user?.id || 'guest'}' lacks entitlement for ${targetSymbol}`,
          });
          return;
        }

        // Only dispose replay session after validation and entitlement pass
        if (session.replaySession) {
          session.replaySession.dispose();
          session.replaySession = null;
        }

        const gen = session.nextGeneration();
        if (targetSymbol !== session.subscribedSymbol) {
          await contextManager.subscribe(session, targetSymbol, requestedTf, gen);
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
        const defaultFuturesProvider = process.env.DATABENTO_API_KEY ? 'databento' : 'none';
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
            const inst = getOrRegisterInstrument(sym);
            let ticks = marketDataStore.queryTrades({ provider, symbol: sym, limit: 5000 }).trades;
            if (ticks.length === 0) {
              for (const p of ['databento', 'binance']) {
                ticks = marketDataStore.queryTrades({ provider: p, symbol: sym, limit: 5000 }).trades;
                if (ticks.length > 0) break;
              }
            }
            if (ticks.length === 0) {
              ticks = contextManager.getTicksForReplay(sym);
            }
            if (ticks.length === 0) {
              const ctx = contextManager.getContext(sym);
              ticks = ctx ? ctx.getHistoryTicks() : [];
            }
            if (ticks.length === 0) {
              console.warn(`[DeepChart Server] Denied REPLAY for '${sym}': no historical or buffered market ticks available`);
              session.send({
                type: 'ERROR',
                code: 'NO_REPLAY_DATA',
                message: `No market replay data available for ${sym}`,
              });
              return;
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
        const defaultFuturesProvider = process.env.DATABENTO_API_KEY ? 'databento' : 'none';
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
          result = marketDataStore.queryBars({ provider, symbol, timeframe, beforeTime, limit });
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
  maintenance.stop();
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
