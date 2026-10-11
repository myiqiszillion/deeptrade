/**
 * Databento Full API Router
 *
 * Implements REST endpoints for the full suite of Databento's official capabilities:
 * - Metadata: datasets, schemas, fields, unit prices, dataset date range, cost estimation
 * - Symbology: symbology.resolve (raw_symbol, instrument_id, parent, continuous)
 * - Timeseries: bars (ohlcv-1s/1m/1h/1d), trades, quotes (mbp-1), depth (mbp-10), tbbo, mbo, definition, statistics, status, imbalances
 */

import { IncomingMessage, ServerResponse } from 'node:http';
import { DatabentoHttpClient } from './client.js';

interface DatabentoRouteContext {
  client: DatabentoHttpClient;
}

export function createDatabentoRouter(ctx: DatabentoRouteContext) {
  const { client } = ctx;

  const sendJson = (res: ServerResponse, status: number, data: any): boolean => {
    res.writeHead(status, {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store, max-age=0',
    });
    res.end(JSON.stringify(data));
    return true;
  };

  const readJsonBody = async (req: IncomingMessage): Promise<any> => {
    let raw = '';
    return new Promise((resolve, reject) => {
      req.on('data', (chunk) => {
        raw += chunk;
        if (raw.length > 1024 * 1024) {
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

  return async function handleDatabentoRequest(
    req: IncomingMessage,
    res: ServerResponse,
    url: URL
  ): Promise<boolean> {
    const pathname = url.pathname;

    if (!pathname.startsWith('/api/v1/databento/')) {
      return false;
    }

    if (!client.configured) {
      return sendJson(res, 503, {
        error: 'Databento API is not configured (missing DATABENTO_API_KEY)',
        status: 'error',
      });
    }

    const subpath = pathname.replace('/api/v1/databento/', '');

    try {
      // 1. Metadata: Publishers
      if (subpath === 'publishers') {
        const publishers = await client.listPublishers();
        return sendJson(res, 200, { count: publishers.length, publishers });
      }

      // 2. Metadata: Datasets
      if (subpath === 'datasets') {
        const datasets = await client.listDatasets();
        return sendJson(res, 200, { datasets, count: datasets.length });
      }

      // 3. Metadata: Schemas
      if (subpath === 'schemas') {
        const dataset = url.searchParams.get('dataset') || 'GLBX.MDP3';
        const schemas = await client.listSchemas(dataset);
        return sendJson(res, 200, { dataset, schemas });
      }

      // 4. Metadata: Fields
      if (subpath === 'fields') {
        const dataset = url.searchParams.get('dataset') || 'GLBX.MDP3';
        const schema = url.searchParams.get('schema') || 'trades';
        const encoding = url.searchParams.get('encoding') || undefined;
        const fields = await client.listFields(dataset, schema, encoding);
        return sendJson(res, 200, { dataset, schema, fields });
      }

      // 5. Metadata: Unit Prices
      if (subpath === 'unit-prices') {
        const dataset = url.searchParams.get('dataset') || 'GLBX.MDP3';
        const mode = url.searchParams.get('mode') || undefined;
        const unitPrices = await client.listUnitPrices(dataset, mode);
        return sendJson(res, 200, { dataset, unitPrices });
      }

      // 6. Metadata: Dataset Condition
      if (subpath === 'condition') {
        const dataset = url.searchParams.get('dataset') || 'GLBX.MDP3';
        const startDate = url.searchParams.get('start_date') || undefined;
        const endDate = url.searchParams.get('end_date') || undefined;
        const condition = await client.getDatasetCondition(dataset, startDate, endDate);
        return sendJson(res, 200, { dataset, condition });
      }

      // 7. Metadata: Date Range
      if (subpath === 'range') {
        const dataset = url.searchParams.get('dataset') || 'GLBX.MDP3';
        const range = await client.getDatasetRange(dataset);
        return sendJson(res, 200, { dataset, ...range });
      }

      // 8. Metadata: Record Count Estimation
      if (subpath === 'record-count') {
        const dataset = url.searchParams.get('dataset') || 'GLBX.MDP3';
        const schema = url.searchParams.get('schema') || 'trades';
        const symbols = url.searchParams.get('symbols') || 'ES.FUT';
        const start = url.searchParams.get('start') || new Date(Date.now() - 86400000).toISOString();
        const end = url.searchParams.get('end') || undefined;
        const stypeIn = url.searchParams.get('stype_in') || undefined;
        const limit = url.searchParams.get('limit') ? Number(url.searchParams.get('limit')) : undefined;

        const count = await client.getRecordCount({ dataset, schema, symbols, start, end, stypeIn, limit });
        return sendJson(res, 200, { dataset, schema, symbols, count });
      }

      // 9. Metadata: Billable Size Estimation
      if (subpath === 'billable-size') {
        const dataset = url.searchParams.get('dataset') || 'GLBX.MDP3';
        const schema = url.searchParams.get('schema') || 'trades';
        const symbols = url.searchParams.get('symbols') || 'ES.FUT';
        const start = url.searchParams.get('start') || new Date(Date.now() - 86400000).toISOString();
        const end = url.searchParams.get('end') || undefined;
        const stypeIn = url.searchParams.get('stype_in') || undefined;
        const limit = url.searchParams.get('limit') ? Number(url.searchParams.get('limit')) : undefined;

        const sizeBytes = await client.getBillableSize({ dataset, schema, symbols, start, end, stypeIn, limit });
        return sendJson(res, 200, { dataset, schema, symbols, sizeBytes });
      }

      // 10. Metadata: Cost Estimation
      if (subpath === 'cost') {
        const dataset = url.searchParams.get('dataset') || 'GLBX.MDP3';
        const schema = url.searchParams.get('schema') || 'trades';
        const symbols = url.searchParams.get('symbols') || 'ES.FUT';
        const start = url.searchParams.get('start') || new Date(Date.now() - 86400000).toISOString();
        const end = url.searchParams.get('end') || undefined;

        const cost = await client.getCost(dataset, schema, symbols, start, end);
        return sendJson(res, 200, { dataset, schema, symbols, ...cost });
      }

      // 6. Symbology Resolve
      if (subpath === 'symbology/resolve') {
        if (req.method === 'POST') {
          const body = await readJsonBody(req);
          const dataset = body.dataset || 'EQUS.MINI';
          const symbols = body.symbols || [];
          const stypeIn = body.stypeIn || body.stype_in || 'raw_symbol';
          const stypeOut = body.stypeOut || body.stype_out || 'instrument_id';
          const startDate = body.startDate || body.start_date;
          const endDate = body.endDate || body.end_date;

          const result = await client.resolveSymbology(dataset, symbols, stypeIn, stypeOut, startDate, endDate);
          return sendJson(res, 200, result);
        } else {
          const dataset = url.searchParams.get('dataset') || 'EQUS.MINI';
          const symbols = (url.searchParams.get('symbols') || 'SPY').split(',');
          const stypeIn = url.searchParams.get('stype_in') || 'raw_symbol';
          const stypeOut = url.searchParams.get('stype_out') || 'instrument_id';
          const startDate = url.searchParams.get('start_date') || undefined;
          const endDate = url.searchParams.get('end_date') || undefined;

          const result = await client.resolveSymbology(dataset, symbols, stypeIn, stypeOut, startDate, endDate);
          return sendJson(res, 200, result);
        }
      }

      // 7. Timeseries: Historical OHLCV Bars
      if (subpath === 'bars') {
        const dataset = url.searchParams.get('dataset') || 'GLBX.MDP3';
        const symbols = (url.searchParams.get('symbols') || url.searchParams.get('symbol') || 'ES.FUT').split(',');
        const schema = (url.searchParams.get('schema') || 'ohlcv-1m') as any;
        const start = url.searchParams.get('start') || new Date(Date.now() - 3600000 * 24).toISOString();
        const end = url.searchParams.get('end') || undefined;
        const limit = url.searchParams.get('limit') ? Number(url.searchParams.get('limit')) : 1000;
        const stypeIn = url.searchParams.get('stype_in') || undefined;

        const bars = await client.getHistoricalBars(dataset, symbols, schema, start, end, limit, stypeIn);
        return sendJson(res, 200, { dataset, symbols, schema, count: bars.length, bars });
      }

      // 8. Timeseries: Historical Trades
      if (subpath === 'trades') {
        const dataset = url.searchParams.get('dataset') || 'GLBX.MDP3';
        const symbols = (url.searchParams.get('symbols') || url.searchParams.get('symbol') || 'ES.FUT').split(',');
        const start = url.searchParams.get('start') || new Date(Date.now() - 3600000).toISOString();
        const end = url.searchParams.get('end') || undefined;
        const limit = url.searchParams.get('limit') ? Number(url.searchParams.get('limit')) : 500;

        const trades = await client.getHistoricalTrades(dataset, symbols, start, end, limit);
        return sendJson(res, 200, { dataset, symbols, count: trades.length, trades });
      }

      // 9. Timeseries: Historical Top-of-Book Quotes (MBP-1)
      if (subpath === 'quotes') {
        const dataset = url.searchParams.get('dataset') || 'GLBX.MDP3';
        const symbols = (url.searchParams.get('symbols') || url.searchParams.get('symbol') || 'ES.FUT').split(',');
        const start = url.searchParams.get('start') || new Date(Date.now() - 3600000).toISOString();
        const end = url.searchParams.get('end') || undefined;
        const limit = url.searchParams.get('limit') ? Number(url.searchParams.get('limit')) : 500;

        const quotes = await client.getHistoricalQuotes(dataset, symbols, start, end, limit);
        return sendJson(res, 200, { dataset, symbols, count: quotes.length, quotes });
      }

      // 10. Timeseries: Historical 10-level Depth (MBP-10)
      if (subpath === 'depth') {
        const dataset = url.searchParams.get('dataset') || 'GLBX.MDP3';
        const symbols = (url.searchParams.get('symbols') || url.searchParams.get('symbol') || 'ES.FUT').split(',');
        const start = url.searchParams.get('start') || new Date(Date.now() - 3600000).toISOString();
        const end = url.searchParams.get('end') || undefined;
        const limit = url.searchParams.get('limit') ? Number(url.searchParams.get('limit')) : 100;

        const depth = await client.getHistoricalDepth(dataset, symbols, start, end, limit);
        return sendJson(res, 200, { dataset, symbols, count: depth.length, depth });
      }

      // 11. Timeseries: Option / Contract Definitions
      if (subpath === 'definitions') {
        const dataset = url.searchParams.get('dataset') || 'OPRA.PILLAR';
        const underlying = url.searchParams.get('underlying') || url.searchParams.get('symbol') || undefined;
        const start = url.searchParams.get('start') || undefined;
        const end = url.searchParams.get('end') || undefined;

        const definitions = await client.getOptionDefinitions(dataset, underlying, start, end);
        return sendJson(res, 200, { dataset, underlying, count: definitions.length, definitions });
      }

      // 12. Timeseries: Daily Statistics (Settlement & OI)
      if (subpath === 'statistics') {
        const dataset = url.searchParams.get('dataset') || 'OPRA.PILLAR';
        const symbols = (url.searchParams.get('symbols') || url.searchParams.get('symbol') || '').split(',').filter(Boolean);
        if (symbols.length === 0) {
          return sendJson(res, 400, { error: "Missing required query parameter 'symbols'" });
        }
        const start = url.searchParams.get('start') || undefined;
        const end = url.searchParams.get('end') || undefined;

        const statistics = await client.getStatistics(dataset, symbols, start, end);
        return sendJson(res, 200, { dataset, symbols, count: statistics.length, statistics });
      }

      // 13. Timeseries: Market Trading Status
      if (subpath === 'status') {
        const dataset = url.searchParams.get('dataset') || 'GLBX.MDP3';
        const symbols = (url.searchParams.get('symbols') || url.searchParams.get('symbol') || 'ES.FUT').split(',');
        const start = url.searchParams.get('start') || undefined;
        const end = url.searchParams.get('end') || undefined;

        const statusRecords = await client.getTradingStatus(dataset, symbols, start, end);
        return sendJson(res, 200, { dataset, symbols, count: statusRecords.length, status: statusRecords });
      }

      // 14. Timeseries: Top of Book on Trade (TBBO)
      if (subpath === 'tbbo') {
        const dataset = url.searchParams.get('dataset') || 'GLBX.MDP3';
        const symbols = (url.searchParams.get('symbols') || url.searchParams.get('symbol') || 'ES.FUT').split(',');
        const start = url.searchParams.get('start') || new Date(Date.now() - 3600000).toISOString();
        const end = url.searchParams.get('end') || undefined;
        const limit = url.searchParams.get('limit') ? Number(url.searchParams.get('limit')) : 500;

        const records = await client.getHistoricalTbbo(dataset, symbols, start, end, limit);
        return sendJson(res, 200, { dataset, symbols, count: records.length, records });
      }

      // 15. Timeseries: Market By Order (MBO Level 3)
      if (subpath === 'mbo') {
        const dataset = url.searchParams.get('dataset') || 'GLBX.MDP3';
        const symbols = (url.searchParams.get('symbols') || url.searchParams.get('symbol') || 'ES.FUT').split(',');
        const start = url.searchParams.get('start') || new Date(Date.now() - 3600000).toISOString();
        const end = url.searchParams.get('end') || undefined;
        const limit = url.searchParams.get('limit') ? Number(url.searchParams.get('limit')) : 500;

        const records = await client.getHistoricalMbo(dataset, symbols, start, end, limit);
        return sendJson(res, 200, { dataset, symbols, count: records.length, records });
      }

      // 16. Timeseries: Auction Imbalances (NOII Crosses)
      if (subpath === 'imbalances') {
        const dataset = url.searchParams.get('dataset') || 'GLBX.MDP3';
        const symbols = (url.searchParams.get('symbols') || url.searchParams.get('symbol') || 'ES.FUT').split(',');
        const start = url.searchParams.get('start') || new Date(Date.now() - 3600000).toISOString();
        const end = url.searchParams.get('end') || undefined;
        const limit = url.searchParams.get('limit') ? Number(url.searchParams.get('limit')) : 500;

        const records = await client.getHistoricalImbalances(dataset, symbols, start, end, limit);
        return sendJson(res, 200, { dataset, symbols, count: records.length, records });
      }

      // 17. Timeseries: Generic timeseries.get_range
      if (subpath === 'timeseries') {
        const dataset = url.searchParams.get('dataset') || 'GLBX.MDP3';
        const schema = url.searchParams.get('schema') || 'trades';
        const symbols = (url.searchParams.get('symbols') || url.searchParams.get('symbol') || 'ES.FUT').split(',');
        const start = url.searchParams.get('start') || new Date(Date.now() - 3600000).toISOString();
        const end = url.searchParams.get('end') || undefined;
        const limit = url.searchParams.get('limit') ? Number(url.searchParams.get('limit')) : 500;
        const stypeIn = url.searchParams.get('stype_in') || undefined;
        const stypeOut = url.searchParams.get('stype_out') || undefined;
        const encoding = url.searchParams.get('encoding') || undefined;

        const records = await client.getTimeseriesRange({ dataset, schema, symbols, start, end, limit, stypeIn, stypeOut, encoding });
        return sendJson(res, 200, { dataset, schema, symbols, count: records.length, records });
      }

      return sendJson(res, 404, { error: `Unknown Databento endpoint: ${subpath}` });
    } catch (err: any) {
      console.error(`[DatabentoRouter] Error handling ${pathname}:`, err);
      return sendJson(res, err.statusCode || 500, {
        error: err.message || 'Internal Databento API error',
        code: err.code || 'DATABENTO_ERROR',
      });
    }
  };
}
