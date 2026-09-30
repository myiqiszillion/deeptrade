import { marketDataStore } from './storage/marketDataStore.js';
import { currentMonthSpend } from './marketData/databentoUsage.js';
import { metrics } from './util/metrics.js';

export interface MaintenanceHandle {
  stop(): void;
  /** Exposed for tests and runbooks: run one maintenance pass now. */
  runOnce(now?: number): void;
}

function intFromEnv(name: string, fallback: number): number {
  const value = parseInt(process.env[name] || '', 10);
  return Number.isFinite(value) ? value : fallback;
}

/**
 * Periodic database housekeeping.
 *
 * Without this the store grows forever (trades/bars/gaps are append-only) and the WAL keeps
 * expanding: a paid service needs a retention policy it can point at in its terms.
 *
 * Ticks and bars have separate windows: ticks dominate disk usage (~85 MB/day/instrument), bars are what
 * the chart replays and cost almost nothing to keep, so STORE_BARS_RETENTION_DAYS defaults to the tick
 * window but can be raised (the Docker image ships 365d) to serve deep history without re-paying the vendor.
 *
 * Knobs: STORE_RETENTION_DAYS (0 = keep everything), STORE_BARS_RETENTION_DAYS (0 = keep every bar),
 * STORE_MAINTENANCE_INTERVAL_MS, STORE_VACUUM (0 = skip the daily VACUUM), STORE_MAINTENANCE_INITIAL_DELAY_MS.
 */
export function startMaintenance(
  options: {
    retentionDays?: number;
    barsRetentionDays?: number;
    intervalMs?: number;
    vacuum?: boolean;
    initialDelayMs?: number;
  } = {}
): MaintenanceHandle {
  const retentionDays = options.retentionDays ?? intFromEnv('STORE_RETENTION_DAYS', 30);
  const barsRetentionDays =
    options.barsRetentionDays ?? intFromEnv('STORE_BARS_RETENTION_DAYS', retentionDays);
  const intervalMs = Math.max(60_000, options.intervalMs ?? intFromEnv('STORE_MAINTENANCE_INTERVAL_MS', 15 * 60_000));
  const vacuumEnabled = options.vacuum ?? process.env.STORE_VACUUM !== '0';
  const initialDelayMs = Math.max(0, options.initialDelayMs ?? intFromEnv('STORE_MAINTENANCE_INITIAL_DELAY_MS', 60_000));

  let lastVacuumDay = -1;
  const dayMs = 24 * 60 * 60 * 1000;

  const runOnce = (now = Date.now()): void => {
    try {
      if (retentionDays > 0 || barsRetentionDays > 0) {
        marketDataStore.purgeOldData(
          retentionDays > 0 ? retentionDays * dayMs : 0,
          barsRetentionDays > 0 ? barsRetentionDays * dayMs : 0
        );
      }
      marketDataStore.purgeExpiredRevocations();
      marketDataStore.checkpointWal();

      const day = Math.floor(now / dayMs);
      if (vacuumEnabled && day !== lastVacuumDay) {
        lastVacuumDay = day;
        marketDataStore.vacuum();
      }

      const stats = marketDataStore.stats();
      metrics.set('deepchart_store_rows', stats.trades, 'Rows currently stored', { table: 'trades' });
      metrics.set('deepchart_store_rows', stats.bars, 'Rows currently stored', { table: 'bars' });
      metrics.set('deepchart_store_rows', stats.gaps, 'Rows currently stored', { table: 'gaps' });
      // Keep the metered-vendor spend gauge warm even before the first pull of the month.
      currentMonthSpend();
      metrics.inc('deepchart_maintenance_runs_total', 'Database maintenance passes completed');
      console.log(
        `[Maintenance] retention(ticks/gaps)=${retentionDays > 0 ? `${retentionDays}d` : 'off'} ` +
          `bars=${barsRetentionDays > 0 ? `${barsRetentionDays}d` : 'off'} ` +
          `vacuum=${vacuumEnabled ? 'daily' : 'off'} rows(trades/bars/gaps)=${stats.trades}/${stats.bars}/${stats.gaps}`
      );
    } catch (err) {
      console.warn(`[Maintenance] pass failed: ${(err as Error).message}`);
    }
  };

  const interval = setInterval(() => runOnce(), intervalMs);
  interval.unref?.();
  const initial = setTimeout(() => runOnce(), initialDelayMs);
  initial.unref?.();

  return {
    stop: () => {
      clearInterval(interval);
      clearTimeout(initial);
    },
    runOnce,
  };
}
