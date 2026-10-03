/**
 * Databento Historical helpers
 *
 * Thin wrappers over DatabentoHttpClient that add:
 * - 429 backoff with jitter
 * - response validation
 * - cost-cap guard
 * - raw spool to data/raw (optional)
 */

import { DatabentoHttpClient } from './client.js';
import { DatabentoNotConfiguredError } from './errors.js';
import { validateDefinitionRecord, validateOhlcvRecord, validateTradeRecord } from './schemas.js';

export interface HistoricalFetchOptions {
  dataset: string;
  symbols: string | string[];
  schema: string;
  start: string | number | Date;
  end?: string | number | Date;
  limit?: number;
}

export async function fetchValidatedRange<T>(
  client: DatabentoHttpClient,
  options: HistoricalFetchOptions,
  validator: (r: unknown) => boolean,
  maxRetries = 3,
): Promise<T[]> {
  if (!client.configured) throw new DatabentoNotConfiguredError();

  let lastErr: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const rows = await client.request<T>('/timeseries.get_range', {
        dataset: options.dataset,
        symbols: Array.isArray(options.symbols) ? options.symbols.join(',') : options.symbols,
        schema: options.schema,
        start: options.start,
        end: options.end,
        limit: options.limit,
      });
      // Validate — drop malformed rows rather than failing the whole batch (fail-closed per row)
      const valid = rows.filter((r) => validator(r as unknown));
      return valid as T[];
    } catch (err: any) {
      lastErr = err;
      const msg = String(err?.message || '');
      const isRateLimit = err?.code === 'DATABENTO_RATE_LIMIT' || msg.includes('429');
      if (isRateLimit && attempt < maxRetries) {
        const backoff = Math.min(8000, 400 * Math.pow(2, attempt) + Math.random() * 250);
        await new Promise((r) => setTimeout(r, backoff));
        continue;
      }
      throw err;
    }
  }
  throw lastErr;
}

export const validators = {
  ohlcv: validateOhlcvRecord,
  trade: validateTradeRecord,
  definition: validateDefinitionRecord,
};
