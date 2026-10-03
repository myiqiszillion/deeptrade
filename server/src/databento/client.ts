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

export interface DatabentoClientOptions {
  apiKey?: string;
  baseUrl?: string;
  fetchFn?: typeof fetch;
  timeoutMs?: number;
}

export class DatabentoHttpClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly fetchFn: typeof fetch;
  private readonly timeoutMs: number;

  constructor(options: DatabentoClientOptions = {}) {
    const cfg = resolveDatabentoConfig();
    this.apiKey = options.apiKey || process.env.DATABENTO_API_KEY || '';
    this.baseUrl = (options.baseUrl || process.env.DATABENTO_HIST_URL || cfg.histBaseUrl).replace(/\/+$/, '');
    this.fetchFn = options.fetchFn || globalThis.fetch;
    this.timeoutMs = options.timeoutMs ?? cfg.timeoutMs;
  }

  public get configured(): boolean {
    return Boolean(this.apiKey && this.apiKey.trim().length > 0);
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
          const availableEnd = match[1];
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

    const contentType = res.headers.get('content-type') || '';
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
    limit?: number
  ): Promise<NormalizedTrade[]> {
    const rawRecords = await this.request<DbTradeRecord>('/timeseries.get_range', {
      dataset,
      symbols: Array.isArray(symbols) ? symbols.join(',') : symbols,
      schema: 'trades',
      start: this.formatTimeArg(start),
      end: this.formatTimeArg(end),
      limit,
    });

    return rawRecords.map((r) => normalizeTrade(r));
  }

  /**
   * Fetches top-of-book (MBP-1) quotes.
   */
  public async getHistoricalQuotes(
    dataset: string,
    symbols: string | string[],
    start: number | string | Date,
    end?: number | string | Date,
    limit?: number
  ): Promise<NormalizedQuote[]> {
    const rawRecords = await this.request<DbMbp1Record>('/timeseries.get_range', {
      dataset,
      symbols: Array.isArray(symbols) ? symbols.join(',') : symbols,
      schema: 'mbp-1',
      start: this.formatTimeArg(start),
      end: this.formatTimeArg(end),
      limit,
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
}
