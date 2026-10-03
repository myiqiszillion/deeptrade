import { DatabentoHttpClient } from './client.js';
import { loadCapabilities, assertCapable } from '../datasets/capabilities.js';
import { marketDataStore } from '../storage/marketDataStore.js';
export class HistoricalEngine {
  constructor(private client = new DatabentoHttpClient()) {}
  async getRange(args: { dataset: string; schema: string; symbols: string[]|string; start: string|Date; end?: string|Date; limit?: number }): Promise<any[]> {
    assertCapable(args.dataset, args.schema);
    return this.client.getHistoricalTrades(args.dataset, Array.isArray(args.symbols)?args.symbols.join(','):args.symbols, args.start as any, args.end as any, args.limit) as any;
  }
  async metadata(dataset: string): Promise<{ dataset: string; available: boolean }> {
    return { dataset, available: true };
  }
}
export const historicalEngine = new HistoricalEngine();
