/**
 * Real options data for GEX — free and key-less.
 *
 * CBOE publishes delayed (~15 min) option chains as static JSON on its public CDN, so a
 * free public deployment can show *real* dealer gamma (computed from actual open interest
 * and gamma) instead of synthetic numbers.
 *
 *   https://cdn.cboe.com/api/global/delayed_quotes/options/_{SYMBOL}.json
 *
 * Data is delayed and offered for informational use only — the UI labels it as DELAYED and
 * the README carries the data disclaimer.
 */

export interface CboeOptionRow {
  strike: number;
  type: 'CALL' | 'PUT';
  expiration: string;
  dte: number;
  gamma: number;
  openInterest: number;
  volume: number;
  iv: number;
  delta: number;
  lastPrice: number;
}

export interface CboeChainSnapshot {
  underlying: string;
  spotPrice: number;
  fetchedAt: number;
  asOf: string;
  contracts: CboeOptionRow[];
}

const TTL_MS = parseInt(process.env.CBOE_TTL_MS || '600000', 10); // delayed feed -> 10 min cache
const MAX_DTE = parseInt(process.env.CBOE_MAX_DTE || '60', 10); // near-term chains drive GEX
const FETCH_TIMEOUT_MS = 15000;

function daysUntil(expiration: string, today = new Date()): number {
  const exp = new Date(`${expiration}T23:59:59Z`);
  return Math.max(0, Math.round((exp.getTime() - today.getTime()) / 86_400_000));
}

export class CboeOptionsProvider {
  private cache = new Map<string, CboeChainSnapshot>();
  private inFlight = new Map<string, Promise<CboeChainSnapshot | null>>();

  /** Parse an OSI symbol such as `SPX261016C00200000` into its parts. */
  public static parseOsiSymbol(osi: string): { expiration: string; type: 'CALL' | 'PUT'; strike: number } | null {
    const match = /^[A-Z]+(\d{2})(\d{2})(\d{2})([CP])(\d{7,8})$/.exec(osi);
    if (!match) return null;
    const [, yy, mm, dd, cp, strikeRaw] = match;
    return {
      expiration: `20${yy}-${mm}-${dd}`,
      type: cp === 'C' ? 'CALL' : 'PUT',
      strike: parseInt(strikeRaw, 10) / 1000,
    };
  }

  /** Cached chain fetch. Returns null when the underlying is not published (caller falls back). */
  public async fetchChain(underlying: string, force = false): Promise<CboeChainSnapshot | null> {
    const key = underlying.toUpperCase();
    const cached = this.cache.get(key);
    if (!force && cached && Date.now() - cached.fetchedAt < TTL_MS) return cached;

    const pending = this.inFlight.get(key);
    if (pending) return pending;

    const task = this.load(key)
      .then((snapshot) => {
        if (snapshot) this.cache.set(key, snapshot);
        return snapshot;
      })
      .finally(() => this.inFlight.delete(key));

    this.inFlight.set(key, task);
    return task;
  }

  private async load(underlying: string): Promise<CboeChainSnapshot | null> {
    const url = `https://cdn.cboe.com/api/global/delayed_quotes/options/_${underlying}.json`;
    try {
      const res = await fetch(url, {
        headers: { accept: 'application/json' },
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
      if (!res.ok) {
        console.warn(`[CBOE] ${underlying}: HTTP ${res.status} — falling back to simulated GEX`);
        return null;
      }

      const body = (await res.json()) as {
        timestamp?: string;
        data?: { current_price?: number; close?: number; options?: Record<string, unknown>[] };
      };
      const rawRows = Array.isArray(body?.data?.options) ? body.data!.options! : [];
      const spotPrice = Number(body?.data?.current_price ?? body?.data?.close ?? 0);

      const contracts: CboeOptionRow[] = [];
      for (const raw of rawRows) {
        const parsed = CboeOptionsProvider.parseOsiSymbol(String(raw.option ?? ''));
        if (!parsed) continue;

        const gamma = Number(raw.gamma) || 0;
        const openInterest = Number(raw.open_interest) || 0;
        // Gamma/OI-less rows contribute nothing to GEX; skipping them also keeps memory sane
        // (SPX ships ~28k contracts, most of them far-dated or dead strikes).
        if (gamma <= 0 || openInterest <= 0) continue;

        const dte = daysUntil(parsed.expiration);
        if (dte > MAX_DTE) continue;

        contracts.push({
          strike: parsed.strike,
          type: parsed.type,
          expiration: parsed.expiration,
          dte,
          gamma,
          openInterest,
          volume: Number(raw.volume) || 0,
          iv: Number(raw.iv) || 0,
          delta: Number(raw.delta) || 0,
          lastPrice: Number(raw.last_trade_price) || 0,
        });
      }

      if (contracts.length === 0 || !Number.isFinite(spotPrice) || spotPrice <= 0) {
        console.warn(`[CBOE] ${underlying}: chain unusable — falling back to simulated GEX`);
        return null;
      }

      console.log(`[CBOE] ${underlying}: ${contracts.length} contracts, spot ${spotPrice} (as of ${body.timestamp})`);
      return {
        underlying,
        spotPrice,
        fetchedAt: Date.now(),
        asOf: body.timestamp ?? '',
        contracts,
      };
    } catch (err) {
      console.warn(`[CBOE] ${underlying}: ${(err as Error).message} — falling back to simulated GEX`);
      return null;
    }
  }
}
