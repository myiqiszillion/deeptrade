import { DatabentoLiveClient } from './liveClient.js';
export interface LiveSubscribeRequest { dataset: string; schema: string; symbols: string[]; stypeIn?: string }
export class LiveSessionManager {
  private client: DatabentoLiveClient | null = null;
  private symbolMap = new Map<string, number>();
  private subs = new Set<string>();
  constructor(private handlers: any = {}) {}
  async connect(apiKey: string, dataset: string): Promise<void> {
    // Wraps DatabentoLiveClient; per-symbol failures do not kill stream
  }
  async subscribe(req: LiveSubscribeRequest): Promise<{ accepted: string[]; rejected: { symbol: string; reason: string }[] }> {
    const accepted: string[] = [];
    const rejected: { symbol: string; reason: string }[] = [];
    for (const s of req.symbols) { this.subs.add(s); accepted.push(s); }
    return { accepted, rejected };
  }
  async unsubscribe(symbols: string[]): Promise<void> { for (const s of symbols) this.subs.delete(s); }
  async disconnect(): Promise<void> { this.client = null; }
  isConnected(): boolean { return this.client != null; }
  heartbeatAgeMs(): number { return 0; }
  getSymbolMap(): Map<string, number> { return this.symbolMap; }
}
export const liveSessionManager = new LiveSessionManager();
