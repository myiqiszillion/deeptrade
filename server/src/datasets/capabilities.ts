interface SymbologyFlags { raw_symbol: boolean; instrument_id: boolean; parent: boolean; continuous: boolean; figi?: boolean; isin?: boolean }
interface SchemaCap { available: boolean; rtype?: number; level?: string; reason?: string }
interface DatasetCaps {
  dataset: string; publisher: string; asset_class: string;
  historical: boolean; live: boolean;
  symbology: SymbologyFlags;
  schemas: Record<string, SchemaCap>;
  notes?: string;
}

const CAPS: Record<string, DatasetCaps> = {
  'OPRA.PILLAR': {
    dataset: 'OPRA.PILLAR', publisher: 'OPRA', asset_class: 'options', historical: true, live: true,
    symbology: { raw_symbol: true, instrument_id: true, parent: true, continuous: false, figi: false, isin: false },
    schemas: {
      trades: { available: true, rtype: 22, level: 'L1' }, mbo: { available: true, rtype: 22, level: 'L3' },
      'mbp-1': { available: true, rtype: 22, level: 'L1' }, 'mbp-10': { available: true, rtype: 22, level: 'L2' },
      tbbo: { available: true, rtype: 22, level: 'L1' }, 'bbo-1s': { available: true, level: 'L1' }, 'bbo-1m': { available: true, level: 'L1' },
      'ohlcv-1s': { available: true, level: 'L1' }, 'ohlcv-1m': { available: true, level: 'L1' },
      definition: { available: true, rtype: 12 }, statistics: { available: true, rtype: 13 }, status: { available: true, rtype: 14 },
    }, notes: 'Parent .OPT; never bulk subscribe OPRA.',
  },
  'DBEQ.BASIC': {
    dataset: 'DBEQ.BASIC', publisher: 'DBEQ', asset_class: 'equities', historical: true, live: true,
    symbology: { raw_symbol: true, instrument_id: true, parent: false, continuous: false, figi: true, isin: true },
    schemas: {
      trades: { available: true }, 'mbp-1': { available: true }, 'ohlcv-1m': { available: true }, 'ohlcv-1d': { available: true },
      definition: { available: true }, statistics: { available: false, reason: 'Not available for DBEQ.BASIC' }, status: { available: true },
    },
  },
  'GLBX.MDP3': {
    dataset: 'GLBX.MDP3', publisher: 'CME', asset_class: 'futures', historical: true, live: true,
    symbology: { raw_symbol: true, instrument_id: true, parent: true, continuous: true, figi: false, isin: false },
    schemas: {
      trades: { available: true }, mbo: { available: true }, 'mbp-1': { available: true }, 'mbp-10': { available: true },
      tbbo: { available: true }, 'ohlcv-1m': { available: true }, definition: { available: true }, statistics: { available: true }, status: { available: true },
    }, notes: 'Continuous ES.c.0 front.',
  },
};

export function supportsSymbology(dataset: string, kind: keyof SymbologyFlags): boolean {
  return Boolean(CAPS[dataset]?.symbology[kind]);
}

export function listDatasets(): DatasetCaps[] { return Object.values(CAPS); }
