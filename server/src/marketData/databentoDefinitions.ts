import { metrics } from '../util/metrics.js';
import { VENDOR_USAGE_PROVIDER, guardVendorSpend, recordVendorSpend } from './databentoUsage.js';

/**
 * Instrument definitions straight from Databento (`schema=definition`).
 *
 * This is how the app covers **every** product in `GLBX.MDP3` (CME/CBOT/NYMEX/COMEX) without hand-typing
 * contract specs. Databento documents the recipe (blog: "Getting futures tick sizes and notional tick
 * values in Python"):
 *
 *   tick_size  = min_price_increment
 *   tick_value = min_price_increment × unit_of_measure_qty      [× 0.01 on CBOT (exchange XCBT)]
 *
 * `unit_of_measure_qty`/`display_factor` are fixed-point (1e-9) in DBN; with `pretty_px=true` the HTTP API
 * returns decimals. We request pretty_px and still decode defensively, then range-check: a spec that does
 * not pass is dropped (never guessed) because wrong multipliers corrupt P&L, whale notches and footprints.
 */
export interface DatabentoInstrumentSpec {
  root: string;
  rawSymbol: string;
  exchange: 'CME' | 'CBOT' | 'NYMEX' | 'COMEX';
  currency: string;
  instrumentClass: string;
  /** USD per full point of the provider's price scale. */
  pointValue: number;
  /** Minimum price increment in the provider's price scale. */
  tickSize: number;
  tickValue: number;
  unitOfMeasure?: string;
  unitOfMeasureQty?: number;
  underlying?: string;
  activation?: string;
  expiration?: string;
}

export interface FetchDefinitionsOptions {
  dataset?: string;
  symbols?: string;
  stypeIn?: string;
  start?: string;
  end?: string;
  apiKey?: string;
  fetchFn?: typeof fetch;
  baseUrl?: string;
  signal?: AbortSignal;
  /** Log the start line (a full GLBX.MDP3 sync is a large metered pull; operators must see it begin). */
  log?: boolean;
  /** Hard cap so an unbounded pull cannot pin the request forever. Default DEFINITIONS_TIMEOUT_MS or 5 min. */
  timeoutMs?: number;
}

/** Databento venue codes → the four CME Group exchanges. */
export const DATABENTO_EXCHANGE_MAP: Record<string, DatabentoInstrumentSpec['exchange']> = {
  XCME: 'CME',
  XCBT: 'CBOT',
  XNYM: 'NYMEX',
  XCEC: 'COMEX',
};

/**
 * CBOT quotes grains/soy in cents, so the contract value is 1/100 of the naive multiplication — exactly the
 * adjustment Databento's own tutorial applies (`df.loc[df["exchange"] == "XCBT", ...] *= 0.01`).
 */
export function exchangeValueFactor(exchange: string): number {
  return exchange.toUpperCase() === 'XCBT' ? 0.01 : 1;
}

/** DBN fixed-point is 1e-9; decimal strings ("1000") and plain numbers pass through unchanged. */
export function decodeFixedPoint(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const direct = Number(trimmed);
  if (!Number.isFinite(direct)) return null;
  // No decimal point and suspiciously large -> still implicitly scaled by 1e-9 (pretty_px not applied).
  if (!trimmed.includes('.') && Math.abs(direct) >= 1e8) return direct / 1e9;
  return direct;
}

/** `ESM6` -> `ES`, `M6EU6` -> `M6E`, `KEM6` -> `KE`. Spreads/options/user-defined symbols do not match. */
export function rootFromRawSymbol(rawSymbol: string): string | null {
  const match = /^([A-Z0-9]+?)([FGHJKMNQUVXZ])(\d{1,2})$/.exec(String(rawSymbol || '').toUpperCase());
  return match ? match[1] : null;
}

/** Parse one definition JSON record into a spec (null when it is not a live outright future we can use). */
export function parseDefinitionRecord(
  record: any,
  now: number = Date.now()
): { spec: DatabentoInstrumentSpec | null; reason?: string } {
  if (!record || typeof record !== 'object') return { spec: null, reason: 'not-an-object' };
  const rawSymbol = typeof record.raw_symbol === 'string' ? record.raw_symbol : '';
  if (!rawSymbol) return { spec: null, reason: 'missing-raw_symbol' };

  const instrumentClass = String(record.instrument_class || '');
  if (instrumentClass && instrumentClass !== 'F') {
    return { spec: null, reason: `class-${instrumentClass}` };
  }

  const exchangeCode = String(record.exchange || '').toUpperCase();
  const exchange = DATABENTO_EXCHANGE_MAP[exchangeCode];
  if (!exchange) return { spec: null, reason: `exchange-${exchangeCode || 'none'}` };

  const root = rootFromRawSymbol(rawSymbol);
  if (!root) return { spec: null, reason: 'not-outright' };

  const factor = exchangeValueFactor(exchangeCode);
  const contractMultiplier = decodeFixedPoint(record.contract_multiplier);
  const tickSize = decodeFixedPoint(record.min_price_increment);
  if (!contractMultiplier || contractMultiplier <= 0) return { spec: null, reason: 'no-multiplier' };
  if (!tickSize || tickSize <= 0) return { spec: null, reason: 'no-tick-size' };

  const unitQty = decodeFixedPoint(record.unit_of_measure_qty);
  const incrementAmount = decodeFixedPoint(record.min_price_increment_amount);

  // Documented formula first (tick × unit qty), then the vendor's own amount field, then the multiplier.
  let tickValue = unitQty && unitQty > 0 ? tickSize * unitQty * factor : 0;
  if (!(tickValue > 0) && incrementAmount && incrementAmount > 0) tickValue = incrementAmount * factor;
  if (!(tickValue > 0)) tickValue = tickSize * contractMultiplier * factor;

  const pointValue = contractMultiplier * factor;
  if (!(pointValue > 0)) return { spec: null, reason: 'non-positive-point-value' };
  if (!(tickSize > 0 && tickSize <= 100)) return { spec: null, reason: `implausible-tick-size-${tickSize}` };
  if (!(tickValue > 0 && tickValue <= 1_000_000)) {
    return { spec: null, reason: `implausible-tick-value-${tickValue}` };
  }

  const expirationMs = record.expiration ? Date.parse(String(record.expiration)) : Number.NaN;
  if (Number.isFinite(expirationMs) && expirationMs < now - 30 * 24 * 60 * 60 * 1000) {
    return { spec: null, reason: 'expired' };
  }
  const activationMs = record.activation ? Date.parse(String(record.activation)) : Number.NaN;
  if (Number.isFinite(activationMs) && activationMs > now + 24 * 60 * 60 * 1000) {
    return { spec: null, reason: 'not-listed-yet' };
  }

  return {
    spec: {
      root,
      rawSymbol,
      exchange,
      currency: String(record.currency || 'USD'),
      instrumentClass: instrumentClass || 'F',
      pointValue,
      tickSize,
      tickValue,
      unitOfMeasure: record.unit_of_measure ? String(record.unit_of_measure) : undefined,
      unitOfMeasureQty: unitQty ?? undefined,
      underlying: record.underlying ? String(record.underlying) : undefined,
      activation: record.activation ? String(record.activation) : undefined,
      expiration: record.expiration ? String(record.expiration) : undefined,
    },
  };
}

/**
 * Definition payload -> one spec per root: contracts of a root share the same tick/point value, so keep the
 * one that expires latest (the still-listed contract) and drop the rest.
 */
export function aggregateSpecsByRoot(specs: DatabentoInstrumentSpec[]): DatabentoInstrumentSpec[] {
  const byRoot = new Map<string, DatabentoInstrumentSpec>();
  for (const spec of specs) {
    const existing = byRoot.get(spec.root);
    if (!existing) {
      byRoot.set(spec.root, spec);
      continue;
    }
    const existingExpiry = existing.expiration ? Date.parse(existing.expiration) : 0;
    const candidateExpiry = spec.expiration ? Date.parse(spec.expiration) : 0;
    if (candidateExpiry > existingExpiry) byRoot.set(spec.root, spec);
  }
  return Array.from(byRoot.values()).sort((a, b) => a.root.localeCompare(b.root));
}

/** Pull and parse `schema=definition` (one metered request, routed through the spend guard). */
export async function fetchDatabentoInstrumentSpecs(options: FetchDefinitionsOptions = {}): Promise<{
  specs: DatabentoInstrumentSpec[];
  skipped: Record<string, number>;
  estimateUsd: number | null;
}> {
  // `??` (not `||`): an explicit empty key means "no vendor credentials", not "fall back to the env".
  const apiKey = (options.apiKey ?? process.env.DATABENTO_API_KEY ?? '').trim();
  if (!apiKey) return { specs: [], skipped: { 'no-api-key': 1 }, estimateUsd: null };

  const dataset = options.dataset || process.env.DATABENTO_DATASET || 'GLBX.MDP3';
  const baseUrl = options.baseUrl || 'https://hist.databento.com';
  const fetchFn = options.fetchFn || fetch;
  const startIso = options.start || new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const endIso = options.end || new Date().toISOString().slice(0, 10);
  const symbols = options.symbols || 'ALL_SYMBOLS';
  const stypeIn = options.stypeIn || 'raw_symbol';

  const verdict = await guardVendorSpend({
    provider: VENDOR_USAGE_PROVIDER,
    label: `${dataset} definition ${symbols} ${startIso} -> ${endIso}`,
    query: { dataset, schema: 'definition', start: startIso, end: endIso, symbols, stype_in: stypeIn },
    apiKey,
    fetchFn,
    baseUrl,
    signal: options.signal,
  });
  if (!verdict.allowed) return { specs: [], skipped: { 'budget-blocked': 1 }, estimateUsd: verdict.estimatedUsd };

  // A full GLBX.MDP3 definition pull is large (hundreds of thousands of instruments): make it visible and
  // bound it, so an operator never wonders why a request is slow or how much it cost.
  const timeoutMs =
    options.timeoutMs ?? (parseInt(process.env.DEFINITIONS_TIMEOUT_MS || '', 10) || 5 * 60 * 1000);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(5_000, timeoutMs));
  timer.unref?.();
  const signal = options.signal ? AbortSignal.any([options.signal, controller.signal]) : controller.signal;

  if (options.log !== false) {
    console.log(
      `[Definitions] pulling ${dataset} definitions (symbols=${symbols}, stype_in=${stypeIn}, ${startIso} -> ${endIso}) — ` +
        `metered request, capped at ${Math.round(timeoutMs / 1000)}s`
    );
  }

  const url =
    `${baseUrl}/v0/timeseries.get_range?` +
    new URLSearchParams({
      dataset,
      symbols,
      stype_in: stypeIn,
      schema: 'definition',
      start: startIso,
      end: endIso,
      encoding: 'json',
      pretty_px: 'true',
    }).toString();

  try {
    const res = await fetchFn(url, {
      headers: {
        Authorization: 'Basic ' + Buffer.from(`${apiKey}:`).toString('base64'),
        Accept: 'application/json',
      },
      signal,
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      console.warn(`[Definitions] HTTP ${res.status} ${errText.slice(0, 200)}`);
      return { specs: [], skipped: { [`http-${res.status}`]: 1 }, estimateUsd: verdict.estimatedUsd };
    }

    const text = await res.text();
    const skipped: Record<string, number> = {};
    const parsed: DatabentoInstrumentSpec[] = [];

    for (const line of text.split('\n')) {
      if (!line.trim()) continue;
      let record: any;
      try {
        record = JSON.parse(line);
      } catch {
        continue;
      }
      const { spec, reason } = parseDefinitionRecord(record);
      if (spec) {
        parsed.push(spec);
      } else if (reason) {
        const key = reason.split('-').slice(0, 2).join('-');
        skipped[key] = (skipped[key] || 0) + 1;
      }
    }

    const specs = aggregateSpecsByRoot(parsed);
    if (specs.length > 0 && verdict.estimatedUsd !== null) {
      recordVendorSpend(VENDOR_USAGE_PROVIDER, verdict.estimatedUsd, 1);
    }
    metrics.set('deepchart_instrument_specs', specs.length, 'Instrument specs known from the vendor');
    return { specs, skipped, estimateUsd: verdict.estimatedUsd };
  } catch (err: any) {
    if (err?.name === 'AbortError') {
      console.warn(`[Definitions] pull aborted after ${Math.round(timeoutMs / 1000)}s — raise DEFINITIONS_TIMEOUT_MS or sync a subset (symbols=ES.FUT,NQ.FUT)`);
      return { specs: [], skipped: { timeout: 1 }, estimateUsd: verdict.estimatedUsd };
    }
    console.warn(`[Definitions] fetch failed: ${err?.message || err}`);
    return { specs: [], skipped: { 'fetch-error': 1 }, estimateUsd: verdict.estimatedUsd };
  } finally {
    clearTimeout(timer);
  }
}
