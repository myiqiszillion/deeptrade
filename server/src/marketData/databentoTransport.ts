import { createHash } from 'node:crypto';
import net from 'node:net';
import { MarketDepthEvent, MarketTrade } from './types.js';

/**
 * Databento Live API transport (CME via GLBX.MDP3) — REAL market data, no simulation.
 *
 * Protocol facts verified against the live gateway on 2026-09-28:
 *   - Gateway: `<dataset, dots->dashes, lowercased>.lsg.databento.com:13000`, PLAIN TCP
 *     (the gateway greets in cleartext; a TLS handshake is refused with "wrong version number").
 *   - Greeting: `lsg_version=<v>\ncram=<challenge>\n`
 *   - Auth: `sha256(<challenge>|<api_key>) + "-" + last5(api_key)`, sent as
 *     `auth=<hash>-<bucket>|dataset=...|encoding=dbn|ts_out=0|compression=none|client=...\n`
 *   - Subscription: `schema=trades|stype_in=continuous|symbols=ES.c.0|snapshot=0|is_last=<0|1>\n`
 *     followed by `start_session\n`.
 *   - Stream: `DBN` + version byte + uint32 metadata length + JSON metadata, then DBN records.
 *
 * DBN record layouts (little-endian, prices are i64 fixed point 1e-9):
 *   Header (16): lengthWords u8 (= len/4), rtype u8, publisherId u16, instrumentId u32, ts_event u64 ns
 *   MboMsg  (0x00 = trades schema, 48 bytes): orderId@16, price@24, size@32 u32, flags@36,
 *       channelId@37, action@38, side@39, ts_recv@40
 *   Mbp1Msg (0x01, 80 bytes): price@16, size@24, flags@28, channelId@29, action@30, side@31,
 *       ts_recv@32, tsInDelta@40, sequence@44, levels[0]@48 (bidPx@48, askPx@56, bidSz@64, askSz@68)
 *   Mbp10Msg (0x02, 368 bytes): same 48-byte prefix, then 10 x 32-byte BidAskPair
 */

export const DBN = {
  MAGIC: 'DBN',
  HEADER_SIZE: 16,
  UNDEF_PRICE: 9223372036854775807n,
  UNDEF_SIZE: 4294967295,
  PRICE_SCALE: 1e9,
  /** DBN v3 record types (metadata version 3 as served by the live gateway). */
  RTYPE_TRADES: 0x00, // TradesMsg (48 bytes) — the `trades` schema
  RTYPE_MBP1: 0x01,
  RTYPE_MBP10: 0x02,
  RTYPE_ERROR: 0x0b, // "Not authorized for <schema>" and other gateway errors
  RTYPE_SYMBOL_MAPPING: 0x16,
  RTYPE_SUBSCRIPTION_ACK: 0x17,
  TRADES_SIZE: 48,
  MBP1_SIZE: 80,
  MBP10_SIZE: 368,
  /** Control records the gateway interleaves with the data stream (ASCII text payloads). */
  RTYPE_CONTROL: new Set([0x0b, 0x0c, 0x0d, 0x0e, 0x15, 0x16, 0x17]),
} as const;

export interface DatabentoTransportConfig {
  apiKey: string;
  dataset: string;
  symbols: string;
  stypeIn?: string;
  host?: string;
  port?: number;
}

export interface DatabentoTransportHandlers {
  onTrade: (trade: MarketTrade) => void;
  onDepth: (depth: MarketDepthEvent) => void;
  onStatus: (state: 'CONNECTING' | 'LIVE' | 'UNAVAILABLE', reason?: string) => void;
  onError: (err: Error) => void;
}

/** Minimal socket surface so tests can drive the protocol without the network. */
export interface DatabentoSocketLike {
  write(data: string | Uint8Array): boolean;
  on(event: 'connect' | 'data' | 'error' | 'close', listener: (...args: any[]) => void): this;
  destroy(): void;
  removeAllListeners(): this;
}

export type DatabentoSocketFactory = (host: string, port: number) => DatabentoSocketLike;

export interface ParsedDbnRecord {
  rtype: number;
  publisherId: number;
  instrumentId: number;
  /** Matching-engine timestamp, epoch milliseconds. */
  tsMs: number;
  trade?: MarketTrade;
  depth?: MarketDepthEvent;
  /** ASCII payload of a control record (subscription acknowledgements, symbol mappings…). */
  control?: string;
}

/** Gateway host for a dataset (`GLBX.MDP3` -> `glbx-mdp3.lsg.databento.com`). */
export function determineDatabentoGateway(dataset: string): string {
  return `${dataset.replace(/\./g, '-').toLowerCase()}.lsg.databento.com`;
}

/** CRAM response: sha256(challenge|apiKey) + '-' + last 5 characters of the API key. */
export function buildCramAuthResponse(challenge: string, apiKey: string, dataset: string): string {
  const hash = createHash('sha256').update(`${challenge}|${apiKey}`).digest('hex');
  const bucket = apiKey.slice(-5);
  return `auth=${hash}-${bucket}|dataset=${dataset}|encoding=dbn|ts_out=0|compression=none|client=DeepChart/1.0.0\n`;
}

const priceOf = (raw: bigint): number => Number(raw) / DBN.PRICE_SCALE;
const isValidPrice = (raw: bigint): boolean => raw !== DBN.UNDEF_PRICE && raw > 0n;
const isValidSize = (size: number): boolean => size !== DBN.UNDEF_SIZE && size > 0;
const sideOf = (sideChar: string): MarketTrade['side'] =>
  sideChar === 'B' ? 'BUY' : sideChar === 'A' ? 'SELL' : 'UNKNOWN';

/** Field diagnostics: set DATABENTO_DEBUG=1 to trace the gateway handshake and record flow. */
const DEBUG = process.env.DATABENTO_DEBUG === '1';
const dbg = (message: string): void => {
  if (DEBUG) console.log(`[Databento:debug] ${message}`);
};


/**
 * Decode one DBN record from the head of `buffer`.
 * Returns `recLen: 0` while more bytes are needed; unknown record types are ignored safely.
 */
export function parseDbnRecord(
  buffer: Buffer,
  sourceProvider = 'databento'
): { parsed: ParsedDbnRecord | null; recLen: number } {
  if (buffer.length < DBN.HEADER_SIZE) return { parsed: null, recLen: 0 };

  const recLen = buffer[0] * 4;
  if (recLen < DBN.HEADER_SIZE || buffer.length < recLen) return { parsed: null, recLen };

  const rtype = buffer[1];
  const publisherId = buffer.readUInt16LE(2);
  const instrumentId = buffer.readUInt32LE(4);
  const tsEventNs = buffer.readBigUInt64LE(8);
  const tsMs = Math.floor(Number(tsEventNs / 1_000_000n));
  const parsed: ParsedDbnRecord = { rtype, publisherId, instrumentId, tsMs };

  if (DBN.RTYPE_CONTROL.has(rtype)) {
    // Control payloads are ASCII with embedded binary fields and NUL padding: keep the readable
    // segments only (e.g. "Subscription request for trades data succeeded").
    const text = buffer.subarray(DBN.HEADER_SIZE, recLen).toString('utf8');
    const readable = text.match(/[ -~]{4,}/g) ?? [];
    parsed.control = readable.join(' | ').trim();
    return { parsed, recLen };
  }

  if (rtype === DBN.RTYPE_TRADES && recLen >= DBN.TRADES_SIZE) {
    // DBN v3 TradesMsg (48 bytes) — verified against live GLBX.MDP3 bytes 2026-09-28:
    // price@16 i64 (1e-9), size@24 u32, action@28, side@29, flags@30, channelId@31,
    // ts_recv@32 u64, ts_in_delta@40 i32, sequence@44 u32.
    const rawPrice = buffer.readBigInt64LE(16);
    const size = buffer.readUInt32LE(24);
    const action = String.fromCharCode(buffer[28]);
    const sideChar = String.fromCharCode(buffer[29]);
    const sequence = buffer.readUInt32LE(44);

    if (action === 'T' && isValidPrice(rawPrice) && isValidSize(size)) {
      parsed.trade = {
        id: `dbn_${instrumentId}_${sequence}_${size}`,
        ts: tsMs,
        price: priceOf(rawPrice),
        size,
        side: sideOf(sideChar),
        aggressorProvenance: 'EXCHANGE_NATIVE',
        sourceProvider,
      };
    }
    return { parsed, recLen };
  }
  if (rtype === DBN.RTYPE_MBP1 && recLen >= DBN.MBP1_SIZE) {
    const rawTradePx = buffer.readBigInt64LE(16);
    const tradeSize = buffer.readUInt32LE(24);
    const action = String.fromCharCode(buffer[30]);
    const sideChar = String.fromCharCode(buffer[31]);
    const sequence = buffer.readUInt32LE(44);

    const rawBidPx = buffer.readBigInt64LE(48);
    const rawAskPx = buffer.readBigInt64LE(56);
    const bidSize = buffer.readUInt32LE(64);
    const askSize = buffer.readUInt32LE(68);
    const hasBid = isValidPrice(rawBidPx) && isValidSize(bidSize);
    const hasAsk = isValidPrice(rawAskPx) && isValidSize(askSize);

    if (hasBid || hasAsk) {
      parsed.depth = {
        kind: 'snapshot',
        ts: tsMs,
        bids: hasBid ? [{ price: priceOf(rawBidPx), size: bidSize }] : [],
        asks: hasAsk ? [{ price: priceOf(rawAskPx), size: askSize }] : [],
        updateId: sequence,
        sourceProvider,
      };
    }

    if (action === 'T' && isValidPrice(rawTradePx) && isValidSize(tradeSize)) {
      parsed.trade = {
        id: `dbn_${instrumentId}_${sequence}_${tradeSize}`,
        ts: tsMs,
        price: priceOf(rawTradePx),
        size: tradeSize,
        side: sideOf(sideChar),
        aggressorProvenance: 'EXCHANGE_NATIVE',
        sourceProvider,
      };
    }
    return { parsed, recLen };
  }

  if (rtype === DBN.RTYPE_MBP10 && recLen >= DBN.MBP10_SIZE) {
    const rawTradePx = buffer.readBigInt64LE(16);
    const tradeSize = buffer.readUInt32LE(24);
    const action = String.fromCharCode(buffer[30]);
    const sideChar = String.fromCharCode(buffer[31]);
    const sequence = buffer.readUInt32LE(44);

    const bids: { price: number; size: number }[] = [];
    const asks: { price: number; size: number }[] = [];
    for (let i = 0; i < 10; i++) {
      const offset = 48 + i * 32;
      const bPx = buffer.readBigInt64LE(offset);
      const aPx = buffer.readBigInt64LE(offset + 8);
      const bSz = buffer.readUInt32LE(offset + 16);
      const aSz = buffer.readUInt32LE(offset + 20);
      if (isValidPrice(bPx) && isValidSize(bSz)) bids.push({ price: priceOf(bPx), size: bSz });
      if (isValidPrice(aPx) && isValidSize(aSz)) asks.push({ price: priceOf(aPx), size: aSz });
    }

    if (bids.length > 0 || asks.length > 0) {
      parsed.depth = { kind: 'snapshot', ts: tsMs, bids, asks, updateId: sequence, sourceProvider };
    }

    if (action === 'T' && isValidPrice(rawTradePx) && isValidSize(tradeSize)) {
      parsed.trade = {
        id: `dbn_${instrumentId}_${sequence}_${tradeSize}`,
        ts: tsMs,
        price: priceOf(rawTradePx),
        size: tradeSize,
        side: sideOf(sideChar),
        aggressorProvenance: 'EXCHANGE_NATIVE',
        sourceProvider,
      };
    }
    return { parsed, recLen };
  }

  // Unknown record type: length framing is still trusted, so the stream stays aligned.
  return { parsed, recLen };
}

type Phase = 'greeting' | 'subscribing' | 'metadata' | 'streaming' | 'closed';

/**
 * Live socket state machine: greeting -> CRAM auth -> subscription -> DBN metadata -> records.
 * Every callback is generation-guarded so a superseded socket can never publish into the feed that
 * replaced it (same contract as the Binance/Tradovate adapters).
 */
export class DatabentoTransport {
  private socket: DatabentoSocketLike | null = null;
  private generation = 0;
  private phase: Phase = 'closed';
  private buffer = Buffer.alloc(0);
  private reconnectTimer: NodeJS.Timeout | null = null;
  private liveReported = false;
  private intentionalStop = false;
  /** Cleared when the gateway reports a schema this key is not authorized for. */
  private depthAuthorized = true;
  private readonly loggedControl = new Set<string>();

  constructor(
    private readonly config: DatabentoTransportConfig,
    private readonly handlers: DatabentoTransportHandlers,
    private readonly socketFactory?: DatabentoSocketFactory
  ) {}

  public isConnected(): boolean {
    return this.liveReported;
  }

  public connect(): void {
    this.intentionalStop = false;
    this.open();
  }

  private open(): void {
    this.teardownSocket();
    const gen = ++this.generation;
    const dataset = this.config.dataset;
    const host = this.config.host || determineDatabentoGateway(dataset);
    const port = this.config.port || 13000;

    this.phase = 'greeting';
    this.buffer = Buffer.alloc(0);
    this.liveReported = false;
    this.handlers.onStatus('CONNECTING', `connecting to Databento ${dataset} (${this.config.symbols})`);

    const socket = this.socketFactory
      ? this.socketFactory(host, port)
      : (net.createConnection({ host, port }) as unknown as DatabentoSocketLike);
    this.socket = socket;
    dbg(`dialing ${host}:${port} for ${this.config.symbols}`);

    socket.on('connect', () => {
      if (gen !== this.generation) return;
      dbg('tcp connected, waiting for CRAM challenge');
    });
    socket.on('data', (chunk: Buffer | Uint8Array) => {
      if (gen !== this.generation) return;
      dbg(`chunk ${(chunk as Buffer).length ?? '?'}B`);
      try {
        this.onData(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      } catch (err) {
        this.handlers.onError(new Error(`[Databento] record decode failed: ${(err as Error).message}`));
      }
    });
    socket.on('error', (err: Error) => {
      if (gen !== this.generation) return;
      dbg('socket error: ' + err.message);
      this.handlers.onError(new Error(`[Databento] ${err.message}`));
    });
    socket.on('close', () => {
      if (gen !== this.generation) return;
      dbg('socket closed');
      this.liveReported = false;
      this.phase = 'closed';
      if (this.intentionalStop) return;
      this.handlers.onStatus('UNAVAILABLE', 'Databento socket closed, reconnecting in 3s');
      this.scheduleReconnect();
    });
  }



  private onData(chunk: Buffer): void {
    this.buffer = Buffer.concat([this.buffer, chunk]);

    if (this.phase === 'greeting' || this.phase === 'subscribing') {
      let nl: number;
      while ((nl = this.buffer.indexOf(10)) !== -1) {
        const line = this.buffer.subarray(0, nl).toString('utf8').trim();
        this.buffer = this.buffer.subarray(nl + 1);

        const challenge = /cram=([^|\s]+)/.exec(line);
        if (challenge && this.phase === 'greeting') {
          dbg('cram challenge received, sending auth');
          this.socket?.write(buildCramAuthResponse(challenge[1], this.config.apiKey, this.config.dataset));
          this.phase = 'subscribing';
          continue;
        }
        if (line.startsWith('success=1')) {
          dbg('auth ok: ' + line);
          this.subscribe();
          this.phase = 'metadata';
          continue;
        }
        if (line.startsWith('success=0')) {
          const reason = /error=([^|]*)/.exec(line)?.[1] || 'authentication failed';
          // Rejected credentials cannot be fixed by reconnecting: fail closed and stay stopped.
          this.teardownSocket();
          this.phase = 'closed';
          this.intentionalStop = true;
          this.handlers.onStatus('UNAVAILABLE', `Databento auth failed: ${reason}`);
          this.handlers.onError(new Error(`[Databento] auth failed: ${reason}`));
          return;
        }
      }
    }

    if (this.phase === 'metadata') {
      if (this.buffer.length >= 8 && this.buffer.subarray(0, 3).toString('ascii') === DBN.MAGIC) {
        const metaLen = this.buffer.readUInt32LE(4);
        if (this.buffer.length >= 8 + metaLen) {
          this.buffer = this.buffer.subarray(8 + metaLen);
          this.phase = 'streaming';
          dbg(`DBN metadata ${metaLen}B consumed, streaming records`);
        }
      } else if (this.buffer.length > 4096) {
        this.buffer = Buffer.alloc(0);
        this.handlers.onError(new Error('[Databento] unexpected stream preamble (no DBN metadata header)'));
      }
    }

    if (this.phase !== 'streaming') return;

    while (this.buffer.length >= DBN.HEADER_SIZE) {
      const { parsed, recLen } = parseDbnRecord(this.buffer);
      if (recLen === 0 || this.buffer.length < recLen) break;
      this.buffer = this.buffer.subarray(recLen);
      if (!parsed) continue;

      if (parsed.control) {
        if (!this.loggedControl.has(parsed.control)) {
          this.loggedControl.add(parsed.control);
          console.log(`[Feed:databento] ${parsed.control}`);
        }
        // The gateway refuses non-entitled schemas by closing the socket. Remember the refusal so
        // the next session subscribes to trades only instead of looping on a denied schema.
        const denied = /not authorized for ([a-z0-9-]+)/i.exec(parsed.control);
        if (denied && /^mbp/.test(denied[1])) {
          this.depthAuthorized = false;
        }
        continue;
      }

      if (parsed.depth) {
        this.markLive();
        this.handlers.onDepth(parsed.depth);
      }
      if (parsed.trade) {
        this.markLive();
        this.handlers.onTrade(parsed.trade);
      }
    }
  }
  private subscribe(): void {
    const stypeIn = this.config.stypeIn || 'continuous';
    const symbols = this.config.symbols;
    // `trades` carries the real aggressor side (footprint/tape); `mbp-1` is the top-of-book book
    // for the DOM ladder. `is_last` must be 1 on the final request of the batch.
    this.socket?.write(
      `schema=trades|stype_in=${stypeIn}|symbols=${symbols}|snapshot=0|is_last=${this.depthAuthorized ? '0' : '1'}\n`
    );
    if (this.depthAuthorized) {
      this.socket?.write(`schema=mbp-1|stype_in=${stypeIn}|symbols=${symbols}|snapshot=0|is_last=1\n`);
    }
    this.socket?.write('start_session\n');
    dbg(`subscribed: trades${this.depthAuthorized ? ' + mbp-1' : ' (depth schema not authorized)'}`);
  }

  private markLive(): void {
    if (this.liveReported) return;
    this.liveReported = true;
    this.handlers.onStatus('LIVE', `databento ${this.config.dataset} (${this.config.symbols})`);
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (this.intentionalStop) return;
      this.open();
    }, 3000);
  }

  public disconnect(): void {
    this.intentionalStop = true;
    ++this.generation;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.teardownSocket();
    this.liveReported = false;
    this.phase = 'closed';
    this.handlers.onStatus('UNAVAILABLE', 'disconnected');
  }

  private teardownSocket(): void {
    const socket = this.socket;
    this.socket = null;
    if (!socket) return;
    try {
      socket.removeAllListeners();
      socket.on('error', () => {
        /* expected while tearing down */
      });
      socket.destroy();
    } catch {
      /* already settled */
    }
  }
}

