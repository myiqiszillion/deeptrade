import { Tick } from '../types.js';

/**
 * REAL historical trades for seeding the orderflow engines at boot.
 *
 * Only key-less public trade history is used (Binance aggTrades, paged backwards).
 * DeepChart deliberately ships no bar-reconstruction path: expanding 1-minute bars into a
 * synthetic intra-bar tick path would fabricate footprint / volume-profile microstructure.
 * Instruments without a real history source simply start empty and accumulate live ticks.
 */

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

/** REAL trades from Binance, oldest -> newest (up to `pages` x 1000 ticks). */
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
