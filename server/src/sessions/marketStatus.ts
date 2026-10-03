export type MarketStatus = 'trading'|'halt'|'pause'|'auction'|'resume'|'ssr_triggered'|'closed';
export interface StatusEvent { dataset: string; instrumentId?: number; status: MarketStatus; timestamp: number; reason?: string; }
export class MarketStatusEngine {
  private last: Map<string, MarketStatus> = new Map();
  ingest(ev: StatusEvent): void { this.last.set(ev.dataset, ev.status); }
  getStatus(dataset: string): MarketStatus | undefined { return this.last.get(dataset); }
}
export const marketStatusEngine = new MarketStatusEngine();
