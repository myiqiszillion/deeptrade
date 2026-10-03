export type SymbologyKind = 'raw_symbol'|'instrument_id'|'parent'|'continuous'|'figi'|'isin'|'cusip';
export interface SymbolRecord {
  instrumentId: number; dataset: string; rawSymbol: string; displaySymbol: string;
  asset: string; underlying?: string; securityType: string; exchange: string;
  figi?: string; isin?: string; cusip?: string;
  parentInstrumentId?: number; isContinuous: boolean; expiration?: string; strike?: number; optionType?: string;
}
import { instrumentMaster } from '../instruments/master.js';
import { supportsSymbology } from '../datasets/capabilities.js';
import { marketDataStore } from '../storage/marketDataStore.js';

export class SymbolEngine {
  async resolve(q: { rawSymbol?: string; instrumentId?: number; parent?: string; continuous?: string; figi?: string; isin?: string; dataset?: string }): Promise<SymbolRecord | null> {
    if (q.instrumentId != null) {
      const r = instrumentMaster.getByInstrumentId(q.instrumentId);
      return r ? toRecord(r) : null;
    }
    if (q.rawSymbol && q.dataset) {
      const r = instrumentMaster.getByRawSymbol(q.dataset, q.rawSymbol);
      if (r) return toRecord(r);
    }
    if (q.rawSymbol) {
      // Fallback: option_definitions or instrument_specs
      try {
        const def = (marketDataStore as any).getOptionDefinitions ? null : null;
      } catch {}
    }
    return null;
  }
  toDisplay(rec: SymbolRecord): string { return rec.displaySymbol; }
  toRawSymbol(display: string, dataset: string): string { return display; }
  async childrenOf(parentRaw: string, dataset: string): Promise<SymbolRecord[]> {
    const rows = instrumentMaster.search({ underlying: parentRaw.replace('.OPT','').toUpperCase() });
    return rows.filter(r => r.dataset === dataset).map(toRecord);
  }
  async continuousChain(root: string, dataset: string): Promise<SymbolRecord[]> {
    return instrumentMaster.search({ asset: root.toUpperCase(), dataset }).map(toRecord);
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
  async resolve(req: { symbols: string[]; dataset: string; stypeIn: SymbologyKind; stypeOut: SymbologyKind }): Promise<Map<string, SymbolRecord>> {
    if (!supportsSymbology(req.dataset, req.stypeIn as any) || !supportsSymbology(req.dataset, req.stypeOut as any)) {
      throw new Error(`Symbology ${req.stypeIn}→${req.stypeOut} not available for ${req.dataset}`);
    }
    const m = new Map<string, SymbolRecord>();
    for (const s of req.symbols) {
      const rec = await this.engine.resolve({ rawSymbol: s, dataset: req.dataset });
      if (rec) m.set(s, rec);
    }
    return m;
  }
}
