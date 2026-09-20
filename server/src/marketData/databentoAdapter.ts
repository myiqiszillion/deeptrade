import { FeedHandlers, MarketDataFeed } from './types.js';

/**
 * Databento adapter — FAIL-CLOSED by design.
 *
 * Verified 2026-09: Databento publishes NO official TypeScript/JavaScript client
 * (docs list Python, C++, Rust and HTTP/Raw only; the npm name `databento@0.0.1` is an empty
 * placeholder). Realtime delivery uses DBN — a binary TCP encoding that must be decoded
 * field-exact against the official spec.
 *
 * Project rule: never guess a vendor protocol. Until a spec-verified transport exists, this
 * adapter reports UNAVAILABLE with an explicit reason instead of connecting and pretending.
 *
 * To finish this adapter (mechanical once the spec is at hand — do NOT guess):
 *   1. Obtain the DBN wire spec (record layouts, `ts_event` unit, price scaling constant,
 *      side/action enums, MBO/MBP/Trades schemas, record header flags).
 *   2. Implement the transport + decoder in `databentoTransport.ts`.
 *   3. Map records → the shapes below and hand them to `validateTrade` / `validateDepth`.
 *   4. Flip `DATABENTO_TRANSPORT_READY=1` (or delete this guard) once step 1–3 are verified.
 */
export const DBN_INTEGRATION_CHECKLIST = [
  'Confirm DBN record sizes/offsets for trades and MBP-1/10 from the official spec',
  'Confirm price integer scaling (do not assume 1e-9)',
  'Confirm ts_event unit (ns/us) and convert to epoch milliseconds',
  'Confirm side/action enum codes for aggressor vs passive updates',
  'Confirm snapshot vs delta delivery order and the snapshot-replay requirement',
  'Confirm symbology: map vendor instrument_id -> DeepChart symbol, log the resolved contract',
] as const;

export class DatabentoMarketDataFeed implements MarketDataFeed {
  public readonly provider = 'databento';

  constructor(
    public readonly symbol: string,
    private readonly handlers: FeedHandlers,
    private readonly config: { apiKey?: string; dataset?: string; stypeIn?: string; symbols?: string }
  ) {}

  public isConnected(): boolean {
    return false;
  }

  public async connect(): Promise<void> {
    const missing: string[] = [];
    if (!this.config.apiKey) missing.push('DATABENTO_API_KEY');
    if (!this.config.dataset) missing.push('DATABENTO_DATASET');
    if (!this.config.symbols) missing.push('DATABENTO_SYMBOLS');

    const reason = missing.length
      ? `Databento not configured (missing ${missing.join(', ')})`
      : 'Databento transport not implemented: no official TypeScript client exists and the DBN ' +
        'wire format has not been spec-verified in this project — refusing to guess a protocol';

    console.warn(`[Feed:databento] ${this.symbol}: ${reason}`);
    this.handlers.onStatus({
      state: 'UNAVAILABLE',
      reason,
      provider: this.provider,
      symbol: this.symbol,
      instrumentId: this.config.symbols,
    });
  }

  public async disconnect(): Promise<void> {
    this.handlers.onStatus({
      state: 'UNAVAILABLE',
      reason: 'disconnected',
      provider: this.provider,
      symbol: this.symbol,
    });
  }
}

/** Symbols Databento would serve once the transport lands (configurable via env). */
export const DATABENTO_SYMBOL_MAP: Record<string, string> = {
  ES: 'ES.FUT',
  NQ: 'NQ.FUT',
  YM: 'YM.FUT',
  RTY: 'RTY.FUT',
  GC: 'GC.FUT',
  CL: 'CL.FUT',
  NG: 'NG.FUT',
};
