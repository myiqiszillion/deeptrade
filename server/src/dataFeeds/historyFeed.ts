import { Tick } from '../types.js';

/**
 * Free historical data for seeding the orderflow engines at boot.
 *
 * - Crypto: Binance public REST gives REAL trades (aggTrades), paged backwards.
 * - Futures/index: Yahoo's public chart endpoint gives REAL 1-minute OHLCV bars. True
 *   tick history is licensed, so bars are expanded into a plausible intra-bar price path —
 *   that microstructure is a RECONSTRUCTION and the UI labels it as such.
 */

export interface HistoryBar {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

const USER_AGENT = 'Mozilla/5.0 (compatible; DeepChart/1.0)';
const TIMEOUT_MS = 15000;

async function getJson(url: string): Promise<unknown | null> {
  try {
    const res = await fetch(url, {
      headers: { 'user-agent': USER_AGENT, accept: 'application/json' },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) {
      console.warn(`[History] ${url} -> HTTP ${res.status}`);
      return null;
    }
    return await res.json();
  } catch (err) {
    console.warn(`[History] ${url} -> ${(err as Error).message}`);
    return null;
  }
}

/** Real 1-minute bars from Yahoo's public chart endpoint (no key required). */
export async function fetchYahooMinuteBars(yahooSymbol: string, range = '1d'): Promise<HistoryBar[]> {
  // Yahoo silently returns an EMPTY chart when the ticker is percent-encoded (ES%3DF), so the
  // raw symbol is used after a strict allow-list check instead of encodeURIComponent.
  if (!/^[A-Za-z0-9.^=-]{1,16}$/.test(yahooSymbol)) {
    console.warn(`[History] Rejecting unexpected Yahoo symbol: ${yahooSymbol}`);
    return [];
  }

  // Markets are closed on weekends/holidays, so `range=1d` can legitimately return an empty
  // chart. Walk a few (range, interval) combinations and keep the first with data.
  const attempts: { range: string; interval: string }[] = [
    { range: '1d', interval: '1m' },
    { range: '5d', interval: '1m' },
    { range: '1mo', interval: '5m' },
  ];

  for (const attempt of attempts) {
    const url = `https://query2.finance.yahoo.com/v8/finance/chart/${yahooSymbol}?interval=${attempt.interval}&range=${attempt.range}`;
    const json = (await getJson(url)) as {
      chart?: { result?: { timestamp?: number[]; indicators?: { quote?: Record<string, (number | null)[]>[] } }[] };
    } | null;

    const result = json?.chart?.result?.[0];
    const stamps = result?.timestamp;
    const quote = result?.indicators?.quote?.[0];
    if (!stamps || !quote || stamps.length === 0) continue;

    const bars: HistoryBar[] = [];
    for (let i = 0; i < stamps.length; i++) {
      const open = quote.open?.[i];
      const high = quote.high?.[i];
      const low = quote.low?.[i];
      const close = quote.close?.[i];
      if (open == null || high == null || low == null || close == null) continue;
      bars.push({
        time: stamps[i] * 1000,
        open,
        high,
        low,
        close,
        volume: quote.volume?.[i] ?? 0,
      });
    }

    if (bars.length > 0) {
      console.log(`[History] Yahoo ${yahooSymbol}: ${bars.length} bars (${attempt.interval}/${attempt.range})`);
      return bars;
    }
  }

  console.warn(`[History] Yahoo ${yahooSymbol}: no bars from any tried range`);
  return [];
}

/** REAL trades from Binance, oldest → newest (up to `pages` × 1000 ticks). */
export async function fetchBinanceAggTrades(symbol: string, pages = 3): Promise<Tick[]> {
  const collected: Tick[] = [];
  let endTime: number | undefined;

  for (let page = 0; page < pages; page++) {
    const url = `https://api.binance.com/api/v3/aggTrades?symbol=${symbol.toUpperCase()}&limit=1000${
      endTime ? `&endTime=${endTime}` : ''
    }`;
    const rows = (await getJson(url)) as Record<string, unknown>[] | null;
    if (!Array.isArray(rows) || rows.length === 0) break;

    const pageTicks: Tick[] = rows.map((row) => ({
      id: String(row.a),
      timestamp: Number(row.T),
      price: parseFloat(String(row.p)),
      size: parseFloat(String(row.q)),
      side: row.m ? 'sell' : 'buy',
      isBuyerMaker: Boolean(row.m),
    }));

    collected.unshift(...pageTicks);
    endTime = Number(rows[0].T) - 1;
    if (rows.length < 1000) break;
  }

  return collected.sort((a, b) => a.timestamp - b.timestamp);
}

/**
 * Expand REAL 1-minute bars into tick-sized events for the footprint/VP/VWAP engines.
 * The price path (O→L→H→C or O→H→L→C) and volume split are deterministic, and the
 * aggressor side follows the bar's net direction — a reconstruction, not real tape.
 */
export function reconstructTicksFromBars(bars: HistoryBar[], tickSize: number, legsPerBar = 6): Tick[] {
  const ticks: Tick[] = [];
  let counter = 0;
  const decimals = tickSize < 0.01 ? 3 : tickSize < 0.1 ? 2 : 1;

  for (const bar of bars) {
    if (!Number.isFinite(bar.open) || !Number.isFinite(bar.close)) continue;

    const up = bar.close >= bar.open;
    const path = up ? [bar.open, bar.low, bar.high, bar.close] : [bar.open, bar.high, bar.low, bar.close];
    const steps = Math.max(2, legsPerBar);
    const totalSteps = steps * (path.length - 1);
    const volumePerStep = bar.volume > 0 ? bar.volume / totalSteps : 1;
    let stepIndex = 0;

    for (let leg = 0; leg < path.length - 1; leg++) {
      const from = path[leg];
      const to = path[leg + 1];
      for (let s = 1; s <= steps; s++) {
        const ratio = s / steps;
        const rawPrice = from + (to - from) * ratio;
        const price = Number((Math.round(rawPrice / tickSize) * tickSize).toFixed(decimals));
        const isBuyerMaker = !up; // sellers dominate in a down bar
        ticks.push({
          id: `hist_${bar.time}_${counter++}`,
          timestamp: bar.time + Math.floor((stepIndex / totalSteps) * 59_000),
          price,
          size: Number(Math.max(1, Math.round(volumePerStep)).toFixed(3)),
          side: isBuyerMaker ? 'sell' : 'buy',
          isBuyerMaker,
        });
        stepIndex++;
      }
    }
  }

  return ticks.sort((a, b) => a.timestamp - b.timestamp);
}
