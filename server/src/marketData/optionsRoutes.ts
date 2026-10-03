/**
 * Databento Options & Market Intelligence API Routes
 *
 * Implements REST endpoints for:
 * - GET /api/v1/options/chain?underlying=SPY
 * - GET /api/v1/options/quotes?underlying=SPY
 * - GET /api/v1/options/trades?underlying=SPY
 * - GET /api/v1/options/statistics?symbol=SPY260320C00500000
 */

import { IncomingMessage, ServerResponse } from 'node:http';
import { DatabentoHttpClient } from '../databento/client.js';
import { MarketDataStore } from '../storage/marketDataStore.js';
import { RedisCache } from '../storage/redisCache.js';
import { OptionContractDefinition } from '../databento/types.js';
import { resolveDatabentoConfig } from '../databento/config.js';
import { DatabentoNotConfiguredError } from '../databento/errors.js';

export interface OptionsRouteContext {
  dbClient: DatabentoHttpClient;
  store: MarketDataStore;
  cache: RedisCache;
}

export function createOptionsRouter(ctx: OptionsRouteContext) {
  const { dbClient, store, cache } = ctx;

  return async function handleOptionsRequest(
    req: IncomingMessage,
    res: ServerResponse,
    url: URL
  ): Promise<boolean> {
    const pathname = url.pathname;

    if (!pathname.startsWith('/api/v1/options/')) {
      return false;
    }

    const sendJson = (status: number, data: any): boolean => {
      res.writeHead(status, {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store, max-age=0',
      });
      res.end(JSON.stringify(data));
      return true;
    };

    const sendError = (status: number, message: string): boolean => {
      sendJson(status, { error: message, status: 'error' });
      return true;
    };

    // 1. GET /api/v1/options/chain
    if (pathname === '/api/v1/options/chain') {
      const underlying = (url.searchParams.get('underlying') || url.searchParams.get('symbol') || 'SPY').toUpperCase();
      const cfg = resolveDatabentoConfig();

      try {
        const cached = await cache.getOptionChain(underlying);
        if (cached && cached.length > 0) {
          return sendJson(200, formatChainResponse(underlying, cached, 'cache'));
        }

        let definitions = store.getOptionDefinitions(underlying);

        if (definitions.length === 0) {
          if (!dbClient.configured) {
            if (definitions.length === 0) {
              // No store data and no vendor — return empty chain, not 500. Caller sees dataSource hint.
              return sendJson(200, formatChainResponse(underlying, [], 'none'));
            }
          } else {
            // Cost-cap guard
            const usage = store.getVendorUsage('databento', new Date().toISOString().slice(0, 7));
            if (usage.usd >= cfg.costCapUsd) {
              console.warn(`[OptionsRoutes] cost cap hit ($${usage.usd} >= $${cfg.costCapUsd}), serving store only`);
            } else {
              try {
                definitions = await dbClient.getOptionDefinitions(cfg.opraDataset, underlying);
                if (definitions.length > 0) {
                  store.saveOptionDefinitions(definitions);
                  await cache.setOptionChain(underlying, definitions, 300);
                  store.addVendorUsage('databento', new Date().toISOString().slice(0, 7), 0.01, 1);
                }
              } catch (err: any) {
                if (err?.code === 'VENDOR_NOT_CONFIGURED') {
                  return sendJson(503, { error: 'Vendor not configured', code: 'VENDOR_NOT_CONFIGURED' });
                }
                console.warn(`[OptionsRoutes] Failed to fetch OPRA definitions for ${underlying}: ${err.message}`);
              }
            }
          }
        }

        return sendJson(200, formatChainResponse(underlying, definitions, definitions.length ? 'databento' : 'none'));
      } catch (err: any) {
        return sendError(500, err.message || 'Failed to retrieve options chain');
      }
    }

    // 2. GET /api/v1/options/trades
    if (pathname === '/api/v1/options/trades') {
      const underlying = (url.searchParams.get('underlying') || url.searchParams.get('symbol') || 'SPY').toUpperCase();
      const limit = Math.min(200, Math.max(1, parseInt(url.searchParams.get('limit') || '50', 10)));

      try {
        let trades: any[] = [];

        if (dbClient.configured) {
          try {
            const rawTrades = await dbClient.getHistoricalTrades(
              'OPRA.PILLAR',
              underlying,
              new Date(Date.now() - 24 * 3600 * 1000).toISOString(),
              undefined,
              limit
            );

            trades = rawTrades.map((t) => {
              const premium = Math.round(t.price * t.size * 100);
              const isCall = t.symbol.includes('C');
              const sentiment = (t.side === 'buy' && isCall) || (t.side === 'sell' && !isCall) ? 'bullish' : 'bearish';

              return {
                id: t.tradeId || `db_${t.timestamp}_${t.price}`,
                symbol: t.symbol,
                underlying,
                price: t.price,
                size: t.size,
                premium,
                side: t.side,
                timestamp: t.timestamp,
                sentiment,
              };
            });
          } catch (err: any) {
            console.warn(`[OptionsRoutes] OPRA trades fetch failed for ${underlying}: ${err.message}`);
          }
        }

        return sendJson(200, {
          symbol: underlying,
          trades,
          source: 'databento',
          timestamp: Date.now(),
        });
      } catch (err: any) {
        return sendError(500, err.message || 'Failed to retrieve options trades');
      }
    }

    // 3. GET /api/v1/options/quotes
    if (pathname === '/api/v1/options/quotes') {
      const underlying = (url.searchParams.get('underlying') || url.searchParams.get('symbol') || 'SPY').toUpperCase();

      try {
        let quotes: any[] = [];
        if (dbClient.configured) {
          try {
            quotes = await dbClient.getHistoricalQuotes(
              'OPRA.PILLAR',
              underlying,
              new Date(Date.now() - 3600 * 1000).toISOString(),
              undefined,
              100
            );
          } catch (err: any) {
            console.warn(`[OptionsRoutes] OPRA quotes fetch failed for ${underlying}: ${err.message}`);
          }
        }

        return sendJson(200, {
          symbol: underlying,
          quotes,
          source: 'databento',
          timestamp: Date.now(),
        });
      } catch (err: any) {
        return sendError(500, err.message || 'Failed to retrieve options quotes');
      }
    }

    // 4. GET /api/v1/options/statistics
    if (pathname === '/api/v1/options/statistics') {
      const symbol = url.searchParams.get('symbol');
      if (!symbol) {
        return sendError(400, 'Missing symbol parameter');
      }

      try {
        let stats = store.getLatestStatistics(symbol);
        if (!stats && dbClient.configured) {
          const rawStats = await dbClient.getStatistics('OPRA.PILLAR', symbol);
          if (rawStats.length > 0) {
            store.saveStatistics(rawStats);
            stats = store.getLatestStatistics(symbol);
          }
        }

        return sendJson(200, {
          symbol,
          statistics: stats || { openInterest: 0, settlementPrice: 0, clearedVolume: 0 },
          source: 'databento',
          timestamp: Date.now(),
        });
      } catch (err: any) {
        return sendError(500, err.message || 'Failed to retrieve statistics');
      }
    }

    return false;
  };
}

function formatChainResponse(underlying: string, definitions: OptionContractDefinition[], source: string) {
  let totalCallOi = 0;
  let totalPutOi = 0;

  for (const d of definitions) {
    if (d.type === 'call') {
      totalCallOi += 100;
    } else {
      totalPutOi += 100;
    }
  }

  const putCallRatio = totalCallOi > 0 ? Number((totalPutOi / totalCallOi).toFixed(2)) : 1.0;

  return {
    symbol: underlying,
    spotPrice: 0,
    gex: 0,
    netGamma: 0,
    zeroGamma: 0,
    maxPain: 0,
    totalCallOi,
    totalPutOi,
    putCallRatio,
    contracts: definitions,
    source,
    timestamp: Date.now(),
  };
}
