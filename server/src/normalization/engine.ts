export type NormalizedSchema = 'trades'|'mbo'|'mbp-1'|'mbp-10'|'tbbo'|'bbo'|'cbbo'|'ohlcv-1s'|'ohlcv-1m'|'ohlcv-1h'|'ohlcv-1d'|'definition'|'statistics'|'status';
export interface NormalizedEnvelope<T> {
  dataset: string; schema: NormalizedSchema; instrumentId: number; rawSymbol: string;
  tsEvent: number; tsRecv: number; publisherId: number; payload: T; rawRef?: string;
}
export interface NormalizedTradePayload { price: number; size: number; side: 'buy'|'sell'|'unknown'; }
export interface NormalizedQuotePayload { bidPx: number; askPx: number; bidSz: number; askSz: number; }
export interface NormalizedBookPayload { bids: { price: number; size: number }[]; asks: { price: number; size: number }[]; }
export interface NormalizedBarPayload { open: number; high: number; low: number; close: number; volume: number; }

export class NormalizationEngine {
  normalizeTrade(raw: any, ctx: { dataset: string; schema: NormalizedSchema }): NormalizedEnvelope<NormalizedTradePayload>[] {
    return [{ dataset: ctx.dataset, schema: ctx.schema, instrumentId: raw.instrument_id ?? 0, rawSymbol: raw.raw_symbol ?? raw.symbol ?? '', tsEvent: raw.ts_event ?? Date.now(), tsRecv: Date.now(), publisherId: raw.publisher_id ?? 0, payload: { price: raw.price, size: raw.size, side: raw.side ?? 'unknown' } }];
  }
  normalizeQuote(raw: any, ctx: { dataset: string; schema: NormalizedSchema }): NormalizedEnvelope<NormalizedQuotePayload>[] {
    return [{ dataset: ctx.dataset, schema: ctx.schema, instrumentId: 0, rawSymbol: '', tsEvent: Date.now(), tsRecv: Date.now(), publisherId: 0, payload: { bidPx: raw.bid_px_00 ?? 0, askPx: raw.ask_px_00 ?? 0, bidSz: raw.bid_sz_00 ?? 0, askSz: raw.ask_sz_00 ?? 0 } }];
  }
}
export const normalizationEngine = new NormalizationEngine();
