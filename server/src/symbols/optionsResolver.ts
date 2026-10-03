import { symbolEngine } from './engine.js';
export class OptionsSymbolResolver {
  async chain(underlying: string, filters?: { expiration?: string; strike?: number; optionType?: 'call'|'put'; dte?: [number, number] }): Promise<any[]> {
    const recs = await symbolEngine.childrenOf(underlying.toUpperCase() + '.OPT', 'OPRA.PILLAR');
    let out = recs;
    if (filters?.expiration) out = out.filter(r => r.expiration === filters.expiration);
    if (filters?.strike != null) out = out.filter(r => r.strike === filters.strike);
    if (filters?.optionType) out = out.filter(r => r.optionType === filters.optionType);
    return out;
  }
  async subscribeSet(underlying: string, filters?: any): Promise<{ instrumentIds: number[]; rawSymbols: string[]; estimatedCount: number }> {
    const chain = await this.chain(underlying, filters);
    return { instrumentIds: chain.map(c => c.instrumentId), rawSymbols: chain.map(c => c.rawSymbol), estimatedCount: chain.length };
  }
  assertSubscribeBudget(count: number, cap = 500): void {
    if (count > cap) throw new Error(`Subscribe budget exceeded: ${count} > ${cap} — narrow filters or use allowlist.`);
  }
}
export const optionsSymbolResolver = new OptionsSymbolResolver();
