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

/**
 * Parse and strictly validate Binance aggTrade rows.
 * Rejects non-finite numbers, malformed numbers with trailing chars (e.g. "100.5abc"),
 * empty IDs, and string booleans like "false" that would misclassify buy/sell.
 */
export function parseBinanceAggTrades(rows: unknown[], seenIds = new Set<string>()): Tick[] {
  if (!Array.isArray(rows) || rows.length === 0) return [];

  const pageTicks: Tick[] = [];
  for (const item of rows) {
    if (!item || typeof item !== 'object') continue;
    const row = item as Record<string, unknown>;

    const priceStr = typeof row.p === 'string' || typeof row.p === 'number' ? String(row.p).trim() : '';
    const sizeStr = typeof row.q === 'string' || typeof row.q === 'number' ? String(row.q).trim() : '';
    const price = Number(priceStr);
    const size = Number(sizeStr);
    const timestamp = Number(row.T);

    if (
      !Number.isFinite(price) ||
      price <= 0 ||
      !Number.isFinite(size) ||
      size <= 0 ||
      !Number.isFinite(timestamp) ||
      timestamp <= 0
    ) {
      continue;
    }

    if (row.a === undefined || row.a === null || (typeof row.a !== 'string' && typeof row.a !== 'number')) {
      continue;
    }
    const id = String(row.a).trim();
    if (!id || seenIds.has(id)) continue;

    // Strict buyer-maker validation:
    let isBuyerMaker: boolean;
    if (typeof row.m === 'boolean') {
      isBuyerMaker = row.m;
    } else if (row.m === 'true' || row.m === true) {
      isBuyerMaker = true;
    } else if (row.m === 'false' || row.m === false) {
      isBuyerMaker = false;
    } else {
      continue;
    }

    seenIds.add(id);
    pageTicks.push({
      id,
      timestamp,
      price,
      size,
      side: isBuyerMaker ? 'sell' : 'buy',
      isBuyerMaker,
    });
  }

  return pageTicks;
}

/** REAL trades from Binance, oldest -> newest (up to `pages` x 1000 ticks). */
export async function fetchBinanceAggTrades(symbol: string, pages = 3): Promise<Tick[]> {
  const collected: Tick[] = [];
  const seenIds = new Set<string>();
  let endTime: number | undefined;

  for (let page = 0; page < pages; page++) {
    const url = `https://fapi.binance.com/fapi/v1/aggTrades?symbol=${symbol.toUpperCase()}&limit=1000${
      endTime ? `&endTime=${endTime}` : ''
    }`;
    const rows = (await getJson(url)) as unknown[] | null;
    if (!Array.isArray(rows) || rows.length === 0) break;

    const pageTicks = parseBinanceAggTrades(rows, seenIds);
    if (pageTicks.length === 0) break;
    collected.unshift(...pageTicks);

    // Use the oldest trade timestamp as the upper bound for the previous page
    const oldestRow = rows[0] as Record<string, unknown> | undefined;
    const oldestTs = Number(oldestRow?.T);
    if (endTime !== undefined && (!Number.isFinite(oldestTs) || oldestTs >= endTime)) {
      break;
    }
    endTime = oldestTs;
    if (rows.length < 1000) break;
  }

  return collected.sort((a, b) => a.timestamp - b.timestamp);
}
