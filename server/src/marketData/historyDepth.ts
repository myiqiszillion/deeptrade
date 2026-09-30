/**
 * How many historical bars the server asks a vendor for, per timeframe.
 *
 * The old hard-coded 500 was a leftover from the free-tier era: a paid Databento license makes deeper
 * pulls cheap (OHLCV-1m for one symbol over days is a few hundred KB), and every bar pulled is cached in
 * SQLite, so the extra depth is paid for once and then served from disk.
 *
 * Raise HISTORY_BARS_TARGET when the chart should pan further back; lower it when the metered vendor
 * bill matters more than depth. The client never renders more than 5000 bars at once, so that is the cap.
 */
export const HISTORY_BARS_MIN = 100;
export const HISTORY_BARS_MAX = 5000;
export const HISTORY_BARS_DEFAULT = 1500;

export function historyBarsTarget(env: NodeJS.ProcessEnv = process.env): number {
  const raw = parseInt(env.HISTORY_BARS_TARGET || '', 10);
  const target = Number.isFinite(raw) && raw > 0 ? raw : HISTORY_BARS_DEFAULT;
  return Math.min(Math.max(target, HISTORY_BARS_MIN), HISTORY_BARS_MAX);
}
