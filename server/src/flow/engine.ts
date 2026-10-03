export interface FlowEvent { symbol: string; side: 'buy'|'sell'; premium: number; size: number; type: 'block'|'sweep'|'large'; timestamp: number; }
export class FlowEngine {
  classify(trade: any): FlowEvent | null {
    const premium = (trade.price ?? 0) * (trade.size ?? 0) * 100;
    if (premium < 10000) return null;
    const type = premium > 100000 ? 'block' : premium > 50000 ? 'sweep' : 'large';
    return { symbol: trade.symbol ?? '', side: trade.side ?? 'unknown', premium, size: trade.size, type, timestamp: trade.timestamp ?? Date.now() };
  }
}
export const flowEngine = new FlowEngine();
