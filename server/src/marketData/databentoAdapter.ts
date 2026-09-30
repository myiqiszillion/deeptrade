import { FUTURES_INSTRUMENTS } from '../futuresConfig.js';
import { DatabentoSocketFactory, DatabentoTransport } from './databentoTransport.js';
import { FeedConnectionState, FeedHandlers, MarketDataFeed } from './types.js';
import { validateDepth, validateTrade } from './validate.js';

export const DBN_INTEGRATION_SPEC = {
  recordSizes: {
    recordHeader: 16,
    tradeMsg: 48,
    mbp1Msg: 80,
    mbp10Msg: 368,
  },
  priceScaling: 1e-9, // fixed-point 1 unit = 10^-9 USD
  undefPrice: 9223372036854775807n, // 0x7fffffffffffffffn
  undefOrderSize: 4294967295, // 0xffffffff
  timeUnit: 'nanoseconds since Unix epoch (divided by 1e6 to epoch ms)',
  sideCodes: {
    A: 'Ask (sell aggressor)',
    B: 'Bid (buy aggressor)',
    N: 'None / unassigned',
  },
  actionCodes: {
    A: 'Add order',
    C: 'Cancel order',
    M: 'Modify order',
    T: 'Trade execution',
    R: 'Reset / snapshot clear book',
  },
} as const;

export interface DatabentoAdapterConfig {
  apiKey?: string;
  dataset?: string;
  stypeIn?: string;
  symbols?: string;
  host?: string;
  port?: number;
  snapshot?: boolean;
}

export interface DatabentoAdapterOptions {
  socketFactory?: DatabentoSocketFactory;
}

/**
 * Roots that need a different continuous series than the default `<ROOT>.c.0` (Databento calendar
 * continuous). Kept explicit and tiny: a wrong mapping silently swaps the instrument you think you trade.
 */
const CONTINUOUS_SYMBOL_OVERRIDES: Record<string, string> = {
  // Volume-based continuous for gold: the calendar series showed session gaps at contract roll.
  GC: 'GC.v.0',
};

/**
 * Continuous front-month vendor symbol per instrument root, derived from the instrument catalog so every
 * instrument the app serves (including operator-added EXTRA_INSTRUMENTS) is automatically resolvable.
 */
export const DATABENTO_SYMBOL_MAP: Record<string, string> = Object.fromEntries(
  Object.keys(FUTURES_INSTRUMENTS).map((root) => [root, CONTINUOUS_SYMBOL_OVERRIDES[root] ?? `${root}.c.0`])
);

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

export class DatabentoMarketDataFeed implements MarketDataFeed {
  public readonly provider = 'databento';
  private transport: DatabentoTransport | null = null;
  private connectionState: FeedConnectionState = 'UNAVAILABLE';
  private terminalReason: string | null = null;
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

  public async connect(): Promise<void> {
    const missing: string[] = [];
    if (!this.config.apiKey) missing.push('DATABENTO_API_KEY');

    const dataset = this.config.dataset || process.env.DATABENTO_DATASET || 'GLBX.MDP3';
    const { vendorSymbol, stypeIn } = resolveDatabentoSymbol(this.symbol, this.config);
    this.resolvedSymbol = vendorSymbol;

    if (missing.length > 0) {
      const reason = `Databento not configured (missing ${missing.join(', ')})`;
      this.terminalReason = reason;
      console.warn(`[Feed:databento] ${this.symbol}: ${reason}`);
      this.connectionState = 'UNAVAILABLE';
      this.handlers.onStatus({
        state: 'UNAVAILABLE',
        reason,
        provider: this.provider,
        symbol: this.symbol,
        instrumentId: vendorSymbol,
      });
      return;
    }

    // Optional operator kill-switch
    if (process.env.DATABENTO_TRANSPORT_READY === '0') {
      const reason = 'Databento transport disabled by DATABENTO_TRANSPORT_READY=0';
      this.terminalReason = reason;
      console.warn(`[Feed:databento] ${this.symbol}: ${reason}`);
      this.connectionState = 'UNAVAILABLE';
      this.handlers.onStatus({
        state: 'UNAVAILABLE',
        reason,
        provider: this.provider,
        symbol: this.symbol,
        instrumentId: vendorSymbol,
      });
      return;
    }

    const instrument = FUTURES_INSTRUMENTS[this.symbol] || FUTURES_INSTRUMENTS.ES;
    const tickSize = instrument?.tickSize ?? 0.25;

    this.transport = new DatabentoTransport(
      {
        apiKey: this.config.apiKey!,
        dataset,
        symbols: vendorSymbol,
        stypeIn,
        host: this.config.host,
        port: this.config.port,
        snapshot: this.config.snapshot ?? (process.env.DATABENTO_SNAPSHOT === '1'),
      },
      {
        onTrade: (rawTrade) => {
          const validated = validateTrade({ ...rawTrade, symbol: this.symbol }, tickSize, this.symbol);
          if (validated.trade) {
            this.handlers.onTrade(validated.trade);
          }
        },
        onDepth: (rawDepth) => {
          const validated = validateDepth(rawDepth, tickSize, this.symbol);
          if (validated.event) {
            this.handlers.onDepth(validated.event);
          }
        },
        onStatus: (state, reason) => {
          this.connectionState = state;
          if (state === 'LIVE') {
            this.terminalReason = null;
            this.notifyLiveWaiters();
          }
          this.handlers.onStatus({
            state,
            reason,
            provider: this.provider,
            symbol: this.symbol,
            instrumentId: vendorSymbol,
          });
        },
        onError: (err) => {
          this.handlers.onError(err);
        },
      },
      this.options.socketFactory
    );

    this.transport.connect();
  }

  public async disconnect(): Promise<void> {
    if (this.transport) {
      this.transport.disconnect();
      this.transport = null;
    }
    this.connectionState = 'UNAVAILABLE';
    this.handlers.onStatus({
      state: 'UNAVAILABLE',
      reason: 'disconnected',
      provider: this.provider,
      symbol: this.symbol,
      instrumentId: this.resolvedSymbol,
    });
  }

  public waitForLive(timeoutMs = 15000): Promise<void> {
    if (this.isConnected()) return Promise.resolve();
    if (this.terminalReason) return Promise.reject(new Error(this.terminalReason));

    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        const idx = this.liveWaiters.indexOf(onLive);
        if (idx !== -1) this.liveWaiters.splice(idx, 1);
        reject(new Error(`[Feed:databento] ${this.symbol}: waitForLive timed out after ${timeoutMs}ms`));
      }, timeoutMs);

      const onLive = () => {
        clearTimeout(timer);
        resolve();
      };

      this.liveWaiters.push(onLive);
    });
  }

  private notifyLiveWaiters(): void {
    const waiters = this.liveWaiters.slice();
    this.liveWaiters.length = 0;
    for (const w of waiters) {
      w();
    }
  }
}
