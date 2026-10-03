/**
 * Watchlist quote board.
 *
 * The terminal streams ONE symbol per session (that is what the vendor feeds cost), so a TradingView-style
 * landscape of live prices needs a second, deliberately limited source. This module fetches the last trade
 * per requested root with a hard cap, a TTL cache.
 *
 * Standardized on Databento market data.
 * Off by default (`ENABLE_QUOTE_BOARD=1` to enable): it is metered data, so the operator opts in.
 */
import { resolveDatabentoConfig } from '../databento/config.js';

export interface WatchlistQuote {
  symbol: string;
  price: number;
  ts: number;
  ageMs: number;
  source: 'databento';
  /** True when the cached value is older than the TTL (the vendor did not answer this round). */
  stale: boolean;
}

export interface QuoteBoardOptions {
  symbols: string[];
  apiKey?: string;
  fetchFn?: typeof fetch;
  baseUrl?: string;
  /** TTL override for tests/ops (0 = always refresh). Defaults to QUOTE_BOARD_TTL_MS. */
  ttlMs?: number;
}

interface CacheEntry {
  quote: WatchlistQuote;
  fetchedAt: number;
}

const MAX_SYMBOLS = 8;
const DEFAULT_TTL_MS = 60_000;
const cache = new Map<string, CacheEntry>();

export function quoteBoardEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.ENABLE_QUOTE_BOARD === '1';
}

export function quoteBoardTtlMs(env: NodeJS.ProcessEnv = process.env): number {
  const parsed = parseInt(env.QUOTE_BOARD_TTL_MS || '', 10);
  return Number.isFinite(parsed) && parsed >= 5_000 ? parsed : DEFAULT_TTL_MS;
}

/** Normalise the request: trim, upper-case, de-duplicate, cap. Never throws on junk input. */
export function normaliseQuoteSymbols(input: string | string[] | undefined): string[] {
  const list = Array.isArray(input) ? input : String(input || '').split(',');
  const seen = new Set<string>();
  for (const raw of list) {
    const symbol = String(raw || '').trim().toUpperCase();
    if (!/^[A-Z0-9]{1,6}$/.test(symbol)) continue;
    seen.add(symbol);
  }
  return Array.from(seen).slice(0, MAX_SYMBOLS);
}

function cached(symbol: string, ttlMs: number): CacheEntry | undefined {
  if (ttlMs <= 0) return undefined;
  const entry = cache.get(symbol);
  if (!entry) return undefined;
  return Date.now() - entry.fetchedAt <= ttlMs ? entry : undefined;
}

export function clearQuoteBoardCache(): void {
  cache.clear();
}

/**
 * Last trade per symbol, cached for `QUOTE_BOARD_TTL_MS`. Symbols the vendor does not answer keep their
 * previous value flagged `stale`, or are omitted when there is nothing to show — never invented.
 */
export async function fetchWatchlistQuotes(options: QuoteBoardOptions): Promise<WatchlistQuote[]> {
  const symbols = normaliseQuoteSymbols(options.symbols);
  if (symbols.length === 0) return [];
  const ttlMs = options.ttlMs ?? quoteBoardTtlMs();
  const quotes: WatchlistQuote[] = [];
  const cfg = resolveDatabentoConfig();
  const apiKey = options.apiKey || cfg.apiKey || process.env.DATABENTO_API_KEY;
  const fetcher = options.fetchFn || fetch;
  const baseUrl = options.baseUrl || cfg.histBaseUrl;

  for (const symbol of symbols) {
    const hit = cached(symbol, ttlMs);
    if (hit) {
      quotes.push({ ...hit.quote, ageMs: Date.now() - hit.quote.ts, stale: false });
      continue;
    }

    try {
      const url = new URL('/v0/timeseries.get_range', baseUrl);
      url.searchParams.set('dataset', cfg.equitiesDataset);
      url.searchParams.set('symbols', symbol);
      url.searchParams.set('schema', 'trades');
      url.searchParams.set('limit', '1');

      const headers: Record<string, string> = { Accept: 'application/json' };
      if (apiKey) {
        headers['Authorization'] = `Basic ${Buffer.from(`${apiKey}:`).toString('base64')}`;
      }

      const res = await fetcher(url.toString(), { headers });
      if (!res.ok) {
        throw new Error(`HTTP ${res.status} ${res.statusText}`);
      }

      const json: any = await res.json();
      // Databento JSON records or standard trade response
      const records = Array.isArray(json) ? json : json.data || json.result || [];
      const last = records[records.length - 1];

      if (last) {
        // Databento trades schema: price is fixed-point 1e9 or float, ts_event is nanoseconds or string
        const price = typeof last.price === 'number'
          ? (last.price > 1e6 ? last.price / 1e9 : last.price)
          : parseFloat(last.price);
        const ts = last.ts_event
          ? Math.floor(Number(last.ts_event) / 1e6)
          : (last.executed_at ? new Date(last.executed_at).getTime() : Date.now());

        if (Number.isFinite(price) && price > 0) {
          const quote: WatchlistQuote = {
            symbol,
            price,
            ts,
            ageMs: Date.now() - ts,
            source: 'databento',
            stale: false,
          };
          cache.set(symbol, { quote, fetchedAt: Date.now() });
          quotes.push(quote);
          continue;
        }
      }
    } catch (err) {
      console.warn(`[QuoteBoard:databento] ${symbol}: ${(err as Error).message}`);
    }

    const previous = cache.get(symbol);
    if (previous) {
      quotes.push({ ...previous.quote, ageMs: Date.now() - previous.quote.ts, stale: true });
    }
  }

  return quotes;
}
