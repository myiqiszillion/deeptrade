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

import { instrumentMaster, InstrumentMasterRecord } from '../instruments/master.js';
import { getOrRegisterInstrument } from '../futuresConfig.js';

function parseDbFixedPoint(val: any, fallback: number): number {
  if (val === undefined || val === null || val === '') return fallback;
  const str = String(val).trim();
  if (
    str === '9223372036854775807' ||
    str === '2147483647' ||
    str.startsWith('922337203685477')
  ) {
    return fallback;
  }
  const num = Number(str);
  if (!Number.isFinite(num) || num <= 0 || num === 2147483647 || num > 9e17) return fallback;
  if (str.includes('.')) {
    return num > 1e7 ? fallback : num;
  }
  const scaled = num / 1e9;
  if (scaled > 1e7 || scaled <= 0) return fallback;
  return Number(scaled.toFixed(9));
}

function parseDbTickSize(val: any, fallback = 0.01): number {
  const parsed = parseDbFixedPoint(val, fallback);
  if (parsed <= 0 || parsed > 1000) return fallback;
  return parsed;
}

function toSpecRows(records: DbDefinitionRecord[], dataset: string): InstrumentSpecRow[] {
  const meta = DATASET_META[dataset] || { exchange: 'UNKNOWN', instrumentClass: 'S' };
  const rows: InstrumentSpecRow[] = [];
  for (const r of records) {
    const rawSymbol = r.raw_symbol || r.symbol || '';
    if (!rawSymbol) continue;
    const asset = (r as any).asset ? String((r as any).asset).trim().toUpperCase() : '';
    const root = asset || rawSymbol.split('.')[0].replace(/\s+/g, '').toUpperCase() || rawSymbol.toUpperCase();
    const tickSize = parseDbTickSize(r.min_price_increment, meta.instrumentClass === 'F' ? 0.25 : 0.01);
    
    // Resolve pointValue: check unit_of_measure_qty first, then contract_multiplier
    let pointValue = 1;
    if ((r as any).unit_of_measure_qty !== undefined) {
      const uom = parseDbFixedPoint((r as any).unit_of_measure_qty, 0);
      if (uom > 0 && uom < 1e7) {
        pointValue = uom;
      }
    }
    if (pointValue === 1 && r.contract_multiplier) {
      const mult = Number(r.contract_multiplier);
      if (mult > 0 && mult < 1e7 && mult !== 2147483647) {
        pointValue = mult;
      }
    }
    if (pointValue === 1 && meta.instrumentClass === 'F') {
      pointValue = 50; // Standard fallback
    }

    const tickValue = Number((pointValue * tickSize).toFixed(10));
    rows.push({
      root,
      rawSymbol,
      exchange: (r as any).exchange || meta.exchange,
      currency: r.currency || 'USD',
      instrumentClass: r.instrument_class || meta.instrumentClass,
      pointValue,
      tickSize,
      tickValue,
      unitOfMeasure: (r as any).unit_of_measure,
      unitOfMeasureQty: (r as any).unit_of_measure_qty !== undefined ? Number((r as any).unit_of_measure_qty) : undefined,
      underlying: r.underlying_symbol,
      expiration: r.expiration ? String(r.expiration) : undefined,
      activation: (r as any).activation ? String((r as any).activation) : undefined,
      updatedAt: Date.now(),
    });
  }
  return rows;
}

const DEFAULT_DATASET_PARAMS: Record<string, Record<string, any>> = {
  'GLBX.MDP3': {
    symbols: 'ES.FUT,NQ.FUT,YM.FUT,RTY.FUT,CL.FUT,GC.FUT,SI.FUT,HG.FUT,NG.FUT,ZB.FUT,ZN.FUT,ZF.FUT,ZT.FUT,6E.FUT,6J.FUT,6B.FUT,BTC.FUT',
    stype_in: 'parent',
  },
  'OPRA.PILLAR': {
    symbols: 'SPY.OPT',
    stype_in: 'parent',
  },
  'DBEQ.BASIC': {
    symbols: 'SPY,QQQ,AAPL,NVDA,TSLA,MSFT,AMZN',
  },
  'XNAS.ITCH': {
    symbols: 'SPY,QQQ,AAPL,NVDA,TSLA,MSFT,AMZN',
  },
};

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

  store.purgeInvalidInstrumentSpecs();

  const today = new Date();
  const threeDaysAgo = new Date(Date.now() - 3 * 24 * 3600 * 1000);
  const startStr = threeDaysAgo.toISOString().split('T')[0];
  const endStr = today.toISOString().split('T')[0];

  for (const dataset of unique) {
    const meta = DATASET_META[dataset] || { exchange: 'UNKNOWN', instrumentClass: 'S' };
    const extraParams = DEFAULT_DATASET_PARAMS[dataset] || {};
    try {
      const records = await httpClient.request<DbDefinitionRecord>('/timeseries.get_range', {
        dataset,
        schema: 'definition',
        start: startStr,
        end: endStr,
        limit: 5000,
        ...extraParams,
      }, { dataset });
      const rows = toSpecRows(records, dataset);
      const deduped = dedupeByRoot(rows);
      const written = store.upsertInstrumentSpecs('databento', deduped);
      perDataset[dataset] = written;
      total += written;

      const masterRecords: InstrumentMasterRecord[] = records.map((r, idx) => {
        const rawSymbol = r.raw_symbol || r.symbol || '';
        const asset = (r as any).asset ? String((r as any).asset).trim().toUpperCase() : '';
        const root = asset || rawSymbol.split('.')[0].replace(/\s+/g, '').toUpperCase() || rawSymbol.toUpperCase();
        const tickSize = parseDbFixedPoint(r.min_price_increment, 0.01);
        
        let multiplier = 1;
        if ((r as any).unit_of_measure_qty !== undefined) {
          const uom = parseDbFixedPoint((r as any).unit_of_measure_qty, 0);
          if (uom > 0 && uom < 1e7) multiplier = uom;
        }
        if (multiplier === 1 && r.contract_multiplier) {
          const mult = Number(r.contract_multiplier);
          if (mult > 0 && mult < 1e7 && mult !== 2147483647) multiplier = mult;
        }
        if (multiplier === 1 && meta.instrumentClass === 'F') multiplier = 50;

        return {
          instrumentId: r.instrument_id ?? idx + 1,
          dataset,
          publisherId: (r as any).publisher_id ?? 1,
          rawSymbol,
          securityType: r.instrument_class || meta.instrumentClass,
          asset: root,
          underlying: r.underlying_symbol,
          exchange: (r as any).exchange || meta.exchange,
          activation: (r as any).activation ? String((r as any).activation) : undefined,
          expiration: r.expiration ? String(r.expiration) : undefined,
          strike: r.strike_price !== undefined ? parsePrice(r.strike_price as any) : undefined,
          optionType: r.instrument_class === 'O' ? (rawSymbol.includes('C') ? 'call' : 'put') : undefined,
          currency: r.currency || 'USD',
          tickSize,
          multiplier,
          isContinuous: Boolean(rawSymbol.includes('.c.')),
          continuousRoot: root,
        };
      });
      instrumentMaster.upsert(masterRecords);

      for (const row of deduped) {
        getOrRegisterInstrument(row.root);
      }
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
