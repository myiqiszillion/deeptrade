// History provider wired to Databento Historical — replaces defaultHistoryProvider (no-op)
import { DatabentoHttpClient } from '../databento/client.js';
import { resolveDatabentoConfig } from '../databento/config.js';
import type { HistoryProvider } from './marketContext.js';

const CME_ROOTS = ['ES', 'NQ', 'MES', 'MNQ', 'CL', 'GC', 'ZB', 'ZN', 'UB', 'RTY', 'MGC', 'SI', 'HG', 'MCL', 'MNG'];

function getSymbolRoot(symbol: string): string {
  return symbol.toUpperCase().split('.')[0].split('/')[0].replace(/[0-9]+$/, '').replace(/[FGHJKMNQUVXZ]\d{1,2}$/, '');
}

function isDatabentoSupportedSymbol(symbol: string, cfg: ReturnType<typeof resolveDatabentoConfig>): boolean {
  const s = symbol.toUpperCase();
  if (s.includes('.OPT') || s.match(/^[A-Z]{1,6}\d{6}[CP]\d{8}$/)) return true;
  const root = getSymbolRoot(s);
  if (CME_ROOTS.includes(root) || CME_ROOTS.includes(s)) return true;
  return cfg.symbols.includes(s) || cfg.symbols.includes(root);
}

function datasetForSymbol(symbol: string, cfg: ReturnType<typeof resolveDatabentoConfig>): string {
  const s = symbol.toUpperCase();
  if (s.includes('.OPT') || s.match(/^[A-Z]{1,6}\d{6}[CP]\d{8}$/)) return cfg.opraDataset;
  const root = getSymbolRoot(s);
  if (CME_ROOTS.includes(root) || CME_ROOTS.includes(s)) return cfg.cmeDataset;
  return cfg.equitiesDataset;
}

function schemaForBarMinutes(barMinutes: number): 'ohlcv-1s' | 'ohlcv-1m' | 'ohlcv-1h' | 'ohlcv-1d' {
  if (barMinutes <= 1) return 'ohlcv-1m';
  if (barMinutes <= 60) return 'ohlcv-1h';
  return 'ohlcv-1d';
}

export function createDatabentoHistoryProvider(client?: DatabentoHttpClient): HistoryProvider {
  const c = client ?? new DatabentoHttpClient();
  return {
    async fetchBars(symbol, config, options) {
      const cfg = resolveDatabentoConfig();
      if (!isDatabentoSupportedSymbol(symbol, cfg)) {
        return [];
      }

      const dataset = datasetForSymbol(symbol, cfg);
      const schema = schemaForBarMinutes(options.barMinutes);
      const barMs = options.barMinutes * 60_000;

      // Databento historical datasets lag real-time by ~10-15 minutes (or weekend close)
      const maxHistoricalEnd = Date.now() - 15 * 60 * 1000;
      const targetEnd = options.beforeTime > 0 ? Math.min(options.beforeTime, maxHistoricalEnd) : maxHistoricalEnd;
      const end = new Date(targetEnd);
      const start = new Date(end.getTime() - options.elements * barMs - barMs);

      let querySymbol = symbol;
      let stypeIn: string | undefined = undefined;

      if (dataset === cfg.cmeDataset) {
        if (!querySymbol.includes('.')) {
          querySymbol = `${querySymbol}.c.0`;
        }
        if (querySymbol.includes('.c.') || querySymbol.includes('.v.')) {
          stypeIn = 'continuous';
        } else if (querySymbol.endsWith('.FUT')) {
          stypeIn = 'parent';
        }
      }

      try {
        const bars = await c.getHistoricalBars(
          dataset,
          querySymbol,
          schema as any,
          start as any,
          end as any,
          options.elements,
          stypeIn
        );
        return bars;
      } catch (err: any) {
        // 400 symbology / dataset mismatch / 422 range mismatch — return empty cleanly
        const msg = String(err?.message || '');
        if (msg.includes('symbology') || msg.includes('data_end_after_available_end') || String(err?.statusCode) === '400' || String(err?.statusCode) === '422') {
          console.warn(`[HistoryProvider] ${dataset}/${schema} ${querySymbol}: ${msg.slice(0, 180)}`);
          return [];
        }
        throw err;
      }
    },
  };
}
