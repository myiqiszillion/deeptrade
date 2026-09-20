import { FuturesInstrument } from '../futuresConfig.js';
import { TradovateQuoteMapper } from './tradovateMapper.js';
import { TradovateConfig, credentialFreeMessage } from './tradovateConfig.js';
import {
  AccessTokenResponse,
  TRADOVATE_ENDPOINTS,
  TradovateClient,
  TradovateDom,
  TradovateQuote,
  TradovateSocketFactory,
  TradovateSocketItem,
  findContractId,
  requestAccessToken,
} from './tradovateTransport.js';
import { FeedConnectionState, FeedHandlers, MarketDataFeed, MarketDepthEvent, MarketTrade } from './types.js';
import { validateDepth, validateTrade } from './validate.js';

/**
 * Tradovate adapter — REAL CME market data (demo or live cluster).
 *
 * Everything above the transport lives in this file: lifecycle, symbol resolution, the two
 * subscriptions (`md/subscribequote` for prints + best bid/offer, `md/subscribedom` for the
 * full ladder) and the hand-off to the shared validators.
 *
 * Honesty rules enforced here:
 *  - UNAVAILABLE is reported with the vendor's OWN reason whenever auth, entitlement or the
 *    socket fails. Nothing synthetic is ever produced in its place.
 *  - Only VALIDATED events move the state to LIVE, so `waitForLive` is a real-data gate.
 *  - Generation-guarded: a socket from a previous instrument can never publish into the next.
 *  - Credentials never reach a status reason, the console or the browser.
 */

/** Vendor rate-limit replay: Tradovate answers with `p-ticket` + `p-time` (seconds). */
const MAX_PTICKET_WAIT_MS = 10000;
/** Depth ladder levels forwarded per DOM frame (OrderbookManager keeps 50 by default). */
const DOM_LEVEL_LIMIT = 50;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Read the `quotes` array off an inbound item without trusting its shape. */
function readQuotes(payload: Record<string, unknown> | null | undefined): TradovateQuote[] {
  const quotes = payload?.quotes;
  return Array.isArray(quotes) ? (quotes as TradovateQuote[]) : [];
}

/** Read the `doms` array off an inbound item without trusting its shape. */
function readDoms(payload: Record<string, unknown> | null | undefined): TradovateDom[] {
  const doms = payload?.doms;
  return Array.isArray(doms) ? (doms as TradovateDom[]) : [];
}

/**
 * DeepChart symbol -> Tradovate symbol.
 *
 * Tradovate accepts both a continuous form (`@ES`, the front month auto-rolled) and an
 * explicit contract month (`ESZ6`), so an operator can pin a month with TRADOVATE_SYMBOL
 * without touching code. TRADOVATE_USE_MICRO=1 streams the micro root (MES/MNQ/M2K/MGC/MCL)
 * that `futuresConfig` already declares.
 */
export function resolveVendorSymbol(
  symbol: string,
  instrument: FuturesInstrument,
  config: TradovateConfig
): string {
  const override = config.symbolOverride?.trim();
  if (override) return override;
  const root = config.useMicro && instrument.microSymbol ? instrument.microSymbol : symbol;
  return `@${root}`;
}

export interface TradovateAdapterOptions {
  /** Test seam: replaces the real WebSocket with a scripted one. */
  socketFactory?: TradovateSocketFactory;
  /** Test seam: overrides REST auth so the suite never touches the network. */
  authResolver?: (config: TradovateConfig, ticket?: string) => Promise<AccessTokenResponse>;
  /** Test seam: overrides the REST contract lookup. */
  contractResolver?: (restBase: string, token: string, symbol: string) => Promise<number | null>;
  heartbeatMs?: number;
}

export class TradovateMarketDataFeed implements MarketDataFeed {
  public readonly provider = 'tradovate';
  private connectionState: FeedConnectionState = 'UNAVAILABLE';
  /** Last published reason, so a changed explanation is not swallowed by the state dedupe. */
  private lastReason: string | undefined;
  /**
   * Set when the adapter conclusively cannot stream for THIS generation (no credentials, auth
   * refused, subscription refused, socket gone). `waitForLive` then rejects at once instead of
   * stalling the caller for the full timeout — the honest reason must reach the UI immediately.
   */
  private terminalReason: string | null = null;
  /** Monotonic token: bumped on connect (new session) and on disconnect (invalidate). */
  private generation = 0;
  private client: TradovateClient | null = null;
  private mapper: TradovateQuoteMapper | null = null;
  /** Resolved via REST /contract/find; null when the lookup failed (frames are then accepted). */
  private contractId: number | null = null;
  /** The symbol actually sent to Tradovate (`@ES`, `ESZ6`, `@MES`, ...). */
  private vendorSymbol = '';
  private liveWaiters: (() => void)[] = [];
  private droppedInvalid = 0;
  private droppedStale = 0;
  /** Requests Tradovate rate-limited; replayed with their `p-ticket` exactly like the vendor. */
  private pendingReplays = new Map<number, { url: string; body: Record<string, unknown> }>();

  constructor(
    public readonly symbol: string,
    private readonly instrument: FuturesInstrument,
    private readonly handlers: FeedHandlers,
    private readonly config: TradovateConfig,
    private readonly options: TradovateAdapterOptions = {}
  ) {}

  public isConnected(): boolean {
    return this.connectionState === 'LIVE';
  }

  /** The vendor-side symbol currently subscribed (`@ES`, `ESZ6`, `@MES`, ...). */
  public get resolvedVendorSymbol(): string {
    return this.vendorSymbol;
  }

  /** Numeric Tradovate contract id, when the REST lookup succeeded. */
  public get resolvedContractId(): number | null {
    return this.contractId;
  }

  /**
   * Resolve once the adapter validated at least one real market event for the CURRENT
   * generation. Rejects honestly on timeout — readiness is never fabricated.
   */
  public waitForLive(timeoutMs = 15000): Promise<void> {
    if (this.connectionState === 'LIVE') return Promise.resolve();
    // Already proven impossible (missing credentials, refusal, dead socket): fail fast with the
    // real reason rather than making the caller wait out the timeout for a known outcome.
    if (this.terminalReason) return Promise.reject(new Error(this.terminalReason));
    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.liveWaiters = this.liveWaiters.filter((w) => w !== onLive);
        reject(new Error(`no validated market data for ${this.symbol} within ${timeoutMs}ms`));
      }, timeoutMs);
      const onLive = () => {
        clearTimeout(timer);
        resolve();
      };
      this.liveWaiters.push(onLive);
    });
  }

  public async connect(): Promise<void> {
    const gen = ++this.generation;
    // Defensive teardown: index.ts always disconnects first, but a second connect() without
    // one must not orphan a socket that keeps streaming the previous contract.
    const previous = this.client;
    this.client = null;
    previous?.close();

    this.mapper = new TradovateQuoteMapper();
    this.contractId = null;
    this.pendingReplays.clear();
    this.terminalReason = null;
    this.vendorSymbol = resolveVendorSymbol(this.symbol, this.instrument, this.config);

    // No credentials = no vendor. Reported with the exact missing env vars, never faked.
    if (!this.config.credentials) {
      this.giveUp(this.config.missingReason ?? 'TRADOVATE_PROVIDER not configured', gen);
      return;
    }

    this.setStatus('CONNECTING', `connecting to tradovate ${this.config.env} (${this.vendorSymbol})`, gen);

    const endpoints = TRADOVATE_ENDPOINTS[this.config.env];
    let accessToken: string;
    try {
      accessToken = await this.authenticate(gen);
    } catch (err) {
      if (gen !== this.generation) return;
      this.giveUp(credentialFreeMessage((err as Error).message), gen);
      return;
    }

    if (gen !== this.generation) return; // switched instruments mid-auth

    // The contract id gives the UI a concrete contract month and lets us filter frames. A
    // failed lookup is non-fatal: we subscribed to exactly one symbol, so its frames are
    // accepted on their own merit rather than discarded over a REST hiccup.
    try {
      const resolveContract = this.options.contractResolver ?? findContractId;
      this.contractId = await resolveContract(
        endpoints.restBase,
        accessToken,
        this.vendorSymbol.replace(/^@/, '')
      );
    } catch {
      this.contractId = null;
    }

    if (gen !== this.generation) return;

    const client = new TradovateClient({
      env: this.config.env,
      accessToken,
      heartbeatMs: this.options.heartbeatMs,
      socketFactory: this.options.socketFactory,
      onItem: (item) => {
        if (gen !== this.generation) return; // stale socket: never emit into the new session
        this.handleItem(item, gen);
      },
      onReady: () => {
        if (gen !== this.generation) return;
        // Authorized is NOT live: no market data has been validated yet.
        this.setStatus('CONNECTING', `authorized, subscribing ${this.vendorSymbol}`, gen);
      },
      onClosed: (reason) => {
        if (gen !== this.generation) return;
        this.client = null;
        // The adapter does not auto-reconnect, so this generation is over: fail fast.
        this.giveUp(credentialFreeMessage(`market-data socket closed (${reason})`), gen);
      },
    });

    this.client = client;

    try {
      await client.connect();
    } catch (err) {
      if (gen !== this.generation) {
        client.close();
        return;
      }
      client.close();
      this.client = null;
      this.giveUp(credentialFreeMessage((err as Error).message), gen);
      return;
    }

    if (gen !== this.generation) {
      client.close();
      return;
    }

    // Quotes carry prints + best bid/offer (tape, footprint, CVD); DOM replaces the whole
    // ladder each frame (the DOM scalper). Both are subscribed for the same symbol.
    this.subscribe('md/subscribequote', gen);
    this.subscribe('md/subscribedom', gen);
  }

  /**
   * Exchange credentials for an access token, replaying Tradovate's `p-ticket` throttle
   * exactly like the vendor client does (wait `p-time` seconds, resend with the ticket).
   * A captcha response cannot be solved by a server-side app and is reported verbatim.
   */
  private async authenticate(gen: number): Promise<string> {
    const credentials = this.config.credentials;
    if (!credentials) throw new Error('TRADOVATE_PROVIDER not configured');

    const request = (ticket?: string) =>
      this.options.authResolver
        ? this.options.authResolver(this.config, ticket)
        : requestAccessToken(TRADOVATE_ENDPOINTS[this.config.env].restBase, credentials, ticket);

    const first = await request();

    if (first['p-captcha']) {
      throw new Error('tradovate auth requires a captcha; solve it in the Tradovate portal first');
    }
    if (first.errorText && !first.accessToken) {
      throw new Error(`tradovate auth refused: ${first.errorText}`);
    }

    // Rate-limited: Tradovate asks us to wait p-time seconds and resend with the ticket.
    const ticket = first['p-ticket'];
    if (ticket && !first.accessToken) {
      const waitMs = Math.min((first['p-time'] ?? 1) * 1000, MAX_PTICKET_WAIT_MS);
      await sleep(waitMs);
      if (gen !== this.generation) throw new Error('tradovate auth superseded by an instrument switch');
      const replay = await request(ticket);
      if (replay.errorText && !replay.accessToken) {
        throw new Error(`tradovate auth refused after replay: ${replay.errorText}`);
      }
      if (!replay.accessToken) throw new Error('tradovate auth returned no access token');
      return replay.accessToken;
    }

    if (!first.accessToken) throw new Error('tradovate auth returned no access token');
    return first.accessToken;
  }

  /**
   * Send a market-data subscription request. Tradovate may answer with `p-ticket` (throttled);
   * the request is then replayed after `p-time` seconds with the ticket attached, mirroring
   * TradovateSocket.subscribe. A refusal is surfaced through handleItem's status path.
   */
  private subscribe(url: string, gen: number): void {
    const client = this.client;
    if (!client) return;
    const body = { symbol: this.vendorSymbol };
    const id = client.send(url, body);
    this.pendingReplays.set(id, { url, body });
    if (gen !== this.generation) return;
    console.log(`[Feed:tradovate] ${this.symbol}: subscribed ${url} ${this.vendorSymbol}`);
  }

  /**
   * Replay a throttled subscription with its `p-ticket` once the vendor's wait elapsed.
   * Called from handleItem when the ack for `id` carried a ticket instead of a realtimeId.
   */
  private replayWithTicket(id: number, payload: Record<string, unknown>, gen: number): void {
    const pending = this.pendingReplays.get(id);
    this.pendingReplays.delete(id);
    if (!pending) return;
    const ticket = payload['p-ticket'];
    if (typeof ticket !== 'string') return;
    const waitMs = Math.min((typeof payload['p-time'] === 'number' ? payload['p-time'] : 1) * 1000, MAX_PTICKET_WAIT_MS);
    void sleep(waitMs).then(() => {
      if (gen !== this.generation) return;
      const client = this.client;
      if (!client) return;
      const nextId = client.send(pending.url, { ...pending.body, 'p-ticket': ticket });
      this.pendingReplays.set(nextId, pending);
    });
  }

  /** Fan one inbound 'a'-frame item out into validated trades / depth. */
  private handleItem(item: TradovateSocketItem, gen: number): void {
    // A refused authorize/subscribe (no market-data entitlement, unknown symbol, locked
    // account) is reported verbatim minus credentials; we never fabricate data instead.
    if (typeof item.s === 'number' && item.s !== 200) {
      const detail = typeof item.d?.errorText === 'string' ? item.d.errorText : `status ${item.s}`;
      this.giveUp(credentialFreeMessage(`tradovate refused request: ${detail}`), gen);
      return;
    }

    const payload = item.d ?? undefined;
    const quotes = readQuotes(payload);
    const doms = readDoms(payload);

    // Request bookkeeping — REPLY frames only. A market-data frame echoes the id of the
    // subscription that carries it, so treating one as a reply would erase the pending
    // `p-ticket` state of the very request that still has to be retried.
    if (
      quotes.length === 0 &&
      doms.length === 0 &&
      typeof item.i === 'number' &&
      this.pendingReplays.has(item.i)
    ) {
      if (payload && typeof payload['p-ticket'] === 'string') {
        this.replayWithTicket(item.i, payload, gen);
      } else {
        this.pendingReplays.delete(item.i);
      }
    }

    for (const quote of quotes) {
      if (!this.acceptsContract(quote.contractId)) continue;
      this.applyQuote(quote, gen);
    }

    for (const dom of doms) {
      if (!this.acceptsContract(dom.contractId)) continue;
      this.applyDom(dom, gen);
    }
  }

  /**
   * Contract filter. Only one symbol is subscribed, so frames normally belong to us; when the
   * REST lookup resolved an id we use it as an extra guard against a vendor-side mismatch.
   * An unresolved id must NOT drop data — that would starve a perfectly valid subscription.
   */
  private acceptsContract(contractId: number | undefined): boolean {
    if (this.contractId === null) return true;
    return contractId === undefined || contractId === this.contractId;
  }

  /** Translate one quote frame into validated trades + best bid/offer deltas. */
  private applyQuote(quote: TradovateQuote, gen: number): void {
    const mapper = this.mapper;
    if (!mapper) return;
    const { trades, depth } = mapper.mapQuote(quote, this.symbol);

    for (const candidate of trades) {
      const { trade, dropped } = validateTrade(candidate, this.instrument.tickSize, this.symbol);
      if (!trade) {
        this.countDrop(dropped);
        continue;
      }
      this.publishTrade(trade, gen);
    }

    for (const candidate of depth) {
      const { event, dropped } = validateDepth(candidate, this.instrument.tickSize, this.symbol);
      if (!event) {
        this.countDrop(dropped);
        continue;
      }
      this.publishDepthEvent(event, gen);
    }
  }

  /** Translate one DOM frame into a validated full-ladder snapshot. */
  private applyDom(dom: TradovateDom, gen: number): void {
    const mapper = this.mapper;
    if (!mapper) return;
    const candidate = mapper.mapDom(dom, this.symbol);
    if (!candidate) return;

    // The DOM scalper renders a bounded ladder; forwarding more levels than OrderbookManager
    // keeps would be silently discarded anyway, so trim at the source.
    const trimmed = {
      ...candidate,
      bids: candidate.bids.slice(0, DOM_LEVEL_LIMIT),
      asks: candidate.asks.slice(0, DOM_LEVEL_LIMIT),
    };

    const { event, dropped } = validateDepth(trimmed, this.instrument.tickSize, this.symbol);
    if (!event) {
      this.countDrop(dropped);
      return;
    }
    this.publishDepthEvent(event, gen);
  }

  public async disconnect(): Promise<void> {
    // Invalidate FIRST: any callback already queued by the old socket becomes a no-op.
    this.generation++;
    const previous = this.client;
    this.client = null;
    this.mapper = null;
    this.liveWaiters = [];
    this.pendingReplays.clear();
    try {
      previous?.close();
    } catch (err) {
      this.handlers.onError(new Error(`tradovate teardown failed: ${(err as Error).message}`));
    }
    this.setStatus('UNAVAILABLE', 'disconnected', this.generation);
  }

  /** Publish a validated trade. The FIRST one is what moves the feed to LIVE. */
  private publishTrade(trade: MarketTrade, gen: number): void {
    if (gen !== this.generation) return;
    this.setStatus('LIVE', this.liveReason(), gen);
    this.handlers.onTrade(trade);
  }

  /** Publish a validated depth event. Depth alone is real data: a contract can quote first. */
  private publishDepthEvent(event: MarketDepthEvent, gen: number): void {
    if (gen !== this.generation) return;
    this.setStatus('LIVE', this.liveReason(), gen);
    this.handlers.onDepth(event);
  }

  /**
   * Conclusively cannot stream for this generation: remember the reason so `waitForLive` fails
   * fast instead of stalling, log it credential-free, and publish it to the handlers.
   */
  private giveUp(reason: string, gen: number): void {
    this.terminalReason = reason;
    console.warn(`[Feed:tradovate] ${this.symbol}: ${reason}`);
    this.setStatus('UNAVAILABLE', reason, gen);
  }

  private countDrop(reason?: 'invalid' | 'stale-symbol'): void {
    if (reason === 'stale-symbol') this.droppedStale++;
    else this.droppedInvalid++;
    const total = this.droppedInvalid + this.droppedStale;
    if (total % 100 === 1) {
      console.warn(
        `[Feed:tradovate] ${this.symbol}: dropped ${total} events ` +
          `(invalid=${this.droppedInvalid}, stale-symbol=${this.droppedStale})`
      );
    }
  }

  /**
   * Credential-free provenance shown in the UI status strip. It also reports honestly when
   * prints had to be dropped because Tradovate publishes no aggressor flag and neither the
   * quote rule nor the tick rule could decide the side.
   */
  private liveReason(): string {
    const parts = [`tradovate ${this.config.env}`, this.vendorSymbol];
    if (this.contractId !== null) parts.push(`contract ${this.contractId}`);
    const counters = this.mapper?.counters;
    if (counters) {
      if (counters.droppedUnresolvedSide > 0) {
        parts.push(`${counters.droppedUnresolvedSide} print(s) dropped: aggressor undecidable`);
      }
      if (counters.coalescedVolume > 0) {
        parts.push(`${counters.coalescedVolume} lot(s) coalesced by vendor`);
      }
    }
    return parts.join(' | ');
  }

  /** Only the active generation may publish status; stale generations are silently ignored. */
  private setStatus(state: FeedConnectionState, reason: string | undefined, gen: number): void {
    if (gen !== this.generation) return;
    if (state === 'LIVE') {
      // Real data proved the feed works: this generation is no longer terminal.
      this.terminalReason = null;
      const waiters = this.liveWaiters;
      this.liveWaiters = [];
      for (const wake of waiters) wake();
    }
    // Dedupe on state AND reason: a fresh reason while the state is unchanged is still news —
    // the fail-closed "missing TRADOVATE_*" explanation must reach the UI even though the
    // adapter starts out UNAVAILABLE, otherwise the status strip silently keeps a stale reason.
    if (state === this.connectionState && reason === this.lastReason) return;
    this.connectionState = state;
    this.lastReason = reason;
    this.handlers.onStatus({
      state,
      reason,
      provider: this.provider,
      symbol: this.symbol,
      instrumentId: this.contractId !== null ? String(this.contractId) : undefined,
    });
  }
}
