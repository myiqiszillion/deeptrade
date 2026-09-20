import { HistoricalBar } from '../types.js';
import { TradovateConfig, credentialFreeMessage } from './tradovateConfig.js';
import {
  AccessTokenResponse,
  TRADOVATE_ENDPOINTS,
  TradovateChart,
  TradovateChartBar,
  TradovateClient,
  TradovateSocketFactory,
  TradovateSocketItem,
  requestAccessToken,
} from './tradovateTransport.js';

/**
 * REAL historical bars for the futures chart, from Tradovate `md/getchart` (EX-10).
 *
 * This is the ONE place a futures chart gets history. It deliberately returns `HistoricalBar`
 * (bar aggregates) instead of `FootprintBar`:
 *
 *  - A bar carries OHLC plus the vendor's OWN volume splits - `upVolume`/`downVolume` (split by
 *    trade direction) and `bidVolume`/`offerVolume` (split by aggressor). Those are real and are
 *    passed through verbatim.
 *  - Plain OHLC bars (withHistogram=false) do not carry per-price distributions. Reconstructing
 *    one from OHLC would invent orderflow, so it is not attempted; the result has no levels field.
 *
 * The request is a subscription like every other `md/*` call, so it is explicitly cancelled
 * (`md/cancelChart`) and the socket closed once the range is delivered.
 */

export interface TradovateHistoryOptions {
  /** Minutes per bar (`chartDescription.elementSize` with `underlyingType: 'MinuteBar'`). */
  barMinutes?: number;
  /** How many bars to request (`timeRange.asMuchAsElements`). */
  elements?: number;
  /** Hard ceiling for the whole fetch. */
  timeoutMs?: number;
  /** Resolve once no further bars have arrived for this long after the first batch. */
  idleMs?: number;
  /** Cancel stale requests when the instrument or timeframe changes. */
  signal?: AbortSignal;
  /** Only completed bars before this boundary, epoch ms. */
  beforeTime?: number;
  /** Test seam: replaces the real WebSocket. */
  socketFactory?: TradovateSocketFactory;
  /** Test seam: replaces the REST auth call. */
  authResolver?: (config: TradovateConfig) => Promise<AccessTokenResponse>;
}

const DEFAULT_BAR_MINUTES = 1;
const DEFAULT_ELEMENTS = 300;
const DEFAULT_TIMEOUT_MS = 12000;
const DEFAULT_IDLE_MS = 1200;

function finitePositive(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

function nonNegative(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function toEpochMs(timestamp: unknown): number | null {
  if (typeof timestamp !== 'string' || timestamp.length === 0) return null;
  const ms = Date.parse(timestamp);
  return Number.isFinite(ms) && ms > 0 ? ms : null;
}

/** Map OHLC and reported volume; missing aggressor data stays absent, never guessed. */
export function mapChartBar(bar: TradovateChartBar): HistoricalBar | null {
  if (!bar || typeof bar !== 'object') return null;
  const time = toEpochMs(bar.timestamp);
  if (time === null) return null;
  if (!finitePositive(bar.open) || !finitePositive(bar.high) || !finitePositive(bar.low) || !finitePositive(bar.close)) {
    return null;
  }
  if (bar.high < Math.max(bar.low, bar.open, bar.close) || bar.low > Math.min(bar.open, bar.close)) return null;
  if (!nonNegative(bar.upVolume) || !nonNegative(bar.downVolume)) return null;
  const volume = bar.upVolume + bar.downVolume;
  if (!Number.isFinite(volume)) return null;

  const result: HistoricalBar = {
    time, open: bar.open, high: bar.high, low: bar.low, close: bar.close, volume,
  };
  // Up/down-tick volume is NOT the aggressor split. Do not relabel it as buy/sell volume.
  if (nonNegative(bar.bidVolume) && nonNegative(bar.offerVolume)) {
    result.buyVolume = bar.offerVolume;
    result.sellVolume = bar.bidVolume;
    result.delta = bar.offerVolume - bar.bidVolume;
  }
  return result;
}

/** Sort ascending by bar-open time and drop duplicate times (the vendor may resend a bar). */
export function normalizeBars(bars: HistoricalBar[]): HistoricalBar[] {
  const byTime = new Map<number, HistoricalBar>();
  for (const bar of bars) byTime.set(bar.time, bar);
  return [...byTime.values()].sort((a, b) => a.time - b.time);
}

/** Read the `charts` array off an inbound item without trusting its shape. */
function readCharts(payload: Record<string, unknown> | null | undefined): TradovateChart[] {
  const charts = payload?.charts;
  return Array.isArray(charts) ? (charts as TradovateChart[]) : [];
}

/**
 * Fetch real historical bars for `vendorSymbol`. Refusal/cancellation returns [];
 * idle/socket timeout may return a partial range containing only received, validated bars.
 */
export async function fetchTradovateHistoryBars(
  vendorSymbol: string,
  config: TradovateConfig,
  options: TradovateHistoryOptions = {}
): Promise<HistoricalBar[]> {
  const credentials = config.credentials;
  if (!credentials || options.signal?.aborted) return [];

  const barMinutes = options.barMinutes ?? DEFAULT_BAR_MINUTES;
  const elements = options.elements ?? DEFAULT_ELEMENTS;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const idleMs = options.idleMs ?? DEFAULT_IDLE_MS;
  if (!Number.isInteger(barMinutes) || barMinutes < 1 || !Number.isInteger(elements) || elements < 1 ||
      !Number.isFinite(timeoutMs) || timeoutMs <= 0 || !Number.isFinite(idleMs) || idleMs <= 0) return [];
  const beforeTime = options.beforeTime ?? Date.now();
  if (!Number.isFinite(beforeTime) || beforeTime <= 0) return [];
  const endpoints = TRADOVATE_ENDPOINTS[config.env];
  const started = Date.now();
  const authAbort = new AbortController();
  let authTimer: NodeJS.Timeout | undefined;
  let onAbort = () => {};
  let accessToken: string;
  try {
    const auth = await new Promise<AccessTokenResponse>((resolve, reject) => {
      onAbort = () => {
        authAbort.abort();
        reject(new Error('history cancelled or timed out'));
      };
      options.signal?.addEventListener('abort', onAbort, { once: true });
      authTimer = setTimeout(onAbort, timeoutMs);
      const request = options.authResolver
        ? options.authResolver(config)
        : requestAccessToken(endpoints.restBase, credentials, undefined, authAbort.signal);
      void request.then(resolve, reject);
    });
    if (!auth.accessToken || auth.errorText || auth['p-ticket'] || auth['p-captcha']) return [];
    accessToken = auth.accessToken;
  } catch {
    // Do not echo vendor auth payloads or credentials into browser-visible diagnostics.
    return [];
  } finally {
    clearTimeout(authTimer);
    options.signal?.removeEventListener('abort', onAbort);
  }
  if (options.signal?.aborted || Date.now() - started >= timeoutMs) return [];

  const collected = new Map<number, HistoricalBar>();

  return new Promise<HistoricalBar[]>((resolve) => {
    let settled = false;
    let idleTimer: NodeJS.Timeout | null = null;
    // Tradovate answers `md/getchart` with realtimeId (or subscriptionId) used to cancel it.
    let subscriptionId: number | undefined;
    let historicalId: number | undefined;
    let requestId: number | undefined;

    const cancel = () => { collected.clear(); finish(); };
    const finish = (): void => {
      if (settled) return;
      settled = true;
      clearTimeout(hardTimer);
      options.signal?.removeEventListener('abort', cancel);
      if (idleTimer) clearTimeout(idleTimer);
      try {
        // Cancel the subscription explicitly, exactly like the vendor client does.
        if (subscriptionId !== undefined) client.send('md/cancelChart', { subscriptionId });
      } catch {
        /* socket already gone */
      }
      client.close();
      const bars = normalizeBars([...collected.values()]);
      if (bars.length > 0) {
        console.log(
          `[History:tradovate] ${vendorSymbol}: ${bars.length} real ${barMinutes}m bar(s) ` +
            `${new Date(bars[0]!.time).toISOString()} .. ${new Date(bars[bars.length - 1]!.time).toISOString()}`
        );
      } else {
        console.log(`[History:tradovate] ${vendorSymbol}: vendor returned no bars`);
      }
      resolve(bars);
    };

    const client = new TradovateClient({
      env: config.env,
      accessToken,
      socketFactory: options.socketFactory,
      onReady: () => {
        if (settled) return;
        requestId = client.send('md/getchart', {
          // Protocol key is `symbol` (EX-10); the value is the vendor form, e.g. `@ES`.
          symbol: vendorSymbol,
          chartDescription: {
            underlyingType: 'MinuteBar',
            elementSize: barMinutes,
            elementSizeUnit: 'UnderlyingUnits',
            withHistogram: false,
          },
          timeRange: { asMuchAsElements: elements, closestTimestamp: new Date(beforeTime - 1).toISOString() },
        });
      },
      onItem: (item: TradovateSocketItem) => {
        if (settled || !item || typeof item !== 'object') return;
        const payload = item.d ?? undefined;
        // Only the correlated reply establishes which chart IDs belong to this request.
        if (requestId !== undefined && item.i === requestId && item.e !== 'md') {
          if (item.s !== 200 || payload?.errorText || payload?.['p-ticket'] || payload?.['p-captcha']) {
            cancel(); // fail closed on refusal/throttle, rather than claiming success
            return;
          }
          const realtime = payload?.realtimeId ?? payload?.subscriptionId;
          if (typeof realtime === 'number') subscriptionId = realtime;
          if (typeof payload?.historicalId === 'number') historicalId = payload.historicalId;
        }
        if (item.e !== 'md') return;

        let received = false;
        for (const chart of readCharts(payload)) {
          if (!chart || typeof chart !== 'object' || typeof chart.id !== 'number' ||
              (chart.id !== subscriptionId && chart.id !== historicalId)) continue;
          for (const raw of Array.isArray(chart.bars) ? chart.bars : []) {
            const bar = mapChartBar(raw);
            if (!bar || bar.time + barMinutes * 60000 > beforeTime) continue;
            collected.set(bar.time, bar);
            if (collected.size > elements) collected.delete(Math.min(...collected.keys()));
            received = true;
          }
          if (chart.eoh) {
            finish();
            return;
          }
        }
        // A bounded fallback returns only bars actually received; silence is not proof of eoh.
        if (received) {
          if (idleTimer) clearTimeout(idleTimer);
          idleTimer = setTimeout(finish, idleMs);
        }
      },
      onClosed: (reason) => {
        if (!settled) {
          console.warn(`[History:tradovate] ${vendorSymbol}: socket closed (${credentialFreeMessage(reason)})`);
        }
        finish();
      },
    });

    const hardTimer = setTimeout(finish, Math.max(1, timeoutMs - (Date.now() - started)));
    options.signal?.addEventListener('abort', cancel, { once: true });
    if (options.signal?.aborted) { cancel(); return; }

    // Open + authorize. connect() rejects only for a socket that never authorized; the fetch's
    // own timeout is the single completion path, so a rejection just ends the attempt.
    void client.connect().catch((err: Error) => {
      if (!settled) {
        console.warn(`[History:tradovate] ${vendorSymbol}: connect failed (${credentialFreeMessage(err.message)})`);
      }
      finish();
    });
  });
}
