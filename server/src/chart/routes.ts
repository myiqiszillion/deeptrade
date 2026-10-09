/**
 * TradingView & Chart Order Flow Router
 *
 * Exposes:
 * 1. TradingView Universal Datafeed (UDF) API (/api/v1/udf/*)
 * 2. Institutional Chart Order Flow API (/api/v1/chart/*)
 * Backed 100% directly by Databento.
 */

import { IncomingMessage, ServerResponse } from 'node:http';
import { ChartService } from './chartService.js';
import { DatabentoHttpClient } from '../databento/client.js';

export function createChartRouter(ctx: {
  client: DatabentoHttpClient;
  chartService?: ChartService;
  getDepthHistory?: (symbol: string, from?: number, to?: number) => any[];
}) {
  const chartService = ctx.chartService || new ChartService(ctx.client);

  const sendJson = (res: ServerResponse, status: number, data: any): boolean => {
    res.writeHead(status, {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store, max-age=0',
      'Access-Control-Allow-Origin': '*',
    });
    res.end(JSON.stringify(data));
    return true;
  };

  const readJsonBody = async (req: IncomingMessage): Promise<any> => {
    let raw = '';
    return new Promise((resolve, reject) => {
      req.on('data', (chunk) => {
        raw += chunk;
        if (raw.length > 256 * 1024) {
          reject(new Error('Payload too large'));
        }
      });
      req.on('end', () => {
        try {
          resolve(raw ? JSON.parse(raw) : {});
        } catch (err) {
          reject(err);
        }
      });
      req.on('error', reject);
    });
  };

  return async function handleChartRequest(
    req: IncomingMessage,
    res: ServerResponse,
    url: URL
  ): Promise<boolean> {
    const pathname = url.pathname;

    // ==========================================
    // 1. TradingView Universal Datafeed (UDF) API
    // ==========================================
    if (pathname.startsWith('/api/v1/udf/')) {
      const subpath = pathname.replace('/api/v1/udf/', '');

      // /config
      if (subpath === 'config') {
        return sendJson(res, 200, chartService.getUdfConfig());
      }

      // /time
      if (subpath === 'time') {
        res.writeHead(200, { 'Content-Type': 'text/plain', 'Access-Control-Allow-Origin': '*' });
        res.end(String(chartService.getUdfTime()));
        return true;
      }

      // /symbols
      if (subpath === 'symbols') {
        const symbol = url.searchParams.get('symbol') || 'ES';
        try {
          const info = await chartService.getUdfSymbol(symbol);
          return sendJson(res, 200, info);
        } catch (err: any) {
          return sendJson(res, 404, { s: 'error', errmsg: err?.message || 'Symbol not found' });
        }
      }

      // /search
      if (subpath === 'search') {
        const query = url.searchParams.get('query') || '';
        const type = url.searchParams.get('type') || undefined;
        const exchange = url.searchParams.get('exchange') || undefined;
        const limit = url.searchParams.get('limit') ? Number(url.searchParams.get('limit')) : 30;

        const results = await chartService.searchUdfSymbols(query, type, exchange, limit);
        return sendJson(res, 200, results);
      }

      // /history
      if (subpath === 'history') {
        const symbol = url.searchParams.get('symbol') || 'ES';
        const resolution = url.searchParams.get('resolution') || '1';
        const from = Number(url.searchParams.get('from')) || Math.floor((Date.now() - 86400000) / 1000);
        const to = Number(url.searchParams.get('to')) || Math.floor(Date.now() / 1000);
        const countback = url.searchParams.get('countback') ? Number(url.searchParams.get('countback')) : undefined;

        const history = await chartService.getUdfHistory(symbol, resolution, from, to, countback);
        return sendJson(res, 200, history);
      }

      // /marks
      if (subpath === 'marks') {
        const symbol = url.searchParams.get('symbol') || 'ES';
        const from = Number(url.searchParams.get('from')) || Math.floor((Date.now() - 86400000) / 1000);
        const to = Number(url.searchParams.get('to')) || Math.floor(Date.now() / 1000);

        const marks = await chartService.getUdfMarks(symbol, from, to);
        return sendJson(res, 200, marks);
      }

      // /timescale_marks
      if (subpath === 'timescale_marks') {
        const symbol = url.searchParams.get('symbol') || 'ES';
        const from = Number(url.searchParams.get('from')) || Math.floor((Date.now() - 86400000) / 1000);
        const to = Number(url.searchParams.get('to')) || Math.floor(Date.now() / 1000);

        const marks = chartService.getUdfTimescaleMarks(symbol, from, to);
        return sendJson(res, 200, marks);
      }

      return sendJson(res, 404, { s: 'error', errmsg: `Unknown UDF endpoint: ${subpath}` });
    }

    // ==========================================
    // 2. Institutional Chart Order Flow API
    // ==========================================
    if (pathname.startsWith('/api/v1/chart/')) {
      const subpath = pathname.replace('/api/v1/chart/', '');

      // /bars
      if (subpath === 'bars') {
        const symbol = url.searchParams.get('symbol') || 'ES';
        const resolution = url.searchParams.get('resolution') || '1';
        const from = Number(url.searchParams.get('from')) || Math.floor((Date.now() - 86400000) / 1000);
        const to = Number(url.searchParams.get('to')) || Math.floor(Date.now() / 1000);
        const countback = url.searchParams.get('countback') ? Number(url.searchParams.get('countback')) : undefined;

        const history = await chartService.getUdfHistory(symbol, resolution, from, to, countback);
        if (history.s === 'ok' && history.t) {
          const bars = history.t.map((t, idx) => ({
            time: t * 1000,
            open: history.o![idx],
            high: history.h![idx],
            low: history.l![idx],
            close: history.c![idx],
            volume: history.v![idx],
          }));
          return sendJson(res, 200, { symbol, resolution, count: bars.length, bars });
        }
        return sendJson(res, 200, { symbol, resolution, count: 0, bars: [] });
      }

      // /footprint
      if (subpath === 'footprint') {
        const symbol = url.searchParams.get('symbol') || 'ES';
        const resolution = url.searchParams.get('resolution') || '1';
        const from = url.searchParams.get('from') ? Number(url.searchParams.get('from')) : undefined;
        const to = url.searchParams.get('to') ? Number(url.searchParams.get('to')) : undefined;

        const footprint = await chartService.getFootprintData(symbol, resolution, from, to);
        return sendJson(res, 200, { symbol, resolution, count: footprint.length, bars: footprint });
      }

      // /cvd
      if (subpath === 'cvd') {
        const symbol = url.searchParams.get('symbol') || 'ES';
        const from = url.searchParams.get('from') ? Number(url.searchParams.get('from')) : undefined;
        const to = url.searchParams.get('to') ? Number(url.searchParams.get('to')) : undefined;

        const cvd = await chartService.getCvdData(symbol, from, to);
        return sendJson(res, 200, { symbol, count: cvd.length, series: cvd });
      }

      // /volume-profile
      if (subpath === 'volume-profile') {
        const symbol = url.searchParams.get('symbol') || 'ES';
        const from = url.searchParams.get('from') ? Number(url.searchParams.get('from')) : undefined;
        const to = url.searchParams.get('to') ? Number(url.searchParams.get('to')) : undefined;

        const vp = await chartService.getVolumeProfile(symbol, from, to);
        return sendJson(res, 200, vp);
      }

      // /volume-profile-range
      if (subpath === 'volume-profile-range') {
        if (req.method !== 'POST') {
          return sendJson(res, 405, { error: 'Method not allowed. Use POST', code: 'METHOD_NOT_ALLOWED' });
        }
        let body: any;
        try {
          body = await readJsonBody(req);
        } catch (err: any) {
          return sendJson(res, 400, { error: `Invalid JSON body: ${err?.message}`, code: 'INVALID_BODY' });
        }

        const symbol = typeof body.symbol === 'string' ? body.symbol : 'ES';
        const startTime = Number(body.startTime);
        const endTime = Number(body.endTime);

        try {
          const result = await chartService.getVolumeProfileRange(symbol, startTime, endTime);
          return sendJson(res, 200, result);
        } catch (err: any) {
          const message = err?.message || 'Failed to compute volume profile for range';
          const status = message.includes('Invalid or unsupported') ? 404 : 400;
          return sendJson(res, status, { error: message, code: 'VOLUME_PROFILE_RANGE_ERROR' });
        }
      }

      // /vwap
      if (subpath === 'vwap') {
        const symbol = url.searchParams.get('symbol') || 'ES';
        const from = url.searchParams.get('from') ? Number(url.searchParams.get('from')) : undefined;
        const to = url.searchParams.get('to') ? Number(url.searchParams.get('to')) : undefined;

        const vwap = await chartService.getVwapData(symbol, from, to);
        return sendJson(res, 200, { symbol, count: vwap.length, series: vwap });
      }

      // /depth-heatmap
      if (subpath === 'depth-heatmap') {
        const symbol = url.searchParams.get('symbol') || 'ES';
        const from = url.searchParams.get('from') ? Number(url.searchParams.get('from')) : undefined;
        const to = url.searchParams.get('to') ? Number(url.searchParams.get('to')) : undefined;
        const resolution = url.searchParams.get('resolution') ? Number(url.searchParams.get('resolution')) : undefined;
        const limit = url.searchParams.get('limit') ? Number(url.searchParams.get('limit')) : undefined;
        const offset = url.searchParams.get('offset') ? Number(url.searchParams.get('offset')) : undefined;

        const liveSnapshots = ctx.getDepthHistory ? ctx.getDepthHistory(symbol, from, to) : undefined;
        const result = await chartService.getDepthHeatmapExtended(symbol, from, to, resolution, limit, offset, liveSnapshots);
        return sendJson(res, 200, result);
      }

      // /large-trades
      if (subpath === 'large-trades') {
        const symbol = url.searchParams.get('symbol') || 'ES';
        const from = url.searchParams.get('from') ? Number(url.searchParams.get('from')) : undefined;
        const to = url.searchParams.get('to') ? Number(url.searchParams.get('to')) : undefined;
        const minSize = url.searchParams.get('min_size') ? Number(url.searchParams.get('min_size')) : undefined;
        const minUsd = url.searchParams.get('min_usd') ? Number(url.searchParams.get('min_usd')) : undefined;

        const trades = await chartService.getLargeTrades(symbol, from, to, minSize, minUsd);
        return sendJson(res, 200, { symbol, count: trades.length, trades });
      }

      // /levels
      if (subpath === 'levels') {
        const symbol = url.searchParams.get('symbol') || 'ES';
        const levels = await chartService.getChartLevels(symbol);
        return sendJson(res, 200, levels);
      }

      return sendJson(res, 404, { error: `Unknown chart endpoint: ${subpath}` });
    }

    return false;
  };
}
