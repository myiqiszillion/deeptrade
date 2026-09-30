import { metrics } from '../util/metrics.js';
import { marketDataStore } from '../storage/marketDataStore.js';

/**
 * Databento metered-spend guard.
 *
 * A Databento subscription (CME Standard, $199/month) covers live data plus included history, but larger
 * historical pulls stay **metered per GB**. This module asks the vendor what a request will cost before it
 * is sent (`POST /v0/metadata.get_cost`), keeps a month-to-date ledger in SQLite, and — when
 * DATABENTO_MONTHLY_USD_BUDGET is set — refuses the fetch instead of silently overshooting the bill.
 *
 * Design rules:
 *  - Off by default: without a budget (or DATABENTO_COST_LOG=1) no extra request is made at all.
 *  - Fail-open: if the estimate cannot be obtained, the fetch proceeds and the failure is counted.
 *  - Never throws: accounting must not take the market data path down.
 */
export const VENDOR_USAGE_PROVIDER = 'databento';
export const DATABENTO_COST_PATH = '/v0/metadata.get_cost';
export const DATABENTO_HIST_URL = 'https://hist.databento.com';

export interface DatabentoCostQuery {
  dataset: string;
  /** 'ohlcv-1m' | 'trades' | ... */
  schema: string;
  /** ISO-8601 UTC. */
  start: string;
  end?: string;
  symbols?: string;
  stype_in?: string;
  /** Defaults to 'historical-streaming', which is what timeseries.get_range uses when mode is omitted. */
  mode?: string;
}

export interface VendorSpendVerdict {
  allowed: boolean;
  estimatedUsd: number | null;
  spentMonth: number;
  budgetMonth: number;
  reason?: 'budget' | 'estimate-unavailable';
}

/** "$1,234.56" / "0.0123" / 0.0123 -> number; anything unparseable -> null. */
export function parseUsd(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string') return null;
  const cleaned = value.replace(/[^0-9.-]/g, '');
  if (!/[0-9]/.test(cleaned)) return null;
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
}

/** UTC month bucket (YYYY-MM): the ledger must roll over even when the process runs for months. */
export function vendorMonthKey(now: number = Date.now()): string {
  const d = new Date(now);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

/** DATABENTO_MONTHLY_USD_BUDGET: unset or 0 = record spend, never block a fetch. */
export function monthlyBudgetUsd(env: NodeJS.ProcessEnv = process.env): number {
  const raw = Number.parseFloat(env.DATABENTO_MONTHLY_USD_BUDGET || '');
  return Number.isFinite(raw) && raw > 0 ? raw : 0;
}

/** DATABENTO_COST_LOG=1: log the estimate even when no budget is configured. */
export function costLoggingEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.DATABENTO_COST_LOG === '1';
}

export function currentMonthSpend(
  provider = VENDOR_USAGE_PROVIDER,
  now = Date.now()
): { month: string; usd: number; requests: number; budget: number } {
  const month = vendorMonthKey(now);
  const usage = marketDataStore.getVendorUsage(provider, month);
  if (usage.updatedAt > 0) {
    metrics.set(
      'deepchart_vendor_estimated_spend_usd',
      usage.usd,
      'Estimated metered vendor spend (USD, month to date)',
      { provider, month }
    );
  }
  return { month, usd: usage.usd, requests: usage.requests, budget: monthlyBudgetUsd() };
}

/** Ask the vendor what this request would cost. Returns null when the estimate is unavailable. */
export async function estimateDatabentoCost(
  query: DatabentoCostQuery,
  opts: { apiKey?: string; fetchFn?: typeof fetch; baseUrl?: string; signal?: AbortSignal } = {}
): Promise<number | null> {
  const apiKey = opts.apiKey || process.env.DATABENTO_API_KEY;
  if (!apiKey) return null;

  const baseUrl = opts.baseUrl || DATABENTO_HIST_URL;
  const fetchFn = opts.fetchFn || fetch;
  const authHeader = 'Basic ' + Buffer.from(`${apiKey}:`).toString('base64');

  const body: Record<string, string> = {
    dataset: query.dataset,
    schema: query.schema,
    start: query.start,
    symbols: query.symbols || 'ALL_SYMBOLS',
    stype_in: query.stype_in || 'raw_symbol',
    mode: query.mode || 'historical-streaming',
  };
  if (query.end) body.end = query.end;

  try {
    const res = await fetchFn(`${baseUrl}${DATABENTO_COST_PATH}`, {
      method: 'POST',
      headers: {
        Authorization: authHeader,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(body),
      signal: opts.signal,
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      console.warn(`[DatabentoUsage] cost estimate HTTP ${res.status} ${errText.slice(0, 200)}`);
      return null;
    }

    const payload: any = await res.json().catch(() => null);
    return parseUsd(payload?.cost ?? payload?.cost_usd ?? payload?.usd);
  } catch (err: any) {
    if (err?.name !== 'AbortError') {
      console.warn(`[DatabentoUsage] cost estimate failed: ${err?.message || err}`);
    }
    return null;
  }
}

/** Persist an estimated charge for the current month and refresh the spend gauge. */
export function recordVendorSpend(
  provider: string,
  usd: number,
  requests = 1,
  now = Date.now()
): { month: string; usd: number; requests: number } {
  const month = vendorMonthKey(now);
  marketDataStore.addVendorUsage(provider, month, usd, requests);
  const usage = marketDataStore.getVendorUsage(provider, month);
  metrics.set(
    'deepchart_vendor_estimated_spend_usd',
    usage.usd,
    'Estimated metered vendor spend (USD, month to date)',
    { provider, month }
  );
  return { month, usd: usage.usd, requests: usage.requests };
}

/**
 * Pre-flight check used by every billable Databento call. Returns allowed=false only when a configured
 * budget would be exceeded; otherwise the caller proceeds and may record the estimate afterwards.
 */
export async function guardVendorSpend(input: {
  provider?: string;
  /** Human label for the log line, e.g. "ES.c.0 ohlcv-1m 2026-09-29T14:00Z -> 2026-09-29T18:00Z". */
  label: string;
  query: DatabentoCostQuery;
  apiKey?: string;
  fetchFn?: typeof fetch;
  baseUrl?: string;
  signal?: AbortSignal;
}): Promise<VendorSpendVerdict> {
  const provider = input.provider || VENDOR_USAGE_PROVIDER;
  const month = vendorMonthKey();
  const spent = marketDataStore.getVendorUsage(provider, month).usd;
  const budget = monthlyBudgetUsd();

  if (budget <= 0 && !costLoggingEnabled()) {
    return { allowed: true, estimatedUsd: null, spentMonth: spent, budgetMonth: budget };
  }

  const estimatedUsd = await estimateDatabentoCost(input.query, input);

  if (estimatedUsd === null) {
    metrics.inc('deepchart_vendor_cost_estimate_total', 'Pre-flight vendor cost estimates', {
      provider,
      result: 'unavailable',
    });
    // Fail-open: an estimate endpoint hiccup must not stop the terminal from loading history.
    return { allowed: true, estimatedUsd: null, spentMonth: spent, budgetMonth: budget, reason: 'estimate-unavailable' };
  }

  metrics.inc('deepchart_vendor_cost_estimate_total', 'Pre-flight vendor cost estimates', {
    provider,
    result: 'ok',
  });

  const projected = spent + estimatedUsd;

  if (budget > 0 && projected > budget) {
    metrics.inc(
      'deepchart_vendor_budget_blocked_total',
      'Vendor fetches refused because the monthly budget would be exceeded',
      { provider }
    );
    console.warn(
      `[DatabentoUsage] BLOCKED ${input.label}: estimate $${estimatedUsd.toFixed(4)} would make ${month} ` +
        `$${projected.toFixed(4)} > DATABENTO_MONTHLY_USD_BUDGET $${budget.toFixed(2)}. ` +
        'Raise the budget or wait for the next month; cached bars are still served.'
    );
    return { allowed: false, estimatedUsd, spentMonth: spent, budgetMonth: budget, reason: 'budget' };
  }

  console.log(
    `[DatabentoUsage] ${input.label}: estimate $${estimatedUsd.toFixed(4)} ` +
      `(month ${month}: $${spent.toFixed(4)}${budget > 0 ? ` / $${budget.toFixed(2)}` : ' / no budget set'})`
  );
  return { allowed: true, estimatedUsd, spentMonth: spent, budgetMonth: budget };
}
