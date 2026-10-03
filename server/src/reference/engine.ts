export interface ReferenceRecord { instrumentId: number; rawSymbol: string; dataset: string; securityType: string; asset: string; exchange: string; tickSize: number; multiplier: number; }
export class ReferenceEngine {
  async definitions(dataset: string, symbols?: string[]): Promise<ReferenceRecord[]> { return []; }
  async symbologyResolve(dataset: string, symbols: string[], stypeIn: string, stypeOut: string): Promise<Map<string,string>> { return new Map(); }
}
export const referenceEngine = new ReferenceEngine();
