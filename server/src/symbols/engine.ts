type SymbologyKind = 'raw_symbol'|'instrument_id'|'parent'|'continuous'|'figi'|'isin'|'cusip';
interface SymbolRecord {
  instrumentId: number; dataset: string; rawSymbol: string; displaySymbol: string;
  asset: string; underlying?: string; securityType: string; exchange: string;
  figi?: string; isin?: string; cusip?: string;
  parentInstrumentId?: number; isContinuous: boolean; expiration?: string; strike?: number; optionType?: string;
}
import { instrumentMaster } from '../instruments/master.js';
import { supportsSymbology } from '../datasets/capabilities.js';
import { marketDataStore } from '../storage/marketDataStore.js';

import { parseOsiSymbol } from '../databento/normalizer.js';

export class SymbolEngine {
  async resolve(q: { rawSymbol?: string; instrumentId?: number; parent?: string; continuous?: string; figi?: string; isin?: string; dataset?: string; asOf?: string | number | Date }): Promise<SymbolRecord | null> {
    if (q.instrumentId != null) {
      const r = instrumentMaster.getByInstrumentId(q.instrumentId, q.dataset, q.asOf);
      return r ? toRecord(r) : null;
    }
    if (q.rawSymbol && q.dataset) {
      const r = instrumentMaster.getByRawSymbol(q.dataset, q.rawSymbol, q.asOf);
      if (r) return toRecord(r);
    }
    if (q.rawSymbol) {
      const norm = q.rawSymbol.toUpperCase();
      const spec = marketDataStore.getInstrumentSpec(q.dataset || 'databento', norm);
      if (spec) {
        return {
          instrumentId: 0,
          dataset: q.dataset || 'GLBX.MDP3',
          rawSymbol: spec.rawSymbol,
          displaySymbol: spec.rawSymbol,
          asset: spec.root,
          underlying: spec.underlying,
          securityType: spec.instrumentClass,
          exchange: spec.exchange,
          isContinuous: true,
          expiration: spec.expiration,
        };
      }
      const osi = parseOsiSymbol(norm);
      if (osi) {
        return {
          instrumentId: 0,
          dataset: 'OPRA.PILLAR',
          rawSymbol: norm,
          displaySymbol: norm,
          asset: osi.underlying,
          underlying: osi.underlying,
          securityType: 'O',
          exchange: 'OPRA',
          isContinuous: false,
          expiration: osi.expiration,
          strike: osi.strike,
          optionType: osi.type,
        };
      }
    }
    return null;
  }
  toDisplay(rec: SymbolRecord): string { return rec.displaySymbol; }
  toRawSymbol(display: string, dataset: string): string { return display; }
  async childrenOf(parentRaw: string, dataset: string): Promise<SymbolRecord[]> {
    const underlying = parentRaw.replace('.OPT','').toUpperCase();
    const rows = instrumentMaster.search({ underlying });
    const matched = rows.filter(r => r.dataset === dataset).map(toRecord);
    if (matched.length > 0) return matched;

    const defs = marketDataStore.getOptionDefinitions(underlying);
    if (defs.length > 0) {
      return defs.map((d, idx) => ({
        instrumentId: d.instrumentId || idx + 1,
        dataset,
        rawSymbol: d.symbol,
        displaySymbol: d.symbol,
        asset: d.underlying,
        underlying: d.underlying,
        securityType: 'O',
        exchange: 'OPRA',
        isContinuous: false,
        expiration: d.expiration,
        strike: d.strike,
        optionType: d.type,
      }));
    }
    return [];
  }
  async continuousChain(root: string, dataset: string): Promise<SymbolRecord[]> {
    const rows = instrumentMaster.search({ asset: root.toUpperCase(), dataset });
    if (rows.length > 0) return rows.map(toRecord);
    const specs = marketDataStore.listInstrumentSpecs('databento').filter(s => s.root === root.toUpperCase());
    if (specs.length > 0) {
      return specs.map((s, idx) => ({
        instrumentId: idx + 1,
        dataset,
        rawSymbol: s.rawSymbol,
        displaySymbol: s.rawSymbol,
        asset: s.root,
        underlying: s.underlying,
        securityType: s.instrumentClass,
        exchange: s.exchange,
        isContinuous: true,
        expiration: s.expiration,
      }));
    }
    return [];
  }
}
function toRecord(r: any): SymbolRecord {
  return {
    instrumentId: r.instrumentId, dataset: r.dataset, rawSymbol: r.rawSymbol, displaySymbol: r.rawSymbol.trim(),
    asset: r.asset, underlying: r.underlying, securityType: r.securityType, exchange: r.exchange,
    figi: r.figi, isin: r.isin, cusip: r.cusip, parentInstrumentId: r.parentInstrumentId,
    isContinuous: r.isContinuous, expiration: r.expiration, strike: r.strike, optionType: r.optionType,
  };
}
export const symbolEngine = new SymbolEngine();

export class SymbologyResolver {
  constructor(private engine: SymbolEngine = symbolEngine) {}
  async resolve(req: { symbols: string[]; dataset: string; stypeIn: SymbologyKind; stypeOut: SymbologyKind; asOf?: string | number | Date }): Promise<Map<string, SymbolRecord>> {
    if (!supportsSymbology(req.dataset, req.stypeIn as any) || !supportsSymbology(req.dataset, req.stypeOut as any)) {
      throw new Error(`Symbology ${req.stypeIn}→${req.stypeOut} not available for ${req.dataset}`);
    }
    const m = new Map<string, SymbolRecord>();
    for (const s of req.symbols) {
      const rec = await this.engine.resolve({ rawSymbol: s, dataset: req.dataset, asOf: req.asOf });
      if (rec) m.set(s, rec);
    }
    return m;
  }
}
