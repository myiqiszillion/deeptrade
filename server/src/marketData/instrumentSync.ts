/**
 * Instrument Registry Sync
 *
 * Pulls instrument definitions from Databento (schema=definition) for each
 * configured dataset and upserts into marketDataStore.instrument_specs.
 * No hard-coded symbols — hierarchy: dataset → venue → symbol → security type → expiry/strike.
 */

import { DatabentoHttpClient } from '../databento/client.js';
import { resolveDatabentoConfig } from '../databento/config.js';
import { DbDefinitionRecord } from '../databento/types.js';
import { parsePrice } from '../databento/normalizer.js';
import { InstrumentSpecRow, marketDataStore } from '../storage/marketDataStore.js';

export interface SyncResult {
  provider: string;
  synced: boolean;
  total: number;
  perDataset: Record<string, number>;
  at: number;
  errors: string[];
}

const DATASET_META: Record<string, { exchange: string; instrumentClass: string }> = {
  'GLBX.MDP3': { exchange: 'CME', instrumentClass: 'F' },
  'OPRA.PILLAR': { exchange: 'OPRA', instrumentClass: 'O' },
  'DBEQ.BASIC': { exchange: 'XNAS', instrumentClass: 'S' },
  'XNAS.ITCH': { exchange: 'XNAS', instrumentClass: 'S' },
};

function toSpecRows(records: DbDefinitionRecord[], dataset: string): InstrumentSpecRow[] {
  const meta = DATASET_META[dataset] || { exchange: 'UNKNOWN', instrumentClass: 'S' };
  const rows: InstrumentSpecRow[] = [];
  for (const r of records) {
    const rawSymbol = r.raw_symbol || r.symbol || '';
    if (!rawSymbol) continue;
    const root = rawSymbol.split('.')[0].replace(/\s+/g, '').toUpperCase() || rawSymbol.toUpperCase();
    rows.push({
      root,
      rawSymbol,
      exchange: meta.exchange,
      currency: r.currency || 'USD',
      instrumentClass: r.instrument_class || meta.instrumentClass,
      pointValue: 1,
      tickSize: r.min_price_increment !== undefined ? parsePrice(r.min_price_increment as any) || 0.01 : 0.01,
      tickValue: 0.01,
      underlying: r.underlying_symbol,
      expiration: r.expiration ? String(r.expiration) : undefined,
      updatedAt: Date.now(),
    });
  }
  return rows;
}

export async function syncInstrumentSpecs(
  client?: DatabentoHttpClient,
  store = marketDataStore,
): Promise<SyncResult> {
  const cfg = resolveDatabentoConfig();
  const httpClient = client || new DatabentoHttpClient();
  const datasets = [cfg.cmeDataset, cfg.opraDataset, cfg.equitiesDataset].filter(Boolean);
  // dedupe
  const unique = [...new Set(datasets)];

  const perDataset: Record<string, number> = {};
  const errors: string[] = [];
  let total = 0;

  if (!httpClient.configured) {
    return { provider: 'databento', synced: false, total: 0, perDataset, at: Date.now(), errors: ['not configured (DATABENTO_API_KEY missing)'] };
  }

  for (const dataset of unique) {
    try {
      const records = await httpClient.request<DbDefinitionRecord>('/timeseries.get_range', {
        dataset,
        schema: 'definition',
        limit: 5000,
      }, { dataset });
      const rows = toSpecRows(records, dataset);
      const deduped = dedupeByRoot(rows);
      const written = store.upsertInstrumentSpecs('databento', deduped);
      perDataset[dataset] = written;
      total += written;
    } catch (err: any) {
      const msg = `${dataset}: ${err?.message || String(err)}`;
      errors.push(msg);
      perDataset[dataset] = 0;
    }
  }

  return { provider: 'databento', synced: errors.length < unique.length, total, perDataset, at: Date.now(), errors };
}

function dedupeByRoot(rows: InstrumentSpecRow[]): InstrumentSpecRow[] {
  const map = new Map<string, InstrumentSpecRow>();
  for (const r of rows) {
    if (!map.has(r.root)) map.set(r.root, r);
  }
  return [...map.values()];
}
