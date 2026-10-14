/**
 * Databento Historical HTTP Client
 *
 * Provides typed access to Databento's REST APIs:
 * - timeseries.get_range (OHLCV-1s/1m/1h/1d, trades, mbp-1, statistics, definition)
 * - symbology.resolve
 *
 * Implements resilient Basic Auth, parameter encoding, and parsing of both JSON array
 * and newline-delimited JSON (NDJSON) streaming payloads.
 */

import { HistoricalBar } from '../types.js';
import {
  DbOhlcvRecord,
  DbTradeRecord,
  DbMbp1Record,
  DbDefinitionRecord,
  DbStatisticsRecord,
  NormalizedTrade,
  NormalizedQuote,
  OptionContractDefinition,
  OptionStatisticRecord,
  DatasetRange,
  SymbologyResolveResult,
  TradingStatusRecord,
  DbPublisherRecord,
  DbUnitPriceRecord,
  DatasetConditionRecord,
  DbMboRecord,
  DbTbboRecord,
  DbImbalanceRecord,
} from './types.js';
import {
  normalizeTrade,
  normalizeQuote,
  normalizeDefinition,
  normalizeStatistic,
  parsePrice,
  parseTimestampMs,
} from './normalizer.js';
import { resolveDatabentoConfig } from './config.js';
import { DatabentoDecodeError, DatabentoNotConfiguredError, errorForStatus } from './errors.js';

interface DatabentoClientOptions {
  requestsEnabled?: boolean;
  apiKey?: string;
  baseUrl?: string;
  fetchFn?: typeof fetch;
  timeoutMs?: number;
}

export class DatabentoHttpClient {
  public readonly sourceKind: 'LOCAL_FIXTURE' | 'VENDOR_HISTORICAL';
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly fetchFn: typeof fetch;
  private readonly timeoutMs: number;
  private readonly requestsEnabled: boolean;

  constructor(options: DatabentoClientOptions = {}) {
    if ((globalThis as any)[Symbol.for('deepchart.offline.guard')] &&
        (options.apiKey || process.env.DATABENTO_API_KEY) && !options.fetchFn) {
      (globalThis as any)[Symbol.for('deepchart.offline.guard')].fail('credentialed HTTP provider requires mock fetch');
    }
    const cfg = resolveDatabentoConfig();
    this.sourceKind=options.fetchFn?'LOCAL_FIXTURE':'VENDOR_HISTORICAL';
    this.requestsEnabled = options.requestsEnabled !== false;
    this.apiKey = options.apiKey || process.env.DATABENTO_API_KEY || '';
    this.baseUrl = (options.baseUrl || process.env.DATABENTO_HIST_URL || cfg.histBaseUrl).replace(/\/+$/, '');
    this.fetchFn = options.fetchFn || globalThis.fetch;
    this.timeoutMs = options.timeoutMs ?? cfg.timeoutMs;
  }

  public get configured(): boolean {
    return this.requestsEnabled && Boolean(this.apiKey && this.apiKey.trim().length > 0);
  }

  /**
   * Helper to format time arguments (Date, epoch ms, ISO string, or nanosecond string)
   * into ISO string or nanosecond integer required by Databento.
   */
  private formatTimeArg(val: number | string | Date | undefined): string | undefined {
    if (val === undefined || val === null || val === '') return undefined;
    if (val instanceof Date) return val.toISOString();
    if (typeof val === 'number') {
      // If epoch milliseconds (< 1e13), convert to ISO string
      if (val < 1e13) {
        return new Date(val).toISOString();
      }
      return String(val);
    }
    return String(val);
  }

  /**
   * Internal request handler with Basic Auth, timeout, and typed errors.
   */
  public async request<T = any>(endpoint: string, params: Record<string, any> = {}, opts?: { signal?: AbortSignal; dataset?: string }): Promise<T[]> {
    if (!this.configured) {
      throw new DatabentoNotConfiguredError();
    }

    const url = new URL(`${this.baseUrl}${endpoint.startsWith('/') ? '' : '/'}${endpoint}`);
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== null && value !== '') {
        if (Array.isArray(value)) {
          url.searchParams.append(key, value.join(','));
        } else {
          url.searchParams.append(key, String(value));
        }
      }
    }

    if (!url.searchParams.has('encoding')) {
      url.searchParams.append('encoding', 'json');
    }

    const authHeader = 'Basic ' + Buffer.from(`${this.apiKey}:`).toString('base64');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    const signal = opts?.signal ? AbortSignal.any([opts.signal, controller.signal]) : controller.signal;

    let res: Response;
    try {
      res = await this.fetchFn(url.toString(), {
        method: 'GET',
        headers: {
          Authorization: authHeader,
          Accept: 'application/json, application/x-ndjson, text/plain',
        },
        signal,
      } as any);
    } catch (err: any) {
      clearTimeout(timer);
      if (err?.name === 'AbortError') throw new DatabentoDecodeError(`Databento request timed out after ${this.timeoutMs}ms`);
      throw err;
    }
    clearTimeout(timer);

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      if (res.status === 422 && errText.includes('data_end_after_available_end')) {
        const match = errText.match(/available up to '([^']+)'/);
        if (match && !(opts as any)?.retried) {
          const availableEnd = new Date(match[1]).toISOString();
          const updatedParams: Record<string, any> = { ...params, end: availableEnd };
          if (params.start && new Date(params.start).getTime() >= new Date(availableEnd).getTime()) {
            const spanMs = (params.limit ? Number(params.limit) * 60_000 : 3600_000) * 2;
            updatedParams.start = new Date(new Date(availableEnd).getTime() - spanMs).toISOString();
          }
          console.log(`[DatabentoClient] Auto-adjusting window to dataset available end: ${availableEnd}`);
          return this.request<T>(endpoint, updatedParams, { ...opts, retried: true } as any);
        }
      }
      throw errorForStatus(res.status, errText.slice(0, 500), opts?.dataset || String(params.dataset || ''));
    }

    const bodyText = await res.text();

    if (!bodyText || !bodyText.trim()) {
      return [];
    }

    // Try parsing as standard JSON
    try {
      const parsed = JSON.parse(bodyText);
      if (Array.isArray(parsed)) {
        return parsed as T[];
      }
      if (parsed && Array.isArray((parsed as any).result)) {
        return (parsed as any).result as T[];
      }
      if (parsed && Array.isArray((parsed as any).data)) {
        return (parsed as any).data as T[];
      }
      return [parsed as T];
    } catch {
      // Fallback: parse newline-delimited JSON (NDJSON)
      const lines = bodyText.split('\n').map((l) => l.trim()).filter(Boolean);
      const results: T[] = [];
      for (const line of lines) {
        try {
          results.push(JSON.parse(line));
        } catch {
          // ignore corrupted lines
        }
      }
      if (results.length === 0) throw new DatabentoDecodeError('Failed to decode Databento response (invalid JSON/NDJSON)');
      return results;
    }
  }

  /**
   * Fetches historical OHLCV aggregate bars.
   */
  public async getHistoricalBars(
    dataset: string,
    symbols: string | string[],
    schema: 'ohlcv-1s' | 'ohlcv-1m' | 'ohlcv-1h' | 'ohlcv-1d',
    start: number | string | Date,
    end?: number | string | Date,
    limit?: number,
    stypeIn?: string
  ): Promise<HistoricalBar[]> {
    const rawRecords = await this.request<DbOhlcvRecord>('/timeseries.get_range', {
      dataset,
      symbols: Array.isArray(symbols) ? symbols.join(',') : symbols,
      schema,
      start: this.formatTimeArg(start),
      end: this.formatTimeArg(end),
      limit,
      stype_in: stypeIn,
    });

    return rawRecords.map((r) => {
      const ts = r.ts_event ?? r.hd?.ts_event;
      return {
        time: parseTimestampMs(ts),
        open: parsePrice(r.open),
        high: parsePrice(r.high),
        low: parsePrice(r.low),
        close: parsePrice(r.close),
        volume: Number(r.volume || 0),
      };
    });
  }

  /**
   * Fetches historical trades.
   */
  public async getHistoricalTrades(
    dataset: string,
    symbols: string | string[],
    start: number | string | Date,
    end?: number | string | Date,
    limit?: number,
    stypeIn?: string
  ): Promise<NormalizedTrade[]> {
    const rawRecords = await this.request<DbTradeRecord>('/timeseries.get_range', {
      dataset,
      symbols: Array.isArray(symbols) ? symbols.join(',') : symbols,
      schema: 'trades',
      start: this.formatTimeArg(start),
      end: this.formatTimeArg(end),
      limit,
      stype_in: stypeIn,
    });

    return rawRecords.map((r) => normalizeTrade(r, dataset));
  }

  /**
   * Fetches top-of-book (MBP-1) quotes.
   */
  public async getHistoricalQuotes(
    dataset: string,
    symbols: string | string[],
    start: number | string | Date,
    end?: number | string | Date,
    limit?: number,
    stypeIn?: string
  ): Promise<NormalizedQuote[]> {
    const rawRecords = await this.request<DbMbp1Record>('/timeseries.get_range', {
      dataset,
      symbols: Array.isArray(symbols) ? symbols.join(',') : symbols,
      schema: 'mbp-1',
      start: this.formatTimeArg(start),
      end: this.formatTimeArg(end),
      limit,
      stype_in: stypeIn,
    });

    return rawRecords.map((r) => normalizeQuote(r));
  }

  /**
   * Fetches option definitions (strikes, expirations, multipliers) for an underlying.
   */
  public async getOptionDefinitions(
    dataset: string = 'OPRA.PILLAR',
    underlying?: string,
    start?: number | string | Date,
    end?: number | string | Date
  ): Promise<OptionContractDefinition[]> {
    const params: Record<string, any> = {
      dataset,
      schema: 'definition',
      start: this.formatTimeArg(start) || new Date(Date.now() - 24 * 3600 * 1000).toISOString(),
    };
    if (end) {
      params.end = this.formatTimeArg(end);
    }
    if (underlying) {
      // Parent symbology for OPRA: try parent first, fallback to underlying alone if rejected
      const u = underlying.toUpperCase().trim();
      params.symbols = u.includes('.') ? u : `${u}.OPT`;
      if (params.symbols.endsWith('.OPT') || dataset.startsWith('OPRA')) {
        params.stype_in = 'parent';
      }
    }

    const rawRecords = await this.request<DbDefinitionRecord>('/timeseries.get_range', params);
    return rawRecords
      .filter((r) => r.instrument_class === 'O' || r.raw_symbol?.match(/[CP]\d{8}$/))
      .map((r) => normalizeDefinition(r));
  }

  /**
   * Fetches daily statistics (Open Interest, Settlement Price, Cleared Volume).
   */
  public async getStatistics(
    dataset: string,
    symbols: string | string[],
    start?: number | string | Date,
    end?: number | string | Date
  ): Promise<OptionStatisticRecord[]> {
    const rawRecords = await this.request<DbStatisticsRecord>('/timeseries.get_range', {
      dataset,
      symbols: Array.isArray(symbols) ? symbols.join(',') : symbols,
      schema: 'statistics',
      start: this.formatTimeArg(start) || new Date(Date.now() - 24 * 3600 * 1000).toISOString(),
      end: this.formatTimeArg(end),
    });

    return rawRecords.map((r) => normalizeStatistic(r));
  }

  /**
   * Lists all publisher ID mappings, venues, and associated datasets.
   */
  public async listPublishers(): Promise<DbPublisherRecord[]> {
    return this.request<DbPublisherRecord>('/metadata.list_publishers');
  }

  /**
   * Lists all available datasets from Databento.
   */
  public async listDatasets(): Promise<string[]> {
    const res = await this.request<any>('/metadata.list_datasets');
    if (Array.isArray(res) && typeof res[0] === 'string') return res;
    if (Array.isArray(res) && res[0]?.dataset) return res.map((r: any) => r.dataset);
    return res as any;
  }

  /**
   * Lists available schemas for a given dataset.
   */
  public async listSchemas(dataset: string): Promise<string[]> {
    const res = await this.request<string>('/metadata.list_schemas', { dataset });
    return res;
  }

  /**
   * Lists fields for a dataset and schema.
   */
  public async listFields(dataset: string, schema: string, encoding?: string): Promise<any[]> {
    return this.request('/metadata.list_fields', { dataset, schema, encoding });
  }

  /**
   * Lists unit prices ($/GB) for a dataset across feed modes.
   */
  public async listUnitPrices(dataset: string, mode?: string): Promise<DbUnitPriceRecord[]> {
    return this.request<DbUnitPriceRecord>('/metadata.list_unit_prices', { dataset, mode });
  }

  /**
   * Gets operational data availability and condition per date.
   */
  public async getDatasetCondition(
    dataset: string,
    startDate?: number | string | Date,
    endDate?: number | string | Date
  ): Promise<DatasetConditionRecord[]> {
    return this.request<DatasetConditionRecord>('/metadata.get_dataset_condition', {
      dataset,
      start_date: this.formatTimeArg(startDate),
      end_date: this.formatTimeArg(endDate),
    });
  }

  /**
   * Gets available time range (start and end) for a dataset.
   */
  public async getDatasetRange(dataset: string): Promise<DatasetRange> {
    const res = await this.request<any>('/metadata.get_dataset_range', { dataset });
    const r = res[0] || res;
    return {
      start: r.start || r.start_date || '',
      end: r.end || r.end_date || '',
    };
  }

  /**
   * Queries expected record count for a timeseries query before execution.
   */
  public async getRecordCount(params: {
    dataset: string;
    schema: string;
    symbols: string | string[];
    start: number | string | Date;
    end?: number | string | Date;
    stypeIn?: string;
    limit?: number;
  }): Promise<number> {
    const res = await this.request<any>('/metadata.get_record_count', {
      dataset: params.dataset,
      schema: params.schema,
      symbols: Array.isArray(params.symbols) ? params.symbols.join(',') : params.symbols,
      start: this.formatTimeArg(params.start),
      end: this.formatTimeArg(params.end),
      stype_in: params.stypeIn,
      limit: params.limit,
    });
    const r = res[0] || res;
    return typeof r === 'number' ? r : Number(r.record_count ?? r.count ?? 0);
  }

  /**
   * Queries expected billable uncompressed byte size before execution.
   */
  public async getBillableSize(params: {
    dataset: string;
    schema: string;
    symbols: string | string[];
    start: number | string | Date;
    end?: number | string | Date;
    stypeIn?: string;
    limit?: number;
  }): Promise<number> {
    const res = await this.request<any>('/metadata.get_billable_size', {
      dataset: params.dataset,
      schema: params.schema,
      symbols: Array.isArray(params.symbols) ? params.symbols.join(',') : params.symbols,
      start: this.formatTimeArg(params.start),
      end: this.formatTimeArg(params.end),
      stype_in: params.stypeIn,
      limit: params.limit,
    });
    const r = res[0] || res;
    return typeof r === 'number' ? r : Number(r.billable_size ?? r.size_bytes ?? r.size ?? 0);
  }

  /**
   * Estimates cost and record count before issuing a historical query.
   */
  public async getCost(
    dataset: string,
    schema: string,
    symbols: string | string[],
    start: number | string | Date,
    end?: number | string | Date,
    stypeIn?: string
  ): Promise<{ costUsd: number; sizeBytes: number; recordCount: number }> {
    const res = await this.request<any>('/metadata.get_cost', {
      dataset,
      schema,
      symbols: Array.isArray(symbols) ? symbols.join(',') : symbols,
      start: this.formatTimeArg(start),
      end: this.formatTimeArg(end),
      stype_in: stypeIn,
    });
    const r = res[0] || res;
    return {
      costUsd: Number(r.cost_usd ?? r.cost ?? 0),
      sizeBytes: Number(r.size_bytes ?? r.size ?? 0),
      recordCount: Number(r.record_count ?? r.count ?? 0),
    };
  }

  /**
   * Resolves symbols between different symbology types (raw_symbol, instrument_id, parent).
   */
  public async resolveSymbology(
    dataset: string,
    symbols: string | string[],
    stypeIn = 'raw_symbol',
    stypeOut = 'instrument_id',
    startDate?: number | string | Date,
    endDate?: number | string | Date
  ): Promise<SymbologyResolveResult> {
    const res = await this.request<any>('/symbology.resolve', {
      dataset,
      symbols: Array.isArray(symbols) ? symbols.join(',') : symbols,
      stype_in: stypeIn,
      stype_out: stypeOut,
      start_date: this.formatTimeArg(startDate) || new Date(Date.now() - 3 * 86400000).toISOString().slice(0, 10),
      end_date: this.formatTimeArg(endDate),
    });
    return res[0] || res;
  }

  /**
   * Fetches 10-level Market By Price (MBP-10) historical depth records.
   */
  public async getHistoricalDepth(
    dataset: string,
    symbols: string | string[],
    start: number | string | Date,
    end?: number | string | Date,
    limit?: number,
    stypeIn?: string
  ): Promise<any[]> {
    return this.request('/timeseries.get_range', {
      dataset,
      symbols: Array.isArray(symbols) ? symbols.join(',') : symbols,
      schema: 'mbp-10',
      start: this.formatTimeArg(start),
      end: this.formatTimeArg(end),
      limit,
      stype_in: stypeIn,
    });
  }

  /**
   * Fetches trading status events (trading, halted, paused, closed).
   */
  public async getTradingStatus(
    dataset: string,
    symbols: string | string[],
    start?: number | string | Date,
    end?: number | string | Date
  ): Promise<TradingStatusRecord[]> {
    const res = await this.request<any>('/timeseries.get_range', {
      dataset,
      symbols: Array.isArray(symbols) ? symbols.join(',') : symbols,
      schema: 'status',
      start: this.formatTimeArg(start) || new Date(Date.now() - 24 * 3600 * 1000).toISOString(),
      end: this.formatTimeArg(end),
    });
    return res.map((r) => ({
      symbol: r.symbol || r.raw_symbol || '',
      timestamp: parseTimestampMs(r.ts_event ?? r.hd?.ts_event),
      status: r.status || r.action || 'unknown',
      reason: r.reason,
      tradingEvent: r.trading_event,
    }));
  }

  /**
   * Fetches Top of Book on Trade (TBBO) records.
   */
  public async getHistoricalTbbo(
    dataset: string,
    symbols: string | string[],
    start: number | string | Date,
    end?: number | string | Date,
    limit?: number
  ): Promise<DbTbboRecord[]> {
    return this.request<DbTbboRecord>('/timeseries.get_range', {
      dataset,
      symbols: Array.isArray(symbols) ? symbols.join(',') : symbols,
      schema: 'tbbo',
      start: this.formatTimeArg(start),
      end: this.formatTimeArg(end),
      limit,
    });
  }

  /**
   * Fetches Market By Order (MBO Level 3) full order book event records.
   */
  public async getHistoricalMbo(
    dataset: string,
    symbols: string | string[],
    start: number | string | Date,
    end?: number | string | Date,
    limit?: number
  ): Promise<DbMboRecord[]> {
    return this.request<DbMboRecord>('/timeseries.get_range', {
      dataset,
      symbols: Array.isArray(symbols) ? symbols.join(',') : symbols,
      schema: 'mbo',
      start: this.formatTimeArg(start),
      end: this.formatTimeArg(end),
      limit,
    });
  }

  /**
   * Fetches auction order imbalance events (NOII crosses: opening, closing, halt).
   */
  public async getHistoricalImbalances(
    dataset: string,
    symbols: string | string[],
    start: number | string | Date,
    end?: number | string | Date,
    limit?: number
  ): Promise<DbImbalanceRecord[]> {
    return this.request<DbImbalanceRecord>('/timeseries.get_range', {
      dataset,
      symbols: Array.isArray(symbols) ? symbols.join(',') : symbols,
      schema: 'imbalance',
      start: this.formatTimeArg(start),
      end: this.formatTimeArg(end),
      limit,
    });
  }

  /**
   * Generic timeseries query for any schema and parameter combination.
   */
  public async getTimeseriesRange<T = any>(params: {
    dataset: string;
    schema: string;
    symbols: string | string[];
    start: number | string | Date;
    end?: number | string | Date;
    limit?: number;
    stypeIn?: string;
    stypeOut?: string;
    encoding?: string;
  }): Promise<T[]> {
    return this.request<T>('/timeseries.get_range', {
      dataset: params.dataset,
      schema: params.schema,
      symbols: Array.isArray(params.symbols) ? params.symbols.join(',') : params.symbols,
      start: this.formatTimeArg(params.start),
      end: this.formatTimeArg(params.end),
      limit: params.limit,
      stype_in: params.stypeIn,
      stype_out: params.stypeOut,
      encoding: params.encoding,
    });
  }
}
