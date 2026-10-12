import net from 'node:net';
import { randomUUID, createHash } from 'node:crypto';
import { DatabentoLiveClient, ParsedDbnRecord } from '../databento/liveClient.js';
import { MarketContext } from '../marketData/marketContext.js';
import { getOrRegisterInstrument } from '../futuresConfig.js';
import { MarketTrade } from '../marketData/types.js';

export type AcceptanceState = 'IDLE' | 'CONNECTING' | 'AUTHENTICATED' | 'ACKNOWLEDGED' | 'RECEIVING' | 'TERMINATING' | 'CLOSED' | 'FAILED';
export interface TradeTrace {
  traceId: string; dataset: 'GLBX.MDP3'; schema: 'trades'; instrumentId: number;
  resolvedContract: string; eventTimestampNs: string; vendorReceiveTimestampNs: string | null;
  localReceiveTimestamp: number; price: number | null; size: number | null;
  rawSide: string | null; normalizedSide: string | null; sequence: number | null;
  sequenceScope: 'NOT CAPTURED'; source: 'DATABENTO_LIVE' | 'OFFLINE_FIXTURE';
  outcome: 'REJECTED' | 'ACCEPTED' | 'DEDUPLICATED'; signedContribution: number;
  outcomeReason: string;
  analytics?: { volumeContribution: number; priceBin: number; footprintVolume: number; profileVolume: number; cvd: number };
}
export function snapshotDigest(snapshot: unknown): string {
  return createHash('sha256').update(JSON.stringify(snapshot)).digest('hex');
}

/** No HTTP start method. One controller owns one fresh production context and TCP socket. */
export class ControlledTradesSession {
  private static lease: ControlledTradesSession | undefined;
  readonly sessionId = randomUUID();
  readonly traces: TradeTrace[] = [];
  private currentState: AcceptanceState = 'IDLE';
  readonly lifecycle: { state: AcceptanceState; localTimestamp: number }[] = [{ state: 'IDLE', localTimestamp: Date.now() }];
  get state() { return this.currentState; }
  private set state(value: AcceptanceState) {
    if (value !== this.currentState) this.lifecycle.push({ state: value, localTimestamp: Date.now() });
    this.currentState = value;
  }
  reason = '';
  metadata = false;
  ackCount = 0;
  gatewayErrors = 0;
  private timer?: ReturnType<typeof setTimeout>;
  private client?: DatabentoLiveClient;
  readonly context: MarketContext;
  private current?: TradeTrace;
  private finished = false;
  private volume = 0;
  private accepted = 0;
  private publicationCount = 0;
  private timerStarted = 0;
  readonly done: Promise<void>;
  private resolveDone!: () => void;

  constructor(private options: {
    apiKey: string; instrumentId: number; resolvedContract: string;
    offline?: boolean; createConnection?: typeof net.createConnection;
    normalFanout?: boolean;
    deadlineClock?: { set: (callback: () => void, delay: number) => ReturnType<typeof setTimeout>; clear: (timer: ReturnType<typeof setTimeout>) => void };
    durationMs?: number; maxRecords?: number;
    publish?: (message: ReturnType<ControlledTradesSession['message']>) => void;
    onClosed?: () => void;
  }) {
    if (!Number.isInteger(options.instrumentId) || options.instrumentId <= 0 || !/^ES[HMUZ]\d{1,2}$/.test(options.resolvedContract)) throw new Error('Date-valid ES mapping required');
    if (options.createConnection && !options.offline) throw new Error('Injected transport is offline-only');
    if (options.deadlineClock && !options.offline) throw new Error('Injected clock is offline-only');
    if (!Number.isInteger(options.durationMs ?? 30000) || (options.durationMs ?? 30000) <= 0 || (options.durationMs ?? 30000) > 30000 ||
        !Number.isInteger(options.maxRecords ?? 50) || (options.maxRecords ?? 50) < 1 || (options.maxRecords ?? 50) > 50) throw new Error('Unsafe acceptance budget');
    this.done = new Promise(resolve => { this.resolveDone = resolve; });
    this.context = new MarketContext('ES', getOrRegisterInstrument('ES'), undefined, undefined, {
      fetchBars: async () => { throw new Error('Acceptance prohibits historical'); },
      fetchTicks: async () => { throw new Error('Acceptance prohibits historical'); },
    }, {
      normalFanout: options.normalFanout,
      createFeed: handlers => {
        if (this.client) throw new Error('Exactly one vendor connection');
        this.client = new DatabentoLiveClient({ symbol: 'ES.c.0', dataset: 'GLBX.MDP3', schema: 'trades', apiKey: options.apiKey,
          handlers: { ...handlers, onStatus: s => { if (s.state !== 'LIVE') handlers.onStatus(s); },
            onError: () => { this.finish('FAILED', 'Transport error'); } },
          acceptance: {
            createConnection: options.createConnection,
            onStage: stage => {
              if (this.finished) return;
              if (stage === 'METADATA') this.metadata = true;
              else if (stage === 'ACKNOWLEDGED') {
                if (this.state !== 'AUTHENTICATED' || !this.metadata || this.ackCount) { this.finish('FAILED', 'Unexpected ACK'); return; }
                this.ackCount++; this.state = 'ACKNOWLEDGED';
              }
              else this.state = 'AUTHENTICATED';
            },
            onFailure: reason => this.finish('FAILED', reason),
            beforeRecord: (record, parsed) => this.beforeRecord(record, parsed),
          },
        });
        return this.client;
      },
      onOutcome: (trade, outcome) => this.outcome(trade, outcome),
    });
  }

  async start(): Promise<void> {
    if (this.state !== 'IDLE' || ControlledTradesSession.lease) throw new Error('Acceptance session already started/leased');
    ControlledTradesSession.lease = this;
    this.state = 'CONNECTING';
    this.timerStarted = Date.now();
    this.timer = (this.options.deadlineClock?.set ?? setTimeout)(() => this.finish(this.ackCount && this.accepted ? 'CLOSED' : 'FAILED',
      !this.ackCount ? 'NO_ACK_TIMEOUT' : !this.accepted ? 'ZERO_RECORDS_TIMEOUT' : 'TIMEOUT'), this.options.durationMs ?? 30000);
    try { await this.context.startFeed(); } catch { this.finish('FAILED', 'Startup failed'); }
  }

  private beforeRecord(record: Buffer, parsed: ParsedDbnRecord | null): boolean {
    if (this.finished) return false;
    if (parsed?.error) this.gatewayErrors++;
    if (record[1] !== 0) {
      if ([1, 10].includes(record[1])) { this.finish('FAILED', 'Unexpected market schema'); return false; }
      return true;
    }
    if (this.traces.length >= (this.options.maxRecords ?? 50)) { this.finish('FAILED', 'Budget overrun'); return false; }
    const validLength = record.length >= 48;
    const trade = parsed?.trade;
    const trace: TradeTrace = {
      traceId: `${this.sessionId}:${this.traces.length + 1}`, dataset: 'GLBX.MDP3', schema: 'trades',
      instrumentId: record.readUInt32LE(4), resolvedContract: this.options.resolvedContract,
      eventTimestampNs: record.readBigUInt64LE(8).toString(),
      vendorReceiveTimestampNs: validLength ? record.readBigUInt64LE(32).toString() : null,
      localReceiveTimestamp: Date.now(), price: trade?.price ?? null, size: trade?.size ?? null,
      rawSide: validLength ? String.fromCharCode(record[29]) : null, normalizedSide: trade?.side ?? null,
      sequence: validLength ? record.readUInt32LE(44) : null, sequenceScope: 'NOT CAPTURED',
      source: this.options.offline ? 'OFFLINE_FIXTURE' : 'DATABENTO_LIVE', outcome: 'REJECTED', signedContribution: 0,
      outcomeReason: trade ? 'PENDING_VALIDATION' : 'DECODER_REJECTED',
    };
    this.traces.push(trace); this.current = trace;
    if (!this.ackCount) { this.finish('FAILED', 'Market record before ACK'); return false; }
    if (trace.instrumentId !== this.options.instrumentId) { this.finish('FAILED', 'Instrument mismatch'); return false; }
    this.state = 'RECEIVING';
    if (trade) {
      trade.id = `${this.sessionId}:${createHash('sha256').update(record).digest('hex')}`;
      trade.receiveTs = trace.localReceiveTimestamp;
      if (this.options.offline) trade.sourceProvider = 'fixture';
      if (trade.side === 'UNKNOWN') trade.aggressorProvenance = 'UNKNOWN';
    } else if (this.traces.length === (this.options.maxRecords ?? 50)) {
      this.finish(this.accepted ? 'CLOSED' : 'FAILED', 'RECORD_CAP'); return false;
    }
    if (this.traceBytes() > 1024 * 1024) { this.finish('FAILED', 'Trace byte budget'); return false; }
    return true;
  }

  private outcome(trade: MarketTrade, outcome: TradeTrace['outcome']) {
    if (this.finished || !this.current) return;
    this.current.outcome = outcome;
    this.current.outcomeReason = outcome === 'ACCEPTED' ? 'VALID_COHORT_TRADE' : outcome === 'DEDUPLICATED' ? 'IDENTICAL_VENDOR_RECORD' : 'MARKET_CONTEXT_VALIDATION';
    if (outcome === 'ACCEPTED') {
      this.accepted++; this.volume += trade.size;
      this.current.signedContribution = trade.side === 'BUY' ? trade.size : trade.side === 'SELL' ? -trade.size : 0;
    }
    const snapshot = this.context.acceptanceSnapshot();
    this.current.analytics = { volumeContribution: outcome === 'ACCEPTED' ? trade.size : 0,
      priceBin: Math.round(trade.price / 0.25) * 0.25,
      footprintVolume: snapshot.bars.reduce((n, bar) => n + bar.volume, 0),
      profileVolume: snapshot.profile.totalVolume, cvd: snapshot.bars.at(-1)?.cvd ?? 0 };
    this.publish(false);
    if (this.traces.length >= (this.options.maxRecords ?? 50)) this.finish('CLOSED', 'RECORD_CAP');
  }

  message(final: boolean) {
    const snapshot = this.context.acceptanceSnapshot();
    return { type: 'ACCEPTANCE' as const, sessionId: this.sessionId, symbol: 'ES' as const,
      dataset: 'GLBX.MDP3' as const, schema: 'trades' as const,
      instrumentId: this.options.instrumentId, resolvedContract: this.options.resolvedContract,
      source: this.options.offline ? 'OFFLINE_FIXTURE' : 'DATABENTO_LIVE', coverage: 'PARTIAL' as const,
      state: this.state, reason: this.reason, lifecycle: this.lifecycle, final, watermark: this.traces.length,
      metadataReceived: this.metadata, ackCount: this.ackCount, gatewayErrors: this.gatewayErrors,
      feedStatus: this.context.feedStatus,
      acceptedCount: this.accepted, acceptedVolume: this.volume,
      unknownVolume: this.traces.filter(t => t.outcome === 'ACCEPTED' && t.normalizedSide === 'UNKNOWN').reduce((n, t) => n + (t.size ?? 0), 0),
      signedContributions: this.traces.map(t => t.signedContribution), snapshot, digest: snapshotDigest(snapshot),
      elapsedMs: this.timerStarted ? Date.now() - this.timerStarted : 0,
    };
  }
  private publish(final: boolean) {
    if (++this.publicationCount > 100) { this.finish('FAILED', 'Publication budget'); return; }
    this.options.publish?.(this.message(final));
  }
  traceBytes() { return Buffer.byteLength(JSON.stringify(this.traces)); }

  finish(state: 'CLOSED' | 'FAILED' = 'FAILED', reason = 'Operator stop') {
    if (this.finished) return;
    this.finished = true; this.state = 'TERMINATING'; this.reason = reason;
    if (this.timer) { (this.options.deadlineClock?.clear ?? clearTimeout)(this.timer); this.timer = undefined; }
    // disconnect synchronously destroys TCP before final analytics publication.
    void this.client?.disconnect();
    this.context.flushAcceptanceTerminal();
    this.context.feedReason = reason;
    this.context.setFeedStatus('UNAVAILABLE');
    this.state = state;
    this.publish(true);
    ControlledTradesSession.lease = undefined;
    this.options.onClosed?.();
    this.resolveDone();
  }
}
