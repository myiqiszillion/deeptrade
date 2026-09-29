import { HistoricalBar, Tick } from '../types.js';
import { DBN_CONSTANTS } from './databentoTransport.js';
import { DATABENTO_SYMBOL_MAP } from './databentoAdapter.js';

export interface DatabentoHistoryOptions {
  barMinutes?: number;
  elements?: number;
  beforeTime?: number;
  signal?: AbortSignal;
  fetchFn?: typeof fetch;
  baseUrl?: string;
}

export interface DatabentoTradesOptions {
  limit?: number;
  beforeTime?: number;
  startTime?: number;
  signal?: AbortSignal;
  fetchFn?: typeof fetch;
  baseUrl?: string;
}

export function aggregateBars(bars: HistoricalBar[], barMinutes: number): HistoricalBar[] {
  if (barMinutes <= 1 || bars.length === 0) return bars;
  const bucketMs = barMinutes * 60 * 1000;
  const buckets = new Map<number, HistoricalBar>();

  for (const b of bars) {
    const bucketTime = Math.floor(b.time / bucketMs) * bucketMs;
    const existing = buckets.get(bucketTime);
    if (!existing) {
      buckets.set(bucketTime, {
        time: bucketTime,
        open: b.open,
        high: b.high,
        low: b.low,
        close: b.close,
        volume: b.volume,
        buyVolume: b.buyVolume,
        sellVolume: b.sellVolume,
        sourceProvider: b.sourceProvider,
      });
    } else {
      existing.high = Math.max(existing.high, b.high);
      existing.low = Math.min(existing.low, b.low);
      existing.close = b.close;
      existing.volume += b.volume;
      if (b.buyVolume !== undefined) existing.buyVolume = (existing.buyVolume || 0) + b.buyVolume;
      if (b.sellVolume !== undefined) existing.sellVolume = (existing.sellVolume || 0) + b.sellVolume;
    }
  }

  return Array.from(buckets.values()).sort((a, b) => a.time - b.time);
}

/**
 * Computes the effective latest session end time for CME Globex futures.
 * CME Globex equity / commodity futures close Friday at 21:00 UTC (16:00 CT)
 * and reopen Sunday at 22:00 UTC (17:00 CT).
 * If target time falls inside the weekend closure, this maps back to Friday 21:00 UTC.
 */
export function getCmeLatestSessionEnd(targetMs: number = Date.now(), fallbackSafetyMargin = false): number {
  const d = new Date(targetMs);
  const day = d.getUTCDay(); // 0 = Sun, 1 = Mon, ..., 5 = Fri, 6 = Sat
  const hour = d.getUTCHours();

  if (day === 6 || (day === 0 && hour < 22) || (day === 5 && hour >= 21)) {
    const diffDays = day === 6 ? 1 : day === 0 ? 2 : 0;
    const friday = new Date(d);
    friday.setUTCDate(d.getUTCDate() - diffDays);
    friday.setUTCHours(21, 0, 0, 0);
    return friday.getTime();
  }

  return fallbackSafetyMargin ? targetMs - 15 * 60 * 1000 : targetMs;
}

function parseDatabentoLines(lines: string[], seenTimes: Set<number>, bars: HistoricalBar[]): void {
  for (const line of lines) {
    try {
      const item = JSON.parse(line);
      if (!item.hd?.ts_event) continue;

      const tsEventNs = BigInt(item.hd.ts_event);
      const time = Number(tsEventNs / 1_000_000n);

      const rawOpen = BigInt(item.open);
      const rawHigh = BigInt(item.high);
      const rawLow = BigInt(item.low);
      const rawClose = BigInt(item.close);

      if (
        rawOpen === DBN_CONSTANTS.UNDEF_PRICE ||
        rawHigh === DBN_CONSTANTS.UNDEF_PRICE ||
        rawLow === DBN_CONSTANTS.UNDEF_PRICE ||
        rawClose === DBN_CONSTANTS.UNDEF_PRICE
      ) {
        continue;
      }

      const open = Number(rawOpen) / 1e9;
      const high = Number(rawHigh) / 1e9;
      const low = Number(rawLow) / 1e9;
      const close = Number(rawClose) / 1e9;
      const volume = Number(BigInt(item.volume || 0));

      if (time <= 0 || open <= 0 || high <= 0 || low <= 0 || close <= 0 || high < low) {
        continue;
      }

      if (seenTimes.has(time)) continue;
      seenTimes.add(time);

      bars.push({
        time,
        open,
        high,
        low,
        close,
        volume,
        sourceProvider: 'databento',
      });
    } catch {
      // Skip malformed record
    }
  }
}

function resolveQuerySymbol(symbol: string, stypeIn?: string): { querySymbol: string; queryStypeIn: string } {
  let querySymbol = symbol;
  let queryStypeIn = stypeIn || process.env.DATABENTO_STYPE_IN || 'continuous';

  if (querySymbol.endsWith('.FUT')) {
    querySymbol = querySymbol.replace(/\.FUT$/i, '.c.0');
    queryStypeIn = 'continuous';
  } else if (querySymbol.includes('.c.') || querySymbol.includes('.v.')) {
    queryStypeIn = 'continuous';
  } else if (DATABENTO_SYMBOL_MAP[querySymbol]) {
    querySymbol = DATABENTO_SYMBOL_MAP[querySymbol];
    queryStypeIn = 'continuous';
  } else if (queryStypeIn === 'continuous' && !querySymbol.includes('.')) {
    querySymbol = `${querySymbol}.c.0`;
  }

  return { querySymbol, queryStypeIn };
}

export async function fetchDatabentoDatasetRange(
  dataset: string,
  apiKey: string,
  fetchFn: typeof fetch = fetch,
  baseUrl = 'https://hist.databento.com'
): Promise<{ start?: string; end?: string } | null> {
  try {
    const authHeader = 'Basic ' + Buffer.from(`${apiKey}:`).toString('base64');
    const res = await fetchFn(`${baseUrl}/v0/metadata.get_dataset_range?dataset=${encodeURIComponent(dataset)}`, {
      headers: { Authorization: authHeader, Accept: 'application/json' },
    });
    if (res.ok) {
      return (await res.json()) as { start?: string; end?: string };
    }
  } catch {}
  return null;
}

let cachedDatasetRange: { end: string; ts: number } | null = null;

export async function getAvailableDatasetEnd(
  dataset: string,
  apiKey: string,
  fetchFn: typeof fetch = fetch,
  baseUrl = 'https://hist.databento.com'
): Promise<number | null> {
  const now = Date.now();
  if (cachedDatasetRange && now - cachedDatasetRange.ts < 60_000) {
    const parsed = new Date(cachedDatasetRange.end).getTime();
    if (!isNaN(parsed) && parsed > 0) return parsed;
  }
  try {
    const range = await fetchDatabentoDatasetRange(dataset, apiKey, fetchFn, baseUrl);
    if (range?.end) {
      cachedDatasetRange = { end: range.end, ts: now };
      const parsed = new Date(range.end).getTime();
      if (!isNaN(parsed) && parsed > 0) return parsed;
    }
  } catch {}
  return null;
}

export async function fetchDatabentoBars(
  symbol: string,
  config: { apiKey?: string; dataset?: string; stypeIn?: string },
  options: DatabentoHistoryOptions = {}
): Promise<HistoricalBar[]> {
  const apiKey = config.apiKey || process.env.DATABENTO_API_KEY;
  if (!apiKey) return [];

  const dataset = config.dataset || process.env.DATABENTO_DATASET || 'GLBX.MDP3';
  const { querySymbol, queryStypeIn } = resolveQuerySymbol(symbol, config.stypeIn);

  const barMinutes = options.barMinutes || 1;
  const elements = Math.min(options.elements || 500, 1000);

  let schema = 'ohlcv-1m';
  if (barMinutes >= 1440) schema = 'ohlcv-1d';
  else if (barMinutes >= 60) schema = 'ohlcv-1h';

  const baseUrl = options.baseUrl || 'https://hist.databento.com';
  const fetchFn = options.fetchFn || fetch;

  const now = Date.now();
  const rawEndMs = options.beforeTime && options.beforeTime > 0 ? options.beforeTime : now;
  const availEndMs = await getAvailableDatasetEnd(dataset, apiKey, fetchFn, baseUrl);
  const maxSafeEnd = availEndMs ?? (now - 15 * 60 * 1000);
  const endMs = Math.min(getCmeLatestSessionEnd(rawEndMs, false), maxSafeEnd);
  const startMs = endMs - elements * Math.max(barMinutes, 1) * 60 * 1000 * 2;

  const startIso = new Date(startMs).toISOString();
  const endIso = new Date(endMs).toISOString();

  const buildUrl = (sSym: string, start: string, end: string) =>
    `${baseUrl}/v0/timeseries.get_range?` +
    new URLSearchParams({
      dataset,
      symbols: sSym,
      stype_in: queryStypeIn,
      schema,
      start,
      end,
      encoding: 'json',
      limit: String(elements * 2),
    }).toString();

  const authHeader = 'Basic ' + Buffer.from(`${apiKey}:`).toString('base64');

  try {
    let res = await fetchFn(buildUrl(querySymbol, startIso, endIso), {
      headers: {
        Authorization: authHeader,
        Accept: 'application/json',
      },
      signal: options.signal,
    });

    if (res.status === 422) {
      const errText = await res.text().catch(() => '');
      try {
        const errJson = JSON.parse(errText);
        const availableEnd = errJson?.detail?.payload?.available_end;
        if (availableEnd) {
          const availMs = new Date(availableEnd).getTime();
          cachedDatasetRange = { end: availableEnd, ts: Date.now() };
          const retryEndMs = availMs;
          const retryStartMs = retryEndMs - elements * Math.max(barMinutes, 1) * 60 * 1000 * 2;
          res = await fetchFn(
            buildUrl(querySymbol, new Date(retryStartMs).toISOString(), new Date(retryEndMs).toISOString()),
            {
              headers: {
                Authorization: authHeader,
                Accept: 'application/json',
              },
              signal: options.signal,
            }
          );
        }
      } catch {
        // Non-JSON 422
      }
    }

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      console.warn(`[History:databento] ${symbol}: HTTP ${res.status} ${errText}`);
      return [];
    }

    const text = await res.text();
    const lines = text.split('\n').filter((l) => l.trim().length > 0);
    const bars: HistoricalBar[] = [];
    const seenTimes = new Set<number>();

    parseDatabentoLines(lines, seenTimes, bars);

    // Fallback: If 0 bars found and symbol is calendar continuous (.c.0), attempt volume continuous (.v.0)
    if (bars.length === 0 && querySymbol.includes('.c.0')) {
      const vSymbol = querySymbol.replace('.c.0', '.v.0');
      try {
        const vRes = await fetchFn(buildUrl(vSymbol, startIso, endIso), {
          headers: { Authorization: authHeader, Accept: 'application/json' },
          signal: options.signal,
        });
        if (vRes.ok) {
          const vText = await vRes.text();
          const vLines = vText.split('\n').filter((l) => l.trim().length > 0);
          parseDatabentoLines(vLines, seenTimes, bars);
        }
      } catch {
        // Fallback attempt failed, keep bars as-is
      }
    }

    bars.sort((a, b) => a.time - b.time);

    // If a multi-minute timeframe was requested (e.g. 5m, 15m) and schema was 1m, aggregate them
    const finalBars =
      schema === 'ohlcv-1m' && barMinutes > 1 ? aggregateBars(bars, barMinutes) : bars;

    return finalBars.slice(-elements);
  } catch (err: any) {
    if (err?.name === 'AbortError') return [];
    console.warn(`[History:databento] ${symbol}: fetch error:`, err?.message || err);
    return [];
  }
}

/**
 * Fetches real historical tick/trade records from Databento timeseries API.
 * Provides granular order flow data for footprint charts, CVD, and market replay.
 */
export async function fetchDatabentoTrades(
  symbol: string,
  config: { apiKey?: string; dataset?: string; stypeIn?: string },
  options: DatabentoTradesOptions = {}
): Promise<Tick[]> {
  const apiKey = config.apiKey || process.env.DATABENTO_API_KEY;
  if (!apiKey) return [];

  const dataset = config.dataset || process.env.DATABENTO_DATASET || 'GLBX.MDP3';
  const { querySymbol, queryStypeIn } = resolveQuerySymbol(symbol, config.stypeIn);

  const limit = options.limit || 3000;
  const baseUrl = options.baseUrl || 'https://hist.databento.com';
  const fetchFn = options.fetchFn || fetch;

  const now = Date.now();
  const rawEndMs = options.beforeTime && options.beforeTime > 0 ? options.beforeTime : now;
  const availEndMs = await getAvailableDatasetEnd(dataset, apiKey, fetchFn, baseUrl);
  const maxSafeEnd = availEndMs ?? (now - 15 * 60 * 1000);
  const endMs = Math.min(getCmeLatestSessionEnd(rawEndMs, false), maxSafeEnd);

  // If no start time given, default to past 30 minutes of trades
  const startMs = options.startTime && options.startTime > 0
    ? options.startTime
    : endMs - 30 * 60 * 1000;

  const startIso = new Date(startMs).toISOString();
  const endIso = new Date(endMs).toISOString();

  const buildUrl = (sSym: string, start: string, end: string) =>
    `${baseUrl}/v0/timeseries.get_range?` +
    new URLSearchParams({
      dataset,
      symbols: sSym,
      stype_in: queryStypeIn,
      schema: 'trades',
      start,
      end,
      encoding: 'json',
      limit: String(limit),
    }).toString();

  const authHeader = 'Basic ' + Buffer.from(`${apiKey}:`).toString('base64');

  try {
    let res = await fetchFn(buildUrl(querySymbol, startIso, endIso), {
      headers: {
        Authorization: authHeader,
        Accept: 'application/json',
      },
      signal: options.signal,
    });

    if (res.status === 422) {
      const errText = await res.text().catch(() => '');
      try {
        const errJson = JSON.parse(errText);
        const availableEnd = errJson?.detail?.payload?.available_end;
        if (availableEnd) {
          const availMs = new Date(availableEnd).getTime();
          cachedDatasetRange = { end: availableEnd, ts: Date.now() };
          const retryEndMs = availMs;
          const retryStartMs = retryEndMs - (endMs - startMs);
          res = await fetchFn(
            buildUrl(querySymbol, new Date(retryStartMs).toISOString(), new Date(retryEndMs).toISOString()),
            {
              headers: {
                Authorization: authHeader,
                Accept: 'application/json',
              },
              signal: options.signal,
            }
          );
        }
      } catch {}
    }

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      console.warn(`[Trades:databento] ${symbol}: HTTP ${res.status} ${errText}`);
      return [];
    }

    const text = await res.text();
    const lines = text.split('\n').filter((l) => l.trim().length > 0);
    const ticks: Tick[] = [];
    const seenIds = new Set<string>();

    for (const line of lines) {
      try {
        const item = JSON.parse(line);
        if (!item.hd?.ts_event) continue;

        const tsEventNs = BigInt(item.hd.ts_event);
        const timestamp = Number(tsEventNs / 1_000_000n);

        const rawPrice = BigInt(item.price);
        const size = Number(item.size || 0);
        const action = item.action || 'T';

        if (
          rawPrice === DBN_CONSTANTS.UNDEF_PRICE ||
          rawPrice <= 0n ||
          size <= 0 ||
          size === DBN_CONSTANTS.UNDEF_ORDER_SIZE ||
          action !== 'T'
        ) {
          continue;
        }

        const price = Number(rawPrice) / 1e9;
        const sideChar = item.side;
        const side: 'buy' | 'sell' | 'unknown' = sideChar === 'B' ? 'buy' : sideChar === 'A' ? 'sell' : 'unknown';
        const id = `${symbol}:${item.sequence ?? item.hd.ts_event}:${item.price}`;

        if (seenIds.has(id)) continue;
        seenIds.add(id);

        ticks.push({
          timestamp,
          price,
          size,
          side,
          id,
        });
      } catch {}
    }

    ticks.sort((a, b) => a.timestamp - b.timestamp);
    return ticks.slice(-limit);
  } catch (err: any) {
    if (err?.name === 'AbortError') return [];
    console.warn(`[Trades:databento] ${symbol}: fetch error:`, err?.message || err);
    return [];
  }
}
