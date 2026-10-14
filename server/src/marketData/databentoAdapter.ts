import { FUTURES_INSTRUMENTS } from '../futuresConfig.js';
import { DatabentoSocketFactory, DatabentoTransport } from './databentoTransport.js';
import { FeedConnectionState, FeedHandlers, MarketDataFeed } from './types.js';
import { validateDepth, validateTrade } from './validate.js';

export interface DatabentoAdapterConfig {
  apiKey?: string;
  dataset?: string;
  stypeIn?: string;
  symbols?: string;
  host?: string;
  port?: number;
}

export interface DatabentoAdapterOptions {
  socketFactory?: DatabentoSocketFactory;
}

/**
 * DeepChart symbol -> Databento continuous front-month symbol (`ES.c.0` = calendar front month).
 * `DATABENTO_SYMBOLS` overrides this for a single instrument (e.g. `ESZ6` with stype_in=raw_symbol).
 */
export const DATABENTO_SYMBOL_MAP: Record<string, string> = {
  ES: 'ES.c.0',
  MES: 'MES.c.0',
  NQ: 'NQ.c.0',
  MNQ: 'MNQ.c.0',
  YM: 'YM.c.0',
  MYM: 'MYM.c.0',
  RTY: 'RTY.c.0',
  M2K: 'M2K.c.0',
  GC: 'GC.v.0',
  MGC: 'MGC.c.0',
  CL: 'CL.c.0',
  MCL: 'MCL.c.0',
  NG: 'NG.c.0',
  ZB: 'ZB.c.0',
  ZN: 'ZN.c.0',
};

/** Resolve the vendor symbol and its symbol type for a DeepChart instrument. */
export function resolveDatabentoSymbol(
  symbol: string,
  config: { symbols?: string; stypeIn?: string } = {}
): { vendorSymbol: string; stypeIn: string } {
  let vendorSymbol = DATABENTO_SYMBOL_MAP[symbol] || `${symbol}.c.0`;
  if (config.symbols && config.symbols.trim().length > 0) {
    vendorSymbol = config.symbols.trim();
  }

  let stypeIn = config.stypeIn || 'continuous';
  if (vendorSymbol.includes('.c.') || vendorSymbol.includes('.v.')) {
    stypeIn = 'continuous';
  } else if (vendorSymbol.endsWith('.FUT')) {
    stypeIn = 'parent';
  }

  return { vendorSymbol, stypeIn };
}

/**
 * REAL CME market data over the Databento Live API (dataset `GLBX.MDP3`).
 *
 * Fail-closed: without an API key the feed reports UNAVAILABLE with an explicit reason and never
 * invents data. Every record passes through `validateTrade` / `validateDepth` before an engine sees
 * it, and LIVE is only reported once the first VALIDATED record arrives (never on socket open).
 */
export class DatabentoMarketDataFeed implements MarketDataFeed {
  public readonly provider = 'databento';
  private transport: DatabentoTransport | null = null;
  private connectionState: FeedConnectionState = 'UNAVAILABLE';
  private liveWaiters: (() => void)[] = [];
  private resolvedSymbol = '';

  constructor(
    public readonly symbol: string,
    private readonly handlers: FeedHandlers,
    private readonly config: DatabentoAdapterConfig = {},
    private readonly options: DatabentoAdapterOptions = {}
  ) {}

  public isConnected(): boolean {
    return this.connectionState === 'LIVE';
  }

  public get vendorSymbol(): string {
    return this.resolvedSymbol;
  }

  /** Resolve once a validated CME record arrived; rejects honestly on timeout. */
  public waitForLive(timeoutMs = 15000): Promise<void> {
    if (this.connectionState === 'LIVE') return Promise.resolve();
    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.liveWaiters = this.liveWaiters.filter((w) => w !== onLive);
        reject(new Error(`no validated Databento market data for ${this.symbol} within ${timeoutMs}ms`));
      }, timeoutMs);
      const onLive = () => {
        clearTimeout(timer);
        resolve();
      };
      this.liveWaiters.push(onLive);
    });
  }


  public async connect(): Promise<void> {
    const dataset = this.config.dataset || process.env.DATABENTO_DATASET || 'GLBX.MDP3';
    const { vendorSymbol, stypeIn } = resolveDatabentoSymbol(this.symbol, this.config);
    this.resolvedSymbol = vendorSymbol;

    // Fail closed with an actionable reason instead of pretending to connect.
    if (!this.config.apiKey) {
      this.reportUnavailable('Databento not configured (missing DATABENTO_API_KEY)', vendorSymbol);
      return;
    }
    if (process.env.DATABENTO_TRANSPORT_READY === '0') {
      this.reportUnavailable('Databento transport disabled by DATABENTO_TRANSPORT_READY=0', vendorSymbol);
      return;
    }

    const tickSize = (FUTURES_INSTRUMENTS[this.symbol] || FUTURES_INSTRUMENTS.ES)?.tickSize ?? 0.25;

    this.transport = new DatabentoTransport(
      {
        apiKey: this.config.apiKey,
        dataset,
        symbols: vendorSymbol,
        stypeIn,
        host: this.config.host,
        port: this.config.port,
      },
      {
        onTrade: (rawTrade) => {
          const { trade } = validateTrade({ ...rawTrade, symbol: this.symbol }, tickSize, this.symbol);
          if (!trade) return;
          this.markLive();
          this.handlers.onTrade(trade);
        },
        onDepth: (rawDepth) => {
          // The transport publishes top-of-book snapshots; narrowing keeps the union honest.
          if (rawDepth.kind !== 'snapshot') return;
          // `validateDepth` expects levels as [price, size] tuples (the vendor-neutral wire shape)
          // and an explicit symbol so stale-socket frames can be rejected.
          const toTuples = (levels: { price: number; size: number }[]): [number, number][] =>
            levels.map((level) => [level.price, level.size]);
          const { event } = validateDepth(
            {
              ...rawDepth,
              symbol: this.symbol,
              bids: toTuples(rawDepth.bids),
              asks: toTuples(rawDepth.asks),
            },
            tickSize,
            this.symbol
          );
          if (!event) return;
          this.markLive();
          this.handlers.onDepth(event);
        },
        onStatus: (state, reason) => {
          if (state === 'LIVE') {
            this.markLive();
          } else if (state === 'CONNECTING') {
            this.setStatus('CONNECTING', reason);
          } else {
            this.setStatus('UNAVAILABLE', reason);
          }
        },
        onError: (err) => this.handlers.onError(err),
      },
      this.options.socketFactory
    );

    this.transport.connect();
  }

  public async disconnect(): Promise<void> {
    const transport = this.transport;
    this.transport = null;
    // Invalidate waiters first so a late socket event can never resolve them.
    this.liveWaiters = [];
    if (transport) transport.disconnect();
    this.setStatus('UNAVAILABLE', 'disconnected');
  }

  private reportUnavailable(reason: string, vendorSymbol: string): void {
    console.warn(`[Feed:databento] ${this.symbol}: ${reason}`);
    this.setStatus('UNAVAILABLE', `${reason} (${vendorSymbol})`);
  }

  private markLive(): void {
    if (this.connectionState !== 'LIVE') {
      this.setStatus('LIVE', undefined);
    }
  }

  private setStatus(state: FeedConnectionState, reason: string | undefined): void {
    if (state === 'LIVE') {
      const waiters = this.liveWaiters;
      this.liveWaiters = [];
      for (const wake of waiters) wake();
    }
    if (state === this.connectionState && state !== 'UNAVAILABLE') return;
    this.connectionState = state;
    this.handlers.onStatus({
      state,
      reason,
      provider: this.provider,
      symbol: this.symbol,
      instrumentId: this.resolvedSymbol || undefined,
    });
  }
}
