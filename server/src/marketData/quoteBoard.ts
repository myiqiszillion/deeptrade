import { fetchDatabentoTrades } from './databentoHistory.js';

/**
 * Watchlist quote board.
 *
 * The terminal streams ONE symbol per session (that is what the vendor feeds cost), so a TradingView-style
 * landscape of live prices needs a second, deliberately limited source. This module fetches the last trade
 * per requested root with a hard cap, a TTL cache and the same spend guard as every other paid call — a
 * watchlist pull must never turn into a surprise bill.
 *
 * Off by default (`ENABLE_QUOTE_BOARD=1` to enable): it is metered data, so the operator opts in.
 */
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
  // ttlMs <= 0 means "always refresh" (tests + operator override): never serve from cache.
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

  for (const symbol of symbols) {
    const hit = cached(symbol, ttlMs);
    if (hit) {
      quotes.push({ ...hit.quote, ageMs: Date.now() - hit.quote.ts, stale: false });
      continue;
    }

    try {
      const trades = await fetchDatabentoTrades(
        symbol,
        { apiKey: options.apiKey, dataset: process.env.DATABENTO_DATASET, stypeIn: process.env.DATABENTO_STYPE_IN },
        { limit: 1, fetchFn: options.fetchFn, baseUrl: options.baseUrl }
      );
      const last = trades[trades.length - 1];
      if (last && Number.isFinite(last.price) && last.price > 0) {
        const quote: WatchlistQuote = {
          symbol,
          price: last.price,
          ts: last.timestamp,
          ageMs: Date.now() - last.timestamp,
          source: 'databento',
          stale: false,
        };
        cache.set(symbol, { quote, fetchedAt: Date.now() });
        quotes.push(quote);
        continue;
      }
    } catch (err) {
      console.warn(`[QuoteBoard] ${symbol}: ${(err as Error).message}`);
    }

    const previous = cache.get(symbol);
    if (previous) {
      quotes.push({ ...previous.quote, ageMs: Date.now() - previous.quote.ts, stale: true });
    }
  }

  return quotes;
}
