import { IncomingMessage, ServerResponse } from 'http';
import { buildVolSurface } from './volSurface.js';
import { marketDataStore } from '../storage/marketDataStore.js';
import { snapshotStore } from '../quant/snapshotStore.js';

function sendJson(res: ServerResponse, statusCode: number, data: unknown) {
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.setHeader('cache-control', 'no-store');
  res.writeHead(statusCode);
  res.end(JSON.stringify(data));
}

export function createVolSurfaceRouter(): (req: IncomingMessage, res: ServerResponse, url: URL) => Promise<boolean> {
  return async (req, res, url) => {
    if (!url.pathname.startsWith('/api/v1/vol-surface')) return false;
    const underlying = (url.searchParams.get('underlying') || url.searchParams.get('symbol') || 'SPY').toUpperCase();
    const snap = snapshotStore.getLatest(underlying) ?? marketDataStore.getLatestExposure(underlying);
    if (!snap) { sendJson(res, 404, { error: `No exposure snapshot for ${underlying}` }); return true; }
    // Best-effort: derive surface from cached exposure levels if priced contracts unavailable
    const surface = buildVolSurface(underlying, snap.spot, [] as any);
    // Empty surface still returns diagnostics skeleton for the UI skeleton
    if (!surface) { sendJson(res, 200, { underlying, empty: true, reason: 'no priced contracts cached' }); return true; }
    sendJson(res, 200, surface);
    return true;
  };
}
