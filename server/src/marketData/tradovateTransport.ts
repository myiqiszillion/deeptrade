import WebSocket from 'ws';

/**
 * Tradovate real-time transport.
 *
 * Every wire detail in this file is quoted from Tradovate's OWN reference client
 * (github.com/tradovate/example-api-js — `tutorial/WebSockets/EX-07..EX-09` and
 * `tutorial/tutorialsURLs.js`). Nothing is inferred and nothing is guessed:
 *
 *   REST bases   demo  https://demo.tradovateapi.com/v1
 *                live  https://live.tradovateapi.com/v1
 *   MD socket    wss://md.tradovateapi.com/v1/websocket          (tutorialsURLs.MD_URL)
 *   auth         POST /auth/accesstokenrequest  (no bearer)      (EX-01 connect.js)
 *   outbound     `${url}\n${id}\n${query || ''}\n${JSON.stringify(body)}`   (TradovateSocket.send)
 *   inbound      first char = 'o' open | 'h' heartbeat | 'a' array, rest is a JSON array
 *                of items `{ e, d, i, s }`; `s === 200` acks the request whose `i` matches.
 *   heartbeat    the client must send the literal string '[]' whenever >= 2500 ms passed
 *                since the last inbound frame (TradovateSocket.checkHeartbeats).
 *   authorize    sent once after the 'o' frame with the RAW TOKEN STRING as the body,
 *                i.e. JSON.stringify(token) — not an object.
 *
 * Quote payload (`md/subscribequote`, EX-08 README):
 *   { e:'md', d:{ quotes:[{ timestamp, contractId, entries:{
 *        Bid:{price,size}, Offer:{price,size}, Trade:{price,size},
 *        TotalTradeVolume:{price,size}, HighPrice, LowPrice, OpeningPrice,
 *        SettlementPrice, OpenInterest, EmptyBook } }] } }
 *   Any entry may be absent, and within an entry either price or size may be absent.
 *
 * DOM payload (`md/subscribedom`, EX-09 README):
 *   { e:'md', d:{ doms:[{ contractId, timestamp, bids:[{price,size}], offers:[{price,size}] }] } }
 */

export type TradovateEnv = 'demo' | 'live';

export interface TradovateEndpoints {
  /** REST base, no trailing slash. */
  restBase: string;
  /** Market-data WebSocket URL (quotes + DOM + chart). */
  mdWsUrl: string;
}

/** Exact values from the vendor's tutorialsURLs.js. */
export const TRADOVATE_ENDPOINTS: Record<TradovateEnv, TradovateEndpoints> = {
  demo: {
    restBase: 'https://demo.tradovateapi.com/v1',
    mdWsUrl: 'wss://md.tradovateapi.com/v1/websocket',
  },
  live: {
    restBase: 'https://live.tradovateapi.com/v1',
    mdWsUrl: 'wss://md.tradovateapi.com/v1/websocket',
  },
};

/** Credentials accepted by POST /auth/accesstokenrequest (EX-01 tutorialsCredentials.js). */
export interface TradovateCredentials {
  name: string;
  password: string;
  appId: string;
  appVersion: string;
  cid: number;
  sec: string;
}

export interface AccessTokenResponse {
  accessToken?: string;
  expirationTime?: string;
  userId?: number;
  userStatus?: string;
  name?: string;
  /** Present instead of a token when Tradovate throttles the auth endpoint. */
  errorText?: string;
  'p-ticket'?: string;
  'p-time'?: number;
  'p-captcha'?: boolean;
}

/** One `{price,size}` entry. Either field may be absent per the documented schema. */
export interface TradovatePriceSize {
  price?: number;
  size?: number;
}

export interface TradovateQuoteEntries {
  Bid?: TradovatePriceSize;
  Offer?: TradovatePriceSize;
  Trade?: TradovatePriceSize;
  TotalTradeVolume?: TradovatePriceSize;
  HighPrice?: TradovatePriceSize;
  LowPrice?: TradovatePriceSize;
  OpeningPrice?: TradovatePriceSize;
  SettlementPrice?: TradovatePriceSize;
  OpenInterest?: TradovatePriceSize;
  EmptyBook?: TradovatePriceSize;
}

export interface TradovateQuote {
  timestamp?: string;
  contractId?: number;
  entries?: TradovateQuoteEntries;
}

export interface TradovateDomLevel {
  price?: number;
  size?: number;
  id?: number;
}

export interface TradovateDom {
  contractId?: number;
  timestamp?: string;
  bids?: TradovateDomLevel[];
  offers?: TradovateDomLevel[];
}

/**
 * One chart bar from `md/getchart` (EX-10). Every field is REAL vendor data: `upVolume` /
 * `downVolume` and `upTicks` / `downTicks` split by trade direction, `bidVolume` /
 * `offerVolume` split by aggressor. Nothing here is derived or estimated.
 */
export interface TradovateChartBar {
  timestamp?: string;
  open?: number;
  high?: number;
  low?: number;
  close?: number;
  upVolume?: number;
  downVolume?: number;
  upTicks?: number;
  downTicks?: number;
  bidVolume?: number;
  offerVolume?: number;
}

export interface TradovateChart {
  id?: number;
  symbol?: string;
  timestamp?: string;
  base?: number;
  /** "End of history": the requested range has been fully delivered. */
  eoh?: boolean;
  bars?: TradovateChartBar[];
}

/** Chart request shape documented in EX-10 (`md/getchart`). */
export interface TradovateChartRequest {
  symbol: string;
  chartDescription: {
    /** Tick | DailyBar | MinuteBar | Custom | DOM */
    underlyingType: 'MinuteBar' | 'DailyBar' | 'Tick';
    elementSize: number;
    /** Volume | Range | UnderlyingUnits | Renko | MomentumRange | PointAndFigure | OFARange */
    elementSizeUnit: 'UnderlyingUnits';
    withHistogram: boolean;
  };
  timeRange: {
    asMuchAsElements?: number;
    closestTimestamp?: string;
    asFarAsTimestamp?: string;
  };
}

/** One element of an 'a' frame's JSON array. */
export interface TradovateSocketItem {
  /** Event name, e.g. 'md'. */
  e?: string;
  /** Payload. */
  d?: Record<string, unknown> | null;
  /** Correlation id echoed from our request. */
  i?: number;
  /** HTTP-style status; 200 = success. */
  s?: number;
}

export interface TradovateFrame {
  /** 'o' connection open, 'h' heartbeat, 'a' data array. */
  kind: string;
  items: TradovateSocketItem[];
}

/**
 * Decode one inbound frame. The vendor strips the first character as the frame type and
 * JSON-parses the remainder; an empty remainder means "no items".
 */
export function parseTradovateFrame(raw: string): TradovateFrame {
  const kind = raw.slice(0, 1);
  if (raw.length <= 1) return { kind, items: [] };
  const parsed: unknown = JSON.parse(raw.slice(1));
  return { kind, items: Array.isArray(parsed) ? parsed.filter((item) => item && typeof item === 'object') : [] };
}

/** Encode one outbound request exactly as TradovateSocket.send does. */
export function buildTradovateFrame(url: string, id: number, body: unknown, query?: string): string {
  return `${url}\n${id}\n${query ?? ''}\n${JSON.stringify(body)}`;
}

/** The literal heartbeat payload the vendor client sends. */
export const TRADOVATE_HEARTBEAT_FRAME = '[]';

/** Milliseconds of inbound silence after which a heartbeat must be sent. */
export const TRADOVATE_HEARTBEAT_INTERVAL_MS = 2500;

const AUTH_TIMEOUT_MS = 20000;
const REST_TIMEOUT_MS = 20000;

/** Thrown when Tradovate refuses credentials (bad user/pass, locked account, captcha). */
export class TradovateAuthError extends Error {}

/**
 * Exchange credentials for an access token.
 *
 * The vendor's connect.js posts to `/auth/accesstokenrequest` WITHOUT a bearer header and
 * reads `{ errorText, accessToken, userId, userStatus, name, expirationTime }`. When the
 * response carries `p-ticket` the request was throttled and must be replayed after `p-time`
 * seconds with the ticket attached; a `p-captcha` response cannot be solved by a
 * third-party app, so it is reported instead of retried.
 */
export async function requestAccessToken(
  restBase: string,
  credentials: TradovateCredentials,
  retryTicket?: string,
  signal?: AbortSignal
): Promise<AccessTokenResponse> {
  const body: Record<string, unknown> = { ...credentials };
  if (retryTicket) body['p-ticket'] = retryTicket;

  const res = await fetch(`${restBase}/auth/accesstokenrequest`, {
    method: 'POST',
    headers: { accept: 'application/json', 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(AUTH_TIMEOUT_MS)]) : AbortSignal.timeout(AUTH_TIMEOUT_MS),
  });

  const json = (await res.json().catch(() => null)) as AccessTokenResponse | null;
  if (!res.ok || !json) {
    throw new TradovateAuthError(`accesstokenrequest -> HTTP ${res.status}`);
  }
  return json;
}

/** Resolve a concrete contract-month symbol (e.g. `ESZ6`) to its numeric contract id. */
export async function findContractId(
  restBase: string,
  accessToken: string,
  symbol: string
): Promise<number | null> {
  const url = `${restBase}/contract/find?name=${encodeURIComponent(symbol)}`;
  const res = await fetch(url, {
    headers: {
      authorization: `Bearer ${accessToken}`,
      accept: 'application/json',
      'content-type': 'application/json',
    },
    signal: AbortSignal.timeout(REST_TIMEOUT_MS),
  });
  if (!res.ok) return null;
  const json = (await res.json().catch(() => null)) as { id?: number } | null;
  return typeof json?.id === 'number' ? json.id : null;
}

/** Minimal socket surface the transport drives; injectable so tests never touch the network. */
export interface TradovateSocketLike {
  send(data: string): void;
  close(code?: number, reason?: string): void;
  terminate?(): void;
  on(event: 'open' | 'message' | 'error' | 'close', listener: (...args: unknown[]) => void): void;
  removeAllListeners(): void;
}

export type TradovateSocketFactory = (url: string) => TradovateSocketLike;

export interface TradovateClientOptions {
  env: TradovateEnv;
  accessToken: string;
  /** Called for every item of every 'a' frame (quotes, doms and acks alike). */
  onItem: (item: TradovateSocketItem) => void;
  /** Socket opened AND authorized. */
  onReady: () => void;
  /** Socket died. `reason` is credential-free. */
  onClosed: (reason: string) => void;
  socketFactory?: TradovateSocketFactory;
  heartbeatMs?: number;
}

/**
 * Authorized market-data socket: opens, authorizes with the raw token string, keeps the
 * vendor's heartbeat alive, and fans inbound 'a' frames out as items.
 */
export class TradovateClient {
  private socket: TradovateSocketLike | null = null;
  private nextId = 0;
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private stopped = false;
  private ready = false;
  private authorizeId: number | null = null;

  constructor(private readonly options: TradovateClientOptions) {}

  public isConnected(): boolean {
    return this.ready && this.socket !== null;
  }

  /** Open + authorize. Resolves once Tradovate accepted the `authorize` request. */
  public connect(): Promise<void> {
    this.stopped = false;
    const endpoints = TRADOVATE_ENDPOINTS[this.options.env];
    const factory =
      this.options.socketFactory ?? ((url: string) => new WebSocket(url) as unknown as TradovateSocketLike);

    return new Promise<void>((resolve, reject) => {
      let settled = false;
      const socket = factory(endpoints.mdWsUrl);
      this.socket = socket;

      const settle = (fn: () => void) => {
        if (settled) return;
        settled = true;
        fn();
      };

      socket.on('message', (data: unknown) => {
        if (this.stopped) return;
        let frame: TradovateFrame;
        try {
          frame = parseTradovateFrame(String(data));
        } catch {
          return; // an undecodable frame carries no trustworthy data
        }

        if (frame.kind === 'o') {
          // The vendor authorizes immediately after the open frame; the body is the RAW
          // TOKEN STRING (JSON.stringify(token)), not an object.
          this.authorizeId = this.increment();
          socket.send(buildTradovateFrame('authorize', this.authorizeId, this.options.accessToken));
          return;
        }
        if (frame.kind !== 'a') return;

        for (const item of frame.items) {
          if (this.stopped) break;
          if (this.isAuthorizeAck(item)) {
            this.ready = true;
            this.startHeartbeat();
            settle(() => {
              this.options.onReady();
              resolve();
            });
          } else if (this.isAuthorizeReject(item)) {
            // e.g. no market-data entitlement or an expired token: fail closed with the
            // vendor's own reason instead of hanging until the caller times out.
            const detail = typeof item.d?.errorText === 'string' ? item.d.errorText : `status ${item.s}`;
            this.stopHeartbeat();
            settle(() => reject(new TradovateAuthError(`tradovate refused authorize: ${detail}`)));
            this.options.onClosed(detail);
          }
          this.options.onItem(item);
        }
      });

      socket.on('error', (err: unknown) => {
        const message = err instanceof Error ? err.message : String(err);
        settle(() => reject(new TradovateAuthError(`market-data socket error: ${message}`)));
        this.options.onClosed(message);
      });

      socket.on('close', () => {
        this.ready = false;
        this.stopHeartbeat();
        settle(() => reject(new TradovateAuthError('market-data socket closed before authorization')));
        if (!this.stopped) this.options.onClosed('socket closed');
      });
    });
  }

  /** Fire-and-forget request using the vendor's newline-delimited frame. */
  public send(url: string, body: unknown): number {
    const id = this.increment();
    this.socket?.send(buildTradovateFrame(url, id, body));
    return id;
  }

  /** Idempotent teardown: listeners are detached so a late frame cannot publish. */
  public close(): void {
    this.stopped = true;
    this.ready = false;
    this.stopHeartbeat();
    const socket = this.socket;
    this.socket = null;
    if (!socket) return;
    socket.removeAllListeners();
    socket.on('error', () => {
      /* expected during intentional teardown */
    });
    try {
      socket.close();
      socket.terminate?.();
    } catch {
      /* already gone */
    }
  }

  /**
   * The `authorize` ack is the first 200-status item that matches our authorize request id.
   * Matching on the id (not on payload shape) keeps market-data events from ever being
   * mistaken for readiness, and a non-200 ack is reported as an auth failure.
   */
  private isAuthorizeAck(item: TradovateSocketItem): boolean {
    if (this.ready || this.authorizeId === null) return false;
    return item.i === this.authorizeId && item.s === 200;
  }

  /** The refuse-case twin of isAuthorizeAck: same id, non-200 status. */
  private isAuthorizeReject(item: TradovateSocketItem): boolean {
    if (this.ready || this.authorizeId === null) return false;
    return item.i === this.authorizeId && typeof item.s === 'number' && item.s !== 200;
  }

  private increment(): number {
    return this.nextId++;
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    const interval = this.options.heartbeatMs ?? TRADOVATE_HEARTBEAT_INTERVAL_MS;
    this.heartbeatTimer = setInterval(() => {
      if (this.stopped || !this.socket) return;
      try {
        this.socket.send(TRADOVATE_HEARTBEAT_FRAME);
      } catch {
        /* a send failure surfaces through the socket's own error/close events */
      }
    }, interval);
    // Never hold the process open just to ping a socket we have already abandoned.
    this.heartbeatTimer.unref?.();
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = null;
  }
}


