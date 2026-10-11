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
      trades: { available: true, rtype: 22, level: 'L1' },
      'cmbp-1': { available: true, level: 'L1' }, 'cbbo-1s': { available: true, level: 'L1' }, 'cbbo-1m': { available: true, level: 'L1' },
      tcbbo: { available: true, level: 'L1' },
      'ohlcv-1s': { available: true, level: 'L1' }, 'ohlcv-1m': { available: true, level: 'L1' },
      'ohlcv-1h': { available: true, level: 'L1' }, 'ohlcv-1d': { available: true, level: 'L1' },
      definition: { available: true, rtype: 12 }, statistics: { available: true, rtype: 13 }, status: { available: true, rtype: 14 },
    }, notes: 'Parent .OPT; never bulk subscribe OPRA.',
  },
  'EQUS.MINI': {
    dataset: 'EQUS.MINI', publisher: 'EQUS', asset_class: 'equities', historical: true, live: true,
    symbology: { raw_symbol: true, instrument_id: true, parent: false, continuous: false, figi: false, isin: false },
    schemas: {
      trades: { available: true }, 'mbp-1': { available: true }, tbbo: { available: true },
      'bbo-1s': { available: true }, 'bbo-1m': { available: true },
      'ohlcv-1s': { available: true }, 'ohlcv-1m': { available: true }, 'ohlcv-1h': { available: true }, 'ohlcv-1d': { available: true },
      definition: { available: true },
      statistics: { available: false, reason: 'Not available for EQUS.MINI' },
      status: { available: false, reason: 'Not available for EQUS.MINI' },
    },
    notes: 'Databento US Equities Mini — subset of consolidated US equity data (since 2023-03-28).',
  },
  'GLBX.MDP3': {
    dataset: 'GLBX.MDP3', publisher: 'CME', asset_class: 'futures', historical: true, live: true,
    symbology: { raw_symbol: true, instrument_id: true, parent: true, continuous: true, figi: false, isin: false },
    schemas: {
      trades: { available: true }, mbo: { available: true }, 'mbp-1': { available: true }, 'mbp-10': { available: true },
      tbbo: { available: true }, 'bbo-1s': { available: true }, 'bbo-1m': { available: true },
      'ohlcv-1s': { available: true }, 'ohlcv-1m': { available: true }, 'ohlcv-1h': { available: true }, 'ohlcv-1d': { available: true },
      'cmbp-1': { available: true }, 'cbbo-1s': { available: true }, 'cbbo-1m': { available: true },
      definition: { available: true }, statistics: { available: true }, status: { available: true },
    }, notes: 'Continuous ES.c.0 front.',
  },
};

export function supportsSymbology(dataset: string, kind: keyof SymbologyFlags): boolean {
  return Boolean(CAPS[dataset]?.symbology[kind]);
}

export function listDatasets(): DatasetCaps[] { return Object.values(CAPS); }
