import { FUTURES_INSTRUMENTS, FuturesInstrument, InstrumentCategory, tickValueFor } from '../futuresConfig.js';
import { InstrumentSpecRow, marketDataStore } from '../storage/marketDataStore.js';
import { DatabentoInstrumentSpec, FetchDefinitionsOptions, fetchDatabentoInstrumentSpecs } from './databentoDefinitions.js';

/**
 * Vendor-driven catalog expansion.
 *
 * `GLBX.MDP3` carries every CME Group product, but the app ships a curated catalog (verified names,
 * categories, underlying index, margins). This module closes the gap: it pulls the vendor's own definition
 * records, stores them, and adds any root the curated catalog does not have yet — so "every instrument the
 * dataset supports" is reachable without guessing a multiplier.
 *
 * Rules that keep the numbers trustworthy:
 *  - Curated entries always win. A disagreement with the vendor is reported (`conflicts`) instead of
 *    silently rewriting a verified spec — wrong tick/point values corrupt P&L, whale notches and footprints.
 *  - Non-USD products are skipped: the app has no FX table anywhere (see docs/DATABENTO.md §3.1).
 *  - Unknown units land in the OTHER category; the picker derives its tabs from the data, so they show up.
 */
export interface InstrumentSyncResult {
  provider: string;
  fetched: number;
  stored: number;
  added: string[];
  skippedNonUsd: string[];
  conflicts: Array<{
    root: string;
    curated: { tickSize: number; pointValue: number };
    vendor: { tickSize: number; pointValue: number; rawSymbol: string };
  }>;
  skipped: Record<string, number>;
  estimateUsd: number | null;
  at: number;
}

/** Map Databento's `unit_of_measure` to a picker category. Ambiguous units become OTHER, never a guess. */
export function categoryFromUnit(unit?: string): InstrumentCategory {
  const value = String(unit || '').toLowerCase();
  if (!value) return 'OTHER';
  if (value.includes('bushel') || value.includes('hundredweight') || value.includes('cwt')) return 'AGRICULTURE';
  if (value.includes('troy ounce') || value.includes('troy oz')) return 'METALS';
  if (
    value.includes('barrel') ||
    value.includes('gallon') ||
    value.includes('mmbtu') ||
    value.includes('mm btu') ||
    value.includes('cubic feet')
  ) {
    return 'ENERGY';
  }
  if (value.includes('index')) return 'INDEX';
  if (value.includes('bitcoin') || value.includes('ether')) return 'CRYPTO';
  if (value.includes('currency')) return 'FX';
  if (value.includes('yield') || value.includes('rate')) return 'RATES';
  if (value.includes('metric ton') || value.includes('tonne') || value.includes('short ton')) return 'METALS';
  return 'OTHER';
}

/** Build a servable instrument from a vendor spec (no margins: unknown, so the UI hides them). */
export function specToInstrument(spec: DatabentoInstrumentSpec): FuturesInstrument {
  const quantity = spec.unitOfMeasureQty;
  const unitLabel = spec.unitOfMeasure ? `${quantity ? `${quantity} ` : ''}${spec.unitOfMeasure}`.trim() : '';
  return {
    symbol: spec.root,
    rootSymbol: spec.root,
    name: unitLabel ? `${spec.root} · ${unitLabel}` : `${spec.root} (${spec.exchange})`,
    category: categoryFromUnit(spec.unitOfMeasure),
    assetClass: 'COMMODITY',
    exchange: spec.exchange,
    tickSize: spec.tickSize,
    pointValue: spec.pointValue,
    tickValue: tickValueFor(spec.pointValue, spec.tickSize),
    initialMargin: 0,
    dayTradingMargin: 0,
    basePrice: 0,
    timezone: 'America/Chicago',
    currency: spec.currency,
    multiplier: spec.pointValue,
    isMicro: false,
    contractType: 'CONTINUOUS',
    sessionScheduleId: `${spec.exchange}_SYNCED`,
  };
}

/**
 * Merge specs into the live catalog: add unknown roots, report disagreements on curated ones.
 * Runs against the in-memory `FUTURES_INSTRUMENTS` map, which every part of the server reads.
 */
export function applySpecsToCatalog(specs: Array<DatabentoInstrumentSpec | InstrumentSpecRow>): {
  added: string[];
  skippedNonUsd: string[];
  conflicts: InstrumentSyncResult['conflicts'];
} {
  const added: string[] = [];
  const skippedNonUsd: string[] = [];
  const conflicts: InstrumentSyncResult['conflicts'] = [];

  for (const spec of specs) {
    const root = String(spec.root || '').toUpperCase();
    if (!root) continue;
    if (String(spec.currency || 'USD').toUpperCase() !== 'USD') {
      skippedNonUsd.push(root);
      continue;
    }

    const existing = FUTURES_INSTRUMENTS[root];
    if (!existing) {
      FUTURES_INSTRUMENTS[root] = specToInstrument(spec as DatabentoInstrumentSpec);
      added.push(root);
      continue;
    }

    if (
      Math.abs(existing.tickSize - spec.tickSize) > 1e-9 ||
      Math.abs(existing.pointValue - spec.pointValue) > 1e-6
    ) {
      conflicts.push({
        root,
        curated: { tickSize: existing.tickSize, pointValue: existing.pointValue },
        vendor: { tickSize: spec.tickSize, pointValue: spec.pointValue, rawSymbol: spec.rawSymbol || root },
      });
    }
  }

  return { added, skippedNonUsd, conflicts };
}

/** Apply specs already persisted in SQLite (no network): called at boot so the catalog survives restarts. */
export function applyStoredVendorSpecs(provider = 'databento'): { added: string[]; skippedNonUsd: string[] } {
  const stored = marketDataStore.listInstrumentSpecs(provider);
  if (stored.length === 0) return { added: [], skippedNonUsd: [] };
  const { added, skippedNonUsd } = applySpecsToCatalog(stored);
  return { added, skippedNonUsd };
}

/** Fetch definitions from Databento, persist them and expand the catalog. One metered, guarded request. */
export async function syncInstrumentsFromDatabento(
  options: FetchDefinitionsOptions = {}
): Promise<InstrumentSyncResult> {
  const provider = 'databento';
  const { specs, skipped, estimateUsd } = await fetchDatabentoInstrumentSpecs(options);
  const stored = specs.length > 0 ? marketDataStore.upsertInstrumentSpecs(provider, specs) : 0;
  const { added, skippedNonUsd, conflicts } = applySpecsToCatalog(specs);

  if (conflicts.length > 0) {
    console.warn(
      `[Instruments] ${conflicts.length} curated instrument(s) disagree with the vendor definition; curated values kept: ` +
        conflicts
          .map(
            (c) =>
              `${c.root} (curated ${c.curated.pointValue}/${c.curated.tickSize} vs vendor ${c.vendor.pointValue}/${c.vendor.tickSize})`
          )
          .join(', ')
    );
  }

  const result: InstrumentSyncResult = {
    provider,
    fetched: specs.length,
    stored,
    added,
    skippedNonUsd,
    conflicts,
    skipped,
    estimateUsd,
    at: Date.now(),
  };

  console.log(
    `[Instruments] Databento sync: ${result.fetched} root(s) from definitions, ${result.stored} stored, ` +
      `${result.added.length} new${result.added.length ? ` (${result.added.slice(0, 12).join(', ')}${result.added.length > 12 ? ', …' : ''})` : ''}, ` +
      `${result.skippedNonUsd.length} non-USD skipped, ${result.conflicts.length} conflict(s)` +
      `${estimateUsd !== null ? `, estimated $${estimateUsd.toFixed(4)}` : ''}`
  );
  return result;
}
