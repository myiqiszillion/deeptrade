import { symbolEngine } from './engine.js';
export class FuturesSymbolResolver {
  async strip(root: string, dataset = 'GLBX.MDP3'): Promise<any[]> {
    return symbolEngine.continuousChain(root.toUpperCase(), dataset);
  }
  async frontMonth(root: string): Promise<any | null> {
    const chain = await this.strip(root);
    if (!chain.length) return null;
    return [...chain].sort((a,b) => String(a.expiration).localeCompare(String(b.expiration)))[0];
  }
  async secondMonth(root: string): Promise<any | null> {
    const chain = await this.strip(root);
    if (chain.length < 2) return null;
    return [...chain].sort((a,b) => String(a.expiration).localeCompare(String(b.expiration)))[1];
  }
  async continuousToContract(continuousSymbol: string): Promise<any | null> {
    const root = continuousSymbol.split('.')[0];
    return this.frontMonth(root);
  }
}
export const futuresSymbolResolver = new FuturesSymbolResolver();
