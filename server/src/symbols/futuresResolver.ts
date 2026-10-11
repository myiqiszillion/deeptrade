import { symbolEngine } from './engine.js';
export class FuturesSymbolResolver {
  async strip(root: string, dataset = 'GLBX.MDP3'): Promise<any[]> {
    return symbolEngine.continuousChain(root.toUpperCase(), dataset);
  }
  async frontMonth(root: string, asOf?: string | number | Date): Promise<any | null> {
    const chain = await this.strip(root);
    if (!chain.length) return null;
    let active = chain;
    if (asOf) {
      const asOfStr = typeof asOf === 'string' ? asOf : (asOf instanceof Date ? asOf.toISOString() : new Date(asOf).toISOString());
      const filtered = chain.filter(c => !c.expiration || c.expiration >= asOfStr);
      if (filtered.length > 0) active = filtered;
    }
    return [...active].sort((a, b) => String(a.expiration).localeCompare(String(b.expiration)))[0];
  }
  async secondMonth(root: string, asOf?: string | number | Date): Promise<any | null> {
    const chain = await this.strip(root);
    if (chain.length < 2) return null;
    let active = chain;
    if (asOf) {
      const asOfStr = typeof asOf === 'string' ? asOf : (asOf instanceof Date ? asOf.toISOString() : new Date(asOf).toISOString());
      const filtered = chain.filter(c => !c.expiration || c.expiration >= asOfStr);
      if (filtered.length >= 2) active = filtered;
    }
    return [...active].sort((a, b) => String(a.expiration).localeCompare(String(b.expiration)))[1];
  }
  async continuousToContract(continuousSymbol: string, asOf?: string | number | Date): Promise<any | null> {
    const root = continuousSymbol.split('.')[0];
    return this.frontMonth(root, asOf);
  }
}
export const futuresSymbolResolver = new FuturesSymbolResolver();
